# 05 — TÀI LIỆU BÀN GIAO ĐẶC BIỆT DÀNH CHO CHATGPT (CHATGPT HANDOFF DOSSIER)
**Gửi tới:** AI Principal Architect & Systems Prompt Engineer (ChatGPT GPT-6)  
**Từ:** Lead Auditor & Principal Systems Analyst (Google Antigravity Discovery Team)  
**Mục tiêu bàn giao:** Cung cấp đầy đủ bối cảnh kỹ thuật, hình ảnh và ràng buộc cốt lõi để ChatGPT thiết kế một **MASTER PROMPT NÂNG CẤP WEBSITE THƯƠNG MẠI CAO CẤP** dành riêng cho hệ thống này.  
**Trạng thái hệ sinh thái:** Hoàn toàn nguyên vẹn — Không qua chỉnh sửa, không refactor trong giai đoạn kiểm toán.  

---

Chào bạn đồng nghiệp! Nếu bạn đang đọc tài liệu này, bạn sắp sửa thiết kế một Master Prompt giúp nhóm kỹ sư hoặc AI nâng cấp toàn diện dự án **Ultimate Celestial Vocab**. Dưới đây là bản tóm lược kỹ sư trưởng (Chief Architect Briefing) chứa đựng toàn bộ sự thật về hệ thống mà không cần bạn phải truy cập trực tiếp vào hàng chục ngàn dòng mã nguồn.

---

## 1. Website Này Thực Sự Là Gì? (The Ground Truth)

**Ultimate Celestial Vocab** không phải là một ứng dụng "Todo" hay "Flashcard đồ chơi". Đây là một **nền tảng học từ vựng tiếng Anh chuyên sâu cá nhân hóa thế hệ mới (Personalized Next-Gen Spaced Repetition Platform)** được xây dựng công phu theo triết lý **Local-First / Offline-First PWA**.

Sản phẩm kết hợp 4 trụ cột kỹ thuật đỉnh cao:
1. **Lõi FSRS-7 (34 tham số sinh học):** Mô hình toán học DSR (Difficulty - Stability - Retrievability) tiên tiến nhất hiện nay, vượt xa thuật toán cổ điển SuperMemo SM-2 (vốn đang dùng trong Anki cổ điển) hay Quizlet.
2. **Linguistic Heuristics v2:** Bộ máy đọc hiểu âm tiết, cấu trúc từ ghép và tần suất từ điển O(1) để tự gán độ khó khách quan cho từ mới (giải quyết triệt để bài toán Cold-Start).
3. **Động cơ đồng bộ phân tán 4-Vector:** Hòa giải xung đột đa thiết bị (PC, Laptop, Smartphone) trên nền Cloud Firestore mà không làm mất dữ liệu của nhau.
4. **Hệ thống Gamification & Thẩm mỹ Thiên hà (Celestial Aesthetics):** Giao diện kính mờ Glassmorphism, nền sao vũ trụ, hiệu ứng rèm cửa Shipper Curtain, hệ thống cấp bậc học giả và huy hiệu tu luyện phong cách Tiên hiệp thiên hà.

---

## 2. Kiến Trúc Đặc Thù Bắt Buộc Phải Bảo Toàn (Architectural Invariants)

Khi thiết kế prompt nâng cấp, bạn **BẮT BUỘC** phải đưa các quy tắc bất biến này vào làm Guardrails:

1. **KHÔNG ĐƯỢC ĐƯA FRAMEWORK NẶNG VÀO (Zero React, Zero Vue):** Dự án đang chạy bằng **Pure Vanilla JavaScript (ES Modules)** và Vite. Tốc độ nạp trang dưới 500ms và dung lượng bundle JS production chỉ nặng 79.27 KB gzip. Việc cố gắng chuyển đổi sang React hoặc Next.js sẽ làm vỡ toàn bộ cấu trúc event-driven hiện có, tăng dung lượng gấp 10 lần và làm mất bản sắc siêu nhẹ của sản phẩm.
2. **TUYỆT ĐỐI KHÔNG DÙNG TAILWIND CSS:** Dự án sở hữu hệ thống CSS thuần hơn 8,600 dòng với các biến `:root` được tính toán kỹ lưỡng. Đưa Tailwind CDN hoặc Tailwind Build vào sẽ kích hoạt lớp Preflight ghi đè toàn bộ font, button, margin và làm vỡ tan giao diện.
3. **BẢO TỒN SCHEMA DỮ LIỆU FSRS-7:** Dữ liệu thẻ từ vựng lưu trong IndexedDB và Firestore mang cấu trúc bất biến:
   - `difficulty` (Độ khó $D \in [1, 10]$)
   - `stability` (Độ bền dài hạn $S_{\text{long}}$ tính bằng ngày)
   - `stabilityShort` (Độ bền ngắn hạn $S_{\text{short}}$)
   - `reps` (Tổng số lần ôn tập thành công)
   - `lapses` (Số lần bị quên)
   - `srsDueDate` (Timestamp mili-giây đến hạn)
   - `srsInterval` (Khoảng cách ngày)
   - `srsStatus` ("New" | "Learning" | "Mastered")
   *Không được đổi tên hoặc thay đổi định dạng của bất kỳ trường nào trong số này.*
4. **BẢO TỒN NGUYÊN TẮC HÒA GIẢI ĐỒNG BỘ 4-VECTOR:** Tầng sync phân tách 4 vector: Tombstone, SRS Memory, Content, Tags. Không được gộp chung việc ghi đè một trường làm ảnh hưởng đến các trường khác.

---

## 3. Các Trang & Chức Năng Quan Trọng Nhất (The Vital Organs)

| Thứ Tự | Thành Phần | Mức Độ Quan Trọng | Lý Do |
|:---:|---|:---:|---|
| **1** | **Flashcard Study Stage & 4 Phím SRS** | **SỐNG CÒN** | Nơi người học dành 80% thời gian. Mọi vi tương tác (lật thẻ, tính nhãn dự báo thời gian thực `<10p`, `1d`, `3d`, `7d`, phát âm, gõ phím) phải mượt mà tuyệt đối ở 60/120 FPS. |
| **2** | **Central Hub — Tab 1: Tổng Quan & Sức Khỏe Trí Nhớ** | **RẤT CAO** | Bảng điều khiển Bento Grid HUD thể hiện uy tín khoa học của sản phẩm: Cấp độ học giả, Chuỗi streak, 3 vi đo FusionSRS (Mức độ thuộc bài %, Thời gian nhớ tự nhiên S, Tổng reviews), Biểu đồ dự báo 7 ngày, Heatmap 84 ngày. |
| **3** | **Active Recall Typing Modality** | **RẤT CAO** | Đột phá độc quyền: Gõ đúng được thưởng $+25\%$ Stability vào FSRS-7. Tính năng bấm giờ phản xạ nơ-ron nhận thức tại ký tự đầu tiên gõ phím. |
| **4** | **Central Hub — Tab 2: Quản Lý Từ Vựng & Radar Dedup** | **CAO** | Tìm kiếm mờ thông minh (Fuzzy Search không dấu tiếng Việt), phân loại thẻ, cuộn vô tận, quét và gộp từ trùng lặp thông minh bảo toàn điểm SRS. |
| **5** | **Grand Victory Stage** | **CAO** | Bục cúp vàng 3D và pháo hoa khi hoàn thành bài học, tùy chọn học nhồi (+10 thẻ) hoặc đóng sổ nghỉ ngơi củng cố trí nhớ. |
| **6** | **Chế Độ Bài Kiểm Tra (Quiz Mode)** | **TRUNG BÌNH** | Thử thách trí nhớ tính giờ, đồng hồ tròn Radial Gauge và HUD tổng kết hiệu suất. |

---

## 4. Ngôn Ngữ Thiết Kế Hiện Tại (Visual Aesthetic)

- **Trường phái:** **Celestial Glassmorphism** (Không gian thiên hà huyền ảo kết hợp kính mờ acrylic).
- **Obsidian Dark Mode:** Nền đen tím không gian sâu (`#0b0d19`), các bề mặt nổi kính acrylic bán trong suốt (`rgba(22, 27, 46, 0.75)` có `backdrop-filter: blur(16px)`), viền phát sáng huỳnh quang tím (`#8a2be2`) và xanh neon (`#00f5ff`).
- **Porcelain Light Mode:** Nền sáng tinh khôi ánh mây (`#f8fafc`), thẻ trắng sứ nguyên khối (`#ffffff`), chữ đen than đạt chuẩn tương phản cao quốc tế **WCAG 2.1 AA/AAA** (`#0f172a`), các điểm nhấn màu pastel tươi tắn.
- **Hoạt ảnh đặc sắc:** Nền sao tương tác chuột tự động ngủ sau 3 giây (`celestial-canvas.js`) và hiệu ứng Rèm cửa Shipper Curtain (`transition.css`) hoán đổi Dark/Light mode không giật lag.

---

## 5. Những Thành Phần Cần Cải Thiện Nhiều Nhất (Prime Targets for Upgrade)

Khi tạo Master Prompt, bạn nên định hướng nhóm kỹ sư nâng cấp các điểm sau:

1. **Module hóa CSS (CSS De-monolithization):** Bóc tách file [src/css/style.css](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/src/css/style.css) khổng lồ (386.7 KB) thành các file chuyên biệt (`css/components/card.css`, `css/components/dock.css`, `css/views/hub.css`, `css/themes/tokens.css`) thông qua tính năng `@import` của Vite, giữ nguyên tên class để không làm vỡ HTML.
2. **Trải Nghiệm Tải Dữ Liệu Khung Xương (Skeleton Shimmering):** Thay thế các dòng text tải tĩnh như "Đang tải danh sách từ vựng..." bằng các thẻ Skeleton Card chuyển động ánh sáng mờ tím sang trọng.
3. **Tối Ưu Hóa Vùng Chạm Trên Điện Thoại Nhỏ (< 360px):** Mở rộng chiều cao và khoảng cách an toàn cho 4 nút đánh giá SRS ở chân thẻ bài trên mobile để đạt chuẩn Apple Human Interface Guidelines / Android Material Touch Target ($\ge 48\text{px}$).
4. **Trải Nghiệm Gõ Phím Mobile (Typing UX):** Bổ sung thuộc tính ngăn chặn bộ gõ tiếng Việt Telex/VNI tự động bỏ dấu sai vào ô gõ tiếng Anh (`autocorrect="off"`, `autocapitalize="none"`, `spellcheck="false"`).
5. **Đóng Gói Cheat Engine An Toàn:** Chuyển đối tượng `window.cheat` trong [src/main.js](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/src/main.js) vào trong khối kiểm tra `if (import.meta.env.DEV)` để không lộ lệnh hack XP trên môi trường người dùng cuối.

---

## 6. Những Chức Năng Chưa Hoàn Thiện Hoặc Đang Ở Dạng Cơ Bản

1. **Đăng nhập người dùng (Multi-user Authentication):** Hiện tại hệ thống đang chạy ở chế độ **Cá nhân (Personal-use single tenant)**; Firestore phân biệt thiết bị qua `deviceId`. Toàn bộ cấu trúc đã chuẩn bị sẵn sàng cho Firebase Auth (Email/Google Sign-In) nhưng giao diện đăng nhập chưa được dựng.
2. **Âm thanh giọng đọc phát âm:** Hiện tại đang dựa vào Google Apps Script Web Proxy cá nhân và Web Speech API nội tại của trình duyệt. Nếu Google Apps Script bị quá tải quota, âm thanh sẽ tự động rơi về giọng Web Speech API của máy (chất lượng giọng phụ thuộc vào OS người dùng). Có thể tích hợp thêm audio CDN hoặc Web Audio buffer offline.

---

## 7. Các Giới Hạn Kỹ Thuật Khi Redesign (Technical Constraints)

1. **DOM Cache Coupling:** Toàn bộ phần tử DOM quan trọng được gom ở [src/ui/elements.js](file:///C:/Users/ASUS/Desktop/CODING/test%20v3/ultimate-celestial-vocab%20-%20vipper%201/src/ui/elements.js). Bất kỳ prompt nào yêu cầu đổi ID trong HTML đều phải kèm theo việc cập nhật `elements.js`.
2. **IndexedDB Migration:** Người dùng đã có sẵn dữ liệu học tập thực tế trong cơ sở dữ liệu `celestial-vocab-idb`. Mọi thay đổi về cấu trúc store đều phải thông qua hàm migration mềm (Soft Migration), không được xóa trắng DB cũ.
3. **PWA Precaching:** File `vite.config.js` đã cấu hình precache chặt chẽ cho font và icon. Khi thêm asset mới, cần chú ý kích thước asset để không làm phình Service Worker precache vượt quá ngưỡng 2MB.

---

## 8. Các Khu Vực Có Nguy Cơ Hồi Quy (High Regression Risk Areas)

1. **`src/core/srs/index.js` & `srs/*.js`:** Đây là trái tim toán học của dự án. **CẤM CHỈNH SỬA** các công thức toán học FSRS-7 trừ khi hiểu rõ phương pháp Newton-Raphson trên không gian $\ln(t)$ và phân rã trí nhớ kép.
2. **`src/core/firebase.js` & `src/core/sync.js`:** Đây là động cơ đồng bộ phân tán 4-vector đã vượt qua các bài kiểm thử đối kháng đa luồng. Việc tự ý can thiệp logic merge sẽ làm hỏng dữ liệu khi người dùng chuyển đổi qua lại giữa PC và điện thoại.
3. **`src/css/transition.css`:** Hiệu ứng rèm cửa chạy bằng CSS transform GPU. Nếu can thiệp sai lầm sang các thuộc tính như `left/right/width`, FPS sẽ bị tụt nghiêm trọng trên các máy cấu hình yếu.

---

## 9. Những Câu Hỏi Còn Thiếu Bằng Chứng & Lời Khuyên Cho Bước Tiếp Theo

- **Về Firebase Security Rules trên Production:** Hiện tại dự án đang cấu hình mở hoặc bảo vệ theo IP nội bộ cá nhân của tác giả. Khi đưa ứng dụng lên mức thương mại hóa đa người dùng (Multi-tenant SaaS), ChatGPT cần thiết kế thêm hệ thống Firebase Security Rules phân tách theo `request.auth.uid`.
- **Về Kho Từ Vựng Gốc:** Ứng dụng hiện lưu trữ dữ liệu người dùng trực tiếp trong IndexedDB; khi người dùng mới truy cập lần đầu vào kho rỗng, ứng dụng hiển thị màn hình Vinh Quang / Kho Rỗng thông minh hướng dẫn nạp file TSV. Một bộ Master Prompt nâng cấp có thể bổ sung thêm tính năng "Kho từ mẫu Starter Decks" (ví dụ: Oxford 3000, IELTS 7.0, TOEIC 900 có sẵn để 1-click nạp ngay).

---

## 10. Thông Điệp Cuối Cho ChatGPT (Final Directive)

Bạn đang cầm trên tay một viên ngọc thô có phần lõi kỹ thuật và toán học vô cùng xuất sắc: **Thuật toán FSRS-7 chính xác, đồng bộ 4-vector không xung đột, PWA siêu nhẹ tải dưới 500ms**.

Hãy thiết kế Master Prompt theo tôn chỉ:
> **"BẢO TỒN NGUYÊN VẸN LÕI TOÁN HỌC & ĐỒNG BỘ ĐÁM MÂY — TẬP TRUNG TỐI ĐA VÀO NÂNG TẦM TRẢI NGHIỆM THẨM MỸ, VI TƯƠNG TÁC XÚC GIÁC, VÀ SỰ TINH TẾ CỦA GIAO DIỆN THƯƠNG MẠI ĐẲNG CẤP THẾ GIỚI."**

Chúc bạn thành công rực rỡ!
