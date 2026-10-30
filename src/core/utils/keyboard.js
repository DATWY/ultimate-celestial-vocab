// src/core/utils/keyboard.js
//
// Quyết định phím tắt toàn cục ở dạng hàm thuần để test được (events.js là module
// lớn, import vào test sẽ kéo theo DOM). Các hàm dưới đây không đọc trạng thái
// toàn cục nào — người gọi truyền vào đủ dữ kiện.

/** Thẻ mà gõ phím phải giữ nguyên hành vi gốc của trình duyệt (undo trong ô nhập). */
export const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function isEditableTarget(target) {
    if (!target || typeof target !== 'object') return false;
    if (EDITABLE_TAGS.has(String(target.tagName || '').toUpperCase())) return true;
    return target.isContentEditable === true;
}

/**
 * UI-02: Ctrl/Cmd+Z có được app xử lý (hoàn tác lượt đánh giá) hay để trình duyệt?
 *
 * Trước đây điều kiện là `!isTyping && !isModalOpen`, nên mở Celestial Hub là mất
 * luôn phím hoàn tác — trong khi nút Undo lại nằm trong Hub. Giờ chỉ cần con trỏ
 * không ở trong ô nhập; modal mở vẫn hoàn tác được, còn đang gõ chữ thì nhường
 * cho trình duyệt.
 */
export function shouldHandleUndoShortcut({ editable = false, isTyping = false } = {}) {
    return !editable && !isTyping;
}

/**
 * UI-03: lệnh gõ phải có tiền tố '/' .
 *
 * Bản cũ nhận cả chuỗi trần "boost", nên gõ đúng 5 chữ đó vừa bật/tắt Boost (B)
 * vừa bật/tắt Sao (S) ở từng ký tự rồi mới khớp lệnh — người dùng mất dấu sao oan.
 */
export const BOOST_COMMAND = '/boost';

export function matchBoostCommand(buffer) {
    return typeof buffer === 'string' && buffer.toLowerCase().endsWith(BOOST_COMMAND);
}
