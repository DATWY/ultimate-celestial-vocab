import { calculateNextSrsState } from './index.js';
import { dualTraceForgettingCurve } from './forgetting.js';
import { DEFAULT_FSRS7_PARAMS, FSRS7_PARAM_BOUNDS, validFsrs7Params } from './constants.js';

// Ngưỡng để coi là "tốt hơn thật": phải giảm >=1% logloss trên holdout VÀ khoảng tin cậy
// 95% của phần giảm (bootstrap theo từng lượt) không được chứa 0.
// Trước đây chỉ cần 0,5% là đủ, nên với ~400 lượt holdout, nhiễu (hoặc overfit trên mẫu nhỏ)
// vẫn thường xuyên vượt ngưỡng và app báo "giảm X%" trong khi kỳ vọng thật là 0.
export const MIN_RELATIVE_GAIN = 0.01;
const BOOTSTRAP_ROUNDS = 1200;

function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function prepareTrainingData(logs, vocabulary = []) {
    const words = new Map(vocabulary.map(card => [card.id, card]));
    const raw = Array.isArray(logs) ? logs : (logs.logs || []).map(row => ({
        cardId: logs.dict?.[row[0]], rating: row[1], t: row[2], ts: row[3],
        modality: row[4] ? 'typing' : 'en-vi', id: row[5]
    }));
    const deleted = new Set(logs.deletedIds || []), seen = new Set();
    const valid = raw.filter(log => {
        if (!log?.cardId || ![1,2,3,4].includes(log.rating) || !Number.isFinite(log.t) || log.t < 0 || deleted.has(log.id)) return false;
        const identity = log.id || `${log.cardId}:${log.ts || log.reviewTime}:${log.rating}:${log.t}:${log.isTyping || log.modality === 'typing'}`;
        if (seen.has(identity)) return false;
        seen.add(identity);
        return Number.isFinite(log.ts || log.reviewTime) && (log.ts || log.reviewTime) > 0;
    }).map(log => ({ ...log, ts: log.ts || log.reviewTime })).sort((a,b) => a.ts - b.ts).slice(-3000);
    const cards = new Map();
    for (const log of valid) {
        if (!cards.has(log.cardId)) cards.set(log.cardId, { id: log.cardId, english: words.get(log.cardId)?.english || '', type: words.get(log.cardId)?.type || '', reviews: [] });
        cards.get(log.cardId).reviews.push(log);
    }
    return { count: valid.length, split: valid[Math.floor(valid.length * .8)]?.ts || Infinity,
        cards: [...cards.values()].filter(card => card.reviews.length >= 2) };
}

export function evaluateParameters(data, weights, partition = 'train') {
    let loss = 0, count = 0;
    for (const card of data.cards) {
        let state = { id: card.id, english: card.english, type: card.type, srsStatus: 'New', reps: 0 };
        for (let i = 0; i < card.reviews.length; i++) {
            const review = card.reviews[i];
            if (partition === 'train' && review.ts >= data.split) break;
            const elapsed = i ? Math.max(0, (review.ts - state.lastReviewDate) / 86400000) : 0;
            if (i && (partition !== 'validation' || review.ts >= data.split)) {
                const probability = dualTraceForgettingCurve(elapsed, state.stability, state.stabilityShort, state.difficulty, weights);
                if (!Number.isFinite(probability)) return { loss: Infinity, count: 0 };
                const p = Math.max(1e-6, Math.min(1 - 1e-6, probability));
                loss -= review.rating > 1 ? Math.log(p) : Math.log(1 - p);
                count++;
            }
            // Replay exactly the memory update used by the live scheduler,
            // including short relearning and the incremental typing bonus.
            state = calculateNextSrsState(state, review.rating, review.modality || (review.isTyping ? 'typing' : 'en-vi'),
                0, weights, true, { now: review.ts, memoryOnly: true }).newState;
        }
    }
    return { loss: count ? loss / count : Infinity, count };
}

/** Từng lượt trên holdout — cần cho bootstrap ghép cặp. Cùng logic với partition='validation'. */
export function collectValidationLosses(data, weights) {
    const losses = [];
    for (const card of data.cards) {
        let state = { id: card.id, english: card.english, type: card.type, srsStatus: 'New', reps: 0 };
        for (let i = 0; i < card.reviews.length; i++) {
            const review = card.reviews[i];
            const elapsed = i ? Math.max(0, (review.ts - state.lastReviewDate) / 86400000) : 0;
            if (i && review.ts >= data.split) {
                const probability = dualTraceForgettingCurve(elapsed, state.stability, state.stabilityShort, state.difficulty, weights);
                const p = Math.max(1e-6, Math.min(1 - 1e-6, probability));
                losses.push({ card: card.id, loss: review.rating > 1 ? -Math.log(p) : -Math.log(1 - p) });
            }
            state = calculateNextSrsState(state, review.rating, review.modality || (review.isTyping ? 'typing' : 'en-vi'),
                0, weights, true, { now: review.ts, memoryOnly: true }).newState;
        }
    }
    return losses;
}

/**
 * Bootstrap ghép cặp trên phần giảm logloss của từng lượt (dương = bộ mới tốt hơn).
 *
 * Resample theo THẺ, không theo từng lượt: các lượt của cùng một thẻ phụ thuộc nhau
 * (cùng chuỗi trí nhớ), nên bootstrap theo lượt cho khoảng tin cậy quá hẹp và biến
 * nhiễu ở cấp thẻ thành "cải thiện có ý nghĩa". Đây chính là lỗi làm cổng cũ lọt.
 */
export function bootstrapGain(baseline, candidate, rounds = BOOTSTRAP_ROUNDS) {
    const n = Math.min(baseline.length, candidate.length);
    if (!n) return { gain: 0, lo: 0, hi: 0, n: 0, cards: 0 };
    const byCard = new Map();
    let sum = 0;
    for (let i = 0; i < n; i++) {
        const d = baseline[i].loss - candidate[i].loss;
        sum += d;
        const key = baseline[i].card ?? i;
        if (!byCard.has(key)) byCard.set(key, []);
        byCard.get(key).push(d);
    }
    const groups = [...byCard.values()];
    const rnd = mulberry32(0x9E3779B9);
    const boots = new Float64Array(rounds);
    for (let k = 0; k < rounds; k++) {
        let s = 0, c = 0;
        for (let g = 0; g < groups.length; g++) {
            const picked = groups[Math.floor(rnd() * groups.length)];
            for (const d of picked) { s += d; c++; }
        }
        boots[k] = c ? s / c : 0;
    }
    boots.sort();
    return { gain: sum / n, lo: boots[Math.floor(rounds * 0.025)], hi: boots[Math.floor(rounds * 0.975)], n, cards: groups.length };
}

export function optimizeParameters(logs, vocabulary = [], initial = DEFAULT_FSRS7_PARAMS, options = {}) {
    const data = prepareTrainingData(logs, vocabulary);
    if (data.count < 400) return { improved: false, reason: 'insufficient-data', count: data.count };
    const start = validFsrs7Params(initial) ? [...initial] : [...DEFAULT_FSRS7_PARAMS];
    const baselineTrain = evaluateParameters(data, start);
    const baselineValidation = evaluateParameters(data, start, 'validation');
    if (baselineTrain.count < 100 || baselineValidation.count < 30) return { improved: false, reason: 'insufficient-history', count: data.count };
    let best = start, bestScore = baselineTrain.loss;
    const deadline = Date.now() + (options.budgetMs ?? 8000);
    const passes = Math.max(1, Math.min(50, options.iterations ?? 2));
    let evaluations = 0;
    for (let pass = 0; pass < passes && Date.now() < deadline; pass++) {
        let improvedThisPass = false;
        for (let index = 0; index < 34 && Date.now() < deadline; index++) {
            const [min, max] = FSRS7_PARAM_BOUNDS[index];
            // Bước nhảy theo BIÊN của tham số, không dùng sàn tuyệt đối 0.005: sàn đó
            // phá các tham số nhỏ (vài phần nghìn) vì 0.005 lớn gấp hàng chục lần.
            const step = Math.max((max - min) * 1e-3, Math.abs(best[index]) * 0.08);
            for (const direction of [1, -1]) {
                const candidate = [...best];
                candidate[index] = Math.min(max, Math.max(min, candidate[index] + direction * step));
                if (candidate[index] === best[index]) continue;
                const train = evaluateParameters(data, candidate);
                evaluations++;
                const penalty = candidate.reduce((sum, value, j) => sum + ((value - start[j]) / Math.max(.1, Math.abs(start[j]))) ** 2, 0) * .01 / 34;
                const score = train.loss + penalty;
                if (score < bestScore) { best = candidate; bestScore = score; improvedThisPass = true; }
            }
        }
        if (!improvedThisPass) break;
    }
    const validation = evaluateParameters(data, best, 'validation');
    const baselineLosses = collectValidationLosses(data, start);
    const candidateLosses = collectValidationLosses(data, best);
    const ci = bootstrapGain(baselineLosses, candidateLosses);
    const relativeGain = baselineValidation.loss > 0 ? (baselineValidation.loss - validation.loss) / baselineValidation.loss : 0;
    const significant = ci.lo > 0 && relativeGain >= MIN_RELATIVE_GAIN;
    const improved = validFsrs7Params(best) && bestScore < baselineTrain.loss && significant;
    return { improved,
        reason: improved ? 'validated' : (ci.lo <= 0 && bestScore < baselineTrain.loss ? 'not-significant' : 'no-validation-gain'),
        params: improved ? best : start,
        oldLoss: baselineValidation.loss, newLoss: validation.loss,
        // Con số để UI hiển thị: mức giảm tương đối + khoảng tin cậy 95% (cũng theo %).
        gainPct: relativeGain * 100,
        gainCiPct: [
            baselineValidation.loss > 0 ? (ci.lo / baselineValidation.loss) * 100 : 0,
            baselineValidation.loss > 0 ? (ci.hi / baselineValidation.loss) * 100 : 0
        ],
        gainSignificant: significant,
        trainCount: baselineTrain.count, validationCount: validation.count,
        evaluations, count: data.count, model: 'dual-stability-34' };
}
