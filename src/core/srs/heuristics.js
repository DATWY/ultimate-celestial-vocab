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

/**
 * Ước lượng số âm tiết của một từ tiếng Anh.
 * Sử dụng phương pháp đếm nhóm nguyên âm liên tiếp (vowel cluster).
 * Độ chính xác ~85% cho tiếng Anh thông dụng.
 * 
 * @param {string} word - Từ tiếng Anh (viết thường)
 * @returns {number} Số âm tiết ước lượng (tối thiểu 1)
 */
function estimateSyllables(word) {
    // Xén hết ký tự không phải chữ cái (dấu câu, số, v.v.)
    const w = word.toLowerCase().replace(/[^a-z]/g, '');
    if (w.length <= 2) return 1;

    // Đếm nhóm nguyên âm liên tiếp
    const vowelGroups = w.match(/[aeiouy]+/gi);
    let count = vowelGroups ? vowelGroups.length : 1;

    // Trừ chữ "e" câm ở cuối từ (silent e)
    // VD: "cake" -> ca-ke -> 2, nhưng thực tế là 1
    // Bao gồm "-le" ending (simple, bottle) vì đã xử lý đúng bởi vowel cluster
    if (w.endsWith('e') && !w.endsWith('le') && !w.endsWith('ie') && count > 1) {
        count--;
    }

    // Trừ "es" và "ed" cuối từ nếu không tạo âm tiết mới
    if (w.endsWith('es') && !w.endsWith('ses') && !w.endsWith('zes') && count > 1) {
        count--;
    }
    if (w.endsWith('ed') && !w.endsWith('ted') && !w.endsWith('ded') && count > 1) {
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
 * @returns {number} bias - Giá trị từ -3.0 đến +3.0
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

    // Clamp bias trong khoảng [-3.0, +3.0] để tránh cực đoan
    return Math.min(3.0, Math.max(-3.0, bias));
}

/**
 * Tính hệ số nhân cho Stability ban đầu dựa trên bias.
 * Từ dễ (bias âm) → S cao hơn (ôn muộn hơn vì dễ nhớ)
 * Từ khó (bias dương) → S thấp hơn (ép ôn sớm hơn vì dễ quên)
 * 
 * @param {number} bias - Giá trị bias từ getDifficultyBias() ([-3.0, +3.0])
 * @returns {number} multiplier - Hệ số nhân cho S (0.5 đến 1.5)
 */
export function getStabilityMultiplier(bias) {
    // bias = -3 → mult = 1.3 (Từ rất dễ: S tăng 30%, ôn muộn hơn)
    // bias =  0 → mult = 1.0 (Trung tính: không thay đổi)
    // bias = +3 → mult = 0.7 (Từ rất khó: S giảm 30%, ôn sớm hơn)
    return Math.max(0.5, Math.min(1.5, 1 - bias * 0.1));
}
