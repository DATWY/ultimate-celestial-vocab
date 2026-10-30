// tests/p0-srs-learning.test.mjs — SRS-01.
//
// Ba lỗi thật trong máy trạng thái Learning:
//   1. `scheduleLearningStep` với rating=2 (Khó) VẪN tăng `learningStep` (index.js:70)
//      nhưng chỉ hẹn 10 phút. Ở bước 1: Khó ⇒ bước 2 + 10 phút; Nhớ ⇒ bước 2 + 1 NGÀY.
//      Nghĩa là bấm Khó lại đưa thẻ tới bước tốt nghiệp NHANH HƠN bấm Nhớ (10 phút
//      so với 1 ngày) — sai hoàn toàn ngữ nghĩa SRS.
//   2. Thẻ New bấm Again bị gán `lapses = 1` (index.js:153). Từ đó `isFreshCard`
//      thành false ⇒ mất trần tốt nghiệp 7 ngày, và chỉ 4 lần Again là thẻ mới bị
//      gắn cờ leech.
//   3. Thẻ New bấm Again đặt `reps = 0`; lượt sau logic "suy diễn reps cho thẻ cũ"
//      (index.js:126-128) chèn thêm 1 rồi cộng tiếp 1 ⇒ reps nhảy 0 → 2.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateNextSrsState } from '../src/core/srs/index.js';
import { LEARNING_STEPS_MS, MAX_GRADUATION_INTERVAL_DAYS } from '../src/core/srs/constants.js';

const DAY = 86400000;
const freshCard = (over = {}) => ({
    id: 'w1',
    english: 'hello',
    vietnamese: 'xin chào',
    type: 'noun',
    srsStatus: 'New',
    srsDueDate: null,
    srsInterval: 0,
    srsEaseFactor: 2.5,
    reps: 0,
    lapses: 0,
    ...over
});

/** Chấm một nhát trên thẻ ở bước học cho trước. */
function rate(card, rating, now = 1_700_000_000_000) {
    return calculateNextSrsState(card, rating, 'en-vi', 0, null, true, { now }).newState;
}

test('Khó (2) không được vượt bước so với Nhớ (3) ở mọi bước học', () => {
    for (let step = 0; step <= 2; step++) {
        // Bước 0/1 là thẻ đang Learning; bước 2 là bước cuối trước khi tốt nghiệp.
        const base = freshCard({
            srsStatus: 'Learning',
            learningStep: step,
            reps: step + 1,
            stability: 2,
            stabilityShort: 1,
            difficulty: 5
        });
        const hard = rate(base, 2);
        const good = rate(base, 3);
        assert.ok(
            hard.learningStep <= good.learningStep,
            `bước ${step}: Khó nhảy tới bước ${hard.learningStep} trong khi Nhớ chỉ ${good.learningStep}`
        );
        assert.ok(
            hard.srsInterval <= good.srsInterval + 1e-9,
            `bước ${step}: Khó hẹn ${hard.srsInterval} ngày, dài hơn Nhớ ${good.srsInterval} ngày`
        );
    }
});

test('Khó ở bước 1 phải lặp lại bước 1 (10 phút), không nhảy lên bước cuối', () => {
    const card = freshCard({
        srsStatus: 'Learning',
        learningStep: 1,
        reps: 2,
        stability: 2,
        stabilityShort: 1,
        difficulty: 5
    });
    const hard = rate(card, 2);
    assert.equal(hard.learningStep, 1, 'Khó phải GIỮ bước hiện tại (Anki: Hard lặp bước), không tiến bước');
    assert.ok(Math.abs(hard.srsInterval - LEARNING_STEPS_MS[1] / DAY) < 1e-9, 'Khó ở bước 1 hẹn đúng 10 phút');
    assert.equal(hard.srsStatus, 'Learning');
});

test('Nhớ ở bước 1 tiến lên bước 2 với 1 ngày (hành vi đúng, giữ nguyên)', () => {
    const card = freshCard({
        srsStatus: 'Learning',
        learningStep: 1,
        reps: 2,
        stability: 2,
        stabilityShort: 1,
        difficulty: 5
    });
    const good = rate(card, 3);
    assert.equal(good.learningStep, 2);
    assert.ok(Math.abs(good.srsInterval - LEARNING_STEPS_MS[2] / DAY) < 1e-9);
});

test('thẻ New bấm Again: KHÔNG bị tính lapses, giữ trần tốt nghiệp 7 ngày', () => {
    const first = rate(freshCard(), 1);
    assert.equal(
        first.lapses,
        0,
        'lần chạm đầu tiên bị quên không phải "lapse" — gán 1 sẽ kích hoạt leech sớm và mất trần 7 ngày'
    );
    assert.equal(first.srsStatus, 'Learning');
    assert.equal(first.isLeech, false, 'một lần Again không được biến thẻ mới thành leech');

    // Học tiếp tới tốt nghiệp: interval phải chịu trần MAX_GRADUATION_INTERVAL_DAYS.
    let card = first;
    card = rate(card, 3);
    card = rate(card, 3);
    card = rate(card, 3);
    assert.equal(card.srsStatus, 'Mastered');
    assert.ok(
        card.srsInterval <= MAX_GRADUATION_INTERVAL_DAYS,
        `thẻ mới tốt nghiệp phải ≤ ${MAX_GRADUATION_INTERVAL_DAYS} ngày, nhận ${card.srsInterval}`
    );
});

test('thẻ New bấm Again: reps không nhảy 0 → 2', () => {
    const first = rate(freshCard(), 1);
    assert.equal(first.reps, 1, 'một lượt chấm là một rep, kể cả khi quên');

    const second = rate({ ...first, srsStatus: 'Learning', learningStep: 0 }, 3);
    assert.equal(
        second.reps,
        2,
        `reps phải tăng đúng 1 mỗi lượt; nhận ${second.reps} (lỗi suy diễn reps cho thẻ "cũ")`
    );
});

test('thẻ đã Mastered bấm Khó vẫn giữ Mastered (không tụt hạng)', () => {
    const mastered = freshCard({
        srsStatus: 'Mastered',
        reps: 5,
        lapses: 0,
        srsInterval: 10,
        stability: 10,
        stabilityShort: 5,
        difficulty: 5,
        srsDueDate: 1_700_000_000_000
    });
    const next = rate(mastered, 2);
    assert.equal(next.srsStatus, 'Mastered');
    assert.ok(next.srsInterval >= 1);
});
