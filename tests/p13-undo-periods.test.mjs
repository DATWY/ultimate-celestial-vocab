// tests/p13-undo-periods.test.mjs
//
// AUDIT-R3.2 — Undo phải giữ đúng XP theo KỲ và các hoạt động phát sinh xen giữa.
//
// Ca chuẩn: hôm qua 50 XP → sang ngày mới A +5 → B +7 cùng ngày → Undo A ⇒ xpToday = 7 và
// `lastXPDate` vẫn là HÔM NAY; cộng thêm 1 ⇒ 8. Bản lỗi trả 57 rồi 1 và kéo `lastXPDate` về hôm qua.
//
// Nguyên nhân: `diff` cũ ghi delta = after − before = 5 − 50 = −45, tức trộn "chuyển kỳ" vào
// "phần đóng góp của A". Nay phần đóng góp = after − 0 khi lượt chấm đã sang kỳ mới.
//
// Test dùng `trackXP` THẬT và (ở các ca tích hợp) chính `processSrsFeedback` +
// `revertGamificationAfterUndo` qua tests/helpers/review-harness.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    snapshotReviewStats, diffReviewStats, revertReviewStats, counterContribution
} from '../src/core/stats-rollback.js';
import { ensureStats, trackXP, trackReview } from '../src/features/stat-trackers.js';
import { startTypingTimer, evaluateTyping } from '../src/features/typing.js';
import { getLocalDateString } from '../src/core/utils/date.js';
import { makeHarness, newCard, NOW } from './helpers/review-harness.mjs';

const DAY = 86400000;
const YESTERDAY = NOW - DAY;

const day = ms => getLocalDateString(ms);
const weekKeyOf = ms => trackXP(ensureStats({}), 0, ms).lastWeekKey;
const monthKeyOf = ms => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// ───────────────────────── Ca chuẩn 50 → 5 → +7 → Undo → +1 ─────────────────────────
test('R3.2 (hàm thuần, trackXP thật): 50 hôm qua, A +5, B +7, Undo A ⇒ 7 rồi +1 ⇒ 8', () => {
    const stats = ensureStats({});
    trackXP(stats, 50, YESTERDAY);
    const snapshot = snapshotReviewStats(stats, day(NOW));
    trackXP(stats, 5, NOW);                       // A
    const changes = diffReviewStats(snapshot, stats);
    trackXP(stats, 7, NOW + 60000);               // B (hợp lệ, cùng ngày)
    revertReviewStats(stats, snapshot, changes, day(NOW));
    assert.equal(stats.xpToday, 7, 'chỉ trừ phần A cộng, không trừ phần chuyển kỳ');
    assert.equal(stats.lastXPDate, day(NOW), 'mốc ngày phải ở lại hôm nay');
    trackXP(stats, 1, NOW + 120000);
    assert.equal(stats.xpToday, 8);
});

test('R3.2 (tích hợp, handler + Undo thật): cùng ca 50 → A +5 → B +7 → Undo', async () => {
    const h = makeHarness({
        card: newCard({ id: 'p1' }),
        stats: { xpToday: 50, lastXPDate: day(YESTERDAY), xpWeekTotal: 50, lastWeekKey: weekKeyOf(NOW) }
    });
    h.review(4);                                   // A: thẻ New, Easy ⇒ +5 XP, sang ngày mới
    assert.equal(h.g.stats.xpToday, 5, 'A phải reset ngày rồi cộng 5');
    assert.equal(h.g.stats.lastXPDate, day(NOW));
    trackXP(h.g.stats, 7, NOW + 60000);            // B
    assert.equal(h.g.stats.xpToday, 12);
    await h.undo();
    assert.equal(h.g.stats.xpToday, 7, 'Undo A phải để lại đúng phần của B');
    assert.equal(h.g.stats.lastXPDate, day(NOW), 'không được kéo mốc ngày về hôm qua');
    trackXP(h.g.stats, 1, NOW + 120000);
    assert.equal(h.g.stats.xpToday, 8);
});

test('R3.2: phần đóng góp tách khỏi chuyển kỳ (bảng nhỏ)', () => {
    // Sang kỳ ngay trong lượt: before 50, after 5 ⇒ đóng góp 5.
    assert.equal(counterContribution('xpToday', { before: 50, after: 5 }, {
        keyBefore: '2026-11-02', keyAfter: '2026-11-03', keyNow: '2026-11-03'
    }), 5);
    // Không sang kỳ: before 40, after 45 ⇒ đóng góp 5.
    assert.equal(counterContribution('xpToday', { before: 40, after: 45 }, {
        keyBefore: '2026-11-03', keyAfter: '2026-11-03', keyNow: '2026-11-03'
    }), 5);
    // Kỳ đã đổi TIẾP sau lượt chấm ⇒ không hoàn (null).
    assert.equal(counterContribution('xpToday', { before: 50, after: 5 }, {
        keyBefore: '2026-11-02', keyAfter: '2026-11-03', keyNow: '2026-11-04'
    }), null);
    // Không có khoá kỳ (log cũ) nhưng bộ đếm bị reset ⇒ vẫn nhận ra nhờ giá trị giảm.
    assert.equal(counterContribution('monthlyTotal', { before: 40, after: 1 }, {}), 1);
    // Bộ đếm không theo kỳ: đóng góp = after − before.
    assert.equal(counterContribution('easyPresses', { before: 2, after: 3 }, {}), 1);
});

// ───────────────────────── Tuần và tháng ─────────────────────────
test('R3.2: sang TUẦN mới — Undo chỉ trừ phần A, giữ nguyên phần B và mốc tuần', () => {
    const stats = ensureStats({});
    const lastWeek = NOW - 8 * DAY;
    trackXP(stats, 100, lastWeek);
    assert.equal(stats.lastWeekKey, weekKeyOf(lastWeek));
    const snapshot = snapshotReviewStats(stats, day(NOW));
    trackXP(stats, 5, NOW);                        // A: sang tuần mới ⇒ xpWeekTotal reset rồi +5
    const changes = diffReviewStats(snapshot, stats);
    assert.equal(stats.xpWeekTotal, 5);
    assert.equal(stats.xpLastWeek, 100, 'chốt sổ tuần trước phải là 100');
    trackXP(stats, 7, NOW + 60000);                // B
    revertReviewStats(stats, snapshot, changes, day(NOW));
    assert.equal(stats.xpWeekTotal, 7, 'tuần này còn đúng 7 của B');
    assert.equal(stats.xpLastWeek, 100, 'không được xoá giá trị chốt sổ tuần trước');
    assert.equal(stats.lastWeekKey, weekKeyOf(NOW), 'mốc tuần không bị kéo lùi');
});

test('R3.2: sang THÁNG mới — Undo chỉ trừ phần A (trackReview thật)', () => {
    const lastMonth = new Date(2026, 9, 20, 12, 0).getTime();   // 20/10
    const stats = ensureStats({ monthlyTotal: 40, monthlyCorrect: 30, lastMonthlyKey: monthKeyOf(lastMonth) });
    const snapshot = snapshotReviewStats(stats, day(NOW));      // chụp TRƯỚC lượt A
    trackReview({ stats, card: { srsStatus: 'Learning', lapses: 0 }, updatedCard: { srsStatus: 'Learning' }, rating: 3, now: NOW });
    assert.equal(stats.monthlyTotal, 1, 'tháng mới: reset rồi +1');
    assert.equal(stats.monthlyCorrect, 1);
    const changes = diffReviewStats(snapshot, stats);
    // B: ba lượt khác trong cùng tháng mới.
    stats.monthlyTotal += 3;
    stats.monthlyCorrect += 3;
    revertReviewStats(stats, snapshot, changes, day(NOW));
    assert.equal(stats.monthlyTotal, 3, 'chỉ trừ lượt A, không trừ 40 của tháng trước');
    assert.equal(stats.monthlyCorrect, 3);
    assert.equal(stats.lastMonthlyKey, monthKeyOf(NOW), 'mốc tháng ở lại tháng mới');
});

test('R3.2: rollover xảy ra SAU lượt chấm ⇒ không trừ vào bộ đếm của kỳ mới', () => {
    const stats = ensureStats({});
    trackXP(stats, 5, NOW);
    const snapshot = snapshotReviewStats(stats, day(NOW));
    trackXP(stats, 5, NOW);                        // A
    const changes = diffReviewStats(snapshot, stats);
    // Sang ngày mới, bộ đếm của ngày mới = 3 (không liên quan A).
    stats.xpToday = 3; stats.lastXPDate = day(NOW + DAY);
    revertReviewStats(stats, snapshot, changes, day(NOW + DAY));
    assert.equal(stats.xpToday, 3, 'không được trừ vào xpToday của ngày mới');
});

// ───────────────────────── Combo ─────────────────────────
test('R3.2: combo thay đổi SAU lượt chấm thì Undo không ghi đè', async () => {
    const h = makeHarness({ card: newCard({ id: 'combo1', srsStatus: 'Learning', reps: 1, learningStep: 0 }) });
    h.review(3);
    assert.equal(h.g.consecutiveCorrect, 1, 'lượt đúng đầu tiên');
    assert.equal(h.snapshot().comboAfter, 1, 'snapshot phải ghi combo SAU lượt chấm');
    // Một lượt đúng khác (tab khác) làm combo thành 2.
    h.g.consecutiveCorrect = 2;
    await h.undo();
    assert.equal(h.g.consecutiveCorrect, 2, 'không được kéo combo về 0 khi nơi khác đã đổi');
});

test('R3.2: combo chưa bị ai đổi thì Undo vẫn khôi phục đúng', async () => {
    const h = makeHarness({ card: newCard({ id: 'combo2', srsStatus: 'Learning', reps: 1, learningStep: 0 }), gamification: { consecutiveCorrect: 5 } });
    h.review(3);
    assert.equal(h.g.consecutiveCorrect, 6);
    await h.undo();
    assert.equal(h.g.consecutiveCorrect, 5);
});

// ───────────────────────── Đường gõ: evaluateTyping → chấm → Undo ─────────────────────────
test('R3.2: evaluateTyping KHÔNG tự cộng thống kê (chỉ chấm xong mới cộng)', () => {
    const stats = ensureStats({});
    startTypingTimer();
    const result = evaluateTyping('apple', 'apple');
    assert.equal(result.rating, 4, 'gõ đúng nhanh ⇒ Easy');
    assert.equal(result.status, 'perfect_fast');
    // Chưa chấm thì chưa có thành tích nào — đây là điều kiện để Undo hoàn được.
    assert.equal(stats.typingTotalCorrect || 0, 0);
    assert.equal(stats.typingFastAnswers || 0, 0);
});

test('R3.2: gõ đúng → chấm → Undo hoàn đúng từng bộ đếm của câu đó; làm lại không nhân đôi', async () => {
    startTypingTimer();
    const answer = evaluateTyping('apple', 'apple');
    const h = makeHarness({ card: newCard({ id: 'type1' }), typing: true });
    h.review(answer.rating);
    assert.equal(h.g.stats.typingTotalCorrect, 1, 'câu đúng được tính một lần');
    assert.equal(h.g.stats.typingFastAnswers, 1, 'câu đúng nhanh được tính một lần');
    assert.equal(h.g.stats.xpToday > 0, true);

    await h.undo();
    assert.equal(h.g.stats.typingTotalCorrect || 0, 0, 'Undo phải hoàn thành tích của câu đã trả lời');
    assert.equal(h.g.stats.typingFastAnswers || 0, 0);
    assert.equal(h.g.stats.xpToday, 0);

    // Làm lại ĐÚNG MỘT câu ⇒ thành tích của câu đó không bị nhân đôi.
    h.review(answer.rating);
    assert.equal(h.g.stats.typingTotalCorrect, 1);
    assert.equal(h.g.stats.typingFastAnswers, 1);
    assert.equal(h.g.stats.easyPresses, 1);
});

test('R3.2: câu gõ bị CHẶN ngân sách không được tính thành tích', () => {
    startTypingTimer();
    const answer = evaluateTyping('apple', 'apple');
    const h = makeHarness({
        card: newCard({ id: 'type2' }), typing: true,
        budget: { limit: 10, used: 10, reserved: 0, remaining: 0 }
    });
    h.review(answer.rating);
    assert.equal(h.logs.length, 0);
    assert.equal(h.g.stats.typingTotalCorrect || 0, 0, 'lượt không được ghi thì không tính công');
    assert.equal(h.g.stats.typingFastAnswers || 0, 0);
});

test('R3.2: sự kiện CHỈ đo thao tác gõ vẫn giữ chính sách riêng (không gắn với câu trả lời)', () => {
    // typingLastCharTypo / typingTypoStreaks / typingShortWordTypo được cộng ngay trong
    // evaluateTyping ở nhánh SAI (xem src/features/typing.js). Chúng đo thao tác gõ, không phải
    // thành tích của một câu đã chấm, nên KHÔNG nằm trong COUNTER_KEYS hoàn tác.
    const stats = ensureStats({});
    const snapshot = snapshotReviewStats(stats, day(NOW));
    stats.typingTypoStreaks = 1;
    const changes = diffReviewStats(snapshot, stats);
    assert.ok(changes.unclassified.includes('typingTypoStreaks'), 'không bị hoàn, nhưng phải được báo là chưa phân loại');
    revertReviewStats(stats, snapshot, changes, day(NOW));
    assert.equal(stats.typingTypoStreaks, 1, 'giữ nguyên theo chính sách hiện tại');
});
