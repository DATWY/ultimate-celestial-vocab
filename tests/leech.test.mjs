// tests/leech.test.mjs — T1.4: xử lý thẻ leech (đã quên >= 4 lần)
//
// Hành vi khoá lại ở đây:
//   1. `lapses` 3 → KHÔNG có cờ; 4 → có cờ isLeech (engine ghi vào state).
//   2. Thẻ leech vừa trượt KHÔNG quay lại hàng đợi ngay (massed practice) mà được hẹn
//      lại sau 10 phút (bước relearning), và không bị insertCardForLearningStep chèn lại.
//   3. Cờ isLeech merge được giữa các thiết bị (card-merge MEMORY + normalizeCard) và
//      luôn suy lại được từ lapses cho thẻ cũ / thẻ nhập từ TSV.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    LEECH_LAPSE_THRESHOLD, LEECH_RELEARNING_INTERVAL_MS, LEECH_RELEARNING_STEP,
    MAX_INTERVAL_DAYS
} from '../src/core/srs/constants.js';
import { calculateNextSrsState, isLeechCard, predictNextIntervals } from '../src/core/srs/index.js';
import { getState, setReviewQueue, setVocabulary } from '../src/core/state.js';
import { insertCardForLearningStep } from '../src/core/queue.js';
import { mergeCardFields, normalizeCard } from '../src/core/card-merge.js';

const MIN = 60_000;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 0, 1, 8, 0, 0);
const TOLERANCE_MS = 1000;

const review = (card, rating, now = NOW) =>
    calculateNextSrsState(card, rating, 'en-vi', 0, null, true, { now }).newState;

/** Thẻ đã Mastered với số lần quên cho trước (ôn đúng hạn, không fuzz). */
const masteredCard = (lapses, overrides = {}) => ({
    id: `leech-${lapses}`,
    english: 'conundrum',
    vietnamese: 'bài toán hóc búa',
    srsStatus: 'Mastered',
    reps: 6,
    lapses,
    stability: 10,
    stabilityShort: 8,
    difficulty: 6,
    srsInterval: 10,
    srsDueDate: NOW,
    lastReviewDate: NOW - 10 * DAY,
    ...overrides
});

test('T1.4: ngưỡng leech là 4 lần quên', () => {
    assert.equal(LEECH_LAPSE_THRESHOLD, 4);
    assert.equal(LEECH_RELEARNING_INTERVAL_MS, 10 * MIN, 'bước relearning của leech là 10 phút');
});

test('T1.4: lapses 3 → chưa có cờ isLeech và vẫn được hẹn lại ngay', () => {
    const next = review(masteredCard(2), 1); // 2 + 1 = 3 lần quên
    assert.equal(next.lapses, 3);
    assert.equal(next.isLeech, false, 'lapses = 3 chưa phải leech');
    assert.equal(isLeechCard(next), false);
    assert.equal(next.srsStatus, 'Learning');
    // Thẻ KHÔNG leech giữ nguyên hành vi cũ: hẹn lại ngay trong phiên (interval 0).
    assert.equal(next.srsInterval, 0, `thẻ chưa leech phải được hẹn lại ngay, nhận ${next.srsInterval}`);
    assert.ok(Math.abs(next.srsDueDate - NOW) <= TOLERANCE_MS);
});

test('T1.4: lapses 4 → có cờ isLeech và due ≈ +10 phút (không nhồi lại ngay)', () => {
    const next = review(masteredCard(3), 1); // 3 + 1 = 4 lần quên
    assert.equal(next.lapses, 4);
    assert.equal(next.isLeech, true, 'lapses = 4 phải bật cờ leech');
    assert.equal(isLeechCard(next), true);
    assert.equal(next.srsStatus, 'Learning');
    assert.equal(next.learningStep, LEECH_RELEARNING_STEP);
    assert.ok(Math.abs(next.srsDueDate - (NOW + 10 * MIN)) <= TOLERANCE_MS,
        `leech phải hẹn lại sau 10 phút, nhận ${next.srsDueDate - NOW}ms`);
    assert.ok(Math.abs(next.srsInterval - 10 / 1440) < 1e-9, `srsInterval phải là 10 phút, nhận ${next.srsInterval}`);
    assert.ok(next.srsInterval <= MAX_INTERVAL_DAYS);
});

test('T1.4: leech đang ở pha Learning cũng được hẹn +10 phút thay vì 1 phút', () => {
    const learningLeech = {
        id: 'learning-leech', english: 'ubiquitous', srsStatus: 'Learning', learningStep: 2,
        reps: 5, lapses: 3, stability: 4, stabilityShort: 3, difficulty: 7,
        srsInterval: 1, srsDueDate: NOW, lastReviewDate: NOW - DAY
    };
    const next = review(learningLeech, 1);
    assert.equal(next.lapses, 4);
    assert.equal(next.isLeech, true);
    assert.equal(next.srsStatus, 'Learning');
    assert.ok(Math.abs(next.srsDueDate - (NOW + 10 * MIN)) <= TOLERANCE_MS,
        `nhánh Learning cũng phải +10 phút, nhận ${next.srsDueDate - NOW}ms`);
});

test('T1.4: cờ leech không bị tắt sau một lượt Nhớ (lapses là bộ đếm tích luỹ)', () => {
    const leech = masteredCard(4, { srsStatus: 'Learning', learningStep: 2, isLeech: true, srsInterval: 1 });
    const good = review(leech, 3, NOW + DAY);
    assert.equal(good.isLeech, true);
    assert.equal(isLeechCard(good), true);
    // Lượt Nhớ vẫn đi theo lịch bình thường (không bị phạt vì là leech).
    assert.equal(good.srsStatus, 'Mastered');
    assert.ok(good.srsDueDate > NOW + DAY);
});

test('T1.4: isLeechCard suy ra được từ lapses cho thẻ cũ / dữ liệu thiếu cờ', () => {
    assert.equal(isLeechCard({ lapses: 3 }), false);
    assert.equal(isLeechCard({ lapses: 4 }), true, 'thẻ chưa có field isLeech vẫn phải nhận ra leech');
    assert.equal(isLeechCard({ lapses: 0, isLeech: true }), true, 'cờ đã lưu phải được tôn trọng');
    assert.equal(isLeechCard(null), false);
    assert.equal(isLeechCard(undefined), false);
});

test('T1.4: thẻ leech không bị chèn lại hàng đợi ngay, thẻ thường vẫn được chèn', () => {
    const now = Date.now();
    // Thẻ leech (lapses 4) đã tới hạn: nếu không có T1.4 nó sẽ bị chèn lại ở vị trí thứ 5.
    const leech = {
        id: 'leech', english: 'conundrum', srsStatus: 'Learning', reps: 6, lapses: 4,
        stability: 2, stabilityShort: 1.6, difficulty: 7, srsInterval: 10 / 1440,
        srsDueDate: now - 1000, lastReviewDate: now - 1000
    };
    const normal = {
        id: 'normal', english: 'resilience', srsStatus: 'Learning', reps: 2, lapses: 0,
        stability: 2, stabilityShort: 1.6, difficulty: 5, srsInterval: 0,
        srsDueDate: now - 1000, lastReviewDate: now - 1000
    };
    setVocabulary([leech, normal]);
    setReviewQueue([1, 2, 3, 4, 5, 6, 7]);

    insertCardForLearningStep(0); // leech: phải bị chặn
    assert.deepEqual(getState().currentReviewQueue, [1, 2, 3, 4, 5, 6, 7],
        'thẻ leech không được quay lại hàng đợi ngay sau khi trượt');

    insertCardForLearningStep(1); // thẻ thường: vẫn chèn như cũ
    assert.ok(getState().currentReviewQueue.includes(1), 'thẻ không leech vẫn phải được chèn lại');
});

test('T1.4: cờ isLeech merge được giữa các thiết bị', () => {
    const older = { id: 'c1', english: 'conundrum', lapses: 0, isLeech: false, srsUpdatedAt: 100, updatedAt: 100 };
    const newer = { id: 'c1', english: 'conundrum', lapses: 4, isLeech: true, srsUpdatedAt: 200, updatedAt: 200 };
    assert.equal(mergeCardFields(older, newer).isLeech, true, 'bản mới hơn (theo srsUpdatedAt) thắng');
    assert.equal(mergeCardFields(newer, older).isLeech, true, 'merge phải đối xứng');
    assert.equal(mergeCardFields(older, newer).lapses, 4, 'lapses và isLeech phải đi cùng bản thắng');

    // Máy chạy bản cũ không gửi field isLeech: merge vẫn phải ra leech nhờ lapses.
    const legacyRemote = { id: 'c1', english: 'conundrum', lapses: 4, srsUpdatedAt: 300, updatedAt: 300 };
    assert.equal(mergeCardFields(older, legacyRemote).isLeech, true,
        'thiếu field nhưng lapses >= 4 vẫn phải là leech sau merge');

    // normalizeCard: chuẩn hoá về boolean và luôn suy lại được từ lapses.
    assert.equal(normalizeCard({ id: 'a', lapses: 4 }).isLeech, true);
    assert.equal(normalizeCard({ id: 'a', lapses: 3 }).isLeech, false);
    assert.equal(normalizeCard({ id: 'a', lapses: 0, isLeech: 'true' }).isLeech, true);
    assert.equal(normalizeCard({ id: 'a', lapses: 0, isLeech: 1 }).isLeech, true);
    assert.equal(normalizeCard({ id: 'a', lapses: 0, isLeech: 'false' }).isLeech, false);
});

test('T1.4: nhãn nút "Quên" của thẻ leech nói đúng 10 phút', () => {
    const labels = predictNextIntervals(masteredCard(4), 'en-vi');
    assert.equal(labels[1], '10p', `thẻ leech phải hiện 10p, nhận "${labels[1]}"`);
    const normalLabels = predictNextIntervals(masteredCard(0), 'en-vi');
    assert.notEqual(normalLabels[1], '10p', 'thẻ không leech giữ nhãn Again như cũ');
});
