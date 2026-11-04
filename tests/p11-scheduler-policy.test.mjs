// tests/p11-scheduler-policy.test.mjs
//
// Regression cho các mục còn lại:
//  (8.3) Jitter chôn thẻ chỉ phụ thuộc lapsesToday ⇒ mọi thẻ nhận CÙNG một mốc (06:00),
//        trái mục đích "không dồn 62 thẻ". Nay băm ổn định theo (cardId, ngày).
//  (8.4) Ngưỡng leech hardcode `>= 4` trong dedup thay vì dùng LEECH_LAPSE_THRESHOLD.
//  (8.2) Persona diễn giải p[7] thành "hệ số nhân chu kỳ" và p[10] thành "% dấu vết".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateNextSrsState } from '../src/core/srs/index.js';
import * as dedup from '../src/core/dedup.js';
import { mergeDuplicateCards } from '../src/core/dedup.js';
import { LEECH_LAPSE_THRESHOLD, BURIED_RELEASE_HOUR } from '../src/core/srs/constants.js';
import { analyzeFsrs7Persona } from '../src/features/fsrsPersona.js';
import { DEFAULT_FSRS7_PARAMS } from '../src/core/srs/constants.js';
import { normalizeCard } from '../src/core/card-merge.js';

const NOW = new Date(2026, 10, 3, 12, 0).getTime();
const TODAY = new Date(NOW).toDateString();
const HOUR = 3600000;

const leech = (id, over = {}) => normalizeCard({
    id, english: 'obfuscate', vietnamese: 'làm khó hiểu', srsStatus: 'Learning', learningStep: 1,
    lapses: 4, reps: 4, stability: 0.7, stabilityShort: 0.5, difficulty: 9,
    srsDueDate: NOW, lastReviewDate: NOW - 60000, updatedAt: NOW - 60000,
    contentUpdatedAt: NOW - 60000, srsUpdatedAt: NOW - 60000, flagsUpdatedAt: NOW - 60000,
    lapseDay: TODAY, lapsesToday: 1, ...over
});

const bury = id => calculateNextSrsState(leech(id), 1, 'en-vi', 0, null, true, { now: NOW }).newState;

test('jitter chôn thẻ phân tán theo TỪNG thẻ, không dồn một mốc', () => {
    const due = new Map();
    for (let i = 0; i < 60; i++) due.set(`card-${i}`, bury(`card-${i}`).srsDueDate);
    const distinct = new Set(due.values());
    assert.ok(distinct.size >= 20, `60 thẻ chỉ có ${distinct.size} mốc hẹn khác nhau — jitter không phân tán`);
    const spread = Math.max(...distinct) - Math.min(...distinct);
    assert.ok(spread > 1 * HOUR, `khoảng phân tán ${(spread / HOUR).toFixed(2)}h quá hẹp`);

    // Mọi mốc phải nằm trong khung 04:00–07:00 sáng hôm sau (giờ địa phương).
    const tomorrow = new Date(NOW); tomorrow.setDate(tomorrow.getDate() + 1);
    const start = new Date(tomorrow).setHours(BURIED_RELEASE_HOUR, 0, 0, 0);
    const end = start + 3 * HOUR;
    for (const value of distinct) {
        assert.ok(value >= start && value < end + 1, `mốc ${new Date(value)} ngoài khung chôn`);
    }
});

test('jitter ổn định: cùng thẻ, cùng ngày cho cùng một lịch (rebuild/Undo không nhảy giờ)', () => {
    const a = bury('stable-card');
    const b = bury('stable-card');
    assert.equal(a.srsDueDate, b.srsDueDate);
    // Undo rồi chấm lại đúng lượt đó phải ra đúng lịch cũ.
    const reviewed = calculateNextSrsState(leech('stable-card'), 1, 'en-vi', 0, null, true, { now: NOW }).newState;
    const again = calculateNextSrsState(leech('stable-card'), 1, 'en-vi', 0, null, true, { now: NOW }).newState;
    assert.equal(reviewed.srsDueDate, again.srsDueDate);
});

test('jitter không đổi theo thứ tự gọi (không phụ thuộc Math.random)', () => {
    const first = bury('order-a').srsDueDate;
    const second = bury('order-b').srsDueDate;
    const againFirst = bury('order-a').srsDueDate;
    assert.equal(first, againFirst);
    // Hai thẻ khác nhau KHÔNG bắt buộc khác nhau, nhưng toàn bộ tập phải phân tán (test trên).
    assert.ok(Number.isFinite(second));
});

test('ngưỡng leech trong dedup bám hằng dùng chung LEECH_LAPSE_THRESHOLD', () => {
    const base = { id: 'p', english: 'obfuscate', vietnamese: 'làm khó hiểu', srsStatus: 'Learning',
        stability: 5, stabilityShort: 4, difficulty: 6, reps: 4, srsInterval: 1,
        updatedAt: NOW, contentUpdatedAt: NOW, srsUpdatedAt: NOW, flagsUpdatedAt: NOW, tags: [] };
    const below = mergeDuplicateCards({ ...base, lapses: LEECH_LAPSE_THRESHOLD - 2 },
        { ...base, id: 's1', lapses: 1 }).mergedCard;
    assert.equal(below.lapses, LEECH_LAPSE_THRESHOLD - 1);
    assert.equal(below.isLeech, false);

    const atThreshold = mergeDuplicateCards({ ...base, lapses: LEECH_LAPSE_THRESHOLD - 1 },
        { ...base, id: 's2', lapses: 1 }).mergedCard;
    assert.equal(atThreshold.lapses, LEECH_LAPSE_THRESHOLD);
    assert.equal(atThreshold.isLeech, true, 'chạm ngưỡng phải thành leech');
    assert.equal(atThreshold.needsReformulation, true, 'thẻ leech sau khi gộp cần được viết lại');
});

test('gộp trùng giữ trạng thái Tạm ẩn, không phụ thuộc thứ tự tham số', () => {
    const active = { id: 'a', english: 'obfuscate', vietnamese: 'làm khó hiểu', srsStatus: 'Learning',
        stability: 5, stabilityShort: 4, difficulty: 6, reps: 4, lapses: 1, srsInterval: 1,
        updatedAt: NOW, contentUpdatedAt: NOW, srsUpdatedAt: NOW, flagsUpdatedAt: NOW, tags: [] };
    const hidden = { ...active, id: 'b', isSuspended: true, isStarred: true };
    const forward = mergeDuplicateCards(active, hidden).mergedCard;
    const backward = mergeDuplicateCards(hidden, active).mergedCard;
    assert.equal(forward.isSuspended, true, 'gộp (đang học, đã ẩn) phải giữ ẩn');
    assert.equal(backward.isSuspended, true, 'đảo thứ tự vẫn phải giữ ẩn');
    assert.equal(forward.isStarred, true);
    assert.equal(backward.isStarred, true);
});

test('persona không còn diễn giải p[7] là bội số chu kỳ hay p[10] là % dấu vết', () => {
    const boosted = [...DEFAULT_FSRS7_PARAMS];
    boosted[7] = DEFAULT_FSRS7_PARAMS[7] * 3;    // đẩy "stamina" lên nhánh mô tả mạnh nhất
    boosted[10] = DEFAULT_FSRS7_PARAMS[10] * 2;  // đẩy "bounce" lên nhánh mô tả mạnh nhất
    const text = JSON.stringify(analyzeFsrs7Persona(boosted, NOW));
    assert.doesNotMatch(text, /nhân lên\s*[\d.,]+\s*x\s*mỗi lượt đúng/i, 'không được nói p7 là hệ số nhân');
    assert.doesNotMatch(text, /\d+\s*%\s*dấu vết/i, 'không được nói p10 là phần trăm dấu vết');
    assert.doesNotMatch(text, /thận trọng\s*[\d.,]+\s*x/i);
});

// ui/modal.js nạp động dedup.js và DESTRUCTURE đúng 5 hàm dưới đây. Đổi tên một hàm mà quên
// cập nhật nơi gọi sẽ chỉ lộ ra khi người dùng mở trình gộp trùng (không có E2E cho màn đó),
// nên ghim hợp đồng này lại bằng test.
test('dedup.js vẫn export đủ 5 hàm mà ui/modal.js nạp động', () => {
    for (const name of ['findDuplicatePairs', 'findDuplicatePairsAsync', 'findInternalDuplicateCards', 'mergeDuplicateCards', 'selectAutoMergePairs']) {
        assert.equal(typeof dedup[name], 'function', `thiếu export ${name} cho trình gộp trùng`);
    }
    // Ba hàm tách sang module nhỏ vẫn phải re-export từ dedup.js để importer cũ không vỡ.
    for (const name of ['isFuzzySearchMatch', 'removeVietnameseTones', 'levenshteinDistance', 'cleanAndDeduplicateVietnamese', 'canonicalEnglish']) {
        assert.equal(typeof dedup[name], 'function', `dedup.js phải re-export ${name}`);
    }
});
