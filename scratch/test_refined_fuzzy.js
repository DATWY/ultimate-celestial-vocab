// scratch/test_refined_fuzzy.js
import fs from 'fs';
import {
    canonicalEnglish,
    canonicalPartOfSpeech,
    calculateSemanticSimilarity
} from '../src/core/dedup.js';

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

// Add test cases
vocabulary.push({
    id: 'sim_1',
    english: 'Demonstrate',
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

function checkDuplicateCardRefined(cardA, cardB) {
    const canonA = canonicalEnglish(cardA.english);
    const canonB = canonicalEnglish(cardB.english);
    const compactA = compactEnglish(cardA.english);
    const compactB = compactEnglish(cardB.english);
    const stemA = stemEnglishPhrase(cardA.english);
    const stemB = stemEnglishPhrase(cardB.english);

    const posA = canonicalPartOfSpeech(cardA.type, cardA.english);
    const posB = canonicalPartOfSpeech(cardB.type, cardB.english);
    
    // Strict POS compatibility:
    // Verb vs Verb, Noun vs Noun, Adj vs Adj, Adv vs Adv.
    // Verb and Phrasal verb / phrase are compatible.
    const isExactSamePOS = posA === posB;
    const isVerbPhraseCompat = (posA === 'phrase' && posB === 'verb') || (posA === 'verb' && posB === 'phrase');
    const isCompatiblePOS = isExactSamePOS || isVerbPhraseCompat;

    const semSim = calculateSemanticSimilarity(cardA.vietnamese, cardB.vietnamese);

    // 1. EXACT / COMPACT MATCH (Mặt chữ tiếng Anh y hệt sau khi bỏ ngoặc/khoảng trắng/gạch nối)
    if (canonA === canonB || compactA === compactB) {
        if (isCompatiblePOS && semSim >= 0.20) {
            return {
                isDuplicate: true,
                confidence: Math.max(0.95, semSim),
                category: 'EXACT',
                reason: 'Trùng khớp 100% từ vựng và loại từ'
            };
        }
        // Khác loại từ nhưng nghĩa tiếng Việt gần như y hệt (>= 0.70)
        if (semSim >= 0.70) {
            return {
                isDuplicate: true,
                confidence: semSim,
                category: 'EXACT',
                reason: 'Trùng khớp từ vựng với nghĩa tiếng Việt tương đồng cao'
            };
        }
        // Khác loại từ và khác nghĩa -> Đa nghĩa (Polysemy), giữ riêng
        return { isDuplicate: false, confidence: semSim, category: 'POLYSEMY', reason: 'Từ đa nghĩa (khác loại từ)' };
    }

    // 2. INFLECTION / STEM MATCH (e.g. demonstrate vs demonstrating, colleague vs colleagues)
    // CHỈ chấp nhận khi CÙNG LOẠI TỪ và NGHĨA TƯƠNG ĐỒNG
    if (stemA === stemB) {
        if (isCompatiblePOS && semSim >= 0.25) {
            return {
                isDuplicate: true,
                confidence: 0.90,
                category: 'INFLECTION',
                reason: `Biến thể ngữ pháp (${cardA.english} ⟷ ${cardB.english})`
            };
        }
    }

    // 3. FUZZY TYPO MATCH (Lệch chính tả 1-2 ký tự)
    // BẮT BUỘC:
    // - Phải cùng loại từ (isCompatiblePOS)
    // - Phải có độ tương đồng nghĩa tiếng Việt >= 0.35 (hoặc substring containment)
    // - Độ dài từ:
    //   + Dưới 5 ký tự: không xét typo (tránh cat/bat/make/take)
    //   + 5-7 ký tự: dist <= 1
    //   + >= 8 ký tự: dist <= 2
    if (isCompatiblePOS) {
        const minLen = Math.min(compactA.length, compactB.length);
        const maxLen = Math.max(compactA.length, compactB.length);
        const dist = levenshteinDistance(compactA, compactB);
        const simRatio = (maxLen - dist) / maxLen;

        const isAllowedDist = (minLen >= 5 && dist === 1) || (minLen >= 8 && dist <= 2);

        if (isAllowedDist && simRatio >= 0.82 && semSim >= 0.30) {
            return {
                isDuplicate: true,
                confidence: Math.round(simRatio * Math.max(0.85, semSim) * 100) / 100,
                category: 'FUZZY_TYPO',
                reason: `Tìm kiếm mờ: Lệch chính tả (${cardA.english} ⟷ ${cardB.english}, giống ${(simRatio * 100).toFixed(0)}%)`
            };
        }
    }

    return { isDuplicate: false, confidence: 0, category: 'DIFFERENT', reason: 'Không trùng lặp' };
}

function findDuplicatePairsRefined(vocab) {
    const activeCards = vocab.filter(w => !w.isDeleted);
    const candidatePairsMap = new Map();

    const addCandidate = (cA, cB) => {
        if (cA.id === cB.id) return;
        const pairKey = cA.id < cB.id ? `${cA.id}|${cB.id}` : `${cB.id}|${cA.id}`;
        if (!candidatePairsMap.has(pairKey)) {
            candidatePairsMap.set(pairKey, [cA, cB]);
        }
    };

    const compactBuckets = new Map();
    const stemBuckets = new Map();
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

    for (const cards of compactBuckets.values()) {
        for (let i = 0; i < cards.length; i++) {
            for (let j = i + 1; j < cards.length; j++) {
                addCandidate(cards[i], cards[j]);
            }
        }
    }

    for (const cards of stemBuckets.values()) {
        for (let i = 0; i < cards.length; i++) {
            for (let j = i + 1; j < cards.length; j++) {
                addCandidate(cards[i], cards[j]);
            }
        }
    }

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
        const check = checkDuplicateCardRefined(cA, cB);
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
const results = findDuplicatePairsRefined(vocabulary);
const t1 = Date.now();

console.log(`Refined scan completed in ${t1 - t0} ms! Found ${results.length} duplicate pairs:`);
results.forEach((r, idx) => {
    console.log(`[#${idx + 1}] [${r.category}] [${(r.confidence * 100).toFixed(0)}%] ${r.cardA.english} (${r.cardA.type}) <-> ${r.cardB.english} (${r.cardB.type}): ${r.reason}`);
    console.log(`      "${r.cardA.vietnamese}" <-> "${r.cardB.vietnamese}"`);
});
