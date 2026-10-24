import { exportVocabularyTsv } from '../core/tabular.js';
import { planVocabularyImport } from '../core/import-plan.js';
// src/features/io.js

import { DOM } from '../ui/elements.js';
import { getState, setVocabulary, setAllTags, saveVocabulary, trackEvent } from '../core/state.js';
import { showPopup, showConfirmation, closeModal, openModal } from '../ui/modal.js';
import { populateTopicFilters, updatePanelWordList, displayCard } from '../ui/render.js';
import { buildReviewQueue, getNextCardToReview } from '../core/queue.js';
import { playSound } from '../core/sound.js';
// Nạp động: io.js nằm trong entry chunk, không kéo firebase vào critical path.
let _syncModulePromise = null;
function syncCardToFirebase(card) {
    if (!card || !card.id) return;
    if (!_syncModulePromise) _syncModulePromise = import('../core/sync.js');
    _syncModulePromise.then(module => module.syncCardToFirebase?.(card)).catch(() => {});
}
import { saveAllVocabularyToDB } from '../core/idb.js';
import { checkAppVersion } from '../core/versionCheck.js';
import { canonicalEnglish, canonicalPartOfSpeech, calculateSemanticSimilarity, isDuplicateCard, cleanAndDeduplicateVietnamese } from '../core/dedup.js';

let parsedImportData = {
    newItems: [],
    updateItems: []
};

// Nâng cấp: Xử lý sự kiện chọn file để xem trước
export function setupIOEventListeners() {
    DOM.exportBtn?.addEventListener('click', handleExport);
    DOM.exportLogsBtn?.addEventListener('click', handleExportLogs);
    DOM.configFsrs7Btn?.addEventListener('click', () => {
        import('../ui/modal.js').then(m => m.openFsrs7ConfigModal());
    });
    DOM.closeFsrs7ModalBtn?.addEventListener('click', () => {
        import('../ui/modal.js').then(m => m.closeFsrs7ConfigModal());
    });
    DOM.cancelFsrs7Btn?.addEventListener('click', () => {
        import('../ui/modal.js').then(m => m.closeFsrs7ConfigModal());
    });
    DOM.fsrs7ConfigOverlay?.addEventListener('click', () => {
        import('../ui/modal.js').then(m => m.closeFsrs7ConfigModal());
    });
    DOM.resetFsrs7Btn?.addEventListener('click', handleResetFsrs7);
    DOM.saveFsrs7Btn?.addEventListener('click', handleSaveFsrs7);
    document.getElementById('run-optimizer-btn')?.addEventListener('click', async event => {
        const button = event.currentTarget;
        const status = document.getElementById('optimizer-feedback');
        button.disabled = true;
        status.textContent = 'Đang kiểm tra lịch sử học… Bạn có thể tiếp tục dùng ứng dụng.';
        try {
            const { runOptimizer, optimizerMessage } = await import('../core/srs/worker-manager.js');
            const result = await runOptimizer();
            status.textContent = optimizerMessage(result);
            if (result.improved) {
                DOM.fsrs7ParamsInput.value = JSON.stringify(result.params, null, 2);
                DOM.fsrs7CurrentStatus.textContent = 'Đang dùng: Bộ cá nhân hóa (34 tham số)';
            }
        } catch (error) { status.textContent = error.message; }
        finally { button.disabled = false; }
    });

    DOM.clearAllBtn?.addEventListener('click', handleClearAllData);

    // Nút kiểm tra phiên bản & cập nhật thủ công
    document.getElementById('btn-check-update')?.addEventListener('click', () => {
        checkAppVersion({ isManual: true });
    });

    // Sự kiện Đồng bộ đa thiết bị
    document.getElementById('copy-sync-key-btn')?.addEventListener('click', handleCopySyncKey);
    document.getElementById('apply-sync-key-btn')?.addEventListener('click', handleApplySyncKey);
    document.getElementById('download-all-audio-btn')?.addEventListener('click', handleDownloadAllAudio);

    DOM.importFile?.addEventListener('change', handleFileSelect);

    // Listener cho modal xem trước
    const importPreviewModal = document.getElementById('import-preview-modal');
    document.getElementById('close-import-preview-modal-btn')?.addEventListener('click', () => closeModal(importPreviewModal));
    document.getElementById('cancel-import-btn')?.addEventListener('click', () => closeModal(importPreviewModal));
    document.getElementById('confirm-import-btn')?.addEventListener('click', confirmImport);

    // Tab Logic
    const importTabs = document.querySelectorAll('.import-tab');
    const importPanels = document.querySelectorAll('.import-panel');
    importTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            importTabs.forEach(t => t.classList.remove('active'));
            importPanels.forEach(p => p.classList.add('hidden'));
            importPanels.forEach(p => p.classList.remove('active'));

            tab.classList.add('active');
            const target = document.getElementById(tab.dataset.target);
            if (target) {
                target.classList.remove('hidden');
                target.classList.add('active');
            }
        });
    });

    // Handle Text Import
    const importTextBtn = document.getElementById('import-text-btn');
    importTextBtn?.addEventListener('click', () => {
        const textArea = document.getElementById('import-text-area');
        const content = textArea.value;
        if (!content.trim()) {
            showPopup('Vui lòng dán nội dung vào ô văn bản.', 'error');
            return;
        }
        previewImport(content, 'Dữ liệu dán tay');
    });

    // Handle Drag & Drop Dropzone
    const dropZone = document.getElementById('drop-zone');
    if (dropZone) {
        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.add('is-dragover');
            }, false);
        });
        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.remove('is-dragover');
            }, false);
        });
        dropZone.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;
            if (files && files.length > 0) {
                readImportFile(files[0]);
            }
        });
    }
}

function handleFileSelect(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    readImportFile(file);
    event.target.value = ''; // Allow selecting the same file again after correction.
}

function readImportFile(file) {
    if (file.size > 10 * 1024 * 1024) { showPopup('Mỗi lần nhập tối đa 10 MB. Vui lòng chia nhỏ tệp.', 'warning'); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
        const content = e.target.result;
        if (typeof content === 'string') {
            previewImport(content, file.name);
        }
    };
    reader.onerror = () => showPopup('Không đọc được tệp. Vui lòng chọn lại hoặc dán nội dung trực tiếp.', 'error');
    reader.readAsText(file, 'UTF-8');
}

function previewImport(content, fileName) {
    let plan;
    try { plan = planVocabularyImport(content, getState().vocabulary); }
    catch (error) { showPopup(error.message, 'error'); return; }
    parsedImportData = { text: content, plan };
    document.getElementById('import-filename').textContent = fileName;
    document.getElementById('import-stats-new').textContent = plan.newItems.length;
    document.getElementById('import-stats-updated').textContent = plan.updateItems.length;
    document.getElementById('import-stats-skipped').textContent = plan.skipped;
    document.getElementById('import-stats-errors').textContent = plan.errors.length;
    document.getElementById('import-error-details').textContent = plan.errors.slice(0, 5)
        .map(error => `Dòng ${error.line}: ${error.message}`).join('\n');
    document.getElementById('confirm-import-btn').disabled = !plan.newItems.length && !plan.updateItems.length;
    const previewTable = document.getElementById('import-preview-table');
    previewTable.innerHTML = '<thead><tr><th>Từ vựng</th><th>Nghĩa</th><th>Từ loại</th><th>Thao tác</th></tr></thead>';
    const tbody = document.createElement('tbody');
    const preview = [...plan.newItems.map(card => ({ card, status: 'Thêm mới' })),
        ...plan.updateItems.map(card => ({ card, status: 'Bổ sung nội dung' }))];
    for (const { card, status } of preview.slice(0, 10)) {
        const row = tbody.insertRow();
        for (const value of [card.english, card.vietnamese, card.type, status]) row.insertCell().textContent = value || '';
    }
    previewTable.appendChild(tbody);
    openModal(document.getElementById('import-preview-modal'));
}

async function confirmImport() {
    if (!parsedImportData.text || parsedImportData.busy) return;
    parsedImportData.busy = true;
    const button = document.getElementById('confirm-import-btn');
    button.disabled = true;
    try {
        const { vocabulary } = getState();
        // Recheck against current data: the preview may have remained open during sync.
        const plan = planVocabularyImport(parsedImportData.text, vocabulary);
        const updated = new Map(plan.updateItems.map(card => [card.id, card]));
        const proposed = [...vocabulary.map(card => updated.get(card.id) || card), ...plan.newItems];
        // Chỉ đánh dấu dirty cho các dòng thực sự thay đổi, KHÔNG đánh dấu toàn bộ kho.
        // Nhờ vậy các thẻ cũ (kể cả tombstone) giữ nguyên bản ghi outbox hiện có.
        const changedIds = new Set([...plan.newItems, ...plan.updateItems].map(card => card.id));
        const next = await saveAllVocabularyToDB(proposed, { markDirty: false, dirtyIds: changedIds });
        setVocabulary(next);
        setAllTags(new Set(['all', ...next.filter(card => !card.isDeleted).flatMap(card => card.tags || [])]));
        [...plan.newItems, ...plan.updateItems].forEach(syncCardToFirebase);
        populateTopicFilters(true);
        buildReviewQueue(); updatePanelWordList(); displayCard(getNextCardToReview());
        closeModal(document.getElementById('import-preview-modal'));
        trackEvent('imports', plan.newItems.length + plan.updateItems.length);
        showPopup(`Đã lưu ${plan.newItems.length} từ mới, bổ sung ${plan.updateItems.length} từ. ${plan.errors.length} dòng lỗi không được nhập.`, 'success');
        playSound('complete');
        parsedImportData = { newItems: [], updateItems: [] };
        const input = document.getElementById('import-text-area');
        if (input) input.value = '';
    } catch (error) {
        console.error('Import failed:', error);
        showPopup('Chưa lưu được dữ liệu. Bản xem trước vẫn được giữ để bạn thử lại.', 'error');
    } finally {
        parsedImportData.busy = false;
        button.disabled = false;
    }
}

// Sửa lỗi: hàm xóa toàn bộ
function handleClearAllData() {
    console.log("Bước 1: handleClearAllData được kích hoạt!");

    showConfirmation("!!! CẢNH BÁO !!!\nBạn có chắc muốn xóa TOÀN BỘ từ vựng không? Thao tác cũng xóa trên Cloud sau khi đồng bộ và không thể hoàn tác trong ứng dụng.",
        () => {
            console.log("Bước 2: Callback xác nhận lần 1 được gọi.");
            showConfirmation("!!! XÁC NHẬN LẦN CUỐI !!!\nBạn thực sự muốn xóa tất cả?",
                async () => {
                    console.log("Bước 3: Callback xác nhận lần 2 được gọi. Bắt đầu xóa...");
                    try {
                        const { vocabulary } = getState();
                        const now = Date.now();
                        
                        // Keep local tombstones until the server acknowledges deletion.
                        const tombstones = vocabulary.map(card => ({ ...card, isDeleted: true, deletedAt: now, updatedAt: now }));
                        await saveAllVocabularyToDB(tombstones, { markDirty: true });
                        setVocabulary(tombstones);
                        tombstones.forEach(syncCardToFirebase);
                        setAllTags(new Set(['all']));
                        localStorage.removeItem('celestialVocab');

                        populateTopicFilters(true);
                        buildReviewQueue();
                        updatePanelWordList();
                        displayCard(-1);
                        closeModal(DOM.manageModal);
                        
                        showPopup("Đã xóa toàn bộ từ vựng trên máy. Thao tác xóa sẽ được đồng bộ khi có kết nối mạng.", "success");
                        playSound('delete');
                        console.log("Bước 4: Xóa thành công!");
                    } catch (e) {
                        console.error("Lỗi trong quá trình xóa dữ liệu:", e);
                        showPopup("Có lỗi xảy ra khi xóa dữ liệu!", "error");
                    }
                }
            );
        }
    );
}


export function handleExport() {
    const { vocabulary } = getState();
    if (!vocabulary.some(card => !card.isDeleted)) {
        showPopup("Không có từ vựng nào để xuất.", "info");
        return;
    }
    const fileContent = exportVocabularyTsv(vocabulary);
    const blob = new Blob([fileContent], { type: 'text/tab-separated-values;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const timestamp = new Date().toISOString().slice(0, 10);
    link.download = `celestial_vocab_${timestamp}.tsv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    playSound('complete');
    trackEvent('exports');
    showPopup("Xuất dữ liệu thành công!", "success");
}

function handleExportLogs() {
    import('../core/state.js').then(m => {
        const result = m.exportReviewLogsAsJson();
        if (result.success) {
            playSound('complete');
            showPopup(`Đã xuất thành công ${result.count} lượt ôn tập ra file JSON. Bạn có thể dùng file này để chạy tool huấn luyện!`, 'success');
        } else {
            showPopup("Chưa có dữ liệu ôn tập nào trong hệ thống để xuất.", "info");
        }
    });
}

function handleResetFsrs7() {
    showConfirmation("Bạn có chắc muốn khôi phục về bộ tham số FSRS-7 mặc định chuẩn lab?", async () => {
        const { setUserFsrs7Params } = await import('../core/state.js');
        const res = await setUserFsrs7Params(null);
        if (res.success) {
            import('../core/sync.js').then(s => s.syncUserSettingsToFirebase());
            if (DOM.fsrs7CurrentStatus) {
                DOM.fsrs7CurrentStatus.textContent = "Đang dùng: Bộ mặc định (34 tham số)";
                DOM.fsrs7CurrentStatus.style.color = "#10b981";
            }
            if (DOM.fsrs7TrainedTime) DOM.fsrs7TrainedTime.textContent = "";
            if (DOM.fsrs7ParamsInput) DOM.fsrs7ParamsInput.value = "";
            if (DOM.fsrs7ParamsFeedback) {
                DOM.fsrs7ParamsFeedback.textContent = "Đã khôi phục về bộ thông số mặc định thành công.";
                DOM.fsrs7ParamsFeedback.style.color = "#10b981";
            }
            showPopup("Đã khôi phục về bộ 34 tham số FSRS-7 mặc định thành công!", "success");
        }
    });
}

async function handleSaveFsrs7() {
    const rawText = DOM.fsrs7ParamsInput?.value || "";
    const { parseAndValidateFsrs7Params, closeFsrs7ConfigModal } = await import('../ui/modal.js');
    const check = parseAndValidateFsrs7Params(rawText);

    if (!check.valid) {
        if (DOM.fsrs7ParamsFeedback) {
            DOM.fsrs7ParamsFeedback.textContent = `❌ ${check.error}`;
            DOM.fsrs7ParamsFeedback.style.color = "#ef4444";
        }
        return;
    }

    const { setUserFsrs7Params } = await import('../core/state.js');
    const res = await setUserFsrs7Params(check.params);
    if (res.success) {
        import('../core/sync.js').then(s => s.syncUserSettingsToFirebase());
        closeFsrs7ConfigModal();
        playSound('complete');
        showPopup(`Thành công! Đã nạp và áp dụng 34 tham số FSRS-7 cá nhân hóa vào hệ thống.`, 'success');
    } else {
        if (DOM.fsrs7ParamsFeedback) {
            DOM.fsrs7ParamsFeedback.textContent = `❌ ${res.error}`;
            DOM.fsrs7ParamsFeedback.style.color = "#ef4444";
        }
    }
}

// ─── THIẾT BỊ & ĐỒNG BỘ ĐA THIẾT BỊ ──────────────────────────────────────────

async function showToastAsync(title, message, icon = 'ph-check-circle') {
    try {
        const modal = await import('../ui/modal.js');
        modal.showToast?.(title, message, icon);
    } catch (_) {}
}

/**
 * Hiển thị mã đồng bộ hiện tại lên ô input.
 */
export async function updateSyncKeyUI() {
    const keyInput = document.getElementById('sync-key-input');
    if (!keyInput) return;
    try {
        const { formatSyncKey } = await import('../core/firebase.js');
        const formatted = formatSyncKey();
        keyInput.value = formatted || 'Chưa khởi tạo';
    } catch (err) {
        console.warn('Lỗi hiển thị mã đồng bộ:', err);
    }
}

/**
 * Xử lý sao chép mã đồng bộ vào clipboard với hiệu ứng phản hồi trực quan.
 */
export async function handleCopySyncKey() {
    const keyInput = document.getElementById('sync-key-input');
    const btn = document.getElementById('copy-sync-key-btn');
    if (!keyInput || !btn) return;

    let keyText = keyInput.value.trim();
    if (!keyText || keyText === '...' || keyText === 'Chưa khởi tạo') {
        const { formatSyncKey } = await import('../core/firebase.js');
        keyText = formatSyncKey();
        keyInput.value = keyText;
    }

    let copied = false;
    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(keyText);
            copied = true;
        } catch (_) {}
    }
    if (!copied) {
        try {
            keyInput.select();
            keyInput.setSelectionRange(0, 99999);
            copied = document.execCommand('copy');
        } catch (_) {}
    }

    if (copied) {
        btn.classList.add('sync-btn-copied');
        const label = btn.querySelector('.btn-copy-label');
        const icon = btn.querySelector('i');
        if (label) label.textContent = 'Đã chép!';
        if (icon) icon.className = 'ph-bold ph-check';

        playSound('click');
        await showToastAsync('Đã sao chép mã đồng bộ', 'Dán mã này vào thiết bị khác để kết nối kho từ vựng.', 'ph-check-circle');

        setTimeout(() => {
            btn.classList.remove('sync-btn-copied');
            if (label) label.textContent = 'Sao chép';
            if (icon) icon.className = 'ph-bold ph-copy';
        }, 2200);
    } else {
        keyInput.select();
        showPopup('Vui lòng chọn và nhấn Ctrl+C để sao chép mã.', 'info');
    }
}

/**
 * Xử lý ghép đôi thiết bị mới bằng mã đồng bộ.
 */
export async function handleApplySyncKey() {
    const applyInput = document.getElementById('sync-key-apply-input');
    const applyBtn = document.getElementById('apply-sync-key-btn');
    if (!applyInput) return;

    const rawKey = applyInput.value.trim();
    if (!rawKey) {
        showPopup('Vui lòng nhập mã đồng bộ từ thiết bị khác.', 'warning');
        applyInput.focus();
        return;
    }

    showConfirmation(
        "Bạn có chắc muốn liên kết với mã đồng bộ này?\n\nKho từ vựng của thiết bị sẽ kết nối và hợp nhất hai chiều (Smart Merge) với tài khoản tương ứng.",
        async () => {
            const originalHtml = applyBtn ? applyBtn.innerHTML : '';
            if (applyBtn) {
                applyBtn.disabled = true;
                applyBtn.innerHTML = '<i class="ph-bold ph-spinner animate-spin"></i> <span>Đang liên kết...</span>';
            }

            try {
                const { applySyncKey } = await import('../core/firebase.js');
                await applySyncKey(rawKey);

                await updateSyncKeyUI();
                applyInput.value = '';

                // Kích hoạt đồng bộ kéo toàn bộ dữ liệu từ đám mây về
                const sync = await import('../core/sync.js');
                await sync.triggerFullSync?.({ forcePull: true });

                playSound('complete');
                showPopup('Liên kết thiết bị thành công! Dữ liệu đang được đồng bộ và hợp nhất.', 'success');
            } catch (err) {
                console.error('Lỗi khi liên kết mã đồng bộ:', err);
                showPopup(err?.message || 'Không thể liên kết mã đồng bộ. Vui lòng kiểm tra lại mã hoặc kết nối mạng.', 'error');
            } finally {
                if (applyBtn) {
                    applyBtn.disabled = false;
                    applyBtn.innerHTML = originalHtml;
                }
            }
        }
    );
}

// ─── ÂM THANH NGOẠI TUYẾN & THỐNG KÊ BỘ NHỚ CỤC BỘ ──────────────────────────

/**
 * Cập nhật số lượng audio đã lưu trong IndexedDB.
 */
export async function updateAudioCacheUI() {
    const countEl = document.getElementById('audio-cache-count');
    const badgeEl = document.getElementById('audio-cache-badge');
    if (!countEl) return;

    try {
        const { getAudioCacheStats } = await import('../core/sound.js');
        const stats = await getAudioCacheStats(getState().vocabulary);

        countEl.textContent = `${stats.cached.toLocaleString('vi-VN')} / ${stats.total.toLocaleString('vi-VN')} từ (${stats.percentage}%)`;

        if (badgeEl) {
            if (stats.missing === 0 && stats.total > 0) {
                badgeEl.className = 'audio-cache-badge badge-complete';
                badgeEl.innerHTML = '<i class="ph-fill ph-check-circle"></i> Đầy đủ 100%';
            } else if (stats.missing > 0) {
                badgeEl.className = 'audio-cache-badge badge-pending';
                badgeEl.innerHTML = `<i class="ph-bold ph-arrow-circle-down"></i> Còn thiếu ${stats.missing.toLocaleString('vi-VN')} từ`;
            } else {
                badgeEl.className = 'audio-cache-badge';
                badgeEl.innerHTML = '<i class="ph-fill ph-check-circle"></i> Sẵn sàng';
            }
        }
    } catch (err) {
        console.warn('Lỗi tính toán audio cache stats:', err);
    }
}

let _isDownloadingAudio = false;

/**
 * Tải toàn bộ audio ngoại tuyến với thanh tiến trình trực quan.
 */
export async function handleDownloadAllAudio() {
    if (_isDownloadingAudio) return;

    const btn = document.getElementById('download-all-audio-btn');
    const btnText = document.getElementById('download-audio-btn-text');
    const progressWrap = document.getElementById('audio-download-progress-wrap');
    const progressFill = document.getElementById('audio-download-progress-fill');

    _isDownloadingAudio = true;
    if (btn) btn.disabled = true;
    if (progressWrap) progressWrap.classList.remove('hidden');

    try {
        const { startBackgroundAudioPreload } = await import('../core/sound.js');
        await startBackgroundAudioPreload(getState().vocabulary, {
            reason: 'manual',
            onProgress: ({ done, total, percent, isComplete, batchTotal }) => {
                if (batchTotal === 0) {
                    if (btnText) btnText.textContent = 'Toàn bộ từ đã có audio!';
                    if (progressFill) progressFill.style.width = '100%';
                    return;
                }
                if (btnText) btnText.textContent = `Đang tải: ${done}/${total} từ (${percent}%)`;
                if (progressFill) progressFill.style.width = `${percent}%`;
            }
        });

        await updateAudioCacheUI();
        if (btnText) btnText.textContent = 'Hoàn tất tải âm thanh!';
        playSound('complete');

        setTimeout(() => {
            if (progressWrap) progressWrap.classList.add('hidden');
            if (progressFill) progressFill.style.width = '0%';
            if (btnText) btnText.textContent = 'Tải toàn bộ audio ngoại tuyến';
            if (btn) btn.disabled = false;
            _isDownloadingAudio = false;
        }, 3000);
    } catch (err) {
        console.error('Lỗi khi tải audio ngoại tuyến:', err);
        showPopup('Có lỗi xảy ra trong quá trình tải audio ngoại tuyến.', 'error');
        if (progressWrap) progressWrap.classList.add('hidden');
        if (btnText) btnText.textContent = 'Tải toàn bộ audio ngoại tuyến';
        if (btn) btn.disabled = false;
        _isDownloadingAudio = false;
    }
}

/**
 * Làm mới toàn bộ thông tin hiển thị của tab "Dữ Liệu" mỗi khi người dùng chuyển sang tab này.
 */
export function refreshIoTabUI() {
    updateSyncKeyUI();
    updateAudioCacheUI();
    checkAppVersion();
}
