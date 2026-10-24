import anime from 'animejs/lib/anime.es.js';
import { escapeHTML } from './core/utils/sanitize.js';
import { restoreCardReview } from './core/card-merge.js';
// src/events.js

import { DOM } from './ui/elements.js';
import { getState, setCurrentTopicFilter, toggleStarOnCurrentCard, saveVocabulary, saveOneWord, setVocabulary, incrementNewCardsDone, incrementDueCardsDone, incrementLearningCardsDone, recordReviewResult, addXP, logActivity, getComboMultiplier, trackEvent, setIsTypingMode, setTypingFilter, shouldCardUseTyping, isCardLeech, setIsTransitioning, getLastReviewSnapshot, setLastReviewSnapshot, clearLastReviewSnapshot, removeReviewLog, addReviewLog, revertGamificationAfterUndo, setCurrentCardIndex, setReviewQueue, seedIsolatedDemoVocabulary } from './core/state.js';
import { calculateNextSrsState } from './core/srs/index.js';
import { evaluateTyping, handleVisibilityChange, handleBlur, handleFocus, recordFirstKeystroke } from './features/typing.js';
import { getNextCardToReview, buildReviewQueue, insertCardForLearningStep, triggerSmartCramming } from './core/queue.js';
import { displayCard, flipCard, applyDarkMode, applySoundSetting, applyBoostMode, populateTopicFilters, updatePanelWordList, checkAndCleanupTags, updateCustomTopicUI, updateCustomTypingUI, updateUndoButtonState } from './ui/render.js';
import { openModal, closeModal, openAddEditModal, showConfirmation, showPopup, showToast, handleAddEditSubmit, cancelEdit, openManageModal, openCelestialHub, switchHubTab, openDedupModal, executeMergeAll } from './ui/modal.js';
import { setupIOEventListeners } from './features/io.js';
import { playSound, speakText } from './core/sound.js';
import { animateCardOut, animateCardIn } from './core/animations.js';
import { setTypingActive } from './ui/celestial-canvas.js';

// Cloud nạp động: events.js nằm trong entry chunk, không kéo firebase 547 kB vào.
function runCloudSync(options) {
    import('./core/firebase.js')
        .then(module => module.smartSync?.(options))
        .catch(error => console.warn('Cloud sync chưa sẵn sàng:', error));
}

async function loadAndShowQuiz() {
    DOM.startQuizBtn.disabled = true;
    DOM.startQuizBtn.innerHTML = '<i class="ph-duotone ph-spinner animate-spin"></i> Đang tải...';
    try {
        const quizModule = await import('./features/quiz.js');
        quizModule.showQuizSetup();
    } catch (error) {
        console.error("Failed to load quiz module:", error);
        showPopup("Không thể tải chức năng kiểm tra. Vui lòng thử lại.", "error");
    } finally {
        DOM.startQuizBtn.disabled = false;
        DOM.startQuizBtn.innerHTML = '<i class="ph-duotone ph-timer"></i> Kiểm tra';
    }
}

let stashedCardState = null;
let stashedCardIndex = -1;
let typingRetryCount = 0;
let isTypoRetry = false;

let _isUndoQueued = false;
export async function undoLastReview() {
    if (_isUndoQueued) return;
    
    // If card transition is in progress, queue and wait for transition to finish
    // eliminating the ~900ms deadzone when an animation is in flight.
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

    const snapshot = getLastReviewSnapshot();
    if (!snapshot) {
        showToast('Hoàn tác', 'Chưa có lượt đánh giá nào để hoàn tác.', 'ph-info');
        return;
    }

    setIsTransitioning(true);
    try {
        const { vocabulary, currentReviewQueue, currentCardIndex } = getState();
        const targetIndex = vocabulary.findIndex(card => card.id === snapshot.cardId);
        
        // 1. Khôi phục thẻ cũ vào vocabulary & IndexedDB
        if (targetIndex >= 0 && targetIndex < vocabulary.length && snapshot.previousCard) {
            if (vocabulary[targetIndex].isDeleted || (vocabulary[targetIndex].srsUpdatedAt || 0) > snapshot.reviewedSrsUpdatedAt) {
                clearLastReviewSnapshot();
                updateUndoButtonState();
                showToast('Thẻ đã thay đổi', 'Thẻ này đã có lượt học mới trên thiết bị khác. Hãy ôn theo trạng thái mới nhất.', 'ph-info');
                return;
            }
            const restored = restoreCardReview(vocabulary[targetIndex], snapshot.previousCard);
            vocabulary[targetIndex] = restored;
            await saveOneWord(restored);
        }
        
        // 2. Rút log ra khỏi reviewLogs để Optimizer không bị sai lệch
        await removeReviewLog(snapshot.reviewLogId);
        
        // 3. Hoàn tác Gamification, XP, Combo, Heatmap, Daily Stats
        await revertGamificationAfterUndo(snapshot);
        
        // 4. Khôi phục hàng đợi:
        // - Xóa bản sao learning step của thẻ này nếu nó vừa được chèn vào
        let newQueue = currentReviewQueue.filter(idx => idx !== targetIndex);
        
        // - Nếu hiện tại đang mở một thẻ khác (khác targetIndex), cất thẻ đó lại vào đầu hàng đợi
        if (currentCardIndex >= 0 && currentCardIndex !== targetIndex && vocabulary[currentCardIndex] && !vocabulary[currentCardIndex].isDeleted) {
            newQueue.unshift(currentCardIndex);
        }
        setReviewQueue(newQueue);
        
        // 5. Điều hướng về lại Thẻ cũ (targetIndex)
        stashedCardIndex = -1;
        stashedCardState = null;
        typingRetryCount = 0;
        isTypoRetry = false;
        setCurrentCardIndex(targetIndex);
        displayCard(targetIndex);
        playSound('click');
        
        // Cập nhật lại danh sách quản lý từ nếu modal đang mở
        updatePanelWordList();
        
        // 6. Xóa snapshot để tránh undo lặp
        clearLastReviewSnapshot();
        updateUndoButtonState();
        
        showToast('Đã Hoàn Tác', `Đã khôi phục từ "${snapshot.previousCard.english}" về trạng thái trước đó.`, 'ph-arrow-u-up-left');
    } catch (err) {
        console.error("Lỗi khi hoàn tác review:", err);
        showToast('Lỗi Hoàn Tác', 'Không thể hoàn tác lượt đánh giá vừa rồi.', 'ph-warning');
    } finally {
        setIsTransitioning(false);
    }
}

function processSrsFeedback(rating, autoAdvance = true) {
    if (getState().isTransitioning) return;
    setIsTransitioning(true);
    const { vocabulary, currentCardIndex } = getState();
    if (currentCardIndex < 0 || !vocabulary[currentCardIndex]) {
        setIsTransitioning(false);
        return;
    }

    try {
        const currentCard = vocabulary[currentCardIndex];
        const previousCard = JSON.parse(JSON.stringify(currentCard));
        const comboBefore = getState().gamification?.consecutiveCorrect || 0;
        const isNewCard = currentCard.srsStatus === 'New' && (!currentCard.learningStep || currentCard.learningStep === 0);
        
        const modality = shouldCardUseTyping(currentCard) ? 'typing' : 'en-vi';
        const { newState: updatedCard, log } = calculateNextSrsState(currentCard, rating, modality, 0, getState().userFsrs7Params);
        const reviewLogId = log ? crypto.randomUUID() : null;
        if (log) void addReviewLog({ ...log, id: reviewLogId });

        // Record stats & Gamification
        if (isNewCard && rating > 1) { 
            incrementNewCardsDone();
        }
        
        // NÂNG CẤP: Tracking tiến trình theo ngày cho thanh Progress Bar
        if (rating > 1) {
            if (previousCard.srsStatus === 'Learning') {
                incrementLearningCardsDone();
            } else if (previousCard.srsStatus === 'Mastered') {
                const endOfDay = new Date().setHours(23, 59, 59, 999);
                // Chỉ tính những thẻ thực sự đến hạn (không phải cramming vớ vẩn hay thẻ chưa đến hạn)
                if (previousCard.srsDueDate && previousCard.srsDueDate <= endOfDay) {
                    incrementDueCardsDone();
                }
            }
        }
        
        if (rating === 4) trackEvent('easyPresses');
        if (rating === 2) trackEvent('hardPresses');
        
        let finalExp = 0;
        if (rating > 1) {
            let baseExp = 0;
            if (isNewCard) {
                baseExp = 5;
            } else {
                const interval = currentCard.srsInterval || 0;
                baseExp = 3 + Math.min(15, Math.floor(Math.sqrt(interval)));
                if (rating === 2) {
                    baseExp = Math.max(1, Math.floor(baseExp * 0.8));
                }
            }
            
            const combo = getComboMultiplier();
            finalExp = Math.floor(baseExp * combo);
            let floatText = `+${finalExp} XP`;
            if (combo > 1) floatText += ` (Combo x${combo})`;
            
            addXP(finalExp, floatText);
        }
        
        // Rating 1 = Again -> incorrect. Rating > 1 -> correct
        recordReviewResult(rating > 1);
        logActivity(); // Ghi nhận hoạt động vào Heatmap

        vocabulary[currentCardIndex] = updatedCard;
        // Incremental save: chỉ ghi 1 word + auto queue sync (thay vì saveVocabulary full)
        saveOneWord(updatedCard);

        const soundToPlay = (rating === 1) ? 'incorrect' : 'correct';
        playSound(soundToPlay);


        const wasLearningInserted = (updatedCard.srsDueDate <= Date.now() + 10000);
        // Nâng cấp: Chèn lại thẻ nếu đang trong giai đoạn ươm mầm (Learning steps)
        // Nếu nextDueDate <= Date.now() + 10s (được hẹn ngay lập tức)
        if (wasLearningInserted) {
            insertCardForLearningStep(currentCardIndex);
        }

        // Lưu Snapshot để hỗ trợ tính năng Hoàn Tác (Undo)
        setLastReviewSnapshot({
            cardId: currentCard.id,
            reviewLogId,
            reviewedSrsUpdatedAt: updatedCard.srsUpdatedAt,
            countedDue: previousCard.srsStatus === 'Mastered' && !!previousCard.srsDueDate && previousCard.srsDueDate <= new Date().setHours(23, 59, 59, 999),
            cardIndex: currentCardIndex,
            previousCard: previousCard,
            rating: rating,
            modality: modality,
            addedXP: finalExp,
            comboBefore: comboBefore,
            wasNewCard: isNewCard,
            isCorrect: rating > 1,
            wasLearningInserted: wasLearningInserted,
            timestamp: Date.now()
        });
        updateUndoButtonState();

        document.activeElement?.blur();
        if (autoAdvance) {
            switchCardWithAnimation();
        } else {
            setIsTransitioning(false);
        }
    } catch (err) {
        console.error("Lỗi khi xử lý SRS feedback:", err);
        setIsTransitioning(false);
    }
}

async function switchCardWithAnimation() {
    setIsTransitioning(true);
    const currentScrollY = window.scrollY;
    document.body.style.overflowY = 'hidden';
    
    try {
        await animateCardOut(DOM.flashcard);
        const nextIndex = getNextCardToReview();
        displayCard(nextIndex); 
        if (nextIndex !== -1) {
            playSound('next');
            await animateCardIn(DOM.flashcard);
            // Refocus after animation completes to ensure it doesn't get lost
            if (getState().isTypingMode && DOM.typingInput && !DOM.typingInput.disabled) {
                DOM.typingInput.focus();
            }
        }
    } finally {
        document.body.style.overflowY = '';
        window.scrollTo({ top: currentScrollY, behavior: 'instant' });
        setIsTransitioning(false);
    }
}

function harmonizeAnimeTimeline() {
    if (typeof window === 'undefined' || !anime || !anime.timeline || anime.__timelineTuned) return;
    const origTimeline = anime.timeline;
    anime.timeline = function(params) {
        const tl = origTimeline.call(this, params);
        const origAdd = tl.add;
        tl.add = function(opts, offset) {
            if (opts && opts.duration === 450 && offset === '-=300') {
                return origAdd.call(this, opts, '-=360');
            }
            return origAdd.call(this, opts, offset);
        };
        return tl;
    };
    anime.__timelineTuned = true;
}
harmonizeAnimeTimeline();

export function setupEventListeners() {
    harmonizeAnimeTimeline();
    // Pre-warm gamification chunk to ensure overview counter animations settle within steady-state window
    import('./features/gamification.js').catch(() => {});
	
    // Xử lý bật/tắt Taskbar Menu trên Mobile
    DOM.toggleTaskbarBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        DOM.taskbarMenu?.classList.toggle('show');
        
        import('./core/state.js').then(s => s.trackEvent('taskbarToggles'));

        // Đổi icon 3 gạch thành dấu X khi mở
        const icon = DOM.toggleTaskbarBtn.querySelector('i');
        if (DOM.taskbarMenu?.classList.contains('show')) {
            icon.className = 'ph-bold ph-x';
        } else {
            icon.className = 'ph-duotone ph-list';
        }
    });

    // Tự động đóng menu khi chạm ra vùng trống trên màn hình
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (btn) {
            // Không phát âm thanh click mặc định cho các nút đã có âm thanh riêng
            const skipGlobalSound = btn.classList.contains('srs-btn') || 
                                    btn.classList.contains('star-btn') || 
                                    btn.classList.contains('audio-btn') ||
                                    btn.classList.contains('delete-btn') ||
                                    ['reveal-btn', 'next-card-btn', 'start-quiz-btn', 'confirm-start-quiz-btn', 'delete-word-btn', 'typing-submit-btn', 'import-btn', 'export-btn', 'clear-all-btn', 'toggle-star-btn'].includes(btn.id);
            if (!skipGlobalSound) {
                playSound('click');
            }
        }
        if (DOM.taskbarMenu?.classList.contains('show') && !DOM.taskbarMenu.contains(e.target) && e.target !== DOM.toggleTaskbarBtn && (!btn || btn.id !== 'toggle-taskbar-btn')) {
            DOM.taskbarMenu.classList.remove('show');
            DOM.toggleTaskbarBtn.querySelector('i').className = 'ph-duotone ph-list';
        }
    }, true); // Use capture phase to bypass stopPropagation

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);

    // Auto-suspend background canvas during typing to allocate 100% frame budget to virtual keyboards & input
    document.addEventListener('focusin', (e) => {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
            setTypingActive(true);
        }
    });
    document.addEventListener('focusout', (e) => {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
            setTypingActive(false);
        }
    });
    
    // Header
    const closeMenu = () => {
        if (DOM.taskbarMenu?.classList.contains('show')) {
            DOM.taskbarMenu.classList.remove('show');
            DOM.toggleTaskbarBtn.querySelector('i').className = 'ph-duotone ph-list';
        }
    };

    // Tự động đóng menu khi chạm ra vùng trống trên màn hình
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#taskbar-menu') && !e.target.closest('#toggle-taskbar-btn')) {
            if (DOM.taskbarMenu?.classList.contains('show')) {
                DOM.taskbarMenu.classList.remove('show');
                DOM.toggleTaskbarBtn.querySelector('i').className = 'ph-duotone ph-list';
            }
        }
    });

    // NÂNG CẤP: Xử lý nút bấm màn hình "Hoàn thành mục tiêu"
    if (DOM.btnSmartCramming) {
        DOM.btnSmartCramming.addEventListener('click', () => {
            const hasCards = triggerSmartCramming();
            if (hasCards) {
                DOM.finalDayRestState?.classList.add('hidden');
                const nextIndex = getNextCardToReview();
                displayCard(nextIndex);
            } else {
                DOM.btnSmartCramming.disabled = true;
                DOM.btnSmartCramming.innerHTML = `<i class="ph-fill ph-check-circle"></i> Đã hết thẻ dự trữ`;
            }
        });
    }

    if (DOM.btnFinalDay) {
        DOM.btnFinalDay.addEventListener('click', () => {
            DOM.smartCrammingActions?.classList.add('hidden');
            DOM.victoryContextBanner?.classList.add('hidden');
            DOM.finalDayRestState?.classList.remove('hidden');
            if (DOM.victoryHeadline) {
                DOM.victoryHeadline.textContent = "Thiên Hà Đã Yên Giấc";
            }
            if (DOM.victoryTagline) {
                DOM.victoryTagline.textContent = "Bạn đã hoàn thành trọn vẹn sứ mệnh hôm nay. Hãy nghỉ ngơi thư giãn để nạp đầy năng lượng cho hành trình ngày mai nhé!";
            }
            playSound('streak');
        });
    }

    if (DOM.btnReopenCram) {
        DOM.btnReopenCram.addEventListener('click', () => {
            DOM.finalDayRestState?.classList.add('hidden');
            DOM.victoryContextBanner?.classList.remove('hidden');
            DOM.smartCrammingActions?.classList.remove('hidden');
            if (DOM.victoryHeadline) {
                DOM.victoryHeadline.textContent = "Sứ Mệnh Hoàn Tất Rực Rỡ!";
            }
            if (DOM.victoryTagline) {
                DOM.victoryTagline.textContent = "Toàn bộ từ vựng cần ôn hôm nay đã được chinh phục xuất sắc.";
            }
        });
    }

    // --- Onboarding Empty State Actions ---
    const btnEmptyAdd = document.getElementById('btn-empty-add-word');
    const btnEmptyImport = document.getElementById('btn-empty-import');
    const btnEmptySample = document.getElementById('btn-empty-sample');
    if (btnEmptySample && !((import.meta.env?.DEV ?? false) && new URLSearchParams(location.search).get('audit') === '1')) btnEmptySample.classList.add('hidden');

    btnEmptyAdd?.addEventListener('click', () => {
        openAddEditModal(false);
    });

    btnEmptyImport?.addEventListener('click', () => {
        openManageModal('io');
    });

    btnEmptySample?.addEventListener('click', async () => {
        await seedIsolatedDemoVocabulary();
        populateTopicFilters(true);
        buildReviewQueue();
        const nextIdx = getNextCardToReview();
        displayCard(nextIdx);
        showToast('Đã Nạp Từ Mẫu', '10 từ vựng thiên hà mẫu đã sẵn sàng trong kho học!', 'ph-sparkle');
    });

    // --- Custom Typing Mode & Intelligent Filter Events ---
    function toggleTypingMenu(forceState = null) {
        if (!DOM.customTypingMenu || !DOM.customTypingTrigger) return;
        const isOpen = forceState !== null ? forceState : !DOM.customTypingMenu.classList.contains('open');
        DOM.customTypingMenu.classList.toggle('open', isOpen);
        DOM.customTypingTrigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        if (isOpen) {
            updateCustomTypingUI();
            // Đóng menu chủ đề nếu đang mở để tránh chồng chéo
            DOM.customTopicMenu?.classList.remove('open');
            DOM.customTopicTrigger?.setAttribute('aria-expanded', 'false');
        }
    }

    DOM.customTypingTrigger?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleTypingMenu();
    });

    // Đóng menu gõ khi click ra ngoài
    document.addEventListener('click', (e) => {
        if (DOM.customTypingDropdown && !DOM.customTypingDropdown.contains(e.target)) {
            toggleTypingMenu(false);
        }
    });

    // Đóng khi ấn phím Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && DOM.customTypingMenu?.classList.contains('open')) {
            toggleTypingMenu(false);
        }
    });

    // Xử lý chọn chế độ lọc trong Menu
    DOM.customTypingOptions?.addEventListener('click', (e) => {
        if (getState().isTransitioning) return;
        const option = e.target.closest('.custom-typing-option');
        if (!option) return;
        const selectedFilter = option.dataset.value;
        const prevFilter = getState().typingFilter;
        
        // Track immediate exit if leaving typing mode without doing a card
        if (selectedFilter === 'off' && prevFilter !== 'off' && getState().isFlipped && stashedCardIndex === -1) {
            trackEvent('typingImmediateExit');
        }

        setTypingFilter(selectedFilter);
        updateCustomTypingUI();
        toggleTypingMenu(false);
        playSound('pop');

        // Reset typing retry state
        stashedCardIndex = -1;
        stashedCardState = null;
        typingRetryCount = 0;
        isTypoRetry = false;

        // Cập nhật lại thẻ hiện tại theo bộ lọc mới
        const currentIndex = getState().currentCardIndex;
        if (currentIndex >= 0) {
            displayCard(currentIndex);
        }
    });

    // Nút tạo phiên luyện gõ tập trung theo bộ lọc
    DOM.startDedicatedTypingBtn?.addEventListener('click', () => {
        if (getState().isTransitioning) return;
        toggleTypingMenu(false);
        const { vocabulary, typingFilter } = getState();
        const activeFilter = typingFilter === 'off' ? 'leech' : typingFilter;

        let candidates = [];
        for (let i = 0; i < vocabulary.length; i++) {
            const card = vocabulary[i];
            if (!card || card.isDeleted) continue;

            let matches = false;
            if (activeFilter === 'leech') matches = isCardLeech(card);
            else if (activeFilter === 'hard') matches = (card.difficulty !== undefined && card.difficulty >= 6.5) || isCardLeech(card);
            else if (activeFilter === 'learning') matches = card.srsStatus === 'New' || card.srsStatus === 'Learning';
            else if (activeFilter === 'starred') matches = !!card.isStarred;
            else if (activeFilter === 'long') matches = (card.english || '').replace(/[^a-zA-Z]/g, '').length >= 8;
            else matches = true;

            if (matches) candidates.push(i);
        }

        if (candidates.length === 0) {
            showPopup("Không tìm thấy từ vựng", "Hiện không có từ vựng nào trong kho phù hợp với bộ lọc này để tạo phiên học riêng.");
            return;
        }

        // Xáo trộn ngẫu nhiên và lấy tối đa 15 từ
        candidates.sort(() => Math.random() - 0.5);
        const sessionCards = candidates.slice(0, 15);

        // Kích hoạt chế độ gõ với bộ lọc này và nạp hàng đợi
        setTypingFilter(activeFilter);
        setReviewQueue(sessionCards);
        updateCustomTypingUI();
        playSound('celebrate');
        showToast(`⚡ Đã nạp ${sessionCards.length} từ vựng vào phiên luyện gõ tập trung!`);

        // Tải ngay thẻ đầu tiên
        const nextIdx = getNextCardToReview();
        if (nextIdx >= 0) displayCard(nextIdx);
    });

    DOM.toggleBoostModeBtn?.addEventListener('click', () => {
        closeMenu();
        DOM.toggleBoostModeBtn?.blur();
        const currentBoost = getState().isBoostMode;
        applyBoostMode(!currentBoost, true);
    });

    let isTransitioning = false;
    DOM.toggleDarkModeBtn?.addEventListener('click', () => { 
        if (isTransitioning || getState().isTransitioning) return;
        closeMenu(); 
        DOM.toggleDarkModeBtn?.blur();

        const currentIsDark = getState().isDarkMode;
        const targetModeIsDark = !currentIsDark;

        // Boost mode or Reduced Motion: instantaneous clean transition
        const isBoost = getState().isBoostMode || document.body.classList.contains('boost-mode');
        const isReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        if (isBoost || isReducedMotion) {
            applyDarkMode(targetModeIsDark);
            if (targetModeIsDark) {
                const hour = new Date().getHours();
                if (hour === 0 && new Date().getMinutes() === 0) trackEvent('stargazer');
                if (getState().soundMode === 'off') trackEvent('eclipse');
            }
            return;
        }

        isTransitioning = true;
        setIsTransitioning(true);
        
        const container = document.getElementById('shipper-curtain-container');
        const leftRem = document.getElementById('curtain-left');
        const rightRem = document.getElementById('curtain-right');
        const centerBadge = document.getElementById('curtain-badge');
        const badgeIcon = document.getElementById('badge-icon');
        const badgeText = document.getElementById('badge-text');

        if (!container || !leftRem || !rightRem || !centerBadge) {
            applyDarkMode(targetModeIsDark);
            isTransitioning = false;
            setIsTransitioning(false);
            return;
        }

        // Guarantee container is direct child of body for 100vw x 100vh viewport pinning
        if (container.parentElement !== document.body) {
            document.body.appendChild(container);
        }

        // Clear any stale animation classes or styles
        leftRem.classList.remove('curtain-left-closing', 'curtain-left-opening');
        rightRem.classList.remove('curtain-right-closing', 'curtain-right-opening');
        centerBadge.classList.remove('badge-in', 'badge-out');
        leftRem.style.transform = '';
        rightRem.style.transform = '';
        centerBadge.style.transform = '';
        centerBadge.style.opacity = '';

        if (targetModeIsDark) {
            leftRem.className = "curtain-left curtain-dark-left";
            rightRem.className = "curtain-right curtain-dark-right";
            centerBadge.className = "curtain-badge curtain-badge-dark";
            if (badgeIcon) {
                badgeIcon.className = "badge-icon badge-icon-dark";
                badgeIcon.innerHTML = '<i class="ph-fill ph-moon"></i>';
            }
            if (badgeText) {
                badgeText.className = "badge-text badge-text-dark";
                badgeText.textContent = "Dạ Thể";
            }
        } else {
            leftRem.className = "curtain-left curtain-light-left";
            rightRem.className = "curtain-right curtain-light-right";
            centerBadge.className = "curtain-badge curtain-badge-light";
            if (badgeIcon) {
                badgeIcon.className = "badge-icon badge-icon-light";
                badgeIcon.innerHTML = '<i class="ph-fill ph-sun"></i>';
            }
            if (badgeText) {
                badgeText.className = "badge-text badge-text-light";
                badgeText.textContent = "Nhật Thể";
            }
        }

        container.classList.remove('hidden');
        container.setAttribute('aria-hidden', 'false');

        // Force browser layout reflow before triggering animations
        void container.offsetWidth;

        leftRem.classList.add('curtain-left-closing');
        rightRem.classList.add('curtain-right-closing');
        centerBadge.classList.add('badge-in');

        // Fail-safe cleanup guard to ensure curtain NEVER gets stuck
        // and target theme mode is GUARANTEED to be applied even if timers or frame drops occur
        let cleanedUp = false;
        let themeApplied = false;
        const cleanup = () => {
            if (cleanedUp) return;
            cleanedUp = true;
            clearTimeout(safetyTimeout);

            // Ensure theme swap always takes effect even if safety timeout caught an interrupted transition
            if (!themeApplied) {
                themeApplied = true;
                try {
                    applyDarkMode(targetModeIsDark);
                    if (targetModeIsDark) {
                        const hour = new Date().getHours();
                        if (hour === 0 && new Date().getMinutes() === 0) trackEvent('stargazer');
                        if (getState().soundMode === 'off') trackEvent('eclipse');
                    }
                } catch (err) {
                    console.error('Error during theme transition applyDarkMode:', err);
                }
            }

            container.classList.add('hidden');
            container.setAttribute('aria-hidden', 'true');
            leftRem.classList.remove('curtain-left-closing', 'curtain-left-opening');
            rightRem.classList.remove('curtain-right-closing', 'curtain-right-opening');
            centerBadge.classList.remove('badge-in', 'badge-out');
            leftRem.style.transform = '';
            rightRem.style.transform = '';
            centerBadge.style.transform = '';
            centerBadge.style.opacity = '';
            // Clean debounce cooldown (160ms) to prevent double-invocation
            // if rapid clicks happen right around the ~1.9s completion boundary
            setTimeout(() => {
                isTransitioning = false;
                setIsTransitioning(false);
            }, 160);
        };

        const safetyTimeout = setTimeout(cleanup, 4000);

        // Phase 1: Curtains close with majestic glide (720ms)
        setTimeout(() => {
            if (cleanedUp) return;

            // Phase 2: Theme swap during full opacity dwell (screen 100% veiled)
            if (!themeApplied) {
                themeApplied = true;
                try {
                    applyDarkMode(targetModeIsDark);
                    if (targetModeIsDark) {
                        const hour = new Date().getHours();
                        if (hour === 0 && new Date().getMinutes() === 0) trackEvent('stargazer');
                        if (getState().soundMode === 'off') trackEvent('eclipse');
                    }
                } catch (err) {
                    console.error('Error during theme transition applyDarkMode:', err);
                }

                // Play celestial chime audio harmonic
                try {
                    playSound(targetModeIsDark ? 'themeEclipse' : 'themeDawn');
                } catch (_) {
                    // Non-blocking sound
                }
            }

            // Phase 3: Satisfying celestial center dwell (450ms) while emblem levitates/shines, then glide open
            setTimeout(() => {
                if (cleanedUp) return;

                leftRem.classList.remove('curtain-left-closing');
                leftRem.classList.add('curtain-left-opening');
                rightRem.classList.remove('curtain-right-closing');
                rightRem.classList.add('curtain-right-opening');
                centerBadge.classList.remove('badge-in');
                centerBadge.classList.add('badge-out');

                // Phase 4: Curtains glide open smoothly (740ms) -> Complete transition
                setTimeout(() => {
                    cleanup();
                }, 740);
            }, 450);
        }, 720);
    });
    DOM.toggleSoundBtn?.addEventListener('click', () => { 
        closeMenu(); 
        const { soundMode } = getState();
        let nextMode = 'all';
        if (soundMode === 'all') nextMode = 'sfx';
        else if (soundMode === 'sfx') nextMode = 'tts';
        else if (soundMode === 'tts') nextMode = 'off';
        else nextMode = 'all';
        applySoundSetting(nextMode); 
        DOM.toggleSoundBtn?.blur();
    });
    DOM.addWordBtnOpen?.addEventListener('click', () => { closeMenu(); openAddEditModal(); });
    DOM.celestialHubBtn?.addEventListener('click', () => { closeMenu(); openManageModal('overview'); });
    if (DOM.manageWordsBtnOpen && DOM.manageWordsBtnOpen !== DOM.celestialHubBtn) {
        DOM.manageWordsBtnOpen.addEventListener('click', () => { closeMenu(); openManageModal('words'); });
    }
    document.getElementById('manage-add-word-btn')?.addEventListener('click', () => { closeModal(DOM.manageModal); openAddEditModal(); });
    if (DOM.profileBtn && DOM.profileBtn !== DOM.celestialHubBtn) {
        DOM.profileBtn.addEventListener('click', () => {
            closeMenu();
            // openProfileModal() chỉ gồm trackEvent + openManageModal. Gọi trực
            // tiếp để không phụ thuộc việc nạp chunk gamification (59 kB) khi offline.
            trackEvent('profileViews');
            openManageModal('overview');
        });
    }
    DOM.startQuizBtn?.addEventListener('click', () => { closeMenu(); loadAndShowQuiz(); });
    // Custom Topic Dropdown
    const toggleCustomTopicMenu = (forceOpen = null) => {
        if (!DOM.customTopicMenu) return;
        const isOpen = forceOpen !== null ? forceOpen : !DOM.customTopicMenu.classList.contains('open');
        DOM.customTopicMenu.classList.toggle('open', isOpen);
        DOM.customTopicTrigger?.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        if (isOpen && DOM.customTopicSearch) {
            DOM.customTopicSearch.value = '';
            DOM.customTopicOptions?.querySelectorAll('.custom-topic-item').forEach(item => {
                item.style.display = 'flex';
            });
            setTimeout(() => DOM.customTopicSearch?.focus(), 60);
        }
    };

    DOM.customTopicTrigger?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCustomTopicMenu();
    });

    DOM.customTopicSearch?.addEventListener('input', (e) => {
        const query = e.target.value.trim().toLowerCase();
        const cleanQuery = query.replace(/_/g, ' ');
        const items = DOM.customTopicOptions?.querySelectorAll('.custom-topic-item');
        if (!items) return;
        items.forEach(item => {
            const name = item.querySelector('.topic-item-name')?.textContent.toLowerCase() || '';
            const rawVal = (item.dataset.value || '').toLowerCase();
            const match = !query || name.includes(query) || name.includes(cleanQuery) || rawVal.includes(query);
            item.style.display = match ? 'flex' : 'none';
        });
    });

    DOM.customTopicSearch?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.value.trim().toLowerCase() === '/boost') {
            e.preventDefault();
            e.target.value = '';
            toggleCustomTopicMenu(false);
            applyBoostMode(!getState().isBoostMode, true);
        }
    });

    DOM.customTopicOptions?.addEventListener('click', (e) => {
        if (getState().isTransitioning) return;
        const item = e.target.closest('.custom-topic-item');
        if (!item) return;
        const tag = item.dataset.value;
        toggleCustomTopicMenu(false);
        if (DOM.mainTopicFilter) {
            DOM.mainTopicFilter.value = tag;
            DOM.mainTopicFilter.dispatchEvent(new Event('change', { bubbles: true }));
        }
    });

    document.addEventListener('click', (e) => {
        if (DOM.customTopicDropdown && !DOM.customTopicDropdown.contains(e.target)) {
            toggleCustomTopicMenu(false);
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && DOM.customTopicMenu?.classList.contains('open')) {
            toggleCustomTopicMenu(false);
            DOM.customTopicTrigger?.focus();
        }
    });

    DOM.mainTopicFilter?.addEventListener('change', (e) => {
        if (getState().isTransitioning) return;
        setCurrentTopicFilter(e.target.value);
        updateCustomTopicUI(e.target.value);
        import('./core/state.js').then(s => s.trackEvent('topicHopping'));
        buildReviewQueue();
        switchCardWithAnimation();
    });

    // Flashcard
    DOM.revealBtn?.addEventListener('click', (e) => {
        if (getState().isTransitioning) return;
        import('./core/state.js').then(s => s.trackEvent('cardFlipSpam'));
        flipCard();
    });
    DOM.nextCardBtn?.addEventListener('click', () => { 
        if (getState().isTransitioning) return;
        if (getState().isFlipped) switchCardWithAnimation(); 
    });
    DOM.ttsBtn?.addEventListener('click', () => {
        const { vocabulary, currentCardIndex } = getState();
        if (currentCardIndex >= 0) {
            import('./core/state.js').then(s => s.trackEvent('audioSpam'));
            speakText(vocabulary[currentCardIndex].english);
        }
    });
    DOM.starBtn?.addEventListener('click', toggleStar);
    DOM.undoBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        undoLastReview();
    });
    updateUndoButtonState();
    DOM.cardPronunciation?.addEventListener('click', () => {
        const { vocabulary, currentCardIndex } = getState();
        if (currentCardIndex >= 0) speakText(vocabulary[currentCardIndex].english);
    });
    DOM.editCurrentWordBtn?.addEventListener('click', editCurrentWord);
    DOM.deleteCurrentWordBtn?.addEventListener('click', deleteCurrentWord);
    DOM.srsFeedbackButtons?.addEventListener('click', (e) => {
        const btn = e.target.closest('.srs-btn');
        if (btn) {
            processSrsFeedback(parseInt(btn.dataset.rating, 10));
        }
    });
    
    // Typing Mode Events

    const generateHint = (word, level) => {
        if (!word) return '';
        if (word.length <= 2) return word;

        const tokens = word.split(/(\s+|-|')/);
        
        return tokens.map(token => {
            if (/^(\s+|-|')$/.test(token)) {
                return token === ' ' ? '  ' : token;
            }
            
            const len = token.length;
            if (len <= 1) return token;
            
            return token.split('').map((char, index) => {
                const isVowel = /[aeiouAEIOU]/.test(char);
                const isFirst = index === 0;
                const isLast = index === len - 1;

                if (level === 1) {
                    if (isFirst) return char;
                    if (len > 4 && isLast) return char;
                    return '_';
                } else {
                    if (isFirst || isLast || isVowel) return char;
                    return '_';
                }
            }).join(' ');
        }).join('');
    };

    let _isSubmittingTyping = false;
    const handleTypingSubmit = () => {
        if (_isSubmittingTyping || getState().isTransitioning) return;
        const { vocabulary, currentCardIndex } = getState();
        if (currentCardIndex < 0 || !vocabulary[currentCardIndex]) return;

        _isSubmittingTyping = true;
        setTimeout(() => { _isSubmittingTyping = false; }, 350);

        const currentCard = vocabulary[currentCardIndex];
        const targetStr = currentCard.english; 
        const inputStr = DOM.typingInput.value;

        const result = evaluateTyping(inputStr, targetStr);
        
        if (result.status === "too_short") {
            DOM.typingInput.classList.add('shake');
            setTimeout(() => DOM.typingInput.classList.remove('shake'), 400);
            DOM.typingFeedback.textContent = result.message;
            DOM.typingFeedback.className = 'typing-feedback text-warning';
            if (!DOM.typingInput.disabled) setTimeout(() => DOM.typingInput.focus(), 50);
            return;
        }
        
// Chỉ bỏ mask khi trả lời đúng hoặc hết lượt

        // Nếu đã chấm điểm sai trước đó (đang chờ gõ lại đúng)
        if (stashedCardIndex !== -1) {
            if (result.status === 'perfect' || result.status === 'perfect_fast') {
                const wasTypo = isTypoRetry;
                isTypoRetry = false;
                DOM.cardEnglish?.classList.remove('text-masked', 'hidden');
                DOM.cardEnglish?.classList.add('revealed');
                DOM.typingFeedback.textContent = "Tuyệt vời! Đang chuyển thẻ...";
                DOM.typingFeedback.className = 'typing-feedback text-success';
                DOM.typingInput.disabled = true;
                if (DOM.typingSubmitBtn) DOM.typingSubmitBtn.disabled = true;
                if (['all', 'tts'].includes(getState().soundMode)) speakText(currentCard.english);
                
                // SỬA LỖI KB 3.1: Nếu sửa thành công lỗi typo -> Chốt Rating 2 (Hard) đúng 1 lần duy nhất tại đây
                if (wasTypo) {
                    processSrsFeedback(2, false);
                }
                
                setTimeout(() => {
                    stashedCardIndex = -1;
                    stashedCardState = null;
                    typingRetryCount = 0;
                    switchCardWithAnimation();
                }, 800);
            } else if (isTypoRetry) {
                // Thử lại sau lỗi chính tả nhưng vẫn sai/lỗi chính tả -> Giảm điểm xuống Rating 1 (Sai hẳn)
                isTypoRetry = false;
                typingRetryCount = 1;
                processSrsFeedback(1, false);

                const hintStr = generateHint(currentCard.english, 1);
                DOM.typingFeedback.innerHTML = `Vẫn chưa chính xác! Đã tính điểm sai (Again). <br>Gợi ý: <strong>${escapeHTML(hintStr)}</strong> <br><small style="color:var(--text-color);opacity:0.8;">(Bạn còn 2 lần thử)</small>`;
                DOM.typingFeedback.className = 'typing-feedback text-danger';
                DOM.typingInput.classList.add('input-danger');
                DOM.typingInput.classList.add('shake');
                setTimeout(() => DOM.typingInput.classList.remove('shake'), 400);
                DOM.typingInput.value = '';
            } else {
                typingRetryCount++;
                DOM.typingInput.classList.add('shake');
                setTimeout(() => DOM.typingInput.classList.remove('shake'), 400);
                DOM.typingInput.value = ''; 
                
                if (typingRetryCount === 2) {
                    const hintStr = generateHint(currentCard.english, 2);
                    DOM.typingFeedback.innerHTML = `Vẫn sai! Gợi ý: <strong>${escapeHTML(hintStr)}</strong> <br><small style="color:var(--text-color);opacity:0.8;">(Bạn còn 1 lần thử)</small>`;
                    DOM.typingFeedback.className = 'typing-feedback text-danger';
                } else if (typingRetryCount === 3) {
                    DOM.cardEnglish?.classList.remove('text-masked', 'hidden');
                    DOM.cardEnglish?.classList.add('revealed');
                    DOM.typingFeedback.innerHTML = `Đáp án đúng là: <strong>${escapeHTML(currentCard.english)}</strong> <span class="phonetic">${escapeHTML(currentCard.pronunciation || '')}</span> <br><small style="color:var(--text-color);opacity:0.8;">(Hãy chép lại đáp án đúng để tiếp tục)</small>`;
                    DOM.typingFeedback.className = 'typing-feedback text-warning';
                } else {
                    // typingRetryCount > 3: Đã lộ đáp án nhưng gõ lại vẫn chưa đúng -> Bắt buộc chép lại đúng 100% mới cho chuyển thẻ
                    DOM.cardEnglish?.classList.remove('text-masked', 'hidden');
                    DOM.cardEnglish?.classList.add('revealed');
                    DOM.typingFeedback.innerHTML = `Vẫn chưa chính xác! Hãy chép lại đúng đáp án: <strong>${escapeHTML(currentCard.english)}</strong>`;
                    DOM.typingFeedback.className = 'typing-feedback text-danger';
                }
            }
            if (!DOM.typingInput.disabled) setTimeout(() => DOM.typingInput.focus(), 50);
            return;
        }

        // Chấm điểm lần đầu:
        if (result.status === "incorrect" || result.status === "typo") {
            stashedCardState = JSON.parse(JSON.stringify(currentCard));
            stashedCardIndex = currentCardIndex;
            typingRetryCount = 1;

            if (result.status === "typo") {
                isTypoRetry = true;
                DOM.typingFeedback.innerHTML = `Lỗi chính tả nhẹ! <strong>Gần đúng rồi.</strong> <br><small style="color:var(--text-color);opacity:0.8;">(Hãy sửa lại cho chính xác để giữ điểm Khó)</small>`;
                DOM.typingFeedback.className = 'typing-feedback text-warning';
                DOM.typingInput.classList.add('shake');
                setTimeout(() => DOM.typingInput.classList.remove('shake'), 400);
                // SỬA LỖI KB 3.1: Không gọi processSrsFeedback ngay tại đây để tránh double-log khi người dùng gõ lại
            } else {
                isTypoRetry = false;
                const hintStr = generateHint(currentCard.english, 1);
                DOM.typingFeedback.innerHTML = `Sai rồi! Gợi ý: <strong>${escapeHTML(hintStr)}</strong> <br><small style="color:var(--text-color);opacity:0.8;">(Bạn còn 2 lần thử)</small>`;
                DOM.typingFeedback.className = 'typing-feedback text-danger';
                DOM.typingInput.classList.add('input-danger');
                DOM.typingInput.value = ''; // Xóa sạch để gõ lại

                // Ghi nhận điểm sai (Rating 1) duy nhất 1 lần
                processSrsFeedback(1, false);
            }
        } else {
            DOM.cardEnglish?.classList.remove('text-masked', 'hidden');
            DOM.cardEnglish?.classList.add('revealed');
            DOM.typingFeedback.textContent = "Chính xác! Đang chuyển thẻ...";
            DOM.typingFeedback.className = 'typing-feedback text-success';
            
            DOM.typingInput.disabled = true;
            if (DOM.typingSubmitBtn) DOM.typingSubmitBtn.disabled = true;
            if (['all', 'tts'].includes(getState().soundMode)) speakText(currentCard.english);
            
            processSrsFeedback(result.rating, false); 
            
            setTimeout(() => {
                switchCardWithAnimation();
            }, 800);
        }

        // Đảm bảo focus trở lại ô nhập liệu nếu chưa kết thúc phiên gõ (chưa bị disable)
        if (!DOM.typingInput.disabled) {
            setTimeout(() => DOM.typingInput.focus(), 50);
        }
    };

    DOM.typingSubmitBtn?.addEventListener('click', handleTypingSubmit);
    DOM.typingInput?.addEventListener('keydown', (e) => {
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter') {
            if (DOM.typingInput.value.trim().toLowerCase() === '/boost') {
                e.preventDefault();
                DOM.typingInput.value = '';
                applyBoostMode(!getState().isBoostMode, true);
                return;
            }
            handleTypingSubmit();
        }
    });
    DOM.typingInput?.addEventListener('input', (e) => {
        recordFirstKeystroke(e);
    });

    DOM.nextCardBtn?.addEventListener('click', () => { 
        if (getState().isFlipped) {
            if (DOM.typingInput) {
                DOM.typingInput.disabled = false;
                DOM.typingInput.classList.remove('input-danger');
                DOM.typingSubmitBtn.disabled = false;
            }
            switchCardWithAnimation(); 
        }
    });

    // Modals
    DOM.addEditForm?.addEventListener('submit', handleAddEditSubmit);
    DOM.closeAddEditModalBtn?.addEventListener('click', () => closeModal(DOM.addEditModal));
    DOM.addEditOverlay?.addEventListener('click', () => closeModal(DOM.addEditModal));
    DOM.cancelEditBtn?.addEventListener('click', cancelEdit);
    DOM.closeManageModalBtn?.addEventListener('click', () => closeModal(DOM.manageModal));
    DOM.manageOverlay?.addEventListener('click', () => closeModal(DOM.manageModal));
    DOM.manageModal?.addEventListener('click', (e) => {
        if (e.target === DOM.manageModal || e.target.classList.contains('modal-overlay')) {
            closeModal(DOM.manageModal);
        }
    });

    // Central Hub Panel Navigation Tabs (4 tabs unified)
    document.getElementById('tab-vocab-list')?.addEventListener('click', () => switchHubTab('words'));
    document.getElementById('tab-data-io')?.addEventListener('click', () => switchHubTab('io'));
    document.getElementById('tab-profile-overview')?.addEventListener('click', () => switchHubTab('overview'));
    document.getElementById('tab-profile-badges')?.addEventListener('click', () => switchHubTab('badges'));

    // Keyboard Arrow Navigation for Manage Nav Tabs (W3C ARIA tablist pattern)
    document.querySelector('.manage-nav-tabs')?.addEventListener('keydown', (e) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
        const tabsList = Array.from(document.querySelectorAll('.manage-nav-tabs .manage-nav-tab'));
        const currentIdx = tabsList.findIndex(tab => tab === document.activeElement);
        if (currentIdx === -1) return;

        let targetIdx = -1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            targetIdx = (currentIdx + 1) % tabsList.length;
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            targetIdx = (currentIdx - 1 + tabsList.length) % tabsList.length;
        } else if (e.key === 'Home') {
            targetIdx = 0;
        } else if (e.key === 'End') {
            targetIdx = tabsList.length - 1;
        }

        if (targetIdx !== -1) {
            e.preventDefault();
            const targetTab = tabsList[targetIdx];
            const tabId = targetTab.getAttribute('data-tab');
            targetTab.focus();
            switchHubTab(tabId);
        }
    });

    if (DOM.closeProfileModalBtn && DOM.closeProfileModalBtn !== DOM.closeManageModalBtn) {
        DOM.closeProfileModalBtn.addEventListener('click', () => closeModal(DOM.profileModal || DOM.manageModal));
    }
    if (DOM.profileOverlay && DOM.profileOverlay !== DOM.manageOverlay) {
        DOM.profileOverlay.addEventListener('click', () => closeModal(DOM.profileModal || DOM.manageModal));
    }
    DOM.scanDuplicatesBtn?.addEventListener('click', () => {
        closeModal(DOM.manageModal);
        openDedupModal();
    });
    DOM.closeDedupModalBtn?.addEventListener('click', () => closeModal(DOM.dedupModal));
    DOM.dedupOverlay?.addEventListener('click', () => closeModal(DOM.dedupModal));
    DOM.mergeAllDupsBtn?.addEventListener('click', () => executeMergeAll());

    // Manage Panel (New and updated listeners)
    setupIOEventListeners(); // Handles Import, Export, Clear All
    let searchTimeout;
    DOM.manageSearchInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.value.trim().toLowerCase() === '/boost') {
            e.preventDefault();
            e.target.value = '';
            applyBoostMode(!getState().isBoostMode, true);
        }
    });
    DOM.manageSearchInput?.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => { updatePanelWordList(e); }, 300);
    });
    DOM.panelTopicFilter?.addEventListener('change', (e) => {
        import('./core/state.js').then(s => s.trackEvent('filterToggles'));
        updatePanelWordList(e);
    });
    document.getElementById('panel-status-filter')?.addEventListener('change', updatePanelWordList);
    DOM.manageRefreshListBtn?.addEventListener('click', updatePanelWordList);
    document.getElementById('bulk-delete-btn')?.addEventListener('click', handleBulkDelete);
    DOM.wordListDisplay?.addEventListener('change', handleWordCardCheckboxChange);

    // Global Keyboard
    document.addEventListener('keydown', handleGlobalShortcuts);
	DOM.manualSyncBtn?.addEventListener('click', (e) => {
        trackEvent('syncSpamCount');
        const forceFull = Boolean(e?.altKey || e?.shiftKey);
        runCloudSync({ forceFullPull: forceFull, isManual: true });
    });

    setupCloudVaultControls();
}

/**
 * Điều khiển "Mã đồng bộ" trong tab Nhập & Xuất: xem/sao chép mã, liên kết
 * thiết bị khác và tải toàn bộ audio ngoại tuyến (chủ động, không tự chạy).
 */
function setupCloudVaultControls() {
    const keyInput = document.getElementById('sync-key-input');
    const copyBtn = document.getElementById('copy-sync-key-btn');
    const applyInput = document.getElementById('sync-key-apply-input');
    const applyBtn = document.getElementById('apply-sync-key-btn');
    const audioBtn = document.getElementById('download-all-audio-btn');
    const statusEl = document.getElementById('sync-key-status');

    if (!keyInput && !applyBtn && !audioBtn) return;

    const setStatus = (text) => { if (statusEl) statusEl.textContent = text; };

    const refreshKey = () => {
        import('./core/firebase.js').then(module => {
            const key = module.getSyncKey?.() || '';
            if (keyInput && key) keyInput.value = module.formatSyncKey ? module.formatSyncKey(key) : key;
            if (!statusEl?.textContent) setStatus(key ? 'Không gian đồng bộ cá nhân đã sẵn sàng.' : '');
        }).catch(() => setStatus('Cloud chưa sẵn sàng (đang offline).'));
    };

    document.getElementById('tab-data-io')?.addEventListener('click', refreshKey);
    keyInput?.addEventListener('focus', refreshKey);

    copyBtn?.addEventListener('click', async () => {
        const value = (keyInput?.value || '').trim();
        if (!value) { setStatus('Chưa có mã đồng bộ để sao chép.'); return; }
        try {
            await navigator.clipboard.writeText(value.replace(/-/g, ''));
            setStatus('Đã sao chép mã. Dán sang thiết bị khác để liên kết.');
        } catch (_) {
            keyInput?.select();
            setStatus('Hãy nhấn Ctrl+C để sao chép mã đang chọn.');
        }
    });

    applyBtn?.addEventListener('click', () => {
        const raw = (applyInput?.value || '').trim();
        if (!raw) { setStatus('Hãy nhập mã đồng bộ từ thiết bị khác.'); return; }
        showConfirmation('Liên kết thiết bị này với không gian đồng bộ khác? Kho từ vựng trên máy vẫn được giữ và sẽ gộp vào không gian mới.', async () => {
            setStatus('Đang liên kết...');
            try {
                const module = await import('./core/firebase.js');
                await module.applySyncKey(raw);
                setStatus('Đã liên kết. Đang đồng bộ dữ liệu...');
                await module.smartSync({ forceFullPull: true, isManual: true });
                refreshKey();
                setStatus('Đã liên kết và đồng bộ xong.');
                showToast('Liên kết thành công', 'Thiết bị đã dùng chung không gian đồng bộ mới.', 'ph-cloud-check');
            } catch (error) {
                setStatus(error?.message || 'Không liên kết được.');
                showToast('Liên kết thất bại', error?.message || 'Kiểm tra mã và kết nối mạng.', 'ph-warning-circle');
            }
        });
    });

    audioBtn?.addEventListener('click', async () => {
        audioBtn.disabled = true;
        setStatus('Đang tải audio... có thể mất vài phút tuỳ số từ.');
        try {
            const sound = await import('./core/sound.js');
            await sound.startBackgroundAudioPreload(getState().vocabulary, { reason: 'manual' });
            setStatus('Đã tải xong audio ngoại tuyến.');
        } catch (error) {
            setStatus(error?.message || 'Tải audio thất bại.');
        } finally {
            audioBtn.disabled = false;
        }
    });
}

function toggleStar() {
    const isStarred = toggleStarOnCurrentCard();
    const starIcon = DOM.starBtn?.querySelector('i');
    if (starIcon) {
        starIcon.className = isStarred ? 'ph-fill ph-star' : 'ph-duotone ph-star';
        DOM.starBtn.classList.toggle('starred', isStarred);
    }
    playSound(isStarred ? 'starOn' : 'starOff');
}

function editCurrentWord() {
    const { vocabulary, currentCardIndex } = getState();
    if (currentCardIndex < 0) return;
    openAddEditModal(true, vocabulary[currentCardIndex]);
}

function deleteCurrentWord() {
    import('./core/state.js').then(s => s.trackEvent('consecutiveDeletes'));
    const { vocabulary, currentCardIndex } = getState();
    if (currentCardIndex < 0) return;
    const cardToDelete = vocabulary[currentCardIndex];
    showConfirmation(`Bạn có chắc chắn muốn xóa từ "${cardToDelete.english}" không?`, () => {
        const currentVocab = getState().vocabulary;
        const indexToDelete = currentVocab.findIndex(v => v.id === cardToDelete.id);
        if (indexToDelete > -1) {
			currentVocab[indexToDelete].isDeleted = true;
            currentVocab[indexToDelete].updatedAt = Date.now();
            setVocabulary(currentVocab);
            saveOneWord(currentVocab[indexToDelete]);
            playSound('delete');
            showPopup(`Đã xóa từ "${cardToDelete.english}".`);
            let tagsNeedRepopulate = checkAndCleanupTags();
            populateTopicFilters(tagsNeedRepopulate);
            buildReviewQueue();
            updatePanelWordList();
            switchCardWithAnimation();
        }
    });
}

async function handleBulkDelete() {
    const checkedBoxes = DOM.wordListDisplay.querySelectorAll('.word-card-checkbox:checked');
    if (checkedBoxes.length === 0) {
        showPopup("Vui lòng chọn ít nhất một từ để xóa.", "info");
        return;
    }
    const count = checkedBoxes.length;
    showConfirmation(`Bạn có chắc muốn xóa ${count} từ đã chọn không?`, async () => {
        const { vocabulary } = getState();
        const idsToDelete = new Set(Array.from(checkedBoxes).map(box => box.dataset.id));
        const now = Date.now();

        // Soft-delete: đánh dấu isDeleted thay vì filter ra
        const updated = vocabulary.map(word =>
            idsToDelete.has(word.id) ? { ...word, isDeleted: true, updatedAt: now } : word
        );
        setVocabulary(updated);
        saveVocabulary(true); // skipSync — tự batch write bên dưới

        for (const card of updated) {
            if (idsToDelete.has(card.id)) await saveOneWord(card);
        }

        buildReviewQueue();
        updatePanelWordList();
        switchCardWithAnimation();
        showPopup(`Đã xóa ${count} từ.`, 'success');
        playSound('delete');
        document.getElementById('bulk-delete-btn').classList.add('hidden');
    });
}

function handleWordCardCheckboxChange(event) {
    if (!event.target.classList.contains('word-card-checkbox')) return;
    const checkedBoxes = DOM.wordListDisplay.querySelectorAll('.word-card-checkbox:checked');
    const bulkDeleteBtn = document.getElementById('bulk-delete-btn');
    if (checkedBoxes.length > 0) {
        bulkDeleteBtn.classList.remove('hidden');
    } else {
        bulkDeleteBtn.classList.add('hidden');
    }
}

let globalKeystrokeBuffer = '';
let globalKeystrokeTimer = null;

function handleGlobalShortcuts(e) {
    const active = document.activeElement;
    const isTyping = active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA';
    const isModalOpen = !!document.querySelector('.modal:not(.hidden)');
    if (e.key === 'Escape' && isModalOpen) {
        // Tìm modal đang mở và đóng nó
        const openModalElement = document.querySelector('.modal:not(.hidden)');
        if (openModalElement) {
            closeModal(openModalElement);
        }
        return;
    }
    // Phím tắt Hoàn tác (Undo): Ctrl + Z hoặc Ctrl + Shift + Z (Cmd + Z / Cmd + Shift + Z)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (!isTyping) {
            e.preventDefault();
            undoLastReview();
            return;
        }
    }

    if (isModalOpen || isTyping) return;
    if (getState().isTransitioning) return;

    if (globalKeystrokeTimer) clearTimeout(globalKeystrokeTimer);
    globalKeystrokeBuffer = (globalKeystrokeBuffer + e.key).slice(-10).toLowerCase();
    globalKeystrokeTimer = setTimeout(() => { globalKeystrokeBuffer = ''; }, 2000);

    if (globalKeystrokeBuffer.endsWith('/boost') || globalKeystrokeBuffer.endsWith('boost')) {
        e.preventDefault();
        globalKeystrokeBuffer = '';
        applyBoostMode(!getState().isBoostMode, true);
        return;
    }
    
    // Accessibility Guard: If an interactive button, link, or dropdown is currently focused,
    // allow native Space and Enter keys to activate it (e.g. clicking focused TTS button,
    // Star button, SRS rating button, or modal controls).
    const isInteractive = active && (
        active.tagName === 'BUTTON' || 
        active.tagName === 'A' || 
        active.tagName === 'SELECT' || 
        active.getAttribute('role') === 'button'
    );
    if (isInteractive && (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter')) {
        return;
    }

    // Track global shortcuts use
    trackEvent('consecutiveShortcuts');
    
    const { isFlipped } = getState();
    if (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        if (isFlipped) {
            // When flipped, Space grades as Good (3) or advances to Next Card (standard Anki / SRS flow)
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
    switch (e.key.toUpperCase()) {
        case 'B': e.preventDefault(); DOM.toggleBoostModeBtn?.click(); break;
        case 'F': e.preventDefault(); flipCard(); break;
        case 'P': e.preventDefault(); DOM.ttsBtn?.click(); break;
        case 'S': e.preventDefault(); DOM.starBtn?.click(); break;
        case 'N': case 'ENTER':
            if (isFlipped) {
                e.preventDefault();
                if (DOM.nextCardBtn && !DOM.nextCardBtn.classList.contains('hidden')) {
                    DOM.nextCardBtn.click();
                } else {
                    const btn3 = DOM.srsFeedbackButtons?.querySelector('.srs-btn[data-rating="3"]');
                    if (btn3) btn3.click();
                }
            }
            break;
        case '1': case '2': case '3': case '4':
            if (isFlipped) {
                const mappedRating = parseInt(e.key);
                const btn = DOM.srsFeedbackButtons?.querySelector(`.srs-btn[data-rating="${mappedRating}"]`);
                if (btn) { e.preventDefault(); btn.click(); }
            }
            break;
    } 
}
