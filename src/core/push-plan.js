// src/core/push-plan.js
//
// Quyết định CHÍNH XÁC thẻ nào được đẩy lên Cloud trong một vòng sync.
// Tách khỏi firebase.js để test được mà không cần Firebase SDK / mạng.
//
// Vì sao phải tách: bản cũ gộp `convergedCardsToPush` (thẻ đã merge với remote,
// cần đẩy để hai máy hội tụ) chung một mảng với hàng nghìn thẻ local "chưa từng
// sync", rồi Quota Shield xoá sạch cả mảng khi > 50 ở background — nghĩa là phần
// hội tụ bị nuốt và hai máy không bao giờ giống nhau.
//
// Luật mới:
//   • Thẻ hội tụ LUÔN được đẩy (chúng là lý do tồn tại của vòng sync này).
//   • Thẻ mới (chưa từng sync) ở background chỉ đẩy tối đa `maxBackground` mỗi
//     vòng để không đốt quota; phần dư được BÁO là `deferred` để lần sau đẩy tiếp
//     thay vì biến mất im lặng.
//   • Sync thủ công đẩy hết.
export function planPushBatch({ converged = [], fresh = [], isManual = false, maxBackground = 50 } = {}) {
    const items = new Map();

    // 1. Hội tụ trước — nếu trùng id, bản hội tụ (đã merge) thắng bản local thô.
    for (const card of converged) {
        if (card?.id) items.set(card.id, card);
    }

    // 2. Thẻ mới, không trùng, có trần theo lô ở background.
    let accepted = 0;
    let deferred = 0;
    for (const card of fresh) {
        if (!card?.id || items.has(card.id)) continue;
        if (!isManual && accepted >= maxBackground) {
            deferred++;
            continue;
        }
        items.set(card.id, card);
        accepted++;
    }

    return { items: [...items.values()], deferred };
}
