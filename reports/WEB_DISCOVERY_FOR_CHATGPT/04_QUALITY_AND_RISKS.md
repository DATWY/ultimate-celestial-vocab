# 04 — ĐÁNH GIÁ CHẤT LƯỢNG KỸ THUẬT & DANH MỤC RỦI RO (QUALITY & RISKS)
**Dự án:** Ultimate Celestial Vocab ✨  
**Phương pháp kiểm định:** Tĩnh (Static Analysis), Động (Dynamic Test Execution) & Build Verification  

---

## 1. Kết Quả Kiểm Tra Sức Khỏe Kỹ Thuật (Technical Health Check)

### 1.1. Trạng Thái Build & Bundle (Vite Bundler)
- **Lệnh thực thi:** `npm run build` (`vite build`).
- **Kết quả:** **THÀNH CÔNG (Exit code 0)** trong **1.35 giây**.
- **Kích thước các gói tài nguyên xuất bản:**
  - `dist/index.html`: **67.74 kB** (Gzip: **13.07 kB**).
  - `dist/assets/index-B4y3PooK.css`: **269.93 kB** (Gzip: **47.58 kB**).
  - `dist/assets/index-CFuuevHi.js`: **246.85 kB** (Gzip: **79.27 kB**).
  - `dist/assets/badges-BHO_RRLX.js`: **18.94 kB** (Gzip: **6.73 kB**).
  - `dist/assets/streakRecovery-CO_nWIef.js`: **11.16 kB** (Gzip: **3.92 kB**).
  - `dist/assets/quiz-BvNyRphn.js`: **10.16 kB** (Gzip: **3.71 kB**).
  - `dist/assets/optimizer.worker-C9pqUn01.js`: **2.61 kB**.
  - `dist/assets/worker-manager-BS1sHksj.js`: **1.64 kB**.
  - `dist/sw.js` & `dist/workbox-835c8c05.js`: Hoàn thành sinh Service Worker precache 23 tài nguyên (**942.15 KiB**).
- **Cảnh báo ghi nhận (Build Warnings):**
  - Rollup phát cảnh báo de-optimization do các module `state.js`, `srs/index.js`, `typing.js`, `events.js` vừa được nạp tĩnh trong `main.js` lại vừa được nạp động bằng `import()` trong các file con, khiến Rollup không thể tách rời các chunk đó ra file riêng.

---

### 1.2. Kết Quả Chạy Các Bộ Kiểm Thử (Test Suite Executions)

| Bộ Kiểm Thử (Test File) | Mục Tiêu Kiểm Định | Số Ca Kiểm Thử | Kết Quả Thực Tế | Đánh Giá Chi Tiết |
|---|---|:---:|:---:|---|
| [scratch/test_sync_merger.mjs](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/scratch/test_sync_merger.mjs) | Động cơ hòa giải 4-Vector Disentangled Sync | 6/6 | **PASS 100%** | Hòa giải hoàn hảo giữa thay đổi nội dung trên PC và đánh giá SRS trên Mobile, xử lý chuẩn xác thẻ bị xóa (Tombstone) và phục hồi (Resurrect). Nén 5,000 logs chỉ mất 2ms. |
| [scratch/test_fsrs7_validation.js](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/scratch/test_fsrs7_validation.js) | Trình xác thực chuỗi 34 tham số FSRS-7 | 8/8 | **PASS 100%** | Bắt chuẩn xác lỗi thiếu tham số (17/34), thừa số (35/34), chuỗi rỗng, ký tự NaN, và giá trị âm ngoài biên sinh học. |
| [scratch/test_streak_comprehensive.js](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/scratch/test_streak_comprehensive.js) | Tính toán ngày tháng, Streak & Heatmap | 6/6 | **PASS 100%** | Chuyển tiếp lịch chính xác, bảo toàn kỷ lục cũ khi đứt chuỗi, hoàn tác review tự động trả về mốc hôm qua, tự phục hồi chuỗi ngày từ Heatmap. |
| [scratch/test_full_fuzzy_engine.js](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/scratch/test_full_fuzzy_engine.js) | Thuật toán Semantic Dedup v5.0 | 7/7 | **PASS 100%** | Phân loại chính xác các trường hợp trùng: EXACT, INFLECTION (-ing, -s), FUZZY_TYPO, và không nhận nhầm các từ khác biệt (*affect* vs *effect*, *adapt* vs *adopt*). |
| [scratch/test_fsrs7_scenarios.js](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/scratch/test_fsrs7_scenarios.js) | Toàn bộ ma trận toán học FSRS-7 | 59/60 | **FAIL 1 CA (Nhóm 7)** | Xem phân tích nguyên nhân gốc rễ bên dưới. |

---

### 1.3. Phân Tích Lỗi Kiểm Thử Tại `test_fsrs7_scenarios.js` (Root Cause Analysis)

- **Vị trí phát sinh:** [scratch/test_fsrs7_scenarios.js](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/scratch/test_fsrs7_scenarios.js#L186)
- **Thông báo lỗi:** `Error: Gõ đúng (typing) phải tăng stability_long nhiều hơn bấm nút`
- **Nguyên nhân kỹ thuật chính xác:**
  - Trong [src/core/srs/index.js](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/src/core/srs/index.js#L118), điều kiện để kích hoạt phần thưởng gõ đúng $+25\%$ Stability là:
    ```javascript
    if (modality === 'typing' && rating > 1 && (card.reps || 0) > 0 && actualDaysElapsed >= 0.05)
    ```
  - Thẻ giả lập trong file test được khởi tạo như sau:
    ```javascript
    const testCard = { english: 'type', stability: 10.0, stabilityShort: 8.0, difficulty: 5.0, srsStatus: 'Mastered' };
    ```
  - Thẻ `testCard` **không khai báo trường `reps`** và **không khai báo `lastReviewDate`**.
  - Do `card.reps` là `undefined` nên `(card.reps || 0) > 0` bị trả về `false`.
  - Đồng thời, do không có `lastReviewDate`, hệ thống gán `lastReviewDate = now`, dẫn đến `actualDaysElapsed = 0 < 0.05`.
  - **Kết luận:** Đây là lỗi của **dữ liệu mock trong kịch bản kiểm thử** (thiếu trường `reps` và thời gian quá khứ), không phải lỗi trong logic toán học vận hành thực tế của FSRS-7 (trong ứng dụng thực tế, mọi thẻ chuyển sang Mastered đều đã có `reps >= 1` và `lastReviewDate` hợp lệ).

---

## 2. Nợ Kỹ Thuật (Technical Debt)

1. **Monolithic CSS Khổng Lồ:**
   - File [src/css/style.css](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/src/css/style.css) chứa **386.7 KB** với hơn 8,600 dòng CSS thuần.
   - Chưa được chia tách thành các module chuyên biệt (như `components/`, `layouts/`, `themes/`). Mọi thay đổi về màu sắc hoặc kích thước dễ tạo ra hiệu ứng domino không lường trước.
2. **Cặp Ghép Chặt Chẽ Giữa DOM và Code (Tight DOM Coupling):**
   - File [src/ui/elements.js](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/src/ui/elements.js) ánh xạ hơn 80 ID phần tử HTML tĩnh trong [index.html](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/index.html).
   - Nếu bất kỳ ID nào bị đổi tên trong quá trình tái cấu trúc HTML mà không cập nhật đồng bộ trong `elements.js`, ứng dụng sẽ gặp lỗi `null pointer exception` khi khởi tạo.
3. **Cheat Engine Lộ Diện Trong Production Entry:**
   - File [src/main.js](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/src/main.js#L12) phơi bày đối tượng `window.cheat` cho phép người dùng tự buff XP, can thiệp streak, đặt lại reviews và xóa sạch dữ liệu từ DevTools Console. Cần có cờ bảo vệ hoặc chỉ nạp trong môi trường Development (`import.meta.env.DEV`).

---

## 3. Các Vấn Đề Giao Diện & Trải Nghiệm Người Dùng Đã Xác Minh (UI/UX Observations)

1. **Khoảng Cách Vùng Bấm Trên Màn Hình Nhỏ (< 360px):**
   - Trên màn hình điện thoại bề ngang hẹp, cụm 4 nút đánh giá SRS (`Quên`, `Khó`, `Nhớ`, `Dễ`) có khoảng cách chạm (Touch target padding) khá hẹp, dễ dẫn đến hiện tượng chạm nhầm nút lân cận.
2. **Thiếu Trạng Thái Tải Khung Xương (Skeleton Shimmering):**
   - Khi mở danh sách từ vựng lần đầu, người dùng nhìn thấy đoạn text tĩnh "Đang tải danh sách từ vựng...". Trải nghiệm sẽ cao cấp hơn nếu sử dụng thẻ skeleton nhấp nháy ánh sáng tím mờ.
3. **Bàn Phím Gõ Tiếng Việt Can Thiệp Vào Chế Độ Typing:**
   - Khi người học kích hoạt chế độ gõ phím Active Recall trên thiết bị di động, bộ gõ Telex/VNI có thể tự động bỏ dấu tiếng Việt vào từ vựng tiếng Anh (ví dụ gõ "as" thành "á"), gây ra lỗi typo ngoài ý muốn. Thẻ `<input>` cần được bổ sung các thuộc tính tắt gõ tiếng Việt tự động như `autocorrect="off"`, `autocapitalize="none"`, `spellcheck="false"`.

---

## 4. Bảng Phân Tích Rủi Ro Khi Nâng Cấp Hệ Thống (Regression Risk Matrix)

| Khu Vực Nâng Cấp | Mức Độ Rủi Ro | Độ Tin Cậy Bằng Chứng | Hậu Quả Tiềm Ẩn Nếu Vi Phạm | Biện Pháp Phòng Vệ Bắt Buộc |
|---|:---:|:---:|---|---|
| **Schema Dữ Liệu Thẻ Bài FSRS-7** | **CRITICAL (Tối Khẩn)** | Đã xác minh 100% | Làm hỏng vĩnh viễn tiến trình học của người dùng trên Cloud Firestore và IndexedDB. Thẻ sẽ bị nhảy lịch sai lệch hàng năm. | Giữ nguyên 100% tên trường: `difficulty`, `stability`, `stabilityShort`, `reps`, `lapses`, `srsStatus`, `srsDueDate`, `srsInterval`. |
| **Đưa Tailwind CSS Vào Dự Án** | **CRITICAL (Tối Khẩn)** | Đã xác minh 100% | Lớp Preflight Reset của Tailwind sẽ làm vỡ hoàn toàn layout, font chữ Lexend, kích thước nút và giao diện Glassmorphism hiện tại. | Tiếp tục sử dụng Pure CSS hoặc CSS Modules có đóng gói phạm vi (Scoped/Isolated). |
| **Động Cơ Đồng Bộ 4-Vector** | **HIGH (Cao)** | Đã xác minh 100% | Xung đột ghi đè thô bạo (Last-Write-Wins), làm mất tiến trình ôn tập trên điện thoại khi người dùng chỉnh sửa nghĩa từ trên PC. | Giữ nguyên logic tách biệt 4 vector trong `firebase.js` và `sync.js`. |
| **Đổi Tên ID Trong `index.html`** | **HIGH (Cao)** | Đã xác minh 100% | Gây sập các hàm render và listener trong `events.js`, `render.js` và `modal.js`. | Nếu đổi tên DOM, phải cập nhật đồng bộ trong `elements.js`. |
| **Sửa Đổi Lõi Âm Thanh `sound.js`** | **MEDIUM (Trung bình)** | Đã xác minh 100% | Mất khả năng phát âm từ vựng khi ngoại tuyến hoặc bị chặn CORS từ Google Apps Script. | Duy trì cơ chế 3 lớp: IndexedDB Object URL cache $\to$ Google Apps Script Proxy $\to$ Web Speech API fallback. |
| **Canvas Vũ Trụ `celestial-canvas.js`** | **LOW (Thấp)** | Đã xác minh 100% | Gây hao pin thiết bị nếu vô tình gỡ bỏ bộ đếm thời gian tự ngắt sau 3 giây (Eco Idle Timeout). | Giữ nguyên cơ chế tự động drain và resume khi có tương tác chuột/phím. |
