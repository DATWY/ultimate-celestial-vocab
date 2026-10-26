// tests/version-guard.test.mjs
// T2.1 — Luật chống reload loop: decideVersionAction() là hàm thuần nên test
// được toàn bộ ma trận quyết định mà không cần DOM / CacheStorage / mạng.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    decideVersionAction,
    isAppCacheName,
    RELOAD_GUARD_WINDOW_MS
} from '../src/core/versionCheck.js';

const NOW = 1_800_000_000_000; // mốc cố định, không phụ thuộc đồng hồ máy chạy test
const HOUR = 60 * 60 * 1000;
const OLD = 'DATWY.V2.261025.15';
const NEW = 'DATWY.V2.261126.16';

test('offline: lệch phiên bản vẫn không reload, không xoá cache', () => {
    // Mất mạng thì HTML cũ là hợp lệ — reload sẽ xoá sạch cache vô ích.
    assert.equal(
        decideVersionAction({ hosted: NEW, local: OLD, lastReload: null, now: NOW, online: false }),
        'none'
    );
    // Offline thắng cả trường hợp đã hết hạn 24h.
    assert.equal(
        decideVersionAction({ hosted: NEW, local: OLD, lastReload: { version: NEW, at: NOW - 30 * HOUR }, now: NOW, online: false }),
        'none'
    );
});

test('phiên bản khớp (hoặc thiếu dữ liệu) → không làm gì', () => {
    assert.equal(
        decideVersionAction({ hosted: OLD, local: OLD, lastReload: null, now: NOW, online: true }),
        'none'
    );
    // /version.json thiếu field version: không đủ căn cứ để phá app.
    assert.equal(
        decideVersionAction({ hosted: null, local: OLD, lastReload: null, now: NOW, online: true }),
        'none'
    );
});

test('lệch phiên bản, chưa từng auto-reload → reload đúng 1 lần', () => {
    assert.equal(
        decideVersionAction({ hosted: NEW, local: OLD, lastReload: null, now: NOW, online: true }),
        'reload'
    );
});

test('đã auto-reload cho cùng version trong 24h → chỉ cảnh báo', () => {
    assert.equal(
        decideVersionAction({
            hosted: NEW,
            local: OLD,
            lastReload: { version: NEW, at: NOW - 1 * HOUR },
            now: NOW,
            online: true
        }),
        'notify'
    );
});

test('guard quá 24h → cho reload lại một lần', () => {
    assert.equal(RELOAD_GUARD_WINDOW_MS, 24 * HOUR);
    assert.equal(
        decideVersionAction({
            hosted: NEW,
            local: OLD,
            lastReload: { version: NEW, at: NOW - 25 * HOUR },
            now: NOW,
            online: true
        }),
        'reload'
    );
    // Đúng mốc biên 24h cũng phải coi là hết hạn (so sánh <), tránh kẹt vĩnh viễn.
    assert.equal(
        decideVersionAction({
            hosted: NEW,
            local: OLD,
            lastReload: { version: NEW, at: NOW - RELOAD_GUARD_WINDOW_MS },
            now: NOW,
            online: true
        }),
        'reload'
    );
});

test('version lùi (bundle mới hơn version.json) vẫn reload đúng 1 lần rồi dừng', () => {
    // server trả bản CŨ hơn bundle đang chạy (deploy lệch / rollback)
    assert.equal(
        decideVersionAction({ hosted: OLD, local: NEW, lastReload: null, now: NOW, online: true }),
        'reload'
    );
});

test('sự cố thật: HTML mới hơn version.json → reload 1 lần, lần sau chỉ cảnh báo', () => {
    // Lần đầu: chưa có guard → reload.
    const first = decideVersionAction({ hosted: OLD, local: NEW, lastReload: null, now: NOW, online: true });
    assert.equal(first, 'reload');

    // Sau reload, bundle vẫn mới hơn version.json và guard đã ghi cho OLD →
    // tab visible / boot lại chỉ được cảnh báo, không reload nữa (hết loop).
    const second = decideVersionAction({
        hosted: OLD,
        local: NEW,
        lastReload: { version: OLD, at: NOW - 2 * HOUR },
        now: NOW,
        online: true
    });
    assert.equal(second, 'notify');
});

test('guard của phiên bản khác không chặn bản mới', () => {
    // Đã reload cho NEW1 cách đây 5 phút, giờ server có NEW2 → phải reload.
    assert.equal(
        decideVersionAction({
            hosted: NEW,
            local: OLD,
            lastReload: { version: 'DATWY.V2.261120.10', at: NOW - 5 * 60 * 1000 },
            now: NOW,
            online: true
        }),
        'reload'
    );
});

test('chỉ xoá cache của app, không đụng cache lạ', () => {
    assert.equal(isAppCacheName('workbox-precache-v2-https://celestial.web.app/'), true);
    assert.equal(isAppCacheName('firebase-chunk-cache'), true);
    assert.equal(isAppCacheName('celestial-audio-v1'), true);
    assert.equal(isAppCacheName('some-other-app-cache'), false);
    assert.equal(isAppCacheName(undefined), false);
});
