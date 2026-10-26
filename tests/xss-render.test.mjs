// tests/xss-render.test.mjs
// Hồi quy XSS (T0.1 + T0.2): 2 sink stored XSS đã xác nhận
//   1. gamification.js — popup "Dự báo" render bằng showPopup(..., true)
//   2. streakRecovery.js — khối câu hỏi Khảo Hạch gán vào innerHTML
// Test gọi trực tiếp 2 hàm thuần buildForecastWordsHtml() / buildPenanceQuestionHtml()
// (không đụng DOM) — nếu ai gỡ escapeHTML khỏi 2 hàm này, test sẽ đỏ.

import test from 'node:test';
import assert from 'node:assert/strict';

// Hai module nguồn kéo theo lớp UI (elements.js, animejs) nên cần một document
// tối thiểu để nạp được trong Node. Stub chỉ phục vụ import; 2 hàm thuần bên dưới
// chỉ nối chuỗi nên không bị stub che giấu lỗi escape.
globalThis.document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
};

const { buildForecastWordsHtml } = await import('../src/features/gamification.js');
const { buildPenanceQuestionHtml } = await import('../src/features/streakRecovery.js');

const IMG_PAYLOAD = '<img src=x onerror=alert(1)>';
const SCRIPT_PAYLOAD = '"><script>alert(1)</script>';
const QUOTE_PAYLOAD = `a"b'c&d`;
const VI_PAYLOAD = 'Nghĩa tiếng Việt có dấu: ắ ẹ ỡ ữ ợ — Đường phố';

// Render 1 payload qua cả 2 hàm (kèm cả ô phiên âm của Khảo Hạch).
function renderForecast(value) {
    return buildForecastWordsHtml([value]);
}

function renderPenanceQuestion(value) {
    return buildPenanceQuestionHtml({ question: value, word: { pronunciation: value } });
}

test('Dự báo: payload <img onerror> bị escape, không tạo thẻ thực thi', () => {
    const html = renderForecast(IMG_PAYLOAD);
    assert.ok(!html.includes('<img'), 'output không được chứa thẻ <img thật');
    assert.ok(!/<img[^>]*\sonerror\s*=/i.test(html), 'không được có <img ... onerror=...> thực thi');
    assert.ok(html.includes('&lt;img'), 'payload phải được escape thành &lt;img');
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'toàn bộ payload phải nằm trong entity');
});

test('Dự báo: payload "><script> bị escape, không tạo thẻ script', () => {
    const html = renderForecast(SCRIPT_PAYLOAD);
    assert.ok(!html.includes('<script'), 'output không được chứa <script');
    assert.ok(html.includes('&lt;script&gt;'), 'payload phải được escape thành &lt;script&gt;');
});

test('Dự báo: nháy kép, nháy đơn và & đều thành entity', () => {
    const html = renderForecast(QUOTE_PAYLOAD);
    assert.ok(html.includes('a&quot;b&#39;c&amp;d'), 'phải escape " -> &quot;, \' -> &#39;, & -> &amp;');
    assert.ok(!html.includes(QUOTE_PAYLOAD), 'không được giữ nguyên chuỗi chưa escape');
});

test('Dự báo: tiếng Việt có dấu giữ nguyên, không double-escape', () => {
    const html = renderForecast(VI_PAYLOAD);
    assert.ok(html.includes(VI_PAYLOAD), 'nội dung hợp lệ phải hiển thị nguyên vẹn');
    assert.ok(!html.includes('&amp;lt;'), 'không được double-escape entity');
    assert.ok(!html.includes('&amp;amp;'), 'không được double-escape dấu &');
});

test('Dự báo: chip HTML vẫn giữ cấu trúc và gộp đúng số từ', () => {
    const html = buildForecastWordsHtml(['cat', 'dog']);
    assert.equal((html.match(/<span /g) || []).length, 2, 'mỗi từ phải là một chip <span>');
    assert.ok(html.includes('>cat</span>'), 'từ hợp lệ phải nằm trong chip');
    assert.equal(buildForecastWordsHtml(null), '', 'input không phải mảng phải trả về chuỗi rỗng');
});

test('Khảo Hạch: payload <img onerror> ở từ và phiên âm đều bị escape', () => {
    const html = renderPenanceQuestion(IMG_PAYLOAD);
    assert.ok(!html.includes('<img'), 'output không được chứa thẻ <img thật');
    assert.ok(!/<img[^>]*\sonerror\s*=/i.test(html), 'không được có <img ... onerror=...> thực thi');
    assert.ok(html.includes('&lt;img'), 'payload phải được escape thành &lt;img ở cả câu hỏi và phiên âm');
    assert.ok(html.includes('Nghĩa tiếng Việt của từ:'), 'khối câu hỏi phải còn nguyên nhãn');
});

test('Khảo Hạch: payload "><script> bị escape, không tạo thẻ script', () => {
    const html = renderPenanceQuestion(SCRIPT_PAYLOAD);
    assert.ok(!html.includes('<script'), 'output không được chứa <script');
    assert.ok(html.includes('&lt;script&gt;'), 'payload phải được escape thành &lt;script&gt;');
});

test('Khảo Hạch: nháy kép, nháy đơn và & đều thành entity', () => {
    const html = renderPenanceQuestion(QUOTE_PAYLOAD);
    assert.ok(html.includes('a&quot;b&#39;c&amp;d'), 'phải escape " -> &quot;, \' -> &#39;, & -> &amp;');
    assert.ok(!html.includes(QUOTE_PAYLOAD), 'không được giữ nguyên chuỗi chưa escape');
});

test('Khảo Hạch: tiếng Việt có dấu giữ nguyên, không double-escape', () => {
    const html = renderPenanceQuestion(VI_PAYLOAD);
    assert.ok(html.includes(VI_PAYLOAD), 'nội dung hợp lệ phải hiển thị nguyên vẹn');
    assert.ok(!html.includes('&amp;lt;'), 'không được double-escape entity');
    assert.ok(!html.includes('&amp;amp;'), 'không được double-escape dấu &');
});

test('Khảo Hạch: thiếu phiên âm thì bỏ khối .question-pron, không ném lỗi', () => {
    const html = buildPenanceQuestionHtml({ question: 'cat' });
    assert.ok(html.includes('>cat</h2>'), 'câu hỏi hợp lệ phải nằm trong thẻ h2');
    assert.ok(!html.includes('question-pron'), 'không có phiên âm thì không render khối phiên âm');
    assert.equal(buildPenanceQuestionHtml(null), buildPenanceQuestionHtml({}), 'input rỗng phải an toàn');
});
