// Kiểm tra "cổng thống kê" của bộ tối ưu: chỉ được báo cải thiện khi có bằng chứng.
import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizeParameters, bootstrapGain } from '../src/core/srs/training.js';
import { calculateNextSrsState } from '../src/core/srs/index.js';
import { dualTraceForgettingCurve } from '../src/core/srs/forgetting.js';
import { DEFAULT_FSRS7_PARAMS, validFsrs7Params } from '../src/core/srs/constants.js';

const DAY = 86400000;

test('bootstrapGain: mọi lượt của mọi thẻ đều tốt hơn ⇒ khoảng tin cậy nằm trên 0', () => {
    const base = [{ card: 'a', loss: 1 }, { card: 'a', loss: 1 }, { card: 'b', loss: 1 }, { card: 'b', loss: 1 }];
    const cand = base.map(x => ({ ...x, loss: 0.5 }));
    const ci = bootstrapGain(base, cand);
    assert.equal(ci.n, 4);
    assert.equal(ci.cards, 2);
    assert.ok(ci.gain > 0);
    assert.ok(ci.lo > 0, 'phải kết luận dương');
});

test('bootstrapGain: hai bộ y hệt ⇒ gain 0 và khoảng tin cậy chứa 0', () => {
    const base = [{ card: 'a', loss: 0.7 }, { card: 'b', loss: 0.8 }, { card: 'c', loss: 0.9 }];
    const ci = bootstrapGain(base, base.map(x => ({ ...x })));
    assert.equal(ci.gain, 0);
    assert.ok(ci.lo <= 0 && ci.hi >= 0);
});

test('bootstrapGain: bộ mới TỆ hơn ⇒ gain âm', () => {
    const base = [{ card: 'a', loss: 0.2 }, { card: 'b', loss: 0.2 }, { card: 'c', loss: 0.2 }];
    const ci = bootstrapGain(base, base.map(x => ({ ...x, loss: 0.9 })));
    assert.ok(ci.gain < 0);
    assert.ok(ci.lo < 0);
});

test('bootstrapGain: nhiễu ở cấp thẻ KHÔNG được thành "có ý nghĩa" (resample theo thẻ)', () => {
    // Mỗi thẻ chỉ 1 lượt, các thẻ có chênh lệch trái dấu nhau ⇒ trung bình ~0 nhưng
    // phương sai lớn. Resample theo lượt sẽ cho CI hẹp; theo thẻ phải rộng và chứa 0.
    const base = [];
    const cand = [];
    for (let i = 0; i < 40; i++) {
        const win = i % 2 === 0 ? 0.4 : -0.4;
        base.push({ card: `c${i}`, loss: 0.6 + win / 2 });
        cand.push({ card: `c${i}`, loss: 0.6 - win / 2 });
    }
    const ci = bootstrapGain(base, cand);
    assert.ok(Math.abs(ci.gain) < 1e-9, `gain trung bình phải ~0, thực tế ${ci.gain}`);
    assert.ok(ci.lo <= 0 && ci.hi >= 0, 'CI phải chứa 0');
});

// Dữ liệu tổng hợp: sinh từ CHÍNH DEFAULT ⇒ không có cải thiện thật nào để tìm.
function syntheticLogs(seed = 1, cards = 70, reviews = 6) {
    let a = seed >>> 0;
    const rnd = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const logs = [];
    const t0 = Date.UTC(2025, 0, 1);
    let id = 0;
    for (let c = 0; c < cards; c++) {
        let state = { id: `c${c}`, english: `w${c}`, srsStatus: 'New', reps: 0, lapses: 0 };
        let ts = t0 + Math.floor(rnd() * 120) * DAY;
        for (let r = 0; r < reviews; r++) {
            const elapsed = r === 0 ? 0 : Math.max(0.3, (state.stability || 1) * (0.8 + rnd() * 0.7));
            const p = r === 0 ? 0 : dualTraceForgettingCurve(elapsed, state.stability, state.stabilityShort, state.difficulty, DEFAULT_FSRS7_PARAMS);
            const rating = r === 0 ? 3 : (rnd() < p ? (rnd() < 0.75 ? 3 : 4) : (rnd() < 0.6 ? 1 : 2));
            logs.push({ id: `l${id++}`, cardId: `c${c}`, rating, t: elapsed, ts, modality: 'en-vi' });
            state = calculateNextSrsState(state, rating, 'en-vi', 0, DEFAULT_FSRS7_PARAMS, true, { now: ts, memoryOnly: true }).newState;
            ts += Math.max(0.3, state.stability || 1) * DAY * (0.8 + rnd() * 0.5);
        }
    }
    return logs.sort((x, y) => x.ts - y.ts);
}

test('cổng: nếu báo improved thì BẮT BUỘC gain ≥1% và CI dưới > 0', () => {
    for (const seed of [1, 2]) {
        const logs = syntheticLogs(seed);
        const result = optimizeParameters(logs, [], DEFAULT_FSRS7_PARAMS, { iterations: 1, budgetMs: 3000 });
        assert.ok(Number.isFinite(result.oldLoss));
        assert.ok(Array.isArray(result.gainCiPct) && result.gainCiPct.length === 2, 'phải trả khoảng tin cậy cho UI');
        if (result.improved) {
            assert.equal(validFsrs7Params(result.params), true);
            assert.ok(result.gainPct >= 1, `gainPct=${result.gainPct} phải >= 1%`);
            assert.ok(result.gainCiPct[0] > 0, `CI dưới=${result.gainCiPct[0]} phải > 0`);
            assert.equal(result.gainSignificant, true);
        } else {
            assert.deepEqual(result.params, DEFAULT_FSRS7_PARAMS, 'không cải thiện thì phải giữ nguyên bộ cũ');
            assert.ok(['not-significant', 'no-validation-gain'].includes(result.reason));
        }
    }
});
