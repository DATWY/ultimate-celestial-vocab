// tests/p14-legacy-xp-boundary.test.mjs
//
// CA BIÊN (vòng 5) — bản lưu có `xpToday = 5` nhưng THIẾU hẳn `lastXPDate` có tới được
// `snapshotReviewStats` qua đường ứng dụng hỗ trợ không?
//
// Kết luận của bộ test này: **KHÔNG**. Mọi đường được kiểm đều chuẩn hóa (hoặc giữ khóa do bản
// local thắng merge) trước khi lượt chấm đầu tiên chụp snapshot:
//   • tải IndexedDB → khối khởi động của `main.js` gọi `rolloverDailyStats`/`trackAppOpen`, mà
//     `ensureStats` bên trong đặt `lastXPDate = ''` trên CHÍNH object đang sống;
//   • nhận tiến độ từ tab khác / merge cloud → `mergeProgress` lấy `{ ...remote, ...local }`, bản
//     local đã chuẩn hóa nên thắng;
//   • khôi phục bản sao (preview) → deep-clone của object đang sống.
//
// Các ca "bỏ khối khởi động" là ĐỐI CHỨNG ở tầng hàm: chúng chứng minh chính bước chuẩn hóa là thứ
// bảo vệ Undo, và rằng bản sửa vòng 4 xử lý đúng "sang kỳ" (3 → 5) chứ không chỉ đúng khi hai con
// số tình cờ bằng nhau. Đường đó KHÔNG tồn tại trong ứng dụng.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initAppDB, saveSettingToDB, getSettingFromDB } from '../src/core/idb.js';
import { mergeProgress } from '../src/core/progress-merge.js';
import { rolloverDailyStats, trackAppOpen, trackXP } from '../src/features/stat-trackers.js';
import { snapshotReviewStats, diffReviewStats, revertReviewStats } from '../src/core/stats-rollback.js';
import { getLocalDateString } from '../src/core/utils/date.js';

const NOW = new Date(2026, 10, 3, 15, 0).getTime();   // 03/11/2026 15:00 giờ máy
const TODAY = getLocalDateString(NOW);
const YESTERDAY = getLocalDateString(NOW - 86400000);

// `state/gamification.js` chạm `document`/`CustomEvent`; cấp bản tối thiểu cho tiến trình Node.
globalThis.document = globalThis.document || {
    getElementById: () => null, dispatchEvent: () => {}, addEventListener: () => {},
    body: { classList: { add() {}, remove() {} } }
};
globalThis.CustomEvent = globalThis.CustomEvent || class {
    constructor(type, init) { this.type = type; this.detail = init?.detail; }
};
globalThis.localStorage = globalThis.localStorage || {
    getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}
};

/**
 * Bốn mốc của luồng Undo, dùng CHÍNH các hàm mà handler/Undo của ứng dụng dùng:
 * ngay trước snapshot → sau A → sau B → sau Undo A → sau +1.
 */
function reviewThenUndo(stats, { applyStartup }) {
    const fact = () => ({
        hasOwn: stats ? Object.hasOwn(stats, 'lastXPDate') : null,
        dayKey: stats ? stats.lastXPDate : null,
        xpToday: stats ? stats.xpToday : null,
        xpWeekTotal: stats ? stats.xpWeekTotal : null
    });
    const marks = [];
    if (applyStartup) {
        // ĐÚNG như main.js: gọi trên object đang sống, không gán lại kết quả.
        rolloverDailyStats(stats, TODAY, 0);
        trackAppOpen(stats, NOW);
    }
    marks.push(fact());
    const snapshot = snapshotReviewStats(stats, TODAY);
    trackXP(stats, 5, NOW);                         // A: lượt chấm đầu hôm nay
    const delta = diffReviewStats(snapshot, stats); // handler tính delta NGAY sau A
    marks.push(fact());
    trackXP(stats, 7, NOW + 60000);                 // B: hoạt động hợp lệ cùng ngày
    marks.push(fact());
    revertReviewStats(stats, snapshot, delta, TODAY);
    marks.push(fact());
    trackXP(stats, 1, NOW + 120000);                // +1 để kiểm mốc ngày còn đúng
    marks.push(fact());
    return marks;
}

// ───────────────── 1. Đường THẬT: IndexedDB cũ → khối khởi động → chấm → Undo ─────────────────
// Một lần tải duy nhất trong tệp: `loadVocabulary()` đọc từ kho thật, còn các ca sau dùng object
// dựng tay để không phụ thuộc thứ tự bài (kho IndexedDB của fake-indexeddb là toàn cục).
test('biên: IDB cũ {xpToday:5} thiếu lastXPDate — khối khởi động THẬT đặt khóa, Undo cho 7 rồi 8', async () => {
    await initAppDB();
    await saveSettingToDB('gamification', { userXP: 0, totalReviews: 0, stats: { xpToday: 5 } });
    const stored = await getSettingFromDB('gamification');
    assert.deepEqual(stored.stats, { xpToday: 5 }, 'fixture phải đọc lại đúng như đã ghi');

    const state = await import('../src/core/state.js');
    await state.loadVocabulary();
    const g = state.getState().gamification;
    assert.deepEqual(g.stats, { xpToday: 5 }, 'điều kiện tái hiện: object tải lên THIẾU lastXPDate');

    const marks = reviewThenUndo(g.stats, { applyStartup: true });
    assert.deepEqual(marks.map(m => m.hasOwn), [true, true, true, true, true],
        'khối khởi động phải chuẩn hóa trước snapshot');
    assert.equal(marks[0].dayKey, '', 'giá trị chuẩn hóa là chuỗi rỗng, không phải hôm nay');
    assert.equal(marks[0].xpToday, 5);
    assert.equal(marks[1].dayKey, TODAY, 'A mở kỳ mới');
    assert.equal(marks[1].xpToday, 5, '5 → 5: đúng ca biên');
    assert.equal(marks[2].xpToday, 12);
    assert.equal(marks[3].xpToday, 7, 'Undo A phải để lại đúng 7 của B');
    assert.equal(marks[3].dayKey, TODAY, 'mốc ngày phải ở lại hôm nay');
    assert.equal(marks[3].xpWeekTotal, 7, 'XP tuần phải hoàn đúng phần A');
    assert.equal(marks[4].xpToday, 8, 'cộng thêm 1 sau Undo ⇒ 8');
});

test('biên: {xpToday:3} thiếu khóa qua khối khởi động ⇒ 7 rồi 8 (không phải chỉ đúng khi bằng số)', () => {
    const stats = { xpToday: 3 };                   // cùng hình dạng bản ghi cũ, không cần tải lại DB
    const marks = reviewThenUndo(stats, { applyStartup: true });
    assert.equal(marks[0].hasOwn, true);
    assert.equal(marks[1].xpToday, 5, 'A: sang kỳ nên reset rồi +5 (3 của kỳ cũ không cộng dồn)');
    assert.equal(marks[3].xpToday, 7);
    assert.equal(marks[4].xpToday, 8);
});

test('biên: phân biệt THIẾU khóa với khóa rỗng "" và khóa = hôm qua', () => {
    const cases = [
        ['thiếu khóa', { xpToday: 5 }],
        ['khóa rỗng', { xpToday: 5, lastXPDate: '' }],
        ['khóa hôm qua', { xpToday: 5, lastXPDate: YESTERDAY }]
    ];
    for (const [label, stored] of cases) {
        const marks = reviewThenUndo({ ...stored }, { applyStartup: true });
        assert.equal(marks[0].hasOwn, true, `${label}: khóa phải hiện diện trước snapshot`);
        assert.equal(marks[3].xpToday, 7, `${label}: Undo phải cho 7`);
        assert.equal(marks[4].xpToday, 8, `${label}: +1 phải cho 8`);
    }
});

// ───────────────── 2. ĐỐI CHỨNG tầng hàm: bỏ khối khởi động (không có trong app) ─────────────────
test('đối chứng: BỎ khối khởi động ⇒ 12 rồi 13 — chuẩn hóa là thứ bảo vệ Undo', () => {
    const marks = reviewThenUndo({ xpToday: 5 }, { applyStartup: false });
    assert.equal(marks[0].hasOwn, false, 'đối chứng: thiếu khóa tại snapshot');
    assert.equal(marks[3].xpToday, 12, 'thiếu chuẩn hóa ⇒ Undo không trừ gì');
    assert.equal(marks[4].xpToday, 13);
});

test('đối chứng: bỏ khối khởi động với {xpToday:3} ⇒ 10 rồi 11 (chỉ trừ 2, sai bản chất)', () => {
    const marks = reviewThenUndo({ xpToday: 3 }, { applyStartup: false });
    assert.equal(marks[3].xpToday, 10, '3 → 5 bị hiểu thành "tăng 2" thay vì "kỳ mới +5"');
    assert.equal(marks[4].xpToday, 11);
});

// ───────────────── 3. Đường thay object SAU khởi động: tab khác / merge cloud ─────────────────
test('biên: merge tiến độ từ tab khác (bản cũ thiếu khóa) vẫn giữ khóa của bản local', () => {
    const local = { userXP: 10, stats: { xpToday: 5, lastXPDate: '' }, activityHeatmap: {}, unlockedBadges: [], frozenDates: [], recoveredDates: [] };
    const remoteLegacy = { userXP: 10, stats: { xpToday: 5 }, activityHeatmap: {}, unlockedBadges: [], frozenDates: [], recoveredDates: [] };
    for (const [order, merged] of [['local trước', mergeProgress(local, remoteLegacy, 'gamification')],
        ['remote trước', mergeProgress(remoteLegacy, local, 'gamification')]]) {
        assert.equal(Object.hasOwn(merged.stats, 'lastXPDate'), true, `${order}: khóa phải còn`);
        assert.equal(merged.stats.lastXPDate, '', `${order}: giữ giá trị đã chuẩn hóa`);
    }
    // Nếu CẢ HAI phía đều chưa chuẩn hóa thì merge KHÔNG tự thêm khóa — nhưng sau khởi động, phía
    // local luôn đã chuẩn hóa, nên trạng thái này không tồn tại trong ứng dụng.
    const bothLegacy = mergeProgress({ stats: { xpToday: 5 } }, { stats: { xpToday: 5 } }, 'gamification');
    assert.equal(Object.hasOwn(bothLegacy.stats, 'lastXPDate'), false,
        'merge thuần không tự chuẩn hóa (ghi nhận giới hạn, không phải lỗi)');
});

test('biên: acceptProgress THẬT với payload tab khác cũ ⇒ khóa hiện diện, Undo cho 7 rồi 8', async () => {
    const state = await import('../src/core/state.js');
    // Trạng thái đang sống đã được khởi động (khóa ""), rồi tab khác gửi tiến độ cũ.
    state.setGamification({ ...state.getState().gamification, stats: { xpToday: 5 } });
    rolloverDailyStats(state.getState().gamification.stats, TODAY, 0);
    trackAppOpen(state.getState().gamification.stats, NOW);
    state.acceptProgress({
        userXP: 0, totalReviews: 0, stats: { xpToday: 5 },
        activityHeatmap: {}, unlockedBadges: [], frozenDates: [], recoveredDates: []
    }, 'gamification');
    const stats = state.getState().gamification.stats;
    assert.equal(Object.hasOwn(stats, 'lastXPDate'), true, 'sau merge, khóa phải hiện diện');

    const marks = reviewThenUndo(stats, { applyStartup: false });   // đã chuẩn hóa ở trên
    assert.equal(marks[0].hasOwn, true);
    assert.equal(marks[3].xpToday, 7);
    assert.equal(marks[4].xpToday, 8);
});

// ───────────────── 4. Bảo vệ thứ tự khởi động (cửa sổ duy nhất từng thiếu khóa) ─────────────────
test('biên: main.js chuẩn hóa g.stats TRƯỚC khi hiển thị thẻ đầu tiên (không có cửa sổ nào để chấm)', () => {
    const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    const rollover = source.indexOf('rolloverDailyStats(g.stats');
    const open = source.indexOf('trackAppOpen(g.stats');
    const display = source.indexOf('displayCard(firstCardIndex)');
    const listeners = source.indexOf('setupEventListeners()');
    assert.ok(rollover > 0 && open > rollover, 'phải gọi rolloverDailyStats rồi trackAppOpen trên g.stats');
    assert.ok(display > open, 'chuẩn hóa phải xong trước khi hiển thị thẻ');
    assert.ok(listeners > 0 && open > listeners, 'khối khởi động nằm ngay sau khi gắn listener, cùng một task đồng bộ');
});
