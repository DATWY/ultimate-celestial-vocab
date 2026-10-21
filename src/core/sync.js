import { doc, setDoc } from "firebase/firestore";
import { db, getCalibratedNow, getDeviceId, writeMergedCards, mergeCardFields, syncProgressToFirebase, syncUserSettings } from './firebase.js';
import { saveWordToDB, getPendingCardIds, getPendingWriteSnapshot, acknowledgePendingWrites } from './idb.js';
import { announceSyncStatus } from './sync-status.js';

const USER_SYNC_COLLECTION = 'celestial_user_sync';
const _syncQueue = new Map();
let _generation = 0;
let _syncTimer = null;
let _flushPromise = null;
let _retryDelay = 2000;
const BATCH_WINDOW_MS = 15000;
const DIRTY_THRESHOLD = 30;

export function getDirtyCount() { return _syncQueue.size; }
export function getSyncQueueSize() { return _syncQueue.size; }

function persistPendingIds() {
    announceSyncStatus({ pending: _syncQueue.size });
    try {
        localStorage.setItem('pendingSyncIds', JSON.stringify([..._syncQueue.keys()]));
    } catch (error) { announceSyncStatus({ phase: 'storage-error' }); console.warn('Không thể lưu hàng chờ đồng bộ.', error); }
}

export function syncCardToFirebase(card) {
    if (!card?.id || sessionStorage.getItem('CHEAT_MODE') === 'true') return;
    _syncQueue.set(card.id, ++_generation);
    persistPendingIds();
    if (_syncTimer) clearTimeout(_syncTimer);
    if (_syncQueue.size >= DIRTY_THRESHOLD) void flushSyncQueue();
    else _syncTimer = setTimeout(flushSyncQueue, BATCH_WINDOW_MS);
}

export async function flushSyncQueue() {
    if (_flushPromise) return _flushPromise;
    if (sessionStorage.getItem('CHEAT_MODE') === 'true') return [];
    if (typeof navigator !== 'undefined' && !navigator.onLine) return [];
    clearTimeout(_syncTimer);
    _syncTimer = null;
    const job = async () => {
        const state = await import('./state.js');
        for (const id of await getPendingCardIds()) if (!_syncQueue.has(id)) _syncQueue.set(id, ++_generation);
        const entries = [..._syncQueue.entries()];
        const flushed = [];
        try {
            for (let i = 0; i < entries.length; i += 100) {
                const chunk = entries.slice(i, i + 100);
                const records = await getPendingWriteSnapshot(chunk.map(([id]) => id));
                const cards = records.map(record => record.card).filter(Boolean);
                const committed = await writeMergedCards(cards);
                for (const card of committed) {
                    const current = state.getVocabById(card.id);
                    if (current) {
                        const merged = mergeCardFields(current, card);
                        state.updateCardInVocabulary(card.id, merged);
                        const stored = await saveWordToDB(merged, { markDirty: false });
                        if (stored) state.updateCardInVocabulary(card.id, mergeCardFields(state.getVocabById(card.id), stored));
                    }
                }
                const acknowledged = new Set(await acknowledgePendingWrites(records));
                for (const [id, generation] of chunk) {
                    // A newer edit made during the request must remain queued.
                    if (_syncQueue.get(id) === generation && acknowledged.has(id)) {
                        _syncQueue.delete(id);
                        flushed.push(id);
                    }
                }
                persistPendingIds();
            }
            _retryDelay = 2000;
            return flushed;
        } catch (error) {
            _retryDelay = Math.min(60000, _retryDelay * 2);
            console.warn('Chưa đồng bộ được; dữ liệu vẫn được giữ trên máy và trong hàng chờ.', error);
            return flushed;
        } finally {
            if (_syncQueue.size) _syncTimer = setTimeout(flushSyncQueue, _retryDelay);
        }
    };
    _flushPromise = job();
    try { return await _flushPromise; }
    finally { _flushPromise = null; }
}

export function flushSyncQueueBeforeUnload() {
    if (sessionStorage.getItem('CHEAT_MODE') === 'true') return;
    persistPendingIds();
    void syncGamificationToFirebase();
    void flushSyncQueue();
}

export async function recoverPendingSyncIds() {
    if (sessionStorage.getItem('CHEAT_MODE') === 'true') return;
    try {
        const persisted = JSON.parse(localStorage.getItem('pendingSyncIds') || '[]');
        const legacy = JSON.parse(sessionStorage.getItem('pendingSyncIds') || '[]');
        for (const id of new Set([...persisted, ...legacy, ...await getPendingCardIds()])) {
            if (typeof id === 'string') _syncQueue.set(id, ++_generation);
        }
        sessionStorage.removeItem('pendingSyncIds');
        persistPendingIds();
        if (_syncQueue.size) _syncTimer = setTimeout(flushSyncQueue, 5000);
    } catch (error) { console.warn('Không thể khôi phục hàng chờ đồng bộ.', error); }
}

// ===== SYNC FUNCTIONS CHO SETTINGS / GAMIFICATION =====

export async function syncUserSettingsToFirebase() {
    try { await syncUserSettings(); }
    catch (error) { console.warn('Thông số đã lưu trên máy và sẽ được đồng bộ lại khi có mạng.', error); }
}

let _gamificationSyncTimer = null;
const GAMIFICATION_SYNC_DEBOUNCE_MS = 60000; // 60 giây (1 phút debounce, tránh gửi request liên tục khi đang học)

export function queueGamificationSync() {
    if (sessionStorage.getItem('CHEAT_MODE') === 'true') return;
    if (_gamificationSyncTimer) return;
    _gamificationSyncTimer = setTimeout(syncGamificationToFirebase, GAMIFICATION_SYNC_DEBOUNCE_MS); 
}

export async function syncGamificationToFirebase() {
    if (sessionStorage.getItem('CHEAT_MODE') === 'true') return;
    clearTimeout(_gamificationSyncTimer);
    _gamificationSyncTimer = null;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    try { await syncProgressToFirebase(); }
    catch (error) { console.warn('Chưa đồng bộ được thống kê; bản lưu trên máy được giữ nguyên.', error); queueGamificationSync(); }
}
