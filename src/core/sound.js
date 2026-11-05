// --- START OF FILE sound.js (FINAL & CORRECT ARCHITECTURE: DATA URL + SYNTH FALLBACK) ---

// setTtsVoice/setTtsRate/TTS_RATE_MIN/TTS_RATE_MAX chỉ phục vụ panel cài đặt
// giọng đọc → đã chuyển sang features/ttsSettings.js (chunk lazy). Entry chỉ
// còn nhu cầu đọc state + chuẩn hoá tốc độ cho đường phát âm thanh.
import { getState, normalizeTtsRate, normalizeTtsSource } from './state.js';
import { openDB } from 'idb';

// Không import tĩnh modal.js: sound <-> modal <-> render là vòng import.
async function showToastAsync(title, message, icon = 'ph-speaker-high') {
    try {
        const modal = await import('../ui/modal.js');
        modal.showToast?.(title, message, icon);
    } catch (_) {}
}

// === CẤU HÌNH ===
const MY_PERSONAL_TTS_PROXY = 'https://script.google.com/macros/s/AKfycbx-PZ8pXIbPZXIOJqg0ggYAZ_KgkOvkZg9jkAJqL994ypOlr__G5hWxuOk00a8d0OY7/exec';
const DB_NAME = 'audio-db-v2';
const STORE_NAME = 'tts-data-urls';

// === KHỞI TẠO BIẾN ===
let sounds = {};
let dbPromise;

/**
 * Tạo Audio element cho TTS + gắn hiệu ứng nút loa bám đúng thời điểm phát thật:
 * 'playing' bật, kết thúc/pause tắt — thay cho animation thời lượng cố định.
 */
function createSpeechElement() {
    if (typeof Audio === 'undefined') return null;
    const el = new Audio();
    const setWaveform = (playing) => {
        import('../ui/waveform.js')
            .then(w => w.setWaveformPlaying(playing))
            .catch(() => {});
    };
    el.addEventListener('playing', () => setWaveform(true));
    el.addEventListener('ended', () => setWaveform(false));
    el.addEventListener('pause', () => setWaveform(false));
    el.addEventListener('error', () => setWaveform(false));
    return el;
}

let currentUtterance = createSpeechElement();
/** Audio element tạo muộn (môi trường không có Audio ngay lúc import, ví dụ test). */
function getSpeechElement() {
    if (!currentUtterance) currentUtterance = createSpeechElement();
    return currentUtterance;
}
let _speakRequestId = 0;

// ===== T2.5 — TTS MINH BẠCH + CẤU HÌNH (giọng / tốc độ) =====
// Proxy Google Apps Script có thể chết vì mạng / CSP / HTTP khác 200. Khi đó ta
// rơi về giọng máy (Web Speech) và nói rõ MỘT lần cho người dùng biết — không
// spam toast mỗi lần bấm loa. Bộ đếm dưới đây là nguồn sự thật cho test + cho
// badge "nguồn giọng đang dùng" trong panel công cụ.
const TTS_DIAG = {
    proxyFailures: 0,
    fallbackPlays: 0,
    noticesShown: 0,
    noticeShown: false,
    lastError: '',
    lastSource: 'unknown' // 'cloud' | 'native' | 'none' | 'unknown'
};

export function getTtsDiagnostics() {
    return { ...TTS_DIAG, settings: readTtsSettings(), voiceCount: listTtsVoices().length };
}

/** Dùng cho test / chẩn đoán: xoá bộ đếm nhưng giữ nguyên cấu hình TTS. */
export function resetTtsDiagnostics() {
    TTS_DIAG.proxyFailures = 0;
    TTS_DIAG.fallbackPlays = 0;
    TTS_DIAG.noticesShown = 0;
    TTS_DIAG.noticeShown = false;
    TTS_DIAG.lastError = '';
    TTS_DIAG.lastSource = 'unknown';
}

function getSpeechSynthesisApi() {
    if (typeof window !== 'undefined' && window.speechSynthesis) return window.speechSynthesis;
    if (typeof globalThis !== 'undefined' && globalThis.speechSynthesis) return globalThis.speechSynthesis;
    return null;
}

function getSpeechUtteranceCtor() {
    if (typeof window !== 'undefined' && typeof window.SpeechSynthesisUtterance === 'function') return window.SpeechSynthesisUtterance;
    if (typeof globalThis !== 'undefined' && typeof globalThis.SpeechSynthesisUtterance === 'function') return globalThis.SpeechSynthesisUtterance;
    return null;
}

/** Danh sách giọng máy khả dụng (rỗng khi trình duyệt chưa nạp xong danh sách giọng). */
export function listTtsVoices() {
    const synth = getSpeechSynthesisApi();
    try {
        return (synth?.getVoices?.() || []).map(voice => ({
            uri: voice.voiceURI || voice.name || '',
            name: voice.name || voice.voiceURI || '',
            lang: voice.lang || ''
        }));
    } catch (_) {
        return [];
    }
}

/** Cấu hình TTS hiện tại — đọc thẳng từ state (settings store là nguồn duy nhất). */
function readTtsSettings() {
    let state = null;
    try { state = typeof getState === 'function' ? getState() : null; } catch (_) { state = null; }
    return {
        voice: typeof state?.ttsVoice === 'string' ? state.ttsVoice : '',
        rate: normalizeTtsRate(state?.ttsRate),
        // 'device' = người dùng chọn giọng máy: KHÔNG gọi proxy Cloud.
        source: normalizeTtsSource(state?.ttsSource)
    };
}

/** Chọn giọng: ưu tiên đúng giọng người dùng chọn, rồi tới giọng tiếng Anh đầu tiên. */
function pickTtsVoice(synth, preferred) {
    let voices = [];
    try { voices = synth?.getVoices?.() || []; } catch (_) { voices = []; }
    if (!voices.length) return null;
    const wanted = String(preferred || '').trim();
    if (wanted) {
        const exact = voices.find(voice => voice.voiceURI === wanted || voice.name === wanted);
        if (exact) return exact;
    }
    return voices.find(voice => /^en[-_]/i.test(voice.lang || ''))
        || voices.find(voice => /^en/i.test(voice.lang || ''))
        || null;
}

/** Cảnh báo MỘT lần / phiên (dù người dùng bấm loa bao nhiêu lần). */
function notifyTtsOnce(kind) {
    if (TTS_DIAG.noticeShown) return false;
    TTS_DIAG.noticeShown = true;
    TTS_DIAG.noticesShown++;
    if (kind === 'unavailable') {
        showToastAsync(
            'Chưa có giọng đọc',
            'Trình duyệt/thiết bị này không phát được âm thanh từ vựng. Bạn vẫn học bình thường, chỉ là không có tiếng.',
            'ph-speaker-slash'
        );
    } else {
        showToastAsync(
            'Đang dùng giọng mặc định của máy',
            'Giọng đọc Cloud tạm thời không dùng được. Mở menu công cụ để chọn giọng/tốc độ, hoặc thử lại khi mạng ổn định.',
            'ph-info'
        );
    }
    return true;
}

/**
 * Badge "nguồn giọng đang dùng" trong panel công cụ.
 * Ở lại entry vì nó phải cập nhật ngay mỗi lần phát (speakText/fallback) — nếu
 * để ở chunk lazy thì đường phát phải await import mới đổi được badge. Chỉ 8
 * dòng, không tạo DOM: panel chưa gắn thì getElementById trả null → no-op.
 * features/ttsSettings.js import lại hàm này để refresh panel dùng chung 1 logic.
 */
export function updateTtsSourceBadge() {
    if (typeof document === 'undefined') return;
    const badge = document.getElementById('tts-source-badge');
    if (!badge) return;
    const label = TTS_DIAG.lastSource === 'cloud'
        ? 'Cloud'
        : TTS_DIAG.lastSource === 'native'
            ? 'Giọng máy'
            : TTS_DIAG.lastSource === 'none' ? 'Không có' : '—';
    if (badge.textContent !== label) badge.textContent = label;
    badge.title = TTS_DIAG.lastSource === 'cloud'
        ? 'Âm thanh lấy từ proxy Google TTS'
        : 'Đang đọc bằng giọng mặc định của trình duyệt (Web Speech)';
}

let audioCtx = null;
let masterGainNode = null;   // bus chung cho sample + synth
let synthGainNode = null;    // bus riêng để cân bằng synth với sample
let cachedNoiseBuffer = null;

// --- SFX SAMPLES ---
// Bộ 5 âm gốc (MP3) là bản người dùng đã quen tai. Chúng được phát qua
// AudioBuffer đã decode sẵn để độ trễ gần như 0 và có thể chồng tiếng.
const SFX_DEFS = {
    flip:      { file: 'flip.mp3',      gain: 0.82, maxVoices: 2 },
    correct:   { file: 'correct.mp3',   gain: 0.86, maxVoices: 2 },
    incorrect: { file: 'incorrect.mp3', gain: 0.80, maxVoices: 2 },
    next:      { file: 'next.mp3',      gain: 0.78, maxVoices: 2 },
    starOn:    { file: 'star_on.mp3',   gain: 0.84, maxVoices: 2 },
};
const _sfxBuffers = new Map();       // name → AudioBuffer
const _sfxFailed = new Set();        // name → không tải/decode được
const _sfxVoices = new Map();        // name → AudioBufferSourceNode[]
let _sfxPreloadPromise = null;
let _sfxReady = false;
let _sfxRetryAfter = 0;
// Warm-up SFX chỉ chạy SAU tương tác đầu tiên hoặc sau 3 s rảnh (T3.3):
// mở app không tải/giải mã 5 file MP3 nào.
let _sfxWarmUpArmed = false;
let _sfxWarmUpTimer = null;
const SFX_WARMUP_DELAY_MS = 3000;
let _audioUnlockInstalled = false;
let _audioUnlocked = false;

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

// === WEB AUDIO: SAMPLE ENGINE + SYNTH FALLBACK ===
function getAudioContext() {
    if (typeof window === 'undefined') return null;
    // Context đã bị đóng (close) thì phải tạo lại, nếu không mọi âm thanh sẽ câm.
    if (audioCtx && audioCtx.state === 'closed') {
        audioCtx = null;
        masterGainNode = null;
        synthGainNode = null;
    }
    if (!audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
            try {
                // 'interactive' ưu tiên buffer nhỏ → giảm độ trễ cho tiếng bấm;
                // trình duyệt cũ không hỗ trợ object options sẽ rơi vào catch.
                audioCtx = new AudioContextClass({ latencyHint: 'interactive' });
            } catch (_) {
                try { audioCtx = new AudioContextClass(); } catch (_) { audioCtx = null; }
            }
        }
    }
    if (!audioCtx) return null;

    // Dựng bus âm thanh một lần: sample + synth → master → limiter → loa.
    // Limiter chỉ hoạt động ở đỉnh cao, không nén các âm đơn lẻ.
    if (!masterGainNode || masterGainNode.context !== audioCtx) {
        let master = null;
        let synth = null;
        let limiter = null;
        try {
            master = audioCtx.createGain();
            master.gain.setValueAtTime(0.9, audioCtx.currentTime);

            if (typeof audioCtx.createDynamicsCompressor === 'function') {
                limiter = audioCtx.createDynamicsCompressor();
                limiter.threshold.setValueAtTime(-2, audioCtx.currentTime);
                limiter.knee.setValueAtTime(0, audioCtx.currentTime);
                limiter.ratio.setValueAtTime(12, audioCtx.currentTime);
                limiter.attack.setValueAtTime(0.002, audioCtx.currentTime);
                limiter.release.setValueAtTime(0.12, audioCtx.currentTime);
                master.connect(limiter);
                limiter.connect(audioCtx.destination);
            } else {
                master.connect(audioCtx.destination);
            }

            // Synth giữ mức cũ (0.35) để không bị to hơn bản trước.
            synth = audioCtx.createGain();
            synth.gain.setValueAtTime(0.35, audioCtx.currentTime);
            synth.connect(master);

            masterGainNode = master;
            synthGainNode = synth;
        } catch (_) {
            try { master?.disconnect(); } catch (_) {}
            try { synth?.disconnect(); } catch (_) {}
            try { limiter?.disconnect(); } catch (_) {}
            masterGainNode = null;
            synthGainNode = null;
            return null;
        }
    }

    if (audioCtx.state === 'suspended') {
        try {
            const p = audioCtx.resume();
            if (p && typeof p.catch === 'function') {
                p.catch(() => {});
            }
        } catch (_) {}
    }
    if (audioCtx.state === 'running') _audioUnlocked = true;
    return audioCtx;
}

function cleanupOnEnded(source, downstreamNodes = []) {
    if (!source) return;
    source.onended = () => {
        try { source.disconnect(); } catch (_) {}
        if (Array.isArray(downstreamNodes)) {
            downstreamNodes.forEach(node => {
                try { node?.disconnect(); } catch (_) {}
            });
        }
    };
}

function getProceduralNoiseBuffer(ctx) {
    if (!ctx) return null;
    if (cachedNoiseBuffer && cachedNoiseBuffer.sampleRate === ctx.sampleRate) {
        return cachedNoiseBuffer;
    }
    try {
        const sampleRate = ctx.sampleRate || 44100;
        const bufferSize = Math.floor(sampleRate * 0.4); // 400ms buffer is ample
        const buffer = ctx.createBuffer(1, bufferSize, sampleRate);
        const data = buffer.getChannelData(0);
        let b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1;
            // 3-pole pink-ish integration for organic ASMR texture
            b0 = 0.99886 * b0 + white * 0.0555179;
            b1 = 0.99332 * b1 + white * 0.0750759;
            b2 = 0.96900 * b2 + white * 0.1538520;
            const pink = b0 + b1 + b2 + white * 0.5362;
            data[i] = pink * 0.18;
        }
        cachedNoiseBuffer = buffer;
        return cachedNoiseBuffer;
    } catch (_) {
        return null;
    }
}

// === GIỚI HẠN SỐ SFX ĐỒNG THỜI (voice cap) ===
// Khi người dùng thao tác rất nhanh, nhiều voice cộng dồn vào master gain gây đỉnh
// âm lượng và tăng tải CPU. Đếm số SFX đang phát và giải phóng bằng setTimeout
// (không dùng wall-clock nên không bị kẹt khi đồng hồ hệ thống bị lùi, và vẫn
// giải phóng được khi AudioContext bị treo nên không thể mute vĩnh viễn).
const MAX_CONCURRENT_SFX = 8;
const SFX_MAX_LIFETIME_MS = 1400; // dài hơn voice dài nhất (~1.15s)
let _concurrentSfx = 0;

function beginSfxSlot() {
    if (_concurrentSfx >= MAX_CONCURRENT_SFX) return false;
    _concurrentSfx++;
    return true;
}

function releaseSfxSlot() {
    _concurrentSfx = Math.max(0, _concurrentSfx - 1);
}

// Một lần hoãn duy nhất khi context chưa chạy: tránh vừa im lặng vĩnh viễn,
// vừa tránh cấp phát voice khi audio chưa thực sự chạy (node sẽ không bao giờ ended).
let _resumeDeferred = false;

function playSynthSound(soundName) {
    try {
        const ctx = getAudioContext();
        if (!ctx || !synthGainNode) return false;
        // Context chưa chạy (autoplay policy): KHÔNG cấp phát voice, vì voice sẽ
        // không bao giờ kết thúc và sẽ tích tụ. Thay vào đó hẹn phát lại đúng một
        // lần sau khi resume() xong. Trả true để không rơi sang nhánh mp3.
        if (ctx.state !== 'running') {
            if (!_resumeDeferred) {
                _resumeDeferred = true;
                const redo = () => {
                    _resumeDeferred = false;
                    if (ctx.state === 'running') {
                        try { playSynthSound(soundName); } catch (_) {}
                    }
                };
                try {
                    const p = ctx.resume?.();
                    if (p && typeof p.then === 'function') {
                        p.then(redo).catch(() => { _resumeDeferred = false; });
                    } else {
                        _resumeDeferred = false;
                    }
                } catch (_) {
                    _resumeDeferred = false;
                }
            }
            return true;
        }
        // Chặn bão voice: coi như đã xử lý (trả true) để KHÔNG rơi sang nhánh mp3.
        if (!beginSfxSlot()) return true;
        try {
            return scheduleSynthVoices(ctx, soundName);
        } finally {
            setTimeout(releaseSfxSlot, SFX_MAX_LIFETIME_MS);
        }
    } catch (_) {
        return false;
    }
}

function scheduleSynthVoices(ctx, soundName) {
    {
        const now = ctx.currentTime;

        /** Đuôi "lấp lánh": vài sine rất cao, rơi chậm — dùng cho chuyển giao diện. */
        const addShimmer = (startAt, freqs, peak = 0.05, dur = 1.0) => {
            if (typeof ctx.createOscillator !== 'function') return;
            freqs.forEach((freq, idx) => {
                try {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'sine';
                    const at = startAt + idx * 0.07;
                    osc.frequency.setValueAtTime(freq, at);
                    gain.gain.setValueAtTime(0.0001, at);
                    gain.gain.exponentialRampToValueAtTime(peak, at + 0.02);
                    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
                    osc.connect(gain);
                    gain.connect(synthGainNode);
                    cleanupOnEnded(osc, [gain]);
                    osc.start(at);
                    osc.stop(at + dur + 0.02);
                } catch (_) { /* thiếu node thì bỏ qua, không phá âm chính */ }
            });
        };

        /** Glissando mềm giữa hai tần số (dùng để "mở màn" khi ra sáng). */
        const addGlide = (startAt, from, to, peak = 0.12, dur = 0.5) => {
            try {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(from, startAt);
                osc.frequency.exponentialRampToValueAtTime(to, startAt + dur);
                gain.gain.setValueAtTime(0.0001, startAt);
                gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.06);
                gain.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);
                osc.connect(gain);
                gain.connect(synthGainNode);
                cleanupOnEnded(osc, [gain]);
                osc.start(startAt);
                osc.stop(startAt + dur + 0.02);
            } catch (_) {}
        };

        /** Nhiễu lọc bandpass quét tần số — "tiếng vút" của màn chuyển giao diện. */
        const noiseSweep = (from, to, dur = 0.55, peak = 0.17) => {
            try {
                if (typeof ctx.createBuffer !== 'function' || typeof ctx.createBufferSource !== 'function') return false;
                const frames = Math.max(1, Math.floor((ctx.sampleRate || 44100) * dur));
                const buffer = ctx.createBuffer(1, frames, ctx.sampleRate || 44100);
                const data = typeof buffer.getChannelData === 'function' ? buffer.getChannelData(0) : null;
                for (let i = 0; i < frames; i++) {
                    const k = i / frames;
                    const fade = (1 - k) * (1 - k);
                    data[i] = (Math.random() * 2 - 1) * fade;
                }
                const src = ctx.createBufferSource();
                src.buffer = buffer;
                const band = ctx.createBiquadFilter ? ctx.createBiquadFilter() : null;
                const gain = ctx.createGain();
                gain.gain.setValueAtTime(0.0001, now);
                gain.gain.exponentialRampToValueAtTime(peak, now + dur * 0.18);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
                if (band) {
                    band.type = 'bandpass';
                    band.Q = 1.2;
                    band.frequency.setValueAtTime(from, now);
                    band.frequency.exponentialRampToValueAtTime(to, now + dur);
                    src.connect(band);
                    band.connect(gain);
                } else {
                    src.connect(gain);
                }
                gain.connect(synthGainNode);
                cleanupOnEnded(src, [gain, band].filter(Boolean));
                src.start(now);
                src.stop(now + dur);
                return true;
            } catch (_) { return false; }
        };

        /** Arpeggio ngắn: dãy nốt đi lên/xuống, mỗi nốt một "hạt" chuông. */
        const addArpeggio = (startAt, freqs, { gap = 0.1, peak = 0.14, dur = 0.9 } = {}) => {
            freqs.forEach((freq, idx) => {
                try {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    const at = startAt + idx * gap;
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(freq, at);
                    gain.gain.setValueAtTime(0.0001, at);
                    gain.gain.exponentialRampToValueAtTime(peak, at + 0.01);
                    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
                    osc.connect(gain);
                    gain.connect(synthGainNode);
                    cleanupOnEnded(osc, [gain]);
                    osc.start(at);
                    osc.stop(at + dur + 0.02);
                } catch (_) {}
            });
        };

        switch (soundName) {
            case 'flip': {
                // Classic crisp sine sweep (320Hz -> 140Hz, 80ms) from backup
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(320, now);
                osc.frequency.exponentialRampToValueAtTime(140, now + 0.08);
                gain.gain.setValueAtTime(0.25, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
                osc.connect(gain);
                gain.connect(synthGainNode);
                cleanupOnEnded(osc, [gain]);
                osc.start(now);
                osc.stop(now + 0.08);
                return true;
            }

            case 'correct': {
                // Lush harmonic crystal chime: 5 partials (C6, E6, G6, B6, D7) with long decay
                const chordFilter = ctx.createBiquadFilter();
                chordFilter.type = 'lowpass';
                chordFilter.frequency.setValueAtTime(4200, now);
                chordFilter.connect(synthGainNode);

                const partials = [
                    { freq: 1046.50, type: 'sine', gain: 0.18, delay: 0 },
                    { freq: 1318.51, type: 'sine', gain: 0.16, delay: 0.032 },
                    { freq: 1567.98, type: 'triangle', gain: 0.13, delay: 0.064 },
                    { freq: 1975.53, type: 'sine', gain: 0.11, delay: 0.096 },
                    { freq: 2349.32, type: 'sine', gain: 0.07, delay: 0.128 }
                ];

                partials.forEach((p, idx) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = p.type;
                    const startTime = now + p.delay;
                    osc.frequency.setValueAtTime(p.freq, startTime);

                    gain.gain.setValueAtTime(0.0001, startTime);
                    gain.gain.exponentialRampToValueAtTime(p.gain, startTime + 0.006);
                    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.88);

                    osc.connect(gain);
                    gain.connect(chordFilter);

                    cleanupOnEnded(osc, [gain, idx === partials.length - 1 ? chordFilter : null].filter(Boolean));
                    osc.start(startTime);
                    osc.stop(now + 0.90);
                });
                return true;
            }

            case 'incorrect': {
                // Warm low-pass muted analog thump, non-abrasive thud (~210ms)
                const lpFilter = ctx.createBiquadFilter();
                lpFilter.type = 'lowpass';
                lpFilter.frequency.setValueAtTime(480, now);
                lpFilter.connect(synthGainNode);

                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(140, now);
                osc.frequency.exponentialRampToValueAtTime(65, now + 0.18);

                gain.gain.setValueAtTime(0.0001, now);
                gain.gain.exponentialRampToValueAtTime(0.32, now + 0.005);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.20);

                osc.connect(gain);
                gain.connect(lpFilter);

                cleanupOnEnded(osc, [gain, lpFilter]);
                osc.start(now);
                osc.stop(now + 0.21);

                // Soft noise puff (felt acoustic displacement)
                const noiseBuf = getProceduralNoiseBuffer(ctx);
                if (noiseBuf) {
                    const noiseSource = ctx.createBufferSource();
                    noiseSource.buffer = noiseBuf;
                    const puffFilter = ctx.createBiquadFilter();
                    puffFilter.type = 'lowpass';
                    puffFilter.frequency.setValueAtTime(320, now);

                    const noiseGain = ctx.createGain();
                    noiseGain.gain.setValueAtTime(0.0001, now);
                    noiseGain.gain.exponentialRampToValueAtTime(0.12, now + 0.008);
                    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

                    noiseSource.connect(puffFilter);
                    puffFilter.connect(noiseGain);
                    noiseGain.connect(synthGainNode);

                    cleanupOnEnded(noiseSource, [puffFilter, noiseGain]);
                    noiseSource.start(now);
                    noiseSource.stop(now + 0.13);
                }
                return true;
            }

            case 'starOn': {
                // Rewarding celebratory arpeggio: 5 ascending notes (C5, E5, G5, C6, E6)
                const notes = [
                    { freq: 523.25, type: 'triangle' },
                    { freq: 659.25, type: 'triangle' },
                    { freq: 783.99, type: 'sine' },
                    { freq: 1046.50, type: 'sine' },
                    { freq: 1318.51, type: 'sine' }
                ];
                const stagger = 0.052;

                notes.forEach((n, idx) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = n.type;
                    const startTime = now + idx * stagger;
                    osc.frequency.setValueAtTime(n.freq, startTime);

                    gain.gain.setValueAtTime(0.0001, startTime);
                    gain.gain.exponentialRampToValueAtTime(0.20, startTime + 0.005);
                    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.35);

                    osc.connect(gain);
                    gain.connect(synthGainNode);

                    cleanupOnEnded(osc, [gain]);
                    osc.start(startTime);
                    osc.stop(startTime + 0.36);
                });
                return true;
            }

            case 'complete':
            case 'celebrate': {
                // Grand celebratory flourish (6 notes + soft shimmer partial, ~1.15s)
                const notes = [
                    { freq: 523.25, type: 'triangle', gain: 0.18, delay: 0 },
                    { freq: 659.25, type: 'triangle', gain: 0.18, delay: 0.055 },
                    { freq: 783.99, type: 'sine', gain: 0.18, delay: 0.110 },
                    { freq: 1046.50, type: 'sine', gain: 0.20, delay: 0.165 },
                    { freq: 1318.51, type: 'sine', gain: 0.18, delay: 0.220 },
                    { freq: 1567.98, type: 'sine', gain: 0.15, delay: 0.275 }
                ];

                notes.forEach(n => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = n.type;
                    const startTime = now + n.delay;
                    osc.frequency.setValueAtTime(n.freq, startTime);

                    gain.gain.setValueAtTime(0.0001, startTime);
                    gain.gain.exponentialRampToValueAtTime(n.gain, startTime + 0.005);
                    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.10);

                    osc.connect(gain);
                    gain.connect(synthGainNode);

                    cleanupOnEnded(osc, [gain]);
                    osc.start(startTime);
                    osc.stop(now + 1.12);
                });

                // Soft shimmer partial
                const shimmerOsc = ctx.createOscillator();
                const shimmerGain = ctx.createGain();
                shimmerOsc.type = 'sine';
                shimmerOsc.frequency.setValueAtTime(1975.53, now + 0.22);

                shimmerGain.gain.setValueAtTime(0.0001, now + 0.22);
                shimmerGain.gain.exponentialRampToValueAtTime(0.08, now + 0.30);
                shimmerGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.15);

                shimmerOsc.connect(shimmerGain);
                shimmerGain.connect(synthGainNode);

                cleanupOnEnded(shimmerOsc, [shimmerGain]);
                shimmerOsc.start(now + 0.22);
                shimmerOsc.stop(now + 1.16);
                return true;
            }

            case 'next': {
                // Crisp pleasant upward tactile blip (~70ms)
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(420, now);
                osc.frequency.exponentialRampToValueAtTime(640, now + 0.055);

                gain.gain.setValueAtTime(0.0001, now);
                gain.gain.exponentialRampToValueAtTime(0.18, now + 0.003);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);

                osc.connect(gain);
                gain.connect(synthGainNode);

                cleanupOnEnded(osc, [gain]);
                osc.start(now);
                osc.stop(now + 0.08);
                return true;
            }

            case 'starOff': {
                // Soft descending de-star release (G5 -> D5, 160ms)
                [
                    { freq: 783.99, delay: 0 },
                    { freq: 587.33, delay: 0.035 }
                ].forEach(n => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'sine';
                    const startTime = now + n.delay;
                    osc.frequency.setValueAtTime(n.freq, startTime);

                    gain.gain.setValueAtTime(0.0001, startTime);
                    gain.gain.exponentialRampToValueAtTime(0.14, startTime + 0.004);
                    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.15);

                    osc.connect(gain);
                    gain.connect(synthGainNode);

                    cleanupOnEnded(osc, [gain]);
                    osc.start(startTime);
                    osc.stop(startTime + 0.16);
                });
                return true;
            }

            case 'delete': {
                // Warm acoustic release / drop (~110ms)
                const filter = ctx.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(550, now);
                filter.connect(synthGainNode);

                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(240, now);
                osc.frequency.exponentialRampToValueAtTime(80, now + 0.10);

                gain.gain.setValueAtTime(0.0001, now);
                gain.gain.exponentialRampToValueAtTime(0.22, now + 0.004);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);

                osc.connect(gain);
                gain.connect(filter);

                cleanupOnEnded(osc, [gain, filter]);
                osc.start(now);
                osc.stop(now + 0.12);
                return true;
            }

            case 'quizStart': {
                // Uplifting celestial triad (F5, A5, C6)
                [698.46, 880.00, 1046.50].forEach((freq, idx) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'sine';
                    const startTime = now + idx * 0.06;
                    osc.frequency.setValueAtTime(freq, startTime);

                    gain.gain.setValueAtTime(0.0001, startTime);
                    gain.gain.exponentialRampToValueAtTime(0.18, startTime + 0.005);
                    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.38);

                    osc.connect(gain);
                    gain.connect(synthGainNode);

                    cleanupOnEnded(osc, [gain]);
                    osc.start(startTime);
                    osc.stop(startTime + 0.39);
                });
                return true;
            }

            case 'quizEnd': {
                // Resolving cadence (G5+B5 -> C6+E6)
                const chords = [
                    { freqs: [783.99, 987.77], time: now, duration: 0.20 },
                    { freqs: [1046.50, 1318.51], time: now + 0.14, duration: 0.40 }
                ];
                chords.forEach(c => {
                    c.freqs.forEach(freq => {
                        const osc = ctx.createOscillator();
                        const gain = ctx.createGain();
                        osc.type = 'triangle';
                        osc.frequency.setValueAtTime(freq, c.time);

                        gain.gain.setValueAtTime(0.0001, c.time);
                        gain.gain.exponentialRampToValueAtTime(0.15, c.time + 0.006);
                        gain.gain.exponentialRampToValueAtTime(0.0001, c.time + c.duration);

                        osc.connect(gain);
                        gain.connect(synthGainNode);

                        cleanupOnEnded(osc, [gain]);
                        osc.start(c.time);
                        osc.stop(c.time + c.duration + 0.01);
                    });
                });
                return true;
            }

            case 'levelUp': {
                // Triumphant ascending fanfare (E5, G#5, B5, E6)
                [659.25, 830.61, 987.77, 1318.51].forEach((freq, idx) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = idx < 2 ? 'triangle' : 'sine';
                    const startTime = now + idx * 0.08;
                    osc.frequency.setValueAtTime(freq, startTime);

                    gain.gain.setValueAtTime(0.0001, startTime);
                    gain.gain.exponentialRampToValueAtTime(0.20, startTime + 0.005);
                    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.82);

                    osc.connect(gain);
                    gain.connect(synthGainNode);

                    cleanupOnEnded(osc, [gain]);
                    osc.start(startTime);
                    osc.stop(now + 0.85);
                });
                return true;
            }

            case 'badgeUnlock': {
                // Shimmering cosmic resonance chord (D5, A5, F#6 detuned)
                const notes = [
                    { freq: 587.33, detune: -3 },
                    { freq: 880.00, detune: 0 },
                    { freq: 1479.98, detune: 3 }
                ];
                notes.forEach(n => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(n.freq, now);
                    if (osc.detune) osc.detune.setValueAtTime(n.detune, now);

                    gain.gain.setValueAtTime(0.0001, now);
                    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.006);
                    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.92);

                    osc.connect(gain);
                    gain.connect(synthGainNode);

                    cleanupOnEnded(osc, [gain]);
                    osc.start(now);
                    osc.stop(now + 0.95);
                });
                return true;
            }

            case 'click': {
                // Tactile glass tap / micro-switch (triangle 750 -> 220Hz in 30ms)
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(750, now);
                osc.frequency.exponentialRampToValueAtTime(220, now + 0.025);

                gain.gain.setValueAtTime(0.0001, now);
                gain.gain.exponentialRampToValueAtTime(0.14, now + 0.002);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);

                osc.connect(gain);
                gain.connect(synthGainNode);

                cleanupOnEnded(osc, [gain]);
                osc.start(now);
                osc.stop(now + 0.04);
                return true;
            }

            case 'pop': {
                // Bubbly micro-pop (sine 300 -> 820Hz in 40ms)
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(300, now);
                osc.frequency.exponentialRampToValueAtTime(820, now + 0.035);

                gain.gain.setValueAtTime(0.0001, now);
                gain.gain.exponentialRampToValueAtTime(0.15, now + 0.002);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);

                osc.connect(gain);
                gain.connect(synthGainNode);

                cleanupOnEnded(osc, [gain]);
                osc.start(now);
                osc.stop(now + 0.05);
                return true;
            }

            case 'streak': {
                // Bright motivate chime (E5 -> B5 -> E6)
                [659.25, 987.77, 1318.51].forEach((freq, idx) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'sine';
                    const startTime = now + idx * 0.045;
                    osc.frequency.setValueAtTime(freq, startTime);

                    gain.gain.setValueAtTime(0.0001, startTime);
                    gain.gain.exponentialRampToValueAtTime(0.16, startTime + 0.004);
                    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.38);

                    osc.connect(gain);
                    gain.connect(synthGainNode);

                    cleanupOnEnded(osc, [gain]);
                    osc.start(startTime);
                    osc.stop(startTime + 0.40);
                });
                return true;
            }

            case 'themeEclipse': {
                // Deep cosmic nocturne chord with lowpass sweep
                const filter = ctx.createBiquadFilter ? ctx.createBiquadFilter() : null;
                if (filter) {
                    filter.type = 'lowpass';
                    filter.frequency.setValueAtTime(850, now);
                    filter.frequency.exponentialRampToValueAtTime(180, now + 0.70);
                    filter.connect(synthGainNode);
                }

                const eclipseFreqs = [164.81, 246.94, 329.63];
                eclipseFreqs.forEach((freq, idx) => {
                    const chordOsc = ctx.createOscillator();
                    const voiceGain = ctx.createGain();
                    chordOsc.type = 'sine';
                    chordOsc.frequency.setValueAtTime(freq, now);
                    if (chordOsc.detune) {
                        chordOsc.detune.setValueAtTime((idx - 1) * 3, now);
                    }
                    voiceGain.gain.setValueAtTime(0.0001, now);
                    voiceGain.gain.exponentialRampToValueAtTime(idx === 0 ? 0.35 : 0.22, now + 0.01);
                    voiceGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.75);

                    chordOsc.connect(voiceGain);
                    voiceGain.connect(filter || synthGainNode);

                    cleanupOnEnded(chordOsc, [voiceGain, idx === eclipseFreqs.length - 1 ? filter : null].filter(Boolean));
                    chordOsc.start(now);
                    chordOsc.stop(now + 0.76);
                });
                // Sub-bass rất trầm cho cảm giác "mặt trời lặn" + đuôi sao lấp lánh.
                try {
                    const sub = ctx.createOscillator();
                    const subGain = ctx.createGain();
                    sub.type = 'sine';
                    sub.frequency.setValueAtTime(55, now);
                    subGain.gain.setValueAtTime(0.0001, now);
                    subGain.gain.exponentialRampToValueAtTime(0.14, now + 0.04);
                    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.95);
                    sub.connect(subGain);
                    subGain.connect(synthGainNode);
                    cleanupOnEnded(sub, [subGain]);
                    sub.start(now);
                    sub.stop(now + 0.97);
                } catch (_) {}
                addShimmer(now + 0.18, [1568.0, 2093.0, 2637.02], 0.045, 1.25);
                // Ba nốt đi XUỐNG, chậm — cảm giác mặt trời lặn dần.
                addArpeggio(now + 0.10, [659.25, 493.88, 329.63], { gap: 0.115, peak: 0.1, dur: 1.2 });
                return true;
            }

            case 'themeDawn': {
                // Sparkling celestial triad chime
                const dawnFreqs = [523.25, 659.25, 783.99, 1046.50];
                dawnFreqs.forEach((freq, idx) => {
                    const chimeOsc = ctx.createOscillator();
                    const voiceGain = ctx.createGain();
                    chimeOsc.type = idx >= 2 ? 'sine' : 'triangle';
                    const startTime = now + idx * 0.035;
                    chimeOsc.frequency.setValueAtTime(freq, startTime);

                    voiceGain.gain.setValueAtTime(0.0001, startTime);
                    voiceGain.gain.exponentialRampToValueAtTime(idx === 3 ? 0.28 : 0.20, startTime + 0.005);
                    voiceGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);

                    chimeOsc.connect(voiceGain);
                    voiceGain.connect(synthGainNode);

                    cleanupOnEnded(chimeOsc, [voiceGain]);
                    chimeOsc.start(startTime);
                    chimeOsc.stop(now + 0.86);
                });
                // Ba nốt đi LÊN, mở màn cho chùm chuông.
                addArpeggio(now + 0.02, [392.0, 523.25, 659.25], { gap: 0.1, peak: 0.085, dur: 1.0 });
                // Đuôi "lấp lánh": hai sine rất cao, rơi chậm — tạo cảm giác nắng lên.
                addShimmer(now + 0.12, [2093.0, 2637.02], 0.055, 1.15);
                // Glissando nhẹ đi lên để mở màn.
                addGlide(now, 660, 1320, 0.18, 0.5);
                return true;
            }

            case 'themeWhoosh': {
                // Vào Tối: nhiễu quét XUỐNG (2800 → 300 Hz) — nghe như bầu trời tối sầm lại.
                return noiseSweep(2800, 300, 0.55, 0.17);
            }

            case 'themeWhooshUp': {
                // Ra Sáng: nhiễu quét LÊN (300 → 2800 Hz) — nghe như ánh sáng tràn vào.
                return noiseSweep(300, 2800, 0.55, 0.17);
            }

            case 'undo': {
                // Hoàn tác: hai nốt đi XUỐNG, ngắn, mềm — nghe như "tua lại".
                [[880, 0], [587.33, 0.09]].forEach(([freq, offset], idx) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(freq, now + offset);
                    gain.gain.setValueAtTime(0.0001, now + offset);
                    gain.gain.exponentialRampToValueAtTime(idx === 0 ? 0.16 : 0.12, now + offset + 0.008);
                    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.26);
                    osc.connect(gain);
                    gain.connect(synthGainNode);
                    cleanupOnEnded(osc, [gain]);
                    osc.start(now + offset);
                    osc.stop(now + offset + 0.28);
                });
                return true;
            }

            default: {
                // Soft warm organic tap
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(520, now);

                gain.gain.setValueAtTime(0.0001, now);
                gain.gain.exponentialRampToValueAtTime(0.12, now + 0.003);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);

                osc.connect(gain);
                gain.connect(synthGainNode);

                cleanupOnEnded(osc, [gain]);
                osc.start(now);
                osc.stop(now + 0.08);
                return true;
            }
        }
    }
}

// === SFX SAMPLE PLAYBACK ===
function decodeAudioBuffer(ctx, arrayBuffer) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const ok = (buffer) => { if (!settled) { settled = true; resolve(buffer); } };
        const fail = (error) => { if (!settled) { settled = true; reject(error); } };
        try {
            const maybePromise = ctx.decodeAudioData(arrayBuffer, ok, fail);
            if (maybePromise && typeof maybePromise.then === 'function') {
                maybePromise.then(ok, fail);
            }
        } catch (error) {
            fail(error);
        }
    });
}

// Cắt khoảng lặng đầu/cuối của sample đã decode. MP3 thường có 20–30 ms
// encoder delay ở đầu và đuôi im lặng (next.mp3 tới 1,1 s). Cắt bằng ngưỡng
// rất thấp (-56 dB) nên không đổi âm sắc, chỉ làm tiếng bật tức thì và giải
// phóng voice sớm hơn.
function trimAudioBuffer(buffer, ctx) {
    try {
        const channels = buffer.numberOfChannels;
        const length = buffer.length;
        const rate = buffer.sampleRate;
        if (!channels || !length || !rate) return buffer;

        const data = [];
        for (let c = 0; c < channels; c++) data.push(buffer.getChannelData(c));

        const threshold = 0.0015;
        const maxLead = Math.min(length, Math.floor(rate * 0.06));
        let start = 0;
        lead: for (; start < maxLead; start++) {
            for (let c = 0; c < channels; c++) {
                if (Math.abs(data[c][start]) > threshold) break lead;
            }
        }
        // Không thấy điểm bắt đầu rõ ràng thì giữ nguyên, tránh cắt nhầm attack.
        if (start >= maxLead) start = 0;

        let end = length;
        tail: while (end > start + 1) {
            for (let c = 0; c < channels; c++) {
                if (Math.abs(data[c][end - 1]) > threshold) break tail;
            }
            end--;
        }

        // Chừa 8 ms đuôi và fade 5 ms để không bao giờ kết thúc bằng một bước nhảy.
        const pad = Math.floor(rate * 0.008);
        end = Math.min(length, end + pad);

        if (start < rate * 0.002) start = 0;
        if (start === 0 && end === length) return buffer;
        if (end - start < rate * 0.05) return buffer;

        const out = ctx.createBuffer(channels, end - start, rate);
        const fade = Math.min(Math.floor(rate * 0.005), end - start);
        for (let c = 0; c < channels; c++) {
            const dst = out.getChannelData(c);
            dst.set(data[c].subarray(start, end));
            for (let i = 0; i < fade; i++) {
                dst[dst.length - 1 - i] *= i / fade;
            }
        }
        return out;
    } catch (_) {
        return buffer;
    }
}

function preloadSfxSamples() {
    if (_sfxReady) return Promise.resolve();
    if (_sfxPreloadPromise) return _sfxPreloadPromise;
    if (Date.now() < _sfxRetryAfter) return Promise.resolve();
    if (typeof fetch !== 'function') return Promise.resolve();

    const ctx = getAudioContext();
    if (!ctx) return Promise.resolve();

    const entries = Object.entries(SFX_DEFS).filter(([name]) => !_sfxBuffers.has(name) && !_sfxFailed.has(name));
    if (!entries.length) {
        _sfxReady = true;
        return Promise.resolve();
    }

    _sfxPreloadPromise = Promise.allSettled(entries.map(async ([name, def]) => {
        try {
            const response = await fetch(`/sounds/${def.file}`, { cache: 'force-cache' });
            if (!response.ok) {
                if (response.status === 404) _sfxFailed.add(name);
                throw new Error(`SFX ${name}: HTTP ${response.status}`);
            }
            const arrayBuffer = await response.arrayBuffer();
            const decoded = await decodeAudioBuffer(ctx, arrayBuffer);
            if (!decoded || !decoded.length) throw new Error(`SFX ${name}: empty buffer`);
            const buffer = trimAudioBuffer(decoded, ctx);
            _sfxBuffers.set(name, buffer);
        } catch (error) {
            console.warn(`Không tải được SFX "${name}", dùng synth thay thế.`, error);
        }
    })).then(() => {
        _sfxPreloadPromise = null;
        const missing = Object.keys(SFX_DEFS).some(name => !_sfxBuffers.has(name) && !_sfxFailed.has(name));
        if (!missing) {
            _sfxReady = true;
        } else if (!_sfxBuffers.size) {
            // Không có sample nào: thử lại sau 15s thay vì spam request mỗi lần bấm.
            _sfxRetryAfter = Date.now() + 15000;
        } else {
            // Thiếu một vài file: vẫn dùng được các file còn lại, thử bù sau 15s.
            _sfxRetryAfter = Date.now() + 15000;
        }
    });

    return _sfxPreloadPromise;
}

function playSample(name, def) {
    const ctx = getAudioContext();
    const buffer = _sfxBuffers.get(name);
    if (!ctx || !buffer || ctx.state === 'closed' || !masterGainNode) return false;
    // Chưa có gesture đầu tiên: không xếp buffer vào context đang treo, vì nó
    // sẽ phát bù rất muộn khi người dùng chạm lần đầu. Để element/synth xử lý.
    if (ctx.state !== 'running' && !_audioUnlocked) return false;

    if (ctx.state === 'suspended') {
        try {
            const p = ctx.resume();
            if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch (_) {}
    }

    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(def.gain, now);
    source.connect(gain);
    gain.connect(masterGainNode);

    // Giới hạn số voice cho từng hiệu ứng, cắt bản cũ bằng fade 12ms để không "tạch".
    const voices = _sfxVoices.get(name) || [];
    while (voices.length >= def.maxVoices) {
        const old = voices.shift();
        try {
            const oldNow = ctx.currentTime;
            old.gain.gain.cancelScheduledValues(oldNow);
            old.gain.gain.setValueAtTime(old.gain.gain.value, oldNow);
            old.gain.gain.linearRampToValueAtTime(0.0001, oldNow + 0.012);
            old.source.stop(oldNow + 0.015);
        } catch (_) {}
    }

    const voice = { source, gain };
    voices.push(voice);
    _sfxVoices.set(name, voices);

    source.onended = () => {
        const list = _sfxVoices.get(name);
        if (list) {
            const idx = list.indexOf(voice);
            if (idx !== -1) list.splice(idx, 1);
            if (!list.length) _sfxVoices.delete(name);
        }
        try { source.disconnect(); } catch (_) {}
        try { gain.disconnect(); } catch (_) {}
    };

    try {
        source.start(now);
    } catch (_) {
        try { source.disconnect(); } catch (_) {}
        try { gain.disconnect(); } catch (_) {}
        return false;
    }
    return true;
}

function playElement(name, def) {
    let el = sounds[name];
    if (!el) {
        try {
            el = new Audio(`/sounds/${def.file}`);
            el.preload = 'auto';
            el.volume = def.gain;
            sounds[name] = el;
        } catch (_) {
            return false;
        }
    }
    try {
        el.volume = def.gain;
        el.currentTime = 0;
        const p = el.play();
        if (p && typeof p.catch === 'function') {
            p.catch(() => { playSynthSound(name); });
        }
        return true;
    } catch (_) {
        return false;
    }
}

function installAudioUnlock() {
    if (_audioUnlockInstalled || typeof window === 'undefined') return;
    _audioUnlockInstalled = true;
    const unlock = () => {
        // Đánh dấu đã có gesture kể cả khi đang Tắt: trình duyệt đã cấp quyền
        // phát audio cho trang, lần bật lại sau đó không bị coi là autoplay.
        _audioUnlocked = true;
        try {
            const mode = getState?.()?.soundMode;
            if (mode !== 'off' && mode !== 'tts') {
                const ctx = getAudioContext();
                if (ctx && ctx.state === 'suspended') {
                    const p = ctx.resume();
                    if (p && typeof p.catch === 'function') p.catch(() => {});
                }
            }
        } catch (_) {}
        // Tương tác đầu tiên = mốc warm-up sớm nhất: tải/giải mã sample ngay
        // để từ lần bấm thứ hai trở đi đường phát là buffer (độ trễ ~0).
        // Chính lần bấm này vẫn có tiếng nhờ element/synth fallback trong playSound.
        warmUpSfx();
        window.removeEventListener('pointerdown', unlock, true);
        window.removeEventListener('keydown', unlock, true);
        window.removeEventListener('touchstart', unlock, true);
    };
    window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
    window.addEventListener('keydown', unlock, { capture: true, passive: true });
    window.addEventListener('touchstart', unlock, { capture: true, passive: true });
}

function clearSfxWarmUpTimer() {
    if (_sfxWarmUpTimer === null) return;
    try { clearTimeout(_sfxWarmUpTimer); } catch (_) {}
    _sfxWarmUpTimer = null;
}

/**
 * Tải + giải mã sample SFX. Idempotent: preloadSfxSamples() tự chặn gọi trùng
 * qua _sfxReady/_sfxPreloadPromise, nên gọi từ nhiều nguồn vẫn chỉ tải 1 lần.
 */
function warmUpSfx() {
    clearSfxWarmUpTimer();
    // Người dùng có thể đã chuyển sang Tắt/TTS trước khi warm-up chạy.
    try {
        const mode = getState?.()?.soundMode;
        if (mode === 'off' || mode === 'tts') return;
    } catch (_) {}
    preloadSfxSamples().catch(() => {});
}

/**
 * Đặt lịch warm-up muộn nhất: 3 s sau khi boot, chạy trong lúc rảnh.
 * Đường còn lại (sớm hơn) là tương tác đầu tiên — xem installAudioUnlock().
 * Trước đây initializeSound() warm-up ở ~350 ms nên mở app là tải 157 kB MP3
 * dù người dùng chưa làm gì.
 */
function scheduleSfxWarmUp() {
    if (_sfxWarmUpArmed || typeof setTimeout !== 'function') return;
    _sfxWarmUpArmed = true;
    _sfxWarmUpTimer = setTimeout(() => {
        _sfxWarmUpTimer = null;
        if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(() => warmUpSfx(), { timeout: 1500 });
        } else {
            warmUpSfx();
        }
    }, SFX_WARMUP_DELAY_MS);
}

function pauseSpokenAudio() {
    _speakRequestId++;
    try {
        if (currentUtterance && !currentUtterance.paused) currentUtterance.pause();
    } catch (_) {}
    try {
        if (typeof window !== 'undefined' && window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }
    } catch (_) {}
}

function closeAudioContextForMute() {
    const ctx = audioCtx;
    audioCtx = null;
    masterGainNode = null;
    synthGainNode = null;
    _sfxVoices.clear();
    _concurrentSfx = 0;
    _resumeDeferred = false;
    if (ctx && ctx.state !== 'closed') {
        try {
            const p = ctx.close();
            if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch (_) {}
    }
}

/**
 * Đồng bộ engine âm thanh với chế độ người dùng chọn.
 * - off/tts: đóng AudioContext để cắt ngay cả tiếng đang ngân (không để tail
 *   phát lại khi bật lại), đồng thời dừng TTS nếu chế độ không cho phép TTS.
 * - sfx: chỉ dừng TTS, giữ SFX.
 */
export function applySoundMode(mode) {
    const sfxMuted = mode === 'off' || mode === 'tts';
    if (sfxMuted) closeAudioContextForMute();
    if (mode === 'off' || mode === 'sfx') pauseSpokenAudio();
    // Bật lại SFX sau khi đã có gesture: warm-up ngay, khỏi chờ lần bấm kế tiếp.
    // (_audioUnlocked = false lúc boot nên nhánh này không làm tải MP3 sớm.)
    if (!sfxMuted && _audioUnlocked) warmUpSfx();
}

export function getSfxStatus() {
    return {
        loaded: [..._sfxBuffers.keys()],
        failed: [..._sfxFailed],
        contextState: audioCtx?.state || 'none',
        usingSamples: _sfxBuffers.size > 0,
    };
}

export function initializeSound() {
    initializeDB();
    // Không tạo sẵn 5 thẻ <audio>: buffer decode là đường phát chính, còn
    // element chỉ được tạo khi buffer chưa sẵn sàng. Tránh tải trùng 164 kB.
    sounds = {};
    installAudioUnlock();
    // UI-FIX: cài đặt giọng/tốc độ nằm trong MODAL riêng (không còn 2 <select>
    // trần trong header). Chunk lazy dựng modal (append vào body) và nút
    // #tts-settings-btn trên header là cửa vào; gọi ở đây để chunk + modal sẵn
    // sàng trước lần bấm đầu tiên (hành vi tải giống bản trước).
    mountTtsSettingsUI();
    installTtsPanelTrigger();
    // Prime giọng máy sớm để sự kiện voiceschanged kích hoạt trước khi người dùng thao tác
    try { getSpeechSynthesisApi()?.getVoices?.(); } catch (_) {}
    // KHÔNG preload MP3 ở đây (T3.3): mở app không phát sinh request âm thanh.
    // Sample chỉ được tải/giải mã sau tương tác đầu tiên hoặc sau 3 s rảnh —
    // xem scheduleSfxWarmUp(). Người dùng đã tắt âm thanh hoặc chỉ dùng TTS
    // thì không tải sample chút nào.
    let savedMode = null;
    try { savedMode = localStorage.getItem('celestialSoundMode'); } catch (_) {}
    if (savedMode !== 'off' && savedMode !== 'tts') {
        scheduleSfxWarmUp();
    }
    console.log('Sound system initialized: decoded MP3 samples + synth fallback.');
}

export function playSound(soundName) {
    try {
        const { soundMode } = typeof getState === 'function' ? getState() : { soundMode: 'all' };
        if (soundMode !== 'all' && soundMode !== 'sfx') return;

        const def = SFX_DEFS[soundName];
        if (!def) {
            // Các hiệu ứng chưa có file mẫu (complete, click, levelUp...) dùng synth.
            playSynthSound(soundName);
            return;
        }

        // Ưu tiên buffer đã decode: độ trễ thấp, chồng tiếng được, không bị
        // giới hạn "mỗi file một Audio element" như bản cũ.
        if (_sfxBuffers.has(soundName) && playSample(soundName, def)) return;

        // Buffer chưa sẵn sàng (lần đầu / mạng chậm): phát element để có tiếng ngay.
        if (playElement(soundName, def)) {
            preloadSfxSamples().catch(() => {});
            return;
        }

        playSynthSound(soundName);
    } catch (_) {
        try { playSynthSound(soundName); } catch (_) {}
    }
}

/**
 * Lấy Data URL để phát.
 * Lấy từ IndexedDB hoặc fetch mới từ proxy.
 */
async function getAudioDataURL(text) {
    if (!dbPromise) initializeDB();
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
        _knownAudioKeys.add(text);
        if (cachedData instanceof Blob) {
            return getCachedBlobUrl(text, cachedData);
        } else {
            return cachedData;
        }
    }

    // 2. GỌI PROXY KHI CHƯA CÓ TRONG CACHE
    const proxyUrl = `${MY_PERSONAL_TTS_PROXY}?text=${encodeURIComponent(text)}`;
    try {
        const response = await fetch(proxyUrl);
        if (!response.ok) throw new Error(`Proxy lỗi (status: ${response.status})`);

        const data = await response.json();
        if (data.error) throw new Error(`Lỗi từ proxy: ${data.error}`);

        const newDataURL = `data:${data.mimeType};base64,${data.audioContent}`;
        const blob = dataURLToBlob(newDataURL);
        await db.put(STORE_NAME, blob, text);
        _knownAudioKeys.add(text);

        return getCachedBlobUrl(text, blob);
    } catch (error) {
        TTS_DIAG.proxyFailures++;
        TTS_DIAG.lastError = String(error?.message || error);
        console.warn('TTS Fetch Warning (falling back to native):', error?.message || error);
        throw new Error(`Không thể lấy âm thanh: ${error.message}`);
    }
}

// Chế độ 'sfx' và 'off' không được phát TTS, kể cả khi người dùng bấm loa.
function isTtsAllowed() {
    try {
        const mode = typeof getState === 'function' ? getState()?.soundMode : 'all';
        return mode !== 'off' && mode !== 'sfx';
    } catch (_) {
        return true;
    }
}

/**
 * Fallback dùng Web Speech API native của trình duyệt (giọng máy).
 * Tôn trọng cấu hình người dùng: giọng đã chọn (ttsVoice) + tốc độ (ttsRate).
 * @returns {boolean} true nếu đã thực sự gọi được giọng máy.
 */
function fallbackNativeTTS(text, rate = null) {
    if (!isTtsAllowed()) return false;
    const synth = getSpeechSynthesisApi();
    const UtteranceCtor = getSpeechUtteranceCtor();
    if (!synth || typeof synth.speak !== 'function' || !UtteranceCtor) {
        TTS_DIAG.lastSource = 'none';
        updateTtsSourceBadge();
        notifyTtsOnce('unavailable');
        return false;
    }
    try {
        synth.cancel();
        const settings = readTtsSettings();
        const effectiveRate = normalizeTtsRate(rate ?? settings.rate);
        const utterance = new UtteranceCtor(text);
        const voice = pickTtsVoice(synth, settings.voice);
        utterance.lang = (voice && voice.lang) || 'en-US';
        utterance.rate = effectiveRate;
        if (voice) utterance.voice = voice;
        utterance.onstart = () => import('../ui/waveform.js')
            .then(w => w.setWaveformPlaying(true)).catch(() => {});
        utterance.onend = utterance.onerror = () => import('../ui/waveform.js')
            .then(w => w.setWaveformPlaying(false)).catch(() => {});
        synth.speak(utterance);
        TTS_DIAG.fallbackPlays++;
        TTS_DIAG.lastSource = 'native';
        updateTtsSourceBadge();
        return true;
    } catch (e) {
        TTS_DIAG.lastSource = 'none';
        updateTtsSourceBadge();
        console.warn('[TTS] Không phát được giọng máy:', e?.message || e);
        return false;
    }
}

/**
 * Hàm phát âm thanh từ vựng chính.
 * @param {string} text
 * @param {number|null} rate  null/undefined = dùng ttsRate trong settings (0.6–1.4)
 */
export async function speakText(text, rate = null) {
    if (!text) return;
    if (!isTtsAllowed()) return;
    const settings = readTtsSettings();
    // Tốc độ: tham số truyền vào (nếu có) > cấu hình người dùng > 1.0.
    const effectiveRate = normalizeTtsRate(rate ?? settings.rate);

    // Người dùng chọn "Giọng máy của thiết bị" ⇒ đi THẲNG vào Web Speech:
    // không fetch proxy, không audio Cloud, nên giọng đã chọn mới thực sự nghe thấy.
    if (settings.source === 'device') {
        fallbackNativeTTS(text, effectiveRate);
        return;
    }

    const requestId = ++_speakRequestId;
    const player = getSpeechElement();

    if (!player) {
        // Không có HTMLAudioElement → đi thẳng vào giọng máy (nếu trình duyệt có).
        fallbackNativeTTS(text, effectiveRate);
        return;
    }

    if (!player.paused) {
        try { player.pause(); } catch (_) {}
    }

    try {
        const safeDataURL = await getAudioDataURL(text);
        // Người dùng có thể đã tắt TTS hoặc bấm từ khác trong lúc chờ proxy.
        if (requestId !== _speakRequestId || !isTtsAllowed()) return;

        player.src = safeDataURL;
        player.playbackRate = effectiveRate;
        player.currentTime = 0;

        // Hiệu ứng nút loa do sự kiện 'playing' của Audio tự bật (xem listeners
        // cạnh phần khai báo audio element) — đúng lúc tiếng thật cất lên.
        await player.play();
        TTS_DIAG.lastSource = 'cloud';
        updateTtsSourceBadge();

    } catch (error) {
        if (requestId !== _speakRequestId) return;
        console.warn('Speech Proxy / Audio playback error, using Web Speech API fallback:', error.message);
        // Minh bạch: chỉ báo MỘT lần, và chỉ khi chính người dùng vừa bấm loa
        // (các lượt preload nền lỗi không làm phiền họ).
        notifyTtsOnce('proxy');
        fallbackNativeTTS(text, effectiveRate);
    }
}

/**
 * Hàm preload audio vào cache IndexedDB.
 */
export async function preloadAudio(text) {
    if (!text) return;
    if (!isTtsAllowed()) return;
    // Nguồn 'device' là chế độ offline: đừng tải trước audio Cloud sau lưng
    // người dùng (vừa vô ích vừa tạo request tới proxy họ không muốn).
    if (readTtsSettings().source === 'device') return;
    try {
        await getAudioDataURL(text);
    } catch (error) {
        console.warn(`Failed to prefetch audio for "${text}":`, error.message);
    }
}

// ─── T2.5: CẤU HÌNH TTS — CẦU NỐI MỎNG SANG CHUNK LAZY ─────────────────────
// Toàn bộ DOM của modal cài đặt (nguồn giọng + giọng máy + tốc độ, badge,
// populate danh sách giọng) nằm ở features/ttsSettings.js để KHÔNG vào entry
// bundle (ngân sách CI 82 kB gzip của tools/bundle_budget.mjs — không nới
// ngưỡng). Ở đây chỉ còn cầu nối: dynamic import + cache promise.
let _ttsUiPromise = null;
let _ttsUiModule = null;

/** Tải chunk panel đúng MỘT lần; lỗi mạng thì log rõ và cho phép thử lại. */
function loadTtsSettingsModule() {
    if (_ttsUiPromise) return _ttsUiPromise;
    _ttsUiPromise = import('../features/ttsSettings.js')
        .then(module => { _ttsUiModule = module; return module; })
        .catch(error => {
            // KHÔNG nuốt lỗi im lặng (lỗi import động rất khó lần ra): log tiếng
            // Việt rõ ràng rồi trả null, đồng thời xoá cache để lần sau thử lại
            // thay vì kẹt một promise đã reject.
            console.warn('[TTS] Không tải được panel cài đặt giọng đọc:', error?.message || error);
            _ttsUiPromise = null;
            return null;
        });
    return _ttsUiPromise;
}

/**
 * Trả về Promise<HTMLElement|null> (modal) — code dựng DOM nằm ở chunk riêng
 * nên không thể dựng ngay trong call stack. Call-site trong app đều
 * fire-and-forget nên không phải await. mount lần 2 chỉ refresh, không nhân đôi.
 */
export function mountTtsSettingsUI() {
    return loadTtsSettingsModule()
        .then(module => (module ? module.mountTtsSettingsUI() : null))
        .catch(error => {
            console.error('[TTS] Panel cài đặt giọng đọc lỗi khi mount:', error);
            return null;
        });
}

/**
 * Đồng bộ UI trong modal với state (voiceschanged / vừa đổi cài đặt / mở modal).
 * Modal chưa mount hoặc chunk chưa nạp ⇒ no-op an toàn, KHÔNG throw.
 */
export function refreshTtsSettingsUI() {
    if (_ttsUiModule) _ttsUiModule.refreshTtsSettingsUI();
}

/**
 * Mở modal "Giọng đọc & tốc độ" (UI-FIX: thay 2 <select> trần trong header).
 * Chunk chưa về kịp thì nạp rồi mở — cùng một promise cache với mount.
 */
export function openTtsSettingsModal() {
    return loadTtsSettingsModule()
        .then(module => (module ? module.openTtsSettingsModal() : null))
        .catch(error => {
            console.error('[TTS] Modal cài đặt giọng đọc lỗi khi mở:', error);
            return null;
        });
}

/**
 * Header có nút riêng `#tts-settings-btn` (index.html) → mở modal. Gắn MỘT lần.
 * `mountTtsSettingsUI()` vẫn chạy lúc boot để chunk + modal sẵn sàng và để
 * `voiceschanged` được lắng nghe; ở đây chỉ là cửa vào.
 */
function installTtsPanelTrigger() {
    if (typeof document === 'undefined') return;
    const trigger = document.getElementById('tts-settings-btn');
    if (!trigger || trigger.dataset.ttsTriggerBound === '1') return;
    trigger.dataset.ttsTriggerBound = '1';
    trigger.addEventListener('click', () => { openTtsSettingsModal(); });
}

// ─── AUDIO CACHE INDEX & LAZY PRELOADER ───────────────────────────────────
// Trước đây mỗi lần mở app quét tuần tự 3.000 từ qua IndexedDB rồi mở 1.000
// luồng fetch + 3 lần retry/từ (đo được 3,85 s trước khi bắt đầu tải và hàng
// nghìn request). Nay: đọc toàn bộ key trong 1 transaction, chỉ tải audio cho
// thẻ đang học + 2 thẻ kế, 3 luồng, nghỉ 150 ms, không retry hàng loạt.
let isPreloadingAll = false;
let _knownAudioKeys = new Set();
let _audioIndexPromise = null;
let _audioWarmTimer = null;
let _audioWarmRunning = false;
const _audioWarmQueue = new Set();

const INITIAL_CONCURRENCY = 4; // Tải song song tối đa 4 luồng (an toàn cho proxy Google Apps Script)
const BASE_SLOT_DELAY_MS = 250; // nghỉ 250ms giữa các slot
const RETRY_MAX_ATTEMPTS = 2; // 1 lần thử lại, không retry 3 lần cả kho
const RETRY_BASE_DELAY_MS = 3000;
const RETRY_JITTER_MS = 500;
const LAZY_AUDIO_CONCURRENCY = 3;
const LAZY_AUDIO_SLOT_DELAY_MS = 150;

/** Đọc toàn bộ key audio đã có trong 1 transaction thay vì N lần db.get tuần tự. */
export async function getKnownAudioKeys({ refresh = false } = {}) {
    if (!dbPromise) initializeDB();
    if (_audioIndexPromise && !refresh) return _audioIndexPromise;
    _audioIndexPromise = (async () => {
        try {
            const db = await dbPromise;
            const keys = await db.getAllKeys(STORE_NAME);
            if (refresh) _knownAudioKeys = new Set();
            for (const key of keys) _knownAudioKeys.add(key);
        } catch (_) {}
        return _knownAudioKeys;
    })();
    return _audioIndexPromise;
}

/**
 * Trả về thống kê số lượng audio đã lưu trong IndexedDB so với tổng số từ vựng active.
 */
export async function getAudioCacheStats(vocabulary = []) {
    if (!dbPromise) initializeDB();
    const known = await getKnownAudioKeys({ refresh: true });
    const seenWords = new Set();
    let totalActive = 0;
    let cachedCount = 0;

    for (const word of vocabulary) {
        if (!word || word.isDeleted || typeof word.english !== 'string') continue;
        const text = word.english.trim();
        if (!text) continue;
        const lowerKey = text.toLowerCase();
        if (seenWords.has(lowerKey)) continue;
        seenWords.add(lowerKey);
        totalActive++;
        if (known.has(text)) {
            cachedCount++;
        }
    }

    return {
        total: totalActive,
        cached: cachedCount,
        missing: Math.max(0, totalActive - cachedCount),
        percentage: totalActive > 0 ? Math.round((cachedCount / totalActive) * 100) : 100
    };
}

function scheduleIdleAudioTask(task) {
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(task, { timeout: 2000 });
    } else {
        setTimeout(task, 300);
    }
}

/**
 * Nạp audio cho một nhóm từ (thường là thẻ hiện tại + 2 thẻ kế).
 * Debounce 350 ms, chạy khi main thread rảnh, tối đa 3 luồng, không retry.
 */
export function ensureAudioForWords(words) {
    // Không tải audio khi người dùng tắt âm thanh/TTS hoặc đang offline.
    // Chế độ 'sfx' chỉ phát hiệu ứng, không cần tải giọng đọc trước.
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    const soundMode = getState()?.soundMode;
    if (soundMode === 'off' || soundMode === 'sfx') return;
    if (words) {
        const list = Array.isArray(words) ? words : [words];
        for (const item of list) {
            const text = typeof item === 'string' ? item : item?.english;
            if (typeof text === 'string' && text.trim()) _audioWarmQueue.add(text.trim());
        }
    }
    if (!_audioWarmQueue.size || _audioWarmTimer) return;
    _audioWarmTimer = setTimeout(() => {
        _audioWarmTimer = null;
        scheduleIdleAudioTask(() => { void runAudioWarmQueue(); });
    }, 350);
}

async function runAudioWarmQueue() {
    if (_audioWarmRunning) return;
    _audioWarmRunning = true;
    try {
        const known = await getKnownAudioKeys();
        const pending = [..._audioWarmQueue].filter(text => !known.has(text)).slice(0, 12);
        _audioWarmQueue.clear();
        if (!pending.length) return;

        let index = 0;
        let ok = 0;
        let failed = 0;
        const workers = Array.from({ length: LAZY_AUDIO_CONCURRENCY }, async () => {
            while (index < pending.length) {
                const text = pending[index++];
                try {
                    await getAudioDataURL(text);
                    ok++;
                } catch (_) {
                    failed++;
                }
                await new Promise(resolve => setTimeout(resolve, LAZY_AUDIO_SLOT_DELAY_MS));
            }
        });
        await Promise.all(workers);
        if (failed) console.log(`[Audio] Đã nạp ${ok}/${pending.length} audio cho thẻ đang học (${failed} lỗi, sẽ thử lại khi gặp lại thẻ).`);
    } finally {
        _audioWarmRunning = false;
        // Nếu trong lúc chạy có thẻ mới được đưa vào hàng đợi thì chạy tiếp.
        if (_audioWarmQueue.size) ensureAudioForWords();
    }
}

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
            return { ok: true, isRateLimited: false };
        } catch (err) {
            const msg = (err.message || '').toLowerCase();
            const isRateLimit = msg.includes('429') ||
                msg.includes('rate') ||
                msg.includes('quota') ||
                msg.includes('limit') ||
                msg.includes('too many') ||
                msg.includes('service invoked');

            if (isRateLimit) {
                _rateLimitStats.rejections++;
                _rateLimitStats.lastRejectedAt = Date.now();
                console.warn(`⚠️ Rate-limit lần ${_rateLimitStats.rejections} cho "${text}" (attempt ${attempt}/${RETRY_MAX_ATTEMPTS})`);
            }

            if (attempt === RETRY_MAX_ATTEMPTS) {
                return { ok: false, reason: err.message, isRateLimited: isRateLimit };
            }

            const waitMs = calcBackoffMs(attempt);
            console.log(`⏳ Retry "${text}" sau ${waitMs}ms...`);
            await new Promise(r => setTimeout(r, waitMs));
        }
    }
}

/**
 * Bộ điều phối tải audio thích ứng động (Dynamic Rate-Limit Throttle).
 * - Tải song song đa luồng (mặc định 4 luồng) với delay 0.1s.
 * - Nếu gặp lỗi Rate-limit / Quota: tự động giảm dần số luồng song song (4 -> 3 -> 2 -> 1) và tăng delay slot (lên tới 3000ms).
 * - Nếu bị rate-limit liên tiếp 5 lần ở mức thấp nhất: tạm dừng đợt tải hiện tại để bảo toàn hạn ngạch IP.
 * - Khi hoạt động ổn định liên tục: dần dần phục hồi số luồng song song và giảm delay về mức 100ms (0.1s).
 */
async function runWithDynamicThrottle(items, fetchFn, onProgress) {
    let index = 0;
    let done = 0;
    let activeWorkers = 0;
    let targetConcurrency = INITIAL_CONCURRENCY;
    let slotDelay = BASE_SLOT_DELAY_MS;
    let consecutiveRateLimits = 0;
    let consecutiveSuccesses = 0;
    let isAborted = false;
    const total = items.length;

    return new Promise((resolve) => {
        function checkCompletion() {
            if (activeWorkers === 0 && (index >= total || isAborted)) {
                resolve({ isAborted, done, total });
            }
        }

        async function scheduleNext() {
            if (isAborted) {
                checkCompletion();
                return;
            }

            while (activeWorkers < targetConcurrency && index < total && !isAborted) {
                const currentIndex = index++;
                const item = items[currentIndex];
                activeWorkers++;

                (async () => {
                    try {
                        const result = await fetchFn(item);
                        done++;

                        if (result && result.isRateLimited) {
                            consecutiveRateLimits++;
                            consecutiveSuccesses = 0;

                            // Giảm dần số luồng song song và tăng delay
                            const oldConcurrency = targetConcurrency;
                            targetConcurrency = Math.max(1, targetConcurrency - 1);
                            slotDelay = Math.min(3000, slotDelay + 500);

                            console.warn(`📉 Audio Throttle: Phát hiện rate-limit! Giảm luồng song song ${oldConcurrency} -> ${targetConcurrency}, tăng delay lên ${slotDelay}ms.`);

                            if (consecutiveRateLimits >= 5) {
                                console.warn("🛑 Quá 5 lần rate-limit liên tiếp từ API audio proxy. Tạm dừng đợt tải này để tránh bị khóa IP.");
                                isAborted = true;
                            }

                            // Tạm nghỉ 2s để API proxy hồi phục
                            await new Promise(r => setTimeout(r, 2000));
                        } else if (result && result.ok) {
                            consecutiveSuccesses++;
                            consecutiveRateLimits = 0;

                            // Phục hồi dần luồng và slotDelay nếu ổn định kéo dài
                            if (consecutiveSuccesses >= 10) {
                                if (slotDelay > BASE_SLOT_DELAY_MS) {
                                    slotDelay = Math.max(BASE_SLOT_DELAY_MS, slotDelay - 100);
                                }
                                if (targetConcurrency < INITIAL_CONCURRENCY) {
                                    targetConcurrency++;
                                }
                            }
                        }

                        onProgress(done, total, targetConcurrency, slotDelay, result);
                    } catch (err) {
                        console.error("Lỗi worker tải audio:", err);
                    } finally {
                        activeWorkers--;
                        await new Promise(r => setTimeout(r, slotDelay));
                        scheduleNext();
                        checkCompletion();
                    }
                })();
            }

            checkCompletion();
        }

        scheduleNext();
    });
}

/**
 * Tải TOÀN BỘ audio còn thiếu để nghe ngoại tuyến.
 * CHỈ gọi khi người dùng chủ động bấm nút "Tải audio ngoại tuyến" — không chạy
 * tự động lúc mở app (trước đây main.js gọi sau 3 s và gây lag 3,8 s + hàng
 * nghìn request).
 */
export async function startBackgroundAudioPreload(vocabulary, { reason = 'manual', onProgress = null } = {}) {
    if (isPreloadingAll || !Array.isArray(vocabulary) || vocabulary.length === 0) return;

    if (!dbPromise) initializeDB();
    isPreloadingAll = true;

    try {
        // 1 transaction getAllKeys thay vì N lần db.get tuần tự.
        const known = await getKnownAudioKeys({ refresh: true });
        const seenWords = new Set();
        const missing = [];

        for (const word of vocabulary) {
            if (!word || word.isDeleted || typeof word.english !== 'string') continue;
            const text = word.english.trim();
            if (!text) continue;
            const lowerKey = text.toLowerCase();
            if (seenWords.has(lowerKey)) continue;
            seenWords.add(lowerKey);
            if (!known.has(text)) missing.push(text);
        }

        const batchTotal = missing.length;
        if (batchTotal === 0) {
            console.log(`⚡ Toàn bộ ${seenWords.size} từ vựng active đều đã có audio offline.`);
            onProgress?.({ done: seenWords.size, total: seenWords.size, percent: 100, isComplete: true, batchTotal: 0 });
            return;
        }

        console.log(`🎵 Tải audio ngoại tuyến: ${batchTotal} từ còn thiếu (tổng ${seenWords.size} từ), ${INITIAL_CONCURRENCY} luồng, delay ${BASE_SLOT_DELAY_MS}ms.`);

        let successCount = 0;
        let failCount = 0;

        const { isAborted } = await runWithDynamicThrottle(
            missing,
            async (text) => {
                const result = await fetchWithRetry(text);
                if (result.ok) successCount++;
                else failCount++;
                return result;
            },
            (done, total, currentConcurrency, currentDelay) => {
                const percent = Math.round((done / total) * 100);
                onProgress?.({ done, total, successCount, failCount, percent, isComplete: done === total });
                if (done % 25 === 0 || done === total) {
                    console.log(`⏳ Audio ${done}/${total} (${percent}%) | ✅ ${successCount} | ❌ ${failCount} | luồng ${currentConcurrency}, delay ${currentDelay}ms`);
                }
            }
        );

        console.log(`✅ Hoàn tất tải audio: ${successCount} thành công, ${failCount} thất bại, ${_rateLimitStats.rejections} lần rate-limit.`);
        onProgress?.({ done: batchTotal, total: batchTotal, successCount, failCount, percent: 100, isComplete: true, isAborted });

        if (reason === 'manual') {
            if (isAborted) {
                await showToastAsync('Âm thanh ngoại tuyến', `Đã chuẩn bị ${successCount}/${batchTotal} từ. Phần còn lại sẽ được tải ở lượt sau.`);
            } else if (successCount > 0) {
                await showToastAsync('Sẵn sàng nghe ngoại tuyến', `Đã chuẩn bị âm thanh cho ${successCount} từ.`);
            }
        }
    } catch (error) {
        console.error("Lỗi Background Preloader:", error);
    } finally {
        isPreloadingAll = false;
    }
}
