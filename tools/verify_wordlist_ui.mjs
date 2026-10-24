/**
 * Functional check for the refactored word list (delegated actions, string
 * rendering, debounced infinite scroll). Serves dist and drives a real Chrome.
 * node tools/verify_wordlist_ui.mjs
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const root = process.cwd(), dist = path.join(root, 'dist'), PORT = 5196;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(dist, p);
  if (fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); }
  else { res.writeHead(200, { 'Content-Type': 'text/html' }); fs.createReadStream(path.join(dist, 'index.html')).pipe(res); }
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(u) { this.ws = new globalThis.WebSocket(u); this.id = 1; this.p = new Map(); this.events = []; }
  init() { return new Promise((r, j) => { this.ws.onopen = r; this.ws.onerror = j; this.ws.onmessage = e => { const d = JSON.parse(e.data); if (d.id && this.p.has(d.id)) { const x = this.p.get(d.id); this.p.delete(d.id); d.error ? x.j(new Error(d.error.message)) : x.r(d.result); } else if (d.method === 'Runtime.consoleAPICalled' || d.method === 'Runtime.exceptionThrown') this.events.push(d); }; }); }
  send(m, p = {}) { const id = this.id++; return new Promise((r, j) => { this.p.set(id, { r, j }); this.ws.send(JSON.stringify({ id, method: m, params: p })); }); }
  async eval(x) { const r = await this.send('Runtime.evaluate', { expression: `(async()=>{${x}})()`, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '')); return r.result?.value; }
  close() { try { this.ws.close(); } catch {} }
}

await new Promise(r => server.listen(PORT, r));
const port = 9800 + Math.floor(Math.random() * 50);
const tmp = path.join(root, 'scratch', 'wl_' + Date.now()); fs.mkdirSync(tmp, { recursive: true });
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--window-size=1440,900', `--user-data-dir=${tmp}`, `--remote-debugging-port=${port}`, '--no-sandbox', '--hide-scrollbars', '--mute-audio', '--disable-extensions']);
let c;
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + JSON.stringify(detail) : ''}`); };
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
    for(let i=0;i<100;i++) st.put({id:'seed-'+i,english:'seedword'+i,vietnamese:'nghĩa '+i,type:'noun',pronunciation:'/x/',example:'example seedword'+i,tags:['Test'],srsStatus:i%2?'Learning':'Mastered',srsDueDate:now-1000,srsInterval:2,srsEaseFactor:2.5,isStarred:false,lapses:0,reps:1,anchor:0,modality:'en-vi',createdAt:now-i*1000,updatedAt:now-i*1000});
    await new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error)}); db.close(); return true;
  `);
  await c.send('Page.navigate', { url: `http://localhost:${PORT}/?theme=dark` });
  await c.eval(`const t0=performance.now();while(!document.body?.classList.contains('app-ready')){await new Promise(r=>setTimeout(r,40));if(performance.now()-t0>15000)break;}return true;`);
  await sleep(800);
  await c.eval(`document.getElementById('toast-container')?.replaceChildren(); return true;`);
  await c.eval(`document.getElementById('celestial-hub-btn')?.click(); await new Promise(r=>setTimeout(r,800)); document.getElementById('tab-vocab-list')?.click(); await new Promise(r=>setTimeout(r,800)); return true;`);

  const initial = await c.eval(`return {cards: document.querySelectorAll('#word-list-display .word-card').length, first: document.querySelector('#word-list-display .word-card .word-english')?.textContent, count: document.getElementById('manage-total-count')?.textContent};`);
  check('renders initial 40 cards', initial.cards === 40, initial);

  const star = await c.eval(`
    const btn=document.querySelector('#word-list-display .word-card .star-btn-card');
    const before=btn.classList.contains('starred');
    btn.click(); await new Promise(r=>setTimeout(r,150));
    const after=btn.classList.contains('starred');
    btn.click(); await new Promise(r=>setTimeout(r,150));
    return {before, after, restored: btn.classList.contains('starred')};
  `);
  check('star action toggles via delegation', star.before === false && star.after === true && star.restored === false, star);

  const del = await c.eval(`
    const card=document.querySelector('#word-list-display .word-card');
    const id=card.dataset.wordId;
    card.querySelector('.delete-btn-card').click();
    await new Promise(r=>setTimeout(r,450));
    const confirmOpen=!document.getElementById('popup-modal')?.classList.contains('hidden');
    document.getElementById('popup-ok-btn')?.click();
    await new Promise(r=>setTimeout(r,700));
    return {
      id, confirmOpen,
      remaining: document.querySelectorAll('#word-list-display .word-card').length,
      stillThere: !!document.querySelector('#word-list-display .word-card[data-word-id="'+id+'"]'),
      countText: document.getElementById('manage-total-count')?.textContent
    };
  `);
  check('delete opens confirm, removes card and updates count', del.confirmOpen && !del.stillThere && del.remaining === 39, del);
  await c.eval(`document.getElementById('popup-ok-btn')?.click(); document.getElementById('close-popup-modal-btn')?.click(); await new Promise(r=>setTimeout(r,300)); return true;`);

  const search = await c.eval(`
    const input=document.getElementById('manage-search-input') || document.getElementById('manage-search') || document.querySelector('#manage-view-words input[type="search"], #manage-view-words input[type="text"]');
    if(!input) return {error:'no search input'};
    input.value='zzzznomatch'; input.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,800));
    const emptyShown = !!document.querySelector('#word-list-display .vocab-empty-results');
    const afterEmpty = document.querySelectorAll('#word-list-display .word-card').length;
    input.value=''; input.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,800));
    const restored = document.querySelectorAll('#word-list-display .word-card').length;
    return {value: input.value, id: input.id, emptyShown, afterEmpty, restored};
  `);
  check('search filters the delegated list and restores', !search.error && search.emptyShown && search.afterEmpty === 0 && search.restored === 40, search);

  const scroll = await c.eval(`
    const input=document.getElementById('manage-search-input') || document.getElementById('manage-search') || document.querySelector('#manage-view-words input[type="search"], #manage-view-words input[type="text"]');
    input.value=''; input.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,600));
    const section=document.getElementById('word-list-section');
    const before=document.querySelectorAll('#word-list-display .word-card').length;
    section.scrollTop=section.scrollHeight;
    await new Promise(r=>setTimeout(r,900));
    const after=document.querySelectorAll('#word-list-display .word-card').length;
    return {before, after, sentinel: document.getElementById('word-list-sentinel')?.textContent.trim().slice(0,60)};
  `);
  check('infinite scroll loads another page after pause', scroll.after > scroll.before, scroll);

  const edit = await c.eval(`
    const card=document.querySelector('#word-list-display .word-card');
    const english=card.querySelector('.word-english').textContent;
    card.querySelector('.edit-btn-card').click();
    await new Promise(r=>setTimeout(r,500));
    const modal=document.getElementById('add-edit-modal');
    const open=modal && !modal.classList.contains('hidden');
    const value=document.getElementById('input-english')?.value;
    document.getElementById('close-add-edit-modal-btn')?.click();
    await new Promise(r=>setTimeout(r,400));
    return {english, open, value, closed: modal?.classList.contains('hidden')};
  `);
  check('edit action opens the prefilled editor', edit.open && edit.value === edit.english, edit);

  const errors = c.events.filter(e => e.method === 'Runtime.exceptionThrown').map(e => e.params.exceptionDetails?.text || 'exception');
  const consoleErrors = c.events.filter(e => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error').map(e => (e.params.args || []).map(a => a.value || a.description || '').join(' '));
  const fatal = [...errors, ...consoleErrors].filter(t => !/Failed to fetch|TTS|Firebase|Network|net::|CORS/i.test(t));
  check('no unexpected runtime errors', fatal.length === 0, { errors, consoleErrors: consoleErrors.slice(0, 5), fatal });

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
} catch (e) { console.error('ERR', e); process.exitCode = 1; }
finally { c?.close(); chrome.kill('SIGKILL'); server.close(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }

