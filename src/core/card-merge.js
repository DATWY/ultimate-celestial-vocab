// Keep editorial changes, review state and flags on independent clocks.
export function toMillis(value) {
    let millis = 0;
    try {
        if (typeof value === 'number') millis = value;
        else if (value instanceof Date) millis = value.getTime();
        else if (typeof value?.toMillis === 'function') millis = value.toMillis();
        else if (typeof value?.seconds === 'number') millis = value.seconds * 1000 + (value.nanoseconds || 0) / 1e6;
    } catch (_) { return 0; }
    return Number.isFinite(millis) ? millis : 0;
}

export const nextRevision = (card, domain, now = Date.now()) => Math.max(now, toMillis(card?.[domain]) + 1);

const CONTENT = ['english', 'vietnamese', 'pronunciation', 'type', 'example', 'exampleMeaning',
    'exampleVi', 'notes', 'synonyms', 'antonyms', 'collocations', 'audio', 'tags'];
const MEMORY = ['srsStatus', 'srsDueDate', 'srsInterval', 'srsEaseFactor', 'stability',
    'stabilityShort', 'difficulty', 'reps', 'lapses', 'lastReviewDate', 'consecutiveCorrect',
    'learningStep', 'anchor', 'modality'];

export function normalizeCard(card) {
    if (!card) return card;
    const updatedAt = toMillis(card.updatedAt);
    const normalized = {
        ...card,
        pronunciation: card.pronunciation ?? card.phonetic ?? '',
        tags: [...new Set((Array.isArray(card.tags) ? card.tags : typeof card.tags === 'string' ? card.tags.split(',') : []).filter(tag => typeof tag === 'string').map(tag => tag.trim()).filter(Boolean))],
        updatedAt,
        contentUpdatedAt: card.contentUpdatedAt != null ? toMillis(card.contentUpdatedAt) : updatedAt,
        srsUpdatedAt: card.srsUpdatedAt != null ? toMillis(card.srsUpdatedAt) : toMillis(card.lastReviewDate),
        flagsUpdatedAt: card.flagsUpdatedAt != null ? toMillis(card.flagsUpdatedAt) : updatedAt,
        isSuspended: false,
        isStarred: card.isStarred === true || card.isStarred === 1 || card.isStarred === 'true',
        isDeleted: card.isDeleted === true || card.isDeleted === 1 || card.isDeleted === 'true',
    };
    for (const key of ['srsDueDate', 'lastReviewDate']) {
        if (card[key] != null) normalized[key] = toMillis(card[key]);
    }
    normalized.srsStatus = ['New', 'Learning', 'Mastered'].includes(card.srsStatus) ? card.srsStatus : 'New';
    for (const key of ['reps', 'lapses', 'learningStep']) normalized[key] = Math.min(100000000, Math.max(0, Math.trunc(Number(card[key]) || 0)));
    normalized.srsInterval = Math.min(36500, Math.max(0, Number(card.srsInterval) || 0));
    for (const [key, min, max] of [['difficulty', 1, 10], ['stability', .01, 36500], ['stabilityShort', .01, 36500]]) {
        if (card[key] != null) normalized[key] = Number.isFinite(Number(card[key])) ? Math.min(max, Math.max(min, Number(card[key]))) : undefined;
    }
    if (normalized.stability && normalized.stabilityShort) normalized.stabilityShort = Math.min(normalized.stability, normalized.stabilityShort);
    delete normalized.phonetic;
    return normalized;
}

function stable(value) {
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if (value && typeof value === 'object') {
        return '{' + Object.keys(value).sort().filter(k => value[k] !== undefined)
            .map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
    }
    return JSON.stringify(value);
}

function choose(a, b, clock, fields) {
    const delta = toMillis(a[clock]) - toMillis(b[clock]);
    if (delta) return delta > 0 ? a : b;
    // A deterministic tie break makes merge(a,b) equal merge(b,a).
    const project = c => Object.fromEntries(fields.map(k => [k, c[k]]));
    return stable(project(a)) >= stable(project(b)) ? a : b;
}

export function mergeCardFields(local, remote) {
    const a = normalizeCard(local), b = normalizeCard(remote);
    if (!a) return b;
    if (!b) return a;
    const editorial = choose(a, b, 'contentUpdatedAt', CONTENT);
    const memory = choose(a, b, 'srsUpdatedAt', MEMORY);
    const flags = choose(a, b, 'flagsUpdatedAt', ['isStarred']);
    const newest = choose(a, b, 'updatedAt', [...CONTENT, ...MEMORY]);
    const result = { ...newest, id: a.id || b.id };
    // Missing values must not accidentally inherit stale data from another domain.
    for (const key of CONTENT) {
        if (Object.hasOwn(editorial, key)) result[key] = editorial[key];
        else delete result[key];
    }
    for (const key of MEMORY) {
        if (Object.hasOwn(memory, key)) result[key] = memory[key];
        else delete result[key];
    }
    result.contentUpdatedAt = Math.max(a.contentUpdatedAt, b.contentUpdatedAt);
    result.srsUpdatedAt = Math.max(a.srsUpdatedAt, b.srsUpdatedAt);
    result.flagsUpdatedAt = Math.max(a.flagsUpdatedAt, b.flagsUpdatedAt);
    result.updatedAt = Math.max(a.updatedAt, b.updatedAt);
    result.isStarred = !!flags.isStarred;
    // There is no restore action: a later review must never resurrect a deleted ID.
    result.isDeleted = !!(a.isDeleted || b.isDeleted);
    result.deletedAt = Math.max(toMillis(a.deletedAt), toMillis(b.deletedAt),
        a.isDeleted ? a.updatedAt : 0, b.isDeleted ? b.updatedAt : 0);
    result.isSuspended = false;
    delete result.syncedAt;
    delete result._lastModifiedBy;
    return result;
}

export function isSrsEqual(a, b) {
    const comparable = card => {
        const copy = normalizeCard(card);
        if (!copy) return copy;
        delete copy.syncedAt;
        delete copy._lastModifiedBy;
        if (!copy.deletedAt) delete copy.deletedAt;
        if (!copy.isDeleted) delete copy.isDeleted;
        return copy;
    };
    return stable(comparable(a)) === stable(comparable(b));
}

export function restoreCardReview(current, previous, now = Date.now()) {
    const revision = nextRevision(current, 'srsUpdatedAt', now);
    const restored = { ...current, updatedAt: Math.max(now, current.updatedAt || 0, revision), srsUpdatedAt: revision };
    for (const key of MEMORY) {
        if (Object.hasOwn(previous, key)) restored[key] = previous[key];
        else delete restored[key];
    }
    return restored;
}
