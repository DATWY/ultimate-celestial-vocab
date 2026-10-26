// src/core/state/tts-settings.js — T4.5b: toàn bộ cấu hình TTS (nguồn + giọng + tốc độ).
//
// T2.5 — TTS: giọng + tốc độ do người dùng chọn.
// UI-FIX — thêm `source`: 'cloud' (proxy Google TTS, cần mạng) hoặc 'device'
// (Web Speech của máy, offline). Trước đây mọi lần phát đều thử Cloud trước nên
// ô chọn "giọng máy" không có tác dụng gì người dùng nghe thấy; `source` là thứ
// làm lựa chọn giọng có ý nghĩa.
// Lưu theo đúng pattern settings đang dùng: object store `settings` của
// IndexedDB (saveSettingToDB/getSettingFromDB) dưới khoá `ttsSettings`.
// Không thêm store, không thêm localStorage key, không thêm document Cloud.
// Dữ liệu cũ (chỉ có voice/rate) vẫn đọc được: thiếu `source` ⇒ 'cloud'.
//
// Tách khỏi state.js vì cụm này KHÔNG chạm vocabulary/gamification/reviewLogs:
// nó chỉ cần `skipPersistence()` (preview-mode.js) + 2 hàm settings của idb.js.
import { getSettingFromDB, saveSettingToDB } from '../idb.js';
import { skipPersistence } from './preview-mode.js';

export const TTS_SETTINGS_KEY = 'ttsSettings';
export const TTS_RATE_MIN = 0.6;
export const TTS_RATE_MAX = 1.4;
export const TTS_RATE_DEFAULT = 1.0;
// Giá trị nguồn giọng (không export riêng: API công khai của cụm state đã có
// `ttsSource` + `normalizeTtsSource` + `setTtsSource`, thêm hằng số nữa chỉ làm
// phình barrel mà không ai cần).
const TTS_SOURCE_CLOUD = 'cloud';
const TTS_SOURCE_DEVICE = 'device';

// Live binding (export let): state.js đọc thẳng trong getState() để không tốn
// thêm byte gọi getter, đúng tinh thần tiết kiệm của T4.5b.
export let ttsVoice = '';   // voiceURI/name của giọng Web Speech; '' = tự chọn giọng tiếng Anh của máy
export let ttsRate = TTS_RATE_DEFAULT;
export let ttsSource = TTS_SOURCE_CLOUD;

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

/** Nguồn giọng: chỉ nhận 'device', mọi giá trị khác (kể cả thiếu) ⇒ 'cloud'. */
export function normalizeTtsSource(source) {
    return source === TTS_SOURCE_DEVICE ? TTS_SOURCE_DEVICE : TTS_SOURCE_CLOUD;
}

export function getTtsSettings() {
    return { voice: ttsVoice, rate: ttsRate, source: ttsSource };
}

async function persistTtsSettings() {
    if (skipPersistence()) return;
    try {
        await saveSettingToDB(TTS_SETTINGS_KEY, { voice: ttsVoice, rate: ttsRate, source: ttsSource });
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
            ttsSource = normalizeTtsSource(saved.source);
        }
    } catch (_) {}
    return getTtsSettings();
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

export async function setTtsSource(source) {
    ttsSource = normalizeTtsSource(source);
    await persistTtsSettings();
    return ttsSource;
}
