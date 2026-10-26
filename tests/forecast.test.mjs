// tests/forecast.test.mjs — T1.6: dự báo ôn tập 7 ngày + nhãn thống kê trong Hub
//
// Mục tiêu: con số trên biểu đồ "Dự báo Ôn tập (7 ngày tới)" và các nhãn
// ("H.Nay"/"N.Mai"/thứ, "Hôm nay: N từ", "TB x/ngày") phải khớp CHÍNH XÁC với
// srsDueDate thật của từng thẻ — không lệch vì múi giờ, DST, giờ trong ngày,
// hay kiểu dữ liệu srsDueDate cũ (chuỗi / Firestore Timestamp / Date).
//
// Cách kiểm: mỗi thẻ trong fixture được CHỈ ĐỊNH TRƯỚC cột kỳ vọng (`expect`)
// bằng tay theo lịch; test chỉ việc cộng dồn các nhãn đó rồi so với kết quả
// buildReviewForecast(). Đây là oracle độc lập, không chạy lại cùng thuật toán.
//
// Trước T1.6 phép đếm nằm lẫn trong renderForecast() nên không test được; đã
// tách thành hàm thuần buildReviewForecast() + getForecastStatusLabel().

import test from 'node:test';
import assert from 'node:assert/strict';

// gamification.js kéo theo lớp UI (elements.js, modal.js, animejs) nên cần một
// document tối thiểu để nạp được trong Node — giống tests/xss-render.test.mjs.
// 2 hàm thuần bên dưới không đụng DOM nên stub không che giấu lỗi nào.
globalThis.document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
};

const { buildReviewForecast, getForecastStatusLabel, FORECAST_DAYS } =
    await import('../src/features/gamification.js');

/** Mốc thời gian theo GIỜ ĐỊA PHƯƠNG (tháng 1-based) — test chạy đúng ở mọi TZ. */
const localMs = (y, m, d, hh = 0, mi = 0, ss = 0, ms = 0) => new Date(y, m - 1, d, hh, mi, ss, ms).getTime();

/**
 * 7 khung ngày cố định. Mỗi khung đều rơi vào một tình huống biên thật:
 *  • 2026-03-05: Mỹ đổi giờ 2026-03-08 (ngày 23h) nằm trong cửa sổ.
 *  • 2026-03-26: EU đổi giờ 2026-03-29 (ngày 23h) nằm trong cửa sổ.
 *  • 2026-09-03: Chile đổi giờ 2026-09-06 (ngày 23h) nằm trong cửa sổ.
 *  • 2026-04-02: Australia kết thúc DST 2026-04-05 (ngày 25h) trong cửa sổ.
 *  • 2026-03-02: thứ Hai — để nhãn thứ không chỉ rơi vào một chuỗi cố định.
 *  • 2026-01-29: băng qua ranh giới tháng 1 → 2.
 *  • 2028-02-26: băng qua 29/02 (năm nhuận).
 * `labels` là nhãn ĐÚNG của từng cột, chép tay từ lịch (không lấy từ code).
 */
const WINDOWS = [
    { y: 2026, m: 3, d: 5, labels: ['H.Nay', 'N.Mai', 'T7', 'CN', 'T2', 'T3', 'T4'] },
    { y: 2026, m: 3, d: 26, labels: ['H.Nay', 'N.Mai', 'T7', 'CN', 'T2', 'T3', 'T4'] },
    { y: 2026, m: 9, d: 3, labels: ['H.Nay', 'N.Mai', 'T7', 'CN', 'T2', 'T3', 'T4'] },
    { y: 2026, m: 4, d: 2, labels: ['H.Nay', 'N.Mai', 'T7', 'CN', 'T2', 'T3', 'T4'] },
    { y: 2026, m: 3, d: 2, labels: ['H.Nay', 'N.Mai', 'T4', 'T5', 'T6', 'T7', 'CN'] },
    { y: 2026, m: 1, d: 29, labels: ['H.Nay', 'N.Mai', 'T7', 'CN', 'T2', 'T3', 'T4'] },
    { y: 2028, m: 2, d: 26, labels: ['H.Nay', 'N.Mai', 'T2', 'T3', 'T4', 'T5', 'T6'] },
];

/**
 * Fixture cố định, dựng TƯƠNG ĐỐI so với ngày gốc để chạy được cho cả 7 khung.
 * `expect` = cột mà thẻ PHẢI rơi vào (0..6), hoặc chuỗi lý do bị loại.
 */
function fixture(y, m, d) {
    return [
        // ── Quá hạn (gộp vào "H.Nay") ──
        { english: 'overdue-yesterday', srsDueDate: localMs(y, m, d - 1, 10, 0), expect: 0 },
        { english: 'overdue-week', srsDueDate: localMs(y, m, d - 7, 23, 59), expect: 0 },
        // ── Hôm nay: đầu ngày và cuối ngày phải CÙNG một cột ──
        { english: 'today-start', srsDueDate: localMs(y, m, d, 0, 0, 0, 0), expect: 0 },
        { english: 'today-end', srsDueDate: localMs(y, m, d, 23, 59, 59, 999), expect: 0 },
        // ── Ngày mai: đầu ngày / cuối ngày cũng phải cùng một cột ──
        { english: 'tomorrow-start', srsDueDate: localMs(y, m, d + 1, 0, 0, 0, 0), expect: 1 },
        { english: 'tomorrow-end', srsDueDate: localMs(y, m, d + 1, 23, 59, 59, 999), expect: 1 },
        // ── +2 … +6 ngày ──
        { english: 'in-2d', srsDueDate: localMs(y, m, d + 2, 7, 15), expect: 2 },
        { english: 'in-3d', srsDueDate: localMs(y, m, d + 3, 12, 0), expect: 3 },
        { english: 'in-4d', srsDueDate: localMs(y, m, d + 4, 18, 30), expect: 4 },
        { english: 'in-5d', srsDueDate: localMs(y, m, d + 5, 0, 0, 0, 1), expect: 5 },
        { english: 'in-6d', srsDueDate: localMs(y, m, d + 6, 23, 59, 59, 998), expect: 6 },
        // ── Ngoài cửa sổ 7 ngày ──
        { english: 'day-seven', srsDueDate: localMs(y, m, d + 7, 0, 0, 0, 0), expect: 'out +7 ngày' },
        { english: 'day-nine', srsDueDate: localMs(y, m, d + 9, 12, 0), expect: 'out +9 ngày' },
        // ── Thẻ New: chưa có lịch FSRS nên không có cột nào ──
        { english: 'new-null-due', srsStatus: 'New', srsDueDate: null, expect: 'out New' },
        { english: 'new-no-field', srsStatus: 'New', expect: 'out New' },
        // ── Thẻ đã xoá ──
        { english: 'deleted-today', isDeleted: true, srsDueDate: localMs(y, m, d, 12, 0), expect: 'out đã xoá' },
        // ── Kiểu dữ liệu srsDueDate cũ: chuỗi số / Firestore Timestamp / Date ──
        // (bản trước T1.6 bỏ âm thầm 2 thẻ đầu — xem báo cáo T1.6)
        { english: 'string-due', srsDueDate: String(localMs(y, m, d + 3, 9, 0)), expect: 3 },
        {
            english: 'timestamp-due',
            srsDueDate: { seconds: Math.floor(localMs(y, m, d + 4, 9, 0) / 1000), nanoseconds: 0 },
            expect: 4
        },
        { english: 'date-object-due', srsDueDate: new Date(localMs(y, m, d + 5, 9, 0)), expect: 5 },
        // ── Rác: không đọc được thì bỏ qua, không được làm sập cả Hub ──
        { english: 'junk-due', srsDueDate: 'not-a-date', expect: 'out không đọc được' },
    ];
}

const inWindow = rows => rows.filter(row => typeof row.expect === 'number');

function expectedCounts(rows) {
    const counts = Array(FORECAST_DAYS).fill(0);
    inWindow(rows).forEach(row => { counts[row.expect]++; });
    return counts;
}

function expectedWords(rows) {
    const words = Array.from({ length: FORECAST_DAYS }, () => []);
    inWindow(rows).forEach(row => { words[row.expect].push(row.english); });
    return words;
}

const label = w => `${w.y}-${String(w.m).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Từng cột ngày khớp số đếm độc lập
// ─────────────────────────────────────────────────────────────────────────────
for (const w of WINDOWS) {
    test(`T1.6: đếm đúng từng cột ngày cho khung ${label(w)}`, () => {
        const rows = fixture(w.y, w.m, w.d);
        const vocabulary = rows.map((row, i) => ({ id: `card-${i}`, ...row }));
        const now = localMs(w.y, w.m, w.d, 12, 0, 0, 0);

        const forecast = buildReviewForecast(vocabulary, now);
        const want = expectedCounts(rows);

        assert.deepEqual(forecast.counts, want,
            `cột đếm sai: nhận [${forecast.counts}] — mong đợi [${want}]`);
        assert.deepEqual(forecast.labels, w.labels, 'nhãn cột sai');

        const wantWords = expectedWords(rows);
        for (let i = 0; i < FORECAST_DAYS; i++) {
            assert.deepEqual([...forecast.words[i]].sort(), wantWords[i].sort(),
                `danh sách từ của cột ${i} ("${w.labels[i]}") sai`);
        }
        assert.equal(forecast.total, inWindow(rows).length, 'tổng 7 ngày phải bằng số thẻ trong cửa sổ');
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Giờ trong ngày không được làm lệch cột (00:00 vs 23:59 cùng ngày)
// ─────────────────────────────────────────────────────────────────────────────
for (const w of WINDOWS) {
    test(`T1.6: chạy lúc 00:00 và 23:59 cùng ngày cho cùng kết quả — ${label(w)}`, () => {
        const rows = fixture(w.y, w.m, w.d);
        const vocabulary = rows.map((row, i) => ({ id: `card-${i}`, ...row }));
        const want = expectedCounts(rows);

        const startOfDay = buildReviewForecast(vocabulary, localMs(w.y, w.m, w.d, 0, 0, 0, 1));
        const endOfDay = buildReviewForecast(vocabulary, localMs(w.y, w.m, w.d, 23, 59, 59, 999));

        assert.deepEqual(startOfDay.counts, endOfDay.counts, 'gần nửa đêm không được lệch cột');
        assert.deepEqual(startOfDay.labels, endOfDay.labels, 'nhãn thứ không được lệch');
        assert.deepEqual(startOfDay.counts, want, 'cả hai mốc đều phải khớp lịch');
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Nhãn hiển thị: "H.Nay" / "N.Mai" / thứ trong tuần / "TB x/ngày"
// ─────────────────────────────────────────────────────────────────────────────
test('T1.6: nhãn "H.Nay" là hôm nay và "N.Mai" là ngày mai, 5 cột sau là thứ', () => {
    const now = localMs(2026, 3, 2, 8, 0); // thứ Hai 02/03/2026
    const forecast = buildReviewForecast([], now);
    assert.equal(forecast.labels[0], 'H.Nay');
    assert.equal(forecast.labels[1], 'N.Mai');
    // Thứ Ba..Chủ nhật của 5 ngày kế tiếp (03/03 → 07/03), không phải thứ của hôm nay.
    assert.deepEqual(forecast.labels.slice(2), ['T4', 'T5', 'T6', 'T7', 'CN']);
    assert.equal(forecast.labels.length, FORECAST_DAYS);
});

test('T1.6: nhãn "TB x/ngày" khớp tổng đếm / 7 (giữ 1 số lẻ khi < 1)', () => {
    const day = (y, m, d) => localMs(y, m, d, 9, 0);

    // 14 thẻ trong cửa sổ → 14/7 = 2 → "2"
    const busy = fixture(2026, 3, 5).map((row, i) => ({ id: `c${i}`, ...row }));
    const busyForecast = buildReviewForecast(busy, localMs(2026, 3, 5, 12, 0));
    assert.equal(busyForecast.total, 14);
    assert.equal(busyForecast.averageLabel, '2', 'TB phải là 2/ngày');

    // 3 thẻ → 3/7 = 0.428… → "0.4" (không được làm tròn thành "0")
    const sparse = [
        { english: 'a', srsDueDate: day(2026, 3, 5) },
        { english: 'b', srsDueDate: day(2026, 3, 7) },
        { english: 'c', srsDueDate: day(2026, 3, 9) },
    ];
    const sparseForecast = buildReviewForecast(sparse, localMs(2026, 3, 5, 12, 0));
    assert.deepEqual(sparseForecast.counts, [1, 0, 1, 0, 1, 0, 0]);
    assert.equal(sparseForecast.averageLabel, '0.4');

    // Không có thẻ nào → "0"
    const empty = buildReviewForecast([], localMs(2026, 3, 5, 12, 0));
    assert.deepEqual(empty.counts, [0, 0, 0, 0, 0, 0, 0]);
    assert.equal(empty.averageLabel, '0');
    assert.equal(empty.total, 0);
    assert.equal(empty.peak, 0);
});

test('T1.6: nhãn trạng thái tải của hôm nay khớp dữ liệu', () => {
    // Không có gì hôm nay → Thảnh thơi
    assert.equal(getForecastStatusLabel([0, 3, 0, 0, 0, 0, 0], 3 / 7).label, '✓ Thảnh thơi');
    // Hôm nay là ngày cao nhất tuần → Đỉnh tải
    assert.equal(getForecastStatusLabel([5, 2, 0, 0, 0, 0, 0], 1).label, '⚠ Đỉnh tải');
    // Hôm nay không cao nhất nhưng trên trung bình → Cao tải
    assert.equal(getForecastStatusLabel([3, 5, 0, 0, 0, 0, 0], 8 / 7).label, '⚡ Cao tải');
    // Hôm nay dưới trung bình → Tải nhẹ
    assert.equal(getForecastStatusLabel([1, 5, 5, 0, 0, 0, 0], 11 / 7).label, '✓ Tải nhẹ');
    // Cả tuần bằng nhau: hôm nay vẫn là "cao nhất tuần" (giữ nguyên hành vi cũ)
    assert.equal(getForecastStatusLabel([1, 1, 1, 1, 1, 1, 1], 1).label, '⚠ Đỉnh tải');

    assert.equal(getForecastStatusLabel([0, 0, 0, 0, 0, 0, 0], 0).kind, 'normal');
    assert.equal(getForecastStatusLabel([3, 5, 0, 0, 0, 0, 0], 8 / 7).kind, 'peak');
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Loại thẻ + kiểu dữ liệu srsDueDate
// ─────────────────────────────────────────────────────────────────────────────
test('T1.6: thẻ New / đã xoá / quá 7 ngày không lọt vào cột nào', () => {
    const now = localMs(2026, 3, 5, 12, 0);
    const rows = fixture(2026, 3, 5);
    const forecast = buildReviewForecast(rows.map((row, i) => ({ id: `c${i}`, ...row })), now);

    const allWords = forecast.words.flat();
    for (const excluded of ['day-seven', 'day-nine', 'new-null-due', 'new-no-field', 'deleted-today', 'junk-due']) {
        assert.ok(!allWords.includes(excluded), `"${excluded}" không được xuất hiện trên biểu đồ`);
    }
    assert.equal(allWords.length, 14, 'chỉ 14 thẻ trong cửa sổ được đếm');
});

test('T1.6: srsDueDate kiểu cũ (chuỗi số / Timestamp / Date) vẫn vào đúng cột', () => {
    const now = localMs(2026, 3, 5, 12, 0);
    const dueToday = localMs(2026, 3, 5, 20, 0);
    const dueIn3 = localMs(2026, 3, 8, 9, 0);

    const cases = [
        ['số (chuẩn)', dueIn3, 3],
        ['chuỗi số (backup JSON cũ)', String(dueIn3), 3],
        ['Firestore Timestamp', { seconds: Math.floor(dueIn3 / 1000), nanoseconds: 0 }, 3],
        ['Date object', new Date(dueIn3), 3],
        ['ISO string', new Date(dueIn3).toISOString(), 3],
    ];
    for (const [name, srsDueDate, bucket] of cases) {
        const forecast = buildReviewForecast([{ id: 'x', english: 'x', srsDueDate }], now);
        assert.equal(forecast.counts[bucket], 1, `${name}: phải rơi vào cột ${bucket}`);
        assert.equal(forecast.total, 1, `${name}: phải được đếm`);
    }

    // Hạn hôm nay 20:00 (sau "bây giờ" 12:00) vẫn thuộc cột hôm nay.
    assert.equal(buildReviewForecast([{ english: 'later-today', srsDueDate: dueToday }], now).counts[0], 1);

    // Giá trị không đọc được: bỏ qua + đếm vào `skipped` để lộ ra được lỗi dữ liệu.
    const junk = buildReviewForecast([
        { english: 'a', srsDueDate: 'not-a-date' },
        { english: 'b', srsDueDate: Number.NaN },
        { english: 'c', srsDueDate: {} },
        { english: 'd', srsDueDate: undefined },
        { english: 'ok', srsDueDate: dueToday },
    ], now);
    assert.deepEqual(junk.counts, [1, 0, 0, 0, 0, 0, 0]);
    assert.equal(junk.skipped, 3, 'chỉ "undefined" (thẻ New thiếu hạn) là chuyện bình thường, 3 giá trị rác còn lại phải bị đếm');
});

test('T1.6: vocabulary rỗng / không phải mảng không làm sập Hub', () => {
    for (const input of [[], null, undefined, {}]) {
        const forecast = buildReviewForecast(input, localMs(2026, 3, 5, 12, 0));
        assert.deepEqual(forecast.counts, [0, 0, 0, 0, 0, 0, 0]);
        assert.equal(forecast.words.length, FORECAST_DAYS);
    }
});
