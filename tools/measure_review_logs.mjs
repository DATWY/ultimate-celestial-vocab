#!/usr/bin/env node
/**
 * T2.4 — Đo kích thước THẬT của document reviewLogs và hiệu quả của pruneReviewLogs.
 *
 * Chạy:  node tools/measure_review_logs.mjs [N]
 *        N = số entry sinh ra để đo (mặc định 2000)
 *
 * Vì sao phải đo: trần cứng của Firestore là 1 MiB/document. reviewLogs nằm ở
 * users/{uid}/state/reviewLogs — vượt trần là lần ghi đó hỏng VĨNH VIỄN (không
 * phải chậm, mà là lỗi). Script này dùng CHÍNH hàm prune/measure của app nên số
 * liệu in ra đúng bằng thứ app sẽ ghi.
 */
import { randomUUID } from 'node:crypto';

// Node không bật WebStorage: chặn cảnh báo ExperimentalWarning khi state.js
// chạm `localStorage` (chỉ ảnh hưởng log của script, không đổi hành vi app).
try {
    Object.defineProperty(globalThis, 'localStorage', {
        value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        configurable: true,
        writable: true
    });
} catch (_) {}

const {
    compressLogs, pruneReviewLogs, measureReviewLogBytes, utf8ByteLength,
    prepareReviewLogsForCloud,
    MAX_REVIEW_LOG_ENTRIES, MAX_REVIEW_LOG_BYTES, MAX_REVIEW_LOG_DELETED_IDS
} = await import('../src/core/state.js');

const FIRESTORE_DOC_LIMIT = 1024 * 1024; // 1 MiB
const HOUR = 3600_000;
const START = Date.UTC(2024, 0, 1);

/** Sinh log thô giống dữ liệu thật: mỗi entry = 1 lần chấm (rating/t/ts/modality/id). */
function makeRawLogs(count, distinctCards = Math.max(1, Math.round(count / 3.6))) {
    const cardIds = Array.from({ length: distinctCards }, () => randomUUID());
    const raw = [];
    for (let i = 0; i < count; i++) {
        raw.push({
            cardId: cardIds[(i * 7 + Math.floor(i / distinctCards)) % distinctCards],
            rating: 1 + (i % 4),
            t: Math.round((0.5 + (i % 120) * 1.37) * 10) / 10,
            ts: START + i * HOUR,
            modality: i % 5 === 0 ? 'typing' : 'en-vi',
            id: randomUUID()
        });
    }
    return raw;
}

/** Shape y hệt document mà firebase.js ghi lên Firestore (rows là chuỗi JSON). */
function toCloudDoc(snapshot) {
    return {
        dict: snapshot.dict,
        logs: snapshot.logs.map(row => JSON.stringify(row)),
        deletedIds: snapshot.deletedIds || []
    };
}

function measure(snapshot) {
    const json = JSON.stringify(toCloudDoc(snapshot));
    const entries = snapshot.logs.length;
    return {
        entries,
        chars: json.length,                 // JSON.stringify(...).length (UTF-16 code units)
        bytes: utf8ByteLength(json),        // số byte Firestore thực sự tính
        perEntry: entries ? utf8ByteLength(json) / entries : 0
    };
}

const kb = bytes => (bytes / 1024).toFixed(1);
const n = value => value.toLocaleString('en-US');
const pad = (value, width) => String(value).padStart(width);

const sampleSize = Math.max(1, Number(process.argv[2]) || 2000);

console.log('');
console.log('══════════════════════════════════════════════════════════════════════════');
console.log(' T2.4 — reviewLogs: đo dung lượng document & kết quả prune');
console.log('══════════════════════════════════════════════════════════════════════════');
console.log(` Trần cứng Firestore/document      : ${n(FIRESTORE_DOC_LIMIT)} bytes (1 MiB)`);
console.log(` MAX_REVIEW_LOG_ENTRIES            : ${n(MAX_REVIEW_LOG_ENTRIES)} entry`);
console.log(` MAX_REVIEW_LOG_BYTES              : ${n(MAX_REVIEW_LOG_BYTES)} bytes`);
console.log(` MAX_REVIEW_LOG_DELETED_IDS        : ${n(MAX_REVIEW_LOG_DELETED_IDS)} id`);
console.log('');

// ── 1. Mẫu đo theo yêu cầu: N entry (mặc định 2000) ─────────────────────────
const sampleSnapshot = compressLogs(makeRawLogs(sampleSize));
const sample = measure(sampleSnapshot);
console.log(`① MẪU N = ${n(sampleSize)} entry (${n(sampleSnapshot.dict.length)} thẻ khác nhau, ${n(sampleSnapshot.dict.length)} id trong dict)`);
console.log(`   JSON.stringify(document).length  : ${n(sample.chars)} ký tự`);
console.log(`   UTF-8 bytes (Firestore tính byte): ${n(sample.bytes)} bytes  (${kb(sample.bytes)} KB)`);
console.log(`   Byte / entry (trung bình)        : ${sample.perEntry.toFixed(2)} bytes/entry`);
console.log(`   Gồm: ${kb(sample.bytes - 0)} KB tổng, trong đó dict chiếm ~${kb(utf8ByteLength(JSON.stringify(sampleSnapshot.dict)))} KB`);
const crossCheck = measureReviewLogBytes(sampleSnapshot);
console.log(`   Đối chiếu measureReviewLogBytes(): ${n(crossCheck)} bytes → ${crossCheck === sample.bytes ? 'KHỚP' : 'LỆCH (kiểm tra lại công thức!)'}`);
console.log('');

// ── 2. Bảng: trước / sau prune theo số entry ────────────────────────────────
console.log('② TRƯỚC vs SAU prune (prune với MAX_REVIEW_LOG_ENTRIES + MAX_REVIEW_LOG_BYTES mặc định)');
console.log('   ┌────────┬──────────────────┬─────────────┬──────────────┬──────────────┬─────────┐');
console.log('   │ N      │ trước: KB        │ byte/entry  │ sau: entry   │ sau: KB      │ bỏ     │');
console.log('   ├────────┼──────────────────┼─────────────┼──────────────┼──────────────┼─────────┤');
for (const count of [200, 500, 1000, 2000, 3000, 5000, 10000]) {
    const before = measure(compressLogs(makeRawLogs(count)));
    const pruned = pruneReviewLogs(compressLogs(makeRawLogs(count)));
    const after = measure(pruned);
    console.log(`   │ ${pad(n(count), 6)} │ ${pad(kb(before.bytes), 16)} │ ${pad(before.perEntry.toFixed(2), 11)} │ ${pad(n(after.entries), 12)} │ ${pad(kb(after.bytes), 12)} │ ${pad(n(before.entries - after.entries), 7)} │`);
}
console.log('   └────────┴──────────────────┴─────────────┴──────────────┴──────────────┴─────────┘');
console.log('   (N nhỏ hơn ngưỡng thì prune không cắt gì — cột "bỏ" = 0)');
console.log('');

// ── 3. Kịch bản code CŨ: 10.000 entry local → 3.000 row nhưng giữ NGUYÊN dict ──
const legacyRows = compressLogs(makeRawLogs(10000)).logs.slice(-3000).map(row => JSON.stringify(row));
const legacyDict = idLength => Array.from({ length: 10000 }, (_, i) => `card-${i}`.padEnd(idLength, 'x'));
const legacyBytes = (idLength) => utf8ByteLength(JSON.stringify({ dict: legacyDict(idLength), logs: legacyRows, deletedIds: [] }));
const legacyFull = legacyBytes(36);
console.log('③ MÔ PHỎNG CODE CŨ (.slice(-3000) nhưng giữ dict của cả 10.000 entry)');
console.log(`   10.000 id trong dict + ${n(legacyRows.length)} row → ${n(legacyFull)} bytes (${kb(legacyFull)} KB) = ${(legacyFull / FIRESTORE_DOC_LIMIT * 100).toFixed(1)}% trần 1 MiB`);
console.log('   Row bị cắt nhưng dict thì KHÔNG → mỗi thẻ từng học để lại 1 id vĩnh viễn trong document.');
console.log('');
console.log('   Dict phình theo SỐ THẺ và ĐỘ DÀI id (id do người dùng/import sinh ra, không phải lúc nào cũng là UUID):');
for (const idLength of [36, 48, 64, 96, 128]) {
    const bytes = legacyBytes(idLength);
    const pct = bytes / FIRESTORE_DOC_LIMIT * 100;
    console.log(`   id ${pad(idLength, 3)} ký tự × 10.000 thẻ → ${pad(n(bytes), 9)} bytes (${pad(kb(bytes), 7)} KB) = ${pct.toFixed(1)}% trần${bytes >= FIRESTORE_DOC_LIMIT ? '  ❌ VƯỢT 1 MiB' : ''}`);
}
console.log('   → Đây chính là lỗi "ghi hỏng vĩnh viễn": dict không có ngưỡng nào cả.');
console.log('');

// ── 4. Worst-case thật của code MỚI (đúng hàm mà firebase.js dùng để ghi) ───
const META = { _lastModifiedBy: 'd'.repeat(64), _ownerUid: 'u'.repeat(28) };
const worstInput = {
    ...compressLogs(makeRawLogs(10000)),
    deletedIds: Array.from({ length: 2000 }, () => randomUUID())
};
const prepared = prepareReviewLogsForCloud(worstInput, { meta: META });
const maxRowBytes = Math.max(...prepared.snapshot.logs.map(row => utf8ByteLength(JSON.stringify(row))));
console.log('④ CODE MỚI — payload lớn nhất có thể ghi (đo bằng prepareReviewLogsForCloud)');
console.log(`   Nguồn vào: 10.000 entry + 2.000 deletedIds (dữ liệu cực đoan)`);
console.log(`   Sau prune: ${n(prepared.snapshot.logs.length)} entry, ${n(prepared.snapshot.deletedIds.length)} deletedIds, dict ${n(prepared.snapshot.dict.length)} id`);
console.log(`   Document bytes (gồm metadata): ${n(prepared.bytes)} bytes (${kb(prepared.bytes)} KB) = ${(prepared.bytes / FIRESTORE_DOC_LIMIT * 100).toFixed(1)}% trần 1 MiB`);
console.log(`   Lưới an toàn 700 KB có phải cắt thêm? ${prepared.trimmed ? 'CÓ' : 'KHÔNG (prune 400 KB đã đủ)'}`);
console.log(`   Entry lớn nhất quan sát  : ${n(maxRowBytes)} bytes → ở cỡ đó 400 KB chứa được ~${n(Math.floor(MAX_REVIEW_LOG_BYTES / maxRowBytes))} entry`);
console.log(`   Chặn trên theo code      : ≤ ${n(MAX_REVIEW_LOG_BYTES + utf8ByteLength(JSON.stringify(META)))} bytes (~${kb(MAX_REVIEW_LOG_BYTES + utf8ByteLength(JSON.stringify(META)))} KB) vì prune cắt theo byte`);
console.log('');
console.log('   Kiểm chứng ngưỡng BYTE khi id dài bất thường (cùng 10.000 entry):');
for (const idLength of [36, 96, 128, 200]) {
    const raw = Array.from({ length: 10000 }, (_, i) => ({
        cardId: `card-${i}`.padEnd(idLength, 'x'),
        rating: 1 + (i % 4),
        t: (i % 90) + 0.5,
        ts: START + i * HOUR,
        id: `log-${i}`
    }));
    const pruned = pruneReviewLogs(compressLogs(raw));
    const bytes = measure(pruned).bytes;
    console.log(`   id ${pad(idLength, 3)} ký tự → giữ ${pad(n(pruned.logs.length), 5)} entry · ${pad(n(bytes), 7)} bytes (${pad(kb(bytes), 7)} KB) → ${bytes <= MAX_REVIEW_LOG_BYTES ? 'OK ≤ 400 KB' : 'VƯỢT NGƯỠNG'}`);
}
console.log('   → Ngưỡng byte tự hạ số entry để document không bao giờ vượt 400 KB.');
console.log('');
console.log('   Với row trung bình ~83 B: ngưỡng 3.000 entry chặn TRƯỚC (≈249 KB),');
console.log('   ngưỡng byte chỉ chặn khi id/row dài bất thường → hai ngưỡng bù nhau.');
console.log('');
console.log(' KẾT LUẬN: sau khi sửa, document reviewLogs ≤ 400 KB + ~130 B metadata (≈39% trần 1 MiB),');
console.log(' KHÔNG phụ thuộc số thẻ trong kho — dict chỉ giữ cardId còn được tham chiếu');
console.log(' (tối đa bằng số entry giữ lại), nên thư viện 30.000 thẻ cũng không làm phình document.');
console.log('══════════════════════════════════════════════════════════════════════════');
console.log('');
