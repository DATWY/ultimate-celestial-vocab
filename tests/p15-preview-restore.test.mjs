// tests/p15-preview-restore.test.mjs
//
// ĐƯỜNG PREVIEW/RESTORE (vòng 6) — `window.__testGamification.previewAllBadges()` + `reset()`.
//
// Đây là API **chỉ tồn tại trong chế độ phát triển** (`import.meta.env.DEV && ?audit=1`, DB audit
// tách biệt), dùng để xem trước huy hiệu/rank. `previewAllBadges` sao lưu `gamification` bằng
// deep-clone rồi bơm dữ liệu giả vào RAM; `reset()` khôi phục bằng `setGamification(this._backup)`.
//
// Câu hỏi: nếu bản lưu cũ thiếu hẳn `lastXPDate`, đường này có làm rơi khoá ngày (và do đó làm Undo
// trừ sai) không?
//
// Test chạy **nguyên văn thân hai hàm** của ứng dụng: khối `window.__testGamification = { … }` được
// trích từ `src/features/gamification.js`, chỉ thay cơ chế nạp module (`import('../core/state.js')`)
// bằng hàm bơm module thật — vì `new Function` không có dynamic import. Không viết lại logic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SPECIAL_BADGES } from '../src/features/badges.js';
import { rolloverDailyStats, trackAppOpen, trackXP } from '../src/features/stat-trackers.js';
import { snapshotReviewStats, diffReviewStats, revertReviewStats } from '../src/core/stats-rollback.js';
import { getLocalDateString } from '../src/core/utils/date.js';

const NOW = new Date(2026, 10, 3, 15, 0).getTime();
const TODAY = getLocalDateString(NOW);

globalThis.localStorage = globalThis.localStorage || {
    getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}
};

/**
 * Dựng lại object `window.__testGamification` từ chính mã nguồn của ứng dụng.
 * Chỉ thay cơ chế nạp module; `previewAllBadges`/`reset` giữ nguyên văn.
 */
function loadPreviewApi(stateModule) {
    const source = fs.readFileSync(new URL('../src/features/gamification.js', import.meta.url), 'utf8');
    const start = source.indexOf('window.__testGamification = {');
    assert.ok(start > 0, 'không tìm thấy khối __testGamification');
    const end = source.indexOf('\n};', start);
    assert.ok(end > start, 'không tìm thấy điểm kết thúc object literal');
    const literal = source.slice(start + 'window.__testGamification = '.length, end + 2);
    assert.match(literal, /^\{[\s\S]*\}$/, 'phải trích được object literal');

    const transformed = literal
        .replaceAll("import('../core/state.js')", '__importState()')
        .replaceAll("import('../features/badges.js')", '__importBadges()');
    assert.equal(transformed.includes('import('), false, 'không còn dynamic import trong khối trích');

    const factory = new Function('__importState', '__importBadges', 'document', 'CustomEvent', 'console',
        `return (${transformed});`);
    const silent = { log() {}, warn() {}, error() {}, info() {} };
    const doc = { getElementById: () => null, body: { classList: { add() {}, remove() {} } } };
    return factory(() => Promise.resolve(stateModule), () => Promise.resolve({ SPECIAL_BADGES }), doc, class {
        constructor(type, init) { this.type = type; this.detail = init?.detail; }
    }, silent);
}

const waitFor = async (predicate, label, timeoutMs = 3000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        if (predicate()) return true;
        await new Promise(r => setTimeout(r, 5));
    }
    throw new Error(`quá thời gian chờ: ${label}`);
};

const read = stats => ({
    hasOwn: !!stats && Object.hasOwn(stats, 'lastXPDate'),
    dayKey: stats ? stats.lastXPDate : null,
    xpToday: stats ? stats.xpToday : null,
    xpWeekTotal: stats ? stats.xpWeekTotal : null
});

test('R6: vào/thoát preview qua chính API ứng dụng vẫn giữ khoá ngày, Undo cho 7 rồi 8', async () => {
    const state = await import('../src/core/state.js');
    // Bản lưu CŨ: `xpToday` có, `lastXPDate` thiếu hẳn (không phải "").
    state.setGamification({ ...state.getState().gamification, userXP: 0, totalReviews: 0, stats: { xpToday: 5 } });
    const stats = state.getState().gamification.stats;
    assert.equal(Object.hasOwn(stats, 'lastXPDate'), false, 'điều kiện tái hiện: thiếu hẳn khoá');

    // Khối khởi động THẬT của main.js (trên chính object đang sống).
    rolloverDailyStats(stats, TODAY, 0);
    trackAppOpen(stats, NOW);
    const beforePreview = read(state.getState().gamification.stats);
    assert.deepEqual(beforePreview, { hasOwn: true, dayKey: '', xpToday: 5, xpWeekTotal: 0 },
        'sau khởi động: khoá hiện diện với giá trị rỗng');

    const api = loadPreviewApi(state);
    api.previewAllBadges();
    await waitFor(() => state.getState().gamification.stats.xpToday === 5000, 'preview áp dữ liệu giả');
    // Trong preview: dữ liệu giả nằm trên object sống, bản sao vẫn là dữ liệu gốc và là deep clone.
    assert.equal(read(state.getState().gamification.stats).xpToday, 5000);
    assert.equal(state.isPreviewMode(), true);
    assert.equal(api._backup.stats.xpToday, 5, 'bản sao phải giữ 5, không dính dữ liệu giả');
    assert.equal(Object.hasOwn(api._backup.stats, 'lastXPDate'), true, 'bản sao phải có khoá ngày');
    assert.equal(api._backup.stats.lastXPDate, '');
    assert.notEqual(api._backup, state.getState().gamification, 'phải là deep clone, không phải tham chiếu');

    api.reset();
    await waitFor(() => api._backup === null, 'reset hoàn tất');
    const restored = state.getState().gamification.stats;
    const afterRestore = read(restored);
    assert.deepEqual(afterRestore, { hasOwn: true, dayKey: '', xpToday: 5, xpWeekTotal: 0 },
        'sau khôi phục: khoá ngày còn hiện diện, XP về đúng 5');
    assert.equal(state.isPreviewMode(), false, 'phải thoát preview');
    assert.equal(restored.typingTotalCorrect, undefined, 'dữ liệu giả của preview không được còn lại');
    assert.equal(state.getState().gamification.userXP, 0);

    // Lượt A +5 (sau khôi phục), B +7, Undo riêng A, rồi +1.
    const snapshot = snapshotReviewStats(restored, TODAY);
    trackXP(restored, 5, NOW);
    const delta = diffReviewStats(snapshot, restored);
    trackXP(restored, 7, NOW + 60000);
    assert.deepEqual(read(restored), { hasOwn: true, dayKey: TODAY, xpToday: 12, xpWeekTotal: 12 });
    revertReviewStats(restored, snapshot, delta, TODAY);
    assert.deepEqual(read(restored), { hasOwn: true, dayKey: TODAY, xpToday: 7, xpWeekTotal: 7 },
        'Undo chỉ trừ phần A, giữ 7 của B');
    trackXP(restored, 1, NOW + 120000);
    assert.deepEqual(read(restored), { hasOwn: true, dayKey: TODAY, xpToday: 8, xpWeekTotal: 8 });
});

test('R6: preview giả lập rank cũng đi qua cùng reset() và giữ khoá ngày', async () => {
    const state = await import('../src/core/state.js');
    state.setGamification({ ...state.getState().gamification, userXP: 0, totalReviews: 0, stats: { xpToday: 5 } });
    const stats = state.getState().gamification.stats;
    rolloverDailyStats(stats, TODAY, 0);
    trackAppOpen(stats, NOW);

    const api = loadPreviewApi(state);
    api.previewRank(50);
    await waitFor(() => state.getState().gamification.currentLevel === 50, 'preview rank áp cấp');
    assert.ok(state.getState().gamification.userXP > 0, 'rank giả đổi userXP trong RAM');
    assert.equal(Object.hasOwn(api._backup.stats, 'lastXPDate'), true);

    api.reset();
    await waitFor(() => api._backup === null, 'reset hoàn tất');
    const restored = state.getState().gamification;
    assert.equal(restored.currentLevel, 1, 'cấp phải trở lại như cũ');
    assert.equal(restored.userXP, 0);
    assert.equal(Object.hasOwn(restored.stats, 'lastXPDate'), true, 'khoá ngày vẫn còn');
    assert.equal(restored.stats.xpToday, 5);
});
