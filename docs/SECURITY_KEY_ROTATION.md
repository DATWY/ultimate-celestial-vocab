# Xoay vòng & giới hạn Firebase API key (việc cần làm thủ công)

> Trạng thái: **CHƯA LÀM**. Tài liệu này là hướng dẫn, không phải biên bản đã hoàn thành.
> Lý do tồn tại: một Firebase API key của project này đã xuất hiện trong một đoạn chat,
> nên phải coi là đã lộ và xử lý theo quy trình dưới đây.

## 1. Hiểu đúng mức độ rủi ro (đừng hoảng, cũng đừng bỏ qua)

Firebase API key **không phải bí mật** theo thiết kế — nó chỉ định danh project và luôn
nằm trong bundle client (ai mở DevTools cũng thấy). Vì vậy:

- Lộ key **không** đồng nghĩa mất dữ liệu. Dữ liệu được bảo vệ bởi **Firestore Security Rules**
  và (khi bật) **App Check**.
- Rủi ro thật của key lộ là **bị dùng chùa**: người khác gọi Identity Toolkit để tạo tài khoản
  hàng loạt, hoặc gọi API tính phí bằng project của bạn.
- Việc phải làm vì thế là **giới hạn key** + **xoay key nếu đã bị lạm dụng**, không chỉ là "đổi mật khẩu".

## 2. Các bước (làm theo đúng thứ tự)

### Bước 1 — Giới hạn key hiện tại (nhanh, chặn phần lớn lạm dụng)
1. Vào **Google Cloud Console** → chọn project Firebase → **APIs & Services → Credentials**.
2. Tìm key dạng **"Browser key (auto created by Firebase)"**.
3. **Application restrictions** → chọn *HTTP referrers (web sites)*, thêm:
   - `https://<domain-that>/*` (domain thật trên Firebase Hosting)
   - `https://<domain-that>` (không có dấu `/` cuối)
   - `http://localhost:5173/*` và `http://127.0.0.1:5173/*` (chỉ để dev)
   - Nếu dùng Firebase Hosting preview channel: `https://<project>--<channel>-<hash>.web.app/*`
   - **Xoá** mọi mục kiểu `*` hoặc để trống.
4. **API restrictions** → *Restrict key*, chỉ tick những API app thật sự dùng:
   - Identity Toolkit API
   - Cloud Firestore API
   - Firebase App Check API
   - Token Service API (Secure Token)
   - (nếu có dùng) Firebase Installations API
5. **Save**, đợi ~5 phút, rồi mở app kiểm tra: đăng nhập/đồng bộ vẫn chạy.

> ⚠️ Đã đo trong repo: CSP ở `firebase.json` cho phép `https://www.google.com` (reCAPTCHA) và
> `connect-src` tới `identitytoolkit`/`firestore`/`securetoken`. Nếu giới hạn thiếu API, lỗi sẽ là
> **403 kèm thông báo "Requests from referer <empty> are blocked"** — khi đó kiểm tra lại referrer,
> đặc biệt trên **WebView của Zalo/Facebook** (một số WebView **không gửi Referer**, xem mục 4).

### Bước 2 — Xoay key (chỉ khi nghi đã bị lạm dụng, hoặc làm định kỳ)
1. **Credentials → Create credentials → API key** → key mới.
2. Đặt lại cùng 2 loại restriction như Bước 1 cho key mới.
3. Cập nhật nơi lưu key:
   - Local: `.env` → `VITE_FIREBASE_API_KEY=<key mới>` (file `.env` đã gitignore).
   - CI/CD: nếu có secret `VITE_FIREBASE_API_KEY` trong GitHub Actions → sửa ở *Settings → Secrets*.
     (Đã kiểm: `.github/workflows/ci.yml` hiện **không** dùng biến này — CI chỉ chạy `npm test`
     + `npm run budget`, nên không phải sửa secret.)
4. Build + deploy, kiểm tra app: đăng nhập, đồng bộ, tạo mã sync mới đều phải chạy.
5. Theo dõi **1–2 ngày** (Cloud Console → APIs & Services → Metrics, hoặc Logs Explorer lọc `status=403`)
   để chắc app thật không bị chặn.
6. **Sau khi chắc chắn**, **xoá key cũ** (Delete). Xoá trước khi deploy = app chết ngay.
7. Xoá bản backup có key cũ: `backups/env-2026-10-26.copy` (đã gitignore, **không bao giờ commit**).
   Ghi chú: file này chứa key **cũ**; sau khi xoay thì nó không còn giá trị sử dụng, xoá cho sạch.

### Bước 3 — Bật App Check (lớp bảo vệ thật sự)
App Check đã có code (`src/core/firebase.js`, hàm `initAppCheck`) nhưng **chưa enforce**:
1. Firebase Console → **App Check** → đăng ký app web với **reCAPTCHA v3**, lấy **site key**.
2. Điền `VITE_FIREBASE_APPCHECK_SITE_KEY=<site key>` vào `.env` rồi build/deploy.
3. Bật **monitoring** (không enforce) **48 giờ**, xem tab Metrics: tỉ lệ request có token phải ~100%.
4. Nếu ổn → bật **Enforce** cho Firestore và Authentication.
5. Nếu tỉ lệ thấp ở một số thiết bị (thường là WebView cũ), **khoan enforce** — enforce lúc đó
   sẽ chặn người dùng thật, và triệu chứng là "không đồng bộ được" (app vẫn chạy offline).

> CSP đã mở sẵn origin reCAPTCHA (`https://www.google.com/recaptcha/`, `frame-src`, `connect-src`)
> trong cả meta (`index.html`) và header (`firebase.json`), nên bật App Check **không cần sửa CSP**.

## 3. Thứ tự ưu tiên nếu chỉ có 30 phút
1. Giới hạn HTTP referrer + API restrictions cho key hiện tại (Bước 1) — chặn phần lớn lạm dụng, không downtime.
2. Bật App Check monitoring (Bước 3.1–3.3).
3. Xoay key (Bước 2) khi có thời gian và có thể theo dõi log 1–2 ngày.

## 4. Những chỗ dễ làm sập app (đã gặp hoặc đã biết trước)

| Tình huống | Triệu chứng | Cách xử lý |
|---|---|---|
| Giới hạn referrer quá chặt | `403 Requests from referer ... are blocked` | Thêm đúng domain (có/không `/` cuối), thêm localhost cho dev |
| WebView Zalo/Facebook không gửi Referer | Đăng nhập/đồng bộ chết trên một số máy | **Không** dựa vào referrer làm lớp bảo vệ duy nhất; dùng App Check; nếu buộc phải chặn, kiểm trên máy thật trước |
| Xoá key cũ trước khi deploy key mới | App chết toàn bộ (auth 400) | Luôn deploy trước, xoá sau |
| Giới hạn thiếu *Token Service API* | Đăng nhập xong nhưng token refresh lỗi sau ~1 giờ | Tick thêm Secure Token |
| Quên cập nhật `.env` trên máy khác | Chạy dev thấy đồng bộ lỗi, production vẫn ổn | Ghi key mới vào trình quản lý mật khẩu của nhóm |

## 5. Checklist copy-paste

```
[ ] Bước 1: HTTP referrer allowlist (domain thật + localhost dev), bỏ wildcard
[ ] Bước 1: API restrictions = Identity Toolkit, Firestore, App Check, Token Service
[ ] Bước 1: deploy xong mở app kiểm tra đăng nhập + đồng bộ
[ ] Bước 2: tạo key mới, gán cùng restriction
[ ] Bước 2: cập nhật .env (+ secret CI nếu có — hiện repo chưa dùng)
[ ] Bước 2: deploy, kiểm tra, theo dõi 403 trong 1–2 ngày
[ ] Bước 2: xoá key cũ; xoá backups/env-2026-10-26.copy
[ ] Bước 3: App Check site key vào .env, deploy
[ ] Bước 3: monitoring 48h → enforce nếu tỉ lệ token ~100%
```
