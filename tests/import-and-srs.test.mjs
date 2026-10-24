import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTsv, parseVocabularyTsv, exportVocabularyTsv } from '../src/core/tabular.js';
import { planVocabularyImport } from '../src/core/import-plan.js';
import { DEFAULT_FSRS7_PARAMS, parseAndValidateFsrs7Params, validFsrs7Params } from '../src/core/srs/constants.js';
import { calculateNextSrsState } from '../src/core/srs/index.js';
import { prepareTrainingData, evaluateParameters, optimizeParameters } from '../src/core/srs/training.js';
import { mergeLearningSettings } from '../src/core/settings-merge.js';
import { nextRevision, normalizeCard, restoreCardReview } from '../src/core/card-merge.js';

test('TSV round trip preserves tabs, quotes, line breaks, optional content and SRS', () => {
    const card = { english: 'English learner', vietnamese: 'nghĩa\tđầy đủ', example: 'He said "hello".\nA new line.\\nLiteral.',
        type: 'noun', tags: ['Study', 'Work'], isStarred: true, srsStatus: 'Learning', srsDueDate: 1000,
        srsInterval: .5, difficulty: 5.5, stability: 2, stabilityShort: 1, notes: 'ghi chú\nnhiều dòng', reps: 2, lapses: 1 };
    const result = parseVocabularyTsv(exportVocabularyTsv([card]));
    assert.equal(result.errors.length, 0); assert.equal(result.rows.length, 1);
    for (const field of Object.keys(card)) assert.deepEqual(result.rows[0].card[field], card[field], field);
});
test('no-header data whose word contains English is not mistaken for a header', () => {
    assert.equal(parseVocabularyTsv('English learner\tngười học tiếng Anh').rows.length, 1);
});
test('reordered headers, BOM and CRLF are accepted', () => {
    const result = parseVocabularyTsv('\uFEFFVietnamese\tEnglish\tType\r\nmèo\tcat\tnoun\r\n');
    assert.equal(result.rows[0].card.english, 'cat');
    assert.equal(result.rows[0].card.vietnamese, 'mèo');
});
test('invalid state, NaN, negative and fractional counters are rejected by row', () => {
    for (const [index, invalid] of [[6,'Unknown'],[7,'NaN'],[9,'-1'],[15,'2.5'],[13,'11'],[14,'Infinity']]) {
        const parts = ['cat','mèo']; parts[index] = invalid;
        const result = parseVocabularyTsv(parts.join('\t'));
        assert.equal(result.rows.length, 0); assert.equal(result.errors[0].line, 1);
    }
});
test('malformed quoted input fails before any mutation', () => {
    assert.throws(() => parseTsv('cat\t"mèo'), /ngoặc kép/);
    assert.throws(() => parseTsv('cat\t"mèo"text'), /ký tự/);
});
test('a later duplicate enriches a pending new row without an undefined card ID', () => {
    const plan = planVocabularyImport('cat\tmèo\tnoun\t\tA cat.\ncat\tmèo\tnoun\t/kæt/\tA very happy cat.', [], () => 'new-card', 100);
    assert.equal(plan.newItems.length, 1); assert.equal(plan.updateItems.length, 0);
    assert.equal(plan.newItems[0].pronunciation, '/kæt/');
    assert.equal(plan.newItems[0].example, 'A very happy cat.');
});
test('import enrichment keeps review progress and never mutates preview source', () => {
    const card = { id: 'a', english: 'cat', vietnamese: 'mèo', type: 'noun', tags: [], srsStatus: 'Mastered', reps: 9, stability: 50 };
    const plan = planVocabularyImport('cat\tmèo\tnoun\t/kæt/\tExample', [card], () => 'new', 100);
    assert.equal(plan.updateItems[0].reps, 9); assert.equal(plan.updateItems[0].stability, 50);
    assert.equal(card.pronunciation, undefined); assert.deepEqual(card.tags, []);
});
test('parameter validation rejects destructive values throughout all 34 weights', () => {
    assert.equal(validFsrs7Params(DEFAULT_FSRS7_PARAMS), true);
    for (const [index, bad] of [[8,-1],[25,0],[26,1],[27,-1],[33,Infinity]]) {
        const weights = [...DEFAULT_FSRS7_PARAMS]; weights[index] = bad;
        assert.equal(parseAndValidateFsrs7Params(JSON.stringify(weights)).valid, false);
    }
});
test('first reviews are logged, and simulated schedules are deterministic', () => {
    const card = { id: 'a', english: 'cat', srsStatus: 'New' };
    const result = calculateNextSrsState(card, 4, 'en-vi', 0, null, true, { now: 100000 });
    assert.equal(result.log.t, 0); assert.equal(result.log.rating, 4);
    assert.deepEqual(result, calculateNextSrsState(card, 4, 'en-vi', 0, null, true, { now: 100000 }));
    assert.throws(() => calculateNextSrsState(card, 9), RangeError);
});
test('training replay uses timestamps, typing flags, deleted IDs and actual scheduler state', () => {
    const logs = { dict: ['a'], logs: [[0,3,0,1700000000000,0,'first'],[0,3,1,1700086400000,1,'second'],[0,1,1,1700172800000,0,'undone']], deletedIds: ['undone'] };
    const data = prepareTrainingData(logs, [{ id: 'a', english: 'cat', type: 'idiom' }]);
    assert.equal(data.count, 2); assert.equal(data.cards[0].type, 'idiom'); assert.equal(data.cards[0].reviews[1].modality, 'typing');
    const result = evaluateParameters({ ...data, split: Infinity }, DEFAULT_FSRS7_PARAMS);
    assert.equal(result.count, 1); assert.ok(Number.isFinite(result.loss));
    const insufficient = optimizeParameters(logs);
    assert.equal(insufficient.improved, false); assert.equal(insufficient.reason, 'insufficient-data');
});
test('a new default reset wins over older personalized settings in both merge orders', () => {
    const reset = { userFsrs7Params: null, trainedAt: 200 };
    const old = { userFsrs7Params: DEFAULT_FSRS7_PARAMS, trainedAt: 100 };
    assert.equal(mergeLearningSettings(old, reset).userFsrs7Params, null);
    assert.equal(mergeLearningSettings(reset, old).userFsrs7Params, null);
});

test('new revisions and Undo advance even when the previous device clock was ahead', () => {
    const previous = { srsUpdatedAt: 5000, flagsUpdatedAt: 6000, updatedAt: 6000 };
    assert.equal(nextRevision(previous, 'flagsUpdatedAt', 100), 6001);
    assert.equal(restoreCardReview(previous, { reps: 1 }, 100).srsUpdatedAt, 5001);
});

test('legacy boolean strings and invalid memory fields are normalized safely', () => {
    const result = normalizeCard({ isStarred: 'false', isDeleted: 'false', tags: 'Work, Work, Study', reps: -1, difficulty: Infinity, srsStatus: 'invalid' });
    assert.equal(result.isStarred, false); assert.equal(result.isDeleted, false);
    assert.deepEqual(result.tags, ['Work', 'Study']); assert.equal(result.reps, 0);
    assert.equal(result.difficulty, undefined); assert.equal(result.srsStatus, 'New');
});

test('the full optimizer evaluates a separate chronological holdout and gates replacement', () => {
    const logs = [];
    for (let review = 0; review < 8; review++) for (let id = 0; id < 60; id++) {
        logs.push({ id: `${id}-${review}`, cardId: String(id), rating: review && (id + review) % 5 === 0 ? 1 : 3,
            t: review ? 1 : 0, ts: 1700000000000 + review * 86400000 + id * 1000 });
    }
    const result = optimizeParameters(logs, [], DEFAULT_FSRS7_PARAMS, { iterations: 4, budgetMs: 3000 });
    assert.ok(result.trainCount >= 100); assert.ok(result.validationCount >= 30);
    assert.ok(Number.isFinite(result.oldLoss)); assert.ok(Number.isFinite(result.newLoss));
    assert.equal(validFsrs7Params(result.params), true);
    if (result.improved) assert.ok(result.newLoss < result.oldLoss * .995);
    else assert.deepEqual(result.params, DEFAULT_FSRS7_PARAMS);
});
