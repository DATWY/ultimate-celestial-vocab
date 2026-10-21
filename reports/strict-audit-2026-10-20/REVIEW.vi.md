# Đánh giá độc lập Celestial Vocab — 20/10/2026

> Đây là báo cáo trước khi sửa. Xem FIXES.vi.md để biết các thay đổi và giới hạn hiện tại; dùng `npm test` để kiểm tra bản đã sửa. Script reproduce.mjs và evidence.json là bằng chứng của bản được đánh giá ban đầu.

**Nhận định:** ứng dụng có bản sắc thị giác và bộ tính năng khá đầy đủ, nhưng cơ chế bảo toàn dữ liệu và tính nhất quán của luồng học chưa tương xứng. Với tiêu chí khắt khe, chưa nên coi bản hiện tại là đã đủ tin cậy để dùng nhiều thiết bị với dữ liệu học quan trọng.

## Phạm vi và độ chắc chắn

- Đọc mã nguồn hiện tại: khởi động, state, IndexedDB, hàng đợi, SRS, đồng bộ, quiz, typing, nhập/xuất, modal và các phần giao diện liên quan.
- Đã chạy 12 phép tái hiện lỗi bằng Node, sử dụng các hàm trích trực tiếp từ mã nguồn và thay phụ thuộc bằng mô phỏng. Kết quả nằm trong `evidence.json`; chạy lại bằng `node reports/strict-audit-2026-10-20/reproduce.mjs` tại thư mục dự án. Đây là kiểm tra tái hiện lỗi, không phải một bộ regression test đang chứng minh ứng dụng hoạt động đúng.
- Đã kiểm tra cú pháp các tệp `.js` trong `src` và `tools`: không phát hiện lỗi cú pháp.
- Đã xem 8 ảnh desktop/mobile có sẵn trong `reports/WEB_DISCOVERY_FOR_CHATGPT/screenshots`, gồm trang học sáng/tối, mặt sau thẻ, onboarding, tổng quan, từ vựng, dữ liệu và thiết lập quiz. Đây là ảnh lưu trong dự án, **không phải ảnh chụp mới của phiên kiểm tra này**.
- Máy chủ Vite chạy được. Trình duyệt tích hợp không truy cập được đúng máy chủ workspace; một địa chỉ localhost khác trả về ứng dụng Kanban nên không được dùng làm bằng chứng cho Celestial. Chưa hoàn thành kiểm thử giao diện trực tiếp, đo hiệu năng hoặc accessibility tự động.
- Không đọc dữ liệu người dùng trên Firebase, không thử khai thác dịch vụ thật, không sửa mã ứng dụng, không build hay triển khai.

P1: ưu tiên cao vì ảnh hưởng bảo mật, dữ liệu hoặc kết quả học. P2: cần sửa vì làm sai hành vi trong tình huống cụ thể. Các mức này là đánh giá tác động, không phải chứng nhận bảo mật.

## Những lỗi đã tái hiện

### 1. [P1] Đồng bộ đẩy bản cũ lên trước khi hợp nhất, làm mất tiến độ mới trên cloud

**Nguồn:** `src/core/sync.js:47–96`, đặc biệt `batch.set(..., {merge:true})` ở dòng 86; `src/core/firebase.js` gọi flush ở Phase 0 trước Phase 1 pull.

**Tình huống:** A giữ bản thẻ cũ rồi sửa nghĩa trong lúc B đã ôn thẻ đó. Khi A đồng bộ, flush ghi toàn bộ đối tượng A lên cloud, bao gồm trường SRS cũ. `merge:true` chỉ hợp nhất các trường của tài liệu Firestore; nó không thực hiện quy tắc giải quyết xung đột của ứng dụng.

**Kết quả mô phỏng:** stability trên cloud từ 20 trở về 2, `lastReviewDate` từ 200 trở về 100. Bước pull tiếp theo trên A chỉ còn đọc được dữ liệu đã bị ghi đè. Một thiết bị còn giữ bản tốt có thể phục hồi sau, nhưng quy trình hiện tại không bảo đảm điều đó.

**Hướng sửa:** đọc/hợp nhất với phiên bản remote trước khi ghi, dùng transaction hoặc kiểm tra revision; phân biệt thay đổi nội dung với thay đổi tiến độ. Cần có kiểm thử hai thiết bị cùng sửa, ôn và xóa một thẻ.

### 2. [P1] Hiệu chỉnh giờ máy chủ bằng thời gian của chính dữ liệu thẻ

**Nguồn:** `src/core/firebase.js:47–59`, `89–100`, `133`.

`toMillis()` gọi `updateServerTimeOffset()` cho mọi timestamp, kể cả ngày đến hạn và ngày ôn trước đó. Các mốc này không đại diện cho thời gian hiện tại của máy chủ.

**Kết quả:** chỉ chuyển đổi một ngày đến hạn sau 30 ngày đã làm `getCalibratedNow()` nhảy lên 30 ngày. Các lần chuyển đổi sau còn có thể đổi offset theo lịch sử của thẻ khác. Giá trị này được dùng tạo `updatedAt` khi merge, nên có thể phá thứ tự mới/cũ và mốc pull.

**Hướng sửa:** `toMillis()` phải thuần chuyển kiểu. Chỉ hiệu chỉnh clock từ một phép đo thời gian máy chủ thực sự; dùng thời gian commit/revision đáng tin cậy cho đồng bộ.

### 3. [P1] Dữ liệu từ vựng đi trực tiếp vào HTML của quiz

**Nguồn:** `src/features/quiz.js:188`, `220`. Ngoài ra cần rà soát `showToast()` và phần hiển thị trùng nghĩa nội bộ trong `src/ui/modal.js`.

**Tình huống:** trường English từ TSV hoặc dữ liệu đồng bộ chứa HTML. Khi trả lời sai hoặc bỏ qua, ứng dụng nội suy nguyên văn trường này vào `innerHTML`.

**Kết quả:** chuỗi kiểm tra vô hại `<b data-audit="inert">cat</b>` được giữ nguyên dưới dạng markup trong HTML đầu ra. Đây là đường chèn HTML có khả năng dẫn đến stored XSS nếu đầu vào chứa phần tử và thuộc tính thực thi được; chưa chạy mã độc hoặc kiểm tra khai thác trên trình duyệt thật.

**Hướng sửa:** tạo phần tử rồi gán `textContent` cho dữ liệu người dùng; hoặc escape dữ liệu nhất quán trước khi dựng HTML. Việc đã có `escapeHTML()` ở những màn khác không bảo vệ được các đường bỏ sót này.

### 4. [P2] Đồng bộ bỏ sót và có thể làm mất phiên âm

**Nguồn:** `src/core/firebase.js:127–241`, `251–289`; đối chiếu `src/ui/modal.js:151`, `src/ui/render.js:230–231`.

Form, import và renderer dùng `pronunciation`; hàm merge và so sánh lại dùng `phonetic`.

**Kết quả:** hai thẻ chỉ khác `pronunciation` bị coi là bằng nhau. Đối tượng merge không có `pronunciation`. Khi kết quả merge được dùng thay thẻ local do một khác biệt SRS/nội dung khác, phiên âm có thể biến mất khỏi giao diện. Firestore merge có thể còn giữ trường cũ, nhưng điều đó không sửa được lỗi đối tượng local.

**Hướng sửa:** thống nhất schema, migrate dữ liệu cũ và kiểm thử round-trip từng trường từ form → local → cloud → local → xuất tệp.

### 5. [P1] Một lần ôn trên bản nội dung cũ có thể xóa sửa chữa nội dung của máy khác

**Nguồn:** `src/core/firebase.js:131–133`, `185–195`; `src/core/srs/index.js` cập nhật `updatedAt` sau mỗi lượt ôn.

**Tình huống:** A sửa nghĩa ở thời điểm 100. B vẫn giữ nghĩa cũ nhưng ôn thẻ ở thời điểm 200. Merge chọn nội dung của B vì dùng `updatedAt` chung cho cả nội dung và SRS.

**Kết quả:** nghĩa đã sửa quay về nghĩa cũ. Dù code gọi đây là các vector độc lập, timestamp nội dung chưa độc lập.

**Hướng sửa:** có revision/timestamp riêng cho nội dung, SRS và flags; hoặc lưu thao tác thay đổi theo trường thay vì dùng timestamp chung cho toàn thẻ.

### 6. [P2] Tag đã xóa và nội dung cố ý để trống tự xuất hiện lại

**Nguồn:** `src/core/firebase.js:189–203`.

Tags luôn được union, nên không biểu diễn được thao tác bỏ tag. `pickNonEmpty()` lấy giá trị cũ khi phiên bản mới là chuỗi rỗng, nên không biểu diễn được thao tác xóa ví dụ/ghi chú.

**Kết quả:** bản mới có `tags: []`, `example: ''` hợp nhất với bản cũ lại thành `['old']` và `'old example'`.

**Hướng sửa:** phân biệt thiếu trường với chủ động xóa trường; có revision hoặc tombstone cho thao tác xóa tag.

### 7. [P2] Sửa thẻ trong lúc batch đang gửi có thể bị xóa khỏi hàng chờ đồng bộ

**Nguồn:** `src/core/sync.js:64–96`.

Queue chỉ giữ ID. Khi batch đang chờ commit, nếu cùng ID được sửa và thêm lại vào Set, commit cũ vẫn gọi `_syncQueue.delete(id)` mà không kiểm tra phiên bản đã gửi.

**Kết quả:** dữ liệu gửi là `'old'`, dữ liệu hiện tại là `'new'`, nhưng queue còn 0 phần tử. Local vẫn có bản mới; một smartSync khác có thể cứu tình huống, nhưng hàng chờ không còn bảo đảm gửi bản mới đúng hạn.

**Hướng sửa:** giữ revision/generation theo ID; chỉ đánh dấu sạch nếu revision hiện tại trùng revision đã commit.

### 8. [P2] Giới hạn từ mới tăng nhiều lần trong cùng ngày mà không có thêm dữ liệu học

**Nguồn:** `src/core/queue.js:18–44`, `118–123`.

Mỗi lần dựng queue, hàm tính limit lấy `currentLimit` đã điều chỉnh trước đó rồi cộng/trừ tiếp theo cùng một retentionHistory. Sau đó kết quả lại được ghi vào `currentLimit`.

**Kết quả:** giữ nguyên retention 90%, limit từ 15 đi qua 20 → 25 → 30 → 35 → 40 chỉ sau 5 lần tính. Nhánh retention thấp có vấn đề đối xứng.

**Hướng sửa:** điều chỉnh tối đa một lần mỗi ngày, gắn với `lastAdjustedDate` và đầu vào cố định của ngày đó. Việc đổi bộ lọc hoặc dựng lại UI phải không làm thay đổi giới hạn.

### 9. [P1] Bấm Bỏ qua liên tiếp chấm nhiều lần cùng một câu và có thể phạt SRS nhiều lần

**Nguồn:** `src/features/quiz.js:196–230`.

Handler chỉ kiểm tra `quizInProgress`. Nó khóa input nhưng không khóa nút bỏ qua hoặc đánh dấu câu đã được chấm. Chỉ số câu chỉ tăng sau 1,2 giây.

**Kết quả:** ba lần gọi Bỏ qua trước khi timer chạy tạo 3 câu sai và 3 timer, trong khi vẫn đang ở câu số 0. Nếu thẻ nằm trong vocabulary, mỗi lần còn đi qua nhánh phạt SRS. Sau đó các timer có thể khiến bài nhảy nhiều câu.

**Hướng sửa:** trạng thái chấm/chuyển câu riêng, khóa toàn bộ hành động ngay lần đầu, bảo đảm một câu chỉ commit kết quả một lần.

### 10. [P2] Timer của quiz cũ có thể làm bỏ câu trong quiz mới

**Nguồn:** `src/features/quiz.js:226–230`; đối chiếu `showQuizSetup()`, `startQuiz()`, `finishQuiz()`.

Timer chuyển câu không có ID để hủy và không ràng buộc với phiên quiz. Dừng/khởi động lại bài không làm callback cũ mất hiệu lực.

**Kết quả:** tạo timer ở phiên cũ, khởi tạo phiên mới tại index 0, chạy callback cũ thì phiên mới nhảy sang index 1.

**Hướng sửa:** hủy timer khi kết thúc/đổi phiên; callback kiểm tra session ID và question ID trước khi đổi trạng thái.

### 11. [P2] Hoàn tác lượt học đầu tiên có thể xóa log của từ khác

**Nguồn:** `src/events.js:86`; `src/core/state.js:530–537`; phần tạo log trong `src/core/srs/index.js`.

Lần đầu ôn một thẻ New bình thường có thể trả `log: null` vì elapsed time bằng 0 và reps chưa lớn hơn 1. Nhưng Undo luôn pop phần tử cuối của toàn bộ reviewLogs, không kiểm tra lượt vừa rồi có sinh log hay không.

**Kết quả:** thẻ mới không tạo log, Undo lại xóa log lịch sử của `older-card`. Điều này làm bẩn dữ liệu huấn luyện. Undo còn chưa hoàn trả `dueDoneToday` và `learningDoneToday` tương ứng với các nhánh tăng ở `processSrsFeedback()`.

**Hướng sửa:** snapshot giữ ID log thực sự được tạo và các delta thống kê; hoàn tác đúng các thay đổi của lượt đó. Nếu Undo phải tồn tại qua nhiều thiết bị, cần biểu diễn được thao tác đảo ngược trong mô hình đồng bộ.

### 12. [P2] Treo tab qua nửa đêm giữ lại bộ đếm của ngày trước

**Nguồn:** `src/core/state.js:717–740`; thứ tự cập nhật trong `src/events.js:148–190`.

Nhánh đổi ngày của `recordReviewResult()` reset new/todayCorrect/todayTotal, nhưng không reset due/learning. Các hàm tăng bộ đếm còn được gọi trước bước kiểm tra đổi ngày.

**Kết quả:** ngày đã chuyển sang 20/10 nhưng vẫn giữ `dueDoneToday: 8`, `learningDoneToday: 3` từ 19/10. Lượt new đầu ngày còn có thể bị reset mất sau khi vừa tăng.

**Hướng sửa:** một hàm rollover duy nhất chạy trước mọi cập nhật và trước khi tính queue; reset toàn bộ bộ đếm theo ngày một cách nhất quán.

## Những vấn đề xác nhận qua mã nguồn nhưng chưa kiểm thử tích hợp

**Optimizer nền không khớp engine đang sử dụng.** `worker-manager.js:50` lưu `recallParams/lapseParams` qua `setUserSrsParams()`, trong khi engine hiện tại đọc bộ 34 `userFsrs7Params`. Worker vẫn tối ưu mô hình 9 chiều cũ. Ngoài ra không tìm thấy nơi gọi `checkAndRunOptimizer()` trong luồng ứng dụng, ngoài chính định nghĩa của nó. Các lệnh dev gọi `runOptimizer()` riêng. Vì vậy chưa có căn cứ để nói việc học bình thường tự huấn luyện và áp dụng bộ 34 tham số. Tool train offline là đường khác, không bị kết luận là hỏng từ phát hiện này.

**Gamification và reviewLogs có đường ghi đè trực tiếp.** `syncGamificationToFirebase()` ghi toàn bộ bản local lên các tài liệu dùng chung, không hợp nhất trước. Trong đường smartSync, lấy max XP/review cũng không cộng được hai nhánh học offline độc lập, và có thể làm sống lại XP đã trừ do Undo hoặc tiêu vật phẩm. Cần kiểm thử hai thiết bị với lịch sử rẽ nhánh và thao tác trừ, không chỉ kiểm tra đồng bộ tuần tự.

**Chưa có phân vùng tài khoản trong client.** Các collection và tài liệu như `celestial_user_sync/gamification` là đường cố định, không theo UID; không thấy luồng Firebase Auth. Nếu đây là ứng dụng cá nhân một kho dữ liệu thì đây có thể là giới hạn thiết kế có chủ ý. Nếu mở cho nhiều người dùng độc lập, đây là thiếu sót nền tảng. Chưa đọc Security Rules production nên không kết luận cơ sở dữ liệu đang công khai hoặc bị truy cập trái phép.

**Thông báo xóa sạch có thể sai khi cloud lỗi.** `handleClearAllData()` bắt lỗi soft-delete cloud rồi vẫn xóa local và báo thành công. Vì vẫn còn remote, một lần pull khác có thể đưa dữ liệu trở lại. Nếu chỉ xóa local thì nhãn phải nói rõ; nếu xóa mọi nơi thì cần trạng thái thất bại/chờ đồng bộ và tombstone bền vững.

**Form nhập TSV kiểm tra dữ liệu chưa đủ.** Các trường trạng thái, interval, due date và stability được nhận từ chuỗi với ít ràng buộc miền giá trị. Cần thêm ca nhập trạng thái lạ, số âm, NaN, ngày sai và trường chứa tab/newline; không chỉ kiểm tra tệp mẫu hợp lệ.

## Đánh giá giao diện

Điểm ở đây là nhận định chuyên môn tạm thời từ ảnh lưu và mã nguồn, không phải kết quả usability test với người dùng thật.

| Tiêu chí | Điểm /10 | Nhận xét |
|---|---:|---|
| Bản sắc và tính nhất quán thị giác | 7 | Palette tím/xanh, thẻ và nút có phong cách rõ; màn học có trọng tâm. |
| Dễ đọc và phân cấp thông tin | 6 | Từ chính nổi bật nhưng nhiều nhãn phụ nhỏ, màu dịu; dashboard có quá nhiều loại badge và điểm nhấn cạnh tranh. |
| Trải nghiệm học | 6 | Bốn mức đánh giá và dự báo lịch ôn là hữu ích; nhãn và trạng thái chưa giải thích đủ cho người mới. |
| Mobile qua ảnh lưu | 6 | Các khối chính xếp dọc được; tab bị cắt, phiên âm xuống dòng và cụm nút/tag còn chật. |
| Độ tin cậy logic qua mã và phép tái hiện | 4 | Các lỗi sync, quiz, Undo và đổi ngày ảnh hưởng trực tiếp giá trị cốt lõi của sản phẩm. |

**Điểm tốt:** màn học tập trung vào một từ; nút đánh giá có màu và nhãn; có onboarding với ba cách bắt đầu; quản lý dữ liệu có xem trước nhập; có một số ARIA labels, keyboard navigation và reduced-motion handling. Không nên xóa bỏ các phần đã làm tốt này khi sửa lỗi.

**Những điểm cần chỉnh:**

1. Mặt sau thẻ trên ảnh mobile tách nhãn “Phiên âm” thành hai dòng. Nên dùng nhãn ngắn hoặc bố cục một cột cho thông tin từ vựng trên màn hẹp.
2. Thanh tab Hub mobile hiển thị nhãn bị cắt. Cuộn ngang là lựa chọn hợp lệ, nhưng cần dấu hiệu cho biết còn tab ở bên cạnh; tên tab hiện khá dài.
3. Nút “Lật thẻ (F)” trên điện thoại đưa thông tin phím tắt vào vị trí không hữu ích. Có thể chỉ hiển thị phím tắt khi dùng bàn phím/con trỏ phù hợp.
4. Chữ phụ và chip trong dashboard/mobile quá dày đặc và nhỏ so với số liệu chính. Nên giảm lượng badge và số loại màu nhấn; ưu tiên việc cần học hôm nay, việc đã làm và bước tiếp theo.
5. “Đã thuộc” dễ bị hiểu là đã nắm chắc lâu dài, trong khi code có thể đưa một thẻ New sang Mastered ngay khi chọn Good/Easy. “Trí Nhớ Vĩnh Cửu” trong onboarding là lời hứa quá mức. Dùng “Đang ôn định kỳ” hoặc giải thích rõ đây là trạng thái lịch ôn; ghi xác suất nhớ là ước tính.
6. Cùng lúc xuất hiện tên FSRS-7, FusionSRS, stability, XP, rank và nhiều thông điệp phong cách vũ trụ. Người mới cần một hướng dẫn ngắn về Quên/Khó/Nhớ/Dễ trước khi cần biết tên thuật toán.
7. Chưa thấy cơ chế giữ focus trong modal hoặc trả focus về nút mở khi đóng. Có role/ARIA không đủ để tuyên bố WCAG AA 100%. Cần kiểm thử bàn phím, screen reader, zoom và contrast thực tế.
8. Các tuyên bố “0% GPU & Pin”, “100%”, “bảo toàn 100%” nên thay bằng mô tả đo được. Độ tin cậy tăng khi sản phẩm nói đúng giới hạn của mình.

`style.css` có 15.395 dòng và 1.679 lần xuất hiện `!important` tại thời điểm kiểm tra. Đây là dấu hiệu rủi ro bảo trì/cascade, không phải bằng chứng web đang chậm. Nên dọn theo component sau khi khóa hành vi bằng test, tránh viết thêm lớp override liên tục.

## Thứ tự xử lý đề xuất

1. Sửa đường ghi cloud, hiệu chỉnh giờ và chèn HTML. Kiểm thử dữ liệu hai thiết bị rẽ nhánh trước khi tin vào sync.
2. Thống nhất schema; hỗ trợ xóa giá trị/tag đúng nghĩa; dùng revision riêng cho nội dung và tiến độ.
3. Bổ sung trạng thái một lần chấm cho quiz, hủy callback cũ, sửa Undo và rollover ngày.
4. Làm rõ optimizer nào thực sự hoạt động; kiểm thử backup round-trip và thao tác xóa khi offline/lỗi mạng.
5. Sau đó chỉnh typography mobile, tab, nội dung hướng dẫn và accessibility; đo hiệu năng trên thiết bị thật.

**Kết luận đánh giá:** phần trình bày đã có đầu tư rõ ràng. Rào cản lớn nhất hiện nay là việc kết quả học và sửa đổi có được bảo toàn đúng hay không. Nên ưu tiên một vòng sửa tính đúng đắn của dữ liệu trước khi thêm hiệu ứng hoặc huy hiệu.
