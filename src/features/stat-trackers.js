// src/features/stat-trackers.js
//
// GAME-01: nối dây 25 khoá `gamification.stats` từng KHÔNG có nơi ghi, khiến 33/80
// huy hiệu đặc biệt không bao giờ mở được (xem báo cáo kiểm toán). Mỗi hàm ở đây
// là hàm thuần theo nghĩa "cho object stats + thời điểm, cập nhật bộ đếm" — không
// đọc DOM, không localStorage, để test được và để mọi call site chỉ phải gọi một
// chỗ thay vì rải logic khắp events.js.
//
// Quy ước: mọi bộ đếm "theo ngày" đều có khoá ngày riêng (`last*Date`) để rollover
// đúng khi người dùng học qua nửa đêm.

const DAY_MS = 86_400_000;

const localDate = ms => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const monthKey = ms => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Đảm bảo object stats tồn tại và các khoá mới có mặc định. */
export function ensureStats(stats) {
    const s = stats && typeof stats === 'object' ? stats : {};
    for (const key of [
        'accidentCount', 'bareMinimumDays', 'consecutiveDeletes', 'consecutiveEasy', 'darkModeDays',
        'earlyBirdStreak', 'justLeveledUp', 'karmaEncounter', 'kingReturns', 'leechesHealed',
        'maxLostStreak', 'monthlyCorrect', 'monthlyTotal', 'nightOwlWords', 'opensToday',
        'overdueReviewedToday', 'sunsetStreak', 'totalTimeSpent', 'typingClearedInput',
        'typingLeechRepeats', 'typingNoHintStreak', 'vampireStreak', 'wordsAddedToday',
        'xpLastWeek', 'xpToday', 'giveUpCount', 'xpWeekTotal', 'reviewsOnLastDay'
    ]) {
        if (!Number.isFinite(Number(s[key]))) s[key] = 0;
    }
    for (const key of ['lastXPDate', 'lastAddedDate', 'lastDarkModeDate', 'lastOpenDate', 'lastOverdueDate', 'lastHourBonusDate', 'lastMonthlyKey', 'lastWeekKey']) {
        if (typeof s[key] !== 'string') s[key] = '';
    }
    if (!Number.isFinite(Number(s.lastForgottenDate))) s.lastForgottenDate = 0;
    return s;
}

/**
 * Ngày đã sang ngày mới ⇢ chốt sổ "ngày hôm qua" trước khi reset bộ đếm ngày.
 * `bareMinimumDays`: hôm qua học đúng bằng hạn mức tối thiểu (làm cho có).
 */
export function rolloverDailyStats(stats, todayKey, cap = 0) {
    const s = ensureStats(stats);
    if (s.lastOpenDate === todayKey) return s;
    // "Làm cho có" = hôm qua dừng ĐÚNG ở hạn mức tối thiểu. Dùng >= sẽ tính cả người
    // học gấp đôi hạn mức, làm huy hiệu procrastinator mất nghĩa.
    if (s.lastOpenDate && cap > 0 && num(s.reviewsOnLastDay) === cap) {
        s.bareMinimumDays = num(s.bareMinimumDays) + 1;
    }
    s.opensToday = 0;
    s.wordsAddedToday = 0;
    s.overdueReviewedToday = 0;
    s.reviewsOnLastDay = 0;
    s.lastOpenDate = todayKey;
    return s;
}

/** Mở app (mỗi lần hiện tab) ⇢ fanatic: 10 lần mở trong một ngày. */
export function trackAppOpen(stats, now = Date.now()) {
    const s = ensureStats(stats);
    const today = localDate(now);
    if (s.lastOpenDate !== today) {
        s.lastOpenDate = today;
        s.opensToday = 0;
    }
    s.opensToday = num(s.opensToday) + 1;
    return s;
}

/**
 * Một lượt chấm SRS/quiz. Đây là nơi "đổ" phần lớn bộ đếm.
 *
 * @param {object} p
 * @param {object} p.stats      gamification.stats (được sửa tại chỗ)
 * @param {object} p.card       thẻ TRƯỚC khi chấm
 * @param {object} p.updatedCard thẻ SAU khi chấm (để biết leech đã tốt nghiệp)
 * @param {number} p.rating     1..4
 * @param {number} p.now
 * @param {boolean} p.isTyping
 * @param {boolean} p.hintUsed
 * @param {boolean} p.inputCleared
 */
export function trackReview({ stats, card, updatedCard, rating, now = Date.now(), isTyping = false, hintUsed = false, inputCleared = false } = {}) {
    const s = ensureStats(stats);
    const today = localDate(now);
    const correct = rating > 1;

    // 1. Quên (Again) = "tai nạn" + mốc quên gần nhất (special_invincible cần mốc này).
    if (!correct) {
        s.accidentCount = num(s.accidentCount) + 1;
        s.lastForgottenDate = now;
        s.consecutiveEasy = 0;
    } else {
        // 2. Chuỗi bấm Dễ liên tiếp (special_untouchable ≥ 100)
        s.consecutiveEasy = rating === 4 ? num(s.consecutiveEasy) + 1 : 0;
    }

    // 3. Tổng tháng: thước đo "phong độ" (peak_form / sniper / eidetic)
    const month = monthKey(now);
    if (s.lastMonthlyKey !== month) {
        s.lastMonthlyKey = month;
        s.monthlyCorrect = 0;
        s.monthlyTotal = 0;
    }
    s.monthlyTotal = num(s.monthlyTotal) + 1;
    if (correct) s.monthlyCorrect = num(s.monthlyCorrect) + 1;

    // 4. Ôn thẻ QUÁ HẠN trong hôm nay (special_firefighter ≥ 100)
    const dueDate = Number(card?.srsDueDate) || 0;
    if (correct && dueDate && dueDate < now - DAY_MS) {
        if (s.lastOverdueDate !== today) {
            s.lastOverdueDate = today;
            s.overdueReviewedToday = 0;
        }
        s.overdueReviewedToday = num(s.overdueReviewedToday) + 1;
    }

    // 5. Chữa được leech: thẻ từng ≥4 lần quên nay tốt nghiệp Mastered (special_healer ≥ 50)
    if (card?.srsStatus !== 'Mastered' && updatedCard?.srsStatus === 'Mastered' && (Number(card?.lapses) || 0) >= 4) {
        s.leechesHealed = num(s.leechesHealed) + 1;
    }

    // 6. Chế độ gõ: chuỗi không dùng gợi ý, số lần xoá hết ô nhập, số lần gặp leech
    if (isTyping) {
        if (inputCleared) s.typingClearedInput = num(s.typingClearedInput) + 1;
        if (card?.isLeech) s.typingLeechRepeats = num(s.typingLeechRepeats) + 1;
        s.typingNoHintStreak = correct && !hintUsed ? num(s.typingNoHintStreak) + 1 : 0;
    }

    // 7. Thời gian học: cộng khoảng cách giữa hai lượt chấm, chặn trần 2 phút/lượt
    //    để không tính thời gian treo máy (bookworm 2h / time_lord 100h / turtle).
    if (s.lastReviewAt) {
        const delta = Math.max(0, Math.min(120_000, now - num(s.lastReviewAt)));
        s.totalTimeSpent = num(s.totalTimeSpent) + Math.round(delta / 1000);
    }
    s.lastReviewAt = now;
    s.reviewsOnLastDay = num(s.reviewsOnLastDay) + 1;

    // 8. Karma: ôn ĐÚNG hạn (không sớm, không trễ) — "gieo nhân nào gặp quả nấy"
    if (correct && dueDate && dueDate >= now - DAY_MS && dueDate <= now + DAY_MS) {
        s.karmaEncounter = num(s.karmaEncounter) + 1;
    }

    return s;
}

/** Cộng XP trong ngày + chốt sổ tuần trước (special_bounty_hunter / mutant / phoenix). */
export function trackXP(stats, amount, now = Date.now()) {
    const s = ensureStats(stats);
    const today = localDate(now);
    if (s.lastXPDate !== today) {
        s.lastXPDate = today;
        s.xpToday = 0;
    }
    const week = `${new Date(now).getFullYear()}-W${Math.floor((now - new Date(new Date(now).getFullYear(), 0, 1)) / (7 * DAY_MS))}`;
    if (s.lastWeekKey !== week) {
        // Sang tuần mới: cả tuần vừa rồi trở thành "tuần trước" (mutant cần > 100).
        // Phải cộng dồn bằng xpWeekTotal vì xpToday bị reset mỗi ngày — chép xpToday
        // sẽ ra 0 nếu hôm nay vừa mở app trước khi học.
        if (s.lastWeekKey) s.xpLastWeek = num(s.xpWeekTotal);
        s.lastWeekKey = week;
        s.xpWeekTotal = 0;
        s.xpToday = 0;
    }
    s.xpToday = num(s.xpToday) + num(amount);
    s.xpWeekTotal = num(s.xpWeekTotal) + num(amount);
    return s;
}

/** Thêm từ mới: hôm nay thêm bao nhiêu, thêm ban đêm, reset chuỗi xoá. */
export function trackWordAdded(stats, now = Date.now()) {
    const s = ensureStats(stats);
    const today = localDate(now);
    if (s.lastAddedDate !== today) {
        s.lastAddedDate = today;
        s.wordsAddedToday = 0;
    }
    s.wordsAddedToday = num(s.wordsAddedToday) + 1;
    if (new Date(now).getHours() < 4) s.nightOwlWords = num(s.nightOwlWords) + 1;
    s.consecutiveDeletes = 0;
    return s;
}

/**
 * Xoá từ.
 *  • special_black_hole: 10 lần xoá LIÊN TIẾP (thêm từ hoặc ôn tập sẽ reset).
 *  • special_give_up: xoá một từ VỪA TẠO trong 60 giây — điều kiện cũ
 *    (`leechesHealed === -1`) là vô nghiệm nên huy hiệu này chết 100%.
 */
export function trackDeletion(stats, card = null, now = Date.now()) {
    const s = ensureStats(stats);
    s.consecutiveDeletes = num(s.consecutiveDeletes) + 1;
    const created = Number(card?.createdAt ?? card?.contentUpdatedAt ?? card?.updatedAt ?? 0);
    if (created > 0 && now - created <= 60_000) s.giveUpCount = num(s.giveUpCount) + 1;
    return s;
}

/** Bật giao diện tối: đếm số NGÀY có dùng dark mode (special_incognito ≥ 7). */
export function trackDarkMode(stats, now = Date.now()) {
    const s = ensureStats(stats);
    const today = localDate(now);
    if (s.lastDarkModeDate !== today) {
        s.lastDarkModeDate = today;
        s.darkModeDays = num(s.darkModeDays) + 1;
    }
    return s;
}

/**
 * Thưởng theo GIỜ của lượt học đầu tiên trong ngày — mỗi ngày chỉ tính một lần:
 *   • trước 6h   → earlyBirdStreak (chim sớm, cần 3 ngày liên tiếp)
 *   • 22h trở đi → vampireStreak   (cú đêm, cần 7 ngày)
 *   • 17–19h     → sunsetStreak    (hoàng hôn, cần 5 ngày)
 * Ngày không học thì chuỗi tương ứng về 0 (đúng nghĩa "chuỗi ngày").
 */
export function trackHourBonus(stats, now = Date.now()) {
    const s = ensureStats(stats);
    const today = localDate(now);
    if (s.lastHourBonusDate === today) return s;
    const yesterday = localDate(now - DAY_MS);
    const consecutive = s.lastHourBonusDate === yesterday;
    const hour = new Date(now).getHours();

    if (hour < 6) s.earlyBirdStreak = consecutive ? num(s.earlyBirdStreak) + 1 : 1;
    else s.earlyBirdStreak = 0;

    if (hour >= 22) s.vampireStreak = consecutive ? num(s.vampireStreak) + 1 : 1;
    else s.vampireStreak = 0;

    if (hour >= 17 && hour <= 19) s.sunsetStreak = consecutive ? num(s.sunsetStreak) + 1 : 1;
    else s.sunsetStreak = 0;

    s.lastHourBonusDate = today;
    return s;
}

/** Mất chuỗi ngày: ghi lại chuỗi dài nhất từng bị mất (return_of_the_king / slip_up). */
export function trackStreakLoss(stats, lostStreak) {
    const s = ensureStats(stats);
    s.maxLostStreak = Math.max(num(s.maxLostStreak), num(lostStreak));
    return s;
}

/** Quay lại sau ≥ 7 ngày vắng bóng (special_king_returns). */
export function trackReturnAfterAbsence(stats, lastStudyDate, now = Date.now()) {
    const s = ensureStats(stats);
    const last = Date.parse(`${lastStudyDate}T00:00:00`);
    if (Number.isFinite(last) && now - last >= 7 * DAY_MS) s.kingReturns = num(s.kingReturns) + 1;
    return s;
}

/** Lên cấp: golden_hour cần lên cấp trong khung 17–18h CÙNG NGÀY. */
export function trackLevelUp(stats, now = Date.now()) {
    const s = ensureStats(stats);
    s.justLeveledUp = now;
    return s;
}
