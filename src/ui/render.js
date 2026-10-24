import anime from 'animejs/lib/anime.es.js';
import { DOM } from './elements.js';
import { getState, setCurrentCardIndex, setIsFlipped, setSoundMode, setIsDarkMode, setIsBoostMode, setVocabulary, saveVocabulary, setAllTags, setIsTransitioning, shouldCardUseTyping, getTypingFilterStats, isCardLeech, setTypingFilter, ensureDailyStats, getLastReviewSnapshot } from '../core/state.js';
import { playSound, ensureAudioForWords } from '../core/sound.js';
import { buildReviewQueue, getNextCardToReview, getSmartCramCards, getPendingLearningCards } from '../core/queue.js';
// modal.js được nạp động: render <-> modal là vòng import lớn nhất của app.
// Gọi UI modal không cần đồng bộ, nên nạp động vừa phá vòng vừa giảm entry chunk.
let _modalModulePromise = null;
function getModalModule() {
    if (!_modalModulePromise) _modalModulePromise = import('./modal.js');
    return _modalModulePromise;
}
import { setBoostMode, updateCanvasTheme } from './celestial-canvas.js';
import { animateFlip, animateNumber } from '../core/animations.js';
import { isFuzzySearchMatch } from '../core/dedup.js';
import { escapeHTML } from '../core/utils/sanitize.js';
import { nextRevision } from '../core/card-merge.js';
import { predictNextIntervals } from '../core/srs/index.js';
import { startTypingTimer } from '../features/typing.js';

export function updateUndoButtonState() {
    const snapshot = getLastReviewSnapshot();
    const undoBtn = DOM.undoBtn || (typeof document !== 'undefined' ? document.getElementById('undo-btn') : null);
    if (undoBtn) {
        undoBtn.disabled = !snapshot;
        undoBtn.classList.toggle('disabled', !snapshot);
        undoBtn.title = snapshot 
            ? `Hoàn tác đánh giá từ "${snapshot.previousCard?.english || ''}" (Ctrl+Shift+Z)` 
            : 'Chưa có lượt đánh giá nào để hoàn tác';
    }
}

// ─── CELEBRATION CONFETTI: MỘT canvas + MỘT vòng rAF duy nhất ─────────────
// Trước đây mỗi lần mở khóa huy hiệu lại tạo một mảng particles + một vòng
// requestAnimationFrame RIÊNG, cùng vẽ chồng lên một canvas. Khi người dùng
// nhập một kho lớn, hàng chục huy hiệu mở cùng lúc ⇒ hàng chục vòng rAF và
// clearRect toàn màn hình mỗi frame ⇒ lag nặng. Nay các đợt pháo hoa được gộp
// vào cùng một danh sách, tối đa 220 hạt, và chỉ có tối đa một vòng rAF.
const CELEBRATE_COLORS = ['#f59e0b', '#ec4899', '#8b5cf6', '#3b82f6', '#10b981', '#fde047', '#a855f7', '#06b6d4', '#e11d48'];
const MAX_CELEBRATE_PARTICLES = 220;
let _celebrateCanvas = null;
let _celebrateCtx = null;
let _celebrateParticles = [];
let _celebrateRaf = 0;
let _celebrateLastTs = 0;

function getCelebrationSurface() {
    if (typeof document === 'undefined') return null;
    if (!_celebrateCanvas) {
        _celebrateCanvas = document.createElement('canvas');
        _celebrateCanvas.id = 'global-celebrate-canvas';
        _celebrateCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:999999;display:none;';
        document.body.appendChild(_celebrateCanvas);
        _celebrateCtx = _celebrateCanvas.getContext('2d');
    }
    if (!_celebrateCtx) _celebrateCtx = _celebrateCanvas.getContext('2d');
    if (!_celebrateCtx) return null;

    // Chỉ đổi kích thước khi thực sự thay đổi: đổi width/height sẽ xóa canvas
    // và làm mất các hạt đang bay của đợt trước.
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (_celebrateCanvas.width !== w || _celebrateCanvas.height !== h) {
        _celebrateCanvas.width = w;
        _celebrateCanvas.height = h;
    }
    return _celebrateCtx;
}

function stepCelebration(ts) {
    const ctx = _celebrateCtx;
    const canvas = _celebrateCanvas;
    if (!ctx || !canvas) { _celebrateRaf = 0; return; }

    if (getState?.()?.isBoostMode) {
        _celebrateParticles.length = 0;
        _celebrateRaf = 0;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.style.display = 'none';
        return;
    }

    const dt = Math.min(48, ts - _celebrateLastTs || 16.666) / 16.666;
    _celebrateLastTs = ts;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const drag = Math.pow(0.965, dt); // mọi hạt dùng chung hệ số cản
    let writeIndex = 0;
    for (let i = 0; i < _celebrateParticles.length; i++) {
        const p = _celebrateParticles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += p.gravity * dt;
        p.vx *= drag;
        p.vy *= drag;
        p.rotation += p.vRot * dt;

        if (ts - p.bornAt > 1100) {
            p.opacity = Math.max(0, p.opacity - 0.024 * dt);
        }

        if (p.opacity <= 0 || p.y > canvas.height + 30) continue;

        _celebrateParticles[writeIndex++] = p;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;
        if (p.shape === 'rect') {
            ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        } else {
            ctx.beginPath();
            ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
    _celebrateParticles.length = writeIndex;

    if (_celebrateParticles.length > 0) {
        _celebrateRaf = requestAnimationFrame(stepCelebration);
    } else {
        _celebrateRaf = 0;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.style.display = 'none';
    }
}

export function launchCelebrationConfetti(options = {}) {
    if (typeof window === 'undefined') return;
    if (getState?.()?.isBoostMode) return;

    const canvas = _celebrateCanvas || document.getElementById('global-celebrate-canvas') || null;
    if (canvas && !_celebrateCanvas) _celebrateCanvas = canvas;
    const ctx = getCelebrationSurface();
    if (!ctx || !_celebrateCanvas) return;

    const now = performance.now();
    const count = Math.min(options.count || 85, 120);
    const originX = options.x ?? (_celebrateCanvas.width * 0.5);
    const originY = options.y ?? (_celebrateCanvas.height * 0.38);

    for (let i = 0; i < count; i++) {
        const angle = Math.PI * 2 * Math.random();
        const speed = Math.random() * 12 + 4;
        _celebrateParticles.push({
            x: originX + (Math.random() - 0.5) * 40,
            y: originY + (Math.random() - 0.5) * 30,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - Math.random() * 5,
            size: Math.random() * 7 + 4,
            color: CELEBRATE_COLORS[Math.floor(Math.random() * CELEBRATE_COLORS.length)],
            rotation: Math.random() * 360,
            vRot: (Math.random() - 0.5) * 14,
            opacity: 1,
            gravity: 0.24,
            drag: 0.965,
            shape: Math.random() > 0.35 ? 'rect' : 'circle',
            bornAt: now
        });
    }

    // Giữ tổng số hạt trong ngưỡng an toàn: bỏ các hạt cũ nhất trước.
    if (_celebrateParticles.length > MAX_CELEBRATE_PARTICLES) {
        _celebrateParticles.splice(0, _celebrateParticles.length - MAX_CELEBRATE_PARTICLES);
    }

    _celebrateCanvas.style.display = 'block';
    if (!_celebrateRaf) {
        _celebrateLastTs = now;
        _celebrateRaf = requestAnimationFrame(stepCelebration);
    }
}

export function launchVictoryConfetti() {
    launchCelebrationConfetti();
    if (getState().isBoostMode) return;
    const canvas = document.getElementById('victory-confetti-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = canvas.offsetWidth || 580;
    canvas.height = canvas.offsetHeight || 390;

    const colors = ['#f59e0b', '#ec4899', '#8b5cf6', '#3b82f6', '#10b981', '#fde047', '#a855f7'];
    const particles = [];
    const count = 75;

    for (let i = 0; i < count; i++) {
        particles.push({
            x: canvas.width / 2 + (Math.random() - 0.5) * 120,
            y: canvas.height * 0.35 + (Math.random() - 0.5) * 60,
            vx: (Math.random() - 0.5) * 14,
            vy: -Math.random() * 9 - 4,
            size: Math.random() * 6 + 4,
            color: colors[Math.floor(Math.random() * colors.length)],
            rotation: Math.random() * 360,
            vRot: (Math.random() - 0.5) * 12,
            opacity: 1,
            gravity: 0.28,
            shape: Math.random() > 0.4 ? 'rect' : 'circle'
        });
    }

    let animId;
    const startTime = Date.now();

    function render() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const elapsed = Date.now() - startTime;
        let active = 0;

        for (const p of particles) {
            p.x += p.vx;
            p.y += p.vy;
            p.vy += p.gravity;
            p.vx *= 0.98;
            p.rotation += p.vRot;

            if (elapsed > 1200) {
                p.opacity = Math.max(0, p.opacity - 0.025);
            }

            if (p.opacity > 0 && p.y < canvas.height + 20) {
                active++;
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate((p.rotation * Math.PI) / 180);
                ctx.globalAlpha = p.opacity;
                ctx.fillStyle = p.color;

                if (p.shape === 'rect') {
                    ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
                } else {
                    ctx.beginPath();
                    ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.restore();
            }
        }

        if (active > 0 && elapsed < 3500) {
            animId = requestAnimationFrame(render);
        } else {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }

    render();
}

export function displayCard(index, preserveFlipState = false) {
    const { vocabulary } = getState();
    const cardData = vocabulary[index];

    // Trường hợp không có thẻ để hiển thị: Phân biệt Onboarding Rỗng vs Màn hình Vinh Quang (Victory Stage)
    if (!cardData) {
        DOM.flashcardArea?.classList.add('hidden');
        DOM.controlsArea?.classList.add('hidden');
        DOM.noCardMessage?.classList.remove('hidden');
        
        // Reset trạng thái nghỉ ngơi khi mở lại
        if (DOM.finalDayRestState) DOM.finalDayRestState.classList.add('hidden');

        const emptyOnboarding = document.getElementById('empty-onboarding-container');
        const victoryStage = document.getElementById('victory-stage-container');
        const activeVocab = (vocabulary || []).filter(w => !w.isDeleted);

        if (activeVocab.length === 0) {
            // Trường hợp 1: Kho từ vựng hoàn toàn trống -> Hiển thị Onboarding chào mừng
            if (emptyOnboarding) emptyOnboarding.classList.remove('hidden');
            if (victoryStage) victoryStage.classList.add('hidden');
        } else {
            // Trường hợp 2: Có từ vựng nhưng đã hoàn tất phiên ôn tập -> Hiển thị Grand Victory Stage
            if (emptyOnboarding) emptyOnboarding.classList.add('hidden');
            if (victoryStage) victoryStage.classList.remove('hidden');
            launchVictoryConfetti();
            const state = getState();
            const filterLowerCase = (state.currentTopicFilter || 'all').trim().toLowerCase();
            const pendingLearning = getPendingLearningCards(vocabulary, filterLowerCase);
            const cramCards = getSmartCramCards(vocabulary, filterLowerCase);
            const masteredCount = vocabulary.filter(w => !w.isDeleted && w.srsStatus === 'Mastered').length;
            const streakCount = state.gamification?.currentStreak || 0;

            // Cập nhật các chip chiến tích
            if (DOM.victoryStreakVal) DOM.victoryStreakVal.textContent = `${streakCount} ngày`;
            if (DOM.victoryMasteredVal) DOM.victoryMasteredVal.textContent = `${masteredCount} từ`;
            if (DOM.victoryCramVal) DOM.victoryCramVal.textContent = pendingLearning.length > 0 ? `${pendingLearning.length} thẻ` : `${cramCards.length} thẻ`;
            const cramChipLbl = document.querySelector('.chip-cram .chip-lbl');
            if (cramChipLbl) cramChipLbl.textContent = pendingLearning.length > 0 ? 'Đang Chờ Học' : 'Sẵn Sàng Nhồi';

            if (pendingLearning.length > 0) {
                if (DOM.victoryHeadline) DOM.victoryHeadline.textContent = "CỦNG CỐ TRÍ NHỚ!";
                if (DOM.victoryTagline) DOM.victoryTagline.textContent = `Bạn còn ${pendingLearning.length} từ đang trong bước ghi nhớ ngắn hạn.`;
                if (DOM.noCardText) DOM.noCardText.textContent = "Lộ trình FSRS đã sẵn sàng. Bạn có thể bấm tiếp tục để học dứt điểm các từ này trước khi hoàn tất mục tiêu hôm nay.";
                DOM.smartCrammingActions?.classList.remove('hidden');
                if (DOM.btnSmartCramming) {
                    DOM.btnSmartCramming.disabled = false;
                    DOM.btnSmartCramming.innerHTML = `
                        <div class="btn-glow-layer"></div>
                        <div class="btn-content">
                            <i class="ph-fill ph-lightning"></i>
                            <div class="btn-labels">
                                <span class="main-label">Học dứt điểm (+${pendingLearning.length} từ đang học)</span>
                                <span class="sub-label">Ôn ngay không cần chờ đếm ngược</span>
                            </div>
                        </div>
                    `;
                }
            } else if (cramCards.length > 0) {
                if (DOM.victoryHeadline) DOM.victoryHeadline.textContent = "XUẤT SẮC HOÀN THÀNH!";
                if (DOM.victoryTagline) DOM.victoryTagline.textContent = "Bạn đã hoàn thành xuất sắc toàn bộ mục tiêu từ vựng hôm nay.";
                if (DOM.noCardText) DOM.noCardText.textContent = "Lộ trình FusionSRS đã được đồng bộ tối ưu. Tương lai vẫn còn thẻ đến hạn — bạn muốn nghỉ ngơi giữ phong độ hay tiếp tục bứt phá học nhồi thêm?";
                DOM.smartCrammingActions?.classList.remove('hidden');
                if (DOM.btnSmartCramming) {
                    DOM.btnSmartCramming.disabled = false;
                    const cramCount = Math.min(10, cramCards.length);
                    DOM.btnSmartCramming.innerHTML = `
                        <div class="btn-glow-layer"></div>
                        <div class="btn-content">
                            <i class="ph-fill ph-rocket-launch"></i>
                            <div class="btn-labels">
                                <span class="main-label">Tiếp tục học nhồi (+${cramCount} thẻ)</span>
                                <span class="sub-label">Còn ${cramCards.length} thẻ sẵn sàng bứt phá</span>
                            </div>
                        </div>
                    `;
                }
            } else {
                if (DOM.victoryHeadline) DOM.victoryHeadline.textContent = "ĐỈNH CAO THIÊN HÀ!";
                if (DOM.victoryTagline) DOM.victoryTagline.textContent = "Bạn đã hoàn thành hàng đợi hiện tại. Hãy quay lại khi có lịch ôn mới.";
                if (DOM.noCardText) DOM.noCardText.textContent = "Không còn thẻ nào cần ôn tập trước hạn. Hãy tận hưởng một ngày nghỉ ngơi thư giãn trọn vẹn!";
                DOM.smartCrammingActions?.classList.add('hidden');
                if (DOM.finalDayRestState) DOM.finalDayRestState.classList.remove('hidden');
            }

            // Kích hoạt âm thanh hoàn thành vinh quang và pháo hoa rực rỡ
            playSound('complete');
        }
        
        setCurrentCardIndex(-1);
        updateStats();
        return;
    }
    
    // ----- NÂNG CẤP HIỆU SUẤT -----
    // Trước đây mỗi lần hiện thẻ đều gọi preloadAudio() ngay: fetch proxy + đọc
    // IndexedDB + atob/Blob trên main thread. Khi người dùng lật/đánh giá liên
    // tục, việc này chạy cho từng thẻ và tranh frame. Nay đưa vào hàng đợi
    // debounce 350ms + requestIdleCallback (3 luồng, không retry), chỉ tải khi
    // thẻ thực sự dừng lại đủ lâu; bấm loa vẫn phát ngay qua speakText().
    if (cardData.english) {
        ensureAudioForWords([cardData.english]);
    }
    // -----------------------------

    // Thiết lập trạng thái và giao diện cho thẻ
    setCurrentCardIndex(index);
    if (!preserveFlipState || !getState().isFlipped) {
        setIsFlipped(false);
        // Reset animation và class của flashcard
        if (DOM.flashcard) {
            anime.set(DOM.flashcard, { rotateY: 0, translateX: 0, translateY: 0, opacity: 1 });
            DOM.flashcard.classList.remove('is-flipped');
        }
    }
    
    const isTypingCard = shouldCardUseTyping(cardData);
    const { typingFilter } = getState();

    // Chỉ nhận diện từ CỰC KHÓ (Extremely Hard / Leech):
    // 1. Độ khó FusionSRS cực cao (Difficulty >= 8.5)
    // 2. HOẶC đã từng bị quên từ 3 lần trở lên (lapses >= 3)
    const isHardWord = isCardLeech(cardData) ||
                       (cardData.difficulty !== undefined && cardData.difficulty >= 8.5) || 
                       (cardData.lapses !== undefined && cardData.lapses >= 3);

    // Cập nhật nội dung thẻ (DOM updates)
    DOM.noCardMessage?.classList.add('hidden');
    DOM.flashcardArea?.classList.remove('hidden');
    DOM.flashcard?.classList.remove('hidden');
    DOM.controlsArea?.classList.remove('hidden');
    DOM.cardEnglish.textContent = cardData.english;
    
    // Hard badge & card glow (Chỉ hiện cho từ Cực Khó khi không ở giao diện gõ)
    DOM.flashcard?.classList.toggle('is-hard-card', isHardWord);
    DOM.cardHardBadge?.classList.toggle('hidden', !isHardWord || isTypingCard);

    const starIcon = DOM.starBtn?.querySelector('i');
    if (starIcon) starIcon.className = cardData.isStarred ? 'ph-fill ph-star' : 'ph ph-star';
    DOM.starBtn?.classList.toggle('starred', !!cardData.isStarred); // Sử dụng !! để đảm bảo giá trị là boolean
    DOM.cardVietnamese.textContent = cardData.vietnamese || 'N/A';
    DOM.cardType.textContent = cardData.type || 'N/A';
    // Ẩn dòng "Phiên âm" khi không có dữ liệu (thay vì hiển thị 'N/A')
    const hasPronunciation = !!cardData.pronunciation && cardData.pronunciation !== 'N/A';
    DOM.cardPronunciation.textContent = hasPronunciation ? cardData.pronunciation : '';
    DOM.cardPronunciation.closest('.detail-row')?.classList.toggle('hidden', !hasPronunciation);

    // Highlight từ vựng trong câu ví dụ & kích hoạt hiệu ứng Deep Focus
    const hasExample = !!cardData.example && cardData.example !== 'N/A';
    if (hasExample) {
        DOM.cardExample.innerHTML = highlightKeywordInExample(cardData.example, cardData.english);
    } else {
        DOM.cardExample.textContent = 'N/A';
    }
    DOM.cardExampleRow?.classList.toggle('is-hard-focus', isHardWord && hasExample);
    DOM.exampleFocusTag?.classList.toggle('hidden', !isHardWord || !hasExample);

    const rawTags = Array.isArray(cardData.tags) 
        ? cardData.tags 
        : (typeof cardData.tags === 'string' ? cardData.tags.split(',') : []);
    DOM.cardTags.textContent = rawTags.map(t => (t ? String(t).trim().replace(/_/g, ' ') : '')).filter(Boolean).join(', ') || '-';
    const srsStatus = cardData.srsStatus || 'New';
    if (DOM.cardSrsStatus) {
        DOM.cardSrsStatus.textContent = srsStatus;
        DOM.cardSrsStatus.className = `status-badge status-${srsStatus.toLowerCase()}`;
        DOM.cardSrsStatus.title = `Status: ${srsStatus}`;
    }

    // Thêm class cho flashcard để CSS xử lý khoảng cách
    DOM.flashcard.classList.toggle('typing-mode-active', isTypingCard);

    // Masking & UI for Typing Mode (Ẩn hoàn toàn từ Tiếng Anh để tránh spoil đáp án)
    if (DOM.cardEnglish) {
        DOM.cardEnglish.classList.remove('revealed');
        DOM.cardEnglish.classList.toggle('text-masked', isTypingCard);
        DOM.cardEnglish.classList.toggle('hidden', isTypingCard);
    }
    if (DOM.typingFrontUi) {
        DOM.typingFrontUi.classList.toggle('hidden', !isTypingCard);
        if (isTypingCard && DOM.typingHintText) {
            let badgeHtml = '';
            if (isCardLeech(cardData)) {
                badgeHtml = '<span class="typing-adaptive-badge leech"><i class="ph-bold ph-fire"></i> Từ Leech (Active Recall)</span>';
            } else if (typingFilter === 'hard') {
                badgeHtml = '<span class="typing-adaptive-badge hard"><i class="ph-bold ph-warning-circle"></i> Từ Thử thách</span>';
            } else if (typingFilter === 'learning') {
                badgeHtml = '<span class="typing-adaptive-badge learning"><i class="ph-bold ph-sparkle"></i> Từ Mới</span>';
            } else if (typingFilter === 'starred') {
                badgeHtml = '<span class="typing-adaptive-badge starred"><i class="ph-bold ph-star"></i> Thẻ Gắn Sao</span>';
            } else if (typingFilter === 'long') {
                badgeHtml = '<span class="typing-adaptive-badge long"><i class="ph-bold ph-text-align-justify"></i> Từ Dài (≥8 ký tự)</span>';
            } else {
                badgeHtml = '<span class="typing-adaptive-badge normal"><i class="ph-bold ph-keyboard"></i> Luyện gõ</span>';
            }
            DOM.typingHintText.innerHTML = `${badgeHtml}<span class="typing-hint-meaning">${escapeHTML(cardData.vietnamese || 'N/A')}</span>`;
        }
    }

    // Cập nhật giao diện thẻ
    DOM.flashcardArea?.classList.remove('hidden');
    DOM.controlsArea?.classList.remove('hidden');
    toggleFlashcardControlButtons(false);
    
    // Cập nhật thống kê cuối cùng
    updateStats();
}

export async function flipCard() {
    if (getState().isTransitioning) return;
    const { currentCardIndex, isFlipped } = getState();
    if (currentCardIndex < 0 || !DOM.flashcard) return;

    setIsTransitioning(true);
    try {
        const newFlippedState = !isFlipped;
        setIsFlipped(newFlippedState);
        await animateFlip(DOM.flashcard);
        DOM.flashcard.classList.toggle('is-flipped', newFlippedState);
        toggleFlashcardControlButtons(newFlippedState);
        if (newFlippedState) {
            playSound('flip');
            const currentCard = getState().vocabulary[getState().currentCardIndex];
            if (shouldCardUseTyping(currentCard)) {
                startTypingTimer();
            } else {
                DOM.srsFeedbackButtons?.querySelector('.srs-btn[data-rating="3"]')?.focus({ preventScroll: true });
            }
        }
    } finally {
        setIsTransitioning(false);
    }
}

function toggleFlashcardControlButtons(showSRSAndNext) {
    const front = DOM.flashcard?.querySelector('.card-front');
    const back = DOM.flashcard?.querySelector('.card-back');
    if (front) { front.setAttribute('aria-hidden', String(showSRSAndNext)); front.inert = showSRSAndNext; }
    if (back) { back.setAttribute('aria-hidden', String(!showSRSAndNext)); back.inert = !showSRSAndNext; }
    const { vocabulary, currentCardIndex } = getState();
    const currentCard = vocabulary[currentCardIndex];
    const isTypingCard = shouldCardUseTyping(currentCard);
    
    if (isTypingCard) {
        DOM.revealBtn?.classList.add('hidden');
        DOM.srsFeedbackButtons?.classList.add('hidden');
        DOM.typingArea?.classList.remove('hidden');
        
        // Reset typing feedback when newly showing
        if (!showSRSAndNext) {
            if (DOM.typingInput) {
                DOM.typingInput.value = '';
                DOM.typingInput.disabled = false;
                DOM.typingInput.classList.remove('input-danger');
            }
            if (DOM.typingSubmitBtn) DOM.typingSubmitBtn.disabled = false;
            if (DOM.typingFeedback) {
                DOM.typingFeedback.textContent = '';
                DOM.typingFeedback.className = 'typing-feedback';
            }
        }
        
        // Only focus if not showing "Next" (meaning we haven't answered yet)
        if (!showSRSAndNext) {
            setTimeout(() => {
                DOM.typingInput?.focus();
            }, 50);
            startTypingTimer();
        }
        
        DOM.nextCardBtn?.classList.toggle('hidden', !showSRSAndNext);
    } else {
        DOM.revealBtn?.classList.toggle('hidden', showSRSAndNext);
        
        if (showSRSAndNext) {
            DOM.srsFeedbackButtons?.classList.remove('hidden');
            DOM.typingArea?.classList.add('hidden');
            updateSrsButtonIntervalPreviews();
        } else {
            DOM.srsFeedbackButtons?.classList.add('hidden');
            DOM.typingArea?.classList.add('hidden');
        }
        
        // In standard flip mode: rating buttons (Again, Hard, Good, Easy) are the primary action.
        // Hide nextCardBtn to prevent skipping SRS feedback without rating.
        DOM.nextCardBtn?.classList.add('hidden');
    }

    // Nạp audio LAZY: chỉ thẻ hiện tại + 2 thẻ kế, chạy khi main thread rảnh.
    // Thay cho việc quét/tải toàn bộ kho lúc mở app (nguyên nhân lag chính).
    try {
        const state = getState();
        const upcoming = [];
        if (currentCard && currentCard.english) upcoming.push(currentCard.english);
        if (Array.isArray(state.currentReviewQueue)) {
            for (const queueIndex of state.currentReviewQueue) {
                if (upcoming.length >= 3) break;
                if (queueIndex === currentCardIndex) continue;
                const nextCard = state.vocabulary[queueIndex];
                if (nextCard?.english) upcoming.push(nextCard.english);
            }
        }
        if (upcoming.length) ensureAudioForWords(upcoming);
    } catch (error) {
        console.warn('[audio-preload]', error);
    }
}

/**
 * Cập nhật thời gian dự kiến ôn tập tiếp theo (FSRS Interval Forecast) trực tiếp trên các nút đánh giá.
 */
export function updateSrsButtonIntervalPreviews() {
    if (!DOM.srsFeedbackButtons) return;
    const { vocabulary, currentCardIndex } = getState();
    const cardData = vocabulary[currentCardIndex];
    if (!cardData) return;

    try {
        const intervals = predictNextIntervals(cardData, 'en-vi');
        
        const ratingConfig = [
            { rating: 1, label: 'Quên', icon: 'ph-duotone ph-brain' },
            { rating: 2, label: 'Khó', icon: 'ph-duotone ph-fire' },
            { rating: 3, label: 'Nhớ', icon: 'ph-duotone ph-sparkle' },
            { rating: 4, label: 'Dễ', icon: 'ph-duotone ph-check-circle' }
        ];

        ratingConfig.forEach(({ rating, label, icon }) => {
            const btn = DOM.srsFeedbackButtons.querySelector(`.srs-btn[data-rating="${rating}"]`);
            if (btn) {
                const intervalText = intervals[rating] || '';
                btn.innerHTML = `
                    <div class="srs-btn-label-group">
                        <i class="${icon}"></i>
                        <span class="srs-btn-name">${label}</span>
                    </div>
                    <span class="srs-interval-badge">${intervalText}</span>
                `;
            }
        });
    } catch (err) {
        console.warn('Failed to predict FSRS intervals:', err);
    }
}

function wordMatchesTopic(word, filterLowerCase) {
    if (!word || !filterLowerCase || filterLowerCase === 'all') return true;
    const rawTags = Array.isArray(word.tags) ? word.tags : (typeof word.tags === 'string' ? word.tags.split(',') : []);
    return rawTags.some(t => t && String(t).trim().toLowerCase() === filterLowerCase);
}

export function updateStats() {
    if (!DOM.statsArea) return;
    const { vocabulary, currentTopicFilter } = getState();
    const todayStats = ensureDailyStats();
    // study-session-bar removed; these elements no longer exist in DOM
    const filterLowerCase = (currentTopicFilter || 'all').toLowerCase();
    const now = Date.now();
    const endOfDay = new Date(now).setHours(23, 59, 59, 999);
    const { currentReviewQueue, currentCardIndex } = getState();

    // Thẻ được ép vào hàng đợi ôn tập (học nhồi / thẻ đang mở) dù chưa đến hạn tự nhiên.
    const forcedDueKeys = new Set();
    const addForcedDue = (index) => {
        if (index < 0 || index >= vocabulary.length) return;
        const card = vocabulary[index];
        if (!card || card.isDeleted || !wordMatchesTopic(card, filterLowerCase)) return;
        if (card.srsStatus === 'Mastered') forcedDueKeys.add(card.id || index);
    };
    addForcedDue(currentCardIndex);
    if (Array.isArray(currentReviewQueue)) {
        for (const queueIndex of currentReviewQueue) addForcedDue(queueIndex);
    }

    // MỘT vòng lặp duy nhất thay cho 7 lần filter() trên toàn kho.
    let totalCount = 0;
    let filteredCount = 0;
    let dueCount = 0;
    let newCount = 0;
    let totalLearningRaw = 0;
    let totalMasteredRaw = 0;
    let masteredNonDue = 0;
    let learningNonDue = 0;

    for (let index = 0; index < vocabulary.length; index++) {
        const word = vocabulary[index];
        if (!word || word.isDeleted) continue;
        totalCount++;
        if (!wordMatchesTopic(word, filterLowerCase)) continue;
        filteredCount++;

        const status = word.srsStatus;
        if (status === 'New') newCount++;
        else if (status === 'Learning') totalLearningRaw++;
        else if (status === 'Mastered') totalMasteredRaw++;

        const isNaturalDue = Boolean(word.srsDueDate) && (status === 'Mastered' ? word.srsDueDate <= endOfDay : word.srsDueDate <= now);
        const isDue = isNaturalDue || forcedDueKeys.has(word.id || index);
        if (isDue) dueCount++;
        else if (status === 'Mastered') masteredNonDue++;
        else if (status === 'Learning') learningNonDue++;
    }

    // Chỉ chạy animation đếm số khi Hub đang mở; khi đang học, ghi thẳng text để
    // không tạo 6 vòng animation 1,6 s cho phần tử người dùng không nhìn thấy.
    const manageModalEl = document.getElementById('manage-modal');
    const isHubVisible = Boolean(manageModalEl && !manageModalEl.classList.contains('hidden'));
    const shouldAnimate = isHubVisible && !getState().isBoostMode;
    const applyStat = (element, value) => {
        if (!element) return;
        if (shouldAnimate) animateNumber(element, value, 600);
        else element.textContent = String(value);
    };
    applyStat(DOM.statTotal, totalCount);
    applyStat(DOM.statFiltered, filteredCount);
    applyStat(DOM.statDue, dueCount);
    applyStat(DOM.statNew, newCount);
    applyStat(DOM.statLearning, totalLearningRaw);
    applyStat(DOM.statMastered, totalMasteredRaw);

    // Cập nhật Radial Progress Rings & Segmented Bar (Celestial Dock v3)
    const baseCount = filteredCount || 1;
    const { dailyStats } = getState();

    // Proportions for SVG radial rings
    const pMasteredTotal = Math.min(100, Math.round((totalMasteredRaw / baseCount) * 100));
    
    // NÂNG CẤP: Tiến độ Cần ôn và Đang học hiển thị theo tiến độ ngày
    const dueDone = dailyStats.dueDoneToday || 0;
    const dueTotalToday = dueCount + dueDone;
    const pDueTotal = dueTotalToday > 0 ? Math.min(100, Math.round((dueDone / dueTotalToday) * 100)) : 100;
    
    const learningDone = dailyStats.learningDoneToday || 0;
    const learningTotalToday = totalLearningRaw + learningDone;
    const pLearningTotal = learningTotalToday > 0 ? Math.min(100, Math.round((learningDone / learningTotalToday) * 100)) : 0;

    const ringMastered = document.getElementById('ring-mastered');
    const ringDue = document.getElementById('ring-due');
    const ringLearning = document.getElementById('ring-learning');

    if (ringMastered) ringMastered.setAttribute('stroke-dasharray', `${pMasteredTotal}, 100`);
    if (ringDue) ringDue.setAttribute('stroke-dasharray', `${pDueTotal}, 100`);
    if (ringLearning) ringLearning.setAttribute('stroke-dasharray', `${pLearningTotal}, 100`);

    // Segmented Progress Bar percentages (Sum = 100%)
    const pBarMastered = masteredNonDue / baseCount * 100;
    const pBarDue = dueCount / baseCount * 100;
    const pBarLearning = learningNonDue / baseCount * 100;
    const pBarNew = newCount / baseCount * 100;

    const barMastered = document.getElementById('bar-mastered');
    const barDue = document.getElementById('bar-due');
    const barLearning = document.getElementById('bar-learning');
    const barNew = document.getElementById('bar-new');

    if (barMastered) {
        barMastered.style.width = `${pBarMastered}%`;
        barMastered.title = `Đã thuộc (chưa đến hạn): ${masteredNonDue} từ (${pBarMastered}%)`;
    }
    if (barDue) {
        barDue.style.width = `${pBarDue}%`;
        barDue.title = `🔥 Cần ôn ngay hôm nay: ${dueCount} từ (${pBarDue}%)`;
    }
    if (barLearning) {
        barLearning.style.width = `${pBarLearning}%`;
        barLearning.title = `⚡️ Đang học (chưa đến hạn): ${learningNonDue} từ (${pBarLearning}%)`;
    }
    if (barNew) {
        barNew.style.width = `${pBarNew}%`;
        barNew.title = `✨ Từ mới: ${newCount} từ (${pBarNew}%)`;
    }
}

export function updateCustomTopicUI(selectedTag = null) {
    const { allTags, vocabulary, currentTopicFilter } = getState();
    const activeTag = selectedTag || currentTopicFilter || 'all';

    const activeVocab = (vocabulary || []).filter(w => !w.isDeleted);
    const tagCounts = { 'all': activeVocab.length };
    activeVocab.forEach(w => {
        const rawTags = Array.isArray(w.tags) 
            ? w.tags 
            : (typeof w.tags === 'string' ? w.tags.split(',') : []);
        rawTags.forEach(t => {
            const norm = t ? String(t).trim() : '';
            if (norm) {
                tagCounts[norm] = (tagCounts[norm] || 0) + 1;
            }
        });
    });

    const sortedTags = Array.from(allTags).sort((a, b) => {
        if (a === 'all') return -1;
        if (b === 'all') return 1;
        return a.localeCompare(b);
    });

    // Update Trigger Label & Badge
    if (DOM.customTopicLabel) {
        DOM.customTopicLabel.textContent = activeTag === 'all' ? 'Tất cả chủ đề' : activeTag.replace(/_/g, ' ');
    }
    if (DOM.customTopicBadge) {
        const count = tagCounts[activeTag] || 0;
        DOM.customTopicBadge.textContent = `${count}`;
        DOM.customTopicBadge.title = `${count} từ vựng`;
    }
    if (DOM.customTopicTotalBadge) {
        DOM.customTopicTotalBadge.textContent = `${activeVocab.length} từ`;
    }

    // Populate Custom Options List
    if (DOM.customTopicOptions) {
        DOM.customTopicOptions.innerHTML = '';
        sortedTags.forEach(tag => {
            const count = tagCounts[tag] || 0;
            const isSelected = tag === activeTag;
            const item = document.createElement('button');
            item.type = 'button';
            item.className = `custom-topic-item ${isSelected ? 'active' : ''}`;
            item.dataset.value = tag;
            item.setAttribute('role', 'option');
            item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
            
            const iconHtml = tag === 'all' 
                ? '<i class="ph-duotone ph-books item-icon"></i>' 
                : '<i class="ph-duotone ph-tag item-icon"></i>';
                
            const displayTagName = tag === 'all' ? 'Tất cả chủ đề' : escapeHTML(tag.replace(/_/g, ' '));
                
            item.innerHTML = `
                ${iconHtml}
                <span class="topic-item-name">${displayTagName}</span>
                <span class="topic-item-count">${count}</span>
                ${isSelected ? '<i class="ph-bold ph-check topic-item-check"></i>' : ''}
            `;
            DOM.customTopicOptions.appendChild(item);
        });
    }
}

export function updateCustomTypingUI() {
    const { isTypingMode, typingFilter } = getState();
    const stats = getTypingFilterStats();
    const currentFilter = isTypingMode ? (typingFilter || 'leech') : 'off';

    const filterConfigs = [
        {
            id: 'off',
            icon: 'ph-cards',
            label: 'Lật thẻ',
            badgeText: '',
            title: 'Chế độ Lật thẻ phản xạ',
            desc: 'Không bắt gõ. Lật thẻ, nghe phát âm nhại theo. Tối ưu năng lượng & tốc độ.',
            count: stats.total,
            tag: '80% Thời gian',
            isRec: false
        },
        {
            id: 'leech',
            icon: 'ph-fire',
            label: 'Gõ: Leech',
            badgeText: 'Ưu tiên',
            title: 'Gõ thích ứng: Chỉ từ Leech / Hay quên',
            desc: 'Tự động bắt gõ cho các từ hay quên (Lapses ≥ 2 hoặc cực khó), từ đã thuộc sẽ lật thẻ.',
            count: stats.leech,
            tag: 'Khuyên dùng (80/20)',
            isRec: true
        },
        {
            id: 'all',
            icon: 'ph-keyboard',
            label: 'Gõ: Tất cả',
            badgeText: '100%',
            title: 'Gõ tất cả thẻ (Toàn diện)',
            desc: 'Bắt buộc gõ 100% mọi thẻ trong hàng đợi để rèn chính tả và trí nhớ cơ bắp.',
            count: stats.all,
            tag: 'Toàn diện',
            isRec: false
        },
        {
            id: 'hard',
            icon: 'ph-warning-circle',
            label: 'Gõ: Từ khó',
            badgeText: '6.5+',
            title: 'Gõ từ Thử thách (Độ khó cao)',
            desc: 'Chỉ bắt gõ các thẻ có độ khó FSRS cao (Difficulty ≥ 6.5) hoặc từng gặp trở ngại.',
            count: stats.hard,
            tag: 'Thử thách',
            isRec: false
        },
        {
            id: 'learning',
            icon: 'ph-sparkle',
            label: 'Gõ: Từ mới',
            badgeText: 'New',
            title: 'Gõ từ Mới & Đang học',
            desc: 'Rèn phản xạ gõ ngay từ giai đoạn đầu để khắc sâu hình thái từ vựng.',
            count: stats.learning,
            tag: 'Giai đoạn đầu',
            isRec: false
        },
        {
            id: 'starred',
            icon: 'ph-star',
            label: 'Gõ: Có sao',
            badgeText: '⭐',
            title: 'Gõ thẻ Đánh dấu sao',
            desc: 'Chỉ bắt gõ các thẻ bạn đã chủ động gắn dấu sao ưu tiên học tập.',
            count: stats.starred,
            tag: 'Ưu tiên',
            isRec: false
        },
        {
            id: 'long',
            icon: 'ph-text-align-justify',
            label: 'Gõ: Từ dài',
            badgeText: '≥8 ký tự',
            title: 'Gõ từ Dài dễ sai chính tả (≥ 8 ký tự)',
            desc: 'Tập trung gõ các từ dài nhiều âm tiết dễ nhầm lẫn như accommodate, compensation...',
            count: stats.long,
            tag: 'Chính tả',
            isRec: false
        }
    ];

    const activeConfig = filterConfigs.find(c => c.id === currentFilter) || filterConfigs[0];

    // Cập nhật nút Trigger
    if (DOM.typingModeLabel) {
        DOM.typingModeLabel.textContent = activeConfig.label;
    }
    if (DOM.typingModeIcon) {
        DOM.typingModeIcon.className = `ph-duotone ${activeConfig.icon} typing-trigger-icon`;
    }
    if (DOM.typingFilterBadge) {
        if (activeConfig?.badgeText) {
            DOM.typingFilterBadge.textContent = activeConfig.badgeText;
            DOM.typingFilterBadge?.classList?.remove('hidden');
        } else {
            DOM.typingFilterBadge?.classList?.add('hidden');
        }
    }
    if (DOM.customTypingTrigger) {
        DOM.customTypingTrigger.classList.toggle('is-typing-active', currentFilter !== 'off');
    }

    // Render danh sách tùy chọn trong Menu
    if (DOM.customTypingOptions) {
        DOM.customTypingOptions.innerHTML = '';
        filterConfigs.forEach(cfg => {
            const isSelected = cfg.id === currentFilter;
            const item = document.createElement('button');
            item.type = 'button';
            item.className = `custom-typing-option ${isSelected ? 'active' : ''} ${cfg.isRec ? 'recommended' : ''}`;
            item.dataset.value = cfg.id;
            item.setAttribute('role', 'option');
            item.setAttribute('aria-selected', isSelected ? 'true' : 'false');

            item.innerHTML = `
                <div class="typing-option-icon-wrap ${cfg.id}">
                    <i class="ph-duotone ${cfg.icon}"></i>
                </div>
                <div class="typing-option-info">
                    <div class="typing-option-header">
                        <span class="typing-option-title">${escapeHTML(cfg.title)}</span>
                        ${cfg.isRec ? '<span class="typing-rec-tag"><i class="ph-bold ph-seal-check"></i> Khuyên dùng</span>' : ''}
                    </div>
                    <p class="typing-option-desc">${escapeHTML(cfg.desc)}</p>
                </div>
                <div class="typing-option-meta">
                    <span class="typing-option-count">${cfg.count} thẻ</span>
                    ${isSelected ? '<i class="ph-bold ph-check typing-option-check"></i>' : ''}
                </div>
            `;
            DOM.customTypingOptions.appendChild(item);
        });
    }

    // Cập nhật nút Dedicated Session
    if (DOM.startDedicatedTypingBtn) {
        if (currentFilter === 'off') {
            DOM.startDedicatedTypingBtn.innerHTML = `
                <i class="ph-bold ph-fire"></i>
                <span>Tạo phiên luyện gõ Leech cấp tốc (15 thẻ)</span>
            `;
        } else {
            DOM.startDedicatedTypingBtn.innerHTML = `
                <i class="ph-bold ph-lightning"></i>
                <span>Luyện gõ tập trung: ${escapeHTML(activeConfig.label)} (15 thẻ)</span>
            `;
        }
    }
}

export function populateTopicFilters(tagsHaveChanged = false) {
    const { allTags } = getState();
    const sortedTags = Array.from(allTags).sort((a, b) => {
        if (a === 'all') return -1;
        if (b === 'all') return 1;
        return a.localeCompare(b);
    });
    const currentMainFilter = DOM.mainTopicFilter ? DOM.mainTopicFilter.value : 'all';
    const currentPanelFilter = DOM.panelTopicFilter ? DOM.panelTopicFilter.value : 'all';
    if (DOM.mainTopicFilter) DOM.mainTopicFilter.innerHTML = '';
    if (DOM.panelTopicFilter) DOM.panelTopicFilter.innerHTML = '';
    sortedTags.forEach(tag => {
        const optionMain = document.createElement('option');
        optionMain.value = tag;
        optionMain.textContent = tag === 'all' ? '📚 Tất cả chủ đề' : tag.replace(/_/g, ' ');
        if (DOM.mainTopicFilter) DOM.mainTopicFilter.appendChild(optionMain);
        const optionPanel = document.createElement('option');
        optionPanel.value = tag;
        optionPanel.textContent = tag === 'all' ? 'Tất cả chủ đề' : tag.replace(/_/g, ' ');
        if (DOM.panelTopicFilter) DOM.panelTopicFilter.appendChild(optionPanel);
    });
    if (DOM.mainTopicFilter) DOM.mainTopicFilter.value = allTags.has(currentMainFilter) ? currentMainFilter : 'all';
    if (DOM.panelTopicFilter) DOM.panelTopicFilter.value = allTags.has(currentPanelFilter) ? currentPanelFilter : 'all';

    updateCustomTopicUI(DOM.mainTopicFilter ? DOM.mainTopicFilter.value : 'all');
}

export function applyDarkMode(isDark) {
    document.body.classList.toggle('dark-mode', isDark);
    setIsDarkMode(isDark);
    localStorage.setItem('celestialDarkMode', isDark);
    const icon = DOM.toggleDarkModeBtn?.querySelector('i');
    if (icon) icon.className = isDark ? 'ph-duotone ph-sun' : 'ph-duotone ph-moon-stars';

    updateCanvasTheme(isDark);
}

export function applySoundSetting(mode) {
    setSoundMode(mode);
    localStorage.setItem('celestialSoundMode', mode);
    
    const icon = DOM.toggleSoundBtn?.querySelector('i');
    const label = DOM.toggleSoundBtn?.querySelector('.btn-label');
    
    if (icon) {
        if (mode === 'all') icon.className = 'ph-duotone ph-speaker-high';
        else if (mode === 'sfx') icon.className = 'ph-duotone ph-music-note';
        else if (mode === 'tts') icon.className = 'ph-duotone ph-waveform';
        else icon.className = 'ph-duotone ph-speaker-slash';
    }
    
    if (label) {
        if (mode === 'all') label.textContent = 'Âm thanh: Tất cả';
        else if (mode === 'sfx') label.textContent = 'Âm thanh: Chỉ SFX';
        else if (mode === 'tts') label.textContent = 'Âm thanh: Chỉ TTS';
        else label.textContent = 'Âm thanh: Tắt';
    }
    DOM.toggleSoundBtn?.classList.toggle('muted', mode === 'off');
}

export function applyBoostMode(isBoost, showToastNotification = false) {
    setIsBoostMode(isBoost);
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem('celestialBoostMode', isBoost ? 'true' : 'false');
    }

    document.body.classList.toggle('boost-mode', isBoost);
    document.documentElement.classList.toggle('boost-mode', isBoost);
    document.querySelectorAll('.floating-xp').forEach(el => el.remove());

    const btn = DOM.toggleBoostModeBtn || document.getElementById('toggle-boost-mode-btn');
    if (btn) {
        btn.classList.toggle('active', isBoost);
        const icon = btn.querySelector('i');
        if (icon) {
            icon.className = isBoost ? 'ph-fill ph-lightning' : 'ph-duotone ph-lightning';
        }
        const label = btn.querySelector('.btn-label');
        if (label) {
            label.textContent = isBoost ? 'Tăng Tốc: BẬT' : 'Tăng Tốc (Boost)';
        }
        btn.setAttribute('aria-pressed', isBoost ? 'true' : 'false');
        btn.title = isBoost 
            ? 'Chế độ Tăng Tốc đang BẬT (giảm hiệu ứng nền)'
            : 'Bật Chế độ Tăng Tốc (Giảm hiệu ứng, tiết kiệm tài nguyên)';
    }

    setBoostMode(isBoost);

    if (showToastNotification) {
        getModalModule().then(m => {
            if (isBoost) {
                m.showToast?.('Chế Độ Tăng Tốc ⚡', 'Đã bật Boost Mode: Giảm chuyển động và hiệu ứng nền để tập trung học.', 'ph-lightning');
            } else {
                m.showToast?.('Hiệu Ứng Thiên Hà ✨', 'Đã khôi phục giao diện sao trời đầy đủ.', 'ph-sparkle');
            }
        }).catch(() => {});
    }
}

let visibleCount = 40;
const INITIAL_LOAD_COUNT = 40;
let filteredWordsCache = [];
let scrollListenerAttached = false;
let sentinelObserver = null;
let wordListDelegationAttached = false;
let pendingLoadMore = false;
let loadMoreDebounceTimer = null;

/**
 * Trước đây mỗi sự kiện scroll chạm đáy đều tạo ngay 40 thẻ (hàng trăm DOM
 * node) ngay giữa frame ⇒ khựng đúng lúc đang cuộn. Nay:
 *   1. Chờ người dùng ngừng cuộn ~140ms (tránh chèn DOM giữa lúc cuộn).
 *   2. Nạp trong requestIdleCallback.
 *   3. Chỉ có tối đa 1 lượt nạp đang chờ.
 */
function scheduleLoadMoreWords() {
    if (loadMoreDebounceTimer) clearTimeout(loadMoreDebounceTimer);
    if (visibleCount >= filteredWordsCache.length) {
        updateSentinelState();
        return;
    }
    loadMoreDebounceTimer = setTimeout(() => {
        loadMoreDebounceTimer = null;
        if (pendingLoadMore) return;
        pendingLoadMore = true;
        const run = () => {
            pendingLoadMore = false;
            loadMoreWords();
        };
        if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(run, { timeout: 400 });
        } else {
            setTimeout(run, 16);
        }
    }, 140);
}

function loadMoreWords() {
    if (visibleCount >= filteredWordsCache.length) {
        updateSentinelState();
        return;
    }

    const prevCount = visibleCount;
    visibleCount = Math.min(visibleCount + INITIAL_LOAD_COUNT, filteredWordsCache.length);

    // Một lần parse HTML cho cả trang thay vì 40 lần createElement + 160 lần
    // appendChild + 160 closure onclick. Danh sách vẫn giữ nguyên cấu trúc DOM.
    const html = filteredWordsCache.slice(prevCount, visibleCount).map(wordCardHtml).join('');
    if (html) DOM.wordListDisplay.insertAdjacentHTML('beforeend', html);
    updateSentinelState();

    // Nếu màn hình vẫn chưa được lấp đầy (sentinel còn trong vùng nhìn), nạp
    // tiếp trang sau. Quan sát lại sentinel thay vì đọc getBoundingClientRect
    // để không ép layout ngay sau khi vừa chèn DOM.
    if (visibleCount < filteredWordsCache.length && sentinelObserver) {
        const sentinel = document.getElementById('word-list-sentinel');
        if (sentinel) {
            sentinelObserver.unobserve(sentinel);
            sentinelObserver.observe(sentinel);
        }
    }
}

function updateSentinelState() {
    const sentinel = document.getElementById('word-list-sentinel');
    if (!sentinel) return;
    if (filteredWordsCache.length === 0) {
        sentinel.style.display = 'none';
        sentinel.innerHTML = '';
    } else if (visibleCount >= filteredWordsCache.length) {
        sentinel.style.display = 'block';
        sentinel.innerHTML = `<span class="word-list-end-msg"><i class="ph-fill ph-check-circle"></i> Đã hiển thị toàn bộ ${filteredWordsCache.length} từ vựng</span>`;
    } else {
        sentinel.style.display = 'block';
        sentinel.innerHTML = `<span class="sentinel-spinner"><i class="ph-duotone ph-spinner animate-spin"></i> Đang tải thêm từ vựng... (${visibleCount}/${filteredWordsCache.length})</span>`;
    }
}

export function updatePanelWordList(resetScroll = true) {
    if (!DOM.wordListDisplay) return;
    
    const { vocabulary } = getState();
    const searchTerm = DOM.manageSearchInput.value.trim().toLowerCase();
    const selectedTopic = document.getElementById('panel-topic-filter').value.toLowerCase();
    const selectedStatus = document.getElementById('panel-status-filter').value;

    DOM.wordListDisplay.innerHTML = ''; // Xóa nội dung cũ

    filteredWordsCache = vocabulary.filter(word => {
        if (word.isDeleted) return false;
        const topicMatch = wordMatchesTopic(word, selectedTopic);
        const statusMatch = selectedStatus === 'all' || word.srsStatus === selectedStatus;
        const searchMatch = !searchTerm || isFuzzySearchMatch(searchTerm, word.english, word.vietnamese);
        return topicMatch && statusMatch && searchMatch;
    }).sort((a, b) => a.english.localeCompare(b.english));

    // Cập nhật thẻ đếm tổng số từ (1 vòng lặp, không cấp phát mảng phụ)
    updateWordListCountBadge();

    if (filteredWordsCache.length === 0) {
        DOM.wordListDisplay.innerHTML = `
            <div class="vocab-empty-results">
                <div class="empty-icon-wrap">
                    <i class="ph-duotone ph-magnifying-glass"></i>
                </div>
                <h4>Không tìm thấy từ vựng nào</h4>
                <p>
                    Không có thẻ nào khớp với từ khóa tìm kiếm hoặc bộ lọc trạng thái hiện tại.
                </p>
                <button type="button" id="reset-vocab-filter-btn" class="primary-btn outline-btn reset-filter-btn">
                    <i class="ph-bold ph-arrow-counter-clockwise"></i> Đặt lại bộ lọc
                </button>
            </div>
        `;
        document.getElementById('reset-vocab-filter-btn')?.addEventListener('click', () => {
            if (DOM.manageSearchInput) DOM.manageSearchInput.value = '';
            const tFilter = document.getElementById('panel-topic-filter');
            const sFilter = document.getElementById('panel-status-filter');
            if (tFilter) tFilter.value = 'all';
            if (sFilter) sFilter.value = 'all';
            updatePanelWordList(true);
        });
        updateSentinelState();
        return;
    }

    if (resetScroll) {
        visibleCount = INITIAL_LOAD_COUNT;
        const section = document.getElementById('word-list-section');
        if (section) section.scrollTop = 0;
    } else if (visibleCount > filteredWordsCache.length) {
        visibleCount = filteredWordsCache.length;
    }

    // Một lần parse HTML cho cả trang: nhanh hơn đáng kể so với tạo từng node.
    DOM.wordListDisplay.innerHTML = filteredWordsCache
        .slice(0, visibleCount)
        .map(wordCardHtml)
        .join('');
    updateSentinelState();
    ensureWordListDelegation();

    // Thiết lập IntersectionObserver và scroll listener cho infinite scroll mượt mà
    const section = document.getElementById('word-list-section');
    const sentinel = document.getElementById('word-list-sentinel');

    if (!scrollListenerAttached && section) {
        section.addEventListener('scroll', () => {
            if (section.scrollTop + section.clientHeight >= section.scrollHeight - 250) {
                scheduleLoadMoreWords();
            }
        }, { passive: true });
        scrollListenerAttached = true;
    }

    if ('IntersectionObserver' in window && sentinel && section) {
        if (sentinelObserver) sentinelObserver.disconnect();
        sentinelObserver = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                scheduleLoadMoreWords();
            }
        }, {
            root: section,
            rootMargin: '300px 0px'
        });
        sentinelObserver.observe(sentinel);
    }
}

function updateWordListCountBadge() {
    const countBadge = document.getElementById('manage-total-count');
    if (!countBadge) return;
    const { vocabulary } = getState();
    let totalCount = 0;
    for (let i = 0; i < vocabulary.length; i++) {
        if (vocabulary[i] && !vocabulary[i].isDeleted) totalCount++;
    }
    const countText = filteredWordsCache.length === totalCount
        ? `${totalCount} từ`
        : `${filteredWordsCache.length}/${totalCount}`;
    countBadge.innerHTML = `<i class="ph-bold ph-cards"></i> ${countText}`;
}

// HTML của một thẻ từ vựng (Material Design 3 & Celestial V5).
// Trả về chuỗi để cả trang chỉ cần một lần parse; toàn bộ nút hành động dùng
// event delegation ở cấp danh sách nên không tạo closure/listener cho từng thẻ.
function wordCardHtml(word) {
    const statusColors = {
        'New': 'var(--new-color)',
        'Learning': 'var(--learning-color)',
        'Mastered': 'var(--mastered-color)',
    };
    const statusColor = statusColors[word.srsStatus] || 'var(--new-color)';
    const statusLabels = { 'New': 'Mới', 'Learning': 'Đang học', 'Mastered': 'Đã thuộc' };
    const statusLabel = statusLabels[word.srsStatus] || 'Mới';
    const statusSlug = (word.srsStatus || 'New').toLowerCase();

    const safeEnglish = escapeHTML(word.english);
    const safeType = escapeHTML(word.type || '');
    const safeVietnamese = escapeHTML(word.vietnamese);
    const safePronunciation = word.pronunciation ? escapeHTML(word.pronunciation) : '';
    const rawWordTags = Array.isArray(word.tags)
        ? word.tags
        : (typeof word.tags === 'string' ? word.tags.split(',') : []);
    const safeTagsStr = escapeHTML(rawWordTags.map(t => (t ? String(t).trim().replace(/_/g, ' ') : '')).filter(Boolean).join(', '));
    const safeTagsDisplay = safeTagsStr || 'Không có chủ đề';
    const safeId = escapeHTML(word.id);
    const isStarred = !!word.isStarred;

    const srsMetricPill = (typeof word.stability === 'number' && word.stability > 0)
        ? `<span class="word-card-srs-badge" style="background: rgba(138,43,226,0.18); border-color: rgba(168,85,247,0.35); color: #c084fc;" title="Độ bền FSRS-7: ${word.stability.toFixed(1)} ngày">S: ${word.stability.toFixed(1)}d</span>`
        : '';

    return `<div class="word-card status-${statusSlug}" data-word-id="${safeId}" style="--status-color: ${statusColor}">
        <div class="word-card-status-bar"></div>
        <div class="word-card-inner">
            <div class="word-card-header">
                <div class="word-card-title-group">
                    <span class="word-english">${safeEnglish}</span>
                    <span class="word-type">${safeType}</span>
                </div>
                <div class="word-card-header-right">
                    ${srsMetricPill}
                    <span class="word-card-srs-badge">${statusLabel}</span>
                    <input type="checkbox" class="word-card-checkbox" data-id="${safeId}" aria-label="Chọn từ ${safeEnglish}">
                </div>
            </div>
            <div class="word-card-body">
                <p class="word-vietnamese">${safeVietnamese}</p>
                ${safePronunciation ? `<p class="word-pronunciation">${safePronunciation}</p>` : ''}
            </div>
            <div class="word-card-footer">
                <span class="word-card-tags" title="${safeTagsStr}">${safeTagsDisplay}</span>
                <div class="word-card-actions">
                    <button type="button" class="icon-btn card-action-btn tts-btn-card" title="Phát âm (TTS)"><i class="ph-duotone ph-speaker-high"></i></button>
                    <button type="button" class="icon-btn card-action-btn star-btn-card${isStarred ? ' starred' : ''}" title="${isStarred ? 'Bỏ đánh dấu sao' : 'Đánh dấu sao'}"><i class="${isStarred ? 'ph-fill ph-star' : 'ph ph-star'}"></i></button>
                    <button type="button" class="icon-btn card-action-btn edit-btn-card" title="Sửa từ"><i class="ph-duotone ph-pencil-simple"></i></button>
                    <button type="button" class="icon-btn card-action-btn danger-btn delete-btn-card" title="Xóa từ"><i class="ph-duotone ph-trash"></i></button>
                </div>
            </div>
        </div>
    </div>`;
}

function ensureWordListDelegation() {
    if (wordListDelegationAttached || !DOM.wordListDisplay) return;
    wordListDelegationAttached = true;
    DOM.wordListDisplay.addEventListener('click', handleWordListActionClick);
}

function findWordForCard(cardEl) {
    const id = cardEl?.dataset?.wordId;
    if (!id) return null;
    return getState().vocabulary.find(card => card.id === id && !card.isDeleted) || null;
}

function handleWordListActionClick(e) {
    const btn = e.target.closest('.card-action-btn');
    if (!btn || !DOM.wordListDisplay?.contains(btn)) return;
    const cardEl = btn.closest('.word-card');
    const current = findWordForCard(cardEl);
    if (!current) return;

    // Nút Nghe Phát Âm (TTS)
    if (btn.classList.contains('tts-btn-card')) {
        e.stopPropagation();
        import('../core/sound.js').then(m => m.speakText(current.english));
        return;
    }

    // Nút Đánh dấu sao (Star)
    if (btn.classList.contains('star-btn-card')) {
        e.stopPropagation();
        current.isStarred = !current.isStarred;
        current.flagsUpdatedAt = nextRevision(current, 'flagsUpdatedAt');
        current.updatedAt = Math.max(Date.now(), current.updatedAt || 0, current.flagsUpdatedAt);
        import('../core/state.js').then(m => m.saveOneWord(current));
        btn.classList.toggle('starred', !!current.isStarred);
        btn.innerHTML = `<i class="${current.isStarred ? 'ph-fill ph-star' : 'ph ph-star'}"></i>`;
        btn.title = current.isStarred ? 'Bỏ đánh dấu sao' : 'Đánh dấu sao';
        return;
    }

    // Nút Sửa
    if (btn.classList.contains('edit-btn-card')) {
        getModalModule().then(m => {
            m.closeModal?.(DOM.manageModal);
            m.openAddEditModal?.(true, current);
        }).catch(() => {});
        return;
    }

    // Nút Xóa
    if (btn.classList.contains('delete-btn-card')) {
        getModalModule().then(m => m.showConfirmation?.(`Bạn có chắc muốn xóa từ "${current.english}"?`, () => {
            const currentVocab = getState().vocabulary;
            const idx = currentVocab.findIndex(v => v.id === current.id);
            if (idx === -1) return;
            currentVocab[idx].isDeleted = true;
            currentVocab[idx].updatedAt = Date.now();
            setVocabulary(currentVocab);
            import('../core/state.js').then(s => s.saveOneWord(currentVocab[idx]));
            // Xóa đúng thẻ khỏi DOM thay vì render lại toàn bộ danh sách (có
            // thể đang có hàng trăm thẻ đã cuộn qua).
            filteredWordsCache = filteredWordsCache.filter(w => w.id !== current.id);
            if (filteredWordsCache.length === 0) {
                updatePanelWordList(false); // hiển thị đúng empty-state như trước
            } else {
                if (cardEl?.isConnected) cardEl.remove();
                visibleCount = Math.max(0, Math.min(visibleCount - 1, filteredWordsCache.length));
                updateWordListCountBadge();
                updateSentinelState();
            }
            getModalModule().then(modal => modal.showPopup?.(`Đã xóa từ "${current.english}".`, 'success'));
        })).catch(() => {});
    }
}


export function checkAndCleanupTags() {
    const { vocabulary, allTags } = getState();
    const currentActiveTags = new Set(['all']);
    vocabulary.forEach(word => {
        if (!word.isDeleted) {
            word.tags?.forEach(tag => currentActiveTags.add(tag));
        }
    });
    let tagsRemoved = false;
    allTags.forEach(tag => {
        if (!currentActiveTags.has(tag)) {
            tagsRemoved = true;
        }
    });
    if (tagsRemoved) {
        setAllTags(currentActiveTags);
    }
    return tagsRemoved;
}

/**
 * Tự động tìm và highlight từ vựng trong câu ví dụ (hỗ trợ cả dấu gạch chéo, ngoặc đơn, biến thể hậu tố và cụm từ)
 * Chống vỡ thẻ HTML bằng Single-Pass Regex thay thế 1 lần duy nhất.
 */
export function highlightKeywordInExample(example, englishWord) {
    if (!example || example === 'N/A' || !englishWord) return escapeHTML(example || 'N/A');
    
    const safeExample = escapeHTML(example);
    // Tách các từ thay thế nếu có dấu gạch chéo '/' (ví dụ: put off / delay)
    const rawTerms = englishWord.split('/').map(t => t.trim()).filter(Boolean);
    const patterns = [];
    
    for (const rawTerm of rawTerms) {
        // Loại bỏ phần giải thích trong ngoặc đơn nếu có (ví dụ: "set (sth) up" -> "set up")
        const cleanTerm = rawTerm.replace(/\([^)]*\)/g, '').trim().replace(/\s+/g, ' ');
        if (!cleanTerm) continue;

        const safeClean = escapeHTML(cleanTerm);
        const escaped = safeClean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        if (escaped.includes(' ')) {
            // Cụm từ (ví dụ: a variety of, set up)
            const words = escaped.split(/\s+/).filter(w => w.length > 0);
            patterns.push(words.join('\\s+') + '(?:\\w*)');
        } else {
            // Từ đơn hoặc từ có gạch nối
            const stem = escaped.length > 4 ? escaped.slice(0, -1) : escaped;
            patterns.push('\\b(?:' + stem + '\\w*|' + escaped + ')\\b');
        }
    }
    
    if (patterns.length === 0) return safeExample;

    try {
        // Gom lại và thay thế trong 1 lần duy nhất để tránh vỡ thẻ HTML lồng nhau
        const combinedRegex = new RegExp('(' + patterns.join('|') + ')', 'gi');
        return safeExample.replace(combinedRegex, '<mark class="example-highlight">$1</mark>');
    } catch (e) {
        return safeExample;
    }
}
