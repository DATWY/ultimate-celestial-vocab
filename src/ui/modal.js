import { nextRevision } from '../core/card-merge.js';
import { saveWordToDB } from '../core/idb.js';
import { setReviewQueue, trackEvent } from '../core/state.js';

import { DOM } from './elements.js';
import { getState, saveVocabulary, setVocabulary, setAllTags, saveOneWord } from '../core/state.js';
import { populateTopicFilters, updatePanelWordList, displayCard, updateUndoButtonState, refreshStudyAfterVocabularyChange } from './render.js';
import { trackWordAdded } from '../features/stat-trackers.js';
import { displayAppVersion } from '../core/versionCheck.js';
import { buildReviewQueue, getNextCardToReview } from '../core/queue.js';
import { playSound } from '../core/sound.js';
import { animateModalOpen, animateModalClose } from '../core/animations.js';
// Nạp động sync: modal.js nằm trong entry chunk, tránh kéo firebase 547 kB vào.
let _syncModulePromise = null;
function syncCardToFirebase(card) {
    if (!card || !card.id) return;
    if (!_syncModulePromise) _syncModulePromise = import('../core/sync.js');
    _syncModulePromise.then(module => module.syncCardToFirebase?.(card)).catch(() => {});
}
import { loadKeptSeparate, keepPairSeparate, keepPairsSeparate, clearKeptSeparate } from '../core/dedup-preferences.js';
import { findDuplicatePairs, findDuplicatePairsAsync, mergeDuplicateCards, findInternalDuplicateCards, cleanAndDeduplicateVietnamese, selectAutoMergePairs } from '../core/dedup.js';
import { escapeHTML } from '../core/utils/sanitize.js';
import { suspendCelestialCanvas, resumeCelestialCanvas } from './celestial-canvas.js';

let confirmCallback = null;
const modalStack = [];
const modalOpeners = new WeakMap();
const modalGenerations = new WeakMap();
const focusableSelector = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

function topModal() {
    return modalStack.filter(modal => !modal.classList.contains('hidden')).at(-1);
}

function modalFocusable(modal) {
    return [...modal.querySelectorAll(focusableSelector)].filter(element =>
        !element.closest('.hidden, [hidden], [inert]') && element.getClientRects().length);
}

if (typeof document !== 'undefined') {
    document.addEventListener('keydown', event => {
    const modal = topModal();
    if (!modal) return;
    if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        void closeModal(modal);
    } else if (event.key === 'Tab') {
        const items = modalFocusable(modal);
        const first = items[0], last = items.at(-1);
        if (!first) { event.preventDefault(); modal.focus(); return; }
        if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
            event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
            event.preventDefault(); first.focus();
        }
    }
    }, true);
}

export function openModal(modalElement) {
    if (!modalElement) return;
    if (modalElement.classList.contains('hidden')) modalOpeners.set(modalElement, document.activeElement);
    const existing = modalStack.indexOf(modalElement);
    if (existing >= 0) modalStack.splice(existing, 1);
    modalStack.push(modalElement);
    modalGenerations.set(modalElement, (modalGenerations.get(modalElement) || 0) + 1);
    // z-index theo độ sâu stack để modal mở sau luôn nằm TRÊN modal mở trước,
    // bất kể thứ tự xuất hiện trong DOM.
    if (modalElement.style) modalElement.style.zIndex = String(1000 + modalStack.length);
    modalElement.setAttribute('tabindex', '-1');
    document.body.classList.add('modal-active');
    suspendCelestialCanvas();
    modalElement.classList.remove('hidden');
    animateModalOpen(modalElement);
    setTimeout(() => {
        if (topModal() !== modalElement) return;
        (modalFocusable(modalElement)[0] || modalElement).focus();
    }, 50);
}

export async function closeModal(modalElement) {
    if (!modalElement || modalElement.classList.contains('hidden')) return;
    const generation = modalGenerations.get(modalElement);
    try {
        await animateModalClose(modalElement);
    } catch (e) {
        console.warn('Error during animateModalClose:', e);
    }
    // Trước đây phần dọn dẹp nằm trong `finally` và dùng `return` ở đó. `return`
    // trong `finally` nuốt luôn ngoại lệ đang lan ra và giá trị trả về của khối
    // try — ESLint no-unsafe-finally bắt đúng. Ở đây không có gì cần finally:
    // lỗi animation đã được catch ngay trên, nên chạy tuần tự là tương đương
    // về hành vi mà không còn cái bẫy đó.
    //
    // Modal bị MỞ LẠI trong lúc chờ animation ⇒ generation đã đổi ⇒ thoát sớm,
    // giữ nguyên stack/opener/body-class cho lần đóng sau.
    if (generation !== modalGenerations.get(modalElement)) return;
    modalElement.classList.add('hidden');
    if (modalElement.style) modalElement.style.zIndex = '';
    const position = modalStack.indexOf(modalElement);
    if (position >= 0) modalStack.splice(position, 1);
    const opener = modalOpeners.get(modalElement);
    const activeModal = topModal();
    if (opener?.isConnected && !opener.closest('.hidden') && (!activeModal || activeModal.contains(opener))) {
        opener.focus({ preventScroll: true });
    } else if (activeModal) (modalFocusable(activeModal)[0] || activeModal).focus();
    if (document.querySelectorAll('.modal:not(.hidden)').length === 0) {
        document.body.classList.remove('modal-active');
        resumeCelestialCanvas();
    }
}

// ── LOẠI THÔNG BÁO ──────────────────────────────────────────────────────────
// showPopup(message, type) nhận `type` ở 22 call site ('error' | 'success' |
// 'warning') nhưng bản cũ bỏ qua hoàn toàn: người dùng thấy hộp thoại lỗi và
// hộp thoại thành công GIỐNG HỆT NHAU. Hàm dưới đây biến `type` thành thứ nhìn
// thấy được (biểu tượng + data-type cho CSS) và chịu được giá trị lạ.
const POPUP_TYPE_ICONS = {
    info: 'ph-duotone ph-info',
    success: 'ph-duotone ph-check-circle',
    error: 'ph-duotone ph-x-circle',
    warning: 'ph-duotone ph-warning-circle',
    confirm: 'ph-duotone ph-question',
};
const DENIED_POPUP_TYPES = new Set(['__proto__', 'constructor', 'prototype']);

/** Chuẩn hoá loại thông báo: chỉ nhận 5 loại đã biết, còn lại rơi về 'info'. */
export function normalizePopupType(type) {
    const value = typeof type === 'string' ? type.trim().toLowerCase() : '';
    if (DENIED_POPUP_TYPES.has(value)) return 'info';
    return Object.prototype.hasOwnProperty.call(POPUP_TYPE_ICONS, value) ? value : 'info';
}

function applyPopupType(type) {
    const normalized = normalizePopupType(type);
    if (DOM.popupModal) {
        if (DOM.popupModal.dataset) DOM.popupModal.dataset.type = normalized;
        else DOM.popupModal.setAttribute('data-type', normalized);
    }
    const iconHost = document.getElementById('popup-icon');
    if (iconHost) iconHost.innerHTML = `<i class="${POPUP_TYPE_ICONS[normalized]}" aria-hidden="true"></i>`;
}

// CẢNH BÁO BẢO MẬT (T0.1): `isHTML = true` là API nguy hiểm vì gán thẳng innerHTML.
// - Chỉ truyền HTML do code tạo (nhãn tĩnh, số liệu).
// - MỌI dữ liệu người dùng (english, vietnamese, pronunciation, example, tags,
//   topic, tên file...) phải đi qua escapeHTML() của core/utils/sanitize.js
//   trước khi nội suy vào template.
// - Nếu chỉ cần hiển thị văn bản thuần, để mặc định isHTML = false (dùng textContent).
export function showPopup(message, type = 'info', isHTML = false) {
    if (!DOM.popupModal) return;
    applyPopupType(type);
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
    applyPopupType('confirm');
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
        if (DOM.inputSuspended) DOM.inputSuspended.checked = wordData.isSuspended === true;
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
    const button = document.getElementById('save-word-btn');
    if (button?.disabled) return;
    const id = DOM.editWordId.value || crypto.randomUUID();
    const editing = !!DOM.editWordId.value;
    const english = DOM.inputEnglish.value.trim(), vietnamese = cleanAndDeduplicateVietnamese(DOM.inputVietnamese.value.trim());
    if (!english || !vietnamese) { showPopup('Từ tiếng Anh và nghĩa tiếng Việt không được để trống.', 'warning'); return; }
    const previous = getState().vocabulary.find(card => card.id === id && !card.isDeleted);
    if (editing && !previous) { showPopup('Thẻ đã bị xóa hoặc thay đổi. Hãy mở lại từ kho từ vựng.', 'warning'); return; }
    const word = { ...(previous || { isStarred: false, srsStatus: 'New', srsInterval: 0, srsDueDate: null, lapses: 0, reps: 0 }),
        id, english, vietnamese, type: DOM.inputType.value.trim(), pronunciation: DOM.inputPronunciation.value.trim(),
        example: DOM.inputExample.value.trim(), tags: [...new Set(DOM.inputTags.value.split(',').map(tag => tag.trim()).filter(Boolean))],
        // C′-thay-thế: "tạm ẩn" là cách TRUNG THỰC để nói "tôi đã biết từ này",
        // thay vì gọi nó là Mastered (điều sai về khoa học trí nhớ).
        isSuspended: DOM.inputSuspended ? DOM.inputSuspended.checked === true : (previous?.isSuspended === true) };
    word.contentUpdatedAt = nextRevision(previous, 'contentUpdatedAt');
    word.updatedAt = Math.max(Date.now(), previous?.updatedAt || 0, word.contentUpdatedAt);
    const commit = async () => {
        if (button) button.disabled = true;
        try {
            const saved = await saveWordToDB(word);
            const { vocabulary, currentCardIndex } = getState();
            const currentId = vocabulary[currentCardIndex]?.id;
            const index = vocabulary.findIndex(card => card.id === id);
            const next = [...vocabulary];
            if (index < 0) next.push(saved); else next[index] = saved;
            setVocabulary(next);
            setAllTags(new Set(['all', ...next.filter(card => !card.isDeleted).flatMap(card => card.tags || [])]));
            syncCardToFirebase(saved);
            if (!editing) {
                trackEvent('manualWordsAdded');
                // GAME-01: wordsAddedToday (hurricane) + nightOwlWords (nightwalker).
                trackWordAdded(getState().gamification?.stats);
            }
            populateTopicFilters(true); buildReviewQueue(); updatePanelWordList();
            const activeIndex = next.findIndex(card => card.id === currentId && !card.isDeleted);
            if (activeIndex >= 0) { setReviewQueue(getState().currentReviewQueue.filter(i => i !== activeIndex)); displayCard(activeIndex); }
            else displayCard(getNextCardToReview());
            await closeModal(DOM.addEditModal);
            showToast(editing ? 'Đã lưu thay đổi' : 'Đã thêm từ mới', english, 'ph-check-circle');
            playSound('complete');
        } catch (error) {
            console.error('Không lưu được từ vựng:', error);
            showPopup('Chưa lưu được từ vựng. Nội dung vẫn được giữ trong biểu mẫu để bạn thử lại.', 'error');
        } finally { if (button) button.disabled = false; }
    };
    if (!editing && getState().vocabulary.some(card => !card.isDeleted && card.english.toLowerCase() === english.toLowerCase())) {
        showConfirmation(`Từ "${english}" đã có. Bạn muốn thêm một nghĩa hoặc từ loại khác?`, commit);
    } else void commit();
}



export function cancelEdit() {
    closeModal(DOM.addEditModal);
}

export function switchHubTab(targetTab = 'overview') {
    const tabAliases = {
        words: 'words',
        vocab: 'words',
        list: 'words',
        word: 'words',
        io: 'io',
        data: 'io',
        backup: 'io',
        overview: 'overview',
        profile: 'overview',
        stats: 'overview',
        persona: 'overview',
        fsrs: 'overview',
        whoiam: 'overview',
        badges: 'badges',
        achievements: 'badges'
    };
    const activeTabId = tabAliases[targetTab] || 'overview';

    const tabs = [
        { id: 'overview', tabEl: document.getElementById('tab-profile-overview'), paneEl: document.getElementById('profile-view-overview') },
        { id: 'words', tabEl: document.getElementById('tab-vocab-list'), paneEl: document.getElementById('manage-view-words') },
        { id: 'io', tabEl: document.getElementById('tab-data-io'), paneEl: document.getElementById('manage-view-io') },
        { id: 'badges', tabEl: document.getElementById('tab-profile-badges'), paneEl: document.getElementById('profile-view-badges') },
    ];

    tabs.forEach(t => {
        const isActive = (t.id === activeTabId);
        if (t.tabEl) {
            t.tabEl.classList.toggle('active', isActive);
            t.tabEl.setAttribute('aria-selected', isActive ? 'true' : 'false');
            t.tabEl.setAttribute('tabindex', isActive ? '0' : '-1');
            if (t.paneEl) t.tabEl.setAttribute('aria-controls', t.paneEl.id);
        }
        if (t.paneEl) {
            t.paneEl.setAttribute('role', 'tabpanel');
            if (t.tabEl) t.paneEl.setAttribute('aria-labelledby', t.tabEl.id);
            t.paneEl.classList.toggle('active', isActive);
            t.paneEl.classList.toggle('hidden', !isActive);
        }
    });

    const activeTabObj = tabs.find(t => t.id === activeTabId);
    const navTabsContainer = document.querySelector('.manage-nav-tabs');
    if (navTabsContainer && activeTabObj?.tabEl) {
        if (activeTabId === 'overview') {
            navTabsContainer.scrollTo({ left: 0, behavior: 'smooth' });
        } else {
            const tabEl = activeTabObj.tabEl;
            const containerRect = navTabsContainer.getBoundingClientRect();
            const tabRect = tabEl.getBoundingClientRect();
            const targetLeft = navTabsContainer.scrollLeft + (tabRect.left - containerRect.left) - (containerRect.width - tabRect.width) / 2;
            navTabsContainer.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
        }
    }

    const headerActions = document.querySelector('.manage-header-actions');
    if (headerActions) {
        const isWordsTab = (activeTabId === 'words');
        headerActions.classList.toggle('hidden', !isWordsTab);
        headerActions.style.display = isWordsTab ? 'flex' : 'none';
    }

    const managePanel = document.querySelector('.manage-panel');
    if (managePanel) {
        managePanel.classList.toggle('tab-overview', activeTabId === 'overview');
        managePanel.classList.toggle('tab-tall', activeTabId !== 'overview');
    }

    if (activeTabId === 'words') {
        updatePanelWordList(false);
        updateUndoButtonState?.();
    } else if (activeTabId === 'overview') {
        import('../features/gamification.js').then(m => m.renderGamificationUI?.({ force: true }));
    } else if (activeTabId === 'badges') {
        import('../features/gamification.js').then(m => (m.renderBadgesTab || m.renderGamificationUI)?.());
    } else if (activeTabId === 'io') {
        displayAppVersion?.();
        // io.js là chunk lười: gắn listener TRƯỚC khi refresh (setup idempotent)
        // để bấm Import/Export/Xoá ngay sau khi tab hiện ra vẫn có handler.
        import('../features/io.js').then(m => {
            m.setupIOEventListeners?.();
            m.refreshIoTabUI?.();
        });
    }
}

export function openManageModal(targetTab = 'overview') {
    if (!DOM.manageModal) return;
    // Tab "Dữ liệu" nằm trong chunk lười features/io.js. Nạp trước + gắn listener
    // ngay khi mở Hub (setup idempotent) để handler Import/Export/Xoá sẵn sàng
    // trước khi người dùng kịp bấm sang tab đó — không dựa vào setTimeout/idle.
    void import('../features/io.js')
        .then(module => module.setupIOEventListeners?.())
        .catch(() => { /* offline/chunk lỗi: refreshIoTabUI sẽ thử lại khi mở tab */ });
    if (DOM.panelTopicFilter) DOM.panelTopicFilter.value = getState().currentTopicFilter;
    if (DOM.manageSearchInput) DOM.manageSearchInput.value = '';
    
    openModal(DOM.manageModal);
    switchHubTab(targetTab);

    const navTabsContainer = document.querySelector('.manage-nav-tabs');
    requestAnimationFrame(() => {
        if (!navTabsContainer) return;
        const tabAliases = { overview: 'overview', stats: 'overview', words: 'words', vocab: 'words', list: 'words', word: 'words' };
        const resolvedTab = tabAliases[targetTab] || targetTab;
        if (resolvedTab === 'overview') {
            navTabsContainer.scrollLeft = 0;
        } else {
            const activeTab = navTabsContainer.querySelector('.manage-nav-tab.active');
            if (activeTab) {
                const cRect = navTabsContainer.getBoundingClientRect();
                const tRect = activeTab.getBoundingClientRect();
                const targetLeft = navTabsContainer.scrollLeft + (tRect.left - cRect.left) - (cRect.width - tRect.width) / 2;
                navTabsContainer.scrollLeft = Math.max(0, targetLeft);
            }
        }
    });
    
    const tabAliases = { words: 'words', vocab: 'words', list: 'words', word: 'words' };
    if (tabAliases[targetTab] === 'words') {
        setTimeout(() => DOM.manageSearchInput?.focus(), 80);
    }
}

export function openCelestialHub(targetTab = 'overview') {
    openManageModal(targetTab);
}

// --- Toast Notification System ---
// Hàng đợi: tối đa 3 toast hiển thị cùng lúc. Trước đây mỗi huy hiệu mở khóa
// tạo ngay một toast; nhập kho lớn có thể sinh 20–40 toast chồng nhau, mỗi toast
// là một layer + transition + filter, làm main thread và compositor quá tải.
// Giao diện/nội dung từng toast giữ nguyên, chỉ lần lượt hiện ra.
const MAX_VISIBLE_TOASTS = 3;
// Trên điện thoại hẹp, 3 toast xếp dọc che gần nửa màn hình (đo ở 320×568: mỗi
// toast ~90px ⇒ 3 cái = 270px). Giới hạn 2 cái; hàng đợi vẫn chạy tiếp vì
// container.childElementCount giảm khi toast tự ẩn.
function maxVisibleToasts() {
    if (typeof window === 'undefined') return MAX_VISIBLE_TOASTS;
    return window.innerWidth <= 480 ? 2 : MAX_VISIBLE_TOASTS;
}
const MAX_QUEUED_TOASTS = 12;
const _toastQueue = [];

function getToastContainer() {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }
    return container;
}

function renderToast({ title, message, iconClass }) {
    const container = getToastContainer();
    // Subset icon font chỉ gán glyph cho tổ hợp weight+icon (.ph-fill.ph-x:before).
    // Tên icon trơn bắt buộc phải ghép thêm weight, nếu không icon render rỗng.
    const hasWeight = /(^|\s)(ph|ph-fill|ph-bold|ph-duotone|ph-thin|ph-light)(\s|$)/.test(iconClass);
    const resolvedIconClass = hasWeight ? iconClass : `ph-fill ${iconClass}`;

    const toast = document.createElement('div');
    toast.className = 'toast-item';
    toast.innerHTML = `
        <div class="toast-icon">
            <i class="${resolvedIconClass}"></i>
        </div>
        <div class="toast-content">
            <div class="toast-title">${escapeHTML(title)}</div>
            ${message ? `<div class="toast-message">${escapeHTML(message)}</div>` : ''}
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
            if (toast.parentElement) toast.parentElement.removeChild(toast);
            drainToastQueue(); // hiện toast kế tiếp trong hàng đợi
        }, 400); // Đợi CSS transition chạy xong
    }, 4000);
}

function drainToastQueue() {
    const container = getToastContainer();
    while (_toastQueue.length > 0 && container.childElementCount < maxVisibleToasts()) {
        renderToast(_toastQueue.shift());
    }
}

export function showToast(title, message = '', iconClass = 'ph-trophy') {
    // Nếu hàng đợi quá dài (badge storm), bỏ bớt toast cũ nhất để không bao giờ
    // có một "dòng" thông báo kéo dài hàng phút.
    if (_toastQueue.length >= MAX_QUEUED_TOASTS) _toastQueue.shift();
    _toastQueue.push({ title, message, iconClass });
    drainToastQueue();
}

// --- Next-Gen Deduplication Modal & Smart Merge Handlers (v5.0 Fuzzy & Meaning Cleaning) ---

let _dedupScanToken = 0;
let _lastDedupScan = { vocabulary: null, dups: [] };

export function openDedupModal() {
    if (!DOM.dedupModal) return;
    openModal(DOM.dedupModal);
    if (DOM.dedupList) {
        DOM.dedupList.innerHTML = `
            <div class="dedup-loading-state" style="text-align: center; padding: 2rem;">
                <i class="ph-duotone ph-spinner animate-spin" style="font-size: 2rem; color: var(--primary-color, #8a2be2);"></i>
                <p style="margin-top: 0.5rem; color: var(--text-muted, #94a3b8);">Đang quét kho từ vựng...</p>
            </div>
        `;
    }
    setTimeout(() => {
        void renderDedupPairs();
    }, 16);
}

/**
 * Quét trùng theo lô, nhường main thread giữa các lô. Trước đây toàn bộ 3.000 từ
 * được quét đồng bộ trong 1 khối 1,3 giây làm treo giao diện.
 */
export async function renderDedupPairs() {
    const scanToken = ++_dedupScanToken;
    const { vocabulary } = getState();
    const dups = await findDuplicatePairsAsync(vocabulary, {
        onProgress: (phase, done, total) => {
            if (scanToken !== _dedupScanToken || !DOM.dedupSummaryText) return;
            DOM.dedupSummaryText.textContent = phase === 'index'
                ? `Đang lập chỉ mục ${done}/${total} từ...`
                : `Đang so khớp ${done}/${total} cặp ứng viên...`;
        }
    });
    if (scanToken !== _dedupScanToken) return;
    _lastDedupScan = { vocabulary, dups };
    // P10: cặp người dùng đã quyết định "giữ riêng" không được hiện lại (nếu không,
    // sự dai dẳng sẽ ép người dùng bấm "Gộp" cho xong — và mất một từ).
    const keptSeparate = loadKeptSeparate();
    const actionable = dups.filter(d => !keptSeparate.has(d.key));
    const keptCount = dups.length - actionable.length;
    const mergeableCount = actionable.filter(d => d.mergePolicy === 'safe').length;
    const variantCount = actionable.filter(d => d.mergePolicy === 'never').length;
    const reviewCount = actionable.filter(d => d.mergePolicy === 'review').length;
    const internalDups = findInternalDuplicateCards(vocabulary);
    
    if (!DOM.dedupList || !DOM.dedupSummaryText) return;
    
    DOM.dedupList.innerHTML = '';
    
    if (actionable.length === 0 && internalDups.length === 0) {
        DOM.dedupSummaryText.innerHTML = `<strong>Tuyệt vời!</strong> Toàn bộ <strong>${vocabulary.filter(w => !w.isDeleted).length} từ</strong> trong kho từ vựng đều độc nhất và sạch sẽ 100%, không phát hiện từ trùng lặp nào.`;
        DOM.mergeAllDupsBtn?.classList.add('hidden');
        const keptNote = keptCount > 0
            ? `<p class="dedup-empty-note">${keptCount} cặp đã được bạn chọn <strong>giữ riêng</strong> (biến thể ngữ pháp) — không hiện lại nữa.`
                + ` <button type="button" id="restore-kept-pairs-btn" class="dedup-link-btn">Hoàn tác</button></p>`
            : '';
        DOM.dedupList.innerHTML = `
            <div class="dedup-empty-state">
                <i class="ph-fill ph-check-circle"></i>
                <p>Kho từ vựng đã được làm sạch và tối ưu hóa 100%!</p>
                ${keptNote}
            </div>
        `;
        DOM.dedupList.querySelector('#restore-kept-pairs-btn')?.addEventListener('click', () => {
            clearKeptSeparate();
            showToast('Đã hoàn tác', 'Toàn bộ cặp "giữ riêng" sẽ hiện lại trong danh sách.', 'ph-arrow-counter-clockwise');
            void renderDedupPairs();
        });
        return;
    }
    
    let summaryText = '';
    if (actionable.length > 0 && internalDups.length > 0) {
        summaryText = `Phát hiện <strong>${actionable.length} cặp cần xem</strong> và <strong>${internalDups.length} thẻ bị lặp từ trong phần nghĩa</strong>:`;
    } else if (actionable.length > 0) {
        summaryText = `Phát hiện <strong>${actionable.length} cặp cần xem</strong>:`;
    } else {
        summaryText = `Phát hiện <strong>${internalDups.length} thẻ có phần nghĩa tiếng Việt bị lặp từ</strong> cần làm sạch:`;
    }
    if (keptCount > 0) {
        summaryText += ` <span class="dedup-kept-count">(${keptCount} cặp đã giữ riêng)</span>`;
    }
    DOM.dedupSummaryText.innerHTML = summaryText;

    // ── Hàng hành động hàng loạt AN TOÀN ────────────────────────────────────
    // Chỉ cặp EXACT (cùng mặt chữ, cùng nghĩa) mới được gộp hàng loạt; biến thể
    // ngữ pháp chỉ có một hành động an toàn là "giữ riêng".
    if (actionable.length > 0) {
        const bulk = document.createElement('div');
        bulk.className = 'dedup-bulk-row';
        bulk.innerHTML = `
            <div class="dedup-bulk-facts">
                <span class="dedup-fact fact-safe"><strong>${mergeableCount}</strong> trùng thật (gộp được)</span>
                <span class="dedup-fact fact-never"><strong>${variantCount}</strong> biến thể (giữ riêng)</span>
                ${reviewCount > 0 ? `<span class="dedup-fact fact-review"><strong>${reviewCount}</strong> lệch chính tả (cần xem)</span>` : ''}
            </div>
            <div class="dedup-bulk-actions">
                ${mergeableCount > 0 ? `<button type="button" id="bulk-merge-exact-btn" class="primary-btn dedup-bulk-btn"><i class="ph-bold ph-arrows-merge"></i> Gộp ${mergeableCount} cặp trùng thật</button>` : ''}
                ${variantCount > 0 ? `<button type="button" id="bulk-keep-variants-btn" class="dedup-bulk-btn secondary"><i class="ph-bold ph-git-branch"></i> Giữ riêng ${variantCount} cặp biến thể</button>` : ''}
                ${keptCount > 0 ? `<button type="button" id="bulk-restore-btn" class="dedup-link-btn">Hoàn tác ${keptCount} cặp đã giữ</button>` : ''}
            </div>
        `;
        DOM.dedupList.appendChild(bulk);
        bulk.querySelector('#bulk-merge-exact-btn')?.addEventListener('click', () => executeMergeAll());
        bulk.querySelector('#bulk-keep-variants-btn')?.addEventListener('click', () => {
            const keys = actionable.filter(d => d.mergePolicy === 'never').map(d => d.key);
            const added = keepPairsSeparate(keys);
            showToast('Đã giữ riêng', added + ' cặp biến thể ngữ pháp sẽ không hiện lại.', 'ph-git-branch');
            void renderDedupPairs();
        });
        bulk.querySelector('#bulk-restore-btn')?.addEventListener('click', () => {
            clearKeptSeparate();
            showToast('Đã hoàn tác', 'Toàn bộ cặp "giữ riêng" sẽ hiện lại.', 'ph-arrow-counter-clockwise');
            void renderDedupPairs();
        });
    }
    DOM.mergeAllDupsBtn?.classList.remove('hidden');

    // 1. Nếu có thẻ bị lặp nghĩa nội bộ, hiển thị hộp cảnh báo & nút 1-click làm sạch
    if (internalDups.length > 0) {
        const internalEl = document.createElement('div');
        internalEl.className = 'dedup-internal-alert-card';
        internalEl.innerHTML = `
            <div class="internal-alert-header">
                <div class="internal-alert-title">
                    <i class="ph-bold ph-magic-wand"></i>
                    <span>Có <strong>${internalDups.length} thẻ bị lặp nghĩa nội bộ</strong> (như: <em>${escapeHTML(internalDups[0].card.english)}</em>)</span>
                </div>
                <button id="clean-internal-meanings-btn" class="clean-internal-btn" title="Làm sạch nghĩa tiếng Việt cho toàn bộ ${internalDups.length} thẻ này">
                    <i class="ph-bold ph-sparkle"></i> Làm sạch tất cả nghĩa lặp
                </button>
            </div>
            <div class="internal-items-preview">
                ${internalDups.slice(0, 4).map(item => `
                    <div class="internal-dup-item">
                        <span class="internal-dup-word"><strong>${escapeHTML(item.card.english)}</strong> <span class="card-sub-tag">${escapeHTML(item.card.type || 'N/A')}</span></span>
                        <div class="internal-dup-diff">
                            <span class="meaning-old" title="Nghĩa cũ">${escapeHTML(item.originalMeaning)}</span>
                            <i class="ph-bold ph-arrow-right"></i>
                            <span class="meaning-new" title="Nghĩa chuẩn sau khi làm sạch">${escapeHTML(item.cleanedMeaning)}</span>
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
    
    // 2. Render danh sách các cặp từ trùng lặp (chỉ cặp chưa "giữ riêng")
    actionable.forEach((item, idx) => {
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
        // P10: nói rõ cặp này CÓ ĐƯỢC GỘP HAY KHÔNG, ngay trong nhãn.
        const policyBadge = item.mergePolicy === 'never'
            ? '<span class="dedup-policy-badge policy-never"><i class="ph-bold ph-prohibit"></i> Không nên gộp</span>'
            : (item.mergePolicy === 'review'
                ? '<span class="dedup-policy-badge policy-review"><i class="ph-bold ph-magnifying-glass"></i> Cần xem tay</span>'
                : '<span class="dedup-policy-badge policy-safe"><i class="ph-bold ph-check"></i> Gộp được</span>');

        const safeEngA = escapeHTML(item.cardA.english);
        const safeEngB = escapeHTML(item.cardB.english);
        const isDifferentEnglish = item.cardA.english.toLowerCase().trim() !== item.cardB.english.toLowerCase().trim();
        const displayKey = isDifferentEnglish 
            ? `${safeEngA} <span class="key-arrow">⟷</span> ${safeEngB}`
            : safeEngA;

        pairEl.innerHTML = `
            <div class="dedup-pair-header">
                <span class="dedup-pair-num">#${idx + 1}</span>
                <span class="dedup-pair-key">${displayKey}</span>
                <div class="dedup-badges-group">
                    ${categoryBadge}
                    ${policyBadge}
                    ${item.category === 'EXACT' ? '' : `<span class="dedup-confidence-badge">${(item.confidence * 100).toFixed(0)}% tương đồng</span>`}
                </div>
            </div>
            <div class="dedup-pair-grid">
                <div class="dedup-card-sub card-primary">
                    <div class="card-sub-header">
                        <span class="card-sub-tag">${escapeHTML(item.cardA.type || 'N/A')}</span>
                        <span class="status-badge status-${(item.cardA.srsStatus || 'New').toLowerCase()}">${escapeHTML(item.cardA.srsStatus || 'New')} (${(item.cardA.stability || 1).toFixed(1)}d)</span>
                    </div>
                    <div class="card-sub-body">
                        <p class="meaning">${escapeHTML(item.cardA.vietnamese || 'N/A')}</p>
                        <p class="example">${escapeHTML(item.cardA.example || 'Chưa có ví dụ')}</p>
                    </div>
                </div>
                <div class="dedup-pair-divider">
                    <i class="ph-duotone ph-arrows-left-right"></i>
                </div>
                <div class="dedup-card-sub card-secondary">
                    <div class="card-sub-header">
                        <span class="card-sub-tag">${escapeHTML(item.cardB.type || 'N/A')}</span>
                        <span class="status-badge status-${(item.cardB.srsStatus || 'New').toLowerCase()}">${escapeHTML(item.cardB.srsStatus || 'New')} (${(item.cardB.stability || 1).toFixed(1)}d)</span>
                    </div>
                    <div class="card-sub-body">
                        <p class="meaning">${escapeHTML(item.cardB.vietnamese || 'N/A')}</p>
                        <p class="example">${escapeHTML(item.cardB.example || 'Chưa có ví dụ')}</p>
                    </div>
                </div>
            </div>
            ${item.suggestedVietnamese ? `
            <div class="dedup-preview-bar">
                <span class="preview-label"><i class="ph-bold ph-sparkle"></i> Nghĩa sau khi gộp & làm sạch:</span>
                <span class="preview-meaning">${escapeHTML(item.suggestedVietnamese)}</span>
            </div>` : ''}
            ${item.reason ? `<p class="dedup-reason"><i class="ph-bold ph-info"></i> ${escapeHTML(item.reason)}</p>` : ''}
            ${item.practiceNote ? `<p class="dedup-practice-note">${escapeHTML(item.practiceNote)}</p>` : ''}
            <div class="dedup-pair-actions">
                ${item.mergePolicy === 'never'
                    ? `<button class="dedup-action-btn keep-separate-btn" data-key="${escapeHTML(item.key)}"><i class="ph-bold ph-git-branch"></i> Giữ riêng (2 từ khác nhau)</button>
                       <button class="dedup-link-btn force-merge-btn" data-key="${escapeHTML(item.key)}">Vẫn gộp…</button>`
                    : (item.mergePolicy === 'review'
                        ? `<button class="primary-btn merge-single-btn" data-key="${escapeHTML(item.key)}"><i class="ph-bold ph-arrows-merge"></i> Gộp (đã kiểm tra chính tả)</button>
                           <button class="dedup-link-btn keep-separate-btn" data-key="${escapeHTML(item.key)}">Giữ riêng</button>`
                        : `<button class="primary-btn merge-single-btn" data-key="${escapeHTML(item.key)}"><i class="ph-bold ph-arrows-merge"></i> Gộp 2 thẻ này</button>
                           <button class="dedup-link-btn keep-separate-btn" data-key="${escapeHTML(item.key)}">Giữ riêng</button>`)}
            </div>
        `;
        
        pairEl.querySelector('.merge-single-btn')?.addEventListener('click', () => {
            executeMergeSingle(item.cardA, item.cardB);
        });
        pairEl.querySelector('.keep-separate-btn')?.addEventListener('click', () => {
            keepPairSeparate(item.key);
            showToast('Đã giữ riêng', `"${item.cardA.english}" và "${item.cardB.english}" sẽ không bị gộp và không hiện lại.`, 'ph-git-branch');
            void renderDedupPairs();
        });
        pairEl.querySelector('.force-merge-btn')?.addEventListener('click', () => {
            // Gộp biến thể là hành động PHÁ DỮ LIỆU HỌC: phải nói rõ hậu quả.
            showConfirmation(
                `"${item.cardA.english}" và "${item.cardB.english}" là hai DẠNG của cùng một từ. `
                + 'Gộp sẽ xoá một dạng và nhập nghĩa của nó vào thẻ còn lại — bạn sẽ không còn luyện dạng đó nữa. '
                + 'Chỉ nên gộp nếu bạn chắc chắn không cần học riêng dạng này. Vẫn gộp?',
                () => executeMergeSingle(item.cardA, item.cardB)
            );
        });
        
        DOM.dedupList.appendChild(pairEl);
    });
}

export function executeCleanAllInternalMeanings() {
    const { vocabulary } = getState();
    const internalDups = findInternalDuplicateCards(vocabulary);
    if (internalDups.length === 0) return;

    const currentVocab = [...vocabulary];
    const modifiedWords = [];

    internalDups.forEach(({ card, cleanedMeaning }) => {
        const targetIndex = currentVocab.findIndex(w => w.id === card.id);
        if (targetIndex > -1) {
            const updated = {
                ...currentVocab[targetIndex],
                vietnamese: cleanedMeaning,
                updatedAt: Date.now(), contentUpdatedAt: Date.now()
            };
            currentVocab[targetIndex] = updated;
            modifiedWords.push(updated);
        }
    });

    setVocabulary(currentVocab);
    saveVocabulary(true);

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
        if (w.id === deletedCardId) return { ...w, isDeleted: true, updatedAt: Date.now(), contentUpdatedAt: Date.now() };
        return w;
    });

    setVocabulary(newVocab);
    saveVocabulary(true);
    
    // Lưu và sync
    saveOneWord(mergedCard);
    const delWord = newVocab.find(w => w.id === deletedCardId);
    if (delWord) saveOneWord(delWord);

    updatePanelWordList(false);
    showToast('Đã gộp thành công!', `Đã hợp nhất thẻ "${mergedCard.english}".`, 'ph-sparkle');
    void renderDedupPairs();
}

export function executeMergeAll() {
    const { vocabulary } = getState();
    // Dùng lại kết quả quét vừa hiển thị nếu vocabulary chưa đổi, tránh quét lại 1,3 s.
    const dups = _lastDedupScan.vocabulary === vocabulary ? _lastDedupScan.dups : findDuplicatePairs(vocabulary);
    const internalDups = findInternalDuplicateCards(vocabulary);
    if (dups.length === 0 && internalDups.length === 0) return;

    // An toàn dữ liệu: chỉ gộp tự động các cặp CHẮC CHẮN cùng một từ.
    // Cặp chỉ "giống chính tả" (FUZZY_TYPO) hoặc confidence thấp được để lại
    // cho người dùng xem từng cặp — gộp nhầm là xoá mất một từ vĩnh viễn.
    const { safe: safePairs, review: reviewPairs } = selectAutoMergePairs(dups);
    const autoMergeable = safePairs.length;
    const reviewNote = reviewPairs.length > 0
        ? ` ${reviewPairs.length} cặp còn lại (biến thể ngữ pháp / lệch chính tả) sẽ được GIỮ LẠI để bạn tự kiểm tra.`
        : '';

    // P4: từ nay chỉ cặp EXACT (cùng một từ) mới được tự gộp, nên có trường hợp
    // không còn cặp nào đủ chắc chắn. Đừng hỏi "Gộp tự động 0 cặp?" — vô nghĩa.
    if (autoMergeable === 0 && internalDups.length === 0) {
        showPopup(reviewPairs.length > 0
            ? `Không có cặp nào đủ chắc chắn để tự gộp. ${reviewPairs.length} cặp cần bạn xem và xác nhận từng cặp bên dưới.`
            : 'Không tìm thấy từ vựng trùng lặp nào.', 'info');
        return;
    }
    const title = autoMergeable > 0
        ? `Gộp tự động ${autoMergeable} cặp chắc chắn trùng và làm sạch nghĩa cho ${internalDups.length} thẻ?`
        : `Làm sạch nghĩa cho ${internalDups.length} thẻ (không có cặp nào đủ chắc chắn để tự gộp)?`;
    showConfirmation(`${title}${reviewNote}`, () => {
        let currentVocab = [...getState().vocabulary];
        const modifiedWords = [];
        let mergedCount = 0;
        let cleanedCount = 0;

        // 1. Gộp các cặp trùng lặp (chỉ rổ an toàn)
        safePairs.forEach(d => {
            const cardA = currentVocab.find(w => w.id === d.cardA.id && !w.isDeleted);
            const cardB = currentVocab.find(w => w.id === d.cardB.id && !w.isDeleted);
            if (cardA && cardB) {
                const { mergedCard, deletedCardId } = mergeDuplicateCards(cardA, cardB);
                currentVocab = currentVocab.map(w => {
                    if (w.id === mergedCard.id) return mergedCard;
                    if (w.id === deletedCardId) return { ...w, isDeleted: true, updatedAt: Date.now(), contentUpdatedAt: Date.now() };
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
                    updatedAt: Date.now(), contentUpdatedAt: Date.now()
                };
                currentVocab[targetIndex] = updated;
                modifiedWords.push(updated);
                cleanedCount++;
            }
        });

        setVocabulary(currentVocab);
        saveVocabulary(true);

        // Sync queue cho tất cả các thẻ đã sửa
        modifiedWords.forEach(word => saveOneWord(word));
        updatePanelWordList(false);
        // UI-02: gộp xong hàng đợi ôn phải dựng lại ngay — thẻ vừa bị gộp (isDeleted)
        // có thể đang là thẻ hiện tại trên màn hình học.
        refreshStudyAfterVocabularyChange(modifiedWords.filter(w => w.isDeleted).map(w => w.id));
        const skippedNote = reviewPairs.length > 0 ? ` ${reviewPairs.length} cặp lệch chính tả cần bạn xem tay.` : '';
        showPopup(`Hoàn tất! Đã gộp ${mergedCount} cặp từ và làm sạch ${cleanedCount} thẻ lặp nghĩa.${skippedNote}`, 'success');
        void renderDedupPairs();
    });
}

export function openFsrs7ConfigModal() {
    if (!DOM.fsrs7ConfigModal) return;
    const { userFsrs7Params, userFsrs7TrainedAt } = getState();

    if (DOM.fsrs7CurrentStatus) {
        if (userFsrs7Params && Array.isArray(userFsrs7Params) && userFsrs7Params.length === 34) {
            DOM.fsrs7CurrentStatus.textContent = "Đang dùng: Bộ cá nhân hóa (34 tham số)";
            DOM.fsrs7CurrentStatus.style.color = "#a855f7";
        } else {
            DOM.fsrs7CurrentStatus.textContent = "Đang dùng: Bộ mặc định (34 tham số)";
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

