// src/features/overview-signature.js — chữ ký dữ liệu cho hai khối nặng của tab Tổng quan.
//
// Vì sao: mỗi lần mở lại tab Tổng quan, code cũ dựng lại 84 ô heatmap và 14 cột dự phòng
// dù dữ liệu không đổi. So chữ ký trước khi dựng giúp lần mở thứ 2 trở đi gần như miễn phí.
// Hai hàm thuần (không DOM) để test được và để không kéo gamification.js vào môi trường Node.

/** Chữ ký heatmap: ngày hôm nay + toàn bộ cặp (ngày → số lượt), sắp xếp để không phụ thuộc thứ tự. */
export function heatmapSignature(activityHeatmap, todayStr) {
    const entries = Object.entries(activityHeatmap || {})
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `${todayStr}|${entries.length}|${entries.map(([k, v]) => `${k}=${v}`).join(',')}`;
}

/**
 * Chữ ký biểu đồ dự phòng: số thẻ sống, tổng khoảng ôn, tổng "ngày đến hạn" và số thẻ mới.
 * Đổi bất kỳ yếu tố nào cũng đổi chuỗi ⇒ vẽ lại; giống hệt ⇒ bỏ qua.
 */
export function forecastSignature(vocabulary, todayStr) {
    let n = 0, sumInterval = 0, sumDueDay = 0, newCount = 0;
    for (const card of vocabulary || []) {
        if (!card || card.isDeleted) continue;
        n++;
        sumInterval += card.srsInterval || 0;
        sumDueDay += Math.floor((card.srsDueDate || 0) / 86400000);
        if (card.srsStatus === 'New') newCount++;
    }
    return `${todayStr}|${n}|${sumInterval}|${sumDueDay}|${newCount}`;
}
