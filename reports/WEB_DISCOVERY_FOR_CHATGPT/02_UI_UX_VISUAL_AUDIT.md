# 02 — BÁO CÁO KHẢO SÁT GIAO DIỆN & TRẢI NGHIỆM NGƯỜI DÙNG (UI/UX AUDIT)
**Dự án:** Ultimate Celestial Vocab ✨  
**Phương pháp thực hiện:** Headless Chrome High-Resolution Rendering & Real-Device Visual Inspection  
**Bộ ảnh chụp bằng chứng:** Nằm trong thư mục [reports/WEB_DISCOVERY_FOR_CHATGPT/screenshots/](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/reports/WEB_DISCOVERY_FOR_CHATGPT/screenshots/)  

---

## 1. Khảo Sát Từng Màn Hình Thực Tế (Screen-by-Screen Audit)

### 1.1. Trang Chủ / Không Gian Học Tập Flashcard (Main Study Stage)
- **Ảnh tham chiếu:** 
  - Chế độ Tối: [desktop-home-dark.png](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/reports/WEB_DISCOVERY_FOR_CHATGPT/screenshots/desktop-home-dark.png)
  - Chế độ Sáng: [desktop-home-light.png](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/reports/WEB_DISCOVERY_FOR_CHATGPT/screenshots/desktop-home-light.png)
  - Điện thoại di động: [mobile-home.png](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/reports/WEB_DISCOVERY_FOR_CHATGPT/screenshots/mobile-home.png)
- **Bố cục thực tế:**
  - **Header tinh gọn (Fixed Top Bar):** Bên trái là Brand Pod biểu tượng hạt ngọc vũ trụ phát sáng cùng tên ứng dụng "Ultimate Celestial Vocab". Ở giữa và bên phải là 3 nhóm công cụ:
    - Nhóm 1: Dropdown chọn chủ đề học (`#custom-topic-dropdown`) với thanh tìm kiếm tích hợp và nút Đồng bộ Cloud (`#manual-sync-btn`).
    - Nhóm 2: Nút Kiểm tra (`#start-quiz-btn`) và nút Trung Tâm Điều Khiển (`#celestial-hub-btn`).
    - Nhóm 3: Dropdown chọn chế độ Gõ phím Active Recall (`#custom-typing-dropdown`), nút đổi Theme Tối/Sáng (`#toggle-dark-mode-btn`) và nút Âm thanh (`#toggle-sound-btn`).
  - **Khối Flashcard Trung Tâm:** Card dạng thẻ bay 3D Perspective (`#flashcard-area`), nằm cân đối giữa màn hình. Mặt trước hiển thị từ vựng tiếng Anh cỡ lớn (32px–40px, font Lexend Semibold), nút phát âm kèm 4 thanh sóng âm chuyển động theo thời gian thực (`#audio-waveform`), nút đánh dấu sao.
  - **Bảng Đo Tiến Độ Nổi (Celestial Stats Dock):** Nằm cố định sát đáy màn hình. Gồm 3 vòng đo tròn SVG mini (Đã thuộc - Xanh lục, Cần ôn - Đỏ cam, Đang học - Tím neon), một thanh phân bổ phân đoạn (Segmented Progress Bar) thể hiện tỷ lệ % của 4 nhóm từ, và hàng pill siêu dữ liệu (Tổng số thẻ, Đang lọc, Từ mới).

### 1.2. Mặt Sau Thẻ Bài & 4 Phím Đánh Giá SRS (Card Flipped State)
- **Ảnh tham chiếu:** [desktop-card-flipped.png](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/reports/WEB_DISCOVERY_FOR_CHATGPT/screenshots/desktop-card-flipped.png), [card_study_back.webp](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/reports/WEB_DISCOVERY_FOR_CHATGPT/screenshots/card_study_back.webp)
- **Chi tiết hiển thị:**
  - Hoạt ảnh lật 180 độ mượt mà.
  - Mặt sau chia làm các hàng chi tiết rõ ràng: Nghĩa tiếng Việt (màu nổi bật), Loại từ (dạng badge mờ), Phiên âm IPA (có thể bấm vào để nghe lại), Chủ đề (các thẻ tag bo tròn), và Câu ví dụ có gạch chân từ khóa ngữ cảnh.
  - Cụm 4 nút đánh giá SRS chuẩn FSRS-7 (`.srs-feedback-grid`):
    1. **Quên (Rating 1):** Biểu tượng bộ não (`ph-brain`), nhãn giãn cách `<10p` màu đỏ san hô.
    2. **Khó (Rating 2):** Biểu tượng ngọn lửa (`ph-fire`), nhãn giãn cách `1d` màu cam hổ phách.
    3. **Nhớ (Rating 3):** Biểu tượng tia sáng (`ph-sparkle`), nhãn giãn cách `3d` màu lam ngọc.
    4. **Dễ (Rating 4):** Biểu tượng tích tròn (`ph-check-circle`), nhãn giãn cách `7d` màu ngọc bích.
  - Điểm xuất sắc UX: Các nhãn thời gian này **không phải số cố định** mà được hàm `predictNextIntervals(card)` tính toán thời gian thực theo đúng trạng thái $D$ và $S$ của thẻ đó.

### 1.3. Bục Vinh Quang Khi Hết Thẻ Cần Ôn (Grand Celestial Victory Stage)
- **Ảnh tham chiếu:** [desktop-victory-stage.png](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/reports/WEB_DISCOVERY_FOR_CHATGPT/screenshots/desktop-victory-stage.png)
- **Chi tiết hiển thị:**
  - Tự động kích hoạt khi hàng đợi ôn tập hôm nay về 0.
  - Hiệu ứng pháo hoa Confetti 7 màu rực rỡ rơi từ đỉnh thẻ trên canvas 2D riêng biệt.
  - Cột bên trái: Bục Cúp Vàng Vũ Trụ 3D phát sáng hào quang Nebula, chùm 3 ngôi sao vàng và huy hiệu tròn "SỨ MỆNH HOÀN THÀNH".
  - Cột bên phải: Tiêu đề lớn "XUẤT SẮC HOÀN THÀNH!", 3 chip chiến tích (Chuỗi Streak, Đã Thuộc, Sẵn Sàng Nhồi), và 2 nút hành động lớn:
    - **Nút Hero 1:** "Tiếp tục học nhồi (+10 thẻ)" — Phục vụ người học muốn bứt phá trước hạn.
    - **Nút Hero 2:** "Hoàn tất & Nghỉ ngơi" — Đóng sổ mục tiêu trong ngày, kích hoạt thông điệp "Nghỉ ngơi trọn vẹn, Học giả! Não bộ đang củng cố liên kết nơ-ron".

### 1.4. Trung Tâm Điều Khiển — Tab 1: Tổng Quan & Sức Khỏe Trí Nhớ (Overview Bento)
- **Ảnh tham chiếu:** [desktop-hub-overview.png](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/reports/WEB_DISCOVERY_FOR_CHATGPT/screenshots/desktop-hub-overview.png), [profile_modal.webp](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/reports/WEB_DISCOVERY_FOR_CHATGPT/screenshots/profile_modal.webp)
- **Chi tiết hiển thị:**
  - Bố cục Bento Grid đa tầng:
    - **Thẻ Cấp Độ Học Giả:** Biểu tượng khiên bạc mạ kim loại, cấp độ số lớn (Level 4), thanh tiến độ kinh nghiệm XP mượt mà, ghi rõ lượng XP còn thiếu để thăng hạng.
    - **Thẻ Chuỗi Ngày Streak:** Biểu tượng ngọn lửa rực sáng, đếm số ngày liên tục (12 ngày).
    - **Cụm Vi Đo Sức Khỏe Trí Nhớ FusionSRS (Telemetry Micro-Meters):** 3 thẻ HUD gồm:
      - *Mức Độ Thuộc Bài:* 94.2% (Thanh đo ngọc lục bảo).
      - *Thời Gian Nhớ Tự Nhiên:* 14.8 ngày (Thanh đo tím huỳnh quang).
      - *Tổng Số Lần Đã Ôn:* Đếm số lượt tích lũy kiến thức.
    - **Ma trận 2 cột cân đối dưới cùng:**
      - *Biểu đồ Dự báo Ôn tập (7 ngày tới):* Biểu đồ cột SVG thể hiện số lượng từ vựng sẽ rơi vào chu kỳ ôn tập các ngày tới.
      - *Ma trận Nhiệt Hoạt Động (84 Ngày Qua):* Heatmap dạng ô vuông ngọc bích đa sắc độ, thể hiện mật độ học tập không ngừng nghỉ.

### 1.5. Trung Tâm Điều Khiển — Tab 2: Danh Sách Từ Vựng (Vocab Management)
- **Ảnh tham chiếu:** [desktop-hub-vocab-list.png](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/reports/WEB_DISCOVERY_FOR_CHATGPT/screenshots/desktop-hub-vocab-list.png), [manage_modal_words.webp](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/reports/WEB_DISCOVERY_FOR_CHATGPT/screenshots/manage_modal_words.webp)
- **Chi tiết hiển thị:**
  - Thanh tìm kiếm mờ Fuzzy Search với biểu tượng kính lúp, hỗ trợ gõ tiếng Việt không dấu.
  - Hai dropdown lọc: Lọc theo chủ đề (All / TOEIC / Advanced...) và Lọc theo trạng thái SRS (All / Mới / Đang học / Đã thuộc / Tạm ngưng).
  - Nút thêm nhanh từ vựng (`+ Thêm Từ`).
  - Danh sách thẻ từ vựng thiết kế dạng Card Bento hiện đại:
    - Dải màu phát sáng cạnh trái phân biệt trạng thái (Xanh dương = Mới, Vàng cam = Đang học, Xanh lá = Đã thuộc).
    - Chip phiên âm bạc hà, chip loại từ xám khói, chip độ khó D và độ bền S.
    - Thao tác tại chỗ: Nút nghe phát âm, nút sửa, nút xóa, nút đánh dấu sao.
  - Cuộn vô tận mượt mà nhờ phần tử giám sát `#word-list-sentinel` tích hợp `IntersectionObserver`.

### 1.6. Trung Tâm Điều Khiển — Tab 3: Dữ Liệu & Sao Lưu (Data & IO)
- **Ảnh tham chiếu:** [desktop-hub-data-io.png](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/reports/WEB_DISCOVERY_FOR_CHATGPT/screenshots/desktop-hub-data-io.png), [manage_modal_io.webp](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/reports/WEB_DISCOVERY_FOR_CHATGPT/screenshots/manage_modal_io.webp)
- **Chi tiết hiển thị:**
  - 3 khối Bento phẳng tinh gọn:
    1. **Khối Nhập Dữ Liệu:** Hỗ trợ tab kéo-thả tệp TSV/TXT vào vùng Dropzone hoặc dán văn bản trực tiếp. Tự động kiểm tra trùng lặp và mở modal xem trước trước khi ghi vào database.
    2. **Khối Xuất Dữ Liệu:** Xuất tệp TSV toàn bộ kho từ vựng hoặc xuất tệp JSON Review Logs phục vụ huấn luyện FSRS-7.
    3. **Khối Cấu Hình FSRS & Quản Trị:** Nút mở hộp thoại 34 tham số FSRS-7 và Khu vực nguy hiểm xóa trắng dữ liệu (Danger Zone) có cảnh báo xác nhận hai lớp.

### 1.7. Trung Tâm Điều Khiển — Tab 4: Phòng Truyền Thống Huy Hiệu (Badges Showcase)
- **Ảnh tham chiếu:** [desktop-hub-badges.png](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/reports/WEB_DISCOVERY_FOR_CHATGPT/screenshots/desktop-hub-badges.png)
- **Chi tiết hiển thị:**
  - Hệ thống huy hiệu phong cách Tiên hiệp / Tu chân thiên hà độc bản (Xianxia Cosmic Theme).
  - 4 đường đua danh hiệu: Tu Luyện (XP), Bền Bỉ (Chuỗi ngày), Trí Tuệ (Số từ đã thuộc), Luyện Tập (Tổng số lượt review).
  - 7 cấp phẩm huy hiệu hiển thị hiệu ứng viền phát sáng và icon tương ứng: Thường (`#B0BEC5`), Lục (`#81C784`), Lam (`#64B5F6`), Sử Thi (`#BA68C8`), Huyền Thoại (`#FFD54F`), Thần Thoại (`#E57373`), Tối Thượng (`#F06292`).

### 1.8. Hộp Thoại Quét Trùng Lặp Thông Minh (Radar Semantic Dedup Modal)
- **Ảnh tham chiếu:** [desktop-modal-dedup.png](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/reports/WEB_DISCOVERY_FOR_CHATGPT/screenshots/desktop-modal-dedup.png)
- **Chi tiết hiển thị:**
  - Bảng so sánh 2 thẻ từ bị trùng lặp cạnh nhau.
  - Phân loại rõ lý do trùng: Trùng khớp tuyệt đối (EXACT), Biến thể ngữ pháp (-ing, -ed, số nhiều), Sai lệch chính tả (FUZZY_TYPO độ tương đồng >80%).
  - Nút gộp từng cặp hoặc nút "Gộp Tất Cả" tự động chọn thẻ có độ bền $S$ và số reps cao nhất, gộp nghĩa tiếng Việt không bị trùng lặp từ.

### 1.9. Hộp Thoại Cấu Hình 34 Tham Số FSRS-7 (FSRS-7 Config Modal)
- **Ảnh tham chiếu:** [desktop-modal-fsrs7-config.png](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/reports/WEB_DISCOVERY_FOR_CHATGPT/screenshots/desktop-modal-fsrs7-config.png), [fsrs7_config_modal.webp](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/reports/WEB_DISCOVERY_FOR_CHATGPT/screenshots/fsrs7_config_modal.webp)
- **Chi tiết hiển thị:**
  - Thẻ trạng thái bộ thông số hiện tại (Mặc định vs Đã tối ưu cá nhân hóa).
  - Ô Textarea hỗ trợ dán mảng JSON hoặc chuỗi số phân cách dấu phẩy.
  - Bộ kiểm định biên thời gian thực: Báo lỗi nếu thiếu số (ví dụ chỉ có 17/34), thừa số (35/34), chứa ký tự NaN hoặc số âm ngoài giới hạn sinh học.
  - Nút "Khôi phục Mặc định" và nút "Lưu & Áp Dụng".

---

## 2. Đánh Giá Thiết Kế Thị Giác Chi Tiết (Visual Design Criteria)

### A. Bố Cục (Layout)
- **Cấu trúc khung nhìn:** Sử dụng mô hình Full-viewport Flexbox & Grid kết hợp `overflow: hidden` trên body và thẻ cuộn cục bộ trong từng modal.
- **Chiều rộng tối đa (Max Container Width):**
  - Khung học Flashcard: Max-width 640px, căn giữa màn hình tạo điểm tập trung tuyệt đối vào từ vựng.
  - Khung Trung Tâm Điều Khiển: Max-width 1080px (dạng bento modal nổi).
  - Khung cấu hình FSRS-7: Max-width 620px.
- **Tỷ lệ và Căn chỉnh (Alignment):** Tuân thủ lưới 8px (khoảng cách padding và margin phổ biến: 8px, 12px, 16px, 20px, 24px, 32px).
- **Đáp ứng di động (Mobile Responsiveness):** Trên màn hình < 768px, toàn bộ menu Header thu gọn thành nút Hamburger (`#toggle-taskbar-btn`), các bảng Bento chuyển từ 2-3 cột thành dạng cuộn dọc 1 cột mượt mà, kích thước font tiêu đề thẻ tự động co giãn từ 36px xuống 26px.

### B. Nghệ Thuật Chữ (Typography)
- **Họ phông chữ:** `Lexend`, sans-serif (nạp từ Google Fonts). Đây là kiểu chữ có khoảng cách ký tự (character spacing) mở rộng đặc thù, được nghiên cứu khoa học giúp gia tăng tốc độ đọc và khả năng nhận diện mặt chữ của não bộ.
- **Thang phân cấp trực quan:**
  - Tiêu đề ứng dụng (Brand Title): 1.15rem (18.4px), Semibold 600.
  - Từ vựng Flashcard chính: 2.25rem – 2.5rem (36px–40px), Bold 700.
  - Nghĩa tiếng Việt: 1.25rem (20px), Medium 500.
  - Nhãn chi tiết (Label): 0.85rem (13.6px), Regular 400, độ tương phản mờ nhẹ.
  - Chỉ số số học HUD: 1.5rem – 2.0rem (24px–32px), Bold 700, font số Tabular Figures.

### C. Bảng Màu Thực Tế (Color Palette & Semantic Tokens)

```css
/* DARK THEME (Obsidian Space Nebula) */
--bg-primary: #0b0d19;          /* Nền đen tím obsidian sâu thẳm */
--bg-secondary: #121526;        /* Nền thẻ nổi thứ cấp */
--surface-glass: rgba(22, 27, 46, 0.75); /* Kính mờ phủ acrylic */
--border-glass: rgba(168, 85, 247, 0.25); /* Viền tím huỳnh quang mờ */
--text-primary: #f8fafc;         /* Chữ trắng tuyết */
--text-secondary: #94a3b8;       /* Chữ xám ánh lam */
--accent-purple: #8a2be2;        /* Tím thiên hà chủ đạo */
--accent-neon: #00f5ff;          /* Xanh lam huỳnh quang */

/* LIGHT THEME (Clean Aesthetic Porcelain) */
--bg-primary-light: #f8fafc;    /* Nền trắng sứ tinh khiết */
--surface-light: #ffffff;        /* Thẻ trắng nguyên khối */
--border-light: #e2e8f0;         /* Viền xám sáng tinh tế */
--text-primary-light: #0f172a;  /* Chữ đen than chuẩn WCAG AAA */
--text-secondary-light: #64748b;/* Chữ xám đậm */

/* SEMANTIC SRS STATUS COLORS */
--status-new: #0284c7;          /* Xanh dương biển sâu (Thẻ mới) */
--status-learning: #d97706;     /* Vàng cam hổ phách (Đang học) */
--status-mastered: #16a34a;     /* Xanh ngọc bích (Đã thuộc) */
--status-suspended: #dc2626;    /* Đỏ san hô (Tạm ngưng do quên nhiều) */
```

### D. Thành Phần Giao Diện (Components Architecture)
- **Nút bấm (Buttons):** Bo góc tròn nhẹ 10px–12px, có hiệu ứng `transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1)`. Khi hover phát sáng viền neon và hơi nhấc cao $1\text{px}$.
- **Ô nhập liệu (Inputs & Textarea):** Bo tròn 8px, nền bán trong suốt, khi focus có viền phát sáng kép (double glow) màu tím hoa cà.
- **Hộp thoại (Modals):** Nền phủ Backdrop Blur 12px, hiệu ứng mở Scale từ 0.95 lên 1.0 với độ mờ Opacity bằng Anime.js.

### E. Chuyển Động & Phản Hồi (Motion & Feedback)
- **Hiệu ứng Rèm cửa Shipper Curtain:** Chuyển giao Dark/Light mode ấn tượng và độc bản nhất của dự án, che giấu hoàn toàn hiện tượng nhấp nháy nền (Flash of unstyled content).
- **Canvas Vũ Trụ Sinh Học:** Các ngôi sao di chuyển chậm với vận tốc ngẫu nhiên và lấp lánh (twinkle). Khi rê chuột, các ngôi sao gần đó chịu lực hút/đẩy nhẹ tạo cảm giác không gian đa chiều sống động. Tự động tạm ngưng vòng lặp render sau 3 giây chuột đứng yên để tối ưu hóa thời lượng pin laptop và thiết bị di động.
- **Phản Hồi Âm Thanh:** Web Audio API phát tiếng click nhẹ khi chuyển thẻ, tiếng chuông ngân khi thuộc bài hoặc lên cấp, và giọng đọc chuẩn phát âm IPA khi bấm vào loa.

---

## 3. Đánh Giá Tính Đồng Nhất & Cơ Hội Nâng Cấp (Visual Consistency & Opportunities)

### Điểm đồng nhất rất tốt:
- Ngôn ngữ Glassmorphism và màu sắc thương hiệu tím thiên hà (`#8a2be2`) được tuân thủ xuyên suốt từ Header, Thẻ bài, Dock thống kê cho tới các Modal.
- Biểu tượng Phosphor Icons sử dụng đồng nhất trường phái Duotone và Fill đúng ngữ cảnh.
- Hệ thống nhãn thời gian dự báo FSRS-7 trên 4 nút đánh giá phản ánh chính xác trạng thái toán học.

### Điểm cần cải thiện khi nâng cấp:
1. **Thiếu Skeleton Screens:** Khi nạp danh sách từ vựng ở lần đầu mở modal, giao diện hiển thị dòng chữ thô "Đang tải danh sách từ vựng..." thay vì các khung xương chuyển động mờ (Skeleton shimmer effect).
2. **Kích thước style.css quá lớn:** Tất cả các khối giao diện được gộp chung trong một file duy nhất, khiến việc chỉnh sửa màu sắc cục bộ dễ gây tác dụng phụ ngoài ý muốn (Side-effects).
3. **Màn hình cực nhỏ (Narrow Phones < 360px):** Hàng nút 4 mức đánh giá SRS ở chân thẻ có thể bị bó hẹp khoảng cách padding khiến người dùng có ngón tay lớn dễ bấm nhầm giữa nút "Khó" và nút "Nhớ". Cần tăng chiều cao bấm tối thiểu đạt chuẩn 48px trên mobile.
