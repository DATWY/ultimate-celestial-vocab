# Nâng cấp hiệu năng — giữ nguyên giao diện & animation

**Mục tiêu:** làm giao diện mượt hơn trên cùng một bộ UI, không đổi bố cục, màu, font, thứ tự phần tử và không bỏ animation.

**Môi trường đo:** Chrome 155 headless, 1440×900 (mobile 390×844), bản production (`npm run build`), deck 3.000 thẻ trong IndexedDB. Các số liệu tương tác đo với **CPU throttle 4×** để mô phỏng máy yếu; số liệu khởi động/idle đo ở 1×.

---

## 1. Kết quả chính

| Hạng mục | Trước | Sau |
|---|---|---|
| CSS rule phải match khi thêm DOM | **11.211** | **3.063** (−73%) |
| Stylesheet icon | 4 file CDN (~480 kB) | **1 file nội bộ 63 kB** (gzip 6,7 kB) |
| `backdrop-filter` đang áp dụng khi mở Hub | 6 lớp lồng nhau | **1 lớp** (modal) + header |
| Animation paint nặng trên màn học | 1 (`exampleBoxBreathing` animate `box-shadow`) | **0** (chỉ còn `opacity`/`transform`) |
| Khởi động (3.000 thẻ) | ~1,29 s | **~1,21 s**, **0 long task > 50 ms** |
| Idle | – | **~100 FPS**, p95 ~10 ms |
| Mở Hub (4× throttle) | ~1,06 s | **~0,66 s** |
| Cuộn danh sách 440 thẻ (4× throttle) | ~30 FPS, p95 ~270 ms | **~71 FPS, p95 ~29 ms** |
| Refresh/rebuild danh sách 40 thẻ (4× throttle) | ~199 ms | **~58 ms** |
| Một đợt mở nhiều huy hiệu | **20 toast xếp chồng + N vòng confetti** | **3 toast + 1 vòng confetti** |

> Số FPS cuộn được đo sau khi danh sách đã nạp trước ~400 thẻ; việc nạp thêm giờ diễn ra sau khi người dùng ngừng cuộn ~140 ms nên không còn khựng giữa lúc cuộn.

Ảnh xác nhận giao diện (dark/light, study/flipped, Hub overview/words/badges/io, mobile): `scratch/ui-final2/` (thư mục scratch không commit).

---

## 2. Những gì đã thay đổi

### 2.1. CSS icon: chỉ tải đúng icon đang dùng
- `tools/build-icon-subset.mjs` quét `index.html` + `src/**` để lấy **198 tên icon**, tải 4 stylesheet chính thức Phosphor 2.1.1 và sinh `public/phosphor-subset.css` (**990 rule** thay vì ~9.000).
- `index.html` bỏ 4 `<link>` unpkg, thay bằng 1 link nội bộ. Font `.woff2` vẫn tải từ unpkg (đã preconnect) nhưng CSS không còn cross-origin và nhẹ hơn ~7×.
- `tests/icon-subset.test.mjs` chặn regression: thêm icon mới mà quên regenerate sẽ fail test.
- Lệnh regenerate: `node tools/build-icon-subset.mjs`.

**Vì sao quan trọng:** mỗi lần chèn 40 thẻ từ vựng, trình duyệt phải match ~1.000 phần tử mới với toàn bộ CSS. Giảm 73% rule làm `Recalculate Style` nhẹ đi rõ rệt.

### 2.2. Flatten `backdrop-filter` lồng nhau
- Giữ blur ở `.app-header` và `.modal-content` (2 bề mặt kính chính).
- Bỏ blur ở các card bento **nằm trong** modal (level card, streak, memory, heatmap, forecast, stats), ở wrapper dropdown và toast.
- Các phần tử này có nền gradient/alpha gần đục, nằm trên bề mặt đã blur ⇒ mắt gần như không phân biệt, nhưng GPU không còn phải tạo và blur thêm 5–6 layer.

File: `src/css/study-polish.css`.

### 2.3. Animation "thở" chuyển sang compositor
- `.detail-row.example-row.is-hard-focus`: bỏ animate `box-shadow`/`border-color`, giữ đúng nhịp 3,5 s/easing bằng lớp phủ `::after` animate `opacity`.
- `.streak-icon-wrapper`: icon chỉ animate `transform`; quầng lửa animate `opacity` trên `::before`.
- `.forecast-bar-container.today .forecast-bar`: quầng sáng trên `::after`, animate `opacity`; thanh bar không còn repaint.
- Các animation còn lại trên màn học (`tagPulse`, `badgePulseOpacity`) vốn đã chỉ animate `opacity`/`transform`.
- Boost Mode vẫn tắt toàn bộ các animation này như trước.

File: `src/css/style.css`.

### 2.4. Chống "bão" huy hiệu
- `unlockBadge()` (`src/core/state.js`) gộp các huy hiệu mở trong cùng 120 ms thành **một đợt**: 1 âm thanh, 1 đợt confetti, 3 toast chi tiết + 1 toast tổng kết. Gộp luôn 1 lần ghi IndexedDB thay vì mỗi huy hiệu một lần.
- `launchCelebrationConfetti()` (`src/ui/render.js`) dùng **một canvas + một vòng rAF duy nhất**, gộp các đợt hạt, cap 220 hạt; canvas tự ẩn khi hết hạt.
- `showToast()` (`src/ui/modal.js`) có hàng đợi: tối đa **3 toast hiển thị**, tối đa 12 chờ; nội dung/animation từng toast giữ nguyên.

Đo lại: cùng một đợt mở 20 huy hiệu, trước là 20 toast + 20 vòng vẽ; sau là 3 toast + 1 vòng (125 lần `clearRect` trong 1,2 s ≈ đúng một vòng ~100 FPS của headless, thay vì 20×).

### 2.5. Danh sách từ vựng
`src/ui/render.js`:
- Render cả trang bằng **một chuỗi HTML + `insertAdjacentHTML`** thay vì tạo từng node và 4 closure `onclick`/thẻ.
- **Event delegation** ở `#word-list-display` cho 4 nút (nghe, sao, sửa, xóa) ⇒ giảm hàng nghìn listener/closure khi cuộn sâu.
- **Nạp thêm có debounce 140 ms + `requestIdleCallback`**, chỉ một lượt chờ; không chèn DOM giữa lúc đang cuộn.
- Xóa một từ chỉ remove đúng thẻ đó + cập nhật bộ đếm, không rebuild toàn bộ danh sách đang có hàng trăm thẻ.
- `contain: layout paint style` trên `.word-card`; bỏ `transition: all` ở thẻ và nút hành động.

Đã kiểm chứng bằng `tools/verify_wordlist_ui.mjs`: render 40 thẻ, star, delete + confirm, search rỗng/khôi phục, infinite scroll, mở editor — **7/7 pass**, không lỗi runtime.

### 2.6. Khởi động & audio
- `renderGamificationUI()` dời sang idle sau 4 s (`src/main.js`); Hub vẫn force-render khi mở. Nếu Hub đã mở trước mốc đó thì bỏ qua để không chạy animation đếm số lần hai.
- `displayCard()` không còn gọi `preloadAudio()` ngay cho từng thẻ; dùng `ensureAudioForWords()` (debounce 350 ms + idle, 3 luồng, không retry). Bấm nút loa vẫn phát ngay.
- Bỏ prefetch audio khi `soundMode` là `off` hoặc `sfx`.

### 2.7. Canvas sao
`src/ui/celestial-canvas.js`:
- Cache kết quả `isMobileDevice()` (trước gọi `matchMedia` mỗi frame).
- Cache gradient của sao băng theo `(theme, len)`, dời gốc toạ độ và dùng `globalAlpha` — màu/độ mờ tương đương, không cấp phát gradient mỗi frame.

---

## 3. Cách kiểm chứng

```bash
npm test                                  # 82 pass
npm run build
npm run preview                           # xem bản production (mượt hơn dev)
```

Các script đo/kiểm tra (chạy sau khi build):

```bash
node tools/perf_interact.mjs --cards 3000 --label check --throttle 4
node tools/perf_deep_audit.mjs --dist --cards 3000 --label check
node tools/verify_wordlist_ui.mjs
node tools/verify_celebrations.mjs
node tools/screenshot_ui.mjs --out scratch/ui-check --cards 3000
```

Nếu đang mở bản cũ: hard reload hoặc **Clear site data / unregister service worker** một lần để nhận CSS/JS mới.

---

## 4. Lưu ý

- **Dev server (`npm run dev`) luôn chậm hơn production**: Vite phục vụ module rời + HMR + source map. Muốn thấy đúng độ mượt, dùng `npm run build && npm run preview`.
- Các phép đo headless có thể dao động ±15–20%; các con số ở trên là trung vị của nhiều lần chạy.
- Không thay đổi DOM/CSS về bố cục, màu, font hay thời lượng/easing của animation; chỉ đổi **thuộc tính được animate** và **cách render danh sách**.
