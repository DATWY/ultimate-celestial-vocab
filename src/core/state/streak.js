// src/core/state/streak.js — T4.5b: toàn bộ logic chuỗi ngày học (streak).
//
// Phần "toán" ở đây thuần: chỉ đọc heatmap + danh sách ngày đóng băng/phao cứu
// và trả về con số. Không ghi IndexedDB, không phát toast, không tự lưu.
//
// Ba hàm dưới giữ ĐÚNG chữ ký cũ, kể cả tham số mặc định lấy từ state hiện tại:
//     calculateStreakFromHeatmap(heatmap)   // today = hôm nay, frozen/recovered = state
//     reconcileStreakFreeze()               // = reconcileStreakFreeze(gamification)
// vì vậy chúng đọc live binding `gamification` của progress-store.js (cùng một
// object mà state.js gọi là `_gamification`) — không cần wrapper, không thêm byte.
import { getLocalDateString, getOffsetDateString } from '../utils/date.js';
import { gamification } from './progress-store.js';

export const MIN_STREAK_DAILY_REVIEWS = 10;
export const STREAK_LEGACY_CUTOFF_DATE = '2026-10-23';

export function isDayStreakQualified(activityHeatmap = {}, dateStr, frozenDates = gamification?.frozenDates, recoveredDates = gamification?.recoveredDates) {
    if (!dateStr) return false;
    if (frozenDates && frozenDates.includes(dateStr)) return true;
    if (recoveredDates && recoveredDates.includes(dateStr)) return true;

    const count = (activityHeatmap && activityHeatmap[dateStr]) || 0;
    return dateStr < STREAK_LEGACY_CUTOFF_DATE ? count > 0 : count >= MIN_STREAK_DAILY_REVIEWS;
}

/** Hoàn trả Khiên Băng bị trừ nhầm cho ngày thực ra đã học. Mutate `g`, trả về true nếu có hoàn trả. */
export function reconcileStreakFreeze(g = gamification) {
    if (!g) return false;
    let refunded = false;
    const heatmap = g.activityHeatmap || {};
    const frozen = Array.isArray(g.frozenDates) ? [...g.frozenDates] : [];

    // "Ngày đó thực ra đã học" — cùng một điều kiện được kiểm cho mọi ngày
    // trong frozenDates và cho lastStreakFreezeDate (trước T4.5b chép 2 lần).
    const hasRealStudyOn = (dateStr) => {
        const count = heatmap[dateStr] || 0;
        return count >= MIN_STREAK_DAILY_REVIEWS || (dateStr < STREAK_LEGACY_CUTOFF_DATE && count > 0);
    };

    const falseFrozenDates = frozen.filter(hasRealStudyOn);

    if (g.lastStreakFreezeDate && hasRealStudyOn(g.lastStreakFreezeDate) && !falseFrozenDates.includes(g.lastStreakFreezeDate)) {
        falseFrozenDates.push(g.lastStreakFreezeDate);
    }

    if (falseFrozenDates.length > 0) {
        console.log(`🛡️ Hoàn trả ${falseFrozenDates.length} Khiên Băng do phát hiện đã học (${falseFrozenDates.join(', ')})!`);
        g.frozenDates = frozen.filter(d => !falseFrozenDates.includes(d));
        if (falseFrozenDates.includes(g.lastStreakFreezeDate)) {
            g.lastStreakFreezeDate = "";
        }
        g.streakFreezeCount = Math.min(1, (g.streakFreezeCount || 0) + falseFrozenDates.length);
        refunded = true;
    }

    return refunded;
}

export function calculateStreakFromHeatmap(
    activityHeatmap = {},
    todayStr = getLocalDateString(),
    frozenDates = gamification?.frozenDates,
    recoveredDates = gamification?.recoveredDates
) {
    if (!activityHeatmap || typeof activityHeatmap !== 'object') {
        return { currentStreak: 0, longestStreak: 0 };
    }

    const isTodayQualified = isDayStreakQualified(activityHeatmap, todayStr, frozenDates, recoveredDates);
    const yesterdayStr = getOffsetDateString(todayStr, -1);
    const isYesterdayQualified = isDayStreakQualified(activityHeatmap, yesterdayStr, frozenDates, recoveredDates);

    let currentStreak = 0;
    let checkDateStr = null;

    if (isTodayQualified) {
        currentStreak = 1;
        checkDateStr = yesterdayStr;
    } else if (isYesterdayQualified) {
        currentStreak = 1;
        checkDateStr = getOffsetDateString(yesterdayStr, -1);
    }

    if (checkDateStr) {
        while (isDayStreakQualified(activityHeatmap, checkDateStr, frozenDates, recoveredDates)) {
            currentStreak += 1;
            checkDateStr = getOffsetDateString(checkDateStr, -1);
        }
    }

    const allCandidateDates = new Set([
        ...Object.keys(activityHeatmap),
        ...(frozenDates || []),
        ...(recoveredDates || [])
    ]);

    const qualifiedDates = [...allCandidateDates]
        .filter(d => isDayStreakQualified(activityHeatmap, d, frozenDates, recoveredDates))
        .sort();

    let longestStreak = 0;
    let tempStreak = 0;
    let prevDateStr = null;

    for (const dateStr of qualifiedDates) {
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
