// tests/p7-mobile.test.mjs — PHASE 7: tối ưu giao diện mobile.
//
// Số đo TRƯỚC khi sửa (Chrome headless + Emulation.setDeviceMetricsOverride,
// 320×568 / 360×640 / 390×844):
//   • #toggle-taskbar-btn 36×36 · #tts-btn 42×42 · #star-btn 34×34 · nút help 20×20
//   • drawer ☰: 11 dòng cao 38px, 2 chip ⚡/🔊 không có chữ
//   • Hub Tổng quan: pane rộng 251px nhưng .streak-recovery-controls rộng 171px
//     (tràn), .identity-card-inner giữ 2 cột ⇒ nội dung 507px, .xp-info chỉ 117px
//     nhưng cần 157px ⇒ chữ "cấp" bị cắt; pane cuộn ngang ở 320/360.
//   • 3 toast cùng lúc chiếm ~270px chiều cao màn 568px.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const css = read('src/css/style.css');
const html = read('index.html');
const render = read('src/ui/render.js');
const modal = read('src/ui/modal.js');

const noComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '');
const cssCode = noComments(css);

test('P7: nút tròn trên header/thẻ đạt 44px chạm trên mobile', () => {
    for (const id of ['#toggle-taskbar-btn', '#tts-btn', '#star-btn']) {
        const re = new RegExp('[^{}]*' + id.replace('#', '\\#') + '[^{}]*\\{[^}]*width: 44px;[^}]*height: 44px;');
        assert.match(cssCode, re, `${id} phải có width/height 44px trong media mobile`);
    }
    // Và phải nằm trong media query, không áp lên desktop
    const block = cssCode.slice(cssCode.indexOf('@media (max-width: 900px)'));
    assert.match(block.slice(0, 2000), /#toggle-taskbar-btn[\s\S]*?width: 44px;/);
});

test('P7: drawer ☰ — mỗi dòng cao ≥44px và KHÔNG còn dòng chỉ có icon', () => {
    assert.match(cssCode, /#taskbar-menu button \{\s*min-height: 44px;/, 'dòng trong drawer phải ≥44px');
    // Nhãn chữ cho hai chip, ẩn trên desktop và hiện trong drawer
    assert.match(cssCode, /\.header-chip-label \{\s*display: none;/, 'desktop: chỉ icon');
    assert.match(
        cssCode,
        /@media \(max-width: 900px\)[\s\S]*?\.header-chip-label \{\s*display: inline;/,
        'mobile: phải hiện nhãn chữ'
    );
    for (const [id, label] of [
        ['toggle-boost-mode-btn', 'Boost'],
        ['toggle-sound-btn', 'Âm thanh']
    ]) {
        const tag = html.slice(html.indexOf(`id="${id}"`));
        const chunk = tag.slice(0, tag.indexOf('</button>'));
        assert.match(chunk, new RegExp(`header-chip-label">${label}<`), `${id} phải có nhãn "${label}"`);
    }
});

test('P7: nhãn chip cập nhật theo trạng thái (không phải chữ tĩnh)', () => {
    assert.match(render, /chipText\.textContent = 'Âm thanh: ' \+ modeText/, 'chip âm thanh phải nói rõ chế độ');
    assert.match(
        render,
        /chipText\.textContent = isBoost \? 'Boost: BẬT' : 'Boost'/,
        'chip boost phải nói rõ đang bật'
    );
});

test('P7: persona không còn 2 cột cứng trên tablet/điện thoại', () => {
    assert.match(
        cssCode,
        /@media \(max-width: 768px\)[\s\S]*?\.whoiam-identity-card \.identity-card-inner \{\s*grid-template-columns: 1fr;/,
        'identity-card-inner (không phải whoiam-identity-card) mới là grid 2 cột'
    );
});

test('P7: khối chuỗi + cấp độ không đẩy tràn pane trên máy hẹp', () => {
    assert.match(cssCode, /\.streak-recovery-controls \.streak-freeze-btn,\s*\.streak-freeze-btn \{[^}]*min-width: 0;/);
    assert.match(
        cssCode,
        /@media \(max-width: 400px\)[\s\S]*?\.level-display \{\s*flex-wrap: wrap;/,
        'ở 320px cấp độ + XP phải xuống dòng'
    );
    assert.match(cssCode, /\.level-display \.xp-info \{\s*flex: 1 1 100%;/, 'XP phải chiếm trọn hàng');
});

test('P7: toast trên máy hẹp giới hạn bằng JS, không ẩn bằng CSS', () => {
    assert.match(modal, /function maxVisibleToasts\(\)/, 'phải có hàm giới hạn theo bề rộng');
    assert.match(modal, /window\.innerWidth <= 480 \? 2 : MAX_VISIBLE_TOASTS/);
    assert.match(modal, /container\.childElementCount < maxVisibleToasts\(\)/, 'vòng drain phải dùng hàm này');
    // Ẩn toast bằng CSS làm childElementCount không giảm ⇒ hàng đợi kẹt
    assert.doesNotMatch(cssCode, /\.toast:nth-last-child/, 'không được ẩn toast bằng CSS');
});
