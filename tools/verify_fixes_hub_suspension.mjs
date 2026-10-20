import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import assert from 'assert';

const distDir = path.join(process.cwd(), 'dist');
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
    res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    fs.createReadStream(path.join(distDir, 'index.html')).pipe(res);
  }
});

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
        } catch (err) { reject(err); }
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
      throw new Error(res.exceptionDetails.text + ': ' + (res.exceptionDetails.exception?.description || ''));
    }
    return res.result?.value;
  }
  close() {
    try { this.ws.close(); } catch (e) {}
  }
}

const PORT = 5210;
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

server.listen(PORT, async () => {
  const tmpDir = path.join(process.cwd(), 'tmp_audit_verify_fixes');
  fs.mkdirSync(tmpDir, { recursive: true });
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9235',
    '--user-data-dir=' + tmpDir,
    '--window-size=1024,640'
  ]);

  try {
    let pagesRes = null;
    for (let retry = 0; retry < 15; retry++) {
      try {
        await new Promise(r => setTimeout(r, 400));
        pagesRes = await fetch(`http://localhost:9235/json`);
        if (pagesRes.ok) break;
      } catch (e) {}
    }
    if (!pagesRes) throw new Error('Không thể kết nối Chrome DevTools port 9235 sau 6 giây');
    const pages = await pagesRes.json();
    const page = pages.find(p => p.type === 'page') || pages[0];
    const cdp = new CDPClient(page.webSocketDebuggerUrl);
    await cdp.init();

    await cdp.send('Page.navigate', { url: `http://localhost:${PORT}` });
    await new Promise(r => setTimeout(r, 1800));

    console.log('\n======================================================');
    console.log('   BẮT ĐẦU KIỂM THỬ TỰ ĐỘNG CHUYÊN SÂU LỖI 1 & LỖI 2   ');
    console.log('======================================================\n');

    // TEST SUITE 1: KIỂM THỬ LỖI 1 (CELESTIAL HUB VISUAL & ALIGNMENT)
    console.log('--- TEST GROUP 1: Lỗi 1 - Khung Celestial Hub & Viền Đen ---');

    // 1.1 Kiểm tra contain trên #app-container
    const appContainerContain = await cdp.eval(`
      const el = document.getElementById('app-container');
      return window.getComputedStyle(el).contain;
    `);
    console.log('1.1 Computed contain trên #app-container:', appContainerContain);
    assert(!appContainerContain.includes('layout'), '#app-container KHÔNG ĐƯỢC có contain: layout (gây bẫy fixed modal)');

    // 1.2 Mở Celestial Hub
    await cdp.eval(`
      const hubBtn = document.getElementById('celestial-hub-btn');
      hubBtn.click();
    `);
    await new Promise(r => setTimeout(r, 600));

    // 1.3 Kiểm tra Rect của modal và modal-overlay
    const hubGeometry = await cdp.eval(`
      const modal = document.getElementById('manage-modal');
      const overlay = modal.querySelector('.modal-overlay');
      const panel = modal.querySelector('.manage-panel');
      const mR = modal.getBoundingClientRect();
      const oR = overlay.getBoundingClientRect();
      const pR = panel.getBoundingClientRect();

      return {
        viewport: { w: window.innerWidth, h: window.innerHeight },
        modal: { top: mR.top, left: mR.left, width: mR.width, height: mR.height },
        overlay: { top: oR.top, left: oR.left, width: oR.width, height: oR.height },
        panel: { top: pR.top, left: pR.left, width: pR.width, height: pR.height, bottom: pR.bottom },
        panelComputed: {
          marginTop: window.getComputedStyle(panel).marginTop,
          height: window.getComputedStyle(panel).height
        }
      };
    `);
    console.log('1.2 Kích thước & Căn chỉnh Hub Geometry:', JSON.stringify(hubGeometry, null, 2));

    assert(hubGeometry.overlay.top === 0 && hubGeometry.overlay.left === 0, 'Modal overlay phải phủ kín từ (0, 0)');
    assert(hubGeometry.overlay.width === hubGeometry.viewport.w, 'Modal overlay width phải bằng 100vw');
    assert(hubGeometry.overlay.height === hubGeometry.viewport.h, 'Modal overlay height phải bằng 100vh');
    assert(hubGeometry.panel.top >= 20, 'Khung Hub phải có khoảng cách đệm trên an toàn (top >= 20px), không dính sát viền trên');

    // 1.4 Chụp ảnh Dark Mode
    const snapDark = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const darkPath = 'C:/Users/ASUS/.gemini/antigravity/brain/081af82c-235e-4abe-8abf-fa0148a383b2/final_verified_hub_dark_1024x640.png';
    fs.writeFileSync(darkPath, Buffer.from(snapDark.data, 'base64'));
    console.log('✓ 1.3 Đã xuất ảnh kiểm chứng Dark Mode:', darkPath);

    // 1.5 Chuyển Light Mode & Chụp ảnh
    await cdp.eval(`
      document.body.classList.remove('dark-mode');
      localStorage.setItem('celestialDarkMode', 'false');
    `);
    await new Promise(r => setTimeout(r, 500));

    const snapLight = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const lightPath = 'C:/Users/ASUS/.gemini/antigravity/brain/081af82c-235e-4abe-8abf-fa0148a383b2/final_verified_hub_light_1024x640.png';
    fs.writeFileSync(lightPath, Buffer.from(snapLight.data, 'base64'));
    console.log('✓ 1.4 Đã xuất ảnh kiểm chứng Light Mode:', lightPath);

    // 1.6 Kiểm tra dropdown trạng thái không còn option 'Suspended'
    const statusOptions = await cdp.eval(`
      const sel = document.getElementById('panel-status-filter');
      return sel ? Array.from(sel.options).map(o => o.value) : [];
    `);
    console.log('1.5 Các option trạng thái từ vựng trong Hub:', statusOptions);
    assert(!statusOptions.includes('Suspended'), 'Option "Suspended" (Bị tạm ngưng) KHÔNG ĐƯỢC tồn tại trong menu chọn trạng thái');

    // Đóng modal
    await cdp.eval(`
      const closeBtn = document.getElementById('close-manage-modal-btn');
      closeBtn.click();
    `);
    await new Promise(r => setTimeout(r, 400));

    console.log('✓ NHÓM 1 HOÀN TẤT: Khung Celestial Hub đã được hạ xuống thanh thoát, viền đen thừa biến mất 100%!\n');

    // TEST SUITE 2: KIỂM THỬ LỖI 2 (ABOLISH SUSPENSION MODE ACROSS THE SYSTEM)
    console.log('--- TEST GROUP 2: Lỗi 2 - Bãi Bỏ Triệt Để Chế Độ Tạm Ngưng Từ Vựng ---');

    // 2.1 Test FSRS calculation với rating 1 (Again) trên thẻ có 7, 8, 15 lapses
    const { calculateNextSrsState } = await import('../src/core/srs/index.js');
      
    const mockCard7 = { english: 'ephemeral', stability: 2.0, stabilityShort: 1.5, difficulty: 8.0, lapses: 7, srsStatus: 'Learning' };
    const { newState: s7 } = calculateNextSrsState(mockCard7, 1, 'typing');

    const mockCard8 = { english: 'serendipity', stability: 1.0, stabilityShort: 0.8, difficulty: 9.0, lapses: 8, srsStatus: 'typing' };
    const { newState: s8 } = calculateNextSrsState(mockCard8, 1, 'typing');

    const mockCard15 = { english: 'tenacious', stability: 0.5, stabilityShort: 0.4, difficulty: 10.0, lapses: 15, srsStatus: 'Learning' };
    const { newState: s15 } = calculateNextSrsState(mockCard15, 1, 'en-vi');

    console.log('2.1 Kết quả FSRS-7 tính toán khi gõ sai / quên thẻ:');
    console.log('  - Thẻ 7 lapses gõ sai:', { lapses: s7.lapses, isSuspended: s7.isSuspended, status: s7.srsStatus });
    console.log('  - Thẻ 8 lapses gõ sai:', { lapses: s8.lapses, isSuspended: s8.isSuspended, status: s8.srsStatus });
    console.log('  - Thẻ 15 lapses quên:', { lapses: s15.lapses, isSuspended: s15.isSuspended, status: s15.srsStatus });

    assert(s7.lapses === 8, 'Thẻ 7 lapses khi sai phải tăng lên 8 lapses');
    assert(s7.isSuspended === false, 'Thẻ 8 lapses KHÔNG ĐƯỢC bị suspended');
    assert(s8.lapses === 9, 'Thẻ 8 lapses khi sai phải tăng lên 9 lapses');
    assert(s8.isSuspended === false, 'Thẻ 9 lapses KHÔNG ĐƯỢC bị suspended');
    assert(s15.lapses === 16, 'Thẻ 15 lapses khi sai phải tăng lên 16 lapses');
    assert(s15.isSuspended === false, 'Thẻ 16 lapses KHÔNG ĐƯỢC bị suspended');

    // 2.2 Kiểm tra trong Browser: Không có phần tử thẻ từ vựng nào mang class is-suspended hay nhãn Tạm ngưng
    const domCheck = await cdp.eval(`
      const hubBtn = document.getElementById('celestial-hub-btn');
      hubBtn.click();
      await new Promise(r => setTimeout(r, 400));
      const vocabTab = document.getElementById('tab-vocab-list');
      vocabTab.click();
      await new Promise(r => setTimeout(r, 400));

      const suspendedCards = document.querySelectorAll('.word-card.is-suspended');
      const suspendedLabels = Array.from(document.querySelectorAll('.word-card-status-bar, .word-card')).filter(e => e.textContent.includes('Tạm ngưng'));
      const reactivateBtns = document.querySelectorAll('.card-action-btn[title*="Kích hoạt"]');

      return {
        suspendedCardCount: suspendedCards.length,
        suspendedLabelCount: suspendedLabels.length,
        reactivateBtnCount: reactivateBtns.length
      };
    `);
    console.log('2.2 Kiểm tra DOM danh sách từ vựng trong Hub:', domCheck);
    assert(domCheck.suspendedCardCount === 0, 'Không được có thẻ mang class is-suspended');
    assert(domCheck.suspendedLabelCount === 0, 'Không được có nhãn "Tạm ngưng" trên thẻ');
    assert(domCheck.reactivateBtnCount === 0, 'Không được có nút kích hoạt lại thẻ tạm ngưng');

    console.log('\n======================================================');
    console.log('  TẤT CẢ CÁC BÀI TEST TỰ ĐỘNG LỖI 1 & LỖI 2 ĐÃ PASS 100%! ');
    console.log('======================================================\n');

    cdp.close();
  } catch (err) {
    console.error('TEST ERROR:', err);
    process.exit(1);
  } finally {
    try { chrome.kill(); } catch (e) {}
    server.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  }
});
