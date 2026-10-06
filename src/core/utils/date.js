// src/core/utils/date.js
// Timezone-safe date utilities for local consistency

/**
 * Trả về chuỗi ngày YYYY-MM-DD theo giờ ĐỊA PHƯƠNG của thiết bị người dùng.
 * Loại bỏ hoàn toàn sự phụ thuộc vào giờ UTC của toISOString() (tránh lệch ngày lúc 00:00 - 06:59 sáng ở VN).
 * 
 * @param {Date|number|string} [inputDate=new Date()] - Đối tượng ngày hoặc timestamp
 * @returns {string} Chuỗi ngày định dạng "YYYY-MM-DD"
 */
export function getLocalDateString(inputDate = new Date()) {
    const d = inputDate instanceof Date ? inputDate : new Date(inputDate);
    if (isNaN(d.getTime())) {
        const fallback = new Date();
        const y = fallback.getFullYear();
        const m = String(fallback.getMonth() + 1).padStart(2, '0');
        const day = String(fallback.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Cộng/trừ ngày an toàn theo giờ địa phương từ một chuỗi ngày "YYYY-MM-DD".
 * Hoàn toàn miễn nhiễm với lệch múi giờ, UTC và Daylight Saving Time.
 * 
 * @param {string} baseDateStr - Chuỗi ngày gốc "YYYY-MM-DD"
 * @param {number} dayOffset - Số ngày cần cộng hoặc trừ (ví dụ -1 là hôm qua, 1 là ngày mai)
 * @returns {string} Chuỗi ngày kết quả "YYYY-MM-DD"
 */
export function getOffsetDateString(baseDateStr, dayOffset = 0) {
    if (!baseDateStr || typeof baseDateStr !== 'string') {
        baseDateStr = getLocalDateString();
    }
    const parts = baseDateStr.split('-');
    if (parts.length !== 3) {
        baseDateStr = getLocalDateString();
    }
    const [y, m, d] = baseDateStr.split('-').map(Number);
    const targetDate = new Date(y, m - 1, d + dayOffset);
    return getLocalDateString(targetDate);
}
