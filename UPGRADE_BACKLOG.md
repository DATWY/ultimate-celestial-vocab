# UPGRADE_BACKLOG — Ultimate Celestial Vocab

> Nguồn: báo cáo đánh giá ngày 2026-10-26 (commit `4e51f0e`) + 4 vòng audit độc lập.
> Quy ước: mỗi task **tự đứng một mình** (đủ để giao cho 1 người/1 agent), có **DoD đo được** và **lệnh kiểm chứng**.
> Ước lượng theo **giờ công 1 dev có hiểu codebase**.
>
> **Cập nhật P5 — 2026-10-26:** P5 bắt đầu ở HEAD `7ec2465`, số liệu được đo lại ở HEAD `c3f5a51`
> (commit T2.5 tách panel cài đặt giọng thành chunk lazy). Thêm bảng trạng thái từng task (§0.1) với commit +
> số đo lại được, mục "Phát hiện mới trong lúc làm" (§3.5) và "Bài học" (§3.6).
> `npm test` tại HEAD: **203/203 PASS** (19 file, ~0,50 s). Quy tắc giữ nguyên: **chỉ đánh `[x]` khi có commit chứa
> thay đổi thật**; task đã làm một phần vẫn để `[ ]` và ghi rõ phần còn thiếu.

---

## 0. Nguyên tắc thực hiện

1. **Mỗi task = 1 commit** (hoặc 1 PR nhỏ). Không gộp P0 với refactor.
2. **Không sửa code khi chưa có test tái hiện** (trừ T0.1–T0.4 là vá nóng, test viết ngay sau trong cùng task).
3. **Không migration dữ liệu SRS** cho thẻ đã có trạng thái — thay đổi lịch chỉ áp cho thẻ `New` và cho các lần chấm tiếp theo (xem R3).
4. Mọi thay đổi hành vi học (Phase 1) phải có **số đo trước/sau** ghi vào commit message.
5. Chạy `npm test` trước và sau mỗi task; CI phải xanh.

---

## Bảng tổng

| Phase | Nội dung | Task | Giờ | Chặn bởi |
|---|---|---:|---:|---|
| **P0** | Cấp cứu bảo mật & toàn vẹn dữ liệu | 7 | 9 | — |
| **P1** | Sửa sản phẩm học (SRS policy) | 8 | 14 | P0 (để tránh conflict file) |
| **P2** | Cập nhật / offline / cloud bền vững | 6 | 12 | P0 |
| **P3** | Hiệu năng & payload | 5 | 11 | P2 (SW/font) |
| **P4** | A11y + chất lượng code | 6 | 13 | P1 (render.js) |
| **P5** | Tài liệu & repo | 4 | 6 | tất cả |
| | | **36** | **65 h** | |

**Lộ trình 1 dev:** ~8–9 ngày làm việc. **3 track song song:** ~4 ngày (xem §4).

---

## 0.1 Trạng thái từng task (đo lại 2026-10-26, HEAD `c3f5a51`)

**22/36 task `[x]`** (có commit), **14 task `[ ]`** — trong đó `T3.2` và `T4.3` đã làm **một phần** nhưng chưa đạt DoD.
Bảng dưới là **nguồn trạng thái duy nhất**; các mục P0–P5 phía sau giữ nguyên nội dung gốc của task (Chạm/Làm/DoD/Verify).

| Task | | Commit | Kết quả đo được / lý do chưa xong |
|---|---|--------|-----------------------------------|
| T0.1 | `[x]` | `b6b498a` | 2 sink stored-XSS đã escape; `node --test tests/xss-render.test.mjs` → **10/10 PASS** |
| T0.2 | `[x]` | `b6b498a` | cùng commit: 10 test với payload `<img onerror>`, `<script>`, quote, tiếng Việt có dấu |
| T0.3 | `[x]` | `b9aba05` | `initializeAppCheck` ở `src/core/firebase.js:83-116`; thiếu site key thì warn 1 lần. **Chưa enforce**, chưa có site key ⇒ DoD "request không token bị 403" **chưa kiểm** |
| T0.4 | `[x]` | `b9aba05` | CSP header `firebase.json:25` + meta `index.html:23`; `script-src` **0** lần `'unsafe-inline'`, `style-src` còn 1 lần (template inline) |
| T0.5 | `[x]` | `066c9e5` | `resolveAuthAction()` mặc định `fail`; `node --test tests/cloud-identity.test.mjs` → **12/12 PASS** |
| T0.6 | `[x]` | `066c9e5` | watermark pull tách theo uid (`pullWatermarkKey`, `firebase.js:177-180`); 12/12 test cloud-identity PASS. **Chưa chạy 2 profile Chrome thật** |
| T0.7 | `[x]` | commit P5 (docs) | `docs/SMOKE_TEST.md` 187 dòng, chạy 2 chế độ `ok:true` (**12,1 s** / **11,9 s**); gồm 7 bẫy CDP đã gặp + cách dọn tài khoản rác |
| T1.1 | `[x]` | `569c509` | smoke: nhãn `1p / 10p / 10p / 7 ngày`; chấm Nhớ → `Learning`, `learningStep=1`, hạn **+10 phút**; `learning-steps.test.mjs` **16/16** |
| T1.2 | `[x]` | `569c509` | `MAX_INTERVAL_DAYS = 365` (`constants.js:6`), clamp **sau** fuzz (`index.js:288`), dự báo cũng chịu trần (`index.js:376`) |
| T1.3 | `[x]` | `e6d6a33` | bias ∈ ±0,5 (`heuristics.js:23-24`) ⇒ D0 lệch ±0,25; hệ số S 0,85–1,15; `heuristics-amplitude.test.mjs` **5/5** |
| T1.4 | `[x]` | `e6d6a33` | `LEECH_LAPSE_THRESHOLD = 4`; smoke `SMOKE_LEECH=1` PASS: badge "CỰC KHÓ" hiện, nút Quên = `10p`, chấm Nhớ → bước 2 (≈1440 phút); `leech.test.mjs` **9/9** |
| T1.5 | `[ ]` | — | Không tồn tại `maxReviewsPerDay`; chỉ có giới hạn thẻ **mới**/ngày (`computeDailyNewLimit`, `queue.js:133`) |
| T1.6 | `[x]` | `4047255` | sửa 2 lỗi dự báo (srsDueDate → `Invalid Date`; bucket lệch ngày DST); `forecast.test.mjs` **20/20** |
| T1.7 | `[x]` | `4047255` | `golden-fsrs.test.mjs` **4/4** (theo commit: 50 kịch bản × 11 trường + fuzz khoá + 200 tổ hợp PRNG) |
| T1.8 | `[x]` | commit P5b | 10/10 câu ví dụ mẫu đã review; sửa 2 câu: `resilience` ("Courage is going on when you do not have strength." → "Her resilience helped her rebuild a life after the flood.") và `meticulous` (bớt lặp "preserving the precision"). **Phần dịch VI cho câu ví dụ KHÔNG làm được**: schema thẻ chỉ có `example`, không có field `exampleVi` → cần task riêng nếu muốn |
| T2.1 | `[x]` | `f8d1ccb` | `RELOAD_GUARD_WINDOW_MS = 24h` (`versionCheck.js:25`), offline không làm gì, xoá cache theo allowlist; `version-guard.test.mjs` **9/9** |
| T2.2 | `[x]` | `2313e40` | **0** tham chiếu `fonts.googleapis.com` / `fonts.gstatic.com` trong `index.html` và CSP; 3 woff2 = **87.996 B** (`src/css/fonts.css`) |
| T2.3 | `[x]` | `f8d1ccb` | `/assets/**` + `/fonts/**` immutable 1 năm, `/index.html` + `/` no-cache, `/version.json` no-store (`firebase.json:29-83`) |
| T2.4 | `[x]` | `4122444` | 3 ngưỡng **3000 entry / 400.000 B / 500 deletedIds** (`state.js:674-678`) + chốt `700_000` B trước khi ghi lên Cloud (`firebase.js:1040`); `review-logs-prune.test.mjs` **19/19** |
| T2.5 | `[x]` | `4122444` (+ `c3f5a51`) | chọn giọng/tốc độ ở `src/features/ttsSettings.js`; `tts.test.mjs` **10/10**. `c3f5a51` tách panel cài đặt giọng thành chunk lazy: entry **81,38 → 80,67 kB gzip** |
| T2.6 | `[ ]` | — | `registerType` vẫn `'autoUpdate'` (`vite.config.js:7`); chưa có toast "đã cập nhật" |
| T3.1 | `[x]` | `2313e40` | woff2 icon **593.596 → 95.568 B (−83,9%)**, `phosphor-subset.css` 64.054 B / **792** rule `.ph-*`; **không xoá weight nào** — xem §3.5 #1 |
| T3.2 | `[ ]` một phần | `862c33a` | đã xoá 504 dòng / 62 rule, `style.css` còn 410.502 B. **DoD KHÔNG đạt:** `!important` toàn `src/css` = **1.920** (mục tiêu < 800) và CSS Vite **58,98 kB gzip** (mục tiêu ≤ 40 kB) — xem §3.5 #2 |
| T3.3 | `[x]` | `f8d1ccb` | precache **35 URL, 0 mp3**; `/sounds/*.mp3` chỉ vào `sfx-cache` (CacheFirst, 10 entry / 90 ngày) |
| T3.4 | `[ ]` | — | `runWhenIdle` có ở `main.js:32` nhưng không có commit cho task này; **chưa đo** app-ready |
| T3.5 | `[x]` | `4047255` | `npm run budget` **4/4 ngưỡng OK**: entry 80,67/82 kB · firebase 113,69/120 kB · CSS 326,70/350 kB · dist 2.096,07/2.700 kB; CI có bước `npm run budget` |
| T4.1 | `[x]` | `7ec2465` | `aria-label` cho `#typing-input`, `role=status aria-live=polite` cho `#typing-feedback`, `lang="en"` cho từ tiếng Anh; `a11y-p4.test.mjs` **8/8** |
| T4.2 | `[x]` | `7ec2465` | `focusGradingArea()` khi lật bằng bàn phím; chuột/tap **không** cướp focus |
| T4.3 | `[ ] một phần` | `7ec2465` | chỉ xong safe-area (`viewport-fit=cover`, `index.html:6`) + `@supports` margin-bottom. **Không** có `color-scheme` / bootstrap theme inline ⇒ nháy trắng **chưa** xử lý |
| T4.4 | `[ ]` | — | không có file eslint/prettier trong repo; CI (`.github/workflows/ci.yml`) không có bước lint |
| T4.5 | `[ ]` | — | `src/core/state.js` vẫn 1 file **1.621 dòng / 91 export** (ước lượng "1.378 dòng, 74 export" trong task đã lạc hậu) |
| T4.6 | `[ ]` | — | `tests/e2e/` không tồn tại; smoke test nằm ở `scratch/` và **không được git track** (`.gitignore:44`) |
| T5.1 | `[ ]` | (`678132a` gắn nhãn) | commit `678132a` chỉ thêm script render báo cáo; đến hết `7ec2465` README **vẫn ghi "77/77"**. Bản viết lại theo số đo đang ở working tree, **chưa commit** |
| T5.2 | `[ ]` | — | **14** file `.md` ở gốc trên đĩa, **8** file được track (`git ls-files "*.md"`); chưa gộp |
| T5.3 | `[ ]` | — | `reports/WEB_DISCOVERY_FOR_CHATGPT/WEB_DISCOVERY_FOR_CHATGPT.zip` **9.019.103 B** vẫn được track (`*.zip` đã ignore nhưng file add từ trước) |
| T5.4 | `[ ]` | — | không có `CHANGELOG.md` |

---

## P0 — Cấp cứu (mục tiêu: hết rủi ro chiếm tài khoản & mất dữ liệu)

### [x] T0.1 — Escape 2 sink XSS đã xác nhận · 1 h
- **Chạm:** `src/features/gamification.js:998-999`, `src/features/streakRecovery.js:299-301`, `src/ui/modal.js:105-112`
- **Làm:**
  1. `gamification.js`: import `escapeHTML` từ `core/utils/sanitize.js`, bọc `${w}` và `dayLabels[index]`.
  2. `streakRecovery.js`: bọc `${currentQ.question}` và `${currentQ.word.pronunciation}` (các option đã escape đúng — giữ nguyên).
  3. Rà toàn bộ lời gọi `showPopup(..., true)` và mọi template có `${` trong `innerHTML`: chỉ cho phép nội suy **số/nhãn tĩnh**, mọi chuỗi từ dữ liệu phải qua `escapeHTML`.
  4. Thêm comment cảnh báo tại `modal.js:105` — `isHTML=true` là API nguy hiểm, ưu tiên `textContent`.
- **DoD:** payload `<img src=x onerror=alert(1)>` đặt ở `card.english` không tạo phần tử `<img>` trong DOM ở cả 2 luồng; `grep -rn '\${w}' src/features/gamification.js` = 0.
- **Verify:** `npm test` + test mới T0.2.

### [x] T0.2 — Test hồi quy XSS · 2 h
- **Chạm:** `src/features/gamification.js` (tách hàm thuần), `src/features/streakRecovery.js`, `tests/xss-render.test.mjs` (mới)
- **Làm:** tách phần tạo HTML ra hàm thuần `buildForecastWordsHtml(words)` / `buildPenanceQuestionHtml(q)` (không đụng DOM) rồi test bằng `node:test`: input chứa `<script>`, `"`, `'`, `onerror=` → output không chứa thẻ thực thi, chứa entity.
- **DoD:** ≥6 assert cho 2 hàm; test fail nếu ai gỡ `escapeHTML`.
- **Verify:** `node --test tests/xss-render.test.mjs`

### [x] T0.3 — Firebase App Check · 2 h (+ thao tác console)
- **Chạm:** `src/core/firebase.js`, Firebase Console
- **Làm:** `initializeAppCheck(app, { provider: new ReCaptchaV3Provider(SITE_KEY), isTokenAutoRefreshEnabled: true })`; ghi SITE_KEY vào `.env` + `.env.example`; bật **Enforce** cho Firestore/Auth trên console; thêm fallback `import.meta.env.DEV` để dev không bị chặn.
- **DoD:** build prod gọi Firestore có header `X-Firebase-AppCheck`; request không token bị 403 (kiểm bằng curl/REST).
- **Verify:** mở app live, đọc Network → `instances/*:runQuery` có header; `npm test` xanh.

### [x] T0.4 — Siết CSP + chuyển sang header · 2 h
- **Chạm:** `index.html:12`, `firebase.json` (`hosting.headers`)
- **Làm:** bỏ `'unsafe-inline'` khỏi `script-src`; bỏ `https://unpkg.com` (không còn dùng); khai CSP đầy đủ trong `firebase.json` (kèm `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`); giữ meta chỉ như bản dự phòng.
- **DoD:** console không có vi phạm CSP; app boot + lật thẻ + mở Hub + quiz + TTS hoạt động; `curl -I https://<host>` có header CSP.
- **Verify:** chạy checklist smoke 8 bước (ghi vào PR), `npm run build`.

### [x] T0.5 — Sửa luồng sync key (không auto-tạo tài khoản) · 2 h
- **Chạm:** `src/core/firebase.js:143-205`, `src/features/io.js` (UI nhập key), `src/events.js:1150-1195`
- **Làm:**
  1. Bỏ `createUserWithEmailAndPassword` khỏi nhánh `auth/invalid-credential`. Chỉ tạo mới khi **người dùng chủ động** bấm "Tạo không gian mới" (có cảnh báo: mã là chìa khoá duy nhất).
  2. Khi đăng nhập thất bại: giữ nguyên key cũ, báo rõ "Mã không đúng hoặc không tồn tại. Kiểm tra lại 20 ký tự."
  3. Thêm nút "Xem mã hiện tại / Sao lưu mã" + cảnh báo copy ngay.
- **DoD:** nhập key sai 1 ký tự → không tạo user mới, không mất dữ liệu, có thông báo; test đơn vị cho hàm quyết định (`resolveAuthAction(error)`).
- **Verify:** `npm test` + thao tác tay 2 profile Chrome.

### [x] T0.6 — Vá luồng "liên kết thiết bị" · 2 h
- **Chạm:** `src/features/io.js:437-460`, `src/core/firebase.js:370-390`, `:540-590`, `src/core/sync.js`
- **Làm:**
  1. `io.js:455` gọi đúng API tồn tại: `smartSync({ forceFullPull: true, isManual: true })` (bỏ `triggerFullSync?.()`).
  2. Đổi `lastPullTime` thành **theo uid**: `lastPullTime:{uid}`; xoá/khởi tạo lại khi `applySyncKey`.
  3. Xoá listener trùng: giữ 1 trong 2 (`io.js:71` hoặc `events.js:1152`), xoá cái còn lại.
  4. `showConfirmation` chỉ 1 callback — kiểm tra chỗ gọi không ghi đè nhau.
- **DoD:** kịch bản 2 profile: A học 5 thẻ → B nhập key A → B thấy đủ 5 thẻ + tiến độ; đổi lại key cũ → dữ liệu cũ trở lại; không cần "Đồng bộ tất cả".
- **Verify:** checklist tay 5 bước + `npm test`.

### [x] T0.7 — Sổ tay kiểm thử thủ công (smoke) · 1 h
- **Chạm:** `docs/SMOKE_TEST.md` (mới)
- **Làm:** 20 bước: boot, lật, chấm 4 mức, undo, gõ phím, quiz, mở Hub 4 tab, nhập TSV, export, sync key, reload khi offline, boost mode, dark/light, mobile 390px.
- **DoD:** file tồn tại, mỗi bước có "kỳ vọng" rõ ràng; dùng lại cho P1–P4.
- **Verify:** chạy thử 1 lượt, ghi kết quả.

---

## P1 — Sản phẩm học (mục tiêu: thẻ mới không còn "thuộc" sau 1 lần bấm)

### [x] T1.1 — Learning steps thật · 4 h
- **Chạm:** `src/core/srs/index.js:130-180`, `src/core/queue.js`, `src/core/state.js` (schema card), `src/ui/render.js` (nhãn interval)
- **Làm:** thêm `learningStep` (0/1/2). Thẻ `New`:
  - rating 1 → step 0, due `now + 1m`
  - rating 2 → step 1, due `now + 10m`
  - rating 3 → step 2, due `now + 1d`
  - rating 4 → step 2, due `now + 3d`
  Chỉ khi hoàn tất step cuối (Good/Easy ở bước ≥2) mới → `Mastered`. `LEARNING_STEPS` đang khai báo trong `constants.js` phải được dùng thật.
- **DoD:** test: New + Good → `Learning`, due ≈ now+1d; lần 2 Good → `Mastered` với interval 2–7 ngày; UI hiện "<10p / 1d" đúng.
- **Verify:** `node --test tests/srs-arithmetic.test.mjs` + test mới.

### [x] T1.2 — Max interval · 1 h
- **Chạm:** `src/core/srs/constants.js`, `src/core/srs/index.js:154-176`
- **Làm:** `MAX_INTERVAL_DAYS = 365`; clamp sau fuzz cho **mọi** lần chấm (không chỉ lần đầu); áp cả trong `predictNextIntervals` (`index.js:241`).
- **DoD:** test: 20 lần Good liên tiếp → interval ≤ 365; nút "Dễ" không bao giờ hiện > 365 ngày.
- **Verify:** `npm test`.

### [x] T1.3 — Giảm heuristics bơm S0/D0 · 3 h
- **Chạm:** `src/core/srs/heuristics.js:57-123`, `src/core/srs/index.js:66-78`
- **Làm:** thu hệ số S0 về [0.85, 1.15] (từ [0.5, 1.5]); D0 ±0.5 (từ ±1.5); hoặc tắt hoàn toàn và đo.
- **DoD:** bảng trước/sau cho 6 từ mẫu ("cat", "meadow", idiom, từ dài) — ghi vào commit; chênh lệch interval lần đầu ≤ 2× giữa từ dễ/khó.
- **Verify:** script `tools/simulate_intervals.mjs` (tạo trong task này) chạy được, in bảng.

### [x] T1.4 — Leech handling · 2 h
- **Chạm:** `src/core/srs/index.js`, `src/features/badges.js`, `src/ui/render.js`
- **Làm:** `lapses >= 4` → cờ `isLeech`; hiện badge + banner "Từ này đang chống lại bạn" + gợi ý đổi cách học (viết câu, nghe); thêm bước relearning cố định 10m thay vì quay lại queue ngay.
- **DoD:** test: 4 lần Again → `isLeech=true`; thẻ leech không bị đưa về vị trí 5 ngay lập tức mà có due +10m.
- **Verify:** `npm test`.

### [ ] T1.5 — Cap số thẻ ôn/ngày · 2 h
- **Chạm:** `src/core/queue.js:120-175`, `index.html` (setting), `src/core/state.js`
- **Làm:** `maxReviewsPerDay` (mặc định 200, phạm vi 50–500), lưu trong settings, cắt queue due; hiển thị "còn X thẻ hôm nay".
- **DoD:** đặt 50 → queue due tối đa 50; setting tồn tại qua reload và sync.
- **Verify:** test queue + thao tác tay.

### [x] T1.6 — Đúng số liệu dự báo & dashboard · 1 h
- **Chạm:** `src/core/srs/index.js:200-250`, `src/ui/render.js:560-740`
- **Làm:** truyền `modality` thật vào `predictNextIntervals` (bỏ hardcode `'en-vi'`); sửa nhãn Again "<10p" cho khớp due thực; làm rõ 3 số "Đã thuộc / Cần ôn / Đang học" để không cộng lệch với "Tổng" (đổi nhãn thành "Đã thuộc (chưa đến hạn)" hoặc tính lại).
- **DoD:** số trên dock cộng khớp `Tổng`; dự báo khớp interval thật khi chấm.
- **Verify:** đối chiếu tay 5 thẻ.

### [x] T1.7 — Golden test FSRS · 2 h
- **Chạm:** `tests/srs-golden.test.mjs` (mới), `tests/fixtures/fsrs-golden.json`
- **Làm:** 10 chuỗi review → snapshot `{S, D, interval}`; test so khớp ±1e-6. Không tự sinh từ chính code hiện tại mà đối chiếu spec.
- **DoD:** refactor SRS làm lệch 1% là test đỏ.
- **Verify:** `npm test`.

### [x] T1.8 — Sửa học liệu mẫu · 1 h
- **Chạm:** `src/core/state.js:1342-1370` (demo vocab), `docs/` nếu có mẫu
- **Làm:** ví dụ câu tiếng Anh tự nhiên (đã phát hiện: "Courage is going on when you do not have strength." sai ngữ pháp), thêm bản dịch VI cho câu ví dụ.
- **DoD:** 10/10 câu ví dụ được review, có nghĩa VI.
- **Verify:** đọc lại + chụp màn hình.

---

## P2 — Cập nhật / offline / cloud bền vững

### [x] T2.1 — Chống reload loop · 2 h
- **Chạm:** `src/core/versionCheck.js:31-110`
- **Làm:** đọc `localStorage.lastReload` `{version, at, count}`; nếu cùng version trong 10 phút → không reload, chỉ hiện banner "Bản mới sẵn sàng — tải lại"; reload tối đa 1 lần/version; chỉ xoá cache khi mismatch **thật** (không xoá khi offline).
- **DoD:** giả lập `version.json` mới hơn bundle → reload đúng 1 lần rồi dừng; offline không xoá cache.
- **Verify:** test đơn vị `shouldReload(state)` + thao tác tay (sửa version.json local).

### [x] T2.2 — Offline thật: font · 3 h
- **Chạm:** `vite.config.js:10`, `index.html:18-25`, `public/fonts/*`
- **Làm:** thêm `woff2` vào `globPatterns`; **self-host Lexend** (subset vietnamese+latin) thay Google Fonts → bỏ 3 request render-blocking; `font-display: swap`; preload 1 font chính.
- **DoD:** DevTools offline → icon + chữ hiển thị đúng; không còn request `fonts.googleapis.com`; FCP giảm ≥150 ms (đo như T3.5).
- **Verify:** offline reload 3 lần; đo lại trang live.

### [x] T2.3 — Cache header đúng · 1 h
- **Chạm:** `firebase.json` (`hosting.headers`)
- **Làm:** `/assets/**` → `public, max-age=31536000, immutable`; `/index.html` + `/` → `no-cache`; `/version.json` → `no-store` (đã có); `/fonts/**` → `max-age=31536000, immutable`.
- **DoD:** `curl -I` xác nhận 3 nhóm header.
- **Verify:** deploy preview + curl.

### [x] T2.4 — Chống chạm hạn 1 MiB của `reviewLogs` · 3 h
- **Chạm:** `src/core/firebase.js:711-745`, `src/core/review-log-merge.js`
- **Làm:** giới hạn cứng ≤ 2.500 dòng + dict ≤ 4.000 id; hoặc chia 2–3 doc theo `hash(cardId) % 3`; thêm cảnh báo UI khi >80% hạn mức; khi transaction fail vì size → nén mạnh hơn rồi retry 1 lần, cuối cùng báo người dùng.
- **DoD:** test: log 6.000 dòng → doc mỗi phần < 700 KB; sync vẫn thành công.
- **Verify:** `npm test` + test với dữ liệu tổng hợp.

### [x] T2.5 — TTS: minh bạch & cấu hình được · 2 h
- **Chạm:** `src/core/sound.js:15,1150-1180`, `index.html` (settings), CSP `connect-src`
- **Làm:** đưa URL endpoint thành setting (mặc định: Web Speech API của máy); chỉ gọi Apps Script khi người dùng bật "Giọng nâng cao"; thêm dòng giải thích quyền riêng tư trong tab Dữ liệu.
- **DoD:** mặc định không có request ra ngoài khi phát âm; tắt/bật rõ ràng; offline vẫn phát được bằng giọng máy.
- **Verify:** DevTools Network + offline.

### [ ] T2.6 — Thông báo cập nhật · 1 h
- **Chạm:** `vite.config.js` (`registerType`), `src/core/versionCheck.js`, `index.html` (banner)
- **Làm:** đổi `autoUpdate` → `prompt` **hoặc** giữ autoUpdate nhưng hiện toast "Đã cập nhật lên bản mới" 1 lần.
- **DoD:** không reload mất ngữ cảnh khi đang gõ từ; người dùng biết khi có bản mới.
- **Verify:** deploy 2 bản liên tiếp, quan sát.

---

## P3 — Hiệu năng

### [x] T3.1 — Icon: 1 weight + SVG sprite · 4 h
- **Chạm:** `public/phosphor-subset.css`, `public/fonts/*`, toàn bộ `<i class="ph-...">`, `tools/build-icon-subset.mjs`
- **Làm:** chọn 1 weight (duotone hoặc regular) + sprite SVG cho ~40 icon hay dùng; `font-display: swap` nếu vẫn giữ font.
- **DoD:** tổng payload icon ≤ 150 KB (hiện 446–594 KB); không icon nào bị mất (chụp ảnh so sánh 6 màn).
- **Verify:** đo `du`/`dist` + so sánh ảnh trước/sau.

### [ ] T3.2 — Dọn CSS chết · 4 h
- **Chạm:** `src/css/style.css`, `study-polish.css`, `transition.css`, `tokens/celestial-v5.css`
- **Làm:** xoá ~182 khai báo `backdrop-filter: none !important` (kill-switch của hệ blur đã bị gỡ); gộp 256 selector trùng; **chọn 1 hệ token**: chuyển dần sang `--v5-*` hoặc xoá file token; cấm thêm `!important` mới (quy ước trong CONTRIBUTING).
- **DoD:** `!important` từ 2.068 → < 800; CSS gzip ≤ 40 KB; ảnh so sánh 6 màn không lệch.
- **Verify:** `npx vite build` + visual diff (Playwright screenshot).

### [x] T3.3 — Bỏ preload MP3 · 1 h
- **Chạm:** `src/core/sound.js:40-60`
- **Làm:** chỉ tải/giải mã SFX sau tương tác đầu tiên (hoặc `requestIdleCallback` sau 3 s).
- **DoD:** mở app không phát sinh request âm thanh; lần chấm đầu vẫn có tiếng (độ trễ <150 ms).
- **Verify:** Network panel + thao tác tay.

### [ ] T3.4 — Giảm việc trên critical path · 2 h
- **Chạm:** `src/main.js:162-172`, `src/core/queue.js`, `src/ui/render.js:280-360`
- **Làm:** render thẻ đầu tiên trước (chỉ cần `nextDueDate`), `buildReviewQueue()` chạy sau trong `requestIdleCallback`; `updateStats()` hoãn 1 frame; `checkAppVersion()` chuyển vào idle.
- **DoD:** app-ready từ ~1,24 s → ≤ 900 ms trên máy CI (3.000 thẻ).
- **Verify:** harness `tools/perf_deep_audit.mjs`.

### [x] T3.5 — Ngân sách hiệu năng trong CI · 2 h
- **Chạm:** `tools/check-budget.mjs` (mới), `.github/workflows/ci.yml`
- **Làm:** fail nếu: JS entry > 100 KB gzip, CSS > 45 KB gzip, font > 200 KB, HTML > 20 KB gzip, app-ready > 1.000 ms (headless).
- **DoD:** PR vượt ngân sách bị CI chặn; số đo in ra trong log CI.
- **Verify:** tạo PR thử vượt 1 ngưỡng.

---

## P4 — A11y & chất lượng code

### [x] T4.1 — Tên & thông báo cho trình đọc màn hình · 2 h
- **Chạm:** `index.html:167,170,159,205`, `src/events.js:960-1000`
- **Làm:** `aria-label` cho `#typing-input`; `role="status" aria-live="polite"` cho `#typing-feedback`; `aria-live="polite"` cho vùng đáp án khi lật thẻ; `lang="en"` cho `#card-english`, `#card-example`.
- **DoD:** VoiceOver/NVDA đọc được câu trả lời + phản hồi; axe không còn lỗi "form field without name".
- **Verify:** axe DevTools + đọc tay.

### [x] T4.2 — Focus sau khi lật thẻ · 1 h
- **Chạm:** `src/ui/render.js:481-527`
- **Làm:** không focus vào nút Good ngay; đặt focus vào vùng nội dung mặt sau (`tabindex="-1"`), chỉ chuyển tới nút khi người dùng Tab.
- **DoD:** Tab từ thẻ → đọc được nghĩa trước khi tới nút chấm.
- **Verify:** điều hướng bàn phím 10 bước.

### [ ] T4.3 — Hết nháy trắng + safe-area · 2 h
- **Chạm:** `index.html` (bootstrap inline), `style.css:89,168`, `celestial-v5.css`
- **Làm:** script inline ≤200 B đặt class `dark-mode` trước khi CSS chạy (dựa `localStorage`/`matchMedia`); thêm `color-scheme: light dark`; `env(safe-area-inset-*)` cho header + grid nút chấm + dock.
- **DoD:** không còn flash trắng (quay video 3 lần); iPhone có notch không bị che.
- **Verify:** record màn hình + DevTools mobile.

### [ ] T4.4 — ESLint + Prettier + CI · 3 h
- **Chạm:** `.eslintrc.cjs`/`eslint.config.js`, `.prettierrc`, `package.json`, `ci.yml`
- **Làm:** config tối thiểu (no-unused-vars, no-undef, no-floating-promises nếu dùng TS check), chạy `--fix` một lần, thêm bước `npm run lint` vào CI (chưa chặn merge tuần đầu, sau đó chặn).
- **DoD:** `npm run lint` = 0 error; CI có bước lint.
- **Verify:** CI xanh.

### [ ] T4.5 — Tách `state.js` · 4 h
- **Chạm:** `src/core/state.js` (1.378 dòng, 74 export)
- **Làm:** tách `state/core.js` (vocab, queue index), `state/gamification.js`, `state/reviews.js`, `state/streak.js`; giữ re-export ở `state.js` để không phá import (làm 2 bước: re-export trước, cập nhật import sau).
- **DoD:** mỗi file < 400 dòng; `npm test` xanh; không đổi hành vi (so sánh snapshot trước/sau).
- **Verify:** `npm test` + smoke 8 bước.

### [ ] T4.6 — 1 test E2E vòng học · 3 h
- **Chạm:** `tests/e2e/study-loop.spec.mjs` (mới), `package.json`, `ci.yml`
- **Làm:** Playwright (chromium) + `vite preview`: seed 10 thẻ qua `?audit=1`, lật, chấm 4 mức, undo, reload → assert IndexedDB còn trạng thái, offline reload vẫn mở.
- **DoD:** test chạy trong CI < 60 s; fail nếu `processSrsFeedback` ngừng lưu.
- **Verify:** CI xanh + cố tình phá `saveOneWord` để thấy test đỏ.

---

## P5 — Tài liệu & repo

### [ ] T5.1 — README theo số đo thật · 2 h
- Thay "77/77" → 82 (hoặc số hiện tại); bỏ "0% GPU"; ghi rõ optimizer là **leo đồi toạ độ 100 vòng**, không phải L-BFGS/ES; nêu rõ phần nào là FSRS-7 chuẩn, phần nào là mở rộng của tác giả (heuristics, typing bonus, cap 21 ngày).

### [ ] T5.2 — Gộp báo cáo · 1 h
- 13 file `.md` ở gốc → `docs/reports/` + 1 `docs/README.md` làm mục lục; xoá bản trùng.

### [ ] T5.3 — Dọn repo · 2 h
- Bỏ track `reports/WEB_DISCOVERY_FOR_CHATGPT/*.zip` (9 MB) và ảnh trùng (dùng `git filter-repo`, **cảnh báo: rewrite history — cần thông báo trước**); thêm `scratch/`, `backups/`, `.codex-evaluation-dist/` vào ignore; quyết định bỏ track `version.js`/`version.json` (build sinh ra).

### [ ] T5.4 — CHANGELOG · 1 h
- Sinh từ commit (`conventional-changelog`), thêm vào `npm run release`.

---

## 3.5 Phát hiện mới trong lúc làm (P5)

### #1 — T3.1 "xoá icon weight" là BẤT KHẢ THI, phải subset codepoint

Không thể biết trước weight nào cần, vì class `ph` được chọn **động từ dữ liệu runtime**:

- `class="ph ${t.icon}"` — `src/features/fsrsPersona.js:323` (5 archetype × 3 trait = **15 icon**),
- `class="ph ${rankInfo.icon}"` — `src/features/gamification.js:68` (**5 rank**).

Grep trước khi build không liệt kê được các chuỗi này. Vì vậy hướng đúng là **subset codepoint** (giữ đủ 4 weight),
không phải bỏ weight. Đã làm ở `2313e40`: **593.596 → 95.568 B (−83,9%)**, giữ 198 codepoint/weight (duotone 396)
theo commit message, tên class trong `phosphor-subset.css` không đổi.

### #2 — `!important` < 800 và CSS gzip ≤ 40 kB KHÔNG đạt được bằng xoá code chết

Đo sau `862c33a`:

| Chỉ số | Hiện tại | Mục tiêu DoD | Cách đo |
|---|---:|---:|---|
| `!important` trong `src/css` | **1.920** (riêng `style.css`: 1.624) | < 800 | regex `!important` trên `src/css/**/*.css` |
| CSS do Vite sinh | **326.700 B / 58,98 kB gzip** | ≤ 40 kB gzip | `npm run budget` |
| Mức giảm của T3.2 | −14.042 B (−3,32%) / −504 dòng | — | commit `862c33a` |

Xoá code chết chỉ đi đúng một bậc nhỏ hơn mục tiêu. Nguyên nhân là **specificity**: 6 file CSS override chéo nhau
(`style.css`, `study-polish.css`, `transition.css`, `motion-upgrade.css`, `icon-system.css`, `tokens/celestial-v5.css`)
nên mỗi rule mới phải dùng `!important` để thắng.

→ **Task mới T3.2b (chưa làm):** đưa các file vào `@layer` theo thứ tự tokens → base → polish → motion, hạ
`!important` xuống chỉ còn cho thuộc tính cần chặn inline style (`style="..."` do JS sinh), rồi đo lại bằng
`npm run budget` + `Get-ChildItem src/css`.

### #3 — Entry gzip 80,67 kB = 98,4% ngân sách, và chi phí entry KHÔNG nằm ở TTS

`npm run budget` trên `dist/` build 26/10/2026 11:15: entry `assets/index-*.js` 247.804 B thô → **80,67 kB gzip**,
ngân sách 82 kB ⇒ chỉ còn **1,33 kB** dư địa.

Đo thử: stub toàn bộ phần T2.5 (TTS) thì entry chỉ xuống **79,54 kB** (tiết kiệm ~1,1 kB).
*Số này do agent T2.5 đo; P5 chưa lặp lại phép stub.* Sau đó chính agent đó làm thật (`c3f5a51`): tách panel cài đặt
giọng thành chunk lazy và entry **81,38 → 80,67 kB gzip** — vẫn còn 98,4% ngân sách.

Nút thắt thật là `src/core/state.js`: **1.621 dòng, 91 export** (`(Get-Content src/core/state.js).Count`;
`grep '^export'`), được import ở gần như mọi module.

→ **Task mới T4.5b (chưa làm, ưu tiên cao hơn T2.5):** tách `state.js` thành `state/vocabulary`, `state/gamification`,
`state/reviews`, `state/streak` (re-export trước, đổi import sau) rồi đo lại entry gzip.
Lưu ý: con số "~3.000 dòng" là **sai**; đo được **1.621 dòng**, và con số "1.378 dòng / 74 export" trong T4.5 cũng đã lạc hậu.

### #4 — `scratch/` bị gitignore ⇒ smoke test không nằm trong repo

`git ls-files scratch` trả về **rỗng**; `.gitignore:44` chặn cả thư mục `scratch/`.
`docs/SMOKE_TEST.md` sẽ vô dụng với người clone sạch vì không có script để chạy.

→ Cần `git add -f scratch/smoke-study-loop.mjs`, hoặc chuyển sang `tests/e2e/` (gộp vào T4.6).

### #5 — `dist/` có thể bị build lại giữa lúc đo

Trong ~10 phút viết tài liệu P5, `dist/` được build lại **3 lần**, hash entry đổi
`index-BS1G-jC9.js` → `index-C3nPcler.js` → `index-CZuGso3D.js` (cùng 247.804 B).
Mọi số bundle phải ghi kèm **mốc thời gian build**, nếu không sẽ so sai.

---

## 3.6 Bài học (P5)

- **BOM UTF-8 làm hỏng `npm run build`.** Ghi file bằng `Set-Content -Encoding utf8` trên **PowerShell 5.1** sinh BOM
  `EF BB BF`; `vite-plugin-pwa` đọc `package.json` bằng `JSON.parse` nên chết ngay
  (`Unexpected token ... is not valid JSON`) và build hỏng với mọi người. Đã sửa ở **`cc3f65d`** (strip BOM 8 file).
  **Từ nay ghi file text bằng:**
  ```powershell
  [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
  ```
  Shell mặc định trên máy này là PowerShell **5.1.26100.9711** (`$PSVersionTable.PSVersion`), nên `-Encoding utf8`
  = UTF-8 **có** BOM. Sau khi ghi, kiểm tra 3 byte đầu khác `EF BB BF`.
- **`Select-String` của PS 5.1 trả 0 match trên file một dòng rất dài.** Đã gặp với `index.html` (88.981 B):
  `Select-String 'sync'` = **0** nhưng `[regex]::Matches([System.IO.File]::ReadAllText($p), 'sync')` = **34**.
  Grep file lớn bằng .NET regex rồi mới tin kết quả.
- **Số đo phải kèm "đo bằng gì, lúc nào".** Cùng một repo: `!important` trong tài liệu cũ ghi 2.068, đo lại còn **1.920**;
  `dist/` đổi 3 lần trong 10 phút.
- **Đừng đánh `[x]` cho task "gần xong".** T3.2 và T4.3 có commit nhưng DoD đo được vẫn trượt ⇒ giữ `[ ]` + ghi rõ phần
  thiếu. Ngược lại T5.1 có commit mang đúng nhãn nhưng nội dung không phải việc của task ⇒ cũng `[ ]`.

---

## 4. Chia track để chạy song song

| Track | Task | File chạm | Xung đột |
|---|---|---|---|
| **A — Security** | T0.1–T0.7 | `firebase.js`, `io.js`, `gamification.js`, `streakRecovery.js`, `firebase.json` | — |
| **B — Learning** | T1.1–T1.8 | `srs/*`, `queue.js`, `render.js` (nhãn) | **Cấm chạy P3.2/T4.2 cùng lúc** (cùng `render.js`/css) |
| **C — Platform** | T2.1–T2.6, T3.1, T3.5 | `vite.config.js`, `versionCheck.js`, `sound.js`, `public/*` | T3.2/T3.3 sau khi B xong |
| **D — Quality** | T4.1, T4.3–T4.6, T5.* | `index.html`, `state.js`, `tests/*` | T4.4 nên làm **cuối** (format toàn repo) |

Thứ tự an toàn khi 3 người: **A (ngày 1) → B + C (ngày 2–3) → D (ngày 4)**. T4.4 và T5.3 làm sau cùng.

---

## 5. Rủi ro & cách chặn

| # | Rủi ro | Chặn |
|---|---|---|
| R1 | Đổi learning steps làm lệch dữ liệu SRS đã có | Chỉ áp cho thẻ `New` + lần chấm mới; thẻ đang `Mastered` giữ nguyên; ghi rõ trong release note |
| R2 | Bật App Check chặn user dùng webview/trình duyệt cũ | Bật "monitor" 48 h trước khi "enforce", xem log |
| R3 | Xoá CSS "chết" làm vỡ giao diện | Visual diff Playwright trước/sau; xoá theo từng nhóm selector |
| R4 | Bỏ Google Fonts → mất dấu tiếng Việt | Dùng subset `vietnamese` của Lexend, test 6 chuỗi có dấu nặng/hỏi/ngã |
| R5 | `git filter-repo` phá clone của người khác | Thông báo trước, tag backup, chỉ chạy khi repo là cá nhân |
| R6 | Optimizer tự chạy khi đang sửa tham số | Giữ guard `userFsrs7TrainedAt` hiện có; test lại T1.3 |

---

## 6. Cột mốc nghiệm thu

- **M1 (hết P0):** XSS test xanh · CSP không `unsafe-inline` · App Check enforce · key sai không tạo user · liên kết thiết bị kéo đủ dữ liệu.
- **M2 (sản phẩm đúng sư phạm):** thẻ mới phải qua 2 bước mới `Mastered` · interval ≤ 365 ngày · có cap/ngày · leech có hành vi.
- **M3 (offline thật + cập nhật an toàn):** offline reload 3 lần vẫn đủ icon/font · không reload loop · không mất cache.
- **M4 (có lưới an toàn kỹ thuật):** 1 E2E vòng học trong CI · ngân sách bundle được ép · lint sạch.

---

## 7. Mẫu giao việc cho agent (copy-paste)

```
Bối cảnh: PWA học từ vựng vanilla JS + Vite, repo tại <đường dẫn>. Đọc UPGRADE_BACKLOG.md.
Task: <T0.1>
Phạm vi: chỉ sửa các file liệt kê trong task. Không refactor ngoài phạm vi.
Ràng buộc: giữ nguyên hành vi khác; mỗi thay đổi phải kèm test nếu task yêu cầu.
DoD: <dán nguyên mục DoD>
Kiểm chứng: chạy `npm test` và báo cáo kết quả; chụp/ghi lại số đo nếu task yêu cầu.
Báo cáo: file đã sửa, diff tóm tắt, output test, rủi ro còn lại.
```
