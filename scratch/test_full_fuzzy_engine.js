// scratch/test_full_fuzzy_engine.js
import {
    canonicalEnglish,
    canonicalPartOfSpeech,
    calculateSemanticSimilarity,
    extractVietnameseKeywords
} from '../src/core/dedup.js';

// 1. Levenshtein & Similarity
function levenshteinDistance(s1, s2) {
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
                currRow[j - 1] + 1,
                prevRow[j] + 1,
                prevRow[j - 1] + cost
            );
        }
        [prevRow, currRow] = [currRow, prevRow];
    }
    return prevRow[len2];
}

function stringSimilarity(s1, s2) {
    const maxLen = Math.max(s1.length, s2.length);
    if (maxLen === 0) return 1.0;
    return (maxLen - levenshteinDistance(s1, s2)) / maxLen;
}

// 2. Compact English (strip spaces, hyphens, apostrophes)
function compactEnglish(text) {
    return canonicalEnglish(text).replace(/[^a-z0-9]/g, '');
}

// 3. English Stemming
function stemEnglishWord(word) {
    if (!word) return '';
    let w = word.toLowerCase().trim();
    if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
    if (w.endsWith('es') && (w.endsWith('shes') || w.endsWith('ches') || w.endsWith('sses') || w.endsWith('xes') || w.endsWith('zes'))) {
        return w.slice(0, -2);
    }
    if (w.endsWith('ing') && w.length > 5) {
        let base = w.slice(0, -3);
        if (base.length > 3 && base[base.length - 1] === base[base.length - 2]) {
            base = base.slice(0, -1);
        } else if (!base.endsWith('e') && !['sing', 'ring', 'bring'].includes(w)) {
            base = base + 'e';
        }
        return base;
    }
    if (w.endsWith('ed') && w.length > 4) {
        let base = w.slice(0, -2);
        if (base.endsWith('i')) base = base.slice(0, -1) + 'y';
        else if (!base.endsWith('e')) base = base + 'e';
        return base;
    }
    if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) {
        return w.slice(0, -1);
    }
    return w;
}

function stemEnglishPhrase(text) {
    const canon = canonicalEnglish(text);
    return canon.split(/\s+/).map(stemEnglishWord).join(' ');
}

// 4. Vietnamese Meaning Cleaning & Deduplicating
function cleanAndDeduplicateVietnamese(rawText) {
    if (!rawText) return '';
    const parts = rawText.split(/[,;\n\/]+/).map(p => p.trim()).filter(Boolean);
    const uniqueMap = new Map();

    for (const part of parts) {
        const cleanPart = part.replace(/^[\-\•\*\s]+|[\.\;\,\s]+$/g, '').trim();
        if (!cleanPart) continue;

        const normKey = cleanPart.toLowerCase().replace(/\s+/g, ' ');
        if (!uniqueMap.has(normKey)) {
            uniqueMap.set(normKey, cleanPart);
        } else {
            const existing = uniqueMap.get(normKey);
            if (cleanPart.length > existing.length) {
                uniqueMap.set(normKey, cleanPart);
            }
        }
    }

    const list = Array.from(uniqueMap.values());
    if (list.length === 0) return '';

    // Capitalize first letter of the first word, lowercase others unless special
    list[0] = list[0].charAt(0).toUpperCase() + list[0].slice(1);
    for (let i = 1; i < list.length; i++) {
        if (list[i].length > 1 && list[i][0] === list[i][0].toUpperCase() && list[i][1] === list[i][1].toLowerCase()) {
            list[i] = list[i].charAt(0).toLowerCase() + list[i].slice(1);
        }
    }

    return list.join(', ');
}

// 5. Intelligent Duplicate Check with Fuzzy
function checkDuplicateCardFuzzy(cardA, cardB) {
    const canonA = canonicalEnglish(cardA.english);
    const canonB = canonicalEnglish(cardB.english);
    const compactA = compactEnglish(cardA.english);
    const compactB = compactEnglish(cardB.english);
    const stemA = stemEnglishPhrase(cardA.english);
    const stemB = stemEnglishPhrase(cardB.english);

    const posA = canonicalPartOfSpeech(cardA.type, cardA.english);
    const posB = canonicalPartOfSpeech(cardB.type, cardB.english);
    const isSamePOS = (posA === posB) || (posA === 'phrase' && posB === 'verb') || (posA === 'verb' && posB === 'phrase');

    const semSim = calculateSemanticSimilarity(cardA.vietnamese, cardB.vietnamese);

    // Check Level 1: Exact Match (canonical or compact)
    if (canonA === canonB || compactA === compactB) {
        if (isSamePOS && semSim >= 0.2) {
            return {
                isDuplicate: true,
                confidence: Math.max(0.95, semSim),
                category: 'EXACT',
                reason: 'Trùng khớp chính xác từ vựng và loại từ'
            };
        }
        if (semSim >= 0.65) {
            return {
                isDuplicate: true,
                confidence: semSim,
                category: 'EXACT',
                reason: 'Trùng khớp chính xác từ vựng với nghĩa tương đồng cao'
            };
        }
        // Polysemy
        return { isDuplicate: false, confidence: semSim, category: 'POLYSEMY', reason: 'Từ đa nghĩa khác biệt' };
    }

    // Check Level 2: Inflection / Stem Match (demonstrate vs demonstrating)
    if (stemA === stemB) {
        if (isSamePOS && semSim >= 0.2) {
            return {
                isDuplicate: true,
                confidence: Math.max(0.90, semSim * 0.95),
                category: 'INFLECTION',
                reason: `Biến thể ngữ pháp (${cardA.english} ⟷ ${cardB.english})`
            };
        }
        if (semSim >= 0.60) {
            return {
                isDuplicate: true,
                confidence: semSim * 0.95,
                category: 'INFLECTION',
                reason: `Cùng gốc từ với nghĩa tương đồng (${cardA.english} ⟷ ${cardB.english})`
            };
        }
    }

    // Check Level 3: Fuzzy Typo Match (Levenshtein)
    const minLen = Math.min(compactA.length, compactB.length);
    const maxLen = Math.max(compactA.length, compactB.length);
    const dist = levenshteinDistance(compactA, compactB);
    const simRatio = (maxLen - dist) / maxLen;

    // Conditions for typo:
    // For length >= 5, dist <= 1 is very likely a typo if meaning matches
    // For length >= 8, dist <= 2 is likely a typo if meaning matches
    const isTypoDistance = (minLen >= 5 && dist === 1) || (minLen >= 8 && dist <= 2);
    if (isTypoDistance && simRatio >= 0.80) {
        // Require at least some semantic overlap to avoid false positives (e.g. cat/bat, effect/affect)
        if (semSim >= 0.25 || isSamePOS && semSim >= 0.15) {
            return {
                isDuplicate: true,
                confidence: Math.round(simRatio * Math.max(0.85, semSim) * 100) / 100,
                category: 'FUZZY_TYPO',
                reason: `Tìm kiếm mờ: Lệch chính tả (${cardA.english} ⟷ ${cardB.english}, độ giống ${(simRatio*100).toFixed(0)}%)`
            };
        }
    }

    return { isDuplicate: false, confidence: 0, category: 'DIFFERENT', reason: 'Từ vựng khác nhau' };
}

// Run test cases
console.log('--- Test Cases for checkDuplicateCardFuzzy ---');
const testCases = [
    {
        a: { english: 'demonstrate', vietnamese: 'Thị phạm, chứng minh', type: 'verb' },
        b: { english: 'demonstrate', vietnamese: 'Chứng minh, giải thích', type: 'verb' },
        desc: 'Exact match'
    },
    {
        a: { english: 'demonstrate', vietnamese: 'Thị phạm, chứng minh', type: 'verb' },
        b: { english: 'demonstrating', vietnamese: 'Chứng minh, giải thích', type: 'verb' },
        desc: 'Stem / Inflection match (-ing)'
    },
    {
        a: { english: 'demonstrate', vietnamese: 'Thị phạm, chứng minh', type: 'verb' },
        b: { english: 'demonstate', vietnamese: 'Chứng minh, giải thích', type: 'verb' },
        desc: 'Typo fuzzy match (missing r)'
    },
    {
        a: { english: 'colleague', vietnamese: 'Đồng nghiệp', type: 'noun' },
        b: { english: 'colleagues', vietnamese: 'Các đồng nghiệp', type: 'noun' },
        desc: 'Plural inflection (-s)'
    },
    {
        a: { english: 'take off', vietnamese: 'Cất cánh, cởi ra', type: 'verb' },
        b: { english: 'take-off', vietnamese: 'Cất cánh', type: 'phrase' },
        desc: 'Hyphen vs space'
    },
    {
        a: { english: 'affect', vietnamese: 'Ảnh hưởng, tác động', type: 'verb' },
        b: { english: 'effect', vietnamese: 'Hiệu quả, kết quả', type: 'noun' },
        desc: 'Different words (affect vs effect) - should NOT duplicate'
    },
    {
        a: { english: 'adapt', vietnamese: 'Thích nghi, phỏng theo', type: 'verb' },
        b: { english: 'adopt', vietnamese: 'Nhận nuôi, thông qua', type: 'verb' },
        desc: 'Different words (adapt vs adopt) - should NOT duplicate'
    }
];

testCases.forEach((tc, idx) => {
    const res = checkDuplicateCardFuzzy(tc.a, tc.b);
    console.log(`[Case ${idx + 1}] ${tc.desc}:`);
    console.log(`  ${tc.a.english} <-> ${tc.b.english}`);
    console.log(`  Result: isDuplicate = ${res.isDuplicate}, Category = ${res.category}, Conf = ${res.confidence}, Reason = ${res.reason}`);
    console.log();
});
