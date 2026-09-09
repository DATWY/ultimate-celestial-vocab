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
