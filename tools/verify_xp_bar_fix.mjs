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

const PORT = 5212;
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

server.listen(PORT, async () => {
  const tmpDir = path.join(process.cwd(), 'tmp_audit_verify_xp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9238',
    '--user-data-dir=' + tmpDir,
    '--window-size=1024,640'
  ]);

  try {
    let pagesRes = null;
    for (let retry = 0; retry < 15; retry++) {
      try {
        await new Promise(r => setTimeout(r, 400));
        pagesRes = await fetch(`http://localhost:9238/json`);
        if (pagesRes.ok) break;
      } catch (e) {}
    }
    if (!pagesRes) throw new Error('Không thể kết nối Chrome DevTools port 9238 sau 6 giây');

    const pages = await pagesRes.json();
    const page = pages.find(p => p.type === 'page') || pages[0];
    const cdp = new CDPClient(page.webSocketDebuggerUrl);
    await cdp.init();

    await cdp.send('Page.navigate', { url: `http://localhost:${PORT}` });
    await new Promise(r => setTimeout(r, 1800));

    console.log('\n======================================================');
    console.log('   BẮT ĐẦU KIỂM THỬ TỰ ĐỘNG LỖI THANH XP Ở RANK       ');
    console.log('======================================================\n');

    // TEST 1: Kiểm tra khởi tạo ban đầu khi mở Celestial Hub
    console.log('--- TEST 1: Mở Celestial Hub và kiểm tra thanh XP ban đầu ---');
    await cdp.eval(`
      document.getElementById('celestial-hub-btn').click();
    `);
    await new Promise(r => setTimeout(r, 1000)); // Chờ animation kết thúc

    const initXpState = await cdp.eval(`
      const fill = document.getElementById('profile-xp-fill');
      const container = fill?.closest('.xp-bar-container');
      const level = document.getElementById('profile-level')?.textContent;
      const totalXp = document.getElementById('profile-total-xp')?.textContent;
      const needed = document.getElementById('profile-xp-needed')?.textContent;
      const rankTitle = document.querySelector('.level-card h3')?.textContent;

      const fillRect = fill.getBoundingClientRect();
      const contRect = container.getBoundingClientRect();

      return {
        level,
        totalXp,
        needed,
        rankTitle,
        styleWidth: fill.style.width,
        datasetTarget: fill.dataset.targetWidth,
        fillWidthPx: fillRect.width,
        contWidthPx: contRect.width
      };
    `);
    console.log('1.1 Trạng thái khởi tạo thanh XP:', initXpState);
    assert(initXpState.level !== '', 'Level phải có giá trị');
    assert(initXpState.totalXp !== '', 'Total XP phải có giá trị');
    assert(initXpState.rankTitle.includes('Đồng'), 'Rank ban đầu phải là Đồng');

    // TEST 2: Đổi Rank qua __testGamification.previewRank (Level 5 Đồng có 500 XP)
    console.log('\n--- TEST 2: Giả lập Level 5 với 500 XP ---');
    await cdp.eval(`
      window.__testGamification.previewRank(5);
    `);
    await new Promise(r => setTimeout(r, 1200));

    const state5XP = await cdp.eval(`
      const fill = document.getElementById('profile-xp-fill');
      const container = fill?.closest('.xp-bar-container');
      const fillRect = fill.getBoundingClientRect();
      const contRect = container.getBoundingClientRect();

      return {
        level: document.getElementById('profile-level')?.textContent,
        totalXp: document.getElementById('profile-total-xp')?.textContent,
        styleWidth: fill.style.width,
        datasetTarget: fill.dataset.targetWidth,
        fillWidthPx: fillRect.width,
        contWidthPx: contRect.width,
        percentWidth: (fillRect.width / contRect.width * 100).toFixed(1) + '%'
      };
    `);
    console.log('2.1 Trạng thái thanh XP sau khi nạp Level 5 (500 XP):', state5XP);
    assert(parseFloat(state5XP.styleWidth) > 0, `Thanh XP phải có style.width > 0%, thực tế: ${state5XP.styleWidth}`);
    assert(state5XP.fillWidthPx > 20, 'Chiều rộng thực tế bằng pixel của thanh XP phải lớn hơn 20px');

    // Chụp ảnh bằng chứng XP bar Level 5
    const snap5 = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const snap5Path = 'C:/Users/ASUS/.gemini/antigravity/brain/081af82c-235e-4abe-8abf-fa0148a383b2/verified_xp_bar_level5.png';
    fs.writeFileSync(snap5Path, Buffer.from(snap5.data, 'base64'));
    console.log('✓ 2.2 Đã chụp ảnh thanh XP Level 5:', snap5Path);

    // TEST 3: Thử nghiệm đổi Rank lên Bạc, Vàng, Bạch Kim bằng previewRank
    console.log('\n--- TEST 3: Đổi Rank lên Vàng (Level 25) và kiểm tra thanh XP ---');
    await cdp.eval(`
      window.__testGamification.previewRank(25);
    `);
    await new Promise(r => setTimeout(r, 1000));

    const stateGold = await cdp.eval(`
      const fill = document.getElementById('profile-xp-fill');
      const container = fill?.closest('.xp-bar-container');
      const fillRect = fill.getBoundingClientRect();
      const contRect = container.getBoundingClientRect();
      const rankCard = document.querySelector('.level-card');

      return {
        level: document.getElementById('profile-level')?.textContent,
        totalXp: document.getElementById('profile-total-xp')?.textContent,
        rankTitle: document.querySelector('.level-card h3')?.textContent,
        rankCardClass: rankCard.className,
        styleWidth: fill.style.width,
        datasetTarget: fill.dataset.targetWidth,
        fillWidthPx: fillRect.width,
        contWidthPx: contRect.width
      };
    `);
    console.log('3.1 Trạng thái sau khi chuyển Rank Vàng (Level 25):', stateGold);
    assert(stateGold.rankCardClass.includes('rank-gold'), 'Card phải mang class rank-gold');
    assert(stateGold.rankTitle.includes('Vàng'), 'Tiêu đề rank phải hiển thị Vàng');
    assert(parseFloat(stateGold.styleWidth) > 0, 'Thanh XP phải có style.width > 0%');
    assert(stateGold.fillWidthPx > 20, 'Thanh XP fill phải hiển thị rõ ràng bằng pixel');

    // Chụp ảnh Rank Vàng
    const snapGold = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const snapGoldPath = 'C:/Users/ASUS/.gemini/antigravity/brain/081af82c-235e-4abe-8abf-fa0148a383b2/verified_xp_bar_rank_gold.png';
    fs.writeFileSync(snapGoldPath, Buffer.from(snapGold.data, 'base64'));
    console.log('✓ 3.2 Đã chụp ảnh Rank Vàng và thanh XP:', snapGoldPath);

    // TEST 4: Đóng modal, chuyển sang tab khác rồi mở lại Hub -> Đảm bảo thanh XP không bị mất
    console.log('\n--- TEST 4: Đóng modal, chuyển tab và mở lại Celestial Hub ---');
    await cdp.eval(`
      document.getElementById('close-manage-modal-btn').click();
    `);
    await new Promise(r => setTimeout(r, 400));

    await cdp.eval(`
      document.getElementById('celestial-hub-btn').click();
    `);
    await new Promise(r => setTimeout(r, 1000));

    const stateReopen = await cdp.eval(`
      const fill = document.getElementById('profile-xp-fill');
      const fillRect = fill.getBoundingClientRect();
      return {
        styleWidth: fill.style.width,
        datasetTarget: fill.dataset.targetWidth,
        fillWidthPx: fillRect.width
      };
    `);
    console.log('4.1 Trạng thái thanh XP sau khi mở lại Hub:', stateReopen);
    assert(parseFloat(stateReopen.styleWidth) > 0, 'Thanh XP sau khi mở lại Hub vẫn phải có style.width > 0%');
    assert(stateReopen.fillWidthPx > 20, 'Thanh XP fill sau khi mở lại Hub phải có pixel width > 20px, không bị tàng hình');

    // Khôi phục dữ liệu gốc
    await cdp.eval(`
      window.__testGamification.reset();
    `);

    console.log('\n======================================================');
    console.log('  TẤT CẢ CÁC BÀI TEST TỰ ĐỘNG VỀ THANH XP ĐÃ PASS 100%! ');
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
