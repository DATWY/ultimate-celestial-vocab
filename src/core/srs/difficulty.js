// src/core/srs/difficulty.js — FSRS-7 Surprise-Weighted Difficulty Engine

import { DEFAULT_FSRS7_PARAMS, D_MIN, D_MAX } from './constants.js';

/**
 * Initial difficulty D0 for rating 1..4 in FSRS-7
 * Formula: w[4] - exp(w[5] * (rating - 1)) + 1.0, clamped to [D_MIN, D_MAX]
 */
export function initDifficulty(rating, w = DEFAULT_FSRS7_PARAMS) {
    const clampedRating = Math.min(4, Math.max(1, Math.round(rating)));
    const rawD = w[4] - Math.exp(w[5] * (clampedRating - 1)) + 1.0;
    return Math.min(D_MAX, Math.max(D_MIN, rawD));
}

/**
 * Linear damping function from FSRS-7
 * Damps the change in D as it approaches boundary extremes (1.0 or 10.0)
 */
export function linearDamping(deltaD, lastD) {
    if (deltaD > 0) {
        return ((D_MAX - lastD) / 9.0) * deltaD;
    } else {
        return ((lastD - D_MIN) / 9.0) * deltaD;
    }
}

/**
 * Mean reversion function from FSRS-7
 * Pulls current difficulty 1% towards initDifficulty(4) to avoid boundary traps
 */
export function meanReversion(currentD, w = DEFAULT_FSRS7_PARAMS) {
    const init4 = initDifficulty(4, w);
    return 0.01 * init4 + 0.99 * currentD;
}

/**
 * Next difficulty update in FSRS-7:
 * - Delta D based on (rating - 3)
 * - Surprise-weighted lapse: on rating == 1, delta_d is scaled by (retention + 0.1)
 * - Linear damping
 * - 1% mean reversion
 * - Clamping to [1.0, 10.0]
 */
export function nextDifficulty(lastD, rating, retention, anchor = 0, w = DEFAULT_FSRS7_PARAMS) {
    const safeD = Math.min(D_MAX, Math.max(D_MIN, typeof lastD === 'number' ? lastD : 5.0));
    
    let deltaD = -w[6] * (rating - 3);

    // FSRS-7 Surprise-weighted lapse: failing a high-retention card means it is surprisingly hard
    if (rating === 1) {
        const safeR = Math.min(1.0, Math.max(0.0, retention !== undefined ? retention : 0.9));
        deltaD = deltaD * (safeR + 0.1);
    }

    // Anchor protection (if user created mnemonic anchors)
    if (anchor > 0) {
        deltaD *= (1.0 - Math.min(0.5, 0.2 * anchor));
    }

    const dampedDelta = linearDamping(deltaD, safeD);
    const rawNewD = safeD + dampedDelta;
    const revertedD = meanReversion(rawNewD, w);

    return Math.min(D_MAX, Math.max(D_MIN, revertedD));
}

/**
 * Backward compatibility wrapper for existing code
 */
export function updateDifficulty(lastD, predictedR, actualOutcome, anchor, w = DEFAULT_FSRS7_PARAMS) {
    // Map actualOutcome (0 = Again, 0.5 = Hard, 1 = Good) to rating
    let rating = 3;
    if (actualOutcome === 0) rating = 1;
    else if (actualOutcome === 0.5) rating = 2;
    return nextDifficulty(lastD, rating, predictedR, anchor, w);
}

