/**
 * Visual check for the motion upgrade: answer feedback + shortcut sheet.
 * node tools/preview_motion.mjs
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const root = process.cwd(), dist = path.join(root, 'dist'), PORT = 5204;
const OUT = path.join(root, 'scratch', 'motion');
fs.mkdirSync(OUT, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    const f = path.join(dist, p);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); }
    else { res.writeHead(200, { 'Content-Type': 'text/html' }); fs.createReadStream(path.join(dist, 'index.html')).pipe(res); }
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
class CDP {
    constructor(u) { this.ws = new globalThis.WebSocket(u); this.id = 1; this.p = new Map(); }
    init() { return new Promise((r, j) => { this.ws.onopen = r; this.ws.onerror = j; this.ws.onmessage = e => { const d = JSON.parse(e.data); if (d.id && this.p.has(d.id)) { const x = this.p.get(d.id); this.p.delete(d.id); d.error ? x.j(new Error(d.error.message)) : x.r(d.result); } }; }); }
    send(m, p = {}) { const id = this.id++; return new Promise((r, j) => { this.p.set(id, { r, j }); this.ws.send(JSON.stringify({ id, method: m, params: p })); }); }
    async eval(x) { const r = await this.send('Runtime.evaluate', { expression: `(async()=>{${x}})()`, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result?.value; }
    close() { try { this.ws.close(); } catch {} }
}
async function shot(c, name, clip) {
    const r = await c.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    console.log('shot', name);
}
async function seed(c) {
    await c.eval(`
        const dbs=await indexedDB.databases(); const names=dbs.map(d=>d.name).filter(Boolean);
        const dbName=names.find(x=>x.includes('celestial-vocab'))||'celestial-vocab-idb';
        const req=indexedDB.open(dbName);
        const db=await new Promise((res,rej)=>{req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error);req.onupgradeneeded=()=>{req.result.createObjectStore('vocabulary',{keyPath:'id'});}});
        const tx=db.transaction('vocabulary','readwrite'); const st=tx.objectStore('vocabulary');
        const now=Date.now();
        st.put({id:'seed-0',english:'ephemeral',vietnamese:'phù du, chóng tàn',type:'adjective',pronunciation:'/ɪˈfem.ər.əl/',example:'The beauty of the sunset was ephemeral, fading within minutes.',tags:['Celestial'],srsStatus:'New',srsDueDate:now-1000,srsInterval:1,srsEaseFactor:2.5,isStarred:false,anchor:0,modality:'en-vi',createdAt:now,updatedAt:now});
        await new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error)}); db.close(); return true;
    `);
}
async function main() {
    await new Promise(r => server.listen(PORT, r));
    const port = 9900 + Math.floor(Math.random() * 50);
    const tmp = path.join(root, 'scratch', 'motion-profile-' + Date.now());
    fs.mkdirSync(tmp, { recursive: true });
    const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
        '--headless=new', '--window-size=1440,900', `--user-data-dir=${tmp}`, `--remote-debugging-port=${port}`,
        '--no-sandbox', '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--disable-extensions',
    ]);
    let c;
    try {
        let ws = null;
        for (let i = 0; i < 60; i++) {
            await sleep(200);
            try { const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const p = tabs.find(x => x.type === 'page'); if (p) { ws = p.webSocketDebuggerUrl; break; } } catch {}
        }
        c = new CDP(ws); await c.init();
        await c.send('Page.enable'); await c.send('Runtime.enable');
        await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
        await c.send('Page.navigate', { url: `http://localhost:${PORT}/?theme=dark` });
        await sleep(1200); await seed(c);
        await c.send('Page.navigate', { url: `http://localhost:${PORT}/?theme=dark` });
        await sleep(1600);

        // Flip to the answer side, capture the sweep mid-flight, then rate "Good".
        await c.eval(`document.getElementById('reveal-btn')?.click(); return true;`);
        await sleep(240);
        await shot(c, 'flip-mid');
        await sleep(560);
        await shot(c, 'flipped');
        await c.eval(`document.querySelector('.srs-btn[data-rating="3"]')?.click(); return true;`);
        await sleep(220);
        await shot(c, 'answer-feedback');

        await sleep(1400);
        await c.eval(`document.getElementById('shortcuts-menu-btn')?.click(); return true;`);
        await sleep(650);
        await shot(c, 'shortcuts-modal');
        const keyboardHelp = await c.eval(`
            document.getElementById('close-shortcuts-modal-btn')?.click();
            await new Promise(r => setTimeout(r, 250));
            document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true, cancelable: true }));
            await new Promise(r => setTimeout(r, 300));
            return !document.getElementById('shortcuts-modal')?.classList.contains('hidden');
        `);
        console.log('question-mark opens help:', keyboardHelp);
        console.log('done');
    } catch (e) { console.error('ERR', e); process.exitCode = 1; }
    finally { c?.close(); chrome.kill('SIGKILL'); server.close(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
}
main();
