// src/core/state/ui-notify.js — T4.5b: cầu nối LƯỜI sang tầng UI.
//
// Mọi thứ ở đây đều nạp module UI bằng dynamic import để UI không quay vào
// critical path của entry chunk. Trước đây các hàm này nằm rải trong state.js
// và có 2 cặp wrapper trùng nghĩa (`updateStats`→`safeUpdateStats`,
// `showToast`→`safeShowToast`, `showPopup`→`safeShowPopup`); nay chỉ giữ bản
// "safe" duy nhất, nơi gọi dùng thẳng tên đó (hành vi y nguyên).
//
// Tách ra vì cả state.js (lưu từ vựng) lẫn state/gamification.js (XP, huy hiệu,
// revert undo) đều cần — để trong state.js thì gamification.js phải import
// ngược lên state.js và tạo vòng import.

let _renderModulePromise = null;
function getRenderModule() {
    if (!_renderModulePromise) _renderModulePromise = import('../../ui/render.js');
    return _renderModulePromise;
}

// Gộp nhiều lần gọi stats trong cùng một frame thành 1 lần render.
let _statsFrameHandle = 0;
export function safeUpdateStats() {
    if (typeof window === 'undefined' || _statsFrameHandle) return;
    const run = () => {
        _statsFrameHandle = 0;
        getRenderModule().then(m => m.updateStats?.()).catch(() => {});
    };
    if (typeof requestAnimationFrame === 'function') {
        _statsFrameHandle = requestAnimationFrame(run);
    } else {
        _statsFrameHandle = setTimeout(run, 0);
    }
}

/** Gọi 1 hàm của ui/modal.js ở nhịp sau (module UI nạp lười, có thể không có). */
function callModalLater(method, args) {
    if (typeof window === 'undefined') return;
    import('../../ui/modal.js').then(m => m[method]?.(...args)).catch(() => {});
}

export function safeShowPopup(message, type = 'info') {
    callModalLater('showPopup', [message, type]);
}

export function safeShowToast(title, message = '', icon = 'ph-trophy') {
    callModalLater('showToast', [title, message, icon]);
}
