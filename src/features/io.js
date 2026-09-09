// src/features/io.js

import { DOM } from '../ui/elements.js';
import { getState, setVocabulary, setAllTags, saveVocabulary, trackEvent } from '../core/state.js';
import { showPopup, showConfirmation, closeModal, openModal } from '../ui/modal.js';
import { populateTopicFilters, updatePanelWordList, displayCard } from '../ui/render.js';
import { buildReviewQueue, getNextCardToReview } from '../core/queue.js';
import { playSound } from '../core/sound.js';
import { syncCardToFirebase } from '../core/sync.js';
import { clearVocabularyDB } from '../core/idb.js';
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

    DOM.clearAllBtn?.addEventListener('click', handleClearAllData);
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
        const content = textArea.value.trim();
        if (!content) {
            showPopup('Vui lòng dán nội dung vào ô văn bản.', 'error');
            return;
        }
        previewImport(content, 'Dữ liệu dán tay');
        textArea.value = ''; // clear after preview
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
                const file = files[0];
                const reader = new FileReader();
                reader.onload = (evt) => {
                    const content = evt.target.result;
                    if (typeof content === 'string') {
                        previewImport(content, file.name);
                    }
                };
                reader.readAsText(file, 'UTF-8');
            }
        });
    }
}

function handleFileSelect(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const content = e.target.result;
        if (typeof content === 'string') {
            previewImport(content, file.name);
        }
    };
    reader.readAsText(file, 'UTF-8');
    event.target.value = ''; // Reset input để có thể chọn lại cùng file
}

function previewImport(content, fileName) {
    const { vocabulary } = getState();
    
    const vocabMap = new Map();
    vocabulary.filter(w => !w.isDeleted).forEach(card => {
        const canonEng = canonicalEnglish(card.english);
        if (!vocabMap.has(canonEng)) {
            vocabMap.set(canonEng, []);
        }
        vocabMap.get(canonEng).push(card);
    });
    
    parsedImportData = {
        newItems: [],
        updateItems: []
    };

    let stats = { new: 0, updated: 0, skipped: 0, errors: 0 };
    const lines = content.split('\n');
    const hasHeader = lines[0]?.toLowerCase().includes('english');
    const dataLines = hasHeader ? lines.slice(1) : lines;

    // Pass 0: Lọc trùng 100% nội bộ ngay trong batch nạp vào (Intra-file deduplication)
    const seenInBatch = new Set();

    dataLines.forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine === '') return;
        
        const parts = trimmedLine.split('\t');
        if (parts.length < 2 || !parts[0] || !parts[1]) {
            stats.errors++;
            return;
        }

        const english = parts[0].trim();
        const canonEng = canonicalEnglish(english);
        const vietnamese = cleanAndDeduplicateVietnamese(parts[1] || '');
        const incomingType = parts[2] ? parts[2].trim() : '';
        const canonPOS = canonicalPartOfSpeech(incomingType, english);
        const incomingExample = (parts[4] || '').replace(/\\n/g, '\n').trim();
        const incomingPron = (parts[3] || '').trim();

        // Key kiểm tra trùng 100% trong file nạp
        const batchKey = `${canonEng}|${canonPOS}|${vietnamese.toLowerCase()}`;
        if (seenInBatch.has(batchKey)) {
            stats.skipped++;
            return;
        }
        seenInBatch.add(batchKey);
        
        let isDuplicate = false;
        let matchedCard = null;

        const incomingVirtualCard = {
            english,
            vietnamese,
            type: incomingType,
            example: incomingExample,
            pronunciation: incomingPron
        };

        if (vocabMap.has(canonEng)) {
            const existingCards = vocabMap.get(canonEng);
            for (const card of existingCards) {
                const check = isDuplicateCard(incomingVirtualCard, card);
                if (check.isDuplicate) {
                    isDuplicate = true;
                    matchedCard = card;
                    break;
                }
            }
        }

        if (isDuplicate && matchedCard) {
            const existingExample = (matchedCard.example || '').trim();
            const existingPron = (matchedCard.pronunciation || '').trim();

            // Kiểm tra xem thẻ mới có câu ví dụ dài/chi tiết hơn hay phiên âm mới hay không (Smart Update)
            const exampleIsBetter = incomingExample.length > existingExample.length;
            const pronIsBetter = incomingPron !== '' && existingPron === '';

            if (exampleIsBetter || pronIsBetter) {
                stats.updated++;
                parsedImportData.updateItems.push({
                    cardId: matchedCard.id,
                    parts
                });
            } else {
                stats.skipped++;
            }
        } else {
            stats.new++;
            parsedImportData.newItems.push(parts);
            
            // Cập nhật vocabMap tạm thời để lọc các dòng sau trong cùng batch
            if (!vocabMap.has(canonEng)) {
                vocabMap.set(canonEng, []);
            }
            vocabMap.get(canonEng).push(incomingVirtualCard);
        }
    });

    // Cập nhật UI của modal xem trước
    document.getElementById('import-filename').textContent = fileName;
    document.getElementById('import-stats-new').textContent = stats.new;
    
    // Nếu có ô stats-updated thì cập nhật, nếu chưa có thì gộp hiển thị vào skipped/popup
    const statsUpdatedEl = document.getElementById('import-stats-updated');
    if (statsUpdatedEl) {
        statsUpdatedEl.textContent = stats.updated;
    }

    document.getElementById('import-stats-skipped').textContent = stats.skipped + (statsUpdatedEl ? 0 : stats.updated);
    document.getElementById('import-stats-errors').textContent = stats.errors;

    const previewTable = document.getElementById('import-preview-table');
    previewTable.innerHTML = `<thead><tr><th>English</th><th>Vietnamese</th><th>Type</th><th>Trạng thái</th></tr></thead>`;
    const tbody = document.createElement('tbody');
    
    // Nạp xem trước 10 dòng đầu (gồm từ mới và từ được Smart Update)
    const previewList = [
        ...parsedImportData.newItems.map(p => ({ parts: p, status: 'Mới' })),
        ...parsedImportData.updateItems.map(u => ({ parts: u.parts, status: 'Cập nhật ví dụ' }))
    ];

    previewList.slice(0, 10).forEach(item => {
        const row = tbody.insertRow();
        row.insertCell().textContent = item.parts[0] || '';
        row.insertCell().textContent = item.parts[1] || '';
        row.insertCell().textContent = item.parts[2] || '';
        const statusCell = row.insertCell();
        statusCell.textContent = item.status;
        if (item.status === 'Cập nhật ví dụ') {
            statusCell.style.color = 'var(--accent-color, #3b82f6)';
        }
    });
    previewTable.appendChild(tbody);
    
    // Hiển thị modal
    const importPreviewModal = document.getElementById('import-preview-modal');
    openModal(importPreviewModal);
}

function confirmImport() {
    const { vocabulary, allTags } = getState();
    let tagsHaveChanged = false;
    let newCount = parsedImportData.newItems.length;
    let updateCount = parsedImportData.updateItems.length;

    // 1. Thao tác Smart Update (TUYỆT ĐỐI KHÔNG SỬA Trạng thái/Tiến độ SRS)
    parsedImportData.updateItems.forEach(item => {
        const card = vocabulary.find(c => c.id === item.cardId);
        if (!card) return;

        const parts = item.parts;
        const incomingExample = (parts[4] || '').replace(/\\n/g, '\n').trim();
        const incomingPron = (parts[3] || '').trim();
        const tagsStr = (parts[8] || '').trim();
        const tagsArray = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [];

        // Bổ sung Tag mới
        tagsArray.forEach(tag => {
            if (!allTags.has(tag)) {
                allTags.add(tag);
                tagsHaveChanged = true;
            }
            if (!card.tags.includes(tag)) {
                card.tags.push(tag);
            }
        });

        // Cập nhật câu ví dụ nếu dài hơn/tốt hơn
        if (incomingExample.length > (card.example || '').trim().length) {
            card.example = incomingExample;
        }

        // Bổ sung phiên âm nếu thẻ cũ thiếu
        if (incomingPron && !(card.pronunciation || '').trim()) {
            card.pronunciation = incomingPron;
        }

        card.updatedAt = Date.now();
        syncCardToFirebase(card); // Đồng bộ thẻ đã làm sạch lên Cloud
    });

    // 2. Thao tác thêm từ vựng mới
    parsedImportData.newItems.forEach(parts => {
        const tagsStr = (parts[8] || '').trim();
        const tagsArray = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [];
        tagsArray.forEach(tag => {
            if (!allTags.has(tag)) {
                allTags.add(tag);
                tagsHaveChanged = true;
            }
        });
        
        const newWord = {
            id: crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).substring(2, 10)),
            english: (parts[0] || '').trim(),
            vietnamese: cleanAndDeduplicateVietnamese(parts[1] || ''),
            type: (parts[2] || '').trim(),
            pronunciation: (parts[3] || '').trim(),
            example: (parts[4] || '').replace(/\\n/g, '\n').trim(),
            isStarred: (parts[5] || 'false').trim().toLowerCase() === 'true',
            srsStatus: (parts[6] && parts[6].trim() !== '') ? parts[6].trim() : 'New', 
            srsInterval: (parts[11] && parts[11].trim() !== '') ? Number(parts[11].trim()) : 0, 
            srsEaseFactor: (parts[12] && parts[12].trim() !== '') ? Number(parts[12].trim()) : 2.5, 
            srsDueDate: (parts[7] && parts[7].trim() !== '') ? Number(parts[7].trim()) : null,
            tags: tagsArray, 
            lapses: (parts[9] && parts[9].trim() !== '') ? Number(parts[9].trim()) : 0, 
            isSuspended: (parts[10] || 'false').trim().toLowerCase() === 'true',
            difficulty: (parts[13] && parts[13].trim() !== '') ? Number(parts[13].trim()) : undefined,
            stability: (parts[14] && parts[14].trim() !== '') ? Number(parts[14].trim()) : undefined,
            reps: (parts[15] && parts[15].trim() !== '') ? Number(parts[15].trim()) : 0,
            learningStep: (parts[16] && parts[16].trim() !== '') ? Number(parts[16].trim()) : 0,
            lastReviewDate: (parts[17] && parts[17].trim() !== '') ? Number(parts[17].trim()) : undefined,
            stabilityShort: (parts[18] && parts[18].trim() !== '') ? Number(parts[18].trim()) : undefined
        };
        
        if (newWord.srsStatus === "New") { 
            newWord.srsDueDate = null; 
        }
        
        newWord.updatedAt = Date.now();
        vocabulary.push(newWord);
        syncCardToFirebase(newWord);
    });

    setVocabulary(vocabulary);
    setAllTags(allTags);
    saveVocabulary();
    populateTopicFilters(tagsHaveChanged);
    buildReviewQueue();
    updatePanelWordList();
    displayCard(getNextCardToReview());
    
    closeModal(document.getElementById('import-preview-modal'));
    
    let msg = `Đã nạp thành công ${newCount} từ mới`;
    if (updateCount > 0) {
        msg += ` và cập nhật ví dụ cho ${updateCount} từ cũ`;
    }
    showPopup(msg + '.', "success");
    playSound('complete');
    
    if (newCount > 0 || updateCount > 0) {
        trackEvent('imports', newCount + updateCount);
    }
    
    parsedImportData = { newItems: [], updateItems: [] }; // Dọn dẹp
}

// Sửa lỗi: hàm xóa toàn bộ
function handleClearAllData() {
    console.log("Bước 1: handleClearAllData được kích hoạt!");

    showConfirmation("!!! CẢNH BÁO !!!\nBạn có chắc muốn xóa TOÀN BỘ dữ liệu từ vựng không? Hành động này không thể hoàn tác.",
        () => {
            console.log("Bước 2: Callback xác nhận lần 1 được gọi.");
            showConfirmation("!!! XÁC NHẬN LẦN CUỐI !!!\nBạn thực sự muốn xóa tất cả?",
                async () => {
                    console.log("Bước 3: Callback xác nhận lần 2 được gọi. Bắt đầu xóa...");
                    try {
                        const { vocabulary } = getState();
                        const now = Date.now();
                        
                        // 1. Soft-delete tất cả thẻ hiện tại trên Firebase Cloud trước
                        if (vocabulary && vocabulary.length > 0) {
                            try {
                                const { db } = await import('../core/firebase.js');
                                const { writeBatch, doc } = await import('https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js');
                                const BATCH_LIMIT = 500;
                                const activeCards = vocabulary.filter(w => !w.isDeleted);
                                for (let i = 0; i < activeCards.length; i += BATCH_LIMIT) {
                                    const batch = writeBatch(db);
                                    activeCards.slice(i, i + BATCH_LIMIT).forEach(card => {
                                        batch.set(doc(db, 'celestial_vocab_sync', card.id), { isDeleted: true, updatedAt: now }, { merge: true });
                                    });
                                    await batch.commit();
                                }
                            } catch (err) {
                                console.warn("Lỗi soft-delete Cloud khi xóa toàn bộ dữ liệu:", err);
                            }
                        }

                        // 2. Xóa dữ liệu cục bộ
                        localStorage.removeItem('celestialVocab');
                        sessionStorage.removeItem('pendingSyncIds');
                        await clearVocabularyDB();
                        
                        // Đặt lại thời gian lastPullTime để thiết bị có thể đồng bộ sạch sẽ lại từ Cloud (không bị miss do cache time cũ)
                        await import('../core/idb.js').then(m => m.saveSettingToDB('lastPullTime', 0));
                        
                        setVocabulary([]);
                        setAllTags(new Set(['all']));
                        
                        populateTopicFilters(true);
                        buildReviewQueue();
                        updatePanelWordList();
                        displayCard(-1);
                        closeModal(DOM.manageModal);
                        
                        showPopup("Toàn bộ dữ liệu đã được xóa sạch.", "success");
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
    if (vocabulary.length === 0) {
        showPopup("Không có từ vựng nào để xuất.", "info");
        return;
    }
    const headers = ["English", "Vietnamese", "Type", "Pronunciation", "Example", "isStarred", "srsStatus", "srsDueDate", "Tags", "lapses", "isSuspended", "srsInterval", "srsEaseFactor", "difficulty", "stability", "reps", "learningStep", "lastReviewDate", "stabilityShort"];
    const headerString = headers.join("\t") + "\n";
    const activeVocabulary = vocabulary.filter(w => !w.isDeleted);
    const dataRows = activeVocabulary.map(w => {
        const exampleCleaned = (w.example || '').replace(/\n/g, '\\n').replace(/\t/g, ' ');
        const dueDateString = w.srsDueDate ? w.srsDueDate.toString() : '';
        const tagsString = w.tags?.join(',') || '';
        return [w.english || '', w.vietnamese || '', w.type || '', w.pronunciation || '', exampleCleaned, w.isStarred ? 'true' : 'false', w.srsStatus || 'New', dueDateString, tagsString, w.lapses || 0, w.isSuspended ? 'true' : 'false', w.srsInterval || 0, w.srsEaseFactor || 2.5, w.difficulty ?? '', w.stability ?? '', w.reps || 0, w.learningStep || 0, w.lastReviewDate || '', w.stabilityShort ?? ''].join("\t");
    }).join("\n");
    const fileContent = headerString + dataRows;
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
                DOM.fsrs7CurrentStatus.textContent = "Đang dùng: Bộ Mặc Định Chuẩn Lab (34 params)";
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
