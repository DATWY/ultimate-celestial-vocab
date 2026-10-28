// tests/adversarial-merge.test.mjs
//
// mergeProgress từng KHÔNG giao hoán: merge(A,B) cho currentStreak 13 còn
// merge(B,A) cho 15 (đo trên state thật 32.242 XP). Hai call site hiện tại đều
// tính lại streak sau merge nên lỗi bị che; test này khoá bản thân hàm merge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeProgress, captureProgress, initializeProgress } from '../src/core/progress-merge.js';

const canonical = (value) => Array.isArray(value)
    ? value.map(canonical)
    : (value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
        : value);
const stable = (value) => JSON.stringify(canonical(value));
const clone = (value) => JSON.parse(JSON.stringify(value));

const baseGamification = () => ({
    userXP: 32242,
    currentLevel: 18,
    currentStreak: 12,
    longestStreak: 125,
    lastStudyDate: '2026-10-27',
    activityHeatmap: { '2026-10-20': 40, '2026-10-21': 66, '2026-10-27': 12 },
    unlockedBadges: ['first_step', 'century'],
    totalReviews: 10595,
    streakFreezeCount: 2,
    lastStreakFreezeDate: '2026-10-25',
    frozenDates: [],
    recoveredDates: ['2026-10-18'],
    consecutiveCorrect: 3,
    stats: { nightOwlWords: 12, justLeveledUp: false, typingLastCharTypo: true, opensToday: 4, xpToday: 120 }
});

// App gọi initializeProgress() ngay khi nạp state (src/core/state.js:318). Thiếu
// bước này thì mỗi lần capture lại seed baseline từ giá trị HIỆN TẠI, delta bằng
// 0 và phép cộng XP giữa hai thiết bị mất trắng — đúng cái bẫy tôi đã sập khi
// viết test lần đầu.
const device = (mutate, actor, at) => {
    const state = initializeProgress(baseGamification(), 'gamification');
    mutate(state);
    captureProgress(state, 'gamification', actor, at);
    return state;
};

test('merge adversarial: giao hoán trên state kiểu thật (currentStreak không được lệch)', () => {
    const a = device(s => { s.userXP += 50; s.currentStreak = 13; s.activityHeatmap['2026-10-28'] = 10; }, 'deviceA', 1000);
    const b = device(s => { s.userXP += 70; s.currentStreak = 15; s.activityHeatmap['2026-10-28'] = 12; }, 'deviceB', 2000);

    const ab = mergeProgress(clone(a), clone(b));
    const ba = mergeProgress(clone(b), clone(a));

    assert.equal(ab.currentStreak, ba.currentStreak, 'currentStreak phải hội tụ');
    assert.equal(ab.currentStreak, 15, 'giá trị mới hơn (deviceB) phải thắng');
    assert.equal(stable(ab), stable(ba), 'hai thứ tự merge phải cho cùng kết quả');
    // Bộ đếm cộng dồn vẫn đúng
    assert.equal(ab.userXP, 32242 + 50 + 70);
    assert.equal(ab.activityHeatmap['2026-10-28'], 22);
});

test('merge adversarial: kết hợp với 3 thiết bị', () => {
    const a = device(s => { s.userXP += 10; s.currentStreak = 13; }, 'a', 1000);
    const b = device(s => { s.userXP += 20; s.currentStreak = 14; }, 'b', 2000);
    const c = device(s => { s.userXP += 30; s.currentStreak = 11; }, 'c', 1500);

    const left = mergeProgress(mergeProgress(clone(a), clone(b)), clone(c));
    const right = mergeProgress(clone(a), mergeProgress(clone(b), clone(c)));
    assert.equal(stable(left), stable(right));
    assert.equal(left.userXP, 32242 + 60);
});

test('merge adversarial: lũy đẳng (merge với chính nó không nhân đôi)', () => {
    const a = device(s => { s.userXP += 40; }, 'a', 1000);
    const twice = mergeProgress(clone(a), clone(a));
    assert.equal(twice.userXP, a.userXP);
    assert.equal(twice.totalReviews, a.totalReviews);
    assert.equal(twice.activityHeatmap['2026-10-27'], 12);
});

test('merge adversarial: ngày (daily) giao hoán và không trả số âm', () => {
    const dailyBase = () => initializeProgress({
        lastDate: '2026-10-28', newCardsDoneToday: 0, dueDoneToday: 4, learningDoneToday: 8,
        todayCorrect: 12, todayTotal: 26, currentLimit: 15, limitAdjustedDate: '2026-10-28', retentionHistory: []
    }, 'daily');
    const a = dailyBase(); a.dueDoneToday += 5; a.todayTotal += 5; a.todayCorrect += 4;
    captureProgress(a, 'daily', 'a', 1000);
    const b = dailyBase(); b.dueDoneToday += 7; b.todayTotal += 7; b.todayCorrect += 6;
    captureProgress(b, 'daily', 'b', 2000);

    const ab = mergeProgress(clone(a), clone(b), 'daily', '2026-10-28');
    const ba = mergeProgress(clone(b), clone(a), 'daily', '2026-10-28');
    assert.equal(stable(ab), stable(ba));
    assert.equal(ab.dueDoneToday, 4 + 5 + 7);
    assert.ok(ab.todayCorrect <= ab.todayTotal, 'correct không được > total');
});
