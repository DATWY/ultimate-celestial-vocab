// src/core/state/preview-mode.js — T4.5b: cờ "chế độ xem trước" + cổng chặn ghi bền vững.
//
// Tách khỏi state.js vì đây là state LÁ: nó chỉ phụ thuộc `isIsolatedStorage`
// của idb.js và sessionStorage, không phụ thuộc vocabulary/gamification/reviewLogs.
// Nhờ vậy cả tts-settings.js lẫn state.js dùng chung được `skipPersistence()`
// mà không tạo vòng import (state → preview-mode, tts → preview-mode).
//
// Chỉ đọc sessionStorage — KHÔNG thêm key mới, không đổi khoá đang dùng.
import { isIsolatedStorage } from '../idb.js';

let _isPreviewMode = false;

export function setPreviewMode(val) { _isPreviewMode = val; }
export function isPreviewMode() { return _isPreviewMode; }

export function skipPersistence() {
    // sessionStorage có thể không tồn tại (SSR, môi trường test thuần Node,
    // hoặc trình duyệt chặn WebStorage) — truy cập trực tiếp sẽ ném ReferenceError.
    let cheatMode = false;
    try {
        if (typeof sessionStorage !== 'undefined') cheatMode = sessionStorage.getItem('CHEAT_MODE') === 'true';
    } catch (_) {} // đọc lỗi ⇒ giữ nguyên false
    return _isPreviewMode || (cheatMode && !isIsolatedStorage);
}
