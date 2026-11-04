// P18 — chữ ký dữ liệu cho heatmap & biểu đồ dự phòng của tab Tổng quan.
// Mục đích: bỏ qua việc dựng lại DOM khi dữ liệu không đổi (mở lại tab nhanh),
// nhưng KHÔNG được bỏ qua khi dữ liệu thật sự thay đổi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { heatmapSignature, forecastSignature } from '../src/features/overview-signature.js';

const TODAY = '2026-11-04';

// ─── Heatmap ────────────────────────────────────────────────────────────────
test('P18-1: heatmap — cùng dữ liệu khác thứ tự ⇒ cùng chữ ký (không vẽ lại vô ích)', () => {
    const a = { '2026-11-01': 3, '2026-11-02': 5 };
    const b = { '2026-11-02': 5, '2026-11-01': 3 };
    assert.equal(heatmapSignature(a, TODAY), heatmapSignature(b, TODAY));
});

test('P18-2: heatmap — đổi số lượt, đổi ngày, đổi hôm nay ⇒ đổi chữ ký (phải vẽ lại)', () => {
    const base = { '2026-11-01': 3 };
    assert.notEqual(heatmapSignature(base, TODAY), heatmapSignature({ '2026-11-01': 4 }, TODAY));
    assert.notEqual(heatmapSignature(base, TODAY), heatmapSignature({ '2026-11-02': 3 }, TODAY));
    // Sang ngày mới: ô "hôm nay" đổi vị trí nên phải vẽ lại dù dữ liệu y nguyên
    assert.notEqual(heatmapSignature(base, TODAY), heatmapSignature(base, '2026-11-05'));
});

test('P18-3: heatmap — rỗng/null ổn định và không ném lỗi', () => {
    assert.equal(heatmapSignature(undefined, TODAY), heatmapSignature({}, TODAY));
    assert.match(heatmapSignature(null, TODAY), /^2026-11-04\|0\|/);
});

// ─── Biểu đồ dự phòng ───────────────────────────────────────────────────────
const card = (over = {}) => ({ id: 'x', english: 'w', srsInterval: 2, srsDueDate: 1_700_000_000_000, srsStatus: 'Learning', ...over });

test('P18-4: forecast — dữ liệu y hệt ⇒ cùng chữ ký; thẻ đã xoá bị bỏ qua', () => {
    const list = [card(), card({ id: 'y', srsInterval: 5 })];
    assert.equal(forecastSignature(list, TODAY), forecastSignature([...list], TODAY));
    const withDeleted = [...list, card({ id: 'z', isDeleted: true, srsInterval: 99 })];
    assert.equal(forecastSignature(withDeleted, TODAY), forecastSignature(list, TODAY), 'thẻ đã xoá không được làm đổi chữ ký');
});

test('P18-5: forecast — đổi khoảng ôn / ngày đến hạn / trạng thái ⇒ đổi chữ ký', () => {
    const base = [card()];
    assert.notEqual(forecastSignature(base, TODAY), forecastSignature([card({ srsInterval: 3 })], TODAY));
    assert.notEqual(forecastSignature(base, TODAY), forecastSignature([card({ srsDueDate: 1_700_000_000_000 + 86_400_000 })], TODAY));
    assert.notEqual(forecastSignature(base, TODAY), forecastSignature([card({ srsStatus: 'New' })], TODAY));
    assert.notEqual(forecastSignature(base, TODAY), forecastSignature(base, '2026-11-06'));
});

test('P18-6: forecast — thêm/bớt thẻ ⇒ đổi chữ ký (không bỏ sót khi số thẻ đổi)', () => {
    assert.notEqual(forecastSignature([card()], TODAY), forecastSignature([card(), card({ id: 'y' })], TODAY));
    assert.notEqual(forecastSignature([card(), card({ id: 'y' })], TODAY), forecastSignature([card()], TODAY));
});

test('P18-7: hai hàm được nối đúng trong gamification.js và có chặn "DOM còn nguyên"', () => {
    const src = fs.readFileSync(new URL('../src/features/gamification.js', import.meta.url), 'utf8');
    assert.match(src, /from '\.\/overview-signature\.js'/, 'phải dùng module chữ ký');
    assert.match(src, /sig === _heatmapSignature && DOM\.activityHeatmap\.childElementCount > 0/, 'heatmap phải kiểm tra DOM còn nguyên trước khi bỏ qua');
    assert.match(src, /sig === _forecastSignature && DOM\.forecastChart\.childElementCount > 0/, 'forecast phải kiểm tra DOM còn nguyên trước khi bỏ qua');
});
