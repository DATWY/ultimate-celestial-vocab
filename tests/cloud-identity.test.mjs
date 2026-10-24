// Kiểm tra lớp định danh Cloud (Mã đồng bộ) không cần trình duyệt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeSyncKey,
    formatSyncKey,
    getCurrentUserId,
    ensureCloudAuth
} from '../src/core/firebase.js';

test('sync key: chuẩn hóa bỏ dấu gạch, viết hoa, từ chối mã quá ngắn/ký tự lạ', () => {
    assert.equal(normalizeSyncKey('abcd-efgh-2345-6789'), 'ABCDEFGH23456789');
    assert.equal(normalizeSyncKey('  P2YV 9NNS CHX9 8B4M B895  '), 'P2YV9NNSCHX98B4MB895');
    assert.equal(normalizeSyncKey('short'), '');
    assert.equal(normalizeSyncKey(''), '');
    assert.equal(normalizeSyncKey(null), '');
    assert.equal(normalizeSyncKey(12345), '');
    assert.equal(normalizeSyncKey('ABCDEFGH23456789!@#$'), 'ABCDEFGH23456789');
});

test('sync key: hiển thị theo nhóm 4 ký tự và không làm mất dữ liệu', () => {
    assert.equal(formatSyncKey('ABCDEFGH23456789'), 'ABCD-EFGH-2345-6789');
    assert.equal(formatSyncKey('P2YV9NNSCHX98B4MB895'), 'P2YV-9NNS-CHX9-8B4M-B895');
    const raw = 'ABCDEFGH23456789';
    assert.equal(normalizeSyncKey(formatSyncKey(raw)), raw);
});

test('cloud identity: không có phiên đăng nhập thì không trả uid giả', async () => {
    assert.equal(getCurrentUserId(), null);
    const user = await ensureCloudAuth();
    // Node không có Firebase Auth khả dụng -> local-only, không ném lỗi.
    assert.ok(user === null || typeof user.uid === 'string');
});
