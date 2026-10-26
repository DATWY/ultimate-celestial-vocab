# CHANGELOG

> File này được **sinh tự động** từ git log bằng `node tools/changelog.mjs` — đừng sửa tay,
> sửa commit message rồi chạy lại. Nhóm theo tiền tố conventional commits (`feat:`, `fix:`, …).

- Phạm vi: `pre-upgrade-2026-10-26..HEAD`
- Số commit: **28**
- Khoảng thời gian: **2026-10-26 → 2026-10-26**
- Sinh lúc: 2026-10-26

## Tính năng (4)

- **queue:** cap so luot on moi ngay, mac dinh 200 (T1.5) — `14885f9` (2026-10-26)
  Truoc day chi co gioi han the MOI/ngay (computeDailyNewLimit, 5-40). Nguoi dung co
- **a11y:** sua 6 loi a11y + responsive do duoc bang CDP (P4) — `7ec2465` (2026-10-26)
  #1 #typing-input: aria-label="Go tu tieng Anh" + aria-describedby tro toi goi y
- **security:** App Check san sang + siet CSP, bo unsafe-inline khoi script-src (T0.3, T0.4) — `b9aba05` (2026-10-26)
  T0.3: khoi tao App Check (reCAPTCHA v3) ngay sau initializeApp va truoc khi tao
- **srs:** learning steps that (1p - 10p - 1 ngay) + tran interval 365 ngay (T1.1, T1.2) — `569c509` (2026-10-26)
  T1.2: MAX_INTERVAL_DAYS = 365 clamp SAU fuzz cho moi lan cham, ap ca trong

## Sửa lỗi (9)

- **report:** bo 3 muc timeline bi lap + sua caveat "entry nang hon" da sai — `9d636aa` (2026-10-26)
  Khi chen 3 commit moi (14885f9, 81d7b09, 1ed0b0e) toi dung str.replace khong gioi
- **tools:** sua 2 verifier chet + them npm run verify (11 + 4 test xanh) — `1476c29` (2026-10-26)
  verify_performance_lifecycle.mjs chet ngay Test 3: TypeError reading 'openHub'.
- **content:** sua 2 cau vi du mau sai/khong tu nhien (T1.8) — `e066222` (2026-10-26)
  Hoc lieu mau (ISOLATED_TEST_MODE, state.js:1591-1600) co 10 cau vi du. Da
- **build:** bo BOM UTF-8 khoi package.json va cac file text (build bi vo) — `cc3f65d` (2026-10-26)
  Loi cua toi: them script "report" bang Set-Content -Encoding utf8 tren PowerShell
- **sync:** chan tram 1 MiB cua Firestore o reviewLogs + TTS chon giong/toc do (T2.4, T2.5) — `4122444` (2026-10-26)
  T2.4 - LOI THAT: code cu cat row theo so luong nhung dict cardId khong co
- **srs:** thu bien do heuristics + xu ly leech that (T1.3, T1.4) — `e6d6a33` (2026-10-26)
  T1.3: bias tu [-3.0,+3.0] -> [-0.5,+0.5], he so S tu [0.7,1.3] -> [0.85,1.15],
- **sync:** khong tu tao khong gian khi go sai ma + lien ket thiet bi dung API that (T0.5, T0.6) — `066c9e5` (2026-10-26)
  T0.5: resolveAuthAction() + ensureCloudAuth({createIfMissing}) - mac dinh khong tao
- **pwa:** chan reload loop, cache header dung, khong preload MP3 luc boot (T2.1, T2.3, T3.3) — `f8d1ccb` (2026-10-26)
  T2.1: decideVersionAction({hosted, local, lastReload, now, online}) - offline thi khong
- **security:** escape HTML o 2 sink stored XSS (popup Du bao, Khao Hach) + test hoi quy — `b6b498a` (2026-10-26)
  T0.1: buildForecastWordsHtml()/buildPenanceQuestionHtml() escape moi du lieu nguoi dung

## Hiệu năng (3)

- **bundle:** dua io.js ra khoi entry, entry 81,85 -> 74,93 kB gzip (T4.5c) — `1ed0b0e` (2026-10-26)
  Truoc: entry 81,85 kB gzip = 99,8% tran 82 kB, con 0,15 kB. Khong con cho cho bat ky
- **tts:** tach panel cai dat giong doc sang chunk lazy, entry 81,38 -> 80,67 kB gzip — `c3f5a51` (2026-10-26)
  Panel TTS (2 select + 9 option toc do + badge + listener voiceschanged) chuyen
- **assets:** self-host Lexend, subset lai icon font, bo MP3 khoi precache (T2.2, T3.1) — `2313e40` (2026-10-26)
  T2.2 - Lexend tu host: 3 file variable woff2 (latin 39.680, latin-ext 34.476,

## Tái cấu trúc (2)

- **state:** tach state.js 1.621 -> 616 dong thanh 10 module (T4.5b) — `8d45904` (2026-10-26)
  Cung mot API: barrel van phat ra dung 93 ten runtime (91 khai bao + 2 re-export
- **css:** xoa CSS chet trong style.css (T3.2) — `862c33a` (2026-10-26)
  Chi xoa, khong sua: 504 dong / 62 rule, 32 class khong xuat hien o bat ky dau

## Tài liệu (8)

- so lieu cuoi (226 test, entry 74,93 kB) + T1.5/T4.5c/T5.1 xong, T2.6 hoan co ly do — `66cffb7` (2026-10-26)
  README: entry 223,06 kB tho / 74,93 kB gzip (91,4% ngan sach, NHE hon 1,4% so voi
- **backlog:** dinh chinh '25 export chet' la 3, va ghi don bay byte that (io.js -7,08 kB) — `09b2a07` (2026-10-26)
- **changelog:** sinh CHANGELOG tu git log + muc luc docs (T5.4, T5.2 mot phan) — `5d873eb` (2026-10-26)
  tools/changelog.mjs: sinh CHANGELOG.md tu git log, 0 dependency (khong dung
- dong bo so lieu sau khi tach state.js + task moi T4.5c — `6440182` (2026-10-26)
  README: test 203 -> 211, entry raw 246.430 B, dist 2.094,70 kB, va bang kien truc
- **security:** huong dan xoay/gioi han Firebase API key + App Check enforce — `2d67118` (2026-10-26)
  docs/SECURITY_KEY_ROTATION.md: huong dan 3 buoc (gioi han HTTP referrer + API
- **report:** cap nhat bao cao truc quan theo so lieu cuoi (18 commit, 203 test) — `7db99e9` (2026-10-26)
  - Trang 1: 203 test (+75), bieu do test them cot 203; entry 76 -> 80,67 kB gzip
- viet lai README theo dung code that + so tay smoke test + cap nhat backlog (P5) — `1ce2457` (2026-10-26)
  README.md (371 dong): sua 19 khang dinh SAI/LOI THOI so voi code, moi con so deu
- **report:** bao cao nang cap truc quan 4 trang + script render tai lap duoc (T5.1) — `678132a` (2026-10-26)
  reports/upgrade-report.html: bao cao 4 trang (tong quan KPI + bieu do truoc/sau,

## Kiểm thử (2)

- **e2e:** dua smoke E2E vao git + do baseline khoi dong (T4.6, T3.4) — `81d7b09` (2026-10-26)
  T4.6: scratch/smoke-study-loop.mjs -> tests/e2e/study-loop.mjs (179 dong, giu
- **srs:** golden test FSRS + sua 2 loi that cua du bao 7 ngay + ngan sach bundle (T1.7, T1.6, T3.5) — `4047255` (2026-10-26)
  T1.7: tests/golden-fsrs.test.mjs - 50 kich ban x 11 truong (S, S_short, D,

