// tests/p1-dedup-fields.test.mjs — DEDUP-01.
//
// Gộp trùng là thao tác XOÁ VĨNH VIỄN thẻ phụ. Bản cũ chỉ chuyển 5 trường
// (nghĩa, ví dụ, phiên âm, tags, sao) rồi `{...primary}`; trường nào chỉ thẻ phụ
// có (notes / synonyms / antonyms / collocations / exampleMeaning / exampleVi /
// audio) là mất sạch. Tương tự, nhập lại một từ đã có không gộp nghĩa tiếng Việt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeDuplicateCards } from '../src/core/dedup.js';
import { planVocabularyImport } from '../src/core/import-plan.js';

const card = (over = {}) => ({
    id: 'a',
    english: 'abandon',
    vietnamese: 'từ bỏ',
    example: '',
    pronunciation: '',
    tags: [],
    srsStatus: 'Mastered',
    stability: 10,
    reps: 5,
    lapses: 0,
    updatedAt: 1000,
    contentUpdatedAt: 1000,
    srsUpdatedAt: 1000,
    flagsUpdatedAt: 1000,
    ...over
});

test('gộp thẻ giữ mọi trường phụ mà chỉ thẻ bị xoá có', () => {
    const primary = card({ id: 'a' });
    const secondary = card({
        id: 'b',
        stability: 1,
        reps: 1,
        notes: 'ghi chú riêng',
        synonyms: 'give up',
        antonyms: 'keep',
        collocations: 'abandon hope',
        exampleMeaning: 'Tôi từ bỏ nó',
        exampleVi: 'Anh ta bỏ cuộc',
        audio: 'https://cdn/abandon.mp3'
    });

    const { mergedCard, deletedCardId } = mergeDuplicateCards(primary, secondary);
    assert.equal(deletedCardId, 'b', 'thẻ phụ (học ít hơn) là thẻ bị xoá');
    for (const [field, expected] of Object.entries({
        notes: 'ghi chú riêng',
        synonyms: 'give up',
        antonyms: 'keep',
        collocations: 'abandon hope',
        exampleMeaning: 'Tôi từ bỏ nó',
        exampleVi: 'Anh ta bỏ cuộc',
        audio: 'https://cdn/abandon.mp3'
    })) {
        assert.equal(mergedCard[field], expected, `mất trường "${field}" của thẻ bị xoá`);
    }
});

test('gộp thẻ KHÔNG ghi đè trường mà thẻ chính đã có', () => {
    const primary = card({ id: 'a', notes: 'của chính', synonyms: 'own' });
    const secondary = card({ id: 'b', stability: 1, reps: 1, notes: 'của phụ', synonyms: 'other', antonyms: 'x' });
    const { mergedCard } = mergeDuplicateCards(primary, secondary);
    assert.equal(mergedCard.notes, 'của chính');
    assert.equal(mergedCard.synonyms, 'own');
    assert.equal(mergedCard.antonyms, 'x', 'trường trống ở thẻ chính vẫn được bù');
});

test('gộp thẻ coi chuỗi rỗng và mảng rỗng là "chưa có"', () => {
    const primary = card({ id: 'a', notes: '   ', synonyms: [], collocations: '' });
    const secondary = card({ id: 'b', stability: 1, reps: 1, notes: 'bù vào', synonyms: ['x'], collocations: 'y' });
    const { mergedCard } = mergeDuplicateCards(primary, secondary);
    assert.equal(mergedCard.notes, 'bù vào');
    assert.deepEqual(mergedCard.synonyms, ['x']);
    assert.equal(mergedCard.collocations, 'y');
});

test('nhập lại từ đã có thì GỘP nghĩa tiếng Việt thay vì bỏ qua', () => {
    const vocabulary = [card({ id: 'a', english: 'abandon', vietnamese: 'từ bỏ' })];
    // Định dạng TSV của app: english \t vietnamese \t type \t pronunciation \t example
    const tsv = 'abandon\ttừ bỏ; bỏ rơi\tnoun\t\t';
    const plan = planVocabularyImport(tsv, vocabulary, () => 'new-id', 5000);
    const updated = plan.updateItems.find(c => c.id === 'a');
    assert.ok(updated, 'phải sinh một bản cập nhật cho thẻ đã có');
    assert.match(updated.vietnamese, /bỏ rơi/i, 'nghĩa mới phải được thêm vào');
    assert.match(updated.vietnamese, /từ bỏ/i, 'nghĩa cũ phải được giữ');
    assert.equal(plan.newItems.length, 0, 'không được tạo thẻ trùng');
});

test('nhập lại từ với nghĩa y hệt thì vẫn bỏ qua (không tạo cập nhật rỗng)', () => {
    const vocabulary = [card({ id: 'a', english: 'abandon', vietnamese: 'từ bỏ' })];
    const plan = planVocabularyImport('abandon\ttừ bỏ\tnoun\t\t', vocabulary, () => 'x', 5000);
    assert.equal(plan.updateItems.length, 0);
    assert.equal(plan.skipped, 1);
});
