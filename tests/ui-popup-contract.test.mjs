// tests/ui-popup-contract.test.mjs — khoá hợp đồng "loại thông báo" của popup.
//
// Vì sao có file này: `showPopup(message, type)` được gọi với 'error'/'success'/
// 'warning' ở 22 chỗ trong src, nhưng bản cũ KHÔNG dùng `type` — hộp thoại lỗi
// và hộp thoại thành công trông giống hệt nhau, người dùng không phân biệt được
// "đã lưu" với "chưa lưu". Đây là lỗi im lặng: không crash, chỉ mất thông tin.
// Test dưới đây chặn tái phát ở cả 4 tầng: markup, CSS, logic, và giá trị lạ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = rel => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const html = read('index.html');
const modalCss = read('src/css/style.css');
const modalSrc = read('src/ui/modal.js');
const subsetCss = read('public/phosphor-subset.css');

const popupBlock = (() => {
    const start = html.indexOf('id="popup-modal"');
    assert.ok(start >= 0, 'index.html phải có #popup-modal');
    return html.slice(start, html.indexOf('id="shortcuts-modal"', start));
})();

// ─── 1. Markup ──────────────────────────────────────────────────────────────
test('popup có host biểu tượng nằm giữa nút đóng và nội dung', () => {
    assert.match(popupBlock, /id="popup-icon"/, 'thiếu #popup-icon trong #popup-modal');
    const iconIndex = popupBlock.indexOf('id="popup-icon"');
    const messageIndex = popupBlock.indexOf('id="popup-message"');
    assert.ok(iconIndex < messageIndex, '#popup-icon phải đứng TRƯỚC #popup-message');
    assert.match(
        popupBlock,
        /id="popup-icon"[^>]*aria-hidden="true"/,
        'biểu tượng phải aria-hidden để trình đọc màn hình không đọc tên icon'
    );
});

test('mọi icon của popup đều có trong subset Phosphor (không hiện ô vuông)', () => {
    const iconNames = [...modalSrc.matchAll(/'(ph-duotone ph-[a-z0-9-]+)'/g)].map(match =>
        match[1].replace('ph-duotone ', '')
    );
    assert.ok(iconNames.length >= 5, 'phải khai báo icon cho 5 loại thông báo');
    for (const name of iconNames) {
        assert.ok(
            subsetCss.includes(`.${name}:before`),
            `${name} không có trong public/phosphor-subset.css — chạy "npm run icons" rồi commit font`
        );
    }
});

// ─── 2. CSS ─────────────────────────────────────────────────────────────────
test('CSS tô màu riêng cho từng loại thông báo', () => {
    for (const type of ['success', 'error', 'warning', 'confirm']) {
        assert.ok(
            modalCss.includes(`#popup-modal[data-type="${type}"] .popup-icon`),
            `thiếu quy tắc màu cho data-type="${type}"`
        );
    }
    assert.match(
        modalCss,
        /#popup-modal \.popup-icon\s*\{[^}]*display:\s*flex/s,
        '.popup-icon phải là flex để căn giữa'
    );
});

// ─── 3. Hành vi (chạy modal.js trong sandbox với DOM stub) ──────────────────
function bootModal(overrides = {}) {
    const makeEl = id => {
        // classList có trạng thái thật để kiểm được việc đóng modal (.hidden).
        const classes = new Set(id === 'popup-modal' ? ['modal', 'hidden'] : []);
        const el = {
            id,
            dataset: {},
            innerHTML: '',
            textContent: '',
            className: '',
            disabled: false,
            style: {},
            isConnected: true,
            classList: {
                add: (...names) => names.forEach(name => classes.add(name)),
                remove: (...names) => names.forEach(name => classes.delete(name)),
                contains: name => classes.has(name),
                toggle: (name, force) => {
                    const want = force === undefined ? !classes.has(name) : Boolean(force);
                    if (want) classes.add(name);
                    else classes.delete(name);
                }
            },
            classes,
            addEventListener() {},
            setAttribute() {},
            focus() {},
            closest: () => null,
            getClientRects: () => [{}],
            querySelector: () => null,
            querySelectorAll: () => []
        };
        return el;
    };
    const icon = makeEl('popup-icon');
    const document = {
        activeElement: null,
        body: { classList: { add() {}, remove() {}, contains: () => false } },
        addEventListener() {},
        getElementById: id => (id === 'popup-icon' ? icon : null),
        querySelectorAll: () => [],
        createElement: tag => makeEl(tag)
    };
    const DOM = { popupModal: makeEl('popup-modal'), popupMessage: makeEl('popup-message') };
    const source = modalSrc.replace(/^(?:import |export \{).*;\r?\n/gm, '').replace(/^export /gm, '');
    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        document,
        DOM,
        animateModalOpen() {},
        animateModalClose: overrides.animateModalClose || (async () => {}),
        suspendCelestialCanvas() {},
        resumeCelestialCanvas() {},
        setTimeout: () => 0,
        clearTimeout() {}
    };
    const context = vm.createContext(sandbox);
    vm.runInContext(source, context);
    return { context, DOM, icon, document };
}

test('showPopup gắn data-type + icon đúng cho từng loại', () => {
    const { context, DOM, icon } = bootModal();
    const cases = [
        ['error', 'ph-x-circle'],
        ['success', 'ph-check-circle'],
        ['warning', 'ph-warning-circle'],
        ['info', 'ph-info']
    ];
    for (const [type, expectedIcon] of cases) {
        context.showPopup('Nội dung', type);
        assert.equal(DOM.popupModal.dataset.type, type, `data-type phải là "${type}"`);
        assert.ok(icon.innerHTML.includes(expectedIcon), `${type} phải dùng ${expectedIcon}`);
        assert.equal(DOM.popupMessage.textContent, 'Nội dung', 'nội dung thuần phải đi qua textContent');
    }
});

test('showPopup mặc định là info và chịu được type rác', () => {
    const { context, DOM } = bootModal();
    context.showPopup('không truyền type');
    assert.equal(DOM.popupModal.dataset.type, 'info');

    for (const junk of ['', '   ', 'ERRORRR', null, undefined, 42, {}, '__proto__', 'constructor']) {
        context.showPopup('rác', junk);
        assert.equal(
            DOM.popupModal.dataset.type,
            'info',
            `type rác ${String(junk)} phải rơi về info thay vì tạo data-type lạ`
        );
    }
});

test('showPopup phân biệt HOA/thường và cắt khoảng trắng của type', () => {
    const { context, DOM } = bootModal();
    context.showPopup('x', '  ERROR  ');
    assert.equal(DOM.popupModal.dataset.type, 'error');
});

test('showConfirmation đánh dấu confirm để không bị nhầm là thông báo thường', () => {
    const { context, DOM } = bootModal();
    context.showPopup('thông báo lỗi', 'error');
    assert.equal(DOM.popupModal.dataset.type, 'error');
    context.showConfirmation('Chắc chắn xoá?', () => {});
    assert.equal(DOM.popupModal.dataset.type, 'confirm');
});

test('normalizePopupType không nhận khoá prototype', () => {
    const { context } = bootModal();
    for (const key of ['__proto__', 'prototype', 'constructor', 'toString', 'hasOwnProperty']) {
        assert.equal(
            context.normalizePopupType(key),
            'info',
            `${key} không được trở thành data-type (tránh đọc thuộc tính prototype)`
        );
    }
});

test('closeModal vẫn dọn dẹp khi animation ném lỗi (không để lỗi thoát ra)', async () => {
    const { context, DOM } = bootModal({
        animateModalClose: async () => {
            throw new Error('boom');
        }
    });
    context.openModal(DOM.popupModal);
    assert.equal(DOM.popupModal.classList.contains('hidden'), false, 'modal phải mở');
    await assert.doesNotReject(() => context.closeModal(DOM.popupModal), 'lỗi animation không được thoát ra ngoài');
    assert.equal(DOM.popupModal.classList.contains('hidden'), true, 'vẫn phải ẩn modal dù animation lỗi');
});

test('mở lại modal trong lúc đang đóng ⇒ không bị ẩn oan (chốt generation)', async () => {
    let release;
    const { context, DOM } = bootModal({
        animateModalClose: () => new Promise(resolve => (release = resolve))
    });
    context.openModal(DOM.popupModal);
    const closing = context.closeModal(DOM.popupModal);
    context.openModal(DOM.popupModal); // người dùng mở lại trước khi animation đóng xong
    release();
    await closing;
    assert.equal(
        DOM.popupModal.classList.contains('hidden'),
        false,
        'modal vừa mở lại KHÔNG được bị đóng bởi lần closeModal cũ'
    );
});
