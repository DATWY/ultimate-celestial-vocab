// scratch/test_search_filter.js
import { levenshteinDistance } from '../src/core/dedup.js';

function removeVietnameseTones(str) {
    if (!str) return '';
    return str.normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D')
        .toLowerCase();
}

function isFuzzySearchMatch(query, english, vietnamese) {
    if (!query) return true;
    const q = query.trim().toLowerCase();
    const eng = (english || '').toLowerCase();
    const vie = (vietnamese || '').toLowerCase();

    // 1. Direct substring match
    if (eng.includes(q) || vie.includes(q)) return true;

    // 2. Vietnamese tone-insensitive match
    const qNoTone = removeVietnameseTones(q);
    const vieNoTone = removeVietnameseTones(vie);
    if (vieNoTone.includes(qNoTone)) return true;

    // 3. Multi-token match
    const tokens = qNoTone.split(/\s+/).filter(Boolean);
    if (tokens.length > 1) {
        const engTokens = eng.replace(/[^a-z0-9]/g, ' ').split(/\s+/);
        const vieTokens = vieNoTone.replace(/[^a-z0-9]/g, ' ').split(/\s+/);
        const allCardTokens = [...engTokens, ...vieTokens];
        const allTokensMatch = tokens.every(tok => allCardTokens.some(ct => ct.includes(tok)));
        if (allTokensMatch) return true;
    }

    // 4. Fuzzy typo match for English word
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

const card = {
    english: 'Demonstrate',
    vietnamese: 'Thị phạm, chứng minh, giải thích'
};

console.log('Query "demonstrate":', isFuzzySearchMatch('demonstrate', card.english, card.vietnamese));
console.log('Query "demonstate" (typo missing r):', isFuzzySearchMatch('demonstate', card.english, card.vietnamese));
console.log('Query "thi pham" (no tone):', isFuzzySearchMatch('thi pham', card.english, card.vietnamese));
console.log('Query "chung minh" (no tone):', isFuzzySearchMatch('chung minh', card.english, card.vietnamese));
console.log('Query "pham giai thich" (multi-token):', isFuzzySearchMatch('pham giai thich', card.english, card.vietnamese));
console.log('Query "hello" (unrelated):', isFuzzySearchMatch('hello', card.english, card.vietnamese));
