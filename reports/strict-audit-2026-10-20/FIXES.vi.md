# Bản sửa sau đánh giá — 20/10/2026

> Đây là ghi chú của vòng sửa trước. Bản nâng cấp tiếp theo và 52 kiểm thử được ghi ở [báo cáo ngày 21/10](../upgrade-2026-10-21/REPORT.vi.md); các giới hạn về cơ chế max và optimizer bên dưới đã được xử lý tiếp trong bản đó.

Đã sửa 12 tình huống lỗi tái hiện trong báo cáo ban đầu, bổ sung kiểm thử hồi quy và chỉnh trải nghiệm học/mobile. Báo cáo REVIEW.vi.md và evidence.json lưu kết quả trước khi sửa, không phải trạng thái hiện tại.

## Các thay đổi chính

- Đọc, hợp nhất và ghi thẻ trong cùng một transaction Firestore. Callback có thể được thử lại nhưng không sửa state local. Cả hàng chờ lẫn đường smartSync dùng chung cách ghi này.
- Tách clock nội dung, SRS và flags; chuẩn hóa phiên âm về pronunciation; giữ nguyên thao tác xóa tag hoặc để trống trường; không cho lượt ôn khôi phục ID đã xóa.
- toMillis chỉ chuyển kiểu. Mốc pull dùng thời gian commit syncedAt của server, reset protocol lần đầu; đồng bộ thủ công đọc đầy đủ để hỗ trợ dữ liệu cũ.
- Hàng chờ giữ phiên bản theo ID, lưu pending IDs vào localStorage ngay khi thay đổi, giữ lần sửa mới khi lần gửi cũ hoàn tất, và retry có giãn cách.
- Quiz chỉ chấm một lần mỗi câu, khóa các nút khi chuyển câu, hủy timer theo phiên, tính giờ từ deadline, escape dữ liệu từ vựng. Chấm chính tả thống nhất hơn với chế độ typing. Kết thúc bài là thao tác idempotent; kết thúc sớm không được thưởng perfect quiz.
- Review logs có ID riêng. Undo xóa đúng log và dùng tombstone khi hợp nhất, trả đúng bộ đếm của ngày đã học và phục hồi riêng trạng thái SRS. Không ghi đè sửa chữa nội dung mới từ thiết bị khác.
- Rollover toàn bộ bộ đếm trước khi tăng, giới hạn từ mới chỉ điều chỉnh một lần trong ngày.
- Đồng bộ nền thống kê/review logs chuyển sang transaction; không còn đường ghi nguyên reviewLogs local đè remote. Chính sách cộng điểm đa thiết bị vẫn có giới hạn nêu bên dưới.
- Xóa hàng loạt giữ tombstone local và hàng chờ, giúp thao tác xóa còn tồn tại sau lỗi mạng.
- Kiểm tra thêm các đường HTML trong phản hồi typing, toast và xem trước trùng nghĩa; âm thanh tải nền dùng toast thay cho popup chặn học.

## Giao diện

- Thanh phiên học hiển thị chủ đề, số thẻ còn trong hàng đợi và số lượt đã ôn hôm nay.
- Màn thẻ có lời nhắc nhớ nghĩa, nút Xem nghĩa rõ hơn, phím tắt ẩn trên màn cảm ứng.
- Tăng độ sáng chữ chính trên nền tối; điều chỉnh khoảng cách theo chiều cao màn hình.
- Bốn tab Hub cùng hiển thị trên mobile, nhãn ngắn hơn. Tên từ được ưu tiên diện tích; badge xuống hàng riêng; nút thao tác có vùng chạm lớn hơn.
- Phiên âm không bị bẻ nhãn trên mobile; focus bàn phím rõ hơn, modal giữ focus và trả focus về nút mở, Escape đóng modal trên cùng. Mặt thẻ bị che được loại khỏi accessibility tree.
- Bỏ một số lời hứa tuyệt đối về trí nhớ vĩnh cửu và mức tiêu thụ tài nguyên.

## Kiểm tra

- `npm test`: 22 ca kiểm thử qua. Kiểm tra hàm merge, transaction với retry mô phỏng, thay đổi khi đang gửi, giữ hàng chờ khi lỗi, quiz, XSS đầu ra, Undo, rollover và modal lồng nhau. Không dùng Firebase production để gây xung đột thử nghiệm.
- Kiểm tra cú pháp JavaScript; CSS parse bằng PostCSS; Vite phục vụ và biến đổi thành công các module đầu vào đã đổi. Không chạy build production.
- Kiểm tra trực tiếp bằng trình duyệt: học → đánh giá → hoàn tác; quiz khóa nút sau khi bỏ qua; kết thúc bài; mở/đóng modal; chuyển tab bằng chuột và bàn phím.
- Đã xem ở kích thước desktop mặc định, mobile 390×844 và 320×568. Tại màn nhỏ đo được document.scrollWidth bằng clientWidth, không tràn ngang trang.
- Ảnh mobile-after.jpg, mobile-hub-after.jpg và desktop-after.jpg được chụp từ bản sửa, với dữ liệu demo.

## Cách xem

Chạy `npm run dev -- --host 127.0.0.1 --port 5299 --strictPort` rồi mở `http://127.0.0.1:5299/?audit=1`.

Tham số audit chỉ hoạt động trong môi trường phát triển. Chế độ này dùng một IndexedDB riêng và chặn đồng bộ cloud, để thử thao tác bằng 10 từ mẫu mà không gửi tiến độ demo lên kho thật.

## Giới hạn cần biết trước khi triển khai

- Cần kiểm thử với hai thiết bị/tài khoản kiểm thử trên Firebase, gồm offline/reconnect và rule thực tế. Transaction cần kết nối mạng; ứng dụng giữ thay đổi ở IndexedDB và hàng chờ khi offline. Tham khảo [tài liệu Firestore](https://firebase.google.com/docs/firestore/manage-data/transactions).
- Các client phiên bản cũ vẫn có thể ghi theo quy trình cũ. Nên cập nhật đồng thời các thiết bị trước khi đánh giá tính hội tụ của phiên bản này.
- Chính sách max của XP/các bộ đếm tổng vẫn chưa phải cơ chế cộng các nhánh offline độc lập; các thao tác trừ điểm/Undo đa thiết bị cần một thiết kế event ledger hoặc counter riêng. Bản sửa này bảo vệ card SRS, nội dung và review logs; không tuyên bố đã hoàn tất một mô hình CRDT cho toàn bộ gamification.
- Chưa thay optimizer 9 tham số cũ bằng bộ huấn luyện nền 34 tham số, chưa thay cấu trúc kho chung thành tài khoản theo UID, và chưa xác minh Security Rules production. Tool train offline và đường nhập 34 tham số hiện hữu được giữ lại.
- Chưa chứng nhận WCAG AA hoặc đo benchmark hiệu năng trên thiết bị thật. Những thay đổi accessibility đã có test hành vi và kiểm tra trình duyệt, nhưng không thay thế một vòng audit đầy đủ.

Chưa build, deploy hay đổi cấu hình Firebase production.
