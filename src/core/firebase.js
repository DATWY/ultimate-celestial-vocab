// src/core/firebase.js — Smart Sync v4 (per-user cloud vault + quota breaker)
//
// Thay đổi kiến trúc so với v3:
// 1. Mỗi người dùng có KHÔNG GIAN RIÊNG: users/{uid}/vocabulary/{cardId} và
//    users/{uid}/state/{gamification|dailyStats|settings|reviewLogs}. Rules chỉ
//    cho chủ sở hữu đọc/ghi, nên không còn chuyện mọi tài khoản ẩn danh đọc được
//    dữ liệu của nhau như collection dùng chung trước đây.
// 2. Danh tính Cloud = "Mã đồng bộ" (sync key) sinh ngẫu nhiên trên máy, quy đổi
//    thành tài khoản email/password nội bộ. Nhập cùng mã trên thiết bị khác là
//    đồng bộ được, nhưng người không biết mã thì không thể đọc dữ liệu.
// 3. Pull theo trang (200 doc/trang) thay vì kéo cả collection; auto sync chỉ
//    pull tối đa 2 trang, full pull chỉ khi người dùng bấm "Đồng bộ toàn bộ".
// 4. Circuit breaker 429 lưu xuống localStorage; UI sync luôn được reset trong
//    finally nên nút đồng bộ không còn kẹt `syncing-active` vô hạn.

import { saveReviewLogsToDB, saveProgressToDB, getSettingFromDB, saveSettingToDB } from './idb.js';
import { mergeLearningSettings } from './settings-merge.js';
import { announceSyncStatus } from './sync-status.js';
import { mergeProgress } from './progress-merge.js';
import { prepareProgress, acceptProgress } from './state.js';

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import {
    initializeFirestore, getFirestore, collection, getDocs, doc, query, where,
    serverTimestamp, runTransaction, Timestamp, orderBy, limit, startAfter,
    memoryLocalCache
} from 'firebase/firestore';
import { mergeCardFields, isSrsEqual, normalizeCard, toMillis } from './card-merge.js';
export { mergeCardFields, isSrsEqual, toMillis } from './card-merge.js';
import { getStorage } from 'firebase/storage';
import {
    getState, setVocabulary, saveVocabulary, setAllTags, isPreviewMode,
    calculateStreakFromHeatmap, reconcileStreakFreeze, setInitialSyncDone,
    syncStreakFromHeatmap, getLocalDateString
} from './state.js';
import { buildReviewQueue, getNextCardToReview } from './queue.js';

// Dynamic UI loader to avoid circular dependencies core <-> UI and server/test crashes
async function getUI() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null;
    try {
        const [render, modal, gamification] = await Promise.all([
            import('../ui/render.js'),
            import('../ui/modal.js'),
            import('../features/gamification.js')
        ]);
        return { ...render, ...modal, ...gamification };
    } catch (_) {
        return null;
    }
}

const firebaseConfig = {
    apiKey: import.meta.env?.VITE_FIREBASE_API_KEY || 'AIzaSyBYuymhxNmf22V2C93HAmCuNK6_wFspT3U',
    authDomain: import.meta.env?.VITE_FIREBASE_AUTH_DOMAIN || 'chat-wywy.firebaseapp.com',
    databaseURL: import.meta.env?.VITE_FIREBASE_DATABASE_URL || 'https://chat-wywy-default-rtdb.firebaseio.com',
    projectId: import.meta.env?.VITE_FIREBASE_PROJECT_ID || 'chat-wywy',
    storageBucket: import.meta.env?.VITE_FIREBASE_STORAGE_BUCKET || 'chat-wywy.appspot.com',
    messagingSenderId: import.meta.env?.VITE_FIREBASE_MESSAGING_SENDER_ID || '452796127167',
    appId: import.meta.env?.VITE_FIREBASE_APP_ID || '1:452796127167:web:600c0332fa5d03a914f30a',
    measurementId: import.meta.env?.VITE_FIREBASE_MEASUREMENT_ID || 'G-FK4FBJ4EY6'
};

const app = initializeApp(firebaseConfig);
let _auth = null;
try {
    _auth = getAuth(app);
} catch (_) {
    _auth = null;
}
export const auth = _auth;

let _db;
try {
    // Bộ nhớ đệm trong RAM thay vì IndexedDB: app đã có IndexedDB riêng cho từ vựng,
    // tránh hai lớp cache ghi đĩa chồng nhau và tránh khoá đa tab.
    _db = initializeFirestore(app, {
        localCache: memoryLocalCache()
    });
} catch (_) {
    _db = getFirestore(app);
}
export const db = _db;
export const storage = getStorage(app);

// ===== CLOUD IDENTITY (SYNC KEY) =====
const SYNC_KEY_STORAGE = 'celestialSyncKey';
const SYNC_KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SYNC_KEY_LENGTH = 20;
const SYNC_KEY_PATTERN = /^[A-Z0-9]{16,40}$/;

export function normalizeSyncKey(raw) {
    if (typeof raw !== 'string') return '';
    const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return SYNC_KEY_PATTERN.test(compact) ? compact : '';
}

function generateSyncKey() {
    const bytes = new Uint8Array(SYNC_KEY_LENGTH);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    let key = '';
    for (const byte of bytes) key += SYNC_KEY_ALPHABET[byte % SYNC_KEY_ALPHABET.length];
    return key;
}

/** Trả về mã đồng bộ đang dùng; tự sinh mã mới ở lần chạy đầu tiên. */
export function getSyncKey() {
    if (typeof localStorage === 'undefined') return '';
    let key = '';
    try { key = normalizeSyncKey(localStorage.getItem(SYNC_KEY_STORAGE) || ''); } catch (_) { return ''; }
    if (!key) {
        key = generateSyncKey();
        try { localStorage.setItem(SYNC_KEY_STORAGE, key); } catch (_) {}
    }
    return key;
}

/** Mã đồng bộ dạng dễ đọc/copy: XXXX-XXXX-XXXX-XXXX-XXXX */
export function formatSyncKey(key = getSyncKey()) {
    return (key || '').replace(/(.{4})/g, '$1-').replace(/-$/, '');
}

function syncKeyToEmail(key) {
    return `${key.toLowerCase()}@sync.celestial-vocab.app`;
}

function syncKeyToPassword(key) {
    return `CV7.${key}.vault`;
}

let _cloudAuthPromise = null;
let _cloudUid = null;

/**
 * Đăng nhập Cloud bằng mã đồng bộ. Trả về user hoặc null khi offline/không thể
 * xác thực (khi đó ứng dụng chạy 100% local, không ghi dữ liệu lên Cloud).
 */
export async function ensureCloudAuth() {
    if (!auth) return null;
    const key = getSyncKey();
    if (!key) return null;
    const email = syncKeyToEmail(key);
    if (auth.currentUser && auth.currentUser.email === email) {
        _cloudUid = auth.currentUser.uid;
        return auth.currentUser;
    }
    if (_cloudAuthPromise) return _cloudAuthPromise;

    _cloudAuthPromise = (async () => {
        const password = syncKeyToPassword(key);
        try {
            let credential;
            try {
                credential = await signInWithEmailAndPassword(auth, email, password);
            } catch (signInError) {
                const code = signInError?.code || '';
                const canCreate = code === 'auth/user-not-found'
                    || code === 'auth/invalid-credential'
                    || code === 'auth/invalid-login-credentials'
                    || code === 'auth/wrong-password';
                if (!canCreate) throw signInError;
                credential = await createUserWithEmailAndPassword(auth, email, password);
            }
            _cloudUid = credential.user.uid;
            return credential.user;
        } catch (error) {
            console.warn('⚠️ Cloud auth không khả dụng (chạy local-only):', error?.code || error?.message);
            _cloudUid = null;
            return null;
        } finally {
            _cloudAuthPromise = null;
        }
    })();
    return _cloudAuthPromise;
}

/** Giữ API cũ để các module khác không phải sửa. */
export async function ensureAuth() {
    return ensureCloudAuth();
}

export function getCurrentUserId() {
    return _cloudUid || null;
}

/**
 * Áp dụng mã đồng bộ mới (nhập từ thiết bị khác). Đăng xuất tài khoản cũ,
 * đăng nhập không gian mới và trả về user.
 */
export async function applySyncKey(rawKey) {
    const key = normalizeSyncKey(rawKey);
    if (!key) throw new Error('Mã đồng bộ phải gồm 16–40 ký tự chữ và số.');
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(SYNC_KEY_STORAGE, key); } catch (_) {}
    _cloudUid = null;
    _cloudAuthPromise = null;
    try { await signOut(auth); } catch (_) {}
    const user = await ensureCloudAuth();
    if (!user) throw new Error('Không đăng nhập được Cloud. Hãy kiểm tra kết nối mạng.');
    return user;
}

// ===== SERVER TIME CALIBRATION (Clock Skew Protection) =====
let _serverTimeOffset = 0;

export function updateServerTimeOffset(remoteTimeMillis) {
    if (remoteTimeMillis && typeof remoteTimeMillis === 'number' && remoteTimeMillis > 0) {
        const diff = remoteTimeMillis - Date.now();
        if (Math.abs(diff) > 1000 || _serverTimeOffset === 0) _serverTimeOffset = diff;
    }
}

export function getCalibratedNow() {
    return Date.now() + _serverTimeOffset;
}

// ===== DEVICE FINGERPRINT & ANTI-ECHO =====
export { getDeviceId } from './device.js';
import { getDeviceId } from './device.js';

// ===== PER-USER PATHS =====
const VOCAB_SUBCOLLECTION = 'vocabulary';
const STATE_SUBCOLLECTION = 'state';
const COLLECTION_PULL_PAGE_SIZE = 200;
const AUTO_PULL_MAX_PAGES = 2;
const FULL_PULL_MAX_PAGES = 50;
const PULL_SAFETY_BUFFER_MS = 10000;
const SYNC_PROTOCOL_VERSION = 3;

function userCollection(uid, name) {
    return collection(db, 'users', uid, name);
}

function userDoc(uid, name, id) {
    return doc(db, 'users', uid, name, id);
}

function yieldToMainThread() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

// ===== QUOTA BREAKER (persisted) =====
const QUOTA_BREAKER_KEY = 'celestialQuotaExhaustedUntil';
let _quotaExhaustedUntil = 0;
try {
    if (typeof localStorage !== 'undefined') {
        _quotaExhaustedUntil = Number(localStorage.getItem(QUOTA_BREAKER_KEY)) || 0;
        if (_quotaExhaustedUntil < Date.now()) _quotaExhaustedUntil = 0;
    }
} catch (_) {}

function tripQuotaBreaker(ms = 60 * 60 * 1000) {
    _quotaExhaustedUntil = Date.now() + ms;
    try { localStorage.setItem(QUOTA_BREAKER_KEY, String(_quotaExhaustedUntil)); } catch (_) {}
}

function isQuotaError(error) {
    const code = error?.code || '';
    const message = String(error?.message || '');
    return code === 'resource-exhausted'
        || message.includes('Quota exceeded')
        || message.includes('resource-exhausted')
        || message.includes('429');
}

// ===== MUTEX =====
let _isSyncing = false;
let _syncPendingAfterCurrent = false;

// ===== HELPERS =====

/** Read and merge within the same transaction; retries never mutate local state. */
export async function writeMergedCards(cards) {
    const user = await ensureCloudAuth();
    if (!user) throw new Error('CLOUD_UNAVAILABLE');
    const uid = user.uid;
    const snapshot = cards.map(card => JSON.parse(JSON.stringify(normalizeCard(card))));
    const committed = [];
    for (let i = 0; i < snapshot.length; i += 100) {
        const chunk = snapshot.slice(i, i + 100);
        const merged = await runTransaction(db, async transaction => {
            const refs = chunk.map(card => doc(db, 'users', uid, 'vocabulary', card.id));
            const remote = await Promise.all(refs.map(ref => transaction.get(ref)));
            return chunk.map((card, index) => {
                const result = mergeCardFields(card, remote[index].exists() ? remote[index].data() : null);
                if (!remote[index].exists() || !isSrsEqual(result, remote[index].data())) {
                    transaction.set(refs[index], {
                        ...result,
                        syncedAt: serverTimestamp(),
                        _lastModifiedBy: getDeviceId(),
                        _ownerUid: uid
                    });
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
    // --- CIRCUIT BREAKER QUOTA PROTECTION ---
    if (Date.now() < _quotaExhaustedUntil) {
        const remainingMinutes = Math.ceil((_quotaExhaustedUntil - Date.now()) / 60000);
        console.warn(`⏳ [Circuit Breaker] Quota Firebase tạm dừng. Chế độ offline còn ${remainingMinutes} phút.`);
        setSyncUIState('offline');
        if (isManual) {
            const ui = await getUI();
            ui?.showToast?.("Hạn mức Cloud tạm dừng", "Hạn mức Firebase hôm nay đã đạt giới hạn. Ứng dụng đang hoạt động 100% offline an toàn trên máy bạn!", "ph-warning-circle");
        }
        return;
    }

    // --- OFFLINE: không khởi động sync, không quay spinner ---
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setSyncUIState('offline');
        if (isManual) {
            const ui = await getUI();
            ui?.showToast?.("Đang ngoại tuyến", "Dữ liệu vẫn được lưu trên máy và sẽ đồng bộ khi có mạng.", "ph-cloud-slash");
        }
        return;
    }

    // --- MUTEX ---
    if (_isSyncing) {
        console.log("🔄 smartSync đã đang chạy. Đánh dấu pending...");
        _syncPendingAfterCurrent = true;
        return;
    }
    _isSyncing = true;
    _syncPendingAfterCurrent = false;

    console.log(`🔄 [Smart Sync v4] Bắt đầu đồng bộ 2 chiều (forceFullPull=${forceFullPull})...`);

    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('CHEAT_MODE') === 'true') {
        if (sessionStorage.getItem('ISOLATED_TEST_MODE') === 'true') {
            console.log("🧪 Đang ở chế độ Isolated Test Mode. Bỏ qua đồng bộ Cloud không hiển thị popup.");
            _isSyncing = false;
            return;
        }
        const ui = await getUI();
        ui?.showPopup?.("⛔️ Tài khoản đang dùng Cheat. Chặn đồng bộ!", "warning");
        _isSyncing = false;
        return;
    }

    let ui = null;
    let settled = false;

    try {
        ui = await getUI();

        // --- AUTHENTICATION (bắt buộc trước mọi thao tác Cloud) ---
        const user = await ensureCloudAuth();
        if (!user) {
            settled = true;
            setSyncUIState('offline');
            if (isManual) {
                ui?.showToast?.("Chưa kết nối Cloud", "Không đăng nhập được không gian đồng bộ. Ứng dụng vẫn học và lưu 100% trên máy.", "ph-cloud-slash");
            }
            return;
        }

        // --- UI: Loading state (chỉ sau khi thực sự bắt đầu request) ---
        setSyncUIState('syncing');

        const stateModule = await import('./state.js');
        const vocabulary = stateModule.getState().vocabulary || [];
        const protocol = await getSettingFromDB('syncProtocol');
        let lastPullTime = forceFullPull || protocol !== SYNC_PROTOCOL_VERSION
            ? 0
            : (await getSettingFromDB('lastPullTime') || 0);

        // Local rỗng không còn ép full pull: auto sync vẫn chỉ đọc 1 trang đầu.
        // Full pull chỉ chạy khi người dùng chủ động bấm "Đồng bộ toàn bộ".

        // ============================================================
        // PHASE 0: FLUSH — Đẩy các card pending trong outbox lên Cloud TRƯỚC
        // ============================================================
        const syncModule = await import('./sync.js');
        const flushedIds = new Set(await syncModule.flushSyncQueue());

        // ============================================================
        // PHASE 1: PULL — theo trang, lưu cursor sau từng trang
        // ============================================================
        let needsLocalUpdate = flushedIds.size > 0;
        const pulledIds = new Set();
        const convergedCardsToPush = [];
        const myDeviceId = getDeviceId();
        let cursorTime = lastPullTime;
        let lastDocSnap = null;
        let pageCount = 0;
        const pageLimit = forceFullPull || isManual ? FULL_PULL_MAX_PAGES : AUTO_PULL_MAX_PAGES;
        const baseCollection = userCollection(user.uid, VOCAB_SUBCOLLECTION);

        while (pageCount < pageLimit) {
            let q;
            if (lastDocSnap) {
                q = query(baseCollection, orderBy('syncedAt'), startAfter(lastDocSnap), limit(COLLECTION_PULL_PAGE_SIZE));
            } else if (lastPullTime > 0) {
                const bufferedPullTime = Math.max(0, lastPullTime - PULL_SAFETY_BUFFER_MS);
                q = query(
                    baseCollection,
                    where('syncedAt', '>', Timestamp.fromMillis(bufferedPullTime)),
                    orderBy('syncedAt'),
                    limit(COLLECTION_PULL_PAGE_SIZE)
                );
            } else {
                q = query(baseCollection, orderBy('syncedAt'), limit(COLLECTION_PULL_PAGE_SIZE));
            }

            const querySnapshot = await getDocs(q);
            if (querySnapshot.empty) break;
            pageCount++;

            let pageMaxPullTime = cursorTime;
            querySnapshot.forEach(docSnap => {
                const remote = normalizeCard(docSnap.data());
                remote.id = docSnap.id;
                const remoteTime = toMillis(remote.updatedAt);
                const remoteSyncedTime = toMillis(remote.syncedAt);
                pageMaxPullTime = Math.max(pageMaxPullTime, remoteSyncedTime);

                remote.updatedAt = remoteTime;
                remote.syncedAt = remoteSyncedTime || Date.now();
                if (remote.srsDueDate) remote.srsDueDate = toMillis(remote.srsDueDate);
                if (remote.lastReviewDate) remote.lastReviewDate = toMillis(remote.lastReviewDate);

                pulledIds.add(remote.id);

                // Bỏ qua loopback/echo nếu thẻ do chính máy này vừa ghi
                if (remote._lastModifiedBy === myDeviceId && remoteSyncedTime <= _lastLocalWriteTimestamp) {
                    return;
                }

                const localIndex = stateModule.getVocabIndexById(remote.id);
                if (localIndex === -1) {
                    stateModule.pushCardToVocabulary(remote);
                    needsLocalUpdate = true;
                    return;
                }

                const local = stateModule.getState().vocabulary[localIndex];
                const localTime = toMillis(local.updatedAt);
                if (remoteTime === localTime && isSrsEqual(local, remote)) return;

                const merged = mergeCardFields(local, remote);
                if (merged.srsDueDate) merged.srsDueDate = toMillis(merged.srsDueDate);
                if (merged.lastReviewDate) merged.lastReviewDate = toMillis(merged.lastReviewDate);

                if (!isSrsEqual(merged, local)) {
                    stateModule.updateCardInVocabulary(local.id, merged);
                    needsLocalUpdate = true;
                }
                if (!isSrsEqual(merged, remote)) {
                    convergedCardsToPush.push(merged);
                }
            });

            cursorTime = pageMaxPullTime;
            lastDocSnap = querySnapshot.docs[querySnapshot.docs.length - 1];

            // KHÔNG ghi syncProtocol/cursor ở đây: nếu ghi protocol mới trước khi commit
            // watermark, một lần migrate lỗi có thể ghép protocol mới với watermark cũ
            // của protocol trước, khiến lần pull tự động kế tiếp bỏ qua thẻ remote.
            // Mọi thứ được commit cùng nhau ở checkpoint cuối (sau khi lưu IndexedDB thành công).

            if (querySnapshot.size < COLLECTION_PULL_PAGE_SIZE) break;
            await yieldToMainThread();
        }

        // ============================================================
        // PHASE 2: PUSH — thẻ local chưa từng sync + thẻ merge hội tụ
        // ============================================================
        const cardsToPushMap = new Map();
        for (const card of convergedCardsToPush) {
            if (card && card.id) cardsToPushMap.set(card.id, card);
        }
        for (const card of vocabulary) {
            if (!card || !card.id) continue;
            if (pulledIds.has(card.id)) continue;
            if (!card.syncedAt && !flushedIds.has(card.id)) {
                if (!cardsToPushMap.has(card.id)) cardsToPushMap.set(card.id, card);
            }
        }

        const cardsToPush = Array.from(cardsToPushMap.values());

        // QUOTA SHIELD: chặn push hàng loạt trong background
        if (cardsToPush.length > 50 && !isManual) {
            console.warn(`🛡️ [Quota Shield] Phát hiện ${cardsToPush.length} thẻ cần push trong background. Chặn push hàng loạt để bảo vệ Firebase Quota.`);
            cardsToPush.length = 0;
        }

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
        // PHASE 3: Gamification & Stats & Settings & Logs
        // ============================================================
        const { gamificationChanged = false, statsChanged = false } = await syncProgressToFirebase() || {};
        await syncUserSettings();

        // ============================================================
        // PHASE 4: UI & timestamps
        // ============================================================
        const manageModal = typeof document !== 'undefined' ? document.getElementById('manage-modal') : null;
        const isManageModalOpen = manageModal && !manageModal.classList.contains('hidden');
        const isOverviewTabActive = isManageModalOpen && document.getElementById('profile-view-overview')?.classList.contains('active');
        const isWordsTabActive = isManageModalOpen && document.getElementById('manage-view-words')?.classList.contains('active');
        const isBadgesTabActive = isManageModalOpen && document.getElementById('profile-view-badges')?.classList.contains('active');

        if (needsLocalUpdate) {
            const latestVocab = stateModule.getState().vocabulary || vocabulary;
            setVocabulary([...latestVocab]);

            const newTags = new Set(['all']);
            latestVocab.forEach(word => {
                if (word && word.tags && Array.isArray(word.tags)) {
                    word.tags.forEach(t => newTags.add(t));
                }
            });
            setAllTags(newTags);

            // Chỉ nâng watermark khi dữ liệu đã thực sự được ghi bền vững xuống IndexedDB.
            // Nếu lưu thất bại, giữ nguyên cursor cũ để lần sync sau kéo lại đủ trang.
            const persisted = await saveVocabulary(true);
            if (persisted !== false) await saveSettingToDB('lastPullTime', cursorTime);
            const state = stateModule.getState();
            const currentCardIndex = state.currentCardIndex;
            const isCurrentCardValid = currentCardIndex >= 0
                && currentCardIndex < latestVocab.length
                && latestVocab[currentCardIndex]
                && !latestVocab[currentCardIndex].isDeleted;

            buildReviewQueue();

            const typingInput = typeof document !== 'undefined' ? document.getElementById('typing-input') : null;
            const isUserActivelyTyping = typingInput && (document.activeElement === typingInput || typingInput.value.length > 0);
            const isCardFlipped = state.isFlipped;
            const isActivelyStudying = isCurrentCardValid && (isUserActivelyTyping || isCardFlipped || state.isTransitioning);

            if (isActivelyStudying) {
                const queueAfterRebuild = stateModule.getState().currentReviewQueue;
                stateModule.setReviewQueue(queueAfterRebuild.filter(idx => idx !== currentCardIndex));
                console.log(`🧘 [Non-Disruptive Study] Đang học thẻ (index ${currentCardIndex}), không làm gián đoạn màn hình học.`);
            } else if (isCurrentCardValid) {
                ui?.displayCard?.(currentCardIndex, true);
                const queueAfterRebuild = stateModule.getState().currentReviewQueue;
                stateModule.setReviewQueue(queueAfterRebuild.filter(idx => idx !== currentCardIndex));
            } else {
                const nextCard = getNextCardToReview();
                ui?.displayCard?.(nextCard);
            }

            ui?.updateStats?.();
            ui?.populateTopicFilters?.();
            if (isWordsTabActive) ui?.updatePanelWordList?.();
            if (isOverviewTabActive) ui?.renderGamificationUI?.({ isBackgroundUpdate: true });

            console.log("📱 Đã đồng bộ và áp dụng dữ liệu từ Cloud về máy thành công.");
            // Không preload toàn bộ audio ở đây: audio được nạp theo thẻ đang học.
        } else {
            if (gamificationChanged || statsChanged) {
                ui?.updateStats?.();
                if (isOverviewTabActive) ui?.renderGamificationUI?.({ isBackgroundUpdate: true });
                if (isBadgesTabActive) ui?.renderBadgesTab?.();
            }
            if (cardsToPush.length === 0) console.log("✅ Dữ liệu đã đồng bộ hoàn toàn.");
            if (cursorTime > lastPullTime) {
                await saveSettingToDB('lastPullTime', cursorTime);
            }
        }
        await saveSettingToDB('syncProtocol', SYNC_PROTOCOL_VERSION);
        await saveSettingToDB('lastSyncTime', Date.now());

        setInitialSyncDone(true);
        syncStreakFromHeatmap({ allowFreeze: true });

        settled = true;
        setSyncUIState('success');
        if (isManual) {
            ui?.showToast?.("Đồng bộ thành công", "Dữ liệu đã được đồng bộ an toàn với Cloud.", "ph-cloud-check");
        }
    } catch (error) {
        console.error("Lỗi đồng bộ Firebase:", error);
        const quota = isQuotaError(error);
        if (quota) {
            tripQuotaBreaker();
            console.warn("⛔ [Circuit Breaker] Đã ngắt kết nối 1 giờ do chạm trần Quota Firebase.");
        }
        if (!ui && isManual) ui = await getUI();
        if (isManual) {
            let msg = error?.message || "Vui lòng kiểm tra kết nối mạng.";
            if (quota) {
                msg = "Hạn mức Firebase hôm nay đã đạt giới hạn (tự động hồi phục sau 1 giờ). Bạn vẫn học bình thường 100% offline an toàn trên máy!";
            } else if (String(error?.message) === 'CLOUD_UNAVAILABLE') {
                msg = "Chưa kết nối được Cloud. Dữ liệu vẫn được lưu an toàn trên máy.";
            }
            ui?.showToast?.("Lỗi đồng bộ", msg, "ph-warning-circle");
        }
        settled = true;
        setSyncUIState(quota ? 'offline' : 'error');
    } finally {
        _isSyncing = false;
        if (!settled) setSyncUIState('error');
        if (_syncPendingAfterCurrent) {
            _syncPendingAfterCurrent = false;
            console.log("🔄 Có yêu cầu sync pending. Chạy lại...");
            setTimeout(() => smartSync(), 1000);
        }
    }
}

// ===== PHASE 3 HELPERS =====

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

async function syncGamification(uid) {
    if (isPreviewMode()) return false;
    const local = JSON.parse(JSON.stringify(prepareProgress('gamification')));
    const ref = userDoc(uid, STATE_SUBCOLLECTION, 'gamification');
    const merged = await runTransaction(db, async transaction => {
        const snap = await transaction.get(ref);
        const result = mergeGamification(local, snap.exists() ? snap.data() : null);
        transaction.set(ref, JSON.parse(JSON.stringify({ ...result, _ownerUid: uid, _lastModifiedBy: getDeviceId() })));
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

async function syncDailyStats(uid) {
    if (isPreviewMode()) return false;
    const local = JSON.parse(JSON.stringify(prepareProgress('daily')));
    const ref = userDoc(uid, STATE_SUBCOLLECTION, 'dailyStats');
    const merged = await runTransaction(db, async transaction => {
        const snap = await transaction.get(ref);
        const result = mergeDailyStats(local, snap.exists() ? snap.data() : null);
        transaction.set(ref, JSON.parse(JSON.stringify({ ...result, _ownerUid: uid, _lastModifiedBy: getDeviceId() })));
        return result;
    });
    const before = JSON.stringify(getState().dailyStats);
    const current = acceptProgress(merged, 'daily');
    acceptProgress(await saveProgressToDB('dailyStats', current, 'daily'), 'daily');
    return before !== JSON.stringify(current);
}

export async function syncUserSettings() {
    if (isPreviewMode() || (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('CHEAT_MODE') === 'true')) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    const user = await ensureCloudAuth();
    if (!user) return;
    const state = await import('./state.js');
    const current = state.getState();
    const local = {
        userFsrs7Params: current.userFsrs7Params || null,
        userFsrs7TrainedAt: current.userFsrs7TrainedAt || 0,
        trainedAt: current.userFsrs7TrainedAt || 0
    };
    const ref = userDoc(user.uid, STATE_SUBCOLLECTION, 'settings');
    const merged = await runTransaction(db, async transaction => {
        const snap = await transaction.get(ref);
        const result = mergeLearningSettings(local, snap.exists() ? snap.data() : null);
        if (result.trainedAt) {
            transaction.set(ref, { ...result, version: '7.0', _lastModifiedBy: getDeviceId(), _ownerUid: user.uid });
        }
        return result;
    });
    if (state.getState().userFsrs7TrainedAt !== current.userFsrs7TrainedAt) return;
    if (merged.trainedAt > local.trainedAt) {
        await state.setUserFsrs7Params(merged.userFsrs7Params, merged.trainedAt);
        document.dispatchEvent(new CustomEvent('learning-settings:updated'));
    }
}

async function syncReviewLogs(uid) {
    if (isPreviewMode()) return;
    const state = await import('./state.js');
    const local = JSON.parse(JSON.stringify(getState().reviewLogs || { dict: [], logs: [] }));
    const ref = userDoc(uid, STATE_SUBCOLLECTION, 'reviewLogs');
    const merged = await runTransaction(db, async transaction => {
        const snap = await transaction.get(ref);
        const raw = snap.exists() ? snap.data() : { dict: [], logs: [] };
        const remote = {
            ...raw,
            logs: (raw.logs || []).map(row => {
                if (Array.isArray(row)) return row;
                if (typeof row === 'string' && row.startsWith('[')) {
                    try { return JSON.parse(row); } catch (_) { return []; }
                }
                return String(row).split(',').map((part, index) => index < 5 ? Number(part) : part);
            })
        };
        const result = state.mergeReviewLogs(remote, local);
        const cloudLogs = result.logs.slice(-3000);
        const cloudDeletedIds = (result.deletedIds || []).slice(-500);
        transaction.set(ref, {
            dict: result.dict,
            logs: cloudLogs.map(row => JSON.stringify(row)),
            deletedIds: cloudDeletedIds,
            _lastModifiedBy: getDeviceId(),
            _ownerUid: uid
        });
        return result;
    });
    const current = state.mergeReviewLogs(merged, getState().reviewLogs);
    state.setReviewLogs(current);
    const saved = await saveReviewLogsToDB(current);
    state.setReviewLogs(state.mergeReviewLogs(state.getState().reviewLogs, saved));
}

let _progressSyncPromise = null;
export async function syncProgressToFirebase() {
    if (_progressSyncPromise) return _progressSyncPromise;
    if (isPreviewMode() || (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('CHEAT_MODE') === 'true')) return;
    const user = await ensureCloudAuth();
    if (!user) return;
    _progressSyncPromise = (async () => {
        const gamificationChanged = await syncGamification(user.uid);
        const statsChanged = await syncDailyStats(user.uid);
        await syncReviewLogs(user.uid);
        return { gamificationChanged, statsChanged };
    })();
    try { return await _progressSyncPromise; }
    finally { _progressSyncPromise = null; }
}

// ===== SYNC UI STATE =====

function setSyncUIState(state) {
    announceSyncStatus({ phase: state });
    if (typeof document === 'undefined') return;
    const manualSyncBtn = document.getElementById('manual-sync-btn');
    if (!manualSyncBtn) return;
    manualSyncBtn.setAttribute('aria-busy', String(state === 'syncing'));
    const icon = manualSyncBtn.querySelector('i');

    switch (state) {
        case 'syncing':
            manualSyncBtn.classList.add('syncing-active');
            if (icon) icon.className = 'ph-duotone ph-arrows-clockwise animate-spin';
            manualSyncBtn.title = 'Đang đồng bộ...';
            break;
        case 'success':
            manualSyncBtn.classList.remove('syncing-active');
            if (icon) icon.className = 'ph-duotone ph-cloud-check';
            manualSyncBtn.title = 'Đồng bộ thành công';
            setTimeout(() => {
                const btn = document.getElementById('manual-sync-btn');
                if (btn) {
                    const ic = btn.querySelector('i');
                    if (ic) ic.className = 'ph-duotone ph-arrows-clockwise';
                    btn.title = 'Đồng bộ Cloud';
                }
            }, 2500);
            break;
        case 'offline':
            manualSyncBtn.classList.remove('syncing-active');
            if (icon) icon.className = 'ph-duotone ph-cloud-slash';
            manualSyncBtn.title = 'Đang ngoại tuyến (Offline)';
            break;
        case 'error':
            manualSyncBtn.classList.remove('syncing-active');
            if (icon) icon.className = 'ph-duotone ph-cloud-warning';
            manualSyncBtn.title = 'Đồng bộ thất bại!';
            setTimeout(() => {
                const btn = document.getElementById('manual-sync-btn');
                if (btn) {
                    const ic = btn.querySelector('i');
                    if (ic) ic.className = 'ph-duotone ph-arrows-clockwise';
                    btn.title = 'Đồng bộ Cloud';
                }
            }, 4000);
            break;
    }
}

// ===== ONLINE/OFFLINE DETECTION =====

let _onlineHandlerAttached = false;

export function setupOnlineOfflineListeners() {
    if (_onlineHandlerAttached || typeof window === 'undefined') return;
    _onlineHandlerAttached = true;

    window.addEventListener('online', () => {
        console.log("🌐 Đã kết nối mạng. Đồng bộ tự động...");
        setSyncUIState('syncing');
        setTimeout(() => smartSync(), 2000);
    });

    window.addEventListener('offline', () => {
        console.log("📴 Mất kết nối mạng. Dữ liệu sẽ được lưu cục bộ.");
        setSyncUIState('offline');
    });

    if (!navigator.onLine) setSyncUIState('offline');
}

export function setupRealtimeSyncListener() {
    // Không dùng onSnapshot để tránh loopback/ping-pong storm và bảo vệ quota.
    console.log("🛡️ [Quota Guard] Realtime onSnapshot tắt hoàn toàn.");
}
