/**
 * Interaction-focused perf harness: flip / rate / hub scroll under CPU throttle.
 * node tools/perf_interact.mjs --cards 3000 --label base [--throttle 4]
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const args = process.argv.slice(2);
const arg = (n, d = null) => { const i = args.indexOf('--' + n); return i === -1 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const CARDS = Number(arg('cards', 3000));
const THROTTLE = Number(arg('throttle', 4));
const LABEL = String(arg('label', 'base'));
const INJECT_CSS = arg('css', null);
const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');
const PORT = 5199;
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(distDir, p);
  if (fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); }
  else { res.writeHead(200, { 'Content-Type': 'text/html' }); fs.createReadStream(path.join(distDir, 'index.html')).pipe(res); }
});

class CDP {
  constructor(u) { this.ws = new globalThis.WebSocket(u); this.id = 1; this.p = new Map(); this.l = new Map(); }
  init() { return new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; this.ws.onmessage = e => { const d = JSON.parse(e.data); if (d.id && this.p.has(d.id)) { const { r, j } = this.p.get(d.id); this.p.delete(d.id); d.error ? j(new Error(d.error.message)) : r(d.result); } else if (d.method) (this.l.get(d.method) || []).forEach(cb => cb(d.params)); }; }); }
  on(m, cb) { if (!this.l.has(m)) this.l.set(m, []); this.l.get(m).push(cb); }
  send(m, params = {}) { const id = this.id++; return new Promise((r, j) => { this.p.set(id, { r, j }); this.ws.send(JSON.stringify({ id, method: m, params })); }); }
  async eval(x) { const r = await this.send('Runtime.evaluate', { expression: `(async()=>{${x}})()`, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '')); return r.result?.value; }
  close() { try { this.ws.close(); } catch {} }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function seed(client, cards) {
  return client.eval(`
    const dbs = await indexedDB.databases(); const names = dbs.map(d=>d.name).filter(Boolean);
    const dbName = names.find(n=>n.includes('celestial-vocab')) || 'celestial-vocab-idb';
    const req = indexedDB.open(dbName);
    const db = await new Promise((res,rej)=>{req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error);req.onupgradeneeded=()=>{req.result.createObjectStore('vocabulary',{keyPath:'id'});}});
    const tx = db.transaction('vocabulary','readwrite'); const st = tx.objectStore('vocabulary');
    const now = Date.now(); const topics=['Celestial','Business','IELTS','Travel','Science'];
    for (let i=0;i<${cards};i++){
      const status = i%5===0?'New':(i%3===0?'Learning':'Mastered');
      st.put({id:'seed-'+i, english:'seedword'+i, vietnamese:'từ vựng thử nghiệm số '+i, type:i%4===0?'noun':(i%4===1?'verb':(i%4===2?'adjective':'phrase')), pronunciation:'/siːd wɜːd '+i+'/', example:'This is a sample celestial example sentence number '+i+' that includes seedword'+i+' inside it for deep focus highlighting.', tags:[topics[i%topics.length]], srsStatus:status, srsDueDate: i%3===0?now-3600000:now+(i%40)*86400000, srsInterval:(i%30)+1, srsEaseFactor:2.5, isStarred:i%11===0, lapses:i%7, reps:i%20, anchor:0, modality:'en-vi', createdAt:now-i*1000, updatedAt:now-i*1000});
    }
    await new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error)}); db.close();
    return {dbName, count:${cards}};
  `);
}

async function main() {
  await new Promise(r => server.listen(PORT, r));
  const port = 9500 + Math.floor(Math.random() * 80);
  const tmp = path.join(rootDir, 'scratch', 'pi_' + Date.now()); fs.mkdirSync(tmp, { recursive: true });
  const chrome = spawn(chromePath, ['--headless=new', '--window-size=1440,900', `--user-data-dir=${tmp}`, `--remote-debugging-port=${port}`, '--no-sandbox', '--hide-scrollbars', '--mute-audio', '--disable-extensions']);
  let c;
  try {
    let ws = null;
    for (let i = 0; i < 60; i++) { await sleep(200); try { const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const p = t.find(x => x.type === 'page'); if (p) { ws = p.webSocketDebuggerUrl; break; } } catch {} }
    if (!ws) throw new Error('no cdp');
    c = new CDP(ws); await c.init();
    await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Performance.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await c.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__lt=[];new PerformanceObserver(l=>{for(const e of l.getEntries())__lt.push({s:e.startTime,d:e.duration})}).observe({entryTypes:['longtask']});
      window.__f=[];(function r(t){__f.push(t);if(__f.length<200000)requestAnimationFrame(r)})(0);`
    });
    await c.send('Page.navigate', { url: `http://localhost:${PORT}/?theme=dark` });
    await sleep(2000);
    console.log('seed', await seed(c, CARDS));
    await c.send('Page.navigate', { url: `http://localhost:${PORT}/?theme=dark` });
    await c.eval(`const t0=performance.now();while(!document.body?.classList.contains('app-ready')){await new Promise(r=>setTimeout(r,40));if(performance.now()-t0>20000)break;}return performance.now()`);
    await sleep(1500);
    // capture the badge/confetti storm that follows a large import
    const startup = await c.eval(`
      const f0 = window.__f.length;
      const t0 = performance.now();
      await new Promise(r=>setTimeout(r,1800));
      const f = window.__f.slice(f0);
      const d = []; for (let i=1;i<f.length;i++) d.push(f[i]-f[i-1]);
      d.sort((a,b)=>a-b);
      return {
        toasts: document.querySelectorAll('.toast-item').length,
        toastNodes: document.querySelectorAll('#toast-container *').length,
        celebrateCanvases: document.querySelectorAll('#global-celebrate-canvas').length,
        animations: document.getAnimations().length,
        domNodes: document.querySelectorAll('*').length,
        frames: d.length,
        fps: d.length ? +(1000/(d.reduce((a,b)=>a+b,0)/d.length)).toFixed(1) : null,
        p95: d.length ? +d[Math.floor(d.length*0.95)].toFixed(1) : null,
        max: d.length ? +d[d.length-1].toFixed(1) : null
      };
    `);
    // clear toast backlog so steady state matches normal use
    await c.eval(`document.getElementById('toast-container')?.replaceChildren(); return true;`);
    await sleep(800);

    await c.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    await sleep(300);
    if (INJECT_CSS) {
      await c.eval(`const s=document.createElement('style'); s.textContent=${JSON.stringify(INJECT_CSS)}; document.head.appendChild(s); return true;`);
      await sleep(200);
    }

    await c.send('Profiler.enable');
    await c.send('Profiler.start');
    const result = await c.eval(`
      const out = { throttle: ${THROTTLE} };
      const cardsDone = [];
      // helper: wait until next paint
      const raf = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const press = (k, code, kc) => { const e = new KeyboardEvent('keydown',{key:k,code,keyCode:kc,which:kc,bubbles:true,cancelable:true}); document.dispatchEvent(e); document.body.dispatchEvent(e); };
      const cardEl = document.getElementById('flashcard');
      const englishEl = document.getElementById('card-english');

      // measure one flip: click reveal -> wait for is-flipped class + two paints
      const flipTimes = [];
      const reveal = document.getElementById('reveal-btn') || cardEl;
      for (let i=0;i<10;i++){
        if (!cardEl.classList.contains('is-flipped')) {
          const s = performance.now();
          reveal.click();
          let n=0; while(!cardEl.classList.contains('is-flipped') && n<180){ await raf(); n++; }
          await raf();
          flipTimes.push(performance.now()-s);
          await new Promise(r=>setTimeout(r,520));
        }
        if (cardEl.classList.contains('is-flipped')) { cardEl.click(); await new Promise(r=>setTimeout(r,520)); }
      }
      flipTimes.sort((a,b)=>a-b);
      out.flip = { n: flipTimes.length, avg:+(flipTimes.reduce((a,b)=>a+b,0)/Math.max(1,flipTimes.length)).toFixed(1), p50:+flipTimes[Math.floor(flipTimes.length/2)].toFixed(1), max:+flipTimes[flipTimes.length-1].toFixed(1) };

      // measure 10 rating rounds (flip, wait for transition end, rate, wait for next english)
      const rateTimes = [];
      for (let i=0;i<10;i++){
        if (!cardEl.classList.contains('is-flipped')) { reveal.click(); await new Promise(r=>setTimeout(r,540)); }
        const before = englishEl.textContent;
        const btn = document.querySelector('.srs-btn[data-rating="3"]');
        btn?.focus({ preventScroll: true });
        await raf();
        const s = performance.now();
        btn?.click();
        let n=0; while (englishEl.textContent === before && n < 240) { await raf(); n++; }
        rateTimes.push(performance.now()-s);
        await new Promise(r=>setTimeout(r,100));
      }
      rateTimes.sort((a,b)=>a-b);
      out.rate = { n: rateTimes.length, avg:+(rateTimes.reduce((a,b)=>a+b,0)/Math.max(1,rateTimes.length)).toFixed(1), p50:+rateTimes[Math.floor(rateTimes.length/2)].toFixed(1), max:+rateTimes[rateTimes.length-1].toFixed(1) };

      // open hub via click and measure first paint after click
      const hub = document.getElementById('celestial-hub-btn');
      const hs = performance.now();
      if (hub) hub.click();
      await raf(); await raf();
      out.hubOpen = +(performance.now()-hs).toFixed(1);
      await new Promise(r=>setTimeout(r,900));
      // switch to the words tab (renders the 40-card page)
      document.getElementById('tab-vocab-list')?.click();
      await new Promise(r=>setTimeout(r,800));
      out.hubCards = document.querySelectorAll('#word-list-display .word-card').length;
      out.hubDomNodes = document.querySelectorAll('*').length;
      out.cardHeights = [...document.querySelectorAll('#word-list-display .word-card')].slice(0, 12).map(el => Math.round(el.getBoundingClientRect().height));
      // preload ~400 cards (debounced loading) then measure scrolling over them
      const list = document.querySelector('#word-list-display');
      const scroller = document.getElementById('word-list-section') || list?.parentElement;
      const preStart = performance.now();
      let guard = 0;
      if (scroller) {
        while (document.querySelectorAll('#word-list-display .word-card').length < 400 && guard < 30) {
          scroller.scrollTop = scroller.scrollHeight;
          await new Promise(r => setTimeout(r, 180));
          guard++;
        }
        out.preloadMs = +(performance.now() - preStart).toFixed(1);
        out.preloadCards = document.querySelectorAll('#word-list-display .word-card').length;
        scroller.scrollTop = 0;
        await new Promise(r => setTimeout(r, 120));
      }
      window.__f = [];
      if (scroller) { for (let i=0;i<80;i++){ scroller.scrollTop += 420; await raf(); } }
      const fd = []; const f = window.__f;
      for (let i=1;i<f.length;i++) fd.push(f[i]-f[i-1]);
      fd.sort((a,b)=>a-b);
      out.scroll = fd.length ? { frames: fd.length, fps:+(1000/(fd.reduce((a,b)=>a+b,0)/fd.length)).toFixed(1), p95:+fd[Math.floor(fd.length*0.95)].toFixed(1), max:+fd[fd.length-1].toFixed(1) } : null;
      out.scrollCards = document.querySelectorAll('#word-list-display .word-card').length;
      out.scrollNodes = document.querySelectorAll('*').length;
      // rebuilding the list while it is long (refresh / star / delete do this)
      const refreshBtn = document.getElementById('manage-refresh-list-btn');
      if (refreshBtn) {
        const rs = performance.now();
        refreshBtn.click();
        out.refreshMs = +(performance.now() - rs).toFixed(1);
        out.refreshCards = document.querySelectorAll('#word-list-display .word-card').length;
      }
      out.domNodes = document.querySelectorAll('*').length;
      out.runningAnims = document.getAnimations().length;
      out.longTasks = (window.__lt||[]).slice().sort((a,b)=>b.d-a.d).slice(0,10);
      out.startup = ${JSON.stringify(startup)};
      return out;
    `);
    const prof = await c.send('Profiler.stop');
    {
      const nodes = new Map(prof.profile.nodes.map(n => [n.id, n]));
      const ticks = new Map();
      for (const id of prof.profile.samples) ticks.set(id, (ticks.get(id) || 0) + 1);
      const agg = new Map();
      for (const [id, n] of ticks) {
        const f = nodes.get(id)?.callFrame;
        if (!f) continue;
        const key = `${f.functionName || '(anonymous)'} @ ${(f.url || '').split('/').pop()}:${f.lineNumber + 1}`;
        agg.set(key, (agg.get(key) || 0) + n);
      }
      const total = prof.profile.samples.length || 1;
      result.cpuTop = [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([fn, n]) => ({ fn, pct: +(n / total * 100).toFixed(1) }));
    }
    const m = await c.send('Performance.getMetrics');
    const mm = {}; for (const x of m.metrics) mm[x.name] = x.value;
    result.metrics = { TaskDuration: +mm.TaskDuration.toFixed(2), ScriptDuration: +mm.ScriptDuration.toFixed(2), LayoutDuration: +mm.LayoutDuration.toFixed(2), RecalcStyleDuration: +mm.RecalcStyleDuration.toFixed(2), JSHeapMB: +(mm.JSHeapUsedSize / 1048576).toFixed(1), Nodes: mm.Nodes };
    console.log(JSON.stringify({ label: LABEL, cards: CARDS, ...result }, null, 2));
    const outFile = path.join(rootDir, 'reports', `perf-interact-${LABEL}-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify({ label: LABEL, cards: CARDS, ...result }, null, 2));
    console.log('written', outFile);
  } catch (e) { console.error('ERR', e); process.exitCode = 1; }
  finally { c?.close(); chrome.kill('SIGKILL'); server.close(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
}
main();

