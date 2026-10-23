import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeProgress, captureProgress, mergeProgress } from '../src/core/progress-merge.js';

const clone = value => structuredClone(value);
const initial = () => initializeProgress({ userXP: 1000, totalReviews: 10, streakFreezeCount: 1,
    activityHeatmap: { '2026-10-20': 10 }, stats: { imports: 2, consecutiveEasy: 5 }, unlockedBadges: [] }, 'gamification');
const save = (value, actor, kind = 'gamification') => captureProgress(value, kind, actor, 100);

test('two offline sessions add their distinct work; repeated sync is idempotent', () => {
    const a = initial(), b = clone(a);
    a.userXP += 15; a.totalReviews++; a.activityHeatmap['2026-10-20']++; save(a, 'A');
    b.userXP += 20; b.totalReviews++; b.activityHeatmap['2026-10-20']++; save(b, 'B');
    const merged = mergeProgress(a, b);
    assert.equal(merged.userXP, 1035);
    assert.equal(merged.totalReviews, 12);
    assert.equal(merged.activityHeatmap['2026-10-20'], 12);
    assert.deepEqual(mergeProgress(merged, a), merged);
    assert.deepEqual(mergeProgress(b, a), merged);
});

test('Undo after upload stays undone against stale cloud snapshots', () => {
    const local = initial();
    local.userXP += 15; local.totalReviews++; local.activityHeatmap['2026-10-20']++; save(local, 'A');
    const cloud = clone(local);
    local.userXP -= 15; local.totalReviews--; local.activityHeatmap['2026-10-20']--; save(local, 'A');
    const merged = mergeProgress(local, cloud);
    assert.equal(merged.userXP, 1000);
    assert.equal(merged.totalReviews, 10);
    assert.equal(merged.activityHeatmap['2026-10-20'], 10);
    assert.deepEqual(mergeProgress(merged, cloud), merged);
});

test('spending XP and consuming a freeze survive reconnect and out-of-order messages', () => {
    const a = initial(), stale = clone(a);
    a.userXP -= 800; a.streakFreezeCount--; save(a, 'A');
    const b = clone(stale); b.userXP += 50; save(b, 'B');
    const merged = mergeProgress(a, b);
    assert.equal(merged.userXP, 250);
    assert.equal(merged.streakFreezeCount, 0);
    assert.equal(mergeProgress(stale, merged).userXP, 250);
    assert.equal(mergeProgress(stale, merged).streakFreezeCount, 0);
});

test('capturing an incoming merge never records remote work as local work', () => {
    const a = initial(), b = clone(a);
    a.userXP += 10; save(a, 'A');
    b.userXP += 20; save(b, 'B');
    const current = mergeProgress(a, b);
    save(current, 'A');
    assert.equal(current._progressV1.actors.A.seq, a._progressV1.actors.A.seq);
    current.userXP += 5; save(current, 'A');
    assert.equal(mergeProgress(current, b).userXP, 1035);
});

test('a removed heatmap date is recorded as a signed change', () => {
    const a = initial(); a.activityHeatmap = {}; save(a, 'A');
    assert.equal(mergeProgress(a, initial()).activityHeatmap['2026-10-20'], 0);
});

test('daily counts add across sessions and remain correct after midnight', () => {
    const a = initializeProgress({ lastDate: '2026-10-20', todayTotal: 2, todayCorrect: 1, newCardsDoneToday: 1 }, 'daily');
    const b = clone(a);
    a.todayTotal++; a.todayCorrect++; save(a, 'A', 'daily');
    b.todayTotal++; b.dueDoneToday = 1; save(b, 'B', 'daily');
    const merged = mergeProgress(a, b, 'daily');
    assert.equal(merged.todayTotal, 4); assert.equal(merged.todayCorrect, 2);
    merged.lastDate = '2026-10-21';
    for (const key of ['todayTotal', 'todayCorrect', 'newCardsDoneToday', 'dueDoneToday', 'learningDoneToday']) merged[key] = 0;
    merged.retentionHistory = [{ date: '2026-10-20', total: 4, correct: 2 }];
    save(merged, 'A', 'daily');
    const next = mergeProgress(merged, b, 'daily');
    assert.equal(next.todayTotal, 0);
    assert.deepEqual(next.retentionHistory, [{ date: '2026-10-20', total: 4, correct: 2 }]);
});

test('resettable stats follow their latest revision instead of their largest value', () => {
    const a = initial(), old = clone(a);
    a.stats.consecutiveEasy = 0; save(a, 'A');
    assert.equal(mergeProgress(a, old).stats.consecutiveEasy, 0);
});

test('all permutations of three offline branches converge', () => {
    const states = ['A', 'B', 'C'].map((actor, i) => { const v = initial(); v.userXP += (i - 1) * 20; v.stats.imports += i; return save(v, actor); });
    const orders = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
    for (const order of orders) {
        const v = order.map(i => states[i]).reduce((x,y) => mergeProgress(x,y));
        assert.equal(v.userXP, 1000); assert.equal(v.stats.imports, 5);
    }
});

test('a remote device clock ahead cannot move the active daily dashboard into the future', () => {
    const local = initializeProgress({ lastDate: '2026-10-21', todayTotal: 3, todayCorrect: 2 }, 'daily');
    const remote = initializeProgress({ lastDate: '2026-11-21', todayTotal: 20, todayCorrect: 19 }, 'daily');
    const merged = mergeProgress(local, remote, 'daily', '2026-10-21');
    assert.equal(merged.lastDate, '2026-10-21'); assert.equal(merged.todayTotal, 3);
});

test('reconciling a false freeze refunds the shield and neutralizes phone debit delta', () => {
    const phone = initializeProgress({ userXP: 1000, totalReviews: 50, streakFreezeCount: 1, activityHeatmap: { '2026-10-21': 20 } }, 'gamification');
    // Phone mistakenly consumes freeze before syncing yesterday's reviews
    phone.streakFreezeCount = 0;
    phone.frozenDates = ['2026-10-22'];
    phone.activityHeatmap['2026-10-22'] = 1;
    save(phone, 'Phone');
    assert.equal(phone._progressV1.actors.Phone.delta['["streakFreezeCount"]'], -1);

    // Cloud already had 13 reviews for yesterday
    const cloud = initializeProgress({ userXP: 1000, totalReviews: 63, streakFreezeCount: 1, activityHeatmap: { '2026-10-21': 20, '2026-10-22': 13 } }, 'gamification');
    save(cloud, 'Cloud');

    const merged = mergeProgress(phone, cloud, 'gamification');
    assert.equal(merged.streakFreezeCount, 0); // Before reconcile, sum is 0 due to phone's -1 delta

    // Reconcile: yesterday had >= 10 reviews (14 reviews in merged)
    const isFalseFreeze = (merged.activityHeatmap['2026-10-22'] || 0) >= 10;
    assert.equal(isFalseFreeze, true);
    merged.streakFreezeCount = Math.min(1, merged.streakFreezeCount + 1);
    merged.frozenDates = [];
    save(merged, 'Phone');

    // Phone delta is now 0 (neutralized)
    assert.equal(merged._progressV1.actors.Phone.delta['["streakFreezeCount"]'], 0);
    assert.equal(merged.streakFreezeCount, 1);

    // Syncing to PC retains shield = 1
    const pc = mergeProgress(cloud, merged, 'gamification');
    assert.equal(pc.streakFreezeCount, 1);
});
