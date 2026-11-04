// tests/p12-trainer-start-evidence.test.mjs
//
// AUDIT-R2.5 — Trainer coi elapsed t = 0 là bằng chứng khởi đầu chuỗi.
//
// `t` là THỜI GIAN ĐÃ TRÔI, không phải cờ "lượt đầu đời": lượt thứ hai cùng timestamp (hoặc lệch
// đồng hồ) cũng có t = 0, nên một chuỗi đã mất log đầu vẫn được coi là đầy đủ.
//
// Nay engine ghi cờ `first` ngay tại lượt nó BIẾT thẻ chưa từng được ôn; cờ này đi qua
// addReviewLog → compressLogs → mergeReviewLogs → prepareTrainingData. Log legacy không có cờ
// được coi là CHƯA xác minh (không bao giờ suy ra từ t = 0).
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateNextSrsState } from '../src/core/srs/index.js';
import { initAppDB } from '../src/core/idb.js';
import { compressLogs, mergeReviewLogs, buildReviewLogsExport } from '../src/core/review-log-merge.js';
import { pruneReviewLogs } from '../src/core/state/review-log-prune.js';
import { prepareTrainingData } from '../src/core/srs/training.js';

const NOW = new Date(2026, 10, 3, 15, 0).getTime();
const DAY = 86400000;

const fresh = (id = 'c1') => ({ id, english: 'apple', srsStatus: 'New', reps: 0 });

test('engine ghi cờ first ở lượt ĐẦU ĐỜI và không ghi ở lượt sau', () => {
    const first = calculateNextSrsState(fresh(), 3, 'en-vi', 0, null, true, { now: NOW });
    assert.equal(first.log.first, true, 'lượt đầu của thẻ New phải có cờ first');
    const second = calculateNextSrsState(first.newState, 3, 'en-vi', 0, null, true, { now: NOW + 1000 });
    assert.equal(second.log.first, false, 'lượt sau KHÔNG được đánh dấu là lượt đầu');
});

test('lệch đồng hồ / cùng timestamp: lượt thứ hai có t = 0 nhưng KHÔNG được coi là lượt đầu', () => {
    const first = calculateNextSrsState(fresh(), 3, 'en-vi', 0, null, true, { now: NOW });
    // Cùng timestamp ⇒ elapsed = 0, đúng cái bẫy của heuristic cũ.
    const second = calculateNextSrsState(first.newState, 3, 'en-vi', 0, null, true, { now: NOW });
    assert.equal(second.log.t, 0, 'điều kiện tái hiện: lượt hai có t = 0');
    assert.equal(second.log.first, false);
    const third = calculateNextSrsState(second.newState, 3, 'en-vi', 0, null, true, { now: NOW + DAY });
    // AUDIT-R3.1: chuỗi mất lượt đầu (chỉ còn log 2 và 3) có `first=false` ở đầu ⇒ BIẾT CHẮC đây
    // không phải lượt đầu, nên bị loại khỏi replay dù t = 0. Bản vòng 2 vẫn dùng nó vì t = 0.
    const data = prepareTrainingData([second.log, third.log], []);
    assert.equal(data.cards.length, 0, 'first = false phải bị loại, không được "cứu" bằng t = 0');
    assert.equal(data.verifiedChains, 0);
    assert.equal(data.assumedStartChains, 0);
    assert.equal(data.truncatedChains, 1);
    assert.equal(data.historyComplete, false, 't = 0 không phải bằng chứng khởi đầu');
});

test('cờ first sống sót qua addReviewLog → compressLogs → mergeReviewLogs → prepareTrainingData', () => {
    const first = calculateNextSrsState(fresh('a'), 3, 'en-vi', 0, null, true, { now: NOW });
    const second = calculateNextSrsState(first.newState, 3, 'en-vi', 0, null, true, { now: NOW + DAY });
    // Dòng log do addReviewLog ghi: [cardIdx, rating, t, ts, typing, id, first].
    const rowFirst = [0, first.log.rating, first.log.t, first.log.reviewTime, 0, 'r1', first.log.first === true ? 1 : 0];
    const rowSecond = [0, second.log.rating, second.log.t, second.log.reviewTime, 0, 'r2', second.log.first === true ? 1 : 0];
    assert.equal(rowFirst[6], 1);
    assert.equal(rowSecond[6], 0);

    const stored = { dict: ['a'], logs: [rowFirst, rowSecond] };
    // Hợp nhất với một bản sao khác (đồng bộ hai thiết bị) rồi nén lại.
    const merged = mergeReviewLogs(stored, { dict: ['a'], logs: [rowSecond] });
    assert.equal(merged.logs.length, 2);
    const head = merged.logs.find(row => row[5] === 'r1');
    assert.equal(head[6], 1, 'cờ first phải được giữ sau khi merge');

    const data = prepareTrainingData(merged, [{ id: 'a', english: 'apple', type: '' }]);
    assert.equal(data.verifiedChains, 1);
    assert.equal(data.assumedStartChains, 0);
    assert.equal(data.historyComplete, true);
});

test('merge: bản BIẾT cờ thắng bản chưa biết; nếu mâu thuẫn thì giữ "không phải lượt đầu"', () => {
    // Chưa biết (thiếu cột) không được thắng bản đã biết — mất cờ là mất thông tin.
    const unknown = { dict: ['a'], logs: [[0, 3, 0, NOW, 0, 'same']] };
    const flaggedFirst = { dict: ['a'], logs: [[0, 3, 0, NOW, 0, 'same', 1]] };
    const flaggedLater = { dict: ['a'], logs: [[0, 3, 0, NOW, 0, 'same', 0]] };
    assert.equal(mergeReviewLogs(unknown, flaggedFirst).logs[0][6], 1);
    assert.equal(mergeReviewLogs(flaggedFirst, unknown).logs[0][6], 1, 'thứ tự tham số không được làm mất cờ');
    assert.equal(mergeReviewLogs(unknown, flaggedLater).logs[0][6], 0);
    // Hai bên đều biết nhưng mâu thuẫn: chọn hướng bảo thủ (0) để chuỗi bị loại khỏi replay.
    assert.equal(mergeReviewLogs(flaggedFirst, flaggedLater).logs[0][6], 0);
    assert.equal(mergeReviewLogs(flaggedLater, flaggedFirst).logs[0][6], 0);
    // Cả hai đều chưa biết: vẫn chưa biết (không tự sinh cột).
    assert.equal(mergeReviewLogs(unknown, unknown).logs[0].length, 6);
});

test('pruning/cắt log loại sự kiện đầu ⇒ trạng thái xác minh đổi đúng', () => {
    const logs = [];
    for (let r = 0; r < 4; r++) {
        logs.push({ id: `x-${r}`, cardId: 'x', rating: 3, t: r ? 1 : 0, ts: NOW - (4 - r) * DAY, first: r === 0 });
    }
    assert.equal(prepareTrainingData(logs, []).historyComplete, true);

    // (a) Mất sự kiện đầu, lượt kế tiếp có t > 0 ⇒ nhận ra ngay là chuỗi bị cắt, loại khỏi train.
    const cutWithElapsed = prepareTrainingData(logs.slice(1), []);
    assert.equal(cutWithElapsed.cards.length, 0, 't > 0 ở đầu chuỗi ⇒ không replay được');
    assert.equal(cutWithElapsed.historyComplete, false);
    assert.equal(cutWithElapsed.truncatedChains, 1);

    // (b) Mất sự kiện đầu NHƯNG lượt kế tiếp cùng timestamp (t = 0): cờ first = false của lượt
    //     đó là bằng chứng BIẾT CHẮC không phải lượt đầu ⇒ chuỗi bị loại khỏi replay.
    const collision = [
        { id: 'y-0', cardId: 'y', rating: 3, t: 0, ts: NOW, first: true },
        { id: 'y-1', cardId: 'y', rating: 3, t: 0, ts: NOW, first: false },
        { id: 'y-2', cardId: 'y', rating: 3, t: 1, ts: NOW + DAY, first: false }
    ];
    assert.equal(prepareTrainingData(collision, []).verifiedChains, 1);
    const prunedCollision = prepareTrainingData(collision.slice(1), []);
    assert.equal(prunedCollision.cards.length, 0, 'đầu chuỗi first = false ⇒ loại, không "phỏng đoán"');
    assert.equal(prunedCollision.verifiedChains, 0, 'không còn bằng chứng lượt đầu');
    assert.equal(prunedCollision.historyComplete, false);
});

test('pruning giữ nguyên cờ first trên các dòng còn lại (chỉ mất khi chính dòng đó bị cắt)', () => {
    const snapshot = compressLogs([
        { cardId: 'p', rating: 3, t: 0, ts: NOW - 3 * DAY, id: 'p1', first: true },
        { cardId: 'p', rating: 3, t: 1, ts: NOW - 2 * DAY, id: 'p2' },
        { cardId: 'p', rating: 3, t: 1, ts: NOW - DAY, id: 'p3' }
    ]);
    // Giữ cả 3 dòng: cờ first còn nguyên (prune chỉ đổi dict index).
    const kept = pruneReviewLogs(snapshot, { maxEntries: 100, maxBytes: 400000 });
    assert.equal(kept.logs.find(row => row[5] === 'p1')[6], 1);
    assert.equal(prepareTrainingData(kept, []).historyComplete, true);
    // Cắt xuống 2 dòng mới nhất: dòng đầu bị bỏ ⇒ mất bằng chứng, trạng thái đổi theo.
    const trimmed = pruneReviewLogs(snapshot, { maxEntries: 2, maxBytes: 400000 });
    assert.equal(trimmed.logs.length, 2);
    assert.equal(prepareTrainingData(trimmed, []).historyComplete, false);
    assert.equal(prepareTrainingData(trimmed, []).verifiedChains, 0);
});

test('file xuất JSON giữ BA trạng thái của cờ first (không tự ghi false cho log cũ)', () => {
    const stored = compressLogs([
        { cardId: 'e1', rating: 3, t: 0, ts: NOW - DAY, id: 'e-1', first: true },
        { cardId: 'e1', rating: 3, t: 1, ts: NOW, id: 'e-2' }
    ]);
    const exported = buildReviewLogsExport(stored, [{ id: 'e1', english: 'apple' }]);
    assert.equal(exported.length, 2);
    assert.equal(exported[0].first, true);
    // Lượt thứ hai không ai nói gì về "lượt đầu" ⇒ trường phải VẮNG MẶT, không phải false.
    assert.equal(Object.hasOwn(exported[1], 'first'), false, 'không được tự ghi first = false');
    const json = JSON.parse(JSON.stringify(exported));
    assert.equal('first' in json[1], false, 'JSON.stringify cũng không được sinh ra false');
    // Xuất rồi dùng lại để train ⇒ chuỗi vẫn xác minh được điểm khởi đầu nhờ dòng đầu.
    assert.equal(prepareTrainingData(json, []).historyComplete, true);

    // Nhánh legacy: KHÔNG dòng nào có cờ ⇒ export không cờ, trainer coi là chưa xác minh.
    const legacy = compressLogs([
        { cardId: 'e2', rating: 3, t: 0, ts: NOW - DAY, id: 'o-1' },
        { cardId: 'e2', rating: 3, t: 1, ts: NOW, id: 'o-2' }
    ]);
    const legacyExport = buildReviewLogsExport(legacy, [{ id: 'e2', english: 'old' }]);
    assert.ok(legacyExport.every(row => !Object.hasOwn(row, 'first')));
    const legacyData = prepareTrainingData(legacyExport, []);
    assert.equal(legacyData.verifiedChains, 0);
    assert.equal(legacyData.assumedStartChains, 1, 'log cũ vẫn đọc được, ở mức phỏng đoán');
    assert.equal(legacyData.historyComplete, false);
});

test('addReviewLog THẬT ghi cột first vào reviewLogs (đường lưu, không phải dựng tay)', async () => {
    // loadVocabulary() cần localStorage; cấp bản tối thiểu rồi nạp module động để polyfill có
    // hiệu lực trước khi state.js chạy.
    globalThis.localStorage = globalThis.localStorage || {
        getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}
    };
    await initAppDB();
    const state = await import('../src/core/state.js');
    await state.loadVocabulary();
    const first = calculateNextSrsState(fresh('db1'), 3, 'en-vi', 0, null, true, { now: NOW });
    const second = calculateNextSrsState(first.newState, 3, 'en-vi', 0, null, true, { now: NOW + DAY });
    await state.addReviewLog({ ...first.log, id: 'db-1' });
    await state.addReviewLog({ ...second.log, id: 'db-2' });
    const rows = state.getState().reviewLogs.logs;
    const byId = new Map(rows.map(row => [row[5], row]));
    assert.equal(byId.get('db-1')[6], 1, 'lượt đầu đời phải được lưu cờ = 1');
    assert.equal(byId.get('db-2')[6], 0, 'lượt sau phải lưu = 0 (chưa xác minh)');
});

test('log legacy (chưa có cột first) đọc được, không bị sửa, và không được coi là xác minh', () => {
    const legacy = { dict: ['k'], logs: [[0, 3, 0, NOW - DAY, 0, 'old-1'], [0, 3, 1, NOW, 0, 'old-2']] };
    const data = prepareTrainingData(legacy, []);
    assert.equal(data.cards.length, 1, 'dữ liệu cũ vẫn đọc được');
    assert.equal(data.verifiedChains, 0);
    assert.equal(data.assumedStartChains, 1);
    assert.equal(data.historyComplete, false);
    // Không được tự thêm cột vào dữ liệu người dùng khi chỉ đọc.
    assert.equal(legacy.logs[0].length, 6);
});

test('chuỗi có cờ first nhưng KHÔNG đủ 2 lượt vẫn bị loại như trước', () => {
    const data = prepareTrainingData([{ id: 'z', cardId: 'z', rating: 3, t: 0, ts: NOW, first: true }], []);
    assert.equal(data.cards.length, 0);
    assert.equal(data.verifiedChains, 0);
    assert.equal(data.historyComplete, false);
});
