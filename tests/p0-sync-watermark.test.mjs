// tests/p0-sync-watermark.test.mjs — SYNC-01.
//
// Sự cố thật: `mergeCardFields` xoá `syncedAt` (card-merge.js:101) và không chỗ nào
// ghi `syncedAt` cho thẻ local, nên Phase 2 của smartSync coi MỌI thẻ chưa-pull là
// "chưa từng sync" (firebase.js:807). Hệ quả kép:
//   1. Mỗi lần sync đẩy lại hàng nghìn thẻ vào `writeMergedCards`, nơi mỗi thẻ là
//      một `transaction.get` (đọc) — "bão đọc" đốt quota.
//   2. `cardsToPush` vượt 50 ở background ⇒ Quota Shield đặt `cardsToPush.length = 0`
//      (firebase.js:817), nuốt luôn `convergedCardsToPush` — tức là mất phần merge
//      cần đẩy lên, hai máy không bao giờ hội tụ.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeCardFields, isSrsEqual } from '../src/core/card-merge.js';
import { planPushBatch } from '../src/core/push-plan.js';

const card = (over = {}) => ({
    id: 'c1',
    english: 'hello',
    vietnamese: 'xin chào',
    tags: [],
    srsStatus: 'Review',
    srsDueDate: 0,
    srsInterval: 1,
    srsEaseFactor: 2.5,
    stability: 1,
    stabilityShort: 1,
    difficulty: 5,
    reps: 1,
    lapses: 0,
    lastReviewDate: 0,
    updatedAt: 1000,
    contentUpdatedAt: 1000,
    srsUpdatedAt: 1000,
    flagsUpdatedAt: 1000,
    ...over
});

test('mergeCardFields giữ mốc syncedAt lớn nhất thay vì xoá trắng', () => {
    // Local đã sync lúc 5.000; remote vừa được pull về với syncedAt 9.000.
    const merged = mergeCardFields(card({ syncedAt: 5000 }), card({ syncedAt: 9000, updatedAt: 9000 }));
    assert.equal(merged.syncedAt, 9000, 'phải giữ mốc mới nhất, nếu không Phase 2 sẽ đẩy lại thẻ này mãi mãi');

    // Merge có tính giao hoán: đảo hai vế vẫn ra cùng mốc.
    const swapped = mergeCardFields(card({ syncedAt: 9000 }), card({ syncedAt: 5000 }));
    assert.equal(swapped.syncedAt, 9000);

    // Chưa từng sync (cả hai đều 0) thì không được tạo mốc giả.
    const never = mergeCardFields(card(), card());
    assert.equal(Object.hasOwn(never, 'syncedAt'), false, 'thẻ chưa sync không được có syncedAt');
});

test('mergeCardFields không mang _lastModifiedBy của máy khác vào dữ liệu local', () => {
    const merged = mergeCardFields(card({ _lastModifiedBy: 'dev_a' }), card({ _lastModifiedBy: 'dev_b' }));
    assert.equal(Object.hasOwn(merged, '_lastModifiedBy'), false);
});

test('isSrsEqual vẫn bỏ qua syncedAt (so sánh nội dung, không so mốc sync)', () => {
    assert.equal(isSrsEqual(card({ syncedAt: 1 }), card({ syncedAt: 999999 })), true);
});

test('planPushBatch: thẻ hội tụ KHÔNG bị Quota Shield nuốt', () => {
    const converged = [{ id: 'x1' }, { id: 'x2' }];
    const fresh = Array.from({ length: 300 }, (_, i) => ({ id: 'a' + i }));
    const plan = planPushBatch({ converged, fresh, isManual: false, maxBackground: 50 });

    const ids = plan.items.map(i => i.id);
    assert.ok(
        ids.includes('x1') && ids.includes('x2'),
        'thẻ hội tụ là thứ duy nhất khiến hai máy giống nhau — không được bỏ'
    );
    assert.equal(plan.deferred, 250, 'phần thẻ mới dư ra phải được BÁO là hoãn, không phải biến mất');
    assert.ok(plan.items.length <= 50 + converged.length);
});

test('planPushBatch: background đẩy theo lô nhỏ để không đốt quota', () => {
    const fresh = Array.from({ length: 120 }, (_, i) => ({ id: 'b' + i }));
    const plan = planPushBatch({ converged: [], fresh, isManual: false, maxBackground: 50 });
    assert.equal(plan.items.length, 50);
    assert.equal(plan.deferred, 70);
});

test('planPushBatch: sync thủ công đẩy hết, không hoãn', () => {
    const fresh = Array.from({ length: 120 }, (_, i) => ({ id: 'b' + i }));
    const plan = planPushBatch({ converged: [{ id: 'x' }], fresh, isManual: true, maxBackground: 50 });
    assert.equal(plan.items.length, 121);
    assert.equal(plan.deferred, 0);
});

test('planPushBatch: khử trùng lặp giữa converged và fresh theo id', () => {
    const shared = { id: 'dup', english: 'converged' };
    const plan = planPushBatch({
        converged: [shared],
        fresh: [{ id: 'dup', english: 'fresh' }, { id: 'other' }],
        isManual: true,
        maxBackground: 50
    });
    assert.equal(plan.items.filter(i => i.id === 'dup').length, 1);
    assert.equal(
        plan.items.find(i => i.id === 'dup').english,
        'converged',
        'bản hội tụ (đã merge với remote) phải thắng bản local thô'
    );
});
