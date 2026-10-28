// tests/render-highlight.test.mjs — khoá hàm tô sáng từ khoá trong câu ví dụ.
//
// Vì sao: `highlightKeywordInExample(example, englishWord)` là một trong số ít
// hàm TRẢ VỀ HTML (escape xong mới chèn <span>), được gọi khi render thẻ học.
// Nó nhận cả văn bản người dùng (câu ví dụ) lẫn từ khoá người dùng (english), và
// dựng RegExp từ chính từ khoá đó — hai rủi ro cùng lúc: XSS nếu escape sai, và
// treo/ném lỗi nếu từ khoá chứa ký tự đặc biệt của RegExp.
import test from 'node:test';
import assert from 'node:assert/strict';

// render.js kéo theo elements.js (đọc DOM lúc nạp) và animejs; stub tối thiểu
// chỉ để import được. Các hàm dưới test là hàm chuỗi, không phụ thuộc stub.
globalThis.document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    body: { classList: { add() {}, remove() {}, contains: () => false, toggle() {} } },
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
};
globalThis.window = globalThis.window || { matchMedia: () => ({ matches: false, addEventListener() {} }) };

const { highlightKeywordInExample } = await import('../src/ui/render.js');

const hasLiveTag = (html, tag) => new RegExp(`<${tag}[\\s>]`, 'i').test(html);

test('tô sáng đúng từ khoá và bọc bằng <mark class="example-highlight">', () => {
    const html = highlightKeywordInExample('She put off the meeting until Monday.', 'put off');
    assert.ok(html.includes('<mark'), 'phải có thẻ <mark> tô sáng');
    assert.match(html, /class="example-highlight"/);
    assert.ok(html.includes('put'), 'phần từ khoá phải còn trong output');
    assert.ok(!hasLiveTag(html, 'script'));
});

test('phân biệt tiền tố (stems): "manage" tô sáng "managed"', () => {
    const html = highlightKeywordInExample('He managed the project.', 'manage');
    assert.ok(html.includes('example-highlight'), 'biến thể hình thái phải được tô sáng');
});

test('nhiều lựa chọn ngăn cách bởi "/" đều được tô sáng', () => {
    const html = highlightKeywordInExample('We need to delay the launch.', 'put off / delay');
    assert.ok(html.includes('example-highlight'));
    assert.ok(html.includes('delay'));
});

test('bỏ phần chú thích trong ngoặc: "set (sth) up" vẫn khớp "set up"', () => {
    const html = highlightKeywordInExample('Please set up the tent.', 'set (sth) up');
    assert.ok(html.includes('example-highlight'), 'cụm "set up" phải khớp sau khi bỏ "(sth)"');
});

test('XSS trong CÂU VÍ DỤ bị escape, không tạo thẻ sống', () => {
    for (const payload of ['<img src=x onerror=alert(1)>', '<script>alert(1)</script>', '<svg onload=alert(1)>']) {
        const html = highlightKeywordInExample(`A ${payload} sentence with word.`, 'word');
        assert.ok(!hasLiveTag(html, 'img'), `không được có <img> sống: ${payload}`);
        assert.ok(!hasLiveTag(html, 'script'), `không được có <script> sống: ${payload}`);
        assert.ok(!hasLiveTag(html, 'svg'), `không được có <svg> sống: ${payload}`);
        assert.ok(html.includes('&lt;'), 'payload phải nằm trong entity');
    }
});

test('XSS trong TỪ KHOÁ không tạo thẻ sống và không ném lỗi', () => {
    for (const payload of ['<img src=x onerror=1>', '<script>alert(1)</script>', '"><b>x</b>']) {
        const html = highlightKeywordInExample('An example sentence.', payload);
        assert.ok(!hasLiveTag(html, 'img'), `từ khoá ${payload} không được tạo <img>`);
        assert.ok(!hasLiveTag(html, 'script'), `từ khoá ${payload} không được tạo <script>`);
        assert.ok(!hasLiveTag(html, 'b'), `từ khoá ${payload} không được tạo <b>`);
    }
});

test('ký tự đặc biệt của RegExp trong từ khoá không làm treo/ném lỗi', () => {
    const tricky = ['a+b', '(test)', 'a[b', 'a\\b', '.*', '$^', 'a|b', 'C++', 'foo?', 'x{2}'];
    for (const term of tricky) {
        assert.doesNotThrow(() => highlightKeywordInExample('a+b (test) a[b a\\b .* $^ a|b C++ foo? x{2}', term),
            `từ khoá ${term} không được làm hỏng RegExp`);
    }
});

test('đầu vào rỗng/N/A trả về văn bản đã escape, không chèn span', () => {
    // Hợp đồng thật: câu ví dụ rỗng ⇒ nhãn thay thế 'N/A' (không phải chuỗi rỗng).
    assert.equal(highlightKeywordInExample('', 'word'), 'N/A');
    assert.equal(highlightKeywordInExample('N/A', 'word'), 'N/A');
    assert.equal(highlightKeywordInExample('câu ví dụ', ''), 'câu ví dụ');
    assert.equal(highlightKeywordInExample('<b>', ''), '&lt;b&gt;', 'vẫn phải escape khi không có từ khoá');
});

test('tiếng Việt có dấu không bị biến dạng', () => {
    const html = highlightKeywordInExample('Đường phố rất đông người.', 'đường');
    assert.ok(html.includes('Đường') || html.includes('đường'));
    assert.ok(!html.includes('&amp;#'), 'không được escape hai lần');
});

test('không escape hai lần: ký tự & có sẵn trong câu ví dụ', () => {
    const html = highlightKeywordInExample('Tom & Jerry word play.', 'word');
    assert.ok(!html.includes('&amp;amp;'), 'không được biến & thành &amp;amp;');
    assert.ok(html.includes('&amp;'), '& phải được escape đúng một lần');
});
