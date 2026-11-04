# Báo cáo sửa lỗi vòng 4

Phạm vi: đúng **hai lỗi** còn mở sau vòng 3. Mỗi lỗi đều được viết regression test **trước**, chạy
trên mã cũ để ghi lại giá trị thực tế, rồi sửa và chạy lại **cùng fixture**. Không reset workspace,
không sửa dữ liệu người dùng, không commit/push, không đổi ngưỡng bundle hay version.

## 0. Cổng kiểm tra

| Lệnh | Baseline vòng 3 | Sau vòng 4 |
|---|---|---|
| `npm run lint` | 0 error, **108 warning** | **0 error, 108 warning** |
| `npm test` | 570 pass | **583 pass / 583**, 0 fail, 0 skip |
| `npx vite build` | OK | OK |
| `npm run budget` | entry **78,22/82 kB** | **entry 78,27 kB (còn 3,73 kB)**, 4/4 đạt |
| `npm run test:e2e` (NEW) | ok | **ok: true**, `failures: []`, `errors: []` |
| `npm run test:e2e` (`SMOKE_LEECH=1`) | ok | **ok: true**, `failures: []`, `errors: []` |
| `version_seq.json` | `seq 2` | **`seq 2`** (dùng Vite trực tiếp) |
| `dist/` | 2.155,16 kB / 42 file | 2.155,39 kB / 42 file |

Bằng chứng số của lỗi 2 (trước/sau): `round4-split-before.txt` và `round4-split-after.txt`.
Test mới: `tests/p14-undo-equal-periods.test.mjs` (8) và `tests/p14-trainer-split.test.mjs` (5).

---

## 1. [P1] Undo bỏ sót XP khi chuyển kỳ mà giá trị trước và sau bằng nhau

### Tình huống đầu vào

Hôm qua 5 XP → sang hôm nay lượt A kiếm 5 XP (`xpToday` 5 → 5, nhưng `lastXPDate` đổi) → lượt B +7
cùng ngày → Undo riêng A → cộng thêm 1 XP.

### Nguyên nhân

`diffReviewStats` (`src/core/stats-rollback.js`) có `if (next === prev) continue;` chạy **trước** khi
xét khoá kỳ. Hai số cùng bằng 5 nhưng thuộc hai ngày khác nhau là hai khoản khác nhau: 5 của hôm qua
đã bị `trackXP` reset, 5 của hôm nay là khoản A vừa cộng. Vì thay đổi bị bỏ qua, snapshot Undo không
có `xpToday` ⇒ `revertReviewStats` không trừ gì ⇒ số của B bị tính lẫn.

### Trước khi sửa (mã vòng 3, cùng fixture)

```
changes.counters.xpToday            : undefined        (kỳ vọng: có, before 5 → after 5)
sau Undo A (qua handler thật)       : xpToday = 12     (kỳ vọng 7)
lastXPDate sau Undo                 : 2026-11-03 (đúng, không đổi)
xpWeekTotal (hai ngày cùng tuần)     : 17 → Undo ⇒ 17   (kỳ vọng 12)
sang TUẦN mới, 5 → 5                : counters.xpWeekTotal undefined (kỳ vọng có)
sang THÁNG mới, 1 → 1               : counters.monthlyTotal undefined (kỳ vọng có)
```

### Đã sửa

Trong `diffReviewStats`: với bộ đếm **có khoá kỳ** (`PERIOD_KEY_OF`: `xpToday`→`lastXPDate`,
`xpWeekTotal`→`lastWeekKey`, `monthlyTotal`/`monthlyCorrect`→`lastMonthlyKey`,
`overdueReviewedToday`→`lastOverdueDate`), nếu khoá kỳ **đổi ngay trong lượt chấm** thì vẫn ghi
nhận `{ before, after }` **kể cả khi `before === after`**. `counterContribution()` đã có sẵn logic
"kỳ đổi ⇒ baseline = 0" nên phần đóng góp của A được tính đúng bằng 5, và `revertReviewStats` trừ
đúng 5. Khi kỳ **giữ nguyên** và số không đổi thì vẫn bỏ qua (không ghi nhận gì) — ca đối chứng.
Khoá kỳ vẫn không bao giờ bị kéo lùi (giữ nguyên quyết định từ vòng 3).

### Sau khi sửa (cùng fixture)

```
changes.counters.xpToday = { before: 5, after: 5 }
sau Undo A: xpToday = 7, lastXPDate = 2026-11-03
+1 XP    : xpToday = 8
tuần (hai ngày cùng tuần): xpWeekTotal 17 → Undo ⇒ 12
tuần mới, 5 → 5: xpWeekTotal 12 → Undo ⇒ 7; lastWeekKey không đổi; xpLastWeek = 5
tháng mới, 1 → 1: monthlyTotal 3 → Undo ⇒ 2; lastMonthlyKey không đổi
ca vòng 3 (50 → A +5 → B +7): vẫn 7 rồi 8
```

### Test bảo vệ — `tests/p14-undo-equal-periods.test.mjs` (8 test)

| Test | Chạy qua đâu |
|---|---|
| `5 XP hôm qua, A +5 (bằng số) hôm nay, B +7, Undo A ⇒ 7 rồi +1 ⇒ 8` | `trackXP` thật + `snapshotReviewStats/diffReviewStats/revertReviewStats` thật |
| `cùng ca, đi qua CHÍNH handler chấm + Undo thật của ứng dụng` | `processSrsFeedback` **trích nguyên văn** từ `src/events.js` + `revertGamificationAfterUndo` trích từ `src/core/state.js` (harness `tests/helpers/review-harness.mjs`), tracker thật |
| `bộ đếm TUẦN cũng đúng khi hai ngày cùng tuần (5 → 10 → 17 → Undo ⇒ 12)` | như trên |
| `sang TUẦN mới với giá trị BẰNG NHAU ⇒ Undo vẫn trừ đúng phần A` | `trackXP` thật (mốc 8 ngày trước) |
| `sang THÁNG mới với giá trị BẰNG NHAU ⇒ Undo vẫn trừ đúng phần A` | `trackReview` thật (reset `lastMonthlyKey`) |
| `cùng kỳ và số không đổi ⇒ không ghi nhận thay đổi` (đối chứng) | hàm thuần |
| `cùng kỳ, số ĐỔI ⇒ vẫn hoàn đúng phần tăng` (chống hồi quy) | `trackXP` thật |
| `R4.1 (vòng 3, chạy lại): 50 → A +5 → B +7 ⇒ 7 rồi 8` | hàm thuần |

---

## 2. [P1] Trainer lấy mốc chia 80/20 trước khi loại lịch sử không đáng tin

### Tình huống đầu vào

Fixture A: **60 chuỗi đã xác minh × 8 lượt = 480 lượt**. Fixture B: giữ nguyên từng log của A rồi
thêm **20 chuỗi × 8 = 160 lượt có timestamp muộn hơn**, đầu chuỗi `first=false` (bị loại).

### Nguyên nhân

`prepareTrainingData` tính `split` từ **toàn bộ** log (`valid[floor(n*0.8)].ts`). Trong
`optimizeParameters`, `trustedData = { ...data, cards: trustedCards }` **kế thừa** mốc đó. Khi các
chuỗi bị loại có timestamp muộn, mốc chia bị đẩy về phía cuối: mọi lượt đáng tin rơi vào phần train,
validation rỗng ⇒ optimizer từ chối oan dù phần đáng tin vẫn đủ 480 lượt.

### Trước khi sửa (mã vòng 3, cùng fixture)

`round4-split-before.txt`:

```
A (480 đáng tin)      : split 1793520024000, trainCount 324, validationCount 96,
                        improved true, reason "validated", oldLoss 0.7056252807501106,
                        newLoss 0.5075217153460795, params[0] 0.1104
B (A + 160 bị loại)   : split 1793865612000  ← bị đẩy
                        reason "insufficient-verified-history",
                        trustedRows 480, trustedTrainCount 420, trustedValidationCount 0
A′ (96 đáng tin)      : reason "insufficient-data"          (không có trustedTrainCount trong chẩn đoán)
B′ (+480 bị loại)     : reason "insufficient-verified-history",
                        trustedRows 96, trustedTrainCount 84, trustedValidationCount 0
```

### Đã sửa (`src/core/srs/training.js`)

1. `prepareTrainingData` tính thêm **`trustedSplit`** = mốc chia 80/20 trên **chính các lượt của
   `trustedCards`** (sắp theo `ts`, giữ thứ tự thời gian; `Infinity` nếu phần đáng tin rỗng).
2. `optimizeParameters` dùng `trustedData = { ...data, cards: trustedCards, split: data.trustedSplit }`
   cho **tất cả** các bước: baseline, candidate (`lossOf`), validation, `collectValidationLosses`
   (bootstrap CI + kiểm tra hai nửa) và điều kiện áp dụng.
3. Số mẫu của phần đáng tin (`trustedRows`, `trustedTrainCount`, `trustedValidationCount`) nay nằm
   trong **chẩn đoán của mọi nhánh từ chối** (kể cả `insufficient-data`), để log bị loại không bao
   giờ "trông như" đã giúp vượt ngưỡng.
4. Giữ nguyên: giới hạn cửa sổ 6.000 lượt, ngưỡng 400/100/30, thứ tự thời gian, các cổng thống kê.

### Sau khi sửa (cùng fixture)

`round4-split-after.txt`:

```
A (480 đáng tin)    : split = trustedSplit = 1793520024000, trainCount 324, validationCount 96,
                      improved true, oldLoss 0.7056252807501106, newLoss 0.5075217153460795, params[0] 0.1104
B (A + 160 bị loại) : split (toàn bộ) 1793865612000 nhưng trustedSplit = 1793520024000 (KHÔNG đổi)
                      trainCount 324, validationCount 96, improved true, reason "validated",
                      oldLoss/newLoss/params[0] GIỐNG HỆT A
A′ (96 đáng tin)    : insufficient-data,   trustedRows 96, trustedTrainCount 64, trustedValidationCount 20
B′ (+480 bị loại)   : insufficient-verified-history, trustedRows 96, trustedTrainCount 64, trustedValidationCount 20
```

### Test bảo vệ — `tests/p14-trainer-split.test.mjs` (5 test, gọi `optimizeParameters` thật)

| Test | Điều khẳng định |
|---|---|
| `thêm chuỗi bị loại (timestamp muộn) KHÔNG đổi mốc chia của phần đáng tin` | `trustedSplit` tồn tại và bằng nhau giữa A và B |
| `fixture chuẩn cho 324 train / 96 validation, và fixture B cho ĐÚNG như vậy` | `trainCount`/`validationCount` của B bằng A, và B **không** bị `insufficient-verified-history` |
| `quyết định của optimizer trên A và B là NHƯ NHAU` | `improved`, `reason`, `oldLoss`, `newLoss`, `gainPct`, `params` (deep-equal) và `resolveOptimizationOutcome(...).apply` giống nhau |
| `(chiều ngược) phần đáng tin thiếu mẫu thì thêm log bị loại KHÔNG giúp vượt ngưỡng` | A′ và B′ đều `improved:false`, `apply:false`, cùng `trustedTrainCount` 64 (<100) và `trustedValidationCount` 20 (<30), `trustedRows` 96 (<400) |
| `mốc chia lấy từ phần đáng tin vẫn giữ thứ tự thời gian và ngưỡng 400/100/30` | `trustedSplit` là timestamp của một lượt **đáng tin**, sau lượt sớm nhất và không vượt lượt muộn nhất |

Tính tất định: `bootstrapGain` dùng RNG có seed cố định (`mulberry32(0x9E3779B9)`), và hai lần chạy
dùng cùng `trustedData` ⇒ `params`, loss và CI trùng khớp từng bit (đã kiểm bằng `deepEqual`).

---

## 3. Tệp thay đổi

| Tệp | Thay đổi |
|---|---|
| `src/core/stats-rollback.js` | `diffReviewStats` ghi nhận bộ đếm theo kỳ khi khoá kỳ đổi **dù giá trị bằng nhau**; chú thích ca 5 → 5 |
| `src/core/srs/training.js` | `trustedSplit` trong `prepareTrainingData`; `trustedData` dùng mốc chia đó; chẩn đoán số mẫu đáng tin cho mọi nhánh từ chối |
| `tests/p14-undo-equal-periods.test.mjs` **(mới, 8)** | Lỗi 1 |
| `tests/p14-trainer-split.test.mjs` **(mới, 5)** | Lỗi 2 |
| `README.md` | Số đo cập nhật (583 test, entry 78,27 kB) |

Không đổi: `index.html`, CSS, `vite.config.js`, `tools/bundle_budget.mjs`, `package.json`,
`version_seq.json`, `public/version.json`, `src/core/version.js`, schema IndexedDB, định dạng TSV,
ngưỡng bundle. Các script bằng chứng cũ (`recheck-reproduce.mjs`, `reproduce.mjs`,
`scratch/repro-round3.mjs`) được giữ nguyên.

---

## 4. Giới hạn và phần chưa kiểm chứng

1. **Không chạy trên dữ liệu thật / thiết bị thật.** Fixture trainer là tổng hợp, tất định; hành vi
   trên log thật (nhiều thẻ, timestamp lệch) chưa được đo trong phạm vi này.
2. **`trustedSplit` chỉ tính trên các lượt còn trong cửa sổ 6.000 lượt.** Nếu chính các lượt đáng tin
   bị cắt khỏi cửa sổ (dữ liệu rất lớn), mốc chia sẽ tính trên phần còn lại — đúng như yêu cầu
   ("khi tập lượt đáng tin được giữ nguyên trong cửa sổ"), nhưng chưa có test riêng cho ca vượt 6.000.
3. **Worker không được khởi động thật trong test Node.** Quyết định áp dụng được kiểm qua
   `resolveOptimizationOutcome` (hàm thật mà `runOptimizer` gọi) và qua việc `optimizeParameters`
   trả cùng `improved`/`params` cho hai fixture.
4. **Undo**: ca tích hợp chạy qua handler/Undo trích từ nguồn; phần lưu trữ và UI được stub trong
   harness (đã ghi trong `tests/helpers/review-harness.mjs`). `recordReviewResult` trong harness là
   bản phản chiếu có chú thích (hàm thật giữ state module riêng).
5. **Headroom bundle còn 3,73 kB** (78,27/82). Không nâng ngưỡng; vòng sau nên tách chunk.
6. **Hai script `scratch/probe-split*.mjs`** chỉ dùng để in số trước/sau, không nằm trong `npm test`;
   bằng chứng đã lưu thành `round4-split-before.txt` / `round4-split-after.txt`.
