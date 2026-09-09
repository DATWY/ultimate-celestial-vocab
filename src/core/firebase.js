// src/core/firebase.js — Smart Sync v2

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, getDocs, writeBatch, doc, query, where, getDoc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";
import { getState, setVocabulary, saveVocabulary, setGamification, saveGamification, setDailyStats, saveDailyStats, setAllTags, isPreviewMode } from './state.js';
import { buildReviewQueue, getNextCardToReview } from './queue.js';
import { updateStats, updatePanelWordList, displayCard, populateTopicFilters } from '../ui/render.js';
import { showPopup } from '../ui/modal.js';
import { DOM } from '../ui/elements.js';
import { startBackgroundAudioPreload } from './sound.js';
import { getSettingFromDB, saveSettingToDB } from './idb.js';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
const VOCAB_COLLECTION = "celestial_vocab_sync";
const USER_SYNC_COLLECTION = "celestial_user_sync";
export const storage = getStorage(app);

// ===== MUTEX LOCK =====
let _isSyncing = false;
let _syncPendingAfterCurrent = false;

// ===== SERVER TIME CALIBRATION (Clock Skew Protection) =====
let _serverTimeOffset = 0;

export function updateServerTimeOffset(remoteTimeMillis) {
    if (remoteTimeMillis && typeof remoteTimeMillis === 'number' && remoteTimeMillis > 0) {
        const localNow = Date.now();
        const diff = remoteTimeMillis - localNow;
        // Cập nhật offset nếu khác biệt lớn hoặc chưa khởi tạo
        if (Math.abs(diff) > 1000 || _serverTimeOffset === 0) {
            _serverTimeOffset = diff;
        }
    }
}

export function getCalibratedNow() {
    return Date.now() + _serverTimeOffset;
}

// ===== HELPERS =====

/**
 * Chuyển đổi updatedAt từ nhiều format (Firestore Timestamp, number, Date) về milliseconds.
 * Tự động cân chỉnh _serverTimeOffset nếu có dữ liệu từ Cloud.
 */
function toMillis(val) {
    if (!val) return 0;
    let millis = 0;
    if (typeof val === 'number') millis = val;
    else if (typeof val.toMillis === 'function') millis = val.toMillis();
    else if (val instanceof Date) millis = val.getTime();
    else if (typeof val.seconds === 'number') millis = val.seconds * 1000 + (val.nanoseconds || 0) / 1e6;

    if (millis > 0) {
        updateServerTimeOffset(millis);
    }
    return millis;
}

/**
 * Field-level SRS-aware merge: Merge 2 versions của cùng 1 card.
 * Luật:
 *   - isDeleted: true luôn thắng (tombstone)
 *   - Tất cả fields khác: lấy từ bản có updatedAt mới hơn
 * 
 * Trả về merged card.
 */
function mergeCardFields(local, remote) {
    const localTime = toMillis(local.updatedAt);
    const remoteTime = toMillis(remote.updatedAt);
    
    // Tombstone rule: isDeleted = true luôn thắng
    if (remote.isDeleted && !local.isDeleted) {
        return { ...remote, updatedAt: Math.max(localTime, remoteTime) };
    }
    if (local.isDeleted && !remote.isDeleted) {
        return { ...local, updatedAt: Math.max(localTime, remoteTime) };
    }
    
    // Lấy bản có updatedAt mới nhất làm base, merge từ bản còn lại
    if (remoteTime > localTime) {
        // Remote mới hơn: dùng remote làm base
        return { ...remote, updatedAt: remoteTime };
    } else if (localTime > remoteTime) {
        // Local mới hơn: giữ local
        return { ...local, updatedAt: localTime };
    }
    
    // Cùng thời gian: ưu tiên local (vì user đang dùng thiết bị này)
    return { ...local, updatedAt: localTime };
}

// ===== SMART SYNC v2 =====

/**
 * BUG-12 FIX: So sánh nhanh 2 card objects.
 * Chỉ check các fields SRS thay đổi thường xuyên thay vì stringify toàn bộ.
 * Trả về true nếu 2 object giống nhau ở các fields quan trọng.
 */
function isSrsEqual(a, b) {
    if (!a || !b) return a === b;
    return (
        a.stability === b.stability &&
        a.difficulty === b.difficulty &&
        a.srsInterval === b.srsInterval &&
        a.srsDueDate === b.srsDueDate &&
        a.srsStatus === b.srsStatus &&
        a.reps === b.reps &&
        a.lapses === b.lapses &&
        a.isDeleted === b.isDeleted &&
        a.isStarred === b.isStarred &&
        a.isSuspended === b.isSuspended &&
        a.updatedAt === b.updatedAt &&
        a.english === b.english &&
        a.vietnamese === b.vietnamese
    );
}

let _lastLocalWriteTimestamp = 0;

export async function smartSync() {
    // --- MUTEX ---
    if (_isSyncing) {
        console.log("🔄 smartSync đã đang chạy. Đánh dấu pending...");
        _syncPendingAfterCurrent = true;
        return;
    }
    _isSyncing = true;
    _syncPendingAfterCurrent = false;

    console.log("🔄 [Smart Sync v2] Bắt đầu đồng bộ 2 chiều...");
    
    if (sessionStorage.getItem('CHEAT_MODE') === 'true') {
        showPopup("⛔️ Tài khoản đang dùng Cheat. Chặn đồng bộ!", "warning");
        _isSyncing = false;
        return;
    }
    
    // --- UI: Loading state ---
    setSyncUIState('syncing');

    try {
        const stateModule = await import('./state.js');
        const vocabulary = stateModule.getState().vocabulary;
        // CHÚ Ý: Tuyệt đối không dùng lastSyncTime làm lastPullTime vì nó là Date.now() local, sẽ làm miss data từ các thiết bị khác!
        let lastPullTime = await getSettingFromDB('lastPullTime') || 0;
        
        // Bắt buộc Full Pull nếu local chưa có từ vựng nào (thiết bị mới)
        if (!vocabulary || vocabulary.length === 0) {
            console.log("📱 Máy mới/chưa có từ vựng local → Ép Full Pull toàn bộ dữ liệu...");
            lastPullTime = 0;
        }
        
        // ============================================================
        // PHASE 0: FLUSH — Đẩy tất cả card pending trong sync queue lên Cloud TRƯỚC
        // Tránh duplicate writes giữa flushSyncQueue() và Phase 2.
        // ============================================================
        const syncModule = await import('./sync.js');
        const flushedIds = new Set(await syncModule.flushSyncQueue());
        
        // ============================================================
        // PHASE 1: PULL — Tải dữ liệu mới từ Cloud về
        // ============================================================
        let q;
        if (lastPullTime > 0) {
            q = query(collection(db, VOCAB_COLLECTION), where("updatedAt", ">", lastPullTime));
        } else {
            q = collection(db, VOCAB_COLLECTION);
        }
        
        const querySnapshot = await getDocs(q);
        
        let maxPullTime = lastPullTime;
        let needsLocalUpdate = false;
        const pulledIds = new Set();
        
        querySnapshot.forEach(docSnap => {
            const remote = docSnap.data();
            const remoteTime = toMillis(remote.updatedAt);
            
            if (remoteTime > maxPullTime) maxPullTime = remoteTime;
            
            // Normalize timestamps
            remote.updatedAt = remoteTime;
            if (remote.srsDueDate) remote.srsDueDate = toMillis(remote.srsDueDate);
            if (remote.lastReviewDate) remote.lastReviewDate = toMillis(remote.lastReviewDate);
            
            pulledIds.add(remote.id);
            
            const localIndex = stateModule.getVocabIndexById(remote.id);
            
            if (localIndex === -1) {
                // Thẻ mới từ Cloud → thêm vào local
                stateModule.pushCardToVocabulary(remote);
                needsLocalUpdate = true;
            } else {
                const local = vocabulary[localIndex];
                const localTime = toMillis(local.updatedAt);
                
                if (remoteTime === localTime) return; // Không thay đổi
                
                // Field-level merge
                const merged = mergeCardFields(local, remote);
                if (merged.srsDueDate) merged.srsDueDate = toMillis(merged.srsDueDate);
                if (merged.lastReviewDate) merged.lastReviewDate = toMillis(merged.lastReviewDate);
                
                if (!isSrsEqual(merged, local)) {
                    stateModule.updateCardInVocabulary(local.id, merged);
                    needsLocalUpdate = true;
                }
            }
        });

        // ============================================================
        // PHASE 2: PUSH — Đẩy thẻ local có thay đổi chưa lên Cloud
        // ============================================================
        const cardsToPush = [];
        for (const card of vocabulary) {
            if (!card || !card.id) continue;
            const cardTime = toMillis(card.updatedAt);
            
            if (cardTime > lastPullTime && !flushedIds.has(card.id) && !pulledIds.has(card.id)) {
                cardsToPush.push(card);
            }
        }
        
        if (cardsToPush.length > 0) {
            console.log(`☁️ Push ${cardsToPush.length} thẻ local lên Cloud...`);
            
            const BATCH_LIMIT = 500;
            for (let i = 0; i < cardsToPush.length; i += BATCH_LIMIT) {
                const batch = writeBatch(db);
                const chunk = cardsToPush.slice(i, i + BATCH_LIMIT);
                
                for (const card of chunk) {
                    const cleanData = JSON.parse(JSON.stringify(card));
                    const cardRef = doc(db, VOCAB_COLLECTION, card.id);
                    batch.set(cardRef, cleanData, { merge: true });
                }
                
                await batch.commit();
            }
            _lastLocalWriteTimestamp = Date.now();
            console.log(`☁️ Đã push ${cardsToPush.length} thẻ.`);
        }

        // ============================================================
        // PHASE 3: Đồng bộ Gamification & Stats & Settings & Logs
        // ============================================================
        await syncGamification();
        await syncDailyStats();
        await syncUserSettings();
        await syncReviewLogs();

        // ============================================================
        // PHASE 4: Cập nhật UI & Lưu timestamps
        // ============================================================
        if (needsLocalUpdate) {
            setVocabulary(vocabulary);
            
            // Rebuild allTags từ vocabulary vừa pull
            const newTags = new Set(['all']);
            vocabulary.forEach(word => {
                if (word && word.tags && Array.isArray(word.tags)) {
                    word.tags.forEach(t => newTags.add(t));
                }
            });
            setAllTags(newTags);
            
            await saveVocabulary(true); 
            buildReviewQueue();
            updateStats();
            populateTopicFilters();
            updatePanelWordList();
            displayCard(getNextCardToReview());
            console.log("📱 Đã cập nhật dữ liệu từ Cloud về máy.");
            showPopup("Đã đồng bộ dữ liệu với Cloud!", "success");
            startBackgroundAudioPreload(vocabulary);
        } else if (cardsToPush.length > 0) {
            console.log(`☁️ Push ${cardsToPush.length} thẻ (không có thay đổi từ Cloud).`);
        } else {
            console.log("✅ Dữ liệu đã đồng bộ hoàn toàn.");
        }

        // Lưu lastPullTime = max timestamp từ Cloud
        if (maxPullTime > lastPullTime) {
            await saveSettingToDB('lastPullTime', maxPullTime);
        }
        await saveSettingToDB('lastSyncTime', Date.now());

        setSyncUIState('success');
    } catch (error) {
        console.error("Lỗi đồng bộ Firebase:", error);
        showPopup("Lỗi đồng bộ: " + error.message, "error");
        setSyncUIState('error');
    } finally {
        _isSyncing = false;
        
        if (_syncPendingAfterCurrent) {
            _syncPendingAfterCurrent = false;
            console.log("🔄 Có yêu cầu sync pending. Chạy lại...");
            setTimeout(() => smartSync(), 1000);
        }
    }
}

// ===== PHASE 3 HELPERS: Tách nhỏ để dễ đọc và maintain =====

async function syncGamification() {
    const gamificationRef = doc(db, USER_SYNC_COLLECTION, "gamification");
    const remoteGamificationSnap = await getDoc(gamificationRef);
    const remoteGamification = remoteGamificationSnap.exists() ? remoteGamificationSnap.data() : null;
    const localGamification = getState().gamification || {};
    
    let mergedGamification = { ...localGamification };
    if (remoteGamification) {
        // Monotonic counters: lấy max
        mergedGamification.userXP = Math.max(localGamification.userXP || 0, remoteGamification.userXP || 0);
        mergedGamification.currentLevel = Math.max(localGamification.currentLevel || 1, remoteGamification.currentLevel || 1);
        mergedGamification.currentStreak = Math.max(localGamification.currentStreak || 0, remoteGamification.currentStreak || 0);
        mergedGamification.totalReviews = Math.max(localGamification.totalReviews || 0, remoteGamification.totalReviews || 0);
        mergedGamification.consecutiveCorrect = localGamification.consecutiveCorrect ?? remoteGamification.consecutiveCorrect ?? 0;
        mergedGamification.longestStreak = Math.max(localGamification.longestStreak || 0, remoteGamification.longestStreak || 0);
        
        // Merge arrays: union
        const unlockedSet = new Set([...(localGamification.unlockedBadges || []), ...(remoteGamification.unlockedBadges || [])]);
        mergedGamification.unlockedBadges = Array.from(unlockedSet);
        
        // Merge heatmap: max per day
        const localHeatmap = localGamification.activityHeatmap || {};
        const remoteHeatmap = remoteGamification.activityHeatmap || {};
        const mergedHeatmap = { ...remoteHeatmap };
        for (const key in localHeatmap) {
            mergedHeatmap[key] = Math.max(localHeatmap[key] || 0, remoteHeatmap[key] || 0);
        }
        mergedGamification.activityHeatmap = mergedHeatmap;
        
        // Merge lastStudyDate: lấy ngày mới nhất
        if (remoteGamification.lastStudyDate && (!localGamification.lastStudyDate || remoteGamification.lastStudyDate > localGamification.lastStudyDate)) {
            mergedGamification.lastStudyDate = remoteGamification.lastStudyDate;
        }

        // Merge stats object: max cho mỗi field số
        if (remoteGamification.stats) {
            mergedGamification.stats = mergedGamification.stats || {};
            for (const key in remoteGamification.stats) {
                const localVal = mergedGamification.stats[key];
                const remoteVal = remoteGamification.stats[key];
                if (typeof remoteVal === 'number' && typeof localVal === 'number') {
                    mergedGamification.stats[key] = Math.max(localVal, remoteVal);
                } else if (typeof remoteVal === 'string' && typeof localVal === 'string') {
                    // String dates: lấy mới nhất
                    mergedGamification.stats[key] = remoteVal > localVal ? remoteVal : localVal;
                } else if (localVal === undefined || localVal === null) {
                    mergedGamification.stats[key] = remoteVal;
                }
            }
        }
    }
    
    const { isPreviewMode } = await import('./state.js');
    if (isPreviewMode()) {
        console.log("⚠️ Đang ở chế độ Preview, bỏ qua đồng bộ Gamification xuống local UI.");
        return;
    }

    setGamification(mergedGamification);
    await saveGamification();
    const cleanGamification = JSON.parse(JSON.stringify(mergedGamification));
    if (!remoteGamification || JSON.stringify(cleanGamification) !== JSON.stringify(remoteGamification)) {
        await setDoc(gamificationRef, cleanGamification);
        _lastLocalWriteTimestamp = Date.now();
    }
}

async function syncDailyStats() {
    const statsRef = doc(db, USER_SYNC_COLLECTION, "dailyStats");
    const remoteStatsSnap = await getDoc(statsRef);
    const remoteStats = remoteStatsSnap.exists() ? remoteStatsSnap.data() : null;
    const localStats = getState().dailyStats || {};
    
    let mergedStats = { ...localStats };
    if (remoteStats) {
        const localDate = localStats.lastDate || "";
        const remoteDate = remoteStats.lastDate || "";
        
        if (remoteDate === localDate) {
            // Cùng ngày: lấy max
            mergedStats.newCardsDoneToday = Math.max(localStats.newCardsDoneToday || 0, remoteStats.newCardsDoneToday || 0);
            mergedStats.todayCorrect = Math.max(localStats.todayCorrect || 0, remoteStats.todayCorrect || 0);
            mergedStats.todayTotal = Math.max(localStats.todayTotal || 0, remoteStats.todayTotal || 0);
        } else if (remoteDate > localDate) {
            // Remote mới hơn: dùng remote stats
            mergedStats.newCardsDoneToday = remoteStats.newCardsDoneToday || 0;
            mergedStats.todayCorrect = remoteStats.todayCorrect || 0;
            mergedStats.todayTotal = remoteStats.todayTotal || 0;
            mergedStats.lastDate = remoteDate;
        }
        
        // Merge retentionHistory: union by date, giữ max total
        const localHistory = localStats.retentionHistory || [];
        const remoteHistory = remoteStats.retentionHistory || [];
        const historyMap = new Map();
        for (const entry of [...remoteHistory, ...localHistory]) {
            if (entry && entry.date) {
                const existing = historyMap.get(entry.date);
                if (!existing || (entry.total || 0) > (existing.total || 0)) {
                    historyMap.set(entry.date, entry);
                }
            }
        }
        mergedStats.retentionHistory = Array.from(historyMap.values())
            .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
            .slice(-3);
        
        // Preserve currentLimit
        mergedStats.currentLimit = mergedStats.currentLimit || remoteStats.currentLimit;
    }
    
    setDailyStats(mergedStats);
    await saveDailyStats();
    const cleanStats = JSON.parse(JSON.stringify(mergedStats));
    if (!remoteStats || JSON.stringify(cleanStats) !== JSON.stringify(remoteStats)) {
        await setDoc(statsRef, cleanStats);
        _lastLocalWriteTimestamp = Date.now();
    }
}

async function syncUserSettings() {
    const { isPreviewMode } = await import('./state.js');
    if (isPreviewMode()) return;

    const settingsRef = doc(db, USER_SYNC_COLLECTION, "settings");
    const remoteSettingsSnap = await getDoc(settingsRef);
    if (remoteSettingsSnap.exists()) {
        const remoteSettings = remoteSettingsSnap.data();
        const localTrainedAt = await getSettingFromDB('userParamsTrainedAt') || 0;
        const remoteTrainedAt = remoteSettings.trainedAt || 0;

        if (remoteTrainedAt > localTrainedAt) {
            const m = await import('./state.js');
            m.setUserSrsParams(remoteSettings.userRecallParams || null, remoteSettings.userLapseParams || null);
            if (remoteSettings.userFsrs7Params && Array.isArray(remoteSettings.userFsrs7Params) && remoteSettings.userFsrs7Params.length === 34) {
                await m.setUserFsrs7Params(remoteSettings.userFsrs7Params);
            }
            await saveSettingToDB('userParamsTrainedAt', remoteTrainedAt);
            console.log("☁️ Đã tải bộ thông số cá nhân hoá FSRS-7 từ Firebase về máy.");
        }
    }
}

async function syncReviewLogs() {
    const reviewLogsRef = doc(db, USER_SYNC_COLLECTION, "reviewLogs");
    const remoteLogsSnap = await getDoc(reviewLogsRef);
    const localLogs = getState().reviewLogs || { dict: [], logs: [] };
    
    if (remoteLogsSnap.exists()) {
        const remoteLogsRaw = remoteLogsSnap.data();
        const remoteLogs = {
            dict: remoteLogsRaw.dict || [],
            logs: (remoteLogsRaw.logs || []).map(str => typeof str === 'string' ? str.split(',').map(Number) : str)
        };
        
        const m = await import('./state.js');
        const mergedLogs = m.mergeReviewLogs(remoteLogs, localLogs);
        m.setReviewLogs(mergedLogs);
        await saveSettingToDB('reviewLogs', mergedLogs);
        
        const firestoreLogs = {
            dict: mergedLogs.dict,
            logs: (mergedLogs.logs || []).map(log => typeof log === 'string' ? log : Array.isArray(log) ? log.join(',') : String(log))
        };
        if (JSON.stringify(firestoreLogs) !== JSON.stringify(remoteLogsRaw)) {
            await setDoc(reviewLogsRef, firestoreLogs);
            _lastLocalWriteTimestamp = Date.now();
            console.log(`☁️ Đã hợp nhất ${mergedLogs.logs.length} bản ghi học tập.`);
        }
    } else if (localLogs && localLogs.logs && localLogs.logs.length > 0) {
        const firestoreLogs = {
            dict: localLogs.dict,
            logs: (localLogs.logs || []).map(log => typeof log === 'string' ? log : Array.isArray(log) ? log.join(',') : String(log))
        };
        await setDoc(reviewLogsRef, firestoreLogs);
        _lastLocalWriteTimestamp = Date.now();
        console.log(`☁️ Đã đẩy ${localLogs.logs.length} bản ghi lên Cloud lần đầu.`);
    }
}

// ===== SYNC UI STATE =====

function setSyncUIState(state) {
    if (!DOM.manualSyncBtn) return;
    
    switch (state) {
        case 'syncing':
            DOM.manualSyncBtn.classList.add('syncing-active');
            DOM.manualSyncBtn.innerHTML = '<i class="ph-duotone ph-arrows-clockwise animate-spin"></i>';
            DOM.manualSyncBtn.title = 'Đang đồng bộ...';
            break;
        case 'success':
            DOM.manualSyncBtn.classList.remove('syncing-active');
            DOM.manualSyncBtn.innerHTML = '<i class="ph-duotone ph-cloud-check"></i>';
            DOM.manualSyncBtn.title = 'Đồng bộ thành công';
            setTimeout(() => {
                if (DOM.manualSyncBtn) {
                    DOM.manualSyncBtn.innerHTML = '<i class="ph-duotone ph-arrows-clockwise"></i>';
                    DOM.manualSyncBtn.title = 'Đồng bộ thủ công';
                }
            }, 2500);
            break;
        case 'offline':
            DOM.manualSyncBtn.classList.remove('syncing-active');
            DOM.manualSyncBtn.innerHTML = '<i class="ph-duotone ph-cloud-slash"></i>';
            DOM.manualSyncBtn.title = 'Đang ngoại tuyến (Offline)';
            break;
        case 'error':
            DOM.manualSyncBtn.classList.remove('syncing-active');
            DOM.manualSyncBtn.innerHTML = '<i class="ph-duotone ph-cloud-warning"></i>';
            DOM.manualSyncBtn.title = 'Đồng bộ thất bại!';
            break;
    }
}

// ===== ONLINE/OFFLINE DETECTION =====

let _onlineHandlerAttached = false;

export function setupOnlineOfflineListeners() {
    if (_onlineHandlerAttached) return;
    _onlineHandlerAttached = true;
    
    window.addEventListener('online', () => {
        console.log("🌐 Đã kết nối mạng. Đồng bộ tự động...");
        setSyncUIState('syncing');
        // Đợi 2s cho kết nối ổn định
        setTimeout(() => smartSync(), 2000);
    });
    
    window.addEventListener('offline', () => {
        console.log("📴 Mất kết nối mạng. Dữ liệu sẽ được lưu cục bộ.");
        setSyncUIState('offline');
    });
    
    // Set initial state
    if (!navigator.onLine) {
        setSyncUIState('offline');
    }
}

// ===== REAL-TIME MULTI-DEVICE LISTENERS =====

let _realtimeUnsubscribers = [];

export function setupRealtimeSyncListener() {
    if (_realtimeUnsubscribers.length > 0) return;

    let debounceTimer = null;
    const triggerDebouncedSync = (sourceName) => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            console.log(`⚡️ [Real-time Sync] Phát hiện thay đổi từ thiết bị khác (${sourceName}). Đang đồng bộ...`);
            smartSync();
        }, 1500);
    };

    try {
        // 1. Lắng nghe thay đổi trên sub-documents user settings/gamification/dailyStats
        const docsToWatch = ['settings', 'gamification', 'dailyStats', 'reviewLogs'];
        docsToWatch.forEach(docName => {
            const docRef = doc(db, USER_SYNC_COLLECTION, docName);
            const unsub = onSnapshot(docRef, (snapshot) => {
                // Chỉ kích hoạt sync nếu thay đổi tới từ xa (Cloud/thiết bị khác), không phải do local ghi
                if (!snapshot.metadata.hasPendingWrites && snapshot.exists()) {
                    // Nếu phản hồi snapshot này xảy ra ngay sau một thao tác ghi từ máy này, bỏ qua để tránh vòng lặp
                    if (Date.now() - _lastLocalWriteTimestamp < 5000) return;
                    triggerDebouncedSync(docName);
                }
            }, (err) => {
                console.warn(`Lỗi Realtime listener (${docName}):`, err);
            });
            _realtimeUnsubscribers.push(unsub);
        });

        console.log("⚡️ Real-time multi-device sync listener đã được kích hoạt.");
    } catch (e) {
        console.error("Không thể khởi chạy Real-time sync listener:", e);
    }
}