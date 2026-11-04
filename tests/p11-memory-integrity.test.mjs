// tests/p11-memory-integrity.test.mjs
//
// Regression cho hai lỗi bảo toàn dữ liệu đã kiểm chứng trong
// reports/logic-audit-2026-11-03/{REVIEW,REVIEW-VERIFIED}.vi.md:
//
//  (1) Gộp trùng (dedup) tạo trạng thái bộ nhớ MỚI nhưng không cấp revision mới, nên khi lưu
//      vào IndexedDB, mergeCardFields rơi vào tie-break so chuỗi JSON và có thể ghi đè mất kết
//      quả gộp (lapses 9 + 1 = 10 thua "9"). Test đi qua ĐƯỜNG LƯU/ĐỌC THẬT (fake-indexeddb).
//  (2) lapseDay / lapsesToday / buriedOn / needsReformulation thuộc domain bộ nhớ nhưng thiếu
//      trong MEMORY ⇒ Undo không phục hồi, và một bản chỉ sửa nội dung mới hơn lại mang bộ đếm
//      cũ đi đè trạng thái SRS mới.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initAppDB, saveWordToDB, getAllVocabularyFromDB, clearVocabularyDB } from '../src/core/idb.js';
import { mergeDuplicateCards } from '../src/core/dedup.js';
import { mergeCardFields, restoreCardReview, normalizeCard } from '../src/core/card-merge.js';
import { calculateNextSrsState } from '../src/core/srs/index.js';

const NOW = new Date(2026, 10, 3, 15, 0).getTime();
const DAY = 86400000;
const TODAY = new Date(NOW).toDateString();

const card = (over = {}) => normalizeCard({
    id: 'c1', english: 'obfuscate', vietnamese: 'làm khó hiểu', type: 'verb',
    srsStatus: 'Mastered', stability: 20, stabilityShort: 16, difficulty: 6,
    reps: 10, lapses: 0, srsInterval: 10, srsDueDate: NOW, lastReviewDate: NOW - DAY,
    updatedAt: NOW - 5000, contentUpdatedAt: NOW - 5000, srsUpdatedAt: NOW - 5000,
    flagsUpdatedAt: NOW - 5000, tags: [], ...over
});

await initAppDB();
await clearVocabularyDB();

// ─────────────────────── (1) Kết quả gộp phải sống sót khi lưu ───────────────────────
test('dedup: kết quả gộp sống sót qua saveWordToDB + đọc lại, không phụ thuộc tie-break chuỗi', async () => {
    // Các cặp từng rơi vào bẫy so chuỗi: '10' < '9', '18' < '9', '100' < '99'.
    const pairs = [[9, 1, 10], [8, 2, 10], [9, 9, 18], [99, 1, 100], [6, 2, 8], [1, 1, 2]];
    for (const [a, b, expected] of pairs) {
        await clearVocabularyDB();
        const primary = card({ id: `p-${a}-${b}`, lapses: a, stability: 30, srsUpdatedAt: NOW - 1000 });
        const secondary = card({ id: `s-${a}-${b}`, lapses: b, stability: 8, srsUpdatedAt: NOW - 9000 });
        await saveWordToDB(primary);
        const { mergedCard } = mergeDuplicateCards(primary, secondary);
        assert.equal(mergedCard.lapses, expected, `gộp ${a}+${b} phải ra ${expected}`);
        // Revision của bản gộp phải LỚN HƠN cả hai đầu vào.
        assert.ok(mergedCard.srsUpdatedAt > Math.max(primary.srsUpdatedAt, secondary.srsUpdatedAt),
            'srsUpdatedAt của bản gộp phải là revision MỚI');

        await saveWordToDB(mergedCard);              // đúng đường modal.js dùng
        const stored = (await getAllVocabularyFromDB()).find(w => w.id === mergedCard.id);
        assert.equal(stored.lapses, expected,
            `cặp ${a}+${b}: lưu xuống ${stored.lapses} thay vì ${expected} (mất kết quả gộp)`);
        assert.equal(stored.stability, mergedCard.stability, 'stability gộp cũng không được bị bản cũ đè');
        assert.equal(stored.srsUpdatedAt, mergedCard.srsUpdatedAt, 'đồng hồ bộ nhớ phải giữ nguyên sau khi lưu');
    }
});

test('dedup: gộp KHÔNG làm hỏng các trường bộ nhớ khác (trạng thái, hạn, bước học)', async () => {
    await clearVocabularyDB();
    const a = card({ id: 'm1', srsStatus: 'Mastered', lapses: 9, learningStep: 2, stability: 30 });
    const b = card({ id: 'm2', srsStatus: 'New', lapses: 1, learningStep: 0, stability: 1, srsDueDate: null });
    await saveWordToDB(a);
    const { mergedCard } = mergeDuplicateCards(a, b);
    await saveWordToDB(mergedCard);
    const stored = (await getAllVocabularyFromDB()).find(w => w.id === mergedCard.id);
    assert.equal(stored.lapses, 10);
    assert.equal(stored.srsStatus, mergedCard.srsStatus);
    assert.equal(stored.learningStep, mergedCard.learningStep);
    assert.equal(stored.srsDueDate, mergedCard.srsDueDate);
});

test('gộp trùng GIỮ "Tạm ẩn" qua đường lưu thật, và không phụ thuộc thứ tự tham số', async () => {
    const active = card({ id: 'sus-a', isSuspended: false, lapses: 2 });
    const hidden = card({ id: 'sus-b', isSuspended: true, isStarred: true, lapses: 1 });
    // Hướng 1: bản đang học là "primary" (bản còn lại đang bị ẩn).
    await clearVocabularyDB();
    await saveWordToDB(active);
    const forward = mergeDuplicateCards(active, hidden).mergedCard;
    assert.equal(forward.isSuspended, true, 'một trong hai bị ẩn thì bản gộp phải ẩn');
    assert.equal(forward.isStarred, true);
    await saveWordToDB(forward);
    let stored = (await getAllVocabularyFromDB()).find(w => w.id === forward.id);
    assert.equal(stored.isSuspended, true, 'trạng thái ẩn phải sống sót qua mergeCardFields khi lưu');

    // Hướng 2: đảo thứ tự tham số, cùng kết quả về cờ.
    await clearVocabularyDB();
    await saveWordToDB(hidden);
    const backward = mergeDuplicateCards(hidden, active).mergedCard;
    await saveWordToDB(backward);
    stored = (await getAllVocabularyFromDB()).find(w => w.id === backward.id);
    assert.equal(stored.isSuspended, true);
    assert.equal(stored.isStarred, true);
});

// ─────────────────── (2) Hợp đồng MEMORY: Undo + merge theo domain ───────────────────
test('Undo phục hồi ĐẦY ĐỦ trạng thái trước lượt học (kể cả bộ đếm sai-trong-ngày)', () => {
    const before = card({
        id: 'u1', srsStatus: 'Learning', learningStep: 1, lapses: 3, reps: 3,
        stability: 0.7, stabilityShort: 0.5, difficulty: 9,
        lapseDay: TODAY, lapsesToday: 1, needsReformulation: false
    });
    const reviewed = calculateNextSrsState(before, 1, 'en-vi', 0, null, true, { now: NOW }).newState;
    // Lượt sai thứ 2 trong ngày ⇒ bị chôn.
    assert.equal(reviewed.lapsesToday, 2);
    assert.equal(reviewed.needsReformulation, true);

    const restored = restoreCardReview(reviewed, before, NOW + 1000);
    assert.equal(restored.lapses, 3, 'lapses phải lùi');
    assert.equal(restored.lapsesToday, 1, 'lapsesToday PHẢI lùi về 1');
    assert.equal(restored.lapseDay, TODAY);
    // normalizeCard canonical hoá false ⇒ VẮNG MẶT (engine chỉ kiểm `=== true`), nên sau Undo
    // trường này phải "không còn true" chứ không nhất thiết là false tường minh.
    assert.notEqual(restored.needsReformulation, true, 'cờ viết lại phải được gỡ khi Undo');
    assert.ok(!Object.hasOwn(restored, 'buriedOn') || restored.buriedOn !== TODAY, 'không được giữ dấu chôn của lượt đã hoàn tác');
    assert.equal(restored.srsStatus, before.srsStatus);
    assert.equal(restored.srsDueDate, before.srsDueDate);
});

test('Undo rồi chấm Again phải cho CÙNG kết quả như chấm Again trực tiếp từ trạng thái trước đó', () => {
    const before = card({
        id: 'u2', srsStatus: 'Learning', learningStep: 1, lapses: 3, reps: 3,
        stability: 0.7, stabilityShort: 0.5, difficulty: 9,
        lapseDay: TODAY, lapsesToday: 1, needsReformulation: false
    });
    const reviewed = calculateNextSrsState(before, 1, 'en-vi', 0, null, true, { now: NOW }).newState;
    const restored = restoreCardReview(reviewed, before, NOW + 1000);
    // Đây là bất biến đúng: Undo phải đưa về đúng điểm xuất phát, nên lượt kế tiếp giống hệt.
    const afterUndoAgain = calculateNextSrsState(restored, 1, 'en-vi', 0, null, true, { now: NOW + 2000 }).newState;
    const directAgain = calculateNextSrsState(before, 1, 'en-vi', 0, null, true, { now: NOW + 2000 }).newState;
    assert.equal(afterUndoAgain.lapsesToday, 2, 'bộ đếm đúng phải là 2, không phải 3');
    assert.equal(afterUndoAgain.lapsesToday, directAgain.lapsesToday);
    assert.equal(afterUndoAgain.srsDueDate, directAgain.srsDueDate, 'lịch hẹn sau Undo phải trùng lịch gốc');
    assert.equal(afterUndoAgain.needsReformulation, directAgain.needsReformulation);
    assert.equal(afterUndoAgain.lapses, directAgain.lapses);
});

test('bản chỉ sửa nội dung mới hơn KHÔNG được đè bộ đếm của trạng thái SRS mới hơn', () => {
    const memory = card({ srsStatus: 'Learning', srsUpdatedAt: NOW + 5000, updatedAt: NOW + 5000,
        lapseDay: TODAY, lapsesToday: 2, needsReformulation: true, buriedOn: TODAY });
    const editorial = card({ vietnamese: 'nghĩa mới', contentUpdatedAt: NOW + 9000, updatedAt: NOW + 9000 });
    const merged = mergeCardFields(memory, editorial);
    assert.equal(merged.vietnamese, 'nghĩa mới', 'nội dung mới vẫn thắng');
    assert.equal(merged.lapsesToday, 2, 'bộ đếm sai-trong-ngày thuộc domain bộ nhớ');
    assert.equal(merged.needsReformulation, true);
    assert.equal(merged.buriedOn, TODAY);
    assert.equal(merged.lapseDay, TODAY);
});

test('merge vẫn hội tụ và giao hoán sau khi thêm 4 trường bộ nhớ', () => {
    const a = card({ id: 'k1', srsUpdatedAt: NOW + 100, lapseDay: TODAY, lapsesToday: 2, needsReformulation: true });
    const b = card({ id: 'k1', srsUpdatedAt: NOW + 100, lapseDay: TODAY, lapsesToday: 0, needsReformulation: false });
    const ab = mergeCardFields(a, b);
    const ba = mergeCardFields(b, a);
    assert.deepEqual(ab, ba, 'merge(a,b) phải bằng merge(b,a)');
    assert.deepEqual(mergeCardFields(ab, a), ab, 'merge phải idempotent');
});

test('thẻ cũ thiếu 4 trường mới vẫn chấm và hoàn tác an toàn', () => {
    // lapses=4 ⇒ thẻ leech, để nhánh chôn/bộ đếm trong ngày thực sự chạy.
    const legacy = card({ id: 'old', srsStatus: 'Learning', learningStep: 1, lapses: 4 });
    delete legacy.lapseDay; delete legacy.lapsesToday; delete legacy.buriedOn; delete legacy.needsReformulation;
    const normalized = normalizeCard(legacy);
    assert.equal(normalized.lapsesToday, 0);
    assert.equal(Object.hasOwn(normalized, 'needsReformulation'), false);

    const reviewed = calculateNextSrsState(normalized, 1, 'en-vi', 0, null, true, { now: NOW }).newState;
    assert.equal(reviewed.lapsesToday, 1, 'lượt sai đầu tiên trong ngày đếm là 1');
    const restored = restoreCardReview(reviewed, normalized, NOW + 1000);
    assert.equal(restored.lapsesToday, 0, 'Undo trên thẻ legacy trả về 0 thay vì undefined/NaN');
    assert.equal(restored.lapses, normalized.lapses);
    assert.notEqual(restored.needsReformulation, true);
});
