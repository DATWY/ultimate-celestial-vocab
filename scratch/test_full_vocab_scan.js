// scratch/test_full_vocab_scan.js
import fs from 'fs';
import {
    canonicalEnglish,
    canonicalPartOfSpeech,
    calculateSemanticSimilarity
} from '../src/core/dedup.js';

// Setup full scanner
const tsvContent = fs.readFileSync('C:/Users/ASUS/Downloads/celestial_vocab_2026-08-30.tsv', 'utf-8');
const lines = tsvContent.split('\n').filter(l => l.trim().length > 0);
const vocabulary = lines.slice(1).map((line, idx) => {
    const p = line.split('\t');
    return {
        id: 'id_' + idx,
        english: p[0] || '',
        vietnamese: p[1] || '',
        type: p[2] || '',
        pronunciation: p[3] || '',
        example: p[4] || '',
        isStarred: p[5] === 'true',
        srsStatus: p[6] || 'New',
        stability: Number(p[14] || 1),
        reps: Number(p[15] || 0)
    };
}).filter(w => w.english.length > 0);

// Add simulated tricky items to test detection
vocabulary.push({
    id: 'sim_1',
    english: 'demonstrate',
    vietnamese: 'Thị phạm, chứng minh, Chứng minh, giải thích',
    type: 'verb',
    srsStatus: 'Mastered',
    stability: 10,
    reps: 15
});
vocabulary.push({
    id: 'sim_2',
    english: 'demonstrating',
    vietnamese: 'Chứng minh, giải thích',
    type: 'verb',
    srsStatus: 'Learning',
    stability: 3,
    reps: 4
});
vocabulary.push({
    id: 'sim_3',
    english: 'demonstate',
    vietnamese: 'Thị phạm, chứng minh',
    type: 'verb',
    srsStatus: 'New',
    stability: 1,
    reps: 0
});

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

function compactEnglish(text) {
    return canonicalEnglish(text).replace(/[^a-z0-9]/g, '');
}

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
        return { isDuplicate: false, confidence: semSim, category: 'POLYSEMY', reason: 'Từ đa nghĩa khác biệt' };
    }

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

    const minLen = Math.min(compactA.length, compactB.length);
    const maxLen = Math.max(compactA.length, compactB.length);
    const dist = levenshteinDistance(compactA, compactB);
    const simRatio = (maxLen - dist) / maxLen;

    const isTypoDistance = (minLen >= 5 && dist === 1) || (minLen >= 8 && dist <= 2);
    if (isTypoDistance && simRatio >= 0.80) {
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

function findDuplicatePairsFuzzy(vocab) {
    const activeCards = vocab.filter(w => !w.isDeleted);
    const candidatePairsMap = new Map();

    const addCandidate = (cA, cB) => {
        if (cA.id === cB.id) return;
        const pairKey = cA.id < cB.id ? `${cA.id}|${cB.id}` : `${cB.id}|${cA.id}`;
        if (!candidatePairsMap.has(pairKey)) {
            candidatePairsMap.set(pairKey, [cA, cB]);
        }
    };

    // 1. Buckets by Compact Key (handles space/hyphen variations)
    const compactBuckets = new Map();
    // 2. Buckets by Stem Key (handles -s, -ed, -ing)
    const stemBuckets = new Map();
    // 3. Buckets by Prefix 3 chars (for typo candidates with similar length)
    const prefixBuckets = new Map();

    activeCards.forEach(card => {
        const compact = compactEnglish(card.english);
        if (compact) {
            if (!compactBuckets.has(compact)) compactBuckets.set(compact, []);
            compactBuckets.get(compact).push(card);

            if (compact.length >= 3) {
                const pfx = compact.slice(0, 3);
                if (!prefixBuckets.has(pfx)) prefixBuckets.set(pfx, []);
                prefixBuckets.get(pfx).push(card);
            }
        }

        const stem = stemEnglishPhrase(card.english);
        if (stem) {
            if (!stemBuckets.has(stem)) stemBuckets.set(stem, []);
            stemBuckets.get(stem).push(card);
        }
    });

    // Generate candidates from compact
    for (const cards of compactBuckets.values()) {
        for (let i = 0; i < cards.length; i++) {
            for (let j = i + 1; j < cards.length; j++) {
                addCandidate(cards[i], cards[j]);
            }
        }
    }

    // Generate candidates from stem
    for (const cards of stemBuckets.values()) {
        for (let i = 0; i < cards.length; i++) {
            for (let j = i + 1; j < cards.length; j++) {
                addCandidate(cards[i], cards[j]);
            }
        }
    }

    // Generate candidates from prefix (only compare if lengths diff <= 2)
    for (const cards of prefixBuckets.values()) {
        if (cards.length < 2) continue;
        for (let i = 0; i < cards.length; i++) {
            for (let j = i + 1; j < cards.length; j++) {
                const lenA = cards[i].english.length;
                const lenB = cards[j].english.length;
                if (Math.abs(lenA - lenB) <= 2) {
                    addCandidate(cards[i], cards[j]);
                }
            }
        }
    }

    const duplicates = [];
    for (const [cA, cB] of candidatePairsMap.values()) {
        const check = checkDuplicateCardFuzzy(cA, cB);
        if (check.isDuplicate) {
            duplicates.push({
                cardA: cA,
                cardB: cB,
                confidence: check.confidence,
                category: check.category,
                reason: check.reason
            });
        }
    }

    return duplicates;
}

const t0 = Date.now();
const results = findDuplicatePairsFuzzy(vocabulary);
const t1 = Date.now();

console.log(`Scan completed in ${t1 - t0} ms! Found ${results.length} duplicate pairs:`);
results.forEach((r, idx) => {
    console.log(`[#${idx + 1}] [${r.category}] [${(r.confidence * 100).toFixed(0)}%] ${r.cardA.english} <-> ${r.cardB.english}: ${r.reason}`);
});
