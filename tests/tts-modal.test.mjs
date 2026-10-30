// tests/tts-modal.test.mjs — UI-FIX theo phản hồi người dùng:
//   • header KHÔNG còn <select> trần nào (2 ô TTS cũ đã vào modal);
//   • #shortcuts-menu-btn và .review-cap-control đã bị gỡ (giữ modal phím tắt + pill cap);
//   • nút #tts-settings-btn mở modal #tts-settings-modal trong body;
//   • nút "Nghe thử" phát đúng nguồn/giọng/tốc độ đã chọn (nguồn device = 0 request proxy).
//
// Test tĩnh đọc index.html/src, test hành vi dùng DOM stub tối thiểu (không cần jsdom).
import 'fake-indexeddb/auto';
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initAppDB } from '../src/core/idb.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const html = read('index.html');
const eventsSrc = read('src/events.js');
const ttsFeatureSrc = read('src/features/ttsSettings.js');
const styleSrc = read('src/css/style.css');

const headerHtml = (() => {
    const start = html.indexOf('<header');
    const end = html.indexOf('</header>');
    assert.ok(start >= 0 && end > start, 'không tìm thấy <header> trong index.html');
    return html.slice(start, end);
})();

// ─── 1. Hợp đồng HTML: header gọn, không còn select / nút thừa ──────────────
test('header không còn <select> nào (2 select TTS đã chuyển vào modal)', () => {
    // Bỏ HTML comment để chữ "<select>" trong ghi chú không bị tính là control.
    const headerMarkup = headerHtml.replace(/<!--[\s\S]*?-->/g, '');
    assert.doesNotMatch(headerMarkup, /<select\b/i,
        'header vẫn còn <select> — dropdown trắng của trình duyệt sẽ đè lên thẻ học');
});

test('nút #tts-settings-btn nằm trong menu ⚙ của taskbar (PHASE 5)', () => {
    // PHASE 5: 10 control rời rạc được gom thành 3 tầng; nút Giọng đọc (1 tháng dùng
    // 1 lần) chuyển vào menu "Tùy chỉnh" nhưng GIỮ NGUYÊN id nên sound.js vẫn gắn được.
    const soundIndex = headerHtml.indexOf('id="toggle-sound-btn"');
    const menuIndex = headerHtml.indexOf('id="header-more-menu"');
    const ttsIndex = headerHtml.indexOf('id="tts-settings-btn"');
    assert.ok(soundIndex >= 0, 'thiếu #toggle-sound-btn');
    assert.ok(menuIndex >= 0, 'thiếu #header-more-menu');
    assert.ok(ttsIndex > menuIndex, '#tts-settings-btn phải nằm TRONG menu ⚙');
    const tag = headerHtml.slice(ttsIndex - 60, ttsIndex + 400).match(/<button[^>]*id="tts-settings-btn"[^>]*>/)?.[0] || '';
    assert.match(tag, /class="header-menu-item"/, 'phải là một dòng trong menu');
    assert.match(tag, /title="Giọng đọc &amp; tốc độ"|title="Giọng đọc & tốc độ"/);
    assert.match(tag, /aria-label="Cài đặt giọng đọc và tốc độ"/);
    assert.match(headerHtml, /ph-duotone ph-sliders-horizontal/,
        'icon phải có trong subset Phosphor (ph-sliders không tồn tại trong public/phosphor-subset.css)');
});

test('#shortcuts-menu-btn chỉ còn trong menu ⚙; .review-cap-control đã bị gỡ', () => {
    // PHASE 5: nút Phím tắt trở lại như một MỤC trong menu ⋯. Trước đây nó là tham
    // chiếu chết trong elements.js (không có phần tử) nên không ai mở được modal.
    const occurrences = (html.match(/shortcuts-menu-btn/g) || []).length;
    assert.equal(occurrences, 1, '#shortcuts-menu-btn phải xuất hiện đúng 1 lần');
    assert.ok(html.indexOf('id="shortcuts-menu-btn"') > html.indexOf('id="header-more-menu"'),
        'phải nằm trong menu ⋯');
    assert.doesNotMatch(html, /review-cap-control/, 'vẫn còn .review-cap-control');
    assert.doesNotMatch(html, /max-reviews-per-day/, 'vẫn còn input #max-reviews-per-day');
});

test('giữ modal phím tắt, pill cap và select ẩn tương thích state/sync', () => {
    assert.match(html, /id="shortcuts-modal"/, 'phải GIỮ modal phím tắt (chỉ bỏ nút)');
    assert.match(html, /id="meta-review-cap"/, 'phải GIỮ pill "Còn X lượt ôn hôm nay"');
    assert.match(html, /id="main-topic-filter"/, 'phải giữ select ẩn cho state/sync bộ lọc chủ đề');
    assert.ok(html.indexOf('id="main-topic-filter"') > html.indexOf('</header>'),
        '#main-topic-filter phải nằm NGOÀI header để header không còn select');
});

// ─── 2. Hợp đồng handler: chỉ bỏ nút, giữ phím tắt + logic cap ─────────────
test('events.js: không còn handler của nút phím tắt / ô cap; phím "?" và cap vẫn sống', () => {
    assert.doesNotMatch(eventsSrc, /shortcuts-menu-btn/, 'vẫn còn listener #shortcuts-menu-btn');
    assert.doesNotMatch(eventsSrc, /max-reviews-per-day/, 'vẫn còn handler ô cap');
    // Phím "?" vẫn mở bảng phím tắt.
    assert.match(eventsSrc, /e\.key === '\?'/, 'phím "?" phải còn');
    assert.match(eventsSrc, /openShortcutsModal\(\)/);
    // Cloud merge cap vẫn phải refresh queue/dock dù không còn UI nhập.
    assert.match(eventsSrc, /review-cap:updated/, 'phải giữ listener review-cap:updated');
});

// ─── 3. Code modal: append vào body, đủ control, không đặt trong header ────
test('features/ttsSettings.js: modal append vào body và có đủ control', () => {
    assert.match(ttsFeatureSrc, /body\.appendChild\(modal\)/,
        'modal phải được append vào body (không phải vào header)');
    for (const id of [
        'tts-settings-modal', 'tts-source-select', 'tts-voice-select',
        'tts-rate-select', 'tts-test-btn', 'tts-source-badge',
    ]) {
        assert.ok(ttsFeatureSrc.includes(`'${id}'`), `thiếu control #${id}`);
    }
    assert.match(ttsFeatureSrc, /role', 'dialog'/);
    assert.match(ttsFeatureSrc, /aria-modal', 'true'/);
    assert.match(ttsFeatureSrc, /aria-hidden', 'true'/);
    assert.match(ttsFeatureSrc, /openModal\(modal\)/, 'phải dùng cơ chế modal sẵn có');
    assert.match(ttsFeatureSrc, /closeModal\(modal\)/);
    assert.doesNotMatch(ttsFeatureSrc, /group-utilities/, 'không được gắn vào group header nữa');
});

// ─── 4. CSS: style modal mới nằm trong layer, không !important ──────────────
test('style.css: có rule modal TTS, khoá cuộn nền, không thêm !important', () => {
    const marker = styleSrc.indexOf('UI-FIX — MODAL "GIỌNG ĐỌC & TỐC ĐỘ"');
    assert.ok(marker > 0, 'thiếu khối CSS UI-FIX cho modal TTS');
    // Bắt đầu từ mở comment để strip được cả khối ghi chú, rồi mới kiểm !important.
    const blockStart = styleSrc.lastIndexOf('/*', marker);
    const block = styleSrc.slice(blockStart).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(block, /!important/, 'khối CSS mới không được dùng !important');
    assert.match(block, /#tts-settings-modal \.modal-content/);
    assert.match(block, /body\.modal-active\s*\{[^}]*overflow:\s*hidden/,
        'modal đang mở phải khoá cuộn nền');
    assert.match(block, /@layer base/);
});

// ─── 5. Hành vi: nút "Nghe thử" phát đúng nguồn device (0 request proxy) ────
const spoken = [];
const voices = [
    { voiceURI: 'voice-us', name: 'Samantha', lang: 'en-US' },
    { voiceURI: 'voice-gb', name: 'Daniel', lang: 'en-GB' }
];
const fakeSynth = {
    speak(utterance) { spoken.push(utterance); },
    cancel() {},
    getVoices() { return voices; },
    addEventListener() {}
};
class FakeUtterance {
    constructor(text) { this.text = text; this.lang = ''; this.rate = 1; this.voice = null; }
}
class FakeAudio {
    constructor() { this.paused = true; this.playbackRate = 1; this.currentTime = 0; this.src = ''; }
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
    addEventListener() {}
}
globalThis.window = { speechSynthesis: fakeSynth };
globalThis.SpeechSynthesisUtterance = FakeUtterance;
globalThis.Audio = FakeAudio;
globalThis.fetch = async () => { throw new Error('không được gọi mạng trong test này'); };

const sound = await import('../src/core/sound.js');
const state = await import('../src/core/state.js');

before(async () => { await initAppDB(); });

/** DOM stub tối thiểu: body + một header group rỗng để chứng minh không bị chèn vào. */
function installDomStub() {
    const root = { children: [] };
    let doc = null;
    const all = () => {
        const out = [];
        const walk = node => { for (const child of node.children || []) { out.push(child); walk(child); } };
        walk(root);
        return out;
    };
    const makeEl = (tag) => {
        const el = {
            tagName: String(tag || 'div').toUpperCase(), id: '', className: '', title: '',
            children: [], style: { cssText: '' }, listeners: {}, textContent: '', disabled: false,
            ownerDocument: doc,
            setAttribute(name, value) { el[`attr:${name}`] = value; },
            appendChild(child) { child.parentElement = el; el.children.push(child); return child; },
            removeChild(child) { el.children = el.children.filter(node => node !== child); return child; },
            addEventListener(type, handler) { (el.listeners[type] ||= []).push(handler); },
            fire(type) { (el.listeners[type] || []).forEach(handler => handler({ target: el })); },
            get firstChild() { return el.children[0] || null; },
            get options() { return el.children.filter(child => child.tagName === 'OPTION'); }
        };
        let value = '';
        Object.defineProperty(el, 'value', {
            get() { return value; },
            set(next) {
                const text = String(next ?? '');
                if (el.tagName === 'SELECT' && !el.options.some(option => option.value === text)) { value = ''; return; }
                value = text;
            }
        });
        return el;
    };
    const body = makeEl('body');
    const headerHost = makeEl('div');
    headerHost.id = 'taskbar-menu';
    headerHost.className = 'header-group group-utilities';
    body.appendChild(headerHost);
    root.children.push(body);
    doc = {
        body,
        createElement: tag => { const el = makeEl(tag); el.ownerDocument = doc; return el; },
        getElementById: id => all().find(el => el.id === id) || null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() {}
    };
    for (const el of all()) el.ownerDocument = doc;
    globalThis.document = doc;
    const contains = (parent, child) => {
        for (const node of parent.children || []) {
            if (node === child) return true;
            if (contains(node, child)) return true;
        }
        return false;
    };
    return { doc, body, headerHost, contains };
}

test('nút "Nghe thử" trong modal: nguồn device ⇒ đúng giọng/tốc độ, không request proxy', async () => {
    const dom = installDomStub();
    try {
        let fetches = 0;
        globalThis.fetch = async () => { fetches++; throw new Error('không được gọi proxy'); };
        await state.setTtsSource('device');
        await state.setTtsVoice('voice-gb');
        await state.setTtsRate(0.7);
        sound.resetTtsDiagnostics();
        spoken.length = 0;

        const modal = await sound.mountTtsSettingsUI();
        assert.ok(modal, 'phải mount được modal');
        assert.equal(dom.body.children.includes(modal), true, 'modal phải là con của body');
        assert.equal(dom.headerHost.children.length, 0, 'header không được nhận thêm control nào');
        for (const id of ['tts-source-select', 'tts-voice-select', 'tts-rate-select', 'tts-test-btn', 'tts-source-badge']) {
            const el = dom.doc.getElementById(id);
            assert.ok(el, `thiếu #${id}`);
            assert.ok(dom.contains(modal, el), `#${id} phải nằm trong modal`);
        }
        assert.ok(modal.className.includes('hidden'), 'modal phải đóng lúc mới mount');
        assert.equal(modal['attr:aria-hidden'], 'true');

        dom.doc.getElementById('tts-test-btn').fire('click');
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.equal(fetches, 0, 'nguồn device không được gọi proxy');
        assert.equal(spoken.length, 1, 'phải phát đúng 1 lần');
        assert.equal(spoken[0].text, 'Skeptical', 'nút phải phát đúng từ thử');
        assert.equal(spoken[0].voice.voiceURI, 'voice-gb', 'phải dùng giọng máy đã chọn');
        assert.equal(spoken[0].rate, 0.7, 'phải dùng tốc độ đã chọn');
        assert.equal(dom.doc.getElementById('tts-source-badge').textContent, 'Giọng máy',
            'badge phải hiển thị nguồn vừa phát');
    } finally {
        await state.setTtsSource('cloud');
        globalThis.fetch = async () => { throw new Error('offline'); };
        delete globalThis.document;
    }
});
