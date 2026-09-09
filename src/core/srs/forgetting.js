// src/core/srs/forgetting.js — FSRS-7 Dual-Trace Mixture Forgetting Curve & Interval Solver

import { DEFAULT_FSRS7_PARAMS, DESIRED_RETENTION, S_MIN, S_MAX, D_MIN, D_MAX } from './constants.js';

/**
 * Short-term recall component r1, driven by short-term S (decay S-modulated via s_decay1).
 * @param {number} t - Elapsed time in days (supports continuous fractional days)
 * @param {number} s_short - Short-term stability
 * @param {Array<number>} w - 34-parameter weight array
 * @returns {number} Probability of short-term recall
 */
export function shortComponentRecall(t, s_short, w = DEFAULT_FSRS7_PARAMS) {
    const safeT = Math.max(0, t);
    const safeS = Math.max(S_MIN, s_short);
    const t_over_s = safeT / safeS;

    const decay1_mag = Math.min(0.95, Math.max(0.01, w[23] * Math.pow(safeS, w[33] - 0.3)));
    const decay1 = -decay1_mag;

    // factor1 built in log-space with exponent clamped at 60 for numerical stability
    const exponent = Math.min(60.0, Math.log(w[25]) / decay1);
    const factor1 = Math.exp(exponent) - 1.0;

    return Math.pow(t_over_s * factor1 + 1.0, decay1);
}

/**
 * Dual-stability forgetting curve (FSRS-7 34-parameter mixture).
 * Curve indices: 23: decay1, 24: decay2, 25: base1, 26: base2, 27: base_weight1,
 * 28: base_weight2, 29: s_weight_power1, 30: s_weight_power2, 31: d_weight, 32: d_decay, 33: s_decay1.
 * 
 * @param {number} t - Elapsed time in days
 * @param {number} s_long - Long-term stability
 * @param {number} s_short - Short-term stability
 * @param {number} d - Difficulty [1, 10]
 * @param {Array<number>} w - 34-parameter weight array
 * @returns {number} Mixed Retrievability probability R in [0, 1]
 */
export function dualTraceForgettingCurve(t, s_long, s_short, d = 5.0, w = DEFAULT_FSRS7_PARAMS) {
    if (Array.isArray(d)) {
        w = d;
        d = 5.0;
    }
    const safeT = Math.max(0, t);
    const safeLong = Math.max(S_MIN, s_long);
    const safeShort = Math.max(S_MIN, s_short);
    const safeD = Math.min(D_MAX, Math.max(D_MIN, Number(d) || 5.0));

    // Short-term component r1
    const r1 = shortComponentRecall(safeT, safeShort, w);

    // Long-term component r2
    const decay2 = -Math.min(0.95, Math.max(0.01, w[24]));
    const factor2 = Math.pow(w[26], 1.0 / decay2) - 1.0;
    const d_timescale = Math.exp((safeD - 5.0) * (w[32] - 0.3));
    const r2 = Math.pow((safeT / safeLong) * factor2 * d_timescale + 1.0, decay2);

    // Mixture weights
    const weight1 = w[27] * Math.pow(safeShort, -w[29]);
    const weight2 = w[28] * Math.pow(safeLong, w[30]) * Math.exp((safeD - 5.0) * (w[31] - 0.5));

    const retention = (weight1 * r1 + weight2 * r2) / (weight1 + weight2);

    // Final rescale: p = 1e-5 + (1 - 2e-5) * retention
    return retention * (1.0 - 2e-5) + 1e-5;
}

/**
 * Newton-Raphson inversion in log(t) space to find interval I where R(I) = desiredRetention.
 * Converges in ~5-8 iterations (< 0.03ms per card).
 * 
 * @param {number} s_long - Long-term stability
 * @param {number} s_short - Short-term stability
 * @param {number} d - Difficulty [1, 10]
 * @param {number} desiredRetention - Target retention (e.g. 0.90)
 * @param {Array<number>} w - 34-parameter weight array
 * @returns {number} Optimal interval in fractional days
 */
export function nextIntervalNewton(s_long, s_short, d = 5.0, desiredRetention = DESIRED_RETENTION, w = DEFAULT_FSRS7_PARAMS) {
    if (typeof d === 'number' && d < 1.0 && (Array.isArray(desiredRetention) || desiredRetention === undefined)) {
        w = desiredRetention || DEFAULT_FSRS7_PARAMS;
        desiredRetention = d;
        d = 5.0;
    } else if (Array.isArray(desiredRetention)) {
        w = desiredRetention;
        desiredRetention = DESIRED_RETENTION;
    }
    const safeD = Math.min(D_MAX, Math.max(D_MIN, Number(d) || 5.0));
    const target = Math.min(0.99, Math.max(0.70, Number(desiredRetention) || DESIRED_RETENTION));
    
    // Initial guess starting point in log(t) space
    let t = Math.max(1.0 / 86400.0, s_long * 0.6);
    let u = Math.log(t);

    for (let iter = 0; iter < 12; iter++) {
        const curR = dualTraceForgettingCurve(t, s_long, s_short, d, w);
        const diff = curR - target;
        if (Math.abs(diff) < 1e-4) break;

        // Symmetric difference derivative
        const eps = Math.max(1e-7, t * 1e-4);
        const rPlus = dualTraceForgettingCurve(t + eps, s_long, s_short, d, w);
        const rMinus = dualTraceForgettingCurve(Math.max(0, t - eps), s_long, s_short, d, w);
        const dR_dt = (rPlus - rMinus) / (2 * eps);

        const denominator = dR_dt * t;
        if (Math.abs(denominator) < 1e-12) break;

        const du = -diff / denominator;
        u += Math.min(2.0, Math.max(-2.0, du));
        t = Math.exp(u);
    }

    return Math.min(S_MAX, Math.max(1.0 / 86400.0, t));
}

/**
 * Universal Retrievability getter (compatible with both FSRS-7 and legacy calls)
 */
export function getRetrievability(s_long, elapsedDays, s_short = null, d = 5.0, w = DEFAULT_FSRS7_PARAMS) {
    const actualShort = s_short !== null ? s_short : 0.8 * s_long;
    return dualTraceForgettingCurve(elapsedDays, s_long, actualShort, d, w);
}

