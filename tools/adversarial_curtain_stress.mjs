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

const PORT = 5299;
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

async function runAdversarialStressTests() {
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

  await new Promise(r => server.listen(0, r));
  const actualPort = server.address().port;
  console.log(`[CHALLENGER] Adversarial Stress Server running on dynamic port ${actualPort}`);

  const cdpPort = 9333 + Math.floor(Math.random() * 50);
  const tmpDir = path.join(rootDir, 'scratch', 'tmp_adversarial_' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  const args = [
    '--headless=new',
    '--window-size=1920,1080',
    `--user-data-dir=${tmpDir}`,
    `--remote-debugging-port=${cdpPort}`,
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `http://localhost:${actualPort}/?theme=dark`
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
    await new Promise(r => setTimeout(r, 1500));

    const testResults = [];

    // =========================================================================
    // SECTION 1: EXTREME VIEWPORT RATIO MATRIX & SEAM OVERLAP (>= 24px)
    // =========================================================================
    const viewportsToTest = [
      { name: 'Ultra-Narrow iPhone SE 1st Gen (320x568)', w: 320, h: 568, mobile: true, dsf: 2 },
      { name: 'Ultra-Narrow Android Compact (360x640)', w: 360, h: 640, mobile: true, dsf: 3 },
      { name: 'Standard Modern iPhone 14 (390x844)', w: 390, h: 844, mobile: true, dsf: 3 },
      { name: 'Odd Dimension Fractional DPI (1365x768 @ 1.25x)', w: 1365, h: 768, mobile: false, dsf: 1.25 },
      { name: 'Classic HD Laptop (1366x768)', w: 1366, h: 768, mobile: false, dsf: 1 },
      { name: 'Standard Widescreen Laptop (1440x900)', w: 1440, h: 900, mobile: false, dsf: 1 },
      { name: 'Full HD Desktop (1920x1080)', w: 1920, h: 1080, mobile: false, dsf: 1 },
      { name: 'Ultrawide 21:9 Monitor (3440x1440)', w: 3440, h: 1440, mobile: false, dsf: 1 },
      { name: '4K UHD Television / Monitor (3840x2160)', w: 3840, h: 2160, mobile: false, dsf: 1 },
      { name: 'DCI Cinema 4K (4096x2160)', w: 4096, h: 2160, mobile: false, dsf: 1 },
      { name: 'Extreme Landscape Mobile (844x390 @ 3x)', w: 844, h: 390, mobile: true, dsf: 3 },
      { name: 'Extreme Landscape Android (640x360 @ 2x)', w: 640, h: 360, mobile: true, dsf: 2 }
    ];

    console.log('\n======================================================');
    console.log(' SECTION 1: EXTREME VIEWPORT & SEAM OVERLAP (>= 24px) ');
    console.log('======================================================');

    for (const vp of viewportsToTest) {
      await client.setViewport(vp.w, vp.h, vp.mobile, vp.dsf);
      await new Promise(r => setTimeout(r, 350));

      const res = await client.eval(`
        const btn = document.getElementById('toggle-dark-mode-btn');
        btn.click();
        await new Promise(r => setTimeout(r, 850)); // Center apex dwell

        const container = document.getElementById('shipper-curtain-container');
        const containerRect = container.getBoundingClientRect();
        const left = document.getElementById('curtain-left').getBoundingClientRect();
        const right = document.getElementById('curtain-right').getBoundingClientRect();
        
        const overlapPx = left.right - right.left;
        const widthCovers = Math.abs(containerRect.width - window.innerWidth) <= 2;
        const heightCovers = Math.abs(containerRect.height - window.innerHeight) <= 2;
        const leftCovered = left.left <= 0.5;
        const rightCovered = right.right >= (window.innerWidth - 0.5);

        await new Promise(r => setTimeout(r, 1600)); // Finish transition & cleanup
        const isHidden = container.classList.contains('hidden');
        const isClean = !document.getElementById('curtain-left').classList.contains('curtain-left-opening') &&
                        !document.getElementById('curtain-right').classList.contains('curtain-right-opening');

        return {
          viewport: { w: window.innerWidth, h: window.innerHeight },
          containerRect: { width: containerRect.width, height: containerRect.height },
          left: { left: left.left, right: left.right, width: left.width },
          right: { left: right.left, right: right.right, width: right.width },
          overlapPx,
          hasNoGap: overlapPx >= 0,
          hasAtLeast24PxOverlap: overlapPx >= 23.95,
          fullCoverage: widthCovers && heightCovers && leftCovered && rightCovered,
          cleanExit: isHidden && isClean
        };
      `);

      const passed = res.hasAtLeast24PxOverlap && res.hasNoGap && res.fullCoverage && res.cleanExit;
      console.log(`[VIEWPORT] ${vp.name}`);
      console.log(`  -> Overlap: ${res.overlapPx.toFixed(2)}px | >=24px: ${res.hasAtLeast24PxOverlap} | Coverage: ${res.fullCoverage} | CleanExit: ${res.cleanExit}`);
      testResults.push({
        category: 'Viewport Overlap',
        name: vp.name,
        passed,
        details: res
      });
    }

    // =========================================================================
    // SECTION 2: ADVERSARIAL RAPID CLICKING & RACE CONDITION HARNESS
    // =========================================================================
    console.log('\n======================================================');
    console.log(' SECTION 2: ADVERSARIAL RAPID CLICKING & RACE CONFLICT ');
    console.log('======================================================');

    // Test A: Rapid clicking burst during Phase 1 closing (20 clicks, 25ms interval)
    console.log('\n--- Stress Test A: Phase 1 Closing Rapid Click Barrage ---');
    const stressA = await client.eval(`
      const btn = document.getElementById('toggle-dark-mode-btn');
      const startTheme = document.body.classList.contains('dark-mode');
      
      // Fire initial click
      btn.click();
      
      // Fire 20 rapid clicks during Phase 1 closing (0ms - 500ms)
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 25));
        btn.click();
      }

      // Check pointer-events shield blocks clicks
      const container = document.getElementById('shipper-curtain-container');
      const shieldActive = window.getComputedStyle(container).pointerEvents === 'auto';
      
      // Wait for complete cycle (total ~2500ms)
      await new Promise(r => setTimeout(r, 2500));
      const endTheme = document.body.classList.contains('dark-mode');
      const isHidden = container.classList.contains('hidden');
      const isClean = !document.getElementById('curtain-left').classList.contains('curtain-left-opening') &&
                      !document.getElementById('curtain-right').classList.contains('curtain-right-opening');

      return {
        themeToggledExactlyOnce: startTheme !== endTheme,
        shieldActive,
        isHidden,
        isClean
      };
    `);
    console.log('Stress Test A Result:', stressA);
    testResults.push({
      category: 'Race Conditions',
      name: 'Phase 1 Closing Rapid Click Barrage (20 clicks @ 25ms)',
      passed: stressA.themeToggledExactlyOnce && stressA.shieldActive && stressA.isHidden && stressA.isClean,
      details: stressA
    });

    // Test B: Dwell Phase Rapid Burst (15 clicks directly at apex dwell 750ms - 1050ms)
    console.log('\n--- Stress Test B: Apex Dwell Rapid Click Barrage ---');
    const stressB = await client.eval(`
      const btn = document.getElementById('toggle-dark-mode-btn');
      const startTheme = document.body.classList.contains('dark-mode');
      
      btn.click();
      await new Promise(r => setTimeout(r, 750)); // Wait until apex dwell
      
      // Fire 15 rapid clicks during dwell when theme is swapping
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 20));
        btn.click();
      }

      await new Promise(r => setTimeout(r, 2200));
      const container = document.getElementById('shipper-curtain-container');
      const endTheme = document.body.classList.contains('dark-mode');
      const isHidden = container.classList.contains('hidden');
      const isClean = !document.getElementById('curtain-left').classList.contains('curtain-left-opening') &&
                      !document.getElementById('curtain-right').classList.contains('curtain-right-opening');

      return {
        themeToggledExactlyOnce: startTheme !== endTheme,
        isHidden,
        isClean
      };
    `);
    console.log('Stress Test B Result:', stressB);
    testResults.push({
      category: 'Race Conditions',
      name: 'Apex Dwell Rapid Click Barrage (15 clicks @ 20ms)',
      passed: stressB.themeToggledExactlyOnce && stressB.isHidden && stressB.isClean,
      details: stressB
    });

    // Test C1: Active In-Flight Rapid Barrage (35 rapid clicks @ 30ms across Phase 1 & 2)
    console.log('\n--- Stress Test C1: Active In-Flight Rapid Barrage (35 clicks @ 30ms) ---');
    const stressC1 = await client.eval(`
      const btn = document.getElementById('toggle-dark-mode-btn');
      const startTheme = document.body.classList.contains('dark-mode');
      
      // Fire initial click to start transition
      btn.click();
      
      // Rapid-fire 35 clicks strictly within the active in-flight lifecycle (35 * 30ms = 1050ms)
      for (let i = 0; i < 35; i++) {
        await new Promise(r => setTimeout(r, 30));
        btn.click();
      }

      // Wait for the single transition to complete (~2300ms from start)
      await new Promise(r => setTimeout(r, 1400));
      const container = document.getElementById('shipper-curtain-container');
      const isHidden = container.classList.contains('hidden');
      const isClean = !document.getElementById('curtain-left').classList.contains('curtain-left-opening') &&
                      !document.getElementById('curtain-right').classList.contains('curtain-right-opening');
      const themeAfterTransition = document.body.classList.contains('dark-mode');

      // Verify immediate post-barrage responsiveness
      btn.click();
      await new Promise(r => setTimeout(r, 2300));
      const themeAfterPostClick = document.body.classList.contains('dark-mode');

      return {
        themeToggledExactlyOnceInFlight: startTheme !== themeAfterTransition,
        curtainCleanAndHidden: isHidden && isClean,
        responsivePostBarrage: themeAfterTransition !== themeAfterPostClick
      };
    `);
    console.log('Stress Test C1 Result:', stressC1);
    testResults.push({
      category: 'Race Conditions',
      name: 'Active In-Flight Barrage (35 clicks @ 30ms) & Post-Recovery',
      passed: stressC1.themeToggledExactlyOnceInFlight && stressC1.curtainCleanAndHidden && stressC1.responsivePostBarrage,
      details: stressC1
    });

    // Test C2: Continuous Multi-Cycle Boundary Barrage (60 clicks @ 40ms = 2400ms across boundary)
    console.log('\n--- Stress Test C2: Multi-Cycle Boundary Crossing Barrage (60 clicks @ 40ms) ---');
    const stressC2 = await client.eval(`
      const btn = document.getElementById('toggle-dark-mode-btn');
      const container = document.getElementById('shipper-curtain-container');
      const left = document.getElementById('curtain-left');
      const right = document.getElementById('curtain-right');
      
      // Hammer continuously across 2400ms (crosses cycle 1 boundary into cycle 2)
      for (let i = 0; i < 60; i++) {
        btn.click();
        await new Promise(r => setTimeout(r, 40));
      }

      // Allow full completion of any boundary-triggered cycle (~2400ms buffer)
      await new Promise(r => setTimeout(r, 2400));
      const isHidden = container.classList.contains('hidden');
      const isClean = !left.classList.contains('curtain-left-opening') &&
                      !left.classList.contains('curtain-left-closing') &&
                      !right.classList.contains('curtain-right-opening') &&
                      !right.classList.contains('curtain-right-closing');

      return {
        curtainNotStuck: isHidden,
        classesClean: isClean
      };
    `);
    console.log('Stress Test C2 Result:', stressC2);
    testResults.push({
      category: 'Race Conditions',
      name: 'Multi-Cycle Boundary Crossing Barrage (60 clicks @ 40ms, zero stuck state)',
      passed: stressC2.curtainNotStuck && stressC2.classesClean,
      details: stressC2
    });

    // Test D: Boost Mode Rapid Toggle Stress
    console.log('\n--- Stress Test D: Boost Mode Rapid Toggle Stress ---');
    const stressD = await client.eval(`
      const boostBtn = document.getElementById('toggle-boost-mode-btn');
      const themeBtn = document.getElementById('toggle-dark-mode-btn');
      const container = document.getElementById('shipper-curtain-container');
      
      boostBtn.click(); // Enable boost mode
      await new Promise(r => setTimeout(r, 100));

      let toggles = 0;
      for (let i = 0; i < 20; i++) {
        const before = document.body.classList.contains('dark-mode');
        themeBtn.click();
        const after = document.body.classList.contains('dark-mode');
        if (before !== after) toggles++;
        await new Promise(r => setTimeout(r, 20));
      }

      const curtainStayedHidden = container.classList.contains('hidden');
      boostBtn.click(); // Restore normal mode
      await new Promise(r => setTimeout(r, 100));

      return {
        togglesCount: toggles,
        curtainStayedHidden,
        allInstantSwapped: toggles === 20
      };
    `);
    console.log('Stress Test D Result:', stressD);
    testResults.push({
      category: 'Race Conditions',
      name: 'Boost Mode 20x Rapid Instant Swaps (0ms Curtain Bypass)',
      passed: stressD.allInstantSwapped && stressD.curtainStayedHidden,
      details: stressD
    });

    // =========================================================================
    // FINAL REPORT SUMMARY
    // =========================================================================
    console.log('\n======================================================');
    console.log('      CHALLENGER ADVERSARIAL STRESS TEST SUMMARY      ');
    console.log('======================================================');
    let totalPassed = 0;
    for (const r of testResults) {
      const mark = r.passed ? 'PASS [✓]' : 'FAIL [✗]';
      console.log(`${mark} [${r.category}] ${r.name}`);
      if (r.passed) totalPassed++;
    }

    console.log(`\nScore: ${totalPassed} / ${testResults.length} passed.`);
    if (totalPassed === testResults.length) {
      console.log('VERDICT: ALL ADVERSARIAL STRESS TESTS PASSED WITH 100% SUCCESS.');
      process.exit(0);
    } else {
      console.error('VERDICT: FAILURES DETECTED IN ADVERSARIAL STRESS TEST.');
      process.exit(1);
    }

  } finally {
    if (client) client.close();
    try { chrome.kill(); } catch (e) {}
    server.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  }
}

runAdversarialStressTests().catch(err => {
  console.error('[CHALLENGER FATAL ERROR]:', err);
  process.exit(1);
});
