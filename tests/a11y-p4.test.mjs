// tests/a11y-p4.test.mjs
// P4 — Hồi quy a11y tĩnh (không cần DOM thật): chỉ đọc mã nguồn và assert các
// thuộc tính/hành vi đã chốt. Mục đích: nếu ai gỡ aria-label, lang="en",
// role="status", hoặc làm focus sau khi lật thẻ quay lại kiểu "cướp focus" thì
// test này đỏ ngay trên CI, không cần chạy trình duyệt.
//
// Số liệu kiểm chứng runtime (AX tree thật, ảnh 375px, safe-area) nằm ở
// scratch/a11y-{before,after}.json + scratch/shots/p4-*.png.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const html = read('index.html');
const renderSrc = read('src/ui/render.js');
const eventsSrc = read('src/events.js');
const styleSrc = read('src/css/style.css');

/** Lấy nguyên thẻ mở của phần tử có id cho trước. */
function openTagById(source, id) {
    const re = new RegExp(`<[a-z0-9]+\\b[^>]*\\bid="${id}"[^>]*>`, 'i');
    const m = source.match(re);
    assert.ok(m, `không tìm thấy thẻ mở có id="${id}"`);
    return m[0];
}

/** Lấy nội dung 1 block CSS theo selector mở đầu (khớp ngoặc nhọn). */
function cssBlock(source, header, fromIndex = 0) {
    const start = source.indexOf(header, fromIndex);
    assert.ok(start !== -1, `không tìm thấy block CSS: ${header}`);
    const open = source.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') {
            depth--;
            if (depth === 0) return source.slice(open + 1, i);
        }
    }
    throw new Error('Block CSS không đóng: ' + header);
}

/** Block media đầu tiên có chứa `needle` (style.css có nhiều block cùng breakpoint). */
function cssBlockContaining(source, header, needle) {
    let from = 0;
    for (;;) {
        const start = source.indexOf(header, from);
        assert.ok(start !== -1, `không tìm thấy ${header} chứa ${needle}`);
        const block = cssBlock(source, header, from);
        if (block.includes(needle)) return block;
        from = start + header.length;
    }
}

test('P4.1 — #typing-input có aria-label (không phụ thuộc placeholder)', () => {
    const tag = openTagById(html, 'typing-input');
    const label = tag.match(/aria-label="([^"]*)"/);
    assert.ok(label, '#typing-input thiếu aria-label');
    assert.ok(label[1].trim().length > 0, 'aria-label của #typing-input rỗng');

    // aria-describedby phải trỏ tới một id CÓ THẬT trong index.html
    const describedBy = tag.match(/aria-describedby="([^"]*)"/);
    assert.ok(describedBy, '#typing-input thiếu aria-describedby');
    const ids = describedBy[1].trim().split(/\s+/);
    for (const id of ids) {
        assert.ok(
            new RegExp(`\\bid="${id}"`, 'i').test(html),
            `aria-describedby trỏ tới id không tồn tại: ${id}`,
        );
    }
});

test('P4.1 — #typing-feedback là live region polite', () => {
    const tag = openTagById(html, 'typing-feedback');
    assert.match(tag, /role="status"/, '#typing-feedback thiếu role="status"');
    assert.match(tag, /aria-live="polite"/, '#typing-feedback thiếu aria-live="polite"');
});

test('P4.1 — từ tiếng Anh trên thẻ có lang="en"', () => {
    for (const id of ['card-english', 'card-example']) {
        const tag = openTagById(html, id);
        assert.match(tag, /lang="en"/, `#${id} thiếu lang="en"`);
    }
});

test('P4.1 — từ tiếng Anh trong word list được render với lang="en"', () => {
    // wordCardHtml() là nơi duy nhất sinh HTML danh sách từ.
    const fnStart = renderSrc.indexOf('function wordCardHtml(');
    assert.ok(fnStart !== -1, 'không tìm thấy wordCardHtml()');
    const fnEnd = renderSrc.indexOf('function ensureWordListDelegation', fnStart);
    const fn = renderSrc.slice(fnStart, fnEnd);
    assert.match(
        fn,
        /<span class="word-english" lang="en">/,
        'wordCardHtml() phải đặt lang="en" ngay trên .word-english',
    );
});

test('P4.2 — flipCard chỉ dời focus khi thao tác từ bàn phím', () => {
    const start = renderSrc.indexOf('export async function flipCard(');
    assert.ok(start !== -1, 'không tìm thấy flipCard()');
    const end = renderSrc.indexOf('function focusGradingArea', start);
    const body = renderSrc.slice(start, end > start ? end : start + 2000);

    assert.match(body, /fromKeyboard = false/, 'flipCard() phải nhận cờ fromKeyboard (mặc định false)');
    assert.match(body, /else if \(fromKeyboard\)/, 'chỉ nhánh bàn phím mới được dời focus');
    assert.match(body, /focusGradingArea\(\)/, 'flipCard() phải gọi focusGradingArea() trong nhánh bàn phím');
    assert.doesNotMatch(
        body,
        /\.srs-btn\[data-rating="3"\]'\)\?\.focus/,
        'không được focus vô điều kiện vào nút "Nhớ" (cướp focus khi click chuột)',
    );
});

test('P4.2 — sự kiện bàn phím truyền fromKeyboard, chuột thì không', () => {
    assert.match(eventsSrc, /flipCard\(\{ fromKeyboard: true \}\)/, 'Space/F phải lật với fromKeyboard: true');
    assert.match(
        eventsSrc,
        /flipCard\(\{ fromKeyboard: e\.detail === 0 \}\)/,
        'nút "Xem nghĩa": click chuột (detail >= 1) không được dời focus, Enter/Space (detail 0) thì được',
    );
    const container = openTagById(html, 'srs-feedback-buttons');
    assert.match(container, /tabindex="-1"/, 'container nút chấm phải focus được bằng JS (tabindex="-1")');
});

test('P4.3 — nhãn thống kê mobile không bị cắt bằng ellipsis', () => {
    const mobile = cssBlockContaining(styleSrc, '@media (max-width: 480px)', '.chip-title');
    const chipTitle = cssBlock(mobile, '.chip-title');
    assert.match(chipTitle, /white-space:\s*normal/, '.chip-title mobile phải cho phép xuống dòng');
    assert.doesNotMatch(chipTitle, /text-overflow:\s*ellipsis/, '.chip-title mobile không được cắt bằng ellipsis');
    assert.doesNotMatch(chipTitle, /white-space:\s*nowrap/, '.chip-title mobile không được nowrap');
});

test('P4.3 — safe area iPhone: viewport-fit=cover + đệm đáy theo env()', () => {
    const meta = html.match(/<meta name="viewport" content="([^"]*)">/);
    assert.ok(meta, 'không tìm thấy meta viewport');
    assert.match(meta[1], /viewport-fit=cover/, 'viewport phải có viewport-fit=cover để env(safe-area-inset-*) khác 0');

    assert.match(
        styleSrc,
        /#stats-area\s*\{[^}]*margin-bottom:\s*env\(safe-area-inset-bottom/,
        '#stats-area (khối dưới cùng màn học) phải cộng env(safe-area-inset-bottom)',
    );
});
