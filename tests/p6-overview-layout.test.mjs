// tests/p6-overview-layout.test.mjs — PHASE 6: lỗi đè layout trong tab Tổng quan.
//
// Triệu chứng người dùng chụp được: thẻ "Xạ Thủ Chuẩn Xác" và panel "CHÍNH XÁC
// TUYỆT ĐỐI" của khối Chân Dung Não Bộ nằm ĐÈ lên heatmap và biểu đồ dự báo.
//
// Nguyên nhân đo được (Chrome headless): `.bento-charts-row` có
//   height = 0px, scrollHeight = 180px, overflow = visible
// vì `flex: 1` (basis 0%) + `min-height: 0` trong cột flex đã tràn. Hai thẻ con
// tràn ra khỏi hộp 0px và vẽ đè lên phần tử đứng sau. Trước PHASE 3, tab này
// không có gì sau hàng đó nên lỗi ẩn; thêm khối persona vào là lộ ra.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const css = read('src/css/style.css');
const html = read('index.html');

test('P6: hàng heatmap + dự báo nhận chiều cao nội dung (không còn 0px)', () => {
    assert.match(
        css,
        /#profile-view-overview > \.profile-rhythm-grid,\s*#profile-view-overview > \.bento-charts-row \{\s*flex: 1 1 auto;\s*min-height: min-content;/,
        'phải override flex/min-height cho hàng charts trong tab Tổng quan'
    );
    // Giữ nguyên gốc cho nơi khác dùng lại
    assert.match(
        css,
        /\.profile-rhythm-grid,\s*\.bento-charts-row \{[^}]*flex: 1;/,
        'rule gốc vẫn phải còn (chỉ override trong pane Tổng quan)'
    );
});

test('P6: khối Chân Dung Não Bộ đứng SAU hàng biểu đồ trong DOM', () => {
    const paneStart = html.indexOf('id="profile-view-overview"');
    const paneEnd = html.indexOf('id="manage-view-words"');
    assert.ok(paneStart > 0 && paneEnd > paneStart, 'không xác định được tab Tổng quan');

    const forecast = html.indexOf('id="review-forecast-card"');
    const persona = html.indexOf('id="profile-view-persona"');
    const heatmapLabel = html.indexOf('Hoạt động Ôn tập');

    assert.ok(heatmapLabel > paneStart, 'heatmap phải nằm trong tab Tổng quan');
    assert.ok(forecast > heatmapLabel, 'biểu đồ dự báo đứng sau heatmap');
    assert.ok(persona > forecast, 'persona phải nằm SAU biểu đồ; nếu phần tử trước nó cao 0px thì nó sẽ bị đè');
    assert.ok(persona < paneEnd, 'persona phải nằm trong tab Tổng quan');
});

test('P6: persona chỉ chiếm 1 khối duy nhất (không chèn vào lưới bento)', () => {
    const occurrences = (html.match(/id="profile-view-persona"/g) || []).length;
    assert.equal(occurrences, 1, 'chỉ được có một pane persona');
    // Khối bọc phải là một section riêng, không phải item của .bento-charts-row
    const wrapper = html.slice(
        html.indexOf('class="profile-card whoiam-card"'),
        html.indexOf('id="profile-view-persona"')
    );
    assert.ok(wrapper.length > 0, 'thiếu khối bọc .whoiam-card');
    assert.doesNotMatch(wrapper, /bento-charts-row/, 'không được lồng trong lưới biểu đồ');
});

// ── PHASE 6b: bẫy "khai báo trùng trong cùng một block" ─────────────────────
// Lỗi thật đã xảy ra: rule .header-more-menu có CẢ `display: none` (mới thêm)
// và `display: flex` (còn sót) trong CÙNG một block ⇒ cái sau thắng, menu ⚙
// luôn mở dù không ai bấm. Test này chặn đúng lớp lỗi đó cho mọi file CSS.
test('P6: không block CSS nào khai báo display hai lần', () => {
    const dir = path.join(root, 'src/css');
    const offenders = [];
    for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.css'))) {
        const text = fs.readFileSync(path.join(dir, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        const blockRe = /([^{}]+)\{([^{}]*)\}/g;
        let match;
        while ((match = blockRe.exec(text))) {
            const decls = match[2]
                .split(';')
                .map(s => s.trim())
                .filter(Boolean);
            const displayCount = decls.filter(d => /^display\s*:/.test(d)).length;
            if (displayCount > 1) {
                offenders.push(name + ' → ' + match[1].trim().split('\n').pop().trim().slice(0, 60));
            }
        }
    }
    assert.deepEqual(offenders, [], 'một block chỉ được có một khai báo display');
});

test('P6: menu ⚙ mặc định ẩn — base rule chỉ có display:none', () => {
    const base = css.slice(css.indexOf('.header-more-menu {'));
    const blockText = base.slice(0, base.indexOf('}'));
    const displays = [...blockText.matchAll(/display:\s*([a-z-]+)/g)].map(m => m[1]);
    assert.deepEqual(displays, ['none'], 'base rule phải chỉ khai báo display:none');
    assert.match(css, /\.header-more-menu\.is-open\s*\{\s*display: flex;/);
});
