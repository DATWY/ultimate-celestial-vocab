import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FSRS7_PARAMS, S_MIN, S_MAX, MAX_INTERVAL_DAYS } from '../src/core/srs/constants.js';
import { initDifficulty, nextDifficulty } from '../src/core/srs/difficulty.js';
import { nextStability } from '../src/core/srs/stability.js';
import { dualTraceForgettingCurve, shortComponentRecall, nextIntervalNewton } from '../src/core/srs/forgetting.js';
import { calculateNextSrsState, predictNextIntervals } from '../src/core/srs/index.js';

const DAY_MS = 86400000;
const FIXED_NOW = 1_700_000_000_000;

/** Đổi nhãn badge ("<10p", "4d", "1.5th", "1n") ra số ngày để so với trần 365. */
function labelToDays(label) {
    if (label === '<10p') return 10 / 1440;
    if (label === '<1h') return 1 / 24;
    const match = /^([0-9]+(?:\.[0-9]+)?)(p|h|d|th|n)$/.exec(String(label));
    assert.ok(match, `Nhãn khoảng cách không đọc được: ${label}`);
    return Number(match[1]) * { p: 1 / 1440, h: 1 / 24, d: 1, th: 30, n: 365 }[match[2]];
}

test('FSRS-7 difficulty arithmetic and invariants', () => {
    // 1. Initial difficulty bounds for ratings 1..4
    const dAgain = initDifficulty(1);
    const dHard = initDifficulty(2);
    const dGood = initDifficulty(3);
    const dEasy = initDifficulty(4);
    
    assert.ok(dAgain >= dHard && dHard >= dGood && dGood >= dEasy, 'Harder ratings yield higher difficulty');
    assert.ok(dAgain <= 10 && dEasy >= 1, 'Initial difficulty stays within [1, 10]');

    // 2. NaN resilience
    assert.equal(typeof initDifficulty(NaN), 'number');
    assert.ok(!Number.isNaN(initDifficulty(NaN)));
    assert.equal(typeof nextDifficulty(NaN, 3, 0.9), 'number');
    assert.ok(!Number.isNaN(nextDifficulty(NaN, 3, 0.9)));

    // 3. Difficulty bounds under extreme ratings
    let highD = 10;
    for (let i = 0; i < 5; i++) {
        highD = nextDifficulty(highD, 1, 0.1);
    }
    assert.ok(highD <= 10, 'Difficulty clamped at 10');

    let lowD = 1;
    for (let i = 0; i < 5; i++) {
        lowD = nextDifficulty(lowD, 4, 0.99);
    }
    assert.ok(lowD >= 1, 'Difficulty clamped at 1');
});

test('FSRS-7 stability arithmetic and invariants', () => {
    // 1. NaN resilience
    const nanS = nextStability(NaN, 5, 0.9, 3, 7);
    assert.ok(!Number.isNaN(nanS));
    assert.ok(nanS >= S_MIN && nanS <= S_MAX);

    // 2. Monotonic recall stability growth: Good review increases stability
    const s0 = 10;
    const sGood = nextStability(s0, 5, 0.9, 3, 7);
    assert.ok(sGood > s0, `Good review must increase stability (s0=${s0}, sGood=${sGood})`);

    // 3. Lapse decay: Again rating significantly drops stability
    const sAgain = nextStability(s0, 5, 0.5, 1, 7);
    assert.ok(sAgain < s0, `Again review must decrease stability (s0=${s0}, sAgain=${sAgain})`);

    // 4. Clamping bounds
    const sExtreme = nextStability(S_MAX, 1, 0.99, 4, 7);
    assert.ok(sExtreme <= S_MAX, 'Stability must not exceed S_MAX');
});

test('FSRS-7 forgetting curve and Newton solver', () => {
    // 1. Boundary conditions
    const rAtZero = dualTraceForgettingCurve(0, 10, 8, 5);
    assert.ok(Math.abs(rAtZero - 1.0) < 1e-4, 'Retrievability at t=0 must be ~1.0');

    // 2. Monotonic decrease over elapsed days
    const r1 = dualTraceForgettingCurve(1, 10, 8, 5);
    const r5 = dualTraceForgettingCurve(5, 10, 8, 5);
    const r30 = dualTraceForgettingCurve(30, 10, 8, 5);
    assert.ok(r1 > r5 && r5 > r30, 'Forgetting curve must strictly decay with time');

    // 3. Newton solver accuracy: recovered interval should produce target retrievability
    const targetR = 0.9;
    const intervalDays = nextIntervalNewton(10, 8, 5, targetR);
    assert.ok(intervalDays > 0, 'Computed interval must be positive');
    
    const evaluatedR = dualTraceForgettingCurve(intervalDays, 10, 8, 5);
    assert.ok(Math.abs(evaluatedR - targetR) < 0.05, `Solver precision: evaluated R=${evaluatedR} should be close to target=${targetR}`);

    // 4. Solver bounds and NaN protection
    assert.equal(nextIntervalNewton(NaN, NaN, 5, 0.9), 1 / 86400);
});

test('calculateNextSrsState end-to-end arithmetic transitions', () => {
    const newCard = {
        id: 'arithmetic-test-1',
        english: 'quantum',
        vietnamese: 'lượng tử',
        srsStatus: 'New',
        reps: 0,
        lapses: 0,
        stability: 0,
        difficulty: 0
    };

    // First review Good: T1.1 — thẻ New vào bước học 10 phút, CHƯA tốt nghiệp Mastered
    const { newState: review1 } = calculateNextSrsState(newCard, 3, 'en-vi', 0, null, true, { now: FIXED_NOW });
    assert.equal(review1.srsStatus, 'Learning');
    assert.equal(review1.learningStep, 1);
    assert.equal(review1.reps, 1);
    assert.equal(review1.lapses, 0);
    assert.ok(review1.stability > 0);
    assert.ok(review1.difficulty >= 1 && review1.difficulty <= 10);
    assert.ok(Math.abs(review1.srsInterval - 10 / 1440) < 1e-9, 'Bước 1 phải là 10 phút');

    // Đi hết thang bước học (10 phút → 1 ngày) rồi mới tốt nghiệp Mastered
    const { newState: review2 } = calculateNextSrsState(review1, 3, 'en-vi', 0, null, true, { now: review1.srsDueDate });
    assert.equal(review2.srsStatus, 'Learning');
    assert.equal(review2.learningStep, 2);
    const { newState: review3 } = calculateNextSrsState(review2, 3, 'en-vi', 0, null, true, { now: review2.srsDueDate });
    assert.equal(review3.srsStatus, 'Mastered');
    assert.ok(review3.srsInterval >= 1, 'Graduated interval must be at least 1 day');

    // Lượt kế tiếp: Again (Lapse)
    const { newState: review4 } = calculateNextSrsState(review3, 1, 'en-vi', 0, null, true, { now: review3.srsDueDate });
    assert.equal(review4.srsStatus, 'Learning');
    assert.equal(review4.lapses, 1);
    assert.equal(review4.learningStep, 0, 'Lapse phải quay về bước học đầu tiên');
    assert.ok(review4.stability < review3.stability, 'Lapse must drop stability');
    assert.ok(review4.difficulty >= review3.difficulty, 'Lapse must increase difficulty');

    // Interval forecast
    const intervals = predictNextIntervals(review1, 'en-vi');
    assert.ok(intervals[1], 'Quên interval forecast must exist');
    assert.ok(intervals[2], 'Khó interval forecast must exist');
    assert.ok(intervals[3], 'Nhớ interval forecast must exist');
    assert.ok(intervals[4], 'Dễ interval forecast must exist');
});

test('T1.2: 20 lần Good liên tiếp không bao giờ vượt trần 365 ngày và không NaN', () => {
    let card = {
        id: 'chain', english: 'ubiquitous', srsStatus: 'Mastered', reps: 5, lapses: 0,
        stability: 10, stabilityShort: 8, difficulty: 5, srsInterval: 10,
        srsDueDate: FIXED_NOW, lastReviewDate: FIXED_NOW - 10 * DAY_MS
    };
    let clock = FIXED_NOW;
    const intervals = [];
    for (let i = 0; i < 20; i++) {
        // isSimulation = false => fuzz BẬT: đúng điều kiện cần clamp sau fuzz.
        const { newState } = calculateNextSrsState(card, 3, 'en-vi', 0, null, false, { now: clock });
        card = newState;
        intervals.push(newState.srsInterval);
        assert.ok(Number.isFinite(newState.srsInterval), `vòng ${i + 1}: interval phải là số hữu hạn, nhận ${newState.srsInterval}`);
        assert.ok(!Number.isNaN(newState.srsDueDate), `vòng ${i + 1}: srsDueDate không được NaN`);
        assert.ok(newState.srsInterval <= MAX_INTERVAL_DAYS, `vòng ${i + 1}: ${newState.srsInterval} ngày vượt trần ${MAX_INTERVAL_DAYS}`);
        assert.ok(newState.srsInterval >= 1, `vòng ${i + 1}: thẻ Mastered phải có interval >= 1 ngày`);
        assert.equal(newState.srsStatus, 'Mastered');
        clock = newState.srsDueDate;
    }
    // Trần phải thực sự có tác dụng (không phải chỉ vì FSRS tình cờ nhỏ).
    assert.ok(intervals.some(days => days === MAX_INTERVAL_DAYS), `Chuỗi interval phải chạm trần; nhận ${intervals.map(d => d.toFixed(1)).join(', ')}`);
    assert.ok(intervals[intervals.length - 1] <= MAX_INTERVAL_DAYS);
    assert.ok(intervals[intervals.length - 1] >= intervals[0], 'Interval phải tăng dần theo độ bền trí nhớ');
});

test('T1.2: predictNextIntervals của thẻ S rất lớn cũng không vượt 365 ngày', () => {
    const huge = {
        id: 'huge', english: 'cosmos', srsStatus: 'Mastered', reps: 40, lapses: 0,
        stability: 30000, stabilityShort: 25000, difficulty: 3, srsInterval: 3000,
        srsDueDate: FIXED_NOW, lastReviewDate: FIXED_NOW - 3000 * DAY_MS
    };

    for (const rating of [2, 3, 4]) {
        const { newState } = calculateNextSrsState(huge, rating, 'en-vi', 0, null, true, { now: FIXED_NOW });
        assert.ok(newState.srsInterval <= MAX_INTERVAL_DAYS, `rating ${rating}: srsInterval=${newState.srsInterval} vượt ${MAX_INTERVAL_DAYS}`);
    }

    const labels = predictNextIntervals(huge, 'en-vi');
    for (const rating of [1, 2, 3, 4]) {
        assert.ok(labels[rating], `Nhãn dự báo cho rating ${rating} phải tồn tại`);
        assert.ok(labelToDays(labels[rating]) <= MAX_INTERVAL_DAYS + 0.5,
            `rating ${rating}: nhãn "${labels[rating]}" vượt 365 ngày`);
    }
});
