
import { DOM } from './elements.js';
import { getState, saveVocabulary, setVocabulary, setAllTags, saveOneWord } from '../core/state.js';
import { populateTopicFilters, updatePanelWordList, displayCard, checkAndCleanupTags } from './render.js';
import { buildReviewQueue, getNextCardToReview } from '../core/queue.js';
import { playSound } from '../core/sound.js';
import { animateModalOpen, animateModalClose } from '../core/animations.js';
import { syncCardToFirebase } from '../core/sync.js';
import { findDuplicatePairs, mergeDuplicateCards, findInternalDuplicateCards, cleanAndDeduplicateVietnamese } from '../core/dedup.js';

let confirmCallback = null;

export function openModal(modalElement) {
    if (!modalElement) return;
    modalElement.classList.remove('hidden');
    animateModalOpen(modalElement);
    setTimeout(() => {
        const focusable = modalElement.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (focusable) focusable.focus();
    }, 50);
}

export async function closeModal(modalElement) {
    if (!modalElement || modalElement.classList.contains('hidden')) return;
    await animateModalClose(modalElement);
    modalElement.classList.add('hidden');
}

export function showPopup(message, type = 'info', isHTML = false) {
    if (!DOM.popupModal) return;
    if (isHTML) {
        DOM.popupMessage.innerHTML = message;
    } else {
        DOM.popupMessage.textContent = message;
    }
    DOM.popupCancelBtn?.classList.add('hidden');
    DOM.popupOkBtn?.classList.remove('hidden');
    if (DOM.popupActions) DOM.popupActions.style.justifyContent = 'center';
    confirmCallback = null;
    openModal(DOM.popupModal);
    DOM.popupOkBtn?.focus();
}

export function showConfirmation(message, onConfirm, isHTML = false) {
    if (!DOM.popupModal) return;
    if (isHTML) {
        DOM.popupMessage.innerHTML = message;
    } else {
        DOM.popupMessage.textContent = message;
    }
    DOM.popupCancelBtn?.classList.remove('hidden');
    DOM.popupOkBtn?.classList.remove('hidden');
    if (DOM.popupActions) DOM.popupActions.style.justifyContent = 'flex-end';
    confirmCallback = onConfirm;
    openModal(DOM.popupModal);
    DOM.popupOkBtn?.focus();
}

function handlePopupOk() {
    if (typeof confirmCallback === 'function') {
        const callbackToExecute = confirmCallback; // Lưu callback hiện tại vào một biến tạm
        confirmCallback = null; // Xóa callback toàn cục ngay lập tức

        // Thực thi callback đã lưu
        callbackToExecute(); 

        // QUAN TRỌNG: Chỉ đóng modal nếu không có một callback MỚI nào được thiết lập
        // (nghĩa là, callback vừa chạy không mở một popup confirm khác)
        if (confirmCallback === null) {
            closeModal(DOM.popupModal);
        }
    } else {
        // Nếu không có callback nào, chỉ cần đóng modal (trường hợp popup thông báo)
        closeModal(DOM.popupModal);
    }
}


function handlePopupCancel() {
    confirmCallback = null;
    closeModal(DOM.popupModal);
}

DOM.popupOkBtn?.addEventListener('click', handlePopupOk);
DOM.popupCancelBtn?.addEventListener('click', handlePopupCancel);
DOM.closePopupModalBtn?.addEventListener('click', handlePopupCancel);
DOM.popupOverlay?.addEventListener('click', handlePopupCancel);

export function openAddEditModal(isEditing = false, wordData = null) {
    if (!DOM.addEditModal || !DOM.addEditForm) return;
    DOM.addEditForm.reset();
    DOM.editWordId.value = '';
    if (isEditing && wordData) {
        DOM.formTitle.textContent = "Sửa từ vựng";
        DOM.editWordId.value = wordData.id;
        DOM.inputEnglish.value = wordData.english;
        DOM.inputVietnamese.value = wordData.vietnamese;
        DOM.inputType.value = wordData.type || '';
        DOM.inputPronunciation.value = wordData.pronunciation || '';
        DOM.inputTags.value = wordData.tags?.join(', ') || '';
        DOM.inputExample.value = wordData.example || '';
        DOM.saveWordBtn.innerHTML = '<i class="ph-duotone ph-floppy-disk"></i> Lưu thay đổi';
        DOM.cancelEditBtn?.classList.remove('hidden');
    } else {
        DOM.formTitle.textContent = "Thêm từ mới";
        DOM.saveWordBtn.innerHTML = '<i class="ph-duotone ph-plus-square"></i> Thêm từ';
        DOM.cancelEditBtn?.classList.add('hidden');
    }
    openModal(DOM.addEditModal);
    DOM.inputEnglish?.focus();
}

export function handleAddEditSubmit(event) {
    event.preventDefault();
    const { vocabulary, allTags, currentCardIndex } = getState();
    const isEditing = !!DOM.editWordId.value;
    const wordId = isEditing ? DOM.editWordId.value : (crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).substring(2, 10)));
    const englishInput = DOM.inputEnglish.value.trim();
    const rawVietnamese = DOM.inputVietnamese.value.trim();
    if (!englishInput || !rawVietnamese) {
        showPopup("Từ tiếng Anh và nghĩa tiếng Việt không được để trống.", "warning");
        return;
    }
    const vietnameseInput = cleanAndDeduplicateVietnamese(rawVietnamese);
    const tagsArray = DOM.inputTags.value.trim() ? DOM.inputTags.value.split(',').map(t => t.trim()).filter(Boolean) : [];
    let tagsHaveChanged = false;
    tagsArray.forEach(tag => {
        if (!allTags.has(tag)) {
            allTags.add(tag);
            tagsHaveChanged = true;
        }
    });
    const wordData = {
        id: wordId,
        english: englishInput,
        vietnamese: vietnameseInput,
        type: DOM.inputType.value.trim() || '',
        pronunciation: DOM.inputPronunciation.value.trim() || '',
        tags: tagsArray,
        example: DOM.inputExample.value.trim() || '',
		updatedAt: Date.now()
    };
    const existingIndex = vocabulary.findIndex(w => w.id === wordId);
    if (existingIndex > -1) {
        const oldWord = vocabulary[existingIndex];
        const updatedWord = { ...oldWord, ...wordData };
        vocabulary[existingIndex] = updatedWord;
        syncCardToFirebase(updatedWord);
        showPopup("Đã cập nhật từ vựng thành công!", "success");
        if (existingIndex === currentCardIndex) {
            displayCard(currentCardIndex);
        }
    } else {
        const duplicateExists = vocabulary.some(w => w.english.toLowerCase() === englishInput.toLowerCase());
        if (duplicateExists) {
            showConfirmation(`Từ "${englishInput}" đã có trong từ điển. Bạn vẫn muốn thêm?`, () => {
                const fullWordData = { ...wordData, isStarred: false, srsStatus: 'New', srsInterval: 0, srsEaseFactor: 2.5, srsDueDate: null, lapses: 0, isSuspended: false };
                addNewWord(fullWordData);
                syncCardToFirebase(fullWordData);
                saveAndRefreshUI(tagsHaveChanged);
                closeModal(DOM.addEditModal);
            });
            return;
        } else {
            const fullWordData = { ...wordData, isStarred: false, srsStatus: 'New', srsInterval: 0, srsEaseFactor: 2.5, srsDueDate: null, lapses: 0, isSuspended: false };
            addNewWord(fullWordData);
            syncCardToFirebase(fullWordData);
        }
    }
    saveAndRefreshUI(tagsHaveChanged);
    closeModal(DOM.addEditModal);
}

function addNewWord(wordData) {
    const { vocabulary } = getState();
    vocabulary.push(wordData);
    setVocabulary(vocabulary);
    showPopup("Đã thêm từ mới thành công!", "success");
}

export function cancelEdit() {
    closeModal(DOM.addEditModal);
}

export function openManageModal() {
    if (!DOM.manageModal) return;
    DOM.panelTopicFilter.value = getState().currentTopicFilter;
    DOM.manageSearchInput.value = '';
    
    // Đảm bảo mở tab Danh sách từ vựng mặc định
    const tabWords = document.getElementById('tab-vocab-list');
    if (tabWords && !tabWords.classList.contains('active')) {
        tabWords.click();
    }
    
    updatePanelWordList();
    import('../events.js').then(m => m.updateUndoButtonState());
    openModal(DOM.manageModal);
    DOM.manageSearchInput?.focus();
}

function saveAndRefreshUI(tagsHaveChanged = false) {
    saveVocabulary();
    playSound('complete');
    if (tagsHaveChanged) {
        populateTopicFilters(true);
    }
    buildReviewQueue();
    updatePanelWordList();
}

// --- Toast Notification System ---
export function showToast(title, message, iconClass = 'ph-trophy') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'toast-item';
    toast.innerHTML = `
        <div class="toast-icon">
            <i class="ph ${iconClass}"></i>
        </div>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-message">${message}</div>
        </div>
    `;

    container.appendChild(toast);

    // Kích hoạt animation trượt vào
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });
    });

    // Tự động ẩn và xóa sau 4 giây
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            if (toast.parentElement) {
                toast.parentElement.removeChild(toast);
            }
        }, 400); // Đợi CSS transition chạy xong
    }, 4000);
}

// --- Next-Gen Deduplication Modal & Smart Merge Handlers (v5.0 Fuzzy & Meaning Cleaning) ---

export function openDedupModal() {
    if (!DOM.dedupModal) return;
    openModal(DOM.dedupModal);
    renderDedupPairs();
}

export function renderDedupPairs() {
    const { vocabulary } = getState();
    const dups = findDuplicatePairs(vocabulary);
    const internalDups = findInternalDuplicateCards(vocabulary);
    
    if (!DOM.dedupList || !DOM.dedupSummaryText) return;
    
    DOM.dedupList.innerHTML = '';
    
    if (dups.length === 0 && internalDups.length === 0) {
        DOM.dedupSummaryText.innerHTML = `<strong>Tuyệt vời!</strong> Toàn bộ <strong>${vocabulary.filter(w => !w.isDeleted).length} từ</strong> trong kho từ vựng đều độc nhất và sạch sẽ 100%, không phát hiện từ trùng lặp nào.`;
        DOM.mergeAllDupsBtn?.classList.add('hidden');
        DOM.dedupList.innerHTML = `
            <div class="dedup-empty-state">
                <i class="ph-fill ph-check-circle"></i>
                <p>Kho từ vựng đã được làm sạch và tối ưu hóa 100%!</p>
            </div>
        `;
        return;
    }
    
    let summaryText = '';
    if (dups.length > 0 && internalDups.length > 0) {
        summaryText = `Phát hiện <strong>${dups.length} cặp từ trùng lặp</strong> và <strong>${internalDups.length} thẻ bị lặp từ trong phần nghĩa</strong>:`;
    } else if (dups.length > 0) {
        summaryText = `Phát hiện <strong>${dups.length} cặp từ trùng lặp</strong> cần xử lý:`;
    } else {
        summaryText = `Phát hiện <strong>${internalDups.length} thẻ có phần nghĩa tiếng Việt bị lặp từ</strong> cần làm sạch:`;
    }
    DOM.dedupSummaryText.innerHTML = summaryText;
    DOM.mergeAllDupsBtn?.classList.remove('hidden');

    // 1. Nếu có thẻ bị lặp nghĩa nội bộ, hiển thị hộp cảnh báo & nút 1-click làm sạch
    if (internalDups.length > 0) {
        const internalEl = document.createElement('div');
        internalEl.className = 'dedup-internal-alert-card';
        internalEl.innerHTML = `
            <div class="internal-alert-header">
                <div class="internal-alert-title">
                    <i class="ph-bold ph-magic-wand"></i>
                    <span>Có <strong>${internalDups.length} thẻ bị lặp nghĩa nội bộ</strong> (như: <em>${internalDups[0].card.english}</em>)</span>
                </div>
                <button id="clean-internal-meanings-btn" class="clean-internal-btn" title="Làm sạch nghĩa tiếng Việt cho toàn bộ ${internalDups.length} thẻ này">
                    <i class="ph-bold ph-sparkle"></i> Làm sạch tất cả nghĩa lặp
                </button>
            </div>
            <div class="internal-items-preview">
                ${internalDups.slice(0, 4).map(item => `
                    <div class="internal-dup-item">
                        <span class="internal-dup-word"><strong>${item.card.english}</strong> <span class="card-sub-tag">${item.card.type || 'N/A'}</span></span>
                        <div class="internal-dup-diff">
                            <span class="meaning-old" title="Nghĩa cũ">${item.originalMeaning}</span>
                            <i class="ph-bold ph-arrow-right"></i>
                            <span class="meaning-new" title="Nghĩa chuẩn sau khi làm sạch">${item.cleanedMeaning}</span>
                        </div>
                    </div>
                `).join('')}
                ${internalDups.length > 4 ? `<p class="internal-more-text">...và còn ${internalDups.length - 4} thẻ khác sẽ được tự động làm sạch cùng lúc.</p>` : ''}
            </div>
        `;

        internalEl.querySelector('#clean-internal-meanings-btn')?.addEventListener('click', () => {
            executeCleanAllInternalMeanings();
        });

        DOM.dedupList.appendChild(internalEl);
    }
    
    // 2. Render danh sách các cặp từ trùng lặp
    dups.forEach((item, idx) => {
        const pairEl = document.createElement('div');
        pairEl.className = 'dedup-pair-card';
        
        // Badge phân loại trùng lặp
        let categoryBadge = '';
        if (item.category === 'EXACT') {
            categoryBadge = `<span class="dedup-category-badge badge-exact"><i class="ph-bold ph-check-circle"></i> Trùng khớp 100%</span>`;
        } else if (item.category === 'INFLECTION') {
            categoryBadge = `<span class="dedup-category-badge badge-inflection"><i class="ph-bold ph-git-branch"></i> Biến thể ngữ pháp</span>`;
        } else if (item.category === 'FUZZY_TYPO') {
            categoryBadge = `<span class="dedup-category-badge badge-fuzzy"><i class="ph-bold ph-waveform"></i> Tìm kiếm mờ (Lệch chính tả)</span>`;
        } else {
            categoryBadge = `<span class="dedup-category-badge badge-exact"><i class="ph-bold ph-sparkle"></i> Tương đồng cao</span>`;
        }

        const isDifferentEnglish = item.cardA.english.toLowerCase().trim() !== item.cardB.english.toLowerCase().trim();
        const displayKey = isDifferentEnglish 
            ? `${item.cardA.english} <span class="key-arrow">⟷</span> ${item.cardB.english}`
            : item.cardA.english;

        pairEl.innerHTML = `
            <div class="dedup-pair-header">
                <span class="dedup-pair-num">#${idx + 1}</span>
                <span class="dedup-pair-key">${displayKey}</span>
                <div class="dedup-badges-group">
                    ${categoryBadge}
                    <span class="dedup-confidence-badge">${(item.confidence * 100).toFixed(0)}% tương đồng</span>
                </div>
            </div>
            <div class="dedup-pair-grid">
                <div class="dedup-card-sub card-primary">
                    <div class="card-sub-header">
                        <span class="card-sub-tag">${item.cardA.type || 'N/A'}</span>
                        <span class="status-badge status-${(item.cardA.srsStatus || 'New').toLowerCase()}">${item.cardA.srsStatus || 'New'} (${(item.cardA.stability || 1).toFixed(1)}d)</span>
                    </div>
                    <div class="card-sub-body">
                        <p class="meaning">${item.cardA.vietnamese || 'N/A'}</p>
                        <p class="example">${item.cardA.example || 'Chưa có ví dụ'}</p>
                    </div>
                </div>
                <div class="dedup-pair-divider">
                    <i class="ph ph-arrows-left-right"></i>
                </div>
                <div class="dedup-card-sub card-secondary">
                    <div class="card-sub-header">
                        <span class="card-sub-tag">${item.cardB.type || 'N/A'}</span>
                        <span class="status-badge status-${(item.cardB.srsStatus || 'New').toLowerCase()}">${item.cardB.srsStatus || 'New'} (${(item.cardB.stability || 1).toFixed(1)}d)</span>
                    </div>
                    <div class="card-sub-body">
                        <p class="meaning">${item.cardB.vietnamese || 'N/A'}</p>
                        <p class="example">${item.cardB.example || 'Chưa có ví dụ'}</p>
                    </div>
                </div>
            </div>
            ${item.suggestedVietnamese ? `
            <div class="dedup-preview-bar">
                <span class="preview-label"><i class="ph-bold ph-sparkle"></i> Nghĩa sau khi gộp & làm sạch:</span>
                <span class="preview-meaning">${item.suggestedVietnamese}</span>
            </div>` : ''}
            <div class="dedup-pair-actions">
                <button class="primary-btn merge-single-btn" data-key="${item.key}"><i class="ph-bold ph-arrows-merge"></i> Gộp 2 thẻ này</button>
            </div>
        `;
        
        pairEl.querySelector('.merge-single-btn')?.addEventListener('click', () => {
            executeMergeSingle(item.cardA, item.cardB);
        });
        
        DOM.dedupList.appendChild(pairEl);
    });
}

export function executeCleanAllInternalMeanings() {
    const { vocabulary } = getState();
    const internalDups = findInternalDuplicateCards(vocabulary);
    if (internalDups.length === 0) return;

    let currentVocab = [...vocabulary];
    const modifiedWords = [];

    internalDups.forEach(({ card, cleanedMeaning }) => {
        const targetIndex = currentVocab.findIndex(w => w.id === card.id);
        if (targetIndex > -1) {
            const updated = {
                ...currentVocab[targetIndex],
                vietnamese: cleanedMeaning,
                updatedAt: Date.now()
            };
            currentVocab[targetIndex] = updated;
            modifiedWords.push(updated);
        }
    });

    setVocabulary(currentVocab);
    saveVocabulary();

    // Sync to Firebase & update UI
    modifiedWords.forEach(word => saveOneWord(word));
    updatePanelWordList(false);
    showPopup(`Đã làm sạch thành công nghĩa lặp cho ${modifiedWords.length} thẻ từ!`, 'success');
    renderDedupPairs();
}

export function executeMergeSingle(cardA, cardB) {
    const { vocabulary } = getState();
    const { mergedCard, deletedCardId } = mergeDuplicateCards(cardA, cardB);

    const newVocab = vocabulary.map(w => {
        if (w.id === mergedCard.id) return mergedCard;
        if (w.id === deletedCardId) return { ...w, isDeleted: true, updatedAt: Date.now() };
        return w;
    });

    setVocabulary(newVocab);
    saveVocabulary();
    
    // Lưu và sync
    saveOneWord(mergedCard);
    const delWord = newVocab.find(w => w.id === deletedCardId);
    if (delWord) saveOneWord(delWord);

    updatePanelWordList(false);
    showToast('Đã gộp thành công!', `Đã hợp nhất thẻ "${mergedCard.english}".`, 'ph-sparkle');
    renderDedupPairs();
}

export function executeMergeAll() {
    const { vocabulary } = getState();
    const dups = findDuplicatePairs(vocabulary);
    const internalDups = findInternalDuplicateCards(vocabulary);
    if (dups.length === 0 && internalDups.length === 0) return;

    const totalActions = dups.length + internalDups.length;
    showConfirmation(`Bạn có chắc muốn tự động gộp ${dups.length} cặp từ trùng và làm sạch nghĩa cho ${internalDups.length} thẻ?`, () => {
        let currentVocab = [...getState().vocabulary];
        let modifiedWords = [];
        let mergedCount = 0;
        let cleanedCount = 0;

        // 1. Gộp các cặp trùng lặp
        dups.forEach(d => {
            const cardA = currentVocab.find(w => w.id === d.cardA.id && !w.isDeleted);
            const cardB = currentVocab.find(w => w.id === d.cardB.id && !w.isDeleted);
            if (cardA && cardB) {
                const { mergedCard, deletedCardId } = mergeDuplicateCards(cardA, cardB);
                currentVocab = currentVocab.map(w => {
                    if (w.id === mergedCard.id) return mergedCard;
                    if (w.id === deletedCardId) return { ...w, isDeleted: true, updatedAt: Date.now() };
                    return w;
                });
                mergedCount++;
                
                modifiedWords.push(mergedCard);
                const delWord = currentVocab.find(w => w.id === deletedCardId);
                if (delWord) modifiedWords.push(delWord);
            }
        });

        // 2. Tự động làm sạch các thẻ lặp nghĩa nội bộ còn lại
        const remainingInternal = findInternalDuplicateCards(currentVocab);
        remainingInternal.forEach(({ card, cleanedMeaning }) => {
            const targetIndex = currentVocab.findIndex(w => w.id === card.id && !w.isDeleted);
            if (targetIndex > -1) {
                const updated = {
                    ...currentVocab[targetIndex],
                    vietnamese: cleanedMeaning,
                    updatedAt: Date.now()
                };
                currentVocab[targetIndex] = updated;
                modifiedWords.push(updated);
                cleanedCount++;
            }
        });

        setVocabulary(currentVocab);
        saveVocabulary();
        
        // Sync queue cho tất cả các thẻ đã sửa
        modifiedWords.forEach(word => saveOneWord(word));
        updatePanelWordList(false);
        showPopup(`Hoàn tất! Đã gộp ${mergedCount} cặp từ và làm sạch ${cleanedCount} thẻ lặp nghĩa.`, 'success');
        renderDedupPairs();
    });
}

export function openFsrs7ConfigModal() {
    if (!DOM.fsrs7ConfigModal) return;
    const { userFsrs7Params, userFsrs7TrainedAt } = getState();

    if (DOM.fsrs7CurrentStatus) {
        if (userFsrs7Params && Array.isArray(userFsrs7Params) && userFsrs7Params.length === 34) {
            DOM.fsrs7CurrentStatus.textContent = "Đang dùng: Bộ Cá Nhân Hóa (34 params)";
            DOM.fsrs7CurrentStatus.style.color = "#a855f7";
        } else {
            DOM.fsrs7CurrentStatus.textContent = "Đang dùng: Bộ Mặc Định Chuẩn Lab (34 params)";
            DOM.fsrs7CurrentStatus.style.color = "#10b981";
        }
    }

    if (DOM.fsrs7TrainedTime) {
        if (userFsrs7TrainedAt) {
            DOM.fsrs7TrainedTime.textContent = `Cập nhật: ${new Date(userFsrs7TrainedAt).toLocaleString('vi-VN')}`;
        } else {
            DOM.fsrs7TrainedTime.textContent = "";
        }
    }

    if (DOM.fsrs7ParamsInput) {
        if (userFsrs7Params && Array.isArray(userFsrs7Params) && userFsrs7Params.length === 34) {
            DOM.fsrs7ParamsInput.value = JSON.stringify(userFsrs7Params, null, 2);
        } else {
            DOM.fsrs7ParamsInput.value = "";
        }
    }

    if (DOM.fsrs7ParamsFeedback) {
        DOM.fsrs7ParamsFeedback.textContent = "";
        DOM.fsrs7ParamsFeedback.style.color = "";
    }

    openModal(DOM.fsrs7ConfigModal);
}

export function closeFsrs7ConfigModal() {
    closeModal(DOM.fsrs7ConfigModal);
}

export { parseAndValidateFsrs7Params } from '../core/srs/constants.js';

