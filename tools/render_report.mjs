// tools/render_report.mjs — render reports/upgrade-report.html thành PNG từng trang (cần Chrome).
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const rootDir = process.cwd();
const PORT = 5401;
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    const f = path.join(rootDir, p);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); }
    else { res.writeHead(404); res.end('not found: ' + p); }
});

class CDP {
    constructor(u) { this.ws = new globalThis.WebSocket(u); this.id = 1; this.p = new Map(); this.l = new Map(); }
    init() { return new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; this.ws.onmessage = e => { const d = JSON.parse(e.data); if (d.id && this.p.has(d.id)) { const { r, j } = this.p.get(d.id); this.p.delete(d.id); d.error ? j(new Error(d.error.message)) : r(d.result); } else if (d.method) (this.l.get(d.method) || []).forEach(cb => cb(d.params)); }; }); }
    send(m, params = {}) { const id = this.id++; return new Promise((r, j) => { this.p.set(id, { r, j }); this.ws.send(JSON.stringify({ id, method: m, params })); }); }
    async eval(x) { const r = await this.send('Runtime.evaluate', { expression: `(async()=>{${x}})()`, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '')); return r.result?.value; }
    close() { try { this.ws.close(); } catch { } }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

await new Promise(r => server.listen(PORT, r));
const debugPort = 9700 + Math.floor(Math.random() * 50);
const tmp = path.join(process.env.TEMP || '/tmp', 'rep_' + Date.now());
fs.mkdirSync(tmp, { recursive: true });
const chrome = spawn(chromePath, ['--headless=new', `--user-data-dir=${tmp}`, `--remote-debugging-port=${debugPort}`, '--no-sandbox', '--hide-scrollbars', '--allow-file-access-from-files']);

let c;
const out = [];
try {
    let ws = null;
    for (let i = 0; i < 80; i++) {
        await sleep(200);
        try { const list = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json(); const page = list.find(x => x.type === 'page'); if (page) { ws = page.webSocketDebuggerUrl; break; } } catch { }
    }
    c = new CDP(ws); await c.init();
    await c.send('Page.enable'); await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await c.send('Page.navigate', { url: `http://localhost:${PORT}/reports/upgrade-report.html` });
    await sleep(1200);
    await c.eval(`
        await document.fonts.ready;
        await Promise.all([...document.images].map(img => img.complete ? 1 : new Promise(res => { img.onload = img.onerror = res; })));
        return { fonts: document.fonts.size, imgs: document.images.length };
    `);
    const info = await c.eval(`return [...document.querySelectorAll('.page')].map((el, i) => {
        const r = el.getBoundingClientRect();
        return { i, id: el.id, x: r.x + scrollX, y: r.y + scrollY, w: Math.round(r.width), h: Math.round(r.height) };
    });`);
    for (const p of info) {
        const shot = await c.send('Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: true,
            clip: { x: p.x, y: p.y, width: p.w, height: p.h, scale: 2 }
        });
        const file = path.join(rootDir, 'reports', `nang-cap-${p.i + 1}.png`);
        fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
        out.push({ file: path.relative(rootDir, file), w: p.w, h: p.h, kb: Math.round(fs.statSync(file).size / 1024) });
    }
} finally {
    try { c?.close(); } catch { }
    chrome.kill();
    server.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
    console.log(JSON.stringify(out, null, 2));
}



