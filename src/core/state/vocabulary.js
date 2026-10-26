// src/core/state/vocabulary.js — T4.5b: kho từ vựng + chỉ mục id → index.
//
// `vocabulary` là live binding (export let) nên nơi khác đọc thẳng được
// `vocabulary[i]` / `vocabulary.length` mà KHÔNG tốn thêm byte gọi getter khi
// Rollup gộp chunk — quan trọng vì entry đang sát ngân sách 82 kB gzip.
// Chỉ hàm GÁN LẠI mảng mới phải đi qua setVocabulary()/resetVocabulary()
// (ESM không cho importer gán vào binding của module khác).
//
// Chỉ mục `_vocabIndex` (id → index) là nội bộ: giữ đúng như bản cũ để
// getVocabById/getVocabIndexById/updateCardInVocabulary chạy O(1).

export let vocabulary = [];
const _vocabIndex = new Map(); // id → index trong vocabulary

export function rebuildVocabIndex() {
    _vocabIndex.clear();
    for (let i = 0; i < vocabulary.length; i++) {
        if (vocabulary[i] && vocabulary[i].id) {
            _vocabIndex.set(vocabulary[i].id, i);
        }
    }
}

export function setVocabulary(newVocab) {
    vocabulary = newVocab;
    rebuildVocabIndex();
}

/**
 * Xoá kho từ trong bộ nhớ nhưng CHƯA dựng lại chỉ mục — đúng như loadVocabulary()
 * bản cũ (mảng được thay ngay, chỉ mục chỉ dựng lại ở cuối hàm sau khi nạp xong).
 */
export function resetVocabulary() {
    vocabulary = [];
}

export function getVocabById(id) {
    const idx = _vocabIndex.get(id);
    return idx !== undefined ? vocabulary[idx] : undefined;
}

export function getVocabIndexById(id) {
    return _vocabIndex.has(id) ? _vocabIndex.get(id) : -1;
}

/**
 * Update 1 card trong vocabulary tại chỗ theo ID.
 * Trả về true nếu tìm thấy và cập nhật, false nếu không.
 */
export function updateCardInVocabulary(cardId, updatedCard) {
    const idx = _vocabIndex.get(cardId);
    if (idx !== undefined) {
        vocabulary[idx] = updatedCard;
        return true;
    }
    return false;
}

/**
 * Thêm card mới vào vocabulary (dùng cho sync pull).
 * Tự động cập nhật index map.
 */
export function pushCardToVocabulary(card) {
    const newIndex = vocabulary.length;
    vocabulary.push(card);
    if (card && card.id) _vocabIndex.set(card.id, newIndex);
    return newIndex;
}
