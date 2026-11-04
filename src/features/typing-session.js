// src/features/typing-session.js
//
// Chọn thẻ cho "phiên luyện gõ riêng" theo bộ lọc. Tách khỏi listener để kiểm thử được: đây
// chính là chỗ bản trước chỉ lọc `isDeleted`, nên phiên luyện gõ vẫn mở thẻ đang "Tạm ẩn" và
// ghi SRS cho nó (AUDIT-R2.4).
//
// Điều kiện hợp lệ dùng CHUNG với Flashcard (`isCardReviewable`), không tự định nghĩa lại.

import { isCardReviewable } from '../core/review-policy.js';

/** Thẻ có khớp bộ lọc typing đang chọn hay không (không xét tính hợp lệ). */
export function matchesTypingFilter(card, activeFilter, isLeech) {
    if (!card) return false;
    if (activeFilter === 'leech') return isLeech(card);
    if (activeFilter === 'hard') return (card.difficulty !== undefined && card.difficulty >= 6.5) || isLeech(card);
    if (activeFilter === 'learning') return card.srsStatus === 'New' || card.srsStatus === 'Learning';
    if (activeFilter === 'starred') return !!card.isStarred;
    if (activeFilter === 'long') return (card.english || '').replace(/[^a-zA-Z]/g, '').length >= 8;
    return true;
}

/**
 * Danh sách CHỈ SỐ thẻ đủ điều kiện cho phiên luyện gõ.
 * Thẻ bị xoá hoặc tạm ẩn bị loại ngay từ đây (và vẫn bị chặn lại ở cửa chấm).
 */
export function buildTypingPool(vocabulary, activeFilter, isLeech) {
    const pool = [];
    if (!Array.isArray(vocabulary)) return pool;
    for (let i = 0; i < vocabulary.length; i++) {
        const card = vocabulary[i];
        if (!isCardReviewable(card)) continue;
        if (matchesTypingFilter(card, activeFilter, isLeech)) pool.push(i);
    }
    return pool;
}
