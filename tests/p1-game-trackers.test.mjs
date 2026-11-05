// tests/p1-game-trackers.test.mjs — GAME-01.
//
// 25 khoá `gamification.stats` từng không có nơi ghi, khiến 33/80 huy hiệu đặc
// biệt không bao giờ mở được. Bộ test này khoá hành vi của từng bộ đếm (đều là
// hàm thuần, thời điểm truyền vào nên tái lập được):
//   • rollover theo ngày/tháng/tuần không cộng dồn sai;
//   • chuỗi theo giờ (chim sớm / cú đêm / hoàng hôn) đếm theo NGÀY, đứt là về 0;
//   • leech chữa được, ôn quá hạn, chuỗi bấm Dễ, "bỏ cuộc" (tạo rồi xoá < 60s);
//   • mất chuỗi, quay lại sau 7 ngày, lên cấp.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ensureStats,
    rolloverDailyStats,
    trackReview,
    trackXP,
    trackWordAdded,
    trackDeletion,
    trackDarkMode,
    trackHourBonus,
    trackStreakLoss,
    trackReturnAfterAbsence,
    trackLevelUp
} from '../src/features/stat-trackers.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// Mốc cố định: 12/03/2026 10:00 giờ máy (không phụ thuộc đồng hồ chạy test).
const T0 = new Date(2026, 2, 12, 10, 0, 0).getTime();

const fresh = () => ensureStats({});

test('trackReview: Quên ⇒ accident + ghi lastForgottenDate; Nhớ thì không', () => {
    const s = fresh();
    trackReview({
        stats: s,
        card: { srsStatus: 'Mastered', lapses: 1 },
        updatedCard: { srsStatus: 'Learning' },
        rating: 1,
        now: T0
    });
    assert.equal(s.accidentCount, 1);
    assert.equal(s.lastForgottenDate, T0, 'invincible cần mốc quên thật');

    trackReview({
        stats: s,
        card: { srsStatus: 'Learning' },
        updatedCard: { srsStatus: 'Learning' },
        rating: 3,
        now: T0 + 1000
    });
    assert.equal(s.accidentCount, 1, 'trả lời đúng không phải tai nạn');
    assert.equal(s.lastForgottenDate, T0);
});

test('trackReview: chuỗi bấm Dễ đứt khi bấm mức khác', () => {
    const s = fresh();
    for (let i = 0; i < 3; i++) trackReview({ stats: s, card: {}, updatedCard: {}, rating: 4, now: T0 + i });
    assert.equal(s.consecutiveEasy, 3);
    trackReview({ stats: s, card: {}, updatedCard: {}, rating: 3, now: T0 + 10 });
    assert.equal(s.consecutiveEasy, 0);
});

test('trackReview: tổng tháng rollover khi sang tháng mới', () => {
    const s = fresh();
    trackReview({ stats: s, card: {}, updatedCard: {}, rating: 3, now: new Date(2026, 2, 31, 23, 0).getTime() });
    trackReview({ stats: s, card: {}, updatedCard: {}, rating: 1, now: new Date(2026, 2, 31, 23, 5).getTime() });
    assert.equal(s.monthlyTotal, 2);
    assert.equal(s.monthlyCorrect, 1);

    trackReview({ stats: s, card: {}, updatedCard: {}, rating: 3, now: new Date(2026, 3, 1, 0, 5).getTime() });
    assert.equal(s.monthlyTotal, 1, 'tháng 4 phải bắt đầu lại');
    assert.equal(s.monthlyCorrect, 1);
});

test('trackReview: ôn thẻ quá hạn đếm theo ngày (firefighter)', () => {
    const s = fresh();
    const overdue = { srsDueDate: T0 - 3 * DAY };
    trackReview({ stats: s, card: overdue, updatedCard: {}, rating: 3, now: T0 });
    trackReview({ stats: s, card: overdue, updatedCard: {}, rating: 3, now: T0 + HOUR });
    assert.equal(s.overdueReviewedToday, 2);

    // Sang ngày mới: bộ đếm trong ngày phải reset.
    trackReview({ stats: s, card: overdue, updatedCard: {}, rating: 3, now: T0 + DAY });
    assert.equal(s.overdueReviewedToday, 1);
});

test('trackReview: chữa leech (lapses ≥ 4 nay Mastered) và chế độ gõ', () => {
    const s = fresh();
    trackReview({
        stats: s,
        card: { srsStatus: 'Learning', lapses: 4 },
        updatedCard: { srsStatus: 'Mastered' },
        rating: 3,
        now: T0
    });
    assert.equal(s.leechesHealed, 1, 'thẻ leech tốt nghiệp = chữa được 1 leech');

    const t = fresh();
    for (let i = 0; i < 5; i++) {
        trackReview({ stats: t, card: { isLeech: true }, updatedCard: {}, rating: 3, now: T0 + i, isTyping: true });
    }
    assert.equal(t.typingNoHintStreak, 5, 'gõ không dùng gợi ý thì chuỗi tăng');
    trackReview({ stats: t, card: {}, updatedCard: {}, rating: 3, now: T0 + 10, isTyping: true, hintUsed: true });
    assert.equal(t.typingNoHintStreak, 0, 'dùng gợi ý là đứt chuỗi');
    assert.equal(t.typingLeechRepeats, 5);
    trackReview({ stats: t, card: {}, updatedCard: {}, rating: 1, now: T0 + 20, isTyping: true, inputCleared: true });
    assert.equal(t.typingClearedInput, 1);
});

test('trackReview: totalTimeSpent cộng khoảng cách lượt nhưng chặn trần 2 phút', () => {
    const s = fresh();
    trackReview({ stats: s, card: {}, updatedCard: {}, rating: 3, now: T0 }); // lượt đầu: chưa có mốc trước
    trackReview({ stats: s, card: {}, updatedCard: {}, rating: 3, now: T0 + 30_000 }); // +30s
    assert.equal(s.totalTimeSpent, 30);
    trackReview({ stats: s, card: {}, updatedCard: {}, rating: 3, now: T0 + 30_000 + 10 * HOUR }); // treo máy
    assert.equal(s.totalTimeSpent, 150, 'mỗi lượt tối đa 120s để không tính giờ treo máy');
});

test('trackXP: xpToday theo ngày, xpLastWeek chốt khi sang tuần', () => {
    const s = fresh();
    trackXP(s, 500, T0);
    assert.equal(s.xpToday, 500);
    trackXP(s, 250, T0 + HOUR);
    assert.equal(s.xpToday, 750);

    // Ngày mới: xpToday reset nhưng KHÔNG đụng xpLastWeek (khác tuần mới chốt).
    const nextDay = T0 + DAY;
    trackXP(s, 100, nextDay);
    assert.equal(s.xpToday, 100);
    assert.equal(s.xpLastWeek, 0);

    // Sang tuần: tuần trước được chốt.
    const nextWeek = T0 + 8 * DAY;
    trackXP(s, 50, nextWeek);
    assert.ok(s.xpLastWeek > 0, 'mutant cần xpLastWeek > 100');
});

test('trackWordAdded: wordsAddedToday + nightOwlWords + reset chuỗi xoá', () => {
    const s = fresh();
    trackDeletion(s, null, T0);
    assert.equal(s.consecutiveDeletes, 1);
    trackWordAdded(s, new Date(2026, 2, 12, 2, 0).getTime());
    assert.equal(s.wordsAddedToday, 1);
    assert.equal(s.nightOwlWords, 1, '2 giờ sáng = thêm từ ban đêm');
    assert.equal(s.consecutiveDeletes, 0, 'thêm từ reset chuỗi xoá liên tiếp');

    trackWordAdded(s, T0 + DAY);
    assert.equal(s.wordsAddedToday, 1, 'sang ngày mới đếm lại');
});

test('trackDeletion: "bỏ cuộc" chỉ tính khi xoá từ VỪA TẠO (< 60 giây)', () => {
    const s = fresh();
    trackDeletion(s, { id: 'x', createdAt: T0 - 10_000 }, T0);
    assert.equal(s.giveUpCount, 1);
    trackDeletion(s, { id: 'y', createdAt: T0 - 10 * DAY }, T0);
    assert.equal(s.giveUpCount, 1, 'xoá từ cũ không phải bỏ cuộc');
    assert.equal(s.consecutiveDeletes, 2);
});

test('trackDarkMode: mỗi NGÀY chỉ đếm một lần', () => {
    const s = fresh();
    trackDarkMode(s, T0);
    trackDarkMode(s, T0 + HOUR);
    assert.equal(s.darkModeDays, 1);
    trackDarkMode(s, T0 + DAY);
    assert.equal(s.darkModeDays, 2);
});

test('trackHourBonus: chuỗi giờ tính theo ngày, đứt thì về 0', () => {
    const early = new Date(2026, 2, 12, 5, 0).getTime(); // 5h
    const s = fresh();
    trackHourBonus(s, early);
    assert.equal(s.earlyBirdStreak, 1);
    trackHourBonus(s, early + DAY); // hôm sau, cùng giờ
    assert.equal(s.earlyBirdStreak, 2, 'hai ngày liền nhau ⇒ chuỗi tăng');

    trackHourBonus(s, early + 5 * DAY); // cách 4 ngày ⇒ đứt
    assert.equal(s.earlyBirdStreak, 1);

    const night = new Date(2026, 2, 20, 23, 30).getTime();
    const n = fresh();
    trackHourBonus(n, night);
    assert.equal(n.vampireStreak, 1);
    assert.equal(n.earlyBirdStreak, 0);

    const sunset = new Date(2026, 2, 20, 18, 0).getTime();
    const d = fresh();
    trackHourBonus(d, sunset);
    assert.equal(d.sunsetStreak, 1);
});

test('trackHourBonus: trong cùng một ngày gọi nhiều lần không cộng dồn', () => {
    const s = fresh();
    const morning = new Date(2026, 2, 12, 5, 0).getTime();
    trackHourBonus(s, morning);
    trackHourBonus(s, morning + 3 * HOUR);
    assert.equal(s.earlyBirdStreak, 1);
});

test('trackStreakLoss / trackReturnAfterAbsence / trackLevelUp', () => {
    const s = fresh();
    trackStreakLoss(s, 30);
    trackStreakLoss(s, 12);
    assert.equal(s.maxLostStreak, 30, 'giữ chuỗi dài nhất từng mất');

    trackReturnAfterAbsence(s, '2026-03-01', new Date(2026, 2, 12, 10, 0).getTime());
    assert.equal(s.kingReturns, 1);
    trackReturnAfterAbsence(s, '2026-03-11', new Date(2026, 2, 12, 10, 0).getTime());
    assert.equal(s.kingReturns, 1, 'chỉ 1 ngày vắng thì không tính');

    trackLevelUp(s, T0);
    assert.equal(s.justLeveledUp, T0);
});

test('rolloverDailyStats: hôm qua học đúng hạn mức tối thiểu ⇒ bareMinimumDays++', () => {
    const s = fresh();
    s.lastOpenDate = '2026-03-11';
    s.reviewsOnLastDay = 20;
    rolloverDailyStats(s, '2026-03-12', 20);
    assert.equal(s.bareMinimumDays, 1);

    const t = fresh();
    t.lastOpenDate = '2026-03-11';
    t.reviewsOnLastDay = 40; // học nhiều hơn mức tối thiểu
    rolloverDailyStats(t, '2026-03-12', 20);
    assert.equal(t.bareMinimumDays, 0);
});

test('ensureStats: dữ liệu cũ thiếu khoá mới vẫn chạy (không NaN)', () => {
    const legacy = { accidentCount: 'rác', xpToday: undefined };
    const s = ensureStats(legacy);
    assert.equal(s.accidentCount, 0);
    assert.equal(s.xpToday, 0);
    assert.equal(typeof s.lastMonthlyKey, 'string');
});
