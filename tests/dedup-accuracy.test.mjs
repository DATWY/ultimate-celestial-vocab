import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDuplicateCard, findDuplicatePairs, mergeDuplicateCards } from '../src/core/dedup.js';

test('dedup accuracy: confusables must NOT be flagged as duplicates (0 false positives)', () => {
    const confusables = [
        [{ english: 'affect', vietnamese: 'ảnh hưởng', type: 'v' }, { english: 'effect', vietnamese: 'kết quả, hiệu ứng', type: 'n' }],
        [{ english: 'desert', vietnamese: 'sa mạc', type: 'n' }, { english: 'dessert', vietnamese: 'món tráng miệng', type: 'n' }],
        [{ english: 'compliment', vietnamese: 'lời khen', type: 'n' }, { english: 'complement', vietnamese: 'phần bổ sung', type: 'n' }],
        [{ english: 'accept', vietnamese: 'chấp nhận', type: 'v' }, { english: 'except', vietnamese: 'ngoại trừ', type: 'prep' }]
    ];

    for (const [a, b] of confusables) {
        const result = isDuplicateCard(a, b);
        assert.equal(result.isDuplicate, false, `Confusable pair "${a.english}" vs "${b.english}" must not be duplicate`);
    }
});

test('dedup accuracy: spelling and inflectional variants MUST be detected (0 false negatives)', () => {
    const trueDuplicates = [
        [{ english: 'Color', vietnamese: 'màu sắc' }, { english: 'colour', vietnamese: 'màu sắc' }],
        [{ english: 'organize', vietnamese: 'tổ chức' }, { english: 'organise', vietnamese: 'tổ chức' }],
        [{ english: 'cat', vietnamese: 'con mèo' }, { english: 'Cat', vietnamese: 'mèo' }],
        [{ english: 'ice cream', vietnamese: 'kem' }, { english: 'ice  cream', vietnamese: 'món kem lạnh' }],
        [{ english: 'happy', vietnamese: 'vui vẻ, hạnh phúc' }, { english: 'happier', vietnamese: 'hạnh phúc hơn' }]
    ];

    for (const [a, b] of trueDuplicates) {
        const result = isDuplicateCard(a, b);
        assert.equal(result.isDuplicate, true, `Variant pair "${a.english}" vs "${b.english}" must be recognized as duplicate`);
    }
});

test('dedup accuracy: polysemous words with different POS and low semantic similarity are preserved', () => {
    const cardNoun = { id: 'run-n', english: 'run', type: 'n', vietnamese: 'chuyến chạy, đợt chạy' };
    const cardVerb = { id: 'run-v', english: 'run', type: 'v', vietnamese: 'vận hành, quản lý doanh nghiệp' };

    const result = isDuplicateCard(cardNoun, cardVerb);
    assert.equal(result.isDuplicate, false, 'Polysemous words with distinct POS and dissimilar meanings should not be merged');
});

test('findDuplicatePairs high-speed SymSpell indexing', () => {
    const words = [
        { id: '1', english: 'apple', vietnamese: 'quả táo' },
        { id: '2', english: 'Apple', vietnamese: 'trái táo' },
        { id: '3', english: 'banana', vietnamese: 'quả chuối' },
        { id: '4', english: 'bananas', vietnamese: 'những quả chuối' },
        { id: '5', english: 'orange', vietnamese: 'quả cam' },
        { id: '6', english: 'affect', vietnamese: 'tác động' },
        { id: '7', english: 'effect', vietnamese: 'kết quả' }
    ];

    const pairs = findDuplicatePairs(words);
    const pairKeys = pairs.map(p => `${p.cardA.english}|${p.cardB.english}`.toLowerCase());

    // Apple/apple and banana/bananas should be found
    assert.ok(pairKeys.some(k => k.includes('apple')), 'apple duplicate found');
    assert.ok(pairKeys.some(k => k.includes('banana')), 'banana duplicate found');

    // affect/effect must NOT be found
    assert.ok(!pairKeys.some(k => k.includes('affect') && k.includes('effect')), 'confusables not in duplicate pairs');
});
