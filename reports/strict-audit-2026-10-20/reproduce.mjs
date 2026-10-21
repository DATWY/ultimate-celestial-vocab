// Historical probes for the pre-fix audit. Run `npm test` against the repaired version.
// No browser profile, IndexedDB, Firebase, or production writes.
// A PASS means the described defect was reproduced, not that the app is correct.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { calculateNextSrsState } from '../../src/core/srs/index.js';

const read = p => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
function fn(file, name) {
  const src = read(file);
  const re = new RegExp('(?:export )?(?:async )?function ' + name + '\\(');
  const start = src.search(re);
  assert.ok(start >= 0, name + ' exists');
  const end = src.indexOf('\n}', start);
  assert.ok(end > start, name + ' ends');
  return src.slice(start, end + 2).replace(/^export /, '');
}
const quiet = { log() {}, warn() {}, error() {} };
function scope(code, deps = {}) {
  const ctx = vm.createContext({ console: quiet, ...deps });
  vm.runInContext(code, ctx);
  return ctx;
}
const evidence = [];
async function probe(name, body) {
  const detail = await body();
  evidence.push({ name, reproduced: true, detail });
  console.log('REPRODUCED: ' + name + ' | ' + JSON.stringify(detail));
}

await probe('Daily limit changes repeatedly with unchanged retention history', () => {
  const c = scope(fn('src/core/queue.js', 'computeDailyNewLimit'), {
    MAX_NEW_PER_DAY_INITIAL: 15, MAX_ABSOLUTE_NEW: 40,
  });
  const stats = { currentLimit: 15, retentionHistory: [{ correct: 9, total: 10 }] };
  const limits = [];
  for (let i = 0; i < 5; i++) {
    stats.currentLimit = c.computeDailyNewLimit(stats); // same assignment as buildReviewQueue
    limits.push(stats.currentLimit);
  }
  assert.deepEqual(limits, [20, 25, 30, 35, 40]);
  return limits;
});

function mergeScope() {
  return scope(fn('src/core/firebase.js', 'mergeCardFields') + '\n' + fn('src/core/firebase.js', 'isSrsEqual'), {
    toMillis: n => Number(n) || 0, getCalibratedNow: () => 300, getDeviceId: () => 'test',
  });
}
await probe('Cloud merge loses pronunciation and comparison ignores it', () => {
  const c = mergeScope();
  const a = { id: 'a', english: 'cat', vietnamese: 'meo', pronunciation: '/kat/', updatedAt: 100 };
  const b = { ...a, pronunciation: '/kæt/', updatedAt: 200 };
  const equal = c.isSrsEqual(a, b);
  const result = c.mergeCardFields(a, b);
  assert.equal(equal, true);
  assert.equal(result.pronunciation, undefined);
  return { comparisonSaysEqual: equal, mergedHasPronunciation: 'pronunciation' in result };
});

await probe('Cloud merge resurrects removed tags and intentionally cleared examples', () => {
  const c = mergeScope();
  const a = { id: 'a', english: 'cat', vietnamese: 'meo', tags: ['old'], example: 'old example', updatedAt: 100 };
  const b = { ...a, tags: [], example: '', updatedAt: 200 };
  const result = c.mergeCardFields(a, b);
  assert.equal(result.tags[0], 'old');
  assert.equal(result.example, 'old example');
  return { tags: result.tags, example: result.example };
});

await probe('Later review on a stale copy overwrites a content correction', () => {
  const c = mergeScope();
  const base = { id: 'a', english: 'cat', vietnamese: 'old meaning', lastReviewDate: 1, updatedAt: 1 };
  const edited = { ...base, vietnamese: 'corrected meaning', updatedAt: 100 };
  const reviewedElsewhere = { ...base, lastReviewDate: 200, updatedAt: 200 };
  const result = c.mergeCardFields(edited, reviewedElsewhere);
  assert.equal(result.vietnamese, 'old meaning');
  return { editedAt: 100, reviewedAt: 200, resultingMeaning: result.vietnamese };
});

await probe('Converting a future due date corrupts server clock calibration', () => {
  const now = 1000000000;
  class FixedDate extends Date { static now() { return now; } }
  const c = scope('let _serverTimeOffset = 0;\n' + ['updateServerTimeOffset', 'getCalibratedNow', 'toMillis'].map(n => fn('src/core/firebase.js', n)).join('\n'), { Date: FixedDate });
  const due = now + 30 * 86400000;
  c.toMillis(due);
  const offsetDays = (c.getCalibratedNow() - now) / 86400000;
  assert.equal(offsetDays, 30);
  return { clockShiftDays: offsetDays };
});

await probe('Card edit during a pending flush is removed from the dirty queue', async () => {
  let card = { id: 'a', english: 'old', updatedAt: 1 };
  let release;
  let started;
  const entered = new Promise(r => { started = r; });
  const committed = new Promise(r => { release = r; });
  const writes = [];
  const code = `let _syncQueue = new Set(['a']); let _syncTimer = null; let _isFlushing = false; let _dirtyCount = 1;\n`
    + fn('src/core/sync.js', 'flushSyncQueue').replace("await import('./state.js')", 'stateModule')
    + '\nfunction dirtyAgain() { _syncQueue.add("a"); _dirtyCount++; }\nfunction queueSize() { return _syncQueue.size; }';
  const c = scope(code, {
    sessionStorage: { getItem: () => null }, stateModule: { getVocabById: () => card },
    db: {}, VOCAB_COLLECTION: 'mock', doc: () => ({}),
    getCalibratedNow: () => 1, getDeviceId: () => 'test',
    setTimeout: () => 1, clearTimeout() {},
    writeBatch: () => ({ set: (_, data) => writes.push(data), commit: () => { started(); return committed; } }),
  });
  const pending = c.flushSyncQueue();
  await entered;
  card = { id: 'a', english: 'new', updatedAt: 2 };
  c.dirtyAgain();
  release();
  await pending;
  assert.equal(c.queueSize(), 0);
  assert.equal(writes[0].english, 'old');
  return { sent: writes[0].english, current: card.english, pendingQueueSize: c.queueSize() };
});

await probe('Flush overwrites newer remote SRS before any field merge runs', async () => {
  const local = { id: 'a', english: 'cat', vietnamese: 'edited locally', lastReviewDate: 100, stability: 2, updatedAt: 300 };
  let remote = { id: 'a', english: 'cat', vietnamese: 'old meaning', lastReviewDate: 200, stability: 20, updatedAt: 200 };
  const previousRemoteStability = remote.stability;
  const c = scope(`let _syncQueue = new Set(['a']); let _syncTimer = null; let _isFlushing = false; let _dirtyCount = 1;\n`
    + fn('src/core/sync.js', 'flushSyncQueue').replace("await import('./state.js')", 'stateModule'), {
    sessionStorage: { getItem: () => null }, stateModule: { getVocabById: () => local },
    db: {}, VOCAB_COLLECTION: 'mock', doc: () => ({}),
    getCalibratedNow: () => 300, getDeviceId: () => 'test',
    setTimeout: () => 1, clearTimeout() {},
    writeBatch: () => ({ set: (_, data) => { remote = { ...remote, ...data }; }, commit: async () => {} }),
  });
  await c.flushSyncQueue();
  assert.equal(remote.stability, 2);
  assert.equal(remote.lastReviewDate, 100);
  return { remoteStabilityBefore: previousRemoteStability, remoteStabilityAfter: remote.stability, remoteReviewDateAfter: remote.lastReviewDate };
});

function quizScope(word = { id: 'a', english: 'cat', vietnamese: 'meo' }) {
  const timers = [];
  const DOM = { quizAnswerInput: { value: '', disabled: false }, quizFeedback: {} };
  const c = scope(`let quizInProgress = true, quizIsReviewing = false, quizIncorrect = 0;
    let currentQuizQuestionIndex = 0, quizQuestions = [word], quizIncorrectWordsInfo = [];
    ${fn('src/features/quiz.js', 'skipQuizQuestion')}
    ${fn('src/features/quiz.js', 'goToNextQuizQuestion')}
    function inspect() { return { incorrect: quizIncorrect, index: currentQuizQuestionIndex }; }
    function newSession() { currentQuizQuestionIndex = 0; quizQuestions = [word, word]; quizInProgress = true; }`, {
    word, DOM, getState: () => ({ vocabulary: [] }), updateQuizProgress() {},
    setTimeout: cb => { timers.push(cb); }, displayQuizQuestion() {},
  });
  return { c, timers, DOM };
}
await probe('Repeated Skip counts one quiz question multiple times', () => {
  const { c, timers } = quizScope();
  c.skipQuizQuestion(); c.skipQuizQuestion(); c.skipQuizQuestion();
  const result = c.inspect();
  assert.equal(result.incorrect, 3);
  assert.equal(result.index, 0);
  assert.equal(timers.length, 3);
  return { ...result, pendingAdvanceTimers: timers.length };
});

await probe('A previous quiz advance timer skips a question in a new session', () => {
  const { c, timers } = quizScope();
  c.skipQuizQuestion();
  c.newSession();
  timers[0]();
  assert.equal(c.inspect().index, 1);
  return { newSessionIndexAfterOldTimer: c.inspect().index };
});

await probe('Quiz feedback renders imported English as raw HTML', () => {
  const markup = '<b data-audit="inert">cat</b>';
  const { c, DOM } = quizScope({ id: 'a', english: markup });
  c.skipQuizQuestion();
  assert.ok(DOM.quizFeedback.innerHTML.includes(markup));
  return { htmlSink: DOM.quizFeedback.innerHTML, payload: 'inert markup; no script executed' };
});

await probe('Undo after a first New review can pop an unrelated historical log', async () => {
  const { log } = calculateNextSrsState({ id: 'new-card', english: 'cat', srsStatus: 'New', reps: 0 }, 3, 'en-vi', 0, null, true);
  assert.equal(log, null);
  const c = scope(`let _reviewLogs = {dict:['older-card'],logs:[[0,3,1,1000,0]]};\n`
    + fn('src/core/state.js', 'popLastReviewLog')
    + '\nfunction countLogs() { return _reviewLogs.logs.length; }', { saveSettingToDB: async () => {} });
  await c.popLastReviewLog(); // undoLastReview calls this unconditionally
  assert.equal(c.countLogs(), 0);
  return { newReviewCreatedLog: false, unrelatedHistoricalLogsRemaining: c.countLogs() };
});

await probe('Midnight rollover retains yesterday due and learning counts', () => {
  const code = fn('src/core/state.js', 'recordReviewResult').replace("import('./sync.js')", 'Promise.resolve({})');
  const stats = { lastDate: '2026-10-19', newCardsDoneToday: 5, dueDoneToday: 8, learningDoneToday: 3, todayCorrect: 5, todayTotal: 7 };
  const c = scope(code, { _dailyStats: stats, _gamification: {},
    getLocalDateString: () => '2026-10-20', checkAndUpdateStreak() {},
    saveSettingToDB: () => Promise.resolve(), saveGamification() {}, showToast() {},
  });
  c.recordReviewResult(false);
  assert.equal(stats.lastDate, '2026-10-20');
  assert.equal(stats.dueDoneToday, 8);
  assert.equal(stats.learningDoneToday, 3);
  return { date: stats.lastDate, staleDue: stats.dueDoneToday, staleLearning: stats.learningDoneToday };
});

fs.writeFileSync(new URL('./evidence.json', import.meta.url), JSON.stringify({
  scope: 'Functions extracted unchanged except explicit dependency mocks; no live cloud or browser test.',
  probes: evidence,
}, null, 2) + '\n');
console.log(`\n${evidence.length} defects reproduced. This is an audit harness, not a passing regression suite.`);
