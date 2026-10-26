// src/core/state/tts-settings.js — T4.5b: toàn bộ cấu hình TTS (giọng + tốc độ).
//
// T2.5 — TTS: giọng + tốc độ do người dùng chọn.
// Lưu theo đúng pattern settings đang dùng: object store `settings` của
// IndexedDB (saveSettingToDB/getSettingFromDB) dưới khoá `ttsSettings`.
// Không thêm store, không thêm localStorage key, không thêm document Cloud.
//
// Tách khỏi state.js vì cụm này KHÔNG chạm vocabulary/gamification/reviewLogs:
// nó chỉ cần `skipPersistence()` (preview-mode.js) + 2 hàm settings của idb.js.
// Nhờ đó state.js re-export nguyên vẹn 8 tên cũ mà không phải giữ bản sao.
import { getSettingFromDB, saveSettingToDB } from '../idb.js';
import { skipPersistence } from './preview-mode.js';

export const TTS_SETTINGS_KEY = 'ttsSettings';
export const TTS_RATE_MIN = 0.6;
export const TTS_RATE_MAX = 1.4;
export const TTS_RATE_DEFAULT = 1.0;

// Live binding (export let): state.js đọc thẳng trong getState() để không tốn
// thêm byte gọi getter, đúng tinh thần tiết kiệm của T4.5b.
export let ttsVoice = '';   // voiceURI/name của giọng Web Speech; '' = tự chọn giọng tiếng Anh của máy
export let ttsRate = TTS_RATE_DEFAULT;

// ===== Chuẩn hoá + lưu / đọc =====
/** Tốc độ đọc luôn nằm trong [0.6, 1.4], làm tròn 1 chữ số thập phân (bước 0.1). */
export function normalizeTtsRate(rate) {
    if (rate === null || rate === undefined || rate === '') return TTS_RATE_DEFAULT;
    const value = Number(rate);
    if (!Number.isFinite(value)) return TTS_RATE_DEFAULT;
    const clamped = Math.min(TTS_RATE_MAX, Math.max(TTS_RATE_MIN, value));
    return Math.round(clamped * 10) / 10;
}

/** Giọng đọc: chuỗi định danh ngắn (voiceURI/name); rỗng = auto. */
export function normalizeTtsVoice(voice) {
    if (typeof voice !== 'string') return '';
    return voice.trim().slice(0, 120);
}

export function getTtsSettings() {
    return { voice: ttsVoice, rate: ttsRate };
}

async function persistTtsSettings() {
    if (skipPersistence()) return;
    try {
        await saveSettingToDB(TTS_SETTINGS_KEY, { voice: ttsVoice, rate: ttsRate });
    } catch (_) {
        // Không có IndexedDB (SSR/test) vẫn giữ cấu hình trong bộ nhớ phiên này.
    }
}

/** Đọc lại cấu hình TTS đã lưu (gọi trong loadVocabulary). */
export async function loadTtsSettings() {
    try {
        const saved = await getSettingFromDB(TTS_SETTINGS_KEY);
        if (saved && typeof saved === 'object') {
            ttsVoice = normalizeTtsVoice(saved.voice);
            ttsRate = normalizeTtsRate(saved.rate);
        }
    } catch (_) {}
    return { voice: ttsVoice, rate: ttsRate };
}

export async function setTtsVoice(voice) {
    ttsVoice = normalizeTtsVoice(voice);
    await persistTtsSettings();
    return ttsVoice;
}

export async function setTtsRate(rate) {
    ttsRate = normalizeTtsRate(rate);
    await persistTtsSettings();
    return ttsRate;
}
