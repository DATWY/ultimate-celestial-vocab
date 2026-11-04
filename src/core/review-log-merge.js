// src/core/review-log-merge.js
//
// Định dạng nén của review log: mỗi dòng là một mảng
//   [cardIdx, rating, t, ts, typing, id, first]
// Cột 6 (`first`) là cờ "lượt đầu đời" do engine ghi (xem src/core/srs/index.js). Ba trạng thái
// phải giữ nguyên xuyên suốt (AUDIT-R3.1):
//   • 1        = engine biết chắc đây là lượt đầu đời;
//   • 0        = engine biết chắc đây KHÔNG phải lượt đầu;
//   • thiếu cột = log cũ, CHƯA biết (`undefined`), không được tự ghi thành 0.
// Không bao giờ suy ra cờ này từ `t = 0`.

/** Giá trị cột 6 cho một cờ ba trạng thái; `null` = chưa biết (không ghi cột). */
const firstToColumn = value => (value === true ? 1 : value === false ? 0 : null);

/** Đọc cột 6 về ba trạng thái. */
export function readFirstFlag(row) {
    if (!Array.isArray(row) || row.length < 7) return undefined;
    const value = row[6];
    if (value === 1 || value === true || value === '1') return true;
    if (value === 0 || value === false || value === '0') return false;
    return undefined;
}

export function compressLogs(rawArray) {
    const dict = [], indexes = new Map(), logs = [];
    for (const log of rawArray) {
        if (!log?.cardId || ![1,2,3,4].includes(log.rating) || !Number.isFinite(log.t) || log.t < 0) continue;
        if (!indexes.has(log.cardId)) { indexes.set(log.cardId, dict.length); dict.push(log.cardId); }
        const ts = Number(log.ts || log.reviewTime) || 0, typing = log.isTyping || log.modality === 'typing' ? 1 : 0;
        const row = [indexes.get(log.cardId), log.rating, log.t, ts, typing,
            log.id || `legacy:${log.cardId}:${ts}:${log.rating}:${log.t}:${typing}`];
        const flag = firstToColumn(log.first);
        if (flag !== null) row.push(flag);
        logs.push(row);
    }
    return { dict, logs };
}

/**
 * Dựng danh sách log cho file xuất JSON (hàm thuần, tách khỏi phần tạo Blob/download để test được).
 * Giữ cờ `first` ở cả ba trạng thái: log cũ không có cờ thì trường này VẮNG MẶT (JSON.stringify
 * bỏ undefined), không bị ghi thành `false`.
 */
export function buildReviewLogsExport(reviewLogs, vocabulary = []) {
    if (!reviewLogs?.dict || !Array.isArray(reviewLogs.logs)) return [];
    const names = new Map((vocabulary || []).map(word => [word.id, word.english || '']));
    return reviewLogs.logs.map((log, idx) => {
        const cardId = reviewLogs.dict[log[0]];
        const first = readFirstFlag(log);
        const entry = {
            cardId,
            english: names.get(cardId) || '',
            rating: log[1],
            t: log[2],
            ts: log[3] || (Date.now() - 1000000 + idx),
            isTyping: log[4] === 1,
            id: log[5]
        };
        if (first !== undefined) entry.first = first;
        return entry;
    });
}

/**
 * Mở rộng các dòng nén `{dict, logs}` thành log dạng object, GIỮ ba trạng thái của cờ `first`.
 * Dùng chung cho trainer trong app (`prepareTrainingData`) và CLI `tools/train_fsrs7.js` để hai
 * đường đọc không lệch nhau.
 */
export function expandReviewLogRows(dict, rows) {
    return (Array.isArray(rows) ? rows : []).map(row => ({
        cardId: Array.isArray(dict) ? dict[row[0]] : undefined,
        rating: row[1],
        t: row[2],
        ts: row[3],
        isTyping: !!row[4],
        // Giữ cả `modality` như bản đọc cũ: nơi khác (thống kê/chẩn đoán) đọc trường này.
        modality: row[4] ? 'typing' : 'en-vi',
        id: row[5],
        first: readFirstFlag(row)
    }));
}

export function mergeReviewLogs(a, b) {
    const removed = new Set([...(a?.deletedIds || []), ...(b?.deletedIds || [])]);
    const events = new Map();
    for (const source of [a, b]) {
        if (!source?.dict || !Array.isArray(source.logs)) continue;
        for (const row of source.logs) {
            if (!Array.isArray(row)) continue;
            const cardId = source.dict[row[0]], ts = Number(row[3]) || 0, typing = row[4] ? 1 : 0;
            const id = row[5] || `legacy:${cardId}:${ts}:${row[1]}:${row[2]}:${typing}`;
            if (!cardId || removed.has(id)) continue;
            const event = { cardId, rating: row[1], t: row[2], ts, isTyping: typing === 1, id, first: readFirstFlag(row) };
            const previous = events.get(id);
            if (!previous) { events.set(id, event); continue; }
            const prevKnown = previous.first !== undefined, nextKnown = event.first !== undefined;
            // Cùng một sự kiện ở hai phía: bản BIẾT cờ thắng bản chưa biết (mất cờ là mất thông
            // tin không thể dựng lại). Nếu cả hai đều biết mà mâu thuẫn thì chọn "không phải lượt
            // đầu" — hướng bảo thủ, để chuỗi bị loại khỏi replay thay vì được tin nhầm.
            if (nextKnown && !prevKnown) { events.set(id, event); continue; }
            if (prevKnown && !nextKnown) continue;
            if (prevKnown && nextKnown && event.first !== previous.first) {
                if (event.first === false) events.set(id, event);
                continue;
            }
            if (JSON.stringify(event) > JSON.stringify(previous)) events.set(id, event);
        }
    }
    const sorted = [...events.values()].sort((x,y) => x.ts - y.ts || x.id.localeCompare(y.id)).slice(-10000);
    return { ...compressLogs(sorted), deletedIds: [...removed].sort() };
}
