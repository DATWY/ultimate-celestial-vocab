// tests/helpers/review-harness.mjs
//
// Dựng môi trường chạy CHÍNH handler `processSrsFeedback` (trích từ src/events.js) và CHÍNH
// `revertGamificationAfterUndo` (trích từ src/core/state.js) với các hàm thống kê THẬT.
// Chỉ stub phần lưu trữ/UI — những thứ không tham gia phép tính.
//
// Dùng cho tests/p12-undo-stats.test.mjs và tests/p12-review-gates.test.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { calculateNextSrsState } from '../../src/core/srs/index.js';
import { trackReview, trackXP, trackHourBonus, trackLevelUp, ensureStats } from '../../src/features/stat-trackers.js';
import { snapshotReviewStats, diffReviewStats, revertReviewStats } from '../../src/core/stats-rollback.js';
import { isCardReviewable, classifyReview, reviewBudgets, budgetBlockReason } from '../../src/core/review-policy.js';
import { getLocalDateString } from '../../src/core/utils/date.js';

export const NOW = new Date(2026, 10, 3, 15, 0).getTime();
const read = path => fs.readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

/** Trích nguyên văn một hàm từ nguồn (không chép lại logic vào test). */
export function sourceOf(file, startMarker, endMarker) {
    const source = read(file);
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + 1);
    assert.ok(start >= 0 && end > start, `không trích được ${startMarker} từ ${file}`);
    return source.slice(start, end);
}

export function newCard(over = {}) {
    return {
        id: 'c1', english: 'apple', vietnamese: 'quả táo', srsStatus: 'New', reps: 0,
        updatedAt: NOW, contentUpdatedAt: NOW, srsUpdatedAt: NOW, flagsUpdatedAt: NOW, ...over
    };
}

export function makeHarness({
    cards = null, card = null, dailyStats = {}, gamification = {}, stats = {},
    budget = null, newLimit = 9999, today = NOW, typing = false
} = {}) {
    const g = {
        userXP: 0, currentLevel: 1, totalReviews: 0, consecutiveCorrect: 0, activityHeatmap: {},
        ...gamification
    };
    g.stats = Object.assign(ensureStats({}), stats);
    const d = { lastDate: getLocalDateString(today), todayTotal: 0, todayCorrect: 0,
        newCardsDoneToday: 0, dueDoneToday: 0, learningDoneToday: 0, ...dailyStats };
    const state = {
        vocabulary: cards || (card ? [card] : []), currentCardIndex: 0, gamification: g, dailyStats: d,
        isTransitioning: false
    };
    let snapshot = null;
    const logs = [], saves = [], toasts = [];
    const noop = () => {};
    const context = vm.createContext({
        console: { log: noop, warn: noop, error: noop },
        getState: () => state,
        setIsTransitioning: value => { state.isTransitioning = value; },
        calculateNextSrsState,
        crypto: { randomUUID: () => 'uuid-' + (logs.length + 1) },
        shouldCardUseTyping: () => typing,
        addReviewLog: log => logs.push(log),
        classifyReview, isCardReviewable, reviewBudgets, budgetBlockReason,
        incrementReviewBudget: category => {
            const key = { new: 'newCardsDoneToday', due: 'dueDoneToday', learning: 'learningDoneToday' }[category];
            if (key) d[key] = (d[key] || 0) + 1;
        },
        getReviewBudget: () => budget || { limit: 999, used: 0, reserved: 0, remaining: 999 },
        computeDailyNewLimit: () => newLimit,
        getLocalDateString: () => getLocalDateString(today),
        trackEvent: (name, amount = 1) => { g.stats[name] = (g.stats[name] || 0) + amount; },
        getComboMultiplier: () => 1,
        // addXP: giữ đúng phần THỐNG KÊ của production (userXP + trackXP + trackLevelUp khi lên cấp).
        addXP: amount => {
            const oldLevel = Math.floor(Math.sqrt(g.userXP / 100)) + 1;
            g.userXP += amount;
            g.currentLevel = Math.floor(Math.sqrt(g.userXP / 100)) + 1;
            trackXP(g.stats, amount, today);
            if (g.currentLevel > oldLevel) trackLevelUp(g.stats, today);
        },
        // Bản sao ĐÚNG của gamification.recordReviewResult (src/core/state/gamification.js):
        // hàm thật đọc/ghi state module của nó nên không tiêm được vào harness; phần Undo được test
        // ở đây là mã THẬT, chỉ phép cộng combo này là stub có ghi chú.
        recordReviewResult: correct => {
            g.totalReviews++; d.todayTotal++;
            if (correct) {
                d.todayCorrect++;
                g.consecutiveCorrect = (g.consecutiveCorrect || 0) + 1;
            } else {
                g.consecutiveCorrect = (g.consecutiveCorrect || 0) >= 30 ? 10 : 0;
            }
        },
        logActivity: () => { g.activityHeatmap[d.lastDate] = (g.activityHeatmap[d.lastDate] || 0) + 1; },
        snapshotReviewStats: s => snapshotReviewStats(s, getLocalDateString(today)),
        diffReviewStats,
        trackHourBonus: s => trackHourBonus(s, today),
        trackReview,
        updateStats: noop, saveOneWord: word => saves.push(word), playSound: noop,
        showToast: (title, body) => toasts.push({ title, body }),
        insertCardForLearningStep: noop,
        setLastReviewSnapshot: value => { snapshot = value; },
        updateUndoButtonState: noop,
        document: { activeElement: null, getElementById: () => null },
        // ── phía Undo ──
        _gamification: g, _dailyStats: d,
        revertReviewBudget: category => {
            const key = { new: 'newCardsDoneToday', due: 'dueDoneToday', learning: 'learningDoneToday' }[category];
            if (key) d[key] = Math.max(0, (d[key] || 0) - 1);
        },
        revertReviewStats, syncStreakFromHeatmap: noop, ensureDailyStats: noop,
        saveGamification: async () => {}, saveDailyStats: async () => {}, CustomEvent: class {},
    });
    vm.runInContext(sourceOf('src/events.js', 'function processSrsFeedback(', '\nasync function switchCardWithAnimation'), context);
    vm.runInContext(
        sourceOf('src/core/state.js', 'export async function revertGamificationAfterUndo(', '\nexport async function setUserSrsParams')
            .replace('export ', ''),
        context);
    return {
        context, state, g, d, logs, saves, toasts,
        snapshot: () => snapshot,
        review: (rating = 4) => context.processSrsFeedback(rating, false),
        undo: () => context.revertGamificationAfterUndo(snapshot)
    };
}
