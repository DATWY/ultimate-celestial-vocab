// tests/p11-training-and-undo-stats.test.mjs
//
// Regression cho:
//  (6) Trainer cắt im lặng 6.000 lượt rồi coi "lượt đầu còn giữ" là lần chạm đầu đời của thẻ,
//      nên cả train lẫn holdout chấm trên bộ nhớ được dựng sai. Nay chuỗi bị cắt bị loại khỏi
//      việc chấm loss, và nếu KHÔNG còn chuỗi nào chứng minh được điểm bắt đầu thì optimizer
//      TỪ CHỐI áp dụng và nói rõ lý do.
//  (7) Undo chỉ lùi 2/15 khoá gamification.stats ⇒ hoàn tác rồi làm lại vẫn cộng dồn thành tích.
//      Nay snapshot giữ DELTA các khoá số nên hoàn lại đúng phần của lượt đó, không ghi đè
//      hoạt động hợp lệ từ tab/thiết bị khác.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareTrainingData, optimizeParameters, evaluateParameters } from '../src/core/srs/training.js';
import { DEFAULT_FSRS7_PARAMS } from '../src/core/srs/constants.js';
import { snapshotNumericStats, diffNumericStats, revertNumericStats } from '../src/core/card-merge.js';
import { trackReview, trackHourBonus } from '../src/features/stat-trackers.js';

const NOW = new Date(2026, 10, 3, 15, 0).getTime();
const DAY = 86400000;

// ───────────────────────── (6) Dữ liệu trainer đáng tin hay không ─────────────────────────
test('chuỗi bắt đầu thật (t = 0) được giữ, chuỗi đã bị cắt (t > 0) bị loại khỏi chấm loss', () => {
    const logs = [
        // Thẻ 'full': lần đầu đời t = 0 ⇒ tái dựng được.
        { id: 'f1', cardId: 'full', rating: 3, t: 0, ts: NOW - 3 * DAY },
        { id: 'f2', cardId: 'full', rating: 3, t: 1, ts: NOW - 2 * DAY },
        { id: 'f3', cardId: 'full', rating: 2, t: 1, ts: NOW - DAY },
        // Thẻ 'cut': lượt đầu còn giữ đã có t = 12 ngày ⇒ thẻ đã tồn tại từ trước, mất prefix.
        { id: 'c1', cardId: 'cut', rating: 3, t: 12, ts: NOW - 2 * DAY },
        { id: 'c2', cardId: 'cut', rating: 3, t: 1, ts: NOW - DAY },
    ];
    const data = prepareTrainingData(logs, []);
    const ids = data.cards.map(card => card.id);
    assert.deepEqual(ids, ['full'], 'chỉ chuỗi có điểm bắt đầu xác minh được mới được dùng');
    assert.equal(data.truncatedChains, 1);
    assert.equal(data.totalChains, 2);
    assert.equal(data.historyComplete, false);
});

test('AUDIT-R2.5: t = 0 KHÔNG đủ để gọi chuỗi là đã xác minh; chỉ cờ first của engine mới đủ', () => {
    const logs = [];
    for (let id = 0; id < 3; id++) {
        logs.push({ id: `${id}-a`, cardId: `c${id}`, rating: 3, t: 0, ts: NOW - 2 * DAY + id * 1000 });
        logs.push({ id: `${id}-b`, cardId: `c${id}`, rating: 3, t: 1, ts: NOW - DAY + id * 1000 });
    }
    // Log legacy (không có cờ): chuỗi vẫn dùng được nhưng KHÔNG được gọi là đầy đủ/xác minh.
    const legacy = prepareTrainingData(logs, []);
    assert.equal(legacy.cards.length, 3);
    assert.equal(legacy.truncatedChains, 0);
    assert.equal(legacy.logTrimmed, false);
    assert.equal(legacy.verifiedChains, 0);
    assert.equal(legacy.assumedStartChains, 3);
    assert.equal(legacy.historyComplete, false, 't = 0 không phải bằng chứng lượt đầu đời');

    // Cùng dữ liệu nhưng có cờ first do engine ghi ⇒ đã xác minh.
    const marked = logs.map(log => log.id.endsWith('-a') ? { ...log, first: true } : log);
    const verified = prepareTrainingData(marked, []);
    assert.equal(verified.verifiedChains, 3);
    assert.equal(verified.assumedStartChains, 0);
    assert.equal(verified.historyComplete, true);
});

test('vượt 6.000 lượt thì bị đánh dấu logTrimmed (không còn cắt im lặng)', () => {
    const logs = [];
    for (let i = 0; i < 6100; i++) {
        logs.push({ id: `l${i}`, cardId: `c${i % 40}`, rating: 3, t: i % 40 === 0 ? 0 : 1, ts: NOW - (6100 - i) * 1000 });
    }
    const data = prepareTrainingData(logs, []);
    assert.equal(data.logTrimmed, true);
    assert.equal(data.rawCount, 6100);
    assert.equal(data.count, 6000);
});

test('optimizer TỪ CHỐI áp dụng khi mọi chuỗi đều bị cắt, và nói rõ lý do', () => {
    // Dựng dữ liệu "trông như đủ nhiều" nhưng mọi chuỗi đều bắt đầu giữa dòng đời thẻ.
    const logs = [];
    for (let id = 0; id < 80; id++) {
        for (let r = 0; r < 10; r++) {
            logs.push({ id: `${id}-${r}`, cardId: `c${id}`, rating: 3, t: 5, ts: NOW - (10 - r) * DAY + id * 1000 });
        }
    }
    const result = optimizeParameters(logs, [], DEFAULT_FSRS7_PARAMS, { iterations: 1, budgetMs: 2000 });
    assert.equal(result.improved, false);
    assert.equal(result.reason, 'truncated-history');
    assert.equal(result.scoredChains, 0);
    assert.equal(result.truncatedChains, 80);
});

test('dữ liệu có chuỗi đầy đủ vẫn tối ưu được như trước (không chặn oan)', () => {
    const logs = [];
    for (let r = 0; r < 8; r++) {
        for (let id = 0; id < 60; id++) {
            logs.push({ id: `${id}-${r}`, cardId: String(id), rating: r && (id + r) % 5 === 0 ? 1 : 3,
                t: r ? 1 : 0, ts: NOW - (8 - r) * DAY + id * 1000 });
        }
    }
    const data = prepareTrainingData(logs, []);
    assert.equal(data.truncatedChains, 0);
    assert.equal(data.cards.length, 60);
    assert.ok(evaluateParameters(data, DEFAULT_FSRS7_PARAMS).count > 0);
});

// ───────────────────────────── (7) Undo hoàn đúng stats ─────────────────────────────
test('delta stats: hoàn tác chỉ trừ phần của lượt đó, giữ nguyên hoạt động của "tab khác"', () => {
    const stats = { accidentCount: 2, monthlyTotal: 10, leechesHealed: 1, xpToday: 50 };
    const before = snapshotNumericStats(stats);
    // Mô phỏng một lượt chấm: trackReview + trackHourBonus.
    trackReview({ stats, card: { srsStatus: 'Learning', srsDueDate: NOW - DAY, lapses: 4 },
        updatedCard: { srsStatus: 'Mastered' }, rating: 1, now: NOW });
    trackHourBonus(stats, NOW);
    const delta = diffNumericStats(before, stats);
    assert.ok(Object.keys(delta).length > 0, 'phải ghi nhận được thay đổi');

    // Trong lúc đó một tab khác cộng thêm hợp lệ.
    stats.monthlyTotal += 5;
    stats.accidentCount += 1;

    revertNumericStats(stats, delta);
    assert.equal(stats.accidentCount, 3, 'chỉ trừ 1 của lượt bị Undo, phần của tab khác còn nguyên');
    assert.equal(stats.monthlyTotal, 10 + 5, 'không ghi đè hoạt động hợp lệ từ nơi khác');
    assert.equal(stats.leechesHealed, 1, 'không đụng khoá không đổi');
});

test('Undo rồi làm lại không cộng dồn thành tích (kể cả bộ đếm do ensureStats tạo trong lượt)', () => {
    const card = { srsStatus: 'Learning', srsDueDate: NOW - DAY, lapses: 4 };
    const updatedCard = { srsStatus: 'Mastered' };
    const stats = { accidentCount: 0, monthlyTotal: 0, totalTimeSpent: 0 };
    const snapshotOf = () => ({
        accidentCount: stats.accidentCount, monthlyTotal: stats.monthlyTotal,
        totalTimeSpent: stats.totalTimeSpent, leechesHealed: stats.leechesHealed,
        reviewsOnLastDay: stats.reviewsOnLastDay, lapseCounterProbe: stats.overdueReviewedToday
    });

    let before = snapshotNumericStats(stats);
    trackReview({ stats, card, updatedCard, rating: 1, now: NOW });
    const afterFirstReview = snapshotOf();
    assert.equal(afterFirstReview.accidentCount, 1);
    assert.equal(afterFirstReview.leechesHealed, 1, 'thẻ leech tốt nghiệp ⇒ bộ đếm này tăng');

    revertNumericStats(stats, diffNumericStats(before, stats));
    assert.equal(stats.accidentCount, 0, 'Undo phải lùi accidentCount');
    assert.equal(stats.monthlyTotal, 0);
    assert.equal(stats.totalTimeSpent, 0);
    assert.equal(stats.leechesHealed, 0, 'bộ đếm được ensureStats tạo trong lượt chấm cũng phải hoàn');
    assert.equal(stats.reviewsOnLastDay, 0);

    // Làm lại đúng lượt đó: kết quả phải Y HỆT lần đầu, không nhân đôi.
    before = snapshotNumericStats(stats);
    trackReview({ stats, card, updatedCard, rating: 1, now: NOW });
    assert.deepEqual(snapshotOf(), afterFirstReview, 'Undo + làm lại phải bằng đúng một lượt');
});

test('kéo dài chuỗi Undo/làm lại nhiều vòng không làm phình bộ đếm', () => {
    const stats = { accidentCount: 0, monthlyTotal: 0 };
    const card = { srsStatus: 'Learning', srsDueDate: NOW - DAY, lapses: 4 };
    for (let i = 0; i < 5; i++) {
        const before = snapshotNumericStats(stats);
        trackReview({ stats, card, updatedCard: { srsStatus: 'Mastered' }, rating: 1, now: NOW });
        revertNumericStats(stats, diffNumericStats(before, stats));
    }
    assert.equal(stats.accidentCount, 0, 'sau 5 vòng Undo, accidentCount phải về 0');
    assert.equal(stats.monthlyTotal, 0);
});

test('delta bỏ qua khoá mốc dạng CHUỖI nhưng hoàn được mốc dạng số', () => {
    const stats = { lastMonthlyKey: '2026-11', lastForgottenDate: 0, accidentCount: 0 };
    const before = snapshotNumericStats(stats);
    stats.lastMonthlyKey = '2026-12';   // khoá chuỗi: không trừ ngược được ⇒ bỏ qua
    stats.lastForgottenDate = NOW;      // khoá số: hoàn lại được
    stats.accidentCount = 1;
    const delta = diffNumericStats(before, stats);
    assert.equal(Object.hasOwn(delta, 'lastMonthlyKey'), false);
    assert.equal(delta.lastForgottenDate, NOW);
    assert.equal(delta.accidentCount, 1);
    revertNumericStats(stats, delta);
    assert.equal(stats.lastForgottenDate, 0, 'mốc số phải trở lại giá trị trước lượt chấm');
});
