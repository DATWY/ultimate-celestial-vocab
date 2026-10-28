// tests/adversarial-dedup.test.mjs
//
// Khoá lại các lỗi GỘP NHẦM đo được trên chính kho 3.053 thẻ của người dùng
// (2026-10-28): dedup đề xuất gộp interviewer⟷interviewee và supplier⟷supply.
// Nếu gộp, mỗi cặp mất hẳn một từ. Ba cổng chặn dưới đây phải giữ được mãi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    isDuplicateCard,
    findDuplicatePairs,
    selectAutoMergePairs,
    isSiblingDerivative,
    isDerivationalVariant
} from '../src/core/dedup.js';

const card = (english, vietnamese, type = '') => ({ id: english + '|' + vietnamese, english, vietnamese, type });

test('dedup adversarial: anh/em cùng họ từ KHÔNG bị gộp (interviewer ⟷ interviewee)', () => {
    assert.equal(isSiblingDerivative('interviewer', 'interviewee'), true);
    assert.equal(isSiblingDerivative('employer', 'employee'), true);
    assert.equal(isSiblingDerivative('trainer', 'trainee'), true);
    // Cặp không phải anh/em thì không được kích hoạt cổng này
    assert.equal(isSiblingDerivative('interviewer', 'interview'), false);
    assert.equal(isSiblingDerivative('happy', 'happier'), false);

    const result = isDuplicateCard(card('Interviewer', 'Người phỏng vấn', 'noun'), card('Interviewee', 'Người được phỏng vấn', 'noun'));
    assert.equal(result.isDuplicate, false, 'interviewer/interviewee phải được giữ riêng');
    assert.equal(result.category, 'WORD_FAMILY');
});

test('dedup adversarial: dạng phái sinh KHÔNG bị gộp (supplier ⟷ supply, manage ⟷ manager)', () => {
    assert.equal(isDerivationalVariant('supplier', 'supply'), true);
    assert.equal(isDerivationalVariant('manager', 'manage'), true);
    assert.equal(isDerivationalVariant('creation', 'create'), true);
    // So sánh hơn là biến thể NGỮ PHÁP, không phải phái sinh
    assert.equal(isDerivationalVariant('happier', 'happy', 'unknown', 'unknown', 'hạnh phúc hơn', 'vui vẻ'), false);
    assert.equal(isDerivationalVariant('happier', 'happy', 'adjective', 'adjective'), false);

    for (const [a, b] of [['Supplier', 'Supply'], ['manage', 'manager']]) {
        const result = isDuplicateCard(card(a, 'Nhà cung cấp / quản lý', 'noun'), card(b, 'Cung cấp, tiếp tế', 'noun'));
        assert.equal(result.isDuplicate, false, `${a}/${b} phải được giữ riêng`);
    }
});

test('dedup adversarial: cùng mặt chữ nhưng nghĩa khác hẳn là ĐA NGHĨA, không gộp', () => {
    const pairs = [
        ['Commission', 'Hoa hồng theo doanh số', 'Commission', 'Hội đồng, ủy ban'],
        ['Turnover', 'Doanh thu, sự luân chuyển', 'Turnover', 'Tỷ lệ nhân sự nghỉ việc'],
        ['Store', 'Cửa hàng', 'Store', 'Lưu trữ']
    ];
    for (const [a, va, b, vb] of pairs) {
        const result = isDuplicateCard(card(a, va, 'noun'), card(b, vb, 'noun'));
        assert.equal(result.isDuplicate, false, `${a} ("${va}" vs "${vb}") phải là đa nghĩa`);
        assert.equal(result.category, 'POLYSEMY');
    }
});

test('dedup adversarial: biến thể thật vẫn phải bắt được (không false negative)', () => {
    // Nghĩa lấy đúng như kho thật (có cụm từ chung) — đây là dữ liệu mà bản cũ
    // vẫn nhận đúng, nên cổng chặn mới không được làm hỏng chúng.
    const positives = [
        ['color', 'colour', 'màu sắc', 'màu sắc', ''],
        ['colleague', 'colleagues', 'đồng nghiệp', 'đồng nghiệp', 'noun'],
        ['maintenance', 'maintainance', 'bảo trì', 'bảo trì', 'noun'],
        ['Facilities', 'Facility', 'Cơ sở vật chất, tiện nghi', 'Cơ sở vật chất, nhà máy', 'noun'],
        ['Advise', 'Advised', 'Khuyên bảo, tư vấn', 'Được khuyến nghị, tư vấn', 'verb'],
        ['happy', 'happier', 'vui vẻ, hạnh phúc', 'hạnh phúc hơn', 'adjective']
    ];
    for (const [a, b, va, vb, type] of positives) {
        const result = isDuplicateCard(card(a, va, type), card(b, vb, type));
        assert.equal(result.isDuplicate, true, `${a}/${b} phải được nhận là trùng`);
    }
});

test('dedup adversarial: nút Gộp tất cả chỉ nhận cặp chắc chắn, cặp lệch chính tả để xem tay', () => {
    const exact = { cardA: card('color', 'màu'), cardB: card('Colour', 'màu'), category: 'EXACT', confidence: 0.99 };
    const inflection = { cardA: card('colleague', 'đồng nghiệp'), cardB: card('colleagues', 'đồng nghiệp'), category: 'INFLECTION', confidence: 0.95 };
    const typo = { cardA: card('maintenance', 'bảo trì'), cardB: card('maintainance', 'bảo trì'), category: 'FUZZY_TYPO', confidence: 0.9 };
    const weak = { cardA: card('abc', 'x'), cardB: card('abd', 'y'), category: 'INFLECTION', confidence: 0.5 };

    const { safe, review } = selectAutoMergePairs([exact, inflection, typo, weak]);
    assert.deepEqual(safe.map(p => p.category), ['EXACT', 'INFLECTION']);
    assert.deepEqual(review.map(p => p.category), ['FUZZY_TYPO', 'INFLECTION']);
});

test('dedup adversarial: quét bộ 14 thẻ mô phỏng đúng 7 cặp thật trong kho người dùng', () => {
    // 7 cặp mà bản cũ đề xuất trên dữ liệu thật, chỉ 3 cặp cuối là biến thể thật.
    const vocabulary = [
        card('Supplier', 'Nhà cung cấp', 'noun'), card('Supply', 'Cung cấp, tiếp tế', 'noun'),
        card('Commission', 'Hoa hồng theo doanh số', 'noun'), card('Commission', 'Hội đồng, ủy ban', 'noun'),
        card('Turnover', 'Doanh thu, sự luân chuyển', 'noun'), card('Turnover', 'Tỷ lệ nhân sự nghỉ việc', 'noun'),
        card('Interviewer', 'Người phỏng vấn', 'noun'), card('Interviewee', 'Người được phỏng vấn', 'noun'),
        card('Leasing', 'Hoạt động cho thuê', 'noun'), card('Lease', 'Hợp đồng cho thuê', 'noun'),
        card('Advise', 'Khuyên bảo, tư vấn', 'verb'), card('Advised', 'Được khuyến nghị', 'verb'),
        card('Facilities', 'Cơ sở vật chất, tiện nghi', 'noun'), card('Facility', 'Cơ sở vật chất, nhà máy', 'noun')
    ];
    const pairs = findDuplicatePairs(vocabulary);
    const forbidden = new Set(['Interviewer/Interviewee', 'Supplier/Supply', 'Commission/Commission', 'Turnover/Turnover']);
    for (const pair of pairs) {
        const key = [pair.cardA.english, pair.cardB.english].sort().join('/');
        assert.equal(forbidden.has(key), false, `Không được đề xuất gộp: ${key}`);
    }
    // Bất biến quan trọng: mọi cặp được đề xuất phải tự kiểm lại là trùng.
    // (Bộ sinh ứng viên có thể bỏ sót vài biến thể ngắn trong một kho 14 thẻ —
    // đo trên kho thật 3.053 thẻ thì Advise/Advised và Facilities/Facility đều
    // được bắt; xem tools/format_user_backup.mjs để chạy lại trên dữ liệu thật.)
    for (const pair of pairs) {
        const verified = isDuplicateCard(pair.cardA, pair.cardB);
        assert.equal(verified.isDuplicate, true, `Cặp ${pair.cardA.english}/${pair.cardB.english} được đề xuất nhưng tự kiểm lại thì KHÔNG trùng`);
    }
    const { safe } = selectAutoMergePairs(pairs);
    assert.equal(safe.length, pairs.length, 'mọi cặp còn lại đều đủ tin cậy để gộp tự động');
});
