# CHANGELOG

> File này được **sinh tự động** từ git log bằng `node tools/changelog.mjs` — đừng sửa tay,
> sửa commit message rồi chạy lại. Nhóm theo tiền tố conventional commits (`feat:`, `fix:`, …).

- Phạm vi: toàn bộ lịch sử
- Số commit: **106**
- Khoảng thời gian: **2026-06-24 → 2026-10-28**
- Sinh lúc: 2026-10-28

## Tính năng (27)

- **srs:** thay leo đoi toa do bang ADAM + gradient so (dung het ngan sach 30-60 s) — `493a97b` (2026-10-26)
  Nguoi dung noi ro: cho chay lau hon cung duoc, mien bo so phai chuan theo ca nhan
- **ui:** go 2 select TTS khoi header, modal Giong doc & toc do, xoa nut phim tat + cap on — `44f2e81` (2026-10-26)
  Theo phan anh truc tiep cua nguoi dung khi xem ban deploy.
- **queue:** cap so luot on moi ngay, mac dinh 200 (T1.5) — `14885f9` (2026-10-26)
  Truoc day chi co gioi han the MOI/ngay (computeDailyNewLimit, 5-40). Nguoi dung co
- **a11y:** sua 6 loi a11y + responsive do duoc bang CDP (P4) — `7ec2465` (2026-10-26)
  #1 #typing-input: aria-label="Go tu tieng Anh" + aria-describedby tro toi goi y
- **security:** App Check san sang + siet CSP, bo unsafe-inline khoi script-src (T0.3, T0.4) — `b9aba05` (2026-10-26)
  T0.3: khoi tao App Check (reCAPTCHA v3) ngay sau initializeApp va truoc khi tao
- **srs:** learning steps that (1p - 10p - 1 ngay) + tran interval 365 ngay (T1.1, T1.2) — `569c509` (2026-10-26)
  T1.2: MAX_INTERVAL_DAYS = 365 clamp SAU fuzz cho moi lan cham, ap ca trong
- **ui:** remake animation nut loa (TTS waveform button) — `4e51f0e` (2026-10-25)
  Animation truoc day la vong lap anime.js thoi luong co dinh ~1.4s khong
- release DATWY.V2.261024.23 with Celestial Hub Data redesign, sync key pill, offline audio hub, and FSRS-7 engine optimizations — `b5f26b9` (2026-10-24)
- **sync:** implement Master Sync V4 with tab bus, leader election, and realtime beacon — `22108d8` (2026-10-23)
- **v2.261021.08:** data-integrity upgrade + UI cleanup — `3564242` (2026-10-21)
  - Core data layer (GPT-6.1 audit fixes, retained):
- **version:** embed versioning with DATWY.V[seq].yymmdd.hh syntax and auto-update cache reset on launch — `43f91b6` (2026-10-20)
- **core:** multi-agent milestone completion with polyphonic audio, mobile zero-blur hardening, and 40/40 test pass — `d7e6b1a` (2026-10-19)
- **motion:** cinematic theme curtain transition with celestial aura, luxury easing and synth harmonics — `c267d75` (2026-10-19)
- **ui:** enhance overview entrance animation and center empty search state — `ba6ec13` (2026-10-19)
- **ui:** implement Concept 1 Golden Ratio Bento for Overview tab (62% heatmap / 38% forecast) — `a3b476e` (2026-10-19)
- **v5:** complete Project Celestial Ascension transformation with V5 Design System, empty onboarding, mobile 2x2 SRS touch grid, and Telex IME decoding — `2bea986` (2026-10-18)
- redesign Celestial Hub into Bento Grid HUD and optimize SRS sync & heatmap — `723ee17` (2026-10-16)
- implement luxury custom typing mode dropdown with intelligent word filters and adaptive leech mode — `7fdf5c3` (2026-10-07)
- redesign app icon with optical clarity, customize main topic filter dropdown, and strengthen streak recovery system — `c40fc03` (2026-10-06)
- revamp Who I Am & Achievements, fix instant sync overwrite without F5, and optimize parallel audio preloader — `f951892` (2026-09-16)
- **achievements:** redesign milestone track cards with tier themes, single-line titles, and accurate progress — `93b1dc5` (2026-09-14)
- **profile:** widen modal to 1260px and elevate Who I Am cognitive dashboard — `e9f1f54` (2026-09-14)
- **profile:** add FSRS-7 Cognitive Persona analyzer & UI tab in Profile modal — `ec71769` (2026-09-14)
- **ui:** remake Profile & Statistics modal with slate glass theme and dual-tab layout — `179c196` (2026-09-14)
- optimize vocabulary management modal for mobile and upgrade train_fsrs7 multi-file logs handler — `9c603f1` (2026-09-13)
- upgrade multi-device sync merger, redesign profile & vocab management UI, compress screenshots to WebP and overhaul documentation — `7c16531` (2026-09-13)
- **core:** massive architectural overhaul with FSRS-7 optimization suite and secure configuration — `011e247` (2026-09-09)

## Sửa lỗi (32)

- **app:** 4 loi that + khoa bang test, tach badge-rules, don ma chet — `452b64c` (2026-10-28)
  LOI THAT da sua (deu loai im lang: khong crash, chi mat thong tin):
- **srs:** cổng thống kê cho "Tối ưu trên máy" — trước đây báo cải thiện dựa trên nhiễu — `ffa311a` (2026-10-26)
  Người dùng hỏi bấm "Tối ưu trên máy" có thực sự hiệu quả/chính xác không. Kiểm toán
- **ui:** "+XP" bam vao the hoc thay vi toa do trang (de len hang nut cham) — `eaec7b9` (2026-10-26)
  Nguoi dung bao: dong "+15 XP" hien ra thap, de len cac nut cham diem (Khó/Nhớ/Dễ)
- **pwa:** manifest theo thuc te app — lang vi, nen toi #0f172a, them description — `babe1b8` (2026-10-26)
  Manifest dang ghi `lang: "en"` va `background_color: "#ffffff"` trong khi:
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
- **ui:** xoa overlay answer-feedback sau khi nhan rating — `2ed7d48` (2026-10-25)
  Overlay 'CHinh Xac / On Lai / Kho / Hoan Hao' to giua man hinh sau moi lan
- **ui:** sua 7 loi giao diện phat hien qua audit truoc deploy — `bdb4dd6` (2026-10-25)
  - Toast: thieu weight class lam icon rỗng (ph-fill prefix cho ten icon tron)
- throttle audio preload concurrency to 4 and persist streak freeze refund — `ee28031` (2026-10-23)
- **sync:** eliminate bulk push loop, shut down realtime listener, and add quota circuit breaker — `9522592` (2026-10-23)
- **streak:** reconcile streak freeze on sync and raise daily streak requirement to 10 cards — `b524052` (2026-10-23)
- **srs,queue:** implement graduation floor >= 1d, strict today-filter, deduplicate queue, and eliminate typing double-logging — `395705d` (2026-10-20)
- **gamification:** resolve XP bar visibility glitch, prevent string-OR truthiness bug, and synchronize rank progress — `eb7118d` (2026-10-20)
- **hub,srs:** resolve modal side-strip containment, add vertical breathing room, and completely abolish card suspension — `3e21931` (2026-10-20)
- **events:** harmonize anime timeline settlement and prewarm gamification for steady-state performance — `0bf500d` (2026-10-19)
- **gamification:** resolve lingering floating-xp in Boost Mode with 2-layer fail-safe auto-cleanup — `aef8fae` (2026-10-19)
- **ui:** resolve theme transition curtain viewport coverage, center slit gap, and click shield — `1b1df23` (2026-10-19)
- **mobile:** resolve overview charts collapse and optimize bento hud layout — `e27145f` (2026-10-18)
- **mobile:** resolve modal scroll cut-off, toast overflow on 320px, and expand touch targets to 44px — `70e6dea` (2026-10-18)
- **audit:** resolve back-face Space navigation, typing retry state leak on undo, and transition race guards — `ed2db6d` (2026-10-18)
- **audit:** isolate typing.js dependencies and finalize audit deliverables package — `1f3d1f1` (2026-10-18)
- **audit:** resolve Space key accessibility, 900ms undo deadzone, SRS exception defense, and add full V5 independent audit deliverables — `fb07105` (2026-10-18)
- **sync:** resolve bidirectional FSRS-7 settings sync and timestamp mismatch across devices — `86192ba` (2026-09-13)
- **docs:** format math formula with Unicode and fix nested list rendering for Blogger MarkdownRenderer — `fc72363` (2026-09-13)
- **docs:** replace abstract artwork with proper English vocabulary flashcard app UI mockup — `1abd7e4` (2026-09-13)

## Hiệu năng (8)

- **srs:** dùng hết ngân sách thời gian cho bộ tối ưu (dò sâu + 2 nửa holdout) — `b3995e3` (2026-10-26)
  Người dùng nói tối ưu là thao tác hiếm, chờ 30 s không sao. Nên nới ngân sách và
- **bundle:** dua io.js ra khoi entry, entry 81,85 -> 74,93 kB gzip (T4.5c) — `1ed0b0e` (2026-10-26)
  Truoc: entry 81,85 kB gzip = 99,8% tran 82 kB, con 0,15 kB. Khong con cho cho bat ky
- **tts:** tach panel cai dat giong doc sang chunk lazy, entry 81,38 -> 80,67 kB gzip — `c3f5a51` (2026-10-26)
  Panel TTS (2 select + 9 option toc do + badge + listener voiceschanged) chuyen
- **assets:** self-host Lexend, subset lai icon font, bo MP3 khoi precache (T2.2, T3.1) — `2313e40` (2026-10-26)
  T2.2 - Lexend tu host: 3 file variable woff2 (latin 39.680, latin-ext 34.476,
- **sync:** fix redundant full-dataset push in Phase 2 to prevent quota exhaustion — `ab12ae4` (2026-10-23)
- **css:** eliminate all GPU-heavy backdrop-filter & keyframe repaints — `aea28e7` (2026-10-21)
  - Remove 13 active backdrop-filter: blur() instances (replaced with
- eliminate mobile & laptop GPU lag with intelligent Boost Mode and universal zero-blur mobile reset — `131d165` (2026-10-19)
- implement Unified Master Architecture V3 for zero-GPU idle and composited rendering — `2ea72d4` (2026-10-16)

## Tái cấu trúc (4)

- **css:** giam !important 1.920 -> 286 va them safe-area xoay ngang (T3.2, T4.3) — `03900c2` (2026-10-26)
  T3.2: !important toan src/css 1.920 -> 286, rieng style.css 1.624 -> 188 (muc tieu
- **state:** tach state.js 1.621 -> 616 dong thanh 10 module (T4.5b) — `8d45904` (2026-10-26)
  Cung mot API: barrel van phat ra dung 93 ten runtime (91 khai bao + 2 re-export
- **css:** xoa CSS chet trong style.css (T3.2) — `862c33a` (2026-10-26)
  Chi xoa, khong sua: 504 dong / 62 rule, 32 class khong xuat hien o bat ky dau
- **whoiam:** rename tab to Who I Am, use objective academic terminology, and enhance visual dual-bar comparisons — `6a825ab` (2026-09-14)

## Tài liệu (20)

- **repo:** so lieu README do lai, CHANGELOG sinh lai, bo 12,7 MB binary khoi git — `ee44f87` (2026-10-28)
  - README: 203 test -> 311 test / 19 -> 33 file; them badge ESLint 0 error,
- cap nhat so lieu sau khi sua UI (241 test, 38 commit, CSS 324,5 kB) — `fa6c25a` (2026-10-26)
- T3.2 + T4.3 xong — !important 286, CSS 322,58 kB, 229 test — `7c7f349` (2026-10-26)
  README: test 229. Backlog: T3.2 va T4.3 danh [x] voi SHA 03900c2, kem so do va
- **backlog:** cap nhat dong tom tat theo so task thuc te (31/37) — `44c02ee` (2026-10-26)
  Dem lai tu bang: 37 dong task, 30 dong [x] het + 1 dong [x] mot phan (T4.5) = 31,
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
- them UPGRADE_BACKLOG - chia 36 task nang cap theo 6 phase (P0-P5) — `2390c23` (2026-10-26)
- update README and screenshots for version DATWY.V2.261024.10 — `a6262e4` (2026-10-24)
- **readme:** rewrite for DATWY.V2.261021 — reflect data-integrity upgrade, new src tree, 52 tests, UI changes & changelog — `760915b` (2026-10-21)
- add celestial project thumbnail artwork in webp and update README and article — `de40e17` (2026-09-13)
- add journey article markdown for personal blog publication — `03aee4c` (2026-09-13)
- fix header and table of contents anchor links with persistent HTML IDs — `81b9741` (2026-09-09)
- remove private web link from README and add full visual screenshot gallery — `77513fe` (2026-09-09)
- rewrite README with comprehensive FSRS-7 documentation, empirical benchmarks, and UI screenshot — `4ae5830` (2026-09-09)

## Kiểm thử (2)

- **e2e:** dua smoke E2E vao git + do baseline khoi dong (T4.6, T3.4) — `81d7b09` (2026-10-26)
  T4.6: scratch/smoke-study-loop.mjs -> tests/e2e/study-loop.mjs (179 dong, giu
- **srs:** golden test FSRS + sua 2 loi that cua du bao 7 ngay + ngan sach bundle (T1.7, T1.6, T3.5) — `4047255` (2026-10-26)
  T1.7: tests/golden-fsrs.test.mjs - 50 kich ban x 11 truong (S, S_short, D,

## Khác (10)

- **tooling:** ESLint 9 + Prettier, cong chan lint trong CI (0 error) — `a9b341c` (2026-10-28)
- **release:** DATWY.V2.261026.22 — build lai tu HEAD 493a97b truoc khi deploy — `30b4cf9` (2026-10-26)
- **release:** DATWY.V2.261026.21 — cổng thống kê cho bộ tối ưu FSRS-7 — `100e74f` (2026-10-26)
- **release:** DATWY.V2.261026.19 — header gọn, modal TTS, sửa vị trí +XP — `a67f183` (2026-10-26)
  Build production trước khi deploy: go 2 select TTS khoi header (thay bang modal
- **release:** DATWY.V2.261026.15 - build truoc khi deploy — `3bd7907` (2026-10-26)
- **changelog:** sinh lai CHANGELOG tu git log (28 commit) — `6e4d412` (2026-10-26)
- **backup:** checkpoint UI remake truoc khi sua loi giao diện (audit 2026-10-25) — `09ea705` (2026-10-25)
- retain audio preload concurrency at 1000 as requested — `659e9b7` (2026-10-23)
- **release:** bump version to DATWY.V2.261021.09 after GPU verification — `6e3f756` (2026-10-21)
- add linguistic analysis scripts and word classification datasets — `dedd7ea` (2026-10-08)

## Không theo conventional commits (3)

- Calm sync frequency, disable realtime listeners, and remove intrusive sync popups during study — `30530c0` (2026-09-14)
- Update README to remove application experience link — `df6f10a` (2026-09-13)
  Removed the 'Trải Nghiệm Ứng Dụng Thực Tế' link from the README.
- Upload project lần đầu nè — `2369ba9` (2026-06-24)

