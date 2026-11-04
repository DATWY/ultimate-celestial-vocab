# Vòng 5 — Kiểm chứng ca biên của Undo: bản lưu thiếu `lastXPDate`

**Kết luận: ĐÓNG CA BIÊN TRÊN CÁC ĐƯỜNG ĐÃ KIỂM CHỨNG.** Không có đường nào trong ứng dụng đưa được
trạng thái `{ xpToday: 5 }` (thiếu hẳn `lastXPDate`) tới `snapshotReviewStats`. Bản sửa vòng 4 đã
đúng cho ca biên khi dữ liệu đã đi qua khối khởi động: Undo cho **7**, cộng thêm 1 cho **8**. Mã ứng
dụng **không đổi**; phần thêm chỉ là test bảo vệ và tài liệu.

> **Bổ sung vòng 6 (đường preview/restore).** Đường thứ tư từng chỉ được đọc mã —
> `window.__testGamification.previewAllBadges()` → `reset()` → `setGamification(this._backup)` — nay đã
> chạy thật trong trình duyệt (DevTools Protocol trên `vite dev` + `?audit=1`) và có test hồi quy
> trong `npm test`. Kết quả: khoá ngày **còn hiện diện** sau khôi phục, Undo giữ **7**, `+1` cho **8**.
> Chi tiết ở §7.

## 1. Câu hỏi và câu trả lời

Dữ liệu `{ xpToday: 5 }` không có `lastXPDate` là hình dạng bản ghi do **phiên bản cũ** ghi (trước khi
có khoá ngày). Nó **có** tới `loadVocabulary()` y nguyên, nhưng **không** tới được snapshot của lượt
chấm đầu tiên, vì `main.js` chuẩn hóa trên chính object đang sống trước khi có bất kỳ lượt chấm nào:

```js
// src/main.js (sau setupEventListeners, cùng một task đồng bộ)
rolloverDailyStats(g.stats, getLocalDateString(), d?.currentLimit || 0); // ensureStats ⇒ lastXPDate = ''
trackAppOpen(g.stats);
...
displayCard(firstCardIndex);
```

`ensureStats` (`src/features/stat-trackers.js`) đặt `lastXPDate = ''` cho khoá thiếu — **có mặt nhưng
rỗng**, không phải hôm nay. Vì vậy `trackXP` thấy `'' !== hôm nay` ⇒ mở kỳ mới, và `diffReviewStats`
(bản sửa vòng 4) ghi nhận đóng góp của A dù `before === after`.

## 2. Bảng bằng chứng (bốn mốc mỗi đường)

`reports/logic-audit-2026-11-03/round5-boundary-table.txt` — dựng bằng `scratch/probe-round5-table.mjs`.

| Đường vào | Trước snapshot | XP sau Undo A | XP sau `+1` |
|---|---|---|---|
| **IDB cũ `{xpToday:5}` → khối khởi động THẬT** (bản ghi đọc từ IndexedDB đúng là `{"xpToday":5}`) | `hasOwn=true`, `key=""`, `xp=5` | **7**, `key=2026-11-03` | **8** |
| `{xpToday:3}` → khối khởi động thật | `hasOwn=true`, `key=""`, `xp=3` | **7** | **8** |
| `{xpToday:5, lastXPDate:""}` → khối khởi động thật | `hasOwn=true`, `key=""`, `xp=5` | 7 | 8 |
| `{xpToday:5, lastXPDate:hôm qua}` → khối khởi động thật | `hasOwn=true`, `key="2026-11-02"`, `xp=5` | 7 | 8 |
| `mergeProgress(local đã chuẩn hóa, remote thiếu khóa)` | `hasOwn=true`, `key=""`, `xp=5` | (không chấm ở bước này) | — |
| `mergeProgress(remote thiếu khóa, local đã chuẩn hóa)` | `hasOwn=true`, `key=""`, `xp=5` | — | — |
| **ĐỐI CHỨNG** — bỏ khối khởi động (không có trong app) | `hasOwn=false`, `xp=5` | **12** | **13** |
| **ĐỐI CHỨNG** — bỏ khối khởi động, `{xpToday:3}` | `hasOwn=false`, `xp=3` | **10** | **11** |

Hai dòng in đậm ở nửa cuối là ca đối chứng tầng hàm: chúng chứng minh **chính bước chuẩn hóa** là
thứ bảo vệ Undo, và bản sửa vòng 4 xử lý đúng **sang kỳ** (3 → 5 cho 7, không phải "tăng 2" cho 10)
chứ không chỉ đúng khi hai con số tình cờ bằng nhau.

XP tuần cũng đúng ở đường thật: sau A `xpWeekTotal=5`, sau B `12`, sau Undo A **7**.

## 3. Những đường đã kiểm và phần nào chạy thật

| Đường | Cơ chế bảo vệ | Chạy thật / giả lập |
|---|---|---|
| Tải IndexedDB → lượt chấm đầu | `main.js` gọi `rolloverDailyStats`/`trackAppOpen` ⇒ `ensureStats` đặt `lastXPDate=''` trên object sống, trước `displayCard` | **Thật**: `initAppDB`, `saveSettingToDB`, `getSettingFromDB`, `loadVocabulary`, `rolloverDailyStats`, `trackAppOpen`, `trackXP`, `snapshotReviewStats`, `diffReviewStats`, `revertReviewStats`. **Giả lập**: `fake-indexeddb` thay IndexedDB thật, `document`/`CustomEvent`/`localStorage` tối thiểu, đồng hồ ghim 03/11/2026 15:00 |
| Tab khác gửi tiến độ | `mergeProgress` lấy `{ ...remote, ...local }`; bản local đã chuẩn hóa nên thắng ⇒ khoá còn | **Thật**: `mergeProgress` và `state.acceptProgress` (đúng hàm `tab-bus.js:100` và `firebase.js:992` gọi). **Giả lập**: payload BroadcastChannel/Firestore dựng tay, không có Firebase thật |
| Merge cloud | như trên (`syncGamification` → `mergeGamification` → `mergeProgress` → `acceptProgress`) | **Thật**: hàm merge. **Giả lập**: không truy cập Firestore |
| Khôi phục bản sao (preview/backup) | `setGamification(this._backup)` với deep-clone của object đang sống (đã có khoá) | **Chạy thật ở vòng 6**: Chrome + test hồi quy `tests/p15-preview-restore.test.mjs` — §7 |
| Thứ tự khởi động | test đọc `src/main.js`: `rolloverDailyStats`/`trackAppOpen` trước `displayCard`, cùng task đồng bộ sau `setupEventListeners` | Kiểm tra tĩnh trên mã nguồn |

## 4. Test bảo vệ — `tests/p14-legacy-xp-boundary.test.mjs` (8 test)

| Test | Nội dung |
|---|---|
| `IDB cũ {xpToday:5} thiếu lastXPDate — khối khởi động THẬT đặt khóa, Undo cho 7 rồi 8` | Đường thật duy nhất cần IndexedDB: ghi bản ghi cũ, `loadVocabulary()`, khẳng định object tải lên **thiếu** khoá, rồi bốn mốc + Undo + `+1`; kiểm cả `xpWeekTotal` |
| `{xpToday:3} thiếu khóa qua khối khởi động ⇒ 7 rồi 8` | Phân biệt "xử lý sang kỳ" với "chỉ đúng khi bằng số" |
| `phân biệt THIẾU khóa với khóa rỗng "" và khóa = hôm qua` | Ba hình dạng dữ liệu cũ, cùng kết quả 7/8 |
| `ĐỐI CHỨNG: BỎ khối khởi động ⇒ 12 rồi 13` | Ca đối chứng tầng hàm (đường không tồn tại trong app) |
| `ĐỐI CHỨNG: bỏ khối khởi động với {xpToday:3} ⇒ 10 rồi 11` | Cho thấy thiếu chuẩn hóa còn làm **sai bản chất** phép trừ |
| `merge tiến độ từ tab khác (bản cũ thiếu khóa) vẫn giữ khóa của bản local` | Cả hai thứ tự merge; ghi nhận merge **không tự** chuẩn hóa |
| `acceptProgress THẬT với payload tab khác cũ ⇒ khóa hiện diện, Undo cho 7 rồi 8` | Đúng hàm app dùng để áp tiến độ từ tab/cloud |
| `main.js chuẩn hóa g.stats TRƯỚC khi hiển thị thẻ đầu tiên` | Bảo vệ thứ tự khởi động (cửa sổ duy nhất từng thiếu khoá) |

Vì kho IndexedDB của `fake-indexeddb` là toàn cục trong một tiến trình, chỉ **một** test dùng đường
tải thật; các ca còn lại dựng object cùng hình dạng. `node --test` chạy mỗi tệp trong tiến trình
riêng nên không ảnh hưởng các tệp khác.

## 5. Cổng kiểm tra

Mã `src/` **không thay đổi** trong vòng này (chỉ thêm 1 tệp test + tài liệu), nhưng vẫn chạy đủ bộ
cổng để chắc chắn không có trôi dạt:

| Lệnh | Kết quả |
|---|---|
| `npm test` | **593 pass / 593**, 0 fail, 0 skip (591 → 593: +2 test preview/restore ở §7) |
| `npm run lint` | **0 error, 108 warning** (đúng baseline) |
| `npx vite build` | OK — `index-CUG8XM4t.js` 238,32 kB thô |
| `npm run budget` | **4/4 đạt**, entry **78,27/82 kB gzip** (không đổi), còn 3,73 kB |
| `npm run test:e2e` (NEW) | `ok: true`, `failures: []`, `errors: []` |
| `npm run test:e2e` (`SMOKE_LEECH=1`) | `ok: true`, `failures: []`, `errors: []` |
| `version_seq.json` | **`seq 2`** (không đổi) |

## 6. Giới hạn và phần chưa kiểm chứng

1. **Môi trường trình duyệt thật không chạy.** IndexedDB được thay bằng `fake-indexeddb`; DOM/
   `CustomEvent`/`localStorage` là stub tối thiểu. Cùng một đường mã, nhưng không phải Chrome/Firefox
   thật; cũng không có tab thứ hai thật (BroadcastChannel) hay Firestore thật.
2. **Bản ghi `stats: null` (hỏng từ ngoài) — chưa sửa, đã đo hành vi.** Nếu kho chứa
   `{ stats: null }`, sau khởi động `gamification.stats` **vẫn là `null`** (vì `rolloverDailyStats`
   trả về object mới còn `main.js` không gán lại), nên XP của lượt chấm rơi vào object tạm và bị mất.
   Đây là hình dạng **ứng dụng không tự ghi ra** (mọi đường ghi đều ghi object), khác ca biên được
   hỏi, và sửa nó sẽ đổi ngữ nghĩa `ensureStats` trên toàn bộ tracker — ngoài phạm vi vòng này.
   Ghi lại để vòng sau quyết định riêng.
3. ~~Khôi phục bản sao (`setGamification(this._backup)`) chỉ được đọc mã~~ — **đã kiểm chứng ở vòng 6**
   (§7): chạy trong Chrome thật trên `vite dev` + `?audit=1`, cộng test hồi quy trong `npm test`.
4. **Người dùng nâng cấp giữa phiên**: một tab cũ (chưa reload) vẫn chạy mã trước bản vá có thể ghi
   đè tiến độ. Đường này dựa vào `mergeProgress` (local thắng cho `stats`) — đã test ở tầng hàm, chưa
   test với hai tiến trình trình duyệt thật.
5. `scratch/probe-*.mjs` chỉ là script bằng chứng cục bộ, không nằm trong `npm test`.

## 7. Bổ sung vòng 6 — đường preview/restore (`window.__testGamification`)

### 7.1 Đây là thao tác nào, và nằm ở đâu trong sản phẩm

| Mục | Kết quả lần theo mã |
|---|---|
| Nơi định nghĩa | `src/features/gamification.js:1271-1435`, khối `window.__testGamification` |
| Điều kiện tồn tại | **Chỉ chế độ phát triển**: `import.meta.env?.DEV && ?audit=1` (dòng 1272). Bundle production không có API này; audit mode còn dùng **DB tách biệt** `celestial-vocab-audit-idb` (`src/core/idb.js:9`), nên không chạm dữ liệu thật |
| Thao tác sản phẩm | Lệnh console của lập trình viên/kiểm định để **xem trước huy hiệu** (`previewAllBadges`), **xem trước bậc rank** (`previewRank`), slideshow rank (`previewAllRanks`), và **khôi phục** (`reset`). Không có nút UI nào gọi tới |
| Nơi tạo `_backup` | `previewAllBadges`: dòng 1294, **luôn** ghi đè bằng `JSON.parse(JSON.stringify(state.gamification))`. `previewRank`: dòng 1382-1384, chỉ tạo khi `_backup` đang null (để chuỗi preview không đè bản gốc) |
| Nơi vào preview | Cùng hai hàm trên; bật cờ bằng `s.setPreviewMode(true)` **trước** khi sao lưu |
| Nơi khôi phục | `reset()` dòng 1412-1431: `setPreviewMode(false)` → `setGamification(this._backup)` → `_backup = null` |
| Dữ liệu dự kiến bị loại khi thoát | Toàn bộ dữ liệu giả bơm vào RAM: `stats` (xpToday 5000, monthly 100, typing 1000, …), `unlockedBadges` thêm từ `SPECIAL_BADGES`, và với `previewRank` là `currentLevel`/`userXP`. Preview **không lưu** IDB/Firebase (không gọi `saveGamification`; `setPreviewMode(true)` chặn đường lưu) |
| Trước hay sau chuẩn hóa? | Đường dùng bình thường là **sau**: API chỉ có sau khi module nạp, và khối khởi động của `main.js` chạy đồng bộ ngay sau `loadVocabulary()`. Nếu gọi từ console **trước** khối đó (chỉ trong DEV+audit) thì `_backup` sẽ thiếu khoá — xem 7.4 |

### 7.2 Chạy thật trong trình duyệt (lượt này)

`scratch/probe-preview-restore.mjs` → `reports/logic-audit-2026-11-03/round6-preview-probe.json`.
Môi trường: `vite dev` (DEV=true) + Chrome headless qua DevTools Protocol + `?audit=1` (DB audit).

| Mốc | `Object.hasOwn(stats,'lastXPDate')` | `lastXPDate` | `xpToday` | `xpWeekTotal` | `userXP` | previewMode |
|---|---|---|---|---|---|---|
| Bản ghi trong IDB (cũ) | **false** | `undefined` | 5 | — | 0 | — |
| Trước preview (sau khởi động) | true | `""` | 5 | 0 | 0 | false |
| Trong preview (dữ liệu giả) | true | `""` | **5000** | 0 | 0 | **true** |
| **Sau khôi phục (trước lượt chấm)** | **true** | **`""`** | **5** | 0 | 0 | **false** |
| Sau B (A +5 rồi B +7) | true | `2026-11-03` | 12 | 12 | — | — |
| **Sau Undo A** | true | `2026-11-03` | **7** | **7** | — | — |
| **Sau `+1`** | true | `2026-11-03` | **8** | **8** | — | — |
| Bản ghi IDB sau khi thoát preview | — | — | **5** (không có 5000) | — | — | — |

Chạy thật: `window.__testGamification.previewAllBadges()` và `.reset()` (API của ứng dụng), `state.setGamification`,
`setPreviewMode`/`isPreviewMode`, `rolloverDailyStats`, `trackAppOpen`, `trackXP`, `snapshotReviewStats`,
`diffReviewStats`, `revertReviewStats`, IndexedDB thật của Chrome. Fixture: bản ghi `gamification` viết thẳng
vào kho audit (`{ userXP: 0, totalReviews: 0, stats: { xpToday: 5 } }`); đồng hồ dùng `Date.now()` thật của máy.

### 7.3 Test hồi quy trong `npm test` — `tests/p15-preview-restore.test.mjs` (2 test)

Tám test trước **không** đi qua preview/restore, nên thêm tệp này. Test trích **nguyên văn** object
`window.__testGamification` từ `src/features/gamification.js` và chỉ thay cơ chế nạp module
(`import('../core/state.js')` → hàm bơm module thật) vì `new Function` không có dynamic import; thân
`previewAllBadges`/`reset` không bị viết lại.

| Test | Khẳng định |
|---|---|
| `vào/thoát preview qua chính API ứng dụng vẫn giữ khoá ngày, Undo cho 7 rồi 8` | trước preview `hasOwn=true, key=""`, `xp=5`; trong preview `xp=5000` + `previewMode=true` và `_backup` vẫn là deep-clone giữ `xp=5`; sau `reset()` `hasOwn=true, key="", xp=5`, `previewMode=false`, không còn `typingTotalCorrect` của dữ liệu giả; sau đó A/B/Undo/`+1` cho **7** rồi **8** |
| `preview giả lập rank cũng đi qua cùng reset() và giữ khoá ngày` | `previewRank(50)` đổi `currentLevel`/`userXP` trong RAM; `reset()` trả `currentLevel=1`, `userXP=0`, khoá ngày còn, `xp=5` |

**Kiểm tra đột biến (mutation check):** tạm đổi `s.setGamification(this._backup)` thành bản chỉ chép
`xpToday` (làm rơi khoá), cả hai test **fail** đúng chỗ (`sau khôi phục: khoá ngày còn hiện diện`);
khôi phục mã thì xanh lại. Vậy test bắt được hồi quy thật, không phải test rỗng.

### 7.4 Giới hạn của đường này

1. **Chỉ tồn tại ở chế độ phát triển** (`DEV` + `?audit=1`, DB audit riêng). Bundle production không có
   API; người dùng thật không đi qua đường này, nên kể cả sai cũng không chạm dữ liệu thật.
2. **Cửa sổ lý thuyết trước khối khởi động**: nếu gọi `previewAllBadges()` từ console **trước** khi
   `main.js` chạy `rolloverDailyStats`, `_backup` là object chưa chuẩn hóa (thiếu khoá) và `reset()` sẽ
   đưa trạng thái đó trở lại. Đây là thao tác tay trong DEV+audit, cùng hình dạng với "ca đối chứng
   tầng hàm" ở §2, **không** phải đường sản phẩm; chưa đo bằng test tự động vì cần canh đúng thời điểm
   giữa hai bước khởi động.
3. `previewAllBadges` **luôn** ghi đè `_backup`: gọi nó hai lần liên tiếp thì `reset()` trả về bộ dữ
   liệu của lần gọi thứ hai. Không ảnh hưởng ca này (`_backup` vẫn là deep-clone có khoá) nhưng là
   hành vi cần biết khi dùng công cụ.
