# Cấu Trúc Kỹ Thuật (Architecture Design Document)
**Dự án:** Ultimate Celestial Vocab (v2.x)
**Ngày tạo:** 28 Tháng 6, 2026
**Trạng thái:** Hoạt động (Active)

---

## 1. Bối Cảnh (Context) và Phạm Vi (Scope)
Ứng dụng **Ultimate Celestial Vocab** là một hệ thống Flashcard học từ vựng tiên tiến, tích hợp các thuật toán Spaced Repetition (Lặp lại ngắt quãng) hiện đại, Gamification, và Đồng bộ hóa đám mây (Firebase). 
Trong phiên bản gần đây, hệ thống đã được nâng cấp mạnh mẽ với sự ra mắt của **Heuristics Engine v2** giúp ứng dụng có khả năng "đọc và cảm nhận" độ khó từ vựng ngay khi người dùng chưa từng học nó, và **Hệ thống Transition Giao diện Shipper Curtain** giúp nâng tầm trải nghiệm người dùng (UX) một cách vượt trội.

Tài liệu này đóng vai trò là "Bản vẽ kỹ thuật" tổng quan cho dự án, hướng dẫn cách các module tương tác với nhau và giải thích các quyết định thiết kế quan trọng.

## 2. Mục Tiêu (Goals) & Giới Hạn (Non-Goals)
### Mục Tiêu
- **Nhẹ & Nhanh:** Giữ nguyên bản chất Pure CSS / Vanilla JS (ES Modules) kết hợp Vite, đảm bảo tốc độ tải trang dưới 500ms, đạt chuẩn PWA 100%.
- **Tự trị (Autonomous):** Thuật toán FSRS và Heuristics tự động tính toán mà không cần tương tác quá phức tạp từ người dùng.
- **Bền vững (Durability):** Mọi cấu trúc dữ liệu đều mang tính "Backward-compatible" (Tương thích ngược) để không làm vỡ các log lịch sử ôn tập (Review Logs) có sẵn trong Firebase.

### Giới Hạn
- Không sử dụng các Frontend Framework lớn như React / Vue để đảm bảo sự nguyên thủy và tối đa hoá tốc độ.
- Không sử dụng Tailwind CSS (Để không ghi đè và phá vỡ cấu trúc CSS gốc của dự án).

## 3. Kiến Trúc Tổng Quan (Architecture Design)
Dự án được xây dựng theo kiến trúc **Modular Vanilla JS** hướng sự kiện (Event-driven).

```text
src/
├── core/                  # Core Business Logic (Luật cốt lõi)
│   ├── srs/               # Cụm Thuật toán FSRS & Heuristics
│   │   ├── heuristics.js  # Heuristics Engine (Phân tích từ vựng bằng Rule-based)
│   │   ├── index.js       # Tính toán trạng thái thẻ tiếp theo (FSRS Logic)
│   │   └── worker-manager.js # Quản lý Web Worker (CMA-ES Optimizer)
│   ├── firebase.js        # Giao tiếp Cloud Firestore / Sync (Offline-first)
│   ├── state.js           # Quản lý Trạng thái Global (Global Store)
│   └── queue.js           # Thuật toán lập lịch hàng đợi (Review Queue)
├── features/              # Các Tính Năng Độc Lập
│   ├── gamification.js    # Hệ thống Cấp độ (XP) và Badges
│   └── quiz.js            # Tính năng Kiểm tra (Trắc nghiệm/Điền từ)
├── ui/                    # Cụm Giao Diện
│   ├── render.js          # DOM Manipulation (Hiển thị Flashcard, Stats)
│   └── modal.js           # Quản lý các Modal (Popup)
├── css/                   # Cụm Styling (CSS Thuần)
│   ├── style.css          # Core Styling (Light/Dark Variables)
│   └── transition.css     # Các hiệu ứng chuyển động phức tạp (Curtain Transition)
├── events.js              # Nút giao Gắn kết Sự Kiện (Event Listeners Root)
└── main.js                # Entry Point (Khởi tạo App, PWA, Audio)
```

## 4. Chi tiết Thiết Kế (Detailed Design)

### 4.1. The Heuristics Engine (Bộ Máy Ước Lượng Dữ Liệu Lạnh)
Vấn đề của thuật toán FSRS gốc là không thể đánh giá chính xác một thẻ hoàn toàn mới (New Card). 
**Giải pháp:** Module `heuristics.js` hoạt động tại Runtime (Không can thiệp Database), chạy duy nhất 1 lần khi `reps === 0`.
- **Phân tích Âm tiết (Syllable Analysis):** Đếm nguyên âm (Vowel Clusters), loại trừ "e" câm. Từ nhiều âm tiết => Tăng Độ Khó (Difficulty).
- **Phân tích Cấu trúc cụm (Phrasal):** Phát hiện từ ghép / cụm từ / Idiom qua Dấu gạch ngang và Khoảng trắng.
- **Kiểm tra Tần suất (Frequency Check):** Lookup O(1) qua danh sách `COMMON_WORDS` ~500 từ phổ biến. Giảm Độ Khó và kéo giãn Khoảng cách ôn tập (Interval) nếu từ thuộc loại Dễ.
- **Stability Multiplier:** Từ hệ số Bias của Độ khó, hệ thống nội suy ra một `StabilityMultiplier` (0.7x -> 1.3x) tác động thẳng vào Khoảng cách ngày ôn tập lần đầu.

### 4.2. Hệ Thống Chuyển Giao Giao Diện (Curtain Transition System)
Để đáp ứng yêu cầu UI cao cấp mà không chèn Tailwind CSS, hệ thống được bóc tách:
- **Cơ chế:** Khi nhấn Toggle Dark/Light Mode, Animation chặn luồng tương tác:
  1. CSS Animation (`transition.css`) kích hoạt đóng hai cánh rèm.
  2. Gắn kèm huy hiệu (Badge) bật nảy (`popIn`).
  3. SetTimeout (500ms) đổi class `dark` của `<body>` phía sau rèm.
  4. Mở rèm phơi bày trạng thái mới.
- **Tối ưu hóa:** Animation sử dụng `transform` thay vì `left/right` để tận dụng **GPU Acceleration** (Compositor Thread) giúp khung hình mượt mà tuyệt đối ở 60/120 FPS.

### 4.3. Firestore Synchronization (Smart Sync)
- **Cơ chế Offline-First:** Toàn bộ Flashcard, XP, và Lịch sử (Logs) lưu ở `localStorage`. `firebase.js` áp dụng Smart Sync đối chiếu Timestamps (Thời gian cập nhật) từng Item riêng biệt.
- Cơ chế chống ghi đè: Chỉ thực hiện Merge, bảo tồn 100% dữ liệu FSRS review history, cho phép đồng bộ chéo thiết bị an toàn.

## 5. Cân Nhắc Thay Thế (Alternatives Considered)

- **Tailwind CSS vs. Pure CSS:** Từng cân nhắc đưa Tailwind CDN vào để làm hiệu ứng Rèm cửa nhanh hơn. **Loại bỏ** vì Preflight của Tailwind phá vỡ cấu trúc CSS (`h1`, `button`, v.v.) hiện tại. Chọn Pure CSS (Custom classes) để tối ưu dung lượng và cách ly thay đổi (Isolation).
- **Lưu Bias vào Database vs Tính toán Runtime:** Việc lưu giá trị Heuristics (độ khó ảo) vào DB làm thay đổi Schema và tăng dung lượng thẻ. **Loại bỏ**. Việc tính toán bằng Regex lúc lật thẻ lấy cực ít tài nguyên (dưới 1ms).

## 6. Quyết định Bảo mật & Hiệu suất (Security & Performance)

- **Web Worker:** Quá trình CMA-ES Optimizer (Tối ưu hóa tham số FSRS) được đẩy vào Background Thread (`worker-manager.js`) để tránh treo UI (Block Main Thread).
- **Firebase Rules:** DB yêu cầu `request.auth` (khi tích hợp Authentication sau này) hoặc giới hạn đọc/ghi theo từng IP. Hiện đang dùng Public trong mô hình Personal-use.
- **DOM Caching:** Các element liên tục sử dụng được gom nhóm ở `ui/elements.js` (DOM Tree cache) giúp tránh query chậm qua `document.getElementById`.

## 7. Rollout / Testing Plan

- Việc tích hợp FSRS v2 và Heuristics v2 áp dụng **Rolling Release**. Mọi thẻ cũ có `difficulty` và `stability` dưới format cũ (SM-2) sẽ được hàm `calculateNextSrsState` tự động migrate ngầm (Soft Migration) lúc người dùng Review lần tiếp theo.
- Không cần kịch bản Rollback phức tạp nhờ dữ liệu `srsEaseFactor` và `srsInterval` cũ vẫn được giữ nguyên như một bản sao dự phòng.
