// --- START OF FILE sound.js (FINAL & CORRECT ARCHITECTURE: DATA URL + SYNTH FALLBACK) ---

import { getState } from './state.js';
import { showPopup } from '../ui/modal.js';
import { openDB } from 'idb';

// === CẤU HÌNH ===
const MY_PERSONAL_TTS_PROXY = 'https://script.google.com/macros/s/AKfycbx-PZ8pXIbPZXIOJqg0ggYAZ_KgkOvkZg9jkAJqL994ypOlr__G5hWxuOk00a8d0OY7/exec';
const DB_NAME = 'audio-db-v2';
const STORE_NAME = 'tts-data-urls';

// === KHỞI TẠO BIẾN ===
let sounds = {};
let dbPromise;
let currentUtterance = new Audio();
let audioCtx = null;

// In-memory cache cho Object URLs để tránh tạo lại mỗi lần gọi
const _blobUrlCache = new Map(); // text → blobUrl
const MAX_BLOB_CACHE_SIZE = 50;  // Giới hạn số URL giữ trong RAM

function getCachedBlobUrl(text, blob) {
    if (_blobUrlCache.has(text)) {
        return _blobUrlCache.get(text);
    }
    // Evict oldest entry nếu cache đầy
    if (_blobUrlCache.size >= MAX_BLOB_CACHE_SIZE) {
        const firstKey = _blobUrlCache.keys().next().value;
        const oldUrl = _blobUrlCache.get(firstKey);
        URL.revokeObjectURL(oldUrl);
        _blobUrlCache.delete(firstKey);
    }
    const url = URL.createObjectURL(blob);
    _blobUrlCache.set(text, url);
    return url;
}

function initializeDB() {
    dbPromise = openDB(DB_NAME, 1, {
        upgrade(db) {
            db.createObjectStore(STORE_NAME);
        },
    });
    console.log("Persistent Cache (IndexedDB for Data URLs) initialized.");
}

// === WEB AUDIO API SYNTHESIZER FALLBACK FOR SOUND EFFECTS ===
function getAudioContext() {
    if (!audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
            audioCtx = new AudioContextClass();
        }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
}

function playSynthSound(soundName) {
    try {
        const ctx = getAudioContext();
        if (!ctx) return;
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        switch (soundName) {
            case 'flip':
                osc.type = 'sine';
                osc.frequency.setValueAtTime(320, now);
                osc.frequency.exponentialRampToValueAtTime(140, now + 0.08);
                gain.gain.setValueAtTime(0.25, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
                osc.start(now);
                osc.stop(now + 0.08);
                break;
            case 'correct':
                osc.type = 'sine';
                osc.frequency.setValueAtTime(523.25, now); // C5
                osc.frequency.setValueAtTime(659.25, now + 0.09); // E5
                gain.gain.setValueAtTime(0.2, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
                osc.start(now);
                osc.stop(now + 0.25);
                break;
            case 'incorrect':
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(220, now);
                osc.frequency.exponentialRampToValueAtTime(130, now + 0.2);
                gain.gain.setValueAtTime(0.18, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
                osc.start(now);
                osc.stop(now + 0.2);
                break;
            case 'next':
                osc.type = 'sine';
                osc.frequency.setValueAtTime(400, now);
                osc.frequency.exponentialRampToValueAtTime(600, now + 0.06);
                gain.gain.setValueAtTime(0.15, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
                osc.start(now);
                osc.stop(now + 0.06);
                break;
            case 'starOn':
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(659.25, now);
                osc.frequency.setValueAtTime(880, now + 0.07);
                osc.frequency.setValueAtTime(1046.5, now + 0.14);
                gain.gain.setValueAtTime(0.2, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
                osc.start(now);
                osc.stop(now + 0.28);
                break;
            case 'starOff':
                osc.type = 'sine';
                osc.frequency.setValueAtTime(880, now);
                osc.frequency.exponentialRampToValueAtTime(440, now + 0.12);
                gain.gain.setValueAtTime(0.15, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
                osc.start(now);
                osc.stop(now + 0.12);
                break;
            case 'complete':
                osc.type = 'sine';
                osc.frequency.setValueAtTime(523.25, now);
                osc.frequency.setValueAtTime(659.25, now + 0.1);
                osc.frequency.setValueAtTime(783.99, now + 0.2);
                osc.frequency.setValueAtTime(1046.5, now + 0.3);
                gain.gain.setValueAtTime(0.22, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
                osc.start(now);
                osc.stop(now + 0.5);
                break;
            case 'delete':
                osc.type = 'sine';
                osc.frequency.setValueAtTime(300, now);
                osc.frequency.exponentialRampToValueAtTime(100, now + 0.12);
                gain.gain.setValueAtTime(0.2, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
                osc.start(now);
                osc.stop(now + 0.12);
                break;
            case 'quizStart':
                osc.type = 'sine';
                osc.frequency.setValueAtTime(440, now);
                osc.frequency.exponentialRampToValueAtTime(880, now + 0.2);
                gain.gain.setValueAtTime(0.2, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
                osc.start(now);
                osc.stop(now + 0.25);
                break;
            case 'quizEnd':
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(523.25, now);
                osc.frequency.setValueAtTime(783.99, now + 0.12);
                gain.gain.setValueAtTime(0.2, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
                osc.start(now);
                osc.stop(now + 0.35);
                break;
            case 'levelUp':
                osc.type = 'square';
                osc.frequency.setValueAtTime(330, now); // E4
                osc.frequency.setValueAtTime(440, now + 0.1); // A4
                osc.frequency.setValueAtTime(554.37, now + 0.2); // C#5
                osc.frequency.setValueAtTime(659.25, now + 0.3); // E5
                osc.frequency.setValueAtTime(880, now + 0.4); // A5
                gain.gain.setValueAtTime(0.2, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
                osc.start(now);
                osc.stop(now + 0.8);
                break;
            case 'badgeUnlock':
                osc.type = 'sine';
                osc.frequency.setValueAtTime(523.25, now); // C5
                osc.frequency.setValueAtTime(783.99, now + 0.1); // G5
                osc.frequency.setValueAtTime(1046.5, now + 0.2); // C6
                gain.gain.setValueAtTime(0.3, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
                osc.start(now);
                osc.stop(now + 0.6);
                break;
            case 'click':
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(800, now);
                osc.frequency.exponentialRampToValueAtTime(300, now + 0.08);
                gain.gain.setValueAtTime(0.3, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
                osc.start(now);
                osc.stop(now + 0.08);
                break;
            default:
                osc.type = 'sine';
                osc.frequency.setValueAtTime(440, now);
                gain.gain.setValueAtTime(0.1, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
                osc.start(now);
                osc.stop(now + 0.1);
                break;
        }
    } catch (_) {
        // Fallback catch
    }
}

export function initializeSound() {
    initializeDB();
    sounds = {
        flip: new Audio('/sounds/flip.mp3'),
        correct: new Audio('/sounds/correct.mp3'),
        incorrect: new Audio('/sounds/incorrect.mp3'),
        next: new Audio('/sounds/next.mp3'),
        starOn: new Audio('/sounds/star_on.mp3'),
    };
    console.log("Sound system initialized with Web Audio synth fallback.");
}

export function playSound(soundName) {
    const { soundMode } = getState();
    if (soundMode !== 'all' && soundMode !== 'sfx') return;

    if (sounds[soundName]) {
        sounds[soundName].currentTime = 0;
        sounds[soundName].play().catch(() => {
            playSynthSound(soundName);
        });
    } else {
        playSynthSound(soundName);
    }
}

/**
 * Lấy Data URL để phát.
 * Lấy từ IndexedDB hoặc fetch mới từ proxy.
 */
async function getAudioDataURL(text) {
    const db = await dbPromise;

    const dataURLToBlob = (dataurl) => {
        const arr = dataurl.split(',');
        const mime = arr[0].match(/:(.*?);/)[1];
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new Blob([u8arr], { type: mime });
    };

    // 1. KIỂM TRA INDEXEDDB (CACHE)
    const cachedData = await db.get(STORE_NAME, text);
    if (cachedData) {
        if (cachedData instanceof Blob) {
            return getCachedBlobUrl(text, cachedData);
        } else {
            return cachedData;
        }
    }

    // 2. GỌI PROXY KHI CHƯA CÓ TRONG CACHE
    console.log(`🌐 Gọi API tải âm thanh cho: "${text}"...`);
    const proxyUrl = `${MY_PERSONAL_TTS_PROXY}?text=${encodeURIComponent(text)}`;
    try {
        const response = await fetch(proxyUrl);
        if (!response.ok) throw new Error(`Proxy lỗi (status: ${response.status})`);

        const data = await response.json();
        if (data.error) throw new Error(`Lỗi từ proxy: ${data.error}`);

        const newDataURL = `data:${data.mimeType};base64,${data.audioContent}`;
        const blob = dataURLToBlob(newDataURL);
        await db.put(STORE_NAME, blob, text);

        return getCachedBlobUrl(text, blob);
    } catch (error) {
        console.error('TTS Fetch Error:', error);
        throw new Error(`Không thể lấy âm thanh: ${error.message}`);
    }
}

/**
 * Fallback dùng Web Speech API native của trình duyệt.
 */
function fallbackNativeTTS(text, rate = 1.0) {
    if ('speechSynthesis' in window) {
        try {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'en-US';
            utterance.rate = rate;
            window.speechSynthesis.speak(utterance);
            import('../ui/waveform.js').then(w => w.triggerAudioWaveformAnimation());
        } catch (e) {
            console.error('Web Speech API Fallback Error:', e);
        }
    }
}

/**
 * Hàm phát âm thanh từ vựng chính.
 */
export async function speakText(text, rate = 1.0) {
    if (!text) return;

    if (!currentUtterance.paused) {
        currentUtterance.pause();
    }

    try {
        const safeDataURL = await getAudioDataURL(text);

        currentUtterance.src = safeDataURL;
        currentUtterance.playbackRate = rate;
        currentUtterance.currentTime = 0;

        import('../ui/waveform.js').then(w => w.triggerAudioWaveformAnimation());
        await currentUtterance.play();

    } catch (error) {
        console.warn('Speech Proxy / Audio playback error, using Web Speech API fallback:', error.message);
        fallbackNativeTTS(text, rate);
    }
}

/**
 * Hàm preload audio vào cache IndexedDB.
 */
export async function preloadAudio(text) {
    if (!text) return;
    try {
        await getAudioDataURL(text);
    } catch (error) {
        console.warn(`Failed to prefetch audio for "${text}":`, error.message);
    }
}

// ─── BACKGROUND AUDIO PRELOADER ───────────────────────────────────────────
let isPreloadingAll = false;
const PRELOAD_CONCURRENCY = 3;
const DELAY_BETWEEN_SLOTS_MS = 400;
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 2000;
const RETRY_JITTER_MS = 500;

const _rateLimitStats = {
    rejections: 0,
    lastRejectedAt: null,
    totalRequests: 0,
};

export function getRateLimitStats() {
    return { ..._rateLimitStats };
}

function calcBackoffMs(attempt) {
    const exponential = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
    const jitter = Math.random() * RETRY_JITTER_MS;
    return Math.round(exponential + jitter);
}

async function fetchWithRetry(text) {
    _rateLimitStats.totalRequests++;

    for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
        try {
            await getAudioDataURL(text);
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
            await new Promise(r => setTimeout(r, DELAY_BETWEEN_SLOTS_MS));
        }
    }

    const workers = Array.from({ length: limit }, () => runNext());
    await Promise.all(workers);
}

export async function startBackgroundAudioPreload(vocabulary) {
    if (isPreloadingAll || !vocabulary || vocabulary.length === 0) return;

    while (!dbPromise) {
        await new Promise(r => setTimeout(r, 100));
    }

    isPreloadingAll = true;

    try {
        const db = await dbPromise;

        const wordsToDownload = [];
        for (const word of vocabulary) {
            if (!word.english) continue;
            try {
                const cached = await db.get(STORE_NAME, word.english);
                if (!cached) wordsToDownload.push(word.english);
            } catch (_) {
                wordsToDownload.push(word.english);
            }
        }

        const total = wordsToDownload.length;
        if (total === 0) {
            console.log("⚡ Tất cả audio đã sẵn sàng offline.");
            return;
        }

        console.log(`🎵 Cần tải ${total} audio. Concurrency=${PRELOAD_CONCURRENCY}, delay=${DELAY_BETWEEN_SLOTS_MS}ms/slot`);

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

        await runWithConcurrency(tasks, PRELOAD_CONCURRENCY, (done, total) => {
            if (done % 10 === 0 || done === total) {
                console.log(`⏳ Tiến độ audio: ${done}/${total} | ✅ ${successCount} | ❌ ${failCount} | 🚫 rate-limit: ${_rateLimitStats.rejections}`);
            }
        });

        console.log(`✅ Hoàn tất: ${successCount} thành công, ${failCount} thất bại, ${_rateLimitStats.rejections} lần bị rate-limit.`);
        if (successCount > 0) {
            showPopup(`Đã tải xong ${successCount} audio. Sẵn sàng offline!`, "success");
        }
    } catch (error) {
        console.error("Lỗi Background Preloader:", error);
    } finally {
        isPreloadingAll = false;
    }
}