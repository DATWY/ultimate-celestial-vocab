// T2.5 — TTS minh bạch: proxy lỗi → fallback giọng máy + chỉ cảnh báo MỘT lần.
// Không cần DOM thật: dùng bộ đếm trong getTtsDiagnostics() + speechSynthesis giả.
import 'fake-indexeddb/auto';
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initAppDB, getSettingFromDB } from '../src/core/idb.js';
import { setTtsRate, setTtsVoice, getTtsSettings, normalizeTtsRate, TTS_RATE_MIN, TTS_RATE_MAX } from '../src/core/state.js';

// ─── Giả lập môi trường trình duyệt TỐI THIỂU ───────────────────────────────
const spoken = [];
const voices = [
    { voiceURI: 'voice-us', name: 'Samantha', lang: 'en-US' },
    { voiceURI: 'voice-gb', name: 'Daniel', lang: 'en-GB' },
    { voiceURI: 'voice-vi', name: 'Linh', lang: 'vi-VN' }
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

/** Mỗi test tự chọn kiểu lỗi mạng/proxy. */
let fetchImpl = async () => { throw new Error('blocked by CSP'); };
globalThis.fetch = (...args) => fetchImpl(...args);

const sound = await import('../src/core/sound.js');

let db = null;
before(async () => {
    db = await initAppDB();
});

/** Chờ microlit: speakText không await phần toast (fire-and-forget). */
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function assertFallbackShape(utterance, { rate, voiceUri = null }) {
    assert.ok(utterance instanceof FakeUtterance, 'phải tạo SpeechSynthesisUtterance');
    assert.equal(utterance.rate, rate);
    if (voiceUri) assert.equal(utterance.voice?.voiceURI, voiceUri);
}

test('proxy lỗi mạng → fallback giọng máy, cảnh báo đúng MỘT lần dù bấm nhiều lần', async () => {
    sound.resetTtsDiagnostics();
    fetchImpl = async () => { throw new Error('blocked by CSP'); };

    await sound.speakText('hello');
    let diag = sound.getTtsDiagnostics();
    assert.equal(spoken.length, 1, 'phải phát bằng giọng máy (Web Speech)');
    assert.equal(diag.proxyFailures, 1);
    assert.equal(diag.fallbackPlays, 1);
    assert.equal(diag.noticesShown, 1, 'cảnh báo đúng 1 lần');
    assert.equal(diag.noticeShown, true);
    assert.equal(diag.lastSource, 'native');
    assert.match(diag.lastError, /CSP/);
    assertFallbackShape(spoken[0], { rate: 1 });

    // Bấm thêm 2 lần nữa: vẫn fallback, nhưng KHÔNG spam cảnh báo.
    await sound.speakText('world');
    await sound.speakText('again');
    diag = sound.getTtsDiagnostics();
    assert.equal(spoken.length, 3);
    assert.equal(diag.proxyFailures, 3);
    assert.equal(diag.fallbackPlays, 3);
    assert.equal(diag.noticesShown, 1, 'không được spam cảnh báo');
});

test('proxy trả HTTP ≠ 200 → cũng coi là lỗi, fallback + cảnh báo 1 lần', async () => {
    sound.resetTtsDiagnostics();
    spoken.length = 0;
    fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });

    await sound.speakText('cloud-failure');
    const diag = sound.getTtsDiagnostics();
    assert.equal(diag.proxyFailures, 1);
    assert.match(diag.lastError, /503/);
    assert.equal(diag.fallbackPlays, 1);
    assert.equal(diag.noticesShown, 1);

    await sound.speakText('second-word');
    assert.equal(sound.getTtsDiagnostics().noticesShown, 1, 'vẫn chỉ 1 cảnh báo cho cả phiên');
});

test('proxy trả JSON có error → cũng fallback (không im lặng)', async () => {
    sound.resetTtsDiagnostics();
    spoken.length = 0;
    fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ error: 'rate limited' }) });

    await sound.speakText('quota');
    const diag = sound.getTtsDiagnostics();
    assert.equal(diag.proxyFailures, 1);
    assert.match(diag.lastError, /rate limited/);
    assert.equal(diag.fallbackPlays, 1);
});

test('tốc độ đọc lấy từ settings: 0.6–1.4 và làm tròn bước 0.1', async () => {
    assert.equal(normalizeTtsRate(9), TTS_RATE_MAX);
    assert.equal(normalizeTtsRate(0), TTS_RATE_MIN);
    assert.equal(normalizeTtsRate('1.24'), 1.2);
    assert.equal(normalizeTtsRate('abc'), 1);

    assert.equal(await setTtsRate(2.5), TTS_RATE_MAX);   // kẹp về 1.4
    assert.equal(await setTtsRate(0.1), TTS_RATE_MIN);   // kẹp về 0.6
    assert.equal(await setTtsRate(1.3), 1.3);

    sound.resetTtsDiagnostics();
    spoken.length = 0;
    fetchImpl = async () => { throw new Error('offline'); };

    await sound.speakText('rate-from-settings');         // không truyền rate → dùng settings
    assert.equal(spoken.at(-1).rate, 1.3);

    await sound.speakText('rate-explicit', 1.1);         // tham số truyền vào được ưu tiên
    assert.equal(spoken.at(-1).rate, 1.1);

    await sound.speakText('rate-clamped', 5);            // tham số cũng bị kẹp
    assert.equal(spoken.at(-1).rate, TTS_RATE_MAX);
});

test('giọng đọc: chọn đúng giọng theo voiceURI, giọng lạ → tự chọn giọng tiếng Anh', async () => {
    sound.resetTtsDiagnostics();
    spoken.length = 0;
    fetchImpl = async () => { throw new Error('offline'); };

    assert.equal(await setTtsVoice('voice-gb'), 'voice-gb');
    await sound.speakText('chosen-voice');
    assert.equal(spoken.at(-1).voice.voiceURI, 'voice-gb');
    assert.equal(spoken.at(-1).lang, 'en-GB', 'lang phải theo giọng đã chọn');

    await setTtsVoice('voice-khong-ton-tai');
    await sound.speakText('unknown-voice');
    assert.equal(spoken.at(-1).voice.voiceURI, 'voice-us', 'fallback: giọng tiếng Anh đầu tiên');

    await setTtsVoice('');
    await sound.speakText('auto-voice');
    assert.equal(spoken.at(-1).voice.voiceURI, 'voice-us');
});

test('cấu hình TTS lưu vào settings hiện có (IndexedDB key ttsSettings)', async () => {
    await setTtsVoice('voice-us');
    await setTtsRate(1.2);
    const saved = await getSettingFromDB('ttsSettings');
    assert.deepEqual(saved, { voice: 'voice-us', rate: 1.2 });
    assert.deepEqual(getTtsSettings(), { voice: 'voice-us', rate: 1.2 });
});

test('danh sách giọng cho UI lấy từ speechSynthesis.getVoices()', () => {
    const list = sound.listTtsVoices();
    assert.equal(list.length, voices.length);
    assert.deepEqual(list[1], { uri: 'voice-gb', name: 'Daniel', lang: 'en-GB' });
    assert.equal(sound.getTtsDiagnostics().voiceCount, voices.length);
});

test('thiết bị không có speechSynthesis → không ném lỗi, báo "không có giọng" 1 lần', async () => {
    sound.resetTtsDiagnostics();
    spoken.length = 0;
    const savedWindow = globalThis.window;
    const savedCtor = globalThis.SpeechSynthesisUtterance;
    globalThis.window = {};
    delete globalThis.SpeechSynthesisUtterance;
    fetchImpl = async () => { throw new Error('offline'); };

    try {
        await sound.speakText('no-tts');
        const diag = sound.getTtsDiagnostics();
        assert.equal(diag.noticesShown, 1);
        assert.equal(diag.fallbackPlays, 0);
        assert.equal(diag.lastSource, 'none');
        await sound.speakText('no-tts-again');
        assert.equal(sound.getTtsDiagnostics().noticesShown, 1, 'không spam');
    } finally {
        globalThis.window = savedWindow;
        globalThis.SpeechSynthesisUtterance = savedCtor;
    }
});

test('TTS đang tắt (soundMode off/sfx) thì không phát và không cảnh báo', async () => {
    const { setSoundMode } = await import('../src/core/state.js');
    sound.resetTtsDiagnostics();
    spoken.length = 0;
    setSoundMode('off');
    try {
        await sound.speakText('silent');
        await tick();
        const diag = sound.getTtsDiagnostics();
        assert.equal(spoken.length, 0);
        assert.equal(diag.noticesShown, 0);
        assert.equal(diag.proxyFailures, 0);
    } finally {
        setSoundMode('all');
    }
});

// ─── Panel cấu hình: DOM tối thiểu (không cần jsdom) ────────────────────────
function installDomStub() {
    const root = { children: [] };
    const all = () => {
        const out = [];
        const walk = node => { for (const child of node.children || []) { out.push(child); walk(child); } };
        walk(root);
        return out;
    };
    const makeEl = (tag) => {
        const el = {
            tagName: String(tag || 'div').toUpperCase(), id: '', className: '', title: '',
            children: [], style: { cssText: '' }, listeners: {}, textContent: '',
            setAttribute(name, value) { el[`attr:${name}`] = value; },
            appendChild(child) { child.parentElement = el; el.children.push(child); return child; },
            append(...nodes) { nodes.forEach(node => el.appendChild(node)); },
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
    const host = makeEl('div');
    host.className = 'header-group group-utilities';
    host.parentElement = root;
    root.children.push(host);
    const doc = {
        createElement: makeEl,
        getElementById: id => all().find(el => el.id === id) || null,
        querySelector: selector => (String(selector).includes('group-utilities') ? host : null),
        addEventListener() {}
    };
    for (const el of all()) el.ownerDocument = doc;
    globalThis.document = doc;
    return { doc, host, fixOwners: () => { for (const el of all()) el.ownerDocument = doc; } };
}

test('panel giọng/tốc độ: gắn vào khối settings có sẵn, nạp option và lưu lựa chọn', async () => {
    const dom = installDomStub();
    try {
        // sound.mountTtsSettingsUI() giờ trả Promise: code dựng DOM của panel đã
        // tách sang chunk lazy src/features/ttsSettings.js (giảm entry bundle),
        // nên phải await trước khi assert. Hợp đồng của test KHÔNG đổi: panel phải
        // nằm TRONG khối settings có sẵn, không tạo container ngoài.
        const group = await sound.mountTtsSettingsUI();
        assert.ok(group, 'phải gắn được vào #taskbar-menu .group-utilities');
        assert.equal(dom.host.children.length, 1, 'không tạo thêm khối ngoài panel settings');
        assert.equal(group.className.includes('header-group'), false, 'không lồng .header-group (CSS mobile sẽ ép width/height)');

        const voiceSelect = dom.doc.getElementById('tts-voice-select');
        const rateSelect = dom.doc.getElementById('tts-rate-select');
        assert.ok(voiceSelect && rateSelect);
        // options được tạo SAU khi append → đồng bộ ownerDocument cho stub
        dom.fixOwners();
        sound.refreshTtsSettingsUI();

        assert.equal(voiceSelect.options.length, 1 + voices.length, 'option "tự động" + mọi giọng máy');
        assert.equal(voiceSelect.options[0].value, '');
        assert.equal(voiceSelect.options[1].value, 'voice-us');
        assert.equal(rateSelect.options.length, 9, '0.6 → 1.4 bước 0.1');
        assert.equal(rateSelect.options[0].value, '0.6');
        assert.equal(rateSelect.options.at(-1).value, '1.4');
        assert.ok(dom.doc.getElementById('tts-source-badge'), 'phải có badge cho biết nguồn giọng');

        await setTtsVoice('voice-gb');
        await setTtsRate(1.2);
        sound.refreshTtsSettingsUI();
        assert.equal(voiceSelect.value, 'voice-gb', 'UI phản ánh đúng giọng đã lưu');
        assert.equal(rateSelect.value, '1.2');

        voiceSelect.value = 'voice-us';
        voiceSelect.fire('change');
        await tick();
        assert.equal(getTtsSettings().voice, 'voice-us', 'đổi giọng trên UI phải lưu vào settings');

        rateSelect.value = '0.8';
        rateSelect.fire('change');
        await tick();
        assert.equal(getTtsSettings().rate, 0.8, 'đổi tốc độ trên UI phải lưu vào settings');
        assert.deepEqual(await getSettingFromDB('ttsSettings'), { voice: 'voice-us', rate: 0.8 });

        await sound.mountTtsSettingsUI();
        assert.equal(dom.host.children.length, 1, 'mount lần 2 không nhân đôi panel');
    } finally {
        delete globalThis.document;
    }
});

