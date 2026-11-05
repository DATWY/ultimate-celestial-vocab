// T2.5 — TTS minh bạch: proxy lỗi → fallback giọng máy + chỉ cảnh báo MỘT lần.
// UI-FIX — thêm nguồn giọng ('cloud' | 'device'): chọn 'device' thì KHÔNG gọi
// proxy, phát thẳng bằng Web Speech đúng giọng/tốc độ đã chọn.
// Không cần DOM thật: dùng bộ đếm trong getTtsDiagnostics() + speechSynthesis giả.
import 'fake-indexeddb/auto';
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initAppDB, getSettingFromDB, saveSettingToDB } from '../src/core/idb.js';
import { setTtsRate, setTtsVoice, setTtsSource, getTtsSettings, loadTtsSettings, getState, normalizeTtsRate, TTS_RATE_MIN, TTS_RATE_MAX } from '../src/core/state.js';

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

before(async () => {
    await initAppDB();
});

/** Chờ microlit: speakText không await phần toast (fire-and-forget). */
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * Chờ có điều kiện. Handler của modal lưu settings qua IndexedDB rồi mới
 * refresh UI (setTtsSource(...).then(refresh)); fake-indexeddb hoàn tất ở
 * macrotask nên `await tick()` một lần là KHÔNG đủ — đo được flake 1/12 lần
 * chạy khi chạy song song cả bộ test.
 */
const waitUntil = async (predicate, { timeout = 3000, step = 10 } = {}) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
        if (predicate()) return true;
        await new Promise(resolve => setTimeout(resolve, step));
    }
    return false;
};

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
    await setTtsSource('cloud');
    await setTtsVoice('voice-us');
    await setTtsRate(1.2);
    const saved = await getSettingFromDB('ttsSettings');
    assert.deepEqual(saved, { voice: 'voice-us', rate: 1.2, source: 'cloud' });
    assert.deepEqual(getTtsSettings(), { voice: 'voice-us', rate: 1.2, source: 'cloud' });
});

// ─── UI-FIX: nguồn giọng 'device' vs 'cloud' ───────────────────────────────
test("nguồn 'device': KHÔNG gọi proxy, phát thẳng giọng máy đúng giọng + tốc độ", async () => {
    let fetches = 0;
    fetchImpl = async () => { fetches++; throw new Error('không được gọi proxy'); };
    sound.resetTtsDiagnostics();
    spoken.length = 0;
    await setTtsSource('device');
    await setTtsVoice('voice-gb');
    await setTtsRate(0.9);
    try {
        await sound.speakText('skeptical');
        assert.equal(fetches, 0, 'nguồn device không được fetch proxy');
        assert.equal(spoken.length, 1);
        assert.equal(spoken[0].text, 'skeptical');
        assert.equal(spoken[0].voice.voiceURI, 'voice-gb', 'phải dùng đúng giọng máy đã chọn');
        assert.equal(spoken[0].rate, 0.9);
        const diag = sound.getTtsDiagnostics();
        assert.equal(diag.proxyFailures, 0);
        assert.equal(diag.lastSource, 'native');

        // Preload nền cũng không được đụng proxy khi người dùng chọn offline.
        await sound.preloadAudio('another-word');
        assert.equal(fetches, 0, 'preloadAudio phải bỏ qua khi nguồn device');
    } finally {
        await setTtsSource('cloud');
    }
});

test("nguồn 'device': đổi giọng máy → lần phát KẾ TIẾP dùng đúng giọng mới", async () => {
    let fetches = 0;
    fetchImpl = async () => { fetches++; throw new Error('không được gọi proxy'); };
    sound.resetTtsDiagnostics();
    spoken.length = 0;
    await setTtsSource('device');
    try {
        await setTtsVoice('voice-us');
        await sound.speakText('first');
        assert.equal(spoken.at(-1).voice.voiceURI, 'voice-us');

        await setTtsVoice('voice-gb');
        await sound.speakText('second');
        assert.equal(spoken.at(-1).voice.voiceURI, 'voice-gb', 'đổi giọng phải có tác dụng ở lần phát kế tiếp');
        assert.equal(fetches, 0);
        assert.equal(spoken.length, 2);
    } finally {
        await setTtsSource('cloud');
    }
});

test("nguồn 'cloud': vẫn thử proxy trước như cũ, lỗi mới fallback giọng máy", async () => {
    let fetches = 0;
    fetchImpl = async () => { fetches++; throw new Error('offline'); };
    sound.resetTtsDiagnostics();
    spoken.length = 0;
    await setTtsSource('cloud');
    await setTtsVoice('voice-us');
    await sound.speakText('cloud-first');
    assert.equal(fetches, 1, 'nguồn cloud phải đi qua proxy trước');
    assert.equal(spoken.length, 1, 'proxy lỗi ⇒ fallback giọng máy');
    assert.equal(sound.getTtsDiagnostics().proxyFailures, 1);
});

test("ttsSettings cũ thiếu 'source' vẫn đọc được (⇒ cloud); source rác cũng về cloud", async () => {
    await saveSettingToDB('ttsSettings', { voice: 'voice-us', rate: 1.1 });
    await loadTtsSettings();
    assert.deepEqual(getTtsSettings(), { voice: 'voice-us', rate: 1.1, source: 'cloud' });
    assert.equal(getState().ttsSource, 'cloud');

    await saveSettingToDB('ttsSettings', { voice: '', rate: 1, source: 'rác' });
    await loadTtsSettings();
    assert.equal(getTtsSettings().source, 'cloud');

    await saveSettingToDB('ttsSettings', { voice: '', rate: 1, source: 'device' });
    await loadTtsSettings();
    assert.equal(getTtsSettings().source, 'device');
    assert.equal(getState().ttsSource, 'device', 'getState() phải thấy live binding mới');
    await setTtsSource('cloud');
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

// ─── Modal cấu hình: DOM tối thiểu (không cần jsdom) ────────────────────────
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
            children: [], style: { cssText: '' }, listeners: {}, textContent: '',
            ownerDocument: doc,
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
    const body = makeEl('body');
    const host = makeEl('div');
    host.id = 'taskbar-menu';
    host.className = 'header-group group-utilities';
    body.appendChild(host);
    root.children.push(body);
    doc = {
        body,
        createElement: tag => { const el = makeEl(tag); el.ownerDocument = doc; return el; },
        getElementById: id => all().find(el => el.id === id) || null,
        querySelector: selector => (String(selector).includes('group-utilities') ? host : null),
        querySelectorAll: () => [],
        addEventListener() {}
    };
    for (const el of all()) el.ownerDocument = doc;
    globalThis.document = doc;
    return { doc, body, host };
}

/** Đi xuống cây con của stub để kiểm "control nằm TRONG modal". */
function stubContains(parent, child) {
    for (const node of parent.children || []) {
        if (node === child) return true;
        if (stubContains(node, child)) return true;
    }
    return false;
}

test('modal giọng/tốc độ: dựng trong body, đủ 3 select + badge, đổi là lưu', async () => {
    const dom = installDomStub();
    const fetchBefore = fetchImpl;
    try {
        const modal = await sound.mountTtsSettingsUI();
        assert.ok(modal, 'phải mount được modal cài đặt');
        assert.equal(modal.id, 'tts-settings-modal');
        assert.equal(dom.body.children.includes(modal), true, 'modal phải append trực tiếp vào body');
        assert.equal(dom.host.children.length, 0, 'header KHÔNG còn control TTS nào');

        const voiceSelect = dom.doc.getElementById('tts-voice-select');
        const rateSelect = dom.doc.getElementById('tts-rate-select');
        const sourceSelect = dom.doc.getElementById('tts-source-select');
        assert.ok(voiceSelect && rateSelect && sourceSelect, 'phải có đủ nguồn/giọng/tốc độ');
        for (const control of [voiceSelect, rateSelect, sourceSelect]) {
            assert.ok(stubContains(modal, control), `${control.id} phải nằm TRONG modal`);
        }
        const hint = dom.doc.getElementById('tts-voice-hint');
        assert.ok(hint, 'phải có hint giải thích nguồn giọng');

        await setTtsSource('cloud');
        await setTtsVoice('');
        await setTtsRate(1.0);
        sound.refreshTtsSettingsUI();

        assert.deepEqual(sourceSelect.options.map(option => option.value), ['cloud', 'device']);
        assert.equal(sourceSelect.value, 'cloud');
        assert.equal(voiceSelect.disabled, true, 'nguồn cloud ⇒ giọng máy bị vô hiệu hoá');
        assert.match(hint.textContent, /giọng Cloud/i);
        assert.equal(voiceSelect.options.length, 1 + voices.length, 'option "tự động" + mọi giọng máy');
        assert.equal(voiceSelect.options[0].value, '');
        assert.equal(voiceSelect.options[1].value, 'voice-us');
        assert.equal(rateSelect.options.length, 9, '0.6 → 1.4 bước 0.1');
        assert.equal(rateSelect.options[0].value, '0.6');
        assert.equal(rateSelect.options.at(-1).value, '1.4');
        assert.ok(dom.doc.getElementById('tts-source-badge'), 'phải có badge cho biết nguồn giọng');
        assert.ok(dom.doc.getElementById('tts-test-btn'), 'phải có nút Nghe thử');

        // Đổi nguồn sang giọng máy: select giọng mở khoá, settings lưu ngay.
        sourceSelect.value = 'device';
        sourceSelect.fire('change');
        await waitUntil(() => getTtsSettings().source === 'device' && voiceSelect.disabled === false);
        assert.equal(getTtsSettings().source, 'device', 'đổi nguồn phải lưu vào settings');
        assert.equal(voiceSelect.disabled, false, 'nguồn device ⇒ chọn giọng được');
        assert.match(hint.textContent, /giọng máy/i);

        voiceSelect.value = 'voice-gb';
        voiceSelect.fire('change');
        await waitUntil(() => getTtsSettings().voice === 'voice-gb');
        assert.equal(getTtsSettings().voice, 'voice-gb', 'đổi giọng trên UI phải lưu vào settings');

        rateSelect.value = '1.2';
        rateSelect.fire('change');
        await waitUntil(() => getTtsSettings().rate === 1.2);
        assert.equal(getTtsSettings().rate, 1.2, 'đổi tốc độ trên UI phải lưu vào settings');
        assert.deepEqual(await getSettingFromDB('ttsSettings'), { voice: 'voice-gb', rate: 1.2, source: 'device' });

        // Đúng lỗi người dùng báo: đổi giọng máy phải nghe thấy ở lần phát kế tiếp.
        let fetches = 0;
        fetchImpl = async () => { fetches++; throw new Error('không được gọi proxy'); };
        sound.resetTtsDiagnostics();
        spoken.length = 0;
        await sound.speakText('skeptical');
        assert.equal(fetches, 0, 'nguồn device không được gọi proxy');
        assert.equal(spoken.at(-1).voice.voiceURI, 'voice-gb');
        assert.equal(spoken.at(-1).rate, 1.2);

        // Mount lần 2 không nhân đôi modal.
        const again = await sound.mountTtsSettingsUI();
        assert.equal(again, modal);
        assert.equal(dom.body.children.filter(el => el.id === 'tts-settings-modal').length, 1);
        await setTtsSource('cloud');
    } finally {
        fetchImpl = fetchBefore;
        delete globalThis.document;
    }
});