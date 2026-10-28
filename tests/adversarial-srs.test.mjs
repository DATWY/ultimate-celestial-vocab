// tests/adversarial-srs.test.mjs
//
// Bất biến của engine FSRS-7. Mọi ca ở đây đều chạy trên API công khai và đã
// từng phát hiện/nuôi dưỡng lỗi thật, nên phải được giữ làm lưới an toàn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateNextSrsState, predictNextIntervals, formatIntervalPreview } from '../src/core/srs/index.js';
import { MAX_INTERVAL_DAYS } from '../src/core/srs/constants.js';

const DAY = 86400000;

test('srs adversarial: rating ngoài 1..4 bị chặn bằng RangeError', () => {
    for (const rating of [0, 5, -1, 1.5, NaN, null, '3', undefined]) {
        assert.throws(() => calculateNextSrsState({ id: 'x' }, rating), RangeError, 'rating=' + String(rating));
    }
});

test('srs adversarial: thẻ thiếu/hỏng dữ liệu vẫn ra state hợp lệ', () => {
    const cards = [
        {}, { english: 'a' }, { stability: NaN, difficulty: NaN, reps: NaN },
        { stability: 1e9, difficulty: 100, lapses: -5, reps: NaN },
        { srsStatus: 'Mastered' }, { srsStatus: 'Learning' }, { stability: 'abc' },
        { srsEaseFactor: 0 }, { lastReviewDate: 'not-a-date' }, { srsDueDate: NaN },
        { stabilityShort: -4, stability: 3 }
    ];
    for (const card of cards) {
        const { newState } = calculateNextSrsState(card, 3, 'en-vi', 0, null, true);
        assert.ok(Number.isFinite(newState.stability) && newState.stability > 0, 'S_long: ' + JSON.stringify(card));
        assert.ok(Number.isFinite(newState.stabilityShort) && newState.stabilityShort > 0, 'S_short: ' + JSON.stringify(card));
        assert.ok(Number.isFinite(newState.difficulty), 'D: ' + JSON.stringify(card));
        assert.ok(Number.isFinite(newState.srsInterval) && newState.srsInterval >= 0, 'I: ' + JSON.stringify(card));
        assert.ok(newState.srsInterval <= MAX_INTERVAL_DAYS, 'interval vượt trần: ' + newState.srsInterval);
    }
});

test('srs adversarial: engine không biến đổi thẻ đầu vào (không side effect)', () => {
    const card = { id: 'z', stability: 5, difficulty: 5, reps: 2, srsStatus: 'Mastered', srsInterval: 8 };
    const snapshot = JSON.stringify(card);
    calculateNextSrsState(card, 3, 'en-vi', 0.5);
    assert.equal(JSON.stringify(card), snapshot);
});

test('srs adversarial: thẻ mới bị chặn 21 ngày, kể cả sau khi fuzz', () => {
    for (let i = 0; i < 300; i++) {
        const { newState } = calculateNextSrsState({ id: 'n' + i }, 4, 'en-vi', 0, null, false, { now: Date.now() + i * 1000 });
        assert.ok(newState.srsInterval <= 21.0001, 'vượt cap khởi tạo: ' + newState.srsInterval);
    }
});

test('srs adversarial: 2.000 lượt liên tiếp vẫn hữu hạn và không vượt 365 ngày', () => {
    let card = { id: 'L', stability: 1, difficulty: 5, stabilityShort: 0.8, reps: 0, lapses: 0, srsStatus: 'New', srsInterval: 0 };
    let now = Date.now();
    let maxInterval = 0;
    for (let i = 0; i < 2000; i++) {
        const rating = [1, 2, 3, 3, 3, 4][i % 6];
        now += Math.max(60000, (card.srsInterval || 1) * DAY * 0.9);
        card = calculateNextSrsState(card, rating, 'en-vi', 0, null, false, { now }).newState;
        assert.ok(Number.isFinite(card.stability) && card.stability > 0, 'S hỏng ở lượt ' + i);
        maxInterval = Math.max(maxInterval, card.srsInterval);
    }
    assert.ok(maxInterval <= MAX_INTERVAL_DAYS + 1e-6, 'max interval = ' + maxInterval);
});

test('srs adversarial: đồng hồ lùi (now < lastReviewDate) không sinh interval âm/NaN', () => {
    const card = {
        id: 'sk', stability: 10, difficulty: 5, stabilityShort: 8, reps: 3, lapses: 0,
        srsStatus: 'Mastered', srsInterval: 10, lastReviewDate: Date.now() + 5 * DAY
    };
    const { newState } = calculateNextSrsState(card, 3, 'en-vi', 0, null, false, { now: Date.now() });
    assert.ok(Number.isFinite(newState.srsInterval) && newState.srsInterval >= 0);
});

test('srs adversarial: dự báo khoảng cách ổn định giữa các lần render (fuzz tắt khi mô phỏng)', () => {
    const card = { id: 'm', stability: 20, difficulty: 5, stabilityShort: 16, reps: 5, lapses: 0, srsStatus: 'Mastered', srsInterval: 20, lastReviewDate: Date.now() - 20 * DAY };
    const seen = new Set();
    for (let i = 0; i < 20; i++) seen.add(JSON.stringify(predictNextIntervals(card)));
    assert.equal(seen.size, 1, 'nhãn nút không được nhảy giữa các lần render: ' + [...seen].join(' | '));
    for (const label of Object.values([...seen].map(JSON.parse)[0])) {
        assert.doesNotMatch(String(label), /NaN|Infinity|undefined/);
    }
});

test('srs adversarial: formatIntervalPreview chặn NaN/Infinity (từng in ra "NaNn")', () => {
    assert.equal(formatIntervalPreview(NaN), '—');
    assert.equal(formatIntervalPreview(Infinity), '—');
    assert.equal(formatIntervalPreview(undefined), '—');
    assert.equal(formatIntervalPreview(0), '<10p');
    assert.equal(formatIntervalPreview(1), '1d');
    assert.equal(formatIntervalPreview(4000), '11n');
});
