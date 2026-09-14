// src/core/firebase.js — Smart Sync v2

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager, collection, getDocs, writeBatch, doc, query, where, getDoc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";
import { getState, setVocabulary, saveVocabulary, setGamification, saveGamification, setDailyStats, saveDailyStats, setAllTags, isPreviewMode } from './state.js';
import { buildReviewQueue, getNextCardToReview } from './queue.js';
import { updateStats, updatePanelWordList, displayCard, populateTopicFilters } from '../ui/render.js';
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
let _cachedDeviceId = null;
export function getDeviceId() {
    if (_cachedDeviceId) return _cachedDeviceId;
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            let id = localStorage.getItem('celestial_device_id');
            if (!id) {
                id = 'dev_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString(36);
                localStorage.setItem('celestial_device_id', id);
            }
            _cachedDeviceId = id;
            return _cachedDeviceId;
        }
    } catch (e) {
        // Fallback if localStorage is restricted
    }
    _cachedDeviceId = 'temp_dev_' + Math.random().toString(36).substring(2, 8);
    return _cachedDeviceId;
}

// ===== HELPERS =====

/**
 * Chuyển đổi updatedAt từ nhiều format (Firestore Timestamp, number, Date) về milliseconds.
 * Tự động cân chỉnh _serverTimeOffset nếu có dữ liệu từ Cloud.
 */
export function toMillis(val) {
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
 * True Field-Level SRS-Aware Merge: Hợp nhất 2 phiên bản của cùng 1 thẻ từ vựng
 * từ 2 thiết bị khác nhau một cách toàn diện và chính xác tuyệt đối.
 * 
 * Chia thành 4 Vectors độc lập:
 * 1. Tombstone Vector (Trạng thái xóa):
 *    - isDeleted = true thắng nếu thời điểm xóa >= thời điểm cập nhật còn lại.
 *    - Nếu một bên xóa nhưng bên kia có sửa đổi mới hơn sau thời điểm xóa -> phục hồi thẻ (resurrect).
 * 
 * 2. SRS Memory Vector (Bộ trạng thái trí nhớ Spaced Repetition):
 *    - srsStatus, srsDueDate, srsInterval, stability, stabilityShort, difficulty,
 *      reps, lapses, lastReviewDate, consecutiveCorrect
 *    - Nguyên tắc: Lấy TOÀN BỘ vector SRS từ phiên bản có lượt review gần nhất (lastReviewDate mới hơn,
 *      hoặc số reps cao hơn nếu hòa). Giữ nguyên tính toàn vẹn toán học của thuật toán FSRS-7.
 * 
 * 3. Content Vector (Dữ liệu từ vựng con người biên soạn):
 *    - english, vietnamese, phonetic, type, example, exampleMeaning, notes,
 *      synonyms, antonyms, collocations, audio
 *    - Lấy từ phiên bản có nội dung đầy đủ hơn hoặc có updatedAt mới hơn.
 * 
 * 4. Tags & Flags Vector:
 *    - tags: Hợp nhất Set Union (không bao giờ làm mất tag thêm từ thiết bị khác).
 *    - isStarred, isSuspended: Lấy từ phiên bản cập nhật gần nhất.
 */
export function mergeCardFields(local, remote) {
    if (!local) return remote;
    if (!remote) return local;

    const localTime = toMillis(local.updatedAt) || 0;
    const remoteTime = toMillis(remote.updatedAt) || 0;
    const maxUpdatedTime = Math.max(localTime, remoteTime, getCalibratedNow());

    // --- VECTOR 1: TOMBSTONE (DELETION) ---
    const localDeleted = !!local.isDeleted;
    const remoteDeleted = !!remote.isDeleted;

    if (localDeleted !== remoteDeleted) {
        if (remoteDeleted) {
            // Remote xóa: nếu local không có sửa đổi nào mới hơn remoteTime, remote xóa thắng
            if (remoteTime >= localTime) {
                return { ...remote, isDeleted: true, updatedAt: maxUpdatedTime };
            }
        } else {
            // Local xóa: nếu remote không có sửa đổi nào mới hơn localTime, local xóa thắng
            if (localTime >= remoteTime) {
                return { ...local, isDeleted: true, updatedAt: maxUpdatedTime };
            }
        }
    } else if (localDeleted && remoteDeleted) {
        return { ...local, ...remote, isDeleted: true, updatedAt: maxUpdatedTime };
    }

    // --- VECTOR 2: SRS MEMORY STATE ---
    const localReviewTime = toMillis(local.lastReviewDate) || 0;
    const remoteReviewTime = toMillis(remote.lastReviewDate) || 0;
    const localReps = Number(local.reps) || 0;
    const remoteReps = Number(remote.reps) || 0;

    let srsWinner = local;
    if (remoteReviewTime > localReviewTime) {
        srsWinner = remote;
    } else if (localReviewTime > remoteReviewTime) {
        srsWinner = local;
    } else {
        // Cùng thời gian review (hoặc cả 2 đều chưa review):
        if (remoteReps > localReps) {
            srsWinner = remote;
        } else if (localReps > remoteReps) {
            srsWinner = local;
        } else {
            // Nếu cả 2 đều chưa review, ưu tiên thẻ có trạng thái đã học
            const localIsNew = !local.srsStatus || local.srsStatus === 'New';
            const remoteIsNew = !remote.srsStatus || remote.srsStatus === 'New';
            if (localIsNew && !remoteIsNew) srsWinner = remote;
            else if (!localIsNew && remoteIsNew) srsWinner = local;
            else srsWinner = remoteTime > localTime ? remote : local;
        }
    }

    // --- VECTOR 3: CONTENT EDITORIAL DATA ---
    const contentWinner = remoteTime > localTime ? remote : local;
    const contentFallback = contentWinner === remote ? local : remote;

    const pickNonEmpty = (key) => {
        const val1 = contentWinner[key];
        const val2 = contentFallback[key];
        if (val1 !== undefined && val1 !== null && val1 !== '') return val1;
        return val2 !== undefined && val2 !== null ? val2 : val1;
    };

    // --- VECTOR 4: TAGS UNION ---
    const localTags = Array.isArray(local.tags) ? local.tags : [];
    const remoteTags = Array.isArray(remote.tags) ? remote.tags : [];
    const mergedTags = Array.from(new Set([...localTags, ...remoteTags]))
        .map(t => typeof t === 'string' ? t.trim() : String(t))
        .filter(t => t.length > 0 && t.toLowerCase() !== 'all');

    // --- VECTOR 5: FLAGS ---
    const flagsWinner = remoteTime > localTime ? remote : local;

    return {
        id: local.id || remote.id,
        english: pickNonEmpty('english') || local.english || remote.english,
        vietnamese: pickNonEmpty('vietnamese') || local.vietnamese || remote.vietnamese,
        phonetic: pickNonEmpty('phonetic') || '',
        type: pickNonEmpty('type') || local.type || remote.type || '',
        example: pickNonEmpty('example') || '',
        exampleMeaning: pickNonEmpty('exampleMeaning') || pickNonEmpty('exampleVi') || '',
        exampleVi: pickNonEmpty('exampleVi') || pickNonEmpty('exampleMeaning') || '',
        notes: pickNonEmpty('notes') || '',
        synonyms: pickNonEmpty('synonyms') || [],
        antonyms: pickNonEmpty('antonyms') || [],
        collocations: pickNonEmpty('collocations') || [],
        audio: pickNonEmpty('audio') || '',
        
        // Tags union
        tags: mergedTags,

        // Flags
        isStarred: typeof flagsWinner.isStarred === 'boolean' ? flagsWinner.isStarred : (local.isStarred || remote.isStarred || false),
        isSuspended: typeof flagsWinner.isSuspended === 'boolean' ? flagsWinner.isSuspended : (local.isSuspended || remote.isSuspended || false),
        isDeleted: false,

        // SRS Atomic State Vector (Bảo toàn 100% logic FSRS-7)
        srsStatus: srsWinner.srsStatus || 'New',
        srsDueDate: srsWinner.srsDueDate ? toMillis(srsWinner.srsDueDate) : null,
        srsInterval: srsWinner.srsInterval !== undefined ? srsWinner.srsInterval : 0,
        stability: srsWinner.stability !== undefined ? srsWinner.stability : 0,
        stabilityShort: srsWinner.stabilityShort !== undefined ? srsWinner.stabilityShort : (srsWinner.stability || 0),
        difficulty: srsWinner.difficulty !== undefined ? srsWinner.difficulty : 0,
        reps: Number(srsWinner.reps) || 0,
        lapses: Number(srsWinner.lapses) || 0,
        lastReviewDate: srsWinner.lastReviewDate ? toMillis(srsWinner.lastReviewDate) : null,
        consecutiveCorrect: srsWinner.consecutiveCorrect !== undefined ? srsWinner.consecutiveCorrect : 0,

        // Convergence Timestamp & Origin
        updatedAt: maxUpdatedTime,
        _lastModifiedBy: getDeviceId()
    };
}

// ===== SMART SYNC v3 =====

/**
 * So sánh toàn diện 2 card objects.
 * Kiểm tra cả SRS metrics, nội dung, cờ, và danh sách tags.
 * Trả về true nếu 2 object hoàn toàn tương đương về dữ liệu người dùng.
 */
export function isSrsEqual(a, b) {
    if (!a || !b) return a === b;
    if (a === b) return true;

    // So sánh các trường SRS và trạng thái
    if (
        a.stability !== b.stability ||
        a.stabilityShort !== b.stabilityShort ||
        a.difficulty !== b.difficulty ||
        a.srsInterval !== b.srsInterval ||
        a.srsDueDate !== b.srsDueDate ||
        a.srsStatus !== b.srsStatus ||
        a.reps !== b.reps ||
        a.lapses !== b.lapses ||
        a.lastReviewDate !== b.lastReviewDate ||
        a.consecutiveCorrect !== b.consecutiveCorrect ||
        a.isDeleted !== b.isDeleted ||
        a.isStarred !== b.isStarred ||
        a.isSuspended !== b.isSuspended ||
        a.english !== b.english ||
        a.vietnamese !== b.vietnamese ||
        a.phonetic !== b.phonetic ||
        a.type !== b.type ||
        a.example !== b.example ||
        (a.exampleMeaning || a.exampleVi || '') !== (b.exampleMeaning || b.exampleVi || '') ||
        (a.notes || '') !== (b.notes || '')
    ) {
        return false;
    }

    // So sánh mảng tags
    const aTags = Array.isArray(a.tags) ? a.tags : [];
    const bTags = Array.isArray(b.tags) ? b.tags : [];
    if (aTags.length !== bTags.length) return false;
    for (let i = 0; i < aTags.length; i++) {
        if (aTags[i] !== bTags[i]) return false;
    }

    return true;
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
        let lastPullTime = forceFullPull ? 0 : (await getSettingFromDB('lastPullTime') || 0);
        
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
        // PHASE 1: PULL — Tải dữ liệu mới từ Cloud về (với safety buffer 3 phút)
        // ============================================================
        const PULL_SAFETY_BUFFER_MS = 180000; // 3 phút overlap phòng lệch đồng hồ giữa các máy
        let q;
        if (lastPullTime > 0) {
            const bufferedPullTime = Math.max(0, lastPullTime - PULL_SAFETY_BUFFER_MS);
            q = query(collection(db, VOCAB_COLLECTION), where("updatedAt", ">", bufferedPullTime));
        } else {
            q = collection(db, VOCAB_COLLECTION);
        }
        
        const querySnapshot = await getDocs(q);
        
        let maxPullTime = lastPullTime;
        let needsLocalUpdate = false;
        const pulledIds = new Set();
        const convergedCardsToPush = [];
        const myDeviceId = getDeviceId();
        
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

        // 2. Thêm các thẻ local mới sửa/tạo mà chưa sync
        for (const card of vocabulary) {
            if (!card || !card.id) continue;
            const cardTime = toMillis(card.updatedAt);
            
            if (cardTime > lastPullTime && !flushedIds.has(card.id) && !pulledIds.has(card.id)) {
                if (!cardsToPushMap.has(card.id)) {
                    cardsToPushMap.set(card.id, card);
                }
            }
        }
        
        const cardsToPush = Array.from(cardsToPushMap.values());

        if (cardsToPush.length > 0) {
            console.log(`☁️ Push ${cardsToPush.length} thẻ (${convergedCardsToPush.length} thẻ hội tụ) lên Cloud...`);
            
            const BATCH_LIMIT = 500;
            for (let i = 0; i < cardsToPush.length; i += BATCH_LIMIT) {
                const batch = writeBatch(db);
                const chunk = cardsToPush.slice(i, i + BATCH_LIMIT);
                
                for (const card of chunk) {
                    const cleanData = JSON.parse(JSON.stringify(card));
                    cleanData._lastModifiedBy = myDeviceId;
                    const cardRef = doc(db, VOCAB_COLLECTION, card.id);
                    batch.set(cardRef, cleanData, { merge: true });
                }
                
                await batch.commit();
            }
            _lastLocalWriteTimestamp = Date.now();
            console.log(`☁️ Đã push thành công ${cardsToPush.length} thẻ.`);
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
            const state = stateModule.getState();
            const isStudyingCard = (state.currentCardIndex >= 0);

            updateStats();
            populateTopicFilters();
            updatePanelWordList();

            // Chỉ reset lại thẻ hiển thị nếu người dùng chưa mở thẻ nào (tránh đổi thẻ người dùng đang suy nghĩ)
            if (!isStudyingCard) {
                buildReviewQueue();
                displayCard(getNextCardToReview());
            } else {
                console.log("📖 Đang trong phiên học bài, giữ nguyên thẻ hiện tại để không gây gián đoạn.");
            }
            console.log("📱 Đã cập nhật dữ liệu từ Cloud về máy.");
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
        if (isManual) {
            showToast("Đồng bộ thành công", "Dữ liệu đã được đồng bộ an toàn với Cloud.", "ph-cloud-check");
        }
    } catch (error) {
        console.error("Lỗi đồng bộ Firebase:", error);
        if (isManual) {
            showToast("Lỗi đồng bộ", error.message || "Vui lòng kiểm tra kết nối mạng.", "ph-warning-circle");
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
    await saveSettingToDB('gamification', mergedGamification);
    const cleanGamification = JSON.parse(JSON.stringify(mergedGamification));
    const compareA = { ...cleanGamification };
    delete compareA._lastModifiedBy;
    const compareB = remoteGamification ? { ...remoteGamification } : null;
    if (compareB) delete compareB._lastModifiedBy;

    if (!compareB || JSON.stringify(compareA) !== JSON.stringify(compareB)) {
        cleanGamification._lastModifiedBy = getDeviceId();
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
    await saveSettingToDB('dailyStats', mergedStats);
    const cleanStats = JSON.parse(JSON.stringify(mergedStats));
    const compareA = { ...cleanStats };
    delete compareA._lastModifiedBy;
    const compareB = remoteStats ? { ...remoteStats } : null;
    if (compareB) delete compareB._lastModifiedBy;

    if (!compareB || JSON.stringify(compareA) !== JSON.stringify(compareB)) {
        cleanStats._lastModifiedBy = getDeviceId();
        await setDoc(statsRef, cleanStats);
        _lastLocalWriteTimestamp = Date.now();
    }
}

async function syncUserSettings() {
    const { isPreviewMode } = await import('./state.js');
    if (isPreviewMode()) return;

    const m = await import('./state.js');
    const { userRecallParams, userLapseParams, userFsrs7Params, userFsrs7TrainedAt } = m.getState();
    const settingsRef = doc(db, USER_SYNC_COLLECTION, "settings");
    
    // Đọc timestamp local (ưu tiên userFsrs7TrainedAt, fallback userParamsTrainedAt)
    const localFsrs7Time = (await getSettingFromDB('userFsrs7TrainedAt')) || userFsrs7TrainedAt || 0;
    const localLegacyTime = (await getSettingFromDB('userParamsTrainedAt')) || 0;
    const localTrainedAt = Math.max(localFsrs7Time, localLegacyTime);

    try {
        const remoteSettingsSnap = await getDoc(settingsRef);
        if (remoteSettingsSnap.exists()) {
            const remoteSettings = remoteSettingsSnap.data();
            const remoteTrainedAt = Math.max(remoteSettings.trainedAt || 0, remoteSettings.userFsrs7TrainedAt || 0);

            if (remoteTrainedAt > localTrainedAt) {
                // Remote mới hơn -> Kéo từ Cloud về máy
                if (remoteSettings.userRecallParams || remoteSettings.userLapseParams) {
                    m.setUserSrsParams(remoteSettings.userRecallParams || null, remoteSettings.userLapseParams || null);
                }
                if (remoteSettings.userFsrs7Params && Array.isArray(remoteSettings.userFsrs7Params) && remoteSettings.userFsrs7Params.length === 34) {
                    await m.setUserFsrs7Params(remoteSettings.userFsrs7Params, remoteTrainedAt);
                    
                    // Cập nhật ngay UI nếu modal đang mở
                    if (DOM.fsrs7CurrentStatus) {
                        DOM.fsrs7CurrentStatus.textContent = "Đang dùng: Bộ Cá Nhân Hóa (34 params)";
                        DOM.fsrs7CurrentStatus.style.color = "#a855f7";
                    }
                    if (DOM.fsrs7TrainedTime) {
                        DOM.fsrs7TrainedTime.textContent = `Cập nhật: ${new Date(remoteTrainedAt).toLocaleString('vi-VN')}`;
                    }
                    if (DOM.fsrs7ParamsInput) {
                        DOM.fsrs7ParamsInput.value = JSON.stringify(remoteSettings.userFsrs7Params, null, 2);
                    }
                }
                await saveSettingToDB('userFsrs7TrainedAt', remoteTrainedAt);
                await saveSettingToDB('userParamsTrainedAt', remoteTrainedAt);
                console.log("☁️ Đã tải bộ thông số cá nhân hoá FSRS-7 từ Firebase về máy.");
            } else if (localTrainedAt > remoteTrainedAt && userFsrs7Params && Array.isArray(userFsrs7Params) && userFsrs7Params.length === 34) {
                // Local mới hơn -> Đẩy từ máy lên Cloud
                await setDoc(settingsRef, {
                    userRecallParams: userRecallParams || null,
                    userLapseParams: userLapseParams || null,
                    userFsrs7Params: userFsrs7Params,
                    userFsrs7TrainedAt: localTrainedAt,
                    trainedAt: localTrainedAt,
                    version: '7.0',
                    source: 'personal',
                    _lastModifiedBy: getDeviceId()
                }, { merge: true });
                console.log("☁️ Đã đồng bộ bộ thông số cá nhân hoá FSRS-7 từ máy lên Firebase.");
            }
        } else if (userFsrs7Params && Array.isArray(userFsrs7Params) && userFsrs7Params.length === 34) {
            // Chưa có tài liệu settings trên Cloud -> Khởi tạo
            const now = localTrainedAt || Date.now();
            await setDoc(settingsRef, {
                userRecallParams: userRecallParams || null,
                userLapseParams: userLapseParams || null,
                userFsrs7Params: userFsrs7Params,
                userFsrs7TrainedAt: now,
                trainedAt: now,
                version: '7.0',
                source: 'personal',
                _lastModifiedBy: getDeviceId()
            }, { merge: true });
            console.log("☁️ Khởi tạo bộ thông số FSRS-7 cá nhân hoá lên Firebase.");
        }
    } catch (err) {
        console.warn("Lỗi kiểm tra/đồng bộ userSettings:", err);
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
        const compareA = JSON.stringify(firestoreLogs);
        const compareB = remoteLogsRaw ? JSON.stringify({ dict: remoteLogsRaw.dict || [], logs: remoteLogsRaw.logs || [] }) : null;
        if (compareA !== compareB) {
            firestoreLogs._lastModifiedBy = getDeviceId();
            await setDoc(reviewLogsRef, firestoreLogs);
            _lastLocalWriteTimestamp = Date.now();
            console.log(`☁️ Đã hợp nhất ${mergedLogs.logs.length} bản ghi học tập.`);
        }
    } else if (localLogs && localLogs.logs && localLogs.logs.length > 0) {
        const firestoreLogs = {
            dict: localLogs.dict,
            logs: (localLogs.logs || []).map(log => typeof log === 'string' ? log : Array.isArray(log) ? log.join(',') : String(log)),
            _lastModifiedBy: getDeviceId()
        };
        await setDoc(reviewLogsRef, firestoreLogs);
        _lastLocalWriteTimestamp = Date.now();
        console.log(`☁️ Đã đẩy ${localLogs.logs.length} bản ghi lên Cloud lần đầu.`);
    }
}

// ===== SYNC UI STATE =====

function setSyncUIState(state) {
    if (!DOM.manualSyncBtn) return;
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

// ===== REAL-TIME MULTI-DEVICE LISTENERS =====

let _realtimeUnsubscribers = [];

export function setupRealtimeSyncListener() {
    // Đã tắt Real-time onSnapshot listener theo yêu cầu người dùng (không bắt buộc realtime).
    // Giúp loại bỏ hoàn toàn tình trạng loop sync liên tục và spam khi đang học thẻ.
    if (_realtimeUnsubscribers.length > 0) {
        _realtimeUnsubscribers.forEach(unsub => {
            try { if (typeof unsub === 'function') unsub(); } catch (e) {}
        });
        _realtimeUnsubscribers = [];
    }
    console.log("ℹ️ Real-time Firestore onSnapshot listener đã tắt theo cấu hình (không bắt buộc realtime).");
}