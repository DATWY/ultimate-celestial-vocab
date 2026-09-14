import { doc, setDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { db, getCalibratedNow, getDeviceId } from './firebase.js';

const VOCAB_COLLECTION = "celestial_vocab_sync";
const USER_SYNC_COLLECTION = "celestial_user_sync";

// --- Sync Queue: Thu thập card IDs đã thay đổi, flush theo batch ---
let _syncQueue = new Set();
let _syncTimer = null;
const BATCH_WINDOW_MS = 90000; // 90 giây (1.5 phút)

// --- Dirty tracking: Đếm số lần thay đổi chưa sync ---
let _dirtyCount = 0;
const DIRTY_THRESHOLD = 30; // Flush nếu có >= 30 thay đổi thẻ

export function getDirtyCount() { return _dirtyCount; }
export function getSyncQueueSize() { return _syncQueue.size; }

/**
 * Queue 1 card để sync lên Firebase.
 * Tự động flush sau 30s hoặc khi đạt dirty threshold.
 */
export async function syncCardToFirebase(card) {
    if (sessionStorage.getItem('CHEAT_MODE') === 'true') return;
    
    _syncQueue.add(card.id);
    _dirtyCount++;
    
    // Reset timer
    if (_syncTimer) clearTimeout(_syncTimer);
    
    // Flush ngay nếu quá nhiều thay đổi (user đang review nhanh)
    if (_dirtyCount >= DIRTY_THRESHOLD) {
        flushSyncQueue();
        return;
    }
    
    _syncTimer = setTimeout(flushSyncQueue, BATCH_WINDOW_MS);
}

let _isFlushing = false;

/**
 * Flush tất cả card trong queue lên Firebase.
 * Trả về danh sách IDs đã flush thành công (để smartSync biết tránh push lại).
 */
export async function flushSyncQueue() {
    if (_syncQueue.size === 0) return [];
    if (sessionStorage.getItem('CHEAT_MODE') === 'true') return [];

    if (_isFlushing) {
        if (!_syncTimer) {
            _syncTimer = setTimeout(flushSyncQueue, 1000);
        }
        return [];
    }
    _isFlushing = true;

    if (_syncTimer) {
        clearTimeout(_syncTimer);
        _syncTimer = null;
    }

    // BUG-02 FIX: Snapshot queue nhưng KHÔNG clear ngay.
    // Chỉ xóa từng batch sau khi commit thành công.
    const idsToSync = Array.from(_syncQueue);

    try {
        const m = await import('./state.js');
        
        const BATCH_LIMIT = 500;
        const flushedIds = [];

        for (let i = 0; i < idsToSync.length; i += BATCH_LIMIT) {
            const chunk = idsToSync.slice(i, i + BATCH_LIMIT);
            const batch = writeBatch(db);
            
            for (const id of chunk) {
                // BUG-09 FIX: O(1) lookup thay vì vocabulary.find()
                const card = m.getVocabById(id);
                if (card) {
                    const cleanData = JSON.parse(JSON.stringify(card));
                    cleanData.updatedAt = card.updatedAt || getCalibratedNow();
                    cleanData._lastModifiedBy = getDeviceId();
                    const cardRef = doc(db, VOCAB_COLLECTION, id);
                    batch.set(cardRef, cleanData, { merge: true });
                    flushedIds.push(id);
                }
            }
            await batch.commit();

            // CHAOS-01 FIX: Xóa IDs đã commit thành công khỏi queue ngay sau mỗi batch
            for (const id of chunk) {
                _syncQueue.delete(id);
            }
        }
        
        // BUG-02 FIX: Reset dirty count chỉ sau khi commit thành công hoàn toàn
        _dirtyCount = Math.max(0, _dirtyCount - flushedIds.length);
        
        console.log(`☁️ Batch flush: ${flushedIds.length} thẻ → Firebase.`);
        return flushedIds;
    } catch(e) {
        console.warn("Lỗi flush batch. Các thẻ chưa commit vẫn nằm trong queue.", e);
        // BUG-02/CHAOS-01 FIX: Không cần re-add vì chỉ xóa sau mỗi batch thành công
        return [];
    } finally {
        _isFlushing = false;
        if (_syncQueue.size > 0) {
            setTimeout(flushSyncQueue, 500);
        }
    }
}

/**
 * Flush an toàn trước khi đóng tab.
 * Lưu pending IDs vào sessionStorage để recover khi mở lại.
 */
export function flushSyncQueueBeforeUnload() {
    if (sessionStorage.getItem('CHEAT_MODE') === 'true') return;

    // Flush ngay Gamification, DailyStats và Logs khi chuẩn bị đóng tab
    syncGamificationToFirebase();

    if (_syncQueue.size === 0) return;

    try {
        const pendingIds = Array.from(_syncQueue);
        sessionStorage.setItem('pendingSyncIds', JSON.stringify(pendingIds));
        console.log(`💾 Đã lưu ${pendingIds.length} thẻ chưa sync vào sessionStorage.`);
    } catch(e) {
        console.warn("Không thể lưu pending sync IDs:", e);
    }

    // Cố gắng flush thẻ (có thể thành công nếu browser cho phép)
    flushSyncQueue();
}

/**
 * Recover pending sync IDs từ phiên trước (crash/đóng tab đột ngột).
 */
export async function recoverPendingSyncIds() {
    try {
        const pendingJson = sessionStorage.getItem('pendingSyncIds');
        if (pendingJson) {
            const pendingIds = JSON.parse(pendingJson);
            if (Array.isArray(pendingIds) && pendingIds.length > 0) {
                pendingIds.forEach(id => _syncQueue.add(id));
                sessionStorage.removeItem('pendingSyncIds');
                console.log(`🔄 Recovered ${pendingIds.length} pending sync IDs.`);
                // Flush sau 5s (chờ app init xong)
                if (_syncTimer) clearTimeout(_syncTimer);
                _syncTimer = setTimeout(flushSyncQueue, 5000);
            }
        }
    } catch(e) {
        console.warn("Lỗi recover pending sync:", e);
    }
}

// ===== SYNC FUNCTIONS CHO SETTINGS / GAMIFICATION =====

export async function syncUserSettingsToFirebase() {
    import('./state.js').then(async (m) => {
        const { userRecallParams, userLapseParams, userFsrs7Params, userFsrs7TrainedAt } = m.getState();
        try {
            const docRef = doc(db, USER_SYNC_COLLECTION, 'settings');
            const now = userFsrs7TrainedAt || getCalibratedNow();
            await setDoc(docRef, {
                userRecallParams: userRecallParams || null,
                userLapseParams: userLapseParams || null,
                userFsrs7Params: userFsrs7Params || null,
                userFsrs7TrainedAt: now,
                trainedAt: now,
                version: '7.0',
                source: 'personal',
                _lastModifiedBy: getDeviceId()
            }, { merge: true });
            const { saveSettingToDB } = await import('./idb.js');
            await saveSettingToDB('userFsrs7TrainedAt', now);
            await saveSettingToDB('userParamsTrainedAt', now);
            console.log("☁️ Đã đồng bộ thông số cá nhân hoá FSRS-7 lên Firebase.");
        } catch (e) {
            console.error("Lỗi đồng bộ thông số:", e);
        }
    });
}

let _gamificationSyncTimer = null;
const GAMIFICATION_SYNC_DEBOUNCE_MS = 60000; // 60 giây (1 phút debounce, tránh gửi request liên tục khi đang học)

export function queueGamificationSync() {
    if (sessionStorage.getItem('CHEAT_MODE') === 'true') return;
    if (_gamificationSyncTimer) clearTimeout(_gamificationSyncTimer);
    _gamificationSyncTimer = setTimeout(syncGamificationToFirebase, GAMIFICATION_SYNC_DEBOUNCE_MS); 
}

export async function syncGamificationToFirebase() {
    if (sessionStorage.getItem('CHEAT_MODE') === 'true') return;
    if (_gamificationSyncTimer) {
        clearTimeout(_gamificationSyncTimer);
        _gamificationSyncTimer = null;
    }
    import('./state.js').then(async (m) => {
        const gamification = m.getState().gamification;
        const reviewLogs = m.getState().reviewLogs;
        const dailyStats = m.getState().dailyStats;
        
        try {
            if (gamification) {
                const gamificationRef = doc(db, USER_SYNC_COLLECTION, 'gamification');
                const cleanGamification = { ...gamification, _lastModifiedBy: getDeviceId() };
                await setDoc(gamificationRef, cleanGamification, { merge: true });
                console.log("☁️ Đã đồng bộ Gamification lên Firebase.");
            }

            if (dailyStats) {
                const statsRef = doc(db, USER_SYNC_COLLECTION, 'dailyStats');
                const cleanDailyStats = { ...dailyStats, _lastModifiedBy: getDeviceId() };
                await setDoc(statsRef, cleanDailyStats, { merge: true });
                console.log("☁️ Đã đồng bộ Daily Stats lên Firebase.");
            }
            
            if (reviewLogs && reviewLogs.logs) {
                const logsRef = doc(db, USER_SYNC_COLLECTION, 'reviewLogs');
                const firestoreLogs = {
                    dict: reviewLogs.dict,
                    logs: (reviewLogs.logs || []).map(log => typeof log === 'string' ? log : Array.isArray(log) ? log.join(',') : String(log)),
                    _lastModifiedBy: getDeviceId()
                };
                await setDoc(logsRef, firestoreLogs);
                console.log(`☁️ Đã đồng bộ ${reviewLogs.logs.length} bản ghi học tập lên Firebase.`);
            }
        } catch (e) {
            console.error("Lỗi đồng bộ Gamification hoặc Logs:", e);
        }
    });
}