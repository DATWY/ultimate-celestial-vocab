// src/core/text-normalize.js
//
// Chuẩn hoá chuỗi tiếng Việt dùng chung cho: ô tìm kiếm mờ (ui/render.js), form thêm/sửa từ
// (ui/modal.js) và engine gộp trùng (core/dedup.js).
//
// Vì sao tách khỏi dedup.js: dedup.js là module nặng (~1.260 dòng: gộp trùng, so khớp hình thái,
// Levenshtein, phân loại cặp trùng) nhưng chỉ cần khi người dùng MỞ trình gộp trùng. Hai hàm ở
// đây lại cần ngay khi gõ tìm kiếm và khi lưu từ, nên tách ra giúp entry bundle không phải mang
// toàn bộ dedup.js lúc khởi động. Hành vi giữ nguyên từng dòng.

/** Loại bỏ dấu tiếng Việt (ví dụ: "thị phạm" -> "thi pham", "chứng minh" -> "chung minh") */
export function removeVietnameseTones(str) {
    if (!str) return '';
    return str.normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D')
        .toLowerCase();
}

/**
 * Chuẩn hoá các ký tự dấu câu thông minh (smart punctuation) từ bàn phím iOS/macOS
 * về các ký tự ASCII tiêu chuẩn tương ứng (dấu nháy đơn, nháy kép, gạch ngang).
 * Giúp các từ viết tắt (contractions như don't, can't, it's, let's) và trích dẫn
 * không bị chấm sai hoặc nhận diện lệch giữa các nền tảng.
 */
export function normalizeSmartPunctuation(str) {
    if (!str) return '';
    return str
        // Xoá ký tự tàng hình / zero-width gây sai lệch độ dài và khoảng cách gõ
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        // Smart single quotes / apostrophes (don’t, it’s, ‘quote’, prime ′, single guillemets ‹›, modifier letters, etc.) -> '
        .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035\u2039\u203A\u02BB\u02BC\u02BD\u02C8\u02CA\u02CB\u055A\uFF07\uFF40`´]/g, "'")
        // Smart double quotes (“quote”, „quote”, «quote», double prime ″, etc.) -> "
        .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036\u00AB\u00BB\uFF02]/g, '"')
        // Smart dashes / hyphens (en-dash, em-dash, minus, fullwidth hyphen －, small hyphens, soft hyphen) -> -
        .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D\u00AD]/g, '-');
}

/**
 * Làm sạch chuỗi nghĩa tiếng Việt: tách theo dấu phẩy/chấm phẩy/xuống dòng/gạch chéo, gọt ký tự
 * rác ở hai đầu, bỏ trùng không phân biệt hoa-thường và giữ biến thể dài hơn (nhiều chú thích hơn).
 */
export function cleanAndDeduplicateVietnamese(rawText) {
    if (!rawText) return '';
    const normalized = normalizeSmartPunctuation(rawText);
    const parts = normalized.split(/[,;\n/]+/).map(p => p.trim()).filter(Boolean);
    const uniqueMap = new Map();

    for (const part of parts) {
        // Gọt sạch các ký tự rác ở đầu/cuối: bullet, gạch ngang, dấu chấm, dấu phẩy, dấu nháy
        const cleanPart = part.replace(/^[-•*\s\d.)"']+|[.;,\s-"']+$/g, '').trim();
        if (!cleanPart) continue;

        // Chuẩn hóa key so sánh: chữ thường và thu gọn khoảng trắng
        const normKey = cleanPart.toLowerCase().replace(/\s+/g, ' ');
        if (!uniqueMap.has(normKey)) {
            uniqueMap.set(normKey, cleanPart);
        } else {
            // Giữ lại định dạng đầy đủ hơn hoặc có chú thích nếu có
            const existing = uniqueMap.get(normKey);
            if (cleanPart.length > existing.length) {
                uniqueMap.set(normKey, cleanPart);
            }
        }
    }

    const list = Array.from(uniqueMap.values());
    if (list.length === 0) return '';

    // Viết hoa chữ cái đầu tiên của cụm từ đầu tiên
    list[0] = list[0].charAt(0).toUpperCase() + list[0].slice(1);

    // Các cụm từ tiếp theo: viết thường chữ cái đầu trừ khi là từ viết hoa toàn bộ (viết tắt)
    for (let i = 1; i < list.length; i++) {
        if (list[i].length > 1 && list[i][0] === list[i][0].toUpperCase() && list[i][1] === list[i][1].toLowerCase()) {
            list[i] = list[i].charAt(0).toLowerCase() + list[i].slice(1);
        }
    }

    return list.join(', ');
}
