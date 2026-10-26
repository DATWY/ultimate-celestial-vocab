# Mục lục tài liệu

Trang này để bạn không phải đoán file `.md` nào còn đúng. Chia làm 3 loại:
**nguồn sự thật** (dùng để ra quyết định), **tài liệu vận hành** (làm theo được ngay),
và **báo cáo lịch sử** (số liệu tại thời điểm viết, **không đảm bảo còn đúng**).

## Đọc trước tiên

| File | Dùng khi nào |
|---|---|
| [`../README.md`](../README.md) | Cần biết app làm gì, chạy thế nào, số đo hiện tại. **Đây là nguồn sự thật duy nhất về con số.** |
| [`../UPGRADE_BACKLOG.md`](../UPGRADE_BACKLOG.md) | Cần biết việc gì đã xong (kèm SHA), việc gì còn, và **vì sao** một task bị đánh trượt. |
| [`../CHANGELOG.md`](../CHANGELOG.md) | Cần xem 21 commit nâng cấp gần nhất theo nhóm. Sinh tự động, đừng sửa tay. |

## Tài liệu vận hành

| File | Nội dung | Trạng thái |
|---|---|---|
| [`SMOKE_TEST.md`](SMOKE_TEST.md) | Quy trình smoke test trên `dist/` (2 chế độ), danh sách assert, 7 bẫy CDP, cảnh báo tài khoản Firebase rác | Đã chạy thật, số đo kèm theo |
| [`SECURITY_KEY_ROTATION.md`](SECURITY_KEY_ROTATION.md) | Cách giới hạn referrer, xoay Firebase API key, bật App Check enforce | **CHƯA LÀM** — là hướng dẫn, không phải biên bản |
| [`PERF.md`](PERF.md) | Baseline thời gian khởi động app (đo bằng Chrome headless) | Có script tái lập: `tools/measure_startup.mjs` |

## Báo cáo trực quan

| File | Nội dung |
|---|---|
| [`../reports/upgrade-report.html`](../reports/upgrade-report.html) | Báo cáo 4 trang (HTML). Tái lập ảnh: `npm run report` |
| `../reports/nang-cap-1..4.png` | Ảnh 2x của 4 trang, dùng để chia sẻ |
| `../reports/assets/` | Ảnh chụp app thật dùng trong báo cáo (để báo cáo tái lập được từ clone sạch) |

## Báo cáo lịch sử ở thư mục gốc

Các file dưới đây là **dấu vết của những đợt làm trước**. Giữ lại vì có bằng chứng đo đạc,
nhưng **đừng trích số từ chúng** — ví dụ "77/77 test" nay là **211**. Danh sách này chưa được
gộp vào `docs/reports/` vì việc xoá/gộp cần người quyết định (xem T5.2 trong backlog).

| File | Nội dung | Ghi chú |
|---|---|---|
| `DESIGN_DOC.md` | Kiến trúc kỹ thuật | Còn giá trị tham khảo |
| `PROJECT.md` | Mô tả project V5 | Một phần đã lỗi thời (số liệu, tên file) |
| `JOURNEY_ARTICLE.md` | Bài viết hành trình làm app | Nội dung kể chuyện, không phải tài liệu kỹ thuật |
| `PERFORMANCE_UPGRADE.md`, `performance-fix-plan.md` | Đợt tối ưu hiệu năng cũ | Số đo cũ; baseline mới ở `docs/PERF.md` |
| `SOUND_UPGRADE.md`, `UI_REMAKE.md` | Đợt nâng cấp âm thanh / giao diện | Lịch sử |
| `PROJECT_EVALUATION_REPORT.md` | Báo cáo đánh giá toàn diện (đợt này) | 36 task sinh ra từ đây |
| `UPGRADE_REPORT.md`, `FIX_REPORT.md`, `report.md`, `report-recheck.md` | Các báo cáo lỗi/ nâng cấp cũ | Có phần đã được sửa xong trong đợt này |

## Script trong `tools/`

| Lệnh | Việc |
|---|---|
| `npm test` | 211 unit test (`node --test`) |
| `npm run verify` | 11 test hiệu năng/vòng đời + 4 test version trên `dist/` (Chrome headless) |
| `npm run test:e2e` | Smoke E2E trên `dist/`, 2 chế độ |
| `npm run budget` | 4 ngưỡng kích thước bundle |
| `npm run report` | Render lại 4 trang PNG của báo cáo |
| `node tools/changelog.mjs` | Sinh `CHANGELOG.md` từ `git log` |
| `node tools/measure_startup.mjs` | Đo baseline khởi động (xem `docs/PERF.md`) |

## Ảnh chụp

`docs/screenshots/` chứa ảnh giao diện (webp) dùng cho README và bài viết. Ảnh trong
`reports/assets/` là bản sao có chủ đích để báo cáo render được từ clone sạch.
