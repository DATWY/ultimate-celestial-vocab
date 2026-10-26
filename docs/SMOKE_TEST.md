# SMOKE TEST — vòng học E2E trên bundle thật

Tài liệu vận hành cho `scratch/smoke-study-loop.mjs`.
Đây là bài test **duy nhất** trong repo chạm vào app đang chạy thật (DOM + IndexedDB + phím thật), nên nó là lưới an toàn cuối cùng trước khi deploy.

---

## 1. Nó làm gì

Một kịch bản duy nhất, chạy không cần framework test:

1. Dựng HTTP server tĩnh phục vụ **`dist/`** (SPA fallback về `dist/index.html`).
2. Mở Chrome headless, nối vào bằng **CDP** (Chrome DevTools Protocol) qua WebSocket.
3. Gieo thẻ vào **IndexedDB của app** ngay trong trang (6 thẻ `New`, hoặc 6 thẻ `New` + 1 thẻ leech).
4. Nạp lại trang, đợi app báo sẵn sàng (`body.app-ready`).
5. Lật thẻ bằng **phím thật**, đọc nhãn 4 nút chấm, chấm "Nhớ" (phím `3`), đọc lại IndexedDB, bấm `Ctrl+Z`, đọc lại lần nữa.
6. Mở Hub và tab từ vựng (kiểm tra UI không chết sau luồng chấm).
7. So các giá trị đọc được với kỳ vọng và in JSON kết quả, exit code 0/1.

Toàn bộ nằm trong `scratch/smoke-study-loop.mjs` (179 dòng).

### Chạy trên `dist/` hay dev server?

**Trên `dist/` thật.** Bằng chứng trong code:

- `const distDir = path.join(process.cwd(), 'dist');` — `smoke-study-loop.mjs:11`
- Server tự viết bằng `http.createServer`, đọc file trong `distDir`, không match thì trả `dist/index.html` — `:17-27`
- Trang được nạp bằng `Page.navigate` tới `http://localhost:5199/` — `:101`, `:105`
- Không hề gọi `vite`, `vite preview`, hay `npm run dev`.

Hệ quả: **phải build trước**, nếu không script sẽ phục vụ `dist/` cũ (hoặc 404 hàng loạt nếu chưa từng build).

---

## 2. Chuẩn bị

| Yêu cầu | Ghi chú |
|---|---|
| `dist/` đã build | `npm run build` (script **không** tự build). `npm run build` có tăng version — nhớ `git checkout -- src/core/version.js public/version.json` nếu không muốn commit số mới |
| Node có `WebSocket` toàn cục | Script dùng `new globalThis.WebSocket(...)` (`:30`). Đo trên **Node v26.1.0** |
| Chrome | Mặc định `C:\Program Files\Google\Chrome\Application\chrome.exe` (`:14`), override bằng biến `CHROME_PATH` |
| Mạng | Script **có** gọi Firebase thật (xem cảnh báo §6) |
| Cổng | `5199` cho HTTP server (`:12`), `9500-9579` ngẫu nhiên cho CDP (`:70`). Cả hai đều > 1024 |

> **Lưu ý về nguồn gốc script:** `scratch/` nằm trong `.gitignore:44` nên `scratch/smoke-study-loop.mjs`
> **không được track trong git** (`git ls-files scratch` trả về rỗng). Máy khác clone repo sẽ **không có**
> file này. Nếu muốn dùng lâu dài, phải `git add -f scratch/smoke-study-loop.mjs` (hoặc chuyển sang
> `tests/e2e/`) — xem T4.6 trong `UPGRADE_BACKLOG.md`.

Không cần `npm install` thêm gì: script chỉ dùng `node:http`, `node:fs`, `node:path`, `node:child_process`.

---

## 3. Cách chạy

```bash
# 0) luôn build lại trước
npm run build

# 1) chế độ mặc định: thẻ NEW (không leech)
node scratch/smoke-study-loop.mjs

# 2) chế độ LEECH: gieo thêm 1 thẻ lapses=4 và ưu tiên thẻ đó
#    PowerShell:
$env:SMOKE_LEECH=1; node scratch/smoke-study-loop.mjs; Remove-Item Env:\SMOKE_LEECH
#    bash / Git Bash:
SMOKE_LEECH=1 node scratch/smoke-study-loop.mjs
```

Exit code: `0` = `ok: true`, `1` = có failure hoặc lỗi console.

### Thời gian chạy thực tế (đo 2026-10-26, Node v26.1.0, `dist/` build 11:19, HEAD `c3f5a51`)

| Chế độ | Thời gian | Kết quả |
|---|---:|---|
| mặc định (`new-card`) | **12,1 s** | `ok: true`, `errors: []`, `expectedAuthRejections: 1`, nhãn `1p/10p/10p/7 ngày` |
| `SMOKE_LEECH=1` | **11,9 s** | `ok: true`, `errors: []`, `expectedAuthRejections: 1`, nhãn `10p/10p/1 ngày/2 ngày` |

Con số này gần như **cố định**, vì script ngủ theo lịch cứng: 3.500 + 1.500 + 1.000 + 1.800 + 1.500 + 2×800 = **10,9 s** (`:102-146`), cộng ~1 s khởi động Chrome + nối CDP. Máy nhanh hơn không làm test nhanh hơn; máy quá chậm có thể làm bước chờ `app-ready` (tối đa 20 s, `:106`) hết hạn.

---

## 4. Nó ASSERT những gì

Lấy trực tiếp từ khối so sánh `:148-167` và các bước đọc DOM (`:109-146`).

### 4.1. Bước chuẩn bị

| Bước | Kỳ vọng | Dòng |
|---|---|---|
| Gieo dữ liệu | ghi được 6 thẻ `New` (+1 nếu leech) vào store `vocabulary` của IndexedDB `celestial-vocab-idb` v2 | `:43-59` |
| App sẵn sàng | `document.body.classList` chứa `app-ready` trong ≤ 20 s | `:106` |
| Thẻ đầu tiên | đọc được `#card-english`, `#card-hard-badge`, `#flashcard` | `:109-115` |

### 4.2. Chế độ mặc định (`new-card`)

| Assert | Kỳ vọng | Dòng |
|---|---|---|
| Nút chấm hiện sau khi lật | `#srs-feedback-buttons` **không** có class `hidden` | `:121`, `:149` |
| Mặt sau hiển thị | `#card-vietnamese` có `offsetParent !== null` | `:123`, `:150` |
| Badge "CỰC KHÓ" | **ẩn** trên thẻ thường (`badgeHidden === true`) | `:158` |
| 4 nhãn nút chấm | đúng thứ tự `['1p', '10p', '10p', '7 ngày']` | `:159` |
| Chấm "Nhớ" (phím `3`) | `srsStatus === 'Learning'`, `learningStep === 1`, hạn trong **9–11 phút** | `:160` |
| `Ctrl+Z` | trả thẻ về `srsStatus === 'New'` | `:161` |
| Console | không có `console.error`, không exception, không `Log.entryAdded` level error (trừ lỗi auth đã lọc) | `:92-99`, `:167` |

### 4.3. Chế độ `SMOKE_LEECH=1`

| Assert | Kỳ vọng | Dòng |
|---|---|---|
| Ưu tiên thẻ leech | thẻ đầu tiên là `obfuscate` | `:152` |
| Badge "CỰC KHÓ" | **hiện** (`badgeHidden === false`) + `#flashcard` có class `is-hard-card` | `:153` |
| 4 nhãn nút chấm | `['10p', '10p', '1 ngày', '2 ngày']` | `:154` |
| Chấm "Nhớ" | `srsStatus === 'Learning'`, `learningStep === 2`, hạn **≥ 1439 phút** (≈ 1 ngày) | `:155` |
| `Ctrl+Z` | trả về `learningStep === 1` | `:156` |

### 4.4. Chung cho cả 2 chế độ

- Mở Hub: `[data-action="open-manage"], #open-manage-btn, .hub-btn` phải bấm được (`:141`).
- Mở tab từ vựng: `#tab-words, [data-hub-tab="words"]` phải bấm được (`:142`). Nếu selector không tồn tại, script chỉ ghi `{ok:false}` vào `steps` — **không** tính là failure (hai bước này chỉ để phát hiện crash, không chặn exit code).
- `ok = (failures.length === 0) && (errors.length === 0)` (`:167`).

---

## 5. Bẫy đã gặp (đọc trước khi sửa script)

1. **Phải `Page.enable` trước khi `Page.navigate`.** Không bật domain thì `Page.navigate` trả lỗi/không có event nào tới, và script chết ở bước chờ `app-ready`. Script làm đúng thứ tự `Page.enable → Runtime.enable → Log.enable → Network.enable` rồi mới navigate (`:89`, `:101`).
2. **Đừng dùng cổng < 1024.** Thử `http://127.0.0.1:9` kiểu "cổng chắc chắn trống" sẽ bị Chrome trả `ERR_UNSAFE_PORT` và không bao giờ load được trang. Script dùng `5199` và dải `9500+` (`:12`, `:70`).
3. **Phím phải gửi qua `Input.dispatchKeyEvent`, không dùng `dispatchEvent` tổng hợp.** Handler phím tắt toàn cục nằm trên `document` (`src/events.js:1136`) và đọc `e.code` / `e.key` (`:1352`, `:1367`, `:1383`); sự kiện tự tạo bằng `new KeyboardEvent(...)` không đi qua input pipeline của trình duyệt nên đã bị bỏ qua trong lần thử đầu (thẻ không lật, không có nút chấm). Script gửi `keyDown` + `keyUp` thật kèm `windowsVirtualKeyCode`/`nativeVirtualKeyCode` (`:88`, `:117`, `:130`, `:135`).
4. **Lỗi 400 từ `identitytoolkit.googleapis.com` là BÌNH THƯỜNG.** Máy chạy test có mã đồng bộ mới tinh (localStorage trắng) nên app thử đăng nhập → Firebase trả 400 `EMAIL_NOT_FOUND`/`INVALID_LOGIN_CREDENTIALS` → app chuyển sang **đăng ký**. Vì vậy mọi log error có URL chứa `identitytoolkit` phải bị lọc vào `expectedAuthRejections` thay vì `errors` (`:94-99`), nếu không test sẽ đỏ vĩnh viễn. `authEndpoints` trong output cho thấy đúng chuỗi này: `signInWithPassword ×2 → signUp ×2 → lookup ×2`.
5. **Đọc state từ IndexedDB của bundle build, không dùng import path của `vite dev`.** Script mở thẳng `indexedDB.open('celestial-vocab-idb', 2)` (`:44`, `:62`) rồi đọc store `vocabulary`. Hai cái bẫy phụ:
   - DB name đổi khi chạy dev với `?audit=1`: `src/core/idb.js:8-9` dùng `celestial-vocab-audit-idb`. Đừng copy snippet này sang test chạy ở chế độ audit.
   - Đừng `import('../src/core/state.js')` trong `Runtime.evaluate`: đường dẫn đó chỉ tồn tại trên dev server, còn ở `dist/` mọi thứ đã bundle + hash tên file.
6. **`dist/` phải mới hơn `src/`.** Trong lúc viết tài liệu này, một tiến trình khác build lại `dist/` hai lần (11:12 và 11:15) và hash entry đổi từ `index-BS1G-jC9.js` → `index-C3nPcler.js` → `index-CZuGso3D.js`. Nếu test báo "không thấy nút chấm" hoặc HTML trắng, kiểm tra `npm run budget` có cảnh báo `dist/ cũ hơn src/` hay không rồi build lại.
7. **Chrome headless cần `--user-data-dir` riêng.** Script tạo thư mục tạm theo timestamp (`:71-73`) và xoá trong `finally` (`:176`) — nhờ vậy mỗi lần chạy là một profile trắng (điều kiện để tái hiện bẫy số 4).

---

## 6. CẢNH BÁO: mỗi lần chạy có thể tạo 1 tài khoản Firebase rác

Vì profile Chrome là trắng, `localStorage.celestialSyncKey` chưa có ⇒ app sinh **mã đồng bộ mới** và tự tạo tài khoản Cloud cho mã đó (cơ chế `isAutoGeneratedSyncKey()` — `src/core/firebase.js:213-242`).

Hệ quả:

- Mỗi lần chạy `node scratch/smoke-study-loop.mjs` có thể thêm **1 user** vào **project Firebase thật** (project cấu hình trong `.env` / fallback trong `src/core/firebase.js:56-65`).
- Chạy 10 lần/ngày trong một tháng ⇒ hàng trăm user rác trong **Authentication**.
- Cần dọn định kỳ trong **Firebase Console → Authentication → Users** (xoá user có email dạng `<20 ký tự>@sync.celestial-vocab.app`).
- Muốn tránh hoàn toàn: chặn mạng của Chrome (`--host-resolver-rules` / firewall), hoặc chấp nhận `expectedAuthRejections` cao hơn và bỏ assert về Cloud.

Script **không** xoá tài khoản sau khi chạy — không có API admin trong client SDK.

---

## 7. Cách đọc kết quả

Script in JSON ra stdout (`:177`) rồi `process.exit(ok ? 0 : 1)`.

```jsonc
{
  "mode": "new-card",              // hoặc "leech"
  "steps": [ ... ],                // nhật ký từng bước: seed, thẻ đầu tiên, sau khi lật, ...
  "errors": [],                    // MẢNG NÀY PHẢI RỖNG
  "expectedAuthRejections": 1,     // số lỗi 400 của identitytoolkit đã lọc — >0 là bình thường
  "authEndpoints": ["accounts:signInWithPassword", ..., "accounts:lookup"],
  "summary": { "card": "quasar", "labels": ["1p","10p","10p","7 ngày"], "afterGood": {...}, "afterUndo": {...} },
  "failures": [],                  // lý do tiếng Việt của từng assert sai
  "ok": true
}
```

Đọc theo thứ tự:

1. **`ok`** — `true` là xong. `false` thì xem `failures` trước, rồi `errors`, rồi `fatal`.
2. **`errors`** — phải là `[]`. Một `console.error` từ app cũng đủ làm đỏ, kể cả khi mọi assert khác đúng.
3. **`expectedAuthRejections`** — 1–2 là bình thường. Nếu nó bằng 0 mà `authEndpoints` vẫn có `signUp`, nghĩa là lần chạy đó dùng tài khoản đã tồn tại (profile không trắng).
4. **`failures`** — mỗi phần tử là một câu tiếng Việt nêu rõ giá trị thực (`'nhãn thẻ New sai: 1p/10p/10p/1 ngày'`). Đây là thứ cần dán vào báo cáo khi test đỏ.
5. **`fatal` + `diagnostics`** — chỉ xuất hiện khi script ném lỗi (không nối được CDP, hết 20 s chờ `app-ready`). `diagnostics` chứa `location.href`, `document.readyState`, `body.className` tại thời điểm chết — đủ để biết trang có load được không.

---

## 8. Khi nào chạy

- Trước mỗi lần deploy hosting.
- Sau khi sửa `src/core/srs/*`, `src/core/queue.js`, `src/events.js`, `src/ui/render.js`, `src/core/idb.js`.
- Sau khi đổi `vite.config.js` (precache/SW) — vì script chạy trên `dist/` nên nó cũng là bài kiểm tra "bundle có boot được".

Smoke test này **không** thay `npm test` (203 unit test, ~0,5 s) và **không** kiểm tra: đồng bộ 2 máy thật, App Check enforce, trình đọc màn hình, iOS thật, TTS trên loa thật — xem mục "Những gì CHƯA kiểm chứng" trong `README.md`.
