# Ultimate Celestial Vocab ✨

**Ultimate Celestial Vocab** là một ứng dụng Web / PWA (Progressive Web App) học từ vựng tiếng Anh tiên tiến. Dự án được thiết kế chuyên biệt để đem lại trải nghiệm học tập siêu tốc, mượt mà và thông minh bằng cách tích hợp các công nghệ lặp lại ngắt quãng (Spaced Repetition) hiện đại cùng các yếu tố Gamification.

![Version](https://img.shields.io/badge/version-2.1.0-blue.svg)
![Status](https://img.shields.io/badge/status-Active-success.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

---

## 🌟 Tính Năng Nổi Bật (Key Features)

- **FSRS Algorithm (Fusion Spaced Repetition):** Thuật toán tối ưu hóa thời gian ôn tập hiện đại, thay thế cho SM-2 cũ.
- **Heuristics Engine v2:** Hệ thống "đọc hiểu" độ khó của từ vựng ngay khi chưa học (phân tích âm tiết, cấu trúc cụm từ, và tần suất xuất hiện) để thiết lập lịch học tối ưu ngay từ lần đầu tiên.
- **CMA-ES Optimizer Worker:** Web Worker chạy ngầm để tối ưu hóa trọng số (weights) của thuật toán FSRS, giúp cá nhân hóa lộ trình học theo từng người dùng.
- **Smart Cloud Sync:** Đồng bộ hóa dữ liệu thời gian thực (Real-time) và Offline-first với Firebase Firestore.
- **Gamification:** Hệ thống điểm kinh nghiệm (XP), Cấp độ, Huy hiệu (Badges), và hiệu ứng phần thưởng sinh động.
- **Text-to-Speech (TTS):** Hỗ trợ đọc phát âm tiếng Anh và tiếng Việt.
- **Giao Diện Siêu Mượt (Smooth UX):** Hiệu ứng chuyển giao "Rèm Cửa Shipper" xịn xò khi chuyển đổi Dark/Light mode, tối ưu hóa FPS nhờ Pure CSS.
- **Hỗ Trợ Đa Nền Tảng (PWA):** Cài đặt như một ứng dụng Native trên cả Desktop và Mobile, hỗ trợ hoạt động ngoại tuyến (Offline Mode).

---

## 🛠 Tech Stack (Công Nghệ Sử Dụng)

Dự án đề cao sự tối giản, hiệu năng cao và loại bỏ các Framework cồng kềnh:
- **Core:** HTML5, Vanilla JavaScript (ES6+), Pure CSS (Sử dụng CSS Variables).
- **Build Tool:** Vite (siêu tốc, HMR, bundling chuẩn PWA).
- **Backend / Database:** Firebase SDK v10 (Firestore, Authentication, Hosting).
- **Icons:** Phosphor Icons.
- **Animations:** Anime.js & CSS Keyframes.
- **PWA:** Vite PWA Plugin & Workbox.

---

## 🚀 Hướng Dẫn Cài Đặt (Local Development)

### Yêu cầu hệ thống
- Node.js (Phiên bản v18 trở lên)
- Trình duyệt web hiện đại (Chrome, Edge, Firefox, Safari)

### Các bước chạy dự án

1. **Clone repository:**
   ```bash
   git clone https://github.com/your-username/ultimate-celestial-vocab.git
   cd ultimate-celestial-vocab
   ```

2. **Cài đặt thư viện dependencies:**
   ```bash
   npm install
   ```

3. **Thiết lập Firebase (Tùy chọn):**
   - Đảm bảo bạn đã cấu hình Firebase config trong file `src/core/firebase.js`.
   - Nếu bạn muốn deploy lên môi trường riêng của bạn:
     ```bash
     npm install -g firebase-tools
     firebase login
     firebase init
     ```

4. **Khởi chạy Development Server:**
   ```bash
   npm run dev
   ```
   *Ứng dụng sẽ tự động mở trên `http://localhost:5173/`.*

5. **Build cho Production (Xuất file):**
   ```bash
   npm run build
   ```

---

## 📂 Cấu Trúc Thư Mục

Dự án được cấu trúc theo hướng **Modular Event-Driven Architecture**. Xem thêm tài liệu [DESIGN_DOC.md](./DESIGN_DOC.md) để biết chi tiết về thiết kế hệ thống.

```text
src/
├── core/                  # Core Business Logic & Algorithms
├── features/              # Modular Features (Gamification, Quiz, I/O)
├── ui/                    # DOM Manipulation, Modals, Render Logic
├── css/                   # Pure CSS Stylesheets
├── events.js              # Central Event Listeners Hub
└── main.js                # App Entry Point
```

---

## 🤝 Đóng Góp (Contributing)
Mọi đóng góp (Pull Request, Report Bug, Feature Suggestion) đều được hoan nghênh.
1. Fork dự án
2. Tạo Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit thay đổi (`git commit -m 'Add some AmazingFeature'`)
4. Push lên Branch (`git push origin feature/AmazingFeature`)
5. Mở Pull Request

---

## 📝 Giấy Phép (License)
Dự án được phân phối dưới giấy phép MIT. Tự do sao chép, chỉnh sửa và sử dụng.
