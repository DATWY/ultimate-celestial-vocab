# Kiểm chứng độc lập `REVIEW.vi.md` — 03/11/2026

## 0. Tôi đã kiểm chứng bằng cách nào

Báo cáo gốc là một đánh giá; tài liệu này là **kiểm chứng lại từng kết luận**, không phải đánh giá mới
toàn diện. Cách làm:

1. Đọc lại trực tiếp mã nguồn tại đúng vị trí báo cáo chỉ ra (đối chiếu số dòng).
2. Chạy lại các cổng chất lượng để xác nhận bảng số liệu.
3. Viết **bộ kiểm chứng riêng với fixture khác** fixture của `reproduce.mjs`, và đi qua **đường tích hợp
   thật** thay vì chỉ gọi hàm thuần: `planVocabularyImport` (import TSV), `mergeCardFields` đúng như
   `saveWordToDB` gọi, `restoreCardReview` đúng như handler Undo gọi.
4. Đối chiếu công thức với nguồn FSRS-7 tham chiếu (`models/fsrs_v7.py`, tải 03/11/2026) để kiểm chứng cả
   phần báo cáo khen, không chỉ phần chê.

Các script kiểm chứng: `scratch/verify-review-2026-11-03.mjs`, `scratch/verify-dedup-direction.mjs`,
`scratch/verify-solver-residual.mjs`, `scratch/verify-solver-default.mjs`,
`scratch/verify-undo-consequence.mjs`, `scratch/verify-e2e-labels.mjs`.

Không sửa mã ứng dụng. Không chạy kiểm thử E2E bằng trình duyệt trong lần này (xem §8).

## 1. Bảng kết luận

| # | Mục trong review | Mức | Kết luận kiểm chứng | Ghi chú |
|---|---|---|---|---|
| 1 | Dedup không tăng revision bộ nhớ | P1 | **Đúng** | Cơ chế đúng; tổn thất phụ thuộc giá trị cụ thể (4/10 mẫu tôi thử), không phải luôn luôn |
| 2 | Thiếu trường bộ nhớ trong hợp đồng merge/Undo | P1 | **Đúng** | Kiểm chứng được cả A và B qua đường Undo thật; hậu quả nặng hơn mô tả (xem §3.2) |
| 3 | Từ mới sai lần đầu không tính hạn mức ngày | P1 | **Đúng** | Không chỉ "không đóng góp": ngân sách ngày **hoàn toàn không bị tiêu** cho lượt đó |
| 4 | Backup TSV làm mất tạm ngưng | P1 | **Đúng về dữ liệu, sai về cơ chế** | Export/import đều hardcode `false`; nhưng round-trip **trên cùng thiết bị không** làm thẻ sống lại |
| 5 | Optimizer tái dựng sai khi lịch sử bị cắt | P1 | **Đúng** | Xác nhận 6.000/3.000, replay khởi tạo New/reps=0, `log.t` bị bỏ qua |
| 6 | Quiz không dùng chính sách chọn thẻ/ngân sách | P2 | **Đúng** | Xác nhận qua chính `applyQuizReview` trích từ nguồn |
| 7 | Validator thiếu ràng buộc giữa tham số | P2 | **Đúng, và có nguồn xác nhận** | Upstream **có** bước monotonicity sau box clamp; dự án không có |
| 8 | E2E lệch đặc tả Hard | P2 | **Đúng** | Xác nhận ở tầng engine, không cần trình duyệt; unit test ủng hộ engine |
| 9 | Persona diễn giải sai công thức | P2 | **Đúng** | Đối chiếu từng ký hiệu với upstream |
| 10 | Jitter chôn thẻ không phân tán | P3 | **Đúng** | 5 thẻ khác nhau → cùng một mốc 06:00 |

**Không có mục nào trong 10 mục là sai.** Có 1 mục (số 4) mô tả sai cơ chế, 1 mục (số 1) cần nói rõ hơn
điều kiện kích hoạt, và 1 mục (số 2) đánh giá **thấp hơn** mức độ thực tế.

## 2. Xác nhận bảng số liệu của review

| Kiểm tra | Review ghi | Tôi chạy lại | Khớp |
|---|---|---|---|
| `npm test` | 450/450, không skip | 450 pass, 0 fail, 0 skipped | ✅ |
| `npm run lint` | 0 error, 108 warning | 0 error, 108 warning | ✅ |
| `npx vite build` | Thành công, có PWA | Thành công (`index-DQ5YtNkF.js`, precache 36 entry) | ✅ |
| `node tools/bundle_budget.mjs` | 4/4 ngưỡng, entry 81,75/82 kB | 4/4 OK, entry 81,75 kB — còn **0,25 kB** | ✅ |
| `npm run test:e2e` | Không đạt vì nhãn Hard | Xác nhận ở tầng engine: app trả `1p/1p/10p/7 ngày`, E2E đòi `1p/10p/10p/7 ngày` | ✅ |
| `reproduce.mjs` | 9 ca, exit 0 | 9 ca, exit 0 | ✅ |

Một điểm đáng khen về phương pháp: báo cáo **nói rõ** exit 0 của `reproduce.mjs` nghĩa là "tái hiện được
lỗi", không phải "ứng dụng không có lỗi". Đây là chỗ dễ bị đọc sai và review đã chặn trước.

## 3. Chi tiết từng mục

### 3.1 — Dedup revision (P1): đúng, cần nêu rõ điều kiện trúng

Cơ chế đúng như mô tả. `dedup.js:1226` đặt `srsUpdatedAt = max(hai đầu vào)`, trong khi chính hàm này
**đã** cấp revision mới cho `contentUpdatedAt` (`:1201`) và `flagsUpdatedAt` (`:1202`). `idb.js:47` gọi
`mergeCardFields(word, previous)`; hai đồng hồ bằng nhau nên rơi vào tie-break `stable()` — so sánh
**chuỗi JSON** (`card-merge.js:73`).

Điểm tôi bổ sung: tổn thất **không phải luôn xảy ra**, mà phụ thuộc thứ tự từ điển của giá trị. Thử 10
cặp `lapses` (thẻ chính + thẻ phụ):

| lapses chính + phụ | lapses sau gộp | lapses lưu được | Mất? |
|---|---|---|---|
| 1 + 1 | 2 | 2 | không |
| 6 + 2 | 8 | 8 | không |
| **8 + 2** | **10** | **8** | **có** |
| **9 + 1** | **10** | **9** | **có** |
| **9 + 9** | **18** | **9** | **có** |
| 4 + 5 | 9 | 9 | không |
| 18 + 1 | 19 | 19 | không |
| **99 + 1** | **100** | **99** | **có** |

4/10 ca mất. Quy luật: mất khi chuỗi số của giá trị gộp nhỏ hơn theo từ điển — điển hình là **vượt mốc
số chữ số** (9→10, 99→100). Điều này khiến lỗi khó thấy khi thử tay vài thẻ, nhưng lại trúng đúng nhóm
thẻ `lapses` cao (thẻ leech) — tức nhóm mà dữ liệu bộ nhớ quan trọng nhất. Tie-break so sánh **toàn bộ**
projection MEMORY theo thứ tự alphabet, nên `difficulty`, `isLeech`, `srsDueDate` cũng có thể là trường
quyết định thay vì `lapses`.

Đề xuất sửa của review (cấp revision mới bằng `nextRevision` trên max clock) là **đúng hướng và nhất
quán** với cách hàm này đang xử lý hai nhóm clock còn lại. Nên thêm: áp cùng quy tắc cho mọi trường hợp
gộp khác sinh ra trạng thái bộ nhớ mới (không chỉ dedup).

### 3.2 — Hợp đồng MEMORY/Undo (P1): đúng, và hậu quả nặng hơn mô tả

`MEMORY` (`card-merge.js:19–21`) không có `lapseDay`, `lapsesToday`, `buriedOn`, `needsReformulation`.
Handler Undo thật (`events.js:93`) gọi `restoreCardReview`, hàm này chỉ phục hồi các khóa trong `MEMORY`
(`:134–137`). Vì các trường thiếu **không** nằm trong `MEMORY`, chúng "đi theo" object có `updatedAt` mới
nhất qua `const newest = choose(a, b, 'updatedAt', [...CONTENT, ...MEMORY])` — kể cả khi bản đó chỉ là
chỉnh nội dung. Cả hai kịch bản A và B của review đều tái hiện được với fixture khác.

Hậu quả cụ thể tôi đo được (đáng đưa vào phần mô tả lỗi, vì nó là trải nghiệm người dùng chứ không chỉ
là bất nhất dữ liệu):

```
sau lần sai thứ 2 trong ngày : lapsesToday=2, bị chôn, needsReformulation=true
sau Undo                     : lapses=3 (đã lùi), nhưng lapsesToday=2, buriedOn giữ nguyên, needsReformulation=true
sai thêm ĐÚNG MỘT lần nữa    : lapsesToday=3 ⇒ bị chôn lại NGAY, hẹn 780 phút (sáng hôm sau)
```

Nghĩa là: người dùng bấm nhầm, hoàn tác, rồi trả lời sai một lần — thẻ bị chôn tới sáng mai như thể đã
sai ba lần trong ngày. Ngoài ra `needsReformulation` còn sót khiến UI hiện badge "cần viết lại"
(`render.js:454`) trong khi `lapses` đã lùi và thẻ có thể không còn là leech.

Một chi tiết làm rõ thêm: `buriedOn` **không** được hàng đợi dùng để lọc — việc chôn thực hiện hoàn toàn
qua `srsDueDate`. Nên hệ quả của `buriedOn` sót lại là badge/toast sai, còn hệ quả nghiêm trọng nằm ở
`lapsesToday`. Điều này không làm sai kết luận của review, chỉ giúp khoanh đúng vùng ảnh hưởng.

### 3.3 — Hạn mức từ mới (P1): đúng, mức độ nặng hơn câu chữ

`events.js:151` định nghĩa `isNewCard` theo `srsStatus === 'New'`; `:159` chỉ tăng khi `rating > 1`. Engine
chuyển New + Again sang `Learning` ngay (`srs/index.js:295–304`), nên các lượt sau không còn thỏa điều
kiện. Mô phỏng chuỗi thật `Again → Good → Good → Good → Easy` trên một thẻ New: **0 lượt** được tính.

Điểm cần nhấn mạnh hơn review: không chỉ `newCardsDoneToday` đứng yên, mà `getReviewBudget().used`
(`queue.js:94–95`) chỉ cộng `dueDoneToday + newCardsDoneToday` — nên lượt "New + Again" **không tiêu bất
kỳ ngân sách nào**, cả ngân sách từ mới lẫn ngân sách lượt ôn. Người dùng có thể mở không giới hạn thẻ
mới bằng cách bấm Again trước. Đây là lỗ hổng ngân sách, không chỉ là lệch thống kê.

Đối xứng mà review chỉ ra là chính xác: `quiz.js:248–250` tăng bộ đếm theo trạng thái thẻ, **không** phụ
thuộc đúng/sai; còn Flashcard thì phụ thuộc. Hai định nghĩa "đã xử lý" khác nhau trong cùng một sản phẩm.

### 3.4 — TSV mất tạm ngưng (P1): đúng về thiệt hại, sai về cơ chế

Đúng: `tabular.js:55` (`isSuspended: false` khi parse) và `:100` (`if (name === 'isSuspended') return false`)
đều hardcode, dù cột tồn tại trong `VOCAB_COLUMNS`. Cột số 10 trong file xuất ra luôn là `false` dù nguồn
là `true`. Test `export-roundtrip.test.mjs` chỉ dùng fixture `isSuspended: false` (dòng 13, 22) — nhận định
về điểm mù của test là đúng.

**Cần chỉnh:** câu "Thẻ tạm ngưng=true sau round-trip thành false và trở lại học" không đúng với đường
import thật khi nhập lại **trên cùng thiết bị**. `planVocabularyImport` chỉ cập nhật các trường nội dung
(`import-plan.js:21–38`), không chạm `isSuspended`; nếu không có gì đổi thì bỏ qua luôn (`skipped`). Tôi
đo được: nhập lại chính file vừa xuất vào kho đang có thẻ đó → `newItems=0`, `updateItems=0`, thẻ **vẫn**
tạm ngưng.

Thiệt hại thật nằm ở nhánh còn lại: nhập vào kho **rỗng** (máy mới, đã xoá dữ liệu, khôi phục sau sự cố)
→ thẻ được tạo mới với `isSuspended=false` (`import-plan.js:42`), và **mọi** thẻ tạm ngưng đều sống lại.
Đây đúng là kịch bản mà backup tồn tại để phục vụ, nên mức P1 vẫn hợp lý — nhưng ca tái hiện phải là
"import vào kho rỗng", không phải "round-trip tại chỗ". Nếu không, người sửa có thể chạy đúng test của
review, thấy hồng, và kết luận sai rằng đã an toàn.

Kết luận phụ của review (TSV là công cụ xuất kho từ, cần JSON backup có schema/version để khôi phục toàn
bộ tài khoản) là đúng và nên làm.

### 3.5 — Optimizer tái dựng sai (P1): đúng

Xác nhận đủ ba mắt xích:
- `training.js:34` — `slice(-6000)` trên danh sách **đã sắp xếp toàn cục**, nên cắt giữa chuỗi của một thẻ
  tùy ý, không theo từng thẻ.
- `review-log-prune.js:12` — `MAX_REVIEW_LOG_ENTRIES = 3000` cho bản Cloud.
- `training.js:47` và `:72` — mỗi thẻ khởi tạo `srsStatus: 'New', reps: 0`, và `:51`/`:75` đặt
  `elapsed = i ? ... : 0`, tức lượt đầu còn giữ **luôn** được coi là lần chạm đầu đời với elapsed 0.

Thêm một điểm củng cố: `log.t` (elapsed do engine ghi lúc ôn thật) **không được dùng** khi replay — elapsed
được tính lại từ chênh lệch `ts`. Đó là lý do ca tái hiện "đặt toàn bộ `log.t = 0` không đổi loss" đúng,
và cũng là lý do dữ liệu `t` trong log không thể dùng để phát hiện chuỗi bị cắt.

Đánh giá mức P1: hợp lý. Kết quả optimizer không chỉ là con số hiển thị — nó ghi đè weights và đổi lịch ôn
của toàn bộ thẻ về sau. Sai ở đầu vào nên "holdout tốt hơn" không suy ra được lịch tốt hơn (review nói
đúng). Lưu ý phạm vi: chỉ ảnh hưởng người dùng thực sự chạy optimizer.

### 3.6 — Quiz (P2): đúng

`quiz.js:84–89` chỉ loại `isDeleted`; không loại `isSuspended`, không kiểm tra `remaining` của cap lượt ôn
hay cap từ mới. `applyQuizReview` (`:243–255`) chỉ kiểm tra `isDeleted`, tăng bộ đếm theo trạng thái, rồi
gọi `calculateNextSrsState` + `saveOneWord` trực tiếp. Tôi xác nhận bằng cách trích nguyên hàm này từ
nguồn và chạy với thẻ New `isSuspended: true`: thẻ chuyển `Learning`, được lưu, bộ đếm từ mới tăng.

Điều này khiến Quiz không phải "bài kiểm tra không ảnh hưởng lịch" như tên gọi gợi ý — nó ghi bộ nhớ và
ngày ôn thật. Đề xuất gom về một hàm áp dụng review dùng chung là đúng, và nên làm **cùng lần** với §3.3
vì cả hai đều là hệ quả của việc định nghĩa "một lượt học" ở ba nơi khác nhau.

### 3.7 — Validator tham số (P2): đúng, có nguồn xác nhận

`validFsrs7Params` (`constants.js:91–94`) chỉ kiểm từng tọa độ theo hộp. `FSRS7_PARAM_BOUNDS[0..3]` đều là
`[0.01, 100]`, nên `w[0]=100, w[3]=0.01` được chấp nhận; tôi đo được S0 của Again = 100 ngày so với Easy
= 0.01 ngày. Adam (`training.js:160–197`) làm việc trong không gian unit với clamp từng tọa độ
(`:196`) — không duy trì thứ tự.

Phần quan trọng nhất của review — "nguồn FSRS-7 tham chiếu có bước áp monotonicity sau box clamp" — tôi
**xác nhận trực tiếp từ upstream**:

```python
w = torch.clamp(w, self._lo, self._hi)
# Cross-parameter monotonicity (after the box clamps)
w[1] = torch.maximum(w[1], w[0])
w[2] = torch.maximum(w[2], w[1])
w[3] = torch.maximum(w[3], w[2])
w[26] = torch.maximum(w[26], w[25])
```

Vậy khoảng trống là thật và có đối chứng, không phải suy đoán. Review cũng đúng khi không gọi khác bounds
là lỗi (hộp của dự án rộng hơn nguồn ở nhiều chỉ số, ví dụ `w[0]` cho tới 100 trong khi nguồn chặn 50) —
khác biên chưa chắc sai, nhưng **thiếu ràng buộc thứ tự** thì chắc chắn cho phép cấu hình vô nghĩa.

Xem thêm §5.2: thiếu ràng buộc này còn ghép với một lỗi thứ hai (solver im lặng trả sai) thành chuỗi hỏng
lịch ôn thật.

### 3.8 — E2E lệch đặc tả (P2): đúng

`study-loop.mjs:191` đòi `['1p','10p','10p','7 ngày']`. Tôi tính trực tiếp từ engine, không cần trình
duyệt: `predictNextIntervals` cho thẻ New trả `{"1":"1p","2":"1p","3":"10p","4":"7 ngày"}`. Chênh đúng
một nhãn.

Engine có chủ ý: `srs/index.js:70–79` cho Hard lặp đúng bước hiện tại, và có unit test bảo vệ
(`learning-steps.test.mjs:110` "T1.1: Khó (2) lặp lại ĐÚNG bước hiện tại, không vượt mặt Nhớ (3)"; thêm
ma trận vàng ở `golden-fsrs.test.mjs:107,118,122,126`). Vậy kết luận của review — đây là **mâu thuẫn
test/contract**, không chứng minh UI tính sai, và **không** được sửa thuật toán để chiều E2E cũ — là đúng
và quan trọng. Đây là chỗ một review kém sẽ kết luận sai.

### 3.9 — Persona (P2): đúng

`fsrsPersona.js:41`: `"Chu kỳ nhớ của bạn nhân lên " + sinc.toFixed(1) + "x mỗi lượt đúng"` với
`sinc = p[7] = w[7] = 1.9795`. Trong công thức thật (`stability.js:36–41`, khớp upstream), `w[7]` nằm
trong `exp(w[7]-1.5)` và toàn bộ `sinc` còn nhân `(11-D)`, `S^-w[8]`, `(exp((1-R)*w[9])-1)`, phạt/bonus
theo rating. Câu "nhân 1,98 lần mỗi lượt đúng" là sai về mặt công thức.

`:55`: `"bạn vẫn lưu giữ " + (failBase*100).toFixed(0) + "% dấu vết cũ"` với `failBase = p[10] = 0.7024`.
Thực tế `new_s_fail = w[10] * ((S+1)^w[11] - 1) * exp((1-R)*w[12])`, và còn bị chặn trên bởi
`pls = min(last_s, new_s_fail)`. Không phải tỷ lệ phần trăm cố định, và đúng như review nói, với `w[10]`
cho phép tới 10 thì câu chữ có thể vượt 100%.

Các điểm 50–99 (`:22, :36, :50, :64`) đúng là biến đổi tuyến tính thủ công
`min(99, max(50, round(75 + delta*k)))`, không phải đo năng lực nhận thức. Đây là lỗi nội dung sản phẩm,
không phải lỗi SRS — cách phân loại của review chính xác.

### 3.10 — Jitter chôn thẻ (P3): đúng

`srs/index.js:289`: `jitterMs = Math.round((lapsesToday * 37) % 3 * 3600000)`. Jitter chỉ phụ thuộc
`lapsesToday`, mà giá trị này khi chôn chỉ có thể là 2 hoặc 3. Tôi cho 5 thẻ khác ID cùng trạng thái:
**cả 5 đều hẹn đúng 06:00** (04:00 + 2h). Không có phân tán theo thẻ nào. Comment "jitter 0–3h để 62 thẻ
leech không dồn hết vào 04:00" (`:288`) không đạt mục tiêu — thực tế chỉ có hai giá trị hằng số cho toàn
bộ thẻ trong ngày. Mức P3 hợp lý (không sai dữ liệu, chỉ dồn tải và sai kỳ vọng).

## 4. Kiểm chứng phần "Đánh giá các thuật toán"

Phần này của review chủ yếu là đánh giá định tính. Tôi kiểm chứng các chỗ **kiểm chứng được**:

| Nhận định | Kết quả |
|---|---|
| "Công thức chính và 34 defaults khớp nguồn FSRS-7" | **Đúng.** 34 giá trị mặc định trùng khít `init_w` của upstream. `dualTraceForgettingCurve` khớp từng bước: `decay1_mag` clamp [0.01,0.95], `factor1` dựng trong log-space chặn 60, `factor2 = w26^(1/decay2)-1`, `d_timescale = exp((d-5)(w32-0.3))`, `weight1/weight2`, rescale `1e-5 + (1-2e-5)·retention`. `nextStability` khớp `new_s_fail`/`pls`/`sinc`/`where(success)`. |
| "Solver Newton trên log(t): có giới hạn bước/lặp" | **Đúng.** `forgetting.js:98–115`: 12 vòng, bước chặn ±2, thoát khi lệch < 1e-4 hoặc đạo hàm ~0. Không kiểm tra residual sau cùng, không có bisection dự phòng. |
| "chưa tái hiện lỗi solver mặc định" | **Đúng.** Với 34 weights mặc định, tôi quét 250 tổ hợp (S × D × tỉ lệ S_short): **0** ca lệch quá 1%, residual tệ nhất 0,0001. |
| "Adam... theo dõi calibration" | Adam trong không gian unit, clamp từng tọa độ — đúng như mô tả; chưa có regularization/constraint. |
| "Rules có owner isolation, nhánh `users/{uid}/**` ghi rộng không kiểm schema" | **Đúng.** `users/{userId}/{document=**}` chỉ `if isOwner(userId)`, trong khi nhánh legacy `celestial_vocab_sync` có `isValidCard()`. |
| "Undo chỉ trừ một phần stats" | **Đúng.** `revertGamificationAfterUndo` chỉ lùi XP/totalReviews/combo/heatmap/5 khoá daily/easyPresses/hardPresses, trong khi `trackReview` ghi thêm `accidentCount`, `consecutiveEasy`, `monthlyTotal/Correct`, `overdueReviewedToday`, `leechesHealed`, `typing*`, `totalTimeSpent`, `reviewsOnLastDay`, `karmaEncounter`… |
| "Không tìm thấy AGENTS.md" | **Đúng.** Không có `AGENTS.md` trong cây dự án. |

## 5. Những chỗ cần chỉnh trong review

### 5.1 Cơ chế của §4 (TSV) — quan trọng nhất

Như §3.4: round-trip **tại chỗ không** làm thẻ sống lại; chỉ nhập vào kho rỗng mới làm vậy. Ca tái hiện
nên đổi sang `planVocabularyImport(tsv, [])` và assert `newItems[0].isSuspended === true` là kỳ vọng. Nếu
giữ nguyên ca cũ (`parse... rows[0].card.isSuspended === false`), test vẫn xanh nhưng chỉ chứng minh "cột
bị ghi cứng thành false", không chứng minh được hệ quả mà người sửa cần bảo vệ.

### 5.2 §7 cần nối với solver để thấy chuỗi hỏng

Review để "solver" và "validator" ở hai chỗ khác nhau và ghi solver "chưa tái hiện". Nhưng hai lỗi này
ghép thành một chuỗi có hậu quả thật:

- Validator chấp nhận bộ weights vô lý (nhập tay hoặc từ Cloud).
- Solver **không** kiểm tra residual; khi không hội tụ, nó im lặng trả `t` hiện tại.

Tôi đo: lấy 400 bộ weights ngẫu nhiên **trong chính hộp mà validator cho phép**, có **24/400 (6%)** trường
hợp solver trả interval mà retrievability đạt được lệch mục tiêu hơn 1%, tệ nhất đạt R=0,157 so với mục
tiêu 0,90 (tức hẹn ôn sai cỡ vài bậc độ lớn). Không chứng minh được người dùng thật sẽ gặp, nhưng chứng
minh được rằng **validator + solver hiện tại không có lưới an toàn nào** giữa dữ liệu tham số và lịch ôn
được ghi xuống. Nên gộp §7 và khuyến nghị solver thành một việc, và coi đây là rủi ro dữ liệu chứ không
chỉ là "cấu hình trái ngữ nghĩa".

### 5.3 §1 nên nêu điều kiện trúng (như §3.1) để người sửa viết được test đúng

Nếu chỉ nói "có thể mất kết quả gộp", người sửa dễ viết test với cặp `6+2=8` (ca tôi thử, **không** mất)
rồi kết luận đã sửa xong. Test phải dùng cặp vượt mốc chữ số (9+1 → 10) hoặc, tốt hơn, assert trực tiếp
`mergedCard.srsUpdatedAt > max(hai đầu vào)`.

### 5.4 Số dòng lệch nhỏ (không ảnh hưởng kết luận)

`src/core/srs/index.js:274` trỏ vào dòng comment, khối cập nhật leech thật ở `:266–294`;
`review-log-prune.js:9` trỏ vào comment, hằng `MAX_REVIEW_LOG_ENTRIES` ở `:12`. Các vị trí còn lại đều
chính xác.

## 6. Những gì review bỏ sót hoặc xếp hạng thấp

1. **Undo không lùi đủ stats nuôi huy hiệu** (chỉ nêu trong bảng, không thành mục). `trackReview` ghi
   ~15 khoá mà `revertGamificationAfterUndo` chỉ lùi 2 khoá trong `gamification.stats`. Hệ quả: hoàn tác
   rồi làm lại sẽ **cộng dồn** `accidentCount`, `monthlyTotal`, `overdueReviewedToday`, `leechesHealed`,
   `totalTimeSpent`…, tức mở huy hiệu bằng lượt đã bị hoàn tác. Đây là lỗi tính đúng của gamification,
   cùng họ với §3.3 (định nghĩa "một lượt học" không thống nhất) nên đáng thành mục P2 riêng.
2. **Chuỗi validator → solver → lịch ôn** (§5.2). Đáng thành một mục, không chỉ một dòng khuyến nghị.
3. **`dedup.js:1227` hardcode `mergedCard.isLeech = mergedLapses >= 4`** thay vì dùng
   `LEECH_LAPSE_THRESHOLD`. Cùng vùng mã với §3.1/§3.2; nếu ngưỡng leech đổi, chỗ này lệch âm thầm.
4. **Điều kiện Undo không hoàn tác được** (`events.js:87–92`): nếu thẻ đã có `srsUpdatedAt` mới hơn thì
   Undo bị từ chối — đúng thiết kế, nhưng review nên ghi nhận vì nó là giới hạn của chính cơ chế Undo mà
   §3.2 đang bàn.
5. **Gộp trùng bỏ cờ tạm ngưng của thẻ phụ, và kết quả phụ thuộc thứ tự tham số** (chi tiết §9.A). Cùng họ
   với mục 4 của review nên nên gộp vào cùng đợt sửa "quyết định tạm ẩn phải sống sót qua thao tác dữ liệu".
6. **Comment lệch code ở cờ "cần viết lại"** (chi tiết §9.B). Nên sửa cùng mục 2, vì mục 2 đưa chính trường
   `needsReformulation` vào `MEMORY`.

Không có chỗ nào review **khen quá mức**: các điểm khen (tách module, outbox cùng transaction, CRDT
progress, bootstrap theo thẻ, gate không tự nhận cải thiện) tôi đều đối chiếu thấy có thật trong mã.

## 7. Đánh giá chất lượng báo cáo

**Điểm mạnh**
- Phân biệt rất tốt giữa "lỗi đã chứng minh" và "giả thuyết/rủi ro chưa chứng minh" (§7 bounds, solver,
  semantic dedup, retention 90%, rules đã deploy). Đây là chỗ phần lớn báo cáo audit tự đánh mất uy tín.
- Không sửa mã, không dùng báo cáo cũ làm bằng chứng, nói rõ `reproduce.mjs` exit 0 là "tái hiện được
  lỗi" — kỷ luật bằng chứng tốt.
- Ca tái hiện cho Quiz trích **nguyên hàm thật** từ nguồn và giả lập persistence, thay vì viết lại logic:
  đúng cách để không tự tạo ra lỗi giả.
- Giữ đúng đặc tả khi E2E xanh/đỏ mâu thuẫn (§8) — không hy sinh thuật toán để chiều test cũ.

**Điểm cần cải thiện**
- §4 mô tả sai đường gây hại (dẫn tới test bảo vệ sai chỗ).
- §1 và §2 chưa định lượng điều kiện trúng, nên người sửa khó viết test hồi quy đúng.
- Một số khuyến nghị ("thống nhất ý nghĩa đã xử lý", "JSON backup có schema") đúng nhưng chưa nêu tiêu
  chí nghiệm thu, nên khó chốt khi nào coi là xong.

**Thứ tự ưu tiên tôi đề xuất** (khác review ở chỗ gộp §1+§2+§4 thành một đợt "toàn vẹn dữ liệu đã lưu",
và đưa §7+solver lên trước §5):

1. §2 + §1 + §4 — toàn vẹn dữ liệu đã lưu và khôi phục được. Cùng vùng mã (`card-merge.js`, `tabular.js`,
   `import-plan.js`), sửa một đợt, test một đợt.
2. §3 + §6 + mục 6.1 — một hàm áp dụng review duy nhất; thống nhất đếm/cap/suspended/Undo.
3. §7 + solver residual/bisection — chặn dữ liệu tham số xấu trước khi nó ghi lịch ôn.
4. §5 — dữ liệu replay trước khi tin optimizer.
5. §8 (E2E theo đặc tả) + regression toàn luồng cho các ca đã tái hiện.
6. §9, §10, chính sách cram, bundle (chỉ còn 0,25 kB — cần kế hoạch trước khi thêm bất kỳ tính năng nào
   vào entry).

## 8. Giới hạn của lần kiểm chứng này

- Đã kiểm chứng ở tầng mã nguồn, hàm engine thật, và các đường tích hợp thuần (import plan, merge IDB,
  restore Undo). **Chưa** chạy E2E bằng trình duyệt; kết luận §8 dựa trên `predictNextIntervals` + đọc
  assertion + log `e2e.txt` của review, và cả ba khớp nhau.
- Chưa chạy hai thiết bị thật hay Firebase đã deploy; các nhận định về rules/đồng bộ vẫn là đọc file.
- Các ca "6%" và "4/10" là suy ra từ mã và tham số ngẫu nhiên trong hộp cho phép, không phải tần suất gặp
  trong dữ liệu người dùng thật.
- Không có dữ liệu học thật để đánh giá retention, hiệu quả typing bonus, chất lượng dedup ngữ nghĩa —
  giống giới hạn review đã nêu, và tôi xác nhận giới hạn đó là trung thực.

## 9. Phụ lục — kiểm chứng chéo độc lập

Năm kết luận then chốt (C1 TSV/tạm ngưng, C2 dedup revision, C3 hợp đồng MEMORY/Undo, C4 stats Undo,
C5 validator + solver) đã được đưa cho một mô hình độc lập (Gemini 3.8 Flash High qua Antigravity CLI) kiểm
tra **chỉ đọc**, với yêu cầu nêu dẫn chứng `file:line` và được phép bác bỏ. Kết quả:

- **C1–C5: cả năm đều được xác nhận TRUE**, độc lập với lập luận của tôi, kèm dẫn chứng dòng trùng khớp
  (kể cả trace so sánh chuỗi ASCII của tie-break: `'1'` < `'9'` nên mất bản gộp, `'8'` > `'6'` nên giữ —
  đúng như đo đạc 4/10 của tôi).
- Xác nhận thêm hai điểm tôi đã nêu: `buriedOn` **không** được hàng đợi dùng để lọc (chỉ cho toast/badge);
  `trackReview` ghi tới 16 khoá stats mà Undo chỉ lùi 2; nhánh training **không** áp ràng buộc thứ tự nào.
- Không phát hiện thêm lỗi mức HIGH nào ngoài 5 mục đã có.

Mô hình đó nêu thêm hai điểm nhỏ. Tôi tự kiểm chứng lại cả hai và **giữ lại**, nhưng chỉnh lại một điểm
cho chính xác hơn:

**A. Gộp trùng không gộp cờ tạm ngưng, và kết quả phụ thuộc thứ tự tham số** (mức thấp–trung bình).
`dedup.js:1193–1203` dựng `mergedCard` bằng `{ ...primary }`, chỉ OR mỗi `isStarred`. Đo được:

```
mergeDuplicateCards(active, suspended) → merged.isSuspended = false
mergeDuplicateCards(suspended, active) → merged.isSuspended = true
flagsUpdatedAt vẫn được cấp revision mới ⇒ kết quả lan sang Cloud
```

Mô tả gốc của mô hình là "tạm ngưng của thẻ phụ bị bỏ mà không báo". Thực tế nặng hơn một bậc: cùng một
cặp thẻ cho hai kết quả khác nhau tùy thứ tự truyền vào, trong khi `isStarred` cùng nhóm FLAGS lại được
OR. Đây cùng họ với mục 4 của review (quyết định "tạm ẩn" không sống sót qua thao tác dữ liệu) nên nên
sửa chung đợt.

**B. Comment lệch code ở cờ "cần viết lại"** (mức thấp). `srs/index.js:136` ghi "tự hết khi thẻ đã trả lời
đúng **2 lần liên tiếp**", nhưng `:137` chỉ cần `rating > 1 && lapsesToday === 0`. Đo được: sang ngày mới,
**một** lần đúng là cờ đã xoá; còn trong cùng ngày đã có 1 lapse thì một lần đúng **chưa** xoá. Nghĩa là
quy tắc thật là "lần đúng đầu tiên của một ngày chưa có lapse", không phải "hai lần liên tiếp". Cần sửa
comment hoặc sửa code cho khớp — và nên làm cùng lúc với mục 2, vì mục 2 đưa chính trường này vào `MEMORY`.

Toàn vẹn trong lần chạy đó: hash SHA-256 của 147 file `src/`, `tests/`, `tools/` trước và sau **trùng
khít**, `git status` không đổi — tức agent phụ chỉ đọc, không có chỉnh sửa đồng thời.

## Kết luận

Review này **đáng tin để hành động**: 10/10 phát hiện tái hiện được, mọi số liệu công bố khớp khi chạy
lại, phần khen ngợi cũng đúng (kể cả đối chiếu công thức với upstream), và năm kết luận then chốt đã được
một mô hình độc lập xác nhận lại. Hai chỗ phải sửa trước khi dùng
làm đặc tả sửa lỗi: cơ chế của mục 4 (nhập lại tại chỗ không làm thẻ sống lại) và điều kiện trúng của mục
1 (chỉ mất khi giá trị gộp vượt mốc so sánh chuỗi). Một chỗ cần nâng mức: mục 2 gây chôn thẻ oan ngay sau
khi Undo, không chỉ để lại bộ đếm lệch.
