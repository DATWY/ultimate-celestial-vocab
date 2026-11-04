// tests/p16-audit-isolation.test.mjs
//
// HAI LỖI ĐÃ TÁI HIỆN BẰNG TRÌNH DUYỆT (xem reports/logic-audit-2026-11-03/
// evidence-production-audit/tab-domains-before.json):
//
//  A. `previewAllBadges()` gọi hai lần rồi `reset()` ⇒ `_backup` bị ghi đè bằng chính dữ liệu
//     giả, nên "khôi phục" trả lại 5000 XP / typingTotalCorrect 1000. Callback nạp badges
//     còn có thể chạy SAU reset và bơm badge giả vào object vừa khôi phục.
//  B. Tab audit (`?audit=1`, DB riêng) và tab thường dùng chung BroadcastChannel
//     `celestial_tab_bus` ⇒ progress/card của tab audit chảy sang tab thường và được tab
//     thường ghi bền xuống DB thật (typingTotalCorrect=1000, monthlyTotal=100, badges=90,
//     thẻ `audit-marker`).
//
// Test này khoá cả hai: (1) snapshot/khôi phục của preview, (2) kênh vận chuyển tách theo
// miền lưu trữ. Luồng trình duyệt hai tab được kiểm riêng bằng scratch/probe-tab-domains.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SPECIAL_BADGES } from '../src/features/badges.js';
import { channelNameFor, leaderLockNameFor, acceptsMessage, transportDomain } from '../src/core/transport-domain.js';

globalThis.localStorage = globalThis.localStorage || {
    getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}
};

/** Trích nguyên văn khối `window.__testGamification` (chỉ thay cơ chế nạp module). */
function loadPreviewApi(stateModule, { badgesPromise } = {}) {
    const source = fs.readFileSync(new URL('../src/features/gamification.js', import.meta.url), 'utf8');
    const start = source.indexOf('window.__testGamification = {');
    assert.ok(start > 0, 'không tìm thấy khối __testGamification');
    const end = source.indexOf('\n};', start);
    const literal = source.slice(start + 'window.__testGamification = '.length, end + 2);
    const transformed = literal
        .replaceAll("import('../core/state.js')", '__importState()')
        .replaceAll("import('../features/badges.js')", '__importBadges()');
    const factory = new Function('__importState', '__importBadges', 'document', 'CustomEvent', 'console',
        `return (${transformed});`);
    const silent = { log() {}, warn() {}, error() {}, info() {} };
    const doc = { getElementById: () => null, body: { classList: { add() {}, remove() {} } } };
    return factory(
        () => Promise.resolve(stateModule),
        () => badgesPromise || Promise.resolve({ SPECIAL_BADGES }),
        doc, class { constructor(t, i) { this.type = t; this.detail = i?.detail; } }, silent
    );
}

const waitFor = async (predicate, label, timeoutMs = 3000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        if (predicate()) return;
        await new Promise(r => setTimeout(r, 5));
    }
    throw new Error(`quá thời gian chờ: ${label}`);
};
const flush = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 5)); };

const seedState = async xpToday => {
    const state = await import('../src/core/state.js');
    state.setGamification({
        ...state.getState().gamification, userXP: 0, currentLevel: 1,
        stats: { xpToday }, unlockedBadges: []
    });
    return state;
};

// ───────────────── A. Snapshot preview ─────────────────
test('A1: previewAllBadges gọi HAI lần rồi reset() phải trả lại dữ liệu gốc, không phải dữ liệu giả', async () => {
    const state = await seedState(5);
    const api = loadPreviewApi(state);
    api.previewAllBadges();
    await waitFor(() => state.getState().gamification.stats.xpToday === 5000, 'preview lần 1');
    api.previewAllBadges();
    await flush();
    assert.equal(api._backup.stats.xpToday, 5, 'bản sao phải là dữ liệu gốc của phiên đầu');

    api.reset();
    await waitFor(() => api._backup === null, 'reset hoàn tất');
    const g = state.getState().gamification;
    assert.equal(g.stats.xpToday, 5, 'reset phải trả lại 5, không phải 5000');
    assert.equal(g.stats.typingTotalCorrect, undefined, 'không được giữ counter giả');
    assert.equal(g.stats.monthlyTotal, undefined);
    assert.equal((g.unlockedBadges || []).length, 0, 'không được giữ badge giả');
    assert.equal(state.isPreviewMode(), false);
});

test('A2: reset() ngay sau khi gọi preview (callback còn chờ nạp module) không được để lại dữ liệu giả', async () => {
    const state = await seedState(5);
    const api = loadPreviewApi(state);
    api.previewAllBadges();   // callback state.js còn ở microtask
    api.reset();              // huỷ phiên trước khi callback chạy
    await flush(12);
    const g = state.getState().gamification;
    assert.equal(g.stats.xpToday, 5);
    assert.equal(g.stats.typingTotalCorrect, undefined);
    assert.equal(api._backup, null);
});

// Lưu ý phạm vi: reset() hiện THAY object gamification, nên callback muộn chỉ chạm object cũ;
// test này là lớp phòng thủ thứ hai (sẽ bắt lỗi nếu sau này reset() gộp tại chỗ thay vì thay
// object). Lớp thứ nhất là A1/A2.
test('A3: callback nạp badges về SAU reset() không được bơm badge giả vào state đã khôi phục', async () => {
    const state = await seedState(5);
    let release;
    const badgesPromise = new Promise(resolve => { release = () => resolve({ SPECIAL_BADGES }); });
    const api = loadPreviewApi(state, { badgesPromise });
    api.previewAllBadges();
    await waitFor(() => state.getState().gamification.stats.xpToday === 5000, 'preview áp dữ liệu');
    api.reset();
    await waitFor(() => api._backup === null, 'reset hoàn tất');
    release();                 // badges "về muộn"
    await flush(12);
    const g = state.getState().gamification;
    assert.equal(g.stats.xpToday, 5);
    assert.deepEqual(g.unlockedBadges, [], 'badge của phiên preview đã bị huỷ phải không quay lại');
    assert.equal(state.isPreviewMode(), false, 'reset không được bật lại preview mode');
});

test('A4: preview → reset → preview → reset vẫn trả đúng dữ liệu gốc', async () => {
    const state = await seedState(7);
    const api = loadPreviewApi(state);
    for (let round = 0; round < 2; round++) {
        api.previewAllBadges();
        await waitFor(() => state.getState().gamification.stats.xpToday === 5000, `vòng ${round} preview`);
        api.reset();
        await waitFor(() => api._backup === null, `vòng ${round} reset`);
    }
    const g = state.getState().gamification;
    assert.equal(g.stats.xpToday, 7);
    assert.equal(g.stats.typingTotalCorrect, undefined);
    assert.deepEqual(g.unlockedBadges, []);
});

// ───────────────── B. Miền vận chuyển ─────────────────
test('B1: kênh và Web Lock của tab audit tách khỏi tab thường, tên cũ giữ nguyên', () => {
    const normal = transportDomain(false);
    const audit = transportDomain(true);
    assert.equal(normal, 'default');
    assert.equal(audit, 'audit');
    assert.equal(channelNameFor(normal), 'celestial_tab_bus', 'tab thường phải giữ tên kênh cũ');
    assert.equal(leaderLockNameFor(normal), 'celestial_sync_leader', 'tab thường phải giữ tên lock cũ');
    assert.notEqual(channelNameFor(audit), channelNameFor(normal));
    assert.notEqual(leaderLockNameFor(audit), leaderLockNameFor(normal));
});

test('B2: lọc thông điệp theo miền — audit ⇄ thường bị chặn, cùng miền vẫn thông, thông điệp cũ coi là default', () => {
    // Cùng miền: thông (đồng bộ thường ↔ thường và audit ↔ audit vẫn chạy).
    assert.equal(acceptsMessage('default', 'default'), true);
    assert.equal(acceptsMessage('audit', 'audit'), true);
    // Khác miền: chặn cả hai hướng, kể cả khi bật tương thích ngược.
    assert.equal(acceptsMessage('default', 'audit'), false);
    assert.equal(acceptsMessage('audit', 'default'), false);
    assert.equal(acceptsMessage('default', 'audit', true), false);
    // Thông điệp kiểu cũ (không có domain) — production coi là tab thường bản trước.
    assert.equal(acceptsMessage('default', undefined, true), true, 'production: không phá đồng bộ liên phiên bản');
    assert.equal(acceptsMessage('audit', undefined, true), false, 'audit không bao giờ trộn dữ liệu thật');
    // DEV: tab audit CŨ cũng gửi thông điệp không có domain ⇒ phải từ chối TẤT CẢ.
    assert.equal(acceptsMessage('default', undefined, false), false,
        'DEV: không thể phân biệt tab thường cũ với tab audit cũ ⇒ từ chối để bịt khe hở');
    assert.equal(acceptsMessage('audit', undefined, false), false);
    // Tab DEV cùng phiên bản (đều gắn domain) vẫn đồng bộ.
    assert.equal(acceptsMessage('default', 'default', false), true);
    assert.equal(acceptsMessage('audit', 'audit', false), true);
});

test('B3: tab-bus dùng đúng miền lưu trữ và khai báo domain trên mọi thông điệp', () => {
    const src = fs.readFileSync(new URL('../src/core/tab-bus.js', import.meta.url), 'utf8');
    assert.match(src, /import \{ storageDomain \} from '\.\/idb\.js'/, 'phải lấy miền từ idb.js (một nguồn duy nhất)');
    assert.match(src, /channelNameFor\(storageDomain\)/);
    assert.match(src, /leaderLockNameFor\(storageDomain\)/);
    assert.match(src, /acceptsMessage\(storageDomain, data\.domain, ALLOW_LEGACY_MESSAGES\)/, 'phải lọc thông điệp nhận');
    assert.match(src, /const ALLOW_LEGACY_MESSAGES = !\(.*import\.meta\.env\?\.DEV\)/, 'chỉ production mới nhận thông điệp kiểu cũ');
    assert.match(src, /domain: storageDomain/, 'phải khai báo domain khi gửi');
});
