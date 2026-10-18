# 00 — BÁO CÁO TỔNG QUAN ĐIỀU HÀNH (EXECUTIVE SUMMARY)
**Dự án:** Ultimate Celestial Vocab ✨  
**Phiên bản hiện tại:** v4.3.0  
**Ngày kiểm toán:** 18 Tháng 10, 2026  
**Chế độ thực hiện:** READ-ONLY Technical & Visual Reconnaissance  
**Người thực hiện:** Principal Software Architect, Senior Product Designer & Full-Stack Systems Auditor  
**Đối tượng bàn giao:** AI Architect (ChatGPT GPT-6) phục vụ thiết kế Master Prompt Nâng cấp Website  

---

## 1. Bản Chất Sản Phẩm (What is Ultimate Celestial Vocab?)

**Ultimate Celestial Vocab** là một nền tảng Web App Lũy Tiến (Progressive Web Application — PWA) học từ vựng tiếng Anh cá nhân hóa cao cấp, hoạt động theo triết lý **Local-First & Offline-First**. 

Sản phẩm kết hợp giữa khoa học nhận thức não bộ hiện đại nhất, thuật toán lặp lại ngắt quãng thế hệ mới **FSRS-7 (Free Spaced Repetition Scheduler — 34 tham số sinh học)**, bộ máy phân tích độ khó ngôn ngữ học **Linguistic Heuristics v2**, hệ thống đồng bộ hóa đám mây đa thiết bị **4-Vector Disentangled Sync Engine (Firebase Firestore)**, và trải nghiệm thẩm mỹ không gian vũ trụ huyền ảo (**Celestial Glassmorphism Aesthetics**).

Khác biệt cốt lõi so với các phần mềm truyền thống (như Anki, Quizlet hay Memrise):
1. **Khắc phục "Ease Hell":** FSRS-7 thay thế hoàn toàn hệ số Ease thô sơ của SM-2 bằng mô hình biến thiên động học DSR (Difficulty - Stability - Retrievability) có cơ chế kéo về điểm cân bằng (Mean Reversion).
2. **Triệt tiêu hiện tượng Cold-Start:** Linguistic Heuristics v2 tự động quét cấu trúc âm tiết, từ ghép và tần suất xuất hiện trong từ điển để gắn độ khó $D_0$ khách quan ngay khi người học chưa từng lật thẻ.
3. **Phân tách phản xạ kép (Dual-Track Modality):** Tích hợp chế độ gõ phím chủ động (Active Typing Recall) với phần thưởng sinh học $+25\%$ Stability, phản ánh chính xác liên kết nơ-ron cơ tay.
4. **Đồng bộ phi xung đột (4-Vector Sync):** Người dùng có thể sửa nội dung thẻ bài trên máy tính để bàn (PC) và đồng thời bấm ôn tập trên điện thoại (Mobile) mà không làm mất bất kỳ thông tin nào của nhau.

---

## 2. Công Nghệ & Kiến Trúc Tổng Thể

### 2.1. Tech Stack Cốt Lõi
- **Môi trường & Bundler:** Node.js (hỗ trợ v18+ đến v26+), Vite 5.0, `vite-plugin-pwa` 1.3.0 với Workbox caching.
- **Frontend Framework:** **100% Pure Vanilla JavaScript (ES Modules)** kết hợp Web Components và Direct DOM Manipulation. **Hoàn toàn KHÔNG sử dụng React, Vue, Angular hay Svelte**.
- **CSS Framework:** **Pure Custom CSS** (hơn 8,600 dòng trong [style.css](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/src/css/style.css) và [transition.css](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/src/css/transition.css)). Không dùng Tailwind CSS, Bootstrap hay CSS-in-JS.
- **Local Storage Layer:** IndexedDB được bọc bởi thư viện `idb` 8.0.3 ([idb.js](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/src/core/idb.js)), lưu trữ 2 object store độc lập: `vocabulary` (keyPath: `id`) và `settings` (key-value store).
- **Cloud Backend & Sync:** Firebase SDK 10.8.1 nạp qua ESM CDN (`firebase-app`, `firebase-firestore`, `firebase-storage`) với `persistentLocalCache` và multi-tab manager.
- **Audio & TTS:** Google Apps Script Web Proxy kết hợp Web Audio API (bộ tạo dao động sóng âm Procedural Synthesizer cho SFX) và Web Speech API (`window.speechSynthesis`).
- **Animation & Physics:** `animejs` 3.2.1, HTML5 Canvas 2D particle physics engine cho hiệu ứng nền sao ([celestial-canvas.js](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/src/ui/celestial-canvas.js)) và pháo hoa ăn mừng ([render.js](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/src/ui/render.js)).
- **Icons & Typography:** Phosphor Icons Web Duotone/Fill/Bold, Google Font "Lexend" (weights 300, 400, 500, 600, 700).
- **Background Processing:** Web Workers (`optimizer.worker.js`) cho thuật toán tối ưu tham số CMA-ES.

### 2.2. Mô Hình Kiến Trúc Ứng Dụng
Ứng dụng vận hành theo mô hình **Event-Driven SPA (Single Page Application)** với luồng dữ liệu một chiều cục bộ:
- Shell HTML duy nhất ([index.html](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/index.html)) chứa toàn bộ markup của trang chủ và 6 modal điều khiển.
- Bộ định tuyến (Router) dựa trên class `.hidden` và tham số URL query (`?tab=...`, `?theme=...`).
- Bộ đệm DOM tập trung tại [elements.js](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/src/ui/elements.js) gom nhóm tất cả các phần tử DOM quan trọng thành đối tượng `DOM` với tra cứu $O(1)$.
- Tầng lưu trữ bộ nhớ [state.js](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/src/core/state.js) quản lý in-memory store song song với bản đồ chỉ mục `_vocabIndex` (Map `id -> index`) để đạt tốc độ truy xuất $O(1)$.

---

## 3. Các Trang, Màn Hình & Trạng Thái Giao Diện Chính

| STT | Màn hình / View State | Vai trò chức năng chính | Ảnh chụp thực tế liên quan |
|---|---|---|---|
| 1 | **Main Study View (Front)** | Không gian học tập trung tâm: hiển thị từ vựng tiếng Anh, nút phát âm kèm sóng âm động, đánh dấu sao, ô nhập liệu gõ phím active recall. | `desktop-home-dark.png`, `desktop-home-light.png`, `mobile-home.png` |
| 2 | **Main Study View (Back/Flipped)** | Mặt sau thẻ: hiển thị định nghĩa tiếng Việt, loại từ, phiên âm IPA, chủ đề (tags), câu ví dụ ngữ cảnh, và 4 nút đánh giá SRS (Quên, Khó, Nhớ, Dễ) tích hợp nhãn dự báo thời gian giãn cách thực tế. | `desktop-card-flipped.png`, `card_study_back.webp` |
| 3 | **Celestial Stats Dock** | Bảng đo tiến độ nổi ở chân màn hình: 3 vòng tròn chỉ số SVG (Đã thuộc, Cần ôn, Đang học), thanh phân bổ phân đoạn Segmented Progress Bar, và các pill đo tổng số từ/bộ lọc. | `desktop-home-dark.png`, `app_dashboard.webp` |
| 4 | **Grand Victory Stage (Empty/Done)** | Màn hình kết thúc phiên học: cúp vàng vinh quang 3D, pháo hoa hạt confetti, các chip tổng kết (Streak, Đã thuộc, Sẵn sàng nhồi), tùy chọn học nhồi (+10 thẻ) hoặc đóng sổ nghỉ ngơi. | `desktop-victory-stage.png` |
| 5 | **Celestial Hub — Tab 1: Tổng Quan & Sức Khỏe Trí Nhớ** | Bento Grid HUD: Cấp độ học giả mạ kim loại, chuỗi ngày streak rực lửa, 3 thanh vi đo FusionSRS (Mức độ thuộc bài %, Thời gian nhớ tự nhiên S, Tổng số lần ôn), Biểu đồ dự báo 7 ngày, Ma trận nhiệt 84 ngày. | `desktop-hub-overview.png`, `profile_modal.webp`, `mobile-hub-overview.png` |
| 6 | **Celestial Hub — Tab 2: Danh Sách Từ Vựng** | Trung tâm quản lý kho thẻ: Thanh tìm kiếm mờ Fuzzy Search, bộ lọc chủ đề, bộ lọc trạng thái SRS, thẻ từ vựng thiết kế Pastel hiện đại, cuộn vô tận IntersectionObserver, thao tác xóa hàng loạt. | `desktop-hub-vocab-list.png`, `manage_modal_words.webp`, `mobile-hub-vocab.png` |
| 7 | **Celestial Hub — Tab 3: Dữ Liệu & Sao Lưu** | Bento Grid nhập/xuất: Kéo thả tệp TSV/TXT, dán văn bản, xuất tệp TSV, xuất JSON Review Logs phục vụ huấn luyện, nút mở cấu hình 34 tham số FSRS-7, khu vực nguy hiểm xóa trắng dữ liệu. | `desktop-hub-data-io.png`, `manage_modal_io.webp`, `mobile-hub-io.png` |
| 8 | **Celestial Hub — Tab 4: Phòng Truyền Thống Huy Hiệu** | Hệ thống danh hiệu Tu Luyện & Vũ Trụ: 7 cấp phẩm (Thường, Lục, Lam, Sử Thi, Huyền Thoại, Thần Thoại, Tối Thượng) trải dài trên 4 lộ trình (Tu Luyện XP, Bền Bỉ Streak, Trí Tuệ Mastered, Luyện Tập Reviews). | `desktop-hub-badges.png` |
| 9 | **Add / Edit Word Modal** | Hộp thoại thêm mới hoặc chỉnh sửa thẻ: Tiếng Anh, Nghĩa tiếng Việt (tự động làm sạch & khử trùng lặp nội tại), Loại từ, Phiên âm, Tags, Câu ví dụ. | `desktop-modal-add-word.png` |
| 10 | **Radar Semantic Dedup Modal** | Công cụ dò tìm từ vựng trùng lặp bằng thuật toán mờ (Fuzzy Levenshtein & Biến thể ngữ pháp), hiển thị bảng so sánh trực quan và hỗ trợ nút "Gộp Tất Cả" bảo toàn điểm SRS cao nhất. | `desktop-modal-dedup.png` |
| 11 | **FSRS-7 Config Modal** | Hộp thoại cấu hình 34 tham số FSRS-7: Khung dán JSON/chuỗi phân tách dấu phẩy, trình xác thực biên thời gian thực (Validation Matrix), khôi phục thông số chuẩn. | `desktop-modal-fsrs7-config.png`, `fsrs7_config_modal.webp` |
| 12 | **Quiz Mode (Setup & Results Luxury)** | Chế độ kiểm tra trí nhớ độc lập: Thiết lập số lượng câu hỏi và thời gian giới hạn, vòng quay điểm số Radial Gauge, bento metrics HUD (Độ chính xác, Tốc độ trung bình, XP kiếm được), danh sách từ sai kèm nút ôn tập tức thì. | `desktop-quiz-setup.png` |

---

## 4. Ngôn Ngữ Thiết Kế & Phong Cách Thị Giác Hiện Tại

- **Triết lý chủ đạo:** **Celestial Deep-Space Glassmorphism** (Không gian thiên hà kính mờ).
- **Chế độ Tối (Obsidian Dark Mode):** Nền không gian sâu thẳm (`#0b0d19` đến `#151828`), các tấm kính mờ acrylic (`rgba(22, 27, 46, 0.75)` với `backdrop-filter: blur(16px)`), viền phát sáng neon tím (`#8a2be2`, `#a855f7`) và lam ngọc (`#00f5ff`, `#38bdf8`).
- **Chế độ Sáng (WCAG 2.1 AA Compliant Pastel Light Mode):** Nền sáng tinh khôi ánh mây (`#f8fafc` đến `#f1f5f9`), bề mặt thẻ trắng sứ nguyên khối (`rgba(255, 255, 255, 0.95)`), độ tương phản văn bản cao đạt chuẩn tiếp cận quốc tế AA/AAA với chữ đen than (`#0f172a`), các điểm nhấn sắc màu ngọc lam, ngọc bích và tím hoa cà.
- **Hiệu ứng Chuyển cảnh Shipper Curtain:** Khi bấm chuyển đổi Dark/Light mode, hai cánh rèm màu đồng bộ đóng sập vào giữa màn hình từ hai phía, huy hiệu biểu tượng xoay nảy (Pop-in), lớp nền hoán đổi class `dark` sau lưng rèm, rồi rèm mở ra phơi bày trạng thái mới. Toàn bộ hiệu ứng chạy 100% bằng CSS `transform: translateX` kích hoạt GPU Compositor Thread, đạt 60/120 FPS không giật lag.

---

## 5. Đánh Giá Chất Lượng Kỹ Thuật (Strengths & Constraints)

### 5.1. Điểm Mạnh Vượt Trội (Architectural Highlights)
1. **Hiệu năng tải trang cực nhanh:** Zero-framework overhead. Toàn bộ gói JS production chỉ nặng **79.27 KB gzip** ([dist/assets/index-CFuuevHi.js](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/dist/assets/index-CFuuevHi.js)). Thời gian dựng `vite build` chỉ mất **1.35 giây**.
2. **Độ chín muồi của thuật toán FSRS-7:** Đầy đủ 34 tham số, giải thuật phân rã trí nhớ kép Dual-Track Stability ($S_{\text{short}}$ và $S_{\text{long}}$), tính khoảng cách ngày bằng phương pháp lặp Newton-Raphson trong không gian $\ln(t)$, có chốt chặn an toàn ngày đầu tiên $\le 21$ ngày chống bấm nhầm Easy.
3. **Bộ đồng bộ 4-Vector Disentangled:** Cơ chế hòa giải xung đột không làm mất dữ liệu giữa các thiết bị di động và máy tính, có bù trừ lệch đồng hồ phần cứng 3 phút và chống lặp vòng phản xạ (Loopback suppression).
4. **Hệ sinh thái kiểm thử sẵn có:** Có sẵn các bộ kiểm thử đối kháng đa luồng trong thư mục [scratch/](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/scratch/) kiểm chứng độ chính xác toán học và cấu trúc dữ liệu.

### 5.2. Các Giới Hạn & Vấn Đề Kỹ Thuật Cần Lưu Tâm (Constraints & Debt)
1. **File CSS Đơn Khối Khổng Lồ (Monolithic CSS):** File [src/css/style.css](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/src/css/style.css) có dung lượng lên tới **386.7 KB** với hơn 8,600 dòng lệnh. Nhiều quy tắc CSS được xếp chồng qua nhiều phiên bản nâng cấp, có nguy cơ xung đột specificity cao nếu can thiệp thiếu cẩn trọng.
2. **Khung HTML Đơn Khối (Monolithic DOM Shell):** File [index.html](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/index.html) dài 1,015 dòng chứa tất cả các modal, bục vinh quang, thanh điều khiển. Toàn bộ DOM được nạp tĩnh ngay từ đầu thay vì render theo nhu cầu.
3. **Cặp Ghép Chặt Chẽ DOM (Tight DOM Coupling):** Logic xử lý trong [render.js](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/src/ui/render.js) và [events.js](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/src/events.js) phụ thuộc vào đúng từng ID và class của phần tử trong `index.html`. Nếu đổi tên ID hoặc cấu trúc thẻ con, các hàm hiển thị sẽ gãy ngay lập tức.
4. **Cảnh báo De-optimization của Vite:** Một số module (như `state.js`, `srs/index.js`, `typing.js`) vừa được `import` tĩnh ở `main.js` lại vừa được `import()` động ở các module con, khiến Rollup không thể tách chunk tối ưu hoàn toàn.
5. **Điểm kiểm thử Typing Edge-Case:** Trong file [scratch/test_fsrs7_scenarios.js](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/scratch/test_fsrs7_scenarios.js), kịch bản kiểm thử Nhóm 7 (Typing Modality Bonus) bị fail do đối tượng thẻ giả lập không khai báo trường `reps` và `lastReviewDate`, dẫn đến biểu thức điều kiện `actualDaysElapsed >= 0.05` và `(card.reps || 0) > 0` bị trả về `false`.

---

## 6. Rủi Ro Hồi Quy Quan Trọng Cần Bảo Vệ Khi Nâng Cấp (Regression Risks)

1. **RỦI RO SCHEMA DỮ LIỆU SRS:** Tuyệt đối không được đổi tên hoặc thay đổi ý nghĩa của các trường: `difficulty`, `stability`, `stabilityShort`, `reps`, `lapses`, `srsStatus`, `srsDueDate`, `srsInterval`, `lastReviewDate`. Hàng ngàn bản ghi ôn tập trong Firestore và IndexedDB của người dùng sẽ bị hỏng hoàn toàn nếu schema bị lệch.
2. **RỦI RO TAILWIND CSS:** Tuyệt đối không đưa Tailwind CSS hoặc các thư viện CSS Reset thô bạo vào dự án. Lớp Preflight của Tailwind sẽ ghi đè toàn bộ font size, margin, button, typography chuẩn của Pure CSS hiện tại.
3. **RỦI RO BỘ ĐỒNG BỘ 4-VECTOR:** Tầng đồng bộ [sync.js](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/src/core/sync.js) và [firebase.js](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/src/core/firebase.js) dựa trên tính độc lập của 4 vector. Bất kỳ thay đổi nào làm gộp chung việc ghi thẻ đều sẽ gây xung đột dữ liệu đa thiết bị (đè mất tiến độ SRS khi sửa nghĩa từ trên PC).

---

## 7. Đề Xuất Trọng Tâm Cho ChatGPT Khi Thiết Kế Master Upgrade Prompt

Khi ChatGPT GPT-6 thiết kế Master Prompt nâng cấp hệ thống, cần ưu tiên phân bổ năng lực vào:
1. **Module hóa CSS:** Bóc tách [style.css](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/src/css/style.css) thành các module hướng thành phần (`css/components/`, `css/views/`, `css/theme/`) mà không làm thay đổi class name.
2. **Nâng cấp Vi Tương Tác & Phản Hồi Xúc Giác (Micro-Interactions):** Hoàn thiện trạng thái Loading, Empty State, Skeleton Screens, âm thanh phản hồi haptic, và chuyển cảnh mượt mà giữa Flashcards và Quiz.
3. **Tối ưu hóa Bố cục Màn hình Lớn & Siêu Nhỏ (Ultra-Wide & Mobile Foldables):** Giữ vững tỷ lệ vàng giao diện trên màn hình laptop 1366x768 cũng như smartphone màn hình dài.
4. **Bảo tồn trọn vẹn Lõi Toán học FSRS-7 & Động cơ Sync 4-Vector:** Mọi cải tiến chỉ được phép can thiệp ở tầng View (Presentation) và UX Flow, tôn trọng 100% hợp đồng dữ liệu hiện hữu.
