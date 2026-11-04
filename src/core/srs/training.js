import { calculateNextSrsState } from './index.js';
import { dualTraceForgettingCurve } from './forgetting.js';
import { expandReviewLogRows } from '../review-log-merge.js';
import { DEFAULT_FSRS7_PARAMS, FSRS7_PARAM_BOUNDS, validFsrs7Params } from './constants.js';

/**
 * AUDIT-5.1 — Chiếu tham số về miền hợp lệ: clamp hộp rồi áp ràng buộc thứ tự (w0 ≤ w1 ≤ w2 ≤ w3,
 * w26 ≥ w25), đúng như bước hậu xử lý của FSRS7ParameterClipper trong nguồn FSRS-7.
 * Chỉ optimizer dùng (module này nằm trong worker, không vào entry bundle), nên nhập tay vẫn
 * bị TỪ CHỐI ở validator thay vì bị tự ý sửa.
 */
export function projectFsrs7Params(params) {
    if (!Array.isArray(params) || params.length !== FSRS7_PARAM_BOUNDS.length) return null;
    const w = new Array(params.length);
    for (let i = 0; i < params.length; i++) {
        const n = Number(params[i]);
        // AUDIT-R2.1: KHÔNG thay NaN/Infinity bằng biên min. Giá trị không hữu hạn nghĩa là phép
        // tính trước đó đã hỏng; "chiếu" nó thành min chỉ che lỗi và âm thầm đổi tham số.
        if (!Number.isFinite(n)) return null;
        const [min, max] = FSRS7_PARAM_BOUNDS[i];
        w[i] = Math.min(max, Math.max(min, n));
    }
    for (let i = 1; i < 4; i++) w[i] = Math.max(w[i], w[i - 1]);
    w[26] = Math.max(w[26], w[25]);
    return w;
}

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
    const raw = Array.isArray(logs) ? logs : expandReviewLogRows(logs.dict, logs.logs);
    const deleted = new Set(logs.deletedIds || []), seen = new Set();
    const sorted = raw.filter(log => {
        if (!log?.cardId || ![1,2,3,4].includes(log.rating) || !Number.isFinite(log.t) || log.t < 0 || deleted.has(log.id)) return false;
        const identity = log.id || `${log.cardId}:${log.ts || log.reviewTime}:${log.rating}:${log.t}:${log.isTyping || log.modality === 'typing'}`;
        if (seen.has(identity)) return false;
        seen.add(identity);
        return Number.isFinite(log.ts || log.reviewTime) && (log.ts || log.reviewTime) > 0;
    }).map(log => ({ ...log, ts: log.ts || log.reviewTime })).sort((a,b) => a.ts - b.ts);
    // AUDIT-6.1: trước đây cắt im lặng 6.000 lượt rồi coi lượt ĐẦU CÒN GIỮ là lần chạm đầu đời của
    // thẻ (elapsed = 0, srsStatus New). Với chuỗi đã bị cắt, điều đó dựng ra một trạng thái bộ
    // nhớ không có thật, nên cả train lẫn holdout đều chấm trên bộ nhớ sai.
    const LOG_HISTORY_LIMIT = 6000;
    const logTrimmed = sorted.length > LOG_HISTORY_LIMIT;
    const valid = sorted.slice(-LOG_HISTORY_LIMIT);
    const cards = new Map();
    for (const log of valid) {
        if (!cards.has(log.cardId)) cards.set(log.cardId, { id: log.cardId, english: words.get(log.cardId)?.english || '', type: words.get(log.cardId)?.type || '', reviews: [] });
        cards.get(log.cardId).reviews.push(log);
    }
    const chains = [...cards.values()].filter(card => card.reviews.length >= 2);
    // AUDIT-R2.5: `t` chỉ là THỜI GIAN ĐÃ TRÔI, không phải bằng chứng "lượt đầu đời": lượt thứ
    // hai cùng timestamp (hoặc lệch đồng hồ) cũng có t = 0. Vì vậy:
    //   • startVerified = cờ `first` do engine ghi ⇒ bằng chứng THẬT.
    //   • startKnown    = cờ đó, HOẶC phỏng đoán cũ (t = 0) cho log legacy đã có trước khi có cờ.
    //     Giữ phỏng đoán này để không vô hiệu hoá optimizer của người dùng cũ (log của họ không
    //     thể có cờ), nhưng nó KHÔNG được coi là "đã xác minh".
    // AUDIT-R2.5 + R3.1: ba trạng thái bằng chứng của lượt đầu chuỗi:
    //   • first === true  ⇒ đã xác minh (engine biết chắc đây là lượt đầu đời).
    //   • first === false ⇒ BIẾT CHẮC đây không phải lượt đầu ⇒ chuỗi bị cắt, LOẠI khỏi replay.
    //     Không được "cứu" bằng t = 0: hai lượt cùng timestamp hoặc lệch đồng hồ cũng cho t = 0.
    //   • first === undefined ⇒ log legacy chưa biết; chỉ dùng phỏng đoán cũ (t = 0) và đánh dấu
    //     là CHƯA xác minh để phần quyết định áp dụng weights không dựa vào nó.
    for (const chain of chains) {
        const head = chain.reviews[0];
        chain.startVerified = head?.first === true;
        chain.startTruncated = head?.first === false || (!chain.startVerified && (Number(head?.t) || 0) > 1e-9);
        chain.startKnown = !chain.startTruncated;
    }
    const usable = chains.filter(chain => chain.startKnown);
    const verified = usable.filter(chain => chain.startVerified);
    const assumed = usable.filter(chain => !chain.startVerified);
    // AUDIT-R4.2: mốc chia 80/20 phải tính từ CHÍNH các lượt đáng tin. Nếu lấy từ toàn bộ log thì
    // các chuỗi bị loại có timestamp muộn sẽ đẩy mốc chia về cuối, toàn bộ lượt đáng tin rơi vào
    // phần train và validation rỗng ⇒ optimizer từ chối oan dù dữ liệu tốt vẫn đủ.
    const trustedTimes = verified.flatMap(chain => chain.reviews.map(review => review.ts)).sort((a, b) => a - b);
    const trustedSplit = trustedTimes.length
        ? (trustedTimes[Math.floor(trustedTimes.length * 0.8)] || Infinity)
        : Infinity;
    return { count: valid.length, split: valid[Math.floor(valid.length * .8)]?.ts || Infinity,
        cards: usable,
        // Tập ĐÁNG TIN: chỉ chuỗi có bằng chứng thật. Dùng cho quyết định áp dụng weights.
        trustedCards: verified,
        // Mốc chia dùng cho tập đáng tin (baseline/candidate/validation/bootstrap).
        trustedSplit,
        totalChains: chains.length,
        truncatedChains: chains.length - usable.length,
        verifiedChains: verified.length,
        assumedStartChains: assumed.length,
        logTrimmed,
        rawCount: sorted.length,
        // Chỉ gọi là "đầy đủ" khi MỌI chuỗi có bằng chứng lượt đầu và không bị cắt log.
        historyComplete: !logTrimmed && chains.length > 0 && verified.length === chains.length };
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
 * P2 + AUDIT-R2.1: đạo hàm số một chiều TÔN TRỌNG MIỀN RÀNG BUỘC.
 *
 * Bản trước luôn tiến (và lùi ở biên hộp), nhưng với ràng buộc thứ tự `w0 ≤ w1 ≤ …`, phía
 * "tiến" có thể rơi ra ngoài miền: khi đó loss = Infinity ⇒ gradient = Infinity ⇒ bước Adam
 * thành NaN và phép chiếu biến NaN thành min.
 *
 * Nay `evaluate` phân biệt ba khả năng:
 *   • số hữu hạn  ⇒ dùng làm gradient;
 *   • `null`      ⇒ hướng này KHÔNG khả thi (vi phạm ràng buộc) ⇒ thử hướng ngược lại;
 *   • NaN/∞       ⇒ lỗi số THẬT (điểm khả thi nhưng không chấm được) ⇒ trả NaN để nơi gọi LOẠI
 *                    bước, không được giả vờ là gradient 0.
 * Không hướng nào khả thi ⇒ trả `null` (toạ độ bị ràng buộc kẹp), KHÔNG trả Infinity/0.
 *
 * @param {number} value     điểm đang xét (đã chuẩn hoá về [0,1])
 * @param {number} fd        bước sai phân
 * @param {number} current   loss tại 'value' (đã có sẵn, tránh đánh giá lại)
 * @param {(x:number)=>number|null} evaluate  hàm loss theo tham số chuẩn hoá
 * @returns {number|null} gradient, null = không có hướng khả thi, NaN = lỗi số thật
 */
export function finiteDifferenceGradient(value, fd, current, evaluate) {
    const north = Math.min(1, value + fd);
    if (north - value >= fd / 2) {
        const loss = evaluate(north);
        if (Number.isFinite(loss)) return (loss - current) / Math.max(1e-9, north - value);
        if (loss !== null && loss !== undefined) return NaN;
    }
    const south = Math.max(0, value - fd);
    if (value - south >= fd / 2) {
        const loss = evaluate(south);
        if (Number.isFinite(loss)) return (current - loss) / Math.max(1e-9, value - south);
        if (loss !== null && loss !== undefined) return NaN;
    }
    return null;
}

export function optimizeParameters(logs, vocabulary = [], initial = DEFAULT_FSRS7_PARAMS, options = {}) {
    const data = prepareTrainingData(logs, vocabulary);
    // AUDIT-6.1: báo ĐỦ chẩn đoán để nơi gọi nói được vì sao không áp dụng, thay vì báo "cải thiện"
    // dựa trên chuỗi bộ nhớ dựng sai.
    const diagnostics = {
        count: data.count, scoredChains: data.cards.length, totalChains: data.totalChains,
        truncatedChains: data.truncatedChains, logTrimmed: data.logTrimmed, historyComplete: data.historyComplete,
        verifiedChains: data.verifiedChains, assumedStartChains: data.assumedStartChains, trustedChains: data.trustedCards.length,
        // 'verified' = mọi chuỗi có cờ first; 'mixed' = có cả chuỗi chưa xác minh; 'assumed' = không
        // chuỗi nào có cờ nhưng vẫn replay được bằng phỏng đoán t = 0; 'none' = không chuỗi nào dùng được.
        startEvidence: data.cards.length === 0 ? 'none'
            : data.verifiedChains === data.totalChains ? 'verified'
            : data.verifiedChains > 0 ? 'mixed' : 'assumed'
    };
    const start = validFsrs7Params(initial) ? [...initial] : [...DEFAULT_FSRS7_PARAMS];
    // AUDIT-R3.1 + R4.2: quyết định ÁP DỤNG phải dựa trên phần lịch sử ĐÁNG TIN (chuỗi có bằng
    // chứng lượt đầu), với mốc chia tính từ chính phần đó. Số mẫu của phần đáng tin được đưa vào
    // chẩn đoán của MỌI nhánh từ chối (kể cả `insufficient-data`) để log bị loại không bao giờ
    // "trông như" đã giúp vượt ngưỡng.
    const trustedData = { ...data, cards: data.trustedCards, split: data.trustedSplit };
    const trustedRows = data.trustedCards.reduce((sum, card) => sum + card.reviews.length, 0);
    const trustedTrain = evaluateParameters(trustedData, start);
    const trustedValidation = evaluateParameters(trustedData, start, 'validation');
    diagnostics.trustedRows = trustedRows;
    diagnostics.trustedTrainCount = trustedTrain.count;
    diagnostics.trustedValidationCount = trustedValidation.count;
    if (data.cards.length === 0 && data.totalChains > 0) {
        // Có lịch sử nhưng KHÔNG chuỗi nào chứng minh được điểm bắt đầu ⇒ replay không đáng tin.
        return { improved: false, reason: 'truncated-history', ...diagnostics };
    }
    if (data.count < 400) return { improved: false, reason: 'insufficient-data', ...diagnostics };
    if (trustedRows < 400 || trustedTrain.count < 100 || trustedValidation.count < 30) {
        return { improved: false, reason: 'insufficient-verified-history', ...diagnostics };
    }
    const baselineTrain = trustedTrain;
    const baselineValidation = trustedValidation;
    if (baselineTrain.count < 100 || baselineValidation.count < 30) return { improved: false, reason: 'insufficient-history', ...diagnostics };
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
        return validFsrs7Params(weights) ? evaluateParameters(trustedData, weights).loss : Infinity;
    };
    const unit = toUnit(start);
    let current = lossOf(unit);
    if (!Number.isFinite(current)) {
        // Ngay điểm xuất phát đã không chấm được ⇒ không có gradient nào đáng tin.
        return { improved: false, reason: 'unscorable', ...diagnostics,
            params: start, gradientFailures: 0, pinnedCoordinates: 0, rejectedSteps: 0 };
    }
    let best = [...start];
    let bestScore = current;
    let bestUnit = [...unit];
    const m1 = new Float64Array(34), m2 = new Float64Array(34);
    const beta1 = 0.9, beta2 = 0.999, eps = 1e-8;
    let evaluations = 1, stale = 0, iteration = 0;
    // AUDIT-R2.1: đếm riêng ba hiện tượng để (a) test khẳng định không có bước nhiễm độc,
    // (b) người dùng thấy được optimizer có gặp biên ràng buộc hay lỗi số.
    let gradientFailures = 0, pinnedCoordinates = 0, rejectedSteps = 0;
    const backToBest = () => { unit.splice(0, unit.length, ...bestUnit); current = bestScore; };
    for (; iteration < maxIterations && Date.now() < deadline; iteration++) {
        const grad = new Float64Array(34);
        let badGradient = false;
        for (let i = 0; i < 34; i++) {
            const saved = unit[i];
            const g = finiteDifferenceGradient(saved, fd, current, (x) => {
                unit[i] = x;
                const weights = fromUnit(unit);
                unit[i] = saved;
                evaluations++;
                // Hướng vi phạm ràng buộc ⇒ null (thử hướng ngược). Điểm hợp lệ nhưng không
                // chấm được ⇒ NaN (lỗi số thật, nơi gọi phải loại bước).
                if (!validFsrs7Params(weights)) return null;
                const loss = evaluateParameters(trustedData, weights).loss;
                return Number.isFinite(loss) ? loss : NaN;
            });
            if (g === null) { grad[i] = 0; pinnedCoordinates++; continue; }  // toạ độ bị kẹp
            if (!Number.isFinite(g)) { badGradient = true; break; }
            grad[i] = g;
        }
        if (badGradient) {
            // KHÔNG cập nhật moment, KHÔNG di chuyển: đây không phải một bước tối ưu hợp lệ.
            gradientFailures++;
            backToBest();
            if (++stale >= patience) break;
            continue;
        }
        let stepOk = true;
        for (let i = 0; i < 34; i++) {
            m1[i] = beta1 * m1[i] + (1 - beta1) * grad[i];
            m2[i] = beta2 * m2[i] + (1 - beta2) * grad[i] * grad[i];
            // Bất biến: gradient hữu hạn ⇒ moment hữu hạn; nếu không (tràn số) thì loại bước
            // thay vì để NaN lan sang vòng sau.
            if (!Number.isFinite(m1[i]) || !Number.isFinite(m2[i])) { stepOk = false; break; }
            const mHat = m1[i] / (1 - Math.pow(beta1, iteration + 1));
            const vHat = m2[i] / (1 - Math.pow(beta2, iteration + 1));
            const candidate = unit[i] - lr * mHat / (Math.sqrt(vHat) + eps);
            if (!Number.isFinite(candidate)) { stepOk = false; break; }
            unit[i] = Math.min(1, Math.max(0, candidate));
        }
        if (!stepOk) {
            // Moment của vòng này đã bị nhiễm ⇒ xoá về 0 thay vì mang rác sang vòng sau.
            rejectedSteps++;
            m1.fill(0); m2.fill(0);
            backToBest();
            if (++stale >= patience) break;
            continue;
        }
        // AUDIT-5.1: Adam là phép chiếu theo TỪNG TỌA ĐỘ, nên một bước có thể sinh ra bộ vi phạm
        // ràng buộc thứ tự (w0 ≤ w1 ≤ w2 ≤ w3, w26 ≥ w25). Chiếu lại về miền hợp lệ rồi đưa
        // về không gian [0,1] để vòng sau vẫn tối ưu trên điểm HỢP LỆ. Ở đây ta CHIẾU (không
        // từ chối) vì mục tiêu là tìm bộ tham số tốt, khác với ô nhập tay phải bị chặn.
        {
            const projected = projectFsrs7Params(fromUnit(unit));
            if (!projected) {
                // Không thể xảy ra khi mọi giá trị đã hữu hạn; nếu xảy ra thì đó là lỗi số thật.
                rejectedSteps++;
                m1.fill(0); m2.fill(0);
                backToBest();
                if (++stale >= patience) break;
                continue;
            }
            const back = toUnit(projected);
            for (let i = 0; i < 34; i++) unit[i] = back[i];
        }
        const next = lossOf(unit);
        evaluations++;
        if (Number.isFinite(next)) {
            current = next;
        } else {
            // Bước đi rơi vào vùng loss = Infinity/NaN: nếu chỉ bỏ qua 'next' thì 'unit'
            // VẪN ở điểm hỏng còn 'current' là loss cũ ⇒ gradient vòng sau tính quanh
            // một điểm không tồn tại. Quay lại điểm tốt nhất và tính là một bước cùn.
            rejectedSteps++;
            backToBest();
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
    const validation = evaluateParameters(trustedData, best, 'validation');
    // AUDIT-R3.1: CI và kiểm tra hai nửa phải chấm trên CÙNG tập với `validation` (phần đáng tin),
    // không phải toàn bộ log — nếu không, một chuỗi legacy chưa xác minh vẫn có thể góp phần làm
    // cổng "có ý nghĩa" đạt trong khi mẫu so sánh lấy từ tập khác.
    const baselineLosses = collectValidationLosses(trustedData, start);
    const candidateLosses = collectValidationLosses(trustedData, best);
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
        evaluations, iterations: iteration, count: data.count,
        scoredChains: diagnostics.scoredChains, truncatedChains: diagnostics.truncatedChains,
        logTrimmed: diagnostics.logTrimmed, historyComplete: diagnostics.historyComplete,
        verifiedChains: diagnostics.verifiedChains, assumedStartChains: diagnostics.assumedStartChains,
        trustedChains: diagnostics.trustedChains,
        startEvidence: diagnostics.startEvidence, gradientFailures, pinnedCoordinates, rejectedSteps,
        model: 'dual-stability-34' };
}
