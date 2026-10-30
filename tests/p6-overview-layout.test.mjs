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
