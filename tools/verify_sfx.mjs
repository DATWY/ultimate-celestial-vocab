/**
 * Verify the SFX engine: MP3 samples are fetched, decoded and played through
 * AudioBufferSourceNode (not the synth), with the synth still covering the
 * effects that have no sample file.
 *
 * node tools/verify_sfx.mjs
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');
const PORT = 5201;
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
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
    constructor(url) { this.ws = new globalThis.WebSocket(url); this.id = 1; this.pending = new Map(); this.listeners = new Map(); }
    init() {
        return new Promise((resolve, reject) => {
            this.ws.onopen = resolve;
            this.ws.onerror = reject;
            this.ws.onmessage = (event) => {
                const msg = JSON.parse(event.data);
                if (msg.id && this.pending.has(msg.id)) {
                    const { resolve: r, reject: j } = this.pending.get(msg.id);
                    this.pending.delete(msg.id);
                    msg.error ? j(new Error(msg.error.message)) : r(msg.result);
                } else if (msg.method) {
                    (this.listeners.get(msg.method) || []).forEach((cb) => cb(msg.params));
                }
            };
        });
    }
    on(method, cb) { if (!this.listeners.has(method)) this.listeners.set(method, []); this.listeners.get(method).push(cb); }
    send(method, params = {}) {
        const id = this.id++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }
    async eval(expression) {
        const r = await this.send('Runtime.evaluate', { expression: `(async()=>{${expression}})()`, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
        return r.result?.value;
    }
    close() { try { this.ws.close(); } catch {} }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
    await new Promise((r) => server.listen(PORT, r));
    const port = 9700 + Math.floor(Math.random() * 80);
    const tmp = path.join(rootDir, 'scratch', 'sfx_' + Date.now());
    fs.mkdirSync(tmp, { recursive: true });
    const chrome = spawn(chromePath, [
        '--headless=new', '--window-size=1280,900', `--user-data-dir=${tmp}`,
        `--remote-debugging-port=${port}`, '--no-sandbox', '--mute-audio',
        '--autoplay-policy=no-user-gesture-required', '--disable-extensions',
    ]);
    let c;
    try {
        let ws = null;
        for (let i = 0; i < 60; i++) {
            await sleep(200);
            try {
                const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
                const page = tabs.find((x) => x.type === 'page');
                if (page) { ws = page.webSocketDebuggerUrl; break; }
            } catch {}
        }
        if (!ws) throw new Error('no cdp');
        c = new CDP(ws);
        await c.init();
        await c.send('Page.enable');
        await c.send('Runtime.enable');
        await c.send('Page.addScriptToEvaluateOnNewDocument', {
            source: `
                window.__sfx = { buf: 0, osc: 0, el: 0, errors: [] };
                const _bs = AudioBufferSourceNode.prototype.start;
                AudioBufferSourceNode.prototype.start = function (...a) { window.__sfx.buf++; return _bs.apply(this, a); };
                const _os = OscillatorNode.prototype.start;
                OscillatorNode.prototype.start = function (...a) { window.__sfx.osc++; return _os.apply(this, a); };
                const _ep = HTMLMediaElement.prototype.play;
                HTMLMediaElement.prototype.play = function (...a) { window.__sfx.el++; return _ep.apply(this, a); };
                window.addEventListener('error', e => window.__sfx.errors.push(String(e.message || e.reason)));
                window.addEventListener('unhandledrejection', e => window.__sfx.errors.push(String(e.reason)));
            `,
        });
        await c.send('Page.navigate', { url: `http://localhost:${PORT}/?theme=dark` });
        await c.eval(`
            const t0 = performance.now();
            while (!document.body?.classList.contains('app-ready')) {
                await new Promise(r => setTimeout(r, 40));
                if (performance.now() - t0 > 20000) break;
            }
            return true;
        `);
        await sleep(1800); // sample preload/decode

        const result = await c.eval(`
            const entry = performance.getEntriesByType('resource').find(e => /\\/assets\\/index-[^/]+\\.js$/.test(e.name));
            if (!entry) throw new Error('entry chunk not found');
            const mod = await import(entry.name);
            // Vite minifies entry exports to short aliases; locate them by source.
            const fns = Object.entries(mod).filter(([, v]) => typeof v === 'function');
            const playSound = fns.find(([, v]) => /soundMode/.test(v.toString()))?.[1];
            if (!playSound) throw new Error('playSound export not found');
            const before = { ...window.__sfx };
            const played = [];
            for (const name of ['flip', 'correct', 'incorrect', 'next', 'starOn']) {
                playSound(name);
                played.push(name);
                await new Promise(r => setTimeout(r, 80));
            }
            const afterSamples = { ...window.__sfx };
            playSound('complete');
            await new Promise(r => setTimeout(r, 120));
            const afterSynth = { ...window.__sfx };
            const resources = performance.getEntriesByType('resource')
                .filter(e => /\\/sounds\\/.*\\.mp3$/.test(e.name))
                .map(e => ({ file: e.name.split('/').pop(), bytes: e.transferSize || e.encodedBodySize || 0 }));
            return {
                sampleBuffers: afterSamples.buf - before.buf,
                sampleElements: afterSamples.el - before.el,
                synthOscillatorsFromComplete: afterSynth.osc - afterSamples.osc,
                resources,
                errors: window.__sfx.errors,
                played,
            };
        `);

        console.log(JSON.stringify(result, null, 2));

        const failures = [];
        if (result.sampleBuffers < 5) failures.push(`expected >=5 buffer starts, got ${result.sampleBuffers}`);
        if (result.sampleElements !== 0) failures.push(`sample fallback used ${result.sampleElements} HTMLAudio plays`);
        if (result.synthOscillatorsFromComplete < 1) failures.push('synth fallback did not run for "complete"');
        if (result.resources.length < 5) failures.push(`expected 5 MP3 resources, got ${result.resources.length}`);
        if ((result.errors || []).length) failures.push(`page errors: ${result.errors.join(' | ')}`);

        if (failures.length) {
            console.error('\nFAIL:\n- ' + failures.join('\n- '));
            process.exitCode = 1;
        } else {
            console.log('\nPASS: samples decoded and played via AudioBuffer; synth fallback intact.');
        }
    } catch (error) {
        console.error('ERR', error);
        process.exitCode = 1;
    } finally {
        c?.close();
        chrome.kill('SIGKILL');
        server.close();
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    }
}

main();
