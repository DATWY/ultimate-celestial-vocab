import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { mergeCardFields, normalizeCard, toMillis, isSrsEqual, restoreCardReview } from '../src/core/card-merge.js';
import { rolloverDailyStats } from '../src/core/daily-stats.js';
import { calculateNextSrsState } from '../src/core/srs/index.js';
import { escapeHTML } from '../src/core/utils/sanitize.js';
import { compressLogs as compressReviewLogs, mergeReviewLogs as mergeLogSnapshots } from '../src/core/review-log-merge.js';
import { superNormalize, stripVietnameseDiacritics } from '../src/features/typing.js';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const quiet = { log() {}, warn() {}, error() {} };
function fn(path, name) {
    const source = read(path);
    const start = source.search(new RegExp('(?:export )?(?:async )?function ' + name + '\\('));
    assert.ok(start >= 0, `${name} exists`);
    return source.slice(start, source.indexOf('\n}', start) + 2).replace(/^export /, '');
}
function context(source, deps = {}) {
    const ctx = vm.createContext({ console: quiet, ...deps });
    vm.runInContext(source, ctx);
    return ctx;
}
const base = () => ({ id: 'a', english: 'cat', vietnamese: 'mèo', pronunciation: '/kæt/',
    tags: ['Animals'], example: 'A cat.', srsStatus: 'Mastered', reps: 4,
    stability: 5, lastReviewDate: 100, updatedAt: 100, contentUpdatedAt: 50,
    srsUpdatedAt: 100, flagsUpdatedAt: 50, isStarred: false });

test('timestamp conversion is pure, including future due dates', () => {
    const now = Date.now();
    assert.equal(toMillis(now + 30 * 86400000), now + 30 * 86400000);
    assert.equal(toMillis({ seconds: 10, nanoseconds: 500000000 }), 10500);
    assert.equal(toMillis(Infinity), 0);
});
test('a content edit and a remote review both survive merge', () => {
    const edited = { ...base(), vietnamese: 'nghĩa đã sửa', contentUpdatedAt: 200, updatedAt: 200 };
    const reviewed = { ...base(), stability: 20, lastReviewDate: 300, srsUpdatedAt: 300, updatedAt: 300 };
    const result = mergeCardFields(edited, reviewed);
    assert.equal(result.vietnamese, 'nghĩa đã sửa');
    assert.equal(result.stability, 20);
    assert.equal(result.lastReviewDate, 300);
});
test('pronunciation edits are compared and preserved; legacy phonetic is migrated', () => {
    const edited = { ...base(), pronunciation: '/new/', contentUpdatedAt: 200, updatedAt: 200 };
    assert.equal(isSrsEqual(base(), edited), false);
    assert.equal(mergeCardFields(base(), edited).pronunciation, '/new/');
    assert.equal(normalizeCard({ id: 'b', phonetic: '/legacy/' }).pronunciation, '/legacy/');
});
test('clearing a field and removing tags persist across repeated sync', () => {
    const edited = { ...base(), example: '', tags: [], contentUpdatedAt: 200, updatedAt: 200 };
    const merged = mergeCardFields(base(), edited);
    assert.equal(merged.example, '');
    assert.deepEqual(merged.tags, []);
    assert.deepEqual(mergeCardFields(merged, base()), merged);
});
test('merge converges, is idempotent, and does not invent timestamps', () => {
    const a = { ...base(), example: 'A', updatedAt: 300, contentUpdatedAt: 200 };
    const b = { ...base(), example: 'B', updatedAt: 300, contentUpdatedAt: 200 };
    const result = mergeCardFields(a, b);
    assert.deepEqual(result, mergeCardFields(b, a));
    assert.deepEqual(result, mergeCardFields(result, result));
    assert.equal(result.updatedAt, 300);
});
test('a later review cannot resurrect a deleted ID', () => {
    const deleted = { ...base(), isDeleted: true, updatedAt: 200 };
    assert.equal(mergeCardFields(deleted, { ...base(), updatedAt: 400, srsUpdatedAt: 400 }).isDeleted, true);
});
test('Undo restores only review state and publishes a new SRS revision', () => {
    const current = { ...base(), vietnamese: 'new meaning', contentUpdatedAt: 400, stability: 20 };
    const restored = restoreCardReview(current, base(), 500);
    assert.equal(restored.vietnamese, 'new meaning');
    assert.equal(restored.stability, 5);
    assert.equal(mergeCardFields(restored, current).stability, 5);
});
test('SRS reviews preserve editorial revision, including an explicit zero', () => {
    const card = { ...base(), contentUpdatedAt: 0 };
    const result = calculateNextSrsState(card, 3, 'en-vi', 0, null, true).newState;
    assert.equal(normalizeCard(result).contentUpdatedAt, 0);
    assert.ok(result.srsUpdatedAt >= card.srsUpdatedAt);
});

test('daily limit changes at most once per day in either direction', () => {
    const c = context(fn('src/core/queue.js', 'computeDailyNewLimit'), {
        MAX_NEW_PER_DAY_INITIAL: 15, MAX_ABSOLUTE_NEW: 40, getLocalDateString: () => '2026-10-20',
    });
    for (const [correct, expected] of [[9, 20], [6, 10]]) {
        const stats = { currentLimit: 15, retentionHistory: [{ correct, total: 10 }] };
        for (let i = 0; i < 10; i++) {
            stats.currentLimit = c.computeDailyNewLimit(stats);
            stats.limitAdjustedDate = '2026-10-20';
            assert.equal(stats.currentLimit, expected);
        }
    }
});
test('midnight resets all counters exactly once and preserves retention history', () => {
    const stats = { lastDate: '2026-10-19', newCardsDoneToday: 2, dueDoneToday: 8,
        learningDoneToday: 3, todayCorrect: 5, todayTotal: 7 };
    rolloverDailyStats(stats, '2026-10-20');
    for (const key of ['newCardsDoneToday', 'dueDoneToday', 'learningDoneToday', 'todayCorrect', 'todayTotal']) assert.equal(stats[key], 0);
    stats.newCardsDoneToday++;
    rolloverDailyStats(stats, '2026-10-20');
    assert.equal(stats.newCardsDoneToday, 1);
    assert.equal(stats.retentionHistory.length, 1);
});

function quizHarness(words = [{ id: 'a', english: 'cat', vietnamese: 'mèo', srsStatus: 'New' }]) {
    const timers = new Map();
    let timerId = 0;
    const nodes = new Map();
    const node = name => {
        if (!nodes.has(name)) nodes.set(name, { value: '', textContent: '', innerHTML: '', disabled: false,
            classList: { add() {}, remove() {} }, focus() {}, addEventListener() {}, querySelectorAll: () => [], style: {} });
        return nodes.get(name);
    };
    const DOM = new Proxy({}, { get: (_, name) => node(name) });
    DOM.quizNumQuestions.value = 'all'; DOM.quizTimeLimit.value = '5';
    const state = { vocabulary: words, currentTopicFilter: 'all', gamification: {} };
    const saves = [];
    const source = read('src/features/quiz.js').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
    const c = context(source + `\nfunction inspectQuiz() { return { index: currentQuizQuestionIndex, incorrect: quizIncorrect, score: quizScore }; }`, {
        DOM, getState: () => state, document: { getElementById: node },
        setTimeout: (cb, ms) => { timers.set(++timerId, { cb, ms }); return timerId; }, clearTimeout: id => timers.delete(id),
        setInterval: () => ++timerId, clearInterval() {},
        calculateNextSrsState: (card, rating) => ({ newState: { ...card, lapses: (card.lapses || 0) + 1 }, log: null }),
        saveOneWord: card => saves.push(card), recordQuizAnswer() {}, addXP() {}, getComboMultiplier: () => 1,
        addReviewLog() {}, clearLastReviewSnapshot() {}, incrementNewCardsDone() {}, incrementDueCardsDone() {}, incrementLearningCardsDone() {},
        updateQuizProgress() {}, playSound() {}, showPopup() {}, showConfirmation() {},
        suspendCelestialCanvas() {}, resumeCelestialCanvas() {}, escapeHTML, superNormalize, stripVietnameseDiacritics,
        animateNumber() {}, launchVictoryConfetti() {}, trackEvent() {}, saveGamification: async () => {},
    });
    c.startQuiz();
    return { c, DOM, saves, timers, state, advance: () => [...timers.values()].find(timer => timer.ms === 1200)?.cb };
}
test('rapid Skip grades and penalizes exactly once', () => {
    const h = quizHarness();
    h.c.skipQuizQuestion(); h.c.skipQuizQuestion(); h.c.skipQuizQuestion();
    assert.equal(h.c.inspectQuiz().incorrect, 1);
    assert.equal(h.saves.length, 1);
    assert.equal([...h.timers.values()].filter(t => t.ms === 1200).length, 1);
    assert.equal(h.DOM.skipQuizBtn.disabled, true);
});
test('old callbacks cannot advance a restarted quiz', () => {
    const h = quizHarness();
    h.c.skipQuizQuestion();
    const stale = h.advance();
    h.c.showQuizSetup(); h.c.startQuiz();
    stale();
    assert.equal(h.c.inspectQuiz().index, 0);
    assert.equal(h.c.inspectQuiz().incorrect, 0);
});
test('both wrong-answer and Skip feedback escape imported markup', () => {
    for (const action of ['skipQuizQuestion', 'checkQuizAnswer']) {
        const h = quizHarness([{ id: 'a', english: '<img src=x onerror=alert(1)>', srsStatus: 'New' }]);
        h.DOM.quizAnswerInput.value = 'wrong';
        h.c[action]();
        assert.ok(h.DOM.quizFeedback.innerHTML.includes('&lt;img'));
        assert.ok(!h.DOM.quizFeedback.innerHTML.includes('<img'));
    }
});
test('a blank answer is not penalized and British/American spelling is consistent', () => {
    const h = quizHarness([{ id: 'a', english: 'colour', srsStatus: 'New' }]);
    h.c.checkQuizAnswer(); assert.equal(h.c.inspectQuiz().incorrect, 0);
    h.DOM.quizAnswerInput.value = 'color';
    h.c.checkQuizAnswer(); assert.equal(h.c.inspectQuiz().score, 1);
});
test('ending a quiz early never awards a perfect quiz; finalization is idempotent', () => {
    const h = quizHarness(Array.from({ length: 10 }, (_, i) => ({ id: String(i), english: 'cat', srsStatus: 'New' })));
    h.DOM.quizAnswerInput.value = 'cat';
    h.c.checkQuizAnswer();
    h.c.finishQuiz();
    assert.equal(h.state.gamification.stats.perfectQuizStreak, 0);
    h.state.gamification.stats.perfectQuizStreak = 3;
    h.c.finishQuiz(true);
    assert.equal(h.state.gamification.stats.perfectQuizStreak, 3);
});

test('Undo decrements the appropriate daily category and does not subtract from a new day', async () => {
    const gamification = { userXP: 10, totalReviews: 2, activityHeatmap: { '2026-10-19': 1 }, stats: {} };
    const stats = { lastDate: '2026-10-19', todayTotal: 2, todayCorrect: 2, dueDoneToday: 2, learningDoneToday: 0 };
    const c = context(fn('src/core/state.js', 'revertGamificationAfterUndo'), {
        _gamification: gamification, _dailyStats: stats,
        getLocalDateString: () => '2026-10-19', syncStreakFromHeatmap() {}, ensureDailyStats() {},
        saveGamification: async () => {}, saveDailyStats: async () => {}, CustomEvent: class {},
        document: { getElementById: () => null }, updateStats() {},
    });
    await c.revertGamificationAfterUndo({ isCorrect: true, countedDue: true, timestamp: 1, previousCard: { srsStatus: 'Mastered' } });
    assert.equal(stats.dueDoneToday, 1);
    stats.lastDate = '2026-10-20'; stats.todayTotal = 3;
    await c.revertGamificationAfterUndo({ isCorrect: true, countedDue: true, timestamp: 1, previousCard: { srsStatus: 'Mastered' } });
    assert.equal(stats.todayTotal, 3);
    assert.equal(stats.dueDoneToday, 1);
});

test('nested modal focus returns to its opener and Tab stays inside the top modal', async () => {
    const handlers = [];
    const modals = [];
    const document = { activeElement: null, body: { classList: { add() {}, remove() {} } },
        addEventListener: (event, callback) => handlers.push({ event, callback }),
        querySelectorAll: () => modals.filter(modal => !modal.classList.contains('hidden')) };
    const element = () => ({ isConnected: true, closest: () => null, getClientRects: () => [{}],
        focus() { document.activeElement = this; }, addEventListener() {} });
    const makeModal = () => {
        const classes = new Set(['hidden']);
        const children = [element(), element()];
        const modal = { ...element(), classList: { contains: value => classes.has(value), add: value => classes.add(value), remove: value => classes.delete(value) },
            setAttribute() {}, querySelectorAll: () => children, contains: child => children.includes(child) };
        modals.push(modal); return { modal, children };
    };
    const source = read('src/ui/modal.js').replace(/^(?:import |export \{).*;\r?\n/gm, '').replace(/^export /gm, '');
    const c = context(source, { document, DOM: new Proxy({}, { get: () => element() }),
        animateModalOpen() {}, animateModalClose: async () => {}, suspendCelestialCanvas() {}, resumeCelestialCanvas() {},
        setTimeout() {}, clearTimeout() {} });
    const opener = element(); document.activeElement = opener;
    const parent = makeModal(), child = makeModal();
    c.openModal(parent.modal); parent.children[0].focus(); c.openModal(child.modal);
    child.children[1].focus();
    let prevented = false;
    handlers.find(handler => handler.event === 'keydown').callback({ key: 'Tab', preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(document.activeElement, child.children[0]);
    await c.closeModal(child.modal); assert.equal(document.activeElement, parent.children[0]);
    await c.closeModal(parent.modal); assert.equal(document.activeElement, opener);
});

test('Undo without a log ID keeps unrelated history; removed logs stay removed after merge', async () => {
    const initial = { dict: ['old'], logs: [[0, 3, 1, 100, 0, 'old-log']] };
    const code = `let _reviewLogs = initial;\n` + ['removeReviewLog', 'compressLogs', 'mergeReviewLogs'].map(name => fn('src/core/state.js', name)).join('\n');
    const c = context(code, { initial, persistReviewLogs: async () => {}, compressReviewLogs, mergeLogSnapshots });
    await c.removeReviewLog(null);
    assert.equal(initial.logs.length, 1);
    const remote = structuredClone(initial);
    await c.removeReviewLog('old-log');
    const merged = c.mergeReviewLogs(remote, initial);
    assert.equal(merged.logs.length, 0);
    assert.ok(merged.deletedIds.includes('old-log'));
});
test('distinct review event IDs are preserved even within the old deduplication window', () => {
    const c = { mergeReviewLogs: mergeLogSnapshots };
    const a = { dict: ['a'], logs: [[0, 3, 1, 100, 0, 'event-a']] };
    const b = { dict: ['a'], logs: [[0, 3, 1, 101, 0, 'event-b']] };
    assert.equal(c.mergeReviewLogs(a, b).logs.length, 2);
    assert.equal(c.mergeReviewLogs(a, a).logs.length, 1);
});

test('transaction merges against the remote revision from the successful retry', async () => {
    let remote = { ...base(), stability: 10, lastReviewDate: 200, srsUpdatedAt: 200, updatedAt: 200 };
    let committed;
    const c = context(fn('src/core/firebase.js', 'writeMergedCards'), {
        normalizeCard, mergeCardFields, isSrsEqual, db: {},
        ensureCloudAuth: async () => ({ uid: 'test-user' }),
        doc: (_, ...path) => path.join('/'),
        serverTimestamp: () => 'server-commit', getDeviceId: () => 'test',
        runTransaction: async (_, callback) => {
            const attempt = () => callback({ get: async () => ({ exists: () => true, data: () => remote }), set: (_, card) => { committed = card; } });
            await attempt(); // discarded attempt; another device reviewed concurrently
            remote = { ...remote, stability: 20, srsUpdatedAt: 300, lastReviewDate: 300, updatedAt: 300 };
            return attempt();
        },
    });
    const edited = { ...base(), vietnamese: 'corrected', contentUpdatedAt: 250, updatedAt: 250 };
    const result = await c.writeMergedCards([edited]);
    assert.equal(result[0].stability, 20);
    assert.equal(committed.vietnamese, 'corrected');
    assert.equal(committed.syncedAt, 'server-commit');
    assert.equal(edited.stability, 5);
});

function syncHarness(writer) {
    const values = new Map();
    const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
    let card = base();
    const stateModule = { getVocabById: () => card, updateCardInVocabulary: (_, next) => { card = next; } };
    const source = read('src/core/sync.js').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '')
        .replace("await import('./state.js')", 'stateModule');
    const c = context(source, { localStorage: storage, sessionStorage: storage, navigator: { onLine: true }, stateModule,
        setTimeout: () => 1, clearTimeout() {}, writeMergedCards: writer, mergeCardFields, saveWordToDB: async () => {},
        ensureCloudAuth: async () => ({ uid: 'test-user' }),
        syncProgressToFirebase: async () => {}, announceSyncStatus() {},
        getPendingCardIds: async () => [],
        getPendingWriteSnapshot: async ids => ids.map(id => ({ id, card, revision: 1 })),
        acknowledgePendingWrites: async records => records.map(record => record.id),
    });
    return { c, values, setCard: next => { card = next; }, getCard: () => card };
}
test('a newer edit during flush stays queued and the next flush sends it', async () => {
    let release, entered;
    const started = new Promise(resolve => { entered = resolve; });
    const pending = new Promise(resolve => { release = resolve; });
    const writes = [];
    const h = syncHarness(async cards => {
        const snapshot = structuredClone(cards); writes.push(snapshot);
        if (writes.length === 1) { entered(); await pending; }
        return snapshot;
    });
    h.c.syncCardToFirebase(h.getCard());
    const flushing = h.c.flushSyncQueue(); await started;
    h.setCard({ ...base(), vietnamese: 'edited during send', contentUpdatedAt: 500, updatedAt: 500 });
    h.c.syncCardToFirebase(h.getCard()); release(); await flushing;
    assert.equal(h.c.getSyncQueueSize(), 1);
    assert.equal(h.getCard().vietnamese, 'edited during send');
    await h.c.flushSyncQueue();
    assert.equal(writes[1][0].vietnamese, 'edited during send');
    assert.equal(h.c.getSyncQueueSize(), 0);
});
test('failed/offline writes keep durable pending IDs', async () => {
    const h = syncHarness(async () => { throw Error('offline'); });
    h.c.syncCardToFirebase(h.getCard()); await h.c.flushSyncQueue();
    assert.equal(h.c.getSyncQueueSize(), 1);
    assert.deepEqual(JSON.parse(h.values.get('pendingSyncIds')), ['a']);
});

test('computeDailyNewLimit can be imported and executed directly without vm context', async () => {
    const { computeDailyNewLimit } = await import('../src/core/queue.js');
    assert.equal(typeof computeDailyNewLimit, 'function');
    const stats = { currentLimit: 15, retentionHistory: [{ correct: 9, total: 10 }] };
    assert.equal(computeDailyNewLimit(stats, '2026-10-20'), 20);
});

test('dedup edge cases: null, empty, and malformed cards are handled without throwing', async () => {
    const { isDuplicateCard, findDuplicatePairs } = await import('../src/core/dedup.js');
    assert.equal(isDuplicateCard(null, null).isDuplicate, false);
    assert.equal(isDuplicateCard({}, {}).isDuplicate, false);
    assert.equal(isDuplicateCard({ english: '' }, { english: '' }).isDuplicate, false);
    assert.equal(isDuplicateCard({ english: '  ' }, { english: '  ' }).isDuplicate, false);
    assert.equal(isDuplicateCard({ english: 'valid' }, null).isDuplicate, false);

    const emptyPairs = findDuplicatePairs([null, {}, { id: 'x', english: '' }, { id: 'y', english: ' ' }]);
    assert.equal(emptyPairs.length, 0);
});

test('saveVocabulary and saveOneWord do not throw ReferenceError for missing UI globals', async () => {
    const { initAppDB, getAllVocabularyFromDB, getPendingCardIds } = await import('../src/core/idb.js');
    const db = await initAppDB();
    try {
        const { saveVocabulary, saveOneWord, setVocabulary } = await import('../src/core/state.js');

        const cardA = { id: 'card-persist-a', english: 'nebula', vietnamese: 'tinh vân', type: 'n', srsStatus: 'New', reps: 0 };
        const cardB = { id: 'card-persist-b', english: 'quasar', vietnamese: 'chuẩn tinh', type: 'n', srsStatus: 'Learning', reps: 1, stability: 10 };

        setVocabulary([cardA]);
        await saveVocabulary(false);

        const savedB = await saveOneWord(cardB);
        assert.ok(savedB, 'saveOneWord should return the saved card and not throw or fail');

        const stored = await getAllVocabularyFromDB();
        const storedMap = new Map(stored.map(card => [card.id, card]));

        assert.ok(storedMap.has('card-persist-a'), 'cardA must be persisted to IndexedDB by saveVocabulary');
        assert.equal(storedMap.get('card-persist-a').english, 'nebula');

        assert.ok(storedMap.has('card-persist-b'), 'cardB must be persisted to IndexedDB by saveOneWord');
        assert.equal(storedMap.get('card-persist-b').english, 'quasar');

        const pendingIds = await getPendingCardIds();
        assert.ok(pendingIds.includes('card-persist-a'), 'cardA should have a pending outbox entry');
        assert.ok(pendingIds.includes('card-persist-b'), 'cardB should have a pending outbox entry');
    } finally {
        db.close();
    }
});

