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

test('cùng chuỗi version nhưng buildTime mới hơn ⇒ VẪN phải cập nhật', () => {
    // Sự cố thật 2026-10-29: hai deploy trong CÙNG MỘT GIỜ cho ra cùng chuỗi
    // DATWY.V2.261029.19. Client cũ so chuỗi ⇒ tưởng "đã mới nhất" ⇒ không bao giờ
    // nhận bản sửa CSS. Nay phải so thêm mốc dựng.
    const SAME = 'DATWY.V2.261029.19';
    const older = '2026-10-29T12:02:56.027Z';
    const newer = '2026-10-29T12:12:02.470Z';

    assert.equal(
        decideVersionAction({
            hosted: SAME, local: SAME, hostedBuildTime: newer, localBuildTime: older,
            lastReload: null, now: NOW, online: true
        }),
        'reload',
        'cùng version nhưng build mới hơn phải reload'
    );
    assert.equal(
        decideVersionAction({
            hosted: SAME, local: SAME, hostedBuildTime: older, localBuildTime: older,
            lastReload: null, now: NOW, online: true
        }),
        'none',
        'đúng bản đang chạy thì không làm gì'
    );
    assert.equal(
        decideVersionAction({
            hosted: SAME, local: SAME, hostedBuildTime: older, localBuildTime: newer,
            lastReload: null, now: NOW, online: true
        }),
        'none',
        'server cũ hơn (rollback đang tải dở) không được kích reload'
    );
});

test('guard ghi kèm buildTime: bản dựng mới cùng version vẫn được reload 1 lần', () => {
    const SAME = 'DATWY.V2.261029.19';
    const first = '2026-10-29T12:02:56.027Z';
    const second = '2026-10-29T12:12:02.470Z';
    const third = '2026-10-29T12:30:00.000Z';

    // Lần 1: guard cho bản dựng 'first' (đã auto-reload cho nó)
    assert.equal(
        decideVersionAction({
            hosted: SAME, local: SAME, hostedBuildTime: second, localBuildTime: first,
            lastReload: { version: SAME, buildTime: first, at: NOW - HOUR }, now: NOW, online: true
        }),
        'reload',
        'guard của bản dựng CŨ không được chặn bản dựng mới'
    );
    // Lần 2: guard đã là 'second' ⇒ cùng bản dựng ⇒ chỉ cảnh báo (chống loop)
    assert.equal(
        decideVersionAction({
            hosted: SAME, local: SAME, hostedBuildTime: second, localBuildTime: first,
            lastReload: { version: SAME, buildTime: second, at: NOW - HOUR }, now: NOW, online: true
        }),
        'notify',
        'đã auto-reload cho đúng bản dựng này rồi thì chỉ cảnh báo'
    );
    // Lần 3: có bản dựng thứ ba ⇒ lại được reload
    assert.equal(
        decideVersionAction({
            hosted: SAME, local: SAME, hostedBuildTime: third, localBuildTime: second,
            lastReload: { version: SAME, buildTime: second, at: NOW - HOUR }, now: NOW, online: true
        }),
        'reload'
    );
});

test('thiếu buildTime (client cũ / server cũ) vẫn giữ hành vi cũ', () => {
    assert.equal(
        decideVersionAction({ hosted: OLD, local: OLD, lastReload: null, now: NOW, online: true }),
        'none'
    );
    assert.equal(
        decideVersionAction({ hosted: NEW, local: OLD, lastReload: null, now: NOW, online: true }),
        'reload'
    );
    // buildTime rác không được làm hỏng quyết định
    assert.equal(
        decideVersionAction({
            hosted: NEW, local: OLD, hostedBuildTime: 'không-phải-ngày', localBuildTime: 'cũng-không',
            lastReload: null, now: NOW, online: true
        }),
        'reload'
    );
});
