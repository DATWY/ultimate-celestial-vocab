# Production-Readiness Audit — Celestial Vocab (2026-11-04)

> **CẬP NHẬT 2026-11-04 (đóng audit):** xem `AUDIT-CLOSURE-STAGING.vi.md`. Ba điểm trong báo cáo này
> đã được sửa/đính chính: (1) khe hở với tab cũ **đã bịt ở DEV** (production giữ tương thích) —
> §3.2 và §6/O4 dưới đây đã lỗi thời; (2) kết luận "flake do tải cao" và khuyến nghị
> `--test-concurrency=1` **không có cơ sở** — thực nghiệm 24 lượt mỗi chế độ cho thấy chế độ chạy
> không tương quan với lỗi (§6.3 đã lỗi thời); (3) phạm vi audit thuật toán là **đọc mã + test sẵn
> có**, không phải kiểm chứng độc lập. Kết luận phát hành **không đổi: CHỈ ĐỦ ĐIỀU KIỆN STAGING**.

> Kết luận: **CHỈ ĐỦ ĐIỀU KIỆN STAGING** — mã nguồn trong phạm vi đã kiểm chứng đã đóng các lỗi
> xác nhận được; còn **hai điều kiện chưa kiểm chứng được trong môi trường này**: (1) đồng bộ
> Firebase/Firestore với rules thật (không có emulator, không có phiên đăng nhập thử), (2) đường
> cập nhật Service Worker trên hosting thật. Chi tiết ở §1 và §6.

## 0. Môi trường và trạng thái đầu vào

| Mục | Giá trị |
|---|---|
| Máy | Windows, Node **v26.1.0**, npm **11.13.0** |
| HEAD | `174907f` (fix(dedup-ui): sửa tương phản light mode) |
| Working tree | **có thay đổi sẵn có của người dùng** (27 file M + nhiều file `??`), **không reset/stash** |
| `version_seq.json` | `seq 2` (không đổi) |
| Scripts | `test` = `node --test tests/*.test.mjs`; `test:e2e` = `node tests/e2e/study-loop.mjs`; `build` = `node tools/generate_version.js && vite build` (**không dùng** — sẽ tăng version); dùng `npx vite build` |
| Chrome | có (E2E và probe trình duyệt chạy được) |
| Antigravity CLI | `agy` **v1.4.12** (`C:\Users\ASUS\AppData\Local\agy\bin\agy.EXE`), có `--print`, `--model`, `--effort`; **không dùng** trong lượt này vì mọi kiểm chứng cần thiết đã làm được bằng CDP trực tiếp + `node --test` |
| Bằng chứng mới | `reports/logic-audit-2026-11-03/evidence-production-audit/` |

**Baseline tự xác minh lại (không dùng số cũ):**

| Cổng | Báo cáo trước | Đo lại đầu lượt này |
|---|---|---|
| `npm test` | 593 pass | **600 pass / 0 fail** (593 + 7 test mới của lượt này) — xem ghi chú flake ở §5 |
| `npm run lint` | 0 error / 108 warning | **0 error / 108 warning** |
| `npx vite build` | OK | OK, entry **238,47 kB thô / 78,33 kB gzip** |
| `npm run budget` | 4/4 | **4/4 đạt** |
| E2E NEW + LEECH | xanh | **xanh cả hai** |
| `version_seq.json` | seq 2 | **seq 2** |

Ghi chú flake: hai lần chạy `npm test` **đầu lượt** (khi Chrome + vite dev + nhiều tiến trình
probe còn chạy song song) báo `tests/review-cap.test.mjs` lỗi **file-level** với
`Error: Unable to deserialize cloned data due to invalid or unsupported version.` — lỗi **bộ
đọc IPC của test-runner**, không phải assert của test. Chạy lại khi máy rảnh: **5/5 lần
600/600** (khi máy không chạy tiến trình nặng khác). Xem §6 và đính chính ở `AUDIT-CLOSURE-STAGING.vi.md` §2.

## 1. Kết luận phát hành

**CHỈ ĐỦ ĐIỀU KIỆN STAGING.**

* Phần **chạy được trong môi trường này** đã kiểm chứng và xanh: build production, không lộ API
  dev, luồng học → chấm → Undo → reload, hai tab thường không ghi đè tiến độ của nhau, hai bug
  audit/preview đã sửa và có test hồi quy + bằng chứng trình duyệt trước/sau.
* Điều kiện còn thiếu để gọi là đủ production:
  1. **Đồng bộ cloud chưa kiểm chứng end-to-end**: `firebase.js` (auth ẩn danh, merge, outbox,
     retry) chỉ được kiểm ở tầng hàm/unit. `firestore.rules` **đã chạy trên Firestore Emulator
     (11/11 ca, 2026-11-04)** nhưng **hai client ứng dụng** chưa chạy trên emulator (app chưa có
     công tắc emulator) và **chưa** kiểm với Firebase thật (transport, App Check, độ trễ thật).
  2. **Service Worker/autoUpdate trên hosting thật** chưa kiểm: chưa deploy, nên chưa xác minh
     chuỗi “có bản mới → dọn cache → reload → không lặp” trên domain thật với header trong
     `firebase.json`; chưa kiểm đồng bộ **liên phiên bản** giữa tab bản A và tab bản B.
  
Không có lỗi chặn nào trong phạm vi chạy được. Không tuyên bố “hết bug”.

## 2. Phạm vi đã kiểm và mức bằng chứng

| Nhóm | Cách kiểm | Mức bằng chứng |
|---|---|---|
| Preview (`window.__testGamification`) + reset | Trình duyệt thật (vite dev + `?audit=1`, Chrome CDP), 2 tab; test Node trích **nguyên văn** hàm | **Chạy thật** (browser) + test hồi quy |
| Cách ly audit ⇄ thường (progress, card, leader lock) | Trình duyệt thật, 4 tab, đọc IndexedDB thật; test Node cho quy tắc thuần | **Chạy thật** (trước/sau) |
| Thường ↔ thường, audit ↔ audit | Cùng probe 2 tab | **Chạy thật** |
| Build production: API dev, `?audit=1` | Chrome trên `dist`, grep bundle | **Chạy thật** |
| Học → chấm → Undo → reload | E2E sẵn có trên `dist` + probe 2 tab của lượt này | **Chạy thật** |
| Ngân sách thẻ mới/tổng (review, quiz) | Đọc mã + test sẵn có (`review-cap`, `p11-review-budget`, `p12-review-gates`) | Mã + unit |
| Undo nhiều kỳ (ngày/tuần/tháng), rollover | Test sẵn có (p13/p14/p15) | Unit |
| SRS/optimizer/trainer (provenance, split, ràng buộc) | Test sẵn có (p11/p12/p13) + đọc mã | Unit |
| Import/export, dedup, tombstone, merge | Test sẵn có | Unit |
| XSS đầu vào | Test sẵn có (“Khảo Hạch: payload `><script>` bị escape…”) | Unit |
| Firestore rules / auth | **Đọc mã only** | **Chưa thực thi** |
| Service worker/update | Đọc mã + kiểm tra `dist/sw.js`, `version.json` | **Chưa thực thi trên hosting thật** |

## 3. Lỗi phát hiện / đã sửa / còn mở

### 3.1 ĐÃ SỬA — L1: `previewAllBadges()` ghi đè snapshot ⇒ `reset()` “khôi phục” về dữ liệu giả

* **Kích hoạt**: gọi `window.__testGamification.previewAllBadges()` **≥ 2 lần** rồi `reset()`.
* **Mong đợi**: state trở về đúng trước preview. **Thực tế (trước sửa)**: `_backup` bị ghi đè ở
  lần gọi thứ hai bằng chính dữ liệu giả ⇒ sau `reset()` còn `xpToday=5000`,
  `typingTotalCorrect=1000`.
* **Đường gọi thật**: DevTools console (DEV + `?audit=1`) → `previewAllBadges` → `reset` →
  `setGamification(this._backup)`. Bằng chứng: `tab-domains-before.json`
  `S1-A1-sau-preview-x2-reset = {xpTodaySauReset: 5000, typingSauReset: 1000}`.
* **Nguyên nhân**: `this._backup = JSON.parse(JSON.stringify(state.gamification))` chạy vô điều
  kiện (`gamification.js:1294` bản cũ).
* **Bản sửa tối thiểu**: chỉ sao lưu khi `_backup` còn null (giữ snapshot **gốc của phiên**), thêm
  `_session` để callback bất đồng bộ (`import(state)`, `import(badges)`) tự huỷ nếu `reset()` đã
  chạy; `reset()` tăng `_session`.
* **Sau sửa**: `tab-domains-after.json` → `{xpTodaySauReset: 0, typingSauReset: 0}`.
* **Test hồi quy**: `tests/p16-audit-isolation.test.mjs` A1–A4. Mutation check: bỏ `if (!this._backup)`
  ⇒ A1 đỏ; bỏ guard `_session` ⇒ A2 đỏ; khôi phục mã ⇒ xanh.
* **Phạm vi**: **chỉ DEV** (API chỉ tồn tại khi `import.meta.env.DEV && ?audit=1`, DB audit riêng).
  Production không có API (đã grep bundle).

### 3.2 ĐÃ SỬA — L2: tab audit và tab thường dùng chung BroadcastChannel/leader lock ⇒ rò dữ liệu

* **Kích hoạt**: mở 1 tab thường + 1 tab `?audit=1` cùng origin; tab audit chấm/ghi tiến độ hoặc
  lưu thẻ; tab thường nhận và **ghi bền** dữ liệu của audit vào DB thật.
* **Mong đợi**: hai miền lưu trữ không trao đổi. **Thực tế (trước sửa)**:
  * tab thường nhận progress audit: `typingTotalCorrect=1000, monthlyTotal=100, accidentCount=10,
    badges=90, auditProbe=1` (`S1-N1-nhận-tiến-độ`);
  * tab thường lưu tiếp ⇒ **DB thường** có đúng các giá trị đó (`S1-DB-thường`);
  * thẻ `audit-marker` từ tab audit xuất hiện trong tab thường và **vào DB thường**
    (`S2-DB-thường: cards=1, markerCard=true`);
  * chiều ngược lại: tab audit nhận `normalProbe=1` từ tab thường (`S3-A1-nhận`).
* **Đường gọi thật**: `saveGamification → afterProgressSaved → broadcastProgressUpdated`;
  `saveOneWord → broadcastCardUpdated`; `tab-bus.onmessage → acceptProgress / mergeCardFields`.
  Bằng chứng: `evidence-production-audit/tab-domains-before.json`.
* **Nguyên nhân**: `CHANNEL_NAME = 'celestial_tab_bus'` và `LEADER_LOCK_NAME` là hằng số dùng
  chung cho cả hai miền; thông điệp không mang thông tin miền.
* **Bản sửa tối thiểu**: `src/core/transport-domain.js` (thuần, test được) +
  `idb.js` xuất `storageDomain` (một nguồn duy nhất, cùng biến `auditMode` chọn DB) +
  `tab-bus.js` dùng `channelNameFor/leaderLockNameFor`, khai báo `domain` khi gửi và lọc
  `acceptsMessage(storageDomain, data.domain)` khi nhận. Tên kênh/lock của miền mặc định **giữ
  nguyên** (`celestial_tab_bus`, `celestial_sync_leader`).
* **Sau sửa** (`tab-domains-after.json`): tab thường **không** nhận progress audit
  (`auditProbe=null`, `typing=0`), **không** nhận card audit (`vocab=0, marker=false`), DB thường
  sạch (`cards=0`, không có `auditProbe`); tab audit vẫn ghi được vào DB audit (`cards=11,
  markerCard=true`) và **không** nhận dữ liệu thường (`normalProbe=null`).
  Đồng bộ nội miền vẫn chạy: thường ↔ thường `userXP 6 → 9`; audit ↔ audit `1421 → 1423`.
* **Test hồi quy**: p16 B1–B3 (+ probe trình duyệt).
* **Phạm vi**: lỗi **chỉ xảy ra ở DEV** (production không có chế độ audit ⇒ `storageDomain` luôn
  `default`). Không phải lỗ hổng production; nhưng là lỗi thật của công cụ kiểm thử và có thể làm
  bẩn dữ liệu thử của chính người kiểm thử. **Không** sửa bằng cách tắt đồng bộ tab thường.

### 3.3 Còn mở / chưa kiểm chứng (không phải lỗi đã xác nhận)

| # | Nội dung | Trạng thái |
|---|---|---|
| O1 | Đồng bộ Firestore thật (auth ẩn danh, `mergeGamification`, outbox retry, xung đột hai thiết bị) | **Chưa kiểm chứng** — không có emulator/credential. Chỉ kiểm ở tầng hàm. |
| O2 | `firestore.rules` | **ĐÃ CHẠY trên Firestore Emulator (2026-11-04): 11/11 ca đạt** — chủ đọc/ghi được, uid khác bị 403, ẩn danh bị 403, legacy thiếu `_ownerUid`/thiếu `english` bị 403. Chưa kiểm trên Firebase thật. Xem `AUDIT-CLOSURE-STAGING.vi.md` §4.1. |
| O3 | Service worker `autoUpdate` + `versionCheck` trên hosting thật | **Chưa chạy** — `dist/sw.js`, `version.json`, `registerSW.js` có mặt; logic dọn cache/reload có guard chống lặp; chưa xác minh trên domain thật. |
| O4 | Tab chạy **bản cũ** (không khai báo `domain`) | **ĐÃ SỬA ở DEV** (2026-11-04): DEV từ chối mọi thông điệp không `domain`; production vẫn nhận để giữ đồng bộ liên phiên bản. Bằng chứng: `AUDIT-CLOSURE-STAGING.vi.md` §1, `legacy-tab.json`. |
| O5 | Flake test-runner dưới tải cao | **Đính chính**: chế độ chạy không tương quan với lỗi (2/24 lượt song song, 1/24 lượt tuần tự). Nguyên nhân chưa xác định; xem `AUDIT-CLOSURE-STAGING.vi.md` §2. |
| O6 | Reload do cập nhật phiên bản giữa lúc đang chấm | Rủi ro lý thuyết; `saveOneWord` không được `await` trong handler. Chưa tái hiện được. |

## 4. Luồng đã chạy trên trình duyệt / bản production

**Production (`dist` + static server + Chrome CDP)** — `evidence-production-audit/prod-two-tabs.json`:

| Bước | Kết quả |
|---|---|
| Mở `/?audit=1` trên **production** | `hasTestApi=false`, DB chỉ có `celestial-vocab-idb` (không tạo `…-audit-idb`) ⇒ tham số audit bị bỏ qua |
| Tab 1 ôn 1 thẻ (Space → `3`) | `xpToday=5`, thẻ `prod-2` → `Learning`, reps 1 |
| Mở tab 2 (cùng origin) | đọc được `xpToday=5`, thấy thẻ đã ôn của tab 1 |
| Tab 2 ôn thẻ khác | `xpToday=10` (**không** bị ghi đè về 5), hai thẻ đều `Learning` |
| Reload tab 1 | trạng thái **giống hệt** sau tab 2 (`xpToday=10`, cùng 2 thẻ) |
| Lỗi console | không có |

**E2E sẵn có trên `dist`** (học → lật → chấm Nhớ → Ctrl+Z → mở Hub): NEW và `SMOKE_LEECH=1` đều
`ok: true`, `failures: []`, `errors: []`.

**Dev, 2 tab (audit ⇄ thường)** — bảng §3.2; **audit ↔ audit** và **thường ↔ thường** vẫn đồng bộ.

**Bundle production**: `dist` **không** chứa `__testGamification`, `previewAllBadges`,
`audit-idb`, `ISOLATED_TEST_MODE`, `audit=`; chỉ còn đúng một chuỗi `celestial_tab_bus`.

## 5. Kết quả cổng thực tế (sau bản sửa cuối)

| Lệnh | Kết quả |
|---|---|
| `npm test` | **600 pass / 600**, 0 fail, 0 skip (593 → 600: +7 test `p16-audit-isolation`) |
| `npm run lint` | **0 error / 108 warning** (không tăng so với baseline) |
| `npx vite build` | OK — `index-CTxn6PRl.js` 238,47 kB thô (**+0,15 kB** so với 238,32) |
| `npm run budget` | **4/4 đạt** — entry **78,33/82 kB gzip** (+0,06 kB, còn 3,67 kB), firebase chunk 113,65/120, CSS 332/350, toàn dist 2.155,54/2.700 kB |
| `npm run test:e2e` | `ok: true`, `failures: []`, `errors: []` |
| `SMOKE_LEECH=1 npm run test:e2e` | `ok: true`, `failures: []`, `errors: []` |
| `version_seq.json` | `seq 2` (không đổi) |

Tăng kích thước giải thích: thêm module thuần `transport-domain.js` (4 hàm nhỏ) và 3 import trong
`tab-bus.js`; phần còn lại là dead-code của nhánh audit bị loại ở production. Không nới ngưỡng.

## 6. Giới hạn kiểm chứng và phụ thuộc môi trường ngoài

1. **Không có Firebase Emulator / phiên đăng nhập**: toàn bộ đường cloud (auth, merge, outbox,
   rules) chưa được thực thi. Đây là lý do chính của kết luận STAGING.
2. **Chưa deploy**: không kiểm được SW/autoUpdate, header CSP trên hosting thật, `version.json`
   no-cache. CSP trong `firebase.json` đã đọc: `default-src 'self'`, không có `'unsafe-inline'`
   cho script, `object-src 'none'`, `frame-ancestors 'none'`.
3. **Flake test-runner** — **ĐÍNH CHÍNH (2026-11-04)**: nhận định "do tải cao, chạy tuần tự sẽ
   giảm" ở bản đầu **không có cơ sở**. Thực nghiệm 24 lượt mỗi chế độ (2 bộ test chạy đồng thời):
   mặc định **2/24** lỗi, `--test-concurrency=1` **1/24** lỗi ⇒ chế độ chạy **không** tương quan với
   lỗi; yếu tố chung là **nhiều tiến trình nặng chạy đồng thời**. Nguyên nhân chưa xác định. Khuyến
   nghị thực dụng: không chạy hai bộ test cùng lúc, không chạy probe trình duyệt song song với cổng
   test, và khi gặp đúng chữ ký `Unable to deserialize` thì chạy lại một lần khi máy rảnh. Chi tiết:
   `AUDIT-CLOSURE-STAGING.vi.md` §2.
4. **Hai thiết bị thật**: xung đột đồng bộ nhiều thiết bị (LWW, tombstone, review-log merge) chỉ
   kiểm ở tầng hàm.
5. **Không đo hiệu năng với dữ liệu lớn thật** (chỉ có test biên 10.000 entry review log và
   30.000 thẻ ở tầng prune).
6. Probe trình duyệt dùng Chrome headless + profile tạm; không phải Safari/Firefox.

## 7. Danh sách file thay đổi (lượt này)

| File | Lý do |
|---|---|
| `src/core/transport-domain.js` | **mới** — quy tắc thuần: miền vận chuyển, tên kênh/lock, lọc thông điệp |
| `src/core/idb.js` | xuất `storageDomain` từ **cùng** `auditMode` đang chọn DB (một nguồn duy nhất) |
| `src/core/tab-bus.js` | dùng tên kênh/lock theo miền; khai báo `domain` khi gửi; lọc khi nhận |
| `src/features/gamification.js` | preview: giữ snapshot gốc của phiên + `_session` chống callback muộn |
| `tests/p16-audit-isolation.test.mjs` | **mới** — 7 test hồi quy cho L1/L2 (đã mutation-check) |
| `README.md` | cập nhật số test (600/600, 66 file) |
| `scratch/probe-tab-domains.mjs` | **mới** — harness 4 tab (dev) đo trước/sau |
| `scratch/probe-prod-two-tabs.mjs` | **mới** — harness production: audit param, 2 tab, reload |
| `reports/logic-audit-2026-11-03/evidence-production-audit/*.json` | **mới** — bằng chứng thô |
| `reports/logic-audit-2026-11-03/PRODUCTION-READINESS-AUDIT.vi.md` | **mới** — báo cáo này |

Không đổi `src` nào khác; không reset/stash thay đổi sẵn có; không commit/push/deploy; không tăng
`version_seq.json`.

## 8. Việc nên làm tiếp (theo thứ tự)

1. Dựng **Firebase Emulator** (auth + firestore) và chạy một ca hai client: đăng nhập ẩn danh, ghi
   thẻ/tiến độ, tắt mạng, mở lại, xác nhận outbox retry + merge; chạy `firestore.rules` bằng
   `@firebase/rules-unit-testing`.
2. Deploy **staging** (Firebase Hosting, project riêng) và kiểm chuỗi cập nhật: bump version →
   xác nhận toast “Có bản cập nhật” → bấm cập nhật → không lặp guard.
3. Không chạy hai bộ test đồng thời và không chạy probe trình duyệt song song với cổng test (xem `AUDIT-CLOSURE-STAGING.vi.md` §2 — `--test-concurrency` không phải biện pháp đã chứng minh).
4. Nếu muốn dùng lại công cụ preview lâu dài: cân nhắc thêm nút UI chỉ trong `?audit=1` và một
   kiểm tra “preview đang bật” trước khi ghi DB (hiện đã có `skipPersistence`).
