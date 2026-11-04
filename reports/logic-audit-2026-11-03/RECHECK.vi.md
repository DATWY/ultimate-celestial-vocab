# Đánh giá lại sau sửa chữa — 03/11/2026

## Kết luận

Bản nâng cấp có cải thiện thực chất: dedup cấp revision mới, hợp đồng MEMORY được bổ sung, TSV giữ được suspension, bộ đếm New+Again được sửa và bundle giảm đáng kể. Tuy nhiên, kết luận “không còn nợ kỹ thuật bắt buộc” trong REPAIR-REPORT.vi.md là quá sớm. Có lỗi mới do ràng buộc optimizer và các phần sửa Undo/ngân sách chưa bao phủ toàn luồng.

Đây là review code hiện tại so với Git HEAD và báo cáo sửa chữa; không sửa mã ứng dụng, không commit/push. Chỉ thêm báo cáo và script tái hiện. Báo cáo là dữ liệu đối chiếu, không được xem như bằng chứng tự xác nhận.

## Kiểm tra chạy lại

| Cổng | Kết quả quan sát |
|---|---|
| npm test | 499 pass, 0 fail, 0 skip |
| npm run lint | 0 error, 108 warning |
| npx vite build | Thành công, có PWA |
| npm run budget | 4/4 đạt; entry 77,03/82 kB gzip, còn 4,97 kB |
| npm run test:e2e, NEW | ok=true, failures=[] |
| npm run test:e2e, SMOKE_LEECH=1 | Xem recheck-leech.txt lưu cùng báo cáo |
| node reports/logic-audit-2026-11-03/recheck-reproduce.mjs | 5 ca xác nhận hành vi còn lỗi |

Không chạy lại npm run build vì script đó gọi generate_version; dùng Vite trực tiếp để tránh cập nhật version chỉ vì review. Không xác minh Firebase đã deploy hoặc hai thiết bị thật. Không chạy lại phép quét 200.000 bộ weights được báo cáo; không coi con số đó là kết quả độc lập của lần review này.

## Phát hiện cần sửa tiếp

### 1. [P1] Ràng buộc thứ tự mới làm gradient optimizer đi qua miền bất hợp lệ

Vị trí: src/core/srs/training.js:211–246, đặc biệt :226 và :237; projectFsrs7Params tại :15.

lossOf trả Infinity nếu weights vi phạm thứ tự. Nhưng finiteDifferenceGradient vẫn tăng từng tọa độ độc lập. Tại bộ hợp lệ w0=w1=w2=w3=4, tăng w0 một chút làm w0>w1, vì vậy gradient w0=Infinity. Bước Adam tạo Infinity/Infinity=NaN và đưa giá trị đó vào moment m1/m2.

projectFsrs7Params không loại bỏ toàn bộ bước hỏng: nó biến NaN thành min của từng tọa độ. Do đó w0 đang là 4 có thể bị âm thầm đưa xuống 0,01, còn moment đã hỏng vẫn được giữ cho vòng sau. Đây không phải bước projected Adam hợp lệ. Các equality này được validator chấp nhận và chính phép chiếu mới cũng tạo ra chúng khi các tọa độ vượt nhau.

Tái hiện: bộ weights đầu vào hợp lệ; gradient=Infinity; bước Adam=NaN; project(NaN) đưa w0 về 0,01. Khi chạy thêm optimizeParameters trên fixture 480 lượt với bộ equality này, hàm vẫn có thể trả improved=true/validated. Điều đó không chứng minh weights cuối chắc chắn làm học kém hơn, nhưng chứng minh gate hiện tại không phát hiện lỗi tính gradient.

Sửa đề nghị: tính sai phân theo hướng hợp lệ dưới các constraint, hoặc tham số hóa các khoảng chênh không âm. Kiểm tra mọi gradient/moment/bước phải hữu hạn trước khi áp dụng; bước hỏng cần bị loại và xử lý moment phù hợp, không thay NaN bằng tham số min rồi tiếp tục. Test phải đi qua tối ưu thật tại biên thứ tự, không chỉ test hàm chiếu.

### 2. [P2] Undo bỏ sót easyPresses/hardPresses và thống kê XP

Vị trí: src/events.js:166–202; src/core/state.js:462.

Snapshot thống kê được chụp tại :202, sau trackEvent(easyPresses/hardPresses) và addXP. addXP đã gọi trackXP, có thể cập nhật xpToday/xpWeekTotal và các thống kê lên cấp. diffNumericStats chỉ thấy thay đổi phát sinh sau snapshot này. Trong khi đó Undo đã bỏ cách trừ easyPresses/hardPresses cũ, chỉ còn revertNumericStats(snapshot.statsDelta).

Ca chạy actual processSrsFeedback(4,false), rồi actual revertGamificationAfterUndo với stub persistence/UI: userXP về 0 nhưng easyPresses=1, xpToday=5 và xpWeekTotal=5. Lặp Undo/làm lại vẫn có thể tích thành tích từ lượt đã hủy. Đây là regression cụ thể với easyPresses/hardPresses so với code trước sửa.

Sửa đề nghị: chụp trước TẤT CẢ thay đổi do review, gồm trackEvent/addXP/trackLevelUp; dùng rollback theo loại dữ liệu. Không áp phép trừ delta một cách tổng quát lên mọi numeric register như timestamp, max hoặc streak khi cần bảo toàn thay đổi hợp lệ từ nơi khác. Bổ sung test handler → Undo thật, kiểm cả các bộ đếm rating và XP, không chỉ gọi trực tiếp trackReview.

### 3. [P2] Quiz vẫn vượt hạn mức từ mới độc lập

Vị trí: src/features/quiz.js:264; đối chiếu src/core/queue.js:256–263.

Quiz chỉ kiểm limit-used của maxReviewsPerDay. Nó không hỏi computeDailyNewLimit và newCardsDoneToday. Hai hạn mức vốn độc lập: còn tổng lượt ôn không đồng nghĩa còn suất giới thiệu từ mới.

Ca tái hiện: currentLimit=15, newCardsDoneToday=15, tổng cap=200, used=15. applyQuizReview vẫn lưu một thẻ New và tăng newCardsDoneToday lên 16. Vì vậy báo cáo chỉ đúng khi nói Quiz đã tôn trọng trần lượt ôn chung, chưa đúng nếu coi ngân sách đã thống nhất đầy đủ.

Sửa đề nghị: policy nhận đủ hai ngân sách và category. New phải còn cả suất mới lẫn suất tổng; Due chỉ cần suất tổng; Learning giữ ngoại lệ theo thiết kế. Tái kiểm tra tại lúc chấm, gồm Flashcard khi hàng đợi đã cũ do đổi cap hoặc tab khác tiêu ngân sách.

### 4. [P2] Phiên luyện gõ riêng vẫn lấy thẻ tạm ngưng

Vị trí: src/events.js:534–543; src/core/queue.js:getNextCardToReview; src/events.js:processSrsFeedback.

Listener startDedicatedTypingBtn chỉ loại isDeleted, không loại isSuspended. getNextCardToReview cũng chỉ kiểm deleted. processSrsFeedback không gọi isCardReviewable trước khi cập nhật bộ nhớ; classifyReview trả null chỉ làm không tăng budget, không cấm chấm.

Ca tái hiện dùng chính listener trích từ events.js và hàm pop queue thật: kho có đúng một thẻ New/isSuspended=true, filter=all; bấm phiên luyện gõ vẫn displayCard(0). Đây là đường vào học còn bỏ qua quyết định tạm ngưng, dù Quiz đã được sửa. Phiên riêng cũng tự nạp 15 thẻ ngoài buildReviewQueue nên cần kiểm tra cả cap ở đường này.

Sửa đề nghị: dùng isCardReviewable khi dựng pool, khi lấy thẻ và tại thời điểm áp dụng review. Chốt chính sách cap chung tại cửa ghi SRS, không chỉ từng màn tạo pool.

### 5. [P2] t=0 chưa chứng minh được điểm bắt đầu chuỗi trainer

Vị trí: src/core/srs/training.js:66–74.

startKnown được suy từ t<=1e-9 rồi gắn historyComplete=true. Nhưng t chỉ là elapsed bị chặn dưới bằng 0, không phải marker lần học đầu. Một review không phải lần đầu vẫn có t=0 khi cùng timestamp, hoặc lastReviewDate ở tương lai do lệch đồng hồ. Khoảng dung sai 1e-9 ngày còn lớn hơn giá trị zero tuyệt đối.

Ca biên đã chạy bằng engine thật: thực hiện hai review cùng timestamp, bỏ log review đầu rồi đưa phần còn lại cho prepareTrainingData. Lượt giữ đầu có reps trước đó=1 nhưng t=0; chuỗi bị cắt vẫn được nhận và historyComplete=true. Đây là ca đầu vào biên, không phải khẳng định UI bình thường tạo hai lần chấm cùng mili-giây hay tỷ lệ gặp cao. Tuy nhiên nó bác bỏ khẳng định “đã chứng minh lần đầu đời thật” bằng riêng t.

Sửa đề nghị: giữ marker khởi đầu có provenance, ví dụ trạng thái/reps trước review hoặc sự kiện tạo thẻ kèm chuỗi log đầy đủ. Với log cũ thiếu marker, biểu diễn là chưa xác minh thay vì historyComplete=true tuyệt đối; quyết định nhận dữ liệu phải nêu rõ giả định và mức tin cậy. Kiểm tra được t>0 giúp loại nhiều chuỗi cắt, nhưng chưa phải bảo đảm hoàn chỉnh.

## Những sửa chữa được chấp nhận ở phạm vi đã kiểm tra

- Dedup cấp revision mới lớn hơn hai đầu vào; test qua IndexedDB bảo vệ đúng lỗi trước. Suspension OR được kiểm tra cả hai hướng.
- lapseDay/lapsesToday/buriedOn/needsReformulation được đưa vào MEMORY; Undo/merge khôi phục theo miền bộ nhớ. Đây là sửa đúng nguyên nhân gốc.
- New+Again được đếm ngay; không còn lỗ hổng không đếm lần giới thiệu trên đường Flashcard thông thường.
- TSV xuất và parse suspension thật; test đi qua import plan vào kho rỗng phù hợp thiệt hại cũ.
- Validator từ chối đảo thứ tự; solver có guard mục tiêu ngoài miền và dự phòng chia đôi. Đính chính 24/400 được giữ đúng, không gọi đó là xác suất lỗi hội tụ.
- Persona bỏ hai diễn giải công thức sai; jitter theo cardId+ngày giữ được tính ổn định và phân tán.
- Tách dedup lazy là cải thiện tải entry thật; số đo build/budget khớp báo cáo. Chưa kiểm tra tương tác modal dedup trong trình duyệt, nên chưa kết luận UI đó đã có đầy đủ coverage sau refactor async.

## Chất lượng bằng chứng và test

499 test xanh là tín hiệu tốt, nhưng chưa đủ cho kết luận “hoàn tất”. Các test Undo mới chụp snapshot TRƯỚC trackReview, trong khi handler thực tế chụp SAU trackEvent/addXP; vì thế test không bảo vệ đúng vị trí nối gây lỗi. Test mang tên dữ liệu đầy đủ “vẫn tối ưu được” chỉ gọi prepareTrainingData/evaluateParameters, chưa gọi optimizeParameters để kiểm quy trình gradient sau constraint mới.

Các ca mới trong recheck-reproduce.mjs dùng module thật và trích nguyên handler khi cần, với storage/UI giả lập. Exit 0 nghĩa là xác nhận được các hành vi còn lỗi; không phải test chứng minh ứng dụng đã sạch lỗi. Không dùng script tái hiện cũ vốn assert trạng thái lỗi trước sửa để kết luận bản sửa thất bại.

Ưu tiên tiếp theo: sửa gradient/moment optimizer; sửa vị trí snapshot Undo; hoàn thiện hai hạn mức và eligibility tại cửa áp dụng review; sau đó siết provenance của chuỗi trainer. Không cần viết lại engine FSRS.
