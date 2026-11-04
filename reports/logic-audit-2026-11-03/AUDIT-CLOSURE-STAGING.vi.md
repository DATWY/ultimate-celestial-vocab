# Đóng audit (2026-11-04) — ba điểm cần làm rõ + bàn giao staging

Tài liệu này **bổ sung** cho `PRODUCTION-READINESS-AUDIT.vi.md`, không thay thế bằng chứng cũ.
Kết luận phát hành **không đổi**: **CHỈ ĐỦ ĐIỀU KIỆN STAGING**.

Ba điểm được nêu trong lượt tra soát của người dùng đã được xử lý như sau.

## 1. Khe hở với tab cũ — **đã bịt ở DEV**, production giữ tương thích

### 1.1 Vấn đề

`acceptsMessage()` bản trước coi thông điệp **không có `domain`** là dữ liệu miền `default`.
Tab audit của **mã cũ** cũng gửi thông điệp không có `domain` trên kênh `celestial_tab_bus`, nên
tab thường **bản mới** vẫn nhận được dữ liệu của nó. Cách ly chỉ đúng khi mọi tab đều chạy mã mới.

### 1.2 Cách xử lý (thay đổi mã nhỏ, có phạm vi)

`src/core/transport-domain.js`:

```js
export function acceptsMessage(domain, messageDomain, allowLegacy = true) {
    if (messageDomain === undefined || messageDomain === null) {
        return allowLegacy === true && domain === DEFAULT_DOMAIN;
    }
    return messageDomain === domain;
}
```

`src/core/tab-bus.js`:

```js
const ALLOW_LEGACY_MESSAGES = !(typeof import.meta !== 'undefined' && import.meta.env?.DEV);
...
if (!acceptsMessage(storageDomain, data.domain, ALLOW_LEGACY_MESSAGES)) return;
```

Lý do chọn đúng chỗ này: chế độ audit **chỉ tồn tại ở DEV** (`import.meta.env.DEV && ?audit=1`).
Vì vậy:

| Tình huống | Production | DEV |
|---|---|---|
| Tab mới ↔ tab mới cùng miền | nhận (có `domain`) | nhận (có `domain`) |
| Tab thường mới ← tab thường **bản deploy trước** (không `domain`) | **nhận** (giữ đồng bộ liên phiên bản) | **từ chối** |
| Tab thường mới ← tab **audit cũ** (không `domain`) | không tồn tại (prod không có audit) | **từ chối** |
| Tab audit ↔ tab audit | không tồn tại | nhận (có `domain: 'audit'`) |
| audit ⇄ thường (bất kỳ bản nào có `domain`) | — | từ chối |

Đánh đổi đã biết: ở **DEV**, hai tab khác phiên bản mã sẽ **không đồng bộ trực tiếp** nữa (đều bị
từ chối thông điệp không `domain`). Chấp nhận được vì (a) đây là môi trường phát triển, (b) dữ liệu
vẫn an toàn ở tầng DB — mỗi tab ghi IndexedDB và merge khi lưu, broadcast chỉ là cập nhật trực tiếp
trong bộ nhớ. Production **không** mất tương thích với tab bản cũ.

### 1.3 Bằng chứng chạy thật — `evidence-production-audit/legacy-tab.json`

Probe `scratch/probe-legacy-tab.mjs`: mở tab thường bản mới, rồi **tự gửi** thông điệp
`PROGRESS_UPDATED` bằng `BroadcastChannel` đúng hình dạng tab cũ (không `domain`) và tab mới
(có `domain: 'default'`).

| Bối cảnh | Thông điệp | Kết quả đo | Kỳ vọng |
|---|---|---|---|
| DEV (vite dev) | không `domain` (kiểu tab audit cũ) | `userXP` giữ **0** | **bị bỏ qua** ✅ |
| DEV | `domain: 'default'` (tab cùng phiên bản) | `userXP` → **333** | **áp dụng** ✅ |
| Production (`dist`) | không `domain` (tab bản deploy trước) | `#profile-total-xp` → **"8.888"** | **áp dụng** ✅ |
| Production | — | `__testGamification` **undefined** | không lộ API ✅ |

Test đơn vị: `tests/p16-audit-isolation.test.mjs` B2 (ma trận `acceptsMessage`, gồm cả
`allowLegacy=false`) và B3 (khẳng định `tab-bus.js` truyền cờ này). Chạy: 7/7 đạt.

**Giới hạn còn lại:** chưa chạy bằng **hai bản mã thật** (một tab nạp bản cũ từ cache SW + một tab
bản mới). Bằng chứng trên mô phỏng đúng *hình dạng thông điệp* của tab cũ; phần "tab cũ thật" sẽ
được kiểm khi lên staging (§4.2).

## 2. Flake test-runner — **không kết luận được nguyên nhân; `--test-concurrency=1` không phải biện pháp đã chứng minh**

Nhận định trước đây ("do tải cao, chạy tuần tự sẽ giảm") **không có cơ sở**. Đã làm thực nghiệm có
đối chứng: mỗi vòng chạy **hai bộ test đồng thời** (mô phỏng tranh chấp tài nguyên), đếm số lần gặp
`Error: Unable to deserialize cloned data due to invalid or unsupported version.`

| Lần chạy | Mặc định (song song trong bộ) | `--test-concurrency=1` (tuần tự trong bộ) |
|---|---|---|
| run1 (3 vòng) | 0 lỗi / 6 lượt | **1 lỗi / 6 lượt** |
| run2 (6 vòng) | **2 lỗi / 12 lượt** | 0 lỗi / 12 lượt |
| run3 (3 vòng) | 0 lỗi / 6 lượt | 0 lỗi / 6 lượt |
| **Tổng** | **2 / 24** | **1 / 24** |

Bằng chứng thô: `evidence-production-audit/test-runner-flake-experiment-{run1,run2}.json`
(run3 đo sau, cùng script, không lưu tệp riêng).

Kết luận đúng phạm vi:

* **Chưa đủ bằng chứng xác định ảnh hưởng của chế độ concurrency** tới lỗi: 1 lỗi ở chế độ tuần tự,
  2 ở song song trên 24 lượt mỗi chế độ là quá ít để nói "không tương quan"; chỉ có thể nói dữ liệu
  hiện có **không cho thấy** chế độ chạy là yếu tố quyết định.
* **Chạy tuần tự KHÔNG loại bỏ được lỗi** — đã quan sát đúng một lần lỗi ở `--test-concurrency=1`.
  Vì vậy không được dùng tuần tự như biện pháp "chữa" flake.
* Yếu tố chung của **mọi** lần gặp lỗi là **nhiều tiến trình nặng chạy đồng thời** (2 bộ test cùng
  lúc; trước đó là Chrome + `vite dev` + probe). Đây là **quan sát tương quan**, chưa phải nguyên
  nhân: chưa đọc được mã Node để xác nhận cơ chế hỏng khung IPC.
* Lỗi thuộc **đường truyền kết quả** của test-runner, không phải assert: khi tái hiện, file bị đánh
  lỗi ở mức file (`test at tests/xxx.test.mjs:1:1`) và chạy riêng file đó đạt 10/10; chạy lại cả bộ
  khi máy rảnh đạt 600/600 (đã lặp nhiều lần).
* **Khuyến nghị thực dụng** (không phải bản sửa, không phải kết luận nguyên nhân): (1) không chạy hai
  bộ test đồng thời trên một máy; (2) không chạy probe trình duyệt song song với cổng test; (3) nếu
  cổng đỏ với đúng chữ ký `Unable to deserialize`, chạy lại **một** lần khi máy rảnh trước khi coi là
  lỗi sản phẩm; (4) nếu CI tái diễn, ghi phiên bản Node, thử reporter khác và thử nâng patch Node —
  kèm số lượt đo được để so sánh.

## 3. Phạm vi audit thuật toán — nói đúng mức bằng chứng

Các nhóm dưới đây **không** được kiểm chứng độc lập trong lượt vừa rồi; chúng dựa trên **đọc mã +
bộ test sẵn có** của dự án:

| Nhóm | Bằng chứng thực tế | Chưa làm |
|---|---|---|
| SRS (chuyển trạng thái, khoảng cách, rollover ngày/tuần/tháng) | test `tests/*srs*`, `learning-steps`, p13/p14; đọc `src/core/srs/*` | không đối chiếu công thức với tài liệu FSRS gốc; không kiểm timezone ngoài `Asia/Saigon` |
| Optimizer FSRS-7 (ràng buộc tham số, moment, bước hỏng) | test p12 (`optimizer-gate`, `optimizer-constraints`) | không kiểm bằng dữ liệu thật/benchmark; không chứng minh "tốt hơn" ngoài loss |
| Trainer (provenance `first`, temporal split, rò rỉ train/validation) | test p12/p13 + đọc mã `prepareTrainingData` | không kiểm thống kê độc lập trên bộ dữ liệu lớn |
| Ngân sách review/quiz/flashcard | test `review-cap`, `p11-review-budget`, `p12-review-gates`; đọc `events.js`, `quiz.js` | không kiểm tương tác UI thật với cap (E2E chỉ chấm 1 lượt) |
| Undo (SRS + log + XP + counter) | test p13/p14/p15/p16; browser probe | không kiểm undo nhiều vòng liên tiếp trên UI thật |
| Merge/import/export/dedup/tombstone | test p11/p12 (unit) + rules đã chạy trên emulator (11/11) | **chưa** chạy hai client ứng dụng trên emulator (app chưa có công tắc emulator — §4.1b) |
| XSS đầu vào | test "Khảo Hạch" (escape payload) | không audit toàn bộ sink `innerHTML` của dự án |

Vì vậy báo cáo trước **không** được đọc là "thuật toán đã kiểm chứng độc lập toàn bộ". Muốn có mức
đó cần: đối chiếu công thức với nguồn FSRS tham chiếu, property-based test cho invariant SRS, và
mutation test cho các nhánh biên — ngoài phạm vi "đóng audit" lần này.

## 4. Bàn giao staging

### 4.1 Firebase Emulator — **đã dựng và chạy được ngay trong môi trường này**

Thiếu Java là **thiếu điều kiện thiết lập**, không phải rào cản phải chờ staging. Đã khắc phục cục bộ
(không cài hệ thống, không đổi `PATH` toàn cục):

| Thành phần | Trạng thái |
|---|---|
| `firebase` CLI | có, `15.17.0` |
| JDK | không có sẵn ⇒ tải **Temurin JRE 21** dạng zip portable (46,8 MB) vào `%TEMP%\temurin21`, chỉ đặt `JAVA_HOME`/`PATH` cho tiến trình emulator |
| `firebase.json` | **không cần** thêm khối `emulators` để chạy `--only firestore` (dùng cổng mặc định 8080, đọc `firestore.rules` sẵn có) |
| Gói npm thêm | **không** — kiểm rules bằng REST + JWT không chữ ký (đúng cơ chế `rules-unit-testing` dùng), không đổi `package.json`/lockfile |

Lệnh đã chạy:

```powershell
$env:JAVA_HOME = "$env:TEMP\temurin21\jdk-21.0.13+9-jre"; $env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
firebase emulators:start --only firestore --project demo-celestial
node scratch/rules-emulator-check.mjs
```

**Kết quả `firestore.rules` — 11/11 ca đạt** (`evidence-production-audit/firestore-rules-emulator.json`):

| Ca | Kỳ vọng | Thực tế |
|---|---|---|
| uid A tạo/đọc `users/A/cards/x` | allow | 200 / 200 |
| uid B đọc & ghi `users/A/**` | deny | 403 / 403 |
| ẩn danh đọc `users/A/cards/x` | deny | 403 |
| uid A tạo `celestial_vocab_sync/*` có `_ownerUid = A` | allow | 200 |
| uid B đọc / ghi legacy của A | deny | 403 / 403 |
| uid A tạo legacy **thiếu** `_ownerUid` | deny | 403 |
| uid A tạo legacy thiếu `english` (rule `isValidCard`) | deny | 403 |
| uid A cập nhật legacy **của mình** | allow | 200 |

Điều này đóng phần "kiểm rules + quyền truy cập chéo tài khoản" trước khi deploy. **Chưa** đóng:
merge/offline-retry của **hai client ứng dụng** — vì app chưa có công tắc nối emulator (xem 4.1b);
và emulator **không thay thế** kiểm Firebase thật (khác transport, không App Check/reCAPTCHA, không
độ trễ mạng thật).

### 4.1b Hai client ứng dụng trên emulator (nối tiếp 4.1) — cần một bản vá DEV nhỏ (chưa áp dụng)

App chưa có `connectFirestoreEmulator`/`connectAuthEmulator`, nên hai tab hiện vẫn nói chuyện với
Firebase thật. Bản vá tối thiểu (chỉ DEV, production bị tree-shake) để chạy hai client trên emulator:

```js
// src/core/firebase.js — ngay sau khi có _db và _auth
if (import.meta.env?.DEV && new URLSearchParams(location.search).get('emu') === '1') {
    const { connectFirestoreEmulator } = await import('firebase/firestore');
    const { connectAuthEmulator } = await import('firebase/auth');
    connectFirestoreEmulator(_db, '127.0.0.1', 8080);
    connectAuthEmulator(_auth, 'http://127.0.0.1:9099', { disableWarnings: true });
}
```

Chưa áp dụng vì: (a) phải bật thêm Auth emulator và chạy `firebase emulators:start --only auth,firestore`;
(b) đụng vào `firebase.js` (tệp nhạy cảm) mà chưa có test tích hợp tương ứng trong lượt này;
(c) người dùng đã yêu cầu **không mở thêm một vòng nâng cấp**, và bản vá này chỉ nên làm khi có kế
hoạch kiểm hai client ngay sau đó. Checklist khi làm: hai profile `?emu=1` cùng uid → ghi ở A, đọc ở
B; tắt mạng B, ghi tiếp, mở mạng → outbox đẩy; sửa cùng thẻ ở hai client → LWW theo `updatedAt`;
review-log merge không mất entry.

### 4.2 Service Worker A → B trên staging

Chưa deploy (không có credential, và không được tự deploy). Khi lên staging:

1. Deploy bản A (version hiện tại), mở app, xác nhận `sw.js` **activated** và `caches` có precache.
2. Ở **một tab**, bắt đầu một lượt học (chưa chấm) — giữ tab mở.
3. Deploy bản B (tăng version), **giữ nguyên** tab cũ. Kiểm: tab cũ **không** bị reload đột ngột;
   toast "Có bản cập nhật mới" xuất hiện; dữ liệu lượt đang học không mất.
4. Bấm cập nhật (hoặc mở tab mới): xác nhận `performAppResetAndUpdate` xoá cache app, unregister SW,
   reload **một lần**, guard `localStorage` chặn vòng lặp; sau reload `version.json` khớp bản B.
5. Kiểm **đồng bộ LIÊN PHIÊN BẢN** (đây là hành vi mong đợi, không phải mất đồng bộ):
   production **vẫn nhận** thông điệp của tab bản A vì ở production không tồn tại chế độ audit
   (`ALLOW_LEGACY_MESSAGES = true`). Cụ thể: tab cũ (A) chấm một thẻ → tab mới (B) **phải** cập nhật
   XP/thẻ trong vòng ~1 giây; làm ngược lại (B chấm → A) cũng phải thấy. Nếu KHÔNG thấy ⇒ **hồi quy**,
   chặn phát hành. Chỉ ở **DEV** mới có chính sách ngược: thông điệp không `domain` bị từ chối
   (vì tab audit cũ cũng gửi đúng hình dạng đó) — kiểm bằng `legacy-tab.json`, không dùng để suy ra
   hành vi production.

### 4.3 Hai thiết bị thử

Không có thiết bị thứ hai trong môi trường này. Trên staging cần: đăng nhập cùng tài khoản ở hai
profile, ghi ở A → đọc ở B; tắt mạng ở B, ghi tiếp, mở mạng → outbox đẩy lên; xung đột sửa cùng thẻ
(LWW theo `updatedAt`) và xác nhận review-log merge không mất entry.

## 5. Cổng chạy lại sau thay đổi của lượt này

| Lệnh | Kết quả |
|---|---|
| `npm test` | **600 pass / 600**, 0 fail, 0 skip |
| `npm run lint` | **0 error / 108 warning** |
| `npx vite build` | OK — `index-BSAYbRDb.js` 238,50 kB thô / **78,36 kB gzip** (+0,03 kB so với 78,33) |
| `npm run budget` | **4/4 đạt** (entry 78,36/82 kB, còn 3,64 kB) |
| `npm run test:e2e` | `ok: true`, `failures: []` |
| `SMOKE_LEECH=1 npm run test:e2e` | `ok: true`, `failures: []` |
| `version_seq.json` | **seq 2** (không đổi) |
| `dist` chứa API dev? | **không** (`__testGamification`, `previewAllBadges`, `audit-idb`, `ALLOW_LEGACY` đều vắng) |

> **Phạm vi số liệu:** bảng trên là lần chạy **của lượt trước** (mã chưa đổi từ đó). Lượt đóng audit này 
> **chỉ sửa tài liệu và thêm script kiểm emulator**, không sửa src//	ests/, nên không chạy lại cổng. 
> Người dùng đã tự chạy lại p16: **7/7 đạt**. Bằng chứng emulator là lần chạy riêng của lượt này (§4.1).

## 6. File thay đổi trong lượt đóng audit

| File | Thay đổi |
|---|---|
| `src/core/transport-domain.js` | `acceptsMessage(domain, messageDomain, allowLegacy)` — chính sách thông điệp không `domain` theo bản chạy |
| `src/core/tab-bus.js` | `ALLOW_LEGACY_MESSAGES = !DEV` và truyền vào bộ lọc |
| `tests/p16-audit-isolation.test.mjs` | B2/B3 mở rộng: DEV từ chối thông điệp kiểu cũ, production vẫn nhận |
| `scratch/probe-legacy-tab.mjs` | **mới** — bằng chứng trình duyệt cho §1 |
| `scratch/experiment-test-runner-flake.mjs` | **mới** — thực nghiệm flake có đối chứng |
| `reports/.../evidence-production-audit/legacy-tab.json` | **mới** — bằng chứng §1 |
| `reports/.../evidence-production-audit/test-runner-flake-experiment-{run1,run2}.json` | **mới** — bằng chứng §2 |
| `reports/.../AUDIT-CLOSURE-STAGING.vi.md` | **mới** — tài liệu này |
| `scratch/rules-emulator-check.mjs` | **mới** — kiểm `firestore.rules` trên emulator bằng REST + JWT không chữ ký |
| `reports/.../evidence-production-audit/firestore-rules-emulator.json` | **mới** — 11/11 ca rules |
| `reports/.../evidence-production-audit/emulator-firestore-startup.log` | **mới** — log khởi động emulator (đã tắt sau khi đo) |

## 7. Bản phát hành staging (2026-11-04)

| Mục | Giá trị |
|---|---|
| Commit | `25b067f` — `fix(audit): vá rò dữ liệu audit⇄tab thường và snapshot preview; chốt audit phát hành` (đã push `origin/main`) |
| Phiên bản | `DATWY.V3.261104.08` (`version_seq.json` seq **3`) |
| Build | `index-CzuPUeSu.js` 238,50 kB thô / **78,35 kB gzip**; budget 4/4 |
| Cổng trước deploy | test **600/600**, lint **0 error/108 warning**, E2E NEW + LEECH xanh, `dist` không có API dev |
| Kênh staging | **https://chat-wywy--staging-audit-i8313vle.web.app** (hết hạn 2026-11-11), project `chat-wywy` |
| Production | **KHÔNG đổi** — `https://chat-wywy.web.app/version.json` vẫn `DATWY.V2.261102.09` (seq 2) |

Kiểm trên hosting thật (kênh staging, Chrome + CDP, `evidence-production-audit/channel-*.json`):

| Bước | Kết quả |
|---|---|
| Khởi động | app-ready, `__testGamification` **undefined**, SW active + controlled |
| Seed 3 thẻ rồi reload | đọc đúng dữ liệu IDB |
| Chấm "Nhớ" | `xpToday = 5`, `userXP = 5`, thẻ sang `Learning` |
| Ctrl+Z | `xpToday = 0`, `userXP = 0`, thẻ về `New` |
| Reload cuối | trạng thái sau Undo **bền vững** |
| Lỗi console | không có |

### 7.1 Promotion lên production (2026-11-04, theo yêu cầu)

`firebase deploy --only hosting --project chat-wywy` → **release complete**. Đã kiểm sau deploy:

| Kiểm | Kết quả |
|---|---|
| `https://chat-wywy.web.app/version.json` | **`DATWY.V3.261104.08`, seq 3** (trước đó V2/seq 2) |
| Asset phục vụ | `assets/index-CzuPUeSu.js` (đúng bản đã kiểm trên kênh staging) |
| Header | CSP đầy đủ, `Cache-Control: no-cache` cho `index.html` |
| Bundle production | **không** chứa `__testGamification`/`previewAllBadges` |
| Chrome E2E trên production | app-ready; SW **active + controlled** sau reload; chấm → `xpToday 5`; Ctrl+Z → `0`; reload giữ đúng; không lỗi console |
| Bằng chứng | `evidence-production-audit/channel-chat-wywy_web_app.json` |

Hệ quả với người dùng đang mở bản V2: `version.json` đổi ⇒ toast "Có bản cập nhật mới"; SW
`autoUpdate` nạp bundle mới ở lần mở kế tiếp. **Chưa** có phép thử A→B có kiểm soát (giữ tab V2
rồi deploy V3 trong cùng profile) — lần cập nhật thật của người dùng chính là phép thử đầu tiên;
logic dọn cache/reload/guard không đổi so với bản trước.
