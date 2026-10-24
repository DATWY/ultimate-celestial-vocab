import { calculateNextSrsState } from './index.js';
import { dualTraceForgettingCurve } from './forgetting.js';
import { DEFAULT_FSRS7_PARAMS, FSRS7_PARAM_BOUNDS, validFsrs7Params } from './constants.js';

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

export function optimizeParameters(logs, vocabulary = [], initial = DEFAULT_FSRS7_PARAMS, options = {}) {
    const data = prepareTrainingData(logs, vocabulary);
    if (data.count < 400) return { improved: false, reason: 'insufficient-data', count: data.count };
    const start = validFsrs7Params(initial) ? [...initial] : [...DEFAULT_FSRS7_PARAMS];
    const baselineTrain = evaluateParameters(data, start);
    const baselineValidation = evaluateParameters(data, start, 'validation');
    if (baselineTrain.count < 100 || baselineValidation.count < 30) return { improved: false, reason: 'insufficient-history', count: data.count };
    let best = start, bestScore = baselineTrain.loss;
    const deadline = Date.now() + (options.budgetMs ?? 8000);
    const iterations = options.iterations ?? 100;
    for (let i = 0; i < iterations && Date.now() < deadline; i++) {
        const index = i % 34, direction = Math.floor(i / 34) % 2 ? -1 : 1;
        const candidate = [...best], [min, max] = FSRS7_PARAM_BOUNDS[index];
        candidate[index] = Math.min(max, Math.max(min, candidate[index] + direction * Math.max(.005, Math.abs(candidate[index]) * .08)));
        const train = evaluateParameters(data, candidate);
        const penalty = candidate.reduce((sum, value, j) => sum + ((value - start[j]) / Math.max(.1, Math.abs(start[j]))) ** 2, 0) * .01 / 34;
        if (train.loss + penalty < bestScore) { best = candidate; bestScore = train.loss + penalty; }
    }
    const validation = evaluateParameters(data, best, 'validation');
    const improved = validFsrs7Params(best) && bestScore < baselineTrain.loss &&
        validation.loss < baselineValidation.loss * .995;
    return { improved, reason: improved ? 'validated' : 'no-validation-gain', params: improved ? best : start,
        oldLoss: baselineValidation.loss, newLoss: validation.loss, trainCount: baselineTrain.count,
        validationCount: validation.count, count: data.count, model: 'dual-stability-34' };
}
