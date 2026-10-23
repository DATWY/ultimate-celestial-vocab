import { saveReviewLogsToDB } from './idb.js';
import { mergeLearningSettings } from './settings-merge.js';
import { announceSyncStatus } from './sync-status.js';
import { saveProgressToDB } from './idb.js';
import { mergeProgress } from './progress-merge.js';
import { prepareProgress, acceptProgress } from './state.js';
// src/core/firebase.js — Smart Sync v2

import { initializeApp } from "firebase/app";
import { initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager, collection, getDocs, writeBatch, doc, query, where, getDoc, setDoc, onSnapshot, serverTimestamp, runTransaction, Timestamp } from "firebase/firestore";
import { mergeCardFields, isSrsEqual, normalizeCard, toMillis } from './card-merge.js';
export { mergeCardFields, isSrsEqual, toMillis } from './card-merge.js';
import { getStorage } from "firebase/storage";
import { getState, setVocabulary, saveVocabulary, setGamification, saveGamification, setDailyStats, saveDailyStats, setAllTags, isPreviewMode, calculateStreakFromHeatmap, reconcileStreakFreeze, setInitialSyncDone, syncStreakFromHeatmap, getLocalDateString } from './state.js';
import { buildReviewQueue, getNextCardToReview } from './queue.js';
import { updateStats, updatePanelWordList, displayCard, populateTopicFilters } from '../ui/render.js';
import { renderGamificationUI } from '../features/gamification.js';
import { showPopup, showToast } from '../ui/modal.js';
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
let _db;
try {
    _db = initializeFirestore(app, {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    });
} catch (_) {
    _db = getFirestore(app);
}
export const db = _db;
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

// ===== DEVICE FINGERPRINT & ANTI-ECHO =====
export { getDeviceId } from './device.js';
import { getDeviceId } from './device.js';

// ===== HELPERS =====

/** Read and merge within the same transaction; retries never mutate local state. */
export async function writeMergedCards(cards) {
    const snapshot = cards.map(card => JSON.parse(JSON.stringify(normalizeCard(card))));
    const committed = [];
    for (let i = 0; i < snapshot.length; i += 100) {
        const chunk = snapshot.slice(i, i + 100);
        const merged = await runTransaction(db, async transaction => {
            const refs = chunk.map(card => doc(db, VOCAB_COLLECTION, card.id));
            const remote = await Promise.all(refs.map(ref => transaction.get(ref)));
            return chunk.map((card, index) => {
                const result = mergeCardFields(card, remote[index].exists() ? remote[index].data() : null);
                if (!remote[index].exists() || !isSrsEqual(result, remote[index].data())) {
                    transaction.set(refs[index], { ...result, syncedAt: serverTimestamp(), _lastModifiedBy: getDeviceId() });
                }
                return result;
            });
        });
        committed.push(...merged);
    }
    return committed;
}

let _lastLocalWriteTimestamp = 0;

export async function smartSync({ forceFullPull = false, isManual = false } = {}) {
    // --- MUTEX ---
    if (_isSyncing) {
        console.log("🔄 smartSync đã đang chạy. Đánh dấu pending...");
        _syncPendingAfterCurrent = true;
        return;
    }
    _isSyncing = true;
    _syncPendingAfterCurrent = false;

    console.log(`🔄 [Smart Sync v3] Bắt đầu đồng bộ 2 chiều (forceFullPull=${forceFullPull})...`);
    
    if (sessionStorage.getItem('CHEAT_MODE') === 'true') {
        if (sessionStorage.getItem('ISOLATED_TEST_MODE') === 'true') {
            console.log("🧪 Đang ở chế độ Isolated Test Mode. Bỏ qua đồng bộ Cloud không hiển thị popup.");
            _isSyncing = false;
            return;
        }
        showPopup("⛔️ Tài khoản đang dùng Cheat. Chặn đồng bộ!", "warning");
        _isSyncing = false;
        return;
    }
    
    // --- UI: Loading state ---
    setSyncUIState('syncing');

    try {
        const stateModule = await import('./state.js');
        const vocabulary = stateModule.getState().vocabulary || [];
        // CHÚ Ý: Tuyệt đối không dùng lastSyncTime làm lastPullTime vì nó là Date.now() local, sẽ làm miss data từ các thiết bị khác!
        const protocol = await getSettingFromDB('syncProtocol');
        let lastPullTime = forceFullPull || protocol !== 2 ? 0 : (await getSettingFromDB('lastPullTime') || 0);
        
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
        // PHASE 1: PULL — Tải dữ liệu mới từ Cloud về (với safety buffer 10 giây)
        // ============================================================
        const PULL_SAFETY_BUFFER_MS = 10000; // 10 giây overlap phòng trễ mạng nhẹ
        let q;
        if (lastPullTime > 0) {
            const bufferedPullTime = Math.max(0, lastPullTime - PULL_SAFETY_BUFFER_MS);
            q = query(collection(db, VOCAB_COLLECTION), where("syncedAt", ">", Timestamp.fromMillis(bufferedPullTime)));
        } else {
            q = collection(db, VOCAB_COLLECTION);
        }
        
        const querySnapshot = await getDocs(q);
        
        let maxPullTime = lastPullTime;
        let needsLocalUpdate = flushedIds.size > 0;
        const pulledIds = new Set();
        const convergedCardsToPush = [];
        const myDeviceId = getDeviceId();
        
        querySnapshot.forEach(docSnap => {
            const remote = normalizeCard(docSnap.data());
            remote.id = docSnap.id;
            const remoteTime = toMillis(remote.updatedAt);
            
            const remoteSyncedTime = toMillis(remote.syncedAt);
            maxPullTime = Math.max(maxPullTime, remoteSyncedTime);
            
            // Normalize timestamps
            remote.updatedAt = remoteTime;
            if (remote.srsDueDate) remote.srsDueDate = toMillis(remote.srsDueDate);
            if (remote.lastReviewDate) remote.lastReviewDate = toMillis(remote.lastReviewDate);
            
            pulledIds.add(remote.id);

            // Bỏ qua loopback/echo nếu thẻ do chính máy này vừa ghi và remote chưa có sửa đổi nào mới hơn
            if (remote._lastModifiedBy === myDeviceId && remoteSyncedTime <= _lastLocalWriteTimestamp) {
                return;
            }
            
            const localIndex = stateModule.getVocabIndexById(remote.id);
            
            if (localIndex === -1) {
                // Thẻ mới từ Cloud → thêm vào local
                stateModule.pushCardToVocabulary(remote);
                needsLocalUpdate = true;
            } else {
                const local = vocabulary[localIndex];
                const localTime = toMillis(local.updatedAt);
                
                if (remoteTime === localTime && isSrsEqual(local, remote)) {
                    return; // Hoàn toàn đồng nhất
                }
                
                // Field-level merge với 4 vector độc lập
                const merged = mergeCardFields(local, remote);
                if (merged.srsDueDate) merged.srsDueDate = toMillis(merged.srsDueDate);
                if (merged.lastReviewDate) merged.lastReviewDate = toMillis(merged.lastReviewDate);
                
                // Cập nhật local nếu phiên bản merge có dữ liệu mới
                if (!isSrsEqual(merged, local)) {
                    stateModule.updateCardInVocabulary(local.id, merged);
                    needsLocalUpdate = true;
                }

                // CRITICAL MULTI-DEVICE FIX:
                // Nếu merged khác remote trên Cloud, tức là local có dữ liệu/review/tag mới hơn Cloud.
                // Ta phải đẩy phiên bản hội tụ này ngược lên Cloud để các máy khác cùng nhận được!
                if (!isSrsEqual(merged, remote)) {
                    convergedCardsToPush.push(merged);
                }
            }
        });

        // ============================================================
        // PHASE 2: PUSH — Đẩy thẻ local chưa lên Cloud + thẻ đã merge hội tụ
        // ============================================================
        const cardsToPushMap = new Map();

        // 1. Thêm các thẻ cần đẩy do kết quả merge hội tụ
        for (const card of convergedCardsToPush) {
            if (card && card.id) {
                cardsToPushMap.set(card.id, card);
            }
        }

        // 2. Thêm các thẻ local mới tạo/import chưa từng sync lên Cloud bao giờ (!card.syncedAt)
        for (const card of vocabulary) {
            if (!card || !card.id) continue;
            // Chỉ push thẻ chưa từng được sync lên Cloud bao giờ
            // Thẻ đã sync rồi nếu có sửa thì đã nằm trong flushedIds (qua outbox)
            if (!card.syncedAt && !flushedIds.has(card.id)) {
                if (!cardsToPushMap.has(card.id)) {
                    cardsToPushMap.set(card.id, card);
                }
            }
        }
        
        const cardsToPush = Array.from(cardsToPushMap.values());

        if (cardsToPush.length > 0) {
            console.log(`☁️ Push ${cardsToPush.length} thẻ (${convergedCardsToPush.length} thẻ hội tụ) lên Cloud...`);
            
            const committedCards = await writeMergedCards(cardsToPush);
            for (const committed of committedCards) {
                const current = stateModule.getVocabById(committed.id);
                if (current) stateModule.updateCardInVocabulary(committed.id, mergeCardFields(current, committed));
            }
            needsLocalUpdate = true;
            _lastLocalWriteTimestamp = Date.now();
            console.log(`☁️ Đã push thành công ${cardsToPush.length} thẻ.`);
        }

        // ============================================================
        // PHASE 3: Đồng bộ Gamification & Stats & Settings & Logs
        // ============================================================
        const { gamificationChanged = false, statsChanged = false } = await syncProgressToFirebase() || {};
        await syncUserSettings();

        // ============================================================
        // PHASE 4: Cập nhật UI & Lưu timestamps
        // ============================================================
        const isManageModalOpen = DOM.manageModal && !DOM.manageModal.classList.contains('hidden');
        const isOverviewTabActive = isManageModalOpen && document.getElementById('profile-view-overview')?.classList.contains('active');
        const isWordsTabActive = isManageModalOpen && document.getElementById('manage-view-words')?.classList.contains('active');
        const isBadgesTabActive = isManageModalOpen && document.getElementById('profile-view-badges')?.classList.contains('active');

        if (needsLocalUpdate) {
            const latestVocab = stateModule.getState().vocabulary || vocabulary;
            setVocabulary([...latestVocab]);
            
            // Rebuild allTags từ vocabulary vừa pull
            const newTags = new Set(['all']);
            latestVocab.forEach(word => {
                if (word && word.tags && Array.isArray(word.tags)) {
                    word.tags.forEach(t => newTags.add(t));
                }
            });
            setAllTags(newTags);
            
            await saveVocabulary(true); 
            const state = stateModule.getState();
            const currentCardIndex = state.currentCardIndex;
            const isCurrentCardValid = currentCardIndex >= 0 && 
                currentCardIndex < latestVocab.length && 
                latestVocab[currentCardIndex] && 
                !latestVocab[currentCardIndex].isDeleted;

            // Rebuild review queue để nạp tất cả các thẻ mới hoặc thẻ đến hạn từ Cloud
            buildReviewQueue();

            const typingInput = typeof document !== 'undefined' ? document.getElementById('typing-input') : null;
            const isUserActivelyTyping = typingInput && (document.activeElement === typingInput || typingInput.value.length > 0);
            const isCardFlipped = state.isFlipped;
            const isActivelyStudying = isCurrentCardValid && (isUserActivelyTyping || isCardFlipped || state.isTransitioning);

            if (isActivelyStudying) {
                // Thẻ hiện tại đang được người dùng thao tác học (gõ phím hoặc lật xem mặt sau):
                // Lưu ngầm vào bộ nhớ/IDB và loại trừ khỏi queue mới, KHÔNG gọi displayCard() gây giật/mất focus.
                const queueAfterRebuild = stateModule.getState().currentReviewQueue;
                const filteredQueue = queueAfterRebuild.filter(idx => idx !== currentCardIndex);
                stateModule.setReviewQueue(filteredQueue);
                console.log(`🧘 [Non-Disruptive Study] Đang học thẻ (index ${currentCardIndex}). Dữ liệu thẻ đã cập nhật ngầm, không làm gián đoạn màn hình học.`);
            } else if (isCurrentCardValid) {
                // Thẻ hiện tại vẫn tồn tại và hợp lệ:
                // Re-render ngay lập tức để ghi đè mọi sửa đổi từ Cloud (nghĩa, ví dụ, trạng thái SRS...),
                // đồng thời giữ nguyên góc lật nếu người dùng đang xem mặt sau.
                displayCard(currentCardIndex, true);

                // Loại bỏ index của thẻ đang xem ra khỏi review queue vừa tạo để tránh lặp lại chính thẻ này
                const queueAfterRebuild = stateModule.getState().currentReviewQueue;
                const filteredQueue = queueAfterRebuild.filter(idx => idx !== currentCardIndex);
                stateModule.setReviewQueue(filteredQueue);
                console.log(`📱 Đã cập nhật và ghi đè nội dung thẻ hiện tại (index ${currentCardIndex}) từ Cloud.`);
            } else {
                // Nếu thẻ hiện tại đã bị xóa trên Cloud hoặc app đang ở màn hình hết bài:
                // Nạp ngay thẻ tiếp theo lên màn hình
                const nextCard = getNextCardToReview();
                displayCard(nextCard);
                console.log(`📱 Đã tự động chèn thẻ mới từ Cloud vào màn hình ôn tập (index ${nextCard}).`);
            }

            updateStats();
            populateTopicFilters();
            if (isWordsTabActive) {
                updatePanelWordList();
            }
            if (isOverviewTabActive) {
                renderGamificationUI({ isBackgroundUpdate: true });
            }

            console.log("📱 Đã đồng bộ và áp dụng dữ liệu từ Cloud về máy thành công.");
            startBackgroundAudioPreload(latestVocab);
        } else {
            // Không có thẻ nào thay đổi từ Cloud:
            // Chỉ cập nhật UI nếu có sự thay đổi thực sự về gamification/stats và màn hình tương ứng đang mở
            if (gamificationChanged || statsChanged) {
                updateStats();
                if (isOverviewTabActive) {
                    renderGamificationUI({ isBackgroundUpdate: true });
                }
                if (isBadgesTabActive) {
                    import('../features/gamification.js').then(m => m.renderBadgesTab?.());
                }
            }
            if (cardsToPush.length > 0) {
                console.log(`☁️ Push ${cardsToPush.length} thẻ (không có thay đổi từ Cloud).`);
            } else {
                console.log("✅ Dữ liệu đã đồng bộ hoàn toàn.");
            }
        }

        // Lưu lastPullTime = max timestamp từ Cloud
        await saveSettingToDB('lastPullTime', maxPullTime);
        await saveSettingToDB('syncProtocol', 2);
        await saveSettingToDB('lastSyncTime', Date.now());

        setInitialSyncDone(true);
        syncStreakFromHeatmap({ allowFreeze: true });

        setSyncUIState('success');
        if (cardsToPush.length > 0 || gamificationChanged || statsChanged) {
            sendSyncBeacon('all');
        }
        if (isManual) {
            showToast("Đồng bộ thành công", "Dữ liệu đã được đồng bộ an toàn với Cloud.", "ph-cloud-check");
        }
    } catch (error) {
        console.error("Lỗi đồng bộ Firebase:", error);
        if (isManual) {
            let msg = error.message || "Vui lòng kiểm tra kết nối mạng.";
            if (error.code === 'resource-exhausted' || (error.message && error.message.includes('Quota exceeded'))) {
                msg = "Hạn mức Firebase miễn phí hôm nay đã đạt giới hạn (tự động hồi phục lúc 14:00). Bạn vẫn học bình thường 100% offline trên máy!";
            }
            showToast("Lỗi đồng bộ", msg, "ph-warning-circle");
        }
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

function mergeGamification(localGamification, remoteGamification) {
    const result = mergeProgress(localGamification, remoteGamification, 'gamification');
    reconcileStreakFreeze(result);
    const streak = calculateStreakFromHeatmap(
        result.activityHeatmap,
        getLocalDateString(),
        result.frozenDates,
        result.recoveredDates
    );
    result.currentStreak = streak.currentStreak;
    result.longestStreak = Math.max(result.longestStreak || 0, streak.longestStreak);
    return result;
}

async function syncGamification() {
    if (isPreviewMode()) return false;
    const local = JSON.parse(JSON.stringify(prepareProgress('gamification')));
    const ref = doc(db, USER_SYNC_COLLECTION, 'gamification');
    const merged = await runTransaction(db, async transaction => {
        const snap = await transaction.get(ref);
        const result = mergeGamification(local, snap.exists() ? snap.data() : null);
        transaction.set(ref, JSON.parse(JSON.stringify(result)));
        return result;
    });
    const before = JSON.stringify(getState().gamification);
    const current = acceptProgress(merged, 'gamification');
    acceptProgress(await saveProgressToDB('gamification', current, 'gamification'), 'gamification');
    return before !== JSON.stringify(current);
}

function mergeDailyStats(localStats, remoteStats) {
    return mergeProgress(localStats, remoteStats, 'daily', localStats.lastDate);
}

async function syncDailyStats() {
    if (isPreviewMode()) return false;
    const local = JSON.parse(JSON.stringify(prepareProgress('daily')));
    const ref = doc(db, USER_SYNC_COLLECTION, 'dailyStats');
    const merged = await runTransaction(db, async transaction => {
        const snap = await transaction.get(ref);
        const result = mergeDailyStats(local, snap.exists() ? snap.data() : null);
        transaction.set(ref, JSON.parse(JSON.stringify(result)));
        return result;
    });
    const before = JSON.stringify(getState().dailyStats);
    const current = acceptProgress(merged, 'daily');
    acceptProgress(await saveProgressToDB('dailyStats', current, 'daily'), 'daily');
    return before !== JSON.stringify(current);
}

export async function syncUserSettings() {
    if (isPreviewMode() || sessionStorage.getItem('CHEAT_MODE') === 'true' || !navigator.onLine) return;
    const state = await import('./state.js');
    const current = state.getState();
    const local = { userFsrs7Params: current.userFsrs7Params || null,
        userFsrs7TrainedAt: current.userFsrs7TrainedAt || 0, trainedAt: current.userFsrs7TrainedAt || 0 };
    const ref = doc(db, USER_SYNC_COLLECTION, 'settings');
    const merged = await runTransaction(db, async transaction => {
        const snap = await transaction.get(ref);
        const result = mergeLearningSettings(local, snap.exists() ? snap.data() : null);
        if (result.trainedAt) transaction.set(ref, { ...result, version: '7.0', _lastModifiedBy: getDeviceId() });
        return result;
    });
    // A manual change made during this request is kept for the next sync.
    if (state.getState().userFsrs7TrainedAt !== current.userFsrs7TrainedAt) return;
    if (merged.trainedAt > local.trainedAt) {
        await state.setUserFsrs7Params(merged.userFsrs7Params, merged.trainedAt);
        document.dispatchEvent(new CustomEvent('learning-settings:updated'));
    }
}

async function syncReviewLogs() {
    if (isPreviewMode()) return;
    const state = await import('./state.js');
    const local = JSON.parse(JSON.stringify(getState().reviewLogs || { dict: [], logs: [] }));
    const ref = doc(db, USER_SYNC_COLLECTION, 'reviewLogs');
    const merged = await runTransaction(db, async transaction => {
        const snap = await transaction.get(ref);
        const raw = snap.exists() ? snap.data() : { dict: [], logs: [] };
        const remote = { ...raw, logs: (raw.logs || []).map(row => {
            if (Array.isArray(row)) return row;
            if (row.startsWith('[')) return JSON.parse(row);
            return row.split(',').map((part, index) => index < 5 ? Number(part) : part);
        }) };
        const result = state.mergeReviewLogs(remote, local);
        // Constrain Cloud payload to the most recent 3,000 logs (<240 KB),
        // perfectly aligning with the FSRS-7 optimizer training window and preventing 1 MiB Firestore document crash.
        const cloudLogs = result.logs.slice(-3000);
        const cloudDeletedIds = (result.deletedIds || []).slice(-500);
        transaction.set(ref, {
            dict: result.dict,
            logs: cloudLogs.map(row => JSON.stringify(row)),
            deletedIds: cloudDeletedIds
        });
        return result;
    });
    // Include reviews and Undo tombstones created while the request was in flight.
    const current = state.mergeReviewLogs(merged, getState().reviewLogs);
    state.setReviewLogs(current);
    const saved = await saveReviewLogsToDB(current);
    state.setReviewLogs(state.mergeReviewLogs(state.getState().reviewLogs, saved));
}

let _progressSyncPromise = null;
export async function syncProgressToFirebase() {
    if (_progressSyncPromise) return _progressSyncPromise;
    if (isPreviewMode() || sessionStorage.getItem('CHEAT_MODE') === 'true') return;
    _progressSyncPromise = (async () => {
        const gamificationChanged = await syncGamification();
        const statsChanged = await syncDailyStats();
        await syncReviewLogs();
        return { gamificationChanged, statsChanged };
    })();
    try { return await _progressSyncPromise; }
    finally { _progressSyncPromise = null; }
}

// ===== SYNC UI STATE =====

function setSyncUIState(state) {
    announceSyncStatus({ phase: state });
    if (!DOM.manualSyncBtn) return;
    DOM.manualSyncBtn.setAttribute('aria-busy', String(state === 'syncing'));
    const icon = DOM.manualSyncBtn.querySelector('i');
    
    switch (state) {
        case 'syncing':
            DOM.manualSyncBtn.classList.add('syncing-active');
            if (icon) icon.className = 'ph-duotone ph-arrows-clockwise animate-spin';
            DOM.manualSyncBtn.title = 'Đang đồng bộ...';
            break;
        case 'success':
            DOM.manualSyncBtn.classList.remove('syncing-active');
            if (icon) icon.className = 'ph-duotone ph-cloud-check';
            DOM.manualSyncBtn.title = 'Đồng bộ thành công';
            setTimeout(() => {
                if (DOM.manualSyncBtn) {
                    const ic = DOM.manualSyncBtn.querySelector('i');
                    if (ic) ic.className = 'ph-duotone ph-arrows-clockwise';
                    DOM.manualSyncBtn.title = 'Đồng bộ Cloud';
                }
            }, 2500);
            break;
        case 'offline':
            DOM.manualSyncBtn.classList.remove('syncing-active');
            if (icon) icon.className = 'ph-duotone ph-cloud-slash';
            DOM.manualSyncBtn.title = 'Đang ngoại tuyến (Offline)';
            break;
        case 'error':
            DOM.manualSyncBtn.classList.remove('syncing-active');
            if (icon) icon.className = 'ph-duotone ph-cloud-warning';
            DOM.manualSyncBtn.title = 'Đồng bộ thất bại!';
            setTimeout(() => {
                if (DOM.manualSyncBtn) {
                    const ic = DOM.manualSyncBtn.querySelector('i');
                    if (ic) ic.className = 'ph-duotone ph-arrows-clockwise';
                    DOM.manualSyncBtn.title = 'Đồng bộ Cloud';
                }
            }, 4000);
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

// ===== REAL-TIME MULTI-DEVICE SIGNALING BEACON =====
const BEACON_DOC = "sync_beacon";
let _beaconDebounceTimer = null;

export function sendSyncBeacon(type = 'all') {
    if (isPreviewMode() || (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('CHEAT_MODE') === 'true')) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    clearTimeout(_beaconDebounceTimer);
    _beaconDebounceTimer = setTimeout(async () => {
        try {
            const beaconRef = doc(db, USER_SYNC_COLLECTION, BEACON_DOC);
            await setDoc(beaconRef, {
                dev: getDeviceId(),
                ts: serverTimestamp(),
                type,
                v: 4
            }, { merge: true });
            console.log(`📡 [Sync Beacon] Đã phát tín hiệu realtime (${type}) từ ${getDeviceId().substring(0, 8)}`);
        } catch (err) {
            console.warn("⚠️ Không thể phát sync beacon:", err);
        }
    }, 1500);
}

let _beaconUnsubscribe = null;
let _remoteBeaconSyncDebounce = null;

export function setupRealtimeSyncListener() {
    import('./tab-bus.js').then(({ onLeaderElected, broadcastRemoteSynced }) => {
        onLeaderElected(() => {
            if (_beaconUnsubscribe) return;
            if (isPreviewMode() || (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('CHEAT_MODE') === 'true')) return;

            try {
                const beaconRef = doc(db, USER_SYNC_COLLECTION, BEACON_DOC);
                _beaconUnsubscribe = onSnapshot(beaconRef, (snapshot) => {
                    if (!snapshot.exists()) return;
                    const data = snapshot.data();
                    if (!data) return;

                    // 1. Anti-echo filter: bỏ qua hoàn toàn các ghi chép xuất phát từ chính máy này
                    const myDevId = getDeviceId();
                    if (data.dev === myDevId) return;

                    console.log(`🔔 [Sync Beacon] Nhận tín hiệu đồng bộ từ thiết bị ${data.dev ? data.dev.substring(0, 8) : 'remote'}.`);

                    // 2. Kích hoạt pull đồng bộ thông minh (debounced 1.2s)
                    clearTimeout(_remoteBeaconSyncDebounce);
                    _remoteBeaconSyncDebounce = setTimeout(async () => {
                        console.log("⚡ [Realtime Beacon] Kích hoạt pull đồng bộ thông minh...");
                        await smartSync({ isManual: false });
                        broadcastRemoteSynced({ fromRemoteDevice: data.dev, timestamp: Date.now() });
                    }, 1200);
                }, (error) => {
                    console.warn("⚠️ [Sync Beacon] Lỗi snapshot beacon:", error);
                });
                console.log("📡 [Sync Beacon] Đã kích hoạt Real-time Beacon Listener trên Leader Tab.");
            } catch (e) {
                console.warn("⚠️ [Sync Beacon] Không thể kích hoạt listener:", e);
            }
        });
    });
}
