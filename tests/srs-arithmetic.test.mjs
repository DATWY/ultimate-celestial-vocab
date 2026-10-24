import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FSRS7_PARAMS, S_MIN, S_MAX } from '../src/core/srs/constants.js';
import { initDifficulty, nextDifficulty } from '../src/core/srs/difficulty.js';
import { nextStability } from '../src/core/srs/stability.js';
import { dualTraceForgettingCurve, shortComponentRecall, nextIntervalNewton } from '../src/core/srs/forgetting.js';
import { calculateNextSrsState, predictNextIntervals } from '../src/core/srs/index.js';

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

    // First review Good
    const { newState: review1 } = calculateNextSrsState(newCard, 3, 'en-vi', 0);
    assert.equal(review1.srsStatus, 'Mastered');
    assert.equal(review1.reps, 1);
    assert.equal(review1.lapses, 0);
    assert.ok(review1.stability > 0);
    assert.ok(review1.difficulty >= 1 && review1.difficulty <= 10);
    assert.ok(review1.srsInterval >= 1, 'Initial interval must be at least 1 day');

    // Second review Again (Lapse)
    const { newState: review2 } = calculateNextSrsState(review1, 1, 'en-vi', review1.srsInterval);
    assert.equal(review2.srsStatus, 'Learning');
    assert.equal(review2.lapses, 1);
    assert.ok(review2.stability < review1.stability, 'Lapse must drop stability');
    assert.ok(review2.difficulty >= review1.difficulty, 'Lapse must increase difficulty');

    // Interval forecast
    const intervals = predictNextIntervals(review1, 'en-vi');
    assert.ok(intervals[1], 'Quên interval forecast must exist');
    assert.ok(intervals[2], 'Khó interval forecast must exist');
    assert.ok(intervals[3], 'Nhớ interval forecast must exist');
    assert.ok(intervals[4], 'Dễ interval forecast must exist');
});
