export function compressLogs(rawArray) {
    const dict = [], indexes = new Map(), logs = [];
    for (const log of rawArray) {
        if (!log?.cardId || ![1,2,3,4].includes(log.rating) || !Number.isFinite(log.t) || log.t < 0) continue;
        if (!indexes.has(log.cardId)) { indexes.set(log.cardId, dict.length); dict.push(log.cardId); }
        const ts = Number(log.ts || log.reviewTime) || 0, typing = log.isTyping || log.modality === 'typing' ? 1 : 0;
        logs.push([indexes.get(log.cardId), log.rating, log.t, ts, typing,
            log.id || `legacy:${log.cardId}:${ts}:${log.rating}:${log.t}:${typing}`]);
    }
    return { dict, logs };
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
            const event = { cardId, rating: row[1], t: row[2], ts, isTyping: typing === 1, id };
            const previous = events.get(id);
            if (!previous || JSON.stringify(event) > JSON.stringify(previous)) events.set(id, event);
        }
    }
    const sorted = [...events.values()].sort((x,y) => x.ts - y.ts || x.id.localeCompare(y.id)).slice(-10000);
    return { ...compressLogs(sorted), deletedIds: [...removed].sort() };
}
