// optimizer.worker.js
// Simple (μ/μ_w, λ)-ES (Evolution Strategy) cho 9 chiều

const FACTOR = 19 / 81;
const DECAY = -0.5;

function getRetrievability(stability, elapsedDays) {
    return Math.pow(1 + FACTOR * elapsedDays / stability, DECAY);
}

function updateDifficulty(d, predictedR, actualOutcome) {
    const surprise = predictedR - actualOutcome;
    const alpha = 0.2;
    const rawDelta = alpha * surprise;
    const damping = (d * (10 - d)) / 25;
    let newD = d + rawDelta * damping;
    newD = 0.9 * newD + 0.1 * 5;
    return Math.min(10, Math.max(1, newD));
}

function nextStabilityRecall(d, s, r, rating, reps, a) {
    const rawSpacing = Math.exp(a[5] * (1 - r)) - 1;
    const spacingEffect = Math.max(0.2, rawSpacing);
    const logReps = Math.log(1 + reps);
    let factor;
    if (rating === 2) factor = a[0] * (11 - d) * Math.pow(s, -a[1]) * spacingEffect * logReps;
    else if (rating === 3) factor = a[2] * (11 - d) * Math.pow(s, -a[3]) * spacingEffect * logReps;
    else factor = a[4] * (11 - d) * Math.pow(s, -a[3]) * spacingEffect * logReps * 1.5;
    const minGrowth = rating === 4 ? 1.20 : (rating === 3 ? 1.10 : 1.05);
    return Math.max(s * minGrowth, s * (1 + factor));
}

function postLapseStability(oldS, oldD, lapses, predictedR, w) {
    const retentionFactor = Math.exp(-w[0] * predictedR);
    const lapsePenalty = 1 / (1 + w[1] * lapses);
    const difficultyFactor = Math.exp(-w[2] * oldD);
    const newS = oldS * retentionFactor * lapsePenalty * difficultyFactor;
    return Math.max(1, Math.max(oldS * 0.5, newS));
}

function computeLoss(logsGroupedByCard, params) {
    const a = params.slice(0, 6);
    const w = params.slice(6, 9);
    
    let totalLoss = 0;
    let count = 0;

    for (const cardId in logsGroupedByCard) {
        const history = logsGroupedByCard[cardId];
        let s = 0, d = 5, reps = 0, lapses = 0;

        for (let i = 0; i < history.length; i++) {
            const entry = history[i];
            const rating = entry.rating;
            const t = entry.t;

            if (i === 0) {
                // Giả lập thẻ mới
                if (rating === 1) { d = 8; s = 0.5; reps = 0; lapses = 1; }
                else if (rating === 2) { d = 7; s = 1; reps = 1; }
                else if (rating === 3) { d = 5; s = 3; reps = 1; }
                else { d = 3; s = 5; reps = 1; }
                continue;
            }

            const r = getRetrievability(s, t);
            const actualOutcome = rating === 1 ? 0 : (rating === 2 ? 0.5 : 1);

            // Cộng dồn Loss
            totalLoss += Math.pow(r - actualOutcome, 2);
            count++;

            // Cập nhật D, S cho bước tiếp theo
            d = updateDifficulty(d, r, actualOutcome);

            if (rating === 1) {
                s = postLapseStability(s, d, lapses, r, w);
                lapses++;
                // Đồng bộ chính xác với logic Reps Decay của UI thay vì reps = 0
                reps = Math.max(1, Math.ceil(reps / 2));
            } else {
                s = nextStabilityRecall(d, s, r, rating, reps, a);
                reps++;
            }
            
            if (entry.isTyping && rating > 1) {
                s *= 1.25;
            }
        }
    }

    return count > 0 ? (totalLoss / count) : 9999;
}

// Sinh nhiễu Gaussian bằng Box-Muller transform
function randomGaussian() {
    let u = 0, v = 0;
    while(u === 0) u = Math.random();
    while(v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// Khởi chạy tối ưu hoá
self.onmessage = function(e) {
    if (e.data.type === 'START_OPTIMIZATION') {
        const payload = e.data.payload;
        
        // Nhóm logs theo cardId
        const grouped = {};
        if (Array.isArray(payload)) {
            for (const log of payload) {
                if (!grouped[log.cardId]) grouped[log.cardId] = [];
                const isTyping = log.modality === 'typing' || log.isTyping === true;
                grouped[log.cardId].push({ cardId: log.cardId, rating: log.rating, t: log.t, isTyping });
            }
        } else if (payload.dict && payload.logs) {
            for (const l of payload.logs) {
                const id = payload.dict[l[0]];
                if (!grouped[id]) grouped[id] = [];
                grouped[id].push({ cardId: id, rating: l[1], t: l[2], isTyping: l[4] === 1 });
            }
        }

        const BASELINE = [0.15, 0.1, 0.3, 0.2, 0.5, 0.3, 0.5, 0.2, 0.1];
        
        // Train / Validation split (80/20 cardId)
        const allCardIds = Object.keys(grouped);
        // BUG-08 FIX: Fisher-Yates shuffle để loại bỏ temporal bias
        for (let i = allCardIds.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allCardIds[i], allCardIds[j]] = [allCardIds[j], allCardIds[i]];
        }
        const trainSize = Math.floor(allCardIds.length * 0.8);
        const trainIds = allCardIds.slice(0, trainSize);
        const valIds = allCardIds.slice(trainSize);

        const trainLogs = {};
        const valLogs = {};
        trainIds.forEach(id => trainLogs[id] = grouped[id]);
        valIds.forEach(id => valLogs[id] = grouped[id]);

        const baselineLoss = computeLoss(valLogs, BASELINE);
        console.log(`[ES Optimizer] Baseline Val Loss: ${baselineLoss.toFixed(4)}`);

        // (mu, lambda)-ES Configuration
        const lambda = 30; // Số cá thể mỗi quần thể
        const mu = 5;      // Số cá thể tốt nhất được chọn
        const generations = 60;
        
        let mean = [...BASELINE];
        let sigma = 0.1; // Độ lệch chuẩn khởi tạo
        
        for (let g = 0; g < generations; g++) {
            const population = [];
            
            for (let i = 0; i < lambda; i++) {
                // Tạo offspring bằng Gaussian noise
                const candidate = mean.map(val => Math.max(0.01, val + randomGaussian() * sigma));
                const loss = computeLoss(trainLogs, candidate);
                population.push({ params: candidate, loss });
            }
            
            // Chọn ra mu cá thể tốt nhất
            population.sort((a, b) => a.loss - b.loss);
            const best = population.slice(0, mu);
            
            // Cập nhật mean
            for (let dim = 0; dim < 9; dim++) {
                let sum = 0;
                for (let i = 0; i < mu; i++) {
                    sum += best[i].params[dim];
                }
                mean[dim] = sum / mu;
            }
            
            // Giảm dần step size (Decay)
            sigma *= 0.95;
        }

        // Đánh giá bộ mean tốt nhất trên tập Validation
        const optimizedLoss = computeLoss(valLogs, mean);
        console.log(`[ES Optimizer] Optimized Val Loss: ${optimizedLoss.toFixed(4)}`);

        // Yêu cầu giảm ít nhất 5% để tránh overfitting (học vẹt) do dữ liệu còn nhỏ
        if (optimizedLoss < baselineLoss * 0.95) {
            self.postMessage({
                type: 'OPTIMIZATION_COMPLETE',
                payload: {
                    improved: true,
                    recallParams: mean.slice(0, 6),
                    lapseParams: mean.slice(6, 9),
                    oldLoss: baselineLoss,
                    newLoss: optimizedLoss
                }
            });
        } else {
            self.postMessage({
                type: 'OPTIMIZATION_COMPLETE',
                payload: {
                    improved: false,
                    oldLoss: baselineLoss,
                    newLoss: optimizedLoss
                }
            });
        }
    }
};
