// scratch/test_streak_freeze_recovery.js
// Kiểm thử chức năng Khiên Băng (Streak Freeze) & Nghi Lễ Chuộc Tội (Streak Recovery)

import assert from 'node:assert';
import { getLocalDateString, getOffsetDateString } from '../src/core/utils/date.js';

console.log("❄️🔥 BẮT ĐẦU KIỂM THỬ TÍNH NĂNG KHIÊN BĂNG & HỒI SINH CHUỖI...\n");

const TODAY = '2026-09-22';
const YESTERDAY = getOffsetDateString(TODAY, -1);
const D2_AGO = getOffsetDateString(TODAY, -2);
const D3_AGO = getOffsetDateString(TODAY, -3);

// Mock Gamification State
let mockGamification = {
    userXP: 2000,
    currentLevel: 5,
    currentStreak: 10,
    longestStreak: 10,
    lastStudyDate: TODAY,
    activityHeatmap: {},
    streakFreezeCount: 0,
    lastStreakFreezeDate: "",
    frozenDates: [],
    recoveredDates: [],
};

function calculateStreakFromHeatmap(activityHeatmap = {}, todayStr = TODAY) {
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

    return currentStreak;
}

function buyStreakFreeze(g) {
    const minStreak = 7;
    const costXP = 800;
    const maxStreakAchieved = Math.max(g.currentStreak || 0, g.longestStreak || 0);

    if (g.streakFreezeCount > 0) {
        return { success: false, message: "Bạn đã trang bị Khiên Băng rồi!" };
    }
    if (maxStreakAchieved < minStreak) {
        return { success: false, message: `Yêu cầu kỷ lục >= ${minStreak} ngày!` };
    }
    if ((g.userXP || 0) < costXP) {
        return { success: false, message: `Không đủ XP! Cần ${costXP} XP.` };
    }

    g.userXP -= costXP;
    g.currentLevel = Math.floor(Math.sqrt(g.userXP / 100)) + 1;
    g.streakFreezeCount = 1;
    return { success: true };
}

function checkAndApplyStreakFreeze(g, todayStr = TODAY) {
    if (!g.streakFreezeCount || g.streakFreezeCount <= 0) return false;
    if (!g.activityHeatmap) g.activityHeatmap = {};

    const yesterdayStr = getOffsetDateString(todayStr, -1);
    const dayBeforeYesterdayStr = getOffsetDateString(todayStr, -2);

    const hasStudiedYesterday = (g.activityHeatmap[yesterdayStr] || 0) > 0;
    const hasStudiedDayBefore = (g.activityHeatmap[dayBeforeYesterdayStr] || 0) > 0;

    if (!hasStudiedYesterday && hasStudiedDayBefore) {
        if (g.lastStreakFreezeDate === dayBeforeYesterdayStr) {
            return false; // Không cho dùng 2 ngày liên tiếp
        }

        g.activityHeatmap[yesterdayStr] = 1;
        g.streakFreezeCount = 0;
        g.lastStreakFreezeDate = yesterdayStr;
        g.frozenDates = g.frozenDates || [];
        if (!g.frozenDates.includes(yesterdayStr)) {
            g.frozenDates.push(yesterdayStr);
        }
        return true;
    }
    return false;
}

function getStreakRecoveryStatus(g, todayStr = TODAY) {
    if (!g.activityHeatmap) return { canRecover: false, reason: "Chưa có dữ liệu hoạt động" };

    const heatmap = g.activityHeatmap;
    const currentStreak = calculateStreakFromHeatmap(heatmap, todayStr);

    // Nếu người dùng đang duy trì chuỗi tốt từ 2 ngày trở lên -> Chuỗi đang hoạt động bình thường, không hiển thị cứu chuỗi
    if (currentStreak >= 2) {
        return { canRecover: false, reason: "Chuỗi học đang duy trì tốt, không có ngày gián đoạn cần cứu." };
    }

    let gapStartOffset = -1;
    if ((heatmap[todayStr] || 0) > 0 && (heatmap[getOffsetDateString(todayStr, -1)] || 0) === 0) {
        gapStartOffset = -1;
    } else if ((heatmap[todayStr] || 0) === 0 && (heatmap[getOffsetDateString(todayStr, -1)] || 0) > 0) {
        gapStartOffset = -2;
    } else {
        gapStartOffset = -1;
    }

    const missedDates = [];
    let gapOffset = gapStartOffset;

    while (gapOffset >= -7 && (heatmap[getOffsetDateString(todayStr, gapOffset)] || 0) === 0) {
        missedDates.push(getOffsetDateString(todayStr, gapOffset));
        gapOffset--;
    }

    if (missedDates.length === 0) {
        return { canRecover: false, reason: "Chuỗi học đang duy trì tốt, không có ngày gián đoạn trong 7 ngày qua." };
    }

    if (gapOffset < -7 && (heatmap[getOffsetDateString(todayStr, gapOffset)] || 0) === 0) {
        return {
            canRecover: false,
            reason: "Thời gian gián đoạn đã vượt quá 1 tuần (7 ngày). Chuỗi lửa đã hóa thành tro tàn cổ đại."
        };
    }

    let priorStreak = 0;
    let priorOffset = gapOffset;
    while ((heatmap[getOffsetDateString(todayStr, priorOffset)] || 0) > 0) {
        priorStreak++;
        priorOffset--;
    }

    if (priorStreak < 2) {
        return {
            canRecover: false,
            reason: priorStreak === 0
                ? "Không tìm thấy chuỗi học trước đợt gián đoạn."
                : "Chuỗi trước khi gián đoạn chỉ có 1 ngày, chưa đủ điều kiện tái sinh (cần tối thiểu 2 ngày)."
        };
    }

    return {
        canRecover: true,
        missedDate: missedDates[0],
        missedDates,
        missedDaysCount: missedDates.length,
        priorStreak,
        costXP: 500
    };
}

function completeStreakRecovery(g, missedDates) {
    const costXP = 500;
    if ((g.userXP || 0) < costXP) {
        return { success: false, message: "Không đủ XP" };
    }
    const datesToRecover = Array.isArray(missedDates) ? missedDates : [missedDates];
    g.userXP -= costXP;
    g.activityHeatmap = g.activityHeatmap || {};
    g.recoveredDates = g.recoveredDates || [];

    datesToRecover.forEach(d => {
        g.activityHeatmap[d] = 1;
        if (!g.recoveredDates.includes(d)) {
            g.recoveredDates.push(d);
        }
    });

    return { success: true, recoveredDates: datesToRecover };
}

// ------------------------------------------------------------------
// TEST SUITE
// ------------------------------------------------------------------

// 1. Mua Khiên Băng khi không đủ điều kiện Streak
console.log("▶ [Test 1] Kiểm tra điều kiện mua Khiên Băng...");
let g1 = { ...mockGamification, userXP: 2000, currentStreak: 3, longestStreak: 3, streakFreezeCount: 0 };
let r1 = buyStreakFreeze(g1);
assert.strictEqual(r1.success, false, "Phải từ chối mua nếu streak < 7 ngày");
console.log("  ✔ 1.1: Từ chối khi streak < 7 ngày.");

// Không đủ XP
let g2 = { ...mockGamification, userXP: 300, currentStreak: 10, streakFreezeCount: 0 };
let r2 = buyStreakFreeze(g2);
assert.strictEqual(r2.success, false, "Phải từ chối mua nếu XP < 800");
console.log("  ✔ 1.2: Từ chối khi XP < 800.");

// Đủ điều kiện
let g3 = { ...mockGamification, userXP: 1000, currentStreak: 10, streakFreezeCount: 0 };
let r3 = buyStreakFreeze(g3);
assert.strictEqual(r3.success, true, "Phải mua thành công khi đủ điều kiện");
assert.strictEqual(g3.userXP, 200, "Phải trừ đúng 800 XP");
assert.strictEqual(g3.streakFreezeCount, 1, "Khiên Băng phải bằng 1");
console.log("  ✔ 1.3: Mua thành công khi đủ 800 XP & Streak >= 7 ngày.");

// Đã có 1 khiên, không cho mua thêm khiên thứ 2
let r4 = buyStreakFreeze(g3);
assert.strictEqual(r4.success, false, "Không được tích trữ quá 1 khiên");
console.log("  ✔ 1.4: Giới hạn tối đa 1 khiên thành công.\n");

// 2. Tự động kích hoạt Khiên Băng khi quên học 1 ngày
console.log("▶ [Test 2] Khiên Băng tự động bảo vệ chuỗi...");
let gFreeze = {
    ...mockGamification,
    streakFreezeCount: 1,
    activityHeatmap: {
        [D3_AGO]: 10,
        [D2_AGO]: 15,
        // YESTERDAY: bỏ lỡ!
    }
};
assert.strictEqual(calculateStreakFromHeatmap(gFreeze.activityHeatmap, TODAY), 0);

let applied = checkAndApplyStreakFreeze(gFreeze, TODAY);
assert.strictEqual(applied, true, "Khiên Băng phải được kích hoạt");
assert.strictEqual(gFreeze.streakFreezeCount, 0, "Khiên Băng phải bị tiêu thụ về 0");
assert.strictEqual(gFreeze.activityHeatmap[YESTERDAY], 1, "Ngày hôm qua phải được cứu");
let streakAfterFreeze = calculateStreakFromHeatmap(gFreeze.activityHeatmap, TODAY);
assert.strictEqual(streakAfterFreeze, 3, "Chuỗi phải được bảo vệ nguyên vẹn (3 ngày)");
console.log("  ✔ Test 2 PASS: Khiên Băng tự động tiêu thụ và cứu chuỗi an toàn.\n");

// 3. Quy tắc trừng phạt: Không được dùng khiên 2 ngày liên tiếp
console.log("▶ [Test 3] Không cho phép dùng Khiên Băng 2 ngày liên tiếp...");
let gConsecutive = {
    ...mockGamification,
    streakFreezeCount: 1,
    lastStreakFreezeDate: D2_AGO,
    activityHeatmap: {
        [D3_AGO]: 10,
        [D2_AGO]: 1,
    }
};
let appliedConsecutive = checkAndApplyStreakFreeze(gConsecutive, TODAY);
assert.strictEqual(appliedConsecutive, false, "Không được dùng khiên 2 ngày liên tiếp");
console.log("  ✔ Test 3 PASS: Chặn thành công lạm dụng khiên liên tiếp.\n");

// 4. Thử Thách Tái Sinh: Hồi sinh chuỗi 1 ngày (trong 24h - 48h)
console.log("▶ [Test 4] Thử Thách Tái Sinh 1 ngày gián đoạn...");
let gBroken = {
    ...mockGamification,
    userXP: 1000,
    streakFreezeCount: 0,
    activityHeatmap: {
        [D3_AGO]: 20,
        [D2_AGO]: 15,
    }
};
let recStatus = getStreakRecoveryStatus(gBroken, TODAY);
assert.strictEqual(recStatus.canRecover, true, "Phải đủ điều kiện cứu chuỗi vì có chuỗi trước đó 2 ngày");
assert.strictEqual(recStatus.priorStreak, 2, "Chuỗi trước đó là 2 ngày");
assert.strictEqual(recStatus.missedDaysCount, 1, "Số ngày gián đoạn là 1 ngày");
assert.strictEqual(recStatus.costXP, 500, "Lễ vật tái sinh là 500 XP");

let recResult = completeStreakRecovery(gBroken, recStatus.missedDates);
assert.strictEqual(recResult.success, true, "Tái sinh thành công");
assert.strictEqual(gBroken.userXP, 500, "Phải trừ 500 XP");
assert.strictEqual(gBroken.activityHeatmap[YESTERDAY], 1, "Ngày hôm qua được phục hồi");
let recoveredStreak = calculateStreakFromHeatmap(gBroken.activityHeatmap, TODAY);
assert.strictEqual(recoveredStreak, 3, "Chuỗi đã được tái sinh nguyên vẹn (3 ngày)!");
console.log("  ✔ Test 4 PASS: Tái sinh thành công 1 ngày, nối chuỗi 3 ngày!\n");

// 5. Thử Thách Tái Sinh: Hồi sinh chuỗi gián đoạn 3 ngày (trong vòng 1 tuần)
console.log("▶ [Test 5] Thử Thách Tái Sinh gián đoạn 3 ngày trong tuần...");
const D4_AGO = getOffsetDateString(TODAY, -4);
const D5_AGO = getOffsetDateString(TODAY, -5);
const D6_AGO = getOffsetDateString(TODAY, -6);
let gMultiMiss = {
    ...mockGamification,
    userXP: 1000,
    activityHeatmap: {
        [D6_AGO]: 10,
        [D5_AGO]: 10,
        [D4_AGO]: 10,
        // D3_AGO, D2_AGO, YESTERDAY đều bỏ lỡ! (3 ngày gián đoạn)
    }
};
let recStatusMulti = getStreakRecoveryStatus(gMultiMiss, TODAY);
assert.strictEqual(recStatusMulti.canRecover, true, "Phải cho phép tái sinh gián đoạn 3 ngày");
assert.strictEqual(recStatusMulti.missedDaysCount, 3, "Phải phát hiện chính xác 3 ngày gián đoạn");
assert.strictEqual(recStatusMulti.priorStreak, 3, "Chuỗi trước khi gián đoạn là 3 ngày");

let recResultMulti = completeStreakRecovery(gMultiMiss, recStatusMulti.missedDates);
assert.strictEqual(recResultMulti.success, true);
assert.strictEqual(gMultiMiss.activityHeatmap[D3_AGO], 1);
assert.strictEqual(gMultiMiss.activityHeatmap[D2_AGO], 1);
assert.strictEqual(gMultiMiss.activityHeatmap[YESTERDAY], 1);
let multiStreak = calculateStreakFromHeatmap(gMultiMiss.activityHeatmap, TODAY);
assert.strictEqual(multiStreak, 6, "Chuỗi sau tái sinh phải nối liền thành 6 ngày (3 ngày cũ + 3 ngày cứu)!");
console.log("  ✔ Test 5 PASS: Tái sinh 3 ngày gián đoạn thành công, chuỗi đạt 6 ngày!\n");

// 6. Thử Thách Tái Sinh: Hồi sinh gián đoạn tối đa 7 ngày (1 tuần)
console.log("▶ [Test 6] Thử Thách Tái Sinh gián đoạn tối đa 7 ngày...");
const D7_AGO = getOffsetDateString(TODAY, -7);
const D8_AGO = getOffsetDateString(TODAY, -8);
const D9_AGO = getOffsetDateString(TODAY, -9);
let g7DaysMiss = {
    ...mockGamification,
    userXP: 800,
    activityHeatmap: {
        [D9_AGO]: 15,
        [D8_AGO]: 20,
        // D7_AGO down to YESTERDAY: nghỉ 7 ngày liên tục!
    }
};
let recStatus7 = getStreakRecoveryStatus(g7DaysMiss, TODAY);
assert.strictEqual(recStatus7.canRecover, true, "Phải cho phép tái sinh khi gián đoạn đúng 7 ngày");
assert.strictEqual(recStatus7.missedDaysCount, 7, "Phát hiện đủ 7 ngày gián đoạn");
assert.strictEqual(recStatus7.priorStreak, 2, "Chuỗi trước đó là 2 ngày (D9, D8)");

let recResult7 = completeStreakRecovery(g7DaysMiss, recStatus7.missedDates);
assert.strictEqual(recResult7.success, true);
let streak7 = calculateStreakFromHeatmap(g7DaysMiss.activityHeatmap, TODAY);
assert.strictEqual(streak7, 9, "Chuỗi sau tái sinh phải là 9 ngày (2 ngày cũ + 7 ngày tái sinh)!");
console.log("  ✔ Test 6 PASS: Tái sinh tròn 7 ngày thành công, chuỗi phục hồi 9 ngày!\n");

// 7. Từ chối tái sinh khi gián đoạn quá 7 ngày (ví dụ 8 ngày)
console.log("▶ [Test 7] Từ chối tái sinh khi gián đoạn vượt quá 1 tuần (8 ngày)...");
const D10_AGO = getOffsetDateString(TODAY, -10);
let gTooLate = {
    ...mockGamification,
    userXP: 800,
    activityHeatmap: {
        [D10_AGO]: 30, // Nghỉ từ D9_AGO tới nay (hơn 8 ngày)
    }
};
let recStatusTooLate = getStreakRecoveryStatus(gTooLate, TODAY);
assert.strictEqual(recStatusTooLate.canRecover, false, "Phải từ chối vì đã quá 1 tuần");
assert.ok(recStatusTooLate.reason.includes("vượt quá 1 tuần"), "Thông báo lý do vượt quá 1 tuần");
console.log("  ✔ Test 7 PASS: Chặn thành công trường hợp gián đoạn quá 1 tuần.\n");

// 8. Tái sinh chuỗi khi người dùng đã quay lại học hôm nay (hàn gắn chuỗi cũ với chuỗi mới)
console.log("▶ [Test 8] Hàn gắn chuỗi cũ khi đã học ngày hôm nay...");
let gStudiedToday = {
    ...mockGamification,
    userXP: 1000,
    activityHeatmap: {
        [D5_AGO]: 10,
        [D4_AGO]: 10,
        // D3_AGO, D2_AGO, YESTERDAY: bỏ lỡ
        [TODAY]: 5, // Hôm nay đã quay lại học!
    }
};
// Chuỗi hiện tại khi chưa tái sinh chỉ là 1 ngày (hôm nay)
assert.strictEqual(calculateStreakFromHeatmap(gStudiedToday.activityHeatmap, TODAY), 1);

let recStatusStudied = getStreakRecoveryStatus(gStudiedToday, TODAY);
assert.strictEqual(recStatusStudied.canRecover, true, "Vẫn cho phép tái sinh vùng gián đoạn trước đó");
assert.strictEqual(recStatusStudied.missedDaysCount, 3, "Phát hiện 3 ngày bị thiếu");
assert.strictEqual(recStatusStudied.priorStreak, 2, "Chuỗi trước đó là 2 ngày");

let recResultStudied = completeStreakRecovery(gStudiedToday, recStatusStudied.missedDates);
assert.strictEqual(recResultStudied.success, true);
let finalStreak = calculateStreakFromHeatmap(gStudiedToday.activityHeatmap, TODAY);
assert.strictEqual(finalStreak, 6, "Chuỗi phải kết nối hoàn chỉnh: 2 ngày cũ + 3 ngày tái sinh + 1 ngày hôm nay = 6 ngày!");
console.log("  ✔ Test 8 PASS: Hàn gắn chuỗi cũ với chuỗi hôm nay thành công mỹ mãn!\n");

// 9. Chuỗi đang hoạt động bình thường (>= 2 ngày) tuyệt đối KHÔNG kích hoạt nút Tái Sinh
console.log("▶ [Test 9] Chuỗi đang học tốt (>= 2 ngày) không được hiện Thử Thách Tái Sinh...");
let gActiveStreak = {
    ...mockGamification,
    userXP: 30000,
    activityHeatmap: {
        [D5_AGO]: 90, // Kỷ lục cũ
        // D4_AGO: trống
        [D2_AGO]: 15, // Chuỗi mới đang học
        [YESTERDAY]: 20,
        [TODAY]: 25,
    }
};
let activeStreak = calculateStreakFromHeatmap(gActiveStreak.activityHeatmap, TODAY);
assert.strictEqual(activeStreak, 3, "Chuỗi hiện tại là 3 ngày");

let recStatusActive = getStreakRecoveryStatus(gActiveStreak, TODAY);
assert.strictEqual(recStatusActive.canRecover, false, "Chuỗi 3 ngày đang học tốt -> canRecover PHẢI LÀ FALSE");
console.log("  ✔ Test 9 PASS: Không hiển thị nút Tái Sinh khi người dùng đang có chuỗi hoạt động bình thường!\n");

console.log("==========================================================================");
console.log("🎉 TẤT CẢ 9 TEST SUITE KHIÊN BĂNG & THỬ THÁCH TÁI SINH 1 TUẦN ĐÃ ĐẠT 100%!");
console.log("==========================================================================");

