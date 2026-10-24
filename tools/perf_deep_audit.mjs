/**
 * Deep performance audit harness (UI unchanged).
 * Usage:
 *   node tools/perf_deep_audit.mjs --url http://127.0.0.1:5173 --cards 3000 --label dev
 *   node tools/perf_deep_audit.mjs --dist --cards 3000 --label prod
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const args = process.argv.slice(2);
function arg(name, fallback = null) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const USE_DIST = Boolean(arg('dist', false));
const CARDS = Number(arg('cards', 3000));
const LABEL = String(arg('label', USE_DIST ? 'prod' : 'dev'));
const SHOTS = arg('shots', null);
const TARGET_PATH = String(arg('path', '/?theme=dark'));
const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');
const PORT = 5199;
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const mime = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.mp3': 'audio/mpeg', '.woff2': 'font/woff2'
};

let server = null;
if (USE_DIST) {
  server = http.createServer((req, res) => {
    let reqPath = decodeURIComponent(req.url.split('?')[0]);
    if (reqPath === '/') reqPath = '/index.html';
    const filePath = path.join(distDir, reqPath);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      res.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    } else {
      const indexPath = path.join(distDir, 'index.html');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      fs.createReadStream(indexPath).pipe(res);
    }
  });
}

class CDP {
  constructor(wsUrl) {
    this.ws = new globalThis.WebSocket(wsUrl);
    this.id = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }
  init() {
    return new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = reject;
      this.ws.onmessage = (evt) => {
        const data = JSON.parse(evt.data);
        if (data.id && this.pending.has(data.id)) {
          const { resolve: r, reject: j } = this.pending.get(data.id);
          this.pending.delete(data.id);
          if (data.error) j(new Error(data.error.message));
          else r(data.result);
        } else if (data.method) {
          const cbs = this.listeners.get(data.method) || [];
          cbs.forEach(cb => cb(data.params));
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
      expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true
    });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text + ': ' + (res.exceptionDetails.exception?.description || ''));
    return res.result?.value;
  }
  close() { try { this.ws.close(); } catch {} }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  if (server) await new Promise(r => server.listen(PORT, r));
  const baseUrl = USE_DIST ? `http://localhost:${PORT}` : `http://localhost:5173`;
  const cdpPort = 9410 + Math.floor(Math.random() * 60);
  const tmpDir = path.join(rootDir, 'scratch', 'perf_audit_' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });
  const chrome = spawn(chromePath, [
    '--headless=new', '--window-size=1440,900', `--user-data-dir=${tmpDir}`,
    `--remote-debugging-port=${cdpPort}`, '--no-sandbox', '--hide-scrollbars',
    '--disable-extensions', '--disable-background-networking', '--mute-audio'
  ]);
  let client;
  const report = { label: LABEL, url: baseUrl + TARGET_PATH, cards: CARDS, chromeVersion: null };

  try {
    let wsUrl = null;
    for (let i = 0; i < 80; i++) {
      await sleep(200);
      try {
        const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
        const ver = await res.json();
        report.chromeVersion = ver['Browser'];
        const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
        const tab = list.find(t => t.type === 'page');
        if (tab) { wsUrl = tab.webSocketDebuggerUrl; break; }
      } catch {}
    }
    if (!wsUrl) throw new Error('No CDP page');
    client = new CDP(wsUrl);
    await client.init();
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Performance.enable');
    await client.send('Profiler.enable');
    await client.send('Log.enable');
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    // Collect console + long tasks from the start
    const consoleLines = [];
    client.on('Runtime.consoleAPICalled', p => {
      try { consoleLines.push(`[${p.type}] ` + p.args.map(a => a.value ?? a.description ?? '').join(' ')); } catch {}
    });
    client.on('Runtime.exceptionThrown', p => consoleLines.push('[exception] ' + (p.exceptionDetails?.text || '')));

    await client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        window.__longTasks = [];
        try {
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) window.__longTasks.push({ start: e.startTime, dur: e.duration, name: e.name });
          }).observe({ entryTypes: ['longtask'] });
        } catch {}
        window.__frames = [];
        (function rafLoop(t) { window.__frames.push(t); if (window.__frames.length < 100000) requestAnimationFrame(rafLoop); })(performance.now());
      `
    });

    console.log(`[${LABEL}] navigating ${baseUrl}${TARGET_PATH}`);
    await client.send('Page.navigate', { url: baseUrl + TARGET_PATH });
    await sleep(2500);

    // Seed cards (works for both dev & prod DB names: try both)
    if (CARDS > 0) {
      const seeded = await client.eval(`
        const dbs = await indexedDB.databases();
        const names = dbs.map(d => d.name).filter(Boolean);
        const dbName = names.find(n => n.includes('celestial-vocab')) || 'celestial-vocab-idb';
        const request = indexedDB.open(dbName);
        const db = await new Promise((res, rej) => { request.onsuccess = () => res(request.result); request.onerror = () => rej(request.error); request.onupgradeneeded = () => { request.result.createObjectStore('vocabulary', { keyPath: 'id' }); }; });
        const tx = db.transaction('vocabulary', 'readwrite');
        const store = tx.objectStore('vocabulary');
        const now = Date.now();
        const topics = ['Celestial', 'Business', 'IELTS', 'Travel', 'Science'];
        for (let i = 0; i < ${CARDS}; i++) {
          const due = i % 3 === 0 ? now - 3600000 : now + (i % 40) * 86400000;
          const status = i % 5 === 0 ? 'New' : (i % 3 === 0 ? 'Learning' : 'Mastered');
          store.put({
            id: 'seed-' + i,
            english: 'seedword' + i,
            vietnamese: 'từ vựng thử nghiệm số ' + i,
            type: i % 4 === 0 ? 'noun' : (i % 4 === 1 ? 'verb' : (i % 4 === 2 ? 'adjective' : 'phrase')),
            pronunciation: '/siːd wɜːd ' + i + '/',
            example: 'This is a sample celestial example sentence number ' + i + ' that includes seedword' + i + ' inside it for deep focus highlighting.',
            tags: [topics[i % topics.length]],
            srsStatus: status,
            srsDueDate: due,
            srsInterval: (i % 30) + 1,
            srsEaseFactor: 2.5,
            isStarred: i % 11 === 0,
            lapses: i % 7,
            reps: i % 20,
            anchor: 0,
            modality: 'en-vi',
            createdAt: now - i * 1000,
            updatedAt: now - i * 1000
          });
        }
        await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
        db.close();
        return { dbName, count: ${CARDS}, names };
      `);
      report.seeded = seeded;
      console.log('[seed]', JSON.stringify(seeded));

      // reload with data
      await client.send('Page.navigate', { url: baseUrl + TARGET_PATH });
      await sleep(1200);
    }

    // Wait for app ready / first paint
    const readyAt = await client.eval(`
      const t0 = performance.now();
      await new Promise(res => {
        const check = () => {
          if (document.body.classList.contains('app-ready')) return res();
          if (performance.now() - t0 > 20000) return res();
          setTimeout(check, 50);
        };
        check();
      });
      return { readyMs: performance.now(), hasAppReady: document.body.classList.contains('app-ready') };
    `);
    report.ready = readyAt;

    // wait for idle tasks (audio/sync) to run a bit
    await sleep(4000);

    const metricsNow = async () => {
      const m = await client.send('Performance.getMetrics');
      const o = {};
      for (const x of m.metrics) o[x.name] = x.value;
      return o;
    };
    const m0 = await metricsNow();

    // Count DOM elements, CSS rules, animations
    report.dom = await client.eval(`
      const all = document.querySelectorAll('*');
      let cssRules = 0;
      for (const sheet of document.styleSheets) {
        try { cssRules += sheet.cssRules.length; } catch {}
      }
      const anims = document.getAnimations ? document.getAnimations() : [];
      const animByProp = {};
      for (const a of anims) {
        const eff = a.effect;
        const target = eff && eff.target;
        const key = (target ? (target.id ? '#' + target.id : target.className || target.tagName) : '?') + ' :: ' + (a.animationName || 'transition');
        animByProp[key] = (animByProp[key] || 0) + 1;
      }
      return {
        elements: all.length,
        cssRules,
        stylesheets: document.styleSheets.length,
        runningAnimations: anims.length,
        animations: animByProp,
        canvases: document.querySelectorAll('canvas').length,
        iframes: document.querySelectorAll('iframe').length
      };
    `);

    // Long tasks captured so far
    report.longTasksAtStart = await client.eval(`
      const lt = (window.__longTasks || []).slice();
      return { count: lt.length, total: Math.round(lt.reduce((s, x) => s + x.dur, 0)), max: Math.round(Math.max(0, ...lt.map(x => x.dur))), top: lt.sort((a,b)=>b.dur-a.dur).slice(0,10) };
    `);

    // --- CPU profile during scripted interaction ---
    await client.send('Profiler.start');
    const t0 = Date.now();
    // Simulate real study interaction: flip card, rate, next
    const interaction = await client.eval(`
      const results = [];
      const press = (key, code, keyCode) => {
        const e = new KeyboardEvent('keydown', { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true });
        document.dispatchEvent(e);
        document.body.dispatchEvent(e);
      };
      const t = [];
      for (let i = 0; i < 12; i++) {
        const s = performance.now();
        document.getElementById('flashcard')?.click();
        await new Promise(r => setTimeout(r, 120));
        '1234'.split('').forEach((k, idx) => press(k, 'Digit' + k, 49 + idx));
        await new Promise(r => setTimeout(r, 180));
        t.push(performance.now() - s);
      }
      return { rounds: t.length, avgMs: t.reduce((a,b)=>a+b,0)/t.length, maxMs: Math.max(...t) };
    `);
    const elapsed = Date.now() - t0;
    const profile = await client.send('Profiler.stop');
    report.interaction = { elapsedMs: elapsed, ...interaction };

    // Aggregate self time by function
    const nodes = profile.profile.nodes;
    const byId = new Map(nodes.map(n => [n.id, n]));
    const selfTicks = new Map();
    const totalSamples = profile.profile.samples.length;
    for (const id of profile.profile.samples) selfTicks.set(id, (selfTicks.get(id) || 0) + 1);
    const agg = new Map();
    for (const [id, ticks] of selfTicks) {
      const n = byId.get(id);
      if (!n) continue;
      const f = n.callFrame;
      const key = `${f.functionName || '(anonymous)'} @ ${(f.url || '').replace(baseUrl, '').split('/').pop()}:${f.lineNumber + 1}`;
      agg.set(key, (agg.get(key) || 0) + ticks);
    }
    report.cpuProfile = {
      totalSamples,
      durationMs: Math.round((profile.profile.endTime - profile.profile.startTime) / 1000),
      top: [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([fn, ticks]) => ({
        fn, ticks, pct: +(ticks / Math.max(1, totalSamples) * 100).toFixed(1)
      }))
    };

    const m1 = await metricsNow();
    const delta = {};
    for (const k of ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'JSHeapUsedSize', 'Nodes', 'Documents', 'Frames', 'JSEventListeners']) {
      if (m1[k] !== undefined) delta[k] = +(m1[k] - (m0[k] || 0)).toFixed(3);
    }
    report.metricsDuringInteraction = delta;

    // --- Frame smoothness while showing card + idle ---
    const fps = await client.eval(`
      window.__frames = [];
      await new Promise(r => setTimeout(r, 2000));
      const f = window.__frames;
      if (f.length < 2) return { frames: f.length };
      const deltas = [];
      for (let i = 1; i < f.length; i++) deltas.push(f[i] - f[i-1]);
      deltas.sort((a,b)=>a-b);
      const pick = p => deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * p))];
      return {
        frames: f.length,
        fps: +(1000 / (deltas.reduce((a,b)=>a+b,0) / deltas.length)).toFixed(1),
        p50: +pick(0.5).toFixed(1), p95: +pick(0.95).toFixed(1), max: +deltas[deltas.length-1].toFixed(1),
        over33: deltas.filter(d => d > 33.4).length
      };
    `);
    report.idleFps = fps;

    // --- Screenshot study view ---
    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      const shot = async (name) => {
        const { data } = await client.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(SHOTS, `${LABEL}-${name}.png`), Buffer.from(data, 'base64'));
      };
      await shot('study-dark');
      await client.eval(`document.getElementById('flashcard')?.click(); await new Promise(r=>setTimeout(r,500)); return true;`);
      await shot('study-flipped');
      await client.eval(`window.__celestialAudit?.openHub?.('overview'); await new Promise(r=>setTimeout(r,900)); return true;`);
      await shot('hub');
    }

    // --- Time specific operations via audit hook / DOM ---
    report.ops = await client.eval(`
      const out = {};
      const measure = (label, fn, n = 1) => {
        const s = performance.now();
        let r;
        for (let i = 0; i < n; i++) r = fn();
        out[label] = +((performance.now() - s) / n).toFixed(2);
        return r;
      };
      // open/close hub timing
      window.__celestialAudit?.openHub?.('words');
      await new Promise(r => setTimeout(r, 700));
      measure('hubWordListScan', () => document.querySelectorAll('#word-list-display .word-card').length);
      out.wordCards = document.querySelectorAll('#word-list-display .word-card').length;
      return out;
    `);

    report.consoleTail = consoleLines.slice(-40);
    report.longTasksFinal = await client.eval(`
      const lt = (window.__longTasks || []).slice();
      return { count: lt.length, total: Math.round(lt.reduce((s, x) => s + x.dur, 0)), max: Math.round(Math.max(0, ...lt.map(x => x.dur))), top: lt.sort((a,b)=>b.dur-a.dur).slice(0,15) };
    `);

    console.log('\n================ REPORT ' + LABEL + ' ================');
    console.log(JSON.stringify(report, null, 2));

    const outFile = path.join(rootDir, 'reports', `perf-${LABEL}-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
    console.log('written', outFile);
  } catch (e) {
    console.error('AUDIT ERROR', e);
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } finally {
    client?.close();
    chrome.kill('SIGKILL');
    if (server) server.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

main();


