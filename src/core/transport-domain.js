// src/core/transport-domain.js — miền vận chuyển giữa các tab.
//
// Tab audit (`?audit=1`, chỉ ở DEV) dùng IndexedDB riêng (`celestial-vocab-audit-idb`),
// nhưng trước đây vẫn dùng CHUNG BroadcastChannel và CHUNG Web Lock với tab thường.
// Hệ quả: tiến độ/thẻ của tab audit (kể cả dữ liệu xem trước) chảy sang tab thường và
// được tab thường ghi bền xuống DB thật.
//
// Tách phần THUẦN này ra một module nhỏ để:
//   • `tab-bus.js` chỉ việc dùng, không tự suy luận tên kênh;
//   • test Node kiểm được quy tắc lọc mà không cần trình duyệt.

export const DEFAULT_DOMAIN = 'default';
export const AUDIT_DOMAIN = 'audit';

/** Tên miền theo nguồn lưu trữ duy nhất: `isIsolatedStorage` của idb.js. */
export function transportDomain(isIsolatedStorage) {
    return isIsolatedStorage ? AUDIT_DOMAIN : DEFAULT_DOMAIN;
}

/** Tên BroadcastChannel của một miền; miền mặc định giữ nguyên tên cũ. */
export function channelNameFor(domain) {
    return domain === DEFAULT_DOMAIN ? 'celestial_tab_bus' : `celestial_tab_bus:${domain}`;
}

/** Tên Web Lock bầu leader đồng bộ; miền mặc định giữ nguyên tên cũ. */
export function leaderLockNameFor(domain) {
    return domain === DEFAULT_DOMAIN ? 'celestial_sync_leader' : `celestial_sync_leader:${domain}`;
}

/**
 * Tab có được xử lý thông điệp này không?
 *
 * Thông điệp không khai báo `domain` là kiểu cũ. Cách xử lý phụ thuộc bản chạy:
 *   • `allowLegacy = true` (bản production): ở production KHÔNG có chế độ audit, nên thông
 *     điệp không khai báo miền chỉ có thể đến từ tab thường của bản deploy trước ⇒ nhận, để
 *     hai tab khác phiên bản vẫn đồng bộ.
 *   • `allowLegacy = false` (bản DEV): tab audit của mã CŨ cũng gửi thông điệp không có
 *     `domain` trên kênh cũ và không thể phân biệt với tab thường cũ ⇒ từ chối tất cả. Tab
 *     DEV cùng phiên bản vẫn đồng bộ vì đều gắn `domain`; tab DEV khác phiên bản thì không —
 *     đúng phạm vi, vì audit chỉ tồn tại ở DEV.
 */
export function acceptsMessage(domain, messageDomain, allowLegacy = true) {
    if (messageDomain === undefined || messageDomain === null) {
        return allowLegacy === true && domain === DEFAULT_DOMAIN;
    }
    return messageDomain === domain;
}
