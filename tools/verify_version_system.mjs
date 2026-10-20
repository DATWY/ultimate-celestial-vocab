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

let mockServerVersion = null;

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/index.html';

  // Nếu là request đến /version.json và có mock version
  if (reqPath === '/version.json' && mockServerVersion) {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.end(JSON.stringify({
      version: mockServerVersion,
      seq: 2,
      buildTime: new Date().toISOString()
    }));
    return;
  }

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

const PORT = 5215;
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

server.listen(PORT, async () => {
  const tmpDir = path.join(process.cwd(), 'tmp_audit_verify_ver');
  fs.mkdirSync(tmpDir, { recursive: true });
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9241',
    '--user-data-dir=' + tmpDir,
    '--window-size=1024,640'
  ]);

  try {
    let pagesRes = null;
    for (let retry = 0; retry < 15; retry++) {
      try {
        await new Promise(r => setTimeout(r, 400));
        pagesRes = await fetch(`http://localhost:9241/json`);
        if (pagesRes.ok) break;
      } catch (e) {}
    }
    if (!pagesRes) throw new Error('Không thể kết nối Chrome DevTools port 9241 sau 6 giây');

    const pages = await pagesRes.json();
    const page = pages.find(p => p.type === 'page') || pages[0];
    const cdp = new CDPClient(page.webSocketDebuggerUrl);
    await cdp.init();

    await cdp.send('Page.navigate', { url: `http://localhost:${PORT}` });
    await new Promise(r => setTimeout(r, 1800));

    console.log('\n======================================================');
    console.log('   BẮT ĐẦU KIỂM THỬ HỆ THỐNG VERSION & AUTO-UPDATE    ');
    console.log('======================================================\n');

    // TEST 1: Kiểm tra định dạng phiên bản nhúng theo cú pháp DATWY.V[số].yymmdd.hh
    console.log('--- TEST 1: Kiểm tra cú pháp phiên bản DATWY.V[số].yymmdd.hh ---');
    const versionData = JSON.parse(fs.readFileSync('public/version.json', 'utf8'));
    console.log('1.1 public/version.json:', versionData);
    const versionRegex = /^DATWY\.V\d+\.\d{6}\.\d{2}$/;
    assert(versionRegex.test(versionData.version), `Phiên bản phải khớp định dạng DATWY.V[số].yymmdd.hh, thực tế: ${versionData.version}`);

    // TEST 2: Kiểm tra hiển thị phiên bản trên giao diện Celestial Hub (Tab 3: Dữ liệu & Sao lưu)
    console.log('\n--- TEST 2: Kiểm tra hiển thị phiên bản trong Celestial Hub ---');
    await cdp.eval(`
      document.getElementById('celestial-hub-btn').click();
      await new Promise(r => setTimeout(r, 300));
      document.getElementById('tab-data-io').click();
    `);
    await new Promise(r => setTimeout(r, 500));

    const uiVersion = await cdp.eval(`
      const el = document.getElementById('app-version-display');
      const btn = document.getElementById('btn-check-update');
      return {
        text: el ? el.textContent.trim() : null,
        btnExists: !!btn
      };
    `);
    console.log('2.1 Phiên bản hiển thị trên UI:', uiVersion);
    assert(uiVersion.text === versionData.version, `UI phải hiển thị đúng version ${versionData.version}, thực tế: ${uiVersion.text}`);
    assert(uiVersion.btnExists === true, 'Nút "Kiểm Tra Cập Nhật" phải tồn tại trong DOM');

    // Chụp ảnh thẻ Version Card trong Celestial Hub
    const snapVer = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const snapVerPath = 'C:/Users/ASUS/.gemini/antigravity/brain/081af82c-235e-4abe-8abf-fa0148a383b2/verified_version_card_ui.png';
    fs.writeFileSync(snapVerPath, Buffer.from(snapVer.data, 'base64'));
    console.log('✓ 2.2 Đã chụp ảnh thẻ Version Card:', snapVerPath);

    // TEST 3: Bấm nút "Kiểm Tra Cập Nhật" khi hệ thống đã là mới nhất
    console.log('\n--- TEST 3: Bấm nút "Kiểm Tra Cập Nhật" thủ công (đã mới nhất) ---');
    await cdp.eval(`
      document.getElementById('btn-check-update').click();
    `);
    await new Promise(r => setTimeout(r, 600));

    const toastMsg = await cdp.eval(`
      const toast = document.querySelector('.toast-item.show');
      return toast ? toast.innerText : null;
    `);
    console.log('3.1 Thông báo Toast khi bấm kiểm tra:', toastMsg);
    assert(toastMsg && toastMsg.includes('Hệ Thống Đã Mới Nhất'), 'Toast phải thông báo hệ thống đã mới nhất');

    // TEST 4: Giả lập máy chủ có phiên bản mới hơn -> Kiểm tra phát hiện & kích hoạt quy trình reset web
    console.log('\n--- TEST 4: Giả lập máy chủ có phiên bản mới (DATWY.V2.261020.99) ---');
    mockServerVersion = 'DATWY.V2.261020.99';

    // Tạo một cache giả lập trong CacheStorage để kiểm tra xem reset web có dọn sạch không
    await cdp.eval(`
      if ('caches' in window) {
        const testCache = await caches.open('test-old-bundle-cache');
        await testCache.put('/test-dummy', new Response('old data'));
      }
    `);

    const cacheBeforeCount = await cdp.eval(`
      return (await caches.keys()).length;
    `);
    console.log('4.1 Số lượng cache trước khi cập nhật:', cacheBeforeCount);
    assert(cacheBeforeCount > 0, 'Phải có ít nhất 1 cache');

    // Xóa toast cũ trước khi test mới
    await cdp.eval(`
      document.querySelectorAll('.toast-item').forEach(el => el.remove());
    `);

    // Bấm kiểm tra cập nhật thủ công để kích hoạt cập nhật ngay lập tức
    console.log('4.2 Kích hoạt kiểm tra cập nhật...');
    await cdp.eval(`
      document.getElementById('btn-check-update').click();
    `);
    await new Promise(r => setTimeout(r, 600));

    const updateToast = await cdp.eval(`
      const toast = document.querySelector('.toast-item.show');
      return toast ? toast.innerText : null;
    `);
    console.log('4.3 Thông báo Toast phát hiện bản mới:', updateToast);
    assert(updateToast && updateToast.includes('DATWY.V2.261020.99'), 'Toast phải thông báo phát hiện bản cập nhật DATWY.V2.261020.99');

    // Chờ 1.5s để quá trình reset hoàn tất và trang reload
    await new Promise(r => setTimeout(r, 1600));

    const savedLocalVersion = await cdp.eval(`
      return localStorage.getItem('celestial_app_version');
    `);
    console.log('4.4 Version lưu trong localStorage sau khi reset:', savedLocalVersion);
    assert(savedLocalVersion === 'DATWY.V2.261020.99', 'localStorage phải được cập nhật lên phiên bản mới nhất');

    console.log('\n======================================================');
    console.log('  TẤT CẢ CÁC BÀI TEST VERSION & RESET WEB ĐÃ PASS 100%! ');
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
