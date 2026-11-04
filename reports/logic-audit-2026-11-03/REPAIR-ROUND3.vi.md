# Báo cáo sửa lỗi vòng 3 — Recheck sau vòng 2

Phạm vi: 3 lỗi còn mở. Mỗi ca đều được **tái hiện trên bản trước khi sửa**, ghi lại kết quả, rồi chạy
lại **đúng dữ liệu đó** sau khi sửa. Không reset workspace, không xoá dữ liệu thật, không commit/push,
không nâng ngưỡng bundle, không đổi version.

Hai phần đã đạt nghiệm thu ở vòng 2 (gradient optimizer, loại thẻ tạm ngưng khỏi phiên luyện gõ) được
giữ nguyên hành vi; phần optimizer chỉ được chỉnh đúng chỗ liên quan tới **bằng chứng lịch sử**.

## 0. Cổng kiểm tra (số đo thật)

| Lệnh | Trước vòng 3 | Sau vòng 3 |
|---|---|---|
| `npm run lint` | 0 error, 108 warning | **0 error, 108 warning** |
| `npm test` | 541 pass | **570 pass / 570**, 0 fail, 0 skip |
| `npx vite build` | OK | OK |
| `npm run budget` | entry 77,81/82 kB | **entry 78,22 kB (còn 3,78 kB)**, 4/4 đạt |
| `npm run test:e2e` (NEW) | ok | **ok: true**, failures/errors rỗng |
| `npm run test:e2e` (`SMOKE_LEECH=1`) | ok | **ok: true**, failures/errors rỗng |
| `version_seq.json` | seq 2 | **seq 2** (dùng Vite trực tiếp) |
| `scratch/repro-round3.mjs` | **2/17 tiêu chí đo được** | **19/19 tiêu chí đạt** (exit 0) |

Bằng chứng trước/sau của script tái hiện: `round3-before.json` và `round3-after.json` trong cùng thư mục.

Chi tiết theo ca (số tiêu chí đạt / số tiêu chí đo):

| Ca | Trước | Sau |
|---|---|---|
| 1a – ghi sai bằng chứng | 0/4 | 4/4 |
| 1b – dùng sai bằng chứng | 0/4 | 5/5 (thêm tiêu chí "worker apply") |
| 2 – XP theo kỳ | 1/4 (chỉ `xpWeekTotal=57` đúng) | 4/4 |
| 3 – ngân sách `due` | 1/5 (chỉ `isNaturallyDue` đúng) | 6/6 (thêm ca 199/200) |

---

## 1. [P1] Trainer xác minh nhầm lượt đầu và áp dụng weights từ lịch sử bị cắt

### 1a. Ghi sai bằng chứng

**Đầu vào (tái hiện).** Thẻ `Mastered`, `srsInterval=15`, `srsDueDate=now`, **thiếu** `reps` và
`lastReviewDate`.

**Trước khi sửa.**
```
logElapsed: 15
logFirst:   true          ← sai
historyComplete: true     ← trainer tin chuỗi này bắt đầu từ thẻ New
verifiedChains: 1
```
**Nguyên nhân.** `src/core/srs/index.js` tính `first` chỉ từ hai trường `reps`/`lastReviewDate`
(`!(reps>0) && !(lastReviewDate>0)`). Nhưng chính engine **đã suy ra** thời gian đã trôi từ
`srsDueDate − srsInterval` (`actualDaysElapsed = 15`) — tức là nó biết thẻ có lịch sử, mà vẫn ghi
`first = true`. Thiếu hai trường không phải bằng chứng "chưa từng ôn".

**Đã sửa.** Bằng chứng lượt đầu nay đòi **cả ba** điều kiện cùng đúng: `srsStatus === 'New'`,
không `reps > 0`, không `lastReviewDate > 0`, và `actualDaysElapsed <= 1e-9`. Thẻ đã học (Mastered/
Learning) hoặc có lịch sử thời gian ⇒ `first = false` (biết chắc **không** phải lượt đầu).
`isFirstReview` (dùng cho nhánh khởi tạo lịch ôn) **không đổi**, nên hành vi lên lịch giữ nguyên.

**Sau khi sửa (cùng dữ liệu).** `logElapsed = 15`, `logFirst = false`, `historyComplete = false`,
`verifiedChains = 0`, `cards = 0` (chuỗi bị loại khỏi replay).

### 1b. Dùng sai bằng chứng

**Đầu vào (tái hiện).** 60 chuỗi × 8 lượt; lượt đầu còn giữ của mỗi chuỗi là `first=false, t=0`.

**Trước khi sửa.**
```
verifiedChains: 0
assumedStartChains: 60
historyComplete: false          ← nhưng vẫn dùng để train
cardsUsedForReplay: 60
improved: true
reason: "validated"             ← worker sẽ ghi weights
```
**Nguyên nhân.** Hai lỗi chồng lên nhau:
1. `prepareTrainingData` gộp ba trạng thái thành hai: `startKnown = first===true || t<=1e-9`. Một
   chuỗi **biết chắc** đã mất lượt đầu (`first=false`) vẫn được "cứu" bằng `t=0` — mà `t=0` chỉ là
   thời gian đã trôi, hai lượt cùng timestamp hay lệch đồng hồ đều cho `t=0`.
2. Nhánh đọc hàng nén gán `first: row[6] === 1`, tức biến "thiếu cột" (log cũ) thành `false` —
   bịa ra một khẳng định mà dữ liệu không hề nói. Cùng lỗi ở `compressLogs`, `buildReviewLogsExport`,
   `addReviewLog` và cả CLI `tools/train_fsrs7.js` (bản CLI còn **bỏ hẳn** cột 6).

**Đã sửa — ba trạng thái xuyên suốt.**
| Nơi | Trạng thái được giữ |
|---|---|
| Engine (`srs/index.js`) | luôn ghi `true`/`false` (engine biết chắc) |
| `state.addReviewLog` | `1` / `0` / **không thêm cột** nếu cờ vắng mặt |
| `compressLogs` | `first===true → 1`, `false → 0`, `undefined →` **không có cột 6** |
| `mergeReviewLogs` | bản **biết** thắng bản chưa biết; hai bên biết mà mâu thuẫn ⇒ chọn `0` (bảo thủ); cả hai chưa biết ⇒ vẫn 6 cột |
| `pruneReviewLogs` | giữ nguyên row (`slice`) — không đổi cột |
| `buildReviewLogsExport` | trường `first` **vắng mặt** (JSON bỏ `undefined`), không ghi `false` |
| `expandReviewLogRows` (**mới**, dùng chung) | đọc ba trạng thái; **CLI `tools/train_fsrs7.js` dùng đúng hàm này** |
| `prepareTrainingData` | `true → startVerified` (đáng tin), `false → startTruncated` (**loại**), thiếu ⇒ phỏng đoán `t=0` cũ, **không đáng tin** |

`historyComplete` = không cắt log **và** mọi chuỗi đều `verified`.

**Đã sửa — quyết định áp dụng ở worker.** Chỉ sửa nhãn không bảo vệ lịch ôn, nên:
- `optimizeParameters` nay huấn luyện **và** kiểm tra trên tập **đáng tin** (`trustedCards`), và cổng
  riêng: `trustedRows ≥ 400`, `trustedTrain ≥ 100`, `trustedValidation ≥ 30`; không đạt ⇒
  `improved:false`, `reason:'insufficient-verified-history'`, giữ nguyên weights.
- CI bootstrap và kiểm tra hai nửa cũng chấm trên **cùng tập đáng tin** (trước đây dùng toàn bộ log).
- Tách quyết định áp dụng thành hàm thuần `resolveOptimizationOutcome()`; `runOptimizer` chỉ gọi
  `setUserFsrs7Params` khi `outcome.apply === true`.
- Thêm thông điệp `optimizerMessage` cho `insufficient-verified-history` (nói rõ cần gì, giữ bộ đang dùng).

**Sau khi sửa (cùng dữ liệu).**
```
assumedStartChains: 0
cardsUsedForReplay: 0
improved: false
reason: "truncated-history"
worker apply: false
```
Và với dữ liệu **trộn**: 4 chuỗi đáng tin + 60 chuỗi bị cắt (512 lượt) ⇒ `insufficient-verified-history`,
`apply:false`; 60 chuỗi đáng tin + 20 chuỗi bị cắt ⇒ phần tin cậy tự đạt ngưỡng, khi đó `apply:true`
nếu cổng thống kê cho qua.

**Test bảo vệ.** `tests/p13-trainer-provenance.test.mjs` (9 test):
- ca 1a đúng dữ liệu (kể cả "thẻ New thật vẫn `first=true`" để không siết oan);
- ca 1b đúng dữ liệu + **quyết định của worker** (`resolveOptimizationOutcome`);
- trộn thiếu/đủ ngưỡng; các nhánh `configuration-changed`/`preview-only`/không cải thiện;
- ba trạng thái qua compress/merge/prune/export; CLI dùng chung `expandReviewLogRows`;
- chuỗi engine → log → trainer cho thẻ legacy.
Cập nhật thêm: `tests/p12-trainer-start-evidence.test.mjs` (kỳ vọng cũ "chuỗi `first=false` vẫn dùng
được ở mức phỏng đoán" nay là **bị loại**), `tests/optimizer-gate.test.mjs` và
`tests/import-and-srs.test.mjs` (fixture chuyển sang log có cờ như dữ liệu hiện tại).

---

## 2. [P2] Undo — XP theo kỳ và hoạt động phát sinh xen giữa

**Đầu vào (tái hiện, `trackXP` thật + đúng đường snapshot/diff/revert của handler).**
1. Hôm qua: 50 XP. 2. Sang ngày mới, lượt A +5 (snapshot đúng luồng chấm). 3. B +7 cùng ngày.
4. Undo riêng A. 5. Cộng thêm 1.

**Trước khi sửa.**
```
sau Undo A: xpToday = 57        (kỳ vọng 7)
            lastXPDate = 2026-11-02   (kỳ vọng 2026-11-03)
+1 XP:      xpToday = 1         (kỳ vọng 8)
```
**Nguyên nhân.** `diffReviewStats` lưu **delta = after − before**. Khi lượt chấm tự sang kỳ mới,
`after=5, before=50` ⇒ delta `−45`. Undo trừ delta đó ⇒ `12 − (−45) = 57`, và `lastXPDate` bị khôi
phục về hôm qua (vì giá trị hiện tại đúng bằng giá trị lượt chấm đã ghi). Lần cộng sau đó lại thấy
"ngày mới" ⇒ reset rồi +1 ⇒ 1. Tức là **chuyển kỳ bị trộn vào phần đóng góp của A**.

**Đã sửa (`src/core/stats-rollback.js`).**
- `counters[key] = { before, after }` (giữ cả hai) và thêm `periodKeys` = giá trị khoá kỳ **sau** lượt
  chấm cho mọi khoá kỳ.
- `counterContribution()`: phần đóng góp = `after − 0` nếu lượt chấm **đã sang kỳ** (khoá kỳ đổi ngay
  trong lượt, hoặc bộ đếm bị reset), ngược lại `after − before`. Nếu kỳ đổi **tiếp sau** lượt chấm
  (`keyNow ≠ keyAfter`) ⇒ bỏ qua hoàn toàn (`null`).
- Khoá kỳ và `xpLastWeek` là **sự thật lịch**, không bao giờ bị kéo lùi (`PERIOD_KEYS`).
- Áp dụng cho `xpToday`, `xpWeekTotal`, `monthlyTotal`, `monthlyCorrect`, `overdueReviewedToday`
  (tuần/tháng cùng nguyên tắc, có test riêng).
- **Combo**: snapshot ghi thêm `comboAfter`; Undo chỉ khôi phục `consecutiveCorrect` khi giá trị hiện
  tại vẫn đúng là thứ lượt chấm để lại (trước đây gán thẳng `comboBefore` nên xoá thay đổi hợp lệ xen giữa).
- **Đường gõ**: `evaluateTyping` không còn cộng `typingTotalCorrect`/`typingFastAnswers` (chúng được
  cộng trong `trackReview`, tức **sau** snapshot). Hai khoá này vào `COUNTER_KEYS`. Các sự kiện **chỉ
  đo thao tác gõ** (`typingLastCharTypo`, `typingTypoStreaks`, `typingShortWordTypo`) **giữ nguyên**
  chính sách cộng ngay lúc đánh giá và được ghi nhận là `unclassified` (không hoàn) — khác biệt có test.

**Sau khi sửa (cùng dữ liệu).** `xpToday = 7`, `lastXPDate = 2026-11-03`, `xpWeekTotal = 57`
(50 của hôm qua + 7 của B — đúng bản chất bộ đếm tuần), sau +1 ⇒ **8**.

**Test bảo vệ.** `tests/p13-undo-periods.test.mjs` (12 test): ca chuẩn ở tầng hàm thuần **và** ở tầng
tích hợp (handler + Undo thật), bảng `counterContribution`, tuần, tháng (`trackReview` thật), rollover
xảy ra sau lượt chấm, combo (bị đổi xen giữa / không bị đổi), gõ: không cộng khi chưa chấm → chấm →
Undo → làm lại không nhân đôi → bị chặn ngân sách thì không tính công → sự kiện chỉ đo thao tác gõ
giữ chính sách riêng. Các ca Easy/Hard, Undo nhiều vòng, cập nhật xen giữa của vòng 2 vẫn xanh
(`tests/p12-undo-stats.test.mjs` 9/9).

---

## 3. [P2] Ngân sách — thẻ `Mastered` thiếu `srsDueDate` đi qua hai quy tắc

**Đầu vào (tái hiện).** `Mastered`, `reps=6`, `srsDueDate=null`, chưa ôn hôm nay, trần tổng 200/200.

**Trước khi sửa.**
```
isNaturallyDue: true        ← queue coi là ĐẾN HẠN
classifyReview: null        ← cửa ghi coi là CRAM (miễn ngân sách)
logsWritten: 1
savesWritten: 1
dueDoneToday: 0
```
**Nguyên nhân.** Hai nguồn quy tắc: `isNaturallyDue` trả `true` ngay khi thiếu `srsDueDate` (để thẻ
legacy từ TSV/đồng bộ cũ không bị "chết" không bao giờ được ôn), còn `classifyReview` lại trả `null`
cho đúng trường hợp đó. Thẻ được mời như một lượt đến hạn nhưng đi qua cửa ghi như một lượt cram.

**Đã sửa.**
- `classifyReview`: `Mastered` + **chưa ôn hôm nay** + (không có `srsDueDate` **hoặc** hẹn trong hôm
  nay) ⇒ `due`. Điều kiện "đã ôn hôm nay" được kiểm **trước** để không tính hai lần.
- `isNaturallyDue`: nhánh `Mastered` nay xét "đã ôn hôm nay" **trước** nhánh thiếu ngày hẹn (trước đây
  thiếu ngày hẹn là trả `true` ngay, nên thẻ vừa ôn xong vẫn bị mời lại).
- Hệ quả: thẻ legacy **vẫn học được khi còn suất** (đúng yêu cầu), nhưng tiêu **một suất `due`** và bị
  chặn khi hết trần — ở cả Flashcard lẫn Quiz (hai chỗ dùng chung `classifyReview`).
- Thẻ ôn sớm (có ngày hẹn tương lai) vẫn theo chính sách cram (`null`, không tiêu suất). Learning giữ
  ngoại lệ cũ.

**Sau khi sửa (cùng dữ liệu).**
```
isNaturallyDue: true, classifyReview: "due"
200/200:  logs=0, saves=0, dueDoneToday=0   (có toast "giới hạn ôn")
199/200:  logs=1, dueDoneToday=1            (lên lịch lại bình thường)
```
**Test bảo vệ.** `tests/p13-budget-due-rule.test.mjs` (8 test): hai quy tắc khớp nhau; đã ôn hôm nay;
ôn sớm/cram; Flashcard 200/200 và 199/200; Learning; Quiz (trích chính `applyQuizReview` từ nguồn)
200/200 bị chặn và 199/200 dùng đúng một suất `due`; và **thẻ đi từ parser TSV** (`Mastered`, cột ngày
hẹn trống ⇒ `srsDueDate = null`) đến cửa ghi review.

---

## 4. Tệp thay đổi (vòng 3)

| Tệp | Thay đổi |
|---|---|
| `src/core/srs/index.js` | Bằng chứng lượt đầu đòi cả trạng thái New + không reps + không lastReviewDate + elapsed = 0 |
| `src/core/srs/training.js` | Ba trạng thái (`startTruncated`); logic đáng tin; cổng `insufficient-verified-history`; train/validate/CI trên tập đáng tin; `trustedChains` trong kết quả; dùng `expandReviewLogRows` |
| `src/core/srs/worker-manager.js` | `resolveOptimizationOutcome()` (quyết định áp dụng, có test); thông điệp `insufficient-verified-history` |
| `src/core/review-log-merge.js` | Ba trạng thái ở `compressLogs`/`mergeReviewLogs`/`buildReviewLogsExport`; `readFirstFlag`, `expandReviewLogRows` (dùng chung với CLI) |
| `src/core/state.js` | `addReviewLog` không bịa `false`; combo chỉ khôi phục khi chưa bị ghi đè (`comboAfter`) |
| `src/core/stats-rollback.js` | Đóng góp tách khỏi chuyển kỳ; `PERIOD_KEYS`/`PERIOD_KEY_OF`/`counterContribution`; `typingTotalCorrect`/`typingFastAnswers` vào COUNTER |
| `src/core/review-policy.js` | `classifyReview` coi thẻ Mastered thiếu ngày hẹn là `due` |
| `src/core/queue.js` | `isNaturallyDue` xét "đã ôn hôm nay" trước nhánh thiếu ngày hẹn |
| `src/features/typing.js` | Bỏ cộng thống kê lúc đánh giá (chuyển sang `trackReview`) |
| `src/features/stat-trackers.js` | `trackReview` cộng `typingTotalCorrect`/`typingFastAnswers` |
| `src/events.js` | Snapshot thêm `comboAfter` |
| `tools/train_fsrs7.js` | Dùng `expandReviewLogRows` (giữ ba trạng thái) thay vì tự map rồi rơi cột |
| `tests/p13-trainer-provenance.test.mjs` **(mới, 9)** | Mục 1 |
| `tests/p13-undo-periods.test.mjs` **(mới, 12)** | Mục 2 |
| `tests/p13-budget-due-rule.test.mjs` **(mới, 8)** | Mục 3 |
| `tests/p12-trainer-start-evidence.test.mjs` | Kỳ vọng cập nhật theo hành vi đúng (`first=false` bị loại; export giữ ba trạng thái) |
| `tests/p12-undo-stats.test.mjs` | Fixture bổ sung `lastWeekKey` (trước đây vô tình gây rollover tuần) |
| `tests/optimizer-gate.test.mjs`, `tests/import-and-srs.test.mjs` | Fixture dùng log có cờ `first` như dữ liệu hiện tại |
| `tests/helpers/review-harness.mjs` | Thêm `typing`; `recordReviewResult` phản chiếu đúng combo của production |
| `README.md` | Số đo cập nhật (570 test, entry 78,22 kB) |

Không đổi: `index.html`, CSS, `vite.config.js`, `tools/bundle_budget.mjs`, `package.json`,
`version_seq.json`, `public/version.json`, `src/core/version.js`, schema IndexedDB, định dạng TSV
(đọc/ghi), giao diện.

---

## 5. Đính chính báo cáo vòng 2 (theo đúng mã hiện tại)

Câu cũ trong `REPAIR-ROUND2.vi.md` §1 — *"bước hỏng không chạm `m1/m2`"* — **không đúng cho mọi
nhánh**. Mã hiện tại (`src/core/srs/training.js`) xử lý bốn kiểu hỏng khác nhau:

| Nhánh hỏng | Moment `m1/m2` | Vị trí |
|---|---|---|
| Gradient không hữu hạn (`badGradient`) | **Không chạm** — vòng lặp moment không chạy, `gradientFailures++`, `backToBest()` | `if (badGradient) { … continue; }` |
| Moment tràn số hoặc candidate không hữu hạn (`stepOk=false`) | **Reset về 0** (`m1.fill(0); m2.fill(0)`) rồi `backToBest()` | `if (!stepOk) { … }` |
| `projectFsrs7Params` trả `null` sau bước | **Reset về 0** + `backToBest()` | `if (!projected) { … }` |
| Bước hợp lệ nhưng loss không hữu hạn | **Giữ nguyên** moment, `rejectedSteps++`, `backToBest()` | `if (Number.isFinite(next)) … else …` |

Điểm bất biến thật sự vẫn đúng: **không có giá trị không hữu hạn nào được dùng để cập nhật tham số**,
và mọi nhánh hỏng đều quay về điểm tốt nhất trước khi tính gradient tiếp. Không sửa optimizer chỉ để
khớp câu chữ.

---

## 6. Tương thích dữ liệu cũ và giới hạn phục hồi

- **Log 6 cột (legacy)**: đọc, nén lại, prune, merge, xuất JSON đều **giữ nguyên "chưa biết"** (không
  bịa `first=false`). Chúng vẫn được replay ở mức **phỏng đoán** (`t=0`) để hiển thị/nhẩm, nhưng
  **không** được dùng để quyết định áp dụng weights.
- **Giới hạn phục hồi**: log legacy đã mất thông tin nguồn gốc thì **không thể** chứng minh điểm bắt
  đầu. Hệ quả có chủ ý: người dùng chỉ có log cũ sẽ **giữ nguyên bộ tham số đang dùng** cho tới khi
  tích đủ chuỗi có cờ (≥400 lượt, ≥100 train, ≥30 validation **trong phần đáng tin**). Đây là đánh
  đổi bảo thủ đã nêu trong yêu cầu; thông điệp trong UI nói rõ còn bao nhiêu thẻ chưa xác minh.
- **Mâu thuẫn cờ giữa hai thiết bị**: chọn `0` (không phải lượt đầu) ⇒ chuỗi bị loại, không được tin nhầm.
- **Thẻ Mastered thiếu `srsDueDate`**: vẫn được mời ôn như trước, nhưng nay tiêu suất `due` — nếu
  người dùng đã hết trần thì thẻ **không** bị ghi SRS (trước đây vẫn ghi). Không xoá/không sửa dữ liệu thẻ.
- **`typingTotalCorrect`/`typingFastAnswers`**: nay chỉ cộng khi lượt chấm **thực sự được ghi**. Câu gõ
  đúng nhưng bị chặn ngân sách (hoặc bỏ dở) không còn được tính công — thay đổi có chủ ý, có test riêng.

---

## 7. Phần chưa kiểm chứng

1. **Không chạy trên dữ liệu thật / hai thiết bị thật**: đồng bộ Firestore chỉ được test ở tầng hàm
   (`mergeReviewLogs` + `normalizeRemoteReviewLogs` logic tương ứng), không chạy với Firebase thật.
2. **Không có test trình duyệt cho luồng gõ**: `evaluateTyping` được gọi thật, sau đó chạy **chính**
   `processSrsFeedback` trích từ nguồn; phần listener DOM (`setupEventListeners`) không được mô phỏng.
   Các test còn lại chạy ở tầng module hoặc trích handler bằng `vm` — chi tiết ghi trong từng tệp.
3. **Worker**: quyết định áp dụng được test qua `resolveOptimizationOutcome` (hàm thật mà
   `runOptimizer` dùng) + kiểm tra chuỗi nối trong mã; **không** khởi động Worker thật trong test Node.
4. **Ngưỡng 400/100/30 cho phần đáng tin** là lựa chọn bảo thủ, chưa được hiệu chuẩn trên dữ liệu thật;
   hệ quả là optimizer có thể **không bao giờ** áp dụng cho người dùng chỉ có log cũ.
5. **Headroom bundle giảm** còn 3,78 kB (78,22/82). Không nâng ngưỡng; vòng sau nên tách chunk thay vì nới.
6. `scratch/repro-round3.mjs` là script tái hiện **cục bộ**, không nằm trong `npm test`; bằng chứng
   trước/sau lưu ở `round3-before.json`, `round3-after.json`. Các script tái hiện cũ
   (`reports/logic-audit-2026-11-03/recheck-reproduce.mjs`) vẫn chỉ là **bằng chứng lịch sử**, không
   còn chạy được trên mã hiện tại và không phải cổng.
