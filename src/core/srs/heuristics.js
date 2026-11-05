/**
 * Heuristics Engine v2 — Ước lượng Độ khó và Độ bền Ban đầu cho FSRS
 * 
 * Module này phân tích nội dung thẻ bài (english, type) tại thời điểm runtime
 * để trả về một "bias" (độ lệch) cho giá trị Difficulty và Stability ban đầu.
 * 
 * QUAN TRỌNG: Không lưu bất kỳ dữ liệu nào vào database.
 * Chỉ chạy DUY NHẤT 1 LẦN cho mỗi thẻ mới (khi reps === 0).
 */

import { isCommonWord } from './frequency-data.js';

// ─── T1.3 — BIÊN ĐỘ CỦA HEURISTICS (thu hẹp, KHÔNG đổi hướng) ────────────────
// Heuristics là "đặc sản" của app: nó đoán độ khó của một TỪ trước khi người học
// chạm vào thẻ, rồi nhích S0/D0 của FSRS. Nhưng trước T1.3 biên độ quá rộng:
//   • bias ∈ [-3.0, +3.0]  ⇒ D0 lệch ±1.5 (thẻ dễ rơi xuống sát D_MIN = 1)
//   • multiplier ∈ [0.7, 1.3] ⇒ S0 lệch ±30%
// Kết quả: interval lần đầu giữa "cat" và "break the ice" lệch tới ~8×, trong khi
// khác biệt THẬT về độ khó chỉ nên là vài chục phần trăm. Từ T1.3:
//   • bias ∈ [-0.5, +0.5] (index.js vẫn nhân 0.5 như cũ ⇒ D0 lệch tối đa ±0.25)
//   • multiplier ∈ [0.85, 1.15] ⇒ S0 lệch tối đa ±15%
// Hướng giữ nguyên: từ càng khó (bias dương) ⇒ S0 càng nhỏ, D0 càng cao.
export const DIFFICULTY_BIAS_MIN = -0.5;
export const DIFFICULTY_BIAS_MAX = 0.5;
export const STABILITY_MULT_MIN = 0.85;
export const STABILITY_MULT_MAX = 1.15;

// Tổng bias thô của code cũ chạy trong khoảng [-3, +4.5] (idiom + chữ dài + nhiều âm tiết).
// Chia cho 6 để đưa về đúng biên độ ±0.5 (rồi vẫn kẹp lại cho chắc).
const RAW_BIAS_SCALE = 6;
// bias -0.5 (rất dễ) → ×1.15 · bias 0 (trung tính) → ×1.00 · bias +0.5 (rất khó) → ×0.85
const STABILITY_MULT_SLOPE = 0.3;

const clampBias = (value) => Math.min(DIFFICULTY_BIAS_MAX, Math.max(DIFFICULTY_BIAS_MIN, value));

/**
 * Ước lượng số âm tiết của một từ tiếng Anh.
 * Sử dụng phương pháp đếm nhóm nguyên âm liên tiếp (vowel cluster).
 * Độ chính xác ~85% cho tiếng Anh thông dụng.
 * 
 * @param {string} word - Từ tiếng Anh (viết thường)
 * @returns {number} Số âm tiết ước lượng (tối thiểu 1)
 */
export function estimateSyllables(word) {
    if (!word || typeof word !== 'string') return 1;
    // Xén hết ký tự không phải chữ cái (dấu câu, số, v.v.)
    const w = word.toLowerCase().replace(/[^a-z]/g, '');
    if (w.length <= 2) return 1;

    // Đếm nhóm nguyên âm liên tiếp
    const vowelGroups = w.match(/[aeiouy]+/gi);
    let count = vowelGroups ? vowelGroups.length : 1;

    // Trừ chữ "e" câm ở cuối từ (silent e):
    // 1. Đuôi "-ee" (coffee, agree, referee, degree) KHÔNG phải e câm (/iː/), không trừ.
    // 2. Đuôi "-ie" (pie, tie) đã tính đúng cụm nguyên âm.
    // 3. Đuôi "-le":
    //    - Phụ âm + "le" (bottle, simple, table) tạo âm tiết riêng [l̩] nên KHÔNG trừ.
    //    - Nguyên âm + "le" (scale, hole, whale, mile, stole) hoặc "isle" (silent s: aisle, isle)
    //      là "e" câm kéo dài nguyên âm -> CẦN TRỪ.
    const isSilentE = w.endsWith('e') &&
        !w.endsWith('ee') &&
        !w.endsWith('ie') &&
        (!w.endsWith('le') || /(?:[aeiouy]|is)le$/.test(w));

    if (isSilentE && count > 1) {
        count--;
    }

    // Trừ "es" và "ed" cuối từ nếu không tạo âm tiết mới:
    // - Đuôi "-ees" (agrees, coffees, degrees, referees) và "-ies" (babies, parties, studies)
    //   đã có nguyên âm /iː/ hoặc /i/ nằm trong cụm nguyên âm hợp lệ -> KHÔNG TRỪ.
    // - Đuôi sibilants "-es" sau s, z, x, ch, sh tạo âm tiết [ɪz] (boxes, watches, wishes) -> KHÔNG TRỪ.
    if (w.endsWith('es') && !w.endsWith('ees') && !w.endsWith('ies') && !/(?:[szx]|ch|sh)es$/.test(w) && count > 1) {
        count--;
    }
    // - Đuôi "-eed" (agreed, proceed, exceed, decreed) và "-ied" (studied, worried, replied, denied)
    //   đã có nguyên âm trong cụm -> KHÔNG TRỪ.
    // - Đuôi "-ed" sau t/d (waited, needed) tạo âm tiết [ɪd] -> KHÔNG TRỪ.
    if (w.endsWith('ed') && !w.endsWith('eed') && !w.endsWith('ied') && !w.endsWith('ted') && !w.endsWith('ded') && count > 1) {
        count--;
    }

    return Math.max(1, count);
}

/**
 * Phân tích nội dung thẻ bài và trả về một bias (độ lệch) cho Difficulty.
 * 
 * @param {Object} card - Đối tượng thẻ bài
 * @param {string} card.english - Từ/cụm từ tiếng Anh
 * @param {string} [card.type] - Loại từ (noun, verb, idiom, phrasal verb, ...)
 * @param {string[]} [card.tags] - Tags của thẻ
 * @returns {number} bias - Giá trị trong [-0.5, +0.5] (T1.3)
 */
export function getDifficultyBias(card) {
    if (!card || !card.english) return 0;

    const english = card.english.trim();
    if (english.length === 0) return 0; // Chuỗi rỗng hoặc chỉ có khoảng trắng

    const words = english.split(/[\s-]+/).filter(Boolean);
    const wordCount = words.length;
    const type = (card.type || '').toLowerCase();
    let bias = 0;

    // ─── TEST 1: Word Length (Độ dài từ thành phần dài nhất) ───
    // CHỈ áp dụng bias -= 1.0 cho TỪ ĐƠN (wordCount === 1) ngắn <= 4 ký tự!
    // Tránh việc Phrasal Verbs như "put up with" bị nhận nhầm là từ ngắn dễ nhớ.
    const maxWordLen = Math.max(...words.map(w => w.length));
    if (wordCount === 1 && maxWordLen <= 4) {
        bias -= 1.0;
    } else if (maxWordLen >= 10) {
        bias += 1.0; // Có từ thành phần dài >= 10 ký tự làm tăng độ khó hình vị
    }

    // ─── TEST 2 & TEST 4: Phân tầng cấu trúc loại trừ lẫn nhau ───
    // Tránh cộng dồn trùng lặp khiến mọi cụm từ ghép bị kịch trần +3.0
    if (type.includes('idiom') || type.includes('thành ngữ')) {
        bias += 2.5; // Thành ngữ ngữ nghĩa trừu tượng, khó nhất
    } else if (type.includes('phrasal')) {
        bias += 2.0; // Cụm động từ có giới từ cố định
    } else if (wordCount >= 2) {
        // Cụm từ ghép thông thường: nếu là danh từ thì dễ hình dung hơn
        bias += (type.includes('noun') || type.includes('danh từ')) ? 0.5 : 1.0;
    } else if ((type === 'noun' || type === 'danh từ' || type.startsWith('noun ')) && !type.includes('pronoun')) {
        bias -= 0.5; // Danh từ đơn cụ thể
    }

    // ─── TEST 3: Syllable Complexity (Độ phức tạp phát âm) ───
    // Chỉ áp dụng cho từ đơn (không phải cụm từ)
    if (wordCount === 1) {
        const syllables = estimateSyllables(english);
        if (syllables >= 4) {
            bias += 1.0;
        }
    }

    // ─── TEST 5: Frequency Check (Kiểm tra tần suất từ vựng) ───
    // Từ nằm trong top ~500 từ phổ biến nhất → Người học gần như chắc chắn đã biết
    if (wordCount === 1 && isCommonWord(english)) {
        bias -= 1.5;
    }

    // T1.3: nén tổng thô về biên độ ±0.5 (giữ nguyên thứ tự: từ khó hơn vẫn bias lớn hơn).
    // Các trọng số phía trên KHÔNG đổi — chỉ có biên độ đầu ra bị thu lại.
    return clampBias(bias / RAW_BIAS_SCALE);
}

/**
 * Tính hệ số nhân cho Stability ban đầu dựa trên bias.
 * Từ dễ (bias âm) → S cao hơn (ôn muộn hơn vì dễ nhớ)
 * Từ khó (bias dương) → S thấp hơn (ép ôn sớm hơn vì dễ quên)
 * 
 * @param {number} bias - Giá trị bias từ getDifficultyBias() (T1.3: [-0.5, +0.5])
 * @returns {number} multiplier - Hệ số nhân cho S (T1.3: [0.85, 1.15])
 */
export function getStabilityMultiplier(bias) {
    // bias = -0.5 → mult = 1.15 (Từ rất dễ: S tăng 15%, ôn muộn hơn)
    // bias =  0.0 → mult = 1.00 (Trung tính: không thay đổi)
    // bias = +0.5 → mult = 0.85 (Từ rất khó: S giảm 15%, ôn sớm hơn)
    const safeBias = clampBias(Number.isFinite(Number(bias)) ? Number(bias) : 0);
    const multiplier = 1 - safeBias * STABILITY_MULT_SLOPE;
    return Math.min(STABILITY_MULT_MAX, Math.max(STABILITY_MULT_MIN, multiplier));
}
