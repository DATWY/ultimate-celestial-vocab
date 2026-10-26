// --- T2.5: PANEL CÀI ĐẶT TTS (giọng đọc / tốc độ) — CHUNK LAZY ---
//
// Vì sao file này tồn tại: toàn bộ DOM của panel (2 <select>, badge nguồn giọng,
// style inline, populate option) chỉ cần khi người dùng MỞ MENU CÔNG CỤ, không
// cần cho first paint. Trước đây khối này nằm thẳng trong src/core/sound.js nên
// bị tính vào entry bundle (ngân sách CI 82 kB gzip trong tools/bundle_budget.mjs).
// Tách ra đây ⇒ entry nhẹ đi, panel thành chunk riêng `ttsSettings-*.js` chỉ tải
// khi cần. KHÔNG nới ngưỡng ngân sách.
//
// Quan hệ import (một chiều, KHÔNG có vòng tĩnh):
//   sound.js --dynamic import--> ttsSettings.js --static--> state.js, sound.js
//   state.js --dynamic import--> sound.js        (chỉ để playSound, không tĩnh)
// Chunk này chỉ được nạp SAU khi entry đã chạy xong, nên các binding import từ
// sound.js/state.js chắc chắn đã khởi tạo.
import { getState, normalizeTtsRate, setTtsVoice, setTtsRate, TTS_RATE_MIN, TTS_RATE_MAX } from '../core/state.js';
// listTtsVoices: danh sách giọng máy (đọc speechSynthesis.getVoices).
// updateTtsSourceBadge: badge "Cloud / Giọng máy" — dùng chung logic với entry.
import { listTtsVoices, updateTtsSourceBadge } from '../core/sound.js';

const TTS_UI_ID = 'tts-settings-group';
// Style tối thiểu bằng inline (không đụng src/css/**): trong suốt, kế thừa màu
// chữ của pill settings để hợp cả light lẫn dark mode.
const TTS_CONTROL_STYLE = 'font:inherit;font-size:12px;color:inherit;background:transparent;'
    + 'border:1px solid rgba(148,163,184,.45);border-radius:8px;padding:3px 4px;';

/** Cấu hình TTS hiện tại — đọc thẳng từ state (settings store là nguồn duy nhất). */
function readTtsSettings() {
    let state = null;
    try { state = typeof getState === 'function' ? getState() : null; } catch (_) { state = null; }
    return {
        voice: typeof state?.ttsVoice === 'string' ? state.ttsVoice : '',
        rate: normalizeTtsRate(state?.ttsRate)
    };
}

/**
 * Lắng nghe `voiceschanged`: trình duyệt nạp danh sách giọng máy BẤT ĐỒNG BỘ
 * (lần đầu thường rỗng), nên panel phải được vẽ lại khi danh sách về.
 * Chỉ gắn 1 lần, và chỉ có ý nghĩa khi panel đã mount (refresh no-op nếu chưa).
 */
let _ttsUiListenersAttached = false;
function attachTtsUiListeners() {
    if (_ttsUiListenersAttached || typeof document === 'undefined') return;
    _ttsUiListenersAttached = true;
    try {
        const synth = (typeof window !== 'undefined' && window.speechSynthesis)
            || (typeof globalThis !== 'undefined' && globalThis.speechSynthesis)
            || null;
        if (synth && typeof synth.addEventListener === 'function') {
            synth.addEventListener('voiceschanged', () => refreshTtsSettingsUI());
        }
    } catch (_) {}
}

/** Nạp danh sách giọng máy vào <select> đã tồn tại (không tạo select mới mỗi lần). */
function populateTtsVoiceSelect(select, selected) {
    if (!select || !select.ownerDocument) return;
    const doc = select.ownerDocument;
    const voices = listTtsVoices();
    const desired = [''].concat(voices.map(voice => voice.uri));
    const current = [...select.options].map(option => option.value);
    const unchanged = current.length === desired.length && desired.every((uri, i) => uri === current[i]);
    if (!unchanged) {
        while (select.firstChild) select.removeChild(select.firstChild);
        const auto = doc.createElement('option');
        auto.value = '';
        auto.textContent = 'Giọng máy: tự động';
        select.appendChild(auto);
        for (const voice of voices) {
            const option = doc.createElement('option');
            option.value = voice.uri;
            option.textContent = voice.lang ? `${voice.name} (${voice.lang})` : voice.name;
            select.appendChild(option);
        }
    }
    select.value = desired.includes(selected) ? selected : '';
}

/**
 * Đồng bộ UI với state (mở menu công cụ / voiceschanged / vừa đổi cài đặt).
 * Panel chưa mount ⇒ no-op an toàn (giữ đúng hành vi cũ), KHÔNG throw.
 */
export function refreshTtsSettingsUI() {
    if (typeof document === 'undefined') return;
    if (!document.getElementById(TTS_UI_ID)) return;
    const { voice, rate } = readTtsSettings();
    populateTtsVoiceSelect(document.getElementById('tts-voice-select'), voice);
    const rateSelect = document.getElementById('tts-rate-select');
    if (rateSelect && rateSelect.value !== String(rate)) rateSelect.value = String(rate);
    updateTtsSourceBadge();
}

/**
 * Gắn khối "Giọng đọc" vào panel settings CÓ SẴN (#taskbar-menu → .group-utilities).
 * Chỉ dùng phần tử do JS tạo, không thêm dòng nào vào index.html.
 * Idempotent: gọi lại lần 2 chỉ refresh, không nhân đôi panel.
 */
export function mountTtsSettingsUI() {
    if (typeof document === 'undefined') return null;
    const existing = document.getElementById(TTS_UI_ID);
    if (existing) {
        refreshTtsSettingsUI();
        return existing;
    }
    const host = document.querySelector('#taskbar-menu .header-group.group-utilities')
        || document.getElementById('taskbar-menu');
    if (!host) return null;

    // KHÔNG dùng class .header-group cho khối này: CSS mobile
    // `#taskbar-menu .header-group > *` sẽ ép width/height 100% lên các control con.
    const group = document.createElement('div');
    group.id = TTS_UI_ID;
    group.className = 'tts-settings-group';
    group.title = 'Giọng đọc tiếng Anh + tốc độ (áp dụng cho lần phát âm kế tiếp)';
    group.style.cssText = 'display:flex;flex-direction:row;align-items:center;gap:5px;min-width:0;';

    const voiceSelect = document.createElement('select');
    voiceSelect.id = 'tts-voice-select';
    voiceSelect.setAttribute('aria-label', 'Chọn giọng đọc');
    voiceSelect.title = 'Giọng đọc của máy (dùng khi giọng Cloud không khả dụng)';
    voiceSelect.style.cssText = `${TTS_CONTROL_STYLE}max-width:128px;`;
    voiceSelect.addEventListener('change', () => {
        setTtsVoice(voiceSelect.value).then(() => refreshTtsSettingsUI()).catch(() => {});
    });

    const rateSelect = document.createElement('select');
    rateSelect.id = 'tts-rate-select';
    rateSelect.setAttribute('aria-label', 'Tốc độ đọc');
    rateSelect.title = 'Tốc độ đọc (0.6× – 1.4×)';
    rateSelect.style.cssText = TTS_CONTROL_STYLE;
    for (let step = Math.round(TTS_RATE_MIN * 10); step <= Math.round(TTS_RATE_MAX * 10); step++) {
        const value = step / 10;
        const option = document.createElement('option');
        option.value = String(value);
        option.textContent = `${value.toFixed(1)}×`;
        rateSelect.appendChild(option);
    }
    rateSelect.addEventListener('change', () => {
        setTtsRate(rateSelect.value).then(saved => { refreshTtsSettingsUI(); return saved; }).catch(() => {});
    });

    const badge = document.createElement('span');
    badge.id = 'tts-source-badge';
    badge.className = 'tts-source-badge';
    badge.style.cssText = 'font-size:11px;opacity:.75;white-space:nowrap;';
    badge.textContent = '—';

    group.append(voiceSelect, rateSelect, badge);
    host.appendChild(group);
    attachTtsUiListeners();
    refreshTtsSettingsUI();
    return group;
}
