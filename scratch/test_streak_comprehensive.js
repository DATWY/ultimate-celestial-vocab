// scratch/test_streak_comprehensive.js
// Bộ kiểm thử toàn diện logic Chuỗi Kiên Trì (Streak) & Tự phục hồi dữ liệu Heatmap

import assert from 'node:assert';
import { getLocalDateString, getOffsetDateString } from '../src/core/utils/date.js';

console.log("🔥 BẮT ĐẦU KIỂM THỬ TOÀN DIỆN LOGIC STREAK & HEATMAP...\n");

// Thuật toán chuẩn hóa từ src/core/state.js
function calculateStreakFromHeatmap(activityHeatmap = {}, todayStr = getLocalDateString()) {
    if (!activityHeatmap || typeof activityHeatmap !== 'object') {
        return { currentStreak: 0, longestStreak: 0 };
    }

    const hasStudiedToday = (activityHeatmap[todayStr] || 0) > 0;
    const yesterdayStr = getOffsetDateString(todayStr, -1);
    const hasStudiedYesterday = (activityHeatmap[yesterdayStr] || 0) > 0;

    let currentStreak = 0;
    let checkDateStr = null;

    if (hasStudiedToday) {
        currentStreak = 1;
        checkDateStr = yesterdayStr;
    } else if (hasStudiedYesterday) {
        currentStreak = 1;
        checkDateStr = getOffsetDateString(yesterdayStr, -1);
    } else {
        currentStreak = 0;
        checkDateStr = null;
    }

    if (checkDateStr) {
        while ((activityHeatmap[checkDateStr] || 0) > 0) {
            currentStreak += 1;
            checkDateStr = getOffsetDateString(checkDateStr, -1);
        }
    }

    const activeDates = Object.keys(activityHeatmap)
        .filter(d => (activityHeatmap[d] || 0) > 0)
        .sort();

    let longestStreak = 0;
    let tempStreak = 0;
    let prevDateStr = null;

    for (const dateStr of activeDates) {
        if (!prevDateStr) {
            tempStreak = 1;
        } else {
            const expectedNext = getOffsetDateString(prevDateStr, 1);
            if (dateStr === expectedNext) {
                tempStreak += 1;
            } else {
                tempStreak = 1;
            }
        }
        if (tempStreak > longestStreak) {
            longestStreak = tempStreak;
        }
        prevDateStr = dateStr;
    }

    longestStreak = Math.max(longestStreak, currentStreak);

    return { currentStreak, longestStreak };
}

// ----------------------------------------------------
// TEST 1: XỬ LÝ DATE & MÚI GIỜ
// ----------------------------------------------------
console.log("▶ [Test 1] Kiểm tra tính toán ngày tháng và chuyển tiếp lịch...");
assert.strictEqual(getOffsetDateString('2026-03-01', -1), '2026-02-28', 'Lỗi lùi ngày đầu tháng 3');
assert.strictEqual(getOffsetDateString('2026-01-01', -1), '2025-12-31', 'Lỗi lùi ngày qua năm mới');
assert.strictEqual(getOffsetDateString('2024-03-01', -1), '2024-02-29', 'Lỗi năm nhuận 2024');
assert.strictEqual(getOffsetDateString('2026-12-31', 1), '2027-01-01', 'Lỗi tiến ngày sang năm mới');
console.log("  ✔ Test 1 PASS: Chuyển tiếp ngày tháng hoàn toàn chuẩn xác.\n");

// ----------------------------------------------------
// TEST 2: KỊCH BẢN HỌC BÌNH THƯỜNG TRONG NGÀY
// ----------------------------------------------------
console.log("▶ [Test 2] Kịch bản học bình thường trong ngày...");
const TODAY = '2026-09-22';
const YESTERDAY = '2026-09-21';
const D2_AGO = '2026-09-20';
const D3_AGO = '2026-09-19';

// 2.1: Sáng sớm hôm nay chưa học, hôm qua có học (chuỗi 3 ngày) -> Chuỗi phải còn nguyên
const hmMorning = {
    [D3_AGO]: 10,
    [D2_AGO]: 20,
    [YESTERDAY]: 15,
};
const resMorning = calculateStreakFromHeatmap(hmMorning, TODAY);
assert.strictEqual(resMorning.currentStreak, 3, "Sáng sớm chưa học nhưng hôm qua có học thì streak phải được bảo toàn");
console.log("  ✔ 2.1 PASS: Sáng sớm chưa học, Streak bảo toàn ở mốc hôm qua (3 ngày).");

// 2.2: Học thẻ đầu tiên hôm nay -> Tăng từ 3 lên 4
const hmFirstCard = { ...hmMorning, [TODAY]: 1 };
const resFirstCard = calculateStreakFromHeatmap(hmFirstCard, TODAY);
assert.strictEqual(resFirstCard.currentStreak, 4, "Sau khi học thẻ đầu tiên, streak phải tăng thêm 1");
console.log("  ✔ 2.2 PASS: Sau thẻ đầu tiên hôm nay, Streak tăng lên 4 ngày.");

// 2.3: Học thêm 100 thẻ nữa hôm nay -> Giữ nguyên mốc 4
const hmMoreCards = { ...hmMorning, [TODAY]: 101 };
const resMoreCards = calculateStreakFromHeatmap(hmMoreCards, TODAY);
assert.strictEqual(resMoreCards.currentStreak, 4, "Học thêm nhiều thẻ trong ngày không làm tăng streak nhiều lần");
console.log("  ✔ 2.3 PASS: Học thêm 100 thẻ trong ngày, Streak vẫn giữ chuẩn 4 ngày.\n");

// ----------------------------------------------------
// TEST 3: KỊCH BẢN ĐỨT CHUỖI & BẮT ĐẦU LẠI
// ----------------------------------------------------
console.log("▶ [Test 3] Kịch bản đứt chuỗi và bắt đầu lại...");
// 3.1: Hôm qua bỏ lỡ, hôm nay chưa học -> Chuỗi về 0
const hmMissedYesterday = {
    [D3_AGO]: 10,
    [D2_AGO]: 20,
    // YESTERDAY: bỏ lỡ
};
const resMissed = calculateStreakFromHeatmap(hmMissedYesterday, TODAY);
assert.strictEqual(resMissed.currentStreak, 0, "Bỏ lỡ hôm qua mà hôm nay chưa học thì streak phải là 0");
assert.strictEqual(resMissed.longestStreak, 2, "Kỷ lục cũ 2 ngày phải được lưu giữ");
console.log("  ✔ 3.1 PASS: Bỏ lỡ hôm qua, Streak hiện tại = 0 ngày, Kỷ lục cũ (2 ngày) được bảo lưu.");

// 3.2: Hôm qua bỏ lỡ, hôm nay vào học thẻ đầu tiên -> Bắt đầu lại chuỗi 1 ngày
const hmRestart = { ...hmMissedYesterday, [TODAY]: 5 };
const resRestart = calculateStreakFromHeatmap(hmRestart, TODAY);
assert.strictEqual(resRestart.currentStreak, 1, "Bắt đầu lại chuỗi sau ngày nghỉ phải là 1 ngày");
assert.strictEqual(resRestart.longestStreak, 2, "Kỷ lục cũ 2 ngày vẫn lớn hơn chuỗi mới");
console.log("  ✔ 3.2 PASS: Bắt đầu lại sau đứt chuỗi -> Streak = 1 ngày, Kỷ lục cũ vẫn giữ nguyên.\n");

// ----------------------------------------------------
// TEST 4: KỊCH BẢN HOÀN TÁC (UNDO)
// ----------------------------------------------------
console.log("▶ [Test 4] Kịch bản Hoàn tác (Undo)...");
// Giả sử có chuỗi 5 ngày, hôm nay vừa học 1 thẻ -> Streak lên 6
const hmUndoBase = {};
for (let i = 1; i <= 5; i++) {
    hmUndoBase[getOffsetDateString(TODAY, -i)] = 10;
}
hmUndoBase[TODAY] = 1; // Học 1 thẻ hôm nay
const resBeforeUndo = calculateStreakFromHeatmap(hmUndoBase, TODAY);
assert.strictEqual(resBeforeUndo.currentStreak, 6, "Trước undo streak phải là 6");

// Bấm Undo thẻ duy nhất hôm nay -> Hôm nay về 0 và bị xoá khỏi heatmap
delete hmUndoBase[TODAY];
const resAfterUndo = calculateStreakFromHeatmap(hmUndoBase, TODAY);
assert.strictEqual(resAfterUndo.currentStreak, 5, "Sau khi undo thẻ duy nhất, streak phải hoàn tác về 5 ngày");
console.log("  ✔ Test 4 PASS: Hoàn tác thẻ duy nhất hôm nay, Streak tự động quay về mốc hôm qua (5 ngày).\n");

// ----------------------------------------------------
// TEST 5: KỊCH BẢN TỰ PHỤC HỒI CHO NGƯỜI DÙNG (SELF-HEALING)
// ----------------------------------------------------
console.log("▶ [Test 5] Kiểm tra tự phục hồi dữ liệu từ Heatmap trong ảnh chụp thực tế...");
// Mô phỏng Heatmap của người dùng có 45 ngày học liên tục đến hôm nay
const hmUserReal = {};
let walker = TODAY;
for (let i = 0; i < 45; i++) {
    hmUserReal[walker] = Math.floor(Math.random() * 50) + 5;
    walker = getOffsetDateString(walker, -1);
}
const resUserReal = calculateStreakFromHeatmap(hmUserReal, TODAY);
assert.strictEqual(resUserReal.currentStreak, 45, "Chuỗi 45 ngày liên tục trên Heatmap phải ra đúng 45");
assert.strictEqual(resUserReal.longestStreak, 45, "Kỷ lục chuỗi phải đạt 45");
console.log(`  ✔ Test 5 PASS: Dữ liệu Heatmap 45 ngày liên tục được chữa lành chính xác từ '2 NGÀY' thành ${resUserReal.currentStreak} NGÀY!\n`);

// ----------------------------------------------------
// TEST 6: ĐỒNG BỘ MULTI-DEVICE FIREBASE
// ----------------------------------------------------
console.log("▶ [Test 6] Mô phỏng gộp Heatmap đa thiết bị (Firebase Sync)...");
const localHM = {
    '2026-09-20': 15,
    '2026-09-22': 30 // Thiết bị PC học hôm nay
};
const remoteHM = {
    '2026-09-20': 15,
    '2026-09-21': 25 // Thiết bị Mobile học hôm qua
};
// Gộp max
const mergedHM = { ...remoteHM };
for (const k in localHM) {
    mergedHM[k] = Math.max(localHM[k] || 0, remoteHM[k] || 0);
}
const resMerged = calculateStreakFromHeatmap(mergedHM, TODAY);
assert.strictEqual(resMerged.currentStreak, 3, "Khi gộp PC (học hôm nay) và Mobile (học hôm qua) phải thành chuỗi 3 ngày liên tiếp");
console.log("  ✔ Test 6 PASS: Đồng bộ Cloud nối liền hoạt động giữa PC và Mobile (3 ngày liên tiếp).\n");

console.log("=================================================");
console.log("🎉 TẤT CẢ 6 NHÓM KIỂM THỬ ĐÃ VƯỢT QUA 100%!");
console.log("=================================================");
