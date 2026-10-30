// tests/learning-steps.test.mjs — T1.1: learning steps thật (1 phút → 10 phút → 1 ngày → Mastered)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEARNING_STEPS_MS, MAX_INTERVAL_DAYS, MAX_INITIAL_INTERVAL, MAX_GRADUATION_INTERVAL_DAYS } from '../src/core/srs/constants.js';
import { calculateNextSrsState, predictNextIntervals } from '../src/core/srs/index.js';
import { getState, setReviewQueue, setVocabulary } from '../src/core/state.js';
import { insertCardForLearningStep, orderLearningByDue } from '../src/core/queue.js';

const MIN = 60_000;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 0, 1, 8, 0, 0);
const TOLERANCE_MS = 1000; // đề bài cho phép lệch ±1 s

const newCard = (overrides = {}) => ({
    id: 'learning-probe', english: 'cat', vietnamese: 'mèo',
    srsStatus: 'New', reps: 0, lapses: 0, stability: 0, difficulty: 0,
    ...overrides
});

const review = (card, rating, now) => calculateNextSrsState(card, rating, 'en-vi', 0, null, true, { now }).newState;

test('T1.1: bộ bước học 1 phút / 10 phút / 1 ngày nằm trong constants và được dùng thật', () => {
    assert.deepEqual(LEARNING_STEPS_MS, [60_000, 600_000, 86_400_000]);
    assert.equal(LEARNING_STEPS_MS.length, 3);
});

test('T1.1 #1: New + Nhớ (3) → Learning, bước 1, hẹn lại sau 10 phút', () => {
    const next = review(newCard(), 3, NOW);
    assert.equal(next.srsStatus, 'Learning');
    assert.equal(next.learningStep, 1);
    assert.ok(Math.abs(next.srsDueDate - (NOW + 10 * MIN)) <= TOLERANCE_MS,
        `due phải là now+10 phút, nhận ${next.srsDueDate - NOW}ms`);
    assert.ok(Math.abs(next.srsInterval - 10 / 1440) < 1e-9, `srsInterval phải là 10 phút, nhận ${next.srsInterval}`);
});

test('T1.1 #2: bước 1 + Nhớ (3) → bước 2, hẹn lại sau 1 ngày', () => {
    const step1 = review(newCard(), 3, NOW);
    const step2 = review(step1, 3, step1.srsDueDate);
    assert.equal(step2.srsStatus, 'Learning');
    assert.equal(step2.learningStep, 2);
    assert.ok(Math.abs(step2.srsDueDate - (step1.srsDueDate + DAY)) <= TOLERANCE_MS,
        `due phải là +1 ngày, nhận ${step2.srsDueDate - step1.srsDueDate}ms`);
    assert.ok(Math.abs(step2.srsInterval - 1) < 1e-9);
});

test('T1.1 #3: bước 2 + Nhớ (3) → tốt nghiệp Mastered với interval FSRS trong [1, 365]', () => {
    const step1 = review(newCard(), 3, NOW);
    const step2 = review(step1, 3, step1.srsDueDate);
    const graduated = review(step2, 3, step2.srsDueDate);
    assert.equal(graduated.srsStatus, 'Mastered');
    assert.ok(graduated.srsInterval >= 1, `interval phải >= 1 ngày, nhận ${graduated.srsInterval}`);
    assert.ok(graduated.srsInterval <= MAX_INTERVAL_DAYS, `interval phải <= 365, nhận ${graduated.srsInterval}`);
    assert.ok(Number.isFinite(graduated.srsDueDate) && !Number.isNaN(graduated.srsDueDate));
    assert.ok(Math.abs((graduated.srsDueDate - step2.srsDueDate) - graduated.srsInterval * DAY) <= TOLERANCE_MS);
});

test('T1.1 #4: New + Dễ (4) → Mastered ngay, interval trong [1, 21] cho lần chấm đầu', () => {
    const next = review(newCard(), 4, NOW);
    assert.equal(next.srsStatus, 'Mastered');
    assert.ok(next.srsInterval >= 1, `interval phải >= 1 ngày, nhận ${next.srsInterval}`);
    assert.ok(next.srsInterval <= MAX_INITIAL_INTERVAL, `lần chấm đầu phải <= 21 ngày, nhận ${next.srsInterval}`);
});

test('T1.1 #5: New + Quên (1) → Learning, bước 0, hẹn lại sau 1 phút', () => {
    const next = review(newCard(), 1, NOW);
    assert.equal(next.srsStatus, 'Learning');
    assert.equal(next.learningStep, 0);
    assert.ok(Math.abs(next.srsDueDate - (NOW + MIN)) <= TOLERANCE_MS,
        `due phải là now+1 phút, nhận ${next.srsDueDate - NOW}ms`);
    // SRS-01: lần chạm đầu bị quên KHÔNG phải lapse (thẻ chưa từng thuộc), và một
    // lượt chấm vẫn là một rep — nếu không, thẻ mới bị mất trần tốt nghiệp 7 ngày.
    assert.equal(next.lapses, 0);
    assert.equal(next.reps, 1);
});

test('T1.1 #6: Mastered + Nhớ (3) giữ nguyên hành vi cũ (snapshot trước khi sửa)', () => {
    // Snapshot chụp từ engine TRƯỚC T1.1/T1.2 với đúng thẻ này (ôn đúng hạn, không fuzz).
    const snapshot = { interval: 42.76028370372528, stability: 22.898897013530494, stabilityShort: 190.6021940609433, difficulty: 4.96 };
    const mastered = {
        id: 'snapshot', english: 'serendipity', srsStatus: 'Mastered', reps: 5, lapses: 0,
        stability: 10, stabilityShort: 8, difficulty: 5, srsInterval: 10,
        srsDueDate: NOW, lastReviewDate: NOW - 10 * DAY
    };
    const next = review(mastered, 3, NOW);
    assert.equal(next.srsStatus, 'Mastered');
    assert.ok(Math.abs(next.srsInterval - snapshot.interval) < 1e-6, `interval=${next.srsInterval} lệch snapshot ${snapshot.interval}`);
    assert.ok(Math.abs(next.stability - snapshot.stability) < 1e-9);
    assert.ok(Math.abs(next.stabilityShort - snapshot.stabilityShort) < 1e-9);
    assert.ok(Math.abs(next.difficulty - snapshot.difficulty) < 1e-9);
    assert.equal('learningStep' in next, false, 'Thẻ Mastered không được sinh thêm trường learningStep');
    assert.equal(next.reps, 6);
});

test('T1.1 #7: 20 lần Good liên tiếp trên thẻ Mastered → interval luôn ≤ 365 và không NaN', () => {
    let card = {
        id: 'good-chain', english: 'ubiquitous', srsStatus: 'Mastered', reps: 5, lapses: 0,
        stability: 10, stabilityShort: 8, difficulty: 5, srsInterval: 10,
        srsDueDate: NOW, lastReviewDate: NOW - 10 * DAY
    };
    let clock = NOW;
    for (let i = 0; i < 20; i++) {
        card = review(card, 3, clock); // isSimulation = true: không fuzz, tái lập được
        assert.ok(Number.isFinite(card.srsInterval) && !Number.isNaN(card.srsInterval), `vòng ${i + 1} interval NaN`);
        assert.ok(card.srsInterval <= MAX_INTERVAL_DAYS, `vòng ${i + 1}: ${card.srsInterval} > 365`);
        assert.equal(card.srsStatus, 'Mastered');
        clock = card.srsDueDate;
    }
});

test('T1.1: Khó (2) lặp lại ĐÚNG bước hiện tại, không vượt mặt Nhớ (3)', () => {
    // SRS-01: bản cũ tăng learningStep rồi chỉ hẹn 10 phút ⇒ ở bước 1, "Khó" chạm
    // bước tốt nghiệp sau 10 phút còn "Nhớ" phải chờ 1 ngày. Giờ Khó đứng yên.
    const hardFromNew = review(newCard(), 2, NOW);
    assert.equal(hardFromNew.srsStatus, 'Learning');
    assert.equal(hardFromNew.learningStep, 0, 'bước 0 + Khó vẫn ở bước 0');
    assert.ok(Math.abs(hardFromNew.srsDueDate - (NOW + MIN)) <= TOLERANCE_MS, 'hẹn lại 1 phút');

    const step1 = review(newCard(), 3, NOW);
    const hardAtStep1 = review(step1, 2, step1.srsDueDate);
    assert.equal(hardAtStep1.learningStep, 1, 'bước 1 + Khó giữ nguyên bước 1');
    assert.ok(Math.abs(hardAtStep1.srsDueDate - (step1.srsDueDate + 10 * MIN)) <= TOLERANCE_MS);

    const step2 = review(step1, 3, step1.srsDueDate);
    const hardAtFinal = review(step2, 2, step2.srsDueDate);
    assert.equal(hardAtFinal.srsStatus, 'Learning', 'Khó ở bước cuối không được tốt nghiệp');
    assert.equal(hardAtFinal.learningStep, 2);
    assert.ok(Math.abs(hardAtFinal.srsDueDate - (step2.srsDueDate + DAY)) <= TOLERANCE_MS, 'bước cuối + Khó hẹn 1 ngày');
});

test('T1.1: trạng thái bộ nhớ FSRS vẫn cập nhật mỗi lượt, chỉ lịch bị override', () => {
    const start = newCard();
    const step1 = review(start, 3, NOW);
    const step2 = review(step1, 3, step1.srsDueDate);
    for (const [i, state] of [step1, step2].entries()) {
        assert.ok(state.stability > 0, `lượt ${i + 1}: stability phải > 0`);
        assert.ok(state.difficulty >= 1 && state.difficulty <= 10, `lượt ${i + 1}: difficulty ngoài [1,10]`);
        assert.ok(Number.isFinite(state.stabilityShort) && state.stabilityShort > 0, `lượt ${i + 1}: stabilityShort`);
        assert.ok(state.srsUpdatedAt >= NOW, `lượt ${i + 1}: srsUpdatedAt phải được làm mới`);
    }
    assert.ok(step2.stability > step1.stability, 'S_long phải tăng sau lượt Nhớ thứ hai');
    assert.ok(step2.srsUpdatedAt > step1.srsUpdatedAt, 'srsUpdatedAt phải tăng đơn điệu');
    assert.equal(step2.reps, 2);
});

test('T1.1: thẻ Learning cũ thiếu learningStep được coi như bước 0', () => {
    const legacy = {
        id: 'legacy-learning', english: 'old', srsStatus: 'Learning', reps: 2, lapses: 1,
        stability: 2, stabilityShort: 1.6, difficulty: 6, srsInterval: 0.5,
        srsDueDate: NOW - 1000, lastReviewDate: NOW - 3600_000
    };
    const next = review(legacy, 3, NOW);
    assert.equal(next.learningStep, 1, 'thiếu trường => bước 0 => Nhớ đưa sang bước 1');
    assert.equal(next.srsStatus, 'Learning');
    assert.ok(Math.abs(next.srsDueDate - (NOW + 10 * MIN)) <= TOLERANCE_MS);
});

test('T1.1: nhãn nút chấm cho thẻ New nói đúng bước học (không còn 5d/13d/21d)', () => {
    const labels = predictNextIntervals(newCard(), 'en-vi');
    assert.equal(labels[1], '1p');
    // SRS-01: New + Khó lặp bước 0 (1 phút), không nhảy sang bước 1 (10 phút).
    assert.equal(labels[2], '1p');
    assert.equal(labels[3], '10p');
    assert.ok(/ngày$/.test(labels[4]), `Dễ phải hiện đơn vị ngày, nhận "${labels[4]}"`);

    const step1 = review(newCard(), 3, NOW);
    const stepLabels = predictNextIntervals(step1, 'en-vi');
    assert.equal(stepLabels[1], '1p', 'Quên ở bước 1 vẫn về 1 phút');
    assert.equal(stepLabels[2], '10p');
    assert.equal(stepLabels[3], '1 ngày', 'Nhớ ở bước 1 phải hẹn 1 ngày');

    const masteredLabels = predictNextIntervals({ ...step1, srsStatus: 'Mastered', srsInterval: 10, stability: 10, stabilityShort: 8, difficulty: 5 }, 'en-vi');
    assert.ok(!/ngày|p$/.test(masteredLabels[2]) && /^[\d.]+(d|th|n)$/.test(masteredLabels[2]),
        `Thẻ Mastered phải giữ nhãn kiểu cũ (d/th/n), nhận "${masteredLabels[2]}"`);
});

test('T1.1: hàng đợi Learning xếp theo hạn thật, thẻ chưa tới hạn không bị chèn lại', () => {
    const now = Date.now();
    const vocabulary = [
        { id: 'far', english: 'far', srsStatus: 'Learning', srsDueDate: now + 10 * MIN },
        { id: 'near', english: 'near', srsStatus: 'Learning', srsDueDate: now + MIN },
        { id: 'late', english: 'late', srsStatus: 'Learning', srsDueDate: now - MIN }
    ];
    assert.deepEqual(orderLearningByDue(vocabulary, [0, 1, 2]), [2, 1, 0], 'thẻ trễ hạn trước, rồi 1 phút, rồi 10 phút');

    setVocabulary(vocabulary);
    setReviewQueue([1]);
    insertCardForLearningStep(0); // thẻ 10 phút: chưa tới hạn
    assert.deepEqual(getState().currentReviewQueue, [1], 'thẻ chưa tới hạn không được chèn sớm');

    const dueNow = [{ ...vocabulary[0], srsDueDate: now - 1 }];
    setVocabulary(dueNow);
    setReviewQueue([1, 2, 3, 4, 5, 6, 7]);
    insertCardForLearningStep(0); // đã tới hạn
    const queue = getState().currentReviewQueue;
    assert.ok(queue.includes(0), 'thẻ đã tới hạn phải quay lại hàng đợi');
    assert.ok(queue.indexOf(0) <= 5, `thẻ đã tới hạn phải ở gần đầu hàng đợi, vị trí ${queue.indexOf(0)}`);
});

// ============================================================================
// T1.1b — Trần tốt nghiệp: thẻ CHƯA TỪNG thuộc không được nhảy 21-38 ngày
// sau 2-3 lần chạm trong cùng một ngày (lỗi sư phạm gốc "từ mới biến mất").
// Thẻ đã từng Mastered rồi trượt (lapses > 0) KHÔNG chịu trần này.
// ============================================================================

test('T1.1b: New + Nhớ x3 → tốt nghiệp nhưng interval bị chặn ở 7 ngày', () => {
    const step1 = review(newCard(), 3, NOW);
    const step2 = review(step1, 3, step1.srsDueDate);
    const graduated = review(step2, 3, step2.srsDueDate);
    assert.equal(graduated.srsStatus, 'Mastered');
    assert.equal(graduated.learningStep, LEARNING_STEPS_MS.length - 1);
    assert.ok(graduated.srsInterval <= MAX_GRADUATION_INTERVAL_DAYS,
        `thẻ mới chỉ được chạm 3 lần trong 1 ngày: interval phải <= ${MAX_GRADUATION_INTERVAL_DAYS} ngày, nhận ${graduated.srsInterval}`);
    assert.ok(graduated.srsInterval >= 1, `interval phải >= 1 ngày, nhận ${graduated.srsInterval}`);
    assert.equal(graduated.lapses, 0, 'thẻ chưa từng trượt (lapses = 0)');
});

test('T1.1b: New + Dễ → tốt nghiệp ngay nhưng cũng chỉ 7 ngày, không phải 21', () => {
    const next = review(newCard(), 4, NOW);
    assert.equal(next.srsStatus, 'Mastered');
    assert.ok(next.srsInterval <= MAX_GRADUATION_INTERVAL_DAYS,
        `Dễ trên thẻ mới phải <= 7 ngày, nhận ${next.srsInterval}`);
    assert.ok(next.srsInterval < MAX_INITIAL_INTERVAL,
        `phải chặt hơn cap 21 ngày cũ, nhận ${next.srsInterval}`);
});

test('T1.1b: thẻ đã từng thuộc (lapses > 0) tái tốt nghiệp KHÔNG bị chặn 7 ngày', () => {
    // Cùng trạng thái bộ nhớ, chỉ khác lapses: thẻ đã từng thuộc phải giữ interval FSRS.
    const relearning = {
        id: 'relearning', english: 'serendipity', srsStatus: 'Learning', learningStep: 2,
        reps: 6, lapses: 1, stability: 300, stabilityShort: 900, difficulty: 3,
        srsInterval: 1, srsDueDate: NOW, lastReviewDate: NOW - DAY
    };
    const lapsed = review(relearning, 3, NOW);
    assert.equal(lapsed.srsStatus, 'Mastered');
    assert.ok(lapsed.srsInterval > MAX_GRADUATION_INTERVAL_DAYS,
        `thẻ tái tốt nghiệp phải vượt trần 7 ngày, nhận ${lapsed.srsInterval}`);
    assert.ok(lapsed.srsInterval <= MAX_INTERVAL_DAYS, `nhưng vẫn <= 365, nhận ${lapsed.srsInterval}`);

    const fresh = review({ ...relearning, lapses: 0 }, 3, NOW);
    assert.ok(fresh.srsInterval <= MAX_GRADUATION_INTERVAL_DAYS,
        `cùng S nhưng chưa từng thuộc thì vẫn bị trần 7 ngày, nhận ${fresh.srsInterval}`);
    assert.ok(lapsed.srsInterval > fresh.srsInterval, 'thẻ đã từng thuộc phải có interval dài hơn');
});

