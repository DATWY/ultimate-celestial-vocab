# Ultimate Celestial Vocab

![Version](https://img.shields.io/badge/version-DATWY.V2.261025.15-8a2be2.svg?style=flat-square)
![Tests](https://img.shields.io/badge/tests-203%2F203%20PASS-brightgreen.svg?style=flat-square)
![PWA](https://img.shields.io/badge/PWA-precache%2035%20entry-orange.svg?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-green.svg?style=flat-square)

PWA học từ vựng tiếng Anh: Vanilla JS (ES Module) + Vite 5 + CSS thuần + IndexedDB.
Dữ liệu học nằm trên máy; phần đồng bộ Cloud là tuỳ chọn và dùng một mã 20 ký tự.

Tài liệu này chỉ ghi những gì **đọc được từ mã nguồn** hoặc **đo lại được bằng lệnh trong repo**.
Số nào chưa đo lại thì ghi rõ "chưa đo" (xem [§12](#12-những-gì-chưa-kiểm-chứng)).
Nếu bạn sửa code, hãy chạy lại các lệnh ở [§9](#9-lệnh--script) rồi cập nhật bảng ở [§1](#1-trạng-thái-đo-được).

---

## 1. Trạng thái đo được

Đo ngày **2026-10-26**, trên HEAD `c3f5a51`, `dist/` build lúc **11:19**.
(Hash tên file trong `dist/assets/` đổi sau mỗi lần build — chỉ tên đổi, kích thước trong bảng đã kiểm lại trên 3 bản build liên tiếp.)

| Hạng mục | Số đo | Cách đo |
|---|---|---|
| Test | **203 pass / 203**, 0 fail, 0 skip, ~0,50 s | `npm test` |
| File test | **19** (`tests/*.test.mjs`) | `Get-ChildItem tests -File` |
| File nguồn | **54** file, **35.504** dòng (gồm cả `src/css`) | `Get-ChildItem src -Recurse -File` |
| Entry `assets/index-*.js` | 246.430 B thô → **80,67 kB gzip** (98,4% ngân sách 82 kB) | `npm run budget` |
| Chunk Firebase lớn nhất | 492.097 B thô → **113,69 kB gzip** (94,7% ngân sách 120 kB) | `npm run budget` |
| CSS do Vite sinh | **326.696 B thô** / 58,98 kB gzip (93,3% ngân sách 350 kB) | `npm run budget` |
| Toàn bộ `dist/` | **2.094,70 kB thô / 40 file** (ngân sách 2.700 kB) | `npm run budget` |
| Precache Service Worker | **35 URL** | đếm `url:"` trong `dist/sw.js` |
| Khai báo `!important` | **1.920** trong `src/css` (riêng `style.css`: 1.624) | regex trên `src/css/**/*.css` |
| Font Lexend self-host | **87.996 B / 3 file** `woff2` | `public/fonts/lexend-*.woff2` |
| Icon subset | **95.568 B / 4 weight** + `phosphor-subset.css` 64.054 B (792 rule `.ph-*`) | `public/fonts/phosphor-*.woff2` |
| Mã đồng bộ | **20 ký tự**, bảng chữ `A-Z` bỏ `I/O` + `2-9` | `src/core/firebase.js:141-142` |
| Trần khoảng cách ôn | **365 ngày** (áp sau fuzz, cho mọi lần chấm) | `src/core/srs/constants.js:6` |

Con số "98,4% ngân sách" là **cảnh báo**, không phải thành tích: entry chỉ còn 1,33 kB dư địa.

---

## 2. Chạy nhanh

```bash
npm install
cp .env.example .env      # điền thông số Firebase nếu muốn dùng đồng bộ Cloud
npm run dev               # http://localhost:5173
npm test                  # 211 test
npm run build             # build production vào dist/ (tự tăng version)
npm run verify            # 11 test hiệu năng/vòng đời + 4 test version (~29 s, cần Chrome + dist đã build)
```

Yêu cầu: Node.js ≥ 18 (đo trên **Node v26.1.0 / npm 11.13.0**), Vite 5.4.19.
Các biến môi trường có thật trong `.env.example`: `VITE_FIREBASE_*` (8 biến) và
`VITE_FIREBASE_APPCHECK_SITE_KEY` + `VITE_FIREBASE_APPCHECK_DEBUG_TOKEN`.
Thiếu `.env` thì app vẫn chạy offline-first; chỉ phần Cloud bị bỏ qua.

---

## 3. Tính năng (đối chiếu được với mã nguồn)

### 3.1. Màn hình học

- **Lật thẻ:** `Space` hoặc `F`. Khi thẻ đã lật, `Space`/`Enter`/`N` chấm "Nhớ" (hoặc sang thẻ kế) — `src/events.js:1352-1382`.
- **Chấm 4 mức:** phím `1 / 2 / 3 / 4`, chỉ có hiệu lực sau khi lật (`src/events.js:1383-1389`).
- **Phím khác:** `P` phát âm, `S` đánh dấu sao, `Ctrl+Z` hoàn tác lượt chấm gần nhất, `B` bật/tắt boost mode, `?` mở bảng phím tắt (`src/events.js:1307-1371`).
- **Chế độ gõ (Active Recall Typing):** `src/features/typing.js`. Gõ đúng và đủ điều kiện thì **phần tăng thêm** của stability được nhân **1,25** — không phải nhân cả S (`src/core/srs/index.js:188-201`).
- **Dải thống kê + thanh tiến độ phân màu** ở cuối màn hình: `Đã thuộc / Cần ôn / Đang học` (`index.html:415-465`).
- **Badge "CỰC KHÓ"** chỉ hiện trên thẻ leech thật (`lapses ≥ 4`), có `title` gợi ý đổi cách học.

### 3.2. Celestial Hub (modal quản lý)

4 tab, mặc định mở tab **Tổng quan** (`index.html:683-692`, `data-tab="overview|words|io|badges"`):

| Tab | Nội dung chính |
|---|---|
| Tổng quan | Level/XP, streak, 3 chỉ số SRS, dự báo 7 ngày, heatmap **84 ngày** (`src/features/gamification.js:880`) |
| Từ vựng | Lưới thẻ, tìm kiếm, lọc chủ đề/trạng thái, thêm/sửa/xoá, radar trùng lặp (`src/core/dedup.js`) |
| Dữ liệu | Nhập TSV, **Xuất Review Logs FSRS-7 (.json)**, cấu hình 34 tham số, **Tối ưu trên máy**, **Đồng bộ đa thiết bị bằng Mã đồng bộ**, **Tải toàn bộ audio ngoại tuyến**, danger zone (`index.html:923`, `:959`, `:1029-1042`, `:1149`) |
| Huy hiệu | Bộ sưu tập badge theo tier (`src/features/badges.js`) |

### 3.3. Khác

- **Quiz** (`src/features/quiz.js`) — mọi chuỗi chèn vào HTML đều qua `escapeHTML` (`src/core/utils/sanitize.js`), có test hồi quy XSS.
- **Streak freeze / phục hồi streak** (`src/features/streakRecovery.js`, `src/core/state/gamification.js`).
- **Dark/Light mode**, hiệu ứng nền canvas tự dừng khi idle (`src/ui/celestial-canvas.js`).
- **TTS:** giọng máy (Web Speech API) + một endpoint proxy Apps Script cho giọng nâng cao (`src/core/sound.js:18`), phần chọn giọng/tốc độ nằm ở `src/features/ttsSettings.js`.

---

## 4. Vòng đời thẻ & FSRS-7

### 4.1. File

| File | Vai trò |
|---|---|
| `src/core/state.js` | Store + barrel **93 tên công khai** (616 dòng); logic tách sang `src/core/state/` (10 module: gamification, review-log-prune, streak, progress-store, tts-settings, vocabulary, typing-filter, demo-seed, ui-notify, preview-mode) |
| `src/core/srs/index.js` | Bộ điều phối: chấm điểm → state mới + lịch |
| `src/core/srs/constants.js` | 34 tham số mặc định + biên hợp lệ từng tham số |
| `src/core/srs/forgetting.js` | Đường cong quên **hai thành phần** + giải interval bằng Newton |
| `src/core/srs/stability.js` | Cập nhật stability (khối dài hạn `start=7`, ngắn hạn `start=15`) |
| `src/core/srs/difficulty.js` | Cập nhật difficulty: damping + mean reversion |
| `src/core/srs/heuristics.js` | Bias độ khó theo hình thái từ (chỉ chạy 1 lần cho thẻ mới) |
| `src/core/srs/training.js` | Optimizer offline (dùng chung cho web và CLI) |

34 tham số mặc định: `src/core/srs/constants.js:43-62`.

### 4.2. Trí nhớ hai thành phần (dual stability)

Mỗi thẻ mang 3 biến trạng thái: `stability` (S dài hạn), `stabilityShort` (S ngắn hạn), `difficulty` ∈ [1, 10].
Retrievability là **hỗn hợp có trọng số** của hai thành phần, không phải một đường power-law đơn:

- Thành phần ngắn hạn `r1 = (t/S_short · factor1 + 1)^decay1`, với `decay1 = -w[23] · S_short^(w[33]-0.3)` — `src/core/srs/forgetting.js:12-25`.
- Thành phần dài hạn `r2 = ((t/S_long) · factor2 · d_timescale + 1)^decay2` — `forgetting.js:54-57`.
- Trộn: `R = (w1·r1 + w2·r2) / (w1 + w2)`, rồi co về khoảng mở `(1e-5, 1-1e-5)` — `forgetting.js:60-66`.
- Interval được giải bằng Newton–Raphson trong không gian `log t`, tối đa 12 vòng, dừng khi `|R - 0.90| < 1e-4` — `forgetting.js:80-118`.

> `constants.js` vẫn xuất `FACTOR = 19/81` và `DECAY = -0.5` cho code cũ, nhưng đường cong đang dùng **không** dùng hai hằng số này.

### 4.3. Cập nhật stability

`nextStability(S, D, R, rating, start)` (`src/core/srs/stability.js:18-47`):

```
new_s_fail = w[start+3] · ((S+1)^w[start+4] - 1) · exp((1-R)·w[start+5])
pls        = min(S, new_s_fail)
sinc       = exp(w[start]-1.5) · (11-D) · S^(-w[start+1]) · (exp((1-R)·w[start+2]) - 1) · hard_penalty · easy_bonus + 1
S_next     = rating > 1 ? max(pls, S · sinc) : pls          (kẹp [S_MIN, S_MAX] = [0.01, 36500])
```

Hai lượt gọi: `start=7` cho S dài hạn, `start=15` cho S ngắn hạn (`index.js:160-163`).
Sau lượt trả lời đúng **không** ép `S_short ≤ S_long`; chỉ nhánh quên mới cap `S_short ≤ 0.8 · S_long` (`index.js:168-182`).

### 4.4. Cập nhật difficulty

```
ΔD = -w[6] · (rating - 3)                     (rating 1: ΔD nhân thêm (R + 0.1))
ΔD = damping_theo_biên(ΔD, D)                  (difficulty.js:19-26)
D' = 0.01 · D0(rating=4) + 0.99 · (D + ΔD)     (mean reversion 1%)
```

Nguồn: `src/core/srs/difficulty.js:46-69`.

### 4.5. Heuristics chỉ tác động lần chấm đầu

- Bias ∈ **[-0.5, +0.5]**; `D0 = initDifficulty(rating) + bias · 0.5` ⇒ D0 chỉ lệch tối đa **±0.25** (`constants.js:24`, `index.js:147`, `heuristics.js:23-24`).
- Hệ số stability ∈ **[0.85, 1.15]** (`heuristics.js:25-26`).

### 4.6. Lịch học: bước học, trần, leech

| Quy tắc | Giá trị | Nguồn |
|---|---|---|
| Bước học thật | **1 phút → 10 phút → 1 ngày** rồi mới `Mastered` | `constants.js:17`, `index.js:50-82` |
| Trần tốt nghiệp của thẻ **chưa từng thuộc** (`lapses = 0`) | **7 ngày** | `constants.js:13`, `index.js:54` |
| Trần lần chấm đầu tiên | **21 ngày**, áp **sau** fuzz | `constants.js:5`, `index.js:228-232` |
| Trần tuyệt đối mọi lần chấm | **365 ngày**, áp sau fuzz | `constants.js:6`, `index.js:288` |
| Fuzz | ±5% khi interval ≥ 2,5 ngày | `constants.js:4`, `index.js:222-226` |
| Nhãn nút chấm khi thẻ đang New/Learning | `1p`, `10p`, `10p`, `1 ngày` | `index.js:350-390` |
| Leech | `lapses ≥ 4` ⇒ `isLeech = true` | `constants.js:29`, `index.js:23-27` |
| Thẻ leech vừa quên | hẹn lại **10 phút** (bước relearning), không nhồi lại ngay | `constants.js:31-33`, `index.js:240-246` |

## Bảo mật — việc thủ công còn lại

> **Chưa làm.** Firebase API key của project từng bị lộ trong một đoạn chat và **chưa được xoay**.
> Các bước giới hạn referrer, xoay key, bật App Check enforce và checklist kiểm tra nằm ở
> [`docs/SECURITY_KEY_ROTATION.md`](docs/SECURITY_KEY_ROTATION.md).
> App Check có code sẵn nhưng **chưa enforce** — đừng đọc README này như thể đã bật.
Nhãn "Dễ" của một thẻ mới hiện `7 ngày` vì bị trần tốt nghiệp 7 ngày — đây là hành vi có chủ đích, không phải lỗi hiển thị (kiểm bằng smoke test, xem `docs/SMOKE_TEST.md`).

---

## 5. Đồng bộ Cloud (tuỳ chọn)

### 5.1. Danh tính = mã đồng bộ

- Mã **20 ký tự** sinh bằng `crypto.getRandomValues`, bảng chữ bỏ `I/O` để không đọc nhầm (`src/core/firebase.js:141-205`); hiển thị dạng `XXXX-XXXX-XXXX-XXXX-XXXX`.
- Mã → email/password nội bộ (`firebase.js:249-255`), nên "tài khoản" chính là mã.
- **Chỉ mã do chính app sinh ra trên máy này** (`localStorage.celestialSyncKeyAutoGen = '1'`) mới được tự tạo tài khoản; mã do người dùng dán vào thì không (`firebase.js:213-242`, `resolveAuthAction` ở `:188-193`). Gõ lệch 1 ký tự sẽ **không** sinh không gian rỗng.
- Mất mã = mất quyền vào Cloud (bản trên máy vẫn còn).

### 5.2. Nơi lưu

`users/{uid}/vocabulary/{cardId}` và `users/{uid}/state/{gamification|dailyStats|settings|reviewLogs}`
(`firebase.js:526-527`, `:972-1065`). `firestore.rules` chỉ cho chủ sở hữu: `match /users/{userId}/{document=**} { allow read, write: if isOwner(userId); }`
(`firestore.rules:25-27`); các đường dẫn cũ `celestial_vocab_sync` / `celestial_user_sync` bị chặn theo `_ownerUid`.

### 5.3. Ghi cục bộ & merge

- IndexedDB `celestial-vocab-idb` **version 2**, 3 store: `vocabulary`, `settings`, `outbox` (`src/core/idb.js:9-30`).
- Mọi lần ghi thẻ đều để lại một bản ghi `outbox` (`idb.js:49-51`), xoá khi đã đẩy xong và `revision` khớp (`idb.js:120-133`).
- Merge theo **3 đồng hồ riêng** (`contentUpdatedAt`, `srsUpdatedAt`, `flagsUpdatedAt`) cộng cờ xoá `isDeleted`; hoà thì tie-break tất định để `merge(a,b) == merge(b,a)` (`src/core/card-merge.js:73-104`).
- Chống echo: bản ghi do chính máy này vừa ghi (`_lastModifiedBy === deviceId` và `syncedAt <= _lastLocalWriteTimestamp`) bị bỏ qua khi pull (`firebase.js:751-754`).
- Watermark pull **tách theo uid** (`lastPullTime:{uid}`) và lùi an toàn 10 giây (`firebase.js:148-180`, `:531`, `:721`).
- **Pull theo trang:** 200 thẻ/trang; tự động tối đa **2 trang**, đồng bộ tay/full tối đa **50 trang** (`firebase.js:528-530`, `:713-792`).
- **Circuit breaker quota:** gặp lỗi `resource-exhausted`/429 ⇒ nghỉ **1 giờ**, mốc lưu ở `localStorage.celestialQuotaExhaustedUntil` (`firebase.js:547-568`, `:609-619`).
- **Quota shield:** đồng bộ nền không đẩy quá 50 thẻ một lượt (`firebase.js:811-815`).

### 5.4. `reviewLogs` và trần 1 MiB của Firestore

Document Firestore tối đa 1 MiB; vượt là ghi hỏng vĩnh viễn. Vì vậy log thống kê có **3 ngưỡng cắt tỉa** (`src/core/state.js:674-678`):

| Ngưỡng | Giá trị |
|---|---|
| Số entry | `MAX_REVIEW_LOG_ENTRIES = 3000` |
| Số byte | `MAX_REVIEW_LOG_BYTES = 400_000` (binary search theo byte thật) |
| `deletedIds` | `MAX_REVIEW_LOG_DELETED_IDS = 500` |

Trước khi ghi lên Cloud còn một chốt thứ tư: `REVIEW_LOG_SAFE_BYTES = 700_000` (`src/core/firebase.js:1040`) — payload lớn hơn thì chỉ ghi phần mới nhất. Cắt tỉa **chỉ** đụng log thống kê, không đụng thẻ/tiến độ (`src/core/state.js:669-700`).

---

## 6. Bảo mật

| Hạng mục | Trạng thái thực tế | Nguồn |
|---|---|---|
| CSP | Có **header thật** trên Hosting (đầy đủ, gồm `frame-ancestors 'none'`) **và** 1 thẻ `<meta>` dự phòng (không có `frame-ancestors` vì Chrome bỏ qua trong meta) | `firebase.json:19-27`, `index.html:21-23` |
| `script-src` | `'self'` + `https://www.google.com/recaptcha/` — **không** còn `'unsafe-inline'` | `firebase.json:25` |
| `style-src` | Vẫn `'unsafe-inline'` (template dùng `style="..."` inline) | `firebase.json:25` |
| Firestore Rules | Chỉ chủ sở hữu đọc/ghi `users/{uid}/**` | `firestore.rules:25-27` |
| XSS | 2 sink stored-XSS đã escape + test hồi quy | `src/core/utils/sanitize.js`, `tests/xss-render.test.mjs` |
| App Check | **Đã có code, CHƯA enforce.** Thiếu `VITE_FIREBASE_APPCHECK_SITE_KEY` thì app log 1 cảnh báo và chạy tiếp không App Check. Bật enforce là thao tác trên Firebase Console, không phải trong code | `src/core/firebase.js:69-116` |

Hệ quả cần nhớ: **apiKey nằm trong bundle là bình thường** với Firebase web; thứ bảo vệ dữ liệu là Rules (+ App Check khi được bật enforce), không phải việc giấu key.

---

## 7. PWA, font, icon

### 7.1. Service Worker (Workbox qua `vite-plugin-pwa`)

- `registerType: 'autoUpdate'`, precache **35 URL** (`vite.config.js:6-20`, đếm trên `dist/sw.js`).
- `globPatterns`: `js, css, html, ico, png, svg, json, wav, woff2`; **không** gồm `mp3`.
- `globIgnores`: `version.json` và `firebase-*.js` — hai thứ này **không** precache.
- MP3 **không** precache; chỉ vào cache sau lần phát đầu: `sfx-cache` — `CacheFirst`, tối đa 10 entry, 90 ngày, nhận cả response opaque (`statuses: [0, 200]`) (`vite.config.js:21-39`).
- `firebase-chunk-cache` (`CacheFirst`, 4 entry/30 ngày) giữ chunk Firebase sau lần đồng bộ đầu (`vite.config.js:40-53`).
- Còn 4 runtime cache cho `unpkg`, `cdnjs`, `jsdelivr`, `gstatic` (`vite.config.js:54-109`). App **không** còn nạp icon/font từ các host này; chúng chỉ được liệt kê trong allowlist xoá cache của `versionCheck.js` và là đường dự phòng.
- **Chống reload loop:** mỗi version host chỉ auto-reload **1 lần trong 24 giờ**, sau đó chỉ phát cảnh báo; offline thì không làm gì; chỉ xoá cache thuộc allowlist của app (`src/core/versionCheck.js:24-25`, `:70-85`).

### 7.2. Font — self-host, không Google Fonts

- 3 file variable `woff2` trong `public/fonts/`: `lexend-latin.woff2` 39.680 B, `lexend-latin-ext.woff2` 34.476 B, `lexend-vietnamese.woff2` 13.840 B (**tổng 87.996 B**).
- Khai báo `@font-face` + `unicode-range` trong `src/css/fonts.css`; thứ tự `vietnamese → latin-ext → latin` là **có chủ đích** (file khai báo sau thắng khi ký tự nằm ở nhiều `unicode-range`, ví dụ `Đ/đ`).
- Trong `index.html` **không còn** `fonts.googleapis.com` / `fonts.gstatic.com` (đã kiểm bằng regex trên toàn file). CSP cũng không còn 2 host này.
- `firebase.json` đặt `Cache-Control: immutable` 1 năm cho `/fonts/**`.

### 7.3. Icon

- `public/phosphor-subset.css` (64.054 B, **792** rule `.ph-*`) + 4 file `woff2` subset: `regular` 23.504, `bold` 23.748, `fill` 19.460, `duotone` 28.856 B (**tổng 95.568 B**).
- Mã nguồn dùng **203** tên class `ph-*` khác nhau (`index.html` + `src/**/*.js`).
- Không xoá được weight nào: icon được chọn **động** qua `class="ph ${t.icon}"` (`src/features/fsrsPersona.js:323`, 5 archetype × 3 trait = 15 icon) và `class="ph ${rankInfo.icon}"` (`src/features/gamification.js:68`, 5 rank). Vì vậy cách đúng là **subset codepoint**, không phải bỏ weight — xem "Phát hiện mới" trong `UPGRADE_BACKLOG.md`.
- Sinh lại subset: `npm run icons` (`tools/build-icon-subset.mjs`; cần mạng + `fonttools`/`pyftsubset`, file sinh ra đã được commit nên build thường không cần mạng).

---

## 8. Optimizer FSRS offline

`npm run train` → `tools/train_fsrs7.js` → `optimizeParameters()` trong `src/core/srs/training.js`.

- Đọc `celestial_review_logs_*.json` / `review_logs.json` (mới nhất), hoặc truyền đường dẫn; `--merge-all` để gộp nhiều file.
- Dữ liệu: chỉ giữ log hợp lệ, sắp theo thời gian, lấy **3000 entry gần nhất**, thẻ phải có ≥ 2 lượt (`training.js:5-26`).
- Chia **80% train / 20% validation theo mốc thời gian** (`training.js:24`).
- Thuật toán: **leo đồi toạ độ** — mỗi vòng chỉ nhích **một** tham số theo `±8%` (tối thiểu `0.005`), có phạt L2 nhẹ so với bộ gốc; CLI chạy tối đa **340 vòng / 60 s** (`training.js:52-69`, `tools/train_fsrs7.js:29`).
  Đây **không phải** (1+λ)-ES, không phải L-BFGS, không có Cauchy mutation — bản README cũ mô tả sai phần này.
- Chỉ chấp nhận bộ mới nếu `validation.loss < 0.995 × validation.loss(baseline)` (`training.js:70-75`); nếu không, giữ bộ cũ và ghi lý do.
- Cùng một hàm này chạy trong Web Worker trên web (`src/core/srs/worker-manager.js`), nên kết quả CLI và web là một.

---

## 9. Lệnh / script

| Lệnh | Việc nó làm | Nguồn |
|---|---|---|
| `npm test` | Chạy 19 file test bằng `node --test` (203 test) | `package.json` → `scripts.test` |
| `npm run test:e2e` | Smoke E2E vòng học trên **`dist/` đã build** (Chrome headless + CDP, 2 chế độ qua `SMOKE_LEECH=1`); ~12 s, exit 0/1. **Không** tự build | `tests/e2e/study-loop.mjs` (tài liệu: `docs/SMOKE_TEST.md`) |
| `npm run dev` | Vite dev server | `scripts.dev` |
| `npm run build` | `tools/generate_version.js` (tăng version) → `vite build` | `scripts.build` |
| `npm run budget` | Đọc `dist/` **đã build**, in bảng thô/gzip từng file và so 4 ngưỡng; exit 1 nếu vượt. **Không** tự build | `tools/bundle_budget.mjs` |
| `npm run verify` | 11 test hiệu năng/vòng đời (`tools/verify_performance_lifecycle.mjs`) + 4 test version (`tools/verify_version_system.mjs`); chạy trên **dist đã build**, cần Chrome; ~29 s | `scripts.verify` |
| `npm run report` | Render `reports/upgrade-report.html` thành `reports/nang-cap-1..4.png` bằng Chrome headless (CDP) | `tools/render_report.mjs` |
| `npm run icons` | Sinh lại `phosphor-subset.css` + 4 `woff2` subset | `tools/build-icon-subset.mjs` |
| `npm run version` | Chỉ tăng version (`src/core/version.js`, `public/version.json`) | `tools/generate_version.js` |
| `npm run train` | Optimizer FSRS-7 offline | `tools/train_fsrs7.js` |
| `npm run preview` | `vite preview` (server tĩnh cho `dist/`) | `scripts.preview` |

CI (`.github/workflows/ci.yml`) chạy `npm ci` → `npm test` → `npm run build` → `npm run budget`.

Ngoài `package.json` còn các script trong `scratch/` và `tools/` phải gọi bằng `node` trực tiếp, ví dụ smoke test E2E:
`npm run test:e2e` (hoặc `node tests/e2e/study-loop.mjs` — tài liệu: `docs/SMOKE_TEST.md`). File smoke test
**nằm trong git** ở `tests/e2e/` (từ T4.6; bản cũ `scratch/smoke-study-loop.mjs` không được track), nên clone mới
chạy được ngay sau `npm run build`. Gốc repo được suy ra từ vị trí file, không phụ thuộc cwd.

---

## 10. Cấu trúc mã nguồn

```
ultimate-celestial-vocab/
├── index.html               # SPA shell + toàn bộ modal (88.981 B)
├── vite.config.js           # Vite 5 + vite-plugin-pwa (Workbox, manifest)
├── firebase.json            # hosting headers (CSP, cache) + rewrites
├── firestore.rules          # rules: chỉ chủ sở hữu users/{uid}/**
├── src/                     # 54 file, 35.504 dòng
│   ├── main.js              # điểm vào, boot theo thứ tự
│   ├── events.js            # toàn bộ event listener + phím tắt toàn cục
│   ├── core/
│   │   ├── state.js         # state trung tâm + reviewLogs & prune log (1.621 dòng, 91 export)
│   │   ├── idb.js           # IndexedDB v2: vocabulary / settings / outbox
│   │   ├── firebase.js      # Auth bằng sync key, Firestore, smartSync, prune log
│   │   ├── card-merge.js    # merge 3 đồng hồ + tombstone
│   │   ├── queue.js         # dựng hàng đợi ôn
│   │   ├── sound.js         # Web Audio + TTS
│   │   ├── dedup.js         # radar trùng lặp (mờ + confusables)
│   │   ├── tabular.js       # parser TSV
│   │   ├── import-plan.js   # planner nhập TSV
│   │   ├── tab-bus.js       # đồng bộ giữa các tab (BroadcastChannel)
│   │   ├── versionCheck.js  # chống reload loop, xoá cache có allowlist
│   │   ├── progress-merge.js / review-log-merge.js / settings-merge.js / sync.js / sync-status.js
│   │   ├── daily-stats.js / device.js / animations.js / version.js
│   │   ├── utils/           # sanitize.js, date.js
│   │   └── srs/             # index.js, constants.js, forgetting.js, stability.js,
│   │                        # difficulty.js, heuristics.js, frequency-data.js,
│   │                        # training.js, worker-manager.js, optimizer.worker.js
│   ├── features/            # gamification, badges, quiz, typing, io,
│   │                        # streakRecovery, fsrsPersona, ttsSettings
│   ├── ui/                  # render.js, modal.js, elements.js, celestial-canvas.js, waveform.js
│   └── css/                 # style.css, study-polish.css, transition.css,
│                            # icon-system.css, motion-upgrade.css, fonts.css, tokens/celestial-v5.css
├── tests/                   # 19 file .test.mjs (node:test) + e2e/study-loop.mjs
├── tools/                   # build-icon-subset, bundle_budget, render_report,
│                            # generate_version, train_fsrs7, measure_review_logs,
│                            # simulate_intervals + các script verify_*/perf_*
├── scratch/                 # script thử nghiệm, chạy tay (không được git track)
├── public/                  # fonts/ (Lexend + phosphor subset), sounds/*.mp3,
│                            # phosphor-subset.css, icon-*, manifest, version.json
├── docs/                    # SMOKE_TEST.md + SECURITY_KEY_ROTATION.md
└── reports/                 # upgrade-report.html + PNG render, audit cũ
```

DevDependencies: `vite`, `vite-plugin-pwa`, `workbox-window`, `fake-indexeddb`.
Dependencies runtime: `firebase@10.8.1`, `idb`, `animejs` (`devDependencies` / `dependencies` trong `package.json`).
Chunk Firebase được tách riêng và nạp động (`vite.config.js:173-180`).

---

## 11. Benchmark FSRS — có nguồn, và phần chưa đo

**Đo được (có file kết quả trong repo):** lần chạy optimizer gần nhất ghi ở `fsrs7_params_latest.report.json`:

```json
{ "improved": false, "reason": "no-validation-gain",
  "oldLoss": 0.45197, "newLoss": 0.47360,
  "trainCount": 1700, "validationCount": 584, "count": 3000,
  "model": "dual-stability-34" }
```

Nghĩa là: trên bộ **3.000 entry gần nhất**, sau khi replay chỉ còn **1.700 lượt** rơi vào train và **584 lượt** vào validation;
bộ tham số mới **tệ hơn** bộ mặc định nên **không** được áp dụng. Đây là hành vi đúng của cổng holdout (bộ cũ được giữ).

**Chưa đo lại được (đã bỏ khỏi tài liệu):** README cũ trích "Baseline 0,30443 → Optimized 0,29050, out-of-sample +2,57%" và bảng hiệu chuẩn "RMSE 2,07%". Không có file log/lệnh nào trong repo tái tạo được hai con số đó ở thời điểm này ⇒ **chưa đo**, không dùng làm bằng chứng.

Muốn có số mới: xuất `Xuất Review Logs FSRS-7 (.json)` từ tab Dữ liệu rồi chạy `npm run train -- "<file>.json"` — kết quả ghi đè `fsrs7_params_latest.report.json`.

---

## 12. Những gì CHƯA kiểm chứng

Danh sách này là **nợ kiểm chứng**, không phải tính năng đã xong:

1. **Đồng bộ A↔B với Firestore thật.** `tests/cloud-identity.test.mjs` chạy với driver Auth giả trong Node; chưa có lần chạy 2 profile thật nào được ghi lại (học 5 thẻ ở A → B nhập mã → thấy đủ 5 thẻ).
2. **App Check enforce.** Code đã sẵn sàng nhưng chưa bật enforce trên Console, chưa có site key thật, chưa quan sát request bị 403 khi thiếu token.
3. **Trình đọc màn hình thật** (NVDA/VoiceOver). `tests/a11y-p4.test.mjs` chỉ assert markup tĩnh (`aria-label`, `aria-live`, `lang`).
4. **iOS/Safari thật.** Safe-area mới được giả lập bằng CDP (`Emulation.setDeviceMetricsOverride`); chưa thử trên máy có notch, chưa thử "Add to Home Screen".
5. **TTS trên máy có loa.** `tests/tts.test.mjs` dùng mock; chưa ai nghe thật để xác nhận giọng/tốc độ/độ trễ, và chưa đo request ra `script.google.com`.
6. **Số benchmark FSRS cũ** (loss 0,30443 / RMSE 2,07%) — xem §11.
7. **Các con số hiệu năng cũ** (SymSpell 43,8 s → 1,1 s; FCP giảm ≥150 ms; app-ready 1,24 s → 900 ms) — không có log tái lập trong repo ở thời điểm này.
8. **`npm run icons` trên máy khác** — script cần mạng + `pyftsubset`; chưa chạy lại từ đầu, chỉ kiểm tra file sinh ra đã commit là đúng.

---

## 13. Giấy phép

MIT License. Tác giả: **DATWY**.
