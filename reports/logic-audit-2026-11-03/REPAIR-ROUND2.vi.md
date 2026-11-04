# Báo cáo sửa lỗi vòng 2 — Recheck 03/11/2026

> **ĐÍNH CHÍNH (vòng 3):** câu "bước hỏng không chạm `m1/m2`" ở §1 **chỉ đúng cho nhánh gradient
> không hữu hạn**. Candidate/moment hỏng và nhánh `projectFsrs7Params` trả `null` **reset** moment
> về 0. Bảng chính xác theo mã hiện tại nằm ở `REPAIR-ROUND3.vi.md` §5. Ba lỗi còn mở sau vòng 2
> được xử lý tiếp trong `REPAIR-ROUND3.vi.md`.

Phạm vi: 5 phát hiện trong `RECHECK.vi.md` (đối chiếu lại với mã nguồn trước khi sửa). Mọi thay đổi
đều nằm trong mã + test hồi quy đi qua **đường tích hợp thật** (handler/hàng đợi/optimizer/log store),
không chỉ gọi hàm thuần rồi suy ra. Không commit/push, không nâng ngưỡng bundle, không xoá dữ liệu,
không sửa `recheck-reproduce.mjs` (giữ làm bằng chứng lịch sử — xem §6).

## 0. Cổng kiểm tra (số đo thật sau khi sửa)

| Lệnh | Kết quả |
|---|---|
| `npm run lint` | **0 error**, 108 warning (đúng baseline) |
| `npm test` | **541/541 pass**, 0 fail, 0 skip (499 test cũ + 42 test mới) |
| `npx vite build` | OK, PWA sinh bình thường |
| `npm run budget` | **4/4 đạt**: entry **77,81 kB**/82 (còn **4,19 kB**), firebase 113,65/120, CSS 332,00/350, dist 2.152,63/2.700 kB |
| `npm run test:e2e` (NEW) | `ok: true`, `failures: []`, `errors: []` |
| `npm run test:e2e` (`SMOKE_LEECH=1`) | `ok: true`, `failures: []`, `errors: []` |
| `version_seq.json` | vẫn `{ "seq": 2 }` (dùng Vite trực tiếp, không chạy generate_version) |
| `node reports/.../recheck-reproduce.mjs` | **exit 1 — xem §6** (script lịch sử, không còn khớp handler hiện tại) |

---

## 1. [P1] Gradient optimizer vi phạm ràng buộc thứ tự

**Nguyên nhân.** `finiteDifferenceGradient` chỉ biết biên hộp `[0,1]`, không biết ràng buộc thứ tự
`w0 ≤ w1 ≤ w2 ≤ w3`, `w26 ≥ w25`. Tại bộ hợp lệ có `w0 = w1 = 4`, phép thử tiến làm `w0 > w1` ⇒
`lossOf` trả `Infinity` ⇒ gradient `Infinity` ⇒ `m1/m2 = NaN` ⇒ bước Adam `NaN` ⇒
`projectFsrs7Params` biến `NaN` thành **min** (w0: 4 → 0,01) rồi vòng lặp vẫn chạy tiếp. Moment đã
nhiễm vẫn được dùng cho vòng sau, và kết quả có thể vẫn được báo `validated`.

**Đã sửa (`src/core/srs/training.js`).**
- `finiteDifferenceGradient` phân biệt **ba** khả năng: số hữu hạn (dùng được), `null` = hướng
  KHÔNG khả thi dưới ràng buộc (thử hướng ngược), `NaN` = lỗi số THẬT (nơi gọi phải loại bước).
  Không hướng nào khả thi ⇒ trả `null` (toạ độ bị ràng buộc kẹp), **không** trả `Infinity`/0 giả.
- Trong vòng lặp: `evaluate` trả `null` khi `validFsrs7Params(weights) === false`; trả `NaN` khi
  loss không hữu hạn. Toạ độ bị kẹp ⇒ gradient 0 + đếm `pinnedCoordinates`.
- **Bất biến trước khi cập nhật:** gradient phải hữu hạn; nếu không ⇒ `gradientFailures++`, **không**
  chạm `m1/m2`, **không** di chuyển, quay về điểm tốt nhất. Moment và candidate được kiểm hữu hạn
  từng phần tử; nếu hỏng ⇒ `rejectedSteps++`, xoá `m1/m2` (không mang rác sang vòng sau), quay về
  điểm tốt nhất.
- `projectFsrs7Params` **trả `null`** cho đầu vào không hữu hạn / sai độ dài — không còn "NaN → min".
  Nhánh chiếu trong optimizer kiểm `null` và loại bước.
- Giữ nguyên: ràng buộc thứ tự sau mỗi bước, holdout theo thời gian, bootstrap theo thẻ, hai nửa
  holdout, ngưỡng ≥1% + CI, và cơ chế "cấu hình mới hơn thắng" (không đổi).
- Thêm chẩn đoán trả về: `gradientFailures`, `pinnedCoordinates`, `rejectedSteps`, `startEvidence`,
  `verifiedChains`, `assumedStartChains`; thêm lý do `unscorable` + thông điệp trong `worker-manager`.

**Bằng chứng (`tests/p12-optimizer-constraints.test.mjs`, 6 test, gọi `optimizeParameters` THẬT).**
- Khởi đầu `w0=w1=w2=w3=4`, `w25=w26=0,5`, fixture 480 lượt: `gradientFailures = 0`,
  `rejectedSteps = 0`, mọi tham số hữu hạn + hợp lệ, `pinnedCoordinates > 0` (chứng minh nhánh biên
  ràng buộc thực sự được dùng), `w0` **không** rơi về 0,01, và thứ tự `w0≤w1≤w2≤w3`, `w26≥w25` đúng.
- Khởi đầu ở **biên hộp** (`w0=min`, `w3=max`, `w25=max`, `w26=max`): cùng bất biến.
- Bộ mặc định vẫn tối ưu được (không chặn oan).
- `finiteDifferenceGradient`: hướng tiến không khả thi ⇒ dùng sai phân lùi (giá trị đúng);
  cả hai không khả thi ⇒ `null`; điểm khả thi nhưng loss NaN ⇒ `NaN`; biên hộp trên ⇒ lùi.
- `projectFsrs7Params(NaN|Infinity)` ⇒ `null`; sai độ dài ⇒ `null`.

---

## 2. [P2] Undo chụp thống kê quá muộn

**Nguyên nhân.** `src/events.js` chụp `snapshotNumericStats` **sau** `trackEvent('easyPresses'/
'hardPresses')` và **sau** `addXP()` (mà `addXP` gọi `trackXP`). Vì vậy delta không bao giờ chứa
`easyPresses/hardPresses/xpToday/xpWeekTotal/xpLastWeek/justLeveledUp`, còn Undo (bản trước) chỉ
hoàn phần delta ⇒ `userXP` về 0 nhưng `easyPresses = 1`, `xpToday = xpWeekTotal = 5`.

**Đã sửa.**
- `snapshotReviewStats` được gọi **ngay đầu handler**, trước `incrementReviewBudget`, `trackEvent`,
  `addXP`, `recordReviewResult`, `logActivity`, `trackHourBonus`, `trackReview`.
- Snapshot lưu **cả** `statsBefore` (giá trị trước) và `statsDelta` (thay đổi) vì mốc thời gian /
  streak chỉ khôi phục được khi biết giá trị cũ.
- Module mới `src/core/stats-rollback.js` phân loại khoá thay vì "trừ delta cho mọi số":
  - `COUNTER_KEYS` (cộng dồn thuần, gồm `easyPresses`, `hardPresses`, `xpToday`, `xpWeekTotal`,
    `monthlyTotal`, `accidentCount`, `reviewsOnLastDay`, …): trừ delta, kẹp ≥ 0 ⇒ cập nhật hợp lệ
    từ tab khác vẫn còn.
  - `STATE_KEYS` (mốc thời gian `last*`, `justLeveledUp`, `lastReviewAt`, streak
    `earlyBird/vampire/sunset/typingNoHint/consecutiveEasy/Deletes`, max `maxLostStreak`,
    `xpLastWeek`): chỉ khôi phục khi giá trị hiện tại **vẫn là** giá trị lượt chấm đã ghi.
  - Khoá lạ: **không đụng**, ghi vào `unclassified` (để test bắt được khi có khoá mới).
- Rollover có chủ ý: bộ đếm theo NGÀY bị bỏ qua nếu `dayKey` lúc Undo khác lúc chấm; theo TUẦN/
  THÁNG so với khoá kỳ **sau** lượt chấm (để lượt đầu tuần/tháng vẫn hoàn được).
- Không phục hồi toàn bộ object gamification; chỉ hoàn phần của lượt bị huỷ ⇒ cập nhật hợp lệ
  xen giữa vẫn còn. Không tước huy hiệu cũ (huy hiệu dẫn xuất từ stats, chỉ số của lượt bị huỷ mất đi).

**Bằng chứng (`tests/p12-undo-stats.test.mjs`, 9 test).** Harness chạy **chính**
`processSrsFeedback` (trích từ `src/events.js` bằng marker, không chép logic) + **chính**
`revertGamificationAfterUndo` (trích từ `src/core/state.js`), với `trackReview/trackXP/trackHourBonus/
trackLevelUp/ensureStats/snapshotReviewStats/diffReviewStats` là hàm THẬT:
- Kiểm tra **vị trí nối**: `snapshotReviewStats` đứng trước `trackEvent('easyPresses')`, `addXP(`,
  `trackHourBonus(`, `trackReview(` trong chính handler; delta lấy sau `trackReview`.
- Easy thẻ New: trước Undo `easyPresses=1, xpToday=5, xpWeekTotal=5`; sau Undo **tất cả 0**, `userXP=0`,
  `totalReviews=0`, `newCardsDoneToday=0`.
- Hard + bộ đếm `trackReview` (`accidentCount`, `monthlyTotal`, `reviewsOnLastDay`, `totalTimeSpent`,
  `consecutiveEasy`, `typingNoHintStreak`, `lastReviewAt`) trở lại đúng giá trị ban đầu.
- Undo rồi làm lại = **đúng một lượt**; 6 vòng Undo/làm lại ⇒ tất cả về 0 (không tích luỹ).
- "Tab khác" cộng thêm 3 lượt + 12 XP giữa chừng ⇒ sau Undo còn đúng phần của tab khác.
- Mốc `lastReviewAt` bị nơi khác ghi mới hơn ⇒ Undo **không** kéo lùi.
- Rollover sang ngày mới ⇒ không trừ `xpToday` của ngày mới, nhưng vẫn hoàn `easyPresses` toàn thời gian.
- Lên cấp trong lượt ⇒ `justLeveledUp` được hoàn.

---

## 3. [P2] Quiz vượt hạn mức từ mới

**Nguyên nhân.** `canSpendBudget` chỉ biết **một** ngân sách (`maxReviewsPerDay - used`). `Quiz` vì
thế cho giới thiệu thẻ New thứ 16 khi hạn mức từ mới là 15 (miễn còn trần tổng).

**Đã sửa (`src/core/review-policy.js`, `quiz.js`, `events.js`).**
- `reviewBudgets({limit, used, newLimit, newUsed})` → `{ totalRemaining, newRemaining }`.
- `canSpendBudget(category, budgets)`: **New** cần `newRemaining > 0` **và** `totalRemaining > 0`;
  **Due** chỉ cần `totalRemaining`; **Learning** và **null/cram** luôn được (giữ ngoại lệ thiết kế).
  Dạng cũ (truyền một số) vẫn được hiểu là "chỉ biết suất tổng" để không phá caller cũ.
- `budgetBlockReason(...)` trả `'new' | 'total' | null` để thông báo nói **đúng lý do**.
- Cả `Quiz` và `Flashcard` tính ngân sách tại **cửa ghi review** bằng
  `getReviewBudget()` + `computeDailyNewLimit(dailyStats)`, dùng `limit - used` (không trừ `reserved`
  — `reserved` chỉ có nghĩa khi dựng hàng đợi).
- Flashcard nay **chặn tại cửa chấm** nếu hàng đợi đã cũ (đổi cap / cập nhật từ thiết bị khác):
  không ghi log, không ghi thẻ, không cộng XP, không tiêu ngân sách, kèm toast đúng lý do.
- Quiz giữ nguyên chính sách điểm quiz (vẫn tính điểm), chỉ **không ghi SRS** và báo một lần.

**Bằng chứng (`tests/p11-review-budget.test.mjs`, +5 test; `tests/p12-review-gates.test.mjs`, +4 test).**
- 15/15 New, còn trần tổng ⇒ **chặn** (và toast nói "từ mới").
- Còn hạn mức New nhưng hết trần tổng ⇒ **chặn** (toast nói "giới hạn ôn").
- Due vẫn học khi hạn mức New đã hết; Learning vẫn chấm khi cả hai hết.
- Bảng chân trị `canSpendBudget/reviewBudgets/budgetBlockReason`.
- Flashcard: hàng đợi cũ + hết trần tổng ⇒ không ghi gì; hết hạn mức New ⇒ không tăng
  `newCardsDoneToday`; Learning vẫn qua; Undo trả lại đúng suất New đã tiêu.
- Tất cả đi qua `applyQuizReview`/`processSrsFeedback` **thật**, không chỉ hàm thuần.

---

## 4. [P2] Phiên luyện gõ riêng lấy thẻ tạm ngưng

**Nguyên nhân.** Listener `startDedicatedTypingBtn` chỉ lọc `card.isDeleted`; `getNextCardToReview`
cũng chỉ kiểm `isDeleted`. `classifyReview` trả `null` cho thẻ tạm ẩn nhưng **không** ngăn việc ghi
SRS, nên phiên luyện gõ vẫn mở và chấm thẻ đang ẩn.

**Đã sửa.**
- `src/features/typing-session.js` (mới): `buildTypingPool()` lọc bằng `isCardReviewable` **dùng
  chung** với Flashcard, rồi mới áp bộ lọc (leech/hard/learning/starred/long/all). Listener chỉ còn
  gọi hàm này (hành vi bộ lọc giữ nguyên).
- `queue.getNextCardToReview` dùng `isCardReviewable(vocabulary[nextIndex])` thay cho
  `!isDeleted` ⇒ bỏ qua thẻ bị ẩn giữa phiên, vẫn nhảy sang thẻ hợp lệ kế tiếp, hết queue thì
  `buildReviewQueue()` (đã loại ẩn/xoá) rồi trả `-1` — vòng lặp vẫn có trần 1000.
- `processSrsFeedback` kiểm `isCardReviewable(currentCard)` **trước** khi tính SRS/ghi log/tiêu
  ngân sách ⇒ thẻ bị ẩn/xoá sau khi vào queue không được chấm, không ghi log, không tiêu suất.
- Phiên luyện gõ cũng đi qua cửa ngân sách của §3 (vì nó dùng chính `processSrsFeedback`).

**Bằng chứng (`tests/p12-review-gates.test.mjs`, 12 test).** Kho chỉ có thẻ tạm ngưng ⇒ pool rỗng;
pool hỗn hợp ⇒ chỉ số thẻ hợp lệ; bộ lọc `long/starred` không đổi; hàng đợi **thật** bỏ qua thẻ ẩn
và trả thẻ kế tiếp; hàng đợi toàn thẻ không hợp lệ ⇒ `-1`; thẻ bị ẩn/xoá sau khi vào queue ⇒ không
log, không save, `srsStatus` nguyên vẹn, không tiêu ngân sách, có toast.

---

## 5. [P2] Trainer coi `t = 0` là bằng chứng khởi đầu

**Nguyên nhân.** `prepareTrainingData` suy `startKnown` từ `t <= 1e-9`. `t` là thời gian đã trôi:
lượt thứ hai cùng timestamp (hoặc lệch đồng hồ) cũng có `t = 0`, nên chuỗi **đã mất log đầu** vẫn
được đánh dấu `historyComplete = true` và được replay như thể bắt đầu từ thẻ New.

**Đã sửa.**
- `src/core/srs/index.js`: log có thêm `first` — cờ do engine ghi tại đúng lượt nó BIẾT thẻ chưa
  từng được ôn (`reps = 0` và không có `lastReviewDate`). Không suy từ `t`.
- Lưu bền vững: `state.addReviewLog` ghi cột 6; `compressLogs` xuất cột 6; `mergeReviewLogs` đọc/giữ
  cột 6 và **ưu tiên bản có cờ** khi cùng một sự kiện (kể cả khi đảo thứ tự tham số);
  `pruneReviewLogs` giữ nguyên row (chỉ đổi dict index); `buildReviewLogsExport` (mới, dùng cho
  `exportReviewLogsAsJson`) giữ `first`; worker nhận đúng dạng nén này nên không cần đổi payload.
- `prepareTrainingData`: `startVerified = first === true`; `startKnown = startVerified || t ≤ 1e-9`
  (giữ phỏng đoán cho log legacy để **không vô hiệu hoá** optimizer của người dùng cũ);
  `historyComplete = !logTrimmed && chains.length > 0 && verifiedChains === chains.length`
  (chỉ khi MỌI chuỗi có bằng chứng). Trả thêm `verifiedChains`, `assumedStartChains`;
  `optimizeParameters` trả `startEvidence: 'verified' | 'mixed' | 'assumed'`.
- Log legacy (6 cột) đọc được, **không** bị sửa/thêm cột, và được biểu diễn là **chưa xác minh**.

**Bằng chứng (`tests/p12-trainer-start-evidence.test.mjs`, 10 test).**
- Engine ghi `first=true` ở lượt đầu, `false` ở lượt sau.
- Lệch đồng hồ: lượt hai có `t = 0` nhưng `first = false`; chuỗi chỉ còn [lượt 2, lượt 3] ⇒
  `historyComplete = false`, `verifiedChains = 0` (chuỗi vẫn dùng được ở mức phỏng đoán).
- Cờ sống sót qua `addReviewLog` **thật** (IndexedDB, `loadVocabulary`) → `compressLogs` →
  `mergeReviewLogs` → `prepareTrainingData`; merge ưu tiên bản có cờ ở cả hai thứ tự tham số.
- Pruning: giữ cả 3 dòng ⇒ cờ còn (historyComplete true); cắt còn 2 dòng ⇒ mất bằng chứng,
  `historyComplete = false`.
- File xuất JSON giữ `first`, và dùng lại để train vẫn xác minh được.
- Log legacy: đọc được, `verifiedChains = 0`, `assumedStartChains = 1`, `historyComplete = false`,
  mảng log gốc **không bị thêm cột**.
- Chuỗi 1 lượt vẫn bị loại như trước.

---

## 6. Trạng thái `recheck-reproduce.mjs` (bằng chứng lịch sử)

Script này được viết cho **mã trước khi sửa** và tự dựng context giả cho handler. Sau khi
`processSrsFeedback` có thêm `isCardReviewable` / `budgetBlockReason` / `reviewBudgets` /
`computeDailyNewLimit`, context của script thiếu các hàm đó nên nó **dừng bằng ReferenceError**
(exit 1), không còn chạy tới các assert mô tả hành vi cũ.

- **Không xoá, không sửa** script (theo yêu cầu). Nó chỉ còn giá trị **bằng chứng lịch sử** về lỗi
  vòng 1.
- Bằng chứng "đã sửa" nằm ở `tests/p11-*.test.mjs` (cập nhật) và `tests/p12-*.test.mjs` (mới), chạy
  qua `npm test`.
- Hệ quả cần biết: **exit 0 của script này không còn là tín hiệu gì** (cả trước lẫn sau khi sửa).

---

## 7. Tệp thay đổi (vòng 2)

| Tệp | Thay đổi |
|---|---|
| `src/core/stats-rollback.js` **(mới)** | Phân loại COUNTER/STATE, snapshot/diff/revert có rollover ngày-tuần-tháng |
| `src/features/typing-session.js` **(mới)** | `buildTypingPool`/`matchesTypingFilter` dùng `isCardReviewable` |
| `src/core/srs/training.js` | FD tôn trọng ràng buộc; chặn gradient/moment/candidate không hữu hạn; `projectFsrs7Params` trả `null`; `startVerified`/`verifiedChains`/`historyComplete` chặt; chẩn đoán `gradientFailures/pinnedCoordinates/rejectedSteps/startEvidence`; lý do `unscorable` |
| `src/core/review-policy.js` | `reviewBudgets`, `canSpendBudget` hai ngân sách, `budgetBlockReason` |
| `src/events.js` | Snapshot thống kê ở đầu handler; `statsBefore`+`statsDelta`; cửa chặn eligibility + ngân sách; dùng `buildTypingPool` |
| `src/core/state.js` | `revertReviewStats` (thay delta mù); `addReviewLog` ghi cột `first`; export log dùng hàm thuần |
| `src/core/queue.js` | `getNextCardToReview` dùng `isCardReviewable` |
| `src/features/quiz.js` | Hai ngân sách + thông báo đúng lý do |
| `src/core/srs/index.js` | Log có cờ `first` |
| `src/core/review-log-merge.js` | Cột `first` trong compress/merge; `buildReviewLogsExport` |
| `src/core/srs/worker-manager.js` | Thông điệp cho `unscorable` |
| `tests/helpers/review-harness.mjs` **(mới)** | Harness chạy handler + revert thật |
| `tests/p12-optimizer-constraints.test.mjs` **(mới, 6)** | §1 |
| `tests/p12-undo-stats.test.mjs` **(mới, 9)** | §2 |
| `tests/p12-review-gates.test.mjs` **(mới, 12)** | §3 (Flashcard) + §4 |
| `tests/p12-trainer-start-evidence.test.mjs` **(mới, 10)** | §5 |
| `tests/p11-review-budget.test.mjs` | +5 test hai ngân sách; harness bổ sung `reviewBudgets/budgetBlockReason/computeDailyNewLimit` |
| `tests/p11-training-and-undo-stats.test.mjs` | Test `historyComplete` cũ (đòi `true` chỉ từ `t=0`) được **sửa lại theo hành vi đúng** + kiểm cả hai chiều |
| `tests/reliability.test.mjs` | Harness quiz/Undo cập nhật theo API mới |
| `README.md` | Số đo cập nhật (541 test, entry 77,81 kB) |

Không đổi: `index.html`, CSS, `vite.config.js`, `tools/bundle_budget.mjs`, `package.json`,
`version_seq.json`, `public/version.json`, `src/core/version.js`, schema IndexedDB, định dạng TSV,
chính sách Smart Cram, UI Quiz.

---

## 8. Tương thích dữ liệu cũ

- **Thẻ/thống kê**: không đổi schema. Snapshot Undo là dữ liệu trong bộ nhớ (không lưu), nên không
  có snapshot "định dạng cũ" sau khi tải lại trang.
- **Review log**: dòng cũ 6 cột vẫn đọc được; cột 6 (`first`) chỉ được **thêm** khi ghi dòng mới.
  Legacy không bị sửa, không bị thêm cột, và được coi là **chưa xác minh** (`historyComplete=false`)
  — nhưng vẫn dùng để train được (giữ phỏng đoán `t=0`) để không vô hiệu hoá optimizer của người
  dùng hiện hữu.
- **Cloud/export**: `mergeReviewLogs`/`normalizeRemoteReviewLogs`/`pruneReviewLogs` đều truyền
  nguyên row nên cột mới sống sót; file JSON xuất ra có thêm trường `first` (không phá file cũ).
- **Tham số FSRS đã lưu**: không đổi. `projectFsrs7Params` trả `null` thay vì min cho đầu vào hỏng —
  optimizer coi đó là bước hỏng và giữ bộ đang dùng.
- Không nhánh nào xoá IndexedDB / localStorage / Cloud / lịch sử.

---

## 9. Giới hạn và phần chưa kiểm chứng

1. **Không chạy trên dữ liệu thật.** Optimizer được kiểm bằng fixture tổng hợp 480 lượt; thay đổi
   hướng sai phân có thể làm **quỹ đạo tối ưu khác đi** trên dữ liệu thật (không thể đo trong phạm vi
   này vì không được dùng dữ liệu thật). Các cổng thống kê (holdout + bootstrap + hai nửa) vẫn giữ
   nguyên nên rủi ro áp dụng bộ tệ hơn vẫn được chặn như trước.
2. **Chính sách legacy**: log cũ **vẫn** được dùng để train ở mức "phỏng đoán" (`t=0`), chỉ không
   còn được gọi là đầy đủ. Đây là quyết định có chủ ý (nếu từ chối, optimizer sẽ tắt với mọi người
   dùng hiện hữu vì log cũ không thể có cờ). `historyComplete` phản ánh đúng: chỉ `true` khi mọi
   chuỗi có cờ.
3. **Chưa kiểm hai thiết bị/Firebase thật**: luồng merge/normalize được test ở tầng hàm; đồng bộ
   Firestore thật không chạy.
4. **Listener luyện gõ**: test đi qua `buildTypingPool` (hàm mà listener gọi), `getNextCardToReview`
   thật và `processSrsFeedback` thật; **không** bấm nút trong trình duyệt (không có DOM harness cho
   màn hình này).
5. **Nhánh `unscorable`** (không chấm được ngay tại điểm xuất phát) chỉ được bảo vệ bằng mã + thông
   điệp; chưa dựng được fixture tất định để chạm nhánh này.
6. **Headroom bundle giảm**: entry 77,03 → 77,81 kB gzip (còn 4,19 kB). Không nâng ngưỡng; nếu vòng
   sau cần thêm byte, nên tách tiếp chứ không nới budget.
7. **`recheck-reproduce.mjs`** không còn chạy được (mục §6) — không dùng nó làm cổng.
8. **Test cũ đã sửa**: `tests/p11-training-and-undo-stats.test.mjs` từng khẳng định
   `historyComplete = true` khi mọi chuỗi chỉ có `t = 0`. Đó chính là hành vi bị báo là sai, nên test
   được viết lại để khẳng định **cả hai chiều** (legacy ⇒ `false`; có cờ ⇒ `true`), không phải nới
   lỏng.
