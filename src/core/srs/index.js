// src/core/srs/index.js — FSRS-7 Dual-Stability Engine Coordinator

import { DEFAULT_FSRS7_PARAMS, DESIRED_RETENTION, S_MIN, S_MAX, D_MIN, D_MAX, FUZZ_PERCENTAGE, MAX_INITIAL_INTERVAL, MAX_INTERVAL_DAYS, MAX_GRADUATION_INTERVAL_DAYS, LEARNING_STEPS_MS, D0_BIAS_SCALE, LEECH_LAPSE_THRESHOLD, LEECH_RELEARNING_INTERVAL_MS, LEECH_RELEARNING_STEP } from './constants.js';
import { dualTraceForgettingCurve, shortComponentRecall, nextIntervalNewton } from './forgetting.js';
import { initDifficulty, nextDifficulty } from './difficulty.js';
import { nextStability } from './stability.js';
import { getDifficultyBias, getStabilityMultiplier } from './heuristics.js';
import { validFsrs7Params } from './constants.js';
import { nextRevision } from '../card-merge.js';

const DAY_MS = 86400000;
const FINAL_LEARNING_STEP = LEARNING_STEPS_MS.length - 1; // 2 => bước 1 ngày

/**
 * T1.4 — Thẻ có phải LEECH (từ "chống lại bạn") hay không.
 * Cờ `isLeech` được engine ghi vào state (lapses >= LEECH_LAPSE_THRESHOLD) để merge
 * được giữa các thiết bị. Thẻ cũ / thẻ nhập từ TSV / thẻ đến từ máy chạy bản cũ có
 * thể thiếu cờ, nên luôn suy ra lại từ `lapses` — hai nguồn không bao giờ lệch nhau.
 *
 * @param {Object} card
 * @returns {boolean}
 */
export function isLeechCard(card) {
    if (!card) return false;
    if (card.isLeech === true) return true;
    return (Number(card.lapses) || 0) >= LEECH_LAPSE_THRESHOLD;
}

/**
 * Đọc bước học hiện tại của thẻ. Thẻ cũ thiếu trường (undefined/null/NaN) => bước 0.
 * @param {Object} card
 * @returns {number} 0 | 1 | 2
 */
function readLearningStep(card) {
    const raw = Number(card?.learningStep);
    if (!Number.isFinite(raw)) return 0;
    return Math.min(FINAL_LEARNING_STEP, Math.max(0, Math.trunc(raw)));
}

/**
 * T1.1 — Learning steps thật cho thẻ đang ở pha New/Learning.
 * Chỉ quyết định LỊCH (status / learningStep / khoảng cách), không đụng vào trạng thái bộ nhớ FSRS.
 *
 * @param {number} currentStep - bước hiện tại 0..2
 * @param {number} rating - 1: Again, 2: Hard, 3: Good, 4: Easy
 * @param {number} fsrsIntervalDays - interval FSRS đã tính (đã fuzz + cap 21 ngày cho lần đầu)
 * @param {{ isFreshCard?: boolean }} [opts] - isFreshCard: thẻ CHƯA TỪNG thuộc (lapses = 0)
 * @returns {{ srsStatus: 'Learning'|'Mastered', learningStep: number, intervalDays: number }}
 */
function scheduleLearningStep(currentStep, rating, fsrsIntervalDays, { isFreshCard = true } = {}) {
    // Thẻ chưa từng thuộc: sau 2-3 lần chạm trong một ngày, FSRS thô vẫn cho 21-38 ngày.
    // Chặn ở 7 ngày để từ mới không biến mất cả tuần ngay sau buổi học đầu tiên.
    // Thẻ tái tốt nghiệp (đã từng Mastered rồi trượt) giữ interval FSRS đầy đủ.
    const graduationCap = isFreshCard ? MAX_GRADUATION_INTERVAL_DAYS : MAX_INTERVAL_DAYS;
    const graduate = () => ({
        srsStatus: 'Mastered',
        learningStep: FINAL_LEARNING_STEP,
        // Tốt nghiệp: dùng interval FSRS nhưng tối thiểu 1 ngày và chịu trần tốt nghiệp ở trên.
        intervalDays: Math.max(1.0, Math.min(graduationCap, fsrsIntervalDays || 1.0))
    });

    if (rating === 1) {
        // Quên: quay về bước đầu, 1 phút nữa gặp lại trong chính phiên học này.
        return { srsStatus: 'Learning', learningStep: 0, intervalDays: LEARNING_STEPS_MS[0] / DAY_MS };
    }
    if (rating === 2) {
        // Khó: nhích 1 bước nhưng luôn chỉ hẹn 10 phút (không nhảy thẳng sang bước 1 ngày).
        return {
            srsStatus: 'Learning',
            learningStep: Math.min(currentStep + 1, FINAL_LEARNING_STEP),
            intervalDays: LEARNING_STEPS_MS[1] / DAY_MS
        };
    }
    if (rating === 3) {
        // Nhớ: chưa hết bước thì sang bước kế tiếp; đang ở bước cuối thì tốt nghiệp.
        if (currentStep >= FINAL_LEARNING_STEP) return graduate();
        const nextStep = currentStep + 1;
        return { srsStatus: 'Learning', learningStep: nextStep, intervalDays: LEARNING_STEPS_MS[nextStep] / DAY_MS };
    }
    // Dễ: tốt nghiệp ngay, interval theo FSRS (lần chấm đầu vẫn chịu cap 21 ngày), tối thiểu 1 ngày.
    return graduate();
}

/**
 * Calculates the next SRS state using the canonical Dual-Stability FSRS-7 algorithm.
 * State carries: [stability (S_long), stabilityShort (S_short), difficulty (D)]
 * 
 * @param {Object} card - Card object
 * @param {number} rating - 1: Again, 2: Hard, 3: Good, 4: Easy
 * @param {string} modality - 'en-vi' | 'typing' | 'quiz'
 * @param {number} anchorStrength - Optional mnemonic anchor [0, 1]
 * @returns {{ newState: Object, log: Object|null }}
 */
export function calculateNextSrsState(card, rating, modality = 'en-vi', anchorStrength = 0, customWeights = null, isSimulation = false, options = {}) {
    if (![1, 2, 3, 4].includes(rating)) throw new RangeError('Rating must be an integer from 1 to 4');
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const newState = { ...card, contentUpdatedAt: card.contentUpdatedAt ?? card.updatedAt ?? 0 };

    // 1. Read custom trained weights if available
    let w = DEFAULT_FSRS7_PARAMS;
    if (validFsrs7Params(customWeights)) {
        w = customWeights;
    } else if (typeof window !== 'undefined' && validFsrs7Params(window.__USER_FSRS7_PARAMS__)) {
        w = window.__USER_FSRS7_PARAMS__;
    }

    // 2. Backward compatibility & Soft Rolling Migration from SM-2 / FSRS-4.5
    if (!Number.isFinite(newState.difficulty)) {
        newState.difficulty = newState.srsEaseFactor ? Math.max(D_MIN, Math.min(D_MAX, 11 - (newState.srsEaseFactor * 2))) : 5.0;
    }
    if (!Number.isFinite(newState.stability) || newState.stability <= 0) {
        newState.stability = Math.max(S_MIN, newState.srsInterval || 1.0);
    }
    if (!Number.isFinite(newState.stabilityShort) || newState.stabilityShort <= 0) {
        // In FSRS-7, short-term S defaults to 0.8 * initial long-term S
        newState.stabilityShort = Math.max(S_MIN, 0.8 * newState.stability);
    }

    newState.lapses = Number.isFinite(Number(newState.lapses)) ? Math.max(0, parseInt(newState.lapses, 10)) : 0;
    newState.anchor = Number.isFinite(anchorStrength) ? Math.min(1, Math.max(0, anchorStrength)) : 0;
    newState.modality = modality;
    newState.srsStatus = newState.srsStatus || 'New';

    let repsNum = Number.isFinite(Number(newState.reps)) ? parseInt(newState.reps, 10) : 0;
    // Inferred reps for legacy cards that have progressed but lack reps counter
    if (newState.srsStatus !== 'New' && repsNum <= 0) {
        repsNum = Math.max(1, Math.round(Math.log2(Math.max(2, newState.srsInterval || newState.stability || 2))));
    }
    newState.reps = Math.max(0, repsNum);

    const lastReviewDate = newState.lastReviewDate || 
        (newState.srsDueDate ? Math.max(0, newState.srsDueDate - (newState.srsInterval || 1) * 86400000) : now);
    const actualDaysElapsed = Math.max(0, (now - lastReviewDate) / 86400000);
    newState.lastReviewDate = now;

    const isFirstReview = newState.srsStatus === 'New' && (card.reps === undefined || card.reps === null || card.reps === 0 || card.reps === '0');

    // 3. First review initialization (New Card)
    if (isFirstReview) {
        const hBias = getDifficultyBias(card);
        const sMult = getStabilityMultiplier(hBias);
        const ratingIdx = Math.min(4, Math.max(1, rating)) - 1;

        // T1.3: bias đã bị thu về ±0.5 (heuristics.js) nên D0 chỉ nhích tối đa ±0.25
        // thay vì ±1.5 như trước (trước: bias ±3.0 × 0.5). Công thức FSRS không đổi.
        const baseS = w[ratingIdx] * sMult;
        const baseD = initDifficulty(rating, w) + hBias * D0_BIAS_SCALE;

        newState.difficulty = Math.min(D_MAX, Math.max(D_MIN, baseD));
        newState.stability = Math.min(S_MAX, Math.max(S_MIN, baseS));
        newState.stabilityShort = Math.min(S_MAX, Math.max(S_MIN, 0.8 * baseS));
        newState.reps = rating > 1 ? 1 : 0;
        if (rating === 1) newState.lapses = 1;
    } else {
        // 4. Subsequent reviews (Dual-Stability Step)
        const retrievability = dualTraceForgettingCurve(actualDaysElapsed, newState.stability, newState.stabilityShort, newState.difficulty, w);
        const r1 = shortComponentRecall(actualDaysElapsed, newState.stabilityShort, w);

        // Update Long-term Stability (start = 7)
        let upd_s_long = nextStability(newState.stability, newState.difficulty, retrievability, rating, 7, w);
        
        // Update Short-term Stability (start = 15)
        let upd_s_short = nextStability(newState.stabilityShort, newState.difficulty, r1, rating, 15, w);

        // Update Difficulty with Surprise-Weighted Lapse
        let upd_d = nextDifficulty(newState.difficulty, rating, retrievability, newState.anchor, w);

        if (rating === 1) { // Lapse (Again)
            // Post-lapse short-term cap: s_short is capped at 0.8 * post-lapse long-term S (bounded by S_MIN)
            upd_s_short = Math.max(S_MIN, Math.min(upd_s_short, 0.8 * upd_s_long));
            newState.lapses = (newState.lapses || 0) + 1;
            newState.isSuspended = false;
            // Lapse forgiveness: keep 50% reps rather than resetting to 0
            newState.reps = Math.max(1, Math.ceil((newState.reps || 0) / 2));
        } else {
            newState.reps = (newState.reps || 0) + 1;
        }

        newState.stability = upd_s_long;
        // FSRS-7 chính thức chỉ giới hạn S_short trong khoảng [S_MIN, S_MAX];
        // KHÔNG ép S_short <= S_long sau mỗi lượt (chỉ nhánh lapse mới có cap 0.8*S_long ở trên).
        newState.stabilityShort = Math.min(S_MAX, Math.max(S_MIN, upd_s_short));
        newState.difficulty = upd_d;
    }

    // 5. Typing Modality Bonus (Desirable Difficulty áp dụng lên gia số tăng trưởng thực tế)
    // Ràng buộc: Chỉ áp dụng khi thẻ đã qua ít nhất 1 chu kỳ thực sự và không phải Re-learning nội nhật
    if (modality === 'typing' && rating > 1 && (card.reps || 0) > 0 && actualDaysElapsed >= 0.05) {
        const oldLong = card.stability || S_MIN;
        const oldShort = card.stabilityShort || S_MIN;

        if (newState.stability > oldLong) {
            const deltaLong = newState.stability - oldLong;
            newState.stability = Math.min(S_MAX, oldLong + deltaLong * 1.25);
        }
        if (newState.stabilityShort > oldShort) {
            const deltaShort = newState.stabilityShort - oldShort;
            // Giữ nguyên mô hình FSRS-7: chỉ clamp vào [S_MIN, S_MAX], không ép theo S_long.
            newState.stabilityShort = Math.min(S_MAX, oldShort + deltaShort * 1.25);
        }
    }

    // 6. Anchor Modality Adjustment
    let effectiveLongS = newState.stability;
    let effectiveShortS = newState.stabilityShort;
    if (newState.anchor > 0) {
        effectiveLongS = Math.min(S_MAX, effectiveLongS * (1 + 0.2 * newState.anchor));
        effectiveShortS = Math.min(S_MAX, effectiveShortS * (1 + 0.2 * newState.anchor));
    }

    // 7. Calculate Fractional Interval via Newton-Raphson in log(t) space
    // Thẻ đang trong pha học (New/Learning) đi qua learning steps; mọi thẻ khác giữ hành vi cũ.
    const wasInLearningPhase = card.srsStatus === 'New' || card.srsStatus === 'Learning';

    // 7a. Interval dài hạn theo FSRS (đã fuzz + cap 21 ngày cho lần chấm đầu).
    //     Dùng cho cả nhánh tốt nghiệp Learning steps lẫn nhánh Mastered.
    let fsrsIntervalDays = 0;
    if (rating > 1) {
        fsrsIntervalDays = options.memoryOnly ? 0 : nextIntervalNewton(effectiveLongS, effectiveShortS, newState.difficulty, DESIRED_RETENTION, w);

        // Fuzzing for intervals >= 2.5 days to distribute review load
        if (fsrsIntervalDays >= 2.5 && !isSimulation) {
            const fuzzRange = fsrsIntervalDays * FUZZ_PERCENTAGE;
            const fuzzOffset = (Math.random() * 2 - 1) * fuzzRange;
            fsrsIntervalDays = Math.max(1.0, fsrsIntervalDays + fuzzOffset);
        }

        // Chốt chặn an toàn (Fail-safe): thẻ mới tinh lần đầu tối đa 21 ngày.
        // Phải áp SAU fuzz, nếu không fuzz ±5% có thể đẩy 21 ngày lên 22,05 ngày.
        if (isFirstReview && fsrsIntervalDays > MAX_INITIAL_INTERVAL) {
            fsrsIntervalDays = MAX_INITIAL_INTERVAL;
        }
    }

    let nextIntervalDays;
    // T1.4 — Cờ leech phải được cập nhật TRƯỚC khi quyết định lịch, vì thẻ vừa trượt
    // lần thứ 4 phải được đối xử như leech ngay trong chính lượt đó.
    newState.isLeech = (Number(newState.lapses) || 0) >= LEECH_LAPSE_THRESHOLD;

    if (rating === 1 && newState.isLeech) {
        // 7b-leech. T1.4: KHÔNG nhồi lại ngay (massed practice chỉ tạo "thuộc giả").
        // Hẹn lại sau 10 phút (một bước relearning thật) để người học phải quên đi một
        // chút rồi mới gặp lại; UI sẽ gắn badge "CỰC KHÓ" khi thẻ hiện lại.
        newState.srsStatus = 'Learning';
        newState.learningStep = LEECH_RELEARNING_STEP;
        nextIntervalDays = LEECH_RELEARNING_INTERVAL_MS / DAY_MS;
    } else if (wasInLearningPhase) {
        // 7b. LEARNING STEPS (T1.1): 1 phút → 10 phút → 1 ngày → mới tốt nghiệp Mastered.
        //     Chỉ override lịch; S/S_short/D/reps/lapses/srsUpdatedAt vẫn cập nhật như trên.
        const schedule = scheduleLearningStep(readLearningStep(card), rating, fsrsIntervalDays, {
            // lapses > 0 => thẻ đã từng thuộc rồi trượt: không áp trần tốt nghiệp 7 ngày.
            isFreshCard: (Number(newState.lapses) || 0) === 0
        });
        newState.srsStatus = schedule.srsStatus;
        newState.learningStep = schedule.learningStep;
        nextIntervalDays = schedule.intervalDays;
    } else if (rating === 1) {
        // 7c. Thẻ (chưa leech) vừa trượt: hẹn gặp lại ngay trong phiên đang học.
        //     Riêng thẻ leech đã được nhánh 7b-leech chặn lại với bước relearning 10 phút.
        nextIntervalDays = 0;
        newState.srsStatus = 'Learning';
        // Thẻ vừa trượt phải leo lại thang bước học từ đầu (không giữ bước cũ để "tốt nghiệp lại" ngay).
        newState.learningStep = 0;
    } else {
        // 7d. Thẻ đã Mastered: giữ nguyên hành vi trước T1.1.
        nextIntervalDays = fsrsIntervalDays;

        // Graduation to Mastered:
        // - Rating 3 (Good) / 4 (Easy)
        // - Hoặc thẻ đã Mastered từ trước và nhận Rating 2 (Hard) (vẫn nhớ được từ, không phải Lapse)
        // - Hoặc độ bền trí nhớ >= 3.0 ngày với reps >= 2
        const wasMastered = card.srsStatus === 'Mastered';
        if (rating >= 3 || (wasMastered && rating === 2) || (newState.stability >= 3.0 && (newState.reps || 0) >= 2)) {
            newState.srsStatus = 'Mastered';
            // GRADUATION & RECALL FLOOR GUARD:
            // Bất kỳ thẻ nào tốt nghiệp hoặc duy trì Mastered thì chu kỳ tiếp theo BẮT BUỘC tối thiểu 1.0 ngày (sang ngày mai)
            // Tuyệt đối không cho phép thẻ Mastered có chu kỳ tính bằng phút/giờ trong ngày hôm nay (< 1.0 ngày)
            if (nextIntervalDays < 1.0) {
                nextIntervalDays = 1.0;
            }
        } else {
            newState.srsStatus = 'Learning';
        }
    }

    // Trần khoảng cách TUYỆT ĐỐI cho mọi lần chấm (không chỉ thẻ mới): áp SAU fuzz.
    // MAX_INITIAL_INTERVAL chỉ là cap của lần chấm đầu; đây là cap của toàn bộ vòng đời thẻ.
    nextIntervalDays = Math.min(MAX_INTERVAL_DAYS, nextIntervalDays);

    const nextDueDate = now + Math.round(nextIntervalDays * 86400000);
    newState.srsInterval = nextIntervalDays;
    newState.srsDueDate = nextDueDate;
    newState.updatedAt = now;
    newState.srsUpdatedAt = nextRevision(card, 'srsUpdatedAt', now);
    newState.updatedAt = Math.max(now, newState.srsUpdatedAt, card.updatedAt || 0);

    // 8. Log review (captures short-term and long-term reviews for FSRS-7 optimizer)
    let rLog = null;
    {
        rLog = {
            cardId: card.id,
            rating: rating,
            t: actualDaysElapsed,
            modality: modality,
            reviewTime: now
        };
    }

    const intervalStr = nextIntervalDays < 1 
        ? `${(nextIntervalDays * 24).toFixed(1)}h` 
        : `${nextIntervalDays.toFixed(1)}d`;

    if (!isSimulation && options.debug) {
        console.log(`[FSRS-7] "${newState.english}" | R: ${rating} | D: ${newState.difficulty.toFixed(2)} | S_long: ${newState.stability.toFixed(2)} | S_short: ${newState.stabilityShort.toFixed(2)} | Interval: ${intervalStr}`);
    }

    return { newState, log: rLog };
}

/**
 * Formats a predicted interval into an elegant badge label.
 * e.g., "<10p", "1d", "4d", "1.5th", "2n"
 * @param {number} days
 * @returns {string}
 */
export function formatIntervalPreview(days) {
    if (days <= 0) return '<10p';
    if (days < 1) {
        const hours = Math.round(days * 24);
        return hours <= 1 ? '<1h' : `${hours}h`;
    }
    if (days < 30) {
        const rounded = days < 2 ? days.toFixed(1).replace(/\.0$/, '') : Math.round(days);
        return `${rounded}d`;
    }
    if (days < 365) {
        const months = (days / 30).toFixed(1).replace(/\.0$/, '');
        return `${months}th`;
    }
    const years = (days / 365).toFixed(1).replace(/\.0$/, '');
    return `${years}n`;
}

/**
 * Nhãn cho thẻ đang ở pha học (New/Learning) — phải nói đúng bước học thật:
 * "1p", "10p", "1h", "1 ngày"… thay vì "5d"/"13d" như trước T1.1.
 * @param {number} intervalDays
 * @returns {string}
 */
function formatLearningPreview(intervalDays) {
    const ms = intervalDays * DAY_MS;
    if (ms < 3600000) return `${Math.max(1, Math.round(ms / 60000))}p`;
    if (ms < DAY_MS) return `${Math.round(ms / 3600000)}h`;
    const days = Math.round(ms / DAY_MS);
    if (days < 30) return `${days} ngày`;
    return formatIntervalPreview(intervalDays);
}

/**
 * Predicts interval badges for all 4 ratings without mutating state or triggering logs.
 * @param {Object} card 
 * @param {string} modality 
 * @returns {{ 1: string, 2: string, 3: string, 4: string }}
 */
export function predictNextIntervals(card, modality = 'en-vi') {
    if (!card) return { 1: '<10p', 2: '1d', 3: '3d', 4: '7d' };
    const inLearningPhase = card.srsStatus === 'New' || card.srsStatus === 'Learning';
    const fallback = inLearningPhase
        ? { 1: '1p', 2: '10p', 3: '10p', 4: '1 ngày' }
        : { 1: '<10p', 2: '1d', 3: '3d', 4: '7d' };
    const predictions = {};
    for (let rating = 1; rating <= 4; rating++) {
        try {
            const { newState } = calculateNextSrsState(card, rating, modality, 0, null, true);
            // Nút chấm không được hứa quá 365 ngày (dự báo cũng phải chịu cùng trần với lịch thật).
            const cappedDays = Math.min(MAX_INTERVAL_DAYS, newState.srsInterval);
            // T1.4: thẻ leech vừa trượt được hẹn đúng 10 phút (bước relearning), nên nhãn
            // nút "Quên" phải nói "10p" chứ không phải "<10p" / "<1h" gây hiểu sai.
            if (rating === 1 && isLeechCard(card)) {
                predictions[rating] = formatLearningPreview(LEECH_RELEARNING_INTERVAL_MS / DAY_MS);
            } else {
                predictions[rating] = inLearningPhase
                    ? formatLearningPreview(cappedDays)
                    : formatIntervalPreview(cappedDays);
            }
        } catch (e) {
            predictions[rating] = fallback[rating];
        }
    }
    return predictions;
}

