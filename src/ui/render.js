import { DOM } from './elements.js';
import { getState, setCurrentCardIndex, setIsFlipped, setSoundEnabled, setIsDarkMode, setVocabulary, saveVocabulary, setAllTags } from '../core/state.js';
import { playSound, preloadAudio } from '../core/sound.js';
import { buildReviewQueue, getNextCardToReview } from '../core/srs.js';
import { openAddEditModal, showConfirmation, showPopup, closeModal } from './modal.js';
import { animateFlip } from '../core/animations.js';

export function displayCard(index) {
    const { vocabulary } = getState();
    const cardData = vocabulary[index];

    // Trường hợp không có thẻ để hiển thị
    if (!cardData) {
        DOM.flashcardArea?.classList.add('hidden');
        DOM.controlsArea?.classList.add('hidden');
        DOM.noCardMessage?.classList.remove('hidden');
        DOM.noCardMessage.textContent = vocabulary.length === 0 
            ? "Chưa có từ vựng. Hãy thêm từ mới!" 
            : "Chúc mừng! Bạn đã hoàn thành tất cả các thẻ trong bộ lọc này.";
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
    
    // Cập nhật nội dung thẻ (DOM updates)
    DOM.noCardMessage?.classList.add('hidden');
    DOM.cardEnglish.textContent = cardData.english;
    const starIcon = DOM.starBtn?.querySelector('i');
    if (starIcon) starIcon.className = cardData.isStarred ? 'ph-fill ph-star' : 'ph ph-star';
    DOM.starBtn?.classList.toggle('starred', !!cardData.isStarred); // Sử dụng !! để đảm bảo giá trị là boolean
    DOM.cardVietnamese.textContent = cardData.vietnamese || 'N/A';
    DOM.cardType.textContent = cardData.type || 'N/A';
    DOM.cardPronunciation.textContent = cardData.pronunciation || 'N/A';
    DOM.cardExample.textContent = cardData.example || 'N/A';
    DOM.cardTags.textContent = cardData.tags?.join(', ') || '-';
    const srsStatus = cardData.srsStatus || 'New';
    if (DOM.cardSrsStatus) {
        DOM.cardSrsStatus.textContent = srsStatus;
        DOM.cardSrsStatus.className = `status-badge status-${srsStatus.toLowerCase()}`;
        DOM.cardSrsStatus.title = `Status: ${srsStatus}`;
    }

    // Cập nhật giao diện thẻ
    DOM.flashcardArea?.classList.remove('hidden');
    DOM.controlsArea?.classList.remove('hidden');
    toggleFlashcardControlButtons(false);
    
    // Cập nhật thống kê cuối cùng
    updateStats();
}

export async function flipCard() {
    const { currentCardIndex, isFlipped } = getState();
    if (currentCardIndex < 0 || !DOM.flashcard) return;
    const newFlippedState = !isFlipped;
    setIsFlipped(newFlippedState);
    await animateFlip(DOM.flashcard);
    DOM.flashcard.classList.toggle('is-flipped', newFlippedState);
    toggleFlashcardControlButtons(newFlippedState);
    if (newFlippedState) {
        playSound('flip');
        DOM.srsFeedbackButtons?.querySelector('.srs-btn[data-rating="2"]')?.focus({ preventScroll: true });
    }
}

function toggleFlashcardControlButtons(showSRSAndNext) {
    DOM.revealBtn?.classList.toggle('hidden', showSRSAndNext);
    DOM.srsFeedbackButtons?.classList.toggle('hidden', !showSRSAndNext);
    DOM.nextCardBtn?.classList.toggle('hidden', !showSRSAndNext);
}

export function updateStats() {
    if (!DOM.statsArea) return;
    const { vocabulary, currentTopicFilter } = getState();
    const activeVocabulary = vocabulary.filter(w => !w.isDeleted);
    const totalCount = activeVocabulary.length;
    const filterLowerCase = currentTopicFilter.toLowerCase();
    const filteredVocab = activeVocabulary.filter(w => 
        filterLowerCase === 'all' || w.tags?.map(t => t.toLowerCase()).includes(filterLowerCase)
    );
    const filteredCount = filteredVocab.length;
    const now = Date.now();
    const dueCount = filteredVocab.filter(w => w.srsDueDate && w.srsDueDate <= now).length;
    const newCount = filteredVocab.filter(w => w.srsStatus === 'New').length;
    const learningCount = filteredVocab.filter(w => w.srsStatus === 'Learning').length;
    const masteredCount = filteredVocab.filter(w => w.srsStatus === 'Mastered').length;
    DOM.statTotal.textContent = totalCount;
    DOM.statFiltered.textContent = filteredCount;
    DOM.statDue.textContent = dueCount;
    DOM.statNew.textContent = newCount;
    DOM.statLearning.textContent = learningCount;
    DOM.statMastered.textContent = masteredCount;
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
}

export function applySoundSetting(enabled) {
    setSoundEnabled(enabled);
    localStorage.setItem('celestialSoundEnabled', enabled);
    const icon = DOM.toggleSoundBtn?.querySelector('i');
    if (icon) icon.className = enabled ? 'ph ph-speaker-high' : 'ph ph-speaker-slash';
    DOM.toggleSoundBtn?.classList.toggle('muted', !enabled);
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
        const searchMatch = !searchTerm || word.english.toLowerCase().includes(searchTerm) || word.vietnamese.toLowerCase().includes(searchTerm);
        return topicMatch && statusMatch && searchMatch;
    }).sort((a, b) => a.english.localeCompare(b.english));

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
                saveVocabulary();
                updatePanelWordList(false);
                showPopup(`Đã xóa từ "${word.english}".`, 'success');
            }
        });
    };

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
            saveVocabulary();
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
