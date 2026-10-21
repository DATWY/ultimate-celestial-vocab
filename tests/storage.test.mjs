import 'fake-indexeddb/auto';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { initAppDB, saveWordToDB, saveAllVocabularyToDB, getAllVocabularyFromDB,
    getPendingCardIds, getPendingWriteSnapshot, acknowledgePendingWrites, saveProgressToDB,
    getSettingFromDB, saveReviewLogsToDB } from '../src/core/idb.js';
import { initializeProgress, captureProgress } from '../src/core/progress-merge.js';

const database = await initAppDB();
after(() => database.close());
const card = id => ({ id, english: 'cat', vietnamese: 'mèo', pronunciation: '/kæt/', tags: [],
    contentUpdatedAt: 100, srsUpdatedAt: 100, flagsUpdatedAt: 100, updatedAt: 100, srsStatus: 'Mastered', reps: 3, stability: 5 });

test('concurrent local writes retain one tab’s edit and another tab’s review', async () => {
    const base = card('two-tabs');
    await saveWordToDB(base, { markDirty: false });
    await Promise.all([
        saveWordToDB({ ...base, vietnamese: 'nghĩa mới', contentUpdatedAt: 200, updatedAt: 200 }),
        saveWordToDB({ ...base, reps: 4, stability: 20, srsUpdatedAt: 300, updatedAt: 300 })
    ]);
    const saved = (await getAllVocabularyFromDB()).find(card => card.id === base.id);
    assert.equal(saved.vietnamese, 'nghĩa mới'); assert.equal(saved.stability, 20);
    assert.ok((await getPendingCardIds()).includes(base.id));
});

test('acknowledging an older request cannot delete a newer durable outbox entry', async () => {
    const base = card('outbox-race');
    await saveWordToDB(base);
    const sending = await getPendingWriteSnapshot([base.id]);
    await saveWordToDB({ ...base, pronunciation: '/new/', contentUpdatedAt: 500, updatedAt: 500 });
    assert.deepEqual(await acknowledgePendingWrites(sending), []);
    assert.ok((await getPendingCardIds()).includes(base.id));
    const latest = await getPendingWriteSnapshot([base.id]);
    assert.equal(latest[0].card.pronunciation, '/new/');
    assert.deepEqual(await acknowledgePendingWrites(latest), [base.id]);
    assert.ok(!(await getPendingCardIds()).includes(base.id));
});

test('cloud readback does not mark a card dirty or clear a pending edit', async () => {
    const base = card('cloud-readback');
    await saveWordToDB(base);
    const before = await getPendingWriteSnapshot([base.id]);
    await saveWordToDB({ ...base, stability: 50, srsUpdatedAt: 500, updatedAt: 500 }, { markDirty: false });
    const after = await getPendingWriteSnapshot([base.id]);
    assert.equal(after[0].revision, before[0].revision);
    assert.equal(after[0].card.stability, 50);
});

test('bulk import and tombstones are persisted atomically with their outbox', async () => {
    await saveAllVocabularyToDB([card('bulk-a'), { ...card('bulk-b'), isDeleted: true, deletedAt: 500, updatedAt: 500 }], { markDirty: true });
    const pending = await getPendingWriteSnapshot(['bulk-a', 'bulk-b']);
    assert.equal(pending.length, 2); assert.ok(pending.every(row => typeof row.revision === 'string' && row.revision.length > 0));
    assert.equal(pending[1].card.isDeleted, true);
});

test('two offline tabs cannot overwrite each other’s progress in shared IndexedDB', async () => {
    const initial = initializeProgress({ userXP: 1000, totalReviews: 10, stats: {} }, 'gamification');
    const a = structuredClone(initial), b = structuredClone(initial);
    a.userXP += 15; a.totalReviews++; captureProgress(a, 'gamification', 'tab-A', 100);
    b.userXP -= 800; captureProgress(b, 'gamification', 'tab-B', 100);
    await Promise.all([saveProgressToDB('gamification', a, 'gamification'), saveProgressToDB('gamification', b, 'gamification')]);
    const saved = await getSettingFromDB('gamification');
    assert.equal(saved.userXP, 215); assert.equal(saved.totalReviews, 11);
    await saveProgressToDB('gamification', a, 'gamification');
    assert.equal((await getSettingFromDB('gamification')).userXP, 215);
});

test('local review history merges additions and exact Undo across tabs', async () => {
    const a = { dict: ['cat'], logs: [[0,3,1,100,0,'a']] };
    const b = { dict: ['cat'], logs: [[0,1,2,200,0,'b']] };
    await Promise.all([saveReviewLogsToDB(a), saveReviewLogsToDB(b)]);
    assert.equal((await getSettingFromDB('reviewLogs')).logs.length, 2);
    await saveReviewLogsToDB({ dict: [], logs: [], deletedIds: ['a'] });
    await saveReviewLogsToDB(a); // stale tab reconnects
    const saved = await getSettingFromDB('reviewLogs');
    assert.equal(saved.logs.length, 1); assert.equal(saved.logs[0][5], 'b');
});

test('a late second tab acknowledgement cannot clear an edit created after the first acknowledgement', async () => {
    const original = card('outbox-aba');
    await saveWordToDB(original);
    const requestA = await getPendingWriteSnapshot([original.id]);
    const requestB = await getPendingWriteSnapshot([original.id]);
    await acknowledgePendingWrites(requestA);
    await saveWordToDB({ ...original, example: 'A later edit.', contentUpdatedAt: 1000, updatedAt: 1000 });
    assert.deepEqual(await acknowledgePendingWrites(requestB), []);
    assert.ok((await getPendingCardIds()).includes(original.id));
});
