// tests/p13-budget-due-rule.test.mjs
//
// AUDIT-R3.3 — Thẻ Mastered thiếu `srsDueDate` đi qua HAI quy tắc khác nhau.
//
// `isNaturallyDue` (dựng queue) coi thẻ KHÔNG có ngày hẹn là đến hạn; `classifyReview` (cửa ghi
// review) trả null và miễn ngân sách. Hệ quả: thẻ vẫn được đưa vào phiên như một lượt đến hạn,
// nhưng khi chấm thì không tiêu suất nào — ở trần 200/200 vẫn ghi 1 log và lưu thẻ.
//
// Nay hai nơi dùng cùng một quy tắc: Mastered + chưa ôn hôm nay + (không có ngày hẹn HOẶC hẹn
// trong hôm nay) ⇒ 'due' ⇒ chịu ngân sách.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { isNaturallyDue } from '../src/core/queue.js';
import { classifyReview, REVIEW_DUE, REVIEW_LEARNING } from '../src/core/review-policy.js';
import { parseVocabularyTsv } from '../src/core/tabular.js';
import { getLocalDateString } from '../src/core/utils/date.js';
import { makeHarness, NOW } from './helpers/review-harness.mjs';

const DAY = 86400000;

/** Thẻ Mastered đến từ TSV / bản đồng bộ cũ: có reps nhưng KHÔNG có ngày hẹn. */
function legacyDueCard(over = {}) {
    return {
        id: 'no-due', english: 'nullish', vietnamese: 'không có', srsStatus: 'Mastered', reps: 6,
        srsDueDate: null, lastReviewDate: NOW - 3 * DAY, srsInterval: 10,
        stability: 10, stabilityShort: 8, difficulty: 5,
        updatedAt: NOW, contentUpdatedAt: NOW, srsUpdatedAt: NOW, flagsUpdatedAt: NOW, ...over
    };
}

const BUDGET_FULL = { limit: 200, used: 200, reserved: 0, remaining: 0 };
const BUDGET_ONE_LEFT = { limit: 200, used: 199, reserved: 0, remaining: 1 };

test('R3.3: queue và cửa ghi dùng CÙNG quy tắc cho thẻ Mastered thiếu ngày hẹn', () => {
    const card = legacyDueCard();
    assert.equal(isNaturallyDue(card, NOW), true, 'queue phải coi là đến hạn (nếu không thẻ legacy không bao giờ được ôn)');
    assert.equal(classifyReview(card, NOW), REVIEW_DUE, 'cửa ghi phải phân loại là due ⇒ tiêu ngân sách');
});

test('R3.3: đã ôn hôm nay thì KHÔNG tính đến hạn ở cả hai nơi (tránh tính hai lần)', () => {
    const card = legacyDueCard({ lastReviewDate: NOW - 1000 });
    assert.equal(isNaturallyDue(card, NOW), false);
    assert.equal(classifyReview(card, NOW), null);
});

test('R3.3: thẻ ôn SỚM (có ngày hẹn trong tương lai) vẫn theo chính sách cram, không tiêu suất', () => {
    const card = legacyDueCard({ srsDueDate: NOW + 3 * DAY });
    assert.equal(isNaturallyDue(card, NOW), false);
    assert.equal(classifyReview(card, NOW), null);
    // Hẹn trong hôm nay ⇒ đến hạn.
    const dueToday = legacyDueCard({ srsDueDate: new Date(NOW).setHours(23, 0, 0, 0) });
    assert.equal(isNaturallyDue(dueToday, NOW), true);
    assert.equal(classifyReview(dueToday, NOW), REVIEW_DUE);
});

test('R3.3: ở 200/200 Flashcard KHÔNG ghi log và KHÔNG đổi lịch thẻ này', () => {
    const card = legacyDueCard();
    const h = makeHarness({ card, budget: BUDGET_FULL });
    h.review(3);
    assert.equal(h.logs.length, 0, 'không được ghi review log');
    assert.equal(h.saves.length, 0, 'không được lưu thẻ');
    assert.equal(h.d.dueDoneToday, 0, 'không tiêu suất');
    assert.equal(h.state.vocabulary[0].srsStatus, 'Mastered');
    assert.equal(h.state.vocabulary[0].srsDueDate, null, 'ngày hẹn phải nguyên vẹn');
    assert.equal(h.toasts.length, 1);
    assert.match(h.toasts[0].title, /giới hạn ôn/i);
});

test('R3.3: ở 199/200 chấm được và dùng ĐÚNG MỘT suất due', () => {
    const card = legacyDueCard();
    const h = makeHarness({ card, budget: BUDGET_ONE_LEFT });
    h.review(3);
    assert.equal(h.logs.length, 1, 'còn suất thì phải chấm được (không chặn oan thẻ legacy)');
    assert.equal(h.saves.length, 1);
    assert.equal(h.d.dueDoneToday, 1, 'tiêu đúng một suất due');
    assert.equal(h.d.newCardsDoneToday, 0);
    assert.notEqual(h.state.vocabulary[0].srsDueDate, null, 'phải được lên lịch lại');
});

test('R3.3: Learning vẫn giữ ngoại lệ hiện tại (ngoài cap ngày)', () => {
    const card = legacyDueCard({ id: 'l1', srsStatus: 'Learning', learningStep: 2, srsDueDate: null, reps: 2 });
    assert.equal(classifyReview(card, NOW), REVIEW_LEARNING);
    const h = makeHarness({ card, budget: BUDGET_FULL });
    h.review(3);
    assert.equal(h.logs.length, 1);
});

test('R3.3: Quiz cũng chặn thẻ này ở 200/200 và cho qua ở 199/200', async () => {
    const makeQuiz = (card, budget) => {
        const state = {
            vocabulary: [card], currentCardIndex: 0,
            gamification: { stats: {}, consecutiveCorrect: 0, totalReviews: 0 },
            dailyStats: { lastDate: getLocalDateString(NOW), todayTotal: 0, todayCorrect: 0, newCardsDoneToday: 0, dueDoneToday: 0, learningDoneToday: 0 }
        };
        const saves = [], logs = [], counted = [], toasts = [];
        const context = vm.createContext({
            getState: () => state,
            calculateNextSrsState: cardIn => ({ newState: { ...cardIn, srsDueDate: NOW + DAY, srsStatus: 'Mastered' }, log: { cardId: cardIn.id } }),
            saveOneWord: word => saves.push(word), recordQuizAnswer() {}, addXP() {}, getComboMultiplier: () => 1,
            addReviewLog: log => logs.push(log), clearLastReviewSnapshot() {},
            incrementNewCardsDone() {}, incrementDueCardsDone() {}, incrementLearningCardsDone() {},
            isCardReviewable: (c) => !!c && c.isDeleted !== true && c.isSuspended !== true,
            classifyReview, canSpendBudget: (category, budgets) => {
                if (category === 'new') return budgets.newRemaining > 0 && budgets.totalRemaining > 0;
                if (category === 'due') return budgets.totalRemaining > 0;
                return true;
            },
            reviewBudgets: ({ limit, used, newLimit, newUsed }) => ({
                totalRemaining: Math.max(0, limit - used),
                newRemaining: Math.max(0, newLimit - (newUsed || 0))
            }),
            budgetBlockReason: (category, budgets) => {
                if (category === 'new') return budgets.newRemaining <= 0 ? 'new' : (budgets.totalRemaining <= 0 ? 'total' : null);
                if (category === 'due') return budgets.totalRemaining <= 0 ? 'total' : null;
                return null;
            },
            REVIEW_NEW: 'new', REVIEW_DUE: 'due', REVIEW_LEARNING: 'learning',
            computeDailyNewLimit: () => 9999,
            getReviewBudget: () => budget,
            incrementReviewBudget: c => counted.push(c),
            updateQuizProgress() {}, playSound() {}, showPopup() {}, showConfirmation() {},
            showToast: (title, body) => toasts.push({ title, body }),
            suspendCelestialCanvas() {}, resumeCelestialCanvas() {}, escapeHTML: s => s, superNormalize: s => s, stripVietnameseDiacritics: s => s,
            animateNumber() {}, launchVictoryConfetti() {}, trackEvent() {}, saveGamification: async () => {},
            // Biến phiên của quiz.js (chỉ dùng để chỉ báo một lần).
            quizBudgetNoticeShown: false
        });
        // `applyQuizReview` là hàm nội bộ (không export), trích nguyên văn từ nguồn để test chạy
        // đúng mã của ứng dụng thay vì chép lại logic.
        const source = fs.readFileSync(new URL('../src/features/quiz.js', import.meta.url), 'utf8');
        const start = source.indexOf('\nfunction applyQuizReview(');
        assert.ok(start > 0, 'không trích được applyQuizReview từ quiz.js');
        const end = source.indexOf('\nfunction ', start + 10);
        vm.runInContext(source.slice(start, end), context);
        return { context, saves, logs, counted, toasts, state };
    };

    const blocked = makeQuiz(legacyDueCard({ id: 'q1' }), BUDGET_FULL);
    blocked.context.applyQuizReview({ id: 'q1' }, 3);
    assert.equal(blocked.saves.length, 0, 'Quiz không được ghi khi đã hết trần');
    assert.equal(blocked.logs.length, 0);
    assert.equal(blocked.counted.length, 0);
    assert.match(blocked.toasts[0].title, /giới hạn ôn/i);

    const allowed = makeQuiz(legacyDueCard({ id: 'q2' }), BUDGET_ONE_LEFT);
    allowed.context.applyQuizReview({ id: 'q2' }, 3);
    assert.equal(allowed.saves.length, 1);
    assert.deepEqual(allowed.counted, [REVIEW_DUE]);
});

test('R3.3: thẻ đi từ parser TSV (Mastered, không có ngày hẹn) đến cửa ghi review', () => {
    // Cột 7 = trạng thái, cột 8 = ngày đến hạn (bỏ trống), cột 12 = khoảng ôn, cột 16 = reps.
    const line = ['nullish', 'không có', '', '', '', 'false', 'Mastered', '', '', '0', 'false', '10', '2.5', '5', '10', '', '', '', ''].join('\t');
    const { rows, errors } = parseVocabularyTsv(line);
    assert.equal(errors.length, 0);
    assert.equal(rows.length, 1);
    const card = { ...rows[0].card, id: 'tsv-1', updatedAt: NOW, contentUpdatedAt: NOW, srsUpdatedAt: NOW, flagsUpdatedAt: NOW };
    assert.equal(card.srsStatus, 'Mastered');
    assert.equal(card.srsDueDate, null, 'TSV không có ngày hẹn ⇒ null, đúng nguồn của lỗi');
    assert.equal(isNaturallyDue(card, NOW), true, 'queue coi là đến hạn');
    assert.equal(classifyReview(card, NOW), REVIEW_DUE, 'cửa ghi cũng phải coi là đến hạn');

    const blocked = makeHarness({ card: { ...card }, budget: BUDGET_FULL });
    blocked.review(3);
    assert.equal(blocked.logs.length, 0, 'ở 200/200 không được ghi gì');
    assert.equal(blocked.saves.length, 0);

    const allowed = makeHarness({ card: { ...card }, budget: BUDGET_ONE_LEFT });
    allowed.review(3);
    assert.equal(allowed.logs.length, 1, 'ở 199/200 phải học được');
    assert.equal(allowed.d.dueDoneToday, 1);
});
