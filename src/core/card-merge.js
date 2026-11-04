// Keep editorial changes, review state and flags on independent clocks.
import { LEECH_LAPSE_THRESHOLD } from './srs/constants.js';

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
    'learningStep', 'anchor', 'modality', 'isLeech',
    // AUDIT-2.1: bộ đếm sai-trong-ngày và cờ chôn thẻ do ENGINE ghi trong lượt chấm, nên chúng
    // thuộc DOMAIN BỘ NHỚ (đi cùng srsUpdatedAt), không phải nội dung. Thiếu 4 trường này thì
    // (a) Undo không phục hồi được chúng, (b) một bản chỉ sửa nội dung nhưng mới hơn sẽ mang
    // bộ đếm cũ đi đè trạng thái SRS mới.
    'lapseDay', 'lapsesToday', 'buriedOn', 'needsReformulation'];

// Cờ boolean đến từ Cloud/TSV có thể là true | 1 | 'true'.
const flag = value => value === true || value === 1 || value === 'true';

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
        // LỖI ĐÃ SỬA (PHASE 9): trước đây hardcode `isSuspended: false` ⇒ mọi lần
        // nạp lại là cờ "tạm ẩn" bị xoá sạch, nên không cách nào tạm ẩn một từ.
        // Cờ này là FLAGS (đi cùng flagsUpdatedAt), không phải nội dung lẫn bộ nhớ.
        isSuspended: flag(card.isSuspended),
        isStarred: flag(card.isStarred),
        isDeleted: flag(card.isDeleted),
    };
    for (const key of ['srsDueDate', 'lastReviewDate']) {
        if (card[key] != null) normalized[key] = toMillis(card[key]);
    }
    normalized.srsStatus = ['New', 'Learning', 'Mastered'].includes(card.srsStatus) ? card.srsStatus : 'New';
    for (const key of ['reps', 'lapses', 'learningStep']) normalized[key] = Math.min(100000000, Math.max(0, Math.trunc(Number(card[key]) || 0)));
    // T1.4: cờ leech là dữ liệu BỘ NHỚ (đi cùng lapses), merge theo đồng hồ srsUpdatedAt.
    // Luôn suy lại được từ lapses nên thẻ đến từ máy chạy bản cũ (chưa có field) hoặc
    // thẻ nhập từ TSV vẫn có cờ đúng ngay sau khi normalize.
    normalized.isLeech = flag(card.isLeech) || normalized.lapses >= LEECH_LAPSE_THRESHOLD;
    // AUDIT-2.1: 4 trường bộ nhớ "trong ngày" — engine đọc chúng qua `Number(x) || 0`, nên thẻ cũ
    // thiếu trường vẫn hiểu là 0 / không chôn; khác biệt duy nhất là nay chúng được merge và
    // phục hồi theo đồng hồ srsUpdatedAt. Giá trị false được canonical hoá thành VẮNG MẶT để
    // projection của merge không phụ thuộc vào việc bản ghi có ghi false tường minh hay không.
    normalized.lapsesToday = Math.min(100000000, Math.max(0, Math.trunc(Number(card.lapsesToday) || 0)));
    for (const key of ['lapseDay', 'buriedOn']) {
        if (typeof card[key] === 'string' && card[key].trim()) normalized[key] = card[key];
        else delete normalized[key];
    }
    if (flag(card.needsReformulation)) normalized.needsReformulation = true;
    else delete normalized.needsReformulation;
    normalized.srsInterval = Math.min(36500, Math.max(0, Number(card.srsInterval) || 0));
    for (const [key, min, max] of [['difficulty', 1, 10], ['stability', .01, 36500], ['stabilityShort', .01, 36500]]) {
        if (card[key] != null) normalized[key] = Number.isFinite(Number(card[key])) ? Math.min(max, Math.max(min, Number(card[key]))) : undefined;
    }
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
    // PHASE 9: isSuspended là FLAGS (đi cùng flagsUpdatedAt) nên phải merge theo nhóm này,
    // nếu không bản mới hơn sẽ ghi đè mất quyết định "tạm ẩn" của người dùng.
    const flags = choose(a, b, 'flagsUpdatedAt', ['isStarred', 'isSuspended']);
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
    result.isSuspended = !!flags.isSuspended;
    // SYNC-01: KHÔNG xoá syncedAt. Đây là mốc "bản trên Cloud đã khớp", thứ duy nhất
    // giúp Phase 2 của smartSync phân biệt "thẻ chưa từng sync" với "thẻ đã sync rồi".
    // Xoá nó khiến mọi thẻ bị đẩy lại mỗi vòng: mỗi thẻ là một transaction.get (đốt
    // quota đọc) và danh sách push phình to tới mức Quota Shield xoá sạch, nuốt luôn
    // các thẻ hội tụ cần đẩy. Giữ giá trị LỚN NHẤT để merge vẫn giao hoán.
    const syncedAt = Math.max(toMillis(a.syncedAt), toMillis(b.syncedAt));
    if (syncedAt > 0) result.syncedAt = syncedAt;
    else delete result.syncedAt;
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

// ─────────────────── U1: hoàn tác phần thống kê của MỘT lượt chấm ───────────────────
// Undo trước đây chỉ lùi easyPresses/hardPresses, còn trackReview/trackHourBonus ghi hàng chục
// khoá ⇒ hoàn tác rồi làm lại vẫn cộng dồn thành tích (mở huy hiệu bằng lượt đã hoàn tác).
// Cách làm: chụp các giá trị SỐ trước lượt chấm rồi lưu DELTA — nhờ vậy chỉ trừ đúng phần của
// lượt đó, không ghi đè hoạt động hợp lệ đến từ tab/thiết bị khác.
// Chỉ xét khoá có giá trị SỐ: khoá mốc dạng chuỗi ngày (lastXPDate, lastMonthlyKey…) bỏ qua vì
// không trừ ngược được; mốc dạng số (lastReviewAt, lastForgottenDate) được hoàn lại.

export function snapshotNumericStats(stats) {
    const snapshot = {};
    if (stats && typeof stats === 'object') {
        for (const key of Object.keys(stats)) {
            if (typeof stats[key] === 'number' && Number.isFinite(stats[key])) snapshot[key] = stats[key];
        }
    }
    return snapshot;
}

export function diffNumericStats(before, stats) {
    const s = stats && typeof stats === 'object' ? stats : {};
    const delta = {};
    // Duyệt HỢP hai tập khoá: ensureStats() khởi tạo lười nhiều bộ đếm = 0 ngay trong lượt chấm
    // đầu, nên khoá đó không có trong `before` và sẽ không được hoàn nếu chỉ duyệt `before`.
    for (const key of new Set([...Object.keys(before || {}), ...Object.keys(s)])) {
        const current = s[key];
        if (typeof current !== 'number' || !Number.isFinite(current)) continue;
        const prior = typeof before?.[key] === 'number' && Number.isFinite(before[key]) ? before[key] : 0;
        if (current !== prior) delta[key] = current - prior;
    }
    return delta;
}

export function revertNumericStats(stats, delta) {
    if (!stats || !delta || typeof delta !== 'object') return stats;
    for (const key of Object.keys(delta)) {
        const change = Number(delta[key]);
        if (!Number.isFinite(change) || change === 0) continue;
        const base = typeof stats[key] === 'number' && Number.isFinite(stats[key]) ? stats[key] : 0;
        stats[key] = Math.max(0, base - change);
    }
    return stats;
}
