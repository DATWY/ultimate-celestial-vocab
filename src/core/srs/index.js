// src/core/srs/index.js — FSRS-7 Dual-Stability Engine Coordinator

import { DEFAULT_FSRS7_PARAMS, DESIRED_RETENTION, S_MIN, S_MAX, D_MIN, D_MAX, FUZZ_PERCENTAGE, MAX_INITIAL_INTERVAL } from './constants.js';
import { dualTraceForgettingCurve, shortComponentRecall, nextIntervalNewton } from './forgetting.js';
import { initDifficulty, nextDifficulty } from './difficulty.js';
import { nextStability } from './stability.js';
import { getDifficultyBias, getStabilityMultiplier } from './heuristics.js';

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
export function calculateNextSrsState(card, rating, modality = 'en-vi', anchorStrength = 0, customWeights = null) {
    const now = Date.now();
    const newState = { ...card };

    // 1. Read custom trained weights if available
    let w = DEFAULT_FSRS7_PARAMS;
    if (Array.isArray(customWeights) && customWeights.length === 34 && customWeights.every(n => typeof n === 'number' && !isNaN(n))) {
        w = customWeights;
    } else if (typeof window !== 'undefined' && Array.isArray(window.__USER_FSRS7_PARAMS__) && window.__USER_FSRS7_PARAMS__.length === 34) {
        w = window.__USER_FSRS7_PARAMS__;
    }

    // 2. Backward compatibility & Soft Rolling Migration from SM-2 / FSRS-4.5
    if (newState.difficulty === undefined) {
        newState.difficulty = newState.srsEaseFactor ? Math.max(D_MIN, Math.min(D_MAX, 11 - (newState.srsEaseFactor * 2))) : 5.0;
    }
    if (newState.stability === undefined) {
        newState.stability = Math.max(S_MIN, newState.srsInterval || 1.0);
    }
    if (newState.stabilityShort === undefined) {
        // In FSRS-7, short-term S defaults to 0.8 * initial long-term S
        newState.stabilityShort = Math.max(S_MIN, 0.8 * newState.stability);
    }

    newState.lapses = newState.lapses || 0;
    newState.anchor = anchorStrength || 0;
    newState.modality = modality;
    newState.srsStatus = newState.srsStatus || 'New';

    // Inferred reps for legacy cards that have progressed but lack reps counter
    if (newState.srsStatus !== 'New' && (!newState.reps || newState.reps === 0)) {
        newState.reps = Math.max(1, Math.round(Math.log2(Math.max(2, newState.srsInterval || newState.stability || 2))));
    } else {
        newState.reps = newState.reps || 0;
    }

    const lastReviewDate = newState.lastReviewDate || 
        (newState.srsDueDate ? Math.max(0, newState.srsDueDate - (newState.srsInterval || 1) * 86400000) : now);
    const actualDaysElapsed = Math.max(0, (now - lastReviewDate) / 86400000);
    newState.lastReviewDate = now;

    // 3. First review initialization (New Card)
    if (newState.srsStatus === 'New' && (!newState.reps || newState.reps === 0)) {
        const hBias = getDifficultyBias(card);
        const sMult = getStabilityMultiplier(hBias);
        const ratingIdx = Math.min(4, Math.max(1, rating)) - 1;

        const baseS = w[ratingIdx] * sMult;
        const baseD = initDifficulty(rating, w) + hBias * 0.5;

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
        const upd_s_long = nextStability(newState.stability, newState.difficulty, retrievability, rating, 7, w);
        
        // Update Short-term Stability (start = 15)
        let upd_s_short = nextStability(newState.stabilityShort, newState.difficulty, r1, rating, 15, w);

        // Update Difficulty with Surprise-Weighted Lapse
        const upd_d = nextDifficulty(newState.difficulty, rating, retrievability, newState.anchor, w);

        if (rating === 1) { // Lapse (Again)
            // Post-lapse short-term cap: s_short is capped at 0.8 * post-lapse long-term S (bounded by S_MIN)
            upd_s_short = Math.max(S_MIN, Math.min(upd_s_short, 0.8 * upd_s_long));
            newState.lapses = (newState.lapses || 0) + 1;
            if (newState.lapses >= 8) {
                newState.isSuspended = true;
            }
            // Lapse forgiveness: keep 50% reps rather than resetting to 0
            newState.reps = Math.max(1, Math.ceil((newState.reps || 0) / 2));
        } else {
            newState.reps = (newState.reps || 0) + 1;
        }

        newState.stability = upd_s_long;
        newState.stabilityShort = upd_s_short;
        newState.difficulty = upd_d;
    }

    // 5. Typing Modality Bonus (Desirable Difficulty: +25% Stability)
    if (modality === 'typing' && rating > 1) {
        newState.stability = Math.min(S_MAX, newState.stability * 1.25);
        newState.stabilityShort = Math.min(S_MAX, newState.stabilityShort * 1.25);
    }

    // 6. Anchor Modality Adjustment
    let effectiveLongS = newState.stability;
    let effectiveShortS = newState.stabilityShort;
    if (newState.anchor > 0) {
        effectiveLongS = Math.min(S_MAX, effectiveLongS * (1 + 0.2 * newState.anchor));
        effectiveShortS = Math.min(S_MAX, effectiveShortS * (1 + 0.2 * newState.anchor));
    }

    // 7. Calculate Fractional Interval via Newton-Raphson in log(t) space
    let nextIntervalDays = 0;
    if (rating === 1) {
        // Failed card: schedule immediate review in the active session
        nextIntervalDays = 0;
        newState.srsStatus = 'Learning';
    } else {
        nextIntervalDays = nextIntervalNewton(effectiveLongS, effectiveShortS, newState.difficulty, DESIRED_RETENTION, w);

        // Chốt chặn an toàn (Fail-safe): Thẻ mới tinh lần đầu tiên tối đa 21 ngày (tránh bấm nhầm Easy bị đẩy đi 4 tháng)
        const isInitialReview = !card.reps || card.reps <= 1 || card.srsStatus === 'New';
        if (isInitialReview && nextIntervalDays > MAX_INITIAL_INTERVAL) {
            nextIntervalDays = MAX_INITIAL_INTERVAL;
        }

        // Fuzzing for intervals >= 2.5 days to distribute review load
        if (nextIntervalDays >= 2.5) {
            const fuzzRange = nextIntervalDays * FUZZ_PERCENTAGE;
            const fuzzOffset = (Math.random() * 2 - 1) * fuzzRange;
            nextIntervalDays = Math.max(1.0, nextIntervalDays + fuzzOffset);
        }

        // Graduation to Mastered: Rating 3 (Good) / 4 (Easy) or memory durability >= 3 days with reps >= 2
        if (rating >= 3 || (newState.stability >= 3.0 && (newState.reps || 0) >= 2)) {
            newState.srsStatus = 'Mastered';
        } else {
            newState.srsStatus = 'Learning';
        }
    }

    const nextDueDate = now + Math.round(nextIntervalDays * 86400000);
    newState.srsInterval = nextIntervalDays;
    newState.srsDueDate = nextDueDate;
    newState.updatedAt = now;

    // 8. Log review (captures short-term and long-term reviews for FSRS-7 optimizer)
    let rLog = null;
    if (actualDaysElapsed > 0 || (newState.reps && newState.reps > 1)) {
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

    console.log(`[FSRS-7] "${newState.english}" | R: ${rating} | D: ${newState.difficulty.toFixed(2)} | S_long: ${newState.stability.toFixed(2)} | S_short: ${newState.stabilityShort.toFixed(2)} | Interval: ${intervalStr}`);

    return { newState, log: rLog };
}

