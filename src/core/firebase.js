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
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
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

// Khoá IndexedDB của watermark pull bản cũ: dùng chung cho mọi không gian nên
// khi đổi mã đồng bộ, watermark bị đẩy vượt qua thẻ của không gian mới.
const LEGACY_PULL_WATERMARK_KEY = 'lastPullTime';
const PULL_WATERMARK_PREFIX = 'lastPullTime:';

export const SYNC_KEY_INVALID_CODE = 'sync/invalid-key';
export const SYNC_KEY_UNAVAILABLE_CODE = 'sync/unavailable';

const AUTH_INVALID_KEY_MESSAGE = 'Mã không đúng hoặc không tồn tại. Kiểm tra lại 20 ký tự.';
const AUTH_UNAVAILABLE_MESSAGE = 'Không đăng nhập được Cloud. Hãy kiểm tra kết nối mạng.';

// Firebase trả các mã này khi cặp email/mật khẩu không khớp tài khoản nào.
// Chúng KHÔNG đồng nghĩa với "hãy tạo tài khoản": người dùng gõ sai 1 ký tự
// cũng rơi vào đây, nên chỉ được tạo khi có cờ cho phép rõ ràng.
const INVALID_CREDENTIAL_CODES = new Set([
    'auth/user-not-found',
    'auth/invalid-credential',
    'auth/invalid-login-credentials',
    'auth/wrong-password'
]);

export function normalizeSyncKey(raw) {
    if (typeof raw !== 'string') return '';
    const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return SYNC_KEY_PATTERN.test(compact) ? compact : '';
}

/**
 * Khoá IndexedDB lưu watermark pull của MỘT không gian Cloud.
 * Watermark phải tách theo uid: nếu dùng chung, không gian B sẽ đẩy cursor vượt
 * qua thẻ của không gian A và lần quay lại A sẽ không bao giờ kéo được thẻ nữa.
 */
export function pullWatermarkKey(uid) {
    const id = typeof uid === 'string' ? uid.trim() : (uid === null || uid === undefined ? '' : String(uid).trim());
    return id ? `${PULL_WATERMARK_PREFIX}${id}` : LEGACY_PULL_WATERMARK_KEY;
}

/**
 * Quyết định bước xác thực tiếp theo từ mã lỗi Firebase.
 * - 'signin': chưa có lỗi (chưa thử đăng nhập) — cứ đăng nhập bình thường.
 * - 'create': mã chưa có tài khoản VÀ người dùng đã cho phép tạo rõ ràng.
 * - 'fail'  : không đăng nhập được — tuyệt đối không tự tạo tài khoản.
 */
export function resolveAuthAction(errorCode, { allowCreate = false } = {}) {
    if (errorCode === null || errorCode === undefined) return 'signin';
    if (typeof errorCode !== 'string') return 'fail';
    if (!INVALID_CREDENTIAL_CODES.has(errorCode)) return 'fail';
    return allowCreate ? 'create' : 'fail';
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

/** Đọc mã đang lưu mà KHÔNG tự sinh mã mới (dùng khi cần khôi phục trạng thái cũ). */
function readStoredSyncKey() {
    if (typeof localStorage === 'undefined') return '';
    try { return normalizeSyncKey(localStorage.getItem(SYNC_KEY_STORAGE) || ''); } catch (_) { return ''; }
}

// Cờ "mã này do CHÍNH app sinh ra trên máy này" (lần chạy đầu / sau khi xoá dữ liệu).
// Chỉ có cờ này mới cho phép tự tạo không gian Cloud: mã nội bộ không thể gõ sai,
// còn mã do người dùng dán vào thì gõ lệch 1 ký tự là thành một không gian rỗng khác.
const SYNC_KEY_AUTOGEN_STORAGE = 'celestialSyncKeyAutoGen';

/** Mã hiện tại có phải do app tự sinh (không phải người dùng nhập) hay không. */
export function isAutoGeneratedSyncKey() {
    if (typeof localStorage === 'undefined') return false;
    try { return localStorage.getItem(SYNC_KEY_AUTOGEN_STORAGE) === '1'; } catch (_) { return false; }
}

function markSyncKeyAutoGenerated(value) {
    if (typeof localStorage === 'undefined') return;
    try {
        if (value) localStorage.setItem(SYNC_KEY_AUTOGEN_STORAGE, '1');
        else localStorage.removeItem(SYNC_KEY_AUTOGEN_STORAGE);
    } catch (_) {}
}

/** Trả về mã đồng bộ đang dùng; tự sinh mã mới ở lần chạy đầu tiên. */
export function getSyncKey() {
    let key = readStoredSyncKey();
    if (!key) {
        key = generateSyncKey();
        try { localStorage.setItem(SYNC_KEY_STORAGE, key); } catch (_) {}
        // Đánh dấu: mã này do app sinh, tạo không gian Cloud cho nó là an toàn.
        markSyncKeyAutoGenerated(true);
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
let _cloudAuthPromiseKey = '';
let _cloudAuthPromiseCreates = false;
let _cloudUid = null;
let _lastAuthFailure = null;
// Tăng mỗi lần đổi mã đồng bộ: một lần đăng nhập cũ còn đang bay không được
// phép ghi đè uid/lỗi của danh tính mới.
let _cloudAuthGeneration = 0;

/** Lý do đăng nhập Cloud thất bại gần nhất (null nếu thành công). */
export function getLastCloudAuthFailure() {
    return _lastAuthFailure;
}

/** Driver Firebase Auth thật; tách riêng để test có thể tiêm bản giả trong Node. */
function defaultAuthDriver() {
    if (!auth) return null;
    return {
        get currentUser() { return auth.currentUser || null; },
        signIn: (email, password) => signInWithEmailAndPassword(auth, email, password),
        create: (email, password) => createUserWithEmailAndPassword(auth, email, password)
    };
}

function buildSyncKeyError(failure) {
    const code = failure?.code || '';
    const invalidKey = INVALID_CREDENTIAL_CODES.has(code);
    const error = new Error(invalidKey ? AUTH_INVALID_KEY_MESSAGE : AUTH_UNAVAILABLE_MESSAGE);
    error.code = invalidKey ? SYNC_KEY_INVALID_CODE : SYNC_KEY_UNAVAILABLE_CODE;
    error.authCode = code;
    return error;
}

/**
 * Đăng nhập Cloud bằng mã đồng bộ. Trả về user hoặc null khi offline/không thể
 * xác thực (khi đó ứng dụng chạy 100% local, không ghi dữ liệu lên Cloud).
 *
 * Mặc định KHÔNG BAO GIỜ tạo tài khoản mới khi mã do NGƯỜI DÙNG nhập: chỉ khi
 * caller truyền createIfMissing:true từ một hành động rõ ràng, hoặc khi mã hiện
 * tại do chính app sinh ra trên máy này (lần chạy đầu — không thể gõ sai).
 * Nhập sai một ký tự trong mã đồng bộ không còn âm thầm tạo ra không gian rỗng.
 */
export async function ensureCloudAuth({ createIfMissing = false, authDriver = null } = {}) {
    const driver = authDriver || defaultAuthDriver();
    if (!driver) return null;
    const key = getSyncKey();
    if (!key) return null;
    // Mã do app tự sinh (không phải người dùng dán vào) thì tạo không gian là an toàn.
    const allowCreate = createIfMissing || isAutoGeneratedSyncKey();
    const email = syncKeyToEmail(key);
    const currentUser = driver.currentUser || null;
    if (currentUser && currentUser.email === email) {
        _cloudUid = currentUser.uid;
        _lastAuthFailure = null;
        return currentUser;
    }

    if (_cloudAuthPromise && _cloudAuthPromiseKey === key) {
        if (_cloudAuthPromiseCreates === allowCreate) return _cloudAuthPromise;
        // Một lần đăng nhập khác đang chạy với cùng mã: chờ nó. Thành công thì
        // dùng luôn; thất bại thì thử lại với cờ tạo tài khoản mới.
        const settled = await _cloudAuthPromise.catch(() => null);
        if (settled) return settled;
    }

    const password = syncKeyToPassword(key);
    const run = async () => {
        const generation = _cloudAuthGeneration;
        const isCurrent = () => generation === _cloudAuthGeneration;
        // Nhường một microtask để promise kịp gán vào _cloudAuthPromise trước khi
        // finally chạy (phòng driver ném lỗi đồng bộ thay vì reject promise).
        await Promise.resolve();
        if (isCurrent()) _lastAuthFailure = null;
        try {
            let credential;
            try {
                credential = await driver.signIn(email, password);
            } catch (signInError) {
                const action = resolveAuthAction(signInError?.code, { allowCreate });
                if (action !== 'create') {
                    if (isCurrent()) {
                        _lastAuthFailure = {
                            code: signInError?.code || 'auth/unknown',
                            message: signInError?.message || ''
                        };
                    }
                    throw signInError;
                }
                credential = await driver.create(email, password);
            }
            if (isCurrent()) {
                _lastAuthFailure = null;
                _cloudUid = credential?.user?.uid || null;
                // Không gian đã tồn tại: từ nay mã này định danh một tài khoản thật,
                // không cần (và không được) tự tạo lại nếu một ngày đăng nhập lỗi.
                markSyncKeyAutoGenerated(false);
            }
            return credential?.user || null;
        } catch (error) {
            if (isCurrent()) {
                if (!_lastAuthFailure) {
                    _lastAuthFailure = { code: error?.code || 'auth/unknown', message: error?.message || '' };
                }
                console.warn('⚠️ Cloud auth không khả dụng (chạy local-only):', _lastAuthFailure.code);
                _cloudUid = null;
            }
            return null;
        } finally {
            if (_cloudAuthPromise === promise) {
                _cloudAuthPromise = null;
                _cloudAuthPromiseKey = '';
                _cloudAuthPromiseCreates = false;
            }
        }
    };
    const promise = run();
    _cloudAuthPromise = promise;
    _cloudAuthPromiseKey = key;
    _cloudAuthPromiseCreates = allowCreate;
    return promise;
}

/** Giữ API cũ để các module khác không phải sửa. */
export async function ensureAuth() {
    return ensureCloudAuth();
}

export function getCurrentUserId() {
    return _cloudUid || null;
}

async function readPullWatermarkSnapshot(uid) {
    const snapshot = { legacy: 0, keyed: null };
    try {
        snapshot.legacy = Number(await getSettingFromDB(LEGACY_PULL_WATERMARK_KEY)) || 0;
        if (uid) {
            const keyed = await getSettingFromDB(pullWatermarkKey(uid));
            if (keyed !== undefined && keyed !== null) snapshot.keyed = Number(keyed) || 0;
        }
    } catch (_) {}
    return snapshot;
}

async function restorePullWatermarkSnapshot(uid, snapshot) {
    if (!snapshot) return;
    try { await saveSettingToDB(LEGACY_PULL_WATERMARK_KEY, snapshot.legacy || 0); } catch (_) {}
    if (uid && snapshot.keyed !== null && snapshot.keyed !== undefined) {
        try { await saveSettingToDB(pullWatermarkKey(uid), snapshot.keyed); } catch (_) {}
    }
}

/** Chuyển watermark dùng chung (bản cũ) sang uid cũ rồi vô hiệu hoá nó. */
async function migrateLegacyPullWatermark(previousUid, legacyWatermark) {
    if (!(legacyWatermark > 0)) return;
    if (previousUid) {
        try {
            const keyedKey = pullWatermarkKey(previousUid);
            const existing = await getSettingFromDB(keyedKey);
            if (existing === undefined || existing === null) await saveSettingToDB(keyedKey, legacyWatermark);
        } catch (_) {}
    }
    try { await saveSettingToDB(LEGACY_PULL_WATERMARK_KEY, 0); } catch (_) {}
}

/** Đọc watermark pull của uid, có fallback một lần cho khoá dùng chung bản cũ. */
async function loadPullWatermark(uid) {
    const key = pullWatermarkKey(uid);
    try {
        const keyed = await getSettingFromDB(key);
        if (keyed !== undefined && keyed !== null) return Number(keyed) || 0;
        // Bản cũ chỉ có `lastPullTime` dùng chung: migrate sang uid hiện tại một
        // lần rồi vô hiệu hoá để không làm sai cursor của không gian khác.
        const legacy = Number(await getSettingFromDB(LEGACY_PULL_WATERMARK_KEY)) || 0;
        if (legacy > 0) {
            await saveSettingToDB(key, legacy);
            await saveSettingToDB(LEGACY_PULL_WATERMARK_KEY, 0);
        }
        return legacy;
    } catch (_) {
        return 0;
    }
}

/**
 * Áp dụng mã đồng bộ mới (nhập từ thiết bị khác). Đăng nhập không gian mới và
 * trả về user. Phiên cũ chỉ bị thay thế khi đăng nhập thành công, nhờ vậy nếu
 * thất bại thì mã cũ, uid cũ và watermark cũ vẫn nguyên vẹn (không nửa vời).
 *
 * options.createIfMissing: chỉ true khi người dùng chủ động bấm
 * "Tạo không gian mới với mã này" — mặc định không bao giờ tạo tài khoản.
 * options.authDriver: điểm tiêm dành cho unit test (production để trống).
 */
export async function applySyncKey(rawKey, options = {}) {
    const { createIfMissing = false, authDriver = null } = options || {};
    const key = normalizeSyncKey(rawKey);
    if (!key) throw new Error('Mã đồng bộ phải gồm 16–40 ký tự chữ và số.');

    const previousKey = readStoredSyncKey();
    const previousUid = getCurrentUserId();
    const previousAutoGen = isAutoGeneratedSyncKey();
    const watermarkSnapshot = await readPullWatermarkSnapshot(previousUid);

    // Reset watermark pull dùng chung TRƯỚC khi đăng nhập: nếu để nguyên, cursor
    // của không gian trước có thể vượt qua toàn bộ thẻ của không gian mới.
    // Watermark theo uid của không gian cũ vẫn được giữ (khôi phục nếu fail).
    if (watermarkSnapshot.legacy > 0) {
        try { await saveSettingToDB(LEGACY_PULL_WATERMARK_KEY, 0); } catch (_) {}
    }

    try { if (typeof localStorage !== 'undefined') localStorage.setItem(SYNC_KEY_STORAGE, key); } catch (_) {}
    // Mã do người dùng nhập: huỷ cờ "app tự sinh" để không bao giờ tự tạo tài khoản
    // từ một mã có thể gõ sai (chỉ nút "Tạo không gian mới" mới được phép tạo).
    markSyncKeyAutoGenerated(false);
    _cloudUid = null;
    _cloudAuthGeneration++;
    _cloudAuthPromise = null;
    _cloudAuthPromiseKey = '';
    _cloudAuthPromiseCreates = false;
    _lastAuthFailure = null;

    let user = null;
    try {
        user = await ensureCloudAuth({ createIfMissing, authDriver });
    } catch (error) {
        _lastAuthFailure = { code: error?.code || 'auth/unknown', message: error?.message || '' };
    }

    if (!user) {
        // Khôi phục nguyên trạng: mã cũ + watermark cũ + uid cũ.
        try {
            if (typeof localStorage !== 'undefined') {
                if (previousKey) localStorage.setItem(SYNC_KEY_STORAGE, previousKey);
                else localStorage.removeItem(SYNC_KEY_STORAGE);
            }
        } catch (_) {}
        markSyncKeyAutoGenerated(previousAutoGen);
        await restorePullWatermarkSnapshot(previousUid, watermarkSnapshot);
        _cloudUid = previousUid;
        _cloudAuthPromise = null;
        _cloudAuthPromiseKey = '';
        _cloudAuthPromiseCreates = false;
        throw buildSyncKeyError(_lastAuthFailure);
    }

    // Đăng nhập thành công: bảo toàn cursor của không gian cũ dưới khoá theo uid,
    // rồi vô hiệu hoá watermark dùng chung để nó không "đội lốt" cho uid mới.
    await migrateLegacyPullWatermark(previousUid, watermarkSnapshot.legacy);
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
        return { ok: false, reason: 'quota' };
    }

    // --- OFFLINE: không khởi động sync, không quay spinner ---
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setSyncUIState('offline');
        if (isManual) {
            const ui = await getUI();
            ui?.showToast?.("Đang ngoại tuyến", "Dữ liệu vẫn được lưu trên máy và sẽ đồng bộ khi có mạng.", "ph-cloud-slash");
        }
        return { ok: false, reason: 'offline' };
    }

    // --- MUTEX ---
    if (_isSyncing) {
        console.log("🔄 smartSync đã đang chạy. Đánh dấu pending...");
        _syncPendingAfterCurrent = true;
        return { ok: false, reason: 'busy' };
    }
    _isSyncing = true;
    _syncPendingAfterCurrent = false;

    console.log(`🔄 [Smart Sync v4] Bắt đầu đồng bộ 2 chiều (forceFullPull=${forceFullPull})...`);

    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('CHEAT_MODE') === 'true') {
        if (sessionStorage.getItem('ISOLATED_TEST_MODE') === 'true') {
            console.log("🧪 Đang ở chế độ Isolated Test Mode. Bỏ qua đồng bộ Cloud không hiển thị popup.");
            _isSyncing = false;
            return { ok: false, reason: 'blocked' };
        }
        const ui = await getUI();
        ui?.showPopup?.("⛔️ Tài khoản đang dùng Cheat. Chặn đồng bộ!", "warning");
        _isSyncing = false;
        return { ok: false, reason: 'blocked' };
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
            return { ok: false, reason: 'auth', error: getLastCloudAuthFailure()?.code || '' };
        }

        // --- UI: Loading state (chỉ sau khi thực sự bắt đầu request) ---
        setSyncUIState('syncing');

        const stateModule = await import('./state.js');
        const vocabulary = stateModule.getState().vocabulary || [];
        const protocol = await getSettingFromDB('syncProtocol');
        // Watermark tách theo uid: đổi mã đồng bộ không còn đẩy cursor của không
        // gian này vượt qua thẻ của không gian khác.
        const watermarkKey = pullWatermarkKey(user.uid);
        const resetCursor = forceFullPull || protocol !== SYNC_PROTOCOL_VERSION;
        let lastPullTime = 0;
        if (!resetCursor) {
            lastPullTime = await loadPullWatermark(user.uid);
        } else {
            // Ghi cursor 0 cho đúng uid này để fallback legacy không "hồi sinh"
            // watermark dùng chung cũ, đồng thời vô hiệu hoá chính khoá legacy.
            try {
                await saveSettingToDB(watermarkKey, 0);
                await saveSettingToDB(LEGACY_PULL_WATERMARK_KEY, 0);
            } catch (_) {}
        }

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
        let pulledCardCount = 0;
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
                    pulledCardCount++;
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
                    pulledCardCount++;
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
            if (persisted !== false) await saveSettingToDB(watermarkKey, cursorTime);
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
                await saveSettingToDB(watermarkKey, cursorTime);
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
        return {
            ok: true,
            pulledCardCount,
            pushedCardCount: cardsToPush.length,
            cursorTime
        };
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
        return { ok: false, reason: quota ? 'quota' : 'error', error: error?.message || '' };
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
