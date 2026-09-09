// scratch/test_final_verification.js
import fs from 'fs';
import {
    findDuplicatePairs,
    findInternalDuplicateCards,
    mergeDuplicateCards,
    cleanAndDeduplicateVietnamese,
    isDuplicateCard,
    levenshteinDistance,
    isFuzzySearchMatch,
    removeVietnameseTones
} from '../src/core/dedup.js';

console.log('=== TEST 1: Khử trùng nghĩa tiếng Việt (cleanAndDeduplicateVietnamese) ===');
const meaningTest = 'Thị phạm, chứng minh, Chứng minh, giải thích';
const cleanedResult = cleanAndDeduplicateVietnamese(meaningTest);
console.log('Original:', meaningTest);
console.log('Cleaned: ', cleanedResult);
if (cleanedResult === 'Thị phạm, chứng minh, giải thích') {
    console.log('=> TEST 1 PASSED: Khử trùng case-insensitive thành công!\n');
} else {
    console.error('=> TEST 1 FAILED!\n');
    process.exit(1);
}

console.log('=== TEST 2: Gộp 2 thẻ trùng lặp (mergeDuplicateCards) ===');
const card1 = {
    id: 'c1',
    english: 'Demonstrate',
    vietnamese: 'Thị phạm, chứng minh',
    type: 'verb',
    srsStatus: 'Mastered',
    stability: 12.5,
    reps: 14,
    tags: ['TOEIC', 'Verbs'],
    example: 'The chef demonstrated how to make the pasta dough.'
};
const card2 = {
    id: 'c2',
    english: 'demonstrate',
    vietnamese: 'Chứng minh, giải thích',
    type: 'verb',
    srsStatus: 'Learning',
    stability: 3.2,
    reps: 4,
    tags: ['Verbs', 'Business'],
    example: 'The study demonstrated a clear link between stress and illness.'
};
const { mergedCard, deletedCardId } = mergeDuplicateCards(card1, card2);
console.log('Merged Card:', {
    english: mergedCard.english,
    vietnamese: mergedCard.vietnamese,
    srsStatus: mergedCard.srsStatus,
    stability: mergedCard.stability,
    tags: mergedCard.tags
});
console.log('Deleted Card ID:', deletedCardId);
if (
    mergedCard.vietnamese === 'Thị phạm, chứng minh, giải thích' &&
    mergedCard.srsStatus === 'Mastered' &&
    deletedCardId === 'c2'
) {
    console.log('=> TEST 2 PASSED: Gộp thẻ và bảo toàn tiến trình SRS cao nhất thành công!\n');
} else {
    console.error('=> TEST 2 FAILED!\n');
    process.exit(1);
}

console.log('=== TEST 3: Quét thẻ có nghĩa bị lặp nội bộ (findInternalDuplicateCards) ===');
const testVocabWithInternal = [
    { id: 'v1', english: 'Demonstrate', vietnamese: 'Thị phạm, chứng minh, Chứng minh, giải thích', isDeleted: false },
    { id: 'v2', english: 'Apple', vietnamese: 'Quả táo', isDeleted: false },
    { id: 'v3', english: 'Contract', vietnamese: 'Hợp đồng, sự thỏa thuận, Hợp đồng', isDeleted: false }
];
const internalDups = findInternalDuplicateCards(testVocabWithInternal);
console.log(`Tìm thấy ${internalDups.length} thẻ có nghĩa lặp nội bộ:`);
internalDups.forEach(d => {
    console.log(`- ${d.card.english}: "${d.originalMeaning}" -> "${d.cleanedMeaning}"`);
});
if (internalDups.length === 2 && internalDups[0].card.english === 'Demonstrate' && internalDups[1].card.english === 'Contract') {
    console.log('=> TEST 3 PASSED: Phát hiện chính xác thẻ lặp nghĩa nội bộ!\n');
} else {
    console.error('=> TEST 3 FAILED!\n');
    process.exit(1);
}

console.log('=== TEST 4: Bảo vệ chống nhận diện nhầm (False Positive Protection) ===');
const falsePositiveChecks = [
    { a: { english: 'affect', type: 'verb', vietnamese: 'Ảnh hưởng, tác động' }, b: { english: 'effect', type: 'noun', vietnamese: 'Hiệu quả, kết quả' }, name: 'affect vs effect' },
    { a: { english: 'assume', type: 'verb', vietnamese: 'Cho rằng, đảm đương' }, b: { english: 'assure', type: 'verb', vietnamese: 'Cam đoan, đảm bảo' }, name: 'assume vs assure' },
    { a: { english: 'manufacture', type: 'verb', vietnamese: 'Sản xuất, chế tạo' }, b: { english: 'manufacturer', type: 'noun', vietnamese: 'Nhà sản xuất' }, name: 'manufacture vs manufacturer' },
    { a: { english: 'accurate', type: 'adj', vietnamese: 'Chính xác' }, b: { english: 'accurately', type: 'adv', vietnamese: 'Một cách chính xác' }, name: 'accurate vs accurately' }
];
falsePositiveChecks.forEach(tc => {
    const res = isDuplicateCard(tc.a, tc.b);
    console.log(`Checking ${tc.name}: isDuplicate = ${res.isDuplicate} (${res.category})`);
    if (res.isDuplicate) {
        console.error(`=> FAILED: ${tc.name} must NOT be considered duplicate!`);
        process.exit(1);
    }
});
console.log('=> TEST 4 PASSED: Toàn bộ các cặp khác nghĩa hoặc word family đều được bảo vệ an toàn 100%!\n');

console.log('=== TEST 5: Nhận diện trùng mờ và biến thể (Fuzzy & Inflection) ===');
const truePositiveChecks = [
    { a: { english: 'demonstrate', type: 'verb', vietnamese: 'Chứng minh, thị phạm' }, b: { english: 'demonstate', type: 'verb', vietnamese: 'Thị phạm, chứng minh' }, expectedCat: 'FUZZY_TYPO', name: 'demonstrate vs demonstate (typo)' },
    { a: { english: 'colleague', type: 'noun', vietnamese: 'Đồng nghiệp' }, b: { english: 'colleagues', type: 'noun', vietnamese: 'Các đồng nghiệp' }, expectedCat: 'INFLECTION', name: 'colleague vs colleagues (plural)' },
    { a: { english: 'take off', type: 'verb', vietnamese: 'Cất cánh' }, b: { english: 'take-off', type: 'phrase', vietnamese: 'Cất cánh' }, expectedCat: 'EXACT', name: 'take off vs take-off (dash/space)' }
];
truePositiveChecks.forEach(tc => {
    const res = isDuplicateCard(tc.a, tc.b);
    console.log(`Checking ${tc.name}: isDuplicate = ${res.isDuplicate} (${res.category})`);
    if (!res.isDuplicate || res.category !== tc.expectedCat) {
        console.error(`=> FAILED: ${tc.name} should be duplicate with category ${tc.expectedCat}!`);
        process.exit(1);
    }
});
console.log('=> TEST 5 PASSED: Phát hiện đúng tất cả biến thể và typo!\n');

console.log('=== TEST 6: Tìm kiếm mờ trong Quản lý từ vựng (isFuzzySearchMatch) ===');
const searchCard = {
    english: 'Demonstrate',
    vietnamese: 'Thị phạm, chứng minh, giải thích'
};
console.log('- Gõ "demonstate" (sai chính tả):', isFuzzySearchMatch('demonstate', searchCard.english, searchCard.vietnamese));
console.log('- Gõ "thi pham" (không dấu):', isFuzzySearchMatch('thi pham', searchCard.english, searchCard.vietnamese));
console.log('- Gõ "chung minh" (không dấu):', isFuzzySearchMatch('chung minh', searchCard.english, searchCard.vietnamese));
console.log('- Gõ "pham giai thich" (đa từ khóa):', isFuzzySearchMatch('pham giai thich', searchCard.english, searchCard.vietnamese));
console.log('- Gõ "unrelated" (không liên quan):', isFuzzySearchMatch('unrelated', searchCard.english, searchCard.vietnamese));

if (
    isFuzzySearchMatch('demonstate', searchCard.english, searchCard.vietnamese) === true &&
    isFuzzySearchMatch('thi pham', searchCard.english, searchCard.vietnamese) === true &&
    isFuzzySearchMatch('chung minh', searchCard.english, searchCard.vietnamese) === true &&
    isFuzzySearchMatch('pham giai thich', searchCard.english, searchCard.vietnamese) === true &&
    isFuzzySearchMatch('unrelated', searchCard.english, searchCard.vietnamese) === false
) {
    console.log('=> TEST 6 PASSED: Tìm kiếm mờ và tiếng Việt không dấu hoạt động hoàn hảo!\n');
} else {
    console.error('=> TEST 6 FAILED!\n');
    process.exit(1);
}

console.log('ALL 6 COMPREHENSIVE TESTS PASSED SUCCESSFULLY!');
