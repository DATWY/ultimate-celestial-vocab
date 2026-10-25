# Remake giao diện: Icon system, Motion và tính năng học tập

## 1. Hệ thống icon mới

Toàn bộ icon Phosphor giờ đi qua một visual language thống nhất trong
`src/css/icon-system.css`:

- **Duotone hai lớp**: lớp nền là glyph fill màu cyan (dark mode) hoặc violet
  (light mode), lớp trên là outline mang gradient sáng → màu ngữ nghĩa.
- **Fill icon** (check, flame, trophy, badge…) nhận gradient nhẹ để có cảm giác
  embossed thay vì phẳng.
- **Hover**: nền hai lớp sáng hơn, outline có glow, icon nhấc nhẹ và nhún khi bấm.
- **Icon hero** (header Hub, onboarding, tiêu đề menu) có nhịp "thở" rất chậm;
  tắt hoàn toàn ở boost mode và `prefers-reduced-motion`.
- **Word card** được miễn gradient/backplate để giữ deep-scroll nhẹ: đây là nơi
  có 4 icon × 440 thẻ, chi phí paint lớn nhất.

Màu ngữ nghĩa được giữ nguyên: check xanh, flame cam, star vàng, trophy gold,
warning đỏ — lớp nền chỉ thêm chiều sâu, không đổi meaning.

## 2. Motion mới

- **Card flip**: thêm nhịp scale 0.965 → 1, glow quanh card và một lượt quét sáng
  chạy ngang mặt thẻ. Tất cả kết thúc trong 620 ms.
- **SRS buttons**: sheen chạy ngang khi hover/focus, nhún nhẹ khi bấm.
- **Answer feedback**: overlay "CHÍNH XÁC / KHÓ / HOÀN HẢO / ÔN LẠI" với halo,
  ring lan rộng, icon pop và combo ×N. Xuất hiện sau mỗi lần chấm, tự biến mất
  sau 950 ms; không ảnh hưởng layout hay 3D flip.
- **Combo pill**: khi chuỗi đúng ≥ 3, dock hiện pill "Combo ×N" màu amber.
- Mọi animation mới chỉ dùng `transform` / `opacity`; riêng shine của card dùng
  `background-position` một lượt trong lúc flip (không lặp, không chạy nền).
- Boost mode tắt shine/sheen; reduced-motion tắt animation và transition.

## 3. Tính năng mới

- **Độ chính xác hôm nay** trong stats dock: `Đúng: 83%`, đổi màu xanh khi ≥80%,
  amber khi <50%; tooltip hiển thị `đúng/tổng` lượt.
- **Combo pill** hiển thị chuỗi đúng hiện tại.
- **Bảng phím tắt** mở bằng nút bàn phím trên header hoặc phím `?`:
  F, Space, 1–4, N/Enter, P, S, B, Ctrl/⌘ Z, ?, Esc.
- **Sửa lỗi**: Ctrl/⌘ Z không còn hoạt động khi đang mở modal.
- **Victory stage** đọc thêm độ chính xác hôm nay vào tagline.

## 4. Kiểm chứng

- `npm test`: **82/82 pass**
- `node tools/verify_wordlist_ui.mjs`: **7/7**
- `node tools/verify_celebrations.mjs`: **4/4** (3 toast, 1 canvas, 1 rAF)
- `node tools/verify_sfx.mjs`: pass (5 buffer, 0 HTMLAudio, TTS gate)
- `node tools/preview_motion.mjs`: chụp được flip-mid, answer-feedback,
  shortcuts-modal; phím `?` mở bảng phím tắt.
- `perf_deep_audit --dist --cards 3000`: ready **~1.216 ms**, idle **120 FPS**,
  p95 **8.4 ms**, CSS **3.128 rules**. Có 1 long task 52 ms ở mốc 183 ms trong
  lần đo cuối (dao động startup; các lần trước 0).
- Ảnh: `scratch/ui-final-v4/`, `scratch/motion/`.

## 5. Cách xem

```bash
npm run build
npm run preview
```

Hard reload / Clear site data một lần để service worker nhận CSS/JS mới.

Lưu ý: các phép đo 4× CPU throttle trên máy này dao động mạnh vì có tiến trình
Chrome nền khác; các con số deep-scroll chỉ nên đọc theo xu hướng, không phải
tuyệt đối.
