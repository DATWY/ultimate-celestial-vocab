// Regression tests cho đợt nâng cấp: dedup (-er, dist-2, bucket cap, guard),
// FSRS-7 (S_short độc lập, cap 21 ngày sau fuzz) và bộ quét trùng bất đồng bộ.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    isDuplicateCard,
    findDuplicatePairs,
    findDuplicatePairsAsync,
    findInternalDuplicateCards
} from '../src/core/dedup.js';
import { calculateNextSrsState } from '../src/core/srs/index.js';

test('dedup: danh từ kết thúc -er không còn bị cắt thành gốc so sánh hơn', () => {
    const falsePairs = [
        ['matter', 'mat'], ['corner', 'corn'], ['leader', 'lead'], ['farmer', 'farm'],
        ['power', 'pow'], ['tower', 'tow'], ['hammer', 'ham'], ['banner', 'ban'],
        ['winner', 'win'], ['dinner', 'din'], ['flower', 'flow'], ['worker', 'work'],
        ['mother', 'moth'], ['brother', 'broth'], ['carrier', 'carry']
    ];
    for (const [englishA, englishB] of falsePairs) {
        const result = isDuplicateCard(
            { id: 'a', english: englishA, vietnamese: `nghĩa của ${englishA}`, type: 'n' },
            { id: 'b', english: englishB, vietnamese: `nghĩa của ${englishB}`, type: 'n' }
        );
        assert.equal(result.isDuplicate, false, `${englishA}/${englishB} phải là hai từ khác nhau`);
    }
});

test('dedup: so sánh hơn của tính từ vẫn được nhận diện', () => {
    const pairs = [
        ['slow', 'slower', 'chậm', 'chậm hơn'],
        ['big', 'bigger', 'to lớn', 'to lớn hơn'],
        ['late', 'later', 'muộn', 'muộn hơn']
    ];
    for (const [englishA, englishB, viA, viB] of pairs) {
        const result = isDuplicateCard(
            { id: 'a', english: englishA, vietnamese: viA, type: 'adj' },
            { id: 'b', english: englishB, vietnamese: viB, type: 'adj' }
        );
        assert.equal(result.isDuplicate, true, `${englishA}/${englishB} là biến thể so sánh hơn`);
    }
});

test('dedup: quét toàn kho bắt được lỗi chính tả Levenshtein 2 (maintenance/maintainance)', () => {
    const pairs = findDuplicatePairs([
        { id: '1', english: 'maintenance', vietnamese: 'bảo trì', type: 'n' },
        { id: '2', english: 'maintainance', vietnamese: 'bảo trì', type: 'n' }
    ]);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].cardA.english, 'maintenance');
});

test('dedup: bucket lớn hơn 100 phần tử không còn bỏ im lặng cặp trùng', () => {
    const K = 'abcdef';
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const fillers = [];
    for (let pos = 0; pos <= K.length && fillers.length < 100; pos++) {
        for (const ch of letters) {
            if (fillers.length >= 100) break;
            const w = K.slice(0, pos) + ch + K.slice(pos);
            fillers.push({ id: `f${fillers.length}`, english: w, vietnamese: `nghĩa ${w}`, type: 'n' });
        }
    }
    const vocab = [
        ...fillers,
        { id: 'ta', english: 'abcdefg', vietnamese: 'nghĩa giống hệt', type: 'n' },
        { id: 'tb', english: 'abcdefh', vietnamese: 'nghĩa giống hệt', type: 'n' }
    ];
    const pairs = findDuplicatePairs(vocab);
    assert.ok(pairs.some(pair => [pair.cardA.id, pair.cardB.id].sort().join() === 'ta,tb'));
});

test('dedup: thẻ thiếu id vẫn tạo được nhiều cặp độc lập', () => {
    const pairs = findDuplicatePairs([
        { english: 'apple', vietnamese: 'táo' },
        { english: 'Apple', vietnamese: 'táo' },
        { english: 'banana', vietnamese: 'chuối' },
        { english: 'Banana', vietnamese: 'chuối' }
    ]);
    assert.equal(pairs.length, 2);
});

test('dedup: dữ liệu sai kiểu không còn ném TypeError', () => {
    assert.doesNotThrow(() => isDuplicateCard({ english: 123 }, { english: '123' }));
    assert.equal(isDuplicateCard({ english: 123 }, { english: '123' }).isDuplicate, true);
    assert.equal(isDuplicateCard({ english: null }, { english: 'x' }).isDuplicate, false);
    assert.deepEqual(findInternalDuplicateCards(null), []);
    assert.deepEqual(findDuplicatePairs(null), []);
});

test('dedup: bản quét bất đồng bộ cho kết quả giống bản đồng bộ', async () => {
    const vocab = [
        { id: '1', english: 'Color', vietnamese: 'màu sắc' },
        { id: '2', english: 'colour', vietnamese: 'màu sắc' },
        { id: '3', english: 'cat', vietnamese: 'con mèo' },
        { id: '4', english: 'cats', vietnamese: 'những con mèo' },
        { id: '5', english: 'matter', vietnamese: 'vấn đề' },
        { id: '6', english: 'mat', vietnamese: 'tấm thảm' }
    ];
    const phases = [];
    const asyncPairs = await findDuplicatePairsAsync(vocab, {
        chunkSize: 2,
        onProgress: phase => phases.push(phase)
    });
    const syncPairs = findDuplicatePairs(vocab);
    assert.deepEqual(
        asyncPairs.map(pair => pair.key).sort(),
        syncPairs.map(pair => pair.key).sort()
    );
    assert.ok(phases.includes('index'));
    assert.ok(phases.includes('match'));
});

const DAY_MS = 86400000;
const now = Date.now();

test('FSRS-7: S_short không bị ép <= S_long sau lượt trả lời đúng', () => {
    const card = {
        id: 'p', english: 'hello', stability: 10, stabilityShort: 9, difficulty: 5,
        srsStatus: 'Mastered', reps: 5,
        lastReviewDate: now - 10 * DAY_MS, srsDueDate: now + 10 * DAY_MS
    };
    const { newState } = calculateNextSrsState(card, 3, 'en-vi', 0, null, true, { now });
    // Đối chiếu fsrs_v7.py: S_long 22.8645, S_short 195.451 với cùng đầu vào.
    assert.ok(Math.abs(newState.stability - 22.8645) < 0.01, `S_long=${newState.stability}`);
    assert.ok(Math.abs(newState.stabilityShort - 195.451) < 0.05, `S_short=${newState.stabilityShort}`);
    assert.ok(newState.stabilityShort > newState.stability, 'S_short phải được giữ độc lập');
});

test('FSRS-7: lapse vẫn cap S_short tại 0.8 * S_long', () => {
    const card = {
        id: 'l', english: 'lapse', stability: 50, stabilityShort: 40, difficulty: 5,
        srsStatus: 'Mastered', reps: 6,
        lastReviewDate: now - 20 * DAY_MS, srsDueDate: now
    };
    const { newState } = calculateNextSrsState(card, 1, 'en-vi', 0, null, true, { now });
    assert.ok(newState.stabilityShort <= 0.8 * newState.stability + 1e-9);
});

test('FSRS-7: thẻ mới không bao giờ vượt cap 21 ngày dù có fuzz', () => {
    let minInterval = Infinity;
    let maxInterval = -Infinity;
    for (let i = 0; i < 300; i++) {
        const { newState } = calculateNextSrsState({
            id: `n${i}`, english: `word${i}`, srsStatus: 'New', reps: 0
        }, 4, 'en-vi', 0, null, false, { now });
        minInterval = Math.min(minInterval, newState.srsInterval);
        maxInterval = Math.max(maxInterval, newState.srsInterval);
    }
    assert.ok(minInterval >= 1.0, `min=${minInterval}`);
    assert.ok(maxInterval <= 21.0, `max=${maxInterval}`);
});

test('FSRS-7: mergeCardFields and parseVocabularyTsv preserve S_short > S_long without clamping', async () => {
    const { mergeCardFields } = await import('../src/core/card-merge.js');
    const { parseVocabularyTsv } = await import('../src/core/tabular.js');

    const local = { id: 'c1', english: 'word', stability: 10, stabilityShort: 50, updatedAt: 100, srsUpdatedAt: 100 };
    const remote = { id: 'c1', english: 'word', stability: 10, stabilityShort: 50, updatedAt: 200, srsUpdatedAt: 200 };
    const merged = mergeCardFields(local, remote);
    assert.equal(merged.stabilityShort, 50);
    assert.ok(merged.stabilityShort > merged.stability);

    const tsv = 'word\ttừ\tnoun\t/wɜːd/\tExample\tfalse\tMastered\t1700000000000\ttag\t0\tfalse\t10\t2.5\t5\t10\t5\t0\t1700000000000\t50';
    const parsed = parseVocabularyTsv(tsv);
    assert.equal(parsed.errors.length, 0);
    assert.equal(parsed.rows[0].card.stabilityShort, 50);
    assert.ok(parsed.rows[0].card.stabilityShort > parsed.rows[0].card.stability);
});

test('dedup: exact-match groups with >600 cards detect duplicate pairs and do not silently drop', () => {
    const cards = [];
    for (let i = 0; i < 601; i++) {
        cards.push({ id: `dup-${i}`, english: 'identical', vietnamese: 'giống hệt', type: 'n' });
    }
    const pairs = findDuplicatePairs(cards);
    assert.ok(pairs.length > 0, 'Must detect duplicate pairs within >600 identical cards');
    assert.equal(pairs[0].cardA.english, 'identical');
});

test('dedup: oversized buckets do not collapse to a single representative (mixed POS)', () => {
    // 1 noun + 200 verbs sharing one spelling: every card must still be reachable by a pair,
    // instead of comparing everything only against cards[0].
    const cards = [{ id: 'n0', english: 'run', vietnamese: 'Sự chạy', type: 'noun' }];
    for (let i = 0; i < 200; i++) cards.push({ id: `v${i}`, english: 'run', vietnamese: 'Chạy', type: 'verb' });

    const pairs = findDuplicatePairs(cards);
    const covered = new Set(pairs.flatMap(p => [p.cardA.id, p.cardB.id]));
    assert.equal(covered.size, 201, `every card must be covered, got ${covered.size}`);
});

test('import: only changed rows create durable outbox entries (bounded dirty set)', async () => {
    const { initAppDB, saveAllVocabularyToDB, getPendingCardIds } = await import('../src/core/idb.js');
    const db = await initAppDB();
    try {
        const seed = [];
        for (let i = 0; i < 200; i++) seed.push({ id: `seed${i}`, english: `w${i}`, vietnamese: `n${i}`, srsStatus: 'New' });
        await saveAllVocabularyToDB(seed, { markDirty: false });
        assert.equal((await getPendingCardIds()).length, 0, 'baseline outbox must be empty');

        const dirtyIds = new Set(['seed3', 'new-1']);
        const proposed = [...seed.map(c => (c.id === 'seed3' ? { ...c, vietnamese: 'đã sửa' } : c)),
            { id: 'new-1', english: 'brandnew', vietnamese: 'mới', srsStatus: 'New' }];
        await saveAllVocabularyToDB(proposed, { markDirty: false, dirtyIds });

        const pending = await getPendingCardIds();
        assert.equal(pending.length, 2, `exactly the changed rows must be queued, got ${pending.length}`);
        assert.ok(pending.includes('seed3') && pending.includes('new-1'));
    } finally {
        db.close();
    }
});
