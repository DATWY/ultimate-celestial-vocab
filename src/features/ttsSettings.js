// --- T2.5 / UI-FIX: MODAL CÀI ĐẶT TTS (nguồn giọng / giọng máy / tốc độ) ---
//
// Vì sao file này tồn tại: toàn bộ DOM của modal (3 <select>, badge nguồn giọng,
// nút "Nghe thử", populate option) chỉ cần khi người dùng mở cài đặt, không cần
// cho first paint. Trước đây khối này nằm thẳng trong src/core/sound.js nên bị
// tính vào entry bundle (ngân sách CI 82 kB gzip trong tools/bundle_budget.mjs).
// Tách ra đây ⇒ entry nhẹ đi, modal thành chunk riêng `ttsSettings-*.js`.
// KHÔNG nới ngưỡng ngân sách.
//
// UI-FIX (phản hồi người dùng): bản cũ chèn 2 <select> trần vào thanh công cụ
// trên header — dropdown trắng của trình duyệt đè lên thẻ học. Nay header chỉ
// còn 1 nút icon `#tts-settings-btn`; mọi control nằm trong modal
// `#tts-settings-modal` (append vào body) dùng đúng bộ class .modal có sẵn.
//
// Quan hệ import (một chiều, KHÔNG có vòng tĩnh):
//   sound.js --dynamic import--> ttsSettings.js --static--> state.js, sound.js, ui/modal.js
//   ui/modal.js --dynamic import--> ... (không import ngược ttsSettings.js)
// Chunk này chỉ được nạp SAU khi entry đã chạy xong, nên các binding import từ
// sound.js/state.js chắc chắn đã khởi tạo.
import { getState, normalizeTtsRate, normalizeTtsSource, setTtsVoice, setTtsRate, setTtsSource, TTS_RATE_MIN, TTS_RATE_MAX } from '../core/state.js';
// listTtsVoices: danh sách giọng máy (đọc speechSynthesis.getVoices).
// speakText: phát thử đúng đường phát thật (tôn trọng nguồn/giọng/tốc độ).
// updateTtsSourceBadge: badge "Cloud / Giọng máy" — dùng chung logic với entry.
import { listTtsVoices, speakText, updateTtsSourceBadge } from '../core/sound.js';
// Dùng lại cơ chế modal có sẵn: khoá cuộn nền (body.modal-active), Esc/Tab,
// trả focus về nút mở (modalOpeners) — không tự viết lại.
import { openModal, closeModal } from '../ui/modal.js';

const TTS_MODAL_ID = 'tts-settings-modal';
/** Từ cố định cho nút "Nghe thử" (đủ dài để nghe rõ giọng + tốc độ). */
const TTS_TEST_WORD = 'Skeptical';

/**
 * Cấu hình TTS hiện tại — đọc thẳng từ state (settings store là nguồn duy nhất).
 * `source`: 'cloud' (proxy Google TTS) | 'device' (Web Speech của máy).
 */
function readTtsSettings() {
    let state = null;
    try { state = typeof getState === 'function' ? getState() : null; } catch (_) { state = null; }
    return {
        voice: typeof state?.ttsVoice === 'string' ? state.ttsVoice : '',
        rate: normalizeTtsRate(state?.ttsRate),
        source: normalizeTtsSource(state?.ttsSource)
    };
}

/**
 * Helper tạo phần tử: gán thuộc tính/property đúng cách để chạy được cả DOM
 * thật lẫn stub tối thiểu trong test (không dùng innerHTML).
 */
function makeNode(doc, tag, props = {}, children = []) {
    const node = doc.createElement(tag);
    if (!node) return null;
    for (const [key, value] of Object.entries(props)) {
        if (key === 'text') node.textContent = value;
        else if (key === 'id') node.id = value;
        else if (key === 'className') node.className = value;
        else if (key === 'title') node.title = value;
        else if (key === 'value') node.value = value;
        else if (key === 'type') node.type = value;
        else if (key === 'disabled') node.disabled = value;
        else node.setAttribute(key, value);
    }
    for (const child of children) if (child) node.appendChild(child);
    return node;
}

/**
 * Lắng nghe `voiceschanged`: trình duyệt nạp danh sách giọng máy BẤT ĐỒNG BỘ
 * (lần đầu thường rỗng), nên modal phải được vẽ lại khi danh sách về.
 * Chỉ gắn 1 lần, và chỉ có ý nghĩa khi modal đã mount (refresh no-op nếu chưa).
 */
let _ttsUiListenersAttached = false;
function attachTtsUiListeners() {
    if (_ttsUiListenersAttached || typeof document === 'undefined') return;
    _ttsUiListenersAttached = true;
    try {
        const synth = (typeof window !== 'undefined' && window.speechSynthesis)
            || (typeof globalThis !== 'undefined' && globalThis.speechSynthesis)
            || null;
        if (synth) {
            const onVoices = () => refreshTtsSettingsUI();
            if (typeof synth.addEventListener === 'function') {
                synth.addEventListener('voiceschanged', onVoices);
            } else {
                synth.onvoiceschanged = onVoices;
            }
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

/** Dựng modal một lần duy nhất, append vào <body>; gọi lại chỉ trả phần tử cũ. */
function ensureTtsSettingsModal() {
    if (typeof document === 'undefined' || !document.body) return null;
    const existing = document.getElementById(TTS_MODAL_ID);
    if (existing) return existing;
    const doc = document;

    const modal = makeNode(doc, 'div', { id: TTS_MODAL_ID, className: 'modal hidden' });
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'tts-settings-title');
    modal.setAttribute('aria-hidden', 'true');

    const overlay = makeNode(doc, 'div', { className: 'modal-overlay', tabindex: '-1' });
    const content = makeNode(doc, 'div', { className: 'modal-content tts-settings-content' });

    const closeBtn = makeNode(doc, 'button', {
        id: 'close-tts-settings-modal-btn',
        className: 'modal-close-btn',
        type: 'button',
        title: 'Đóng (Esc)',
        'aria-label': 'Đóng cài đặt giọng đọc'
    }, [makeNode(doc, 'i', { className: 'ph-bold ph-x' })]);

    const head = makeNode(doc, 'div', { className: 'tts-settings-head' }, [
        makeNode(doc, 'span', { className: 'tts-settings-head-icon', 'aria-hidden': 'true' }, [
            makeNode(doc, 'i', { className: 'ph-duotone ph-sliders-horizontal' })
        ]),
        makeNode(doc, 'div', { className: 'tts-settings-head-text' }, [
            makeNode(doc, 'h3', { id: 'tts-settings-title', text: 'Giọng đọc & tốc độ' }),
            makeNode(doc, 'p', {
                text: 'Áp dụng cho lần phát âm kế tiếp. Chọn nguồn giọng để quyết định máy đọc bằng Cloud hay bằng giọng cài sẵn trên thiết bị.'
            })
        ])
    ]);

    const sourceSelect = makeNode(doc, 'select', {
        id: 'tts-source-select',
        'aria-label': 'Nguồn giọng đọc'
    }, [
        makeNode(doc, 'option', { value: 'cloud', text: 'Cloud (tự nhiên, cần mạng)' }),
        makeNode(doc, 'option', { value: 'device', text: 'Giọng máy của thiết bị (offline)' })
    ]);

    const voiceSelect = makeNode(doc, 'select', {
        id: 'tts-voice-select',
        'aria-label': 'Chọn giọng máy'
    });
    const voiceHint = makeNode(doc, 'p', {
        id: 'tts-voice-hint',
        className: 'tts-settings-hint'
    });

    const rateSelect = makeNode(doc, 'select', {
        id: 'tts-rate-select',
        'aria-label': 'Tốc độ đọc'
    });
    for (let step = Math.round(TTS_RATE_MIN * 10); step <= Math.round(TTS_RATE_MAX * 10); step++) {
        const value = step / 10;
        rateSelect.appendChild(makeNode(doc, 'option', { value: String(value), text: `${value.toFixed(1)}×` }));
    }

    const testBtn = makeNode(doc, 'button', {
        id: 'tts-test-btn',
        className: 'primary-btn',
        type: 'button',
        title: `Phát thử từ “${TTS_TEST_WORD}” theo cài đặt hiện tại`
    }, [
        makeNode(doc, 'i', { className: 'ph-duotone ph-play' }),
        makeNode(doc, 'span', { text: 'Nghe thử' })
    ]);

    const badge = makeNode(doc, 'span', {
        id: 'tts-source-badge',
        className: 'tts-source-badge',
        text: '—'
    });
    const badgeRow = makeNode(doc, 'div', { className: 'tts-settings-badge-row' }, [
        makeNode(doc, 'span', { className: 'tts-settings-badge-label', text: 'Lần phát gần nhất:' }),
        badge
    ]);

    const actions = makeNode(doc, 'div', { className: 'tts-settings-actions' }, [testBtn, badgeRow]);

    content.appendChild(closeBtn);
    content.appendChild(head);
    content.appendChild(makeNode(doc, 'div', { className: 'tts-settings-field' }, [
        makeNode(doc, 'label', { for: 'tts-source-select', text: 'Nguồn giọng' }),
        sourceSelect
    ]));
    content.appendChild(makeNode(doc, 'div', { className: 'tts-settings-field' }, [
        makeNode(doc, 'label', { for: 'tts-voice-select', text: 'Giọng máy' }),
        voiceSelect,
        voiceHint
    ]));
    content.appendChild(makeNode(doc, 'div', { className: 'tts-settings-field' }, [
        makeNode(doc, 'label', { for: 'tts-rate-select', text: 'Tốc độ' }),
        rateSelect
    ]));
    content.appendChild(actions);

    modal.appendChild(overlay);
    modal.appendChild(content);
    doc.body.appendChild(modal);

    sourceSelect.addEventListener('change', () => {
        setTtsSource(sourceSelect.value).then(() => refreshTtsSettingsUI()).catch(() => {});
    });
    voiceSelect.addEventListener('change', () => {
        setTtsVoice(voiceSelect.value).then(() => refreshTtsSettingsUI()).catch(() => {});
    });
    rateSelect.addEventListener('change', () => {
        setTtsRate(rateSelect.value).then(saved => { refreshTtsSettingsUI(); return saved; }).catch(() => {});
    });
    testBtn.addEventListener('click', () => { void speakText(TTS_TEST_WORD); });
    closeBtn.addEventListener('click', () => { void closeTtsSettingsModal(); });
    // Click vùng tối (overlay) đóng modal — giống các modal khác trong app.
    overlay.addEventListener('click', () => { void closeTtsSettingsModal(); });

    // Esc do modal.js đóng thẳng (không qua closeTtsSettingsModal) ⇒ đồng bộ
    // aria-hidden theo class .hidden để trạng thái trợ năng luôn đúng.
    if (typeof MutationObserver === 'function') {
        try {
            const observer = new MutationObserver(() => {
                if (modal.classList.contains('hidden')) {
                    if (modal.getAttribute('aria-hidden') !== 'true') modal.setAttribute('aria-hidden', 'true');
                } else if (modal.getAttribute('aria-hidden') !== null) {
                    modal.removeAttribute('aria-hidden');
                }
            });
            observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
        } catch (_) {}
    }

    return modal;
}

/**
 * Đồng bộ UI với state (voiceschanged / vừa đổi cài đặt / vừa mở modal).
 * Modal chưa mount ⇒ no-op an toàn (giữ đúng hành vi cũ), KHÔNG throw.
 */
export function refreshTtsSettingsUI() {
    if (typeof document === 'undefined') return;
    if (!document.getElementById(TTS_MODAL_ID)) return;
    const { voice, rate, source } = readTtsSettings();
    const isDevice = source === 'device';

    const sourceSelect = document.getElementById('tts-source-select');
    if (sourceSelect && sourceSelect.value !== source) sourceSelect.value = source;

    const voiceSelect = document.getElementById('tts-voice-select');
    populateTtsVoiceSelect(voiceSelect, voice);
    if (voiceSelect) {
        // Nguồn Cloud ⇒ giọng máy không được dùng, vô hiệu hoá để không gây hiểu
        // nhầm "chọn giọng mà không nghe thấy gì" (đúng lỗi người dùng báo).
        voiceSelect.disabled = !isDevice;
        voiceSelect.title = isDevice
            ? 'Giọng máy dùng khi phát bằng thiết bị'
            : 'Đang dùng giọng Cloud — đổi nguồn sang “Giọng máy” để chọn giọng';
    }

    const rateSelect = document.getElementById('tts-rate-select');
    if (rateSelect && rateSelect.value !== String(rate)) rateSelect.value = String(rate);

    const hint = document.getElementById('tts-voice-hint');
    if (hint) {
        hint.textContent = isDevice
            ? 'Đang dùng giọng máy của thiết bị. Danh sách trên là các giọng trình duyệt tìm thấy.'
            : 'Đang dùng giọng Cloud. Chọn “Giọng máy” để đổi.';
    }

    updateTtsSourceBadge();
}

/**
 * Mount modal (idempotent): dựng DOM lần đầu + refresh. Trả về modal.
 * Tên hàm giữ nguyên để cầu nối trong sound.js/test cũ không phải đổi.
 */
export function mountTtsSettingsUI() {
    if (typeof document === 'undefined') return null;
    const modal = ensureTtsSettingsModal();
    if (!modal) return null;
    attachTtsUiListeners();
    refreshTtsSettingsUI();
    return modal;
}

/**
 * Mở modal: refresh dữ liệu mới nhất rồi dùng openModal() của app
 * (body.modal-active khoá cuộn nền, Esc/Tab, trả focus về nút mở).
 */
export function openTtsSettingsModal() {
    const modal = ensureTtsSettingsModal();
    if (!modal) return null;
    refreshTtsSettingsUI();
    if (typeof modal.removeAttribute === 'function') modal.removeAttribute('aria-hidden');
    try {
        openModal(modal);
    } catch (_) {
        // Môi trường không có đủ API modal (test DOM tối thiểu): vẫn mở được.
        modal.classList.remove('hidden');
    }
    return modal;
}

/** Đóng modal + aria-hidden đúng trạng thái (Esc/overlay/nút X đều đi qua đây). */
export async function closeTtsSettingsModal() {
    if (typeof document === 'undefined') return;
    const modal = document.getElementById(TTS_MODAL_ID);
    if (!modal) return;
    try {
        await closeModal(modal);
    } catch (_) {
        modal.classList.add('hidden');
    }
    modal.setAttribute('aria-hidden', 'true');
}
