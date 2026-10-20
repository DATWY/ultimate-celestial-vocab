import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import assert from 'assert';

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
        } catch (e) {
          reject(e);
        }
      };
      this.ws.onerror = reject;
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.msgId++;
      const handler = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id === id) {
          this.ws.removeEventListener('message', handler);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      };
      this.ws.addEventListener('message', handler);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    }
    return res.result?.value;
  }
}

async function runTest() {
  const PORT = 5291;
  console.log(`🚀 Starting Vite Dev Server on port ${PORT}...`);
  const viteProc = spawn('npx.cmd', ['vite', '--port', String(PORT), '--strictPort'], {
    shell: true,
    cwd: process.cwd()
  });

  // Chờ Vite khởi động
  for (let retry = 0; retry < 20; retry++) {
    try {
      await new Promise(r => setTimeout(r, 400));
      const r = await fetch(`http://localhost:${PORT}/index.html`);
      if (r.ok) break;
    } catch (e) {}
  }
  console.log(`✓ Vite Dev Server ready on http://localhost:${PORT}`);

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const tmpUserData = path.join(process.cwd(), 'tmp_audit_verify_loop_vite');
  if (fs.existsSync(tmpUserData)) {
    try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch (e) {}
  }

  const chromeProc = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9245',
    `--user-data-dir=${tmpUserData}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `http://localhost:${PORT}`
  ]);

  await new Promise(r => setTimeout(r, 1500));

  let cdp = null;
  try {
    const listRes = await fetch('http://localhost:9245/json/list').then(r => r.json());
    const pageTarget = listRes.find(t => t.type === 'page');
    if (!pageTarget) throw new Error('Cannot find Chrome page target');
    cdp = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await cdp.init();

    await new Promise(r => setTimeout(r, 1500));

    console.log('\n======================================================');
    console.log('   BẮT ĐẦU KIỂM THỬ TRÌNH DUYỆT THẬT (CHROME HEADLESS) ');
    console.log('======================================================\n');

    // 1. Kiểm tra buildReviewQueue với Today Filter & chống lặp thẻ Mastered
    console.log('--- TEST BROWSER 1: Chống lặp thẻ Mastered đã ôn hôm nay ---');
    const queueTestResult = await cdp.evaluate(`
      (async () => {
        const stateModule = await import('/src/core/state.js');
        const queueModule = await import('/src/core/queue.js');
        
        const now = Date.now();
        const testVocab = [
          {
            id: 'word-mastered-today',
            english: 'Rational',
            vietnamese: 'Hợp lý, có lý trí',
            srsStatus: 'Mastered',
            difficulty: 9.87,
            stability: 0.91,
            lastReviewDate: now,
            srsDueDate: now - 5000 // Hạn quá khứ do bẫy 98s cũ
          },
          {
            id: 'word-real-due',
            english: 'Comply',
            vietnamese: 'Tuân thủ',
            srsStatus: 'Mastered',
            difficulty: 5.0,
            stability: 10.0,
            lastReviewDate: now - 86400000 * 5,
            srsDueDate: now - 10000 // Chưa ôn hôm nay và đã đến hạn
          }
        ];
        
        stateModule.setVocabulary(testVocab);
        queueModule.buildReviewQueue();
        const queue = stateModule.getState().currentReviewQueue;
        
        return {
          queue,
          includesRational: queue.includes(0),
          includesComply: queue.includes(1)
        };
      })()
    `);

    console.log('1.1 Kết quả hàng đợi:', queueTestResult);
    assert.strictEqual(queueTestResult.includesRational, false, 'Rational ĐÃ ÔN HÔM NAY không được lọt vào hàng đợi');
    assert.strictEqual(queueTestResult.includesComply, true, 'Comply CHƯA ÔN HÔM NAY phải có trong hàng đợi');
    console.log('✓ TEST BROWSER 1 PASS: Thẻ Mastered đã ôn hôm nay không bao giờ bị bốc lại vào hàng đợi.\n');

    // 2. Kiểm tra insertCardForLearningStep chống trùng lặp
    console.log('--- TEST BROWSER 2: Chống chèn trùng lặp vào hàng đợi ---');
    const dedupQueueResult = await cdp.evaluate(`
      (async () => {
        const stateModule = await import('/src/core/state.js');
        const queueModule = await import('/src/core/queue.js');
        
        stateModule.setReviewQueue([10, 20, 30]);
        queueModule.insertCardForLearningStep(99);
        const q1 = [...stateModule.getState().currentReviewQueue];
        
        // Chèn lại lần 2 thẻ 99:
        queueModule.insertCardForLearningStep(99);
        const q2 = [...stateModule.getState().currentReviewQueue];
        
        return { q1, q2 };
      })()
    `);

    console.log('2.1 Kết quả chèn thẻ:', dedupQueueResult);
    assert.deepStrictEqual(dedupQueueResult.q1, [10, 20, 30, 99]);
    assert.deepStrictEqual(dedupQueueResult.q2, [10, 20, 30, 99]);
    console.log('✓ TEST BROWSER 2 PASS: Hàng đợi loại bỏ 100% rủi ro trùng lặp thẻ.\n');

    // 3. Kiểm tra FSRS-7 tính toán Tốt nghiệp có khóa sàn >= 1.0 ngày
    console.log('--- TEST BROWSER 3: Graduation Floor Guard >= 1.0 ngày ---');
    const srsGraduationResult = await cdp.evaluate(`
      (async () => {
        const srsModule = await import('/src/core/srs/index.js');
        const extremeCard = {
          english: 'Rational',
          difficulty: 9.87,
          stability: 0.91,
          stabilityShort: 0.72,
          srsStatus: 'Learning',
          reps: 2,
          lapses: 4,
          lastReviewDate: Date.now() - 300000
        };
        const { newState } = srsModule.calculateNextSrsState(extremeCard, 3, 'en-vi');
        return {
          status: newState.srsStatus,
          interval: newState.srsInterval,
          dueInDays: (newState.srsDueDate - Date.now()) / 86400000
        };
      })()
    `);

    console.log('3.1 Kết quả FSRS-7 Tốt nghiệp:', srsGraduationResult);
    assert.strictEqual(srsGraduationResult.status, 'Mastered');
    assert(srsGraduationResult.interval >= 1.0, 'Interval phải >= 1.0 ngày');
    assert(srsGraduationResult.dueInDays >= 0.99, 'Hạn ôn phải ở ngày mai');
    console.log('✓ TEST BROWSER 3 PASS: Khóa sàn Tốt nghiệp bảo đảm chu kỳ >= 1.0 ngày.\n');

    console.log('======================================================');
    console.log('   TẤT CẢ CÁC BÀI TEST TRÌNH DUYỆT ĐÃ PASS 100%!     ');
    console.log('======================================================');

  } finally {
    if (chromeProc) chromeProc.kill();
    if (viteProc) {
      try { process.kill(viteProc.pid); } catch (e) {}
    }
    if (fs.existsSync(tmpUserData)) {
      try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch (e) {}
    }
  }
}

runTest().catch(err => {
  console.error('TEST ERROR:', err);
  process.exit(1);
});
