// tests/p1-ui-fixes.test.mjs — PHASE 2: UI-01, UI-02, UI-03.
//
// Ba lỗi người dùng thấy trực tiếp:
//   UI-01 nút "Tải toàn bộ audio" bị gắn HAI listener. events.js chạy trước, đặt
//         isPreloadingAll = true (sound.js:1836) khiến handler của io.js return sớm
//         (sound.js:1833) ⇒ thanh tiến độ đứng im.
//   UI-02 xoá/gộp một thẻ chỉ sửa mảng vocabulary: thẻ vừa xoá vẫn nằm trên màn
//         hình học, số "cần ôn / từ mới" sai tới lần render sau.
//         Nút Undo nằm trong khối display:none của Celestial Hub và Ctrl+Z bị
//         chặn mỗi khi mở Hub.
//   UI-03 gõ chữ "boost" vừa bật/tắt Boost (B) vừa bật/tắt Sao (S) ở từng ký tự;
//         showPopup bị gọi sai arity nên mất nửa thông điệp.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEditableTarget, shouldHandleUndoShortcut, matchBoostCommand } from '../src/core/utils/keyboard.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : /\.(js|mjs)$/.test(entry.name) ? [full] : [];
    });
}
const srcFiles = walk(path.join(root, 'src')).map(abs => ({
    rel: path.relative(root, abs).replace(/\\/g, '/'),
    text: fs.readFileSync(abs, 'utf8')
}));

test('UI-01: chỉ MỘT nơi bind #download-all-audio-btn (nơi có onProgress)', () => {
    const binders = srcFiles.filter(f =>
        /download-all-audio-btn['"]\)?\s*\??\.?\s*addEventListener|getElementById\('download-all-audio-btn'\)\?\.addEventListener/.test(
            f.text
        )
    );
    assert.equal(binders.length, 1, `phải chỉ còn 1 listener, đang có: ${binders.map(b => b.rel).join(', ')}`);
    assert.equal(
        binders[0].rel,
        'src/features/io.js',
        'listener còn lại phải là io.js — bản có onProgress + progress bar'
    );

    const html = read('index.html');
    const wrapId = 'audio-download-progress-wrap';
    const fillId = 'audio-download-progress-fill';
    assert.ok(html.includes(wrapId) && html.includes(fillId), 'progress bar phải tồn tại trong DOM');
});

test('UI-02: nút Undo nằm ở thanh công cụ học, không bị giấu trong Hub', () => {
    const html = read('index.html');
    const undoAt = html.indexOf('id="undo-btn"');
    assert.ok(undoAt > 0, 'phải có #undo-btn');

    // Khối actions của Hub bị display:none; nút không được nằm trong khoảng đó.
    const actionsStart = html.indexOf('manage-header-actions');
    const actionsEnd = html.indexOf('</div>', html.indexOf('id="scan-duplicates-btn"'));
    assert.ok(actionsStart > 0 && actionsEnd > actionsStart);
    assert.equal(
        undoAt > actionsStart && undoAt < actionsEnd,
        false,
        'Undo không được nằm trong manage-header-actions (khối display:none)'
    );

    // Phải đứng trước khi mở modal Hub ⇒ thuộc vùng thanh công cụ học.
    const manageModalAt = html.indexOf('id="manage-modal"');
    assert.ok(undoAt < manageModalAt, 'Undo phải ở header học, trước cả #manage-modal');
});

test('UI-02: Ctrl/Cmd+Z hoạt động khi mở Hub, nhưng nhường trình duyệt khi đang gõ', () => {
    assert.equal(shouldHandleUndoShortcut({ editable: false, isTyping: false }), true);
    assert.equal(
        shouldHandleUndoShortcut({ editable: true, isTyping: false }),
        false,
        'đang ở trong ô nhập thì phải để trình duyệt undo chữ'
    );
    assert.equal(
        shouldHandleUndoShortcut({ editable: false, isTyping: true }),
        false,
        'đang gõ phím trong chế độ typing thì không hoàn tác lượt đánh giá'
    );

    assert.equal(isEditableTarget({ tagName: 'input' }), true);
    assert.equal(isEditableTarget({ tagName: 'textarea' }), true);
    assert.equal(isEditableTarget({ tagName: 'DIV', isContentEditable: true }), true);
    assert.equal(isEditableTarget({ tagName: 'BUTTON' }), false);
    assert.equal(isEditableTarget(null), false);
});

test('UI-02: xoá từ và gộp trùng đều dựng lại hàng đợi ôn', () => {
    const render = read('src/ui/render.js');
    assert.ok(
        render.includes('export function refreshStudyAfterVocabularyChange'),
        'phải có helper dùng chung để không lặp lại logic ở hai nơi'
    );
    assert.ok(render.includes('refreshStudyAfterVocabularyChange([current.id])'), 'handler xoá thẻ phải gọi refresh');
    const modal = read('src/ui/modal.js');
    assert.ok(/refreshStudyAfterVocabularyChange\(/.test(modal), 'gộp trùng (executeMergeAll) phải gọi refresh');
});

test('UI-03: lệnh Boost cần tiền tố "/" nên gõ chữ thường không bắn phím B/S', () => {
    assert.equal(matchBoostCommand('/boost'), true);
    assert.equal(matchBoostCommand('xx/boost'), true, 'buffer 10 ký tự vẫn nhận ra lệnh');
    assert.equal(matchBoostCommand('boost'), false, 'chữ trần "boost" KHÔNG còn là lệnh');
    assert.equal(matchBoostCommand('b'), false);
    assert.equal(matchBoostCommand(''), false);
    assert.equal(matchBoostCommand(null), false);
});

test('UI-03: showPopup được gọi đúng (message, type) ở luồng tạo phiên lọc', () => {
    const events = read('src/events.js');
    assert.ok(
        events.includes('showPopup("Hiện không có từ vựng nào trong kho phù hợp'),
        'phải truyền câu giải thích làm message'
    );
    assert.equal(
        events.includes('showPopup("Không tìm thấy từ vựng", "Hiện không có'),
        false,
        'không được truyền (title, message) — câu giải thích sẽ bị nuốt vào type'
    );
});
