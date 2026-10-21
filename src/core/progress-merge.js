// Cumulative, signed contributions per browser session. A retry copies a component;
// it never adds it again. Undo and spending are negative contributions.
const META = '_progressV1';
const DAILY = ['newCardsDoneToday', 'dueDoneToday', 'learningDoneToday', 'todayCorrect', 'todayTotal'];
const clone = value => JSON.parse(JSON.stringify(value));
const number = value => Number.isFinite(value) ? value : 0;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const cumulativeStat = key => !/streak|consecutive|^last|^max|Today$|^xpLastWeek$|^monthly|Date$/i.test(key);
const path = (...parts) => JSON.stringify(parts);
const read = (object, parts) => parts.reduce((value, key) => value?.[key], object);
function write(object, parts, value) {
    let target = object;
    parts.slice(0, -1).forEach(key => { target = target[key] ??= {}; });
    target[parts.at(-1)] = value;
}

function counters(value, kind) {
    const result = {};
    if (kind === 'daily') {
        if (value.lastDate) for (const key of DAILY) result[path('day', value.lastDate, key)] = number(value[key]);
        for (const entry of value.retentionHistory || []) {
            if (!entry.date) continue;
            result[path('day', entry.date, 'todayCorrect')] ??= number(entry.correct);
            result[path('day', entry.date, 'todayTotal')] ??= number(entry.total);
        }
    } else {
        for (const key of ['userXP', 'totalReviews', 'streakFreezeCount']) result[path(key)] = number(value[key]);
        for (const [date, count] of Object.entries(value.activityHeatmap || {})) result[path('activityHeatmap', date)] = number(count);
        for (const [key, count] of Object.entries(value.stats || {})) {
            if (typeof count === 'number' && cumulativeStat(key)) result[path('stats', key)] = number(count);
        }
    }
    return result;
}

function registers(value, kind) {
    const result = {};
    const fields = kind === 'daily' ? ['currentLimit', 'limitAdjustedDate']
        : ['consecutiveCorrect', 'lastStreakFreezeDate', 'lastStudyDate'];
    for (const key of fields) if (value[key] !== undefined) result[path(key)] = value[key];
    if (kind !== 'daily') for (const [key, val] of Object.entries(value.stats || {})) {
        if (typeof val !== 'number' || !cumulativeStat(key)) result[path('stats', key)] = val;
    }
    return result;
}

function totals(meta) {
    const result = { ...meta.base };
    for (const actor of Object.values(meta.actors)) for (const [key, delta] of Object.entries(actor.delta)) {
        result[key] = number(result[key]) + number(delta);
    }
    return result;
}

function seed(value, kind) {
    if (value[META]?.version === 1) return clone(value[META]);
    return { version: 1, base: counters(value, kind), actors: {},
        registers: Object.fromEntries(Object.entries(registers(value, kind)).map(([key, val]) => [key, { value: val, at: 0, actor: '', seq: 0 }])) };
}

export function initializeProgress(value, kind) {
    value[META] = seed(value, kind);
    return value;
}

export function captureProgress(value, kind, actorId, now = Date.now()) {
    const meta = seed(value, kind);
    const before = totals(meta);
    const current = counters(value, kind);
    // An absent heatmap date means the last review on that date was undone.
    if (kind !== 'daily') for (const key of Object.keys(before)) {
        if (JSON.parse(key)[0] === 'activityHeatmap') current[key] ??= 0;
    }
    const component = clone(meta.actors[actorId] || { seq: 0, delta: {} });
    const seq = component.seq + 1;
    let changed = false;
    for (const [key, val] of Object.entries(current)) {
        const difference = val - Math.max(0, number(before[key]));
        if (Math.abs(difference) < 1e-9) continue;
        component.delta[key] = number(component.delta[key]) + difference;
        changed = true;
    }
    for (const [key, val] of Object.entries(registers(value, kind))) {
        if (equal(meta.registers[key]?.value, val)) continue;
        const previousTime = meta.registers[key]?.at || 0;
        meta.registers[key] = { value: val, at: Math.max(now, previousTime + 1), actor: actorId, seq };
        changed = true;
    }
    if (changed) { component.seq = seq; meta.actors[actorId] = component; }
    value[META] = meta;
    return value;
}

function newer(a, b) {
    if (!a) return b;
    if (!b) return a;
    const order = a.at - b.at || a.actor.localeCompare(b.actor) || a.seq - b.seq;
    return order > 0 ? a : order < 0 ? b : JSON.stringify(a.value) > JSON.stringify(b.value) ? a : b;
}

export function mergeProgress(local = {}, remote = {}, kind = 'gamification', activeDate = null) {
    remote ||= {};
    const a = seed(local, kind), b = seed(remote, kind);
    const meta = { version: 1, base: {}, actors: {}, registers: {} };
    for (const key of new Set([...Object.keys(a.base), ...Object.keys(b.base)])) {
        // Legacy migration retains the larger historical baseline once. All new
        // activity is recorded separately, including signed debits and Undo.
        meta.base[key] = Math.max(number(a.base[key]), number(b.base[key]));
    }
    for (const key of new Set([...Object.keys(a.actors), ...Object.keys(b.actors)])) {
        const x = a.actors[key], y = b.actors[key];
        meta.actors[key] = clone(!x ? y : !y ? x : x.seq >= y.seq ? x : y);
    }
    for (const key of new Set([...Object.keys(a.registers), ...Object.keys(b.registers)])) {
        meta.registers[key] = clone(newer(a.registers[key], b.registers[key]));
    }
    const result = { ...clone(remote), ...clone(local), [META]: meta };
    for (const [key, record] of Object.entries(meta.registers)) write(result, JSON.parse(key), record.value);
    const sum = totals(meta);
    if (kind === 'daily') {
        result.lastDate = activeDate || [local.lastDate || '', remote.lastDate || ''].sort().at(-1);
        for (const key of DAILY) result[key] = Math.max(0, number(sum[path('day', result.lastDate, key)]));
        result.todayCorrect = Math.min(result.todayCorrect, result.todayTotal);
        const dates = new Set(Object.keys(sum).map(key => JSON.parse(key)).filter(p => p[0] === 'day').map(p => p[1]));
        result.retentionHistory = [...dates].filter(date => date < result.lastDate && sum[path('day', date, 'todayTotal')] > 0).sort().slice(-3).map(date => ({
            date, correct: Math.max(0, number(sum[path('day', date, 'todayCorrect')])), total: Math.max(0, number(sum[path('day', date, 'todayTotal')]))
        }));
    } else {
        result.activityHeatmap = {};
        for (const [key, val] of Object.entries(sum)) write(result, JSON.parse(key), Math.max(0, val));
        result.currentLevel = Math.floor(Math.sqrt(result.userXP / 100)) + 1;
        for (const field of ['unlockedBadges', 'frozenDates', 'recoveredDates']) result[field] = [...new Set([...(local[field] || []), ...(remote[field] || [])])].sort();
        result.longestStreak = Math.max(local.longestStreak || 0, remote.longestStreak || 0);
    }
    return result;
}
