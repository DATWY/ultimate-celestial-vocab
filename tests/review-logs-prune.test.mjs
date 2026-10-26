// T2.4 — pruneReviewLogs: cắt log thống kê theo SỐ ENTRY và theo BYTE,
// luôn giữ phần mới nhất, không mutate input, chịu được dữ liệu rỗng/hỏng.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    pruneReviewLogs, measureReviewLogBytes, utf8ByteLength, mergeReviewLogs,
    toCloudReviewLogPayload, prepareReviewLogsForCloud,
    MAX_REVIEW_LOG_ENTRIES, MAX_REVIEW_LOG_BYTES, MAX_REVIEW_LOG_DELETED_IDS
} from '../src/core/state.js';

const HOUR = 3600_000;
const T0 = Date.UTC(2024, 0, 1);

/** Snapshot dạng nén thật: {dict, logs: [[dictIndex, rating, t, ts, typing, id], ...]} */
function snapshot(count, { idLength = 36, cards = null } = {}) {
    const cardIds = cards || Array.from({ length: Math.max(1, Math.ceil(count / 3)) }, (_, i) => `card-${i}`.padEnd(idLength, 'x'));
    const dict = [];
    const index = new Map();
    const logs = [];
    for (let i = 0; i < count; i++) {
        const cardId = cardIds[i % cardIds.length];
        if (!index.has(cardId)) { index.set(cardId, dict.length); dict.push(cardId); }
        logs.push([index.get(cardId), 1 + (i % 4), (i % 90) + 0.5, T0 + i * HOUR, i % 5 === 0 ? 1 : 0, `log-${i}`]);
    }
    return { dict, logs, deletedIds: [] };
}

test('prune theo SỐ ENTRY: giữ đúng maxEntries và luôn là entry MỚI nhất', () => {
    const input = snapshot(10);
    const pruned = pruneReviewLogs(input, { maxEntries: 4 });
    assert.equal(pruned.logs.length, 4);
    assert.deepEqual(pruned.logs.map(row => row[3]), [T0 + 6 * HOUR, T0 + 7 * HOUR, T0 + 8 * HOUR, T0 + 9 * HOUR]);
    assert.deepEqual(pruned.logs.map(row => row[5]), ['log-6', 'log-7', 'log-8', 'log-9']);
});

test('prune theo SỐ ENTRY: mặc định dùng MAX_REVIEW_LOG_ENTRIES', () => {
    assert.equal(MAX_REVIEW_LOG_ENTRIES, 3000);
    const pruned = pruneReviewLogs(snapshot(4200));
    assert.equal(pruned.logs.length, MAX_REVIEW_LOG_ENTRIES);
    assert.equal(pruned.logs.at(-1)[5], 'log-4199');   // entry cuối = mới nhất
    assert.equal(pruned.logs[0][5], 'log-1200');       // 4200 - 3000
});

test('prune theo BYTE: tổng document ≤ maxBytes và cắt bớt entry nếu cần', () => {
    const input = snapshot(400);
    const budget = 4000;
    const pruned = pruneReviewLogs(input, { maxBytes: budget });
    assert.ok(pruned.logs.length > 1, 'phải còn nhiều hơn 1 entry');
    assert.ok(pruned.logs.length < 400, 'phải cắt bớt so với input');
    assert.ok(measureReviewLogBytes(pruned) <= budget, `bytes ${measureReviewLogBytes(pruned)} phải ≤ ${budget}`);
    // vẫn là các entry mới nhất
    assert.equal(pruned.logs.at(-1)[5], 'log-399');
    const kept = new Set(pruned.logs.map(row => row[5]));
    assert.ok(kept.has('log-399') && !kept.has('log-0'));
});

test('prune mặc định: 3.000 entry vẫn nằm dưới MAX_REVIEW_LOG_BYTES', () => {
    const pruned = pruneReviewLogs(snapshot(3000));
    assert.equal(pruned.logs.length, 3000);
    assert.ok(measureReviewLogBytes(pruned) <= MAX_REVIEW_LOG_BYTES);
});

test('prune với id rất dài: ngưỡng BYTE tự hạ số entry (không bao giờ vượt 400 KB)', () => {
    const cards = Array.from({ length: 3000 }, (_, i) => `card-${i}`.padEnd(200, 'x'));
    const pruned = pruneReviewLogs(snapshot(3000, { cards }));
    assert.ok(pruned.logs.length < 3000, 'entry phải bị cắt thêm vì byte');
    assert.ok(pruned.logs.length > 0);
    assert.ok(measureReviewLogBytes(pruned) <= MAX_REVIEW_LOG_BYTES);
});

test('prune KHÔNG mutate input (kể cả dict, row và deletedIds)', () => {
    const input = snapshot(12);
    input.deletedIds = ['id-a', 'id-b'];
    const before = JSON.stringify(input);
    const frozenRows = input.logs.map(row => [...row]);
    const pruned = pruneReviewLogs(input, { maxEntries: 5 });

    assert.equal(JSON.stringify(input), before, 'input phải nguyên vẹn');
    assert.notEqual(pruned, input, 'phải trả về object mới');
    assert.notEqual(pruned.logs, input.logs, 'mảng logs phải là mảng mới');
    assert.notEqual(pruned.logs[0], frozenRows.at(-5), 'row phải được copy');
    pruned.logs.forEach(row => { row[1] = 9; });
    pruned.dict.push('mutated');
    assert.deepEqual(input.logs, frozenRows, 'sửa output không được ảnh hưởng input');
    assert.ok(!input.dict.includes('mutated'));
});

test('prune chạy an toàn với log rỗng / thiếu field / dữ liệu hỏng', () => {
    const empty = { dict: [], logs: [], deletedIds: [] };
    assert.deepEqual(pruneReviewLogs(empty), empty);
    assert.deepEqual(pruneReviewLogs(null), empty);
    assert.deepEqual(pruneReviewLogs(undefined), empty);
    assert.deepEqual(pruneReviewLogs({}), empty);
    assert.deepEqual(pruneReviewLogs([]), empty);
    assert.deepEqual(pruneReviewLogs({ logs: 'not-an-array' }), empty);
    assert.deepEqual(pruneReviewLogs({ dict: null, logs: [{ foo: 1 }, null, 'junk', []], deletedIds: null }), empty);

    // row thiếu ts/rating vẫn được giữ (chỉ cắt theo ts nếu có), row trỏ dict hỏng bị loại
    const mixed = {
        dict: ['card-a'],
        logs: [[0, 3, 1, T0], [0, 2], [5, 1, 1, T0 + 5]],
        deletedIds: undefined
    };
    const pruned = pruneReviewLogs(mixed);
    assert.equal(pruned.logs.length, 1, 'chỉ row đủ field + dict hợp lệ được giữ');
    assert.equal(pruned.logs[0][3], T0);
    assert.deepEqual(pruned.deletedIds, []);
});

test('prune nhận rows dạng chuỗi JSON (document đọc từ Firestore)', () => {
    const input = {
        dict: ['card-a', 'card-b'],
        logs: ['[0,3,1.5,1700000000000,0,"a"]', '[1,2,2.5,1700000001000,0,"b"]'],
        deletedIds: []
    };
    const pruned = pruneReviewLogs(input);
    assert.equal(pruned.logs.length, 2);
    assert.deepEqual(pruned.logs.map(row => row[0]), [0, 1]);
    assert.deepEqual(pruned.logs.map(row => row[5]), ['a', 'b']);
});

test('prune dựng lại dict: chỉ giữ cardId còn được tham chiếu (dict không phình theo kho từ)', () => {
    const cards = Array.from({ length: 50 }, (_, i) => `card-${i}`);
    const input = snapshot(5, { cards });            // 5 row → 5 thẻ được tham chiếu
    input.dict = cards;                              // giả lập document cũ phình dict 50 id
    const pruned = pruneReviewLogs(input, { maxEntries: 3 });
    assert.equal(pruned.logs.length, 3);
    assert.equal(pruned.dict.length, 3, 'dict = đúng số cardId còn dùng');
    assert.deepEqual(pruned.dict, ['card-2', 'card-3', 'card-4']);
    // index trong row phải trỏ đúng dict mới
    pruned.logs.forEach(row => assert.equal(pruned.dict[row[0]], `card-${row[5].replace('log-', '')}`));
});

test('prune cắt deletedIds theo MAX_REVIEW_LOG_DELETED_IDS và bỏ id không phải chuỗi', () => {
    const input = snapshot(3);
    input.deletedIds = Array.from({ length: 900 }, (_, i) => `del-${i}`);
    const pruned = pruneReviewLogs(input);
    assert.equal(pruned.deletedIds.length, MAX_REVIEW_LOG_DELETED_IDS);
    assert.equal(pruned.deletedIds.at(-1), 'del-899');
    assert.equal(pruned.deletedIds[0], 'del-400');
    assert.deepEqual(pruneReviewLogs({ ...snapshot(1), deletedIds: ['', null, 7, 'ok'] }).deletedIds, ['ok']);
});

test('prune luôn giữ ít nhất 1 entry mới nhất kể cả khi ngưỡng byte cực nhỏ', () => {
    const pruned = pruneReviewLogs(snapshot(20), { maxBytes: 1 });
    assert.equal(pruned.logs.length, 1);
    assert.equal(pruned.logs[0][5], 'log-19');
});

test('prune không làm mất/thay đổi nội dung entry được giữ (rating, t, ts, typing, id)', () => {
    const input = snapshot(30);
    const pruned = pruneReviewLogs(input, { maxEntries: 10 });
    const expected = input.logs.slice(-10).map(row => row.slice(1)); // bỏ index (dict được dựng lại)
    assert.deepEqual(pruned.logs.map(row => row.slice(1)), expected);
});

test('sau prune vẫn merge được với snapshot khác (không phá tính đúng của review log)', () => {
    const a = pruneReviewLogs(snapshot(50), { maxEntries: 10 });
    const b = snapshot(50);
    const merged = mergeReviewLogs(a, b);
    assert.ok(merged.logs.length >= 10);
    merged.logs.forEach(row => {
        assert.ok(Array.isArray(row));
        assert.equal(typeof merged.dict[row[0]], 'string', 'row phải trỏ tới cardId hợp lệ');
        assert.ok([1, 2, 3, 4].includes(row[1]), 'rating phải nguyên bản');
    });
});

test('utf8ByteLength đếm byte chứ không đếm ký tự', () => {
    assert.equal(utf8ByteLength('abc'), 3);
    assert.equal(utf8ByteLength('ắ'), 3);       // tiếng Việt: 3 byte UTF-8
    assert.equal(utf8ByteLength('😀'), 4);      // emoji: cặp surrogate 4 byte
    assert.equal(utf8ByteLength(''), 0);
});

// ===== Payload ghi Cloud (dùng chung với firebase.js) =====
test('payload Cloud: rows là chuỗi JSON + metadata, đo đúng bằng byte UTF-8', () => {
    const logs = snapshot(5);
    const meta = { _ownerUid: 'uid-1', _lastModifiedBy: 'dev-1' };
    const payload = toCloudReviewLogPayload(logs, meta);
    assert.equal(payload._ownerUid, 'uid-1');
    assert.equal(payload.logs.length, 5);
    assert.ok(payload.logs.every(row => typeof row === 'string' && row.startsWith('[')));
    assert.equal(measureReviewLogBytes(logs, meta), utf8ByteLength(JSON.stringify(payload)));
    // metadata được tính vào dung lượng
    assert.ok(measureReviewLogBytes(logs, meta) > measureReviewLogBytes(logs));
});

test('payload Cloud: dict chỉ chứa cardId còn dùng (kho 30.000 thẻ không làm phình document)', () => {
    const cards = Array.from({ length: 30000 }, (_, i) => `card-${i}`);
    const input = snapshot(300);              // chỉ 300 lượt chôn gần nhất
    input.dict = cards;                       // document cũ từng phình dict 30.000 id
    const payload = toCloudReviewLogPayload(input);
    assert.equal(payload.dict.length <= 300, true, `dict phải ≤ số entry, thực tế ${payload.dict.length}`);
    assert.ok(measureReviewLogBytes(input) < MAX_REVIEW_LOG_BYTES);
});

test('prepareReviewLogsForCloud: payload vượt ngưỡng an toàn → cắt thêm log, KHÔNG ném lỗi, vẫn giữ entry mới nhất', () => {
    const input = snapshot(1200);
    const meta = { _ownerUid: 'uid', _lastModifiedBy: 'dev' };
    const notices = [];
    const prepared = prepareReviewLogsForCloud(input, {
        meta,
        safeBytes: 20000,                                  // ngưỡng nhỏ để mô phỏng "payload quá lớn"
        onOversize: info => notices.push(info)
    });
    assert.equal(prepared.trimmed, true, 'phải báo đã cắt thêm');
    assert.equal(notices.length, 1, 'cảnh báo được báo đúng 1 lần qua callback');
    assert.ok(prepared.bytes <= 20000, `sau cắt phải ≤ ngưỡng, thực tế ${prepared.bytes}`);
    assert.ok(prepared.snapshot.logs.length < 1200);
    assert.ok(prepared.snapshot.logs.length >= 1);
    assert.equal(prepared.snapshot.logs.at(-1)[5], 'log-1199', 'vẫn giữ entry MỚI nhất');
    // payload trả về khớp với snapshot và đúng shape ghi Cloud
    assert.equal(prepared.payload.logs.length, prepared.snapshot.logs.length);
    assert.equal(prepared.payload._ownerUid, 'uid');
});

test('prepareReviewLogsForCloud: payload bình thường → không cắt thêm, không cảnh báo', () => {
    const notices = [];
    const prepared = prepareReviewLogsForCloud(snapshot(100), { meta: { _ownerUid: 'u' }, onOversize: i => notices.push(i) });
    assert.equal(prepared.trimmed, false);
    assert.equal(notices.length, 0);
    assert.equal(prepared.snapshot.logs.length, 100);
    assert.ok(prepared.bytes <= MAX_REVIEW_LOG_BYTES);
});

test('prepareReviewLogsForCloud: 10.000 entry + 2.000 deletedIds vẫn ≤ 400 KB khi ghi', () => {
    const input = snapshot(10000);
    input.deletedIds = Array.from({ length: 2000 }, (_, i) => `del-${i}`);
    const prepared = prepareReviewLogsForCloud(input, { meta: { _ownerUid: 'x', _lastModifiedBy: 'y' } });
    assert.ok(prepared.bytes <= MAX_REVIEW_LOG_BYTES, `bytes ${prepared.bytes} phải ≤ ${MAX_REVIEW_LOG_BYTES}`);
    assert.ok(prepared.bytes < 700 * 1024, 'phải nằm dưới ngưỡng an toàn 700 KB');
    assert.equal(prepared.trimmed, false, 'prune 400 KB đã đủ, không cần lưới thứ hai');
    assert.ok(prepared.snapshot.logs.length <= MAX_REVIEW_LOG_ENTRIES);
});
