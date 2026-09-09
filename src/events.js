// src/events.js

import { DOM } from './ui/elements.js';
import { getState, setCurrentTopicFilter, toggleStarOnCurrentCard, saveVocabulary, saveOneWord, setVocabulary, incrementNewCardsDone, incrementDueCardsDone, incrementLearningCardsDone, recordReviewResult, addXP, logActivity, getComboMultiplier, trackEvent, setIsTypingMode, setIsTransitioning, getLastReviewSnapshot, setLastReviewSnapshot, clearLastReviewSnapshot, popLastReviewLog, revertGamificationAfterUndo, setCurrentCardIndex, setReviewQueue } from './core/state.js';
import { calculateNextSrsState } from './core/srs/index.js';
import { evaluateTyping, handleVisibilityChange, handleBlur, handleFocus } from './features/typing.js';
import { getNextCardToReview, buildReviewQueue, insertCardForLearningStep, triggerSmartCramming } from './core/queue.js';
import { displayCard, flipCard, applyDarkMode, applySoundSetting, populateTopicFilters, updatePanelWordList, checkAndCleanupTags } from './ui/render.js';
import { openModal, closeModal, openAddEditModal, showConfirmation, showPopup, showToast, handleAddEditSubmit, cancelEdit, openManageModal, openDedupModal, executeMergeAll } from './ui/modal.js';
import { openProfileModal } from './features/gamification.js';
import { setupIOEventListeners } from './features/io.js';
import { playSound, speakText, preloadAudio  } from './core/sound.js';
import { animateCardOut, animateCardIn } from './core/animations.js';
import { smartSync } from './core/firebase.js';

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

export function updateUndoButtonState() {
    const snapshot = getLastReviewSnapshot();
    const undoBtn = DOM.undoBtn || document.getElementById('undo-btn');
    if (undoBtn) {
        undoBtn.disabled = !snapshot;
        undoBtn.classList.toggle('disabled', !snapshot);
        undoBtn.title = snapshot 
            ? `Hoàn tác đánh giá từ "${snapshot.previousCard?.english || ''}" (Ctrl+Shift+Z)` 
            : 'Chưa có lượt đánh giá nào để hoàn tác';
    }
}

export async function undoLastReview() {
    if (getState().isTransitioning) return;
    const snapshot = getLastReviewSnapshot();
    if (!snapshot) {
        showToast('Hoàn tác', 'Chưa có lượt đánh giá nào để hoàn tác.', 'ph-info');
        return;
    }

    setIsTransitioning(true);
    try {
        const { vocabulary, currentReviewQueue, currentCardIndex } = getState();
        const targetIndex = snapshot.cardIndex;
        
        // 1. Khôi phục thẻ cũ vào vocabulary & IndexedDB
        if (targetIndex >= 0 && targetIndex < vocabulary.length && snapshot.previousCard) {
            vocabulary[targetIndex] = snapshot.previousCard;
            await saveOneWord(snapshot.previousCard);
        }
        
        // 2. Rút log ra khỏi reviewLogs để Optimizer không bị sai lệch
        await popLastReviewLog();
        
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
    const { vocabulary, currentCardIndex } = getState();
    if (currentCardIndex < 0 || !vocabulary[currentCardIndex]) return;

    const currentCard = vocabulary[currentCardIndex];
    const previousCard = JSON.parse(JSON.stringify(currentCard));
    const comboBefore = getState().gamification?.consecutiveCorrect || 0;
    const isNewCard = currentCard.srsStatus === 'New' && (!currentCard.learningStep || currentCard.learningStep === 0);
    
    const modality = getState().isTypingMode ? 'typing' : 'en-vi';
    const { newState: updatedCard, log } = calculateNextSrsState(currentCard, rating, modality, 0, getState().userFsrs7Params);
    if (log) {
        import('./core/state.js').then(s => s.addReviewLog(log));
    }

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

    if (updatedCard.isSuspended) {
        showPopup(`Từ "${updatedCard.english}" bị quên quá nhiều lần và đã được tạm ngưng. Bạn có thể kích hoạt lại trong phần Quản lý.`, 'info');
    }

    const wasLearningInserted = (updatedCard.srsDueDate <= Date.now() + 10000);
    // Nâng cấp: Chèn lại thẻ nếu đang trong giai đoạn ươm mầm (Learning steps)
    // Nếu nextDueDate <= Date.now() + 10s (được hẹn ngay lập tức)
    if (wasLearningInserted) {
        insertCardForLearningStep(currentCardIndex);
    }

    // Lưu Snapshot để hỗ trợ tính năng Hoàn Tác (Undo)
    setLastReviewSnapshot({
        cardId: currentCard.id,
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

export function setupEventListeners() {
	
    // Xử lý bật/tắt Taskbar Menu trên Mobile
    DOM.toggleTaskbarBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        DOM.taskbarMenu?.classList.toggle('show');
        
        import('./core/state.js').then(s => s.trackEvent('taskbarToggles'));

        // Đổi icon 3 gạch thành dấu X khi mở
        const icon = DOM.toggleTaskbarBtn.querySelector('i');
        if (DOM.taskbarMenu?.classList.contains('show')) {
            icon.className = 'ph-duotone ph-x';
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

    // Typing Mode Window Listeners for Timer Pause/Resume
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    
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

    DOM.toggleTypingModeBtn?.addEventListener('click', () => {
        closeMenu();
        const currentMode = getState().isTypingMode;
        const nextMode = !currentMode;
        
        // Track immediate exit if leaving typing mode without doing a card
        if (!nextMode && getState().isFlipped && stashedCardIndex === -1) {
            trackEvent('typingImmediateExit');
        }
        
        setIsTypingMode(nextMode);
        DOM.typingModeLabel.textContent = nextMode ? 'Gõ từ' : 'Lật thẻ';
        DOM.typingModeIcon.className = `ph ${nextMode ? 'ph-keyboard' : 'ph-cards'}`;
        
        // Reset typing state khi chuyển mode để tránh bug giữa chừng
        stashedCardIndex = -1;
        stashedCardState = null;
        typingRetryCount = 0;
        isTypoRetry = false;
        
        // Skip current card if switching TO typing mode to prevent spoiling
        if (nextMode) {
            switchCardWithAnimation();
        } else {
            const index = getState().currentCardIndex;
            if (index >= 0) displayCard(index);
        }
    });

    let isTransitioning = false;
    DOM.toggleDarkModeBtn?.addEventListener('click', () => { 
        if (isTransitioning) return;
        isTransitioning = true;
        closeMenu(); 

        const currentIsDark = getState().isDarkMode;
        const targetModeIsDark = !currentIsDark;
        
        const container = document.getElementById('shipper-curtain-container');
        const leftRem = document.getElementById('curtain-left');
        const rightRem = document.getElementById('curtain-right');
        const centerBadge = document.getElementById('curtain-badge');
        const badgeIcon = document.getElementById('badge-icon');
        const badgeText = document.getElementById('badge-text');

        if (targetModeIsDark) {
            leftRem.className = "curtain-left curtain-dark-left";
            rightRem.className = "curtain-right curtain-dark-right";
            centerBadge.className = "curtain-badge curtain-badge-dark";
            badgeIcon.className = "badge-icon badge-icon-dark";
            badgeIcon.innerHTML = '<i class="ph-fill ph-moon"></i>';
            badgeText.className = "badge-text badge-text-dark";
        } else {
            leftRem.className = "curtain-left curtain-light-left";
            rightRem.className = "curtain-right curtain-light-right";
            centerBadge.className = "curtain-badge curtain-badge-light";
            badgeIcon.className = "badge-icon badge-icon-light";
            badgeIcon.innerHTML = '<i class="ph-fill ph-sun"></i>';
            badgeText.className = "badge-text badge-text-light";
        }

        container.classList.remove('hidden');

        leftRem.classList.add('curtain-left-closing');
        rightRem.classList.add('curtain-right-closing');
        centerBadge.classList.add('badge-in');

        setTimeout(() => {
            applyDarkMode(targetModeIsDark);
            import('./core/state.js').then(s => {
                if (targetModeIsDark) {
                    const hour = new Date().getHours();
                    if (hour === 0 && new Date().getMinutes() === 0) s.trackEvent('stargazer');
                    if (s.getState().soundMode === 'off') s.trackEvent('eclipse');
                }
            });

            leftRem.classList.replace('curtain-left-closing', 'curtain-left-opening');
            rightRem.classList.replace('curtain-right-closing', 'curtain-right-opening');
            centerBadge.classList.replace('badge-in', 'badge-out');

            setTimeout(() => {
                container.classList.add('hidden');
                leftRem.classList.remove('curtain-left-opening');
                rightRem.classList.remove('curtain-right-opening');
                centerBadge.classList.remove('badge-out');
                
                leftRem.style.transform = '';
                rightRem.style.transform = '';
                centerBadge.style.opacity = '';
                isTransitioning = false;
            }, 500);
        }, 500);
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
    });
    DOM.addWordBtnOpen?.addEventListener('click', () => { closeMenu(); openAddEditModal(); });
    DOM.manageWordsBtnOpen?.addEventListener('click', () => { closeMenu(); openManageModal(); });
    document.getElementById('manage-add-word-btn')?.addEventListener('click', () => { closeModal(DOM.manageModal); openAddEditModal(); });
    DOM.profileBtn?.addEventListener('click', () => { closeMenu(); openProfileModal(); });
    DOM.startQuizBtn?.addEventListener('click', () => { closeMenu(); loadAndShowQuiz(); });
    DOM.mainTopicFilter?.addEventListener('change', (e) => {
        setCurrentTopicFilter(e.target.value);
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

    const handleTypingSubmit = () => {
        const { vocabulary, currentCardIndex } = getState();
        if (currentCardIndex < 0 || !vocabulary[currentCardIndex]) return;

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
                isTypoRetry = false;
                DOM.cardEnglish?.classList.remove('text-masked', 'hidden');
                DOM.cardEnglish?.classList.add('revealed');
                DOM.typingFeedback.textContent = "Tuyệt vời! Đang chuyển thẻ...";
                DOM.typingFeedback.className = 'typing-feedback text-success';
                DOM.typingInput.disabled = true;
                if (DOM.typingSubmitBtn) DOM.typingSubmitBtn.disabled = true;
                if (['all', 'tts'].includes(getState().soundMode)) speakText(currentCard.english);
                
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
                DOM.typingFeedback.innerHTML = `Vẫn chưa chính xác! Đã tính điểm sai (Again). <br>Gợi ý: <strong>${hintStr}</strong> <br><small style="color:var(--text-color);opacity:0.8;">(Bạn còn 2 lần thử)</small>`;
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
                    DOM.typingFeedback.innerHTML = `Vẫn sai! Gợi ý: <strong>${hintStr}</strong> <br><small style="color:var(--text-color);opacity:0.8;">(Bạn còn 1 lần thử)</small>`;
                    DOM.typingFeedback.className = 'typing-feedback text-danger';
                } else if (typingRetryCount === 3) {
                    DOM.cardEnglish?.classList.remove('text-masked', 'hidden');
                    DOM.cardEnglish?.classList.add('revealed');
                    DOM.typingFeedback.innerHTML = `Đáp án đúng là: <strong>${currentCard.english}</strong> <span class="phonetic">${currentCard.pronunciation || ''}</span> <br><small style="color:var(--text-color);opacity:0.8;">(Hãy chép lại đáp án đúng để tiếp tục)</small>`;
                    DOM.typingFeedback.className = 'typing-feedback text-warning';
                } else {
                    // typingRetryCount > 3: Đã lộ đáp án nhưng gõ lại vẫn chưa đúng -> Bắt buộc chép lại đúng 100% mới cho chuyển thẻ
                    DOM.cardEnglish?.classList.remove('text-masked', 'hidden');
                    DOM.cardEnglish?.classList.add('revealed');
                    DOM.typingFeedback.innerHTML = `Vẫn chưa chính xác! Hãy chép lại đúng đáp án: <strong>${currentCard.english}</strong>`;
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
            } else {
                isTypoRetry = false;
                const hintStr = generateHint(currentCard.english, 1);
                DOM.typingFeedback.innerHTML = `Sai rồi! Gợi ý: <strong>${hintStr}</strong> <br><small style="color:var(--text-color);opacity:0.8;">(Bạn còn 2 lần thử)</small>`;
                DOM.typingFeedback.className = 'typing-feedback text-danger';
                DOM.typingInput.classList.add('input-danger');
                DOM.typingInput.value = ''; // Xóa sạch để gõ lại
            }

            // Ghi nhận điểm (Rating 1 hoặc 2 tùy typo hay sai hẳn)
            processSrsFeedback(result.rating, false);
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
        if (e.key === 'Enter') handleTypingSubmit();
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
    DOM.closeProfileModalBtn?.addEventListener('click', () => closeModal(DOM.profileModal));
    DOM.profileOverlay?.addEventListener('click', () => closeModal(DOM.profileModal));
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
	DOM.manualSyncBtn?.addEventListener('click', () => {
        import('./core/state.js').then(s => s.trackEvent('syncSpamCount'));
        smartSync();
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

        // Batch write lên Firebase ngay lập tức
        try {
            const { db } = await import('./core/firebase.js');
            const { writeBatch, doc } = await import('https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js');
            const LIMIT = 500;
            const ids = Array.from(idsToDelete);
            for (let i = 0; i < ids.length; i += LIMIT) {
                const batch = writeBatch(db);
                ids.slice(i, i + LIMIT).forEach(id => {
                    batch.set(doc(db, 'celestial_vocab_sync', id), { isDeleted: true, updatedAt: now }, { merge: true });
                });
                await batch.commit();
            }
        } catch (e) {
            console.warn('Bulk delete Firebase offline, sẽ sync sau:', e.message);
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
    // Phím tắt Hoàn tác (Undo): Ctrl + Shift + Z (hoặc Cmd + Shift + Z)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') {
        if (!isTyping) {
            e.preventDefault();
            undoLastReview();
            return;
        }
    }

    if (isModalOpen || isTyping) return;
    if (getState().isTransitioning) return;
    
    // Track global shortcuts use
    import('./core/state.js').then(s => s.trackEvent('consecutiveShortcuts'));
    
    const { isFlipped } = getState();
    switch (e.key.toUpperCase()) {
        case 'F': e.preventDefault(); flipCard(); break;
        case 'P': e.preventDefault(); DOM.ttsBtn?.click(); break;
        case 'S': e.preventDefault(); DOM.starBtn?.click(); break;
        case 'N': case 'ENTER':
            if (isFlipped) { e.preventDefault(); DOM.nextCardBtn?.click(); }
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