// scratch/test_real_dedup.js
import fs from 'fs';
import { canonicalEnglish, canonicalPartOfSpeech, calculateSemanticSimilarity, isDuplicateCard, findDuplicatePairs } from '../src/core/dedup.js';

const tsvContent = fs.readFileSync('C:/Users/ASUS/Downloads/celestial_vocab_2026-08-30.tsv', 'utf-8');
const lines = tsvContent.split('\n').filter(l => l.trim().length > 0);
const headers = lines[0].split('\t');
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
        srsDueDate: p[7] ? Number(p[7]) : null,
        tags: (p[8] || '').split(',').filter(Boolean),
        lapses: Number(p[9] || 0),
        isSuspended: p[10] === 'true',
        srsInterval: Number(p[11] || 0),
        srsEaseFactor: Number(p[12] || 2.5),
        difficulty: Number(p[13] || 0),
        stability: Number(p[14] || 1),
        reps: Number(p[15] || 0),
        learningStep: Number(p[16] || 0),
        lastReviewDate: p[17] ? Number(p[17]) : null
    };
}).filter(w => w.english.length > 0);

console.log('Total vocabulary size:', vocabulary.length);

// 1. Current findDuplicatePairs
const currentDups = findDuplicatePairs(vocabulary);
console.log('Current findDuplicatePairs detected:', currentDups.length, 'pairs:');
currentDups.forEach((d, i) => {
    console.log(`[${i+1}] ${d.cardA.english} (${d.cardA.type}): "${d.cardA.vietnamese}" <--> ${d.cardB.english} (${d.cardB.type}): "${d.cardB.vietnamese}" [${(d.confidence*100).toFixed(0)}%]`);
});

// 2. Check for cards with internal duplicate meanings in the file
console.log('\n--- Checking internal duplicate meanings in current file ---');
let internalDupsCount = 0;
vocabulary.forEach(card => {
    const parts = (card.vietnamese || '').split(/[,;\n\/]+/).map(p => p.trim()).filter(Boolean);
    const setLower = new Set();
    let hasDup = false;
    parts.forEach(p => {
        const lower = p.toLowerCase();
        if (setLower.has(lower)) {
            hasDup = true;
        }
        setLower.add(lower);
    });
    if (hasDup) {
        internalDupsCount++;
        console.log(`Card "${card.english}": "${card.vietnamese}"`);
    }
});
console.log('Total cards with internal duplicate meanings:', internalDupsCount);
