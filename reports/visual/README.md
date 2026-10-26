# Ảnh so sánh trước/sau khi dọn `!important` (T3.2, T4.3)

> **Ảnh PNG không được commit** (18,5 MB) — đây là bằng chứng cục bộ, tái lập được bằng
> `node tools/visual_snapshot.mjs`. Thư mục này chỉ giữ file README trong git.
> Lý do: repo đã từng bị phình vì một file zip 9 MB (T5.3), không lặp lại lỗi đó.

## Kết quả

- **32/32 ảnh chuẩn GIỐNG NHAU** (8 trạng thái × 4 viewport: `1440×900`, `390×844`, `320×568`, `844×390`),
  **0 pixel khác**, 0 phần tử lệch `rect`/`computedStyle`. `844×390` **không** notch cũng 0 pixel khác.
- **8/8 ảnh notch khác CÓ CHỦ Ý** (T4.3): body/modal đệm `env(safe-area-inset-left/right)` = 59 px.
  Audit phần tử bị dải an toàn che: **54 → 0**.
- `!important`: **1.920 → 286** toàn `src/css`; riêng `style.css` **1.624 → 188**.
- CSS Vite raw: **326,70 → 322,58 kB** (gzip 58,98 → 58,91 kB).

## Cách tái lập

```powershell
node tools/visual_snapshot.mjs --out before      # chụp bộ ảnh trên code hiện tại
# ... sửa CSS ...
node tools/visual_snapshot.mjs --out after
node tools/visual_snapshot.mjs --compare before after
node tools/visual_snapshot.mjs --with-notch --out notch   # thêm 8 ảnh mô phỏng tai thỏ
```

Script tự `npm run build`, phục vụ `dist/` trên cổng OS cấp, dùng Chrome headless + CDP.
Mỗi ảnh có sidecar JSON ghi `getBoundingClientRect` + 45 computed style của 51 selector,
nên so sánh không chỉ dựa vào pixel. Giải mã PNG bằng `node:zlib` (không thêm dependency).

## Giới hạn (đọc trước khi tin bảng trên)

- Chỉ **Chrome headless**; tai thỏ mô phỏng bằng `Emulation.setSafeAreaInsetsOverride`,
  **không** phải iPhone/Safari thật.
- Phủ 8 màn chính (`empty`, `card-front`, `card-back`, `hub-overview`, `hub-words`, `hub-io`,
  `tts-panel`, `light`); **chưa** phủ quiz, dedup, badges, victory stage.
- Canvas nền/toast/animation bị đóng băng; trạng thái mạng của nút Đồng bộ đưa về pose idle
  để ảnh không phụ thuộc timer Firebase.
- Chrome software raster có lúc lệch ±1 level màu trên một vạch 4 px giữa 2 process —
  đó là giới hạn harness, **không** phải thay đổi CSS, và không chỉnh sửa ảnh.

## Dấu vân tay ảnh baseline (sha256, 16 ký tự đầu)

Dùng để biết baseline có bị chụp lại khác đi không (raster, font, viewport):

| Ảnh | Kích thước | sha256[:16] |
|---|---:|---|
| `before-card-back-1440x900.png` | 414,362 B | `b119853b5b20f1e3` |
| `before-card-back-320x568.png` | 91,157 B | `ec088695a31eacb3` |
| `before-card-back-390x844.png` | 142,916 B | `ef09beca0a1ea6d5` |
| `before-card-back-844x390.png` | 106,537 B | `d21791bb01784941` |
| `before-card-front-1440x900.png` | 383,450 B | `622f4c3d408fc6f7` |
| `before-card-front-320x568.png` | 72,806 B | `de12665c344110ed` |
| `before-card-front-390x844.png` | 110,955 B | `257baabf2367ebf4` |
| `before-card-front-844x390.png` | 97,052 B | `92f4ada711e72f0b` |
| `before-empty-1440x900.png` | 366,132 B | `e6336f46efa502fb` |
| `before-empty-320x568.png` | 68,416 B | `a592644f31a70d62` |
| `before-empty-390x844.png` | 106,897 B | `93a0f7c7e87183ad` |
| `before-empty-844x390.png` | 83,895 B | `d10db5f299a03701` |
| `before-hub-io-1440x900.png` | 210,881 B | `c38da5b39769a1e4` |
| `before-hub-io-320x568.png` | 55,663 B | `90e21eeac422e024` |
| `before-hub-io-390x844.png` | 83,010 B | `fa84d3bef6364422` |
| `before-hub-io-844x390.png` | 58,105 B | `af2bd66460f6b571` |
| `before-hub-overview-1440x900.png` | 201,614 B | `12e9ead2ea012b1e` |
| `before-hub-overview-320x568.png` | 71,394 B | `b8b65c36d666c6e2` |
| `before-hub-overview-390x844.png` | 92,727 B | `4a4dbe0ed33b496b` |
| `before-hub-overview-844x390.png` | 91,424 B | `939db16c3296a0a7` |
| `before-hub-words-1440x900.png` | 105,292 B | `ad9dd56d5cec8a02` |
| `before-hub-words-320x568.png` | 55,615 B | `596954919b634b9c` |
| `before-hub-words-390x844.png` | 69,399 B | `fc06449dcccf3acd` |
| `before-hub-words-844x390.png` | 58,661 B | `3758fca4b8bc17bc` |
| `before-light-1440x900.png` | 491,165 B | `756d1f54f005a2a7` |
| `before-light-320x568.png` | 90,162 B | `475730a6472ed002` |
| `before-light-390x844.png` | 141,167 B | `c1ebc0ae91b87323` |
| `before-light-844x390.png` | 107,610 B | `929a553700ad112b` |
| `before-notch-card-back-844x390.png` | 106,537 B | `d21791bb01784941` |
| `before-notch-card-front-844x390.png` | 97,052 B | `92f4ada711e72f0b` |
| `before-notch-empty-844x390.png` | 83,895 B | `d10db5f299a03701` |
| `before-notch-hub-io-844x390.png` | 58,105 B | `af2bd66460f6b571` |
| `before-notch-hub-overview-844x390.png` | 91,424 B | `939db16c3296a0a7` |
| `before-notch-hub-words-844x390.png` | 58,661 B | `3758fca4b8bc17bc` |
| `before-notch-light-844x390.png` | 107,610 B | `929a553700ad112b` |
| `before-notch-tts-panel-844x390.png` | 121,708 B | `488da75f0023ecfb` |
| `before-tts-panel-1440x900.png` | 414,362 B | `b119853b5b20f1e3` |
| `before-tts-panel-320x568.png` | 75,132 B | `2f416930f1631d24` |
| `before-tts-panel-390x844.png` | 113,160 B | `d59d8dde8918a2f6` |
| `before-tts-panel-844x390.png` | 121,708 B | `488da75f0023ecfb` |

Tổng: 80 file PNG (40 baseline + 40 after).
