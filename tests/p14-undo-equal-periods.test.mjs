// tests/p14-undo-equal-periods.test.mjs
//
// AUDIT-R4.1 — Undo bỏ sót XP khi chuyển kỳ mà giá trị TRƯỚC và SAU bằng nhau.
//
// `diffReviewStats` có `if (next === prev) continue;` chạy TRƯỚC khi xét khoá kỳ. Hai số cùng bằng
// 5 nhưng thuộc hai ngày khác nhau là hai khoản XP khác nhau: hôm qua 5 XP, hôm nay lượt A kiếm 5
// XP ⇒ `xpToday` 5 → 5 nhưng `lastXPDate` đã đổi. Bản lỗi bỏ qua thay đổi này nên Undo A không trừ
// gì, và số của B (7) bị tính lẫn.
//
// Ca chuẩn (yêu cầu): hôm qua 5 → A +5 (bằng số) → B +7 → Undo A ⇒ 7, `lastXPDate` vẫn hôm nay;
// +1 ⇒ 8. Kiểm cả bộ đếm tuần khi hai ngày cùng tuần, và ca đối chứng (cùng kỳ, không đổi số).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    snapshotReviewStats, diffReviewStats, revertReviewStats
} from '../src/core/stats-rollback.js';
import { ensureStats, trackXP, trackReview } from '../src/features/stat-trackers.js';
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

// ───────────────────── Ca chuẩn: bằng số qua NGÀY (hàm thuần, trackXP thật) ─────────────────────
test('R4.1: 5 XP hôm qua, A +5 (bằng số) hôm nay, B +7, Undo A ⇒ 7 rồi +1 ⇒ 8', () => {
    const stats = ensureStats({});
    trackXP(stats, 5, YESTERDAY);                       // hôm qua: 5
    assert.equal(stats.xpToday, 5);

    const snapshot = snapshotReviewStats(stats, day(NOW));
    trackXP(stats, 5, NOW);                             // A: sang ngày mới, reset rồi +5 ⇒ 5 (BẰNG số)
    assert.equal(stats.xpToday, 5, 'điều kiện tái hiện: trước và sau A đều bằng 5');
    assert.equal(stats.lastXPDate, day(NOW), 'nhưng mốc ngày đã đổi');

    const changes = diffReviewStats(snapshot, stats);
    assert.ok(changes.counters.xpToday, 'A vẫn phải được ghi nhận là có đóng góp cho xpToday');

    trackXP(stats, 7, NOW + 60000);                     // B
    assert.equal(stats.xpToday, 12);

    revertReviewStats(stats, snapshot, changes, day(NOW));
    assert.equal(stats.xpToday, 7, 'Undo A phải để lại đúng 7 của B');
    assert.equal(stats.lastXPDate, day(NOW), 'mốc ngày phải ở lại hôm nay');

    trackXP(stats, 1, NOW + 120000);
    assert.equal(stats.xpToday, 8);
});

test('R4.1: cùng ca, đi qua CHÍNH handler chấm + Undo thật của ứng dụng', async () => {
    const h = makeHarness({
        card: newCard({ id: 'eq-day' }),
        stats: { xpToday: 5, lastXPDate: day(YESTERDAY), xpWeekTotal: 5, lastWeekKey: weekKeyOf(NOW), xpLastWeek: 0 }
    });
    h.review(4);                                        // A: Easy thẻ New ⇒ +5 XP, sang ngày mới
    assert.equal(h.g.stats.xpToday, 5, 'điều kiện tái hiện: 5 → 5');
    assert.equal(h.g.stats.lastXPDate, day(NOW));
    trackXP(h.g.stats, 7, NOW + 60000);                 // B
    assert.equal(h.g.stats.xpToday, 12);
    await h.undo();
    assert.equal(h.g.stats.xpToday, 7, 'Undo A không được để lại 12');
    assert.equal(h.g.stats.lastXPDate, day(NOW));
    trackXP(h.g.stats, 1, NOW + 120000);
    assert.equal(h.g.stats.xpToday, 8);
});

test('R4.1: bộ đếm TUẦN cũng đúng khi hai ngày cùng tuần (5 → 10 → 17 → Undo ⇒ 12)', () => {
    const stats = ensureStats({});
    trackXP(stats, 5, YESTERDAY);
    const snapshot = snapshotReviewStats(stats, day(NOW));
    trackXP(stats, 5, NOW);                             // A cùng tuần ⇒ xpWeekTotal 5 → 10
    const changes = diffReviewStats(snapshot, stats);
    trackXP(stats, 7, NOW + 60000);                     // B ⇒ 17
    revertReviewStats(stats, snapshot, changes, day(NOW));
    assert.equal(stats.xpWeekTotal, 12, 'tuần còn 5 của hôm qua + 7 của B');
    assert.equal(stats.xpToday, 7);
});

// ───────────────────── Bằng số qua TUẦN và qua THÁNG ─────────────────────
test('R4.1: sang TUẦN mới với giá trị BẰNG NHAU ⇒ Undo vẫn trừ đúng phần A', () => {
    const lastWeek = NOW - 8 * DAY;
    const stats = ensureStats({});
    trackXP(stats, 5, lastWeek);                        // tuần trước: 5
    const snapshot = snapshotReviewStats(stats, day(NOW));
    trackXP(stats, 5, NOW);                             // A: tuần mới, reset rồi +5 ⇒ xpWeekTotal 5 (BẰNG số)
    assert.equal(stats.xpWeekTotal, 5, 'điều kiện tái hiện: 5 → 5');
    assert.notEqual(stats.lastWeekKey, weekKeyOf(lastWeek));
    const changes = diffReviewStats(snapshot, stats);
    assert.ok(changes.counters.xpWeekTotal, 'A vẫn phải được ghi nhận cho xpWeekTotal');

    trackXP(stats, 7, NOW + 60000);                     // B ⇒ 12
    revertReviewStats(stats, snapshot, changes, day(NOW));
    assert.equal(stats.xpWeekTotal, 7, 'Undo A phải để lại đúng 7 của B');
    assert.equal(stats.lastWeekKey, weekKeyOf(NOW), 'mốc tuần không bị kéo lùi');
    assert.equal(stats.xpLastWeek, 5, 'giá trị chốt sổ tuần trước vẫn còn');
});

test('R4.1: sang THÁNG mới với giá trị BẰNG NHAU ⇒ Undo vẫn trừ đúng phần A (trackReview thật)', () => {
    const lastMonth = new Date(2026, 9, 20, 12, 0).getTime();
    const stats = ensureStats({ monthlyTotal: 1, monthlyCorrect: 1, lastMonthlyKey: monthKeyOf(lastMonth) });
    const snapshot = snapshotReviewStats(stats, day(NOW));
    trackReview({ stats, card: { srsStatus: 'Learning', lapses: 0 }, updatedCard: { srsStatus: 'Learning' }, rating: 3, now: NOW });
    assert.equal(stats.monthlyTotal, 1, 'điều kiện tái hiện: tháng trước 1, tháng này 1');
    assert.equal(stats.monthlyCorrect, 1);
    assert.equal(stats.lastMonthlyKey, monthKeyOf(NOW));
    const changes = diffReviewStats(snapshot, stats);
    assert.ok(changes.counters.monthlyTotal, 'A vẫn phải được ghi nhận cho monthlyTotal');

    stats.monthlyTotal += 2;                            // B: hai lượt nữa trong tháng mới
    stats.monthlyCorrect += 2;
    revertReviewStats(stats, snapshot, changes, day(NOW));
    assert.equal(stats.monthlyTotal, 2, 'Undo A phải để lại đúng 2 của B');
    assert.equal(stats.monthlyCorrect, 2);
    assert.equal(stats.lastMonthlyKey, monthKeyOf(NOW));
});

// ───────────────────── Ca đối chứng: cùng kỳ, không đổi số ⇒ không làm gì ─────────────────────
test('R4.1: cùng kỳ và số không đổi ⇒ không ghi nhận thay đổi, Undo giữ nguyên bộ đếm', () => {
    const stats = ensureStats({ xpToday: 5, lastXPDate: day(NOW), xpWeekTotal: 5, lastWeekKey: weekKeyOf(NOW) });
    const snapshot = snapshotReviewStats(stats, day(NOW));
    // Không có gì thay đổi (ví dụ lượt chấm không cộng XP nào).
    const changes = diffReviewStats(snapshot, stats);
    assert.deepEqual(Object.keys(changes.counters), [], 'không được ghi nhận đóng góp khi không có gì đổi');
    revertReviewStats(stats, snapshot, changes, day(NOW));
    assert.equal(stats.xpToday, 5);
    assert.equal(stats.xpWeekTotal, 5);
    assert.equal(stats.lastXPDate, day(NOW));
});

test('R4.1: cùng kỳ, số ĐỔI ⇒ vẫn hoàn đúng phần tăng (không hồi quy)', () => {
    const stats = ensureStats({ xpToday: 5, lastXPDate: day(NOW), xpWeekTotal: 5, lastWeekKey: weekKeyOf(NOW) });
    const snapshot = snapshotReviewStats(stats, day(NOW));
    trackXP(stats, 5, NOW);                             // cùng ngày ⇒ 5 → 10
    const changes = diffReviewStats(snapshot, stats);
    trackXP(stats, 7, NOW + 60000);                     // 17
    revertReviewStats(stats, snapshot, changes, day(NOW));
    assert.equal(stats.xpToday, 12);
});

// ───────────────────── Ca vòng 3 chạy lại (không hồi quy) ─────────────────────
test('R4.1 (vòng 3, chạy lại): 50 → A +5 → B +7 → Undo ⇒ 7 rồi +1 ⇒ 8', () => {
    const stats = ensureStats({});
    trackXP(stats, 50, YESTERDAY);
    const snapshot = snapshotReviewStats(stats, day(NOW));
    trackXP(stats, 5, NOW);
    const changes = diffReviewStats(snapshot, stats);
    trackXP(stats, 7, NOW + 60000);
    revertReviewStats(stats, snapshot, changes, day(NOW));
    assert.equal(stats.xpToday, 7);
    assert.equal(stats.lastXPDate, day(NOW));
    assert.equal(stats.xpWeekTotal, 57);
    trackXP(stats, 1, NOW + 120000);
    assert.equal(stats.xpToday, 8);
});
