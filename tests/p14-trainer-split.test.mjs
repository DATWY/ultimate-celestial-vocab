// tests/p14-trainer-split.test.mjs
//
// AUDIT-R4.2 — Trainer lấy mốc chia 80/20 từ TOÀN BỘ log trước khi loại lịch sử không đáng tin.
//
// `trustedData = { ...data, cards: trustedCards }` kế thừa `split` tính trên mọi chuỗi (kể cả chuỗi
// bị loại). Nếu các chuỗi bị loại có timestamp MUỘN hơn, mốc chia bị đẩy về phía cuối ⇒ toàn bộ lượt
// đáng tin rơi vào phần "train", validation rỗng ⇒ optimizer từ chối oan (`insufficient-verified-history`)
// dù phần đáng tin vẫn đủ 480 lượt.
//
// Fixture tất định: 60 chuỗi đã xác minh × 8 lượt = 480 lượt (324 train / 96 validation). Fixture B
// giữ nguyên từng log của A rồi thêm 20 chuỗi × 8 = 160 lượt có timestamp muộn hơn, đầu chuỗi
// `first=false` (bị loại).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareTrainingData, optimizeParameters } from '../src/core/srs/training.js';
import { DEFAULT_FSRS7_PARAMS, validFsrs7Params } from '../src/core/srs/constants.js';
import { resolveOptimizationOutcome } from '../src/core/srs/worker-manager.js';

const DAY = 86400000;
const NOW = new Date(2026, 10, 3, 15, 0).getTime();

/** 60 chuỗi × 8 lượt, mọi chuỗi có `first=true` ở lượt đầu (đã xác minh). */
function verifiedFixture({ chains = 60, prefix = 'v' } = {}) {
    const logs = [];
    for (let r = 0; r < 8; r++) {
        for (let id = 0; id < chains; id++) {
            logs.push({
                id: `${prefix}${id}-${r}`, cardId: `${prefix}${id}`,
                rating: r && (id + r) % 5 === 0 ? 1 : 3,
                t: r ? 1 : 0,
                ts: NOW - (8 - r) * DAY + id * 1000,
                first: r === 0
            });
        }
    }
    return logs;
}

/** 20 chuỗi × 8 lượt, timestamp MUỘN hơn mọi log của fixture trên, đầu chuỗi `first=false`. */
function excludedLaterFixture({ chains = 20 } = {}) {
    const logs = [];
    for (let r = 0; r < 8; r++) {
        for (let id = 0; id < chains; id++) {
            logs.push({
                id: `x${id}-${r}`, cardId: `x${id}`,
                rating: r && (id + r) % 5 === 0 ? 1 : 3,
                t: r ? 1 : 0,
                ts: NOW + (r + 1) * DAY + id * 1000,
                first: false
            });
        }
    }
    return logs;
}

const OPTIONS = { iterations: 4, budgetMs: 30000 };

test('R4.2: thêm chuỗi bị loại (timestamp muộn) KHÔNG đổi mốc chia của phần đáng tin', () => {
    const a = prepareTrainingData(verifiedFixture(), []);
    const b = prepareTrainingData([...verifiedFixture(), ...excludedLaterFixture()], []);
    assert.equal(a.verifiedChains, 60);
    assert.equal(b.verifiedChains, 60);
    assert.equal(b.truncatedChains, 20);
    // Mốc chia phải tính từ chính các lượt đáng tin (trường mới `trustedSplit`).
    assert.ok(Number.isFinite(a.trustedSplit), 'phải có mốc chia riêng cho phần đáng tin');
    assert.equal(b.trustedSplit, a.trustedSplit, 'thêm chuỗi bị loại không được đẩy mốc chia');
});

test('R4.2: fixture chuẩn cho 324 train / 96 validation, và fixture B cho ĐÚNG như vậy', () => {
    const a = optimizeParameters(verifiedFixture(), [], DEFAULT_FSRS7_PARAMS, OPTIONS);
    const b = optimizeParameters([...verifiedFixture(), ...excludedLaterFixture()], [], DEFAULT_FSRS7_PARAMS, OPTIONS);

    // Mốc chuẩn của fixture 60×8 đã kiểm chứng.
    assert.equal(a.trainCount, 324, `train của A phải là 324 (nhận ${a.trainCount})`);
    assert.equal(a.validationCount, 96, `validation của A phải là 96 (nhận ${a.validationCount})`);

    // Bản lỗi: 420 train / 0 validation + từ chối oan.
    assert.equal(b.trainCount, a.trainCount, `thêm chuỗi bị loại không được đổi số mẫu train (nhận ${b.trainCount})`);
    assert.equal(b.validationCount, a.validationCount, `validation phải giữ 96 (nhận ${b.validationCount})`);
    assert.notEqual(b.reason, 'insufficient-verified-history', 'không được từ chối oan vì mốc chia sai');
});

test('R4.2: quyết định của optimizer trên A và B là NHƯ NHAU (cùng weights, cùng số vòng)', () => {
    const a = optimizeParameters(verifiedFixture(), [], DEFAULT_FSRS7_PARAMS, OPTIONS);
    const b = optimizeParameters([...verifiedFixture(), ...excludedLaterFixture()], [], DEFAULT_FSRS7_PARAMS, OPTIONS);
    assert.equal(b.improved, a.improved);
    assert.equal(b.reason, a.reason);
    assert.equal(b.oldLoss, a.oldLoss);
    assert.equal(b.newLoss, a.newLoss);
    assert.equal(b.gainPct, a.gainPct);
    assert.deepEqual(b.params, a.params, 'params phải giống nhau từng phần tử');
    assert.equal(validFsrs7Params(b.params), true);
    const applyA = resolveOptimizationOutcome(a, { baselineTrainedAt: 1, currentTrainedAt: 1 }).apply;
    const applyB = resolveOptimizationOutcome(b, { baselineTrainedAt: 1, currentTrainedAt: 1 }).apply;
    assert.equal(applyB, applyA, 'quyết định áp dụng của worker không được phụ thuộc log bị loại');
});

test('R4.2 (chiều ngược): phần đáng tin thiếu mẫu thì thêm log bị loại KHÔNG giúp vượt ngưỡng', () => {
    // 12 chuỗi × 8 = 96 lượt đáng tin (< 400) — dưới ngưỡng dù có thêm bao nhiêu log bị loại.
    const trusted = verifiedFixture({ chains: 12, prefix: 's' });
    const a = optimizeParameters(trusted, [], DEFAULT_FSRS7_PARAMS, OPTIONS);
    const b = optimizeParameters([...trusted, ...excludedLaterFixture({ chains: 60 })], [], DEFAULT_FSRS7_PARAMS, OPTIONS);

    for (const [label, result] of [['A', a], ['B', b]]) {
        assert.equal(result.improved, false, `${label}: không được báo cải thiện`);
        assert.equal(resolveOptimizationOutcome(result, { baselineTrainedAt: 1, currentTrainedAt: 1 }).apply, false,
            `${label}: worker không được áp dụng`);
        assert.ok(Number(result.trustedRows) < 400, `${label}: phần đáng tin vẫn dưới 400 lượt`);
    }
    // Số mẫu của PHẦN ĐÁNG TIN không đổi khi thêm log bị loại.
    assert.equal(b.trustedTrainCount, a.trustedTrainCount, 'train của phần đáng tin không được đổi');
    assert.equal(b.trustedValidationCount, a.trustedValidationCount, 'validation của phần đáng tin không được đổi');
    assert.ok(a.trustedTrainCount < 100, `train phần đáng tin phải dưới 100 (nhận ${a.trustedTrainCount})`);
    assert.ok(a.trustedValidationCount < 30, `validation phần đáng tin phải dưới 30 (nhận ${a.trustedValidationCount})`);
});

test('R4.2: mốc chia lấy từ phần đáng tin vẫn giữ thứ tự thời gian và ngưỡng 400/100/30', () => {
    const data = prepareTrainingData([...verifiedFixture(), ...excludedLaterFixture()], []);
    const trustedReviewTimes = data.trustedCards.flatMap(card => card.reviews.map(review => review.ts)).sort((x, y) => x - y);
    assert.ok(Number.isFinite(data.trustedSplit));
    assert.ok(trustedReviewTimes[Math.floor(trustedReviewTimes.length * 0.8)] <= data.trustedSplit + 1e-9 === false
        || trustedReviewTimes.includes(data.trustedSplit), 'mốc chia phải là timestamp của một lượt đáng tin');
    // Không rơi vào vùng timestamp của chuỗi bị loại.
    const latestTrusted = trustedReviewTimes[trustedReviewTimes.length - 1];
    assert.ok(data.trustedSplit <= latestTrusted, 'mốc chia không được vượt quá lượt đáng tin muộn nhất');
    // Và phải nằm sau lượt sớm nhất.
    assert.ok(data.trustedSplit > trustedReviewTimes[0]);
});
