// src/core/state/typing-filter.js — T4.5b: vị từ THUẦN về thẻ cho "bộ lọc gõ phím".
//
// Trước đây điều kiện "thẻ khó" và "từ dài" bị chép nguyên xi ở HAI nơi trong
// state.js (shouldCardUseTyping + getTypingFilterStats) nên mỗi lần đổi ngưỡng
// phải sửa 2 chỗ. Gom về đây thành vị từ thuần, không đọc state, không side-effect.
//
// Ngưỡng giữ NGUYÊN như cũ — đây là hành vi đã khoá bằng test, không phải chỗ
// để "cải thiện" thuật toán.

/** Thẻ leech: đã quên nhiều / khó cao / đang Learning mà reps cao / ease thấp. */
export function isCardLeech(card) {
    if (!card) return false;
    return (card.lapses !== undefined && card.lapses >= 2) ||
           (card.difficulty !== undefined && card.difficulty >= 7.5) ||
           (card.srsStatus === 'Learning' && (card.reps || 0) >= 3) ||
           (card.srsEaseFactor !== undefined && card.srsEaseFactor <= 2.1);
}

/** Thẻ "khó" theo bộ lọc gõ phím (ngưỡng 6.5 / 2.3 — khác ngưỡng leech 7.5 / 2.1). */
export function isHardCard(card) {
    if (!card) return false;
    return (card.difficulty !== undefined && card.difficulty >= 6.5) ||
           (card.srsEaseFactor !== undefined && card.srsEaseFactor <= 2.3) ||
           isCardLeech(card);
}

export function isLearningCard(card) {
    if (!card) return false;
    return card.srsStatus === 'New' || card.srsStatus === 'Learning';
}

/** "Từ dài" = >= 8 ký tự chữ cái (bỏ dấu cách/gạch nối/số). */
export function isLongWord(card) {
    return (card.english || '').replace(/[^a-zA-Z]/g, '').length >= 8;
}

/**
 * Quyết định thuần cho một bộ lọc cụ thể.
 * Lưu ý: KHÔNG kiểm tra `off` — nơi gọi phải tự chặn 'off' trước, đúng như
 * shouldCardUseTyping() vẫn làm (nhánh default của switch cũ trả true).
 */
export function matchesTypingFilter(card, filter) {
    switch (filter) {
        case 'leech':
            return isCardLeech(card);
        case 'hard':
            return isHardCard(card);
        case 'learning':
            return isLearningCard(card);
        case 'starred':
            return !!card.isStarred;
        case 'long':
            return isLongWord(card);
        default: // 'all' + mọi giá trị lạ
            return true;
    }
}
