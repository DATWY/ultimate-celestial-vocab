// tests/p11-review-budget.test.mjs
//
// Regression cho lỗi "ba chế độ định nghĩa một lượt học theo ba cách":
//   • Flashcard: New + "Quên" không bao giờ tiêu ngân sách từ mới (mở thẻ mới vô hạn);
//   • Quiz: cộng bộ đếm bất kể đúng/sai, bỏ qua "Tạm ẩn" và bỏ qua cap ngày;
//   • Undo: hoàn lại một phần, không khớp với phần đã cộng.
//
// Nguồn duy nhất sau khi sửa: src/core/review-policy.js (phân loại thuần) +
// incrementReviewBudget/revertReviewBudget (ghi daily stats). Test kiểm cả hàm thuần,
// cả bộ đếm thật (fake-indexeddb), và chính applyQuizReview trích từ nguồn.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { initAppDB } from '../src/core/idb.js';
import { classifyReview, isCardReviewable, canSpendBudget, reviewBudgets, budgetBlockReason,
    REVIEW_NEW, REVIEW_LEARNING, REVIEW_DUE } from '../src/core/review-policy.js';
import { incrementReviewBudget, revertReviewBudget } from '../src/core/state/gamification.js';
import { getState } from '../src/core/state.js';
import { calculateNextSrsState } from '../src/core/srs/index.js';

const NOW = new Date(2026, 10, 3, 15, 0).getTime();
const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

await initAppDB();

// ───────────────────────────── phân loại ngân sách ─────────────────────────────
test('classifyReview: mỗi trạng thái thẻ tiêu đúng một loại ngân sách', () => {
    assert.equal(classifyReview({ srsStatus: 'New' }, NOW), REVIEW_NEW);
    assert.equal(classifyReview({ srsStatus: 'Learning', learningStep: 1 }, NOW), REVIEW_LEARNING);
    assert.equal(classifyReview({ srsStatus: 'Mastered', srsDueDate: NOW - 1000 }, NOW), REVIEW_DUE);
    // Chưa đến hạn (ôn sớm / cram) ⇒ không tiêu ngân sách.
    assert.equal(classifyReview({ srsStatus: 'Mastered', srsDueDate: NOW + 5 * 86400000 }, NOW), null);
    // Đã ôn hôm nay rồi ⇒ không đếm lần nữa dù hạn vẫn trong hôm nay.
    assert.equal(classifyReview({ srsStatus: 'Mastered', srsDueDate: NOW - 1000, lastReviewDate: NOW - 3600000 }, NOW), null);
    // Thẻ tạm ẩn / đã xoá không được chấm.
    assert.equal(classifyReview({ srsStatus: 'New', isSuspended: true }, NOW), null);
    assert.equal(classifyReview({ srsStatus: 'New', isDeleted: true }, NOW), null);
    assert.equal(classifyReview(null, NOW), null);
});

test('chỉ thẻ mới và thẻ đến hạn mới nằm trong cap lượt ôn', () => {
    // Learning sub-day nằm NGOÀI cap theo thiết kế; thẻ mới/đến hạn thì bị cap chặn.
    assert.equal(canSpendBudget(REVIEW_LEARNING, 0), true);
    assert.equal(canSpendBudget(REVIEW_NEW, 0), false);
    assert.equal(canSpendBudget(REVIEW_DUE, 1), true);
    assert.equal(canSpendBudget(REVIEW_DUE, 0), false);
    assert.equal(canSpendBudget(null, 0), true);
});

test('isCardReviewable tôn trọng tạm ẩn và xoá', () => {
    assert.equal(isCardReviewable({ id: 'a' }), true);
    assert.equal(isCardReviewable({ id: 'a', isSuspended: true }), false);
    assert.equal(isCardReviewable({ id: 'a', isDeleted: true }), false);
    assert.equal(isCardReviewable(null), false);
});

// ─────────────────── New + Quên phải tiêu đúng MỘT suất từ mới ───────────────────
test('New → Quên → Learning: ngân sách từ mới tiêu đúng một lần, không đếm lại', () => {
    const fresh = { id: 'n1', english: 'apple', srsStatus: 'New', reps: 0, lapses: 0 };
    const firstCategory = classifyReview(fresh, NOW);
    assert.equal(firstCategory, REVIEW_NEW, 'lượt đầu của thẻ New phải tiêu suất từ mới');

    // Chấm "Quên": engine chuyển ngay sang Learning.
    const afterAgain = calculateNextSrsState(fresh, 1, 'en-vi', 0, null, true, { now: NOW }).newState;
    assert.equal(afterAgain.srsStatus, 'Learning');
    const secondCategory = classifyReview(afterAgain, NOW + 60000);
    assert.equal(secondCategory, REVIEW_LEARNING, 'lượt sau là Learning, KHÔNG tiêu thêm suất từ mới');
    assert.equal(secondCategory === REVIEW_NEW, false);
});

// ───────────────────── bộ đếm thật: cộng/hoàn đúng một suất ─────────────────────
test('incrementReviewBudget/revertReviewBudget tác động đúng khoá daily-stats', () => {
    const before = { ...getState().dailyStats };
    for (let i = 0; i < 3; i++) incrementReviewBudget(REVIEW_NEW);
    assert.equal(getState().dailyStats.newCardsDoneToday, (before.newCardsDoneToday || 0) + 3);
    incrementReviewBudget(REVIEW_DUE);
    assert.equal(getState().dailyStats.dueDoneToday, (before.dueDoneToday || 0) + 1);
    incrementReviewBudget(REVIEW_LEARNING);
    assert.equal(getState().dailyStats.learningDoneToday, (before.learningDoneToday || 0) + 1);
    // Không tiêu ngân sách (cram) ⇒ không đổi gì.
    assert.equal(incrementReviewBudget(null), null);

    revertReviewBudget(REVIEW_NEW);
    assert.equal(getState().dailyStats.newCardsDoneToday, (before.newCardsDoneToday || 0) + 2);
    // Hoàn nhiều lần hơn số đã cộng thì kẹp ở 0, không âm.
    for (let i = 0; i < 10; i++) revertReviewBudget(REVIEW_DUE);
    assert.equal(getState().dailyStats.dueDoneToday, 0);
});

test('Undo rồi làm lại không cộng dồn: +1 rồi -1 rồi +1 phải bằng +1', () => {
    const start = getState().dailyStats.newCardsDoneToday || 0;
    incrementReviewBudget(REVIEW_NEW);
    revertReviewBudget(REVIEW_NEW);
    incrementReviewBudget(REVIEW_NEW);
    assert.equal(getState().dailyStats.newCardsDoneToday, start + 1);
    revertReviewBudget(REVIEW_NEW);
    assert.equal(getState().dailyStats.newCardsDoneToday, start);
});

// ─────────────────── applyQuizReview thật: tạm ẩn + cap + tái kiểm tra ───────────────────
function quizReviewHarness({ words, remaining = 999, budget = null, newLimit = 9999, dailyStats = null }) {
    const source = read('src/features/quiz.js');
    const start = source.indexOf('let quizBudgetNoticeShown');
    const end = source.indexOf('\nfunction skipQuizQuestion');
    assert.ok(start >= 0 && end > start, 'không trích được applyQuizReview từ quiz.js');
    const code = source.slice(start, end);
    const state = { vocabulary: words, dailyStats: dailyStats || {} };
    const saves = [], counted = [], logs = [], toasts = [];
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        getState: () => state,
        isCardReviewable, classifyReview, canSpendBudget, reviewBudgets, budgetBlockReason, REVIEW_NEW,
        // `remaining` được mô phỏng bằng (limit - used) để giữ đúng ngữ nghĩa "còn bao nhiêu
        // suất thật"; `budget` cho phép dựng ca có suất GIỮ CHỖ (reserved) riêng.
        getReviewBudget: () => budget || { limit: 1000, used: 1000 - remaining, reserved: 0, remaining },
        computeDailyNewLimit: () => newLimit,
        incrementReviewBudget: category => { counted.push(category); return category; },
        showToast: (title, body) => toasts.push({ title, body }),
        calculateNextSrsState: (card, _rating) => ({ newState: { ...card, srsStatus: 'Learning', lapses: (card.lapses || 0) + 1 }, log: { cardId: card.id } }),
        saveOneWord: card => saves.push(card),
        addReviewLog: log => logs.push(log),
    });
    vm.runInContext(code + '\nthis.applyQuizReview = applyQuizReview;', context);
    return { apply: (word, rating) => context.applyQuizReview(word, rating), state, saves, counted, logs, toasts };
}

test('Quiz KHÔNG chấm thẻ đang Tạm ẩn (không ghi SRS, không tiêu ngân sách)', () => {
    const word = { id: 'q1', english: 'cat', srsStatus: 'New', isSuspended: true };
    const h = quizReviewHarness({ words: [word] });
    h.apply(word, 3);
    assert.equal(h.saves.length, 0, 'không được lưu thẻ tạm ẩn');
    assert.equal(h.counted.length, 0, 'không được tiêu ngân sách');
    assert.equal(h.state.vocabulary[0].srsStatus, 'New', 'trạng thái SRS phải nguyên vẹn');
});

test('Quiz tái kiểm tra trạng thái tại lúc áp dụng (thẻ bị xoá giữa chừng)', () => {
    const word = { id: 'q2', english: 'cat', srsStatus: 'New' };
    const h = quizReviewHarness({ words: [word] });
    h.state.vocabulary[0].isDeleted = true;
    h.apply(word, 3);
    assert.equal(h.saves.length, 0);
});

test('Quiz không âm thầm vượt ngân sách: hết suất thì không ghi SRS và nói rõ một lần', () => {
    const word = { id: 'q3', english: 'cat', srsStatus: 'New' };
    const h = quizReviewHarness({ words: [word], remaining: 0 });
    h.apply(word, 3);
    h.apply(word, 3);
    assert.equal(h.saves.length, 0, 'đã chạm cap thì không được ghi SRS');
    assert.equal(h.counted.length, 0);
    assert.equal(h.toasts.length, 1, 'phải báo cho người học, và chỉ một lần');
    assert.match(h.toasts[0].title, /giới hạn|ngân sách/i);
});

test('Quiz vẫn chấm bình thường khi còn suất, và tiêu đúng loại ngân sách', () => {
    const word = { id: 'q4', english: 'cat', srsStatus: 'New' };
    const h = quizReviewHarness({ words: [word], remaining: 5 });
    h.apply(word, 3);
    assert.equal(h.saves.length, 1);
    assert.deepEqual(h.counted, [REVIEW_NEW]);
    assert.equal(h.logs.length, 1, 'vẫn phải ghi review log như trước');
    assert.equal(h.state.vocabulary[0].srsStatus, 'Learning');
});

test('Quiz với thẻ Learning không bị cap ngày chặn (Learning nằm ngoài ngân sách)', () => {
    const word = { id: 'q5', english: 'cat', srsStatus: 'Learning', learningStep: 1 };
    const h = quizReviewHarness({ words: [word], remaining: 0 });
    h.apply(word, 3);
    assert.equal(h.saves.length, 1, 'Learning vẫn được cập nhật dù đã hết cap');
    assert.deepEqual(h.counted, [REVIEW_LEARNING]);
});

test('Quiz không bị chặn sớm bởi suất GIỮ CHỖ của thẻ đang mở trước mặt', () => {
    // Trần 10, đã dùng 9, còn 1 suất; thẻ Mastered đang mở khiến `reserved = 1` nên
    // `remaining = 0`. Lúc chấm thật, quiz phải được dùng suất thứ 10 đó.
    const word = { id: 'q6', english: 'cat', srsStatus: 'New' };
    const h = quizReviewHarness({
        words: [word],
        budget: { limit: 10, used: 9, reserved: 1, remaining: 0 }
    });
    h.apply(word, 3);
    assert.equal(h.saves.length, 1, 'phải cho phép lượt thứ 10 dù có 1 suất đang giữ chỗ');
    assert.deepEqual(h.counted, [REVIEW_NEW]);

    // Nhưng khi ĐÃ dùng đủ trần thì vẫn phải chặn.
    const h2 = quizReviewHarness({
        words: [{ id: 'q7', english: 'cat', srsStatus: 'New' }],
        budget: { limit: 10, used: 10, reserved: 1, remaining: 0 }
    });
    h2.apply({ id: 'q7' }, 3);
    assert.equal(h2.saves.length, 0, 'dùng đủ trần thì không được ghi SRS');
    assert.equal(h2.toasts.length, 1);
});

// ─────────── AUDIT-R2.3: HAI ngân sách độc lập (từ mới và tổng) ───────────
const totalBudget = (limit, used) => ({ limit, used, reserved: 0, remaining: Math.max(0, limit - used) });

test('R2.3: đã đủ hạn mức TỪ MỚI (15/15) nhưng còn trần tổng ⇒ Quiz phải CHẶN thẻ New', () => {
    const word = { id: 'n1', english: 'cat', srsStatus: 'New' };
    const h = quizReviewHarness({
        words: [word],
        budget: totalBudget(200, 15),          // còn 185 suất tổng
        newLimit: 15,
        dailyStats: { newCardsDoneToday: 15 }  // nhưng đã dùng hết suất từ mới
    });
    h.apply(word, 3);
    assert.equal(h.saves.length, 0, 'không được giới thiệu thẻ New thứ 16');
    assert.equal(h.counted.length, 0, 'không được tiêu ngân sách');
    assert.equal(h.logs.length, 0, 'không được ghi review log');
    assert.equal(h.toasts.length, 1);
    assert.match(h.toasts[0].title, /từ mới/i, 'thông báo phải nói ĐÚNG lý do (hạn mức từ mới)');
});

test('R2.3: còn suất TỪ MỚI nhưng hết trần TỔNG ⇒ Quiz phải CHẶN thẻ New', () => {
    const word = { id: 'n2', english: 'cat', srsStatus: 'New' };
    const h = quizReviewHarness({
        words: [word],
        budget: totalBudget(200, 200),
        newLimit: 15,
        dailyStats: { newCardsDoneToday: 3 }
    });
    h.apply(word, 3);
    assert.equal(h.saves.length, 0);
    assert.equal(h.counted.length, 0);
    assert.match(h.toasts[0].title, /giới hạn ôn/i, 'lý do phải là trần tổng, không phải hạn mức từ mới');
});

test('R2.3: thẻ ĐẾN HẠN chỉ cần trần tổng (hạn mức từ mới đã hết vẫn học được)', () => {
    const today = new Date();
    const word = { id: 'd1', english: 'dog', srsStatus: 'Mastered', stability: 10, difficulty: 5,
        srsDueDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 8, 0).getTime(),
        lastReviewDate: today.getTime() - 3 * 86400000 };
    const h = quizReviewHarness({
        words: [word],
        budget: totalBudget(200, 20),
        newLimit: 15,
        dailyStats: { newCardsDoneToday: 15 }
    });
    h.apply(word, 3);
    assert.equal(h.saves.length, 1, 'thẻ đến hạn không phụ thuộc hạn mức từ mới');
    assert.deepEqual(h.counted, [REVIEW_DUE]);
});

test('R2.3: thẻ LEARNING vẫn chấm được khi hết CẢ hai ngân sách (ngoại lệ theo thiết kế)', () => {
    const word = { id: 'l1', english: 'cat', srsStatus: 'Learning', learningStep: 2 };
    const h = quizReviewHarness({
        words: [word],
        budget: totalBudget(200, 200),
        newLimit: 15,
        dailyStats: { newCardsDoneToday: 15 }
    });
    h.apply(word, 3);
    assert.equal(h.saves.length, 1);
    assert.deepEqual(h.counted, [REVIEW_LEARNING]);
});

test('R2.3: canSpendBudget/reviewBudgets là MỘT quyết định dùng chung (bảng chân trị)', () => {
    const budgets = (limit, used, newLimit, newUsed) => reviewBudgets({ limit, used, newLimit, newUsed });
    // New: cần CẢ HAI.
    assert.equal(canSpendBudget(REVIEW_NEW, budgets(200, 15, 15, 15)), false);
    assert.equal(canSpendBudget(REVIEW_NEW, budgets(200, 200, 15, 3)), false);
    assert.equal(canSpendBudget(REVIEW_NEW, budgets(200, 15, 15, 14)), true);
    // Due: chỉ cần trần tổng.
    assert.equal(canSpendBudget(REVIEW_DUE, budgets(200, 20, 15, 15)), true);
    assert.equal(canSpendBudget(REVIEW_DUE, budgets(200, 200, 15, 0)), false);
    // Learning + cram (null): luôn được.
    assert.equal(canSpendBudget(REVIEW_LEARNING, budgets(200, 200, 15, 15)), true);
    assert.equal(canSpendBudget(null, budgets(0, 200, 0, 15)), true);
    // Lý do chặn phải phân biệt được.
    assert.equal(budgetBlockReason(REVIEW_NEW, budgets(200, 15, 15, 15)), 'new');
    assert.equal(budgetBlockReason(REVIEW_NEW, budgets(200, 200, 15, 0)), 'total');
    assert.equal(budgetBlockReason(REVIEW_DUE, budgets(200, 20, 15, 15)), null);
});
