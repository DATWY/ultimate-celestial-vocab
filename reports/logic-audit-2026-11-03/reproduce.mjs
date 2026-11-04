import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { exportVocabularyTsv, parseVocabularyTsv } from '../../src/core/tabular.js';
import { restoreCardReview, mergeCardFields } from '../../src/core/card-merge.js';
import { calculateNextSrsState } from '../../src/core/srs/index.js';
import { DEFAULT_FSRS7_PARAMS, validFsrs7Params } from '../../src/core/srs/constants.js';
import { mergeDuplicateCards } from '../../src/core/dedup.js';
import { prepareTrainingData, evaluateParameters } from '../../src/core/srs/training.js';

const now = new Date(2026, 10, 3, 12).getTime();
const day = 86400000;
const base = { id: 'a', english: 'apple', vietnamese: 'táo', type: 'noun',
  srsStatus: 'Mastered', stability: 20, stabilityShort: 16, difficulty: 5,
  reps: 10, lapses: 9, srsInterval: 10, srsDueDate: now, lastReviewDate: now-day,
  updatedAt: now-100, contentUpdatedAt: now-100, srsUpdatedAt: now-100,
  flagsUpdatedAt: now-100, tags: [] };
const results = [];
function check(name, fn) { results.push({ name, evidence: fn() }); }

check('TSV drops suspension', () => {
  const card = parseVocabularyTsv(exportVocabularyTsv([{ ...base, isSuspended: true }])).rows[0].card;
  assert.equal(card.isSuspended, false);
  return { before: true, after: card.isSuspended };
});
check('Undo retains leech counters from undone review', () => {
  const previous = { ...base, lapseDay: new Date(now).toDateString(), lapsesToday: 1, needsReformulation: false };
  const reviewed = calculateNextSrsState(previous, 1, 'en-vi', 0, null, true, { now }).newState;
  const restored = restoreCardReview(reviewed, previous, now+1);
  assert.equal(restored.lapsesToday, 2);
  assert.equal(restored.needsReformulation, true);
  return { expectedLapsesToday: 1, actualLapsesToday: restored.lapsesToday, needsReformulation: restored.needsReformulation };
});
check('Newer editorial edit replaces leech counters from newer SRS', () => {
  const memory = { ...base, srsUpdatedAt: now+100, updatedAt: now+100, lapsesToday: 2, needsReformulation: true };
  const edit = { ...base, contentUpdatedAt: now+200, updatedAt: now+200, lapsesToday: 0, needsReformulation: false };
  const merged = mergeCardFields(memory, edit);
  assert.equal(merged.srsUpdatedAt, memory.srsUpdatedAt);
  assert.equal(merged.lapsesToday, 0);
  return { srsClockRetained: true, expectedLapsesToday: 2, actualLapsesToday: merged.lapsesToday };
});
check('Dedup memory changes can lose against existing IDB record', () => {
  const a = { ...base, isLeech: true };
  const b = { ...base, id: 'b', stability: 10, lapses: 1, isLeech: false };
  const { mergedCard } = mergeDuplicateCards(a, b);
  const saved = mergeCardFields(mergedCard, a);
  assert.equal(mergedCard.lapses, 10);
  assert.equal(saved.lapses, 9);
  return { proposedLapses: mergedCard.lapses, savedLapses: saved.lapses, sameSrsClock: mergedCard.srsUpdatedAt === a.srsUpdatedAt };
});
check('Parameter validation accepts inverted initial stability', () => {
  const weights = [...DEFAULT_FSRS7_PARAMS]; weights[0] = 100; weights[3] = 0.01;
  assert.equal(validFsrs7Params(weights), true);
  return { accepted: true, againInitialStability: weights[0], easyInitialStability: weights[3] };
});
check('Burial jitter is identical for unrelated cards', () => {
  const input = { ...base, lapseDay: new Date(now).toDateString(), lapsesToday: 1 };
  const a = calculateNextSrsState(input, 1, 'en-vi', 0, null, true, { now }).newState;
  const b = calculateNextSrsState({ ...input, id: 'b' }, 1, 'en-vi', 0, null, true, { now }).newState;
  assert.equal(a.srsDueDate, b.srsDueDate);
  return { equalDueDates: true, releaseHour: new Date(a.srsDueDate).getHours() };
});
check('Training replay ignores elapsed time before retained history', () => {
  const logs = [0, 1, 2, 3, 4].map((i) => ({ id: String(i), cardId: 'a', rating: 3, t: i ? 1 : 100, ts: now+i*day }));
  const a = evaluateParameters(prepareTrainingData(logs, [base]), DEFAULT_FSRS7_PARAMS);
  const b = evaluateParameters(prepareTrainingData(logs.map(x => ({ ...x, t: 0 })), [base]), DEFAULT_FSRS7_PARAMS);
  assert.equal(a.loss, b.loss);
  return { sameLossDespiteDifferentHistoricalElapsed: true, loss: a.loss };
});
check('Flashcard Again then Good never counts a newly introduced card', () => {
  const events = fs.readFileSync(new URL('../../src/events.js', import.meta.url), 'utf8');
  assert.match(events, /if \(isNewCard && rating > 1\)/);
  const fresh = { id: 'new', english: 'apple', srsStatus: 'New', reps: 0 };
  const first = calculateNextSrsState(fresh, 1, 'en-vi', 0, null, true, { now }).newState;
  assert.equal(first.srsStatus, 'Learning');
  const countedFirst = fresh.srsStatus === 'New' && 1 > 1;
  const countedSecond = first.srsStatus === 'New' && 3 > 1;
  assert.equal(countedFirst || countedSecond, false);
  return { statusAfterAgain: first.srsStatus, countedFirst, countedSecond, method: 'live engine + source guard' };
});
check('Quiz applies SRS to a suspended card and ignores daily caps', () => {
  const source = fs.readFileSync(new URL('../../src/features/quiz.js', import.meta.url), 'utf8');
  const start = source.indexOf('function applyQuizReview('), end = source.indexOf('\nfunction skipQuizQuestion', start);
  let newCount = 0, saves = 0;
  const vocabulary = [{ ...base, srsStatus: 'New', isSuspended: true }];
  const context = vm.createContext({ getState: () => ({ vocabulary }), incrementNewCardsDone: () => newCount++,
    incrementLearningCardsDone() {}, incrementDueCardsDone() {}, calculateNextSrsState,
    saveOneWord() { saves++; }, addReviewLog() {} });
  vm.runInContext(source.slice(start, end) + '\napplyQuizReview(getState().vocabulary[0], 3);', context);
  assert.equal(newCount, 1); assert.equal(saves, 1); assert.equal(vocabulary[0].srsStatus, 'Learning');
  return { suspendedCardReviewed: true, newCount, method: 'actual extracted applyQuizReview with persistence stubs' };
});
console.log(JSON.stringify({ date: '2026-11-03', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, confirmed: results.length, results }, null, 2));
