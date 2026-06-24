
import { DOM } from './elements.js';
import { getState, saveVocabulary, setVocabulary, setAllTags } from '../core/state.js';
import { populateTopicFilters, updatePanelWordList, displayCard, checkAndCleanupTags } from './render.js';
import { buildReviewQueue, getNextCardToReview } from '../core/srs.js';
import { playSound } from '../core/sound.js';
import { animateModalOpen, animateModalClose } from '../core/animations.js';

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
    const vietnameseInput = DOM.inputVietnamese.value.trim();
    if (!englishInput || !vietnameseInput) {
        showPopup("Từ tiếng Anh và nghĩa tiếng Việt không được để trống.", "warning");
        return;
    }
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
        vocabulary[existingIndex] = { ...oldWord, ...wordData };
        showPopup("Đã cập nhật từ vựng thành công!", "success");
        if (existingIndex === currentCardIndex) {
            displayCard(currentCardIndex);
        }
    } else {
        const duplicateExists = vocabulary.some(w => w.english.toLowerCase() === englishInput.toLowerCase());
        if (duplicateExists) {
            showConfirmation(`Từ "${englishInput}" đã có trong từ điển. Bạn vẫn muốn thêm?`, () => {
                addNewWord({ ...wordData, isStarred: false, srsStatus: 'New', srsInterval: 0, srsEaseFactor: 2.5, srsDueDate: null, lapses: 0, isSuspended: false });
                saveAndRefreshUI(tagsHaveChanged);
                closeModal(DOM.addEditModal);
            });
            return;
        } else {
            addNewWord({ ...wordData, isStarred: false, srsStatus: 'New', srsInterval: 0, srsEaseFactor: 2.5, srsDueDate: null, lapses: 0, isSuspended: false });
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
    updatePanelWordList();
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
