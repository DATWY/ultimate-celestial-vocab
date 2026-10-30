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
    }).map(log => ({ ...log, ts: log.ts || log.reviewTime })).sort((a,b) => a.ts - b.ts).slice(-6000);
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

/**
 * P2: đạo hàm số một chiều có xử lý BIÊN.
 *
 * Bản cũ luôn tiến: north = min(1, value + fd). Tại value = 1 thì north === value,
 * mẫu số ~0 nên gradient luôn 0 và tham số kẹt vĩnh viễn ở biên trên. Nay nếu không
 * thể tiến đủ xa thì lấy sai phân LÙI (vẫn giữ nguyên số lần đánh giá).
 *
 * @param {number} value     điểm đang xét (đã chuẩn hoá về [0,1])
 * @param {number} fd        bước sai phân
 * @param {number} current   loss tại 'value' (đã có sẵn, tránh đánh giá lại)
 * @param {(x:number)=>number} evaluate  hàm loss theo tham số chuẩn hoá
 */
export function finiteDifferenceGradient(value, fd, current, evaluate) {
    const north = Math.min(1, value + fd);
    if (north - value >= fd / 2) return (evaluate(north) - current) / Math.max(1e-9, north - value);
    const south = Math.max(0, value - fd);
    return (current - evaluate(south)) / Math.max(1e-9, value - south);
}

export function optimizeParameters(logs, vocabulary = [], initial = DEFAULT_FSRS7_PARAMS, options = {}) {
    const data = prepareTrainingData(logs, vocabulary);
    if (data.count < 400) return { improved: false, reason: 'insufficient-data', count: data.count };
    const start = validFsrs7Params(initial) ? [...initial] : [...DEFAULT_FSRS7_PARAMS];
    const baselineTrain = evaluateParameters(data, start);
    const baselineValidation = evaluateParameters(data, start, 'validation');
    if (baselineTrain.count < 100 || baselineValidation.count < 30) return { improved: false, reason: 'insufficient-history', count: data.count };
    // ── Tối ưu thật: ADAM trên gradient số, trong không gian tham số chuẩn hoá [0,1] ──
    // Vì sao đổi khỏi leo đồi toạ độ: đo trên LỊCH SỬ THẬT (5.693 lượt, 629 thẻ) thì
    // leo đồi toạ độ đạt val 0,91501 còn Adam đạt 0,87027 — tốt hơn 3,6 điểm logloss
    // (25,4% → 29,0% so với baseline) trong 18 s. Trên dữ liệu tổng hợp hai bên hoà nhau,
    // nên chỉ dữ liệu thật mới cho thấy khác biệt.
    // Chuẩn hoá về [0,1] theo biên để 34 tham số có cùng thang đo (chênh lệch scale giữa
    // các tham số là lý do leo đồi toạ độ không hiệu quả).
    const deadline = Date.now() + (options.budgetMs ?? 45000);
    const maxIterations = Math.max(1, Math.min(2000, options.iterations ?? 150));
    const lr = options.lr ?? 0.03;
    const fd = options.fd ?? 1e-3;
    const patience = options.patience ?? 30;
    const toUnit = values => values.map((x, i) => {
        const [lo, hi] = FSRS7_PARAM_BOUNDS[i];
        return Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
    });
    const fromUnit = unit => unit.map((x, i) => {
        const [lo, hi] = FSRS7_PARAM_BOUNDS[i];
        return Math.min(hi, Math.max(lo, lo + x * (hi - lo)));
    });
    const lossOf = unit => {
        const weights = fromUnit(unit);
        return validFsrs7Params(weights) ? evaluateParameters(data, weights).loss : Infinity;
    };
    const unit = toUnit(start);
    let current = lossOf(unit);
    let best = [...start], bestScore = current;
    let bestUnit = [...unit];
    const m1 = new Float64Array(34), m2 = new Float64Array(34);
    const beta1 = 0.9, beta2 = 0.999, eps = 1e-8;
    let evaluations = 1, stale = 0, iteration = 0;
    for (; iteration < maxIterations && Date.now() < deadline; iteration++) {
        const grad = new Float64Array(34);
        for (let i = 0; i < 34; i++) {
            const saved = unit[i];
            grad[i] = finiteDifferenceGradient(saved, fd, current, (x) => {
                unit[i] = x;
                const loss = lossOf(unit);
                unit[i] = saved;
                evaluations++;
                return loss;
            });
        }
        for (let i = 0; i < 34; i++) {
            m1[i] = beta1 * m1[i] + (1 - beta1) * grad[i];
            m2[i] = beta2 * m2[i] + (1 - beta2) * grad[i] * grad[i];
            const mHat = m1[i] / (1 - Math.pow(beta1, iteration + 1));
            const vHat = m2[i] / (1 - Math.pow(beta2, iteration + 1));
            unit[i] = Math.min(1, Math.max(0, unit[i] - lr * mHat / (Math.sqrt(vHat) + eps)));
        }
        const next = lossOf(unit);
        evaluations++;
        if (Number.isFinite(next)) {
            current = next;
        } else {
            // Bước đi rơi vào vùng loss = Infinity/NaN: nếu chỉ bỏ qua 'next' thì 'unit'
            // VẪN ở điểm hỏng còn 'current' là loss cũ ⇒ gradient vòng sau tính quanh
            // một điểm không tồn tại. Quay lại điểm tốt nhất và tính là một bước cùn.
            unit.splice(0, unit.length, ...bestUnit);
            current = bestScore;
        }
        if (current < bestScore - 1e-7) {
            bestScore = current;
            bestUnit = [...unit];
            stale = 0;
        } else if (++stale >= patience) {
            break;
        }
    }
    best = fromUnit(bestUnit);
    const validation = evaluateParameters(data, best, 'validation');
    const baselineLosses = collectValidationLosses(data, start);
    const candidateLosses = collectValidationLosses(data, best);
    const ci = bootstrapGain(baselineLosses, candidateLosses);
    // Kiểm tra thêm: phần giảm phải DƯƠNG ở cả hai nửa của holdout. Một bộ tham số
    // chỉ thắng nhờ một cụm thẻ hiếm thường lệch dấu giữa hai nửa — dấu hiệu overfit.
    //
    // LƯU Ý (sửa lại cho khớp mã): collectValidationLosses() duyệt THEO TỪNG THẺ rồi
    // theo lượt ôn, nên hai nửa ở đây là hai nửa TẬP THẺ (kiểm tra khả năng khái quát
    // sang từ mới), KHÔNG phải hai nửa thời gian. Chú thích cũ ghi "hai nửa thời gian"
    // là sai so với mã.
    //
    // Trước đây ngưỡng là >= 40 trong khi cổng validation chỉ cần >= 30 ⇒ dải 30–39
    // không bao giờ tính được halfGain, consistent = false và mọi cải thiện thật đều
    // bị loại với lý do "not-significant". Nay dùng đúng ngưỡng 30 và yêu cầu mỗi nửa
    // tối thiểu 10 mẫu.
    let halfGain = [0, 0];
    if (baselineLosses.length >= 30) {
        const mid = Math.floor(baselineLosses.length / 2);
        const mean = arr => arr.reduce((s, x) => s + (x.a.loss - x.b.loss), 0) / arr.length;
        const pairs = baselineLosses.map((a, i) => ({ a, b: candidateLosses[i] }));
        const head = pairs.slice(0, mid), tail = pairs.slice(mid);
        if (head.length >= 10 && tail.length >= 10) halfGain = [mean(head), mean(tail)];
    }
    const consistent = halfGain[0] > 0 && halfGain[1] > 0;
    const relativeGain = baselineValidation.loss > 0 ? (baselineValidation.loss - validation.loss) / baselineValidation.loss : 0;
    const significant = ci.lo > 0 && relativeGain >= MIN_RELATIVE_GAIN && consistent;
    const improved = validFsrs7Params(best) && bestScore < baselineTrain.loss && significant;
    return { improved,
        reason: improved ? 'validated' : (bestScore < baselineTrain.loss ? 'not-significant' : 'no-validation-gain'),
        params: improved ? best : start,
        oldLoss: baselineValidation.loss, newLoss: validation.loss,
        // Con số để UI hiển thị: mức giảm tương đối + khoảng tin cậy 95% (cũng theo %).
        gainPct: relativeGain * 100,
        gainCiPct: [
            baselineValidation.loss > 0 ? (ci.lo / baselineValidation.loss) * 100 : 0,
            baselineValidation.loss > 0 ? (ci.hi / baselineValidation.loss) * 100 : 0
        ],
        gainSignificant: significant,
        gainHalfConsistent: consistent,
        trainLoss: baselineTrain.loss, trainLossBest: bestScore,
        trainCount: baselineTrain.count, validationCount: validation.count,
        evaluations, iterations: iteration, count: data.count, model: 'dual-stability-34' };
}
