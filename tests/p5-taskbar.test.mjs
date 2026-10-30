// tests/p5-taskbar.test.mjs — PHASE 5: thanh taskbar 3 tầng.
//
// Trước: 10 control hiện cùng lúc, trộn 3 kiểu hiển thị (chữ+icon / icon trơn /
// dropdown). Nút cài đặt dùng 1 tháng 1 lần nằm ngang hàng nút dùng mỗi ngày.
// Sau:  7 control, 3 nhóm có vách ngăn, phần ít dùng gom vào menu "⚙".
//
// Bài học được khoá bằng test:
//   • .hidden của toàn cục là `display:none !important` nằm trong @layer; với
//     !important thì rule CÓ layer thắng rule không layer bất kể specificity ⇒
//     không được dùng class .hidden cho menu này (dùng .is-open).
//   • Icon phải có glyph trong public/phosphor-subset.css, nếu không sẽ hiện ô rỗng.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const html = read('index.html');
const css = read('src/css/style.css');
const events = read('src/events.js');
const render = read('src/ui/render.js');
const elements = read('src/ui/elements.js');

const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
const taskbar = header.slice(header.indexOf('id="taskbar-menu"'));

test('P5: header chia đúng 3 nhóm và 2 vách ngăn', () => {
    const groups = [...taskbar.matchAll(/class="header-group ([a-z-]+)"/g)].map(m => m[1]);
    assert.deepEqual(groups, ['group-filter', 'group-actions', 'group-utilities']);
    const dividers = (taskbar.match(/class="header-divider"/g) || []).length;
    assert.equal(dividers, 2, 'mỗi ranh giới nhóm cần một vách ngăn');
});

test('P5: tầng 1 (học mỗi ngày) và tầng 2 (toggle) vẫn hiện, đúng thứ tự', () => {
    const order = [
        'custom-topic-trigger',
        'custom-typing-trigger',
        'start-quiz-btn',
        'celestial-hub-btn',
        'toggle-boost-mode-btn',
        'toggle-sound-btn',
        'header-more-btn'
    ];
    const positions = order.map(id => taskbar.indexOf(`id="${id}"`));
    for (const [i, pos] of positions.entries()) {
        assert.ok(pos > 0, `thiếu control ${order[i]}`);
        if (i > 0) assert.ok(pos > positions[i - 1], `${order[i]} phải đứng sau ${order[i - 1]}`);
    }
});

test('P5: hai chip có aria-pressed để nhìn ra trạng thái bật/tắt', () => {
    for (const id of ['toggle-boost-mode-btn', 'toggle-sound-btn']) {
        const tag = taskbar.slice(taskbar.indexOf(`id="${id}"`));
        const openTag = tag.slice(0, tag.indexOf('>'));
        assert.match(openTag, /class="[^"]*header-chip/, `${id} phải là chip`);
        assert.match(openTag, /aria-pressed="(true|false)"/, `${id} phải có aria-pressed`);
    }
});

test('P5: 4 công cụ ít dùng nằm trong menu ⚙ và GIỮ NGUYÊN id cũ', () => {
    const menuStart = taskbar.indexOf('id="header-more-menu"');
    assert.ok(menuStart > 0, 'phải có #header-more-menu');
    const menu = taskbar.slice(menuStart);
    for (const id of [
        'undo-btn',
        'toggle-dark-mode-btn',
        'tts-settings-btn',
        'manual-sync-btn',
        'shortcuts-menu-btn'
    ]) {
        assert.ok(menu.includes(`id="${id}"`), `${id} phải nằm trong menu`);
        assert.ok(!taskbar.slice(0, menuStart).includes(`id="${id}"`), `${id} không được còn ở ngoài menu`);
    }
    // id giữ nguyên ⇒ handler trong io.js/events.js/render.js vẫn chạy, không phải sửa logic
    // id giữ nguyên nên các chỗ tra cứu hiện có (elements.js cho undo/theme, sound.js cho
    // TTS) vẫn tìm thấy phần tử — không phải sửa một dòng logic nào.
    for (const [file, snippet] of [
        ['src/ui/elements.js', "undoBtn: getEl('undo-btn')"],
        ['src/ui/elements.js', "toggleDarkModeBtn: getEl('toggle-dark-mode-btn')"],
        ['src/ui/elements.js', "manualSyncBtn: getEl('manual-sync-btn')"],
        ['src/core/sound.js', "document.getElementById('tts-settings-btn')"]
    ]) {
        assert.ok(read(file).includes(snippet), `${file} phải còn tham chiếu ${snippet}`);
    }
    // Chỉ MỘT listener cho nút Giọng đọc: sound.js tự tra id và tự đánh dấu đã gắn.
    assert.match(read('src/core/sound.js'), /ttsTriggerBound/, 'phải chống gắn listener trùng');
});

test('P5: menu dùng .is-open, KHÔNG dùng .hidden (bẫy @layer + !important)', () => {
    const menuTag = taskbar.slice(taskbar.indexOf('id="header-more-menu"'));
    const openTag = menuTag.slice(0, menuTag.indexOf('>'));
    assert.doesNotMatch(openTag, /\bhidden\b/, 'class .hidden của toàn cục là !important trong @layer, sẽ luôn thắng');
    assert.match(css, /\.header-more-menu\.is-open\s*\{\s*display: flex;/, 'phải mở bằng .is-open');
    assert.match(events, /classList\.toggle\('is-open', open\)/, 'JS phải toggle .is-open');
    assert.match(events, /isMoreMenuOpen/, 'phải có helper đọc trạng thái');
});

test('P5: menu đóng được bằng click ngoài và bằng Escape', () => {
    assert.match(
        events,
        /event\.target\.closest\('#header-more-menu, #header-more-btn'\)/,
        'click ra ngoài phải đóng menu'
    );
    assert.match(events, /event\.key === 'Escape' && isMoreMenuOpen\(\)/, 'Escape phải đóng menu');
    assert.match(events, /moreBtn\.focus\(\)/, 'sau Escape phải trả focus về nút mở');
    assert.match(
        events,
        /DOM\.shortcutsMenuBtn\?\.addEventListener\('click', \(\) => openShortcutsModal\(\)\)/,
        'mục "Phím tắt" phải mở modal phím tắt'
    );
});

test('P5: âm thanh + giao diện phản ánh trạng thái trong chip/menu', () => {
    assert.match(render, /soundBtn\.setAttribute\('aria-pressed', mode === 'off' \? 'false' : 'true'\)/);
    assert.match(render, /DOM\.toggleDarkModeBtn\.setAttribute\('aria-pressed', isDark \? 'true' : 'false'\)/);
    assert.match(render, /Giao diện: Tối/, 'nhãn trong menu phải nói rõ đang ở chế độ nào');
    assert.match(render, /header-menu-item-text/);
});

test('P5: mobile bỏ menu lồng — 5 mục chảy thẳng vào drawer ☰', () => {
    // Khối @media (max-width: 900px) của PHASE 5 không còn là khối cuối file
    // (PHASE 7 thêm block mobile riêng) ⇒ lấy từ @media gần nhất TRƯỚC rule
    // #header-more-btn, đủ dài để chứa cả .header-more-menu.
    const btnIdx = css.indexOf('#header-more-btn {');
    const blockStart = css.lastIndexOf('@media (max-width: 900px) {', btnIdx);
    const mobile = css.slice(blockStart, blockStart + 1600);
    assert.match(
        mobile,
        /#header-more-btn\s*\{\s*display: none;/,
        'nút ⚙ phải ẩn trên mobile (id selector, không dùng !important)'
    );
    assert.match(
        mobile,
        /\.header-more-menu\s*\{[\s\S]*?display: contents;/,
        'container phải biến mất khỏi layout (display:contents) để 5 mục xếp như chip'
    );
});

test('P5: mọi icon dùng trong app đều có glyph trong phosphor-subset.css', () => {
    const subset = read('public/phosphor-subset.css');
    const hasGlyph = selector => new RegExp('\\.' + selector.replace(/\./g, '\\.') + ':before').test(subset);
    const files = ['index.html'];
    const walk = dir => {
        for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
            const rel = dir + '/' + entry.name;
            if (entry.isDirectory()) {
                if (!/node_modules|dist/.test(rel)) walk(rel);
            } else if (/\.(js|mjs)$/.test(entry.name)) files.push(rel);
        }
    };
    walk('src');
    const missing = new Set();
    for (const file of files) {
        const text = read(file);
        for (const m of text.matchAll(/\bph-(duotone|fill|bold|thin|light)\s+(ph-[a-z0-9-]+)/g)) {
            const sel = 'ph-' + m[1] + '.' + m[2];
            if (!hasGlyph(sel)) missing.add(sel + ' (' + file + ')');
        }
        for (const m of text.matchAll(/class="ph\s+(ph-[a-z0-9-]+)"/g)) {
            if (!hasGlyph('ph.' + m[1])) missing.add('ph.' + m[1] + ' (' + file + ')');
        }
    }
    assert.deepEqual([...missing], [], 'icon không có trong subset sẽ hiện ô rỗng');
});

test('P5: nút Phím tắt trong menu được khai báo lại trong elements.js', () => {
    assert.match(elements, /shortcutsMenuBtn: getEl\('shortcuts-menu-btn'\)/);
    assert.match(elements, /headerMoreBtn: getEl\('header-more-btn'\)/);
    assert.match(elements, /headerMoreMenu: getEl\('header-more-menu'\)/);
});
