/**
 * tools/measure_startup.mjs — đo thời gian khởi động app (T3.4) trên bundle THẬT (dist/).
 *
 * Chạy trên `dist/` đã build (script KHÔNG tự build), phục vụ bằng http server tĩnh
 * với header cache giống `firebase.json`, rồi nối CDP vào Chrome headless.
 *
 * 3 chỉ số, mỗi chỉ số đo `--runs` lần (mặc định 5):
 *   1. appReadyMs        = navigationStart → `document.body.classList.add('app-ready')`
 *                          (patch DOMTokenList.add để bắt ĐÚNG thời điểm; MutationObserver
 *                           chỉ là cross-check vì callback chạy sau microtask)
 *   2. fcpMs             = navigationStart → first-contentful-paint
 *                          (PerformanceObserver type 'paint' + fallback getEntriesByType)
 *   3. lastLongTaskEndMs = navigationStart → THỜI ĐIỂM KẾT THÚC của long task cuối cùng
 *                          có start < 2000 ms (PerformanceObserver type 'longtask').
 *                          Không có long task nào → null (in "—"), không bịa số.
 *
 * 3 series (điều kiện đo):
 *   A `cold`  — profile Chrome MỚI cho mỗi lần đo: HTTP cache lạnh, service worker chưa cài.
 *   B `warm`  — 1 profile dùng chung: nạp 1 lần (warm-up, không tính) để SW cài + cache ấm,
 *               rồi đo `--runs` lần nạp lại (lần 2..N).
 *   C `cards` — như B nhưng gieo trước `--cards` thẻ (mặc định 3000) vào IndexedDB, đúng
 *               điều kiện DoD của T3.4 ("app-ready ≤ 900 ms … 3.000 thẻ").
 *
 * Cách chạy:
 *   node tools/measure_startup.mjs                        # 5 lần × 3 series, 3000 thẻ cho series C
 *   node tools/measure_startup.mjs --runs 5 --cards 3000
 *   node tools/measure_startup.mjs --series cold,warm     # chỉ 2 điều kiện chính
 *   node tools/measure_startup.mjs --json                 # in thêm JSON thô để lưu lại
 *
 * Cờ: --runs N --cards N --series cold,warm,cards --port 5210 --url "/?theme=dark" --json
 * Yêu cầu: Node ≥ 22 (WebSocket toàn cục) — đo trên Node v26.1.0.
 */
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';

const args = process.argv.slice(2);
function arg(name, fallback = null) {
    const i = args.indexOf(`--${name}`);
    if (i === -1) return fallback;
    const v = args[i + 1];
    return v === undefined || v.startsWith('--') ? true : v;
}

const RUNS = Math.max(1, Number(arg('runs', 5)) || 5);
const CARDS = Math.max(0, Number(arg('cards', 3000)) || 0);
// Cổng 0 = để OS cấp cổng trống. Máy này từng có process khác giữ 5210/5211
// (Windows cho bind trùng cổng) → nếu đặt cổng cứng, request có thể lọt sang app khác.
const PORT = Number(arg('port', 0)) || 0;
const TARGET_PATH = String(arg('url', '/?theme=dark'));
const SERIES = String(arg('series', 'cold,warm,cards')).split(',').map(s => s.trim()).filter(Boolean);
const PRINT_JSON = Boolean(arg('json', false));
const WARMUP_TIMEOUT_MS = 20000;
const READY_TIMEOUT_MS = 15000;
const LT_WINDOW_MS = 2000;

// Gốc repo suy ra từ vị trí file (tools/ → ..) nên chạy được từ cwd bất kỳ.
const rootDir = path.resolve(path.dirname(process.argv[1] || '.'), '..');
const distDir = path.join(rootDir, 'dist');
const indexPath = path.join(distDir, 'index.html');
const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.woff2': 'font/woff2',
    '.webmanifest': 'application/manifest+json', '.txt': 'text/plain'
};

/** Header cache bám `firebase.json:29-83` để "cache ấm" giống production. */
function cacheControl(p) {
    if (p.startsWith('/assets/') || p.startsWith('/fonts/')) return 'public, max-age=31536000, immutable';
    if (p === '/version.json') return 'no-cache, no-store, must-revalidate';
    if (p === '/phosphor-subset.css') return 'public, max-age=3600';
    return 'no-cache'; // index.html, / và file ở gốc (icon, manifest)
}

/* ------------------------------------------------------------------ *
 * 1. Server tĩnh phục vụ dist/
 * ------------------------------------------------------------------ */
function startServer() {
    const server = http.createServer((req, res) => {
        let p = decodeURIComponent(String(req.url || '/').split('?')[0].split('#')[0]);
        if (p === '/') p = '/index.html';
        const file = path.join(distDir, p);
        const exists = fs.existsSync(file) && fs.statSync(file).isFile();
        // SPA fallback: mọi path không phải file → index.html (giống firebase rewrites)
        const target = exists ? file : indexPath;
        if (!fs.existsSync(target)) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('dist/index.html không tồn tại — chạy `npm run build` trước.');
            return;
        }
        res.writeHead(200, {
            'Content-Type': MIME[path.extname(target)] || 'application/octet-stream',
            'Cache-Control': cacheControl(exists ? p : '/index.html')
        });
        fs.createReadStream(target).pipe(res);
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(PORT, () => resolve({ server, port: server.address().port }));
    });
}

/* ------------------------------------------------------------------ *
 * 2. CDP tối giản trên WebSocket toàn cục
 * ------------------------------------------------------------------ */
class CDP {
    constructor(wsUrl) {
        this.ws = new globalThis.WebSocket(wsUrl);
        this.id = 1;
        this.pending = new Map();
        this.listeners = new Map();
        this.consoleErrors = [];
        this.exceptions = [];
    }
    init() {
        return new Promise((resolve, reject) => {
            this.ws.onopen = () => resolve();
            this.ws.onerror = () => reject(new Error('không mở được WebSocket CDP'));
            this.ws.onmessage = evt => {
                const data = JSON.parse(evt.data);
                if (data.id && this.pending.has(data.id)) {
                    const { resolve: r, reject: j } = this.pending.get(data.id);
                    this.pending.delete(data.id);
                    if (data.error) j(new Error(data.error.message));
                    else r(data.result);
                } else if (data.method) {
                    (this.listeners.get(data.method) || []).forEach(cb => cb(data.params));
                }
            };
        });
    }
    on(method, cb) {
        if (!this.listeners.has(method)) this.listeners.set(method, []);
        this.listeners.get(method).push(cb);
    }
    send(method, params = {}) {
        const id = this.id++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }
    async eval(expression) {
        const res = await this.send('Runtime.evaluate', {
            expression: `(async () => { ${expression} })()`,
            awaitPromise: true,
            returnByValue: true
        });
        if (res.exceptionDetails) {
            const d = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
            throw new Error(String(d || 'Runtime.evaluate failed'));
        }
        return res.result?.value;
    }
    close() {
        try { this.ws.close(); } catch { }
    }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ------------------------------------------------------------------ *
 * 3. Đoạn script tiêm vào ĐẦU document (trước mọi script của app)
 * ------------------------------------------------------------------ */
const INSTRUMENT = `
(() => {
  const S = { appReady: null, appReadyObserved: null, fcpObserved: null, longTasks: [], startedAt: null };
  window.__startup = S;
  S.startedAt = performance.timeOrigin || 0;

  // FCP: observer + (dự phòng) getEntriesByType lúc đọc
  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        if (e.name === 'first-contentful-paint' && S.fcpObserved == null) S.fcpObserved = e.startTime;
      }
    }).observe({ type: 'paint', buffered: true });
  } catch (err) { S.paintObserverError = String(err && err.message || err); }

  // Long task: cần đủ lâu để entry đầu tiên trong 2 s được giao
  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) S.longTasks.push({ start: e.startTime, dur: e.duration, name: e.name });
    }).observe({ type: 'longtask', buffered: true });
  } catch (err) { S.longTaskObserverError = String(err && err.message || err); }

  // app-ready: bắt đúng lúc class được thêm (MutationObserver chạy SAU microtask nên trễ vài ms)
  const nativeAdd = DOMTokenList.prototype.add;
  DOMTokenList.prototype.add = function (...tokens) {
    const out = nativeAdd.apply(this, tokens);
    if (S.appReady == null && tokens.includes('app-ready')) S.appReady = performance.now();
    return out;
  };
  try {
    new MutationObserver(() => {
      if (S.appReadyObserved == null && document.body && document.body.classList.contains('app-ready')) {
        S.appReadyObserved = performance.now();
      }
    }).observe(document, { attributes: true, attributeFilter: ['class'], subtree: true });
  } catch (err) { S.appReadyObserverError = String(err && err.message || err); }

  // 3 timestamp rAF đầu tiên: khung hình đầu tiên mà compositor thực sự vẽ
  S.rafSamples = [];
  try {
    const raf = window.requestAnimationFrame.bind(window);
    const tick = t => { S.rafSamples.push(t); if (S.rafSamples.length < 3) raf(tick); };
    raf(tick);
  } catch (err) { S.rafError = String(err && err.message || err); }
})();
`;

/* ------------------------------------------------------------------ *
 * 4. Chrome headless + kết nối CDP
 * ------------------------------------------------------------------ */
let chromeVersion = null;

async function withChrome(label, fn) {
    const profileDir = path.join(os.tmpdir(), `startup_${label}_${Date.now()}_${Math.floor(Math.random() * 1e4)}`);
    fs.mkdirSync(profileDir, { recursive: true });
    const debugPort = 9400 + Math.floor(Math.random() * 90);
    const chrome = spawn(chromePath, [
        '--headless=new',
        '--window-size=1440,900',
        `--user-data-dir=${profileDir}`,
        `--remote-debugging-port=${debugPort}`,
        '--no-sandbox', '--hide-scrollbars', '--mute-audio',
        '--disable-extensions', '--disable-background-networking',
        '--no-first-run', '--no-default-browser-check', '--disable-sync'
    ], { stdio: 'ignore' });

    let client = null;
    try {
        let wsUrl = null;
        for (let i = 0; i < 100 && !wsUrl; i++) {
            await sleep(150);
            try {
                const ver = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();
                chromeVersion = ver['Browser'] || chromeVersion;
                const list = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
                const page = list.find(t => t.type === 'page');
                if (page) wsUrl = page.webSocketDebuggerUrl;
            } catch { /* Chrome chưa mở cổng — thử lại */ }
        }
        if (!wsUrl) throw new Error('không nối được CDP (Chrome không mở debug port)');
        client = new CDP(wsUrl);
        await client.init();
        client.on('Runtime.consoleAPICalled', p => {
            if (p.type !== 'error') return;
            client.consoleErrors.push((p.args || []).map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
        });
        client.on('Runtime.exceptionThrown', p => {
            client.exceptions.push(String(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || '').slice(0, 200));
        });
        await client.send('Page.enable');
        await client.send('Runtime.enable');
        await client.send('Log.enable');
        await client.send('Page.addScriptToEvaluateOnNewDocument', { source: INSTRUMENT });
        return await fn(client, profileDir);
    } finally {
        try { client?.close(); } catch { }
        try { chrome.kill(); } catch { }
        await Promise.race([
            new Promise(r => chrome.once('exit', r)),
            sleep(6000)
        ]);
        try { fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { }
    }
}

/* ------------------------------------------------------------------ *
 * 5. Một lần đo = 1 navigation
 * ------------------------------------------------------------------ */
let baseUrl = `http://localhost:${PORT}`; // cập nhật lại sau khi server nghe ở cổng thật
let distEntryFile = null; // tên file entry của dist hiện tại — dùng để chắc chắn đang đo ĐÚNG app

function urlWith(marker) {
    const join = TARGET_PATH.includes('?') ? '&' : '?';
    return `${baseUrl}${TARGET_PATH}${join}m=${marker}`;
}

/** Chờ document MỚI (đúng marker) thay vì document cũ còn sống trong lúc navigate. */
async function waitForDocument(client, marker, timeoutMs = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        try {
            const ok = await client.eval(
                `return !!(location.search.includes(${JSON.stringify('m=' + marker)}) && window.__startup);`
            );
            if (ok) return true;
        } catch { /* execution context bị destroy khi navigate — thử lại */ }
        await sleep(50);
    }
    return false;
}

async function measureNavigation(client, marker) {
    const errBase = client.consoleErrors.length;
    const excBase = client.exceptions.length;
    await client.send('Page.navigate', { url: urlWith(marker) });
    if (!(await waitForDocument(client, marker))) {
        return { marker, fatal: 'document mới không xuất hiện (navigate/CDP lỗi)' };
    }

    const m = await client.eval(`
      const S = window.__startup;
      const t0 = performance.now();
      while (S.appReady == null && performance.now() - t0 < ${READY_TIMEOUT_MS}) await new Promise(r => setTimeout(r, 20));
      // Đợi hết 2 s đầu để long task trong cửa sổ đo được giao về observer
      if (performance.now() < ${LT_WINDOW_MS + 250}) await new Promise(r => setTimeout(r, ${LT_WINDOW_MS + 250} - performance.now()));

      const nav = performance.getEntriesByType('navigation')[0] || {};
      const paints = performance.getEntriesByType('paint').map(p => ({ name: p.name, start: p.startTime }));
      const fcpEntry = paints.find(p => p.name === 'first-contentful-paint');
      const lt = (S.longTasks || []).slice().sort((a, b) => a.start - b.start);
      const ltWindow = lt.filter(t => t.start < ${LT_WINDOW_MS});
      let ltLastEnd = null, ltTotal = 0, ltMax = null;
      for (const t of ltWindow) {
        ltTotal += t.dur;
        const end = t.start + t.dur;
        if (ltLastEnd == null || end > ltLastEnd) ltLastEnd = end;
        if (ltMax == null || t.dur > ltMax) ltMax = t.dur;
      }
      const res = performance.getEntriesByType('resource');
      const sw = { supported: !!navigator.serviceWorker, controller: !!(navigator.serviceWorker && navigator.serviceWorker.controller) };
      try { sw.registrations = (await navigator.serviceWorker.getRegistrations()).length; } catch (e) { sw.regError = String(e && e.message || e); }
      try { sw.caches = (await caches.keys()).length; } catch (e) { sw.cacheError = String(e && e.message || e); }

      return {
        appReadyMs: S.appReady,
        appReadyObservedMs: S.appReadyObserved,
        readyTimedOut: S.appReady == null,
        fcpMs: fcpEntry ? fcpEntry.start : (S.fcpObserved != null ? S.fcpObserved : null),
        paintEntries: paints.map(p => ({ name: p.name, start: Math.round(p.start * 10) / 10 })),
        longTaskSupported: !S.longTaskObserverError,
        longTaskCount: ltWindow.length,
        longTaskTotalMs: Math.round(ltTotal * 10) / 10,
        longTaskMaxMs: ltMax == null ? null : Math.round(ltMax * 10) / 10,
        longTaskLastEndMs: ltLastEnd == null ? null : Math.round(ltLastEnd * 10) / 10,
        longTaskAllCount: lt.length,
        longTasksDetailed: ltWindow.map(t => ({ start: Math.round(t.start * 10) / 10, dur: Math.round(t.dur * 10) / 10 })),
        firstRafMs: (S.rafSamples && S.rafSamples[0] != null) ? S.rafSamples[0] : null,
        rafSamples: (S.rafSamples || []).map(t => Math.round(t * 10) / 10),
        nav: {
          type: nav.type || null,
          responseStart: nav.responseStart ?? null,
          responseEnd: nav.responseEnd ?? null,
          domInteractive: nav.domInteractive ?? null,
          domContentLoaded: nav.domContentLoadedEventEnd ?? null,
          loadEvent: nav.loadEventEnd ?? null,
          transferSize: nav.transferSize ?? null,
          encodedBodySize: nav.encodedBodySize ?? null,
          decodedBodySize: nav.decodedBodySize ?? null
        },
        resources: {
          count: res.length,
          transferSumBytes: res.reduce((a, r) => a + (r.transferSize || 0), 0),
          fromCacheCount: res.filter(r => (r.transferSize || 0) === 0 && r.duration > 0).length,
          slowest: res.slice().sort((a, b) => b.duration - a.duration).slice(0, 3).map(r => ({ name: r.name.split('/').pop(), dur: Math.round(r.duration), transfer: r.transferSize || 0 }))
        },
        sw,
        entryLoaded: res.some(r => r.name.split('?')[0].endsWith(${JSON.stringify(distEntryFile || '')})),
        viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
        visibility: document.visibilityState,
        bodyClass: document.body ? document.body.className : null,
        card: document.getElementById('card-english')?.textContent?.trim() || null,
        timeOrigin: performance.timeOrigin,
        nowAtRead: performance.now()
      };
    `);

    m.marker = marker;
    m.consoleErrors = client.consoleErrors.slice(errBase);
    m.exceptions = client.exceptions.slice(excBase);
    if (!m.entryLoaded) {
        m.fatal = `trang không tải entry ${distEntryFile} — request có thể bị process khác chiếm cổng`;
    }
    return m;
}

/* ------------------------------------------------------------------ *
 * 6. Chuẩn bị profile: nạp lần đầu (warm-up) + (tuỳ chọn) gieo thẻ
 * ------------------------------------------------------------------ */
async function warmUp(client, label) {
    await client.send('Page.navigate', { url: urlWith(label + '-warmup') });
    if (!(await waitForDocument(client, label + '-warmup'))) throw new Error('warm-up: không có document mới');
    const info = await client.eval(`
      const S = window.__startup;
      const t0 = performance.now();
      while (S.appReady == null && performance.now() - t0 < ${WARMUP_TIMEOUT_MS}) await new Promise(r => setTimeout(r, 25));
      const reg = await Promise.race([
        navigator.serviceWorker.ready.catch(() => null),
        new Promise(r => setTimeout(() => r(null), ${WARMUP_TIMEOUT_MS}))
      ]);
      await new Promise(r => setTimeout(r, 1200)); // cho precache ghi xong
      const keys = await caches.keys().catch(() => []);
      return {
        appReadyMs: S.appReady,
        readyTimedOut: S.appReady == null,
        swActive: !!reg,
        swScope: reg ? String(reg.scope) : null,
        swController: !!navigator.serviceWorker.controller,
        caches: keys,
        bodyClass: document.body ? document.body.className : null,
        card: document.getElementById('card-english')?.textContent?.trim() || null
      };
    `);
    info.consoleErrors = client.consoleErrors.slice();
    return info;
}

async function seedCards(client, count) {
    return client.eval(`
      const dbs = await indexedDB.databases();
      const name = (dbs.map(d => d.name).filter(Boolean)).find(n => n.includes('celestial-vocab')) || 'celestial-vocab-idb';
      const req = indexedDB.open(name);
      const db = await new Promise((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
        req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('vocabulary')) req.result.createObjectStore('vocabulary', { keyPath: 'id' }); };
      });
      const tx = db.transaction('vocabulary', 'readwrite');
      const store = tx.objectStore('vocabulary');
      const now = Date.now();
      const topics = ['Celestial', 'Business', 'IELTS', 'Travel', 'Science'];
      for (let i = 0; i < ${count}; i++) {
        const due = i % 3 === 0 ? now - 3600000 : now + (i % 40) * 86400000;
        const status = i % 5 === 0 ? 'New' : (i % 3 === 0 ? 'Learning' : 'Mastered');
        store.put({
          id: 'seed-' + i, english: 'seedword' + i, vietnamese: 'từ vựng thử nghiệm số ' + i,
          type: i % 4 === 0 ? 'noun' : (i % 4 === 1 ? 'verb' : (i % 4 === 2 ? 'adjective' : 'phrase')),
          pronunciation: '/siːd wɜːd ' + i + '/',
          example: 'This is a sample celestial example sentence number ' + i + ' that includes seedword' + i + ' inside it.',
          tags: [topics[i % topics.length]], srsStatus: status, srsDueDate: due,
          srsInterval: (i % 30) + 1, srsEaseFactor: 2.5, isStarred: i % 11 === 0,
          lapses: i % 7, reps: i % 20, anchor: 0, modality: 'en-vi',
          createdAt: now - i * 1000, updatedAt: now - i * 1000
        });
      }
      await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
      const total = await new Promise((res, rej) => {
        const c = db.transaction('vocabulary', 'readonly').objectStore('vocabulary').count();
        c.onsuccess = () => res(c.result);
        c.onerror = () => rej(c.error);
      });
      db.close();
      return { dbName: name, count: ${count}, totalInStore: total };
    `);
}

/* ------------------------------------------------------------------ *
 * 7. Ba series
 * ------------------------------------------------------------------ */
async function seriesCold() {
    const runs = [];
    for (let i = 1; i <= RUNS; i++) {
        const r = await withChrome(`cold${i}`, client => measureNavigation(client, `cold-${i}`));
        runs.push(r);
        report(`A/cold #${i}`, r);
    }
    return { series: 'cold', label: 'A — profile mới mỗi lần (cache lạnh, SW chưa cài)', runs };
}

async function seriesWarm() {
    return withChrome('warm', async client => {
        const warmup = await warmUp(client, 'warm');
        console.log(`  [warm-up] appReady=${fmt(warmup.appReadyMs)} ms · SW active=${warmup.swActive} · controller=${warmup.swController} · caches=[${warmup.caches.join(', ')}]`);
        const runs = [];
        for (let i = 1; i <= RUNS; i++) {
            const r = await measureNavigation(client, `warm-${i}`);
            runs.push(r);
            report(`B/warm #${i}`, r);
        }
        return { series: 'warm', label: 'B — lần nạp lại trên CÙNG profile (cache + SW ấm)', warmup, runs };
    });
}

async function seriesCards() {
    return withChrome('cards', async client => {
        const warmup = await warmUp(client, 'cards');
        console.log(`  [warm-up] appReady=${fmt(warmup.appReadyMs)} ms · SW active=${warmup.swActive} · controller=${warmup.swController}`);
        const seeded = await seedCards(client, CARDS);
        console.log(`  [seed] ${seeded.dbName}: put ${seeded.count} thẻ, tổng trong store = ${seeded.totalInStore}`);
        const runs = [];
        for (let i = 1; i <= RUNS; i++) {
            const r = await measureNavigation(client, `cards-${i}`);
            runs.push(r);
            report(`C/cards #${i}`, r);
        }
        return { series: 'cards', label: `C — nạp lại cùng profile với ${CARDS} thẻ trong IndexedDB (điều kiện DoD T3.4)`, warmup, seeded, runs };
    });
}

/* ------------------------------------------------------------------ *
 * 8. In báo cáo
 * ------------------------------------------------------------------ */
function fmt(v) {
    return v == null ? '—' : String(Math.round(v * 10) / 10);
}

function hashFile(file) {
    try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return 'n/a'; }
}

function report(tag, r) {
    if (r.fatal) {
        console.log(`  ${tag}: FATAL ${r.fatal}`);
        return;
    }
    const obsDelta = (r.appReadyMs != null && r.appReadyObservedMs != null)
        ? Math.round((r.appReadyObservedMs - r.appReadyMs) * 10) / 10
        : null;
    console.log(
        `  ${tag}: app-ready ${fmt(r.appReadyMs)} ms · FCP ${fmt(r.fcpMs)} ms · ` +
        `longTask cuối ${r.longTaskLastEndMs == null ? '—' : fmt(r.longTaskLastEndMs) + ' ms'} ` +
        `(${r.longTaskCount} task/2s, tổng ${fmt(r.longTaskTotalMs)} ms) · ` +
        `SW ctrl=${r.sw.controller} · card=${r.card || 'null'}` +
        (obsDelta == null ? '' : ` · MO+${obsDelta} ms`) +
        (r.readyTimedOut ? ' · ⚠ HẾT HẠN chờ app-ready' : '')
    );
}

function stats(values) {
    const v = values.filter(x => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return { n: 0, min: null, median: null, max: null, values: [] };
    const mid = Math.floor(v.length / 2);
    const median = v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
    return { n: v.length, min: v[0], median, max: v[v.length - 1], values: v };
}

function summarize(series) {
    const ok = series.runs.filter(r => !r.fatal);
    const out = {
        series: series.series,
        label: series.label,
        runs: series.runs.length,
        validRuns: ok.length,
        appReady: stats(ok.map(r => r.appReadyMs)),
        fcp: stats(ok.map(r => r.fcpMs)),
        lastLongTask: stats(ok.map(r => r.longTaskLastEndMs)),
        longTaskCount: stats(ok.map(r => r.longTaskCount)),
        resources: stats(ok.map(r => r.resources?.count)),
        swControllerRuns: ok.filter(r => r.sw?.controller).length,
        timedOut: ok.filter(r => r.readyTimedOut).length,
        consoleErrors: ok.reduce((a, r) => a + (r.consoleErrors?.length || 0) + (r.exceptions?.length || 0), 0)
    };
    return out;
}

function printSummary(s) {
    const row = (name, st) => `| ${name} | ${st.n ? fmt(st.min) : '—'} | ${st.n ? '**' + fmt(st.median) + '**' : '—'} | ${st.n ? fmt(st.max) : '—'} |`;
    console.log(`\n### ${s.label}`);
    console.log(`lần chạy hợp lệ: ${s.validRuns}/${s.runs} · SW kiểm soát: ${s.swControllerRuns}/${s.validRuns} · hết hạn chờ app-ready: ${s.timedOut} · lỗi console: ${s.consoleErrors}`);
    console.log('| Chỉ số | min | median | max |');
    console.log('|---|---:|---:|---:|');
    console.log(row('app-ready (ms)', s.appReady));
    console.log(row('first-contentful-paint (ms)', s.fcp));
    console.log(row('long task cuối, ≤2 s (ms)', s.lastLongTask));
    console.log(row('số long task, ≤2 s', s.longTaskCount));
    console.log(row('số request tài nguyên', s.resources));
    const deltas = {};
    if (s.appReady.n && s.fcp.n) deltas.appReadyMinusFcp = +(s.appReady.median - s.fcp.median).toFixed(1);
    return deltas;
}

/* ------------------------------------------------------------------ *
 * 9. main
 * ------------------------------------------------------------------ */
async function main() {
    if (!fs.existsSync(indexPath)) {
        console.error(`Không thấy ${indexPath} — chạy \`npm run build\` trước khi đo.`);
        process.exit(2);
    }
    const html = fs.readFileSync(indexPath, 'utf8');
    const entry = (html.match(/\/assets\/index-[\w-]+\.js/) || ['(không thấy)'])[0];
    distEntryFile = path.basename(entry);
    const distMtime = fs.statSync(indexPath).mtime.toISOString();

    const { server, port } = await startServer();
    baseUrl = `http://localhost:${port}`;
    const startedAt = new Date().toISOString();
    console.log('== Môi trường đo ==');
    console.log(`Node:      ${process.version} (${process.platform} ${process.arch})`);
    console.log(`CPU:       ${(os.cpus()[0] || {}).model || '?'} × ${os.cpus().length}`);
    console.log(`RAM:       ${(os.totalmem() / 1073741824).toFixed(1)} GB`);
    console.log(`Chrome:    ${process.env.CHROME_PATH || chromePath}`);
    console.log(`dist:      index.html ${fs.statSync(indexPath).size} B, mtime ${distMtime}, entry ${entry}`);
    console.log(`URL:       ${baseUrl}${TARGET_PATH}  (cổng OS cấp, header cache giống firebase.json)`);
    console.log(`Viewport:  --window-size=1440,900, headless=new`);
    console.log(`Series:    ${SERIES.join(', ')} · ${RUNS} lần/series · ${CARDS} thẻ cho series C`);
    console.log(`Bắt đầu:   ${startedAt}`);
    if (!chromeVersion) console.log('(Chrome version sẽ in ở bảng JSON / dòng dưới)');

    const results = [];
    const distHashBefore = hashFile(indexPath);
    try {
        for (const name of SERIES) {
            console.log(`\n-- Series ${name} --`);
            if (name === 'cold') results.push(await seriesCold());
            else if (name === 'warm') results.push(await seriesWarm());
            else if (name === 'cards') results.push(await seriesCards());
            else console.log(`  (bỏ qua series lạ: ${name})`);
        }
    } finally {
        server.close();
    }
    const distHashAfter = hashFile(indexPath);
    const distStable = distHashBefore === distHashAfter;
    if (!distStable) {
        console.log(`\n⚠ dist/index.html ĐỔI giữa lúc đo (${distHashBefore.slice(0, 12)} → ${distHashAfter.slice(0, 12)}):`);
        console.log('  build khác đã ghi đè dist trong lúc đo → số liệu có thể trộn 2 build; chạy lại khi dist ổn định.');
    }

    console.log('\n== Tổng hợp (navigationStart → mốc, ms) ==');
    const summaries = results.map(s => {
        const d = printSummary(summarize(s));
        return { ...summarize(s), deltas: d };
    });

    if (chromeVersion) console.log(`\nChrome thực tế: ${chromeVersion}`);

    if (PRINT_JSON) {
        console.log('\n== JSON ==');
        console.log(JSON.stringify({ chromeVersion, startedAt, env: { node: process.version, platform: process.platform, cpu: (os.cpus()[0] || {}).model, cpus: os.cpus().length }, dist: { entry, mtime: distMtime, hashBefore: distHashBefore, hashAfter: distHashAfter, stable: distStable }, runs: RUNS, cards: CARDS, summaries, series: results }, null, 2));
    }
}

main().catch(err => {
    console.error('ĐO THẤT BẠI:', err && err.stack || err);
    process.exit(1);
});
