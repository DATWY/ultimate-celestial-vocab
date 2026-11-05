// tests/p0-smart-punctuation-and-merge.test.mjs
//
// P0 VERIFICATION SUITE:
// 1. Unicode smart punctuation normalization on iOS/macOS (`’`, `‘`, `“`, `”`, smart dashes,
//    primes, single guillemets, modifier letters, and zero-width noise) in typing, quiz,
//    dedup, fuzzy-search, and text-normalize so contractions and quotes are never falsely
//    graded as typos or wrong answers.
// 2. Accidental submit guard edge cases in evaluateTyping (single-letter and short words
//    enclosed in smart quotes).
// 3. Immediate study queue refresh in executeMergeSingle (matching executeMergeAll)
//    removing deletedCardId from active review and study desk.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeSmartPunctuation, cleanAndDeduplicateVietnamese } from '../src/core/text-normalize.js';
import { superNormalize, evaluateTyping, startTypingTimer } from '../src/features/typing.js';
import { normalizeQuizAnswer, normalizeSmartPunctuation as quizNormalizeSmartPunctuation } from '../src/features/quiz.js';
import { canonicalEnglish, compactEnglish, isDuplicateCard, selectAutoMergePairs, mergeDuplicateCards } from '../src/core/dedup.js';
import { isFuzzySearchMatch } from '../src/core/fuzzy-search.js';
import { buildReviewQueue } from '../src/core/queue.js';
import { getState, setVocabulary, setCurrentCardIndex } from '../src/core/state.js';
import { refreshStudyAfterVocabularyChange } from '../src/ui/render.js';

// ─── 1. normalizeSmartPunctuation ──────────────────────────────────────────

test('P0: normalizeSmartPunctuation handles null, undefined, empty safely', () => {
    assert.equal(normalizeSmartPunctuation(null), '');
    assert.equal(normalizeSmartPunctuation(undefined), '');
    assert.equal(normalizeSmartPunctuation(''), '');
});

test('P0: normalizeSmartPunctuation strips invisible zero-width characters and maps soft hyphen to hyphen', () => {
    assert.equal(normalizeSmartPunctuation('don\u200Bt'), "dont"); // zero-width space
    assert.equal(normalizeSmartPunctuation('don\u200Ct'), "dont"); // zero-width non-joiner
    assert.equal(normalizeSmartPunctuation('don\u200Dt'), "dont"); // zero-width joiner
    assert.equal(normalizeSmartPunctuation('don\uFEFFt'), "dont"); // byte order mark / ZWNBSP
    assert.equal(normalizeSmartPunctuation('well\u00ADknown'), 'well-known'); // soft hyphen
});

test('P0: normalizeSmartPunctuation maps all single quotes / typographic apostrophes to ASCII single quote', () => {
    // iOS/macOS typographic apostrophe (U+2019)
    assert.equal(normalizeSmartPunctuation('don’t'), "don't");
    assert.equal(normalizeSmartPunctuation('can’t'), "can't");
    assert.equal(normalizeSmartPunctuation('it’s'), "it's");
    assert.equal(normalizeSmartPunctuation('let’s'), "let's");
    assert.equal(normalizeSmartPunctuation('I’m'), "I'm");
    assert.equal(normalizeSmartPunctuation('they’re'), "they're");
    assert.equal(normalizeSmartPunctuation('we’ve'), "we've");
    assert.equal(normalizeSmartPunctuation('he’d'), "he'd");
    assert.equal(normalizeSmartPunctuation('o’clock'), "o'clock");

    // Left single quote (U+2018), low/reversed quotes, modifier letters, fullwidth, accents
    assert.equal(normalizeSmartPunctuation('‘quote’'), "'quote'");
    assert.equal(normalizeSmartPunctuation('‚single low‘'), "'single low'");
    assert.equal(normalizeSmartPunctuation('‛high reversed‛'), "'high reversed'");
    assert.equal(normalizeSmartPunctuation('ʻokinaʻ'), "'okina'");
    assert.equal(normalizeSmartPunctuation('ʼmodifierʼ'), "'modifier'");
    assert.equal(normalizeSmartPunctuation('ʽreversed commaʽ'), "'reversed comma'");
    assert.equal(normalizeSmartPunctuation('ˈstressˈ'), "'stress'");
    assert.equal(normalizeSmartPunctuation('donˊt'), "don't");
    assert.equal(normalizeSmartPunctuation('donˋt'), "don't");
    assert.equal(normalizeSmartPunctuation('don′t'), "don't"); // prime
    assert.equal(normalizeSmartPunctuation('don‵t'), "don't"); // reversed prime
    assert.equal(normalizeSmartPunctuation('‹guillemet›'), "'guillemet'");
    assert.equal(normalizeSmartPunctuation('＇fullwidth＇'), "'fullwidth'");
    assert.equal(normalizeSmartPunctuation('｀fullwidth grave｀'), "'fullwidth grave'");
    assert.equal(normalizeSmartPunctuation('`grave`'), "'grave'");
    assert.equal(normalizeSmartPunctuation('´acute´'), "'acute'");
});

test('P0: normalizeSmartPunctuation maps all double quotes to ASCII double quote', () => {
    assert.equal(normalizeSmartPunctuation('“smart quotes”'), '"smart quotes"');
    assert.equal(normalizeSmartPunctuation('„german quotes”'), '"german quotes"');
    assert.equal(normalizeSmartPunctuation('‟high-reversed‟'), '"high-reversed"');
    assert.equal(normalizeSmartPunctuation('«guillemets»'), '"guillemets"');
    assert.equal(normalizeSmartPunctuation('＂fullwidth＂'), '"fullwidth"');
    assert.equal(normalizeSmartPunctuation('″double prime″'), '"double prime"');
    assert.equal(normalizeSmartPunctuation('‶reversed double prime‶'), '"reversed double prime"');
});

test('P0: normalizeSmartPunctuation maps smart dashes and fullwidth hyphens to ASCII hyphen', () => {
    assert.equal(normalizeSmartPunctuation('state–of–the–art'), 'state-of-the-art'); // en-dash
    assert.equal(normalizeSmartPunctuation('well—known'), 'well-known');             // em-dash
    assert.equal(normalizeSmartPunctuation('horizontal―bar'), 'horizontal-bar');     // horizontal bar
    assert.equal(normalizeSmartPunctuation('minus−sign'), 'minus-sign');             // minus
    assert.equal(normalizeSmartPunctuation('state－of－the－art'), 'state-of-the-art'); // fullwidth hyphen U+FF0D
    assert.equal(normalizeSmartPunctuation('small﹘dash'), 'small-dash');             // small em dash U+FE58
    assert.equal(normalizeSmartPunctuation('small﹣hyphen'), 'small-hyphen');         // small hyphen-minus U+FE63
});

// ─── 2. superNormalize in typing & quiz ────────────────────────────────────

test('P0: superNormalize equates contractions with iOS smart apostrophe and ASCII apostrophe', () => {
    assert.equal(superNormalize('don’t'), superNormalize("don't"));
    assert.equal(superNormalize('can’t'), superNormalize("can't"));
    assert.equal(superNormalize('it’s'), superNormalize("it's"));
    assert.equal(superNormalize('let’s'), superNormalize("let's"));
    assert.equal(superNormalize('I’m'), superNormalize("I'm"));
    assert.equal(superNormalize('they’re'), superNormalize("they're"));
    assert.equal(superNormalize('we’ve'), superNormalize("we've"));
    assert.equal(superNormalize('he’d'), superNormalize("he'd"));
    assert.equal(superNormalize('o’clock'), superNormalize("o'clock"));
    assert.equal(superNormalize('don′t'), superNormalize("don't"));
});

test('P0: superNormalize strips quotes and converts smart dashes seamlessly', () => {
    assert.equal(superNormalize('“ephemeral”'), 'ephemeral');
    assert.equal(superNormalize('‘ephemeral’'), 'ephemeral');
    assert.equal(superNormalize('"ephemeral"'), 'ephemeral');
    assert.equal(superNormalize("'ephemeral'"), 'ephemeral');
    assert.equal(superNormalize('‹ephemeral›'), 'ephemeral');
    assert.equal(superNormalize('«ephemeral»'), 'ephemeral');
    assert.equal(superNormalize('state–of–the–art'), 'state of the art');
    assert.equal(superNormalize('well—known'), 'well known');
    assert.equal(superNormalize('state－of－the－art'), 'state of the art');
});

// ─── 3. evaluateTyping — No false typos or false wrong grades ──────────────

test('P0: evaluateTyping grades iOS smart apostrophe as perfect (distance 0, rating 3 or 4)', () => {
    startTypingTimer();

    const pairs = [
        ["don't", 'don’t'],
        ["can't", 'can’t'],
        ["it's", 'it’s'],
        ["let's", 'let’s'],
        ["I'm", 'I’m'],
        ["they're", 'they’re'],
        ["we've", 'we’ve'],
        ["he'd", 'he’d'],
        ["o'clock", 'o’clock'],
        ["don't", 'don′t'],
        ["don't", 'don\u200Bt'], // zero-width space in paste
        ["well-known", 'well­known'], // soft hyphen in paste
        ["state-of-the-art", 'state－of－the－art'] // CJK fullwidth hyphen
    ];

    for (const [target, input] of pairs) {
        const result = evaluateTyping(input, target);
        assert.equal(
            result.distance,
            0,
            `Expected distance 0 for target "${target}" and input "${input}", got ${result.distance}`
        );
        assert.ok(
            result.rating === 3 || result.rating === 4,
            `Expected rating 3 or 4 for "${input}", got rating ${result.rating} (status: ${result.status})`
        );
        assert.notEqual(result.status, 'typo', `Should never be graded as typo: "${input}"`);
        assert.notEqual(result.status, 'incorrect', `Should never be graded as incorrect: "${input}"`);
    }
});

test('P0: evaluateTyping handles reverse case (target has smart apostrophe, input has ASCII apostrophe)', () => {
    startTypingTimer();
    const result = evaluateTyping("don't", 'don’t');
    assert.equal(result.distance, 0);
    assert.ok(result.rating >= 3);
});

test('P0: evaluateTyping short words like "it\'s" (len 3 stripped) are never marked as incorrect due to smart quote', () => {
    startTypingTimer();
    const result = evaluateTyping('it’s', "it's");
    assert.equal(result.distance, 0);
    assert.ok(result.rating >= 3);
    assert.notEqual(result.status, 'incorrect');
});

test('P0: evaluateTyping does NOT reject short words in smart quotes with too_short guard', () => {
    startTypingTimer();

    // Single-letter words in smart quotes (previously failed because input.length 1 < 0.4 * target.length 3)
    const singleLetterResult1 = evaluateTyping('I', '“I”');
    assert.equal(singleLetterResult1.status, 'perfect_fast');
    assert.equal(singleLetterResult1.distance, 0);

    const singleLetterResult2 = evaluateTyping('a', '“a”');
    assert.equal(singleLetterResult2.status, 'perfect_fast');
    assert.equal(singleLetterResult2.distance, 0);

    const twoLetterResult = evaluateTyping('be', '“be”');
    assert.equal(twoLetterResult.distance, 0);
    assert.ok(twoLetterResult.rating >= 3);
});

test('P0: evaluateTyping strips accidental smart/ascii quotes around inputs', () => {
    startTypingTimer();
    const result1 = evaluateTyping('“serendipity”', 'serendipity');
    assert.equal(result1.distance, 0);
    assert.ok(result1.rating >= 3);

    const result2 = evaluateTyping('serendipity', '“serendipity”');
    assert.equal(result2.distance, 0);
    assert.ok(result2.rating >= 3);

    const result3 = evaluateTyping('‹serendipity›', 'serendipity');
    assert.equal(result3.distance, 0);
    assert.ok(result3.rating >= 3);
});

// ─── 4. Quiz answer normalization ──────────────────────────────────────────

test('P0: quiz exports normalizeSmartPunctuation and normalizeQuizAnswer', () => {
    assert.equal(typeof quizNormalizeSmartPunctuation, 'function');
    assert.equal(typeof normalizeQuizAnswer, 'function');

    assert.equal(normalizeQuizAnswer('don’t'), normalizeQuizAnswer("don't"));
    assert.equal(normalizeQuizAnswer('can’t'), normalizeQuizAnswer("can't"));
    assert.equal(normalizeQuizAnswer('it’s'), normalizeQuizAnswer("it's"));
    assert.equal(normalizeQuizAnswer('“ubiquitous”'), normalizeQuizAnswer('ubiquitous'));
    assert.equal(normalizeQuizAnswer('state–of–the–art'), normalizeQuizAnswer('state-of-the-art'));
    assert.equal(normalizeQuizAnswer('don′t'), normalizeQuizAnswer("don't"));
    assert.equal(normalizeQuizAnswer('don\u200Bt'), normalizeQuizAnswer("don't"));
});

// ─── 5. cleanAndDeduplicateVietnamese ──────────────────────────────────────

test('P0: cleanAndDeduplicateVietnamese normalizes smart quotes and dashes', () => {
    const raw = '“toàn diện”, "toàn diện", – bao quát –';
    const cleaned = cleanAndDeduplicateVietnamese(raw);
    assert.equal(cleaned, 'Toàn diện, bao quát');
});

// ─── 6. Dedup engine with smart punctuation ────────────────────────────────

test('P0: dedup canonicalEnglish and compactEnglish normalize smart quotes and dashes', () => {
    assert.equal(canonicalEnglish('don’t'), canonicalEnglish("don't"));
    assert.equal(compactEnglish('don’t'), compactEnglish("don't"));
    assert.equal(compactEnglish('“organize”'), compactEnglish('organize'));
    assert.equal(compactEnglish('state–of–the–art'), compactEnglish('state-of-the-art'));
    assert.equal(compactEnglish('don′t'), compactEnglish("don't"));
});

test('P0: dedup detects duplicate pair when one has smart apostrophe and one has ASCII apostrophe', () => {
    const cardA = {
        id: 'c1',
        english: "don't",
        vietnamese: 'không, đừng',
        type: 'phrase',
        srsStatus: 'Mastered',
        stability: 10,
        reps: 5
    };
    const cardB = {
        id: 'c2',
        english: 'don’t',
        vietnamese: 'không, đừng',
        type: 'phrase',
        srsStatus: 'Learning',
        stability: 2,
        reps: 1
    };

    const result = isDuplicateCard(cardA, cardB);
    assert.equal(result.isDuplicate, true, 'don\'t and don’t must be detected as duplicate');
    assert.equal(result.category, 'EXACT');

    const pairs = [{ cardA, cardB, ...result }];
    const { safe } = selectAutoMergePairs(pairs);
    assert.equal(safe.length, 1, 'don\'t and don’t should be in safe auto-merge list');
});

// ─── 7. Fuzzy search with smart punctuation ────────────────────────────────

test('P0: isFuzzySearchMatch matches queries with smart punctuation against ASCII and vice versa', () => {
    // Search query on iOS with smart apostrophe matches standard ASCII word in deck
    assert.equal(isFuzzySearchMatch('don’t', "don't", 'không'), true);
    // Search query with ASCII matches word stored with smart apostrophe in deck
    assert.equal(isFuzzySearchMatch("don't", 'don’t', 'không'), true);
    // Search query with smart quotes matches word
    assert.equal(isFuzzySearchMatch('“benevolent”', 'benevolent', 'nhân từ'), true);
    // Search query with en-dash matches hyphenated word
    assert.equal(isFuzzySearchMatch('state–of–the–art', 'state-of-the-art', 'hiện đại'), true);
    // Search query with prime
    assert.equal(isFuzzySearchMatch('don′t', "don't", 'không'), true);
});

// ─── 8. executeMergeSingle refreshes study queue and desk ──────────────────

test('P0: executeMergeSingle calls refreshStudyAfterVocabularyChange matching executeMergeAll', () => {
    const modalSrc = fs.readFileSync(new URL('../src/ui/modal.js', import.meta.url), 'utf8');
    assert.match(
        modalSrc,
        /executeMergeSingle[\s\S]*?refreshStudyAfterVocabularyChange\(\s*deletedCardId\s*\?\s*\[deletedCardId\]\s*:\s*\[\]\s*\)/,
        'executeMergeSingle must call refreshStudyAfterVocabularyChange([deletedCardId])'
    );
});

test('P0: mergeDuplicateCards returns correct mergedCard and deletedCardId for refresh', () => {
    const cardA = {
        id: 'card-primary',
        english: 'comprehensive',
        vietnamese: 'toàn diện',
        type: 'adjective',
        srsStatus: 'Mastered',
        stability: 30,
        reps: 10
    };
    const cardB = {
        id: 'card-secondary',
        english: 'Comprehensive',
        vietnamese: 'toàn diện, bao quát',
        type: 'adjective',
        srsStatus: 'Learning',
        stability: 3,
        reps: 2
    };

    const { mergedCard, deletedCardId } = mergeDuplicateCards(cardA, cardB);
    assert.equal(mergedCard.id, 'card-primary');
    assert.equal(deletedCardId, 'card-secondary');
});

test('P0: refreshStudyAfterVocabularyChange immediately excludes deleted cards from active review desk', () => {
    const cardA = {
        id: 'card-1',
        english: 'apple',
        vietnamese: 'táo',
        srsStatus: 'Learning',
        srsDueDate: Date.now() - 5000,
        stability: 1,
        reps: 1
    };
    const cardB = {
        id: 'card-2',
        english: 'banana',
        vietnamese: 'chuối',
        srsStatus: 'Learning',
        srsDueDate: Date.now() - 5000,
        stability: 1,
        reps: 1
    };

    setVocabulary([cardA, cardB]);
    buildReviewQueue();
    assert.equal(getState().currentReviewQueue.length, 2);

    // Set cardB as currently displayed card
    setCurrentCardIndex(1);
    assert.equal(getState().currentCardIndex, 1);

    // Simulate merge: cardB is deleted, cardA is kept
    setVocabulary([cardA, { ...cardB, isDeleted: true, updatedAt: Date.now() }]);

    // Trigger refreshStudyAfterVocabularyChange with cardB deleted
    refreshStudyAfterVocabularyChange([cardB.id]);

    // cardB was active on desk (currentCardIndex was 1).
    // refreshStudyAfterVocabularyChange detected that cardB was deleted/removed,
    // so it immediately called displayCard(getNextCardToReview()).
    // getNextCardToReview() pulled cardA (index 0) from queue to the active study desk.
    assert.equal(getState().currentCardIndex, 0);
    assert.equal(getState().vocabulary[getState().currentCardIndex].id, 'card-1');
    assert.equal(getState().vocabulary[getState().currentCardIndex].english, 'apple');
});
