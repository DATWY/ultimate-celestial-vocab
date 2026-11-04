// tests/p12-review-gates.test.mjs
//
// AUDIT-R2.3 (phần Flashcard) — hàng đợi CŨ không được âm thầm vượt cap.
// AUDIT-R2.4 — thẻ bị xoá/tạm ngưng không được chấm, không ghi log, không tiêu ngân sách; phiên
//              luyện gõ riêng phải dùng CÙNG điều kiện hợp lệ (buildTypingPool + getNextCardToReview).
//
// Các test ở đây đi qua handler thật (processSrsFeedback) và hàng đợi thật (queue.js), không chỉ
// gọi hàm thuần rồi suy ra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildTypingPool, matchesTypingFilter } from '../src/features/typing-session.js';
import { isLeechCard } from '../src/core/srs/index.js';
import { classifyReview, isCardReviewable } from '../src/core/review-policy.js';
import { makeHarness, newCard, NOW } from './helpers/review-harness.mjs';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

/** Hàng đợi thật `getNextCardToReview` với state tối thiểu. */
function makeQueue(vocabulary, queue) {
    const state = { vocabulary, currentReviewQueue: queue };
    const context = vm.createContext({
        getState: () => state,
        setReviewQueue: next => { state.currentReviewQueue = next; },
        ensureDailyStats: () => {},
        // Trong production buildReviewQueue() bỏ qua isDeleted/isSuspended; ở đây mô phỏng đúng
        // kết quả đó (hàng đợi rỗng) để kiểm nhánh "không còn thẻ hợp lệ" mà không dựng cả kho.
        buildReviewQueue: () => { state.currentReviewQueue = []; },
        isCardReviewable,
    });
    const source = read('src/core/queue.js');
    const start = source.indexOf('export function getNextCardToReview(');
    const end = source.indexOf('\nexport function insertCardForLearningStep(');
    assert.ok(start >= 0 && end > start);
    vm.runInContext(source.slice(start, end).replace('export ', ''), context);
    return { next: () => context.getNextCardToReview(), state };
}

// ─────────────────────────── R2.4: eligibility dùng chung ───────────────────────────
test('R2.4: kho chỉ có thẻ TẠM NGƯNG ⇒ phiên luyện gõ không có thẻ nào', () => {
    const vocabulary = [{ id: 'a', english: 'cat', srsStatus: 'New', isSuspended: true }];
    assert.deepEqual(buildTypingPool(vocabulary, 'all', isLeechCard), []);
});

test('R2.4: pool hỗn hợp ⇒ chỉ mở thẻ hợp lệ (ẩn/xoá bị loại, thẻ thường vẫn còn)', () => {
    const vocabulary = [
        { id: 'ok1', english: 'cat', srsStatus: 'New' },
        { id: 'hidden', english: 'dog', srsStatus: 'New', isSuspended: true },
        { id: 'gone', english: 'cow', srsStatus: 'New', isDeleted: true },
        { id: 'ok2', english: 'bird', srsStatus: 'Learning', learningStep: 1 }
    ];
    assert.deepEqual(buildTypingPool(vocabulary, 'all', isLeechCard), [0, 3]);
    // Bộ lọc vẫn hoạt động như trước, chỉ thêm điều kiện hợp lệ.
    assert.deepEqual(buildTypingPool(vocabulary, 'learning', isLeechCard), [0, 3]);
    assert.deepEqual(buildTypingPool(vocabulary, 'starred', isLeechCard), []);
});

test('R2.4: bộ lọc "long"/"starred" giữ nguyên hành vi', () => {
    const long = { english: 'congratulations', srsStatus: 'New' };
    const starred = { english: 'cat', srsStatus: 'New', isStarred: true };
    assert.equal(matchesTypingFilter(long, 'long', isLeechCard), true);
    assert.equal(matchesTypingFilter(starred, 'long', isLeechCard), false);
    assert.equal(matchesTypingFilter(starred, 'starred', isLeechCard), true);
});

test('R2.4: hàng đợi bỏ qua thẻ bị tạm ngưng và trả thẻ hợp lệ kế tiếp', () => {
    const vocabulary = [
        { id: 'hidden', srsStatus: 'New', isSuspended: true },
        { id: 'ok', srsStatus: 'New' }
    ];
    const q = makeQueue(vocabulary, [0, 1]);
    assert.equal(q.next(), 1, 'phải nhảy qua thẻ tạm ngưng');
    assert.equal(q.state.currentReviewQueue.length, 0);
});

test('R2.4: hàng đợi toàn thẻ không hợp lệ ⇒ -1, không lặp vô hạn', () => {
    const vocabulary = [
        { id: 'a', srsStatus: 'New', isSuspended: true },
        { id: 'b', srsStatus: 'New', isDeleted: true }
    ];
    const q = makeQueue(vocabulary, [0, 1]);
    assert.equal(q.next(), -1);
});

// ─────────────────── R2.4: chặn tại CỬA CHẤM (không chỉ lúc dựng pool) ───────────────────
test('R2.4: thẻ bị tạm ngưng SAU khi vào hàng đợi ⇒ không chấm, không log, không tiêu ngân sách', () => {
    const card = newCard({ id: 's1', isSuspended: true });
    const h = makeHarness({ card });
    h.review(3);
    assert.equal(h.logs.length, 0, 'không được ghi review log');
    assert.equal(h.saves.length, 0, 'không được ghi thẻ');
    assert.equal(h.state.vocabulary[0].isSuspended, true);
    assert.equal(h.state.vocabulary[0].srsStatus, 'New', 'trạng thái SRS phải nguyên vẹn');
    assert.equal(h.d.newCardsDoneToday, 0, 'không được tiêu ngân sách');
    assert.equal(h.g.userXP, 0, 'không được cộng XP');
    assert.equal(h.toasts.length, 1, 'phải nói rõ vì sao không chấm được');
});

test('R2.4: thẻ bị XOÁ sau khi vào hàng đợi ⇒ không chấm', () => {
    const card = newCard({ id: 'd1', isDeleted: true });
    const h = makeHarness({ card });
    h.review(4);
    assert.equal(h.logs.length, 0);
    assert.equal(h.saves.length, 0);
    assert.equal(h.g.userXP, 0);
});

// ─────────────────── R2.3: chốt ngân sách tại cửa ghi (hàng đợi cũ) ───────────────────
test('R2.3: hàng đợi cũ + trần tổng đã hết ⇒ Flashcard không ghi SRS', () => {
    const h = makeHarness({ card: newCard({ id: 'b1' }), budget: { limit: 10, used: 10, reserved: 0, remaining: 0 } });
    h.review(4);
    assert.equal(h.logs.length, 0, 'không được ghi review log khi đã hết suất');
    assert.equal(h.saves.length, 0);
    assert.equal(h.d.newCardsDoneToday, 0);
    assert.equal(h.g.userXP, 0, 'lượt bị chặn không được cộng XP');
    assert.equal(h.toasts.length, 1);
    assert.match(h.toasts[0].title, /giới hạn ôn/i);
});

test('R2.3: hạn mức TỪ MỚI đã hết nhưng còn trần tổng ⇒ Flashcard không giới thiệu thẻ New', () => {
    const h = makeHarness({
        card: newCard({ id: 'b2' }),
        budget: { limit: 200, used: 20, reserved: 0, remaining: 180 },
        newLimit: 15,
        dailyStats: { newCardsDoneToday: 15 }
    });
    h.review(3);
    assert.equal(h.logs.length, 0);
    assert.equal(h.d.newCardsDoneToday, 15, 'không được tăng bộ đếm từ mới');
    assert.match(h.toasts[0].title, /từ mới/i, 'thông báo phải nêu đúng hạn mức từ mới');
});

test('R2.3: thẻ Learning vẫn chấm được khi cả hai ngân sách đã hết', () => {
    const h = makeHarness({
        card: newCard({ id: 'b3', srsStatus: 'Learning', reps: 2, learningStep: 1 }),
        budget: { limit: 200, used: 200, reserved: 0, remaining: 0 },
        newLimit: 15,
        dailyStats: { newCardsDoneToday: 15 }
    });
    h.review(3);
    assert.equal(h.logs.length, 1, 'Learning nằm ngoài cap theo thiết kế hiện tại');
    assert.equal(h.saves.length, 1);
});

test('R2.3: Undo sau lượt được phép hoàn đúng suất từ mới đã tiêu', async () => {
    const h = makeHarness({ card: newCard({ id: 'b4' }), newLimit: 15, dailyStats: { newCardsDoneToday: 14 } });
    h.review(3);
    assert.equal(h.d.newCardsDoneToday, 15);
    await h.undo();
    assert.equal(h.d.newCardsDoneToday, 14, 'Undo phải trả lại suất thứ 15');
});

test('R2.3: phân loại và điều kiện hợp lệ là cùng một nguồn cho mọi chế độ', () => {
    // Quiz và Flashcard đều import từ review-policy; ở đây khẳng định hành vi tối thiểu mà cả
    // hai dựa vào, để một thay đổi lệch ở một phía sẽ làm test này đỏ.
    assert.equal(isCardReviewable({ isSuspended: true }), false);
    assert.equal(isCardReviewable({ isDeleted: true }), false);
    assert.equal(classifyReview({ srsStatus: 'New' }), 'new');
    assert.equal(classifyReview({ srsStatus: 'Learning' }), 'learning');
    assert.equal(classifyReview({ srsStatus: 'Mastered', srsDueDate: NOW - 1000, lastReviewDate: NOW - 5 * 86400000 }), 'due');
});
