// src/core/review-policy.js
//
// MỘT lượt chấm = MỘT sự kiện học. Đây là nguồn duy nhất định nghĩa lượt chấm đó tiêu vào
// NGÂN SÁCH NÀO của ngày, để Flashcard, Typing và Quiz không lệch nhau nữa.
//
// Trước đây mỗi chế độ tự quyết bằng điều kiện riêng, dẫn tới ba hệ quả sai:
//   • New + "Quên" chuyển ngay sang Learning nên KHÔNG BAO GIỜ tiêu ngân sách từ mới;
//   • Mastered + "Quên" không tăng dueDoneToday, còn Quiz thì tăng bất kể đúng/sai;
//   • Quiz bỏ qua "Tạm ẩn" và cap ngày nhưng vẫn ghi SRS.
//
// Ngân sách tiêu theo SỰ KIỆN ĐÃ GẶP THẺ, không theo việc trả lời đúng; XP/điểm mới phụ thuộc
// đúng/sai. Hàm thuần (không DOM, không state toàn cục) nên test được và dùng chung ba chế độ.

export const REVIEW_NEW = 'new';
export const REVIEW_LEARNING = 'learning';
export const REVIEW_DUE = 'due';

/** Thẻ có được phép chấm ngay lúc áp dụng câu trả lời hay không. */
export function isCardReviewable(card) {
    return !!card && card.isDeleted !== true && card.isSuspended !== true;
}

/**
 * Ngân sách mà lượt chấm sắp thực hiện sẽ tiêu, dựa trên trạng thái TRƯỚC khi chấm:
 *   'New'      ⇒ 'new'      (kể cả khi người học bấm "Quên")
 *   'Learning' ⇒ 'learning' (bộ đếm tiến trình, nằm NGOÀI cap lượt ôn)
 *   'Mastered' đến hạn hôm nay và chưa ôn hôm nay ⇒ 'due'
 *   còn lại (ôn sớm / cram / thẻ chưa đến hạn / thẻ ẩn-xoá) ⇒ null
 *
 * AUDIT-R3.3: "đến hạn" phải là MỘT quy tắc dùng chung với `isNaturallyDue` (queue).
 * `isNaturallyDue` coi thẻ KHÔNG có `srsDueDate` là đến hạn — đúng cho thẻ legacy đến từ TSV
 * hoặc bản đồng bộ cũ, vì nếu không chúng sẽ không bao giờ được ôn. Nhưng `classifyReview` lại
 * trả null cho đúng những thẻ đó, nên chúng đi qua cửa chấm mà KHÔNG tiêu suất `due`: ở trần
 * 200/200 vẫn ghi log và đổi lịch. Nay hai nơi cùng một quy tắc.
 */
export function classifyReview(previousCard, now = Date.now()) {
    if (!isCardReviewable(previousCard)) return null;
    const status = previousCard.srsStatus;
    if (status === 'New') return REVIEW_NEW;
    if (status === 'Learning') return REVIEW_LEARNING;
    if (status !== 'Mastered') return null;
    // Đã ôn hôm nay ⇒ không tính lần nữa (tránh tính hai lần trong cùng ngày).
    const last = Number(previousCard.lastReviewDate) || 0;
    if (last && new Date(last).toDateString() === new Date(now).toDateString()) return null;
    const due = Number(previousCard.srsDueDate) || 0;
    // Thẻ Mastered thiếu ngày hẹn: queue coi là đến hạn (isNaturallyDue) ⇒ ở đây cũng vậy, để
    // lượt chấm tiêu suất `due` thay vì đi qua như một lượt cram miễn phí.
    if (!due) return REVIEW_DUE;
    if (due > new Date(now).setHours(23, 59, 59, 999)) return null;
    return REVIEW_DUE;
}

/**
 * Suất còn lại của HAI ngân sách độc lập tại thời điểm ghi review.
 *
 * `totalRemaining` = trần lượt ôn/ngày − đã dùng (`maxReviewsPerDay`).
 * `newRemaining`   = hạn mức từ mới của ngày − đã giới thiệu (`computeDailyNewLimit`).
 *
 * Hai ngân sách này KHÔNG thay thế nhau: thẻ New phải còn CẢ HAI, thẻ đến hạn chỉ cần suất
 * tổng. Tách hàm thuần để Flashcard, Typing và Quiz cùng một quyết định, và để test được mà
 * không cần dựng state.
 */
export function reviewBudgets({ limit, used, newLimit, newUsed }) {
    const num = value => {
        const n = Number(value);
        return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    };
    return {
        totalRemaining: Math.max(0, num(limit) - num(used)),
        newRemaining: Math.max(0, num(newLimit) - num(newUsed))
    };
}

/**
 * Còn suất để GHI lượt chấm này hay không.
 *
 * `budget` là kết quả reviewBudgets() (hoặc một số = suất tổng, dạng tương thích cũ):
 *   New       ⇒ cần newRemaining > 0 VÀ totalRemaining > 0
 *   Due       ⇒ cần totalRemaining > 0
 *   Learning  ⇒ luôn được (thiết kế hiện tại: bước học sub-day nằm ngoài cap ngày)
 *   null/cram ⇒ luôn được (ôn sớm/cram không phải lượt ôn theo lịch)
 *
 * LƯU Ý: `reserved` KHÔNG thuộc hàm này. Nó là suất giữ chỗ khi DỰNG hàng đợi (để rebuild
 * không vượt trần); lúc ghi review thật thì chỉ so với phần đã dùng thật.
 */
export function canSpendBudget(category, budget) {
    if (category !== REVIEW_NEW && category !== REVIEW_DUE) return true;
    // Dạng cũ (chỉ truyền suất tổng): không có thông tin ngân sách từ mới nên chỉ kiểm suất tổng.
    if (typeof budget === 'number') return budget > 0;
    if (!(Number(budget?.totalRemaining) > 0)) return false;
    if (category === REVIEW_NEW) return Number(budget.newRemaining) > 0;
    return true;
}

/**
 * Vì sao bị chặn — để thông báo nói ĐÚNG lý do thay vì đoán theo loại thẻ.
 * 'new' = hết suất từ mới (còn suất tổng), 'total' = hết trần lượt ôn, null = được phép.
 */
export function budgetBlockReason(category, budgets) {
    if (canSpendBudget(category, budgets)) return null;
    if (category === REVIEW_NEW && Number(budgets?.newRemaining) <= 0) return 'new';
    return 'total';
}
