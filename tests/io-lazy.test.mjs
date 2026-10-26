// tests/io-lazy.test.mjs — Hợp đồng của việc tách src/features/io.js ra khỏi entry:
//   1. events.js KHÔNG còn import tĩnh io.js; 2 handler sync-key đi qua dynamic import.
//   2. setupIOEventListeners() idempotent: gọi 2 lần (hoặc qua refreshIoTabUI rồi gọi
//      lại) chỉ gắn ĐÚNG 1 listener cho mỗi nút — bấm 1 lần không chạy 2 lần.
//   3. handleCopySyncKey()/handleApplySyncKey() vẫn gọi được qua đường lazy import.
//
// Chạy trong Node với DOM giả tối thiểu: elements.js chỉ đọc document.getElementById
// một lần lúc import, nên registry dưới đây phải có sẵn trước khi import io.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');

// ─── DOM giả tối thiểu ──────────────────────────────────────────────────────
function makeClassList() {
    const set = new Set();
    return {
        add: (...names) => names.forEach(name => set.add(name)),
        remove: (...names) => names.forEach(name => set.delete(name)),
        contains: (name) => set.has(name),
        toggle: (name, force) => {
            const next = force === undefined ? !set.has(name) : Boolean(force);
            if (next) set.add(name); else set.delete(name);
            return next;
        },
        _set: set,
    };
}

class FakeElement {
    constructor(id = '') {
        this.id = id;
        this.value = '';
        this.textContent = '';
        this.innerHTML = '';
        this.disabled = false;
        this.isConnected = true;
        this.style = {};
        this.dataset = {};
        this.children = [];
        this.focused = false;
        this.selected = false;
        this.classList = makeClassList();
        this.listeners = new Map();
    }
    addEventListener(type, handler) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(handler);
    }
    removeEventListener(type, handler) {
        const list = this.listeners.get(type) || [];
        const index = list.indexOf(handler);
        if (index >= 0) list.splice(index, 1);
    }
    listenerCount(type) { return (this.listeners.get(type) || []).length; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    appendChild(child) { this.children.push(child); return child; }
    get childElementCount() { return this.children.length; }
    setAttribute() {}
    removeAttribute() {}
    closest() { return null; }
    focus() { this.focused = true; }
    select() { this.selected = true; }
    setSelectionRange() {}
}

const registry = new Map();
const fakeDocument = {
    getElementById: (id) => registry.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => new FakeElement(),
    addEventListener() {},
    removeEventListener() {},
    execCommand: () => false,
    body: new FakeElement('body'),
    documentElement: new FakeElement('html'),
    activeElement: null,
    hidden: false,
};
globalThis.document = fakeDocument;
globalThis.localStorage = {
    _data: new Map(),
    getItem(key) { return this._data.has(key) ? this._data.get(key) : null; },
    setItem(key, value) { this._data.set(key, String(value)); },
    removeItem(key) { this._data.delete(key); },
};
globalThis.fetch = async () => { throw new Error('offline (test)'); };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

// Các phần tử mà setupIOEventListeners() phải gắn listener trong bài test này.
for (const id of ['export-btn', 'export-logs-btn', 'clear-all-btn', 'import-file']) {
    registry.set(id, new FakeElement(id));
}

// ─── 1. Hợp đồng tĩnh: io.js đã rời khỏi entry ──────────────────────────────
test('events.js không còn import tĩnh io.js; 2 handler gọi qua dynamic import', () => {
    const events = read('src/events.js');
    assert.doesNotMatch(
        events,
        /import\s*\{[^}]*\}\s*from\s*['"]\.\/features\/io\.js['"]/,
        'events.js không được import tĩnh bất cứ thứ gì từ io.js'
    );
    assert.match(events, /import\(['"]\.\/features\/io\.js['"]\)/, 'phải nạp io.js bằng dynamic import');
    assert.match(events, /module\.handleCopySyncKey\?\.\(\)/, 'handler Copy phải gọi qua module lazy');
    assert.match(
        events,
        /module\.handleApplySyncKey\?\.\(\{ input: applyInput, button: applyBtn, statusElement: statusEl \}\)/,
        'handler Apply phải gọi qua module lazy'
    );
});

test('modal.js nạp io.js động và gắn listener trước khi refresh tab Dữ liệu', () => {
    const modal = read('src/ui/modal.js');
    assert.match(modal, /import\(['"]\.\.\/features\/io\.js['"]\)/);
    assert.match(modal, /m\.setupIOEventListeners\?\.\(\);\s*\n\s*m\.refreshIoTabUI\?\.\(\)/, 'phải setup trước refresh');
    assert.match(modal, /openManageModal[\s\S]*?import\(['"]\.\.\/features\/io\.js['"]\)/, 'mở Hub phải preload io.js');
});

// ─── 2. Runtime: setup idempotent + handler qua lazy import ──────────────────
test('setupIOEventListeners idempotent: refresh + gọi lại 2 lần vẫn chỉ 1 listener/nút', async () => {
    const io = await import('../src/features/io.js');
    assert.equal(typeof io.setupIOEventListeners, 'function');
    assert.equal(typeof io.refreshIoTabUI, 'function');

    // refreshIoTabUI() là đường mà tab Dữ liệu luôn đi qua khi mở panel.
    io.refreshIoTabUI();

    const exportBtn = registry.get('export-btn');
    const exportLogsBtn = registry.get('export-logs-btn');
    const clearAllBtn = registry.get('clear-all-btn');
    const importFile = registry.get('import-file');
    assert.equal(exportBtn.listenerCount('click'), 1, 'refresh phải gắn listener Export');
    assert.equal(exportLogsBtn.listenerCount('click'), 1);
    assert.equal(clearAllBtn.listenerCount('click'), 1, 'refresh phải gắn listener Xoá');
    assert.equal(importFile.listenerCount('change'), 1, 'refresh phải gắn listener Import');

    // Gọi thêm 2 lần nữa (mở/đóng panel, HMR, preload Hub) — không được gắn trùng.
    assert.equal(io.setupIOEventListeners(), false, 'lần 2 phải là no-op');
    assert.equal(io.setupIOEventListeners(), false, 'lần 3 phải là no-op');
    assert.equal(exportBtn.listenerCount('click'), 1, 'Export không được có 2 listener');
    assert.equal(clearAllBtn.listenerCount('click'), 1, 'Xoá không được có 2 listener');
    assert.equal(importFile.listenerCount('change'), 1, 'Import không được có 2 listener');
    assert.equal(io.areIOEventListenersBound(), true);
});

test('handleApplySyncKey gọi được qua dynamic import (đường lazy của events.js)', async () => {
    const io = await import('../src/features/io.js');
    const input = new FakeElement();
    const button = new FakeElement();
    const status = new FakeElement();

    await io.handleApplySyncKey({ input, button, statusElement: status });

    assert.equal(status.textContent, 'Vui lòng nhập mã đồng bộ từ thiết bị khác.');
    assert.equal(input.focused, true, 'ô nhập rỗng phải được focus lại');
});

test('handleCopySyncKey gọi được qua dynamic import và thực thi handler thật', async () => {
    const io = await import('../src/features/io.js');
    const keyInput = new FakeElement('sync-key-input');
    keyInput.value = 'ABCDEFGH12345678';
    const copyBtn = new FakeElement('copy-sync-key-btn');
    registry.set('sync-key-input', keyInput);
    registry.set('copy-sync-key-btn', copyBtn);

    const copied = [];
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { clipboard: { writeText: async (text) => { copied.push(text); } } },
    });
    globalThis.window = { isSecureContext: true };
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = () => 0; // chặn timer reset UI 2,2s giữ tiến trình test
    try {
        await io.handleCopySyncKey();
    } finally {
        globalThis.setTimeout = realSetTimeout;
        delete globalThis.window;
    }

    assert.deepEqual(copied, ['ABCDEFGH12345678'], 'phải ghi đúng mã vào clipboard');
    assert.equal(copyBtn.classList.contains('sync-btn-copied'), true, 'phải có phản hồi UI sau khi chép');
});
