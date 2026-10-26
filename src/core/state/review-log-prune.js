// src/core/state/review-log-prune.js — T4.5b: cắt tỉa / đo / đóng gói reviewLogs.
//
// Toàn bộ file này là HÀM THUẦN LÁ: không đọc state toàn cục, không side-effect,
// không import gì (kể cả idb hay firebase). Vì vậy nó chạy được cả trong Node
// (test) lẫn trong chunk lazy firebase/sync.
//
// ===== T2.4 — GIỚI HẠN & CẮT TỈA reviewLogs (chống chạm trần 1 MiB của Firestore) =====
// reviewLogs CHỈ phục vụ thống kê/heatmap + train FSRS. Mất entry CŨ không ảnh
// hưởng lịch ôn, nhưng một document Firestore vượt 1 MiB thì ghi hỏng vĩnh viễn.
// Vì vậy log bị cắt theo CẢ HAI ngưỡng (số entry + số byte) và luôn giữ phần
// MỚI NHẤT. Card/progress/settings tuyệt đối không đi qua hàm này.
export const MAX_REVIEW_LOG_ENTRIES = 3000;
// 400 KB: bằng ~40% trần 1 MiB, đủ chỗ cho dict + deletedIds + metadata và cho
// biên an toàn khi Firestore cộng thêm overhead chỉ mục cho từng field.
export const MAX_REVIEW_LOG_BYTES = 400_000;
export const MAX_REVIEW_LOG_DELETED_IDS = 500;

/** Đếm BYTE UTF-8 (Firestore tính byte chứ không tính ký tự: tiếng Việt/emoji > 1 byte). */
export function utf8ByteLength(value) {
    const text = typeof value === 'string' ? value : String(value ?? '');
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code < 0x80) bytes += 1;
        else if (code < 0x800) bytes += 2;
        else if (code >= 0xD800 && code <= 0xDBFF) { bytes += 4; i++; } // cặp surrogate
        else bytes += 3;
    }
    return bytes;
}

/** Một row có thể là mảng (dạng local) hoặc chuỗi JSON (dạng Firestore). */
function parseReviewLogRow(raw) {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string' && raw.startsWith('[')) {
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : null;
        } catch (_) { return null; }
    }
    return null;
}

/** Chuẩn hoá đầu vào: thiếu field / rỗng / rác đều trả về cấu trúc an toàn. */
function normalizeReviewLogs(logs) {
    const source = Array.isArray(logs) ? { logs } : (logs && typeof logs === 'object' ? logs : {});
    const dict = Array.isArray(source.dict) ? source.dict : [];
    const deletedIds = [...new Set(
        (Array.isArray(source.deletedIds) ? source.deletedIds : [])
            .filter(id => typeof id === 'string' && id)
    )];
    const entries = [];
    (Array.isArray(source.logs) ? source.logs : []).forEach((raw, order) => {
        const row = parseReviewLogRow(raw);
        if (!row || row.length < 4) return;              // thiếu field bắt buộc → bỏ row rác
        const dictIndex = Number(row[0]);
        if (!Number.isFinite(dictIndex)) return;
        const cardId = dict[dictIndex];
        if (cardId === undefined || cardId === null) return; // trỏ vào dict hỏng → không dùng được
        const ts = Number(row[3]);
        entries.push({ row, cardId, ts: Number.isFinite(ts) ? ts : 0, order });
    });
    return { dict, deletedIds, entries };
}

/** Dựng lại {dict, logs} với dict CHỈ chứa cardId còn được tham chiếu (dict không phình theo kho từ). */
function buildReviewLogSnapshot(entries, deletedIds) {
    const dict = [], index = new Map(), logs = [];
    for (const { row, cardId } of entries) {
        let dictIndex = index.get(cardId);
        if (dictIndex === undefined) {
            dictIndex = dict.length;
            dict.push(cardId);
            index.set(cardId, dictIndex);
        }
        const copy = row.slice();
        copy[0] = dictIndex;
        logs.push(copy);
    }
    return { dict, logs, deletedIds };
}

/** Shape THẬT của document Firestore: rows là chuỗi JSON (Firestore không nhận mảng lồng trong mảng). */
function toCloudShape({ dict, logs, deletedIds }) {
    return { dict, logs: logs.map(row => JSON.stringify(row)), deletedIds };
}

function snapshotBytes(entries, deletedIds) {
    return utf8ByteLength(JSON.stringify(toCloudShape(buildReviewLogSnapshot(entries, deletedIds))));
}

/**
 * Payload đúng như document sẽ ghi lên Cloud (rows → chuỗi JSON, dict đã dựng
 * lại, kèm metadata nếu có). Dùng chung cho lúc ghi thật và lúc đo.
 */
export function toCloudReviewLogPayload(logs, meta = {}) {
    const { deletedIds, entries } = normalizeReviewLogs(logs);
    const snapshot = buildReviewLogSnapshot(orderByNewest(entries), deletedIds.slice(-MAX_REVIEW_LOG_DELETED_IDS));
    return { ...toCloudShape(snapshot), ...meta };
}

/** Đo dung lượng document sẽ ghi (byte UTF-8 của JSON) — cùng công thức với lúc ghi thật. */
export function measureReviewLogBytes(logs, meta = {}) {
    return utf8ByteLength(JSON.stringify(toCloudReviewLogPayload(logs, meta)));
}

function orderByNewest(entries) {
    return entries
        .map((entry, order) => ({ ...entry, order }))
        .sort((a, b) => (a.ts - b.ts) || (a.order - b.order));
}

/**
 * Cắt reviewLogs theo cả ngưỡng SỐ ENTRY và ngưỡng BYTE, giữ phần MỚI NHẤT.
 * - Không mutate input (trả về object/row/dict mới).
 * - Chạy được với log rỗng / thiếu field / dict hỏng.
 * - Luôn giữ ít nhất 1 entry mới nhất kể cả khi chính nó vượt ngưỡng byte.
 * @param {object} logs  {dict, logs, deletedIds}; mảng thô / null / thiếu field đều được xử lý an toàn
 * @returns {{dict: Array, logs: Array, deletedIds: Array}}
 */
export function pruneReviewLogs(logs, { maxEntries = MAX_REVIEW_LOG_ENTRIES, maxBytes = MAX_REVIEW_LOG_BYTES, maxDeletedIds = MAX_REVIEW_LOG_DELETED_IDS } = {}) {
    const entryLimit = Math.max(1, Math.trunc(Number(maxEntries)) || MAX_REVIEW_LOG_ENTRIES);
    const byteLimit = Math.max(1, Math.trunc(Number(maxBytes)) || MAX_REVIEW_LOG_BYTES);
    const deletedLimit = Math.max(0, Math.trunc(Number(maxDeletedIds)) || 0);

    const { deletedIds, entries } = normalizeReviewLogs(logs);
    const trimmedDeleted = deletedIds.slice(-deletedLimit);
    const ordered = orderByNewest(entries);
    const byCount = ordered.slice(-entryLimit);   // entry cũ nhất bị bỏ trước
    if (byCount.length === 0) return buildReviewLogSnapshot([], trimmedDeleted);

    // Đường nhanh: phần lớn trường hợp chỉ cần ngưỡng số entry là đủ.
    if (snapshotBytes(byCount, trimmedDeleted) <= byteLimit) {
        return buildReviewLogSnapshot(byCount, trimmedDeleted);
    }

    // Byte giảm đơn điệu khi bớt entry → tìm nhị phân số entry giữ lại lớn nhất.
    let low = 1, high = byCount.length, best = 0;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (snapshotBytes(byCount.slice(-mid), trimmedDeleted) <= byteLimit) {
            best = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    const keep = Math.max(1, best);
    return buildReviewLogSnapshot(byCount.slice(-keep), trimmedDeleted);
}

/**
 * Chuẩn bị payload ghi Cloud: prune theo 2 ngưỡng, rồi kiểm tra thêm NGƯỠNG AN
 * TOÀN (mặc định 400 KB = đúng MAX_REVIEW_LOG_BYTES) trên payload THẬT sắp ghi.
 * Nếu vẫn vượt (dữ liệu bất thường / sau này nới ngưỡng prune), tiếp tục cắt
 * log theo cấp số nhân — luôn giữ entry mới nhất — thay vì để Firestore từ chối.
 * @returns {{snapshot: object, payload: object, bytes: number, trimmed: boolean, before?: {bytes: number, entries: number}}}
 */
export function prepareReviewLogsForCloud(logs, { meta = {}, safeBytes = MAX_REVIEW_LOG_BYTES, onOversize = null } = {}) {
    const limit = Math.max(1, Math.trunc(Number(safeBytes)) || MAX_REVIEW_LOG_BYTES);
    let snapshot = pruneReviewLogs(logs);
    let bytes = measureReviewLogBytes(snapshot, meta);
    if (bytes <= limit) {
        return { snapshot, payload: toCloudReviewLogPayload(snapshot, meta), bytes, trimmed: false };
    }
    const before = { bytes, entries: snapshot.logs.length };
    let guard = 0;
    while (bytes > limit && snapshot.logs.length > 1 && guard++ < 16) {
        snapshot = pruneReviewLogs(snapshot, {
            maxEntries: Math.max(1, Math.floor(snapshot.logs.length / 2)),
            maxBytes: Math.max(1, Math.floor(bytes / 2))
        });
        bytes = measureReviewLogBytes(snapshot, meta);
    }
    const result = { snapshot, payload: toCloudReviewLogPayload(snapshot, meta), bytes, trimmed: true, before };
    try { onOversize?.(result); } catch (_) {}
    return result;
}
