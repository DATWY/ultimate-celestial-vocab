// scratch/test_fuzzy_dedup.js
import fs from 'fs';

// 1. Vietnamese tone stripper for search
function removeVietnameseTones(str) {
    if (!str) return '';
    return str.normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D')
        .toLowerCase();
}

// 2. Levenshtein Distance
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
                currRow[j - 1] + 1,      // insertion
                prevRow[j] + 1,          // deletion
                prevRow[j - 1] + cost    // substitution
            );
        }
        [prevRow, currRow] = [currRow, prevRow];
    }
    return prevRow[len2];
}

function stringSimilarity(s1, s2) {
    const maxLen = Math.max(s1.length, s2.length);
    if (maxLen === 0) return 1.0;
    const dist = levenshteinDistance(s1, s2);
    return (maxLen - dist) / maxLen;
}

// 3. Basic English Stemmer / Normalizer
function getEnglishStem(word) {
    if (!word) return '';
    let w = word.toLowerCase().trim().replace(/[\-\_\s]/g, '');
    
    // Plural / Verb endings
    if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
    if (w.endsWith('es') && (w.endsWith('shes') || w.endsWith('ches') || w.endsWith('sses') || w.endsWith('xes'))) return w.slice(0, -2);
    if (w.endsWith('ing') && w.length > 5) {
        let base = w.slice(0, -3);
        // e.g. running -> run
        if (base.length > 3 && base[base.length - 1] === base[base.length - 2]) {
            base = base.slice(0, -1);
        } else if (!base.endsWith('e') && !['sing', 'ring', 'bring'].includes(w)) {
            // e.g. demonstrating -> demonstrate
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
    if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1);

    return w;
}

// 4. Vietnamese Meaning Clean & Deduplicate
function cleanAndDeduplicateVietnamese(rawText) {
    if (!rawText) return '';
    // Split by comma, semicolon, newline, slash
    const parts = rawText.split(/[,;\n\/]+/).map(p => p.trim()).filter(Boolean);
    
    const uniqueMap = new Map();
    for (const part of parts) {
        // Clean trailing dots or dashes
        const cleanPart = part.replace(/^[\-\•\*\s]+|[\.\;\,\s]+$/g, '').trim();
        if (!cleanPart) continue;

        // Key normalized: lower-case without redundant spaces
        const normKey = cleanPart.toLowerCase().replace(/\s+/g, ' ');
        
        if (!uniqueMap.has(normKey)) {
            uniqueMap.set(normKey, cleanPart);
        } else {
            // If exists, keep the nicer form if current one has better casing or length
            const existing = uniqueMap.get(normKey);
            if (cleanPart.length > existing.length) {
                uniqueMap.set(normKey, cleanPart);
            }
        }
    }

    // Format: capitalize first char of first meaning
    const list = Array.from(uniqueMap.values());
    if (list.length === 0) return '';
    
    // Capitalize first letter of the first word
    list[0] = list[0].charAt(0).toUpperCase() + list[0].slice(1);
    for (let i = 1; i < list.length; i++) {
        // If it starts with uppercase, lowercase it unless it's an acronym or proper noun
        if (list[i].length > 1 && list[i][0] === list[i][0].toUpperCase() && list[i][1] === list[i][1].toLowerCase()) {
            list[i] = list[i].charAt(0).toLowerCase() + list[i].slice(1);
        }
    }

    return list.join(', ');
}

// Test cases
console.log('--- Test cleanAndDeduplicateVietnamese ---');
const testMeaning1 = 'Thị phạm, chứng minh, Chứng minh, giải thích';
console.log('Input 1:', testMeaning1);
console.log('Output 1:', cleanAndDeduplicateVietnamese(testMeaning1));

const testMeaning2 = 'hợp đồng; Sự thỏa thuận, Hợp đồng , cam kết.';
console.log('Input 2:', testMeaning2);
console.log('Output 2:', cleanAndDeduplicateVietnamese(testMeaning2));

console.log('\n--- Test stringSimilarity & Stem ---');
console.log('demonstrate vs demonstrate:', stringSimilarity('demonstrate', 'demonstrate'));
console.log('demonstrate vs demonstate (typo):', stringSimilarity('demonstrate', 'demonstate'));
console.log('demonstrate vs demonstrating (similarity):', stringSimilarity('demonstrate', 'demonstrating'));
console.log('Stem demonstrate:', getEnglishStem('demonstrate'));
console.log('Stem demonstrating:', getEnglishStem('demonstrating'));
console.log('Stem demonstrated:', getEnglishStem('demonstrated'));
console.log('Stem demonstrates:', getEnglishStem('demonstrates'));
console.log('Stem colleagues:', getEnglishStem('colleagues'));
console.log('Stem colleague:', getEnglishStem('colleague'));
