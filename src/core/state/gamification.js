// src/core/state/gamification.js — T4.5b: XP, chuỗi ngày, huy hiệu, thống kê ngày.
//
// Đây là phần "động" nhất của store cũ: mọi hàm ở đây đều mutate HAI object
// tiến độ trong progress-store.js và/hoặc ghi IndexedDB + phát sự kiện UI.
// Gom về một module vì chúng gọi chéo nhau rất dày:
//   recordQuizAnswer → recordReviewResult → checkAndUpdateStreak → syncStreakFromHeatmap
//   syncStreakFromHeatmap → reconcileStreakFreeze / checkAndApplyStreakFreeze / saveGamification
//   saveGamification → prepareProgress / acceptProgress → setGamification
// Tách rời từng hàm sẽ tạo vòng import (đã kiểm bằng tests/state-split.test.mjs).
//
// Phần toán của streak nằm ở state/streak.js; module đó đọc trực tiếp live
// binding `gamification` của progress-store.js nên ở đây không cần wrapper.
import { saveProgressToDB } from '../idb.js';
import { rolloverDailyStats } from '../daily-stats.js';
import { captureProgress, mergeProgress } from '../progress-merge.js';
import { announceSyncStatus } from '../sync-status.js';
import { getDeviceId } from '../device.js';
import { getLocalDateString, getOffsetDateString } from '../utils/date.js';
import { skipPersistence, isPreviewMode } from './preview-mode.js';
import { safeShowToast } from './ui-notify.js';
import { gamification, dailyStats, setGamification, setDailyStats } from './progress-store.js';
import { MIN_STREAK_DAILY_REVIEWS, isDayStreakQualified, reconcileStreakFreeze, calculateStreakFromHeatmap } from './streak.js';

// ─── Cờ "đã đồng bộ lần đầu" (dùng để trì hoãn trừ Khiên Băng khi còn online) ─
let _initialSyncDone = false;
export function setInitialSyncDone(done = true) {
    _initialSyncDone = Boolean(done);
}
export function isInitialSyncDone() {
    return _initialSyncDone;
}

const progressActor = getDeviceId();

// ─── Tiện ích dùng chung trong module (gom các khối bị chép lặp trước T4.5b) ──
/** Phát sự kiện để UI vẽ lại thanh XP / rank / huy hiệu. */
function notifyGamificationUpdate() {
    document.getElementById('app-container')?.dispatchEvent(new CustomEvent('gamification:update'));
}

/** Sau khi ghi IndexedDB: xếp hàng đồng bộ Cloud + báo tab khác (cả hai đều lazy). */
function afterProgressSaved() {
    import('../sync.js').then(m => m.queueGamificationSync());
    if (typeof window !== 'undefined') import('../tab-bus.js').then(bus => bus.broadcastProgressUpdated?.(gamification, dailyStats));
}

/** Cấp độ luôn suy ra từ XP: level = floor(sqrt(xp/100)) + 1. */
function syncLevelFromXp() {
    gamification.currentLevel = Math.floor(Math.sqrt(gamification.userXP / 100)) + 1;
}

export function getComboMultiplier() {
    const consecutive = gamification.consecutiveCorrect || 0;
    if (consecutive >= 30) return 1.5;
    if (consecutive >= 10) return 1.2;
    if (consecutive >= 5) return 1.1;
    return 1;
}

export function prepareProgress(kind) {
    if (kind === 'daily') rolloverDailyStats(dailyStats, getLocalDateString());
    return captureProgress(kind === 'daily' ? dailyStats : gamification, kind, progressActor);
}

export function acceptProgress(remote, kind) {
    const merged = mergeProgress(prepareProgress(kind), remote, kind, kind === 'daily' ? getLocalDateString() : null);
    if (kind === 'daily') setDailyStats(merged);
    else {
        setGamification(merged);
        const refunded = reconcileStreakFreeze(gamification);
        const streak = calculateStreakFromHeatmap(
            gamification.activityHeatmap,
            getLocalDateString(),
            gamification.frozenDates,
            gamification.recoveredDates
        );
        merged.currentStreak = streak.currentStreak;
        merged.longestStreak = Math.max(merged.longestStreak || 0, streak.longestStreak);
        if (refunded) {
            prepareProgress('gamification');
        }
    }
    return merged;
}

export function ensureDailyStats() {
    const previous = dailyStats.lastDate;
    rolloverDailyStats(dailyStats, getLocalDateString());
    if (previous !== dailyStats.lastDate) void saveDailyStats();
    return dailyStats;
}

export function incrementNewCardsDone() {
    ensureDailyStats();
    dailyStats.newCardsDoneToday += 1;
    void saveDailyStats();
}
export function incrementDueCardsDone() {
    ensureDailyStats();
    dailyStats.dueDoneToday = (dailyStats.dueDoneToday || 0) + 1;
    void saveDailyStats();
}
export function incrementLearningCardsDone() {
    ensureDailyStats();
    dailyStats.learningDoneToday = (dailyStats.learningDoneToday || 0) + 1;
    void saveDailyStats();
}

export function recordReviewResult(isCorrect) {
    checkAndUpdateStreak(); // Đảm bảo cập nhật streak kể cả khi user treo tab sang ngày mới

    ensureDailyStats();

    dailyStats.todayTotal = (dailyStats.todayTotal || 0) + 1;
    if (isCorrect) {
        dailyStats.todayCorrect = (dailyStats.todayCorrect || 0) + 1;
        gamification.consecutiveCorrect = (gamification.consecutiveCorrect || 0) + 1;

        // Gamification: Thông báo Combo mỗi 10 câu đúng liên tiếp
        if (gamification.consecutiveCorrect > 0 && gamification.consecutiveCorrect % 10 === 0) {
            safeShowToast('Chuỗi Combo Đỉnh Cao', `🔥 Đỉnh quá! Trả lời đúng liên tiếp: ${gamification.consecutiveCorrect}`, 'ph-fire');
        }
    } else {
        // Option 3 Combo Degradation: Bấm sai khi >=30 rớt về 10, còn lại rớt về 0
        gamification.consecutiveCorrect = (gamification.consecutiveCorrect || 0) >= 30
            ? 10   // Rớt từ x1.5 xuống mốc 10 (x1.2)
            : 0;   // Mất combo hoàn toàn về 0 (x1.0)
    }
    gamification.totalReviews = (gamification.totalReviews || 0) + 1;
    // Dùng incremental save thay vì saveVocabulary()
    void saveDailyStats();
    saveGamification();
}

export function recordQuizAnswer(isCorrect) {
    recordReviewResult(isCorrect);
    logActivity();
    gamification.stats ||= {};
    gamification.stats.quizCorrectStreak = isCorrect ? (gamification.stats.quizCorrectStreak || 0) + 1 : 0;
    void saveGamification();
}

/**
 * Ghi 1 trong 2 object tiến độ xuống IndexedDB rồi merge ngược lại vào state.
 * (Trước T4.5b saveGamification/saveDailyStats là 2 bản chép gần như y hệt nhau.)
 */
async function persistProgressStore(kind, storeName, data, errorLabel) {
    if (skipPersistence()) return;
    prepareProgress(kind);
    try {
        const saved = await saveProgressToDB(storeName, structuredClone(data), kind);
        acceptProgress(saved, kind);
        afterProgressSaved();
    } catch (e) {
        announceSyncStatus({ phase: 'storage-error' });
        console.error(errorLabel, e);
    }
}

export async function saveGamification() {
    return persistProgressStore('gamification', 'gamification', gamification, 'Không lưu được tiến độ học:');
}

export async function saveDailyStats() {
    return persistProgressStore('daily', 'dailyStats', dailyStats, 'Không lưu được thống kê ngày:');
}

export function addXP(amount, floatText = null) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    const oldLevel = gamification.currentLevel || 1;
    gamification.userXP += amount;
    syncLevelFromXp();
    saveGamification();

    if (gamification.currentLevel > oldLevel) {
        import('../sound.js').then(m => m.playSound('levelUp'));
    }

    // Gọi event cho UI (hiệu ứng +XP)
    const xpEvent = new CustomEvent('gamification:xp_added', { detail: { amount, text: floatText } });
    document.getElementById('app-container')?.dispatchEvent(xpEvent);

    // Gọi event để check badge
    notifyGamificationUpdate();
}

export async function setXP(targetXP) {
    const xp = Math.max(0, parseInt(targetXP) || 0);
    gamification.userXP = xp;
    syncLevelFromXp();
    await saveGamification();

    notifyGamificationUpdate();
    console.log(`✨ XP đã được set thành ${xp} (Level ${gamification.currentLevel})`);
}

export function checkAndApplyStreakFreeze(todayStr = getLocalDateString()) {
    if (!gamification.streakFreezeCount || gamification.streakFreezeCount <= 0) return false;
    if (!gamification.activityHeatmap) gamification.activityHeatmap = {};

    const yesterdayStr = getOffsetDateString(todayStr, -1);
    const dayBeforeYesterdayStr = getOffsetDateString(todayStr, -2);

    const hasStudiedYesterday = isDayStreakQualified(gamification.activityHeatmap, yesterdayStr, gamification.frozenDates, gamification.recoveredDates);
    const hasStudiedDayBefore = isDayStreakQualified(gamification.activityHeatmap, dayBeforeYesterdayStr, gamification.frozenDates, gamification.recoveredDates);

    // Nếu hôm qua chưa đạt điều kiện và hôm kia có đạt điều kiện -> kích hoạt khiên cứu ngày hôm qua
    if (!hasStudiedYesterday && hasStudiedDayBefore) {
        if (gamification.lastStreakFreezeDate === dayBeforeYesterdayStr) {
            console.log("⚠️ Khiên Băng không thể kích hoạt 2 ngày liên tiếp.");
            return false;
        }

        gamification.frozenDates = gamification.frozenDates || [];
        if (!gamification.frozenDates.includes(yesterdayStr)) {
            gamification.frozenDates.push(yesterdayStr);
        }
        gamification.streakFreezeCount = Math.max(0, gamification.streakFreezeCount - 1);
        gamification.lastStreakFreezeDate = yesterdayStr;

        console.log(`❄️ Khiên Băng đã kích hoạt bảo vệ ngày ${yesterdayStr}!`);
        safeShowToast('Khiên Băng Kích Hoạt ❄️', `Kết giới băng giá đã bảo vệ chuỗi của bạn cho ngày ${yesterdayStr}!`, 'ph-snowflake');
        return true;
    }

    return false;
}

export function buyStreakFreeze() {
    const minStreak = 7;
    const costXP = 800;
    const maxStreakAchieved = Math.max(gamification.currentStreak || 0, gamification.longestStreak || 0);

    if (gamification.streakFreezeCount > 0) {
        return { success: false, message: "Bạn đã trang bị Khiên Băng rồi (Tối đa 1 khiên)!" };
    }
    if (maxStreakAchieved < minStreak) {
        return { success: false, message: `Bạn cần đạt kỷ lục chuỗi tối thiểu ${minStreak} ngày để đủ tư cách chế tác Khiên Băng!` };
    }
    if ((gamification.userXP || 0) < costXP) {
        return { success: false, message: `Không đủ XP! Chế tác Khiên Băng cần ${costXP} XP (Bạn đang có ${gamification.userXP || 0} XP).` };
    }

    gamification.userXP -= costXP;
    syncLevelFromXp();
    gamification.streakFreezeCount = 1;
    saveGamification();

    notifyGamificationUpdate();

    return { success: true, message: "Đã rèn thành công Khiên Băng Cổ Đại ❄️! Chuỗi học của bạn đã được bảo vệ an toàn." };
}

export function getStreakRecoveryStatus(todayStr = getLocalDateString()) {
    if (!gamification.activityHeatmap) return { canRecover: false, reason: "Chưa có dữ liệu hoạt động" };

    const heatmap = gamification.activityHeatmap;
    const frozen = gamification.frozenDates;
    const recovered = gamification.recoveredDates;
    const currentStreak = calculateStreakFromHeatmap(heatmap, todayStr, frozen, recovered).currentStreak;

    // Nếu người dùng đang duy trì chuỗi tốt từ 2 ngày trở lên -> Chuỗi đang hoạt động bình thường, không hiển thị cứu chuỗi
    if (currentStreak >= 2) {
        return { canRecover: false, reason: "Chuỗi học đang duy trì tốt, không có ngày gián đoạn cần cứu." };
    }

    let gapStartOffset = -1;
    const isTodayQ = isDayStreakQualified(heatmap, todayStr, frozen, recovered);
    const isYestQ = isDayStreakQualified(heatmap, getOffsetDateString(todayStr, -1), frozen, recovered);
    if (isTodayQ && !isYestQ) {
        gapStartOffset = -1;
    } else if (!isTodayQ && isYestQ) {
        gapStartOffset = -2;
    } else {
        gapStartOffset = -1;
    }

    // Quét vùng gián đoạn (gap) liên tiếp trong phạm vi 7 ngày gần nhất
    const missedDates = [];
    let gapOffset = gapStartOffset;

    while (gapOffset >= -7 && !isDayStreakQualified(heatmap, getOffsetDateString(todayStr, gapOffset), frozen, recovered)) {
        missedDates.push(getOffsetDateString(todayStr, gapOffset));
        gapOffset--;
    }

    // Không có ngày nào bị thiếu trong 7 ngày qua
    if (missedDates.length === 0) {
        return { canRecover: false, reason: "Chuỗi học đang duy trì tốt, không có ngày gián đoạn trong 7 ngày qua." };
    }

    // Nếu đã quét hết 7 ngày mà ngày thứ -8 vẫn là 0 (gap kéo dài quá 7 ngày)
    if (gapOffset < -7 && !isDayStreakQualified(heatmap, getOffsetDateString(todayStr, gapOffset), frozen, recovered)) {
        return {
            canRecover: false,
            reason: "Thời gian gián đoạn đã vượt quá 1 tuần (7 ngày). Chuỗi lửa đã hóa thành tro tàn cổ đại."
        };
    }

    // 3. Quét chuỗi học ngay trước vùng gián đoạn
    let priorStreak = 0;
    let priorOffset = gapOffset;
    while (isDayStreakQualified(heatmap, getOffsetDateString(todayStr, priorOffset), frozen, recovered)) {
        priorStreak++;
        priorOffset--;
    }

    // Yêu cầu chuỗi trước đó phải >= 2 ngày để việc tái sinh có giá trị
    if (priorStreak < 2) {
        return {
            canRecover: false,
            reason: priorStreak === 0
                ? "Không tìm thấy chuỗi học trước đợt gián đoạn."
                : "Chuỗi trước khi gián đoạn chỉ có 1 ngày, chưa đủ điều kiện tái sinh (cần tối thiểu 2 ngày)."
        };
    }

    // Đủ điều kiện thực hiện Thử Thách Tái Sinh trong vòng 1 tuần!
    const costXP = 500;
    const firstMissed = missedDates[missedDates.length - 1];
    const lastMissed = missedDates[0];
    const dateRangeStr = missedDates.length === 1 
        ? `ngày ${lastMissed}` 
        : `${missedDates.length} ngày (từ ${firstMissed} đến ${lastMissed})`;

    return {
        canRecover: true,
        missedDate: lastMissed, // Giữ thuộc tính tương thích ngược
        missedDates, // Danh sách toàn bộ các ngày gián đoạn trong 7 ngày qua
        missedDaysCount: missedDates.length,
        priorStreak,
        costXP,
        reason: `Bạn đã gián đoạn ${dateRangeStr}, làm nguội lạnh chuỗi ${priorStreak} ngày!`
    };
}

export function completeStreakRecovery(missedDates) {
    const datesToRecover = Array.isArray(missedDates) 
        ? missedDates.filter(Boolean) 
        : (missedDates ? [missedDates] : []);

    if (datesToRecover.length === 0) {
        return { success: false, message: "Ngày tái sinh chuỗi không hợp lệ" };
    }

    const costXP = 500;
    if ((gamification.userXP || 0) < costXP) {
        return { success: false, message: `Không đủ Tinh Hoa XP để làm lễ vật tái sinh! Cần ${costXP} XP (bạn có ${gamification.userXP || 0} XP).` };
    }

    gamification.userXP -= costXP;
    syncLevelFromXp();

    if (!gamification.activityHeatmap) gamification.activityHeatmap = {};
    gamification.recoveredDates = gamification.recoveredDates || [];

    datesToRecover.forEach(dateStr => {
        gamification.activityHeatmap[dateStr] = Math.max(gamification.activityHeatmap[dateStr] || 0, 1);
        if (!gamification.recoveredDates.includes(dateStr)) {
            gamification.recoveredDates.push(dateStr);
        }
    });

    unlockBadge('special_phoenix');
    syncStreakFromHeatmap();

    const rangeText = datesToRecover.length === 1 
        ? datesToRecover[0] 
        : `${datesToRecover.length} ngày (${datesToRecover[datesToRecover.length - 1]} → ${datesToRecover[0]})`;

    return {
        success: true,
        message: `🔥 TÁI SINH THÀNH CÔNG! Ngọn lửa tinh tú đã bùng cháy trở lại, kết nối thành công chuỗi ngày (${rangeText})!`,
        recoveredDates: datesToRecover
    };
}

export function syncStreakFromHeatmap(options = {}) {
    const today = getLocalDateString();
    if (!gamification.activityHeatmap) {
        gamification.activityHeatmap = {};
    }

    // Hoàn trả Khiên Băng nếu phát hiện đã học nhưng bị trừ nhầm trước khi đồng bộ
    reconcileStreakFreeze(gamification);

    // Tự động kích hoạt Khiên Băng nếu đủ điều kiện cứu ngày hôm qua (chỉ khi được phép)
    const allowFreeze = options.allowFreeze ?? (typeof navigator === 'undefined' || !navigator.onLine || _initialSyncDone);
    if (allowFreeze) {
        checkAndApplyStreakFreeze(today);
    }

    const { currentStreak, longestStreak } = calculateStreakFromHeatmap(
        gamification.activityHeatmap,
        today,
        gamification.frozenDates,
        gamification.recoveredDates
    );
    gamification.currentStreak = currentStreak;
    gamification.longestStreak = Math.max(gamification.longestStreak || 0, longestStreak);
    if (isDayStreakQualified(gamification.activityHeatmap, today, gamification.frozenDates, gamification.recoveredDates)) {
        gamification.lastStudyDate = today;
    } else {
        const activeDates = Object.keys(gamification.activityHeatmap)
            .filter(d => isDayStreakQualified(gamification.activityHeatmap, d, gamification.frozenDates, gamification.recoveredDates))
            .sort();
        if (activeDates.length > 0) {
            gamification.lastStudyDate = activeDates[activeDates.length - 1];
        }
    }
    saveGamification();

    notifyGamificationUpdate();
}

export function logActivity() {
    const today = getLocalDateString(); // YYYY-MM-DD local
    if (!gamification.activityHeatmap) {
        gamification.activityHeatmap = {};
    }
    if (!gamification.activityHeatmap[today]) {
        gamification.activityHeatmap[today] = 0;
    }
    gamification.activityHeatmap[today] += 1;
    const currentTodayCount = gamification.activityHeatmap[today];
    if (currentTodayCount === MIN_STREAK_DAILY_REVIEWS) {
        safeShowToast('Nối Chuỗi Thành Công! 🔥', `Tuyệt vời! Bạn đã hoàn thành ${MIN_STREAK_DAILY_REVIEWS} lượt ôn tập hôm nay để bảo toàn chuỗi tinh tú!`, 'ph-fire');
    }
    syncStreakFromHeatmap();
}

export function checkStreakStatusOnLoad() {
    // Không trừ khiên sớm khi vừa mở web nếu thiết bị đang online (chờ sync Firestore hoàn tất)
    const canApplyFreeze = typeof navigator === 'undefined' || !navigator.onLine || _initialSyncDone;
    syncStreakFromHeatmap({ allowFreeze: canApplyFreeze });
}

export function checkAndUpdateStreak() {
    syncStreakFromHeatmap();
}

// ─── BADGE CELEBRATION BATCHING ───────────────────────────────────────────
// Mỗi huy hiệu mở khóa từng: ghi IDB + nạp 4 module + phát 1 âm thanh + chạy
// 1 vòng confetti + tạo 1 toast. Nhập kho lớn có thể mở 20–30 huy hiệu cùng
// lúc ⇒ 20–30 lần ghi IDB, 20–30 vòng confetti và một "bức tường" toast.
// Nay: gộp các huy hiệu trong cùng 120ms thành MỘT đợt chúc mừng (1 âm thanh,
// 1 đợt confetti, 3 toast đầu + 1 toast tổng kết), và gộp 1 lần ghi IDB.
// Người dùng vẫn thấy đầy đủ thông tin mở khóa, giao diện không đổi.
let _badgeCelebrateTimer = null;
const _badgeCelebrateQueue = [];
let _badgeSaveTimer = null;

function scheduleGamificationSave() {
    if (_badgeSaveTimer) return;
    _badgeSaveTimer = setTimeout(() => {
        _badgeSaveTimer = null;
        saveGamification();
    }, 150);
}

function flushBadgeCelebrations() {
    _badgeCelebrateTimer = null;
    const ids = _badgeCelebrateQueue.splice(0);
    if (!ids.length) return;

    import('../sound.js').then(m => m.playSound('badgeUnlock')).catch(() => {});
    import('../../ui/render.js')
        .then(m => m.launchCelebrationConfetti?.({ count: Math.min(85 + ids.length * 8, 160) }))
        .catch(() => {});

    Promise.all([import('../../ui/modal.js'), import('../../features/badges.js')])
        .then(([ui, badgeModule]) => {
            const { BADGE_TRACKS, SPECIAL_BADGES } = badgeModule;
            const infoOf = (badgeId) => {
                let badgeInfo = SPECIAL_BADGES.find(b => b.id === badgeId);
                if (!badgeInfo) {
                    for (const track of BADGE_TRACKS) {
                        const index = track.ids.indexOf(badgeId);
                        if (index !== -1) {
                            badgeInfo = { name: track.names[index], icon: track.icons[index] };
                            break;
                        }
                    }
                }
                return badgeInfo;
            };

            // Tối đa 3 toast chi tiết; phần còn lại gộp thành 1 toast tổng kết
            // để không tạo hàng chục phần tử DOM + transition cùng lúc.
            ids.slice(0, 3).forEach((badgeId) => {
                const badgeInfo = infoOf(badgeId);
                const title = badgeInfo ? `Huy hiệu: ${badgeInfo.name}` : 'Huy hiệu mới!';
                const icon = badgeInfo ? badgeInfo.icon : 'ph-trophy';
                ui.showToast(title, 'Bạn vừa mở khóa một thành tựu tuyệt vời!', icon);
            });
            if (ids.length > 3) {
                ui.showToast(
                    `+${ids.length - 3} huy hiệu khác`,
                    'Bạn vừa mở khóa thêm nhiều thành tựu tuyệt vời!',
                    'ph-trophy'
                );
            }
        })
        .catch(() => {});
}

export function unlockBadge(badgeId) {
    if (isPreviewMode()) {
        if (!gamification.unlockedBadges) gamification.unlockedBadges = [];
        if (!gamification.unlockedBadges.includes(badgeId)) {
            gamification.unlockedBadges.push(badgeId);
        }
        return;
    }

    if (!gamification.unlockedBadges) gamification.unlockedBadges = [];
    if (!gamification.unlockedBadges.includes(badgeId)) {
        gamification.unlockedBadges.push(badgeId);
        scheduleGamificationSave();

        _badgeCelebrateQueue.push(badgeId);
        if (!_badgeCelebrateTimer) {
            _badgeCelebrateTimer = setTimeout(flushBadgeCelebrations, 120);
        }
    }
}

let _trackEventTimeout = null;

export function trackEvent(eventName, amount = 1) {
    if (!gamification.stats) {
        gamification.stats = {};
    }

    if (gamification.stats[eventName] !== undefined) {
        gamification.stats[eventName] += amount;
    } else {
        gamification.stats[eventName] = amount;
    }

    // Debounce save and update to avoid I/O spam
    if (_trackEventTimeout) clearTimeout(_trackEventTimeout);
    _trackEventTimeout = setTimeout(() => {
        saveGamification();
        notifyGamificationUpdate();
    }, 1500); // Batch all events within 1.5 seconds
}
