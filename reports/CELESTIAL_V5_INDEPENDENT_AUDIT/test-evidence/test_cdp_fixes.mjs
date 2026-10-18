import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import assert from 'assert';

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
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
    res.writeHead(200, { 'Content-Type': 'text/html' });
    fs.createReadStream(path.join(distDir, 'index.html')).pipe(res);
  }
});

const PORT = 5299;
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

server.listen(PORT, async () => {
  const cdpPort = 9266;
  const tmpDir = path.join(rootDir, 'scratch', 'tmp_cdp_' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  const chrome = spawn(chromePath, [
    '--headless=new',
    '--window-size=1440,900',
    `--user-data-dir=${tmpDir}`,
    `--remote-debugging-port=${cdpPort}`,
    `http://localhost:${PORT}`
  ]);

  try {
    let wsUrl = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 200));
      try {
        const res = await fetch(`http://127.0.0.1:${cdpPort}/json`);
        const tabs = await res.json();
        const tab = tabs.find(t => t.type === 'page');
        if (tab && tab.webSocketDebuggerUrl) {
          wsUrl = tab.webSocketDebuggerUrl;
          break;
        }
      } catch (e) {}
    }

    const ws = new globalThis.WebSocket(wsUrl);
    await new Promise(res => { ws.onopen = res; });
    let msgId = 1;
    const send = (method, params = {}) => {
      const id = msgId++;
      return new Promise(resolve => {
        const h = (evt) => {
          const data = JSON.parse(evt.data);
          if (data.id === id) {
            ws.removeEventListener('message', h);
            resolve(data.result);
          }
        };
        ws.addEventListener('message', h);
        ws.send(JSON.stringify({ id, method, params }));
      });
    };

    await send('Runtime.enable');
    await send('Page.enable');

    ws.addEventListener('message', (evt) => {
      const data = JSON.parse(evt.data);
      if (data.method === 'Runtime.consoleAPICalled') {
        const text = data.params.args.map(a => a.value || a.description).join(' ');
        if (data.params.type === 'error') {
          console.error('BROWSER ERROR:', text);
        }
      }
      if (data.method === 'Runtime.exceptionThrown') {
        console.error('BROWSER EXCEPTION:', data.params.exceptionDetails);
      }
    });

    await new Promise(r => setTimeout(r, 1500));

    // Seed test vocabulary
    await send('Runtime.evaluate', {
      expression: `(async () => {
        await window.__celestialAudit.seed();
      })()`,
      awaitPromise: true
    });
    await new Promise(r => setTimeout(r, 500));

    console.log('======================================================');
    console.log('VERIFYING TARGETED REMEDIATIONS IN REAL BROWSER');
    console.log('======================================================\n');

    // TEST 1: Space Key Flip from Front to Back
    console.log('--- TEST 1: Space Key Flip (Front to Back) ---');
    const beforeFront = await send('Runtime.evaluate', {
      expression: `(() => {
        const card = document.getElementById('flashcard');
        return {
          english: document.getElementById('card-english')?.textContent,
          isFlipped: card.classList.contains('is-flipped')
        };
      })()`,
      returnByValue: true
    });
    console.log('Initial Card state:', beforeFront.result.value);
    assert.strictEqual(beforeFront.result.value.isFlipped, false, 'Initial card must be front face');

    // Send Space key
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      windowsVirtualKeyCode: 32,
      code: 'Space',
      key: ' ',
      text: ' '
    });
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      windowsVirtualKeyCode: 32,
      code: 'Space',
      key: ' '
    });

    await new Promise(r => setTimeout(r, 700));

    const afterSpaceFront = await send('Runtime.evaluate', {
      expression: `(() => {
        const card = document.getElementById('flashcard');
        const active = document.activeElement;
        return {
          isFlipped: card.classList.contains('is-flipped'),
          activeTag: active?.tagName,
          activeRating: active?.getAttribute('data-rating')
        };
      })()`,
      returnByValue: true
    });
    console.log('After Space state:', afterSpaceFront.result.value);
    assert.strictEqual(afterSpaceFront.result.value.isFlipped, true, 'Card must be flipped to back');
    assert.strictEqual(afterSpaceFront.result.value.activeRating, '3', 'Button 3 (Good) should be focused upon flip');
    console.log('✅ TEST 1 PASSED: Space successfully flipped card and focused Good button.\n');

    // TEST 2: Space Key on Focused Button 3 Rates Card as Good (3) and Advances
    console.log('--- TEST 2: Space Key Activation on Focused Button 3 ---');
    const initialWord = beforeFront.result.value.english;

    // Send Space key on the focused Button 3
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      windowsVirtualKeyCode: 32,
      code: 'Space',
      key: ' ',
      text: ' '
    });
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      windowsVirtualKeyCode: 32,
      code: 'Space',
      key: ' '
    });

    // Wait for rating & animation transition
    await new Promise(r => setTimeout(r, 1100));

    const afterSpaceRating = await send('Runtime.evaluate', {
      expression: `(() => {
        const card = document.getElementById('flashcard');
        return {
          english: document.getElementById('card-english')?.textContent,
          isFlipped: card.classList.contains('is-flipped'),
          isTransitioning: false
        };
      })()`,
      returnByValue: true
    });
    console.log('After Rating Space state:', afterSpaceRating.result.value);
    assert.notStrictEqual(afterSpaceRating.result.value.english, initialWord, 'Card should have advanced to the next word');
    console.log('✅ TEST 2 PASSED: Pressing Space on focused Button 3 rated and advanced card!\n');

    // TEST 3: Rapid Undo (< 400ms Deadzone Elimination)
    console.log('--- TEST 3: Fast Undo During Transition (< 400ms) ---');
    const card2English = afterSpaceRating.result.value.english;
    console.log(`Current word before rating: "${card2English}"`);

    // Flip and rate word 2
    await send('Runtime.evaluate', {
      expression: `(async () => {
        await window.__celestialAudit.flipCard();
        await new Promise(r => setTimeout(r, 600));
        const btnGood = document.querySelector('.srs-btn[data-rating="3"]');
        btnGood.click(); // Triggers processSrsFeedback and starts switchCardWithAnimation
      })()`,
      awaitPromise: true
    });

    // Wait only 150ms (transition animation is now actively running in-flight)
    await new Promise(r => setTimeout(r, 150));

    const checkDuringTransition = await send('Runtime.evaluate', {
      expression: `(() => {
        const undoBtn = document.getElementById('undo-btn');
        return {
          undoDisabled: undoBtn ? undoBtn.disabled : true
        };
      })()`,
      returnByValue: true
    });
    console.log('Transition state at 150ms:', checkDuringTransition.result.value);

    // Trigger fast Undo via shortcut (Ctrl+Shift+Z) right during the in-flight transition!
    await send('Runtime.evaluate', {
      expression: `(() => {
        const evt = new KeyboardEvent('keydown', {
          key: 'z',
          code: 'KeyZ',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true
        });
        document.dispatchEvent(evt);
      })()`
    });

    // Allow queued wait + restore animation to complete
    await new Promise(r => setTimeout(r, 1400));

    const checkAfterFastUndo = await send('Runtime.evaluate', {
      expression: `(() => {
        return {
          currentEnglish: document.getElementById('card-english')?.textContent
        };
      })()`,
      returnByValue: true
    });
    console.log('Card word after Fast Undo:', checkAfterFastUndo.result.value);
    assert.strictEqual(checkAfterFastUndo.result.value.currentEnglish, card2English, 'Card must be restored to word 2 after fast undo');
    console.log('✅ TEST 3 PASSED: Fast Undo executed smoothly without deadzone!\n');

    // TEST 4: Focused Interactive Button Accessibility (Star & TTS Button)
    console.log('--- TEST 4: Keyboard Accessibility for Focused Non-Flip Buttons ---');
    const starBefore = await send('Runtime.evaluate', {
      expression: `(() => {
        const starBtn = document.getElementById('star-btn');
        starBtn.focus();
        return {
          starClass: starBtn.className,
          isStarred: starBtn.classList.contains('starred')
        };
      })()`,
      returnByValue: true
    });
    console.log('Star button focused state before Space:', starBefore.result.value);

    // Send Space to focused star button
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      windowsVirtualKeyCode: 32,
      code: 'Space',
      key: ' ',
      text: ' '
    });
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      windowsVirtualKeyCode: 32,
      code: 'Space',
      key: ' '
    });
    await new Promise(r => setTimeout(r, 400));

    const starAfter = await send('Runtime.evaluate', {
      expression: `(() => {
        const starBtn = document.getElementById('star-btn');
        const card = document.getElementById('flashcard');
        return {
          starClass: starBtn.className,
          isStarred: starBtn.classList.contains('starred'),
          isFlipped: card.classList.contains('is-flipped')
        };
      })()`,
      returnByValue: true
    });
    console.log('Star button state after Space:', starAfter.result.value);
    assert.notStrictEqual(starBefore.result.value.isStarred, starAfter.result.value.isStarred, 'Space must toggle star button');
    assert.strictEqual(starAfter.result.value.isFlipped, false, 'Card must NOT have flipped when Space was pressed on focused star button');
    console.log('✅ TEST 4 PASSED: Space on focused button activates the button without hijacking flip!\n');

    // TEST 5: Word List Container Scrollbar Clearance (Hub Tab 2)
    console.log('--- TEST 5: Hub Tab 2 Word List Container Scrollbar Clearance ---');
    const wordListStyle = await send('Runtime.evaluate', {
      expression: `(async () => {
        await window.__celestialAudit.openHub('words');
        await new Promise(r => setTimeout(r, 500));
        const container = document.querySelector('.word-list-cards-container');
        const style = window.getComputedStyle(container);
        return {
          paddingRight: style.paddingRight,
          scrollbarGutter: style.scrollbarGutter
        };
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    console.log('Word list container styles:', wordListStyle.result.value);
    assert.ok(parseFloat(wordListStyle.result.value.paddingRight) >= 14, 'Padding right must be at least 14px');
    console.log('✅ TEST 5 PASSED: Word list container has stable scrollbar clearance!\n');

    console.log('🎉 ALL CDP BROWSER REMEDIATION TESTS PASSED 100%!');

    ws.close();
  } catch (err) {
    console.error('CDP test failure:', err);
    process.exit(1);
  } finally {
    chrome.kill();
    server.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    process.exit(0);
  }
});
