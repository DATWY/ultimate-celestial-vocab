// tests/p4-automerge-safety.test.mjs — PHASE 4.
//
// "Gộp tự động" là thao tác XOÁ VĨNH VIỄN thẻ phụ (executeMergeAll đặt isDeleted
// cho cardB), nên tiêu chuẩn tự gộp phải là "chắc chắn cùng một từ", không phải
// "cùng gốc từ".
//
// Lỗi cũ: INFLECTION có confidence = Math.max(0.90, semSim) nên luôn vượt ngưỡng
// 0.9 và bị gộp tự động. Trên kho thật 3.053 thẻ điều đó gộp nhầm Leasing/Lease
// (hoạt động cho thuê vs hợp đồng cho thuê) và Advise/Advised (khuyên vs được
// khuyên) — hai khái niệm học khác nhau.
import test from 'node:test';
import assert from 'node:assert/strict';
import { selectAutoMergePairs, isDuplicateCard, findDuplicatePairs, canonicalEnglish } from '../src/core/dedup.js';

const card = (english, vietnamese, type = '') => ({ id: english + '|' + vietnamese, english, vietnamese, type });
const pair = (a, b, category, confidence = 0.95) => ({ cardA: a, cardB: b, category, confidence });

test('chỉ EXACT cùng chính tả + cùng nghĩa được tự gộp', () => {
    const exact = pair(card('color', 'màu sắc'), card('Colour', 'màu sắc'), 'EXACT', 0.99);
    const { safe, review } = selectAutoMergePairs([exact]);
    assert.equal(safe.length, 1, 'color/Colour phải được tự gộp');
    assert.equal(review.length, 0);
});

test('biến thể ngữ pháp KHÔNG được tự gộp, kể cả khi nghĩa y hệt', () => {
    const plural = pair(card('colleague', 'đồng nghiệp'), card('colleagues', 'đồng nghiệp'), 'INFLECTION', 0.95);
    const { safe, review } = selectAutoMergePairs([plural]);
    assert.equal(safe.length, 0, 'INFLECTION phải để người dùng xác nhận');
    assert.equal(review.length, 1);
});

test('cặp nguy hiểm từ kho thật (Leasing/Lease, Advise/Advised) không bị tự gộp', () => {
    const dangerous = [
        pair(card('Leasing', 'Hoạt động cho thuê', 'noun'), card('Lease', 'Hợp đồng cho thuê', 'noun'), 'INFLECTION'),
        pair(card('Advise', 'Khuyên bảo, tư vấn', 'verb'), card('Advised', 'Được khuyến nghị', 'verb'), 'INFLECTION'),
        pair(card('Supplier', 'Nhà cung cấp', 'noun'), card('Supply', 'Cung cấp, tiếp tế', 'noun'), 'INFLECTION'),
        pair(
            card('Facilities', 'Cơ sở vật chất, tiện nghi', 'noun'),
            card('Facility', 'Cơ sở vật chất, nhà máy', 'noun'),
            'INFLECTION'
        )
    ];
    const { safe } = selectAutoMergePairs(dangerous);
    assert.deepEqual(
        safe,
        [],
        `không cặp nào được tự gộp, đang gộp: ${safe.map(p => p.cardA.english + '/' + p.cardB.english)}`
    );
});

test('cùng chính tả nhưng KHÁC nghĩa (đa nghĩa) không được tự gộp', () => {
    const polysemy = pair(
        card('Commission', 'Hoa hồng theo doanh số'),
        card('Commission', 'Hội đồng, ủy ban'),
        'EXACT',
        0.99
    );
    const { safe } = selectAutoMergePairs([polysemy]);
    assert.equal(safe.length, 0, 'hai nghĩa khác nhau phải giữ cả hai thẻ');
});

test('danh sách cặp cũ/độ tin cậy thấp vẫn bị chặn (tự kiểm lại trước khi gộp)', () => {
    const weak = pair(card('color', 'màu'), card('colour', 'màu'), 'EXACT', 0.5);
    assert.equal(selectAutoMergePairs([weak]).safe.length, 0, 'confidence < 0.9 không được tự gộp');

    // Cặp khai báo EXACT nhưng tự kiểm lại KHÔNG trùng (dữ liệu cũ/lỗi thời).
    const lying = pair(card('maintenance', 'bảo trì'), card('maintainance', 'bảo trì'), 'EXACT', 0.99);
    assert.equal(
        isDuplicateCard(lying.cardA, lying.cardB).category === 'EXACT',
        false,
        'cặp lệch chính tả không phải EXACT'
    );
    assert.equal(selectAutoMergePairs([lying]).safe.length, 0, 'phải tự kiểm lại, không tin nhãn cũ');
});

test('quét kho thật: mọi cặp được đề xuất đều tự kiểm lại là trùng', () => {
    const vocabulary = [
        card('Supplier', 'Nhà cung cấp', 'noun'),
        card('Supply', 'Cung cấp, tiếp tế', 'noun'),
        card('Leasing', 'Hoạt động cho thuê', 'noun'),
        card('Lease', 'Hợp đồng cho thuê', 'noun'),
        card('Advise', 'Khuyên bảo, tư vấn', 'verb'),
        card('Advised', 'Được khuyến nghị', 'verb'),
        card('Facilities', 'Cơ sở vật chất, tiện nghi', 'noun'),
        card('Facility', 'Cơ sở vật chất, nhà máy', 'noun'),
        card('color', 'màu sắc'),
        card('Colour', 'màu sắc')
    ];
    const pairs = findDuplicatePairs(vocabulary);
    for (const p of pairs) {
        assert.equal(
            isDuplicateCard(p.cardA, p.cardB).isDuplicate,
            true,
            `${p.cardA.english}/${p.cardB.english} được đề xuất nhưng không trùng`
        );
    }
    const { safe } = selectAutoMergePairs(pairs);
    for (const p of safe) {
        // "Cùng chính tả" nghĩa là cùng dạng CHUẨN HOÁ (color ≈ Colour), không phải
        // cùng chuỗi thường — canonicalEnglish chính là thứ dedup dùng để so.
        assert.equal(
            canonicalEnglish(p.cardA.english),
            canonicalEnglish(p.cardB.english),
            `tự gộp phải là cùng từ chuẩn hoá, nhận ${p.cardA.english}/${p.cardB.english}`
        );
    }
});
