// src/core/stats-rollback.js
//
// Hoàn tác thống kê của MỘT lượt chấm (Undo) theo ĐÚNG loại dữ liệu.
//
// Vì sao không dùng một phép "trừ delta cho mọi khoá số" (bản trước):
//   • `lastReviewAt`, `lastForgottenDate`, `justLeveledUp` là MỐC THỜI GIAN — trừ delta sẽ
//     biến chúng thành giá trị vô nghĩa nếu nơi khác vừa ghi mốc mới hơn.
//   • `earlyBirdStreak`, `vampireStreak`, `sunsetStreak`, `typingNoHintStreak`,
//     `consecutiveEasy`, `consecutiveDeletes` là MÁY TRẠNG THÁI: lượt chấm có thể RESET về 0
//     hoặc 1 chứ không chỉ cộng thêm, nên trừ delta là sai dấu.
//   • `maxLostStreak` là MAX register.
//   • Các bộ đếm theo NGÀY/TUẦN/THÁNG bị rollover ngay TRONG lượt chấm đầu tiên của kỳ mới:
//     `before` = 50 (hôm qua), `after` = 5 (hôm nay) ⇒ hiệu `after - before` = **-45** không
//     phải "phần A đã cộng". Trừ delta đó (bản vòng 2) biến 12 XP hôm nay thành 57 và kéo
//     `lastXPDate` về hôm qua.
//
// Nguyên tắc (AUDIT-R3.2):
//   COUNTER (cộng dồn): phần đóng góp = `after - baseline`, trong đó baseline = 0 nếu lượt chấm
//     ĐÃ SANG KỲ MỚI (khoá kỳ đổi ngay trong lượt, hoặc bộ đếm bị reset), ngược lại = `before`.
//     Trừ đúng phần đó, kẹp ≥ 0 ⇒ cập nhật hợp lệ từ tab/thiết bị khác vẫn còn.
//   STATE (mốc thời gian / streak / max / last-write-wins): chỉ khôi phục khi giá trị hiện tại
//     VẪN LÀ giá trị mà lượt chấm đã ghi; nếu nơi khác đã ghi sau thì giữ nguyên.
//   Sự kiện lịch (khoá kỳ + xpLastWeek): KHÔNG khôi phục. "Hôm nay là ngày 03" hay "tuần này
//     bắt đầu từ W45" là sự thật lịch, không phải phần đóng góp của lượt chấm; kéo lùi khoá kỳ sẽ
//     làm bộ đếm của kỳ mới bị hiểu là của kỳ cũ.
//   Khoá lạ: không đụng tới, chỉ ghi vào `unclassified` để test bắt được khi có khoá mới.
//
// Đây là module thuần (không DOM, không state toàn cục) nên kiểm thử được trực tiếp.

/** Bộ đếm cộng dồn: mỗi sự kiện +1 (hoặc +N) và không bao giờ bị reset bởi chính lượt chấm. */
export const COUNTER_KEYS = new Set([
    'accidentCount', 'bareMinimumDays', 'darkModeDays', 'giveUpCount', 'karmaEncounter',
    'kingReturns', 'leechesHealed', 'monthlyCorrect', 'monthlyTotal', 'nightOwlWords',
    'opensToday', 'overdueReviewedToday', 'reviewsOnLastDay', 'totalTimeSpent',
    'typingClearedInput', 'typingLeechRepeats', 'wordsAddedToday', 'xpToday', 'xpWeekTotal',
    'easyPresses', 'hardPresses',
    // AUDIT-R3.2: hai bộ đếm này gắn với CÂU TRẢ LỜI đã chấm (đúng / đúng nhanh), không phải
    // với thao tác gõ nói chung, nên phải hoàn được khi Undo.
    'typingTotalCorrect', 'typingFastAnswers'
]);

/**
 * Trạng thái / mốc thời gian / chuỗi / max: khôi phục theo kiểu "nếu chưa bị ghi đè".
 */
export const STATE_KEYS = new Set([
    'consecutiveDeletes', 'consecutiveEasy', 'earlyBirdStreak', 'justLeveledUp', 'lastAddedDate',
    'lastDarkModeDate', 'lastForgottenDate', 'lastHourBonusDate', 'lastOpenDate', 'lastReviewAt',
    'maxLostStreak', 'sunsetStreak', 'typingNoHintStreak', 'vampireStreak'
]);

/**
 * Khoá kỳ (calendar fact) — KHÔNG bao giờ khôi phục. `xpLastWeek` đi cùng `lastWeekKey`: nó là
 * tổng của tuần TRƯỚC, được chốt lúc sang tuần, không phải phần lượt chấm cộng vào.
 */
export const PERIOD_KEYS = new Set([
    'lastMonthlyKey', 'lastOverdueDate', 'lastWeekKey', 'lastXPDate', 'xpLastWeek'
]);

/** Bộ đếm ↔ khoá kỳ tương ứng (để biết lượt chấm có làm reset bộ đếm hay không). */
export const PERIOD_KEY_OF = {
    xpToday: 'lastXPDate',
    xpWeekTotal: 'lastWeekKey',
    monthlyTotal: 'lastMonthlyKey',
    monthlyCorrect: 'lastMonthlyKey',
    overdueReviewedToday: 'lastOverdueDate'
};

const numeric = value => typeof value === 'number' && Number.isFinite(value);

/** Bộ đếm theo ngày KHÔNG có khoá kỳ riêng (không bị lượt chấm reset) ⇒ dùng dayKey làm lưới an toàn. */
const DAY_SCOPED_WITHOUT_KEY = new Set(['reviewsOnLastDay', 'wordsAddedToday', 'opensToday']);

/**
 * Chụp trạng thái thống kê TRƯỚC khi lượt chấm bắt đầu thay đổi bất cứ thứ gì.
 * @param {object} stats  gamification.stats
 * @param {string} dayKey  khoá ngày tại thời điểm chấm (getLocalDateString)
 */
export function snapshotReviewStats(stats, dayKey = '') {
    const values = {};
    if (stats && typeof stats === 'object') {
        for (const key of Object.keys(stats)) {
            if (numeric(stats[key]) || typeof stats[key] === 'string') values[key] = stats[key];
        }
    }
    return { dayKey, values };
}

/**
 * Tập thay đổi do lượt chấm gây ra.
 * `counters[key] = { before, after }` — giữ CẢ HAI để nơi hoàn tác tự tính phần đóng góp (cần
 * biết lượt chấm có sang kỳ mới hay không, xem `revertReviewStats`).
 * `instants` = giá trị lượt chấm đã ghi cho STATE_KEYS.
 * `unclassified` liệt kê khoá chưa được phân loại — KHÔNG bị hoàn, chỉ để phát hiện.
 */
export function diffReviewStats(snapshot, stats) {
    const before = snapshot?.values || {};
    const current = stats && typeof stats === 'object' ? stats : {};
    const changes = { counters: {}, instants: {}, unclassified: [], periodKeys: {} };
    // AUDIT-R3.2: ghi lại khoá kỳ SAU lượt chấm cho MỌI khoá kỳ, kể cả khoá không đổi trong lượt.
    // Nếu chỉ dựa vào `instants` (khoá bị đổi) thì không phân biệt được "kỳ đổi sau lượt chấm"
    // với "kỳ vốn đã đúng từ trước", và Undo sẽ trừ vào số của kỳ mới.
    for (const key of PERIOD_KEYS) {
        if (Object.hasOwn(current, key)) changes.periodKeys[key] = current[key];
    }
    for (const key of new Set([...Object.keys(before), ...Object.keys(current)])) {
        const prev = before[key], next = current[key];
        // AUDIT-R4.1: với bộ đếm theo kỳ, "giá trị không đổi" KHÔNG có nghĩa "lượt chấm không đóng
        // góp gì". Hôm qua 5 XP, hôm nay lượt A kiếm 5 XP ⇒ `xpToday` 5 → 5 nhưng `lastXPDate` đã
        // đổi: 5 của hôm qua đã bị reset, 5 của hôm nay là khoản mới. Bỏ qua ở đây thì Undo A
        // không trừ gì và số của lượt B bị tính lẫn (12 thay vì 7).
        const crossedPeriod = (() => {
            const periodKey = PERIOD_KEY_OF[key];
            if (!periodKey) return false;
            return Object.hasOwn(before, periodKey) && Object.hasOwn(current, periodKey)
                && before[periodKey] !== current[periodKey];
        })();
        if (next === prev && !(crossedPeriod && COUNTER_KEYS.has(key))) continue;
        if (numeric(next)) {
            if (COUNTER_KEYS.has(key)) {
                changes.counters[key] = { before: numeric(prev) ? prev : 0, after: next };
            } else if (STATE_KEYS.has(key)) changes.instants[key] = next;
            else if (!PERIOD_KEYS.has(key)) changes.unclassified.push(key);
        } else if (typeof next === 'string') {
            if (STATE_KEYS.has(key)) changes.instants[key] = next;
            else if (!PERIOD_KEYS.has(key)) changes.unclassified.push(key);
        } else if (next === undefined) {
            // Khoá bị xoá trong lượt chấm: chỉ hoàn được nếu đó là trạng thái "last-write-wins".
            if (STATE_KEYS.has(key)) changes.instants[key] = undefined;
            else changes.unclassified.push(key);
        }
    }
    return changes;
}

/**
 * Phần đóng góp của lượt chấm cho MỘT bộ đếm, đã tách khỏi phần "chuyển kỳ".
 *
 * Ví dụ (ca 50 → A +5 → B +7): `before = 50`, `after = 5`, `lastXPDate` đổi 02→03 ngay trong A
 * ⇒ baseline = 0 ⇒ đóng góp = 5 (không phải 5 − 50 = −45). Nhờ vậy Undo A để lại 7 của B.
 */
export function counterContribution(key, change, { keyBefore, keyAfter, keyNow }) {
    if (!change || !numeric(change.after)) return 0;
    const before = numeric(change.before) ? change.before : 0;
    const periodKey = PERIOD_KEY_OF[key];
    let crossedPeriod = false;
    if (periodKey) {
        // Sang kỳ ngay trong lượt chấm: khoá kỳ đổi, hoặc bộ đếm bị reset (giá trị giảm).
        if (keyBefore !== undefined && keyAfter !== undefined && keyBefore !== keyAfter) crossedPeriod = true;
        if (change.after < before) crossedPeriod = true;
        // Kỳ đã đổi TIẾP sau lượt chấm ⇒ số hiện tại thuộc kỳ mới hơn, không phải phần của lượt này.
        if (keyAfter !== undefined && keyNow !== undefined && keyNow !== keyAfter) return null;
    }
    const baseline = crossedPeriod ? 0 : before;
    return Math.max(0, change.after - baseline);
}

/**
 * Hoàn lại phần của lượt chấm đã bị Undo.
 * @param {object} stats     gamification.stats HIỆN TẠI (có thể đã có cập nhật từ nơi khác)
 * @param {object} snapshot  kết quả snapshotReviewStats của chính lượt đó
 * @param {object} changes   kết quả diffReviewStats của chính lượt đó
 * @param {string} dayKey    khoá ngày HIỆN TẠI (giữ cho tương thích; việc tách kỳ nay dựa trên
 *                           chính khoá kỳ trong stats nên chính xác hơn)
 */
export function revertReviewStats(stats, snapshot, changes, dayKey = '') {
    if (!stats || !changes) return stats;
    const before = snapshot?.values || {};
    const written = changes.instants || {};
    const sameDay = !snapshot?.dayKey || !dayKey || snapshot.dayKey === dayKey;

    for (const key of Object.keys(changes.counters || {})) {
        const change = changes.counters[key];
        const periodKey = PERIOD_KEY_OF[key];
        // Không có khoá kỳ riêng nhưng là bộ đếm theo ngày: bỏ qua nếu đã sang ngày khác.
        if (!periodKey && !sameDay && DAY_SCOPED_WITHOUT_KEY.has(key)) continue;
        const contribution = counterContribution(key, change, {
            keyBefore: periodKey ? before[periodKey] : undefined,
            keyAfter: periodKey
                ? (changes.periodKeys?.[periodKey] ?? (Object.hasOwn(written, periodKey) ? written[periodKey] : stats[periodKey]))
                : undefined,
            keyNow: periodKey ? stats[periodKey] : undefined
        });
        // null = kỳ đã đổi sau lượt chấm ⇒ bỏ qua (số hiện tại không còn là phần của lượt này).
        if (contribution === null || contribution === 0) continue;
        const current = stats[key];
        if (!numeric(current)) continue;
        stats[key] = Math.max(0, current - contribution);
    }

    for (const key of Object.keys(written)) {
        if (PERIOD_KEYS.has(key)) continue;   // sự thật lịch — không kéo lùi
        // Chỉ khôi phục khi giá trị hiện tại vẫn đúng là thứ lượt chấm đã ghi.
        if (stats[key] !== written[key]) continue;
        if (Object.hasOwn(before, key)) stats[key] = before[key];
        else delete stats[key];
    }
    return stats;
}
