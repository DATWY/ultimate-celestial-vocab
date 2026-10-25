# Nâng cấp SoundFX

## Nguyên nhân âm thanh bị "dở"

Từ sau lần thay engine SFX, `playSound()` gọi **synth procedural trước** cho mọi hiệu ứng:

```js
const handled = playSynthSound(soundName); // luôn trả true
if (!handled && sounds[soundName]) { ... }  // không bao giờ chạy
```

Vì vậy 5 file MP3 gốc trong `public/sounds/` (flip, correct, incorrect, next, star_on)
không bao giờ được phát. Người dùng chỉ nghe được các nốt synth mỏng, ngắn hơn bản gốc.

## Đợt 1 — khôi phục âm gốc + engine buffer

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
- **PWA precache MP3**: thêm `mp3` vào `globPatterns`, để offline vẫn có tiếng.

## Đợt 2 — độ trễ, chế độ tắt tiếng và TTS

- **Cắt khoảng lặng đầu/cuối** của buffer đã decode (ngưỡng −56 dB, chừa 8 ms đuôi,
  fade 5 ms). Không đổi âm sắc nhưng bỏ được encoder delay và đuôi im lặng:

  | File | Trước | Sau |
  |---|---|---|
  | flip | 0,597 s (21 ms lặng đầu) | **0,492 s** |
  | correct | 1,068 s | **0,847 s** |
  | incorrect | 1,063 s | **0,501 s** |
  | next | 1,650 s (1,13 s lặng cuối) | **0,519 s** |
  | star_on | 1,513 s | **1,391 s** |

- **`latencyHint: 'interactive'`** khi tạo AudioContext để trình duyệt chọn buffer nhỏ
  hơn cho tiếng bấm.
- **Tắt tiếng là im ngay**: `applySoundMode()` đóng AudioContext khi chọn Tắt/TTS,
  dừng cả tiếng đang ngân; bật lại dùng lại buffer đã decode (không tải lại).
- **TTS đúng chế độ**: `speakText()`, `fallbackNativeTTS()` và `preloadAudio()` đều
  chặn khi chế độ là `off`/`sfx`. Trước đây bấm loa vẫn đọc dù đã chọn "Chỉ SFX"/"Tắt".
- **Chống TTS đọc bù**: thêm `requestId` cho mỗi lần gọi; nếu người dùng bấm từ khác
  hoặc tắt tiếng trong lúc chờ proxy, kết quả cũ bị bỏ, không phát chồng.
- **Chống autoplay phát bù**: nếu AudioContext còn treo và chưa có gesture, không xếp
  buffer vào context (tránh tiếng phát muộn khi người dùng chạm lần đầu).
- **Preload idle có kiểm tra chế độ**: nếu người dùng chuyển sang Tắt/TTS trước khi
  idle callback chạy thì không tải sample nữa.

## Kiểm chứng

`node tools/verify_sfx.mjs` (Chrome headless, production `dist`):

```json
{
  "sampleBuffers": 5,
  "sampleElements": 0,
  "synthOscillatorsFromComplete": 7,
  "durations": [0.492, 0.847, 0.501, 0.519, 1.391],
  "muteBuffers": 0,
  "muteElements": 0,
  "closeCalls": 1,
  "resumeBuffers": 1,
  "resumeElements": 0,
  "ttsFetch": 0,
  "ttsElements": 0,
  "errors": []
}
```

Nghĩa là:

- cả 5 hiệu ứng gốc phát bằng buffer, không rơi vào HTMLAudio;
- đã cắt đúng khoảng lặng (next từ 1,65 s còn 0,52 s);
- chế độ Tắt không phát SFX và đóng AudioContext để cắt tiếng đang ngân;
- bật lại vẫn dùng buffer cũ, không cần tải lại;
- chế độ SFX không gọi fetch/TTS.

- `npm test`: **82/82 pass**
- `perf_deep_audit --dist --cards 3000`: ready **~1.217 ms**, **0 long task**,
  idle **~119,5 FPS**, p95 **~8,5 ms**.

## Cách nghe thử

```bash
npm run build
npm run preview
```

Hard reload / Clear site data một lần để service worker nhận file MP3 mới.
