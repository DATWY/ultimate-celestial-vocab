// src/core/srs/constants.js — FSRS-7 Dual-Stability Core Parameters & Bounds

export const DESIRED_RETENTION = 0.90;
export const FUZZ_PERCENTAGE = 0.05;
export const MAX_INITIAL_INTERVAL = 21.0; // Chốt chặn an toàn: thẻ mới lần đầu tối đa 21 ngày (3 tuần)
export const MAX_INTERVAL_DAYS = 365; // Trần khoảng cách ôn tập cho MỌI lần chấm (sau fuzz): tối đa 1 năm

// Trần RIÊNG cho lần "tốt nghiệp" của thẻ CHƯA TỪNG thuộc (lapses = 0).
// Thẻ mới chỉ được chạm 2-3 lần trong một ngày nên không được nhảy tới 21-38 ngày
// như interval FSRS thô tính ra — đó là lý do gốc của lỗi "từ mới biến mất 3 tuần".
// Thẻ đã từng Mastered rồi trượt (lapses >= 1) KHÔNG chịu trần này: chúng phải
// khôi phục interval dài ngay khi tái tốt nghiệp.
export const MAX_GRADUATION_INTERVAL_DAYS = 7;

// Learning steps thật (T1.1): thẻ New/Learning đi 1 phút → 10 phút → 1 ngày rồi mới tốt nghiệp Mastered.
// Đơn vị: mili-giây. index.js dùng trực tiếp mảng này để tính srsDueDate/srsInterval.
export const LEARNING_STEPS_MS = [60_000, 600_000, 86_400_000];

// ─── T1.3 — hệ số heuristics tác động lên D0 ────────────────────────────────
// Giữ nguyên độ "nhạy" 0.5 của công thức cũ (D0 = initDifficulty(rating) + bias × 0.5).
// Trước T1.3 bias chạy tới ±3.0 ⇒ D0 bị đẩy ±1.5 (thẻ dễ rơi sát D_MIN = 1).
// Từ T1.3 bias chỉ còn ±0.5 (heuristics.js) ⇒ D0 chỉ lệch ±0.25, tức thu 6× —
// đúng bằng mức thu của chính bias, không đụng vào công thức FSRS nào.
export const D0_BIAS_SCALE = 0.5;

// ─── T1.4 — Leech (thẻ "chống lại bạn") ─────────────────────────────────────
// Đã quên >= 4 lần ⇒ không nhồi lại ngay trong phiên (massed practice chỉ tạo
// cảm giác thuộc giả), thay bằng một bước relearning 10 phút rồi mới gặp lại.
export const LEECH_LAPSE_THRESHOLD = 4;
// Bước relearning của thẻ leech = 10 phút (đúng bước thứ 2 trong LEARNING_STEPS_MS).
export const LEECH_RELEARNING_INTERVAL_MS = 600_000;
// Bước học tương ứng với bước relearning ở trên (dùng cho learningStep của thẻ leech).
export const LEECH_RELEARNING_STEP = 1;
// C′ — TRẦN TỐT NGHIỆP SAU KHI ĐÃ TRƯỢT.
// Thẻ đã từng quên (lapses > 0) mà bấm "Dễ" thì KHÔNG được nhảy interval như thẻ
// mới tinh: trace vừa đứt, bằng chứng trí nhớ yếu. Trần 10 ngày để buộc phải
// retrieval lại trước khi tin tưởng (xem docs/SRS-KHOA-HOC.md §C).
export const POST_LAPSE_GRADUATION_CAP_DAYS = 10;

// B′ — CHỐNG "BÃO ÔN" TRONG NGÀY.
// Một thẻ leech sai 2 lần trong cùng một ngày là dấu hiệu massed practice: thêm
// lượt nữa hôm nay chỉ tạo "thuộc giả" (fluency illusion) chứ không tăng trí nhớ
// dài hạn. Lần sai thứ 2 → chôn tới sáng mai, gắn cờ cần viết lại thẻ.
export const LEECH_MAX_SAME_DAY_LAPSES = 2;
// Ngày bị chôn: 04:00 sáng hôm sau (+ jitter 0–3h để không dồn một giờ cao điểm).
export const BURIED_RELEASE_HOUR = 4;

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
// Legacy: số bước học của thế hệ scheduler cũ. Lịch thật hiện dùng LEARNING_STEPS_MS ở trên.
export const LEARNING_STEPS = 2;

export const FSRS7_PARAM_BOUNDS = [
    ...Array.from({ length: 4 }, () => [0.01, 100]), [1, 10], [0.01, 5], [0.01, 10],
    [0.01, 10], [0, 2], [0.01, 10], [0.01, 10], [0, 2], [0.01, 10], [0.01, 1], [1, 5],
    [0.01, 10], [0, 2], [0.01, 10], [0.01, 10], [0, 2], [0.01, 10], [0.01, 1], [1, 5],
    [0.01, 0.95], [0.01, 0.95], [0.01, 0.99], [0.01, 0.99], [0.01, 5], [0.01, 5],
    [0, 2], [0, 2], [0, 2], [0, 2], [0, 2]
];

/**
 * AUDIT-5.1 — Ràng buộc THỨ TỰ giữa các tham số, không chỉ biên từng số.
 *
 * Nguồn FSRS-7 (srs-benchmark models/fsrs_v7.py, FSRS7ParameterClipper) áp các ràng buộc này
 * SAU bước clamp hộp:
 *     w1 = max(w1, w0); w2 = max(w2, w1); w3 = max(w3, w2); w26 = max(w26, w25)
 * Thiếu chúng, validator chấp nhận w[0]=100 và w[3]=0.01 — tức "Quên" cho độ bền ban đầu
 * 100 ngày còn "Dễ" chỉ 0.01 ngày, đảo ngược ngữ nghĩa rating.
 *
 * Trả về thông điệp lỗi đầu tiên (string) hoặc null nếu hợp lệ.
 */
export function fsrs7OrderingError(params) {
    if (!Array.isArray(params) || params.length !== 34) return null;
    for (let i = 0; i < 3; i++) {
        if (params[i] > params[i + 1]) return `tham số S0 phải tăng dần theo rating (w${i + 1} ≥ w${i})`;
    }
    if (params[25] > params[26]) return 'w26 (base2) phải ≥ w25 (base1) theo ràng buộc FSRS-7';
    return null;
}

/**
 * Chiếu một bộ tham số về miền hợp lệ: clamp hộp rồi áp ràng buộc thứ tự.
 * (Nằm ở training.js — chỉ optimizer dùng; tách khỏi entry bundle.)
 */

export function validFsrs7Params(params) {
    return Array.isArray(params) && params.length === 34 && params.every((value, i) =>
        Number.isFinite(value) && value >= FSRS7_PARAM_BOUNDS[i][0] && value <= FSRS7_PARAM_BOUNDS[i][1])
        && fsrs7OrderingError(params) === null;
}

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
        const [min, max] = FSRS7_PARAM_BOUNDS[i];
        if (val < min || val > max) {
            return { valid: false, error: `Tham số thứ ${i + 1} phải trong khoảng ${min}–${max}` };
        }
    }

    // AUDIT-5.1: nhập tay bị TỪ CHỐI (không tự chiếu) để người dùng thấy lý do, khác với optimizer
    // — nơi bước tối ưu được CHIẾU về miền hợp lệ thay vì hủy cả vòng lặp.
    const orderingError = fsrs7OrderingError(parsed);
    if (orderingError) return { valid: false, error: orderingError };

    return { valid: true, params: parsed };
}

