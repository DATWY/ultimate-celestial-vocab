# Nâng cấp SoundFX

## Nguyên nhân âm thanh bị "dở"

Từ sau lần thay engine SFX, `playSound()` gọi **synth procedural trước** cho mọi hiệu ứng:

```js
const handled = playSynthSound(soundName); // luôn trả true
if (!handled && sounds[soundName]) { ... }  // không bao giờ chạy
```

Vì vậy 5 file MP3 gốc trong `public/sounds/` (flip, correct, incorrect, next, star_on)
không bao giờ được phát. Người dùng chỉ nghe được các nốt synth mỏng, ngắn hơn bản gốc.

## Đã sửa

- **Sample MP3 là đường phát chính** cho 5 hiệu ứng gốc; synth chỉ còn là fallback cho
  các hiệu ứng chưa có file (complete, click, delete, levelUp, badgeUnlock…).
- **Decode trước thành `AudioBuffer`** và phát qua `AudioBufferSourceNode`:
  - độ trễ thấp hơn `HTMLAudioElement`,
  - chồng tiếng được (tối đa 2 voice/hiệu ứng, cắt bản cũ bằng fade 12 ms),
  - không còn cảnh một file Audio bị restart giữa chừng.
- **Bus âm thanh**: sample + synth → master 0.9 → limiter −2 dB → loa. Limiter chỉ chặn
  đỉnh khi nhiều hiệu ứng chồng nhau, không nén từng âm đơn lẻ.
- **Cân bằng âm lượng** riêng cho từng file (0.78–0.86) để correct/star_on không bị
  chói trong khi flip/next vẫn rõ.
- **Preload thông minh**: decode trong `requestIdleCallback` sau khi UI ổn định; bỏ qua
  nếu người dùng đang để chế độ Tắt/TTS; tự thử lại sau 15 s nếu lỗi mạng.
- **Fallback 3 lớp**: buffer → `<audio>` MP3 (khi buffer chưa sẵn sàng) → synth.
- **Mở khóa audio** đúng chuẩn autoplay: resume AudioContext ở `pointerdown`/`keydown`
  đầu tiên.
- **PWA precache MP3**: thêm `mp3` vào `globPatterns`, để offline vẫn có tiếng.

## Kiểm chứng

`node tools/verify_sfx.mjs` (Chrome headless, production `dist`):

```json
{
  "sampleBuffers": 5,
  "sampleElements": 0,
  "synthOscillatorsFromComplete": 7,
  "resources": ["flip.mp3", "correct.mp3", "incorrect.mp3", "star_on.mp3", "next.mp3"],
  "errors": []
}
```

Nghĩa là cả 5 hiệu ứng gốc đều được phát bằng buffer, không rơi vào HTMLAudio,
và synth vẫn hoạt động cho `complete`.

- `npm test`: **82/82 pass**
- `node tools/perf_deep_audit.mjs --dist --cards 3000`: ready **~1.220 ms**,
  **0 long task**, idle **~117 FPS**, p95 ~8.4 ms.

## Cách nghe thử

```bash
npm run build
npm run preview
```

Hard reload / Clear site data một lần để service worker nhận file MP3 mới.
