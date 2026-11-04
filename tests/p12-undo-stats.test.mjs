import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revertReviewStats } from '../src/core/stats-rollback.js';
import { ensureStats, trackXP } from '../src/features/stat-trackers.js';
import { getLocalDateString } from '../src/core/utils/date.js';
import { makeHarness, sourceOf, newCard, NOW } from './helpers/review-harness.mjs';
test('vị trí chụp snapshot: TRƯỚC trackEvent và addXP trong chính handler', () => {
    // Đây là kiểm tra VỊ TRÍ NỐI — đúng thứ mà test cũ (chụp trước trackReview) không bảo vệ được.
    const body = sourceOf('src/events.js', 'function processSrsFeedback(', '\nasync function switchCardWithAnimation');
    const snap = body.indexOf('snapshotReviewStats(');
    assert.ok(snap > 0, 'handler phải chụp thống kê');
    assert.ok(snap < body.indexOf("trackEvent('easyPresses')"), 'phải chụp TRƯỚC trackEvent');
    assert.ok(snap < body.indexOf('addXP('), 'phải chụp TRƯỚC addXP (addXP gọi trackXP)');
    assert.ok(snap < body.indexOf('trackHourBonus('), 'phải chụp TRƯỚC trackHourBonus');
    assert.ok(snap < body.indexOf('trackReview('), 'phải chụp TRƯỚC trackReview');
    // Và delta được lấy ở CUỐI, sau khi mọi thứ đã chạy.
    assert.ok(body.indexOf('diffReviewStats(statsBefore') > body.indexOf('trackReview('));
});

test('Undo hoàn ĐỦ easyPresses, xpToday, xpWeekTotal và userXP (ca chấm Easy thẻ New)', async () => {
    const h = makeHarness({ card: newCard() });
    h.review(4);
    assert.equal(h.g.userXP, 5, 'Easy thẻ New được 5 XP');
    assert.equal(h.g.stats.easyPresses, 1);
    assert.equal(h.g.stats.xpToday, 5);
    assert.equal(h.g.stats.xpWeekTotal, 5);
    assert.equal(h.g.totalReviews, 1);
    assert.equal(h.d.newCardsDoneToday, 1);

    await h.undo();
    assert.equal(h.g.userXP, 0, 'XP phải về 0');
    assert.equal(h.g.stats.easyPresses, 0, 'easyPresses phải được hoàn');
    assert.equal(h.g.stats.xpToday, 0, 'xpToday phải được hoàn');
    assert.equal(h.g.stats.xpWeekTotal, 0, 'xpWeekTotal phải được hoàn');
    assert.equal(h.g.totalReviews, 0);
    assert.equal(h.d.newCardsDoneToday, 0, 'suất ngân sách phải được hoàn');
});

test('Undo hoàn cả hardPresses và bộ đếm của trackReview', async () => {
    const h = makeHarness({ card: newCard({ srsStatus: 'Learning', reps: 2, learningStep: 1, lapses: 0 }) });
    const keys = ['accidentCount', 'monthlyTotal', 'reviewsOnLastDay', 'totalTimeSpent', 'consecutiveEasy', 'typingNoHintStreak', 'lastReviewAt'];
    const before = {};
    for (const key of keys) before[key] = h.g.stats[key];
    h.review(2);
    assert.equal(h.g.stats.hardPresses, 1);
    assert.equal(h.g.stats.monthlyTotal, 1);
    await h.undo();
    assert.equal(h.g.stats.hardPresses, 0);
    assert.equal(h.g.stats.monthlyTotal, 0);
    for (const key of keys) assert.equal(h.g.stats[key], before[key], `${key} phải trở lại giá trị ban đầu`);
});

test('Undo rồi làm lại bằng ĐÚNG một lượt (không nhân đôi, không âm)', async () => {
    const h = makeHarness({ card: newCard({ id: 'c2', srsStatus: 'Learning', reps: 1, learningStep: 0 }) });
    h.review(3);
    const once = { xp: h.g.stats.xpToday, easy: h.g.stats.easyPresses, monthly: h.g.stats.monthlyTotal };
    assert.ok(once.xp > 0);
    await h.undo();
    assert.equal(h.g.stats.xpToday, 0);
    // Làm lại: phải bằng đúng một lượt, không cộng dồn phần đã hủy.
    h.review(3);
    assert.equal(h.g.stats.xpToday, once.xp);
    assert.equal(h.g.stats.monthlyTotal, once.monthly);
    assert.equal(h.g.stats.easyPresses || 0, 0, 'rating 3 không được cộng easyPresses');
});

test('nhiều vòng Undo/làm lại không tích thành tích từ lượt đã hủy', async () => {
    const h = makeHarness({ card: newCard({ id: 'c3', srsStatus: 'Learning', reps: 1, learningStep: 0 }) });
    for (let i = 0; i < 6; i++) {
        h.review(3);
        await h.undo();
    }
    assert.equal(h.g.stats.xpToday, 0);
    assert.equal(h.g.stats.xpWeekTotal, 0);
    assert.equal(h.g.stats.monthlyTotal, 0);
    assert.equal(h.g.stats.reviewsOnLastDay, 0);
    assert.equal(h.g.totalReviews, 0);
    assert.equal(h.g.userXP, 0);
    assert.equal(h.d.newCardsDoneToday, 0);
    assert.equal(h.d.todayTotal, 0);
});

test('hoạt động hợp lệ từ "tab khác" xen giữa vẫn còn (chỉ trừ phần của lượt bị hủy)', async () => {
    const d = new Date(NOW);
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    // Tuần hiện tại phải khớp, nếu không `trackXP` sẽ rollover tuần và reset cả xpToday (đúng
    // hành vi sản phẩm, nhưng không phải thứ test này đo).
    const weekKey = trackXP(ensureStats({}), 0, NOW).lastWeekKey;
    const h = makeHarness({ card: newCard({ id: 'c4' }),
        stats: { monthlyTotal: 7, xpToday: 40, lastMonthlyKey: monthKey, lastXPDate: getLocalDateString(NOW), lastWeekKey: weekKey } });
    h.review(4);
    assert.equal(h.g.stats.monthlyTotal, 8);
    // Tab khác vừa chấm thêm 3 lượt và +12 XP trong lúc chờ Undo.
    h.g.stats.monthlyTotal += 3;
    h.g.stats.xpToday += 12;
    await h.undo();
    assert.equal(h.g.stats.monthlyTotal, 10, 'phần của tab khác phải còn (7 + 3)');
    assert.equal(h.g.stats.xpToday, 52, 'phần XP của tab khác phải còn (40 + 12)');
    assert.equal(h.g.stats.easyPresses, 0, 'easyPresses của lượt bị hủy vẫn phải hoàn');
});

test('mốc thời gian/streak: chỉ khôi phục khi chưa bị nơi khác ghi sau', async () => {
    const h = makeHarness({ card: newCard({ id: 'c5', srsStatus: 'Learning', reps: 1, learningStep: 0 }) });
    const before = h.g.stats.lastReviewAt;
    h.review(3);
    const written = h.g.stats.lastReviewAt;
    assert.notEqual(written, before);
    // Nơi khác ghi mốc mới hơn ⇒ Undo KHÔNG được kéo lùi mốc đó.
    h.g.stats.lastReviewAt = written + 5000;
    await h.undo();
    assert.equal(h.g.stats.lastReviewAt, written + 5000, 'không được ghi đè mốc mới hơn của nơi khác');
});

test('rollover qua nửa đêm: bộ đếm của NGÀY MỚI không bị trừ', async () => {
    const h = makeHarness({ card: newCard({ id: 'c6' }) });
    h.review(4);
    const snapshot = h.snapshot();
    // Ngày mới: các bộ đếm theo ngày đã được rollover (giá trị thuộc ngày mới).
    h.g.stats.xpToday = 0;
    h.g.stats.lastXPDate = '2026-11-04';
    h.d.lastDate = '2026-11-04';
    h.d.todayTotal = 0;
    // Undo được gọi với dayKey của ngày mới (getLocalDateString trong harness là ngày chụp, nên
    // gọi trực tiếp hàm thuần để mô phỏng đúng ranh giới ngày).
    revertReviewStats(h.g.stats, snapshot.statsBefore, snapshot.statsDelta, '2026-11-04');
    assert.equal(h.g.stats.xpToday, 0, 'không được trừ vào xpToday của ngày mới');
    assert.equal(h.g.stats.easyPresses, 0, 'bộ đếm toàn thời gian vẫn phải hoàn');
});

test('level-up trong lượt chấm: justLeveledUp được hoàn khi Undo', async () => {
    // 99 XP: cộng 5 XP của lượt này vượt mốc để trackLevelUp ghi justLeveledUp.
    const h = makeHarness({ card: newCard({ id: 'c7' }), gamification: { userXP: 99 } });
    h.review(4);
    assert.ok(Number(h.g.stats.justLeveledUp) > 0, 'lượt này phải ghi mốc lên cấp');
    await h.undo();
    assert.equal(h.g.stats.justLeveledUp || 0, 0, 'Undo phải hoàn mốc lên cấp do chính lượt này ghi');
});
