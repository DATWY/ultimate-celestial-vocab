// src/features/io.js

import { DOM } from '../ui/elements.js';
import { getState, setVocabulary, setAllTags, saveVocabulary } from '../core/state.js';
import { showPopup, showConfirmation, closeModal, openModal } from '../ui/modal.js';
import { populateTopicFilters, updatePanelWordList, displayCard } from '../ui/render.js';
import { buildReviewQueue, getNextCardToReview } from '../core/srs.js';
import { playSound } from '../core/sound.js';

let parsedImportData = []; // Lưu trữ dữ liệu đã phân tích để xác nhận

// Nâng cấp: Xử lý sự kiện chọn file để xem trước
export function setupIOEventListeners() {
    DOM.exportBtn?.addEventListener('click', handleExport);
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
    const existingWords = new Set(vocabulary.map(w => w.english.toLowerCase()));
    
    parsedImportData = [];
    let stats = { new: 0, skipped: 0, errors: 0 };
    const lines = content.split('\n').slice(0, 500); // Giới hạn 500 dòng để xem trước
    const hasHeader = lines[0]?.toLowerCase().includes('english');
    const dataLines = hasHeader ? lines.slice(1) : lines;

    dataLines.forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine === '') return;
        
        const parts = trimmedLine.split('\t');
        if (parts.length < 2 || !parts[0] || !parts[1]) {
            stats.errors++;
            return;
        }

        const english = parts[0].trim();
        const wordData = {
            english,
            vietnamese: parts[1] ? parts[1].trim() : '',
            type: parts[2] ? parts[2].trim() : '',
            pronunciation: parts[3] ? parts[3].trim() : '',
            example: parts[4] ? parts[4].trim() : '',
            isStarred: parts[5] ? parts[5].trim() : 'false',
            srsStatus: parts[6] ? parts[6].trim() : 'New',
            srsDueDate: parts[7] ? parts[7].trim() : '',
            tags: parts[8] ? parts[8].trim() : '',
            lapses: parts[9] ? parts[9].trim() : '0',
            isSuspended: parts[10] ? parts[10].trim() : 'false'
        };

        if (existingWords.has(english.toLowerCase())) {
            stats.skipped++;
        } else {
            stats.new++;
            parsedImportData.push(parts); // Chỉ lưu những từ mới sẽ được thêm
        }
    });

    // Cập nhật UI của modal xem trước
    document.getElementById('import-filename').textContent = fileName;
    document.getElementById('import-stats-new').textContent = stats.new;
    document.getElementById('import-stats-skipped').textContent = stats.skipped;
    document.getElementById('import-stats-errors').textContent = stats.errors;

    const previewTable = document.getElementById('import-preview-table');
    previewTable.innerHTML = `<thead><tr><th>English</th><th>Vietnamese</th><th>Type</th></tr></thead>`;
    const tbody = document.createElement('tbody');
    parsedImportData.slice(0, 10).forEach(parts => { // Chỉ hiện 10 dòng đầu
        const row = tbody.insertRow();
        row.insertCell().textContent = parts[0] || '';
        row.insertCell().textContent = parts[1] || '';
        row.insertCell().textContent = parts[2] || '';
    });
    previewTable.appendChild(tbody);
    
    // Hiển thị modal
    const importPreviewModal = document.getElementById('import-preview-modal');
    openModal(importPreviewModal);
}

function confirmImport() {
    const { vocabulary, allTags } = getState();
    let tagsHaveChanged = false;

    parsedImportData.forEach(parts => {
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
            vietnamese: (parts[1] || '').trim(),
            type: (parts[2] || '').trim(),
            pronunciation: (parts[3] || '').trim(),
            example: (parts[4] || '').replace(/\\n/g, '\n').trim(),
            isStarred: (parts[5] || 'false').trim().toLowerCase() === 'true',
            srsStatus: (parts[6] && parts[6].trim() !== '') ? parts[6].trim() : 'New', 
            srsInterval: 0, 
            srsEaseFactor: 2.5, 
            srsDueDate: (parts[7] && parts[7].trim() !== '') ? Number(parts[7].trim()) : null,
            tags: tagsArray, 
            lapses: (parts[9] && parts[9].trim() !== '') ? Number(parts[9].trim()) : 0, 
            isSuspended: (parts[10] || 'false').trim().toLowerCase() === 'true'
        };
        
        if (newWord.srsStatus === "New") { 
            newWord.srsDueDate = null; 
        }

        vocabulary.push(newWord);
    });

    setVocabulary(vocabulary);
    setAllTags(allTags);
    saveVocabulary();
    populateTopicFilters(tagsHaveChanged);
    buildReviewQueue();
    updatePanelWordList();
    displayCard(getNextCardToReview());
    
    closeModal(document.getElementById('import-preview-modal'));
    showPopup(`Đã nhập thành công ${parsedImportData.length} từ mới.`, "success");
    playSound('complete');
    parsedImportData = []; // Dọn dẹp
}

// Sửa lỗi: hàm xóa toàn bộ
function handleClearAllData() {
    // BƯỚC 1: ĐẶT BẪY ĐỂ XEM HÀM CÓ ĐƯỢC GỌI KHÔNG
    console.log("Bước 1: handleClearAllData được kích hoạt!");

    showConfirmation("!!! CẢNH BÁO !!!\nBạn có chắc muốn xóa TOÀN BỘ dữ liệu từ vựng không? Hành động này không thể hoàn tác.",
        () => {
            console.log("Bước 2: Callback xác nhận lần 1 được gọi."); // Bẫy thứ hai
            showConfirmation("!!! XÁC NHẬN LẦN CUỐI !!!\nBạn thực sự muốn xóa tất cả?",
                () => {
                    console.log("Bước 3: Callback xác nhận lần 2 được gọi. Bắt đầu xóa..."); // Bẫy thứ ba
                    try {
                        localStorage.removeItem('celestialVocab');
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
    const headers = ["English", "Vietnamese", "Type", "Pronunciation", "Example", "isStarred", "srsStatus", "srsDueDate", "Tags", "lapses", "isSuspended"];
    const headerString = headers.join("\t") + "\n";
    const activeVocabulary = vocabulary.filter(w => !w.isDeleted);
    const dataRows = activeVocabulary.map(w => {
        const exampleCleaned = (w.example || '').replace(/\n/g, '\\n').replace(/\t/g, ' ');
        const dueDateString = w.srsDueDate ? w.srsDueDate.toString() : '';
        const tagsString = w.tags?.join(',') || '';
        return [w.english || '', w.vietnamese || '', w.type || '', w.pronunciation || '', exampleCleaned, w.isStarred ? 'true' : 'false', w.srsStatus || 'New', dueDateString, tagsString, w.lapses || 0, w.isSuspended ? 'true' : 'false'].join("\t");
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
    showPopup("Xuất dữ liệu thành công!", "success");
}
