# Đánh giá logic và thuật toán Celestial Vocab — 03/11/2026

## Kết luận

Dự án có nền tảng tốt: engine bộ nhớ tách module, learning steps thực sự, lưu IndexedDB có outbox, merge theo từng nhóm dữ liệu, CRDT cho tiến độ, optimizer chạy worker và có kiểm tra holdout. Tuy nhiên, chưa nên kết luận toàn bộ luồng học đáng tin cậy chỉ dựa vào 450 test xanh. Những lỗi còn lại tập trung ở chỗ nối các module: ghi nhận lượt học, Undo, dedup, backup và tái dựng lịch sử huấn luyện.

Đây là đánh giá và ca tái hiện; không sửa mã ứng dụng. Không tìm thấy AGENTS.md trong danh sách file của dự án. Không dùng các báo cáo audit cũ làm bằng chứng thay cho code hiện tại.

## Phạm vi và phương pháp

Đọc trực tiếp các luồng chính trong main/events, state và các module con, queue, SRS/forgetting/stability/difficulty/constants/heuristics/training/worker, idb, card/progress/log merge, firebase/sync, import-plan/tabular/dedup, typing, quiz, gamification và persona. Xem bộ test và cấu hình build/rules. Phần UI/CSS/TTS chủ yếu được kiểm tra qua bộ regression hiện có; không phải kiểm toán trực quan mọi màn hình. Không xác minh cấu hình Firebase Console/rules đã triển khai hay đồng bộ hai thiết bị thật.

Các kết quả chạy tại workspace:

| Kiểm tra | Kết quả |
|---|---|
| `npm test` | 450/450 đạt, không skip |
| `npm run lint` | 0 error, 108 warning |
| `npx vite build` | Thành công, bao gồm PWA |
| `node tools/bundle_budget.mjs` | Đạt cả 4 ngưỡng; entry gzip 81,75 kB / 82 kB |
| `npm run test:e2e` | Không đạt: kỳ vọng nhãn Hard của thẻ New đã lỗi thời |
| `node reports/logic-audit-2026-11-03/reproduce.mjs` | 9 ca tái hiện xác nhận hành vi bất lợi |

Build trực tiếp bằng Vite để tránh script generate_version thay đổi version của dự án chỉ vì review. Các ca tái hiện dùng hàm engine thật; ca Quiz trích nguyên hàm applyQuizReview và giả lập persistence; ca giới hạn từ mới kết hợp guard trong nguồn với chuyển trạng thái engine. Chúng không thay thế kiểm thử toàn luồng trình duyệt.

## Những vấn đề cần sửa

### 1. [P1] Dedup không tăng revision bộ nhớ, có thể mất ngay kết quả gộp

Vị trí: `src/core/dedup.js:1226`; `src/core/idb.js:47`; `src/core/card-merge.js:69`.

mergeDuplicateCards thay đổi stability/lapses/status/due nhưng đặt srsUpdatedAt bằng max của hai thẻ cũ. Khi saveWordToDB merge lại với bản đang lưu, revision bằng nhau nên thắng thua do tie-break theo chuỗi JSON, không phải do thao tác gộp mới hơn.

Tái hiện: thẻ chính lapses=9 + thẻ phụ lapses=1 tạo mergedCard.lapses=10; merge với bản cũ của thẻ chính cho lapses=9. Ca này chạy trực tiếp hàm merge mà IDB sử dụng, chưa cần Cloud. Có thể mất cả các điều chỉnh lịch bảo thủ đi kèm.

Sửa: tạo revision SRS mới lớn hơn cả hai đầu vào bằng nextRevision trên max clock; kiểm tra cả cờ tạm ngưng khi gộp. Thêm test gộp → lưu → đọc lại, thay vì chỉ kiểm tra object trả về từ dedup.

### 2. [P1] Thiếu trường bộ nhớ trong hợp đồng merge/Undo của thẻ leech

Vị trí: `src/core/card-merge.js:19`, `:131`; `src/core/srs/index.js:274`.

MEMORY thiếu lapseDay, lapsesToday, buriedOn, needsReformulation. Engine cập nhật các trường này nhưng restoreCardReview không phục hồi; mergeCardFields để chúng đi theo object có updatedAt mới nhất, kể cả đó chỉ là chỉnh nội dung.

Tái hiện A: trước lượt Again có lapsesToday=1; lượt Again làm thành 2 và chôn thẻ. Undo trả lapses về trước nhưng vẫn giữ lapsesToday=2 và needsReformulation=true.

Tái hiện B: SRS mới có lapsesToday=2; một bản chỉnh nội dung muộn hơn còn giữ 0. Merge giữ revision SRS mới nhưng nhận lapsesToday=0 từ bản nội dung. Cơ chế chống ôn lặp không còn nhất quán giữa thiết bị.

Sửa: đưa đủ trường vào nhóm MEMORY và restore, quy định giá trị mặc định cho thẻ legacy; thêm test Undo tại đúng lần chôn thứ hai và merge content/SRS độc lập.

### 3. [P1] Từ mới trả lời sai lần đầu không được tính vào hạn mức ngày

Vị trí: `src/events.js:151–160`; `src/core/queue.js:301`.

Flashcard chỉ incrementNewCardsDone khi thẻ New được chấm rating>1. Nhưng New + Again chuyển ngay sang Learning. Các lần trả lời đúng về sau không còn thỏa isNewCard, nên thẻ đó không bao giờ đóng góp vào bộ đếm newCardsDoneToday.

Hệ quả: người học có thể liên tục mở thẻ mới, chọn Again rồi học tiếp mà không tiêu ngân sách từ mới; khi hàng đợi được dựng lại, thẻ mới tiếp tục được nạp. Đây là lỗi đặc biệt bất lợi với người đang học nhiều từ khó. Mastered + Again cũng không tăng dueDoneToday, trong khi Quiz lại tăng bộ đếm không phụ thuộc đúng/sai.

Sửa: thống nhất ý nghĩa “đã giới thiệu thẻ mới” và “đã xử lý thẻ đến hạn”, đếm theo sự kiện/thẻ/ngày độc lập với kết quả; dùng cùng hàm cho Flashcard và Quiz, Undo hoàn lại đúng sự kiện.

### 4. [P1] Backup TSV làm mất quyết định tạm ngưng

Vị trí: `src/core/tabular.js:55`, `:100`.

Cả export lẫn import đều hardcode isSuspended=false dù cột này có trong định dạng. Thẻ tạm ngưng=true sau round-trip thành false và trở lại học. Bộ test export-roundtrip chỉ dùng fixture false nên bỏ sót.

Sửa: xuất giá trị thật, parse boolean có kiểm tra hợp lệ như isStarred; bổ sung fixture true. TSV hiện cũng không giữ ID, revision, trạng thái chôn hay toàn bộ các trường mở rộng; nên coi là xuất kho từ, bổ sung JSON backup có schema/version để khôi phục toàn bộ tài khoản cục bộ.

### 5. [P1] Optimizer tái dựng sai bộ nhớ khi lịch sử đã bị cắt

Vị trí: `src/core/srs/training.js:34`, `:47`, `:72`; `src/core/state/review-log-prune.js:9`.

Trainer chỉ giữ 6.000 lượt cuối; Cloud pruning mặc định 3.000 lượt. Sau đó mỗi thẻ đều được khởi tạo thành New/reps=0 ở lượt đầu còn giữ. Không có trạng thái checkpoint trước phần lịch sử còn lại. log.t được lọc hợp lệ nhưng quá trình replay tính elapsed từ timestamp và xem lượt đầu là lần học mới, kể cả log.t cho thấy thẻ đã tồn tại lâu.

Ca tái hiện cho thấy thay toàn bộ log.t bằng 0 không làm đổi loss khi timestamp giữ nguyên. Điều này tự nó hợp lệ với lịch sử đầy đủ; lỗi là không nhận biết chuỗi đã bị cắt và tiếp tục giả định lượt đầu giữ lại là lần đầu đời thẻ.

Hệ quả: train và validation cùng đánh giá trên bộ nhớ được dựng sai. Holdout và bootstrap không tự sửa được lỗi đầu vào này. Không thể suy ra rằng giảm logloss hiện tại chắc chắn đồng nghĩa lịch ôn thật tốt hơn.

Sửa: lưu checkpoint đủ trạng thái bộ nhớ trước điểm cắt, hoặc giữ lịch sử đầy đủ theo thẻ và chỉ tối ưu những chuỗi xác minh được khởi đầu. Có thể replay toàn bộ prefix để warm-up nhưng chỉ chấm loss trên phần gần đây. Cần thiết kế checkpoint phù hợp việc đổi weights; không dùng trạng thái tính bằng bộ weights cũ như ground truth của candidate mà không đánh giá sai lệch.

### 6. [P2] Quiz không dùng chính sách chọn thẻ và ngân sách chung

Vị trí: `src/features/quiz.js:84–85`, `:243–254`.

Pool chỉ loại isDeleted, không loại isSuspended. applyQuizReview cũng chỉ kiểm tra deleted và cập nhật SRS trực tiếp. Quiz có thể lấy tất cả từ, không kiểm tra remaining của review cap hay new cap. Đây không chỉ là bài kiểm tra không ảnh hưởng lịch: câu trả lời thực sự thay đổi bộ nhớ và ngày ôn.

Tái hiện bằng hàm applyQuizReview thật: thẻ New đang isSuspended=true vẫn chuyển Learning và được lưu. Đường gọi này không có bước kiểm tra ngân sách. Các lượt Quiz sai vẫn tiêu bộ đếm mới/đến hạn, khác Flashcard.

Sửa: dùng một chính sách chung để lọc và áp dụng review. Nếu chủ ý cho phép Quiz vượt cap hoặc học thẻ tạm ngưng, cần tùy chọn rõ trong sản phẩm và thống kê riêng, tránh âm thầm thay đổi lịch ôn.

### 7. [P2] Validator tham số thiếu ràng buộc giữa các tham số

Vị trí: `src/core/srs/constants.js:81–94`; `src/core/srs/training.js:162` trở đi.

validFsrs7Params chỉ kiểm từng số độc lập. Bộ w[0]=100 và w[3]=0,01 được chấp nhận: độ bền ban đầu của Again cao hơn Easy 10.000 lần. Adam cũng chiếu từng tọa độ về hộp riêng, không duy trì thứ tự S0 theo rating hoặc base2>=base1.

Nguồn FSRS-7 tham chiếu có bước áp monotonicity sau box clamp; giới hạn hộp trong dự án cũng khác nguồn hiện tại. Khác bounds không tự động là lỗi, nhưng thiếu ràng buộc thứ tự cho phép cấu hình trái ngữ nghĩa. Holdout không phải bảo đảm mọi tình huống rating đều hợp lý.

Sửa: duy trì w0<=w1<=w2<=w3, w26>=w25, áp trong validator, optimizer, cấu hình tay và dữ liệu Cloud; có test rating/interval ordering cho bộ weights được chấp nhận.

### 8. [P2] Cổng E2E không đồng bộ với chính sách Hard hiện tại

Vị trí: `tests/e2e/study-loop.mjs:191`; `src/core/srs/index.js:77`.

E2E chờ nhãn New [1p,10p,10p,7 ngày], ứng dụng trả [1p,1p,10p,7 ngày]. Engine hiện chủ ý cho Hard lặp bước hiện tại, đã có unit test ủng hộ. Vì thế đây là mâu thuẫn test/contract; kết quả không chứng minh UI đang tính sai.

Hệ quả: npm run check sẽ không xanh toàn bộ trong môi trường đã chạy. Luồng Good → Learning 10 phút và Undo → New vẫn hoạt động trong smoke run. Cần thống nhất đặc tả rồi cập nhật E2E; thêm smoke cho các phát hiện trên. Không sửa thuật toán chỉ để đáp ứng kỳ vọng E2E cũ.

### 9. [P2] Persona diễn giải hệ số mô hình thành tuyên bố trí nhớ sai công thức

Vị trí: `src/features/fsrsPersona.js:33–61`; đối chiếu `src/core/srs/stability.js:37–52`.

Persona nói chu kỳ nhớ nhân p[7] lần mỗi lượt đúng và sau quên giữ p[10]*100% dấu vết. Công thức thật dùng exp(p7-1,5), D, S, R và nhiều tham số; p10 nhân với ((S+1)^p11-1)*exp((1-R)*p12), không phải tỷ lệ phần trăm cố định. Với p10>1 còn có thể nói giữ hơn 100% dù lapse stability bị cap bằng giá trị trước.

Các điểm 50–99 cũng là phép biến đổi thủ công, không phải đo năng lực nhận thức được kiểm định. Đây là lỗi diễn giải sản phẩm, không phải lỗi tính SRS. Sửa nội dung theo mô tả xu hướng/mức độ chắc chắn; không gắn hệ số riêng lẻ thành tỷ lệ nhớ hay chẩn đoán tính cách.

### 10. [P3] Jitter chôn thẻ không phân tán theo thẻ

Vị trí: `src/core/srs/index.js:289`.

Công thức chỉ phụ thuộc lapsesToday. Ở lần sai thứ hai, mọi thẻ đều nhận 2 giờ jitter và hẹn 06:00 hôm sau theo giờ địa phương. Ca hai ID khác nhau cho dueDate y hệt. Điều này trái mục đích comment “không dồn 62 thẻ”.

Sửa: hash ổn định theo cardId+ngày để phân tán, hoặc random được lưu một lần. Nếu chỉ cần phân theo ngày trong queue thì bỏ tuyên bố phân tán giờ.

## Đánh giá các thuật toán

| Thành phần | Đánh giá |
|---|---|
| FSRS D/S/S_short, forgetting curve | Công thức chính và 34 defaults khớp nguồn FSRS-7 được đối chiếu; không phải chỉ gắn nhãn FSRS lên SM-2. |
| Solver Newton trên log(t) | Lựa chọn hợp lý để giữ thời gian dương; có giới hạn bước/lặp. Nên bổ sung kiểm tra residual và fallback chia đôi cho bộ tham số biên; chưa tái hiện lỗi solver mặc định trong audit này. |
| Learning/relearning | Có hạn phút/ngày thật, tránh lặp ngay thẻ chưa tới hạn. Again của thẻ Mastered chưa leech vẫn hẹn tức thì theo chủ ý hiện tại; cần đánh giá trải nghiệm, không mặc định coi là lỗi số học. |
| Heuristics và bonus typing | Bias nhỏ có clamp, bonus áp lên gia số thay vì toàn bộ stability là hướng thận trọng. Tuy nhiên ±15% S0 và +25% gia số vẫn là giả định của sản phẩm; chưa có bằng chứng audit này về mức tăng hiệu quả học thực tế. |
| Queue/cap | Chia nhóm rõ và Learning được ưu tiên. Đang có lỗi đếm đầu vào; ngân sách dành từ mới trước due có thể làm tồn đọng due khi cap thấp. Smart Cram sort số ngày tương lai giảm dần nên ưu tiên xa hạn hơn; cần xác định có đúng mục tiêu “khẩn cấp” hay không. |
| Training | Adam chuẩn hóa, temporal holdout, bootstrap theo thẻ và gate không tự nhận cải thiện là điểm mạnh. Cần sửa chuỗi lịch sử bị cắt, bổ sung regularization/constraint và theo dõi calibration trên dữ liệu tương lai. |
| Typing | OSA Damerau-Levenshtein O(n*m), có chặn input 128; phân biệt typo theo độ dài và tốc độ. Hard cho câu gần đúng vẫn được coi là recall thành công: nên đo riêng spelling accuracy và recall accuracy. Target vẫn có thể rất dài qua import, nên chặn cả target hoặc dùng distance có ngưỡng. |
| Dedup | Multi-bucket/stem/deletion giúp giảm so sánh; có bảo vệ khác từ loại/confusable và chính sách gộp. “Semantic” chủ yếu là overlap/heuristic văn bản tiếng Việt, không phải suy luận nghĩa tổng quát. Bucket lớn có thể bị bỏ để bảo vệ hiệu năng, không bảo đảm recall 100%. |
| IndexedDB và Cloud | Ghi card+outbox cùng transaction, revision và acknowledgement chống mất edit khi request đang chạy là thiết kế tốt. LWW cho bộ nhớ giúp hội tụ nhưng hai review offline đồng thời có thể chỉ giữ một trạng thái; không tương đương replay cả hai sự kiện. |
| Progress/gamification | CRDT signed contributions giúp cộng nhiều tab và hoàn tác. Undo còn chỉ trừ một phần stats trong khi trackReview/trackXP cập nhật nhiều khóa; cần mở rộng kiểm tra toàn bộ hậu quả của Undo, gồm badge đã mở. |
| Bảo mật | Rules hiện có owner isolation. Nhánh users/{uid}/** cho owner ghi rộng, không kiểm schema card như legacy; đây là thiếu validation phía server, chưa phải bằng chứng đọc chéo tài khoản. Không suy ra cấu hình Firebase đang deploy từ file rules cục bộ. |
| Kiến trúc và bảo trì | Core thuần dễ test, nhưng state/events và vòng import động còn coupling; logic review bị nhân đôi giữa modes là nguồn lỗi rõ nhất. 108 lint warnings và entry chỉ còn ~0,25 kB budget cần xử lý có kế hoạch. |

## Thứ tự sửa đề nghị

1. Sửa revision dedup và hợp đồng MEMORY/Undo trước: bảo vệ tính đúng của dữ liệu đã lưu.
2. Gom Flashcard/Typing/Quiz vào một hàm áp dụng review; thống nhất count/cap/suspended và cách Undo. Ghi card, log, progress như một sự kiện có ID để có thể kiểm tra và phục hồi khi một bước lưu thất bại.
3. Sửa TSV suspension và thiết kế JSON backup đầy đủ.
4. Sửa dữ liệu replay trước khi tin vào kết quả optimizer; bổ sung constraints cho weights.
5. Đồng bộ E2E với đặc tả, bổ sung regression toàn luồng cho các ca đã tái hiện.
6. Điều chỉnh persona, jitter, chính sách cram và độ nặng bundle.

## Bằng chứng và giới hạn kết luận

- `reproduce.mjs`: các assertion xác nhận lỗi hiện tại. Exit 0 nghĩa là tái hiện thành công, KHÔNG phải ứng dụng không có lỗi.
- `evidence.json`: đầu ra 9 ca tái hiện.
- `existing-tests.txt`, `e2e.txt`: log chạy bộ test hiện tại.
- Chưa chạy lại sau sửa vì nhiệm vụ hiện tại là đánh giá, không thay đổi logic.
- Không có dữ liệu học thật để chứng minh retention 90%, hiệu quả bonus typing, độ chính xác semantic dedup hay chất lượng dự đoán cá nhân hóa. Không có cơ sở chấm các mục này như hiệu quả đã kiểm định.

Nguồn đối chiếu công thức và constraint FSRS-7 (truy cập 03/11/2026): https://raw.githubusercontent.com/open-spaced-repetition/srs-benchmark/main/models/fsrs_v7.py . Các thay đổi heuristic, typing bonus, learning caps trong dự án là lớp chính sách riêng; không suy ra chúng được nguồn FSRS xác nhận.
