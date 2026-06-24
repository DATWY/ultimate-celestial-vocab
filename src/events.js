// src/events.js

import { DOM } from './ui/elements.js';
import { getState, setCurrentTopicFilter, toggleStarOnCurrentCard, saveVocabulary, setVocabulary, incrementNewCardsDone, recordReviewResult, addXP, logActivity } from './core/state.js';
import { calculateNextSrsState, getNextCardToReview, buildReviewQueue, insertCardForLearningStep } from './core/srs.js';
import { displayCard, flipCard, applyDarkMode, applySoundSetting, populateTopicFilters, updatePanelWordList, checkAndCleanupTags } from './ui/render.js';
import { openModal, closeModal, openAddEditModal, showConfirmation, showPopup, handleAddEditSubmit, cancelEdit, openManageModal } from './ui/modal.js';
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

function processSrsFeedback(rating) {
    const { vocabulary, currentCardIndex } = getState();
    if (currentCardIndex < 0 || !vocabulary[currentCardIndex]) return;

    const currentCard = vocabulary[currentCardIndex];
    const isNewCard = currentCard.srsStatus === 'New' && (!currentCard.learningStep || currentCard.learningStep === 0);
    
    const updatedCard = calculateNextSrsState(currentCard, rating);

    // Record stats & Gamification
    if (isNewCard && rating > 0) { // If it was totally new and we rated it (not again)
        incrementNewCardsDone();
        addXP(10); // +10 XP for learning a new card
    } else if (rating > 0) {
        addXP(5); // +5 XP for correct review
    }
    
    // Rating 0 = Again -> incorrect. Rating > 0 -> correct
    recordReviewResult(rating > 0);
    logActivity(); // Ghi nhận hoạt động vào Heatmap

    vocabulary[currentCardIndex] = updatedCard;
    saveVocabulary();

    const soundToPlay = (rating === 0) ? 'incorrect' : 'correct';
    playSound(soundToPlay);

    if (updatedCard.isSuspended) {
        showPopup(`Từ "${updatedCard.english}" bị quên quá nhiều lần và đã được tạm ngưng. Bạn có thể kích hoạt lại trong phần Quản lý.`, 'info');
    }

    // Nâng cấp: Chèn lại thẻ nếu đang trong giai đoạn ươm mầm (Learning steps)
    // Nếu nextDueDate <= Date.now() + 10s (được hẹn ngay lập tức)
    if (updatedCard.srsDueDate <= Date.now() + 10000) {
        insertCardForLearningStep(currentCardIndex);
    }

	document.activeElement?.blur();
    switchCardWithAnimation();
}

async function switchCardWithAnimation() {
	const currentScrollY = window.scrollY;
    document.body.style.overflowY = 'hidden';
    await animateCardOut(DOM.flashcard);
    const nextIndex = getNextCardToReview();
    displayCard(nextIndex); 
    if (nextIndex !== -1) {
        playSound('next');
        await animateCardIn(DOM.flashcard);
    }
	document.body.style.overflowY = '';
    window.scrollTo({ top: currentScrollY, behavior: 'instant' });
}

export function setupEventListeners() {
	
	// Xử lý bật/tắt Taskbar Menu trên Mobile
    DOM.toggleTaskbarBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        DOM.taskbarMenu?.classList.toggle('show');
        
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
        if (DOM.taskbarMenu?.classList.contains('show') && !DOM.taskbarMenu.contains(e.target) && e.target !== DOM.toggleTaskbarBtn) {
            DOM.taskbarMenu.classList.remove('show');
            DOM.toggleTaskbarBtn.querySelector('i').className = 'ph-duotone ph-list';
        }
    });
    // Header
    DOM.toggleDarkModeBtn?.addEventListener('click', () => applyDarkMode(!getState().isDarkMode));
    DOM.toggleSoundBtn?.addEventListener('click', () => applySoundSetting(!getState().isSoundEnabled));
    DOM.addWordBtnOpen?.addEventListener('click', () => openAddEditModal());
    DOM.manageWordsBtnOpen?.addEventListener('click', openManageModal);
    DOM.profileBtn?.addEventListener('click', openProfileModal);
    DOM.startQuizBtn?.addEventListener('click', loadAndShowQuiz);
    DOM.mainTopicFilter?.addEventListener('change', (e) => {
        setCurrentTopicFilter(e.target.value);
        buildReviewQueue();
        switchCardWithAnimation();
    });

    // Flashcard
    DOM.revealBtn?.addEventListener('click', flipCard);
    DOM.nextCardBtn?.addEventListener('click', () => { if (getState().isFlipped) switchCardWithAnimation(); });
    DOM.ttsBtn?.addEventListener('click', () => {
        const { vocabulary, currentCardIndex } = getState();
        if (currentCardIndex >= 0) speakText(vocabulary[currentCardIndex].english);
    });
    DOM.starBtn?.addEventListener('click', toggleStar);
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

    // Modals
    DOM.addEditForm?.addEventListener('submit', handleAddEditSubmit);
    DOM.closeAddEditModalBtn?.addEventListener('click', () => closeModal(DOM.addEditModal));
    DOM.addEditOverlay?.addEventListener('click', () => closeModal(DOM.addEditModal));
    DOM.cancelEditBtn?.addEventListener('click', cancelEdit);
    DOM.closeManageModalBtn?.addEventListener('click', () => closeModal(DOM.manageModal));
    DOM.manageOverlay?.addEventListener('click', () => closeModal(DOM.manageModal));
    DOM.closeProfileModalBtn?.addEventListener('click', () => closeModal(DOM.profileModal));
    DOM.profileOverlay?.addEventListener('click', () => closeModal(DOM.profileModal));

    // Manage Panel (New and updated listeners)
    setupIOEventListeners(); // Handles Import, Export, Clear All
    let searchTimeout;
    DOM.manageSearchInput?.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => { updatePanelWordList(e); }, 300);
    });
    DOM.panelTopicFilter?.addEventListener('change', updatePanelWordList);
    document.getElementById('panel-status-filter')?.addEventListener('change', updatePanelWordList);
    DOM.manageRefreshListBtn?.addEventListener('click', updatePanelWordList);
    document.getElementById('bulk-delete-btn')?.addEventListener('click', handleBulkDelete);
    DOM.wordListDisplay?.addEventListener('change', handleWordCardCheckboxChange);

    // Global Keyboard
    document.addEventListener('keydown', handleGlobalShortcuts);
	DOM.manualSyncBtn?.addEventListener('click', () => {
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
            saveVocabulary();
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
    if (isModalOpen || isTyping) return;
    const { isFlipped } = getState();
    switch (e.key.toUpperCase()) {
        case 'F': e.preventDefault(); flipCard(); break;
        case 'P': e.preventDefault(); DOM.ttsBtn?.click(); break;
        case 'S': e.preventDefault(); DOM.starBtn?.click(); break;
        case 'N': case 'ENTER':
            if (isFlipped) { e.preventDefault(); DOM.nextCardBtn?.click(); }
            break;
        case '1': case '2': case '3':
            if (isFlipped) {
                const mappedRating = parseInt(e.key) - 1; // '1' -> 0 (Again), '2' -> 1 (Good), '3' -> 2 (Easy)
                const btn = DOM.srsFeedbackButtons?.querySelector(`.srs-btn[data-rating="${mappedRating}"]`);
                if (btn) { e.preventDefault(); btn.click(); }
            }
            break;
    } 
}