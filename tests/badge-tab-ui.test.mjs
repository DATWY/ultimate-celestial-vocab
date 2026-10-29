// tests/badge-tab-ui.test.mjs — khoá 3 lỗi thiết kế của tab "Huy Hiệu" (Celestial Hub).
//
// Bối cảnh (người dùng báo 2026-10-29, kèm ảnh chụp): tab Huy Hiệu bị "lỗi thiết
// kế UI". Đo trong trình duyệt (viewport 1295×810 @2x, light mode) tìm ra 3 lỗi
// thật, mỗi lỗi có một con số:
//
//  1. Hộp icon của thẻ track lấy màu theo TIER (`tier-rare` = cyan) thay vì màu
//     track (--track-theme). Kết quả: thẻ cam "Bền Bỉ" có hộp icon cyan, thẻ xanh
//     lá "Trí Tuệ" cũng cyan → 3/4 thẻ mất bản sắc màu, 1 thẻ lệch hẳn.
//  2. Thẻ có CẢ `border-top: 4px` LẪN `::before` cao 4px ⇒ dải accent trên đỉnh
//     dày 8px (10px khi hover) thay vì 4px.
//  3. Lưới 2×2 (thiết kế ghi rõ "Fix 'trên 3 dưới 1'") cao 241×2 + 18 = 500px
//     trong khi khung nhìn chỉ 462px ⇒ KHÔNG BAO GIỜ thấy trọn 4 thẻ cùng lúc.
//
// Test đọc CSS/JS nguồn nên không cần DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cssDir = fileURLToPath(new URL('../src/css', import.meta.url));
const css = Object.fromEntries(
    fs
        .readdirSync(cssDir)
        .filter(name => name.endsWith('.css'))
        .map(name => [name, fs.readFileSync(path.join(cssDir, name), 'utf8')])
);
const allCss = Object.values(css).join('\n');
const gamification = fs.readFileSync(
    fileURLToPath(new URL('../src/features/gamification.js', import.meta.url)),
    'utf8'
);

/** Lấy giá trị đầu tiên của một thuộc tính trong rule khớp selector. */
function cssValue(selectorPattern, property, source = allCss) {
    const ruleRe = new RegExp(selectorPattern.source + String.raw`[^{}]*\{([^}]*)\}`, 'g');
    const propRe = new RegExp(String.raw`(?:^|;|\n)\s*` + property + String.raw`\s*:\s*([^;}]+)`, 'i');
    for (const match of source.matchAll(ruleRe)) {
        const found = propRe.exec(match[1]);
        if (found) return found[1].trim();
    }
    return null;
}
const px = value => Number.parseFloat(String(value));

test('hộp icon của thẻ track KHÔNG dùng màu tier (phải theo --track-theme)', () => {
    assert.equal(
        /track-icon-box[^`"']*\$\{tier\.id\}|track-icon-box tier-\$\{/.test(gamification),
        false,
        'không được gắn class tier-* vào .track-icon-box của thẻ track — tier sẽ ghi đè màu track'
    );
    assert.equal(
        /class="track-icon-box tier-/.test(gamification),
        false,
        'markup thẻ track không được có "track-icon-box tier-…"'
    );
    // Base style phải thật sự dùng biến màu của track
    const base = cssValue(/\.track-icon-box/, 'color');
    assert.match(String(base), /--track-theme/, `.track-icon-box phải tô bằng --track-theme, đang: ${base}`);
});

test('dải accent trên đỉnh thẻ chỉ dày 4px, không cộng dồn border + ::before', () => {
    const borderTop = cssValue(/body:not\(\.dark-mode\)[^{]*\.badge-track-item[^{]*/, 'border-top');
    assert.equal(borderTop, null, `không được đặt border-top riêng (::before đã là dải accent), đang: ${borderTop}`);
    const stripeHeight = cssValue(/\.badge-track-item::before/, 'height');
    assert.equal(px(stripeHeight), 4, `dải accent phải cao 4px, đang: ${stripeHeight}`);
});

test('thẻ track đủ gọn để thấy trọn lưới 2×2 trong khung nhìn 810px', () => {
    // Ngân sách đo được: khung cuộn của pane ≈ 462px ở viewport 1295×810.
    // 2 thẻ + 1 khoảng hàng phải ≤ 462 - 20 (dư an toàn) = 442.
    const padding = px(cssValue(/\.badge-track-item/, 'padding', css['study-polish.css']));
    const rowGap = px(cssValue(/\.badge-track-item/, 'gap', css['study-polish.css']));
    const iconBox = px(cssValue(/\.track-icon-box/, 'height', css['study-polish.css']));
    const gridGap = px(cssValue(/\.achievements-wrapper/, 'gap', css['study-polish.css']));
    assert.ok(padding <= 15, `padding thẻ track phải ≤ 15px, đang ${padding}`);
    assert.ok(rowGap <= 12, `gap trong thẻ phải ≤ 12px, đang ${rowGap}`);
    assert.ok(iconBox <= 50, `hộp icon phải ≤ 50px, đang ${iconBox}`);
    assert.ok(gridGap <= 16, `khoảng cách lưới phải ≤ 16px, đang ${gridGap}`);

    // Ước lượng chiều cao thẻ từ các thành phần cố định:
    // border 1px×2 + padding×2 + gap×2 + hộp icon (hero) + hàng pill 33 + khối tiến độ 72
    // (đo thật trong Chrome ở 1295×810: 204px — khớp công thức này)
    const estimated = 2 + padding * 2 + rowGap * 2 + iconBox + 33 + 72;
    assert.ok(estimated <= 215, `ước lượng chiều cao thẻ quá lớn: ${estimated}px`);
    assert.ok(estimated * 2 + gridGap <= 442, `2 hàng cần ${estimated * 2 + gridGap}px, vượt ngân sách 442px`);
});

test('không còn vệt sáng lặp vô hạn trên banner tổng', () => {
    assert.equal(/summaryShineSweep/.test(allCss), false, 'animation sweep 6s của banner phải bị xoá');
    assert.equal(
        /\.achievements-summary-banner::before/.test(allCss),
        false,
        'banner không được có pseudo-element tạo vệt sáng'
    );
});
