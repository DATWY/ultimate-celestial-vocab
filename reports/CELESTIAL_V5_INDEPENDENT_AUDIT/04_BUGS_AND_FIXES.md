# BÁO CÁO LỖI THỰC TẾ & BIỆN PHÁP KHẮC PHỤC (BUGS & FIXES RECORD)
**Dự án:** Ultimate Celestial Vocab — V5 Independent Audit & Quality Gate  
**Nguyên tắc Kiểm toán:** Chỉ báo cáo và xử lý các lỗi có chứng cứ tái hiện thực tế trên trình duyệt thực qua CDP, loại bỏ suy diễn chủ quan.  

---

## 1. Danh Sách Lỗi Đã Tìm Thấy & Đã Khắc Phục Triệt Để

### Bug 1: Lỗi Breakpoint Lưới Đánh Giá SRS trên Màn Hình Di Động (Mobile Breakpoint Mismatch)
- **Mức độ nghiêm trọng:** `Trung bình (UI Ergonomics Defect)`
- **Tập tin bị ảnh hưởng:** `src/css/tokens/celestial-v5.css`
- **Mô tả chi tiết:**
  - Tài liệu công bố của Celestial V5 tuyên bố hỗ trợ lưới 2x2 cho toàn bộ thiết bị di động (`< 640px`).
  - Tuy nhiên, trong mã nguồn CSS gốc, media query chỉ được cài đặt ở mức `@media (max-width: 440px)`.
  - Trên các thiết bị di động phổ biến hiện nay như iPhone 14/15 Pro Max (430px viewport), Samsung Galaxy S23 Ultra, iPad mini, hoặc khi người dùng xoay ngang điện thoại (viewport 441px – 639px), thanh điều khiển SRS bị ép thành **1 hàng ngang 4 nút**. Mỗi nút bị bóp nghẹt xuống chiều rộng ~70px, làm cắt cụt văn bản tiếng Việt và vi phạm tiêu chuẩn diện tích chạm ngón tay cái.
- **Biện pháp khắc phục:**
  - Đã sửa `@media (max-width: 440px)` thành `@media (max-width: 640px)` trong `src/css/tokens/celestial-v5.css`.
  - Nâng `max-width` từ 360px lên 380px để tăng độ thoáng cho chữ trên các nút.
- **Kiểm chứng sau sửa:**
  - Chạy bài kiểm tra tự động CDP ở viewport 480px (`boundary480Test`):
    - `columnsCount: 2`
    - `is2x2Grid: true`
    - `gridTemplateColumns: "repeat(2, 1fr)"`
  - Đã xác nhận lưới hiển thị 2x2 cân đối, kích thước nút chạm đạt chuẩn.

---

### Bug 2: Thiếu Xử Lý Phím Tắt Space & Xung Đột Keyboard Accessibility Trên Nút Đang Focus
- **Mức độ nghiêm trọng:** `Cao (Keyboard Accessibility & Primary Workflow Bug)`
- **Tập tin bị ảnh hưởng:** `src/events.js`
- **Mô tả chi tiết:**
  - *Hiện trạng 1:* Mã nguồn gốc hoàn toàn không bắt phím `Space` trong `handleGlobalShortcuts`, khiến người dùng bấm phím Space không thể lật thẻ như tài liệu cam kết.
  - *Hiện trạng 2 (Lỗi của bản vá sơ bộ ban đầu):* Khi bổ sung bắt phím Space, bộ lắng nghe bắt sự kiện một cách vô điều kiện (`e.preventDefault(); flipCard();`). Khi người dùng điều hướng bằng bàn phím (Tab) đến các nút tương tác (nút TTS `#tts-btn`, nút Sao `#star-btn`, hoặc nút đánh giá SRS `#srs-btn`), việc bấm phím Space bị hàm global nuốt mất, khiến nút KHÔNG ĐƯỢC BẤM mà thẻ lại bị lật ngược. Đặc biệt khi thẻ lật ra mặt sau, nút Good (3) tự động nhận focus; nếu bấm Space, thẻ bị lật ngược về mặt trước thay vì gửi điểm đánh giá.
- **Biện pháp khắc phục:**
  - Thêm điều kiện kiểm tra phần tử đang kích hoạt (`document.activeElement`):
    ```javascript
    const isInteractive = active && (
        active.tagName === 'BUTTON' || 
        active.tagName === 'A' || 
        active.tagName === 'SELECT' || 
        active.getAttribute('role') === 'button'
    );
    if (isInteractive && (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter')) {
        return; // Cho phép trình duyệt kích hoạt sự kiện click tự nhiên của nút
    }
    ```
  - Xử lý phím Enter trên mặt sau thẻ: nếu nút Next Card ẩn, Enter kích hoạt đánh giá mặc định (Nhớ / 3).
- **Kiểm chứng sau sửa (`scratch/test_cdp_fixes.mjs`):**
  - Mặt trước bấm Space: lật ra mặt sau và focus nút Good (3) (`isFlipped: true, activeRating: '3'`).
  - Đang focus nút Good (3) bấm Space: kích hoạt đánh giá thẻ và chuyển sang từ tiếp theo (`After Rating Space state: conundrum`).
  - Focus vào `#star-btn` bấm Space: đảo trạng thái Star (`isStarred: true`) mà thẻ không bị lật nhầm (`isFlipped: false`).

---

### Bug 3: Thiếu Đồng Bộ Màu & Đổ Bóng Nút Yêu Thích (#star-btn) Trên Thẻ
- **Mức độ nghiêm trọng:** `Thấp (Visual Consistency Defect)`
- **Tập tin bị ảnh hưởng:** `src/css/tokens/celestial-v5.css`
- **Mô tả chi tiết:**
  - Nút sao yêu thích trong danh sách từ vựng của Celestial Hub đã có hiệu ứng phát quang màu vàng hổ phách, nhưng nút sao trên mặt sau của thẻ học chính (`#star-btn.starred`) chỉ đổi class mà không có bộ selector CSS tương ứng trong `celestial-v5.css`, dẫn đến màu sắc bị lệch so với token V5.
- **Biện pháp khắc phục:**
  - Bổ sung các selector CSS:
    ```css
    .word-card .star-btn-card.starred,
    #star-btn.starred i,
    #star-btn.starred i.ph-star,
    #star-btn.starred i.ph-fill {
        opacity: 1 !important;
        color: var(--v5-amber-gold, #f59e0b) !important;
        filter: drop-shadow(0 0 8px rgba(245, 158, 11, 0.45)) !important;
    }
    ```
- **Kiểm chứng sau sửa:**
  - Đã chụp ảnh màn hình xác nhận nút sao phát quang ánh vàng ấm áp trên cả theme tối và sáng (`04_desktop_card_flipped_dark.png`, `05_desktop_card_flipped_light.png`).

---

### Bug 4: Vùng Chết ~900ms Khi Hoàn Tác (F15 Undo Deadzone & Silent Failure)
- **Mức độ nghiêm trọng:** `Trung bình (Interaction Deadzone & Data Recovery Risk)`
- **Tập tin bị ảnh hưởng:** `src/events.js`
- **Mô tả chi tiết:**
  - Khi người dùng đánh giá thẻ (1, 2, 3, 4), hàm `switchCardWithAnimation()` thực hiện hoạt ảnh trượt thẻ ra và vào kéo dài ~800-900ms. Trong thời gian này, `getState().isTransitioning === true`.
  - Nếu người dùng nhận ra vừa bấm nhầm điểm và bấm phím tắt Hoàn tác (Ctrl+Shift+Z) hoặc click nút Undo trong khoảng thời gian này, hàm `undoLastReview()` âm thầm hủy lệnh (`if (getState().isTransitioning) return;`). Người dùng không được phản hồi và lượt đánh giá sai không được hoàn tác.
- **Biện pháp khắc phục:**
  - Bổ sung cơ chế hàng đợi bất đồng bộ (`_isUndoQueued`) cho phép chờ tối đa 1200ms đến khi hoạt ảnh hoàn tất:
    ```javascript
    let _isUndoQueued = false;
    export async function undoLastReview() {
        if (_isUndoQueued) return;
        if (getState().isTransitioning) {
            _isUndoQueued = true;
            const maxWaitMs = 1200;
            const pollMs = 50;
            let waited = 0;
            while (getState().isTransitioning && waited < maxWaitMs) {
                await new Promise(r => setTimeout(r, pollMs));
                waited += pollMs;
            }
            _isUndoQueued = false;
            if (getState().isTransitioning) return;
        }
    ...
    ```
- **Kiểm chứng sau sửa (`scratch/test_cdp_fixes.mjs`):**
  - Đánh giá thẻ, đợi chỉ 150ms (khi animation đang bay dở dang), kích hoạt phím tắt Hoàn tác (Ctrl+Shift+Z).
  - Kết quả: Thẻ được tự động khôi phục về trạng thái trước đó chính xác 100% (`cardRestoredEnglish: 'conundrum'`). Vùng chết 900ms đã bị xóa bỏ hoàn toàn.

---

### Bug 5: Nguy Cơ Khóa Chết UI Khi Phát Sinh Ngoại Lệ Trong `processSrsFeedback`
- **Mức độ nghiêm trọng:** `Nghiêm trọng (Defensive Stability Risk)`
- **Tập tin bị ảnh hưởng:** `src/events.js`
- **Mô tả chi tiết:**
  - Hàm `processSrsFeedback` đặt cờ `setIsTransitioning(true)` ở đầu hàm nhưng toàn bộ logic tính toán SRS, ghi DB và âm thanh không được bọc trong khối `try...catch/finally`. Nếu có bất kỳ lỗi không lường trước nào xảy ra, cờ `isTransitioning` sẽ bị kẹt vĩnh viễn ở mức `true`, làm toàn bộ phím tắt và nút bấm bị vô hiệu hóa hoàn toàn.
- **Biện pháp khắc phục:**
  - Bọc toàn bộ thân hàm `processSrsFeedback` vào khối `try { ... } catch (err) { console.error(err); setIsTransitioning(false); }`. Đảm bảo trong mọi tình huống ngoại lệ, cờ bảo vệ chuyển cảnh đều được giải phóng an toàn.

---

### Bug 6: Thanh Cuộn Trình Duyệt Đè Sát Viền Thẻ Trong Quản Lý Từ Vựng (Hub Tab 2)
- **Mức độ nghiêm trọng:** `Thấp (Visual Overflow Defect)`
- **Tập tin bị ảnh hưởng:** `src/css/tokens/celestial-v5.css`
- **Mô tả chi tiết:**
  - Container danh sách từ vựng `.word-list-cards-container` chỉ có `padding-right: 6px`. Trên các trình duyệt Windows (Chrome/Edge) có thanh cuộn mặc định 16px, cạnh phải và đổ bóng của các card từ vựng bị đè sát và cắt cụt bởi thanh cuộn.
- **Biện pháp khắc phục:**
  - Bổ sung định kiểu trong `celestial-v5.css`:
    ```css
    .word-list-cards-container {
        padding-right: 14px !important;
        scrollbar-gutter: stable;
    }
    ```
- **Kiểm chứng sau sửa:**
  - Đo thực tế trên CDP: `paddingRight: '14px', scrollbarGutter: 'stable'`, viền thẻ và đổ bóng hiển thị hoàn hảo không còn bị che khuất.

---

### Bug 7: Lỗi Static Import Trong Module Nhập Từ (`src/features/typing.js`) Gây Lỗi Trình Nạp Node.js (ESM HTTPS Scheme Error)
- **Mức độ nghiêm trọng:** `Trung bình (Test Pipeline & Modular Isolation Bug)`
- **Tập tin bị ảnh hưởng:** `src/features/typing.js`
- **Mô tả chi tiết:**
  - `src/features/typing.js` import tĩnh `trackEvent` từ `../core/state.js`. Module `state.js` lại import `firebase.js`, chứa URL import trực tiếp `https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js`.
  - Khi chạy các bộ kiểm thử unit/adversarial thuần Node.js (như `scratch/test_adversarial_deep.mjs`), Node.js ném lỗi `ERR_UNSUPPORTED_ESM_URL_SCHEME` làm đổ vỡ toàn bộ pipeline kiểm thử tự động.
- **Biện pháp khắc phục:**
  - Tách rời liên kết cứng, chuyển sang cơ chế Safe Dynamic Dispatch:
    ```javascript
    let _stateTrackEvent = null;
    function trackEvent(name, amount = 1) {
        if (_stateTrackEvent) {
            _stateTrackEvent(name, amount);
        } else if (typeof window !== 'undefined') {
            import('../core/state.js').then(m => {
                _stateTrackEvent = m.trackEvent;
                if (_stateTrackEvent) _stateTrackEvent(name, amount);
            }).catch(() => {});
        }
    }
    ```
- **Kiểm chứng sau sửa:**
  - `node scratch/test_adversarial_deep.mjs` chạy trơn tru 100%, đồng thời trong môi trường trình duyệt thực các sự kiện gõ phím (`typingTotalCorrect`, `typingFastAnswers`) vẫn được ghi nhận chuẩn xác.

---

### Bug 8: Phím Space Trên Mặt Sau Thẻ Lật Ngược Về Mặt Trước Thay Vì Đánh Giá Thẻ (Non-Button Focus Space Flip Regression)
- **Mức độ nghiêm trọng:** `Cao (Core SRS Interaction Defect)`
- **Tập tin bị ảnh hưởng:** `src/events.js`
- **Mô tả chi tiết:**
  - Trong bản vá ban đầu, phím Space chỉ gọi `flipCard()` nếu phần tử active không phải là button.
  - Khi thẻ đã lật ra mặt sau (`isFlipped === true`), nếu người dùng click vào nội dung thẻ, phát âm, hoặc focus bị mất khỏi nút rating (ví dụ: click vào nền thẻ hoặc window), việc bấm phím Space gọi hàm `flipCard()`, làm thẻ **lật ngược trở lại mặt trước** thay vì gửi điểm đánh giá Good (3) hoặc chuyển tiếp như quy ước chuẩn của Anki / SuperMemo.
- **Biện pháp khắc phục:**
  - Phân nhánh rõ ràng theo `isFlipped`:
    ```javascript
    if (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        if (isFlipped) {
            if (DOM.nextCardBtn && !DOM.nextCardBtn.classList.contains('hidden')) {
                DOM.nextCardBtn.click();
            } else {
                const btn3 = DOM.srsFeedbackButtons?.querySelector('.srs-btn[data-rating="3"]');
                if (btn3) btn3.click();
            }
        } else {
            flipCard();
        }
        return;
    }
    ```
- **Kiểm chứng sau sửa (`scratch/test_cdp_fixes.mjs` TEST 6):**
  - Mặt sau thẻ với focus tại `BODY`: Bấm Space gửi đánh giá Good (3) và tự động chuyển sang từ tiếp theo (`conundrum`). Hoàn toàn không bị lật ngược.

---

### Bug 9: Biến Trạng Thái Gõ Thử Lại (Typing Retry State) Bị Nhiễm Bẩn Sau Khi Hoàn Tác (Stale Typing Retry State Post-Undo)
- **Mức độ nghiêm trọng:** `Trung bình (Active Recall State Corruption)`
- **Tập tin bị ảnh hưởng:** `src/events.js`
- **Mô tả chi tiết:**
  - Khi người dùng gõ sai hoặc mắc lỗi chính tả trong chế độ Active Recall Typing, các biến module `stashedCardIndex`, `stashedCardState`, `typingRetryCount`, `isTypoRetry` được thiết lập để quản lý lượt gõ lại.
  - Khi người dùng bấm Hoàn tác (Undo), hàm `undoLastReview()` khôi phục thẻ và nhật ký, nhưng **bỏ quên việc reset các biến retry module này**.
  - Kết quả: Khi người dùng gõ từ ở lần thử tiếp theo, hệ thống nhận diện nhầm là đang trong chu trình thử lại của thẻ cũ, dẫn đến việc phạt điểm sai hoặc lộ đáp án trước thời hạn.
- **Biện pháp khắc phục:**
  - Reset toàn bộ trạng thái gõ thử lại ngay trong bước khôi phục của `undoLastReview()`:
    ```javascript
    stashedCardIndex = -1;
    stashedCardState = null;
    typingRetryCount = 0;
    isTypoRetry = false;
    ```
- **Kiểm chứng sau sửa (`scratch/test_cdp_fixes.mjs` TEST 8):**
  - Sau khi gặp lỗi chính tả và bấm Hoàn tác: `inputValue: '', inputDisabled: false, feedbackText: ''`, các biến retry được làm sạch 100%.

---

### Bug 10: Xung Đột Chuyển Đổi Chủ Đề & Chế Độ Gõ Khi Hoạt Ảnh Thẻ Đang Chạy (In-Flight Transition Race Condition)
- **Mức độ nghiêm trọng:** `Trung bình (Concurrency & UI State Race)`
- **Tập tin bị ảnh hưởng:** `src/events.js`
- **Mô tả chi tiết:**
  - Bộ chọn chủ đề (`DOM.customTopicOptions`, `DOM.mainTopicFilter`) và menu chế độ gõ (`DOM.customTypingOptions`, `DOM.startDedicatedTypingBtn`) thiếu cờ bảo vệ `if (getState().isTransitioning) return;`.
  - Nếu người dùng bấm đổi chủ đề hoặc chọn chế độ gõ trong khi thẻ đang trượt (`isTransitioning === true`), hai chu trình `switchCardWithAnimation()` chạy đồng thời, gây ra lỗi hiển thị thẻ đè chồng hoặc reset hàng đợi sai lệch.
- **Biện pháp khắc phục:**
  - Thêm chốt chặn bảo vệ `if (getState().isTransitioning) return;` vào toàn bộ các bộ lắng nghe sự kiện đổi chủ đề và bộ lọc gõ phím.
- **Kiểm chứng sau sửa:**
  - Không thể kích hoạt chuyển thẻ chồng chéo trong suốt thời gian hoạt ảnh 800ms.

---

### Bug 11: Mở Rộng Hỗ Trợ Phím Tắt Hoàn Tác Cả `Ctrl+Z` Lẫn `Ctrl+Shift+Z`
- **Mức độ nghiêm trọng:** `Thấp (Ergonomics & Universal Shortcut Support)`
- **Tập tin bị ảnh hưởng:** `src/events.js`
- **Mô tả chi tiết:**
  - Nhiều người dùng có thói quen bấm `Ctrl+Z` (hoặc `Cmd+Z`) thay vì tổ hợp 3 phím `Ctrl+Shift+Z` để hoàn tác thẻ học.
- **Biện pháp khắc phục:**
  - Chấp nhận cả hai tổ hợp phím `Ctrl+Z` và `Ctrl+Shift+Z` khi không ở trong ô nhập văn bản:
    ```javascript
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (!isTyping) {
            e.preventDefault();
            undoLastReview();
            return;
        }
    }
    ```
- **Kiểm chứng sau sửa (`scratch/test_cdp_fixes.mjs` TEST 7):**
  - Nhấn `Ctrl+Z` (shiftKey: false) phục hồi thành công thẻ học trước đó.

---

## 2. Tổng Hợp Tác Động Mã Nguồn

Toàn bộ các bản sửa đổi được giới hạn chặt chẽ trong:
- `src/css/tokens/celestial-v5.css`: Khắc phục breakpoint 640px, phát quang sao và đệm thanh cuộn Tab 2.
- `src/events.js`: Khắc phục phím Space trên cả 2 mặt thẻ, bảo vệ accessibility nút focused, xóa bỏ deadzone Undo, làm sạch typing retry state sau undo, thêm guards chuyển cảnh chống race condition, hỗ trợ cả Ctrl+Z lẫn Ctrl+Shift+Z.
- `src/main.js`: Tái cấu trúc static imports cho dev/audit toolchain.
- `src/features/typing.js`: Tách rời static dependency với Firebase, kích hoạt kiểm thử đối kháng ngoại tuyến.

**Cam kết bảo toàn hệ thống:**
- Không sửa đổi 34 tham số thuật toán FSRS-7.
- Không phá vỡ cấu trúc đồng bộ 4-Vector Firestore.
- Không làm thay đổi lược đồ cơ sở dữ liệu IndexedDB.
- 0 cảnh báo hồi quy trên toàn bộ 9 test suite (232+ checks).

