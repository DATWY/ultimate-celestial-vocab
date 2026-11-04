// P17 — Chuyển giao diện (View Transitions + hạt sáng) và âm thanh chuyển cảnh.
// Kiểm ba tầng:
//   1. Toán đường tròn lan + chọn chiến lược (thuần, chạy được không cần DOM).
//   2. Dây nối thật trong events.js / transition.css / sound.js (nếu ai gỡ, test đỏ).
//   3. Tổng hợp âm thanh với AudioContext giả: 'themeWhoosh' tạo buffer source,
//      'undo' tạo hai nốt đi xuống, và chế độ tắt tiếng không tạo voice nào.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    circleRevealRadius, circleRevealPath, originFromElement, pickThemeTransitionStrategy,
    VT_CLASS, BURST_CLASS, VT_DURATION_MS
} from '../src/ui/theme-transition.js';

const read = rel => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

// ─── 1. Phần thuần ────────────────────────────────────────────────────────────
test('P17-1: bán kính đường tròn lan phủ tới góc xa nhất (làm tròn lên)', () => {
    // Tâm giữa 1000×600 → góc xa nhất là (1000,600): hypot(500,300) = 583.09… → 584
    assert.equal(circleRevealRadius(500, 300, 1000, 600), 584);
    // Tâm ở góc trên-trái → phải phủ chéo: hypot(1000,600) = 1166.19… → 1167
    assert.equal(circleRevealRadius(0, 0, 1000, 600), 1167);
    // Không bao giờ nhỏ hơn nửa đường chéo (nếu không sẽ hở góc)
    const half = Math.hypot(1000, 600) / 2;
    assert.ok(circleRevealRadius(500, 300, 1000, 600) >= half);
    // Đầu vào rác không làm NaN
    assert.equal(circleRevealRadius(NaN, undefined, null, undefined), 0);
});

test('P17-2: chuỗi clip-path đúng định dạng CSS và làm tròn toạ độ', () => {
    // 800×600, tâm (120,89): dx = max(120,680) = 680; dy = max(89,511) = 511
    // → hypot(680,511) = 850.6… → làm tròn LÊN 851 (nếu chỉ làm tròn thường sẽ hở góc).
    assert.equal(circleRevealPath(120, 89, 800, 600), 'circle(851px at 120px 89px)');
    assert.equal(circleRevealPath(120.4, 88.6, 800, 600), 'circle(851px at 120px 89px)');
});

test('P17-3: tâm lấy từ nút bấm, kẹp trong khung nhìn, thiếu nút thì giữa màn hình', () => {
    const btn = { getBoundingClientRect: () => ({ left: 100, top: 40, width: 20, height: 10 }) };
    assert.deepEqual(originFromElement(btn, 1000, 800), { x: 110, y: 45 });
    // Nút ở ngoài khung (menu trượt) → kẹp về biên
    const offscreen = { getBoundingClientRect: () => ({ left: 2000, top: 900, width: 10, height: 10 }) };
    assert.deepEqual(originFromElement(offscreen, 1000, 800), { x: 1000, y: 800 });
    // Không có nút / nút 0×0 → giữa màn hình
    assert.deepEqual(originFromElement(null, 1000, 800), { x: 500, y: 400 });
    assert.deepEqual(originFromElement({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }) }, 600, 400), { x: 300, y: 200 });
});

test('P17-4: giảm chuyển động và Boost Mode LUÔN thắng — kể cả khi có View Transitions', () => {
    assert.equal(pickThemeTransitionStrategy({ supportsViewTransition: true, reduceMotion: true, boostMode: false }), 'instant');
    assert.equal(pickThemeTransitionStrategy({ supportsViewTransition: true, reduceMotion: false, boostMode: true }), 'instant');
    assert.equal(pickThemeTransitionStrategy({ supportsViewTransition: true, reduceMotion: true, boostMode: true }), 'instant');
    // Bình thường: có API → view-transition, không có → màn khép dự phòng
    assert.equal(pickThemeTransitionStrategy({ supportsViewTransition: true }), 'view-transition');
    assert.equal(pickThemeTransitionStrategy({ supportsViewTransition: false }), 'curtain');
    // Thiếu tham số cũng không được ném lỗi
    assert.equal(pickThemeTransitionStrategy(), 'curtain');
});

// ─── 2. Dây nối thật ─────────────────────────────────────────────────────────
test('P17-5: events.js dùng đúng chiến lược, tâm nút bấm và âm thanh chuyển cảnh', () => {
    const src = read('src/events.js');
    assert.match(src, /from '\.\/ui\/theme-transition\.js'/, 'phải import module chuyển cảnh');
    assert.match(src, /pickThemeTransitionStrategy\(\{/, 'phải chọn chiến lược thay vì hard-code');
    assert.match(src, /runThemeTransition\(\{/, 'phải chạy đường View Transitions');
    assert.match(src, /originFromElement\(DOM\.toggleDarkModeBtn/, 'tâm đường tròn phải là nút người dùng bấm');
    assert.match(src, /playSound\('themeWhoosh'\)/, 'phải có tiếng "vút" khi bắt đầu chuyển');
    assert.match(src, /playSound\(targetModeIsDark \? 'themeEclipse' : 'themeDawn'\)/, 'phải phát chime đúng chiều');
    assert.match(src, /playSound\('undo'\)/, 'undo phải có âm riêng');
    // Đường màn khép cũ vẫn còn làm dự phòng
    assert.match(src, /curtain-left-closing/, 'thiếu API thì vẫn phải có màn khép dự phòng');
});

test('P17-6: CSS có luật View Transitions, hạt sáng và tôn trọng giảm chuyển động', () => {
    const css = read('src/css/transition.css');
    assert.match(css, /::view-transition-new\(root\)/, 'phải tạo hoạt ảnh cho lớp giao diện mới');
    assert.match(css, /@keyframes theme-vt-reveal/, 'thiếu keyframes mở đường tròn');
    assert.match(css, /clip-path: circle\(0px at var\(--theme-vt-x/, 'đường tròn phải bắt đầu từ tâm nút');
    assert.match(css, new RegExp(`\\.${BURST_CLASS}`), 'thiếu lớp hạt sáng');
    assert.match(css, /@keyframes theme-vt-spark/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,220}theme-burst[\s\S]{0,80}display: none/, 'giảm chuyển động phải tắt hạt sáng');
    assert.equal(VT_CLASS, 'theme-vt-run');
    assert.ok(VT_DURATION_MS >= 400 && VT_DURATION_MS <= 900, 'thời lượng chuyển cảnh phải đủ thấy nhưng không lê');
});

test('P17-7: sound.js có voice cho themeWhoosh/undo và đuôi lấp lánh cho hai chime', () => {
    const src = read('src/core/sound.js');
    assert.match(src, /case 'themeWhoosh':/);
    assert.match(src, /case 'undo':/);
    assert.match(src, /const addShimmer = /);
    assert.match(src, /addShimmer\(now \+ 0\.18/, 'themeEclipse phải có shimmer');
    assert.match(src, /addGlide\(now, 660, 1320/, 'themeDawn phải có glissando');
});

// ─── 3. Tổng hợp âm thanh với AudioContext giả ──────────────────────────────
const made = { osc: 0, buffer: 0, filters: 0 };

class Param {
    constructor(v = 0) { this.value = v; }
    setValueAtTime(v) { this.value = v; return this; }
    linearRampToValueAtTime(v) { this.value = v; return this; }
    exponentialRampToValueAtTime(v) { this.value = v; return this; }
    cancelScheduledValues() { return this; }
}

class FakeCtx {
    constructor() {
        this.currentTime = 0;
        this.sampleRate = 48000;
        this.state = 'running';
        this.destination = { connect() {} };
    }
    resume() { return Promise.resolve(); }
    createGain() { return { gain: new Param(1), connect() {} }; }
    createOscillator() {
        made.osc++;
        return { type: 'sine', frequency: new Param(), detune: new Param(), connect() {}, start() {}, stop() {}, onended: null };
    }
    createBiquadFilter() { made.filters++; return { type: 'lowpass', frequency: new Param(), Q: new Param(), gain: new Param(), connect() {} }; }
    createDynamicsCompressor() {
        return { threshold: new Param(), knee: new Param(), ratio: new Param(), attack: new Param(), release: new Param(), connect() {} };
    }
    createBuffer(ch, frames) { made.buffer++; return { getChannelData: () => new Float32Array(frames) }; }
    createBufferSource() { return { buffer: null, connect() {}, start() {}, stop() {}, onended: null }; }
    createDelay() { return { delayTime: new Param(), connect() {} }; }
}

globalThis.window = {
    AudioContext: FakeCtx,
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
};
globalThis.document = {
    addEventListener() {}, removeEventListener() {},
    visibilityState: 'visible', hidden: false,
    documentElement: { style: { setProperty() {}, removeProperty() {} }, classList: { add() {}, remove() {}, contains: () => false } },
    body: { classList: { add() {}, remove() {}, contains: () => false }, appendChild() {} },
    createElement: () => ({ style: { setProperty() {} }, setAttribute() {}, appendChild() {}, classList: { add() {} } }),
    querySelector: () => null, getElementById: () => null
};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { playSound, applySoundMode } = await import('../src/core/sound.js');
const { getState, setSoundMode } = await import('../src/core/state.js');

test('P17-8: themeWhoosh tổng hợp bằng buffer nhiễu, không cần file âm thanh', () => {
    applySoundMode('all');
    made.osc = 0; made.buffer = 0; made.filters = 0;
    playSound('themeWhoosh');
    assert.equal(getState().soundMode, 'all');
    assert.ok(made.buffer >= 1, 'phải tạo AudioBuffer cho nhiễu');
    assert.ok(made.filters >= 1, 'phải lọc bandpass để thành tiếng "vút"');
});

test('P17-9: undo phát hai nốt đi xuống; tắt tiếng thì không tạo voice nào', () => {
    applySoundMode('all');
    made.osc = 0;
    playSound('undo');
    assert.ok(made.osc >= 2, `undo phải có ≥2 oscillator, thực tế ${made.osc}`);

    setSoundMode('off');
    applySoundMode('off');
    made.osc = 0; made.buffer = 0;
    playSound('undo');
    playSound('themeWhoosh');
    assert.equal(made.osc, 0, 'chế độ off không được tạo oscillator');
    assert.equal(made.buffer, 0, 'chế độ off không được tạo buffer');
    setSoundMode('all');
    applySoundMode('all');
});
