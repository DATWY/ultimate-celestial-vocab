// src/ui/theme-transition.js — chuyển giao diện Sáng ⇄ Tối.
//
// Bản cũ: hai tấm màn khép/mở (~1,9 s) + huy hiệu ở giữa. Bản này:
//   • ưu tiên View Transitions API: đổi theme trong MỘT khung hình rồi để trình duyệt
//     "mở" giao diện mới bằng đường tròn lan từ đúng nút người dùng bấm (620 ms);
//   • kèm một lớp hạt sáng (sao khi vào tối, tia nắng khi ra sáng) để chuyển cảnh có chất;
//   • trình duyệt không hỗ trợ / người dùng giảm chuyển động / bật Boost Mode ⇒ trả
//     `'instant'` hoặc `'curtain'` để nơi gọi dùng đường cũ (màn khép) hoặc đổi ngay.
//
// Phần THUẦN (toán đường tròn, chọn chiến lược) tách riêng để test Node không cần DOM.

export const VT_DURATION_MS = 900;

/** Nhịp của đường màn khép dự phòng (ms) — ngắn hơn bản cũ 1,9 s. */
export const CURTAIN_TIMING = { cover: 620, dwell: 240, reveal: 540 };

export const VT_CLASS = 'theme-vt-run';
export const VT_CLASS_DARK = 'theme-vt-to-dark';
export const VT_CLASS_LIGHT = 'theme-vt-to-light';
export const BURST_CLASS = 'theme-burst';
/** Lớp tắt transition toàn cục trong lúc đổi theme (màn chuyển cảnh đang phủ). */
export const SWITCHING_CLASS = 'theme-switching';

/**
 * Bán kính cần thiết để đường tròn phủ hết khung nhìn khi tâm đặt tại (cx, cy).
 * Lấy khoảng cách tới góc XA NHẤT, làm tròn LÊN để không hở một dải pixel ở góc.
 */
export function circleRevealRadius(cx, cy, vw, vh) {
    const x = Number(cx) || 0, y = Number(cy) || 0;
    const w = Math.max(0, Number(vw) || 0), h = Math.max(0, Number(vh) || 0);
    const dx = Math.max(x, w - x);
    const dy = Math.max(y, h - y);
    return Math.ceil(Math.hypot(dx, dy));
}

/** Giá trị `clip-path` cho đường tròn lan; dùng cho test và cho CSS fallback. */
export function circleRevealPath(cx, cy, vw, vh) {
    return `circle(${circleRevealRadius(cx, cy, vw, vh)}px at ${Math.round(Number(cx) || 0)}px ${Math.round(Number(cy) || 0)}px)`;
}

/** Tâm nút bấm (toạ độ khung nhìn), kẹp trong khung nhìn; thiếu nút thì giữa màn hình. */
export function originFromElement(el, vw, vh) {
    const w = Number(vw) || 0, h = Number(vh) || 0;
    const rect = el && typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
    if (!rect || (!rect.width && !rect.height)) return { x: w / 2, y: h / 2 };
    const clamp = (v, max) => Math.min(Math.max(0, v), Math.max(0, max));
    return { x: clamp(rect.left + rect.width / 2, w), y: clamp(rect.top + rect.height / 2, h) };
}

/**
 * Chọn cách chuyển:
 *   'instant'        — giảm chuyển động hoặc Boost Mode: đổi ngay, không hoạt ảnh.
 *   'view-transition'— có View Transitions API: đường tròn lan.
 *   'curtain'        — còn lại: màn khép dự phòng.
 */
export function pickThemeTransitionStrategy({ supportsViewTransition, reduceMotion, boostMode } = {}) {
    if (reduceMotion === true || boostMode === true) return 'instant';
    return supportsViewTransition === true ? 'view-transition' : 'curtain';
}

/** Lớp hạt sáng: sao khi vào tối, tia nắng khi ra sáng + đĩa sáng bung ở tâm. */
export function createBurst(doc, x, y, isDark, count = 18) {
    if (!doc || typeof doc.createElement !== 'function' || !doc.body) return null;
    const wrap = doc.createElement('div');
    wrap.className = `${BURST_CLASS} ${isDark ? 'is-to-dark' : 'is-to-light'}`;
    wrap.setAttribute('aria-hidden', 'true');
    wrap.style.setProperty('--x', `${Math.round(x)}px`);
    wrap.style.setProperty('--y', `${Math.round(y)}px`);
    // Đĩa sáng bung ra ở tâm (tạo "độ nặng" cho khoảnh khắc chuyển).
    const orb = doc.createElement('div');
    orb.className = 'theme-burst__orb';
    wrap.appendChild(orb);
    for (let i = 0; i < count; i++) {
        const dot = doc.createElement('span');
        const angle = (Math.PI * 2 * i) / count + (isDark ? 0.2 : -0.2);
        const dist = 70 + ((i * 37) % 120);
        dot.style.setProperty('--dx', `${Math.round(Math.cos(angle) * dist)}px`);
        dot.style.setProperty('--dy', `${Math.round(Math.sin(angle) * dist)}px`);
        dot.style.setProperty('--d', `${(i % 7) * 24}ms`);
        // Mỗi 5 hạt là một "vệt sao" dài hơn để có nhịp điệu.
        if (i % 5 === 0) dot.className = 'is-streak';
        wrap.appendChild(dot);
    }
    doc.body.appendChild(wrap);
    return wrap;
}

/**
 * Chạy chuyển cảnh bằng View Transitions.
 * `apply` PHẢI chạy đúng một lần (đổi theme + tracking); `onSwap` chạy cùng lúc để phát âm.
 * Trả về 'view-transition' | 'instant' để test/telemetry biết đường đã dùng.
 */
export async function runThemeTransition({
    isDark, apply, origin, onSwap, onDone,
    doc = typeof document !== 'undefined' ? document : null,
    win = typeof window !== 'undefined' ? window : null
} = {}) {
    const vw = win?.innerWidth || 0, vh = win?.innerHeight || 0;
    const x = Number.isFinite(origin?.x) ? origin.x : vw / 2;
    const y = Number.isFinite(origin?.y) ? origin.y : vh / 2;
    let applied = false;
    const runApply = () => {
        if (applied) return;
        applied = true;
        try { apply?.(); } finally { onSwap?.(); }
    };

    const root = doc?.documentElement;
    const canVT = !!root && typeof doc?.startViewTransition === 'function';
    if (!canVT) { runApply(); onDone?.(); return 'instant'; }

    const burst = createBurst(doc, x, y, isDark);
    root.style.setProperty('--theme-vt-x', `${Math.round(x)}px`);
    root.style.setProperty('--theme-vt-y', `${Math.round(y)}px`);
    root.style.setProperty('--theme-vt-r', `${circleRevealRadius(x, y, vw, vh)}px`);
    root.classList.add(VT_CLASS, isDark ? VT_CLASS_DARK : VT_CLASS_LIGHT);
    // Trong lúc đổi theme, tắt transition của MỌI phần tử: hàng trăm phần tử đổi màu cùng lúc
    // sẽ tạo ra một đợt transition khổng lồ (đo được 75 lần recalc cho 6 lần đổi theme).
    // Màn chuyển cảnh đang phủ nên người dùng không thấy khác biệt.
    root.classList.add(SWITCHING_CLASS);

    let cleaned = false;
    const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        root.classList.remove(VT_CLASS, VT_CLASS_DARK, VT_CLASS_LIGHT, SWITCHING_CLASS);
        root.style.removeProperty('--theme-vt-x');
        root.style.removeProperty('--theme-vt-y');
        root.style.removeProperty('--theme-vt-r');
        if (burst && burst.parentNode) burst.parentNode.removeChild(burst);
        onDone?.();
    };

    let transition;
    try {
        transition = doc.startViewTransition(runApply);
    } catch (_) {
        // Trình duyệt từ chối (đang có transition khác, snapshot lỗi…): vẫn đổi theme.
        runApply();
        cleanup();
        return 'instant';
    }

    // Lưới an toàn: nếu 'finished' không bao giờ resolve (tab bị ẩn giữa chừng), vẫn dọn.
    const guard = win?.setTimeout ? win.setTimeout(cleanup, VT_DURATION_MS + 1200) : null;
    try { await transition.finished; } catch (_) { /* đã đổi theme rồi */ }
    if (guard && win?.clearTimeout) win.clearTimeout(guard);
    cleanup();
    return 'view-transition';
}
