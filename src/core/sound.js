// --- START OF FILE sound.js (FINAL & CORRECT ARCHITECTURE: DATA URL) ---

import { getState } from './state.js';
import { showPopup } from '../ui/modal.js';

// === CẤU HÌNH ===
const MY_PERSONAL_TTS_PROXY = 'https://script.google.com/macros/s/AKfycbx-PZ8pXIbPZXIOJqg0ggYAZ_KgkOvkZg9jkAJqL994ypOlr__G5hWxuOk00a8d0OY7/exec';
const DB_NAME = 'audio-db-v2'; // Đổi tên DB để tránh xung đột với dữ liệu cũ bị hỏng
const STORE_NAME = 'tts-data-urls';
import { storage } from './firebase.js';
import { ref, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";

// === KHỞI TẠO BIẾN ===
let sounds = {};
let dbPromise;
let currentUtterance = new Audio();
let currentAudioUrl = null;

import { openDB } from 'idb';

function initializeDB() {
    dbPromise = openDB(DB_NAME, 1, {
        upgrade(db) {
            db.createObjectStore(STORE_NAME);
        },
    });
    console.log("Persistent Cache (IndexedDB for Data URLs) initialized.");
}

export function initializeSound() {
    if (MY_PERSONAL_TTS_PROXY.includes('DÁN_URL')) {
        console.error("VUI LÒNG CẬP NHẬT URL PROXY TRONG sound.js");
    }
    initializeDB();
        sounds = {
        flip: new Audio('/sounds/flip.wav'),
        correct: new Audio('/sounds/correct.wav'),
        incorrect: new Audio('/sounds/incorrect.wav'),
        next: new Audio('/sounds/next.wav'),
        starOn: new Audio('/sounds/star_on.wav'),
        starOff: new Audio('/sounds/star_off.wav'),
        complete: new Audio('/sounds/complete.wav'),
        delete: new Audio('/sounds/delete.wav'),
        quizStart: new Audio('/sounds/quiz_start.wav'),
        quizEnd: new Audio('/sounds/quiz_end.wav')
    };
    console.log("Sound system initialized with 2-Layer Caching.");
}

export function playSound(soundName) {
    const { isSoundEnabled } = getState();
    if (isSoundEnabled && sounds[soundName]) {
        sounds[soundName].currentTime = 0;
        sounds[soundName].play().catch(e => console.warn(`Sound play warning (${soundName}):`, e.message));
    }
}

/**
 * Lấy Data URL để phát.
 * Nó sẽ lấy từ IndexedDB hoặc fetch mới từ proxy.
 */
async function getAudioDataURL(text) {
    const db = await dbPromise;
    const safeFilename = text.toLowerCase().replace(/[^a-z0-9]/gi, '_'); 
    const storageRef = ref(storage, `audio_cache/${safeFilename}.txt`);

    // Helper: Chuyển DataURL sang Blob
    const dataURLToBlob = (dataurl) => {
        const arr = dataurl.split(',');
        const mime = arr[0].match(/:(.*?);/)[1];
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while(n--){
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new Blob([u8arr], {type:mime});
    };

    // ==========================================
    // LỚP 1: KIỂM TRA BỘ NHỚ TRONG (INDEXEDDB) - NHANH NHẤT
    // ==========================================
    const cachedData = await db.get(STORE_NAME, text);
    if (cachedData) {
        // Nếu là Blob (định dạng mới), tạo object URL. Nếu là string (cũ), trả về luôn
        if (cachedData instanceof Blob) {
            return URL.createObjectURL(cachedData);
        } else {
            return cachedData;
        }
    }

    // ==========================================
    // LỚP 2: KIỂM TRA FIREBASE CLOUD STORAGE - NHANH VỪA
    // (Dành cho trường hợp thiết bị khác đã tải và đẩy lên mây rồi)
    // ==========================================
    try {
        const cloudDataUrl = await getDownloadURL(storageRef);
        
        // Firebase Storage trả về một HTTP URL để tải file text chứa Base64
        const response = await fetch(cloudDataUrl);
        const downloadedDataUrl = await response.text();
        
        // Chuyển sang Blob và cất vào máy
        const blob = dataURLToBlob(downloadedDataUrl);
        await db.put(STORE_NAME, blob, text);
        console.log(`☁️ Đã tải âm thanh "${text}" từ Firebase Storage về máy (Lưu dưới dạng Blob).`);
        return URL.createObjectURL(blob);

    } catch (storageError) {
        // storageError.code === 'storage/object-not-found' nghĩa là trên mây chưa có
        // Bỏ qua lỗi này để đi tiếp sang Lớp 3
    }

    // ==========================================
    // LỚP 3: GỌI API PROXY - CHẬM NHẤT (Chỉ dùng 1 lần duy nhất trên đời cho mỗi từ)
    // ==========================================
    console.log(`🌐 Gọi API tải âm thanh mới toanh cho: "${text}"...`);
    const proxyUrl = `${MY_PERSONAL_TTS_PROXY}?text=${encodeURIComponent(text)}`;
    try {
        const response = await fetch(proxyUrl);
        if (!response.ok) throw new Error(`Proxy lỗi (status: ${response.status})`);
        
        const data = await response.json();
        if (data.error) throw new Error(`Lỗi từ proxy: ${data.error}`);

        const newDataURL = `data:${data.mimeType};base64,${data.audioContent}`;

        // 3.1: Chuyển đổi thành Blob và lưu vào ổ cứng máy tính hiện tại
        const blob = dataURLToBlob(newDataURL);
        await db.put(STORE_NAME, blob, text);

        // 3.2: Tự động đẩy file lên Firebase Storage cho các thiết bị khác dùng chung
        try {
            await uploadString(storageRef, newDataURL);
            console.log(`☁️ Đã cất âm thanh "${text}" lên Firebase Storage thành công!`);
        } catch (uploadError) {
            console.warn(`Lỗi đẩy âm thanh lên Cloud (vẫn chạy được offline):`, uploadError);
        }

        return URL.createObjectURL(blob);
    } catch (error) {
        console.error('Final Fetch Error:', error);
        throw new Error(`Không thể lấy âm thanh: ${error.message}`);
    }
}

/**
 * Hàm phát âm thanh chính.
 */
export async function speakText(text) {
    if (!text || MY_PERSONAL_TTS_PROXY.includes('DÁN_URL')) return;

    if (!currentUtterance.paused) {
        currentUtterance.pause();
    }
    
    try {
        if (currentAudioUrl) {
            URL.revokeObjectURL(currentAudioUrl);
        }
        const safeDataURL = await getAudioDataURL(text);
        if (safeDataURL && safeDataURL.startsWith('blob:')) {
            currentAudioUrl = safeDataURL;
        } else {
            currentAudioUrl = null;
        }
        
        // GÁN TRỰC TIẾP DATA URL VÀO SRC
        currentUtterance.src = safeDataURL;
        currentUtterance.currentTime = 0;
        
        await currentUtterance.play();

    } catch (error) {
        // Lỗi này giờ đây gần như không thể xảy ra trừ khi proxy chết hoặc mạng mất
        console.error('Speech Synthesis Error:', error);
        showPopup(error.message, "error");
    }
}

/**
 * Hàm preload vẫn có giá trị để "làm ấm" cache IndexedDB.
 */
export async function preloadAudio(text) {
    if (!text) return;
    try {
        const url = await getAudioDataURL(text);
        if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
    } catch (error) {
        console.warn(`Failed to prefetch audio for "${text}":`, error.message);
    }
}

// --- THÊM VÀO CUỐI FILE sound.js ---

// --- THÊM VÀO CUỐI FILE sound.js ---

let isPreloadingAll = false;

// ─── CẤU HÌNH CONCURRENCY & BACKOFF ────────────────────────────────────────
//
//  CONCURRENCY = 3:
//    Google Apps Script free tier giới hạn ~30 req/phút/user.
//    3 request song song × mỗi request ~1-2s = ~6 req/10s = ~36 req/phút.
//    Đây là ngưỡng an toàn tối đa — KHÔNG tăng lên.
//
//  DELAY_BETWEEN_SLOTS_MS = 400ms:
//    Khoảng cách tối thiểu giữa mỗi lần "thả" request mới vào slot trống.
//    Trải đều traffic, tránh burst ngắn làm quota counter tăng đột biến.
//
//  RETRY attempts: 3 lần với exponential backoff + jitter:
//    Lần 1: 2s  ± 0-500ms jitter
//    Lần 2: 4s  ± 0-500ms jitter
//    Lần 3: 8s  ± 0-500ms jitter
//    → Tổng wait tối đa ~14s trước khi bỏ cuộc
//
const PRELOAD_CONCURRENCY       = 3;
const DELAY_BETWEEN_SLOTS_MS    = 400;
const RETRY_MAX_ATTEMPTS        = 3;
const RETRY_BASE_DELAY_MS       = 2000;
const RETRY_JITTER_MS           = 500;

// ─── RATE LIMIT MONITOR ────────────────────────────────────────────────────
// Đếm số lần bị từ chối (429 / rate-limit) trong session hiện tại.
// Dùng để hiển thị cảnh báo và điều chỉnh tốc độ động.
const _rateLimitStats = {
    rejections: 0,       // Tổng số lần bị block
    lastRejectedAt: null, // Timestamp lần bị block gần nhất
    totalRequests: 0,     // Tổng request đã gửi
};

/** Đọc thống kê rate-limit hiện tại (dùng cho debug / monitoring UI) */
export function getRateLimitStats() {
    return { ..._rateLimitStats };
}

// ─── EXPONENTIAL BACKOFF + JITTER ─────────────────────────────────────────
/**
 * Tính thời gian chờ cho lần retry thứ `attempt` (bắt đầu từ 1).
 * Công thức: base * 2^(attempt-1) + random(0, jitter)
 *
 * attempt=1 → 2000 + [0..500] ms
 * attempt=2 → 4000 + [0..500] ms
 * attempt=3 → 8000 + [0..500] ms
 */
function calcBackoffMs(attempt) {
    const exponential = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
    const jitter = Math.random() * RETRY_JITTER_MS;
    return Math.round(exponential + jitter);
}

// ─── FETCH VỚI RETRY ──────────────────────────────────────────────────────
/**
 * Gọi getAudioDataURL() với tối đa RETRY_MAX_ATTEMPTS lần.
 * Nhận diện lỗi rate-limit qua HTTP 429 hoặc message chứa "429"/"rate".
 * Trả về { ok: true } hoặc { ok: false, reason }
 */
async function fetchWithRetry(text) {
    _rateLimitStats.totalRequests++;

    for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
        try {
            const url = await getAudioDataURL(text);
            if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
            return { ok: true };
        } catch (err) {
            const msg = (err.message || '').toLowerCase();
            const isRateLimit = msg.includes('429') || msg.includes('rate') || msg.includes('quota');

            if (isRateLimit) {
                _rateLimitStats.rejections++;
                _rateLimitStats.lastRejectedAt = Date.now();
                console.warn(`⚠️ Rate-limit lần ${_rateLimitStats.rejections} cho "${text}" (attempt ${attempt}/${RETRY_MAX_ATTEMPTS})`);
            }

            if (attempt === RETRY_MAX_ATTEMPTS) {
                return { ok: false, reason: err.message };
            }

            const waitMs = calcBackoffMs(attempt);
            console.log(`⏳ Retry "${text}" sau ${waitMs}ms...`);
            await new Promise(r => setTimeout(r, waitMs));
        }
    }
}

// ─── CONCURRENCY LIMITER (không cần thư viện ngoài) ──────────────────────
/**
 * Chạy tối đa `limit` task đồng thời từ mảng `tasks`.
 * Mỗi khi một slot trống, chờ thêm DELAY_BETWEEN_SLOTS_MS trước khi
 * nạp task tiếp theo — trải đều traffic, không burst.
 *
 * Tương đương p-limit(3) nhưng không cần npm install.
 *
 * @param {Array<() => Promise<any>>} tasks - Mảng các hàm trả về Promise
 * @param {number} limit - Số task chạy song song tối đa
 * @param {(done: number, total: number) => void} onProgress - Callback tiến độ
 */
async function runWithConcurrency(tasks, limit, onProgress) {
    let index = 0;
    let done = 0;
    const total = tasks.length;

    async function runNext() {
        while (index < total) {
            const currentIndex = index++;
            await tasks[currentIndex]();
            done++;
            onProgress(done, total);
            // Chờ một chút trước khi lấy task tiếp theo vào slot vừa trống
            await new Promise(r => setTimeout(r, DELAY_BETWEEN_SLOTS_MS));
        }
    }

    // Khởi động `limit` worker song song
    const workers = Array.from({ length: limit }, () => runNext());
    await Promise.all(workers);
}

// ─── HÀM CHÍNH ────────────────────────────────────────────────────────────
/**
 * Tải ngầm audio cho toàn bộ từ vựng chưa có cache.
 * Concurrency: 3 request song song, delay 400ms/slot, retry 3 lần với backoff.
 */
export async function startBackgroundAudioPreload(vocabulary) {
    if (isPreloadingAll || !vocabulary || vocabulary.length === 0) return;

    while (!dbPromise) {
        await new Promise(r => setTimeout(r, 100));
    }

    isPreloadingAll = true;

    try {
        const db = await dbPromise;

        // 1. Lọc ra những từ chưa có trong IndexedDB
        const wordsToDownload = [];
        for (const word of vocabulary) {
            if (!word.english) continue;
            try {
                const cached = await db.get(STORE_NAME, word.english);
                if (!cached) wordsToDownload.push(word.english);
            } catch (_) {
                wordsToDownload.push(word.english); // Lỗi DB → thêm vào để thử tải
            }
        }

        const total = wordsToDownload.length;
        if (total === 0) {
            console.log("⚡ Tất cả audio đã sẵn sàng offline.");
            return;
        }

        console.log(`🎵 Cần tải ${total} audio. Concurrency=${PRELOAD_CONCURRENCY}, delay=${DELAY_BETWEEN_SLOTS_MS}ms/slot`);

        // 2. Tạo danh sách task
        let successCount = 0;
        let failCount = 0;

        const tasks = wordsToDownload.map(text => async () => {
            const result = await fetchWithRetry(text);
            if (result.ok) {
                successCount++;
            } else {
                failCount++;
                console.warn(`❌ Bỏ qua "${text}": ${result.reason}`);
            }
        });

        // 3. Chạy với concurrency control
        await runWithConcurrency(tasks, PRELOAD_CONCURRENCY, (done, total) => {
            if (done % 10 === 0 || done === total) {
                console.log(`⏳ Tiến độ audio: ${done}/${total} | ✅ ${successCount} | ❌ ${failCount} | 🚫 rate-limit: ${_rateLimitStats.rejections}`);
            }
        });

        // 4. Báo cáo kết quả
        console.log(`✅ Hoàn tất: ${successCount} thành công, ${failCount} thất bại, ${_rateLimitStats.rejections} lần bị rate-limit.`);
        if (successCount > 0) {
            showPopup(`Đã tải xong ${successCount} audio. Sẵn sàng offline!`, "success");
        }
        if (_rateLimitStats.rejections > 0) {
            console.warn(`📊 Rate-limit stats:`, getRateLimitStats());
        }

    } catch (error) {
        console.error("Lỗi Background Preloader:", error);
    } finally {
        isPreloadingAll = false;
    }
}