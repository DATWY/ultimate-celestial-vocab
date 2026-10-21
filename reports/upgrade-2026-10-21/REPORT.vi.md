# Bản nâng cấp Celestial Vocab — 20–21/10/2026

Đã nâng cấp các luồng hiện có trong mã nguồn cục bộ, bổ sung 52 kiểm thử và kiểm tra trực tiếp bằng trình duyệt. Chưa build hoặc triển khai production.

**Cập nhật theo yêu cầu ngày 21/10:** đã khôi phục màn học đơn giản từ bản backup trước nâng cấp. Bỏ tiêu đề lớn, bảng mục tiêu, biểu đồ bên cạnh và thanh điều hướng dưới mới; giữ các sửa lỗi logic. Đã chạy lại 52/52 kiểm thử, kiểm tra cú pháp/CSS và thử lật thẻ → đánh giá → hoàn tác trên kho demo riêng. Desktop 1280×900 và mobile 390×844 không tràn ngang. Ảnh hiện tại: [desktop](study-simple-restored-desktop.jpg), [mobile](study-simple-restored-mobile.jpg). Các ảnh `desktop-dark.jpg` và `mobile-light.jpg` phía dưới ghi lại bản giao diện nâng cấp trước khi khôi phục.

Bản giao diện trước khi khôi phục cũng được lưu riêng tại `backups/ui-before-simple-restore-2026-10-21.zip` (6 tệp nguồn liên quan). Không thay đổi dữ liệu học của người dùng trong lần khôi phục giao diện.

## Bản sao lưu trước khi sửa tiếp

- Thư mục: `backups/2026-10-20_23-38-51/`.
- Tệp: `project-before-upgrade.zip`, 181 tệp; có trạng thái chưa commit, các tệp nguồn chưa được Git theo dõi, cấu hình riêng và hướng dẫn dự án.
- Mỗi tệp trong ZIP đã được đối chiếu SHA-256 với `manifest.json`.
- SHA-256 của ZIP: `6C4BD859A9452314719CBED485CE08C2A9519327CDF4D648F40CCD634D6C7200`.
- `RESTORE.txt` hướng dẫn giải nén vào thư mục mới và cài lại thư viện. ZIP không chứa node_modules, .git, dist, cache hoặc các tệp bị bỏ qua theo quy tắc dự án, trừ cấu hình riêng và hướng dẫn đã được bổ sung rõ ràng.

Đây là backup của dự án trên ổ đĩa, không phải bản xuất IndexedDB trong trình duyệt hay bản sao Firebase. ZIP chứa cấu hình riêng, cần giữ cục bộ.

## Logic đã thay đổi

1. **Điểm và thống kê:** ghi đóng góp tăng/giảm theo phiên, hợp nhất theo phiên bản thay vì lấy số lớn nhất cho hoạt động mới. Hai nhánh offline cộng đủ phần việc riêng; gửi lại không cộng lặp. Undo và tiêu XP đã được kiểm tra bằng các ca hợp nhất có dấu. Combo và các chỉ số có thể reset dùng phiên bản mới nhất.
2. **Lưu nhiều tab:** thẻ, thống kê và review logs được hợp nhất trong transaction IndexedDB. Một tab sửa nội dung và một tab ôn thẻ không ghi đè hai nhóm dữ liệu của nhau.
3. **Hàng chờ bền vững:** thêm store outbox ở IndexedDB phiên bản 2. Thẻ và dấu chờ được ghi trong cùng transaction. Mỗi lần ghi dùng mã riêng; phản hồi cũ không được xóa dấu chờ của lần sửa mới, kể cả sau khi dấu chờ trước đã được xóa và tạo lại.
4. **Đồng bộ thẻ:** dùng chung transaction Firestore cho hàng chờ và smartSync; tách phiên bản nội dung, SRS và đánh dấu sao. Giữ các thao tác xóa nội dung/tag và tombstone. Mốc pull dựa trên thời điểm commit server. Bấm đồng bộ thủ công thực hiện lượt đọc đầy đủ.
5. **Quiz:** mỗi câu chỉ chấm một lần, hủy callback của phiên cũ, khóa nút trong lúc chuyển câu. Đúng/sai/bỏ qua đều ghi tiến độ và lịch sử; đúng cũng cập nhật lịch ôn. Ôn lại câu sai không nhận thêm thưởng của bài gốc. Bỏ nhãn Enter gây nhầm ở nút Bỏ qua.
6. **Nhập/xuất:** đọc TSV có dấu ngoặc kép, tab và nhiều dòng trong một ô; nhận header đổi thứ tự và BOM. Kiểm tra trạng thái, số hữu hạn, số âm, số nguyên và miền giá trị SRS. Hiển thị số dòng lỗi cùng lý do; chỉ nhập dòng hợp lệ. Dòng trùng xuất hiện sau có thể bổ sung cho dòng mới phía trước. Kiểm tra lại với dữ liệu hiện tại khi xác nhận. Giữ văn bản dán đến khi lưu thành công; chặn tệp lớn trước khi đọc và xử lý lỗi đọc tệp.
7. **Cá nhân hóa lịch ôn:** worker và công cụ train offline dùng chung bộ tính 34 tham số với trình ôn. Ghi cả lượt học đầu tiên; kiểm tra miền của mọi tham số. Tối ưu trên phần lịch sử trước, đánh giá trên phần sau theo thời gian; chỉ áp dụng nếu sai số kiểm tra giảm đủ ngưỡng. Có nút chạy trên máy, xử lý timeout và bảo vệ cấu hình người dùng vừa đổi trong lúc huấn luyện.
8. **Cấu hình:** reset về mặc định có phiên bản mới, không bị bộ tham số cũ kéo trở lại. Thao tác gửi cấu hình cũng dùng transaction.
9. **Độ bền và đầu ra:** chuẩn hóa cờ boolean cũ, dữ liệu SRS lỗi và timestamp; phiên bản mới vẫn tăng khi đồng hồ thiết bị trước chạy nhanh. Loại bỏ các helper reset Cloud khỏi giao diện production; công cụ demo chỉ dùng trong kho kiểm thử riêng. Firebase SDK giữ cùng phiên bản 10.8.1 và chuyển sang dependency cục bộ; hiệu ứng dùng animejs đã có trong dự án.

## Giao diện

- Màn học desktop và mobile trở lại bố cục cũ: thẻ ở giữa, nút xem nghĩa, các nút đánh giá và thống kê nhỏ phía dưới.
- Giữ menu công cụ quen thuộc; đã bỏ các bảng và thanh điều hướng mới theo yêu cầu.
- Lỗi lưu hoặc dữ liệu bị tab cũ chặn vẫn được thông báo qua hộp thoại khi cần.
- Kho từ có tab gọn, tên từ rõ, thao tác chạm lớn hơn; biểu mẫu thêm/sửa chỉ thông báo thành công sau khi lưu.
- Bổ sung focus, nhãn nhập liệu, bẫy focus modal, Escape, trả focus về nút mở và hỗ trợ giảm chuyển động. Mặt thẻ và menu bị che không tham gia tương tác bàn phím.
- Thông báo xóa toàn bộ nói rõ thao tác sẽ lan lên Cloud sau khi đồng bộ.

## Kiểm chứng

`npm test`: **52/52 qua**, log đầy đủ ở [test-results.txt](test-results.txt).

Các ca gồm hợp nhất/xung đột, retry, thao tác mới trong lúc gửi, giữ hàng chờ khi lỗi, hai tab dùng chung IndexedDB, phản hồi cũ đến muộn, review logs và Undo, rollover, đồng hồ chạy nhanh, quiz, XSS đầu ra, TSV và kiểm tra tham số/holdout của bộ tối ưu. IndexedDB trong kiểm thử tự động được giả lập bằng fake-indexeddb; các hàm lưu transaction thực tế của ứng dụng được gọi trực tiếp.

Đã kiểm tra cú pháp toàn bộ JavaScript trong src/tools, parse CSS bằng PostCSS và kiểm tra khoảng trắng của diff. Không chạy lệnh build.

Trình duyệt đã kiểm tra:

- Học → đánh giá → Ctrl+Z; đánh giá rồi tải lại vẫn giữ tiến độ.
- Đổi mục tiêu trên mobile; thêm `luminous`, sửa phiên âm, đánh dấu sao và tìm lại. Tab thứ hai đọc đúng từ, phiên âm và dấu sao đã lưu.
- Nhập một dòng hợp lệ và một dòng có số lần quên âm: xem trước báo đúng dòng 3; chỉ thêm dòng hợp lệ.
- Worker tối ưu chạy và báo cần 400 lượt khi lịch sử chưa đủ, không phát sinh lỗi console trên phiên kiểm tra cuối.
- Giao diện sáng/tối, desktop 1280×900, mobile 390×844 và màn hẹp 320×568. Ở hai màn mobile, scrollWidth bằng clientWidth; không tràn ngang trang.

Ảnh: [desktop-dark.jpg](desktop-dark.jpg), [mobile-light.jpg](mobile-light.jpg). Dữ liệu trong ảnh là demo, Cloud bị tắt.

## Cách xem

Phiên xem thử cuối dùng `http://127.0.0.1:5302/?audit=1&theme=dark`.

Có thể khởi động lại bằng `npm run dev -- --host 127.0.0.1 --port 5302 --strictPort`. Tham số `audit=1` chỉ có tác dụng trong môi trường phát triển, dùng IndexedDB riêng và không gửi tiến độ demo lên Firebase.

## Phần chưa được xác nhận trên production

- Chưa kiểm thử xung đột trên hai thiết bị kết nối Firebase thật, mất/kết nối lại mạng thật, Security Rules hay quyền truy cập production. Kho hiện tại vẫn là kho chung theo kiến trúc cá nhân có sẵn, chưa chuyển thành nhiều tài khoản tách theo UID.
- Khi nâng cấp, cần dùng cùng phiên bản trên các thiết bị. Phần lịch sử trước cơ chế đóng góp mới được giữ theo baseline cũ; không thể suy ra chính xác mọi nhánh offline đã xảy ra trước khi có thông tin nhận diện mới.
- Các thao tác tiêu XP/mua vật phẩm đồng thời khi hai thiết bị đều offline chưa có cơ chế giữ chỗ độc quyền ở server. Hợp nhất điểm có dấu không thay thế một hệ thống ví/inventory có khóa giao dịch toàn cục.
- Metadata đồng bộ và review logs vẫn cần kiểm tra kích thước trên kho thực tế lớn. Chưa thử giới hạn tài liệu Firestore, chưa benchmark điện thoại thật hay kiểm tra cache PWA sau build. Biểu mẫu, thẻ, thống kê và lịch sử được lưu qua các transaction riêng; chưa chứng minh tính nguyên tử cho toàn bộ một lượt học khi thiết bị mất điện giữa các lần lưu.
- Chưa chứng nhận WCAG. Bộ tối ưu có kiểm tra giữ lại lịch sử, không phải bằng chứng về hiệu quả ghi nhớ dài hạn trên người dùng thật.

Không thay đổi dữ liệu Firebase production, không deploy và không tạo commit tự động.
