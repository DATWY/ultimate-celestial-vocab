/**
 * Verifies that a large badge-unlock burst produces:
 *  - at most 3 concurrent toasts (queued, not stacked)
 *  - one confetti canvas / one rAF loop (not one per badge)
 * node tools/verify_celebrations.mjs
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const root = process.cwd(), dist = path.join(root, 'dist'), PORT = 5195;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(dist, p);
  if (fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); }
  else { res.writeHead(200, { 'Content-Type': 'text/html' }); fs.createReadStream(path.join(dist, 'index.html')).pipe(res); }
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
class CDP {
  constructor(u) { this.ws = new globalThis.WebSocket(u); this.id = 1; this.p = new Map(); }
  init() { return new Promise((r, j) => { this.ws.onopen = r; this.ws.onerror = j; this.ws.onmessage = e => { const d = JSON.parse(e.data); if (d.id && this.p.has(d.id)) { const x = this.p.get(d.id); this.p.delete(d.id); d.error ? x.j(new Error(d.error.message)) : x.r(d.result); } }; }); }
  send(m, p = {}) { const id = this.id++; return new Promise((r, j) => { this.p.set(id, { r, j }); this.ws.send(JSON.stringify({ id, method: m, params: p })); }); }
  async eval(x) { const r = await this.send('Runtime.evaluate', { expression: `(async()=>{${x}})()`, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '')); return r.result?.value; }
  close() { try { this.ws.close(); } catch {} }
}

await new Promise(r => server.listen(PORT, r));
const port = 9850 + Math.floor(Math.random() * 40);
const tmp = path.join(root, 'scratch', 'cel_' + Date.now()); fs.mkdirSync(tmp, { recursive: true });
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--window-size=1440,900', `--user-data-dir=${tmp}`, `--remote-debugging-port=${port}`, '--no-sandbox', '--hide-scrollbars', '--mute-audio', '--disable-extensions']);
let c;
const results = [];
const check = (n, ok, d) => { results.push({ n, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' :: ' + JSON.stringify(d) : ''}`); };
try {
  let ws = null;
  for (let i = 0; i < 60; i++) { await sleep(200); try { const l = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const p = l.find(x => x.type === 'page'); if (p) { ws = p.webSocketDebuggerUrl; break; } } catch {} }
  c = new CDP(ws); await c.init(); await c.send('Runtime.enable'); await c.send('Page.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await c.send('Page.navigate', { url: `http://localhost:${PORT}/?theme=dark` });
  await sleep(1800);
  await c.eval(`
    const dbs=await indexedDB.databases(); const names=dbs.map(d=>d.name).filter(Boolean);
    const dbName=names.find(x=>x.includes('celestial-vocab'))||'celestial-vocab-idb';
    const req=indexedDB.open(dbName);
    const db=await new Promise((res,rej)=>{req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error);req.onupgradeneeded=()=>{req.result.createObjectStore('vocabulary',{keyPath:'id'});}});
    const tx=db.transaction('vocabulary','readwrite'); const st=tx.objectStore('vocabulary'); const now=Date.now();
    for(let i=0;i<3000;i++) st.put({id:'seed-'+i,english:'seedword'+i,vietnamese:'nghĩa '+i,type:'noun',pronunciation:'/x/',example:'example seedword'+i,tags:['Test'],srsStatus:i%2?'Learning':'Mastered',srsDueDate:now-1000,srsInterval:2,srsEaseFactor:2.5,isStarred:false,lapses:i%7,reps:20,anchor:0,modality:'en-vi',createdAt:now-i*1000,updatedAt:now-i*1000});
    await new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error)}); db.close(); return true;
  `);
  await c.send('Page.navigate', { url: `http://localhost:${PORT}/?theme=dark` });
  await c.eval(`const t0=performance.now();while(!document.body?.classList.contains('app-ready')){await new Promise(r=>setTimeout(r,40));if(performance.now()-t0>15000)break;}return true;`);
  await sleep(800);
  // Trigger one review => gamification update => badge burst (3000-card deck).
  await c.eval(`document.getElementById('reveal-btn')?.click(); await new Promise(r=>setTimeout(r,650)); document.querySelector('.srs-btn[data-rating="3"]')?.click(); await new Promise(r=>setTimeout(r,450)); return true;`);
  // Now the burst has started; patch clearRect to count frames of the (single) loop.
  const patched = await c.eval(`
    window.__celebrateFrames = 0;
    const canvas = document.getElementById('global-celebrate-canvas');
    if (!canvas) return false;
    const ctx = canvas.getContext('2d');
    const orig = ctx.clearRect.bind(ctx);
    ctx.clearRect = (...args) => { window.__celebrateFrames++; return orig(...args); };
    return true;
  `);
  await c.eval(`await new Promise(r=>setTimeout(r,1200)); return true;`);
  const state = await c.eval(`
    return {
      patched: ${JSON.stringify(patched)},
      toasts: document.querySelectorAll('.toast-item').length,
      toastTitles: [...document.querySelectorAll('.toast-title')].map(e=>e.textContent),
      canvases: document.querySelectorAll('#global-celebrate-canvas').length,
      celebrateFrames: window.__celebrateFrames,
      framesWindowMs: 1200,
      domNodes: document.querySelectorAll('*').length
    };
  `);
  check('at most 3 concurrent toasts during badge burst', state.toasts > 0 && state.toasts <= 3, state);
  check('exactly one celebration canvas', state.canvases === 1, { canvases: state.canvases });
  check('one confetti rAF loop (≈60 clearRect/s, not N×)', state.patched && state.celebrateFrames > 0 && state.celebrateFrames < 220, { frames: state.celebrateFrames, windowMs: state.framesWindowMs });
  const after = await c.eval(`await new Promise(r=>setTimeout(r,5000)); return {toasts: document.querySelectorAll('.toast-item').length, frameCount: window.__celebrateFrames};`);
  check('queue keeps draining without stacking', after.toasts <= 3, after);

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
} catch (e) { console.error('ERR', e); process.exitCode = 1; }
finally { c?.close(); chrome.kill('SIGKILL'); server.close(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }

