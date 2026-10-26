# PERF — đo thời gian khởi động app (T3.4)

Trạng thái: **đã đo thật** (2026-10-26), **chưa tối ưu gì** — task này chỉ dựng thước đo + baseline.
Không sửa một dòng nào trong `src/`; mọi số dưới đây lấy từ `dist/` do `npm run build` sinh ra.

- Harness: `tools/measure_startup.mjs` (mới — CDP + Chrome headless + server tĩnh phục vụ `dist/`).
- Mốc "app-ready" là **đúng marker mà smoke E2E đang chờ**: `document.body.classList.add('app-ready')`
  ở `src/main.js:171`, smoke chờ `body.app-ready` ở `tests/e2e/study-loop.mjs:106`.
- Ngưỡng liên quan trong backlog: **T3.4** (`UPGRADE_BACKLOG.md:261-265`) và **T3.5** (`:267-271`) — xem §6.

---

## 1. Vì sao phải đo lại: con số "~1,24 s" trong backlog KHÔNG phải app-ready

`UPGRADE_BACKLOG.md:264` ghi DoD của T3.4 là *"app-ready từ ~1,24 s → ≤ 900 ms trên máy CI (3.000 thẻ)"*.
Con số `1,24 s` đó đến từ `tools/perf_deep_audit.mjs`, và cách nó đo bị lệch:

```js
// tools/perf_deep_audit.mjs:205-221
await client.send('Page.navigate', { url: baseUrl + TARGET_PATH });
await sleep(1200);                                   // ← ngủ 1.200 ms TRƯỚC khi bắt đầu đo
const readyAt = await client.eval(`
  const t0 = performance.now();                      // ← t0 đã ≈ 1.200 ms sau navigationStart
  await new Promise(res => { /* poll body.app-ready */ });
  return { readyMs: performance.now(), ... };        // ← trả về "thời điểm bây giờ", không phải lúc ready
`);
```

`performance.now()` tính từ `navigationStart` của document hiện tại, nên `readyMs` **luôn ≥ 1.200 ms**
bất kể app sẵn sàng lúc nào: app ready ở 200 ms thì harness vẫn in ~1.24 s (1.200 ms ngủ + 1 vòng CDP).
Nói cách khác `1.24 s` là **thời lượng `sleep(1200)` cộng overhead**, không phải thời gian khởi động.

→ Hệ quả 1: không thể nói "app-ready giảm từ 1,24 s" — chưa từng có phép đo app-ready đúng trước hôm nay.
→ Hệ quả 2: ngưỡng **≤ 900 ms** vẫn dùng được làm ngưỡng tuyệt đối, chỉ đừng so với `1,24 s`.

Harness mới đo **đúng thời điểm**, không poll sau khi ngủ:

| Cơ chế | Cách làm | Cross-check |
|---|---|---|
| app-ready | patch `DOMTokenList.prototype.add`, ghi `performance.now()` **ngay trong lời gọi** `body.classList.add('app-ready')` | `MutationObserver` độc lập (luôn trễ hơn 0,5–2,1 ms — đúng như lý thuyết microtask) |
| FCP | `PerformanceObserver({type:'paint', buffered:true})` + fallback `performance.getEntriesByType('paint')` | 2 nguồn phải bằng nhau (mọi lần chạy đều khớp) |
| long task | `PerformanceObserver({type:'longtask', buffered:true})`, lấy các task có `startTime < 2000` | báo cả số task + tổng thời gian + thời điểm kết thúc của task cuối |

---

## 2. Cách chạy

```bash
npm run build                          # harness KHÔNG tự build; dist phải mới
node tools/measure_startup.mjs         # 5 lần × 3 series (mặc định), 3000 thẻ cho series C
node tools/measure_startup.mjs --json  # in thêm JSON thô (để lưu/so sánh sau này)
node tools/measure_startup.mjs --series cold,warm --runs 5 --cards 0
```

Cờ: `--runs N` · `--cards N` · `--series cold,warm,cards` · `--url "/?theme=dark"` · `--port 0` · `--json`.
Cổng mặc định `0` = **OS cấp cổng trống** (xem §7.3 — máy này có process khác giữ cổng cố định).

Ba series = ba điều kiện:

| Series | Điều kiện | Cách làm |
|---|---|---|
| **A `cold`** | profile Chrome **mới** cho từng lần: HTTP cache lạnh, SW chưa cài | 5 lần × (Chrome mới → 1 navigation → đo → kill) |
| **B `warm`** | **cùng 1 profile**: cache + SW ấm | 1 navigation warm-up (không tính), rồi 5 navigation đo (lần 2..6) |
| **C `cards`** | như B + **3.000 thẻ** trong IndexedDB (đúng điều kiện DoD T3.4) | warm-up → gieo 3000 thẻ vào `celestial-vocab-idb`/`vocabulary` → 5 navigation đo |

Mỗi lần đo: `Page.navigate` → chờ `window.__startup` của **document mới** (theo marker query) → chờ `app-ready`
(tối đa 15 s) → đợi hết 2,25 s để long task trong cửa sổ 2 s được giao → đọc toàn bộ metrics.
Một lần đo bị đánh `FATAL` nếu trang không tải đúng entry JS của `dist/` (chống đo nhầm app — §7.3) hoặc
không thấy document mới.

Server tĩnh trả header cache **giống `firebase.json:29-83`** (`/assets/**` + `/fonts/**` immutable 1 năm,
`/version.json` no-store, `/index.html` + `/` no-cache) để "cache ấm" phản ánh production.

---

## 3. Môi trường đo

| Thông số | Giá trị |
|---|---|
| Ngày | 2026-10-26, 12:54–12:57 (Asia/Saigon) |
| Máy | Intel Core Ultra 7 155H × 22 thread · 15,5 GB RAM · Windows (win32 x64) |
| Node | v26.1.0 (WebSocket toàn cục) |
| Chrome | `C:\Program Files\Google\Chrome\Application\chrome.exe`, **Chrome/155.0.8059.85** |
| Chế độ | `--headless=new`, `--no-sandbox`, `--hide-scrollbars`, `--mute-audio`, `--disable-extensions`, `--disable-background-networking` |
| Viewport | `--window-size=1440,900` → `innerWidth × innerHeight` = **1414 × 744**, `devicePixelRatio = 1` |
| Server | http tĩnh từ `dist/`, **localhost** (RTT ≈ 0), cổng OS cấp |
| URL | `http://localhost:<port>/?theme=dark` |
| `dist/` chính | `index.html` 91.787 B · entry **`/assets/index-C9CY7lRE.js`** · mtime `2026-10-26T05:52:51Z` · sha256 `03087d21…e0ca` (không đổi trong suốt lượt đo) |
| Git | HEAD **`6440182`** + working tree **bẩn** (agent khác đang sửa `index.html`, `src/core/{queue,state,firebase,version}.js`, `src/events.js`, `src/ui/render.js`) |

> **Cảnh báo trung thực về môi trường:** trong lúc đo, một agent khác **build lại `dist/` nhiều lần**
> (entry đổi `index-CwjdIOHw.js` → `index-C9CY7lRE.js` → `index-CDnD4OEW.js`). Vì vậy số đo mang
> build của *working tree đang dở*, không phải build sạch từ `6440182`, và có nhiễu do CPU/disk bị tranh.
> Bảng chính (§4) chỉ lấy lượt có `dist` **không đổi từ đầu đến cuối** (harness kiểm bằng sha256 và in cảnh báo).

---

## 4. Kết quả (lượt chính: 5 lần × 3 chỉ số × 3 điều kiện)

Đơn vị: **ms**, đo từ `navigationStart` của document. `—` = không có long task nào > 50 ms trong 2 s đầu
(không phải "không đo được").

### A — profile mới mỗi lần (cache lạnh, SW chưa cài), 0 thẻ

| # | app-ready | FCP | long task cuối (≤2 s) | số long task | request | byte tải |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 349,5 | 940 | 311,5 | 2 | 21 | 1.451.400 |
| 2 | 319,0 | 780 | 226,9 | 1 | 21 | 1.451.400 |
| 3 | 283,6 | 776 | 181,7 | 1 | 21 | 1.451.400 |
| 4 | 255,0 | 708 | 161,8 | 1 | 21 | 1.451.400 |
| 5 | 271,2 | 748 | 198,7 | 1 | 21 | 1.451.400 |
| **min** | **255,0** | **708** | **161,8** | 1 | 21 | |
| **median** | **283,6** | **776** | **198,7** | 1 | 21 | |
| **max** | **349,5** | **940** | **311,5** | 2 | 21 | |

### B — nạp lại trên cùng profile (cache + SW ấm), 0 thẻ

| # | app-ready | FCP | long task cuối (≤2 s) | số long task | request | byte tải |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 68,0 | 88 | — | 0 | 17 | 392 |
| 2 | 68,9 | 112 | — | 0 | 17 | 392 |
| 3 | 86,2 | 88 | — | 0 | 17 | 392 |
| 4 | 59,8 | 68 | — | 0 | 17 | 392 |
| 5 | 91,7 | 92 | — | 0 | 17 | 392 |
| **min** | **59,8** | **68** | — | 0 | 17 | |
| **median** | **68,9** | **88** | — | 0 | 17 | |
| **max** | **91,7** | **112** | — | 0 | 17 | |

### C — cùng profile + **3.000 thẻ** (điều kiện DoD T3.4)

| # | app-ready | FCP | long task cuối (≤2 s) | số long task | request | byte tải |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 110,5 | 76 | — | 0 | 20 | 392 |
| 2 | 83,2 | 64 | — | 0 | 19 | 392 |
| 3 | 124,8 | 64 | — | 0 | 18 | 392 |
| 4 | 193,8 | 96 | — | 0 | 18 | 392 |
| 5 | 153,3 | 72 | — | 0 | 18 | 392 |
| **min** | **83,2** | **64** | — | 0 | 18 | |
| **median** | **124,8** | **72** | — | 0 | 18 | |
| **max** | **193,8** | **96** | — | 0 | 20 | |

Trong C, `card = seedword1002` → app đã render thẻ thật từ 3000 thẻ đã gieo (không phải màn trống).
Lượt đo C có 0 lỗi console, `SW controller = true` ở cả 5 lần.

### 4.1. Lượt lặp (kiểm độ ổn định) — build kế tiếp `index-CDnD4OEW.js`

| Series | app-ready min/median/max | FCP min/median/max | long task cuối min/median/max |
|---|---|---|---|
| A cold | 218,6 / **229,4** / 876,3 | 484 / **620** / 656 | 132,9 / **147,9** / 179,8 |
| B warm | 62,4 / **78,9** / 93,0 | 64 / **68** / 108 | — (0 task) |
| C 3000 thẻ | 127,3 / **137,5** / 150,8 | 68 / **88** / 104 | — (0 task) |

Hai build khác nhau (và máy có tải khác nhau) cho median lệch **10–30 %**: A app-ready 283,6 → 229,4;
A FCP 776 → 620; B app-ready 68,9 → 78,9; C app-ready 124,8 → 137,5.
→ Chênh lệch < ~30 % giữa các lần chạy là **nhiễu**, đừng đọc thành hồi quy. Chỉ tin median của cùng một
build, và luôn so cùng series.

---

## 5. Lạnh vs ấm: khác nhau cái gì

| Chỉ số (median) | A cold | B warm | Chênh |
|---|---:|---:|---|
| app-ready | 283,6 ms | 68,9 ms | **nhanh hơn 4,1×** khi ấm |
| FCP | 776 ms | 88 ms | nhanh hơn 8,8× (nhưng xem §5.1) |
| long task > 50 ms trong 2 s | 1 task (tổng 78–143 ms) | **0** | long task chỉ xuất hiện ở lần đầu |
| request trong cửa sổ đo | 21 | 17 | cold tải thêm chunk/font chưa có trong precache |
| byte tải | 1.451.400 B | 392 B | ấm = SW precache + HTTP cache; chỉ `version.json` ra mạng |

Cơ chế: lần đầu, `registerSW.js` cài SW và precache 35 URL (~1,36 MB) **trong lúc** trang đang boot;
lần sau mọi asset lấy từ `workbox-precache-v2` (transfer = 0). `SW controller = true` ở **cả** A và B
(vì `registerType: 'autoUpdate'` ⇒ `clientsClaim`, SW chiếm trang ngay trong lần nạp đầu) — nên đừng
dùng "controller" để phân biệt lạnh/ấm; dùng **byte tải** (1,45 MB vs 392 B).

### 5.1. Bất thường: ở điều kiện lạnh, FCP **chậm hơn** app-ready ~490 ms

Số liệu A: app-ready median 283,6 ms nhưng FCP median 776 ms (chênh **+492 ms**) và FCP **luôn sau
`loadEvent`** (load 182–260 ms). Ở B thì FCP ≈ app-ready + 19 ms; ở C thì FCP **trước** app-ready 53 ms
(khung HTML tĩnh vẽ xong trước, thẻ được render sau).

Giả thuyết 1 — "mạng/JS chậm": **loại**. Mọi request xong ở `loadEvent` 182–260 ms, main thread rảnh sau
long task cuối (161–311 ms), mà vẫn chưa có paint nào.

Giả thuyết 2 — "tiến trình Chrome mới chưa present được frame đầu (GPU/compositor init)": **khớp**.
Bằng chứng (probe tạm, ngoài repo, cùng server + cùng `dist/`, 1 browser):

| Navigation | Điều kiện | app-ready | FCP | byte tải |
|---|---|---:|---:|---:|
| nav1 | browser mới, cache lạnh, chưa có SW | 365 | **788** | 1.451.400 |
| nav2 | **cùng browser**, đã `Network.clearBrowserCache` + unregister SW + xoá CacheStorage | 257 | **276** | 932.943 |
| nav3 | cùng browser, ấm lại | 82 | 96 | 85.190 |

Cùng một browser, cache lạnh lại mà FCP chỉ 276 ms (dù vẫn tải 933 kB) ⇒ **cái làm FCP lạnh chậm ~500 ms
không phải cache/SW/mạng, mà là frame đầu tiên của một tiến trình Chrome mới** (headless dùng SwiftShader).
Hệ quả khi đọc số: FCP của series A bị "nhiễm" ~0,5 s chi phí khởi động trình duyệt, **không phải chi phí
của app**. Muốn so FCP của app thì so B ↔ C, hoặc thêm `--warmup` cho A (chưa làm).

Hệ quả sản phẩm (đáng lưu ý): ở **lần truy cập đầu**, app báo `app-ready` ở ~250–350 ms nhưng người dùng
chỉ thấy nội dung ở ~700–940 ms trên máy này. `app-ready` **không** đồng nghĩa "đã nhìn thấy gì đó".

---

## 6. Kết luận trung thực (đối chiếu mục tiêu trong backlog)

**Mục tiêu có trong backlog** (`UPGRADE_BACKLOG.md:261-265`, T3.4):
> **DoD:** app-ready từ ~1,24 s → **≤ 900 ms** trên máy CI (3.000 thẻ).

| Câu hỏi | Trả lời |
|---|---|
| Có đo được app-ready thật không? | **Có** — 3 chỉ số × 5 lần × 3 điều kiện, số ở §4. |
| Có đạt ≤ 900 ms (3.000 thẻ) không? | **Đạt trên máy này**: series C median **124,8 ms**, max **193,8 ms** (lượt lặp: 137,5 / 150,8). Kể cả series A (0 thẻ, cold) max 349,5 ms vẫn dưới 900 ms. |
| Vậy có được coi là "xong T3.4" không? | **Chưa.** (a) Đây là **máy dev 22 thread**, không phải "máy CI" như DoD ghi; (b) `dist` đo được build từ working tree **bẩn** của agent khác, không phải `6440182` sạch; (c) T3.4 còn phần *hành vi* (render thẻ trước, `buildReviewQueue()` vào idle…) — task này **không** sửa `src/`, nên không chứng minh được "đã giảm việc trên critical path". |
| 1,24 s → nay bao nhiêu? | **Không so được** — 1,24 s là artifact của `sleep(1200)` (§1). Con số đúng để so về sau là baseline ở §4, không phải 1,24 s. |
| Có ngưỡng cho FCP / long task chưa? | **Chưa có.** Đây là baseline đầu tiên: FCP 776 ms (cold, gồm ~0,5 s khởi động Chrome) / 88 ms (ấm); long task 1 cái (78–143 ms tổng) ở lần đầu, 0 ở lần sau. |

**Phát hiện phụ về ngân sách:** T3.5 (`UPGRADE_BACKLOG.md:269`) ghi ngân sách *"app-ready > 1.000 ms
(headless)"* phải làm CI fail, nhưng `tools/bundle_budget.mjs` **không** chứa bất kỳ tham chiếu nào tới
`app-ready`/Chrome/CDP (`Select-String tools/bundle_budget.mjs -Pattern "app-ready|Chrome|CDP"` → 0 kết quả).
⇒ Ngân sách app-ready trong CI **hiện không được thực thi**; harness này là nguồn số liệu sẵn sàng để nối vào
bước CI đó (không sửa trong task này vì `package.json`/`.github/**` ngoài phạm vi được phép).

---

## 7. Bất thường đã gặp + bằng chứng

### 7.1. `dist/` bị build đè **giữa lúc đo** → một series bị vô hiệu
Lượt đo đầu (12:51) có series C `FATAL` cả 5 lần: `trang không tải entry index-CwjdIOHw.js`.
Nguyên nhân: agent khác build lại `dist/` lúc 12:52:51 (sha256 `index.html` đổi
`4718F322…F810` → `03087D21…E0CA` trong đúng 67 s của lượt đo) ⇒ các navigation sau đó phục vụ entry mới.
Đây là **guard hoạt động đúng** (không lấy số của app/build khác). Harness nay in thêm cảnh báo nếu
sha256 của `dist/index.html` đổi giữa đầu và cuối lượt đo.

### 7.2. Nhiễu do máy bận (outlier)
- Lượt 1, A#5: app-ready **594,1 ms** (trong khi 4 lần kia 177–236 ms).
- Lượt 3, A#5: app-ready **876,3 ms**, `domContentLoaded` 138 ms, `load` 168 ms ⇒ **~700 ms trống sau khi
  trang đã tải xong**, main thread không có long task tương ứng ⇒ nghẽn ngoài trang (build/IO của agent khác).
- Lượt 3, warm-up của series C: **781 ms** (cùng lý do).
→ Vì vậy báo cáo dùng **median**, và luôn kèm min/max; đừng dùng max làm chỉ số chính.

### 7.3. Bẫy cổng: 2 process có thể cùng "nghe" một cổng trên Windows
Lần chạy thử đầu tiên (cổng cứng 5210/5211) đo **nhầm một app khác** ("TOEIC OMEGA") — `document.title`
và entry JS không khớp `dist/`, `body.app-ready` không bao giờ xuất hiện, nhưng script vẫn "đo" ra
FCP 112 ms / 0 long task. Nguyên nhân: máy này đang có process node khác giữ 5210/5211 và Windows cho
bind trùng cổng. Đã sửa: harness bind **cổng 0** (OS cấp) và **kiểm tra entry JS của `dist/` có mặt trong
`performance.getEntriesByType('resource')`**; không khớp ⇒ `FATAL`, không dùng số.
(Ghi chú cho smoke E2E: nó vẫn dùng cổng cứng **5199** — nếu cổng đó bị chiếm, smoke sẽ fail ở bước chờ
`app-ready` kèm `diagnostics`, chứ không âm thầm PASS. Không sửa vì phải giữ nguyên hành vi.)

### 7.4. `--window-size=1440,900` nhưng viewport thật là 1414 × 744
Headless mới vẫn trừ phần viền/của sổ. Mọi số trong tài liệu này ứng với **1414 × 744 @ DPR 1**;
so sánh với nguồn khác phải cùng viewport.

---

## 8. Những gì **KHÔNG** đo được (không có số, không suy đoán)

| Không đo | Vì sao |
|---|---|
| **Cold profile + 3.000 thẻ** | Muốn có 3000 thẻ phải nạp trang 1 lần để tạo DB rồi gieo ⇒ profile không còn "lạnh" nữa. Điều kiện này **về mặt định nghĩa** không tồn tại; gần nhất là series A (0 thẻ, cold) + series C (3000 thẻ, ấm). |
| Số trên **máy CI** | Không có runner CI ở đây; máy này 22 thread. DoD ghi "máy CI" nên kết luận §6 chỉ có giá trị tham khảo. |
| Mạng thật (3G/4G, RTT ≠ 0) | Server là localhost, RTT ≈ 0. Không suy ra được hành vi trên mạng thật từ số này. |
| GPU thật | Headless dùng SwiftShader; số FCP phụ thuộc phần mềm dựng hình. |
| "Dùng được" ở nghĩa tương tác (TTI, INP, độ trễ lật thẻ/gõ phím) | Chỉ đo tới mốc `app-ready` + FCP; không đo input latency. |
| LCP, CLS | Không thuộc 3 chỉ số được yêu cầu; chưa đo. |
| Ai gây long task | Chrome chỉ trả `startTime`/`duration`, không trả attribution cho main-frame task. Suy đoán "parse+execute entry 241 kB" là **giả thuyết**, không phải số đo. |
| Long task sau 2 s | Cửa sổ đo cố định 2 s (theo yêu cầu T3.4); các task idle 4 s/6 s (`src/main.js:178,197`) nằm ngoài. |

---

## 9. Cách tái lập & lưu ý

```bash
npm run build                                  # dist phải mới; script KHÔNG tự build
node tools/measure_startup.mjs --json | Tee-Object -FilePath perf-startup.json
git checkout -- src/core/version.js public/version.json    # build có tăng version
```

- Chạy khi **không ai build** song song, nếu không sẽ gặp cảnh báo "dist ĐỔI giữa lúc đo" (§7.1).
- So sánh sau này: giữ nguyên `--runs 5`, `--url`, `--cards`, viewport; so **median của cùng series**.
- Cần Chrome; mặc định `C:\Program Files\Google\Chrome\Application\chrome.exe`, override bằng `CHROME_PATH`.
- Chạy từ cwd bất kỳ (gốc repo suy ra từ vị trí file), nhưng `dist/` phải nằm ở gốc repo.
