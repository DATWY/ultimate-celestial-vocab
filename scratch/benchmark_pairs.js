// scratch/benchmark_pairs.js
import fs from 'fs';

const tsvContent = fs.readFileSync('C:/Users/ASUS/Downloads/celestial_vocab_2026-08-30.tsv', 'utf-8');
const lines = tsvContent.split('\n').filter(l => l.trim().length > 0);
const words = lines.slice(1).map((line, idx) => {
    const p = line.split('\t');
    return {
        id: 'id_' + idx,
        english: p[0] || '',
        vietnamese: p[1] || '',
        type: p[2] || ''
    };
}).filter(w => w.english.length > 0);

console.log('Total words:', words.length);

const startTime = Date.now();

// 1. Bucket by normalized stem / prefix
// To be both fast and catch typos, we can group cards by:
// - Stem key: getEnglishStem(canonicalEnglish(word.english))
// - Compact key: word without spaces/hyphens
// - 3-gram or length-based indexing for candidates
// Let's test a smart candidate generation:

function getTokens(str) {
    return str.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean);
}

const stemBuckets = new Map();
const compactBuckets = new Map();

words.forEach(card => {
    const cleanEng = card.english.toLowerCase().trim();
    // Compact key:
    const compact = cleanEng.replace(/[^a-z0-9]/g, '');
    if (!compactBuckets.has(compact)) compactBuckets.set(compact, []);
    compactBuckets.get(compact).push(card);

    // Stem key:
    const wordsInEng = getTokens(cleanEng);
    if (wordsInEng.length > 0) {
        // stem of the main word
        const mainStem = wordsInEng.map(w => {
            if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
            if (w.endsWith('es') && w.length > 4) return w.slice(0, -2);
            if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3);
            if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2);
            if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1);
            return w;
        }).join('_');

        if (!stemBuckets.has(mainStem)) stemBuckets.set(mainStem, []);
        stemBuckets.get(mainStem).push(card);
    }
});

console.log('Compact buckets with > 1 item:', Array.from(compactBuckets.values()).filter(v => v.length > 1).length);
console.log('Stem buckets with > 1 item:', Array.from(stemBuckets.values()).filter(v => v.length > 1).length);

// What about Typo Fuzzy search (Levenshtein distance <= 2)?
// Using a prefix index (first 2-3 letters) or length partitioning:
let candidatePairs = new Set();

// A. Pairs from stemBuckets
for (const [_, cards] of stemBuckets.entries()) {
    if (cards.length < 2) continue;
    for (let i = 0; i < cards.length; i++) {
        for (let j = i + 1; j < cards.length; j++) {
            const key = cards[i].id < cards[j].id ? `${cards[i].id}|${cards[j].id}` : `${cards[j].id}|${cards[i].id}`;
            candidatePairs.add(key);
        }
    }
}

// B. Pairs from compactBuckets
for (const [_, cards] of compactBuckets.entries()) {
    if (cards.length < 2) continue;
    for (let i = 0; i < cards.length; i++) {
        for (let j = i + 1; j < cards.length; j++) {
            const key = cards[i].id < cards[j].id ? `${cards[i].id}|${cards[j].id}` : `${cards[j].id}|${cards[i].id}`;
            candidatePairs.add(key);
        }
    }
}

// C. Fuzzy Typo search across words of similar length (diff <= 2) and shared 3-grams or prefix:
// To be ultra fast:
const ngrams = new Map();
words.forEach(w => {
    const clean = w.english.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (clean.length < 4) return;
    for (let i = 0; i <= clean.length - 3; i++) {
        const gram = clean.slice(i, i + 3);
        if (!ngrams.has(gram)) ngrams.set(gram, []);
        ngrams.get(gram).push(w);
    }
});

console.log('Total candidate pairs gathered so far:', candidatePairs.size);
console.log('Time taken:', Date.now() - startTime, 'ms');
