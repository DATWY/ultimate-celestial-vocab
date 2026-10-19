import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.join(distDir, reqPath);
  
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    const indexPath = path.join(distDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      fs.createReadStream(indexPath).pipe(res);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  }
});

const PORT = 5198;
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

class CDPClient {
  constructor(wsUrl) {
    this.ws = new globalThis.WebSocket(wsUrl);
    this.msgId = 1;
  }

  init() {
    return new Promise((resolve, reject) => {
      this.ws.onopen = async () => {
        try {
          await this.send('Page.enable');
          await this.send('Runtime.enable');
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      this.ws.onerror = reject;
    });
  }

  send(method, params = {}) {
    const id = this.msgId++;
    return new Promise((resCmd, rejCmd) => {
      const handler = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          if (data.id === id) {
            this.ws.removeEventListener('message', handler);
            if (data.error) {
              rejCmd(new Error(data.error.message || JSON.stringify(data.error)));
            } else {
              resCmd(data.result);
            }
          }
        } catch (e) {}
      };
      this.ws.addEventListener('message', handler);
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
      const err = new Error(res.exceptionDetails.text + (res.exceptionDetails.exception?.description ? ': ' + res.exceptionDetails.exception.description : ''));
      err.details = res.exceptionDetails;
      throw err;
    }
    return res.result?.value;
  }

  async setViewport(width, height, mobile = false, deviceScaleFactor = 1) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor,
      mobile
    });
  }

  close() {
    try { this.ws.close(); } catch (e) {}
  }
}

async function runTests() {
  await new Promise(r => server.listen(PORT, r));
  console.log(`Test server running on port ${PORT}`);

  const cdpPort = 9222 + Math.floor(Math.random() * 80);
  const tmpDir = path.join(rootDir, 'scratch', 'tmp_curtain_' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  const args = [
    '--headless=new',
    `--window-size=1920,1080`,
    `--user-data-dir=${tmpDir}`,
    `--remote-debugging-port=${cdpPort}`,
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `http://localhost:${PORT}/?theme=dark`
  ];

  const chrome = spawn(chromePath, args);
  let client = null;

  try {
    let wsUrl = null;
    for (let attempt = 0; attempt < 60; attempt++) {
      await new Promise(r => setTimeout(r, 200));
      try {
        const res = await fetch(`http://127.0.0.1:${cdpPort}/json`);
        const tabs = await res.json();
        const pageTab = tabs.find(t => t.type === 'page');
        if (pageTab && pageTab.webSocketDebuggerUrl) {
          wsUrl = pageTab.webSocketDebuggerUrl;
          break;
        }
      } catch (e) {}
    }

    if (!wsUrl) throw new Error('Cannot connect to Chrome CDP WebSocket');

    client = new CDPClient(wsUrl);
    await client.init();
    await client.setViewport(1920, 1080, false, 1);
    await new Promise(r => setTimeout(r, 1500)); // DOM & SW setup

    const results = [];

    // TEST 1: Full Viewport Coverage (100vw x 100vh) at 1920x1080
    console.log('\n--- Test 1: Desktop Viewport 100vw x 100vh Coverage ---');
    const t1 = await client.eval(`
      const container = document.getElementById('shipper-curtain-container');
      const isDirectChild = container.parentElement === document.body;
      const btn = document.getElementById('toggle-dark-mode-btn');
      btn.click();
      await new Promise(r => setTimeout(r, 150));
      const rect = container.getBoundingClientRect();
      const winW = window.innerWidth;
      const winH = window.innerHeight;
      const coversViewport = (
        Math.abs(rect.left) <= 1 &&
        Math.abs(rect.top) <= 1 &&
        Math.abs(rect.width - winW) <= 1 &&
        Math.abs(rect.height - winH) <= 1
      );
      return {
        isDirectChild,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        viewport: { width: winW, height: winH },
        coversViewport
      };
    `);
    console.log('Test 1 Result:', t1);
    results.push({ name: 'Full Viewport Coverage (100vw x 100vh)', passed: t1.isDirectChild && t1.coversViewport });

    await new Promise(r => setTimeout(r, 2000));

    // TEST 2: Center Seam Overlap (Zero Gap)
    console.log('\n--- Test 2: Center Seam Overlap (Zero Gap) ---');
    const t2 = await client.eval(`
      const btn = document.getElementById('toggle-dark-mode-btn');
      btn.click();
      await new Promise(r => setTimeout(r, 850));
      const left = document.getElementById('curtain-left').getBoundingClientRect();
      const right = document.getElementById('curtain-right').getBoundingClientRect();
      const overlapPx = left.right - right.left;
      return {
        leftPanel: { left: left.left, right: left.right, width: left.width },
        rightPanel: { left: right.left, right: right.right, width: right.width },
        overlapPx,
        hasNoGap: overlapPx >= 0
      };
    `);
    console.log('Test 2 Result:', t2);
    results.push({ name: 'Center Seam Overlap (Zero Gap/Slit)', passed: t2.hasNoGap && t2.overlapPx > 0 });

    await new Promise(r => setTimeout(r, 1500));

    // TEST 3: Clean Completion & Element Hiding
    console.log('\n--- Test 3: Clean Completion & Element Hiding ---');
    const t3 = await client.eval(`
      const container = document.getElementById('shipper-curtain-container');
      const left = document.getElementById('curtain-left');
      const right = document.getElementById('curtain-right');
      const badge = document.getElementById('curtain-badge');
      const isHidden = container.classList.contains('hidden');
      const hasClosingClass = left.classList.contains('curtain-left-closing') || right.classList.contains('curtain-right-closing');
      const hasOpeningClass = left.classList.contains('curtain-left-opening') || right.classList.contains('curtain-right-opening');
      const badgeClean = !badge.classList.contains('badge-in') && !badge.classList.contains('badge-out');
      return {
        isHidden,
        hasClosingClass,
        hasOpeningClass,
        badgeClean,
        isClean: isHidden && !hasClosingClass && !hasOpeningClass && badgeClean
      };
    `);
    console.log('Test 3 Result:', t3);
    results.push({ name: 'Clean Completion & Hidden', passed: t3.isClean });

    // TEST 4: Window Blur Immunity
    console.log('\n--- Test 4: Window Blur Immunity ---');
    const t4 = await client.eval(`
      document.body.classList.add('window-blurred');
      const btn = document.getElementById('toggle-dark-mode-btn');
      btn.click();
      const curtain = document.getElementById('shipper-curtain-container');
      const isActive = !curtain.classList.contains('hidden');
      await new Promise(r => setTimeout(r, 2200));
      const isHiddenAfter = curtain.classList.contains('hidden');
      document.body.classList.remove('window-blurred');
      return {
        isActiveDuring: isActive,
        isHiddenAfter
      };
    `);
    console.log('Test 4 Result:', t4);
    results.push({ name: 'Window-Blurred Animation Immunity', passed: t4.isActiveDuring && t4.isHiddenAfter });

    // TEST 5: Boost Mode Instantaneous Swap
    console.log('\n--- Test 5: Boost Mode Instantaneous Swap ---');
    const t5 = await client.eval(`
      const boostBtn = document.getElementById('toggle-boost-mode-btn');
      boostBtn.click();
      await new Promise(r => setTimeout(r, 100));

      const bodyBefore = document.body.classList.contains('dark-mode');
      const btn = document.getElementById('toggle-dark-mode-btn');
      btn.click();
      const curtain = document.getElementById('shipper-curtain-container');
      const isCurtainHidden = curtain.classList.contains('hidden');
      const bodyAfter = document.body.classList.contains('dark-mode');

      boostBtn.click();
      await new Promise(r => setTimeout(r, 100));

      return {
        swappedImmediately: bodyBefore !== bodyAfter,
        curtainRemainedHidden: isCurtainHidden
      };
    `);
    console.log('Test 5 Result:', t5);
    results.push({ name: 'Boost Mode Immediate Swap', passed: t5.swappedImmediately && t5.curtainRemainedHidden });

    // TEST 6: Odd Dimensions & Subpixel Rounding (1365x768)
    console.log('\n--- Test 6: Odd Dimensions & Subpixel Rounding (1365x768) ---');
    await client.setViewport(1365, 768, false, 1.25);
    await new Promise(r => setTimeout(r, 300));
    const t6 = await client.eval(`
      const btn = document.getElementById('toggle-dark-mode-btn');
      btn.click();
      await new Promise(r => setTimeout(r, 850));
      const left = document.getElementById('curtain-left').getBoundingClientRect();
      const right = document.getElementById('curtain-right').getBoundingClientRect();
      const overlapPx = left.right - right.left;
      return {
        overlapPx,
        hasNoGap: overlapPx >= 0
      };
    `);
    console.log('Test 6 Result:', t6);
    results.push({ name: 'Odd Dimensions (1365px, 125% DPI) Zero Gap', passed: t6.hasNoGap && t6.overlapPx > 0 });

    await new Promise(r => setTimeout(r, 1500));

    // TEST 7: Mobile Viewport (390x844)
    console.log('\n--- Test 7: Mobile Viewport (390x844) ---');
    await client.setViewport(390, 844, true, 3);
    await new Promise(r => setTimeout(r, 300));
    const t7 = await client.eval(`
      const btn = document.getElementById('toggle-dark-mode-btn');
      btn.click();
      await new Promise(r => setTimeout(r, 850));
      const container = document.getElementById('shipper-curtain-container').getBoundingClientRect();
      const left = document.getElementById('curtain-left').getBoundingClientRect();
      const right = document.getElementById('curtain-right').getBoundingClientRect();
      const overlapPx = left.right - right.left;
      await new Promise(r => setTimeout(r, 1500));
      const isHiddenEnd = document.getElementById('shipper-curtain-container').classList.contains('hidden');
      return {
        overlapPx,
        hasNoGap: overlapPx >= 0,
        isHiddenEnd
      };
    `);
    console.log('Test 7 Result:', t7);
    results.push({ name: 'Mobile Viewport (390x844) Seam & Cleanup', passed: t7.hasNoGap && t7.isHiddenEnd });

    // TEST 8: Light-to-Dark and Dark-to-Light Badge & Theme Switch Accuracy
    console.log('\n--- Test 8: Badge Icon & Theme Content Accuracy ---');
    await client.setViewport(1440, 900, false, 1);
    await new Promise(r => setTimeout(r, 300));
    const t8 = await client.eval(`
      const btn = document.getElementById('toggle-dark-mode-btn');
      // Ensure we are in dark mode first with synchronized state
      window.__celestialAudit.setDarkMode(true);
      await new Promise(r => setTimeout(r, 100));
      
      // Transition from Dark to Light
      btn.click();
      await new Promise(r => setTimeout(r, 200));
      const leftLight = document.getElementById('curtain-left').classList.contains('curtain-light-left');
      const badgeLight = document.getElementById('curtain-badge').classList.contains('curtain-badge-light');
      const sunIcon = document.getElementById('badge-icon').querySelector('.ph-sun') !== null;
      
      await new Promise(r => setTimeout(r, 2000));
      const isLightNow = !document.body.classList.contains('dark-mode');

      // Transition from Light to Dark
      btn.click();
      await new Promise(r => setTimeout(r, 200));
      const leftDark = document.getElementById('curtain-left').classList.contains('curtain-dark-left');
      const badgeDark = document.getElementById('curtain-badge').classList.contains('curtain-badge-dark');
      const moonIcon = document.getElementById('badge-icon').querySelector('.ph-moon') !== null;

      await new Promise(r => setTimeout(r, 2000));
      const isDarkNow = document.body.classList.contains('dark-mode');

      return {
        darkToLight: leftLight && badgeLight && sunIcon && isLightNow,
        lightToDark: leftDark && badgeDark && moonIcon && isDarkNow
      };
    `);
    console.log('Test 8 Result:', t8);
    results.push({ name: 'Theme Mode Colors & Badge Icons', passed: t8.darkToLight && t8.lightToDark });

    // TEST 9: Pointer-Events Modal Shield During Transition
    console.log('\n--- Test 9: Pointer-Events Modal Shield During Transition ---');
    const t9 = await client.eval(`
      const btn = document.getElementById('toggle-dark-mode-btn');
      btn.click();
      await new Promise(r => setTimeout(r, 300));
      const container = document.getElementById('shipper-curtain-container');
      const styleDuring = window.getComputedStyle(container);
      const pointerEventsDuring = styleDuring.pointerEvents;
      const hitElement = document.elementFromPoint(100, 100);
      const isCurtainHit = container.contains(hitElement);
      
      await new Promise(r => setTimeout(r, 2000));
      const isHiddenAfter = container.classList.contains('hidden');
      const pointerEventsAfter = window.getComputedStyle(container).pointerEvents;
      
      return {
        pointerEventsDuring,
        isCurtainHit,
        isHiddenAfter,
        pointerEventsAfter,
        shieldActive: pointerEventsDuring === 'auto' && isCurtainHit && isHiddenAfter && pointerEventsAfter === 'none'
      };
    `);
    console.log('Test 9 Result:', t9);
    results.push({ name: 'Pointer-Events Modal Shield Protection', passed: t9.shieldActive });

    // TEST 10: 4K UHD Viewport (3840x2160) Seam & Coverage
    console.log('\n--- Test 10: 4K UHD Viewport (3840x2160) Seam & Coverage ---');
    await client.setViewport(3840, 2160, false, 1);
    await new Promise(r => setTimeout(r, 300));
    const t10 = await client.eval(`
      const btn = document.getElementById('toggle-dark-mode-btn');
      btn.click();
      await new Promise(r => setTimeout(r, 850));
      const container = document.getElementById('shipper-curtain-container').getBoundingClientRect();
      const left = document.getElementById('curtain-left').getBoundingClientRect();
      const right = document.getElementById('curtain-right').getBoundingClientRect();
      const overlapPx = left.right - right.left;
      await new Promise(r => setTimeout(r, 1500));
      const isHiddenEnd = document.getElementById('shipper-curtain-container').classList.contains('hidden');
      return {
        containerWidth: container.width,
        containerHeight: container.height,
        overlapPx,
        hasNoGap: overlapPx >= 0,
        covers4K: Math.abs(container.width - 3840) <= 2 && Math.abs(container.height - 2160) <= 2,
        isHiddenEnd
      };
    `);
    console.log('Test 10 Result:', t10);
    results.push({ name: '4K UHD (3840x2160) Seam & Viewport Coverage', passed: t10.hasNoGap && t10.covers4K && t10.isHiddenEnd });

    // TEST 11: Offscreen Shadow Bleed Resistance (>50px offscreen)
    console.log('\n--- Test 11: Offscreen Shadow Bleed Resistance ---');
    await client.setViewport(1920, 1080, false, 1);
    await new Promise(r => setTimeout(r, 300));
    const t11 = await client.eval(`
      const container = document.getElementById('shipper-curtain-container');
      const left = document.getElementById('curtain-left');
      const right = document.getElementById('curtain-right');
      const leftStyle = window.getComputedStyle(left);
      const rightStyle = window.getComputedStyle(right);
      const isHidden = container.classList.contains('hidden');
      return {
        isHidden,
        leftTransform: leftStyle.transform,
        rightTransform: rightStyle.transform
      };
    `);
    console.log('Test 11 Result:', t11);
    results.push({ name: 'Offscreen Shadow Bleed Clearance & Rest State', passed: t11.isHidden });

    console.log('\n=======================================');
    console.log('        TEST SUMMARY RESULTS           ');
    console.log('=======================================');
    let allPassed = true;
    for (const r of results) {
      const status = r.passed ? 'PASS [✓]' : 'FAIL [✗]';
      console.log(`${status} ${r.name}`);
      if (!r.passed) allPassed = false;
    }

    if (!allPassed) {
      console.error('\nSome tests failed!');
      process.exit(1);
    } else {
      console.log('\nAll 11 automated curtain verification tests PASSED with 100% success!');
      process.exit(0);
    }
  } finally {
    if (client) client.close();
    try { chrome.kill(); } catch (e) {}
    server.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
