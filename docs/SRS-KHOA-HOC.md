# Ba nâng cấp SRS dưới góc nhìn khoa học trí nhớ

Tài liệu này không phải "giải thích cho có". Mỗi đề xuất đều bị phản biện, và có
đề xuất bị **bác bỏ** rồi thay bằng phương án khác. Ghi lại cả phần bác bỏ để
sau này không ai (kể cả tác giả) lặp lại sai lầm cũ.

Bối cảnh dữ liệu thật (bản xuất `info.json`, 2154 từ):

| Chỉ số | Giá trị |
|---|---|
| New / Learning / Mastered | 1441 / 2 / 711 |
| Đang tới hạn ngay | **1649** (1441 New + 209 Mastered quá hạn + 2 Learning) |
| Thẻ trùng lặp | **13 nhóm / 27 thẻ** — 10 nhóm có 1 bản đã học + 1 bản còn New |
| Leech (quên ≥ 4 lần) | **97 thẻ**, 62 tới hạn ngay |
| difficulty ≥ 9.5 | 115 thẻ |
| Giới hạn thẻ mới/ngày | 5 |

Triệu chứng người dùng báo: *"đã liên tiếp trả lời đúng mà web vẫn hiển thị lại"*.
Kiểm tra dữ liệu cho thấy **logic xếp lịch không sai** (0 ca "Mastered đã ôn hôm
nay mà vẫn tới hạn"), nên nguyên nhân nằm ở **cấu trúc dữ liệu** và **chính sách
relearning**, không phải ở công thức FSRS.

---

## §A. Gộp thẻ trùng — ĐỒNG Ý, nhưng phương án ban đầu SAI

### Vì sao gộp là đúng (khoa học)

1. **Một cue → một trace.** Thẻ trùng nghĩa là cùng một từ tiếng Anh tồn tại như
   hai "ký ức" riêng trong hệ thống. Mỗi bản có lịch riêng, nên mỗi bản chỉ nhận
   một nửa số lần retrieval đáng lẽ thuộc về nó ⇒ **giãn cách thực tế bị chia đôi**,
   trong khi giãn cách là biến số quyết định độ bền (hội tụ của hàng trăm nghiên
   cứu, tổng hợp trong Cepeda et al., 2006, *Psychological Bulletin*).
2. **Nhiễu giao thoa (interference).** Hai bản xuất hiện gần nhau tạo hiện tượng
   *cue overload* / output interference: một cue gắn với hai trace ⇒ truy xuất
   nhập nhằng, người học thấy "quen quen" mà không nhớ ra. Đây đúng là cảm giác
   "từ này vừa học xong sao lại hiện".
3. **Làm hỏng tham số FSRS.** FSRS (Ye et al., 2023 — benchmark trên ~10⁴ bộ thẻ,
   ~7·10⁸ lượt ôn) ước lượng *difficulty* và *stability* từ **lịch sử của một item**.
   Chia lịch sử cho hai bản làm cả hai ước lượng lệch, và các tham số cá nhân
   (`userFsrs7Params`) học từ log cũng bị nhiễu.
4. **Ảo giác năng lực.** Gặp lại bản sao ngay sau khi vừa trả lời ⇒ fluency tăng
   giả tạo, không phải trí nhớ tăng (Koriat & Bjork, 2005; Soderstrom & Bjork,
   2015). Massed exposure tạo cảm giác "đã thuộc" nhanh hơn spaced retrieval
   nhưng giữ được ít hơn.

### Phản biện phương án ban đầu của tôi ("giữ bản tiến độ cao nhất")

Đề xuất cũ: *giữ thẻ có trạng thái/stability/reps cao nhất, xoá bản kia.* **Sai**,
vì nó **thổi phồng** trí nhớ:

> Thẻ A: Mastered, stability 60 ngày, reps 9, chưa từng quên.
> Thẻ B: New nhưng **đã quên 3 lần**.
> Gộp kiểu "giữ bản khoẻ" ⇒ thẻ biến mất **2 tháng**. Trong khi bằng chứng mới
> nhất về từ này là *quên ba lần*.

Chọn bản khoẻ là tối ưu cho **cảm giác** (ít thẻ phải ôn), không tối ưu cho **trí
nhớ**. Trong SRS, sai lệch phải nghiêng về phía **ôn nhiều hơn**: ôn thừa một lượt
tốn vài giây, bỏ sót một từ đã quên tốn cả từ đó.

### Phương án đã triển khai (A′)

`mergeDuplicateCards()` nay gộp trạng thái **theo hướng thận trọng**:

| Trường | Quy tắc | Lý do |
|---|---|---|
| `lapses` | **tổng** hai bản | mỗi lần quên là bằng chứng trace yếu |
| `reps` | **max** (không cộng) | tránh reps ảo, vốn làm hỏng `isFirstReview` |
| `difficulty` | **max** (khó hơn) | đánh giá thấp độ khó sẽ giãn cách quá nhanh |
| `stability` | **min**; nếu chỉ một bên có số ⇒ ×0.8 | lịch sử còn lại chưa biết ⇒ hạ mức tin |
| `srsInterval` | **min**, và **≤ 10 ngày nếu đã từng quên** | không cho thẻ vừa quên biến mất |
| `srsDueDate` | **min** (không dời hạn) | gộp không được phép trì hoãn ôn tập |
| `lastReviewDate` | **max** | mốc thời gian thật gần nhất |
| `srsStatus` | có bản chưa Mastered ⇒ **Learning** | nghiêng về "còn phải học" |
| `isLeech` | `lapses ≥ 4` sau khi cộng | giữ đúng ngữ nghĩa leech |

**Ghi chú phản biện còn lại (đã chấp nhận rủi ro ở mức nào):** gộp chỉ nên áp cho
cặp **cùng nghĩa**, không gộp theo mặt chữ tiếng Anh thuần. Từ đồng âm khác nghĩa
(`bank` = bờ sông / ngân hàng) là hai ký ức hợp lệ và **không được** gộp. Vì vậy
luồng gộp vẫn giữ bước xác nhận nghĩa; test `A′: gộp vẫn giữ nguyên nội dung`
khoá việc không được làm mất nghĩa nào khi gộp.

---

## §B. Chính sách leech — ĐỒNG Ý một phần, "chôn cả ngày" một mình là NGUY HIỂM

### Khoa học nói gì về leech

1. **Massed practice ≠ học.** 62 thẻ leech tới hạn ngay, mỗi lần sai lại hẹn
   +10 phút ⇒ trong một buổi có thể gặp cùng một thẻ 4–6 lần. Đó là massed
   practice: kết quả tức thời tốt, giữ lại kém (Cepeda et al., 2006).
2. **Học thuyết leech của SuperMemo**: thẻ trượt nhiều lần là dấu hiệu **item hỏng**,
   không phải "người học kém". Cách chữa là **viết lại item** (đơn giản hoá, thêm
   mnemonic, tách thẻ, bỏ nhiễu). Anki cũng mặc định *tag + suspend* để buộc người
   học xem lại thẻ, chứ không chỉ giãn cách.
3. **Desirable difficulty** (Bjork & Bjork, 2011): khó vừa sức thì tốt; khó quá
   mức (11 lần quên) thì chỉ tạo thất vọng và né tránh.

### Phản biện phương án ban đầu của tôi ("chôn leech trong ngày")

Chỉ chôn ⇒ hai hệ quả xấu:

- **Né tránh**: thẻ khó nhất bị đẩy khỏi tầm mắt, không ai sửa → tuần sau quay lại
  y nguyên, thậm chí tệ hơn vì mất ngữ cảnh.
- **Giấu vấn đề**: người học không biết mình đang có 97 thẻ "hỏng" — mất khả năng
  ra quyết định (sửa thẻ, tách thẻ, hay bỏ hẳn từ đó).

Ngoài ra "chôn" **không có bằng chứng trực tiếp** trong tài liệu về trí nhớ; nó là
suy luận từ hai mảng có bằng chứng mạnh (giãn cách + giao thoa). Cần nói rõ mức
tin cậy đó thay vì trình bày như chân lý.

### Phương án đã triển khai (B′)

| Tình huống | Hành vi | Căn cứ |
|---|---|---|
| Leech sai **lần 1** trong ngày | Hẹn lại **10 phút** (relearning step) | giãn cách trong ngày, đủ để phải truy xuất lại thật |
| Leech sai **lần 2** trong cùng ngày | **Chôn tới 04:00 sáng mai** (+ jitter 0–3h), bật `needsReformulation` | cắt massed practice; jitter tránh dồn 62 thẻ vào một giờ |
| Sang ngày mới | Bộ đếm `lapsesToday` **reset** | tránh chôn oan vì dữ liệu ngày cũ |
| Sau khi trả lời đúng | Gỡ cờ `needsReformulation` | thẻ đã ổn thì không làm phiền |
| `lapses` | **luôn tăng**, không reset | không giả vờ thẻ là mới — đây là chỗ dễ tự lừa mình nhất |

Điểm quan trọng nhất: **chôn không phải xoá**. Thẻ vẫn còn, vẫn tới hạn, vẫn giữ
`lapses`; chỉ rời khỏi phiên hôm nay.

---

## §C. "Dễ" → nhảy thẳng Mastered — BÁC BỎ HOÀN TOÀN

Đây là đề xuất **tệ nhất** trong ba đề xuất ban đầu của tôi. Lý do bác bỏ:

1. **Tự đánh giá độ dễ là tín hiệu yếu và thiên lệch.** Judgments of learning bị
   thổi phồng bởi fluency (Koriat & Bjork, 2005): thẻ vừa gặp lại, hoặc chữ dễ
   đọc, được cho là "đã thuộc" nhiều hơn thực tế.
2. **Bỏ lịch = bỏ chính cơ chế tạo trí nhớ bền.** Giãn cách là thứ tạo ra độ bền;
   một lần "Dễ" không thay thế được các lần truy xuất ở khoảng cách tăng dần.
3. **Phá tham số FSRS.** Stability chỉ nên tăng khi có bằng chứng truy xuất thành
   công ở *khoảng cách thực*. Nhảy sang Mastered đặt interval từ **không có dữ
   liệu**, và log đó còn được dùng để huấn luyện `userFsrs7Params` ⇒ làm bẩn tham
   số cá nhân về sau.
4. **"Mastered giả" là leech trá hình.** Từ biến mất 2–12 tháng, quên lúc nào không
   ai biết, và khi quay lại thì `lapses` tăng vọt. Cái giá phải trả **muộn và đắt**
   hơn nhiều so với việc ôn đúng lúc.

### Kiểm tra lại mã hiện tại

Hoá ra bản đang chạy **không hề** có đường tắt đó: nút "Dễ" đi qua
`scheduleLearningStep()` và **tốt nghiệp với interval do FSRS tính, bị trần 7 ngày**
cho thẻ mới. Tức là về cơ bản đã đúng tinh thần khoa học. Vậy "nâng cấp C" đúng
nghĩa là **bịt lỗ hổng còn lại**, không phải thêm đường tắt:

> Lỗ hổng: khi thẻ **đã từng trượt** (`lapses > 0`), bản cũ đặt
> `graduationCap = MAX_INTERVAL_DAYS` (365) ⇒ thẻ vừa quên 1 lần, bấm "Dễ", có thể
> được hẹn **365 ngày**. Snapshot test B13 trước đây ghi đúng con số 365.

### Phương án đã triển khai (C′)

`POST_LAPSE_GRADUATION_CAP_DAYS = 10`: thẻ đã từng quên, khi tốt nghiệp lại, interval
bị trần **10 ngày** (thay vì 365). Thẻ mới tinh vẫn giữ trần 7 ngày. Không có bất kỳ
đường tắt nào đưa thẻ lên lịch dài khi chưa có retrieval ở khoảng cách ≥ 1 ngày.

Nếu sau này muốn chiều người dùng "từ này tôi đã biết", phương án **trung thực** là
**tạm ẩn (suspend)** thẻ đó — nó rời khỏi SRS một cách minh bạch và có thể bật lại —
chứ **không** gọi nó là "Mastered".

---

## §D. Sửa lỗi UI "đứng khi đang gõ từ"

### Đo trước khi sửa

Chrome headless, vào chế độ gõ, focus ô nhập:

```
isTypingActive: true   animFrameId: null   số lệnh vẽ canvas trong 500ms: 0
```

Nguyên nhân nằm ở `src/ui/celestial-canvas.js`:

```js
export function setTypingActive(active) {
    isTypingActive = !!active;
    if (isTypingActive) stopAnimationLoop();   // ← dừng HẲN vòng vẽ
```

Nghĩa là **hễ có input/textarea được focus là cả bầu trời sao đứng im** — người
dùng thấy như app treo, dù main thread hoàn toàn rảnh (không có long task nào khi
gõ: p95 khung hình 9 ms).

### Sau khi sửa

| Trạng thái | Lệnh vẽ / 500 ms | animFrameId |
|---|---|---|
| Không gõ (idle, thiết kế ngủ để 0% GPU) | 0 | `null` |
| **Đang gõ** | **320** | **78** (vòng vẽ sống) |

Thay đổi:

1. `setTypingActive()` **không dừng** vòng vẽ nữa, chỉ đổi nhịp.
2. Nhịp khi gõ: desktop **20 FPS**, mobile **~12 FPS** (vẫn nhường frame budget cho
   bàn phím ảo / IME như mục tiêu ban đầu, nhưng không đóng băng hình).
3. `isIdle = !isTypingActive && …` — đang gõ không bị coi là idle (nếu không, sau
   1.2 s vòng vẽ tự ngủ và sao lại đứng).
4. `keydown` trong input/textarea được tính là hoạt động (gộp 120 ms) ⇒ gõ phím
   cũng đánh thức engine.
5. Thêm `getCelestialDiagnostics()` + `window.__celestialCanvasDiagnostics` để **đo
   được** trạng thái này về sau (trước đây không có cách nào biết sao có vẽ hay không).

---

## §F. "Tạm ẩn" — cách trung thực để nói "tôi đã biết từ này", và 3 lỗi phát hiện dọc đường

§C kết luận: muốn chiều "từ này tôi đã biết" thì dùng **tạm ẩn (suspend)**, đừng gọi
là Mastered. Khi triển khai thì phát hiện tính năng này **chưa từng hoạt động**:

| Nơi | Dòng (trước) | Hành vi |
|---|---|---|
| `src/core/card-merge.js` | 34 | `normalizeCard` hardcode `isSuspended: false` ⇒ **mọi lần nạp xoá cờ** |
| `src/core/card-merge.js` | 103 | merge hai bản ghi: `result.isSuspended = false` |
| `src/core/state.js` | 283–289 | migration "chế độ tạm ngưng đã bị hủy bỏ" xoá cờ của **mọi** thẻ |
| `src/core/queue.js` | — | **không nơi nào đọc** `isSuspended` ⇒ cờ vô nghĩa với lịch ôn |

Nói cách khác: trong nhiều phiên bản, người dùng **không có** cách nào nói "từ này
tôi đã biết" ngoài đường tắt "Dễ → Mastered" — đúng cái sai khoa học ở §C. Đây là lý
do §C không thể chỉ là "bác bỏ" mà phải kèm một lựa chọn thay thế **hoạt động được**.

Đã sửa: parse đúng (`true`/`1`/`'true'`), merge theo nhóm **FLAGS** (cùng
`flagsUpdatedAt` với `isStarred`) để bản mới hơn không ghi đè quyết định của người
dùng, bỏ migration xoá cờ, lọc `isSuspended` ở **cả 5 vòng** dựng hàng đợi và trong
`isNaturallyDue`, thêm ô tick trong form thêm/sửa và nhãn **"Tạm Ẩn"** trên thẻ.

Đo end-to-end trên `dist` thật (Chrome headless):

```
form   : { formOpened: true, checkboxFound: true }
submit : { saved: true, savedSuspended: true }        ← IDB nhận đúng cờ
reload : { cardShown: "English Word", suspendedNotShown: true }  ← bị loại khỏi phiên học
```

Bài học giống §D: **cờ dữ liệu không được đọc ở đâu thì tính năng không tồn tại** —
và chỉ phép đo end-to-end mới phát hiện được, đọc mã nguồn thì không.

---

## §E. Điều gì KHÔNG được làm (để không tự phá kết quả)

- Không nới trần interval để "bớt thẻ phải ôn" — đó là đánh đổi bằng trí nhớ.
- Không reset `lapses` khi chôn/sửa thẻ; chỉ hạ `stability` và giữ lịch sử.
- Không dùng "Dễ" như một đường tắt trạng thái.
- Không xoá cờ "tạm ẩn" trong bất kỳ normalize/merge/migration nào: đó là quyết định
  của người dùng, không phải dữ liệu suy ra được.
- Không ẩn thẻ khó khỏi tầm mắt mà không có hành động sửa thẻ.
- Không đo "sao có chạy" bằng cách so pixel (sao trôi chậm nên ảnh giống nhau) —
  phải đếm lệnh vẽ.

## Tham khảo

- Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T., & Rohrer, D. (2006). Distributed
  practice in verbal recall tasks: A review and quantitative synthesis.
  *Psychological Bulletin*, 132(3), 354–380.
- Roediger, H. L., & Karpicke, J. D. (2006). Test-enhanced learning.
  *Psychological Science*, 17(3), 249–255.
- Bjork, E. L., & Bjork, R. A. (2011). Making things hard on yourself, but in a good
  way: Creating desirable difficulties to enhance learning.
- Koriat, A., & Bjork, R. A. (2005). Illusions of competence in monitoring one's
  knowledge during study. *JEP: LMC*, 31(2), 187–194.
- Soderstrom, N. C., & Bjork, R. A. (2015). Learning versus performance: An
  integrative review. *Perspectives on Psychological Science*, 10(2), 176–199.
- Ye, J. et al. (2023). FSRS: A modern, efficient spaced repetition scheduler
  (benchmark trên ~10⁴ bộ thẻ, ~7·10⁸ review log).
- Wozniak, P. A. — SuperMemo: "Leech" và nguyên tắc *reformulate the item*.
- Anki Manual — Leech handling, learning steps, bury siblings.
