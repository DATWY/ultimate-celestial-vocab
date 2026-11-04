import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { calculateNextSrsState } from '../../src/core/srs/index.js';
import { snapshotNumericStats, diffNumericStats, revertNumericStats } from '../../src/core/card-merge.js';
import { trackReview, trackHourBonus, trackXP } from '../../src/features/stat-trackers.js';
import { isCardReviewable, classifyReview, canSpendBudget } from '../../src/core/review-policy.js';
import { computeDailyNewLimit } from '../../src/core/queue.js';
import { getLocalDateString } from '../../src/core/utils/date.js';
import { prepareTrainingData, evaluateParameters, finiteDifferenceGradient, projectFsrs7Params } from '../../src/core/srs/training.js';
import { DEFAULT_FSRS7_PARAMS, FSRS7_PARAM_BOUNDS, validFsrs7Params } from '../../src/core/srs/constants.js';

const read = path => fs.readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const results = [];
const now = Date.now(), day = 86400000;

// Run the actual feedback handler, then the actual Undo progress handler with storage/UI stubs.
{
  const g = { userXP: 0, totalReviews: 0, consecutiveCorrect: 0, activityHeatmap: {}, stats: { easyPresses: 0, hardPresses: 0 } };
  const d = { lastDate: getLocalDateString(now), todayTotal: 0, todayCorrect: 0, newCardsDoneToday: 0 };
  const state = { vocabulary: [{ id: 'undo', english: 'apple', srsStatus: 'New', reps: 0 }], currentCardIndex: 0, gamification: g, dailyStats: d };
  let snapshot;
  const no = () => {};
  const context = vm.createContext({
    getState: () => state, setIsTransitioning: no, calculateNextSrsState, crypto,
    shouldCardUseTyping: () => false, addReviewLog: no, classifyReview,
    incrementReviewBudget: () => d.newCardsDoneToday++,
    trackEvent: key => { g.stats[key] = (g.stats[key] || 0) + 1; },
    getComboMultiplier: () => 1,
    addXP: n => { g.userXP += n; trackXP(g.stats, n); },
    recordReviewResult: yes => { g.totalReviews++; d.todayTotal++; if (yes) d.todayCorrect++; },
    logActivity: () => { g.activityHeatmap[d.lastDate] = 1; },
    snapshotNumericStats, diffNumericStats, trackHourBonus, trackReview,
    updateStats: no, saveOneWord: no, playSound: no, showToast: no,
    insertCardForLearningStep: no, setLastReviewSnapshot: s => { snapshot = s; },
    updateUndoButtonState: no, document: { activeElement: null, getElementById: () => null },
    console, _gamification: g, _dailyStats: d, getLocalDateString,
    syncStreakFromHeatmap: no, ensureDailyStats: no,
    revertReviewBudget: () => d.newCardsDoneToday--,
    revertNumericStats, saveGamification: no, saveDailyStats: no, CustomEvent: class {},
  });
  const source = read('src/events.js');
  vm.runInContext(source.slice(source.indexOf('function processSrsFeedback('), source.indexOf('\nasync function switchCardWithAnimation')), context);
  context.processSrsFeedback(4, false);
  assert.ok(snapshot);
  context.savedSnapshot = snapshot;
  const store = read('src/core/state.js');
  vm.runInContext(store.slice(store.indexOf('export async function revertGamificationAfterUndo('), store.indexOf('\nexport async function setUserSrsParams')).replace('export ', ''), context);
  await vm.runInContext('revertGamificationAfterUndo(savedSnapshot)', context);
  assert.equal(g.userXP, 0);
  assert.equal(g.stats.easyPresses, 1);
  assert.equal(g.stats.xpToday, 5);
  results.push({ issue: 'Undo snapshot is taken after rating and XP stats', afterUndo: { userXP: g.userXP, easyPresses: g.stats.easyPresses, xpToday: g.stats.xpToday, xpWeekTotal: g.stats.xpWeekTotal } });
}

// Quiz has remaining total budget but the independent NEW budget has already run out.
{
  const dailyStats = { lastDate: getLocalDateString(now), currentLimit: 15, limitAdjustedDate: getLocalDateString(now), newCardsDoneToday: 15, dueDoneToday: 0 };
  const vocabulary = [{ id: 'quiz-cap', english: 'apple', srsStatus: 'New' }];
  let saves = 0;
  const context = vm.createContext({ getState: () => ({ vocabulary, dailyStats }), isCardReviewable, classifyReview, canSpendBudget,
    getReviewBudget: () => ({ limit: 200, used: 15, remaining: 185 }), showToast() {},
    incrementReviewBudget: () => dailyStats.newCardsDoneToday++, calculateNextSrsState,
    saveOneWord: () => saves++, addReviewLog() {} });
  const source = read('src/features/quiz.js');
  vm.runInContext(source.slice(source.indexOf('let quizBudgetNoticeShown'), source.indexOf('\nfunction skipQuizQuestion')), context);
  const limit = computeDailyNewLimit(dailyStats);
  vm.runInContext('applyQuizReview(getState().vocabulary[0], 3)', context);
  assert.equal(limit, 15); assert.equal(saves, 1); assert.equal(dailyStats.newCardsDoneToday, 16);
  results.push({ issue: 'Quiz ignores independent new-card cap', limit, newCardsDoneToday: dailyStats.newCardsDoneToday, saves });
}

// Dedicated typing pool + actual queue pop still admit suspended cards.
{
  let queue = [];
  const vocabulary = [{ id: 'suspended', english: 'apple', srsStatus: 'New', isSuspended: true }];
  const state = { vocabulary, typingFilter: 'all', currentReviewQueue: queue };
  let listener, displayed;
  const context = vm.createContext({ DOM: { startDedicatedTypingBtn: { addEventListener: (_, fn) => { listener = fn; } } },
    getState: () => state, toggleTypingMenu() {}, isCardLeech: () => false, showPopup() {},
    setTypingFilter() {}, setReviewQueue: q => { state.currentReviewQueue = q; }, updateCustomTypingUI() {},
    playSound() {}, showToast() {}, displayCard: i => { displayed = i; }, buildReviewQueue() {} });
  const q = read('src/core/queue.js');
  vm.runInContext(q.slice(q.indexOf('export function getNextCardToReview('), q.indexOf('\nexport function insertCardForLearningStep')).replace('export ', ''), context);
  const e = read('src/events.js');
  vm.runInContext(e.slice(e.indexOf("    DOM.startDedicatedTypingBtn?.addEventListener"), e.indexOf("    DOM.toggleBoostModeBtn?.addEventListener")), context);
  listener(); assert.equal(displayed, 0); assert.equal(isCardReviewable(vocabulary[displayed]), false);
  results.push({ issue: 'Dedicated typing opens suspended card', displayed, isSuspended: vocabulary[displayed].isSuspended });
}

// New ordering constraints intersect numerical finite-difference directions.
{
  const logs = [];
  for (let r = 0; r < 8; r++) for (let i = 0; i < 60; i++) logs.push({ id: `${i}-${r}`, cardId: `${i}`, rating: r && (i+r)%5===0 ? 1 : 3, t: r ? 1 : 0, ts: now-(8-r)*day+i*1000 });
  const data = prepareTrainingData(logs), weights = [...DEFAULT_FSRS7_PARAMS];
  weights[0] = weights[1] = weights[2] = weights[3] = 4;
  assert.equal(validFsrs7Params(weights), true);
  const current = evaluateParameters(data, weights).loss;
  const [lo, hi] = FSRS7_PARAM_BOUNDS[0], x = (4-lo)/(hi-lo);
  const gradient = finiteDifferenceGradient(x, .001, current, north => {
    const w = [...weights]; w[0] = lo+north*(hi-lo);
    return validFsrs7Params(w) ? evaluateParameters(data, w).loss : Infinity;
  });
  const step = .03*gradient/(Math.sqrt(gradient*gradient)+1e-8);
  const bad = [...weights]; bad[0] = NaN;
  assert.equal(gradient, Infinity); assert.equal(Number.isNaN(step), true);
  const projected = projectFsrs7Params(bad);
  assert.equal(projected[0], lo);
  results.push({ issue: 'Finite differences cross ordering constraint and contaminate Adam', gradient: String(gradient), step: String(step), silentlyProjectedW0: projected[0] });
}

// t=0 is elapsed time, not a unique first-review marker.
{
  const fresh = { id: 'cut', english: 'apple', srsStatus: 'New', reps: 0 };
  const first = calculateNextSrsState(fresh, 1, 'en-vi', 0, null, true, { now });
  const second = calculateNextSrsState(first.newState, 3, 'en-vi', 0, null, true, { now });
  const third = calculateNextSrsState(second.newState, 3, 'en-vi', 0, null, true, { now: now+60000 });
  const data = prepareTrainingData([second.log, third.log]);
  assert.equal(first.newState.reps, 1); assert.equal(second.log.t, 0);
  assert.equal(data.historyComplete, true); assert.equal(data.cards.length, 1);
  results.push({ issue: 'Truncated chain with zero elapsed accepted as complete', firstReviewRemoved: true, retainedFirstElapsed: second.log.t, historyComplete: data.historyComplete });
}
console.log(JSON.stringify({ confirmed: results.length, results }, null, 2));
