// src/core/srs/stability.js — FSRS-7 Dual-Stability Engine (Long-Term & Short-Term)

import { DEFAULT_FSRS7_PARAMS, S_MIN, S_MAX } from './constants.js';

/**
 * Next stability calculation for FSRS-7.
 * Supports both long-term stability (start = 7) and short-term stability (start = 15).
 * In FSRS-7, post-lapse stability is D-INDEPENDENT (the old D factor was ablated based on empirical benchmarks).
 * 
 * @param {number} last_s - Previous stability
 * @param {number} last_d - Previous difficulty
 * @param {number} r - Retrievability (mixed R for long-term S, r1 for short-term S)
 * @param {number} rating - Rating (1: Again, 2: Hard, 3: Good, 4: Easy)
 * @param {number} start - Parameter block index (7 for long-term, 15 for short-term)
 * @param {Array<number>} customParams - Optional 34-parameter array
 * @returns {number} Updated stability clamped to [S_MIN, S_MAX]
 */
export function nextStability(last_s, last_d, r, rating, start = 7, customParams = null) {
    const w = customParams || DEFAULT_FSRS7_PARAMS;

    const safeS = Math.min(S_MAX, Math.max(S_MIN, last_s));
    const safeD = Math.min(10.0, Math.max(1.0, last_d));
    const safeR = Math.min(1.0, Math.max(0.0, r));

    const hard_penalty = (rating === 2) ? w[start + 6] : 1.0;
    const easy_bonus = (rating === 4) ? w[start + 7] : 1.0;

    // Post-lapse stability (when forgotten)
    const new_s_fail = w[start + 3] * 
        (Math.pow(safeS + 1.0, w[start + 4]) - 1.0) * 
        Math.exp((1.0 - safeR) * w[start + 5]);
    const pls = Math.min(safeS, new_s_fail);

    // Stability increase on recall
    const sinc = Math.exp(w[start] - 1.5) * 
        (11.0 - safeD) * 
        Math.pow(safeS, -w[start + 1]) * 
        (Math.exp((1.0 - safeR) * w[start + 2]) - 1.0) * 
        hard_penalty * 
        easy_bonus + 1.0;

    const new_s_success = Math.max(pls, safeS * sinc);
    const result = (rating > 1) ? new_s_success : pls;

    return Math.min(S_MAX, Math.max(S_MIN, result));
}

/**
 * Helper to update both Long-term and Short-term stability simultaneously.
 * Returns [upd_s_long, upd_s_short]
 */
export function nextDualStability(s_long, s_short, d, r, r1, rating, customParams = null) {
    const sL = nextStability(s_long, d, r, rating, 7, customParams);
    let sS = nextStability(s_short, d, (r1 !== undefined ? r1 : r), rating, 15, customParams);
    if (rating === 1) {
        sS = Math.max(S_MIN, Math.min(sS, 0.8 * sL));
    }
    return [sL, sS];
}

export function nextStabilityRecall(d, s, r, rating, reps, customParams) {
    return nextStability(s, d, r, rating, 7, customParams);
}

export function postLapseStability(oldS, oldD, lapses, predictedR, customParams) {
    return nextStability(oldS, oldD, predictedR, 1, 7, customParams);
}

