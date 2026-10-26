#!/usr/bin/env node
/**
 * tools/visual_snapshot.mjs — harness ảnh chụp pixel cho T3.2 / T4.3.
 *
 * Chụp 8 trạng thái UI thật ở 4 viewport bằng Chrome headless + CDP:
 *   empty, card-front, card-back, hub-overview, hub-words, hub-io,
 *   tts-panel, light
 *
 * Baseline (trước khi sửa CSS):
 *   node tools/visual_snapshot.mjs --out reports/visual/before --with-notch
 *
 * Sau khi sửa CSS:
 *   node tools/visual_snapshot.mjs --out reports/visual/after --with-notch
 *
 * So sánh:
 *   node tools/visual_snapshot.mjs --compare reports/visual/before reports/visual/after --exclude=-notch-
 *
 * Ghi chú:
 * - Không dùng Playwright/sharp/pngjs. PNG được decode byte-level bằng zlib của
 *   Node (hỗ trợ PNG 8-bit RGB/RGBA/palette, không interlace — đúng định dạng
 *   Page.captureScreenshot của Chrome).
 * - Mỗi ảnh có sidecar .json chứa rect + computedStyle của danh sách selector
 *   cố định và audit vùng safe-area (khi chụp bằng --with-notch).
 * - Ảnh được chụp ở DPR=1 đúng kích thước viewport. Canvas nền động, toast,
 *   curtain và mọi animation/transition bị đóng băng bằng một style tiêm sau
 *   khi UI đã ổn định; mọi trạng thái khác đều do thao tác UI thật.
 * - Nút Đồng bộ Cloud có timer mạng 2,5-4 s (đang đồng bộ / thành công / lỗi).
 *   Harness đưa riêng icon này về pose idle trước mỗi frame để ảnh không phụ
 *   thuộc tốc độ Firebase. Đây là state mạng, không phải state giao diện T3.2.
 * - Ảnh được chụp lặp 2 lần liên tiếp trong cùng page và chỉ nhận khi 2 frame
 *   byte-identical. Chrome software raster vẫn có thể lệch ±1 level màu giữa
 *   hai process ở một số cao độ fractional; khi gặp, chạy lại đúng viewport
 *   (cùng build) để lấy raster variant ổn định — không sửa CSS/ảnh.
 * - `--with-notch` chỉ chụp thêm 844x390 với safe-area giả lập qua CDP
 *   (`Emulation.setSafeAreaInsetsOverride`), không thay đổi 32 ảnh chuẩn.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const args = process.argv.slice(2);
const hasFlag = (name) => args.includes('--' + name);
const argValue = (name, fallback = null) => {
    const withEquals = args.find((value) => value.startsWith(`--${name}=`));
    if (withEquals) return withEquals.slice(name.length + 3);
    const i = args.indexOf('--' + name);
    if (i === -1) return fallback;
    const v = args[i + 1];
    return v && !v.startsWith('--') ? v : true;
};

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEFAULT_VIEWPORTS = [
    { name: '1440x900', width: 1440, height: 900, mobile: false, orientation: null },
    { name: '390x844', width: 390, height: 844, mobile: true, orientation: { type: 'portraitPrimary', angle: 0 } },
    { name: '320x568', width: 320, height: 568, mobile: true, orientation: { type: 'portraitPrimary', angle: 0 } },
    { name: '844x390', width: 844, height: 390, mobile: true, orientation: { type: 'landscapePrimary', angle: 90 } },
];
const NOTCH_VIEWPORT = {
    name: '844x390',
    width: 844,
    height: 390,
    mobile: true,
    orientation: { type: 'landscapePrimary', angle: 90 },
    insets: { top: 0, right: 59, bottom: 21, left: 59 },
};
const STATES = [
    'empty',
    'card-front',
    'card-back',
    'hub-overview',
    'hub-words',
    'hub-io',
    'tts-panel',
    'light',
];

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg',
    '.woff2': 'font/woff2',
    '.webmanifest': 'application/manifest+json',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CDP {
    constructor(wsUrl) {
        this.ws = new globalThis.WebSocket(wsUrl);
        this.id = 1;
        this.pending = new Map();
        this.listeners = new Map();
    }
    init() {
        return new Promise((resolve, reject) => {
            this.ws.onopen = resolve;
            this.ws.onerror = reject;
            this.ws.onmessage = (event) => {
                const message = JSON.parse(event.data);
                if (message.id && this.pending.has(message.id)) {
                    const { resolve: done, reject: fail } = this.pending.get(message.id);
                    this.pending.delete(message.id);
                    if (message.error) fail(new Error(message.error.message));
                    else done(message.result);
                } else if (message.method) {
                    for (const listener of this.listeners.get(message.method) || []) listener(message.params);
                }
            };
        });
    }
    on(method, listener) {
        if (!this.listeners.has(method)) this.listeners.set(method, []);
        this.listeners.get(method).push(listener);
    }
    send(method, params = {}) {
        const id = this.id++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }
    async eval(expression) {
        const result = await this.send('Runtime.evaluate', {
            expression: `(async () => { ${expression} })()`,
            awaitPromise: true,
            returnByValue: true,
            userGesture: true,
        });
        if (result.exceptionDetails) {
            throw new Error(
                result.exceptionDetails.text + ' ' +
                (result.exceptionDetails.exception?.description || ''),
            );
        }
        return result.result?.value;
    }
    close() {
        try { this.ws.close(); } catch {}
    }
}

function makeStaticServer(rootDir) {
    const server = http.createServer((request, response) => {
        let pathname;
        try {
            pathname = decodeURIComponent((request.url || '/').split('?')[0]);
        } catch {
            response.writeHead(400); response.end('Bad request'); return;
        }
        if (pathname === '/') pathname = '/index.html';
        const target = path.resolve(rootDir, '.' + pathname);
        if (!target.startsWith(rootDir + path.sep)) {
            response.writeHead(403); response.end('Forbidden'); return;
        }
        if (fs.existsSync(target) && fs.statSync(target).isFile()) {
            response.writeHead(200, {
                'Content-Type': MIME[path.extname(target)] || 'application/octet-stream',
                'Cache-Control': 'no-store',
            });
            fs.createReadStream(target).pipe(response);
        } else {
            // SPA fallback giống hosting thật.
            const fallback = path.join(rootDir, 'index.html');
            response.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
            fs.createReadStream(fallback).pipe(response);
        }
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            resolve({ server, port: server.address().port });
        });
    });
}

async function startChrome() {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'celestial-visual-'));
    const chrome = spawn(CHROME, [
        '--headless=new',
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--no-sandbox',
        '--hide-scrollbars',
        '--mute-audio',
        '--disable-extensions',
        '--disable-sync',
        '--force-device-scale-factor=1',
        '--force-color-profile=srgb',
        '--font-render-hinting=none',
        '--disable-lcd-text',
        '--disable-gpu',
        '--disable-accelerated-2d-canvas',
        '--disable-partial-raster',
        '--num-raster-threads=1',
        '--disable-skia-runtime-opts',
        '--disable-features=SkiaGraphite',
        '--run-all-compositor-stages-before-draw',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        'about:blank',
    ], { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true });

    const activePortFile = path.join(userDataDir, 'DevToolsActivePort');
    let browserPort = null;
    for (let attempt = 0; attempt < 120; attempt++) {
        if (fs.existsSync(activePortFile)) {
            const lines = fs.readFileSync(activePortFile, 'utf8').trim().split(/\r?\n/);
            if (lines[0]) { browserPort = Number(lines[0]); break; }
        }
        if (chrome.exitCode !== null) break;
        await sleep(100);
    }
    if (!browserPort) {
        chrome.kill();
        throw new Error('Chrome headless không mở được DevToolsActivePort');
    }

    let wsUrl = null;
    for (let attempt = 0; attempt < 100; attempt++) {
        try {
            const list = await (await fetch(`http://127.0.0.1:${browserPort}/json/list`)).json();
            const page = list.find((item) => item.type === 'page');
            if (page) { wsUrl = page.webSocketDebuggerUrl; break; }
        } catch {}
        await sleep(100);
    }
    if (!wsUrl) {
        chrome.kill();
        throw new Error('Chrome headless không có page target');
    }
    return { chrome, userDataDir, browserPort, wsUrl };
}

async function waitFor(c, expression, timeoutMs = 15000, label = 'điều kiện UI') {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        try {
            if (await c.eval(expression)) return true;
        } catch {}
        await sleep(80);
    }
    throw new Error(`Timeout chờ ${label}`);
}

async function click(c, selector, waitMs = 300) {
    const clicked = await c.eval(`
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.click();
        return true;
    `);
    if (!clicked) throw new Error(`Không tìm thấy để click: ${selector}`);
    await sleep(waitMs);
}

async function setValue(c, selector, value) {
    await c.eval(`
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('missing ${selector.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}');
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    `);
    await sleep(80);
}

async function applyDeviceMetrics(c, viewport, insets = null) {
    const metrics = {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: viewport.mobile,
        screenWidth: viewport.width,
        screenHeight: viewport.height,
        dontSetVisibleSize: false,
    };
    if (viewport.orientation) metrics.screenOrientation = viewport.orientation;
    await c.send('Emulation.setDeviceMetricsOverride', metrics);
    await c.send('Emulation.setTouchEmulationEnabled', {
        enabled: Boolean(viewport.mobile),
        maxTouchPoints: viewport.mobile ? 5 : 1,
    });
    if (insets) await c.send('Emulation.setSafeAreaInsetsOverride', { insets });
    else await c.send('Emulation.setSafeAreaInsetsOverride', { insets: {} });
}

async function resetApp(c, origin, viewport, insets) {
    await applyDeviceMetrics(c, viewport, insets);
    // Nạp origin một lần để Storage.clearDataForOrigin có security origin hợp lệ,
    // kể cả ở lần chạy đầu tiên với profile Chrome hoàn toàn mới.
    await c.send('Page.navigate', { url: `${origin}/?theme=dark&bootstrap=1` });
    await sleep(700);
    await c.send('Storage.clearDataForOrigin', {
        origin,
        storageTypes: 'all',
    });
    await c.send('Page.navigate', { url: `${origin}/?theme=dark&shot=${Date.now()}` });
    await waitFor(
        c,
        `return document.readyState === 'complete' && document.body?.classList.contains('app-ready');`,
        25000,
        'app-ready',
    );
    await c.eval(`await document.fonts?.ready; return true;`);
    // Nút đồng bộ có pulse/class tạm thời sau khi lưu dữ liệu. Chờ nó tắt để
    // ảnh không phụ thuộc việc Firebase phản hồi nhanh hay chậm.
    await waitFor(c, `return !document.getElementById('manual-sync-btn')?.classList.contains('syncing-active');`, 9000, 'sync idle')
        .catch(() => {});
    // Chờ các count-up/JS animation ngắn của app kết thúc. CSS animation đã bị
    // tắt sau bước dưới, nhưng JS có thể đang cập nhật số liệu bằng rAF.
    await sleep(1800);
    await c.eval(`
        if (document.getElementById('__visual_stable__')) return true;
        document.getElementById('toast-container')?.replaceChildren();
        const style = document.createElement('style');
        style.id = '__visual_stable__';
        style.textContent = \`
            #toast-container,
            #global-celebrate-canvas,
            #victory-confetti-canvas,
            .shipper-curtain-container,
            #celestial-canvas {
                display: none !important;
                visibility: hidden !important;
            }
            *, *::before, *::after {
                animation: none !important;
                transition: none !important;
                caret-color: transparent !important;
                scroll-behavior: auto !important;
            }
            html { scrollbar-width: none !important; }
            ::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
        \`;
        document.head.appendChild(style);
        return true;
    `);
    await sleep(250);
}

const DOM_SPEC = [
    { selector: 'html', max: 1 },
    { selector: 'body', max: 1 },
    { selector: '#app-container', max: 1 },
    { selector: 'header.app-header', max: 1 },
    { selector: '.brand-container', max: 1 },
    { selector: '.brand-title', max: 1 },
    { selector: '#toggle-taskbar-btn', max: 1 },
    { selector: '#taskbar-menu', max: 1 },
    { selector: '.settings-controls', max: 1 },
    { selector: '.group-filter', max: 1 },
    { selector: '.group-actions', max: 1 },
    { selector: '.group-utilities', max: 1 },
    { selector: '#tts-settings-group', max: 1 },
    { selector: '#tts-voice-select', max: 1 },
    { selector: '#tts-rate-select', max: 1 },
    { selector: '#main-flashcard-view', max: 1 },
    { selector: '#flashcard-area', max: 1 },
    { selector: '#flashcard', max: 1 },
    { selector: '.card-front', max: 1 },
    { selector: '.card-back', max: 1 },
    { selector: '#card-english', max: 1 },
    { selector: '.card-back-content', max: 1 },
    { selector: '#reveal-btn', max: 1 },
    { selector: '#srs-feedback-buttons', max: 1 },
    { selector: '.srs-btn', max: 4 },
    { selector: '#stats-area', max: 1 },
    { selector: '.celestial-stats-dock', max: 1 },
    { selector: '.dock-chips-row', max: 1 },
    { selector: '.review-cap-control', max: 1 },
    { selector: '#manage-modal', max: 1 },
    { selector: '.manage-panel', max: 1 },
    { selector: '.manage-panel-header', max: 1 },
    { selector: '.manage-nav-tabs', max: 1 },
    { selector: '.manage-nav-tab', max: 4 },
    { selector: '#profile-view-overview', max: 1 },
    { selector: '.streak-bento-card', max: 1 },
    { selector: '#activity-heatmap-card', max: 1 },
    { selector: '#review-forecast-card', max: 1 },
    { selector: '.fusionsrs-bento-section', max: 1 },
    { selector: '#manage-view-words', max: 1 },
    { selector: '#manage-view-io', max: 1 },
    { selector: '.word-card', max: 2 },
    { selector: '.io-clean-card', max: 2 },
    { selector: '#empty-onboarding-container', max: 1 },
    { selector: '#no-card-message', max: 1 },
    { selector: '#toggle-dark-mode-btn', max: 1 },
    { selector: '#celestial-hub-btn', max: 1 },
    { selector: '#start-quiz-btn', max: 1 },
    { selector: '#manage-modal .modal-close-btn', max: 1 },
    { selector: '#toast-container', max: 1 },
    { selector: '#celestial-canvas', max: 1 },
];

const COMPUTED_PROPS = [
    'display', 'visibility', 'position', 'top', 'right', 'bottom', 'left',
    'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'marginTop', 'marginBottom',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'borderRadius', 'color', 'backgroundColor', 'backgroundImage', 'boxShadow',
    'opacity', 'transform', 'zIndex', 'fontFamily', 'fontSize', 'fontWeight',
    'lineHeight', 'letterSpacing', 'gap', 'flexDirection', 'alignItems',
    'justifyContent', 'gridTemplateColumns', 'overflowX', 'overflowY',
    'pointerEvents', 'scrollbarWidth',
];

const SAFE_AUDIT_SELECTORS = [
    'header.app-header',
    '.brand-container',
    '#toggle-taskbar-btn',
    '#taskbar-menu',
    '.settings-controls',
    '#tts-settings-group',
    '#tts-voice-select',
    '#tts-rate-select',
    '#main-flashcard-view',
    '#flashcard',
    '#srs-feedback-buttons',
    '.srs-btn',
    '#stats-area',
    '.celestial-stats-dock',
    '.manage-panel',
    '.manage-panel-header',
    '.manage-nav-tabs',
    '.manage-nav-tab',
    '#manage-modal .modal-close-btn',
    '.io-clean-card',
    '#empty-onboarding-container',
    '.onboarding-cta-card',
];

function collectDomExpression(insets) {
    return `
        const rectOf = (el) => {
            const r = el.getBoundingClientRect();
            return {
                x: +r.x.toFixed(2), y: +r.y.toFixed(2),
                width: +r.width.toFixed(2), height: +r.height.toFixed(2),
                top: +r.top.toFixed(2), right: +r.right.toFixed(2),
                bottom: +r.bottom.toFixed(2), left: +r.left.toFixed(2),
            };
        };
        const probe = document.createElement('div');
        probe.id = '__visual_safe_probe__';
        probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;' +
            'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);';
        document.documentElement.appendChild(probe);
        const probeStyle = getComputedStyle(probe);
        const safeArea = {
            top: parseFloat(probeStyle.paddingTop) || 0,
            right: parseFloat(probeStyle.paddingRight) || 0,
            bottom: parseFloat(probeStyle.paddingBottom) || 0,
            left: parseFloat(probeStyle.paddingLeft) || 0,
        };
        probe.remove();

        const elements = [];
        const specs = ${JSON.stringify(DOM_SPEC)};
        for (const spec of specs) {
            const nodes = [...document.querySelectorAll(spec.selector)].slice(0, spec.max);
            nodes.forEach((el, index) => {
                const cs = getComputedStyle(el);
                const style = {};
                for (const prop of ${JSON.stringify(COMPUTED_PROPS)}) style[prop] = cs[prop];
                elements.push({
                    selector: spec.selector,
                    index,
                    tag: el.tagName.toLowerCase(),
                    id: el.id || '',
                    className: typeof el.className === 'string' ? el.className : '',
                    rect: rectOf(el),
                    style,
                });
            });
        }

        const audit = [];
        const visible = (el, r) => {
            const cs = getComputedStyle(el);
            return cs.display !== 'none' && cs.visibility !== 'hidden' &&
                +cs.opacity > 0 && r.width > 0 && r.height > 0;
        };
        const hasSafeArea = safeArea.top > 0 || safeArea.right > 0 || safeArea.bottom > 0 || safeArea.left > 0;
        if (hasSafeArea) {
            for (const selector of ${JSON.stringify(SAFE_AUDIT_SELECTORS)}) {
                for (const el of [...document.querySelectorAll(selector)]) {
                    const r = el.getBoundingClientRect();
                    if (!visible(el, r)) continue;
                    // Chỉ audit phần tử đang nằm trong dải dọc của viewport. Nội
                    // dung phía dưới fold vẫn cuộn được, không phải "bị tai thỏ che".
                    if (r.bottom <= 0 || r.top >= innerHeight) continue;
                    // T4.3 chỉ quan tâm tai thỏ trái/phải. Không tính trục dọc:
                    // nội dung dưới fold vẫn cuộn được, không phải bị che.
                    const leftHit = safeArea.left > 0 && r.left < safeArea.left - 1;
                    const rightHit = safeArea.right > 0 && r.right > innerWidth - safeArea.right + 1;
                    const outsideViewportLeft = safeArea.left > 0 && r.left < -1;
                    const outsideViewportRight = safeArea.right > 0 && r.right > innerWidth + 1;
                    if (leftHit || rightHit || outsideViewportLeft || outsideViewportRight) {
                        audit.push({
                            selector,
                            tag: el.tagName.toLowerCase(),
                            id: el.id || '',
                            className: typeof el.className === 'string' ? el.className.slice(0, 120) : '',
                            rect: rectOf(el),
                            hits: {
                                leftNotch: leftHit,
                                rightNotch: rightHit,
                                outsideViewportLeft,
                                outsideViewportRight,
                            },
                        });
                    }
                }
            }
        }

        return {
            viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
            safeArea,
            scroll: {
                x: window.scrollX, y: window.scrollY,
                docWidth: document.documentElement.scrollWidth,
                docHeight: document.documentElement.scrollHeight,
            },
            activeElement: document.activeElement ? {
                tag: document.activeElement.tagName.toLowerCase(),
                id: document.activeElement.id || '',
                className: typeof document.activeElement.className === 'string' ? document.activeElement.className : '',
            } : null,
            elements,
            audit,
            auditViolations: audit.length,
        };
    `;
}

async function normalizeVolatileUi(c) {
    // Trạng thái mạng (Đang đồng bộ / Thành công / Lỗi) là timer 2,5-4 s không
    // liên quan tới CSS. Đưa nút sync về đúng một pose idle trước mỗi frame để
    // 32 ảnh so sánh không phụ thuộc việc Firebase trả về nhanh hay chậm.
    await c.eval(`
        document.getElementById('toast-container')?.replaceChildren();
        const btn = document.getElementById('manual-sync-btn');
        if (btn) {
            btn.classList.remove('syncing-active');
            btn.removeAttribute('aria-busy');
            btn.title = 'Đồng bộ Cloud';
            const icon = btn.querySelector('i');
            if (icon) icon.className = 'ph-duotone ph-arrows-clockwise';
        }
        return true;
    `);
}

async function captureStableScreenshot(c, label) {
    let previous = null;
    for (let attempt = 0; attempt < 6; attempt++) {
        await normalizeVolatileUi(c);
        const { data } = await c.send('Page.captureScreenshot', {
            format: 'png',
            fromSurface: true,
            captureBeyondViewport: false,
            optimizeForSpeed: false,
        });
        const buffer = Buffer.from(data, 'base64');
        if (previous && previous.equals(buffer)) return { png: previous, stable: true, attempts: attempt + 1 };
        previous = buffer;
        await sleep(360);
    }
    console.warn(`  [canh bao] ${label}: ảnh chưa ổn định sau 6 lần chụp — dùng lần cuối.`);
    return { png: previous, stable: false, attempts: 6 };
}

async function capture(c, fileBase, state, viewportName, notch, diagnostics) {
    await c.eval(`
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        return true;
    `);
    await sleep(120);
    const label = `${state}-${viewportName}${notch ? '-notch' : ''}`;
    const stable = await captureStableScreenshot(c, label);
    const dom = await c.eval(collectDomExpression(Boolean(notch)));
    const png = stable.png;
    const file = `${fileBase}-${notch ? 'notch-' : ''}${state}-${viewportName}.png`;
    fs.writeFileSync(file, png);
    const sidecar = file.replace(/\.png$/i, '.json');
    fs.writeFileSync(sidecar, JSON.stringify(dom, null, 2) + '\n');
    const hash = crypto.createHash('sha256').update(png).digest('hex').slice(0, 16);
    console.log(
        `  [shot] ${path.basename(file)}  ${png.length.toLocaleString('en-US')} B  ` +
        `safe=${dom.safeArea.left}/${dom.safeArea.right}  audit=${dom.auditViolations}  ${hash}`,
    );
    if (dom.auditViolations) {
        diagnostics.safeAreaAudit.push({ state, viewport: viewportName, notch, violations: dom.audit });
    }
    return { file, sidecar, dom, png };
}

async function runStateSequence(c, origin, viewport, fileBase, notch, diagnostics) {
    await resetApp(c, origin, viewport, notch ? viewport.insets : null);

    const emptyVisible = await c.eval(`
        const el = document.getElementById('empty-onboarding-container');
        return Boolean(el && el.offsetParent !== null);
    `);
    if (!emptyVisible) throw new Error(`Empty state không hiện ở ${viewport.name}`);
    await capture(c, fileBase, 'empty', viewport.name, notch, diagnostics);

    // Thao tác UI thật: thêm đúng 1 từ qua form onboarding. Không đọc/ghi
    // IndexedDB trực tiếp, không gọi biến nội bộ.
    await click(c, '#btn-empty-add-word', 450);
    await setValue(c, '#input-english', 'celestial');
    await setValue(c, '#input-vietnamese', 'thiên thể');
    await setValue(c, '#input-type', 'noun');
    await setValue(c, '#input-pronunciation', '/səˈlestiəl/');
    await setValue(c, '#input-tags', 'Celestial');
    await setValue(c, '#input-example', 'The celestial map guided us home.');
    await click(c, '#save-word-btn', 250);
    await waitFor(c, `
        const modal = document.getElementById('add-edit-modal');
        const word = document.getElementById('card-english')?.textContent?.trim();
        return (!modal || modal.classList.contains('hidden')) && word === 'celestial';
    `, 10000, 'thẻ đầu tiên sau khi lưu từ');
    await waitFor(c, `return !document.getElementById('manual-sync-btn')?.classList.contains('syncing-active');`, 9000, 'sync idle sau lưu')
        .catch(() => {});
    await sleep(1200);
    await capture(c, fileBase, 'card-front', viewport.name, notch, diagnostics);

    await click(c, '#reveal-btn', 250);
    await waitFor(c, `
        const panel = document.getElementById('srs-feedback-buttons');
        return panel && !panel.classList.contains('hidden') && panel.offsetParent !== null;
    `, 8000, '4 nút chấm sau khi lật');
    await sleep(700);
    await capture(c, fileBase, 'card-back', viewport.name, notch, diagnostics);

    await click(c, '#celestial-hub-btn', 500);
    await waitFor(c, `
        const modal = document.getElementById('manage-modal');
        return modal && !modal.classList.contains('hidden') &&
            document.getElementById('profile-view-overview')?.offsetParent !== null;
    `, 10000, 'Hub tổng quan');
    await sleep(2200);
    await capture(c, fileBase, 'hub-overview', viewport.name, notch, diagnostics);

    await click(c, '#tab-vocab-list', 400);
    await waitFor(c, `return document.getElementById('manage-view-words')?.offsetParent !== null;`, 8000, 'tab Từ vựng');
    await sleep(700);
    await capture(c, fileBase, 'hub-words', viewport.name, notch, diagnostics);

    await click(c, '#tab-data-io', 450);
    await waitFor(c, `return document.getElementById('manage-view-io')?.offsetParent !== null;`, 10000, 'tab Dữ liệu');
    await sleep(1100);
    await capture(c, fileBase, 'hub-io', viewport.name, notch, diagnostics);

    await click(c, '#close-manage-modal-btn', 550);
    await waitFor(c, `return document.getElementById('manage-modal')?.classList.contains('hidden');`, 8000, 'đóng Hub');
    await waitFor(c, `return Boolean(document.getElementById('tts-settings-group'));`, 10000, 'panel TTS mount');
    if (viewport.width <= 1000) {
        const menuOpen = await c.eval(`return document.getElementById('taskbar-menu')?.classList.contains('show');`);
        if (!menuOpen) await click(c, '#toggle-taskbar-btn', 450);
        await waitFor(c, `return document.getElementById('taskbar-menu')?.classList.contains('show');`, 5000, 'menu TTS mở');
    }
    await sleep(500);
    await capture(c, fileBase, 'tts-panel', viewport.name, notch, diagnostics);

    if (viewport.width <= 1000) {
        const menuOpen = await c.eval(`return document.getElementById('taskbar-menu')?.classList.contains('show');`);
        if (!menuOpen) await click(c, '#toggle-taskbar-btn', 350);
    }
    await click(c, '#toggle-dark-mode-btn', 450);
    await waitFor(c, `return !document.body.classList.contains('dark-mode');`, 8000, 'chuyển sang chế độ sáng');
    await sleep(3200);
    await capture(c, fileBase, 'light', viewport.name, notch, diagnostics);
}

async function runHarness({ outPrefix, withNotch, noBuild, viewportNames }) {
    if (!noBuild) {
        console.log('\n[visual] npm run build ...');
        const np = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        const result = spawnSync(np, ['run', 'build'], {
            cwd: ROOT,
            stdio: 'inherit',
            shell: process.platform === 'win32',
        });
        if (result.status !== 0) throw new Error(`npm run build thất bại (exit ${result.status})`);
    }
    if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error('Không thấy dist/index.html');

    const outBase = path.resolve(ROOT, outPrefix);
    fs.mkdirSync(path.dirname(outBase), { recursive: true });
    const { server, port } = await makeStaticServer(DIST);
    const origin = `http://127.0.0.1:${port}`;
    const chromeInfo = await startChrome();
    const c = new CDP(chromeInfo.wsUrl);
    const diagnostics = { safeAreaAudit: [], errors: [] };
    try {
        await c.init();
        await c.send('Page.enable');
        await c.send('Runtime.enable');
        await c.send('Log.enable');
        c.on('Runtime.exceptionThrown', (params) => {
            const text = params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || '';
            if (text) diagnostics.errors.push({ type: 'exception', text: String(text).slice(0, 400) });
        });
        c.on('Log.entryAdded', (params) => {
            if (params.entry?.level === 'error') {
                const url = String(params.entry.url || '');
                if (url.includes('identitytoolkit')) return;
                diagnostics.errors.push({ type: 'log', text: String(params.entry.text || '').slice(0, 400), url });
            }
        });

        const selectedViewports = viewportNames?.length
            ? DEFAULT_VIEWPORTS.filter((vp) => viewportNames.includes(vp.name))
            : DEFAULT_VIEWPORTS;
        console.log(`\n[visual] server ${origin}; Chrome ${chromeInfo.browserPort}; output ${outBase}-...`);
        for (const viewport of selectedViewports) {
            console.log(`\n[viewport] ${viewport.name} (${viewport.mobile ? 'mobile' : 'desktop'})`);
            await runStateSequence(c, origin, viewport, outBase, false, diagnostics);
        }
        if (withNotch) {
            console.log(`\n[viewport] ${NOTCH_VIEWPORT.name} + safe-area notch (left=59,right=59,bottom=21)`);
            await runStateSequence(c, origin, NOTCH_VIEWPORT, outBase, true, diagnostics);
        }
        await c.send('Emulation.setSafeAreaInsetsOverride', { insets: {} });
    } finally {
        c.close();
        try { chromeInfo.chrome.kill(); } catch {}
        server.close();
        try { fs.rmSync(chromeInfo.userDataDir, { recursive: true, force: true }); } catch {}
    }

    const files = fs.readdirSync(path.dirname(outBase))
        .filter((name) => name.startsWith(path.basename(outBase) + '-') && name.endsWith('.png'))
        .sort();
    const auditViolations = diagnostics.safeAreaAudit.reduce((sum, item) => sum + item.violations.length, 0);
    console.log(`\n[visual] Đã chụp ${files.length} ảnh.`);
    console.log(`[visual] Safe-area audit violations: ${auditViolations}`);
    if (diagnostics.errors.length) {
        console.log(`[visual] Console/runtime errors (không tự fail): ${diagnostics.errors.length}`);
        for (const error of diagnostics.errors.slice(0, 8)) console.log('  -', error.type, error.text.split('\n')[0].slice(0, 220));
    }
    console.log(`[visual] Xong lúc ${new Date().toISOString()}`);
    return { files, auditViolations, diagnostics };
}

/* ─────────────────────────── PNG + compare ─────────────────────────── */

function decodePng(buffer) {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (buffer.length < 8 || !buffer.subarray(0, 8).equals(signature)) {
        throw new Error('Không phải PNG');
    }
    let offset = 8;
    let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
    let palette = null;
    const idat = [];
    while (offset + 12 <= buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString('ascii', offset + 4, offset + 8);
        const data = buffer.subarray(offset + 8, offset + 8 + length);
        offset += 12 + length;
        if (type === 'IHDR') {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            bitDepth = data[8];
            colorType = data[9];
            interlace = data[12];
        } else if (type === 'PLTE') {
            palette = data;
        } else if (type === 'IDAT') {
            idat.push(data);
        } else if (type === 'IEND') {
            break;
        }
    }
    if (bitDepth !== 8 || interlace !== 0) {
        throw new Error(`PNG không hỗ trợ: bitDepth=${bitDepth}, interlace=${interlace}`);
    }
    const channelMap = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
    const channels = channelMap[colorType];
    if (!channels) throw new Error(`PNG colorType không hỗ trợ: ${colorType}`);
    if (colorType === 3 && !palette) throw new Error('PNG palette thiếu PLTE');

    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    const expected = (stride + 1) * height;
    if (raw.length < expected) throw new Error(`PNG IDAT ngắn: ${raw.length} < ${expected}`);
    const pixels = Buffer.alloc(stride * height);
    let rawOffset = 0;
    for (let y = 0; y < height; y++) {
        const filter = raw[rawOffset++];
        const rowStart = y * stride;
        const prevStart = (y - 1) * stride;
        for (let x = 0; x < stride; x++) {
            const value = raw[rawOffset++];
            const left = x >= channels ? pixels[rowStart + x - channels] : 0;
            const up = y > 0 ? pixels[prevStart + x] : 0;
            const upLeft = y > 0 && x >= channels ? pixels[prevStart + x - channels] : 0;
            let out;
            switch (filter) {
                case 0: out = value; break;
                case 1: out = value + left; break;
                case 2: out = value + up; break;
                case 3: out = value + Math.floor((left + up) / 2); break;
                case 4: {
                    const p = left + up - upLeft;
                    const pa = Math.abs(p - left);
                    const pb = Math.abs(p - up);
                    const pc = Math.abs(p - upLeft);
                    out = value + (pa <= pb && pa <= pc ? left : (pb <= pc ? up : upLeft));
                    break;
                }
                default: throw new Error(`PNG filter lạ: ${filter}`);
            }
            pixels[rowStart + x] = out & 0xff;
        }
    }

    const rgba = Buffer.alloc(width * height * 4);
    for (let i = 0, p = 0; i < width * height; i++, p += channels) {
        let r, g, b, a = 255;
        if (colorType === 0) {
            r = g = b = pixels[p];
        } else if (colorType === 2) {
            r = pixels[p]; g = pixels[p + 1]; b = pixels[p + 2];
        } else if (colorType === 3) {
            const index = pixels[p] * 3;
            r = palette[index]; g = palette[index + 1]; b = palette[index + 2];
        } else if (colorType === 4) {
            r = g = b = pixels[p]; a = pixels[p + 1];
        } else {
            r = pixels[p]; g = pixels[p + 1]; b = pixels[p + 2]; a = pixels[p + 3];
        }
        const o = i * 4;
        rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
    }
    return { width, height, rgba };
}

function deepDiffCount(a, b, limit = 100000) {
    let count = 0;
    const first = [];
    function walk(x, y, at) {
        if (count >= limit) return;
        if (x === y) return;
        if (x === null || y === null || typeof x !== typeof y) {
            count += 1;
            if (first.length < 5) first.push(at);
            return;
        }
        if (typeof x !== 'object') {
            if (!Object.is(x, y)) {
                count += 1;
                if (first.length < 5) first.push(at);
            }
            return;
        }
        if (Array.isArray(x) || Array.isArray(y)) {
            if (!Array.isArray(x) || !Array.isArray(y)) {
                count += 1;
                if (first.length < 5) first.push(at);
                return;
            }
            if (x.length !== y.length) {
                count += Math.abs(x.length - y.length);
                if (first.length < 5) first.push(at + '.length');
            }
            const len = Math.min(x.length, y.length);
            for (let i = 0; i < len; i++) walk(x[i], y[i], `${at}[${i}]`);
            return;
        }
        const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
        for (const key of keys) walk(x[key], y[key], at ? `${at}.${key}` : key);
    }
    walk(a, b, '');
    return { count, first };
}

function compareImages(fileA, fileB) {
    const pngA = decodePng(fs.readFileSync(fileA));
    const pngB = decodePng(fs.readFileSync(fileB));
    if (pngA.width !== pngB.width || pngA.height !== pngB.height) {
        return {
            pixelDiff: Math.max(pngA.width * pngA.height, pngB.width * pngB.height),
            total: Math.max(pngA.width * pngA.height, pngB.width * pngB.height),
            percent: 100,
            dimensionMismatch: `${pngA.width}x${pngA.height} vs ${pngB.width}x${pngB.height}`,
        };
    }
    let diff = 0, minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
    const total = pngA.width * pngA.height;
    for (let i = 0, p = 0; i < total; i++, p += 4) {
        if (
            pngA.rgba[p] !== pngB.rgba[p] ||
            pngA.rgba[p + 1] !== pngB.rgba[p + 1] ||
            pngA.rgba[p + 2] !== pngB.rgba[p + 2] ||
            pngA.rgba[p + 3] !== pngB.rgba[p + 3]
        ) {
            diff += 1;
            const x = i % pngA.width;
            const y = Math.floor(i / pngA.width);
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }
    return {
        pixelDiff: diff,
        total,
        percent: total ? (diff / total) * 100 : 0,
        bbox: diff ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null,
    };
}

async function compareHarnesses(prefixA, prefixB, exclude = null) {
    const aPath = path.resolve(ROOT, prefixA);
    const bPath = path.resolve(ROOT, prefixB);
    const aDir = path.dirname(aPath);
    const bDir = path.dirname(bPath);
    const aBase = path.basename(aPath);
    const bBase = path.basename(bPath);
    if (!fs.existsSync(aDir)) throw new Error(`Không thấy thư mục baseline: ${aDir}`);
    if (!fs.existsSync(bDir)) throw new Error(`Không thấy thư mục after: ${bDir}`);
    const files = fs.readdirSync(aDir)
        .filter((name) => name.startsWith(aBase + '-') && name.endsWith('.png'))
        .filter((name) => !exclude || !name.includes(exclude))
        .sort((a, b) => a.localeCompare(b, 'en'));
    if (!files.length) throw new Error(`Không có ảnh ${aBase}-*.png trong ${aDir}`);

    console.log(`\n=== SO SÁNH ẢNH PIXEL (${files.length} ảnh) ===`);
    console.log(`${'ẢNH'.padEnd(48)}${'PIXEL KHÁC'.padStart(12)}${'%'.padStart(9)}${'DOM LỆCH'.padStart(11)}  KẾT LUẬN`);
    console.log('-'.repeat(100));
    let different = 0;
    let missing = 0;
    let domDifferent = 0;
    let totalPixels = 0;
    for (const name of files) {
        const suffix = name.slice(aBase.length);
        const bName = bBase + suffix;
        const fileB = path.join(bDir, bName);
        const fileA = path.join(aDir, name);
        if (!fs.existsSync(fileB)) {
            missing += 1;
            different += 1;
            console.log(`${name.padEnd(48)}${'—'.padStart(12)}${'—'.padStart(9)}${'—'.padStart(11)}  THIẾU FILE`);
            continue;
        }
        const pixel = compareImages(fileA, fileB);
        let domCount = null;
        let domFirst = [];
        const sideA = fileA.replace(/\.png$/i, '.json');
        const sideB = fileB.replace(/\.png$/i, '.json');
        if (fs.existsSync(sideA) && fs.existsSync(sideB)) {
            const domA = JSON.parse(fs.readFileSync(sideA, 'utf8'));
            const domB = JSON.parse(fs.readFileSync(sideB, 'utf8'));
            const result = deepDiffCount(domA, domB);
            domCount = result.count;
            domFirst = result.first;
            if (domCount > 0) domDifferent += 1;
        }
        totalPixels += pixel.total || 0;
        const isDifferent = pixel.pixelDiff !== 0 || domCount === null || domCount > 0;
        if (isDifferent) different += 1;
        const percent = pixel.percent === undefined ? '—' : pixel.percent.toFixed(4);
        const conclusion = isDifferent ? 'KHÁC' : 'GIỐNG';
        console.log(
            `${name.padEnd(48)}${String(pixel.pixelDiff).padStart(12)}${percent.padStart(9)}` +
            `${String(domCount === null ? '—' : domCount).padStart(11)}  ${conclusion}`,
        );
        if (pixel.dimensionMismatch) console.log(`  ! dimension: ${pixel.dimensionMismatch}`);
        if (pixel.bbox) {
            console.log(`  ! pixel bbox: x=${pixel.bbox.x}, y=${pixel.bbox.y}, w=${pixel.bbox.width}, h=${pixel.bbox.height}`);
        }
        if (domFirst.length) console.log(`  ! DOM khác: ${domFirst.join(' | ')}`);
    }
    console.log('-'.repeat(100));
    console.log(
        `Tổng: ${files.length} ảnh | giống: ${files.length - different} | khác: ${different} | ` +
        `khác DOM: ${domDifferent} | thiếu file: ${missing} | pixel khác: ${totalPixels ? 'xem từng dòng' : '—'}`,
    );
    console.log(different ? '[KET LUAN] CÓ KHÁC BIỆT — xem bảng trên.' : '[KET LUAN] TẤT CẢ ẢNH GIỐNG NHAU 100%.');
    return { files: files.length, different, domDifferent, missing };
}

/* ───────────────────────────── CLI ───────────────────────────── */

const compareIndex = args.indexOf('--compare');
if (compareIndex !== -1) {
    const prefixA = args[compareIndex + 1];
    const prefixB = args[compareIndex + 2];
    if (!prefixA || !prefixB || prefixA.startsWith('--') || prefixB.startsWith('--')) {
        console.error('Dùng: node tools/visual_snapshot.mjs --compare <prefixA> <prefixB> [--exclude=<text>]');
        process.exit(2);
    }
    const exclude = argValue('exclude', null);
    try {
        const result = await compareHarnesses(prefixA, prefixB, exclude);
        process.exit(result.different ? 1 : 0);
    } catch (error) {
        console.error('[visual] LỖI SO SÁNH:', error.message);
        process.exit(2);
    }
} else {
    const outPrefix = String(argValue('out', 'reports/visual/current'));
    const withNotch = hasFlag('with-notch');
    const noBuild = hasFlag('no-build');
    const viewportArg = argValue('viewports', null);
    const viewportNames = typeof viewportArg === 'string' ? viewportArg.split(',').map((s) => s.trim()).filter(Boolean) : null;
    try {
        await runHarness({ outPrefix, withNotch, noBuild, viewportNames });
        process.exit(0);
    } catch (error) {
        console.error('\n[visual] LỖI:', error.message);
        if (error.stack) console.error(error.stack);
        process.exit(2);
    }
}
