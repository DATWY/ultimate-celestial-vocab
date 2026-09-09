// scratch/test_phrase_matching.js
function extractVietnamesePhrases(text) {
    if (!text) return new Set();
    const clean = text.replace(/[\(\[\{].*?[\)\]\}]/g, ' ');
    const parts = clean.split(/[,;\n\/]+/).map(p => p.trim().toLowerCase()).filter(Boolean);
    const phrases = new Set();
    parts.forEach(p => {
        // remove extra spaces and punctuation
        const norm = p.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
        if (norm) phrases.add(norm);
    });
    return phrases;
}

function calculatePhraseOverlap(textA, textB) {
    const setA = extractVietnamesePhrases(textA);
    const setB = extractVietnamesePhrases(textB);
    if (setA.size === 0 || setB.size === 0) return 0;

    let matchCount = 0;
    for (const pA of setA) {
        for (const pB of setB) {
            if (pA === pB || pA.includes(pB) || pB.includes(pA)) {
                matchCount++;
                break;
            }
        }
    }
    return matchCount / Math.min(setA.size, setB.size);
}

console.log('demonstrate vs demonstate:', calculatePhraseOverlap(
    'Thị phạm, chứng minh, giải thích',
    'Thị phạm, chứng minh'
)); // Expected: 1.0 (both phrases match)

console.log('Assume vs Assure:', calculatePhraseOverlap(
    'Cho rằng, đảm đương',
    'Cam đoan, đảm bảo một cách chắc chắn'
)); // Expected: 0.0 (no phrase matches)

console.log('Representation vs Representative:', calculatePhraseOverlap(
    'Sự đại diện, hình tượng',
    'Người đại diện (nhân viên tư vấn)'
)); // "đại diện" is in both
