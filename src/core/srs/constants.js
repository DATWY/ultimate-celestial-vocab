// src/core/srs/constants.js — FSRS-7 Dual-Stability Core Parameters & Bounds

export const DESIRED_RETENTION = 0.90;
export const FUZZ_PERCENTAGE = 0.05;
export const MAX_INITIAL_INTERVAL = 21.0; // Chốt chặn an toàn: thẻ mới lần đầu tối đa 21 ngày (3 tuần)

// Memory-state clamp bounds from FSRS-7 (fsrs-rs / srs-benchmark)
export const S_MIN = 0.01;
export const S_MAX = 36500.0; // 100 years in days
export const D_MIN = 1.0;
export const D_MAX = 10.0;

// Canonical 34-parameter initial weights for Dual-Stability FSRS-7
// Sourced bit-identically from open-spaced-repetition/srs-benchmark (models/fsrs_v7.py)
export const DEFAULT_FSRS7_PARAMS = [
    // w[0..3]: Initial Stability (S0) for ratings [1: Again, 2: Hard, 3: Good, 4: Easy]
    0.1104, 2.2395, 3.9221, 11.7841,

    // w[4..6]: Difficulty initialization & delta (w[4]: init_d_base, w[5]: init_d_exp, w[6]: delta_d_scale)
    6.1686, 0.6457, 3.6807,

    // w[7..14]: Stability (Long-term) parameter block (start = 7)
    // 7: sinc_base, 8: s_power, 9: r_scale, 10: fail_base, 11: fail_power, 12: fail_r_scale, 13: hard_penalty, 14: easy_bonus
    1.9795, 0.0, 1.3826, 0.7024, 0.5999, 0.8146, 0.6398, 1.0,

    // w[15..22]: Stability (Short-term) parameter block (start = 15)
    // 15: sinc_base, 16: s_power, 17: r_scale, 18: fail_base, 19: fail_power, 20: fail_r_scale, 21: hard_penalty, 22: easy_bonus
    1.3207, 0.6707, 3.8668, 0.4416, 0.0934, 1.8631, 0.6162, 1.0869,

    // w[23..33]: Dual-Trace Forgetting Curve Mixture (11 parameters)
    // 23: decay1, 24: decay2, 25: base1, 26: base2, 27: base_weight1, 28: base_weight2,
    // 29: s_weight_power1, 30: s_weight_power2, 31: d_weight, 32: d_decay, 33: s_decay1
    0.1567, 0.0801, 0.2421, 0.9464, 0.1433, 0.7145, 0.0, 0.5667, 0.3734, 0.5333, 0.3048
];

// Legacy fallbacks for compatibility
export const FACTOR = 19 / 81;
export const DECAY = -0.5;
export const LEARNING_STEPS = 2;

/**
 * Parses and validates a 34-parameter FSRS-7 array or string representation.
 */
export function parseAndValidateFsrs7Params(rawText) {
    if (!rawText || !rawText.trim()) {
        return { valid: false, error: "Vui lòng nhập hoặc dán 34 tham số" };
    }

    let parsed = [];
    const trimmed = rawText.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
            parsed = JSON.parse(trimmed);
        } catch {
            return { valid: false, error: "Định dạng mảng JSON không hợp lệ" };
        }
    } else {
        parsed = trimmed.split(/[\s,]+/).filter(Boolean).map(Number);
    }

    if (!Array.isArray(parsed)) {
        return { valid: false, error: "Dữ liệu nhập phải là danh sách số" };
    }

    if (parsed.length !== 34) {
        return { valid: false, error: `Cần đúng 34 tham số của FSRS-7 (hiện tại bạn nhập ${parsed.length} số)` };
    }

    for (let i = 0; i < parsed.length; i++) {
        const val = parsed[i];
        if (typeof val !== 'number' || isNaN(val) || !isFinite(val)) {
            return { valid: false, error: `Tham số thứ ${i + 1} (${val}) không phải là số hợp lệ` };
        }
        if (i < 7 && val <= 0) {
            return { valid: false, error: `Tham số thứ ${i + 1} (${val}) phải là số dương lớn hơn 0` };
        }
    }

    return { valid: true, params: parsed };
}

