/**
 * Deterministic UI screenshots for visual regression checks.
 * node tools/screenshot_ui.mjs --out scratch/ui-after [--cards 3000]
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const args = process.argv.slice(2);
const arg = (n, d = null) => { const i = args.indexOf('--' + n); return i === -1 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const OUT = String(arg('out', 'scratch/ui'));
const CARDS = Number(arg('cards', 3000));
const root = process.cwd(), dist = path.join(root, 'dist'), PORT = 5197;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
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

async function seed(c, n) {
  return c.eval(`
    const dbs=await indexedDB.databases(); const names=dbs.map(d=>d.name).filter(Boolean);
    const dbName=names.find(x=>x.includes('celestial-vocab'))||'celestial-vocab-idb';
    const req=indexedDB.open(dbName);
    const db=await new Promise((res,rej)=>{req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error);req.onupgradeneeded=()=>{req.result.createObjectStore('vocabulary',{keyPath:'id'});}});
    const tx=db.transaction('vocabulary','readwrite'); const st=tx.objectStore('vocabulary');
    const now=Date.now(); const topics=['Celestial','Business','IELTS','Travel','Science'];
    for(let i=0;i<${n};i++){
      const status=i%5===0?'New':(i%3===0?'Learning':'Mastered');
      st.put({id:'seed-'+i,english:'seedword'+i,vietnamese:'từ vựng thử nghiệm số '+i,type:i%4===0?'noun':(i%4===1?'verb':(i%4===2?'adjective':'phrase')),pronunciation:'/siːd wɜːd '+i+'/',example:'This is a sample celestial example sentence number '+i+' that includes seedword'+i+' inside it for deep focus highlighting.',tags:[topics[i%topics.length]],srsStatus:status,srsDueDate:i%3===0?now-3600000:now+(i%40)*86400000,srsInterval:(i%30)+1,srsEaseFactor:2.5,isStarred:i%11===0,lapses:i%7,reps:i%20,anchor:0,modality:'en-vi',createdAt:now-i*1000,updatedAt:now-i*1000});
    }
    await new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error)}); db.close(); return {dbName,count:${n}};
  `);
}

await new Promise(r => server.listen(PORT, r));
fs.mkdirSync(OUT, { recursive: true });
const port = 9700 + Math.floor(Math.random() * 60);
const tmp = path.join(root, 'scratch', 'shot_' + Date.now()); fs.mkdirSync(tmp, { recursive: true });
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--window-size=1440,900', `--user-data-dir=${tmp}`, `--remote-debugging-port=${port}`, '--no-sandbox', '--hide-scrollbars', '--mute-audio', '--disable-extensions', '--force-device-scale-factor=1']);
let c;
try {
  let ws = null;
  for (let i = 0; i < 60; i++) { await sleep(200); try { const l = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const p = l.find(x => x.type === 'page'); if (p) { ws = p.webSocketDebuggerUrl; break; } } catch {} }
  if (!ws) throw new Error('no cdp');
  c = new CDP(ws); await c.init(); await c.send('Page.enable'); await c.send('Runtime.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await c.send('Page.navigate', { url: `http://localhost:${PORT}/?theme=dark` });
  await sleep(2000);
  console.log('seed', await seed(c, CARDS));
  await c.send('Page.navigate', { url: `http://localhost:${PORT}/?theme=dark` });
  await c.eval(`const t0=performance.now();while(!document.body?.classList.contains('app-ready')){await new Promise(r=>setTimeout(r,40));if(performance.now()-t0>20000)break;}return true;`);
  await sleep(1200);
  // deterministic: hide transient overlays and freeze CSS animations
  await c.eval(`
    document.getElementById('toast-container')?.replaceChildren();
    const style=document.createElement('style');
    style.textContent='#toast-container{display:none!important}#global-celebrate-canvas{display:none!important}#celestial-canvas{visibility:hidden!important}*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}';
    document.head.appendChild(style);
    const cc=document.getElementById('global-celebrate-canvas'); if(cc) cc.style.display='none';
    return true;
  `);
  await sleep(300);

  const shot = async (name) => {
    const { data } = await c.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
    console.log('shot', name);
  };

  await shot('study-dark');
  await c.eval(`document.getElementById('reveal-btn')?.click(); await new Promise(r=>setTimeout(r,700)); return true;`);
  await shot('study-flipped-dark');
  await c.eval(`document.getElementById('celestial-hub-btn')?.click(); await new Promise(r=>setTimeout(r,900)); return true;`);
  await shot('hub-overview-dark');
  await c.eval(`document.getElementById('tab-vocab-list')?.click(); await new Promise(r=>setTimeout(r,700)); return true;`);
  await shot('hub-words-dark');
  await c.eval(`document.getElementById('tab-profile-badges')?.click(); await new Promise(r=>setTimeout(r,1000)); return true;`);
  await shot('hub-badges-dark');
  console.log('badges-layout', await c.eval(`
    const w=document.querySelector('.achievements-wrapper');
    const m=document.querySelector('#manage-modal .manage-panel');
    const p=document.getElementById('profile-view-badges');
    const cs=w?getComputedStyle(w):null;
    return {
      wrapper: w?{width:Math.round(w.getBoundingClientRect().width),cols:cs.gridTemplateColumns,gap:cs.gap,items:w.children.length}:null,
      panel: m?{width:Math.round(m.getBoundingClientRect().width),cls:m.className}:null,
      pane: p?{width:Math.round(p.getBoundingClientRect().width),scrollW:p.scrollWidth,clientW:p.clientWidth}:null,
      viewport: innerWidth
    };
  `));
  await c.eval(`document.getElementById('tab-data-io')?.click(); await new Promise(r=>setTimeout(r,700)); return true;`);
  await shot('hub-io-dark');
  await c.eval(`document.querySelector('#manage-modal .modal-close-btn')?.click(); await new Promise(r=>setTimeout(r,700)); document.getElementById('toggle-dark-mode-btn')?.click(); await new Promise(r=>setTimeout(r,2600)); return true;`);
  await shot('study-light');
  await c.eval(`document.getElementById('celestial-hub-btn')?.click(); await new Promise(r=>setTimeout(r,1000)); return true;`);
  await shot('hub-overview-light');

  // mobile viewport
  await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await c.eval(`document.querySelector('#manage-modal .modal-close-btn')?.click(); await new Promise(r=>setTimeout(r,600)); if(!document.body.classList.contains('dark-mode')) document.getElementById('toggle-dark-mode-btn')?.click(); await new Promise(r=>setTimeout(r,800)); return true;`);
  await shot('study-mobile-dark');
} catch (e) { console.error('ERR', e); process.exitCode = 1; }
finally { c?.close(); chrome.kill('SIGKILL'); server.close(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
