// src/core/fuzzy-search.js
//
// Tìm kiếm mờ cho ô tìm kiếm từ vựng: khớp trực tiếp, khớp tiếng Việt không dấu, khớp nhiều
// token và sửa lỗi gõ (Levenshtein). Tách khỏi dedup.js để entry bundle không phải nạp toàn bộ
// engine gộp trùng chỉ vì ui/render.js cần đúng hai hàm ở đây. Hành vi giữ nguyên từng dòng.
import { removeVietnameseTones, normalizeSmartPunctuation } from './text-normalize.js';

export function levenshteinDistance(s1, s2) {
    if (s1 === s2) return 0;
    const len1 = s1.length;
    const len2 = s2.length;
    if (len1 === 0) return len2;
    if (len2 === 0) return len1;

    let prevRow = new Array(len2 + 1);
    let currRow = new Array(len2 + 1);
    for (let j = 0; j <= len2; j++) prevRow[j] = j;

    for (let i = 1; i <= len1; i++) {
        currRow[0] = i;
        const char1 = s1.charCodeAt(i - 1);
        for (let j = 1; j <= len2; j++) {
            const cost = char1 === s2.charCodeAt(j - 1) ? 0 : 1;
            currRow[j] = Math.min(
                currRow[j - 1] + 1,      // insertion
                prevRow[j] + 1,          // deletion
                prevRow[j - 1] + cost    // substitution
            );
        }
        [prevRow, currRow] = [currRow, prevRow];
    }
    return prevRow[len2];
}

/** Tìm kiếm mờ thông minh cho ô tìm kiếm từ vựng (hỗ trợ không dấu, multi-token, typo Levenshtein) */
export function isFuzzySearchMatch(query, english, vietnamese) {
    if (!query) return true;
    const q = normalizeSmartPunctuation(query).trim().toLowerCase();
    const eng = normalizeSmartPunctuation(english || '').toLowerCase();
    const vie = normalizeSmartPunctuation(vietnamese || '').toLowerCase();

    // 1. Khớp chuỗi trực tiếp
    if (eng.includes(q) || vie.includes(q)) return true;

    // 2. Tiếng Việt không dấu
    const qNoTone = removeVietnameseTones(q);
    const vieNoTone = removeVietnameseTones(vie);
    if (vieNoTone.includes(qNoTone)) return true;

    // 3. Khớp đa từ khóa (Multi-token match)
    const tokens = qNoTone.split(/\s+/).filter(Boolean);
    if (tokens.length > 1) {
        const engTokens = eng.replace(/[^a-z0-9]/g, ' ').split(/\s+/);
        const vieTokens = vieNoTone.replace(/[^a-z0-9]/g, ' ').split(/\s+/);
        const allTokens = [...engTokens, ...vieTokens];
        const allTokensMatch = tokens.every(tok => allTokens.some(t => t.includes(tok)));
        if (allTokensMatch) return true;
    }

    // 4. Tìm kiếm mờ tiếng Anh (Levenshtein Fuzzy Match)
    if (q.length >= 4) {
        const engWords = eng.replace(/[^a-z0-9]/g, ' ').split(/\s+/);
        for (const w of engWords) {
            if (w.length >= 4 && Math.abs(w.length - q.length) <= 2) {
                const dist = levenshteinDistance(q, w);
                const maxLen = Math.max(q.length, w.length);
                if (dist <= 1 || (maxLen >= 8 && dist <= 2)) {
                    return true;
                }
            }
        }
    }

    return false;
}
