// T1.5 — Cap số lượt ôn/ngày.
//
// Khoá các hành vi người dùng thấy được:
//   • mặc định 200, kẹp [50, 500], giá trị rác/thiếu → 200;
//   • cap cắt ĐÚNG số thẻ đến hạn được nạp, thẻ bị hoãn vẫn `due` + giữ hạn;
//   • thẻ Learning sub-day (1p/10p) KHÔNG bị cap chặn;
//   • cap thẻ mới vẫn độc lập nhưng tổng thẻ mới + đến hạn không vượt trần;
//   • đổi setting có hiệu lực ngay và sống qua reload (IndexedDB settings).
import 'fake-indexeddb/auto';
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initAppDB, getSettingFromDB, saveSettingToDB } from '../src/core/idb.js';
import { getState, getLocalDateString, setVocabulary, setDailyStats, setReviewQueue, setCurrentCardIndex } from '../src/core/state.js';
import {
    REVIEW_CAP_SETTINGS_KEY,
    MAX_REVIEWS_PER_DAY_DEFAULT,
    MAX_REVIEWS_PER_DAY_MIN,
    MAX_REVIEWS_PER_DAY_MAX,
    normalizeMaxReviewsPerDay,
    mergeReviewCapSettings,
    getReviewCapSettings,
    loadReviewCapSettings,
    setMaxReviewsPerDay,
    getReviewBudget,
    getReviewCapStatus,
    buildReviewQueue,
    insertCardForLearningStep
} from '../src/core/queue.js';

before(async () => {
    await initAppDB();
    await setMaxReviewsPerDay(MAX_REVIEWS_PER_DAY_DEFAULT, 1);
});

const TODAY = () => getLocalDateString();

function baseStats(overrides = {}) {
    return {
        lastDate: TODAY(),
        newCardsDoneToday: 0,
        dueDoneToday: 0,
        learningDoneToday: 0,
        todayTotal: 0,
        todayCorrect: 0,
        retentionHistory: [],
        currentLimit: 15,
        limitAdjustedDate: TODAY(),
        ...overrides
    };
}

function makeCard(id, srsStatus, srsDueDate) {
    return {
        id,
        english: id,
        vietnamese: `nghĩa ${id}`,
        srsStatus,
        srsDueDate,
        lastReviewDate: Date.now() - 7 * 24 * 60 * 60 * 1000,
        isDeleted: false,
        tags: []
    };
}

/** Dựng kho + dailyStats sạch. Trả kèm map hạn gốc để kiểm "không đổi hạn". */
function seedWorld({ due = 0, newCards = 0, learning = 0, stats = {} } = {}) {
    const vocabulary = [];
    const dueDates = new Map();
    for (let i = 0; i < due; i++) {
        const card = makeCard(`due-${i}`, 'Mastered', Date.now() - 86_400_000);
        dueDates.set(card.id, card.srsDueDate);
        vocabulary.push(card);
    }
    for (let i = 0; i < newCards; i++) vocabulary.push(makeCard(`new-${i}`, 'New', null));
    for (let i = 0; i < learning; i++) {
        vocabulary.push(makeCard(`learn-${i}`, 'Learning', Date.now() - 1_000));
    }
    setVocabulary(vocabulary);
    setDailyStats(baseStats(stats));
    setReviewQueue([]);
    return { vocabulary, dueDates };
}

function statusCounts(vocabulary) {
    const counts = { Mastered: 0, New: 0, Learning: 0 };
    for (const index of getState().currentReviewQueue) {
        const status = vocabulary[index]?.srsStatus;
        if (status) counts[status]++;
    }
    return counts;
}

test('T1.5 — mặc định 200; clamp 50/500; giá trị rác/thiếu đều về 200', () => {
    assert.equal(MAX_REVIEWS_PER_DAY_DEFAULT, 200);
    assert.equal(MAX_REVIEWS_PER_DAY_MIN, 50);
    assert.equal(MAX_REVIEWS_PER_DAY_MAX, 500);
    assert.equal(getReviewCapSettings().maxReviewsPerDay, 200);
    assert.equal(normalizeMaxReviewsPerDay(10), 50);
    assert.equal(normalizeMaxReviewsPerDay(49.6), 50);
    assert.equal(normalizeMaxReviewsPerDay(200), 200);
    assert.equal(normalizeMaxReviewsPerDay('250'), 250);
    assert.equal(normalizeMaxReviewsPerDay(999), 500);

    for (const garbage of [undefined, null, '', '   ', 'abc', NaN, Infinity, -Infinity, {}, [], true, false]) {
        assert.equal(normalizeMaxReviewsPerDay(garbage), 200, `rác ${String(garbage)} phải về 200`);
    }

});

test('T1.5 — cap 50 cắt đúng 50 thẻ đến hạn; phần còn lại vẫn due và KHÔNG đổi hạn', async () => {
    await setMaxReviewsPerDay(50);
    const { vocabulary, dueDates } = seedWorld({ due: 100 });

    buildReviewQueue();
    const queue = getState().currentReviewQueue;
    assert.equal(queue.length, 50, 'chỉ nạp đúng 50 lượt');
    assert.equal(statusCounts(vocabulary).Mastered, 50);

    const queued = new Set(queue);
    const deferred = vocabulary.filter((_, index) => !queued.has(index));
    assert.equal(deferred.length, 50, '50 thẻ còn lại bị hoãn');
    for (const card of deferred) {
        assert.equal(card.srsStatus, 'Mastered', 'thẻ hoãn VẪN ở trạng thái đến hạn');
        assert.ok(card.srsDueDate <= Date.now(), 'hạn của thẻ hoãn không bị đẩy sang tương lai');
        assert.equal(card.srsDueDate, dueDates.get(card.id), 'hạn không bị đổi');
    }

    const status = getReviewCapStatus();
    assert.equal(status.limit, 50);
    assert.equal(status.used, 0);
    assert.equal(status.remaining, 50, 'queue mới dựng chưa trừ lượt nào; ngân sách trừ khi chấm thật');
    assert.equal(status.deferredDue, 50);
    assert.equal(status.reached, false);

    // Chấm xong 50 lượt trong phiên ⇒ chạm trần, 50 thẻ còn lại bị hoãn.
    setDailyStats(baseStats({ dueDoneToday: 50 }));
    const reachedStatus = getReviewCapStatus();
    assert.equal(reachedStatus.remaining, 0);
    assert.equal(reachedStatus.deferredDue, 50);
    assert.equal(reachedStatus.reached, true);
});

test('T1.5 — hai cap độc lập: thẻ mới giữ cap riêng, thẻ đến hạn lấp phần còn lại, tổng ≤ trần', async () => {
    await setMaxReviewsPerDay(50);
    const { vocabulary } = seedWorld({ due: 100, newCards: 20 });

    buildReviewQueue();
    const counts = statusCounts(vocabulary);
    assert.equal(counts.New, 15, 'cap thẻ mới vẫn là 15, không bị cap lượt ôn cắt riêng');
    assert.equal(counts.Mastered, 35, 'due dùng phần ngân sách còn lại (50 - 15)');
    assert.equal(getState().currentReviewQueue.length, 50, 'tổng không vượt 50');

    // Ngân sách đã dùng hết hôm nay (kể cả thẻ mới) ⇒ không nạp gì thêm.
    setDailyStats(baseStats({ newCardsDoneToday: 5, dueDoneToday: 45 }));
    buildReviewQueue();
    assert.equal(getState().currentReviewQueue.length, 0);
});

test('T1.5 — trừ đúng số đã ôn hôm nay (dueDoneToday + newCardsDoneToday)', async () => {
    await setMaxReviewsPerDay(200);
    seedWorld({ due: 300, stats: { dueDoneToday: 150, newCardsDoneToday: 10 } });

    buildReviewQueue();
    assert.equal(getState().currentReviewQueue.length, 40, '200 - 150 - 10 = 40');

    setDailyStats(baseStats({ dueDoneToday: 190, newCardsDoneToday: 10 }));
    buildReviewQueue();
    assert.equal(getState().currentReviewQueue.length, 0, 'đã dùng đủ 200 thì không nạp thêm');

    const budget = getReviewBudget(getState().dailyStats);
    assert.deepEqual(budget, { limit: 200, used: 200, reserved: 0, remaining: 0 });
});

test('T1.5 — thẻ đang mở giữ chỗ 1 lượt khi rebuild (Cloud sync/đổi topic) — không vượt trần', async () => {
    await setMaxReviewsPerDay(50);
    seedWorld({ due: 100, stats: { dueDoneToday: 10 } });
    setCurrentCardIndex(0);

    const budget = getReviewBudget(getState().dailyStats);
    assert.deepEqual(budget, { limit: 50, used: 10, reserved: 1, remaining: 39 });
    buildReviewQueue();
    assert.equal(getState().currentReviewQueue.length, 39,
        '10 đã chấm + 1 thẻ đang mở + 39 nạp = đúng 50 lượt');

    setCurrentCardIndex(-1);
});

test('T1.5 — thẻ Learning sub-day KHÔNG bị cap chặn (kể cả khi đã chạm trần)', async () => {
    await setMaxReviewsPerDay(50);
    const { vocabulary } = seedWorld({ due: 100, learning: 5 });

    buildReviewQueue();
    const counts = statusCounts(vocabulary);
    assert.equal(counts.Learning, 5, 'cả 5 thẻ 1p/10p vẫn vào phiên dù cap 50');
    assert.equal(counts.Mastered, 50);
    assert.equal(getState().currentReviewQueue.length, 55, 'cap chỉ áp cho due (+ new), không áp learning');

    // Chèn lại thẻ vừa chấm trong bước 1p/10p cũng không bị cap chặn.
    setDailyStats(baseStats({ dueDoneToday: 200 }));
    setVocabulary([makeCard('subday', 'Learning', Date.now() - 1_000)]);
    setReviewQueue([]);
    insertCardForLearningStep(0);
    assert.deepEqual(getState().currentReviewQueue, [0], 'insertCardForLearningStep vẫn chạy khi hết ngân sách');
});

test('T1.5 — đổi setting có hiệu lực NGAY ở lần dựng queue kế tiếp', async () => {
    const { vocabulary } = seedWorld({ due: 100 });

    await setMaxReviewsPerDay(50);
    buildReviewQueue();
    assert.equal(getState().currentReviewQueue.length, 50);

    await setMaxReviewsPerDay(120);
    buildReviewQueue();
    assert.equal(getState().currentReviewQueue.length, 100, '120 > 100 nên nạp hết');

    await setMaxReviewsPerDay(500);
    buildReviewQueue();
    assert.equal(getState().currentReviewQueue.length, 100);
    assert.equal(statusCounts(vocabulary).Mastered, 100);

    // Ngoài phạm vi bị kẹp ngay khi lưu.
    await setMaxReviewsPerDay(9999);
    assert.equal(getReviewCapSettings().maxReviewsPerDay, 500);
    await setMaxReviewsPerDay(1);
    assert.equal(getReviewCapSettings().maxReviewsPerDay, 50);
});

test('T1.5 — sang ngày mới: bộ đếm hôm qua rollover, ngân sách đầy lại', async () => {
    await setMaxReviewsPerDay(50);
    seedWorld({ due: 60, stats: { lastDate: '2000-01-01', dueDoneToday: 50, newCardsDoneToday: 15 } });
    buildReviewQueue();
    assert.equal(getState().currentReviewQueue.length, 50, 'counter ngày cũ không được trừ vào hôm nay');
    assert.equal(getState().dailyStats.dueDoneToday, 0);
});

test('T1.5 — lưu/đọc settings (IndexedDB) + chuẩn hoá khi đọc giá trị rác', async () => {
    await setMaxReviewsPerDay(330, 111);
    assert.deepEqual(await getSettingFromDB(REVIEW_CAP_SETTINGS_KEY), {
        maxReviewsPerDay: 330,
        updatedAt: 111
    });

    // Ghi thẳng một object "bẩn" rồi gọi load như lúc mở app.
    await saveSettingToDB(REVIEW_CAP_SETTINGS_KEY, { maxReviewsPerDay: 123, updatedAt: 222 });
    assert.deepEqual(await loadReviewCapSettings(), { maxReviewsPerDay: 123, updatedAt: 222 });
    assert.equal(getReviewCapSettings().maxReviewsPerDay, 123);

    await saveSettingToDB(REVIEW_CAP_SETTINGS_KEY, { maxReviewsPerDay: 'rác', updatedAt: 'x' });
    assert.deepEqual(await loadReviewCapSettings(), { maxReviewsPerDay: 200, updatedAt: 0 });
    assert.equal(getReviewCapSettings().maxReviewsPerDay, 200);

    await saveSettingToDB(REVIEW_CAP_SETTINGS_KEY, { maxReviewsPerDay: 75 });
    assert.deepEqual(await loadReviewCapSettings(), { maxReviewsPerDay: 75, updatedAt: 0 });

    await setMaxReviewsPerDay(200, 1);
});

test('T1.5 — merge Cloud: LWW theo updatedAt, remote rác không thắng', () => {
    const local = { maxReviewsPerDay: 200, updatedAt: 100 };
    assert.deepEqual(mergeReviewCapSettings(local, { maxReviewsPerDay: 350, updatedAt: 200 }), {
        maxReviewsPerDay: 350,
        updatedAt: 200
    });
    assert.deepEqual(mergeReviewCapSettings(local, { maxReviewsPerDay: 350, updatedAt: 50 }), local);
    assert.deepEqual(mergeReviewCapSettings(local, { maxReviewsPerDay: 350 }), local);
    assert.deepEqual(mergeReviewCapSettings(local, { maxReviewsPerDay: 'rác', updatedAt: 300 }), {
        maxReviewsPerDay: 200,
        updatedAt: 300
    });
    assert.deepEqual(mergeReviewCapSettings({ maxReviewsPerDay: 50, updatedAt: 0 }, { maxReviewsPerDay: 500, updatedAt: 10 }), {
        maxReviewsPerDay: 500,
        updatedAt: 10
    });
    assert.deepEqual(getReviewCapSettings(), { maxReviewsPerDay: 200, updatedAt: 1 });
});
