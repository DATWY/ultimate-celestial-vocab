// tests/heuristics-amplitude.test.mjs — T1.3: thu biên độ heuristics (bơm S0/D0)
//
// Trước T1.3: bias ∈ [-3.0, +3.0] ⇒ D0 lệch ±1.5, multiplier ∈ [0.7, 1.3] ⇒ S0 lệch ±30%.
// Hệ quả: interval lần đầu giữa "cat" và một idiom lệch ~8×, dù khác biệt độ khó thật
// chỉ nên vài chục phần trăm. Sau T1.3: bias ±0.5, multiplier [0.85, 1.15], D0 lệch ±0.25.
//
// Test này khoá CẢ HAI đầu: (1) biên độ phải nằm trong dải mới, (2) hướng phải giữ nguyên
// (từ khó vẫn S0 thấp hơn / D0 cao hơn / interval ngắn hơn), (3) chênh lệch giữa từ dễ
// nhất và khó nhất không vượt 2×.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    getDifficultyBias, getStabilityMultiplier,
    DIFFICULTY_BIAS_MIN, DIFFICULTY_BIAS_MAX, STABILITY_MULT_MIN, STABILITY_MULT_MAX
} from '../src/core/srs/heuristics.js';
import { DEFAULT_FSRS7_PARAMS, DESIRED_RETENTION, D0_BIAS_SCALE } from '../src/core/srs/constants.js';
import { initDifficulty } from '../src/core/srs/difficulty.js';
import { nextIntervalNewton } from '../src/core/srs/forgetting.js';
import { calculateNextSrsState } from '../src/core/srs/index.js';

const NOW = Date.UTC(2026, 0, 1, 8, 0, 0);
const W = DEFAULT_FSRS7_PARAMS;
const GOOD = 3;

// 5 input khác hẳn nhau về hình thái: từ ngắn phổ biến, từ dài nhiều âm tiết, idiom,
// cụm động từ có giới từ, và một từ dài không phổ biến.
const FIVE_INPUTS = [
    { english: 'cat', type: 'noun', pronunciation: '/kæt/' },
    { english: 'serendipitously', type: 'adverb' },
    { english: 'break the ice', type: 'idiom' },
    { english: 'put up with', type: 'phrasal verb' },
    { english: 'extraordinarily', type: 'adverb' }
];

const newCard = (card) => ({ id: `probe-${card.english}`, srsStatus: 'New', reps: 0, lapses: 0, ...card });
const goodOnce = (card) => calculateNextSrsState(newCard(card), GOOD, 'en-vi', 0, null, true, { now: NOW }).newState;

test('T1.3: getDifficultyBias luôn nằm trong [-0.5, +0.5] với 5 input khác nhau', () => {
    assert.equal(DIFFICULTY_BIAS_MIN, -0.5);
    assert.equal(DIFFICULTY_BIAS_MAX, 0.5);
    for (const card of FIVE_INPUTS) {
        const bias = getDifficultyBias(card);
        assert.ok(Number.isFinite(bias), `${card.english}: bias phải là số, nhận ${bias}`);
        assert.ok(bias >= DIFFICULTY_BIAS_MIN && bias <= DIFFICULTY_BIAS_MAX,
            `${card.english}: bias ${bias} ngoài dải [${DIFFICULTY_BIAS_MIN}, ${DIFFICULTY_BIAS_MAX}]`);
    }
    // Dữ liệu biên: rỗng, null, "siêu khó" (idiom + từ 18 ký tự + 6 âm tiết) vẫn không vượt dải.
    for (const odd of [null, {}, { english: '' }, { english: '   ' },
        { english: 'incomprehensibility', type: 'idiom' }]) {
        const bias = getDifficultyBias(odd);
        assert.ok(bias >= DIFFICULTY_BIAS_MIN && bias <= DIFFICULTY_BIAS_MAX,
            `input ${JSON.stringify(odd)}: bias ${bias} ngoài dải`);
    }
});

test('T1.3: getStabilityMultiplier luôn nằm trong [0.85, 1.15] với 5 bias khác nhau', () => {
    assert.equal(STABILITY_MULT_MIN, 0.85);
    assert.equal(STABILITY_MULT_MAX, 1.15);
    // Gồm cả bias cực đoan của code cũ (±3) và bias rác: đầu ra vẫn bị kẹp.
    for (const bias of [-99, -3, -0.5, 0, 0.5, 3, 99, NaN]) {
        const mult = getStabilityMultiplier(bias);
        assert.ok(Number.isFinite(mult), `bias ${bias}: multiplier phải là số, nhận ${mult}`);
        assert.ok(mult >= STABILITY_MULT_MIN && mult <= STABILITY_MULT_MAX,
            `bias ${bias}: multiplier ${mult} ngoài dải [${STABILITY_MULT_MIN}, ${STABILITY_MULT_MAX}]`);
    }
    // Đúng 5 input từ danh sách mẫu, cũng phải nằm trong dải.
    for (const card of FIVE_INPUTS) {
        const mult = getStabilityMultiplier(getDifficultyBias(card));
        assert.ok(mult >= STABILITY_MULT_MIN && mult <= STABILITY_MULT_MAX, `${card.english}: ×${mult}`);
    }
});

test('T1.3: hướng của heuristics KHÔNG đổi (từ khó vẫn khó hơn)', () => {
    const easy = getDifficultyBias({ english: 'cat', type: 'noun' });
    const hard = getDifficultyBias({ english: 'break the ice', type: 'idiom' });
    assert.ok(easy < hard, `cat (${easy}) phải dễ hơn idiom (${hard})`);

    // bias âm ⇒ S0 lớn hơn (ôn muộn hơn); bias dương ⇒ S0 nhỏ hơn.
    assert.ok(getStabilityMultiplier(easy) > 1, 'từ dễ phải có multiplier > 1');
    assert.ok(getStabilityMultiplier(hard) < 1, 'từ khó phải có multiplier < 1');
    assert.ok(getStabilityMultiplier(easy) > getStabilityMultiplier(hard));

    // Đơn điệu: bias càng tăng thì multiplier càng giảm (không có bậc thang ngược).
    let previous = Infinity;
    for (let bias = -0.5; bias <= 0.5 + 1e-9; bias += 0.1) {
        const mult = getStabilityMultiplier(bias);
        assert.ok(mult <= previous + 1e-12, `multiplier không đơn điệu tại bias=${bias.toFixed(2)}`);
        previous = mult;
    }

    // Ở tầng bộ nhớ: từ dễ phải có S0 cao hơn và interval thô dài hơn từ khó.
    const easyState = goodOnce({ english: 'cat', type: 'noun' });
    const hardState = goodOnce({ english: 'break the ice', type: 'idiom' });
    assert.ok(easyState.stability > hardState.stability,
        `S0(cat)=${easyState.stability} phải > S0(idiom)=${hardState.stability}`);
    assert.ok(easyState.difficulty < hardState.difficulty,
        `D0(cat)=${easyState.difficulty} phải < D0(idiom)=${hardState.difficulty}`);
});

test('T1.3: S0 chỉ nhích ±15% và D0 chỉ nhích ±0.25 so với FSRS thuần', () => {
    const s0Pure = W[2];
    const d0Pure = initDifficulty(GOOD, W);
    for (const card of FIVE_INPUTS) {
        const state = goodOnce(card);
        const sRatio = state.stability / s0Pure;
        const dDelta = state.difficulty - d0Pure;
        assert.ok(sRatio >= STABILITY_MULT_MIN - 1e-9 && sRatio <= STABILITY_MULT_MAX + 1e-9,
            `${card.english}: S0 lệch ${((sRatio - 1) * 100).toFixed(1)}% — vượt dải ±15%`);
        const maxDelta = 0.5 * Math.abs(D0_BIAS_SCALE);
        assert.ok(Math.abs(dDelta) <= maxDelta + 1e-9,
            `${card.english}: D0 lệch ${dDelta.toFixed(3)} — vượt dải ±${maxDelta}`);
    }
});

test('T1.3: chênh lệch interval giữa từ dễ nhất và khó nhất ≤ 2×', () => {
    // 6 từ mẫu đúng như bảng trong tools/simulate_intervals.mjs.
    const samples = [
        { english: 'cat', type: 'noun', pronunciation: '/kæt/' },
        { english: 'serendipitously', type: 'adverb', pronunciation: '/ˌser.ənˈdɪp.ə.təs.li/' },
        { english: 'break the ice', type: 'idiom', pronunciation: '/breɪk ði aɪs/' },
        { english: 'meticulous', type: 'adjective', pronunciation: '/məˈtɪk.jə.ləs/' },
        { english: 'meticulous', type: 'adjective' },
        { english: 'extraordinarily', type: 'adverb' }
    ];

    // (a) interval FSRS thô của lần chấm đầu — đây chính là số mà heuristics "bơm".
    const rawIntervals = samples.map(card => {
        const state = goodOnce(card);
        return nextIntervalNewton(state.stability, state.stabilityShort, state.difficulty, DESIRED_RETENTION, W);
    });
    const rawRatio = Math.max(...rawIntervals) / Math.min(...rawIntervals);
    assert.ok(rawRatio <= 2, `interval lần 1 lệch ${rawRatio.toFixed(2)}× (> 2×): ${rawIntervals.map(v => v.toFixed(2))}`);

    // (b) interval sau 5 lần Good — chạy bằng engine thật, cùng một bộ máy FSRS.
    const after5 = samples.map(card => {
        let state = goodOnce(card);
        for (let i = 1; i < 5; i++) {
            state = calculateNextSrsState(state, GOOD, 'en-vi', 0, null, true, { now: state.srsDueDate }).newState;
        }
        return state.srsInterval;
    });
    const ratio5 = Math.max(...after5) / Math.min(...after5);
    assert.ok(ratio5 <= 2, `interval sau 5 Good lệch ${ratio5.toFixed(2)}× (> 2×): ${after5.map(v => v.toFixed(2))}`);
});
