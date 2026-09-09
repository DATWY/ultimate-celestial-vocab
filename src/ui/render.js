import { DOM } from './elements.js';
import { getState, setCurrentCardIndex, setIsFlipped, setSoundMode, setIsDarkMode, setVocabulary, saveVocabulary, setAllTags, setIsTransitioning } from '../core/state.js';
import { playSound, preloadAudio } from '../core/sound.js';
import { buildReviewQueue, getNextCardToReview, getSmartCramCards, getPendingLearningCards } from '../core/queue.js';
import { openAddEditModal, showConfirmation, showPopup, closeModal } from './modal.js';
import { animateFlip, animateNumber } from '../core/animations.js';
import { isFuzzySearchMatch } from '../core/dedup.js';

export function launchVictoryConfetti() {
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

export function displayCard(index) {
    const { vocabulary } = getState();
    const cardData = vocabulary[index];

    // Trường hợp không có thẻ để hiển thị: Màn hình Vinh Quang (Grand Celestial Victory Stage)
    if (!cardData) {
        DOM.flashcardArea?.classList.add('hidden');
        DOM.controlsArea?.classList.add('hidden');
        DOM.noCardMessage?.classList.remove('hidden');
        
        // Reset trạng thái nghỉ ngơi khi mở lại
        if (DOM.finalDayRestState) DOM.finalDayRestState.classList.add('hidden');

        if (vocabulary.length === 0) {
            if (DOM.victoryHeadline) DOM.victoryHeadline.textContent = "KHO TỪ VỰNG TRỐNG";
            if (DOM.victoryTagline) DOM.victoryTagline.textContent = "Chưa có từ vựng nào trong kho học của bạn.";
            if (DOM.noCardText) DOM.noCardText.textContent = "Hãy thêm từ mới hoặc tải file TSV vào hệ thống để bắt đầu hành trình chinh phục!";
            DOM.smartCrammingActions?.classList.add('hidden');
        } else {
            const state = getState();
            const filterLowerCase = (state.currentTopicFilter || 'all').trim().toLowerCase();
            const pendingLearning = getPendingLearningCards(vocabulary, filterLowerCase);
            const cramCards = getSmartCramCards(vocabulary, filterLowerCase);
            const masteredCount = vocabulary.filter(w => !w.isDeleted && w.srsStatus === 'Mastered').length;
            const streakCount = state.streak || 0;

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
                if (DOM.victoryTagline) DOM.victoryTagline.textContent = "Toàn bộ kho từ vựng hôm nay và ngày mai đều đã hoàn thành 100%!";
                if (DOM.noCardText) DOM.noCardText.textContent = "Không còn thẻ nào cần ôn tập trước hạn. Hãy tận hưởng một ngày nghỉ ngơi thư giãn trọn vẹn!";
                DOM.smartCrammingActions?.classList.add('hidden');
                if (DOM.finalDayRestState) DOM.finalDayRestState.classList.remove('hidden');
            }

            // Kích hoạt âm thanh hoàn thành vinh quang và pháo hoa rực rỡ
            playSound('complete');
            setTimeout(launchVictoryConfetti, 120);
        }
        
        setCurrentCardIndex(-1);
        updateStats();
        return;
    }
    
    // ----- NÂNG CẤP HIỆU SUẤT -----
    // Ngay sau khi xác định có thẻ, bắt đầu tìm nạp trước âm thanh trong nền.
    // Việc này diễn ra trong khi phần còn lại của hàm đang cập nhật giao diện.
    if (cardData.english) {
        preloadAudio(cardData.english);
    }
    // -----------------------------

    // Thiết lập trạng thái và giao diện cho thẻ mới
    setCurrentCardIndex(index);
    setIsFlipped(false);

    // Reset animation và class của flashcard
    if (DOM.flashcard) {
        anime.set(DOM.flashcard, { rotateY: 0, translateX: 0, translateY: 0, opacity: 1 });
        DOM.flashcard.classList.remove('is-flipped');
    }
    
    const isTypingMode = getState().isTypingMode;

    // Chỉ nhận diện từ CỰC KHÓ (Extremely Hard / Leech):
    // 1. Độ khó FusionSRS cực cao (Difficulty >= 8.5)
    // 2. HOẶC đã từng bị quên từ 3 lần trở lên (lapses >= 3)
    // 3. HOẶC thẻ từng bị tạm ngưng (isSuspended)
    const isHardWord = (cardData.difficulty !== undefined && cardData.difficulty >= 8.5) || 
                       (cardData.lapses !== undefined && cardData.lapses >= 3) || 
                       !!cardData.isSuspended;

    // Cập nhật nội dung thẻ (DOM updates)
    DOM.noCardMessage?.classList.add('hidden');
    DOM.cardEnglish.textContent = cardData.english;
    
    // Hard badge & card glow (Chỉ hiện cho từ Cực Khó)
    DOM.flashcard?.classList.toggle('is-hard-card', isHardWord);
    DOM.cardHardBadge?.classList.toggle('hidden', !isHardWord || isTypingMode);

    const starIcon = DOM.starBtn?.querySelector('i');
    if (starIcon) starIcon.className = cardData.isStarred ? 'ph-fill ph-star' : 'ph ph-star';
    DOM.starBtn?.classList.toggle('starred', !!cardData.isStarred); // Sử dụng !! để đảm bảo giá trị là boolean
    DOM.cardVietnamese.textContent = cardData.vietnamese || 'N/A';
    DOM.cardType.textContent = cardData.type || 'N/A';
    DOM.cardPronunciation.textContent = cardData.pronunciation || 'N/A';

    // Highlight từ vựng trong câu ví dụ & kích hoạt hiệu ứng Deep Focus
    const hasExample = !!cardData.example && cardData.example !== 'N/A';
    if (hasExample) {
        DOM.cardExample.innerHTML = highlightKeywordInExample(cardData.example, cardData.english);
    } else {
        DOM.cardExample.textContent = 'N/A';
    }
    DOM.cardExampleRow?.classList.toggle('is-hard-focus', isHardWord && hasExample);
    DOM.exampleFocusTag?.classList.toggle('hidden', !isHardWord || !hasExample);

    DOM.cardTags.textContent = cardData.tags?.join(', ') || '-';
    const srsStatus = cardData.srsStatus || 'New';
    if (DOM.cardSrsStatus) {
        DOM.cardSrsStatus.textContent = srsStatus;
        DOM.cardSrsStatus.className = `status-badge status-${srsStatus.toLowerCase()}`;
        DOM.cardSrsStatus.title = `Status: ${srsStatus}`;
    }

    // Thêm class cho flashcard để CSS xử lý khoảng cách
    DOM.flashcard.classList.toggle('typing-mode-active', isTypingMode);

    // Masking & UI for Typing Mode (Ẩn hoàn toàn từ Tiếng Anh để tránh spoil đáp án)
    if (DOM.cardEnglish) {
        DOM.cardEnglish.classList.remove('revealed');
        DOM.cardEnglish.classList.toggle('text-masked', isTypingMode);
        DOM.cardEnglish.classList.toggle('hidden', isTypingMode);
    }
    if (DOM.typingFrontUi) {
        DOM.typingFrontUi.classList.toggle('hidden', !isTypingMode);
        if (isTypingMode && DOM.typingHintText) {
            DOM.typingHintText.textContent = cardData.vietnamese || 'N/A';
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
            if (getState().isTypingMode) {
                import('../features/typing.js').then(m => m.startTypingTimer());
            } else {
                DOM.srsFeedbackButtons?.querySelector('.srs-btn[data-rating="3"]')?.focus({ preventScroll: true });
            }
        }
    } finally {
        setIsTransitioning(false);
    }
}

function toggleFlashcardControlButtons(showSRSAndNext) {
    const isTypingMode = getState().isTypingMode;
    
    if (isTypingMode) {
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
            import('../features/typing.js').then(m => m.startTypingTimer());
        }
        
        DOM.nextCardBtn?.classList.toggle('hidden', !showSRSAndNext);
    } else {
        DOM.revealBtn?.classList.toggle('hidden', showSRSAndNext);
        
        if (showSRSAndNext) {
            DOM.srsFeedbackButtons?.classList.remove('hidden');
            DOM.typingArea?.classList.add('hidden');
        } else {
            DOM.srsFeedbackButtons?.classList.add('hidden');
            DOM.typingArea?.classList.add('hidden');
        }
        
        DOM.nextCardBtn?.classList.toggle('hidden', !showSRSAndNext);
    }
}

export function updateStats() {
    if (!DOM.statsArea) return;
    const { vocabulary, currentTopicFilter } = getState();
    const activeVocabulary = vocabulary.filter(w => !w.isDeleted);
    const totalCount = activeVocabulary.length;
    const filterLowerCase = currentTopicFilter.toLowerCase();
    const filteredVocab = activeVocabulary.filter(w => 
        !w.isSuspended && (filterLowerCase === 'all' || w.tags?.map(t => t.toLowerCase()).includes(filterLowerCase))
    );
    const filteredCount = filteredVocab.length;
    const now = Date.now();
    const endOfDay = new Date(now).setHours(23, 59, 59, 999);
    
    // V3.3: Tập hợp các thẻ CẦN ÔN (Bao gồm thẻ đến hạn tự nhiên + Thẻ đang trong hàng đợi ôn tập do học nhồi)
    const activeDueSet = new Set();
    filteredVocab.forEach((w, idx) => {
        const isNaturalDue = w.srsDueDate && (w.srsStatus === 'Mastered' ? w.srsDueDate <= endOfDay : w.srsDueDate <= now);
        if (isNaturalDue) {
            activeDueSet.add(w.id || idx);
        }
    });

    const { currentReviewQueue, currentCardIndex } = getState();
    // Bổ sung thẻ hiện tại nếu là thẻ Mastered đang ôn tập
    if (currentCardIndex >= 0 && currentCardIndex < vocabulary.length) {
        const cw = vocabulary[currentCardIndex];
        if (cw && !cw.isDeleted && !cw.isSuspended && (filterLowerCase === 'all' || cw.tags?.map(t => t.toLowerCase()).includes(filterLowerCase))) {
            if (cw.srsStatus === 'Mastered') {
                activeDueSet.add(cw.id || currentCardIndex);
            }
        }
    }
    // Bổ sung các thẻ trong currentReviewQueue (được nạp từ học nhồi)
    if (Array.isArray(currentReviewQueue)) {
        currentReviewQueue.forEach(idx => {
            if (idx >= 0 && idx < vocabulary.length) {
                const qw = vocabulary[idx];
                if (qw && !qw.isDeleted && !qw.isSuspended && (filterLowerCase === 'all' || qw.tags?.map(t => t.toLowerCase()).includes(filterLowerCase))) {
                    if (qw.srsStatus === 'Mastered') {
                        activeDueSet.add(qw.id || idx);
                    }
                }
            }
        });
    }

    const dueCount = activeDueSet.size;
    const newCount = filteredVocab.filter(w => w.srsStatus === 'New').length;
    const totalLearningRaw = filteredVocab.filter(w => w.srsStatus === 'Learning').length;
    const totalMasteredRaw = filteredVocab.filter(w => w.srsStatus === 'Mastered').length;

    // Mutually exclusive partitioning for progress bar:
    // 1. Due today (Active review queue)
    // 2. Mastered & not due (Long-term retained)
    // 3. Learning & not due (In-progress review)
    // 4. New (Unseen cards)
    const masteredNonDue = filteredVocab.filter(w => w.srsStatus === 'Mastered' && (!w.srsDueDate || w.srsDueDate > endOfDay)).length;
    const learningNonDue = filteredVocab.filter(w => w.srsStatus === 'Learning' && (!w.srsDueDate || w.srsDueDate > now)).length;

    animateNumber(DOM.statTotal, totalCount);
    animateNumber(DOM.statFiltered, filteredCount);
    animateNumber(DOM.statDue, dueCount);
    animateNumber(DOM.statNew, newCount);
    animateNumber(DOM.statLearning, totalLearningRaw);
    animateNumber(DOM.statMastered, totalMasteredRaw);

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
    const pBarMastered = Math.round((masteredNonDue / baseCount) * 100);
    const pBarDue = Math.round((dueCount / baseCount) * 100);
    const pBarLearning = learningNonDue > 0 ? Math.max(2, Math.round((learningNonDue / baseCount) * 100)) : 0;
    const pBarNew = Math.max(0, 100 - pBarMastered - pBarDue - pBarLearning);

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

export function populateTopicFilters(tagsHaveChanged = false) {
    const { allTags } = getState();
    const sortedTags = Array.from(allTags).sort((a, b) => {
        if (a === 'all') return -1;
        if (b === 'all') return 1;
        return a.localeCompare(b);
    });
    const currentMainFilter = DOM.mainTopicFilter.value;
    const currentPanelFilter = DOM.panelTopicFilter.value;
    DOM.mainTopicFilter.innerHTML = '';
    DOM.panelTopicFilter.innerHTML = '';
    sortedTags.forEach(tag => {
        const optionMain = document.createElement('option');
        optionMain.value = tag;
        optionMain.textContent = tag === 'all' ? '📚 Tất cả chủ đề' : tag;
        DOM.mainTopicFilter.appendChild(optionMain);
        const optionPanel = document.createElement('option');
        optionPanel.value = tag;
        optionPanel.textContent = tag === 'all' ? 'Tất cả chủ đề' : tag;
        DOM.panelTopicFilter.appendChild(optionPanel);
    });
    DOM.mainTopicFilter.value = allTags.has(currentMainFilter) ? currentMainFilter : 'all';
    DOM.panelTopicFilter.value = allTags.has(currentPanelFilter) ? currentPanelFilter : 'all';
}

export function applyDarkMode(isDark) {
    document.body.classList.toggle('dark-mode', isDark);
    setIsDarkMode(isDark);
    localStorage.setItem('celestialDarkMode', isDark);
    const icon = DOM.toggleDarkModeBtn?.querySelector('i');
    if (icon) icon.className = isDark ? 'ph ph-sun' : 'ph ph-moon';

    import('./celestial-canvas.js').then(m => m.updateCanvasTheme(isDark));
}

export function applySoundSetting(mode) {
    setSoundMode(mode);
    localStorage.setItem('celestialSoundMode', mode);
    
    const icon = DOM.toggleSoundBtn?.querySelector('i');
    const label = DOM.toggleSoundBtn?.querySelector('.btn-label');
    
    if (icon) {
        if (mode === 'all') icon.className = 'ph ph-speaker-high';
        else if (mode === 'sfx') icon.className = 'ph ph-music-note';
        else if (mode === 'tts') icon.className = 'ph ph-waveform';
        else icon.className = 'ph ph-speaker-slash';
    }
    
    if (label) {
        if (mode === 'all') label.textContent = 'Âm thanh: Tất cả';
        else if (mode === 'sfx') label.textContent = 'Âm thanh: Chỉ SFX';
        else if (mode === 'tts') label.textContent = 'Âm thanh: Chỉ TTS';
        else label.textContent = 'Âm thanh: Tắt';
    }
    DOM.toggleSoundBtn?.classList.toggle('muted', mode === 'off');
}

let visibleCount = 30;
const INITIAL_LOAD_COUNT = 30;
let filteredWordsCache = [];
let scrollListenerAttached = false;

function loadMoreWords() {
    if (visibleCount >= filteredWordsCache.length) return;
    
    const prevCount = visibleCount;
    visibleCount = Math.min(visibleCount + INITIAL_LOAD_COUNT, filteredWordsCache.length);
    
    const fragment = document.createDocumentFragment();
    filteredWordsCache.slice(prevCount, visibleCount).forEach(word => {
        const card = createWordCard(word);
        fragment.appendChild(card);
    });
    
    DOM.wordListDisplay.appendChild(fragment);
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
        const topicMatch = selectedTopic === 'all' || word.tags?.map(t => t.toLowerCase()).includes(selectedTopic);
        const statusMatch = selectedStatus === 'all' || word.srsStatus === selectedStatus || (selectedStatus === 'Suspended' && word.isSuspended);
        const searchMatch = !searchTerm || isFuzzySearchMatch(searchTerm, word.english, word.vietnamese);
        return topicMatch && statusMatch && searchMatch;
    }).sort((a, b) => a.english.localeCompare(b.english));

    // Cập nhật thẻ đếm tổng số từ
    const countBadge = document.getElementById('manage-total-count');
    if (countBadge) {
        const totalCount = vocabulary.filter(w => !w.isDeleted).length;
        countBadge.innerHTML = `<i class="ph-bold ph-cards"></i> ${filteredWordsCache.length} / ${totalCount} từ`;
    }

    if (filteredWordsCache.length === 0) {
        DOM.wordListDisplay.innerHTML = `<p style="text-align:center; padding: 40px; opacity: 0.7;">Không có từ nào khớp với bộ lọc của bạn.</p>`;
        return;
    }

    if (resetScroll) {
        visibleCount = INITIAL_LOAD_COUNT;
        const section = document.getElementById('word-list-section');
        if (section) section.scrollTop = 0;
    }

    const fragment = document.createDocumentFragment();
    filteredWordsCache.slice(0, visibleCount).forEach(word => {
        const card = createWordCard(word);
        fragment.appendChild(card);
    });

    DOM.wordListDisplay.appendChild(fragment);

    // Gắn sự kiện cuộn nếu chưa gắn
    if (!scrollListenerAttached) {
        const section = document.getElementById('word-list-section');
        if (section) {
            section.addEventListener('scroll', () => {
                if (section.scrollTop + section.clientHeight >= section.scrollHeight - 150) {
                    loadMoreWords();
                }
            });
            scrollListenerAttached = true;
        }
    }
}

// HÀM MỚI: Tạo một thẻ từ vựng (Material Design 3)
function createWordCard(word) {
    const cardEl = document.createElement('div');
    cardEl.className = 'word-card';
    if (word.isSuspended) {
        cardEl.classList.add('is-suspended');
    }

    // Determine status color
    const statusColors = {
        'New': 'var(--new-color)',
        'Learning': 'var(--learning-color)',
        'Mastered': 'var(--mastered-color)',
    };
    const statusColor = word.isSuspended ? 'var(--text-light)' : (statusColors[word.srsStatus] || 'var(--new-color)');
    const statusLabels = { 'New': 'Mới', 'Learning': 'Đang học', 'Mastered': 'Đã thuộc' };
    const statusLabel = word.isSuspended ? 'Tạm ngưng' : (statusLabels[word.srsStatus] || 'Mới');
    
    cardEl.style.setProperty('--status-color', statusColor);

    cardEl.innerHTML = `
        <div class="word-card-status-bar"></div>
        <div class="word-card-inner">
            <div class="word-card-header">
                <div class="word-card-title-group">
                    <span class="word-english">${word.english}</span>
                    <span class="word-type">${word.type || ''}</span>
                </div>
                <div class="word-card-header-right">
                    <span class="word-card-srs-badge">${statusLabel}</span>
                    <input type="checkbox" class="word-card-checkbox" data-id="${word.id}" aria-label="Chọn từ ${word.english}">
                </div>
            </div>
            <div class="word-card-body">
                <p class="word-vietnamese">${word.vietnamese}</p>
                ${word.pronunciation ? `<p class="word-pronunciation">${word.pronunciation}</p>` : ''}
            </div>
            <div class="word-card-footer">
                <span class="word-card-tags" title="${word.tags?.join(', ') || ''}">${word.tags?.join(', ') || 'Không có chủ đề'}</span>
                <div class="word-card-actions"></div>
            </div>
        </div>
    `;

    const actionsContainer = cardEl.querySelector('.word-card-actions');
    
    // Nút Nghe Phát Âm (TTS)
    const ttsBtn = document.createElement('button');
    ttsBtn.className = 'icon-btn card-action-btn tts-btn-card';
    ttsBtn.title = 'Phát âm (TTS)';
    ttsBtn.innerHTML = '<i class="ph ph-speaker-high"></i>';
    ttsBtn.onclick = (e) => {
        e.stopPropagation();
        import('../core/sound.js').then(m => m.speakText(word.english));
    };

    // Nút Sửa
    const editBtn = document.createElement('button');
    editBtn.className = 'icon-btn card-action-btn';
    editBtn.title = 'Sửa từ';
    editBtn.innerHTML = '<i class="ph ph-pencil-simple"></i>';
    editBtn.onclick = () => {
        closeModal(DOM.manageModal);
        openAddEditModal(true, word);
    };

    // Nút Xóa
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'icon-btn card-action-btn danger-btn';
    deleteBtn.title = 'Xóa từ';
    deleteBtn.innerHTML = '<i class="ph ph-trash"></i>';
    deleteBtn.onclick = () => {
        showConfirmation(`Bạn có chắc muốn xóa từ "${word.english}"?`, () => {
            const currentVocab = getState().vocabulary;
            const idx = currentVocab.findIndex(v => v.id === word.id);
            if (idx > -1) {
                currentVocab[idx].isDeleted = true;
                currentVocab[idx].updatedAt = Date.now();
                setVocabulary(currentVocab);
                import('../core/state.js').then(m => m.saveOneWord(currentVocab[idx]));
                updatePanelWordList(false);
                showPopup(`Đã xóa từ "${word.english}".`, 'success');
            }
        });
    };

    actionsContainer.appendChild(ttsBtn);
    actionsContainer.appendChild(editBtn);

    // Nút Kích hoạt lại (nếu bị tạm ngưng)
    if (word.isSuspended) {
        const reactivateBtn = document.createElement('button');
        reactivateBtn.className = 'icon-btn card-action-btn';
        reactivateBtn.title = 'Kích hoạt lại từ này';
        reactivateBtn.innerHTML = '<i class="ph ph-arrow-clockwise"></i>';
        reactivateBtn.onclick = () => {
            word.isSuspended = false;
            word.lapses = 0; // Reset bộ đếm lỗi
            word.updatedAt = Date.now(); // Quan trọng: đánh dấu thay đổi để sync
            import('../core/state.js').then(m => m.saveOneWord(word));
            updatePanelWordList(false); // Cập nhật lại danh sách
            showPopup(`Đã kích hoạt lại từ "${word.english}".`, 'success');
        };
        actionsContainer.appendChild(reactivateBtn);
    }

    actionsContainer.appendChild(deleteBtn);

    return cardEl;
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
    if (!example || example === 'N/A' || !englishWord) return example || 'N/A';
    
    // Tách các từ thay thế nếu có dấu gạch chéo '/' (ví dụ: put off / delay)
    const rawTerms = englishWord.split('/').map(t => t.trim()).filter(Boolean);
    const patterns = [];
    
    for (const rawTerm of rawTerms) {
        // Loại bỏ phần giải thích trong ngoặc đơn nếu có (ví dụ: "set (sth) up" -> "set up")
        const cleanTerm = rawTerm.replace(/\([^)]*\)/g, '').trim().replace(/\s+/g, ' ');
        if (!cleanTerm) continue;

        const escaped = cleanTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
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
    
    if (patterns.length === 0) return example;

    try {
        // Gom lại và thay thế trong 1 lần duy nhất để tránh vỡ thẻ HTML lồng nhau
        const combinedRegex = new RegExp('(' + patterns.join('|') + ')', 'gi');
        return example.replace(combinedRegex, '<mark class="example-highlight">$1</mark>');
    } catch (e) {
        return example;
    }
}
