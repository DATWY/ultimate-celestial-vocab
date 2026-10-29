// tests/card-flip-motion.test.mjs — khoá việc thẻ học KHÔNG còn "vệt sáng" khi lật.
//
// Bối cảnh (phản hồi trực tiếp người dùng, 2026-10-29): khi bấm lật thẻ, một dải
// sáng chéo chạy ngang mặt thẻ. Đó là `.card-face::after` + @keyframes 620ms.
// Ba lý do nó là lỗi chứ không phải trang trí:
//   1. Không truyền tải thông tin (người dùng gọi là "vệt sáng vô nghĩa").
//   2. Chạy 620ms trong khi `.is-flipping` chỉ tồn tại 500ms ⇒ luôn bị cắt giữa
//      chừng, nên nó hiện ra như một mảng sáng đứng yên chứ không phải một lượt quét.
//   3. Thêm một lớp gradient toàn thẻ đúng lúc trình duyệt đang xoay 3D.
//
// Test này giữ: (a) không còn pseudo-element/gradient trên mặt thẻ; (b) phần
// phản hồi CÓ nghĩa (bóng đổ sâu khi lật) vẫn còn, để "sửa lỗi" không âm thầm
// xoá luôn feedback tốt.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath (không phải URL.pathname) — trên Windows pathname là "/C:/...",
// ghép với path.join sẽ thành "C:\C:\...".
const cssDir = fileURLToPath(new URL('../src/css', import.meta.url));
const cssFiles = fs.readdirSync(cssDir).filter(name => name.endsWith('.css'));
const allCss = cssFiles.map(name => fs.readFileSync(path.join(cssDir, name), 'utf8')).join('\n');
const motion = fs.readFileSync(path.join(cssDir, 'motion-upgrade.css'), 'utf8');

test('không còn dải sáng trên mặt thẻ (không pseudo-element ::after của .card-face)', () => {
    assert.equal(
        /\.card-face\s*::\s*(after|before)/i.test(allCss),
        false,
        'mặt thẻ không được có pseudo-element trang trí — đây chính là "vệt sáng" khi lật'
    );
});

test('không còn keyframes sweep của thẻ', () => {
    assert.equal(/celestialCardSweep/i.test(allCss), false, 'keyframes sweep của thẻ phải bị xoá hẳn');
    assert.equal(/@keyframes\s+[\w-]*[Cc]ard[Ss]weep/.test(allCss), false);
});

test('không rule nào animate mặt thẻ khi lật (chỉ còn hiệu ứng độ sâu)', () => {
    // Bắt mọi khai báo animation/transition gắn với .card-face
    const cardFaceRules = [...allCss.matchAll(/\.card-face[^{}]*\{([^}]*)\}/g)].map(match => match[1]);
    assert.ok(cardFaceRules.length > 0, 'phải còn layout của .card-face');
    for (const body of cardFaceRules) {
        assert.equal(/\banimation\s*:/i.test(body), false, '.card-face không được khai báo animation');
        assert.equal(
            /background-image\s*:\s*linear-gradient\([^)]*105deg/i.test(body),
            false,
            'không được quay lại gradient chéo kiểu dải sáng'
        );
    }
});

test('vẫn giữ phản hồi có nghĩa: bóng đổ sâu hơn khi lật', () => {
    assert.match(
        motion,
        /\.flashcard\.is-flipping\s*\{[^}]*box-shadow/s,
        'mất box-shadow khi lật = mất feedback độ sâu (đừng "sửa lỗi" bằng cách xoá hết)'
    );
    assert.match(
        motion,
        /body:not\(\.dark-mode\)\s*\.flashcard\.is-flipping\s*\{[^}]*box-shadow/s,
        'phải có biến thể bóng đổ cho light mode'
    );
});

test('boost mode và reduced-motion không còn tham chiếu tới pseudo-element đã xoá', () => {
    assert.equal(
        /boost-mode[^{]*\.card-face::after/.test(motion),
        false,
        'chọn lọc boost-mode còn trỏ vào ::after không tồn tại = CSS rác'
    );
    assert.equal(
        /\.flashcard\.is-flipping\s+\.card-face::after/.test(motion),
        false,
        'override reduced-motion còn trỏ vào ::after không tồn tại = CSS rác'
    );
});
