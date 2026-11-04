// src/core/state.js — STORE + BARREL của toàn bộ state ứng dụng.
//
// T4.5b: file gốc 1.621 dòng / 91 export đã được tách theo ranh giới rõ ràng.
// File này giữ lại ĐÚNG hai vai trò:
//   1. STORE: các cờ UI + con trỏ hàng đợi + reviewLogs + phiên ôn hiện tại, và
//      các hàm đọc/ghi IndexedDB cho vocabulary (nơi cần cả 3 mảng cùng lúc).
//   2. BARREL: re-export nguyên vẹn mọi tên công khai cũ từ các module con,
//      nên KHÔNG call-site nào phải sửa (import { x } from '../core/state.js').
//
// Bản đồ module con — src/core/state/:
//   review-log-prune.js  cắt tỉa/đo/đóng gói reviewLogs (hàm thuần lá, 0 import)
//   vocabulary.js        mảng từ vựng + chỉ mục id→index
//   progress-store.js    hai object gốc gamification + dailyStats (live binding)
//   gamification.js      XP, chuỗi ngày, huy hiệu, thống kê ngày (mutate 2 object trên)
//   streak.js            toán thuần của chuỗi (ngày đủ điều kiện, chuỗi dài nhất)
//   tts-settings.js      giọng + tốc độ TTS (khoá settings `ttsSettings`)
//   preview-mode.js      cờ xem trước + skipPersistence()
//   typing-filter.js     vị từ thuần cho bộ lọc gõ phím
//   ui-notify.js         cầu nối lười sang tầng UI (stats/toast/popup)
//   demo-seed.js         dữ liệu 10 thẻ mẫu cho kho kiểm thử (?audit=1)
//
// Vì sao `_gamification` / `_dailyStats` ở đây lại là tên có gạch dưới? Chúng
// được IMPORT (alias) từ progress-store.js — cùng một object, cùng một binding
// sống. Giữ đúng tên cũ để thân hàm revertGamificationAfterUndo (mà
// tests/reliability.test.mjs đọc trực tiếp từ file này) không phải sửa một chữ.
//
// Những gì CỐ Ý để lại đây — xem báo cáo T4.5b (mục "không tách được"):
//   • reviewLogs: tests/reliability.test.mjs trích hàm removeReviewLog() từ
//     chính file này rồi chạy trong VM với `let _reviewLogs = ...` ⇒ state và
//     hàm ghi log phải nằm cùng file.
//   • revertGamificationAfterUndo: cùng lý do (test trích hàm + truyền
//     _gamification/_dailyStats giả). Tách sang module gamification.js sẽ làm
//     test đỏ dù hành vi không đổi.
//
// SỐ ĐO THẬT của T4.5b (cùng máy, cùng commit, `npm run build` + `npm run budget`):
//   entry trước: 247.804 B raw / 80.674 B gzip — sau: 246.430 B / 80.668 B gzip.
// Tức mã nguồn nhỏ đi 1.374 B nhưng gzip gần như đứng yên: mọi thứ trong src/
// nằm chung MỘT chunk, và 9 chỗ `await import('./state.js')` buộc Rollup dựng
// đủ 93 tên của namespace ngay trong entry ⇒ tách file KHÔNG tree-shake được gì.
// Muốn entry gzip giảm thật thì phải bỏ kiểu import namespace đó ở nơi gọi
// (ngoài phạm vi T4.5b) hoặc xoá 25 export không ai dùng (trái yêu cầu giữ API).

import { compressLogs as compressReviewLogs, mergeReviewLogs as mergeLogSnapshots, buildReviewLogsExport } from './review-log-merge.js';
import { normalizeCard, mergeCardFields, nextRevision } from './card-merge.js';
import { revertReviewStats } from './stats-rollback.js';
import { initializeProgress } from './progress-merge.js';
import { validFsrs7Params } from './srs/constants.js';
import { announceSyncStatus } from './sync-status.js';
import { saveReviewLogsToDB } from './idb.js';
import { initAppDB, getAllVocabularyFromDB, saveAllVocabularyToDB, saveWordToDB, getSettingFromDB, saveSettingToDB, isIsolatedStorage } from './idb.js';
import { getLocalDateString } from './utils/date.js';
import { vocabulary, setVocabulary, resetVocabulary, rebuildVocabIndex, getVocabById, updateCardInVocabulary } from './state/vocabulary.js';
import { pruneReviewLogs } from './state/review-log-prune.js';
import { gamification as _gamification, dailyStats as _dailyStats, setGamification, setDailyStats } from './state/progress-store.js';
import { ttsVoice, ttsRate, ttsSource, loadTtsSettings } from './state/tts-settings.js';
import { skipPersistence } from './state/preview-mode.js';
import { safeUpdateStats, safeShowPopup, safeShowToast } from './state/ui-notify.js';
import { isCardLeech, isHardCard, isLearningCard, isLongWord, matchesTypingFilter } from './state/typing-filter.js';
import { ensureDailyStats, checkStreakStatusOnLoad, saveDailyStats, saveGamification, syncStreakFromHeatmap, revertReviewBudget } from './state/gamification.js';
export { getLocalDateString, getOffsetDateString } from './utils/date.js';

/** Bí danh giữ đúng tên `updateStats()` mà revertGamificationAfterUndo() gọi. */
const updateStats = safeUpdateStats;

// Cloud sync nạp MUỘN: state.js nằm trong entry chunk, nếu import tĩnh sync.js
// thì firebase (547 kB) lại quay vào critical path. Chỉ nạp khi thực sự có thẻ
// cần xếp hàng đồng bộ (sau lượt học đầu tiên).
let _syncModulePromise = null;
function queueCardSync(card) {
    if (typeof window === 'undefined' || !card || !card.id) return;
    if (!_syncModulePromise) _syncModulePromise = import('./sync.js');
    _syncModulePromise.then(m => m.syncCardToFirebase?.(card)).catch(() => {});
}

let _currentReviewQueue = [];
let _allTags = new Set(['all']);
let _currentCardIndex = -1;
let _isFlipped = false;
let _isDarkMode = false;
let _isBoostMode = false;
let _soundMode = 'all'; // 'all', 'sfx', 'tts', 'off'
let _isTypingMode = false;
let _typingFilter = 'off'; // 'off', 'leech', 'all', 'hard', 'learning', 'starred', 'long'

// Khôi phục bộ lọc gõ phím thông minh từ localStorage
if (typeof localStorage !== 'undefined') {
    const savedFilter = localStorage.getItem('celestial_typing_filter');
    if (savedFilter && ['off', 'leech', 'all', 'hard', 'learning', 'starred', 'long'].includes(savedFilter)) {
        _typingFilter = savedFilter;
        _isTypingMode = savedFilter !== 'off';
    }
}
let _currentTopicFilter = 'all';
let _isTransitioning = false;

let _lastReviewSnapshot = null;
let _reviewLogs = [];
let _userRecallParams = null;
let _userLapseParams = null;
let _userFsrs7Params = null;
let _userFsrs7TrainedAt = null;

export const getState = () => ({
    vocabulary: vocabulary,
    currentReviewQueue: _currentReviewQueue,
    allTags: _allTags,
    currentCardIndex: _currentCardIndex,
    isFlipped: _isFlipped,
    isDarkMode: _isDarkMode,
    isBoostMode: _isBoostMode,
    soundMode: _soundMode,
    ttsVoice: ttsVoice,
    ttsRate: ttsRate,
    ttsSource: ttsSource,
    isTypingMode: _isTypingMode,
    typingFilter: _typingFilter,
    currentTopicFilter: _currentTopicFilter,
    dailyStats: _dailyStats,
    gamification: _gamification,
    reviewLogs: _reviewLogs,
    userRecallParams: _userRecallParams,
    userLapseParams: _userLapseParams,
    userFsrs7Params: _userFsrs7Params,
    userFsrs7TrainedAt: _userFsrs7TrainedAt,
    isTransitioning: _isTransitioning,
});

export function setReviewQueue(newQueue) { _currentReviewQueue = newQueue; }
export function setAllTags(newTags) { _allTags = newTags; }
export function setCurrentCardIndex(index) { _currentCardIndex = index; }
export function setIsTransitioning(isTrans) { _isTransitioning = isTrans; }
export function getLastReviewSnapshot() { return _lastReviewSnapshot; }
export function setLastReviewSnapshot(snapshot) { _lastReviewSnapshot = snapshot; }
export function clearLastReviewSnapshot() { _lastReviewSnapshot = null; }

export function setIsFlipped(flipped) { _isFlipped = flipped; }
export function setIsDarkMode(isDark) { _isDarkMode = isDark; }
export function setIsBoostMode(isBoost) { _isBoostMode = !!isBoost; }
export function setIsTypingMode(isTyping) {
    _isTypingMode = isTyping;
    if (!isTyping) {
        _typingFilter = 'off';
    } else if (_typingFilter === 'off') {
        _typingFilter = 'leech'; // Mặc định chuyển sang bộ lọc Leech thông minh
    }
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem('celestial_typing_filter', _typingFilter);
    }
}

export function setTypingFilter(filter) {
    _typingFilter = filter;
    _isTypingMode = filter !== 'off';
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem('celestial_typing_filter', filter);
    }
}

export function shouldCardUseTyping(card) {
    if (!_isTypingMode || _typingFilter === 'off' || !card) return false;
    return matchesTypingFilter(card, _typingFilter);
}

export function getTypingFilterStats() {
    const stats = {
        total: 0,
        leech: 0,
        all: 0,
        hard: 0,
        learning: 0,
        starred: 0,
        long: 0
    };

    for (let i = 0; i < vocabulary.length; i++) {
        const card = vocabulary[i];
        if (!card || card.isDeleted) continue;
        stats.total++;
        stats.all++;
        if (isCardLeech(card)) stats.leech++;
        if (isHardCard(card)) stats.hard++;
        if (isLearningCard(card)) stats.learning++;
        if (card.isStarred) stats.starred++;
        if (isLongWord(card)) stats.long++;
    }
    return stats;
}
export function setCurrentTopicFilter(topic) { _currentTopicFilter = topic; }
export function setSoundMode(mode) { _soundMode = mode; }

export async function saveVocabulary(skipSync = true) {
    try {
        const vocabToSave = vocabulary.map(w => ({ ...w, srsDueDate: w.srsDueDate || null }));

        // Lưu toàn bộ vào IndexedDB (chỉ dùng cho bulk operations: import, full sync)
        const stored = await saveAllVocabularyToDB(vocabToSave, { markDirty: !skipSync });
        const current = new Map(vocabulary.map(card => [card.id, card]));
        setVocabulary(stored.map(card => mergeCardFields(current.get(card.id) || card, card)));
        await saveDailyStats();

        safeUpdateStats();
        return true;
    } catch (e) {
        console.error("Save error:", e);
        announceSyncStatus({ phase: 'storage-error' });
        safeShowPopup("Lỗi không thể lưu dữ liệu!", "error");
        // Trả về false để nơi gọi biết dữ liệu CHƯA được ghi bền vững.
        // Đặc biệt quan trọng với sync: không được nâng watermark khi lưu thất bại,
        // nếu không lần sync sau sẽ bỏ qua vĩnh viễn các thẻ vừa kéo về.
        return false;
    }
}

/**
 * Incremental save: Chỉ ghi 1 word vào IDB + queue sync lên Cloud.
 * Dùng cho single-card changes (review, star, edit, delete).
 * Giảm I/O từ O(n) xuống O(1) so với saveVocabulary().
 */
export async function saveOneWord(word) {
    if (skipPersistence()) return;
    try {
        const stored = await saveWordToDB({ ...word, srsDueDate: word.srsDueDate || null });
        const merged = mergeCardFields(getVocabById(word.id) || word, stored);
        updateCardInVocabulary(word.id, merged);
        // Không chặn lượt học: stats gộp theo frame, sync xếp hàng nền.
        safeUpdateStats();
        queueCardSync(merged);
        if (typeof window !== 'undefined') import('./tab-bus.js').then(bus => bus.broadcastCardUpdated?.(merged)).catch(() => {});
        return merged;
    } catch (e) {
        console.error("SaveOneWord error:", e);
        announceSyncStatus({ phase: 'storage-error' });
        safeShowToast('Chưa lưu được', 'Thiết bị chưa lưu được lượt học này. Hãy xuất dữ liệu trước khi đóng trang.', 'ph-warning');
        return null;
    }
}

export async function loadVocabulary() {
    await initAppDB(); // Khởi tạo DB

    // Đọc từ IDB
    let savedVocab = await getAllVocabularyFromDB();

    // Nếu IDB trống, thử migrate từ localStorage sang IDB
    if (!isIsolatedStorage && savedVocab.length === 0) {
        const oldVocabStr = localStorage.getItem('celestialVocab');
        if (oldVocabStr) {
            try {
                savedVocab = JSON.parse(oldVocabStr);
                if (Array.isArray(savedVocab)) {
                    await saveAllVocabularyToDB(savedVocab);
                    localStorage.removeItem('celestialVocab'); // Xóa localStorage sau khi migrate
                    console.log("Migrated vocabulary from localStorage to IndexedDB");
                }
            } catch(e) { console.error(e); }
        }
    }

    _allTags = new Set(['all']);
    resetVocabulary();

    if (Array.isArray(savedVocab)) {
        savedVocab.forEach(word => {
            if (!word || typeof word !== 'object') return;
            let parsedTags = [];
            if (word.tags) {
                if (typeof word.tags === 'string') {
                    parsedTags = word.tags.split(',').map(t => t.trim()).filter(Boolean);
                } else if (Array.isArray(word.tags)) {
                    parsedTags = word.tags.map(t => typeof t === 'string' ? t.trim() : '').filter(Boolean);
                }
            }
            word.tags = parsedTags;
            word.srsStatus = word.srsStatus || "New";
            word.srsInterval = Number(word.srsInterval) || 0;
            word.srsEaseFactor = Number(word.srsEaseFactor) || 2.5;
            word.srsDueDate = word.srsDueDate ? Number(word.srsDueDate) : null;
            word.isStarred = word.isStarred || false;
            word.lapses = Number(word.lapses) || 0;
            word.reps = Number(word.reps) || 0;
            word.anchor = Number(word.anchor) || 0;
            word.modality = word.modality || 'en-vi';
            // PHASE 9: BỎ migration xoá cờ tạm ngưng. Migration cũ ("chế độ tạm ngưng
            // đã bị hủy bỏ hoàn toàn") khiến `isSuspended` thành dữ liệu chết: mọi lần
            // nạp đều ghi đè về false, nên người dùng KHÔNG có cách trung thực nào để
            // nói "từ này tôi đã biết" (ngoài đường tắt "Dễ → Mastered" sai khoa học).
            // Giờ cờ được giữ nguyên; người dùng tự bật/tắt trong form thêm/sửa.
            word.isSuspended = word.isSuspended === true
                || word.isSuspended === 1
                || word.isSuspended === 'true';
            if (!word.id) word.id = crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).substring(2, 10));
            vocabulary.push(normalizeCard(word));
            word.tags.forEach(tag => _allTags.add(tag));
        });
    }

    // Load Daily Stats
    let parsedStats = await getSettingFromDB('dailyStats');
    if (!isIsolatedStorage && !parsedStats) {
        const oldStatsStr = localStorage.getItem('celestialDailyStats');
        if (oldStatsStr) {
            try {
                parsedStats = JSON.parse(oldStatsStr);
                await saveSettingToDB('dailyStats', parsedStats);
                localStorage.removeItem('celestialDailyStats');
            } catch(e) {}
        }
    }

    setDailyStats(initializeProgress(parsedStats || _dailyStats, 'daily'));
    ensureDailyStats();
    // Load Gamification Stats
    const savedGamification = await getSettingFromDB('gamification');
    if (savedGamification) {
        setGamification({ ..._gamification, ...savedGamification });
        initializeProgress(_gamification, 'gamification');
        checkStreakStatusOnLoad(); // Check streak status on load (reset UI if missed days, do not grant streak without study)
    }
    initializeProgress(_gamification, 'gamification');



    const rawLogs = await getSettingFromDB('reviewLogs') || { dict: [], logs: [] };
    if (Array.isArray(rawLogs)) {
        console.log("Migrating reviewLogs to compressed format...");
        _reviewLogs = compressLogs(rawLogs);
        await persistReviewLogs();
    } else {
        _reviewLogs = rawLogs;
        if (!_reviewLogs.dict) _reviewLogs = { dict: [], logs: [] };
    }

    _userRecallParams = await getSettingFromDB('userRecallParams') || null;
    _userLapseParams = await getSettingFromDB('userLapseParams') || null;
    _userFsrs7Params = await getSettingFromDB('userFsrs7Params') || null;
    _userFsrs7TrainedAt = await getSettingFromDB('userFsrs7TrainedAt') || null;
    // AUDIT-5.1: bộ tham số CŨ có thể vi phạm ràng buộc thứ tự mới. Không xoá dữ liệu người dùng:
    // chỉ ngừng đưa nó cho engine (window flag), giữ nguyên bản ghi trong IndexedDB.
    if (_userFsrs7Params && !validFsrs7Params(_userFsrs7Params)) console.warn('[FSRS-7] stored params invalid; using defaults');
    if (typeof window !== 'undefined') window.__USER_FSRS7_PARAMS__ = validFsrs7Params(_userFsrs7Params) ? _userFsrs7Params : null;

    // T2.5: giọng + tốc độ TTS (cùng store settings, không tạo store mới).
    await loadTtsSettings();

    // T1.5: cap lượt ôn/ngày (settings key `reviewCapSettings`). Nạp ĐỘNG vì
    // queue.js import state.js — import tĩnh ngược lại sẽ tạo vòng.
    await import('./queue.js').then(m => m.loadReviewCapSettings()).catch(() => {});



    console.log(`Loaded: ${vocabulary.length} words from IDB.`);
    rebuildVocabIndex();
    safeUpdateStats();
}

async function persistReviewLogs() {
    const saved = await saveReviewLogsToDB(structuredClone(_reviewLogs));
    _reviewLogs = mergeLogSnapshots(_reviewLogs, saved);
}
export async function addReviewLog(log) {
    let dictIndex = _reviewLogs.dict.indexOf(log.cardId);
    if (dictIndex === -1) {
        dictIndex = _reviewLogs.dict.length;
        _reviewLogs.dict.push(log.cardId);
    }

    // AUDIT-R2.5 + R3.1: cột 6 = cờ "lượt đầu đời" ba trạng thái. Engine luôn trả boolean nên
    // dòng mới luôn có cột; nếu vì lý do nào đó cờ vắng mặt thì KHÔNG ghi 0 (0 là khẳng định
    // "biết chắc không phải lượt đầu"), mà bỏ cột để giữ trạng thái "chưa biết".
    const row = [dictIndex, log.rating, log.t, log.reviewTime || Date.now(),
        log.modality === 'typing' ? 1 : 0, log.id || crypto.randomUUID()];
    if (log.first === true) row.push(1);
    else if (log.first === false) row.push(0);
    _reviewLogs.logs.push(row);

    if (_reviewLogs.logs.length > 10000) {
        _reviewLogs.logs = _reviewLogs.logs.slice(_reviewLogs.logs.length - 10000);
    }
    await persistReviewLogs();
    if (_reviewLogs.logs.length >= 400 && _reviewLogs.logs.length % 200 === 0) {
        import('./srs/worker-manager.js').then(module => module.checkAndRunOptimizer()).catch(console.warn);
    }
}

export async function removeReviewLog(id) {
    if (!id) return;
    _reviewLogs.logs = _reviewLogs.logs.filter(log => log[5] !== id);
    _reviewLogs.deletedIds = [...new Set([...(_reviewLogs.deletedIds || []), id])];
    await persistReviewLogs();
}

// Compatibility for dev tools; review Undo always removes by its exact ID.
export async function popLastReviewLog() {
    const last = _reviewLogs.logs.at(-1);
    if (last?.[5]) return removeReviewLog(last[5]);
    return null;
}

export async function clearReviewLogs() {
    const normalized = mergeLogSnapshots(_reviewLogs, null);
    _reviewLogs = { dict: [], logs: [], deletedIds: [...new Set([...normalized.deletedIds, ...normalized.logs.map(row => row[5])])] };
    await persistReviewLogs();
}

export function compressLogs(rawArray) {
    return compressReviewLogs(rawArray);
}

export function mergeReviewLogs(remoteLogs, localLogs) {
    return mergeLogSnapshots(remoteLogs, localLogs);
}

export function setReviewLogs(logs) {
    // Chốt chặn cuối: mọi đường ghi vào state (kể cả pull/merge) đều không thể
    // làm log phình quá ngưỡng trong bộ nhớ.
    _reviewLogs = pruneReviewLogs(logs);
}

export function toggleStarOnCurrentCard() {
    if (_currentCardIndex < 0 || !vocabulary[_currentCardIndex]) return false;
    const card = vocabulary[_currentCardIndex];
    card.isStarred = !card.isStarred;
	card.updatedAt = Date.now();
    card.flagsUpdatedAt = nextRevision(card, 'flagsUpdatedAt');
    card.updatedAt = Math.max(card.updatedAt, card.flagsUpdatedAt);
    // Incremental save + sync thay vì ghi toàn bộ vocabulary
    saveOneWord(card);
    return card.isStarred;
}

export async function revertGamificationAfterUndo(snapshot) {
    if (!snapshot) return;

    // 1. Trừ lại XP đã cộng
    if (snapshot.addedXP > 0) {
        _gamification.userXP = Math.max(0, (_gamification.userXP || 0) - snapshot.addedXP);
        _gamification.currentLevel = Math.floor(Math.sqrt(_gamification.userXP / 100)) + 1;
    }

    // 2. Trừ lượt review
    if (_gamification.totalReviews > 0) {
        _gamification.totalReviews -= 1;
    }

    // 3. Khôi phục chuỗi Combo ban đầu — CHỈ khi combo hiện tại vẫn đúng là giá trị lượt chấm đã
    //    để lại. Nếu một lượt khác đã đổi combo sau đó thì giữ nguyên (AUDIT-R3.2).
    //    Snapshot cũ (tạo trước bản vá) không có `comboAfter` ⇒ giữ hành vi cũ.
    if (snapshot.comboAfter === undefined || (_gamification.consecutiveCorrect || 0) === snapshot.comboAfter) {
        _gamification.consecutiveCorrect = snapshot.comboBefore || 0;
    }

    // 4. Trừ Heatmap của ngày hôm nay
    const today = getLocalDateString(snapshot.timestamp);
    if (_gamification.activityHeatmap && _gamification.activityHeatmap[today]) {
        _gamification.activityHeatmap[today] = Math.max(0, _gamification.activityHeatmap[today] - 1);
        if (_gamification.activityHeatmap[today] === 0) {
            delete _gamification.activityHeatmap[today];
        }
    }
    syncStreakFromHeatmap();

    // 5. Khôi phục Daily Stats
    ensureDailyStats();
    if (_dailyStats.lastDate === today) {
        if (_dailyStats.todayTotal > 0) _dailyStats.todayTotal -= 1;
        if (snapshot.isCorrect && _dailyStats.todayCorrect > 0) _dailyStats.todayCorrect -= 1;
        // AUDIT-3.1: hoàn ĐÚNG suất ngân sách đã tiêu — kể cả lượt trả lời SAI (ngân sách tính theo
        // sự kiện đã gặp thẻ) và kể cả nhóm 'learning' (ngoài cap nhưng vẫn là tiến trình).
        revertReviewBudget(snapshot.countedCategory);
    }

    // 6. AUDIT-R2.2: hoàn phần thống kê mà lượt chấm đã thay đổi. `snapshot.statsBefore` được
    // chụp ở ĐẦU handler (trước trackEvent/addXP) nên delta bao gồm cả easyPresses/hardPresses
    // và xpToday/xpWeekTotal. `revertReviewStats` phân biệt bộ đếm cộng dồn với mốc thời gian /
    // streak / max, và bỏ qua bộ đếm đã rollover sang ngày/tuần/tháng mới.
    revertReviewStats(_gamification.stats, snapshot.statsBefore, snapshot.statsDelta, getLocalDateString());

    await saveGamification();
    await saveDailyStats();

    // Cập nhật lại giao diện
    const event = new CustomEvent('gamification:update');
    document.getElementById('app-container')?.dispatchEvent(event);
    updateStats();
}

export async function setUserSrsParams(recall, lapse) {
    _userRecallParams = recall;
    _userLapseParams = lapse;
    await saveSettingToDB('userRecallParams', recall);
    await saveSettingToDB('userLapseParams', lapse);
    await saveSettingToDB('userParamsTrainedAt', Date.now());
}

export async function setUserFsrs7Params(params34, trainedAtTimestamp = null) {
    // T4.5b: 2 nhánh "reset" và "đặt mới" trước đây là 2 bản chép y hệt nhau
    // (chỉ khác `reset`), nay dùng chung 1 thân. Hành vi + thứ tự ghi không đổi:
    // tham số không hợp lệ vẫn trả lỗi TRƯỚC khi chạm vào state/IndexedDB.
    const reset = params34 === null;
    if (!reset && !validFsrs7Params(params34)) {
        return { success: false, error: 'Phải chứa đúng 34 số thực hợp lệ' };
    }
    _userFsrs7Params = reset ? null : params34;
    _userFsrs7TrainedAt = trainedAtTimestamp ?? Math.max(Date.now(), (_userFsrs7TrainedAt || 0) + 1);
    if (typeof window !== 'undefined') window.__USER_FSRS7_PARAMS__ = _userFsrs7Params;
    await saveSettingToDB('userFsrs7Params', _userFsrs7Params);
    await saveSettingToDB('userFsrs7TrainedAt', _userFsrs7TrainedAt);
    await saveSettingToDB('userParamsTrainedAt', _userFsrs7TrainedAt);
    return { success: true, reset };
}

export function exportReviewLogsAsJson() {
    // AUDIT-R2.5: phần dựng danh sách tách sang hàm thuần (review-log-merge.js) để test được,
    // và để cờ "lượt đầu đời" chắc chắn có mặt trong file xuất.
    const rawList = (_reviewLogs && _reviewLogs.dict && Array.isArray(_reviewLogs.logs))
        ? buildReviewLogsExport(_reviewLogs, vocabulary)
        : (Array.isArray(_reviewLogs) ? _reviewLogs : []);

    if (rawList.length === 0) {
        return { success: false, count: 0 };
    }

    const payload = {
        exportedAt: new Date().toISOString(),
        version: "FSRS-7",
        totalReviews: rawList.length,
        logs: rawList
    };

    const jsonStr = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const dateStr = new Date().toISOString().slice(0, 10);
    link.download = `celestial_review_logs_${dateStr}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    return { success: true, count: rawList.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// BARREL — re-export nguyên vẹn API công khai cũ (91 tên gốc + 2 tên ngày tháng).
// Không call-site nào phải sửa. Nhóm theo module nguồn.
// ─────────────────────────────────────────────────────────────────────────────
export {
    MAX_REVIEW_LOG_ENTRIES,
    MAX_REVIEW_LOG_BYTES,
    MAX_REVIEW_LOG_DELETED_IDS,
    utf8ByteLength,
    toCloudReviewLogPayload,
    measureReviewLogBytes,
    pruneReviewLogs,
    prepareReviewLogsForCloud
} from './state/review-log-prune.js';

export { getVocabById, getVocabIndexById, updateCardInVocabulary, pushCardToVocabulary, setVocabulary } from './state/vocabulary.js';
export { setGamification, setDailyStats };
export { setPreviewMode, isPreviewMode } from './state/preview-mode.js';
export { isCardLeech } from './state/typing-filter.js';
export {
    TTS_SETTINGS_KEY,
    TTS_RATE_MIN,
    TTS_RATE_MAX,
    TTS_RATE_DEFAULT,
    normalizeTtsRate,
    normalizeTtsVoice,
    normalizeTtsSource,
    getTtsSettings,
    loadTtsSettings,
    setTtsVoice,
    setTtsRate,
    setTtsSource,
    ttsSource
} from './state/tts-settings.js';
export {
    MIN_STREAK_DAILY_REVIEWS,
    STREAK_LEGACY_CUTOFF_DATE,
    isDayStreakQualified,
    reconcileStreakFreeze,
    calculateStreakFromHeatmap
} from './state/streak.js';
export { seedIsolatedDemoVocabulary } from './state/demo-seed.js';

export {
    setInitialSyncDone,
    isInitialSyncDone,
    prepareProgress,
    acceptProgress,
    getComboMultiplier,
    ensureDailyStats,
    incrementNewCardsDone,
    incrementDueCardsDone,
    incrementLearningCardsDone,
    incrementReviewBudget,
    revertReviewBudget,
    recordReviewResult,
    recordQuizAnswer,
    saveGamification,
    saveDailyStats,
    addXP,
    setXP,
    checkAndApplyStreakFreeze,
    buyStreakFreeze,
    getStreakRecoveryStatus,
    completeStreakRecovery,
    syncStreakFromHeatmap,
    logActivity,
    checkStreakStatusOnLoad,
    checkAndUpdateStreak,
    unlockBadge,
    trackEvent
} from './state/gamification.js';
