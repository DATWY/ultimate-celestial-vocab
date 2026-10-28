// tests/e2e/study-loop.mjs — E2E vòng học trên bundle THẬT (dist) qua CDP.
// Chạy 2 chế độ:
//   node tests/e2e/study-loop.mjs                 → thẻ NEW (không có leech)
//   SMOKE_LEECH=1 node tests/e2e/study-loop.mjs   → thẻ LEECH (lapses=4) đầu tiên
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';

const rootDir = path.resolve(path.dirname(process.argv[1] || '.'), '..', '..'); // gốc repo suy ra từ vị trí file (tests/e2e/ → ../..), không phụ thuộc cwd
const distDir = path.join(rootDir, 'dist');
const PORT = 5199;
const WITH_LEECH = process.env.SMOKE_LEECH === '1';
// Tìm Chrome theo thứ tự: biến môi trường → đường dẫn phổ biến của từng HĐH →
// lệnh trong PATH. Trước đây đường dẫn Windows được hard-code nên E2E không thể
// chạy trong CI (ubuntu-latest) và luôn bị bỏ qua ở cổng chất lượng.
function resolveChromePath() {
    const candidates = [
        process.env.CHROME_PATH,
        process.env.CHROME_BIN,
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    ].filter(Boolean);
    for (const candidate of candidates) {
        try { if (fs.existsSync(candidate)) return candidate; } catch { }
    }
    for (const command of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome']) {
        try {
            const found = execSync(`command -v ${command} || where ${command}`, { stdio: ['ignore', 'pipe', 'ignore'] })
                .toString().split(/\r?\n/)[0].trim();
            if (found) return found;
        } catch { }
    }
    return null;
}

const chromePath = resolveChromePath();
if (!chromePath) {
    console.error('Không tìm thấy Chrome. Đặt CHROME_PATH hoặc cài Chrome/Chromium để chạy E2E.');
    process.exit(2);
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    const f = path.join(distDir, p);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
        res.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'application/octet-stream' });
        fs.createReadStream(f).pipe(res);
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        fs.createReadStream(path.join(distDir, 'index.html')).pipe(res);
    }
});

class CDP {
    constructor(u) { this.ws = new globalThis.WebSocket(u); this.id = 1; this.p = new Map(); this.l = new Map(); }
    init() { return new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; this.ws.onmessage = e => { const d = JSON.parse(e.data); if (d.id && this.p.has(d.id)) { const { r, j } = this.p.get(d.id); this.p.delete(d.id); d.error ? j(new Error(d.error.message)) : r(d.result); } else if (d.method) (this.l.get(d.method) || []).forEach(cb => cb(d.params)); }; }); }
    on(m, cb) { if (!this.l.has(m)) this.l.set(m, []); this.l.get(m).push(cb); }
    send(m, params = {}) { const id = this.id++; return new Promise((r, j) => { this.p.set(id, { r, j }); this.ws.send(JSON.stringify({ id, method: m, params })); }); }
    async eval(x) { const r = await this.send('Runtime.evaluate', { expression: `(async()=>{${x}})()`, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '')); return r.result?.value; }
    close() { try { this.ws.close(); } catch { } }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let press = async () => { throw new Error('press chưa gán'); };

const results = { mode: WITH_LEECH ? 'leech' : 'new-card', steps: [], errors: [] };
const step = (name, data) => { results.steps.push({ name, ...data }); };

const seedExpr = () => `
  const req = indexedDB.open('celestial-vocab-idb', 2);
  const db = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
  const now = Date.now();
  const tx = db.transaction('vocabulary', 'readwrite'); const st = tx.objectStore('vocabulary');
  ${WITH_LEECH ? `await st.put({ id: 'smoke-leech', english: 'obfuscate', vietnamese: 'làm tối nghĩa', type: 'verb', topic: 'Celestial',
    srsStatus: 'Learning', learningStep: 1, reps: 6, lapses: 4, stability: 2.1, stabilityShort: 2.1, difficulty: 8.4,
    srsInterval: 0.0069, srsDueDate: now - 120000, createdAt: now - 600000, updatedAt: now - 600000, isLeech: true });` : ''}
  const words = [['nebula','tinh vân'],['quasar','chuẩn tinh'],['pulsar','sao xung'],['comet','sao chổi'],['eclipse','nhật thực'],['gravity','trọng lực']];
  for (const [i, [en, vi]] of words.entries()) {
    await st.put({ id: 'smoke-' + i, english: en, vietnamese: vi, type: 'noun', topic: 'Celestial',
      srsStatus: 'New', reps: 0, lapses: 0, stability: 0, stabilityShort: 0, difficulty: 0,
      srsInterval: 0, srsDueDate: now - 1000, createdAt: now - 60000, updatedAt: now - 60000 });
  }
  await new Promise(res => { tx.oncomplete = res; });
  return words.length + ${WITH_LEECH ? 1 : 0};
`;

const READ_CARD = en => `
  const req = indexedDB.open('celestial-vocab-idb', 2);
  const db = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
  const all = await new Promise((res, rej) => { const r = tx0(); function tx0(){ const t = db.transaction('vocabulary','readonly').objectStore('vocabulary').getAll(); return t; } r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const c = all.find(x => x.english === ${JSON.stringify(en)});
  return c ? { status: c.srsStatus, step: c.learningStep ?? null, interval: c.srsInterval, dueInMin: Math.round((c.srsDueDate - Date.now())/60000) } : null;
`;

await new Promise(r => server.listen(PORT, r));
const debugPort = 9500 + Math.floor(Math.random() * 80);
const tmp = path.join(process.env.TEMP || '/tmp', 'smoke_' + Date.now());
fs.mkdirSync(tmp, { recursive: true });
const chrome = spawn(chromePath, ['--headless=new', '--window-size=1440,900', `--user-data-dir=${tmp}`, `--remote-debugging-port=${debugPort}`, '--no-sandbox', '--hide-scrollbars', '--mute-audio', '--disable-extensions']);

let c;
try {
    let ws = null;
    for (let i = 0; i < 80; i++) {
        await sleep(200);
        try {
            const list = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
            const page = list.find(x => x.type === 'page');
            if (page) { ws = page.webSocketDebuggerUrl; break; }
        } catch { }
    }
    if (!ws) throw new Error('không kết nối được CDP');
    c = new CDP(ws); await c.init();
    press = async opts => { await c.send('Input.dispatchKeyEvent', { type: 'keyDown', ...opts }); await sleep(60); await c.send('Input.dispatchKeyEvent', { type: 'keyUp', ...opts }); };
    await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Log.enable'); await c.send('Network.enable');
    const authCalls = [];
    c.on('Network.requestWillBeSent', p => { const u = String(p.request?.url || ''); if (u.includes('identitytoolkit')) authCalls.push(u.split('?')[0].split('/').pop()); });
    c.on('Runtime.consoleAPICalled', p => { if (p.type === 'error') results.errors.push({ type: 'console.error', text: (p.args || []).map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300) }); });
    c.on('Runtime.exceptionThrown', p => results.errors.push({ type: 'exception', text: (p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || '').slice(0, 300) }));
    c.on('Log.entryAdded', p => {
        if (p.entry.level !== 'error') return;
        const u = String(p.entry.url || '');
        if (u.includes('identitytoolkit')) { results.expectedAuthRejections = (results.expectedAuthRejections || 0) + 1; return; }
        results.errors.push({ type: 'log.error', text: String(p.entry.text).slice(0, 200), url: u.slice(0, 160) });
    });

    await c.send('Page.navigate', { url: `http://localhost:${PORT}/?theme=dark` });
    await sleep(3500);
    step('seed', { cards: await c.eval(seedExpr()) });

    await c.send('Page.navigate', { url: `http://localhost:${PORT}/?theme=dark` });
    await c.eval(`const t0=performance.now(); while(!document.body?.classList.contains('app-ready')){ await new Promise(r=>setTimeout(r,40)); if(performance.now()-t0>20000) break; } return document.body.className;`);
    await sleep(1500);

    const cardUi = await c.eval(`return {
        english: document.getElementById('card-english')?.textContent?.trim(),
        badgeHidden: document.getElementById('card-hard-badge')?.classList.contains('hidden'),
        badgeTitle: (document.getElementById('card-hard-badge')?.title || '').slice(0, 50),
        hardClass: document.getElementById('flashcard')?.classList.contains('is-hard-card')
    };`);
    step('thẻ đầu tiên', cardUi);

    await press({ key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32, text: ' ' });
    await sleep(1000);

    const flipped = await c.eval(`return {
        buttonsVisible: !document.getElementById('srs-feedback-buttons')?.classList.contains('hidden'),
        labels: [...document.querySelectorAll('.srs-interval-badge')].map(e=>e.textContent.trim()),
        answerVisible: document.getElementById('card-vietnamese')?.offsetParent !== null
    };`);
    step('sau khi lật', flipped);

    const before = await c.eval(READ_CARD(cardUi.english));
    step('state trước khi chấm', before);

    await press({ key: '3', code: 'Digit3', windowsVirtualKeyCode: 51, nativeVirtualKeyCode: 51, text: '3' });
    await sleep(1800);
    const after = await c.eval(READ_CARD(cardUi.english));
    step('sau khi chấm Nhớ (3)', after);

    await press({ key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, modifiers: 2 });
    await sleep(1500);
    const undone = await c.eval(READ_CARD(cardUi.english));
    step('sau Ctrl+Z', undone);

    for (const [name, expr] of [
        ['mở Hub', `document.querySelector('[data-action="open-manage"], #open-manage-btn, .hub-btn')?.click(); return true;`],
        ['mở wordlist', `document.querySelector('#tab-words, [data-hub-tab="words"]')?.click(); return true;`]
    ]) {
        try { await c.eval(expr); await sleep(800); step(name, { ok: true }); }
        catch (e) { step(name, { ok: false, error: String(e.message).slice(0, 160) }); }
    }

    const bad = [];
    if (!flipped.buttonsVisible) bad.push('nút chấm không hiện sau khi lật');
    if (!flipped.answerVisible) bad.push('mặt sau không hiển thị');
    if (WITH_LEECH) {
        if (cardUi.english !== 'obfuscate') bad.push('thẻ leech không được ưu tiên');
        if (cardUi.badgeHidden) bad.push('badge CỰC KHÓ bị ẩn trên thẻ leech');
        if (JSON.stringify(flipped.labels) !== JSON.stringify(['10p', '10p', '1 ngày', '2 ngày'])) bad.push('nhãn bước Learning sai: ' + flipped.labels.join('/'));
        if (after?.status !== 'Learning' || after?.step !== 2 || !(after.dueInMin >= 1439)) bad.push('chấm Nhớ không sang bước 2 (1 ngày): ' + JSON.stringify(after));
        if (undone?.step !== 1) bad.push('Ctrl+Z không trả về bước 1: ' + JSON.stringify(undone));
    } else {
        if (cardUi.badgeHidden !== true) bad.push('badge CỰC KHÓ hiện trên thẻ thường');
        if (JSON.stringify(flipped.labels) !== JSON.stringify(['1p', '10p', '10p', '7 ngày'])) bad.push('nhãn thẻ New sai: ' + flipped.labels.join('/'));
        if (after?.status !== 'Learning' || after?.step !== 1 || !(after.dueInMin >= 9 && after.dueInMin <= 11)) bad.push('chấm Nhớ không hẹn +10 phút: ' + JSON.stringify(after));
        if (undone?.status !== 'New') bad.push('Ctrl+Z không trả về New: ' + JSON.stringify(undone));
    }

    results.authEndpoints = authCalls;
    results.summary = { card: cardUi.english, labels: flipped.labels, afterGood: after, afterUndo: undone };
    results.failures = bad;
    results.ok = bad.length === 0 && results.errors.length === 0;
} catch (e) {
    results.ok = false;
    results.fatal = String(e.message || e);
    try { results.diagnostics = await c.eval(`return { url: location.href, ready: document.readyState, bodyClass: document.body.className };`); } catch { }
} finally {
    try { c?.close(); } catch { }
    chrome.kill();
    server.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
    console.log(JSON.stringify(results, null, 2));
    process.exit(results.ok ? 0 : 1);
}
