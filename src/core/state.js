import { compressLogs as compressReviewLogs, mergeReviewLogs as mergeLogSnapshots } from './review-log-merge.js';
import { getDeviceId } from './device.js';
import { saveReviewLogsToDB } from './idb.js';
import { rolloverDailyStats } from './daily-stats.js';
import { normalizeCard, mergeCardFields, nextRevision } from './card-merge.js';
import { initializeProgress, captureProgress, mergeProgress } from './progress-merge.js';
import { validFsrs7Params } from './srs/constants.js';
import { saveProgressToDB } from './idb.js';
import { announceSyncStatus } from './sync-status.js';
import { isIsolatedStorage } from './idb.js';
import { showPopup, showToast } from '../ui/modal.js';
import { updateStats } from '../ui/render.js';
import { initAppDB, getAllVocabularyFromDB, saveAllVocabularyToDB, saveWordToDB, getSettingFromDB, saveSettingToDB } from './idb.js';
import { getLocalDateString, getOffsetDateString } from './utils/date.js';
export { getLocalDateString, getOffsetDateString } from './utils/date.js';

import { syncCardToFirebase } from './sync.js';

let _vocabulary = [];
let _vocabIndex = new Map(); // id → index in _vocabulary

function _rebuildVocabIndex() {
    _vocabIndex.clear();
    for (let i = 0; i < _vocabulary.length; i++) {
        if (_vocabulary[i] && _vocabulary[i].id) {
            _vocabIndex.set(_vocabulary[i].id, i);
        }
    }
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
let _isPreviewMode = false;
let _isTransitioning = false;
export const MIN_STREAK_DAILY_REVIEWS = 10;
export const STREAK_LEGACY_CUTOFF_DATE = '2026-10-23';

let _initialSyncDone = false;
export function setInitialSyncDone(done = true) {
    _initialSyncDone = Boolean(done);
}
export function isInitialSyncDone() {
    return _initialSyncDone;
}

let _lastReviewSnapshot = null;
let _dailyStats = {
    newCardsDoneToday: 0,
    dueDoneToday: 0,
    learningDoneToday: 0,
    retentionHistory: [],
    lastDate: getLocalDateString()
};

let _gamification = {
    userXP: 0,
    currentLevel: 1,
    currentStreak: 0,
    lastStudyDate: "",
    activityHeatmap: {},
    unlockedBadges: [],
    totalReviews: 0,
    streakFreezeCount: 0,
    lastStreakFreezeDate: "",
    frozenDates: [],
    recoveredDates: [],
    stats: {
        // Group 1: Time
        nightOwlWords: 0,
        earlyBirdStreak: 0, lastEarlyBirdDate: "",
        vampireStreak: 0, lastVampireDate: "",
        opensToday: 0, lastOpenDate: "",
        sunsetStreak: 0, lastSunsetDate: "",
        totalTimeSpent: 0, 

        // Group 2: Speed & Acc
        quizCorrectStreak: 0,
        perfectQuizStreak: 0,
        monthlyCorrect: 0, monthlyTotal: 0,

        // Group 3: Interactions
        easyPresses: 0,
        hardPresses: 0,
        profileViews: 0,
        imports: 0,
        exports: 0,
        darkModeDays: 0, lastDarkModeDate: "",
        manualWordsAdded: 0,

        // Group 4: Grinding
        wordsAddedToday: 0, lastAddedDate: "",
        xpToday: 0, lastXPDate: "",
        leechesHealed: 0,
        maxLostStreak: 0,
        lastForgottenDate: Date.now(), // default to now

        // Group 5: Humor
        overdueReviewedToday: 0,
        bareMinimumDays: 0,
        accidentCount: 0,
        
        // Metadata
        accountCreatedDate: Date.now(),
        
        // Group 6: Typing
        typingPerfectQuizzes: 0, typingTypoStreaks: 0, typingFastAnswers: 0,
        typingNoHintStreak: 0, typingTotalCorrect: 0, typingLastCharTypo: 0,
        typingShortWordTypo: 0, typingClearedInput: 0, typingLeechRepeats: 0,
        typingImmediateExit: 0, 
        
        // Group 7: UI/UX
        syncSpamCount: 0, cardFlipSpam: 0,
        consecutiveDeletes: 0, consecutiveShortcuts: 0, taskbarToggles: 0,
        audioSpam: 0, filterToggles: 0, 
        
        // Group 8: Bizarre
        xpLastWeek: 0, topicHopping: 0,
        consecutiveEasy: 0, quizZeroScore: 0, justLeveledUp: false,
        karmaEncounter: 0, kingReturns: 0
    }
};

let _reviewLogs = [];
let _userRecallParams = null;
let _userLapseParams = null;
let _userFsrs7Params = null;
let _userFsrs7TrainedAt = null;
const progressActor = getDeviceId();
function skipPersistence() {
    return _isPreviewMode || (sessionStorage.getItem('CHEAT_MODE') === 'true' && !isIsolatedStorage);
}

export function prepareProgress(kind) {
    if (kind === 'daily') rolloverDailyStats(_dailyStats, getLocalDateString());
    return captureProgress(kind === 'daily' ? _dailyStats : _gamification, kind, progressActor);
}

export function acceptProgress(remote, kind) {
    const merged = mergeProgress(prepareProgress(kind), remote, kind, kind === 'daily' ? getLocalDateString() : null);
    if (kind === 'daily') _dailyStats = merged;
    else {
        _gamification = merged;
        reconcileStreakFreeze(_gamification);
        const streak = calculateStreakFromHeatmap(
            _gamification.activityHeatmap,
            getLocalDateString(),
            _gamification.frozenDates,
            _gamification.recoveredDates
        );
        merged.currentStreak = streak.currentStreak;
        merged.longestStreak = Math.max(merged.longestStreak || 0, streak.longestStreak);
    }
    return merged;
}

export const getState = () => ({
    vocabulary: _vocabulary,
    currentReviewQueue: _currentReviewQueue,
    allTags: _allTags,
    currentCardIndex: _currentCardIndex,
    isFlipped: _isFlipped,
    isDarkMode: _isDarkMode,
    isBoostMode: _isBoostMode,
    soundMode: _soundMode,
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

export function getComboMultiplier() {
    const consecutive = _gamification.consecutiveCorrect || 0;
    if (consecutive >= 30) return 1.5;
    if (consecutive >= 10) return 1.2;
    if (consecutive >= 5) return 1.1;
    return 1;
}

export function setVocabulary(newVocab) { 
    _vocabulary = newVocab; 
    _rebuildVocabIndex();
}
export function setReviewQueue(newQueue) { _currentReviewQueue = newQueue; }
export function setAllTags(newTags) { _allTags = newTags; }
export function setCurrentCardIndex(index) { _currentCardIndex = index; }
export function setIsTransitioning(isTrans) { _isTransitioning = isTrans; }
export function getLastReviewSnapshot() { return _lastReviewSnapshot; }
export function setLastReviewSnapshot(snapshot) { _lastReviewSnapshot = snapshot; }
export function clearLastReviewSnapshot() { _lastReviewSnapshot = null; }

export function getVocabById(id) {
    const idx = _vocabIndex.get(id);
    return idx !== undefined ? _vocabulary[idx] : undefined;
}

export function getVocabIndexById(id) {
    return _vocabIndex.has(id) ? _vocabIndex.get(id) : -1;
}

/**
 * Update 1 card trong vocabulary tại chỗ theo ID.
 * Trả về true nếu tìm thấy và cập nhật, false nếu không.
 */
export function updateCardInVocabulary(cardId, updatedCard) {
    const idx = _vocabIndex.get(cardId);
    if (idx !== undefined) {
        _vocabulary[idx] = updatedCard;
        return true;
    }
    return false;
}

/**
 * Thêm card mới vào vocabulary (dùng cho sync pull).
 * Tự động cập nhật index map.
 */
export function pushCardToVocabulary(card) {
    const newIndex = _vocabulary.length;
    _vocabulary.push(card);
    if (card && card.id) _vocabIndex.set(card.id, newIndex);
    return newIndex;
}
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

export function isCardLeech(card) {
    if (!card) return false;
    return (card.lapses !== undefined && card.lapses >= 2) ||
           (card.difficulty !== undefined && card.difficulty >= 7.5) ||
           (card.srsStatus === 'Learning' && (card.reps || 0) >= 3) ||
           (card.srsEaseFactor !== undefined && card.srsEaseFactor <= 2.1);
}

export function shouldCardUseTyping(card) {
    if (!_isTypingMode || _typingFilter === 'off' || !card) return false;
    
    switch (_typingFilter) {
        case 'all':
            return true;
        case 'leech':
            return isCardLeech(card);
        case 'hard':
            return (card.difficulty !== undefined && card.difficulty >= 6.5) ||
                   (card.srsEaseFactor !== undefined && card.srsEaseFactor <= 2.3) ||
                   isCardLeech(card);
        case 'learning':
            return card.srsStatus === 'New' || card.srsStatus === 'Learning';
        case 'starred':
            return !!card.isStarred;
        case 'long':
            return (card.english || '').replace(/[^a-zA-Z]/g, '').length >= 8;
        default:
            return true;
    }
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
    
    for (let i = 0; i < _vocabulary.length; i++) {
        const card = _vocabulary[i];
        if (!card || card.isDeleted) continue;
        stats.total++;
        stats.all++;
        if (isCardLeech(card)) stats.leech++;
        if ((card.difficulty !== undefined && card.difficulty >= 6.5) ||
            (card.srsEaseFactor !== undefined && card.srsEaseFactor <= 2.3) ||
            isCardLeech(card)) {
            stats.hard++;
        }
        if (card.srsStatus === 'New' || card.srsStatus === 'Learning') stats.learning++;
        if (card.isStarred) stats.starred++;
        if ((card.english || '').replace(/[^a-zA-Z]/g, '').length >= 8) stats.long++;
    }
    return stats;
}
export function setCurrentTopicFilter(topic) { _currentTopicFilter = topic; }
export function setSoundMode(mode) { _soundMode = mode; }
export function setGamification(data) { _gamification = data; }
export function setDailyStats(data) { _dailyStats = data; }
export function setPreviewMode(val) { _isPreviewMode = val; }
export function isPreviewMode() { return _isPreviewMode; }

export async function saveVocabulary(skipSync = false) {
    try {
        const vocabToSave = _vocabulary.map(w => ({ ...w, srsDueDate: w.srsDueDate || null }));
        
        // Lưu toàn bộ vào IndexedDB (chỉ dùng cho bulk operations: import, full sync)
        const stored = await saveAllVocabularyToDB(vocabToSave, { markDirty: !skipSync });
        const current = new Map(_vocabulary.map(card => [card.id, card]));
        setVocabulary(stored.map(card => mergeCardFields(current.get(card.id) || card, card)));
        await saveDailyStats();
        
        updateStats();
    } catch (e) {
        console.error("Save error:", e);
        showPopup("Lỗi không thể lưu dữ liệu!", "error");
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
        updateStats();
        // Queue sync lên Cloud (batch 30s)
        syncCardToFirebase(merged);
        if (typeof window !== 'undefined') import('./tab-bus.js').then(bus => bus.broadcastCardUpdated?.(merged));
        return merged;
    } catch (e) {
        console.error("SaveOneWord error:", e);
        announceSyncStatus({ phase: 'storage-error' });
        showToast('Chưa lưu được', 'Thiết bị chưa lưu được lượt học này. Hãy xuất dữ liệu trước khi đóng trang.', 'ph-warning');
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
    _vocabulary = [];
    let hasSuspendedMigration = false;
    
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
            // Tự động bỏ trạng thái tạm ngưng cho mọi từ vựng trong cơ sở dữ liệu (chế độ tạm ngưng đã bị hủy bỏ hoàn toàn)
            if (word.isSuspended) {
                word.isSuspended = false;
                hasSuspendedMigration = true;
            } else {
                word.isSuspended = false;
            }
            if (!word.id) word.id = crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).substring(2, 10));
            _vocabulary.push(normalizeCard(word));
            word.tags.forEach(tag => _allTags.add(tag));
        });
        if (hasSuspendedMigration) {
            saveAllVocabularyToDB(_vocabulary).catch(console.error);
        }
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

    _dailyStats = initializeProgress(parsedStats || _dailyStats, 'daily');
    ensureDailyStats();
    // Load Gamification Stats
    let savedGamification = await getSettingFromDB('gamification');
    if (savedGamification) {
        _gamification = { ..._gamification, ...savedGamification };
        initializeProgress(_gamification, 'gamification');
        checkStreakStatusOnLoad(); // Check streak status on load (reset UI if missed days, do not grant streak without study)
    }
    initializeProgress(_gamification, 'gamification');



    let rawLogs = await getSettingFromDB('reviewLogs') || { dict: [], logs: [] };
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
    if (typeof window !== 'undefined') window.__USER_FSRS7_PARAMS__ = _userFsrs7Params;



    console.log(`Loaded: ${_vocabulary.length} words from IDB.`);
    _rebuildVocabIndex();
    updateStats();
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
    
    _reviewLogs.logs.push([dictIndex, log.rating, log.t, log.reviewTime || Date.now(), log.modality === 'typing' ? 1 : 0, log.id || crypto.randomUUID()]);
    
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
    _reviewLogs = logs;
}

export async function setUserSrsParams(recall, lapse) {
    _userRecallParams = recall;
    _userLapseParams = lapse;
    await saveSettingToDB('userRecallParams', recall);
    await saveSettingToDB('userLapseParams', lapse);
    await saveSettingToDB('userParamsTrainedAt', Date.now());
}

export async function setUserFsrs7Params(params34, trainedAtTimestamp = null) {
    if (params34 === null) {
        _userFsrs7Params = null;
        _userFsrs7TrainedAt = trainedAtTimestamp ?? Math.max(Date.now(), (_userFsrs7TrainedAt || 0) + 1);
        if (typeof window !== 'undefined') window.__USER_FSRS7_PARAMS__ = null;
        await saveSettingToDB('userFsrs7Params', null);
        await saveSettingToDB('userFsrs7TrainedAt', _userFsrs7TrainedAt);
        await saveSettingToDB('userParamsTrainedAt', _userFsrs7TrainedAt);
        return { success: true, reset: true };
    }
    if (validFsrs7Params(params34)) {
        _userFsrs7Params = params34;
        _userFsrs7TrainedAt = trainedAtTimestamp ?? Math.max(Date.now(), (_userFsrs7TrainedAt || 0) + 1);
        if (typeof window !== 'undefined') window.__USER_FSRS7_PARAMS__ = _userFsrs7Params;
        await saveSettingToDB('userFsrs7Params', params34);
        await saveSettingToDB('userFsrs7TrainedAt', _userFsrs7TrainedAt);
        await saveSettingToDB('userParamsTrainedAt', _userFsrs7TrainedAt);
        return { success: true, reset: false };
    }
    return { success: false, error: 'Phải chứa đúng 34 số thực hợp lệ' };
}

export function exportReviewLogsAsJson() {
    let rawList = [];
    if (_reviewLogs && _reviewLogs.dict && Array.isArray(_reviewLogs.logs)) {
        const vocabMap = new Map();
        _vocabulary.forEach(w => {
            if (w.id) vocabMap.set(w.id, w.english || '');
        });
        rawList = _reviewLogs.logs.map((log, idx) => {
            const cardId = _reviewLogs.dict[log[0]];
            return {
                cardId,
                english: vocabMap.get(cardId) || '',
                rating: log[1],
                t: log[2],
                ts: log[3] || (Date.now() - 1000000 + idx),
                isTyping: log[4] === 1,
                id: log[5]
            };
        });
    } else if (Array.isArray(_reviewLogs)) {
        rawList = _reviewLogs;
    }

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

export function ensureDailyStats() {
    const previous = _dailyStats.lastDate;
    rolloverDailyStats(_dailyStats, getLocalDateString());
    if (previous !== _dailyStats.lastDate) void saveDailyStats();
    return _dailyStats;
}

export function incrementNewCardsDone() {
    ensureDailyStats();
    _dailyStats.newCardsDoneToday += 1;
    void saveDailyStats();
}
export function incrementDueCardsDone() {
    ensureDailyStats();
    _dailyStats.dueDoneToday = (_dailyStats.dueDoneToday || 0) + 1;
    void saveDailyStats();
}
export function incrementLearningCardsDone() {
    ensureDailyStats();
    _dailyStats.learningDoneToday = (_dailyStats.learningDoneToday || 0) + 1;
    void saveDailyStats();
}

export function recordReviewResult(isCorrect) {
    checkAndUpdateStreak(); // Đảm bảo cập nhật streak kể cả khi user treo tab sang ngày mới
    
    ensureDailyStats();

    _dailyStats.todayTotal = (_dailyStats.todayTotal || 0) + 1;
    if (isCorrect) {
        _dailyStats.todayCorrect = (_dailyStats.todayCorrect || 0) + 1;
        _gamification.consecutiveCorrect = (_gamification.consecutiveCorrect || 0) + 1;
        
        // Gamification: Thông báo Combo mỗi 10 câu đúng liên tiếp
        if (_gamification.consecutiveCorrect > 0 && _gamification.consecutiveCorrect % 10 === 0) {
            showToast('Chuỗi Combo Đỉnh Cao', `🔥 Đỉnh quá! Trả lời đúng liên tiếp: ${_gamification.consecutiveCorrect}`, 'ph-fire');
        }
    } else {
        // Option 3 Combo Degradation: Bấm sai khi >=30 rớt về 10, còn lại rớt về 0
        let currentCombo = _gamification.consecutiveCorrect || 0;
        if (currentCombo >= 30) {
            _gamification.consecutiveCorrect = 10; // Rớt từ x1.5 xuống mốc 10 (x1.2)
        } else {
            _gamification.consecutiveCorrect = 0;  // Mất combo hoàn toàn về 0 (x1.0)
        }
    }
    _gamification.totalReviews = (_gamification.totalReviews || 0) + 1;
    // Dùng incremental save thay vì saveVocabulary()
    void saveDailyStats();
    saveGamification();
}

export function recordQuizAnswer(isCorrect) {
    recordReviewResult(isCorrect);
    logActivity();
    _gamification.stats ||= {};
    _gamification.stats.quizCorrectStreak = isCorrect ? (_gamification.stats.quizCorrectStreak || 0) + 1 : 0;
    void saveGamification();
}

export function toggleStarOnCurrentCard() {
    if (_currentCardIndex < 0 || !_vocabulary[_currentCardIndex]) return false;
    const card = _vocabulary[_currentCardIndex];
    card.isStarred = !card.isStarred;
	card.updatedAt = Date.now();
    card.flagsUpdatedAt = nextRevision(card, 'flagsUpdatedAt');
    card.updatedAt = Math.max(card.updatedAt, card.flagsUpdatedAt);
    // Incremental save + sync thay vì ghi toàn bộ vocabulary
    saveOneWord(card);
    return card.isStarred;
}

export async function saveGamification() {
    if (skipPersistence()) return;
    prepareProgress('gamification');
    try {
        const saved = await saveProgressToDB('gamification', structuredClone(_gamification), 'gamification');
        acceptProgress(saved, 'gamification');
        import('./sync.js').then(m => m.queueGamificationSync());
        if (typeof window !== 'undefined') import('./tab-bus.js').then(bus => bus.broadcastProgressUpdated?.(_gamification, _dailyStats));
    } catch(e) { announceSyncStatus({ phase: 'storage-error' }); console.error('Không lưu được tiến độ học:', e); }
}

export async function saveDailyStats() {
    if (skipPersistence()) return;
    prepareProgress('daily');
    try {
        const saved = await saveProgressToDB('dailyStats', structuredClone(_dailyStats), 'daily');
        acceptProgress(saved, 'daily');
        import('./sync.js').then(m => m.queueGamificationSync());
        if (typeof window !== 'undefined') import('./tab-bus.js').then(bus => bus.broadcastProgressUpdated?.(_gamification, _dailyStats));
    } catch(e) { announceSyncStatus({ phase: 'storage-error' }); console.error('Không lưu được thống kê ngày:', e); }
}

export function addXP(amount, floatText = null) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    const oldLevel = _gamification.currentLevel || 1;
    _gamification.userXP += amount;
    _gamification.currentLevel = Math.floor(Math.sqrt(_gamification.userXP / 100)) + 1;
    saveGamification();
    
    if (_gamification.currentLevel > oldLevel) {
        import('./sound.js').then(m => m.playSound('levelUp'));
    }
    
    // Gọi event cho UI (hiệu ứng +XP)
    const xpEvent = new CustomEvent('gamification:xp_added', { detail: { amount, text: floatText } });
    document.getElementById('app-container')?.dispatchEvent(xpEvent);

    // Gọi event để check badge
    const event = new CustomEvent('gamification:update');
    document.getElementById('app-container')?.dispatchEvent(event);
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
    
    // 3. Khôi phục chuỗi Combo ban đầu
    _gamification.consecutiveCorrect = snapshot.comboBefore || 0;
    
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
        if (snapshot.wasNewCard && snapshot.isCorrect && _dailyStats.newCardsDoneToday > 0) {
            _dailyStats.newCardsDoneToday -= 1;
        }
    }
    
    if (_dailyStats.lastDate === today && snapshot.isCorrect) {
        const key = snapshot.previousCard?.srsStatus === 'Learning' ? 'learningDoneToday'
            : snapshot.countedDue ? 'dueDoneToday' : null;
        if (key) _dailyStats[key] = Math.max(0, (_dailyStats[key] || 0) - 1);
    }

    // 6. Trừ bớt event stats nếu có
    if (_gamification.stats) {
        if (snapshot.rating === 4 && _gamification.stats.easyPresses > 0) _gamification.stats.easyPresses -= 1;
        if (snapshot.rating === 2 && _gamification.stats.hardPresses > 0) _gamification.stats.hardPresses -= 1;
    }
    
    await saveGamification();
    await saveDailyStats();
    
    // Cập nhật lại giao diện
    const event = new CustomEvent('gamification:update');
    document.getElementById('app-container')?.dispatchEvent(event);
    updateStats();
}

export async function setXP(targetXP) {
    const xp = Math.max(0, parseInt(targetXP) || 0);
    _gamification.userXP = xp;
    _gamification.currentLevel = Math.floor(Math.sqrt(xp / 100)) + 1;
    await saveGamification();
    
    const event = new CustomEvent('gamification:update');
    document.getElementById('app-container')?.dispatchEvent(event);
    console.log(`✨ XP đã được set thành ${xp} (Level ${_gamification.currentLevel})`);
}



export function isDayStreakQualified(activityHeatmap = {}, dateStr, frozenDates = _gamification?.frozenDates, recoveredDates = _gamification?.recoveredDates) {
    if (!dateStr) return false;
    if (frozenDates && frozenDates.includes(dateStr)) return true;
    if (recoveredDates && recoveredDates.includes(dateStr)) return true;

    const count = (activityHeatmap && activityHeatmap[dateStr]) || 0;
    if (dateStr < STREAK_LEGACY_CUTOFF_DATE) {
        return count > 0;
    }
    return count >= MIN_STREAK_DAILY_REVIEWS;
}

export function reconcileStreakFreeze(g = _gamification) {
    if (!g) return false;
    let refunded = false;
    const heatmap = g.activityHeatmap || {};
    const frozen = Array.isArray(g.frozenDates) ? [...g.frozenDates] : [];

    const falseFrozenDates = [];
    for (const d of frozen) {
        const count = heatmap[d] || 0;
        const hasRealStudy = count >= MIN_STREAK_DAILY_REVIEWS || (d < STREAK_LEGACY_CUTOFF_DATE && count > 1);
        if (hasRealStudy) {
            falseFrozenDates.push(d);
        }
    }

    if (g.lastStreakFreezeDate) {
        const count = heatmap[g.lastStreakFreezeDate] || 0;
        const hasRealStudy = count >= MIN_STREAK_DAILY_REVIEWS || (g.lastStreakFreezeDate < STREAK_LEGACY_CUTOFF_DATE && count > 1);
        if (hasRealStudy && !falseFrozenDates.includes(g.lastStreakFreezeDate)) {
            falseFrozenDates.push(g.lastStreakFreezeDate);
        }
    }

    if (falseFrozenDates.length > 0) {
        console.log(`🛡️ Hoàn trả ${falseFrozenDates.length} Khiên Băng do phát hiện đã học (${falseFrozenDates.join(', ')})!`);
        g.frozenDates = frozen.filter(d => !falseFrozenDates.includes(d));
        if (falseFrozenDates.includes(g.lastStreakFreezeDate)) {
            g.lastStreakFreezeDate = "";
        }
        g.streakFreezeCount = Math.min(1, (g.streakFreezeCount || 0) + falseFrozenDates.length);
        refunded = true;
    }

    return refunded;
}

export function calculateStreakFromHeatmap(
    activityHeatmap = {},
    todayStr = getLocalDateString(),
    frozenDates = _gamification?.frozenDates,
    recoveredDates = _gamification?.recoveredDates
) {
    if (!activityHeatmap || typeof activityHeatmap !== 'object') {
        return { currentStreak: 0, longestStreak: 0 };
    }

    const isTodayQualified = isDayStreakQualified(activityHeatmap, todayStr, frozenDates, recoveredDates);
    const yesterdayStr = getOffsetDateString(todayStr, -1);
    const isYesterdayQualified = isDayStreakQualified(activityHeatmap, yesterdayStr, frozenDates, recoveredDates);

    let currentStreak = 0;
    let checkDateStr = null;

    if (isTodayQualified) {
        currentStreak = 1;
        checkDateStr = yesterdayStr;
    } else if (isYesterdayQualified) {
        currentStreak = 1;
        checkDateStr = getOffsetDateString(yesterdayStr, -1);
    } else {
        currentStreak = 0;
        checkDateStr = null;
    }

    if (checkDateStr) {
        while (isDayStreakQualified(activityHeatmap, checkDateStr, frozenDates, recoveredDates)) {
            currentStreak += 1;
            checkDateStr = getOffsetDateString(checkDateStr, -1);
        }
    }

    const allCandidateDates = new Set([
        ...Object.keys(activityHeatmap),
        ...(frozenDates || []),
        ...(recoveredDates || [])
    ]);

    const qualifiedDates = [...allCandidateDates]
        .filter(d => isDayStreakQualified(activityHeatmap, d, frozenDates, recoveredDates))
        .sort();

    let longestStreak = 0;
    let tempStreak = 0;
    let prevDateStr = null;

    for (const dateStr of qualifiedDates) {
        if (!prevDateStr) {
            tempStreak = 1;
        } else {
            const expectedNext = getOffsetDateString(prevDateStr, 1);
            if (dateStr === expectedNext) {
                tempStreak += 1;
            } else {
                tempStreak = 1;
            }
        }
        if (tempStreak > longestStreak) {
            longestStreak = tempStreak;
        }
        prevDateStr = dateStr;
    }

    longestStreak = Math.max(longestStreak, currentStreak);

    return { currentStreak, longestStreak };
}

export function checkAndApplyStreakFreeze(todayStr = getLocalDateString()) {
    if (!_gamification.streakFreezeCount || _gamification.streakFreezeCount <= 0) return false;
    if (!_gamification.activityHeatmap) _gamification.activityHeatmap = {};

    const yesterdayStr = getOffsetDateString(todayStr, -1);
    const dayBeforeYesterdayStr = getOffsetDateString(todayStr, -2);

    const hasStudiedYesterday = isDayStreakQualified(_gamification.activityHeatmap, yesterdayStr, _gamification.frozenDates, _gamification.recoveredDates);
    const hasStudiedDayBefore = isDayStreakQualified(_gamification.activityHeatmap, dayBeforeYesterdayStr, _gamification.frozenDates, _gamification.recoveredDates);

    // Nếu hôm qua chưa đạt điều kiện và hôm kia có đạt điều kiện -> kích hoạt khiên cứu ngày hôm qua
    if (!hasStudiedYesterday && hasStudiedDayBefore) {
        if (_gamification.lastStreakFreezeDate === dayBeforeYesterdayStr) {
            console.log("⚠️ Khiên Băng không thể kích hoạt 2 ngày liên tiếp.");
            return false;
        }

        _gamification.frozenDates = _gamification.frozenDates || [];
        if (!_gamification.frozenDates.includes(yesterdayStr)) {
            _gamification.frozenDates.push(yesterdayStr);
        }
        _gamification.streakFreezeCount = Math.max(0, _gamification.streakFreezeCount - 1);
        _gamification.lastStreakFreezeDate = yesterdayStr;

        console.log(`❄️ Khiên Băng đã kích hoạt bảo vệ ngày ${yesterdayStr}!`);
        showToast('Khiên Băng Kích Hoạt ❄️', `Kết giới băng giá đã bảo vệ chuỗi của bạn cho ngày ${yesterdayStr}!`, 'ph-snowflake');
        return true;
    }

    return false;
}

export function buyStreakFreeze() {
    const minStreak = 7;
    const costXP = 800;
    const maxStreakAchieved = Math.max(_gamification.currentStreak || 0, _gamification.longestStreak || 0);

    if (_gamification.streakFreezeCount > 0) {
        return { success: false, message: "Bạn đã trang bị Khiên Băng rồi (Tối đa 1 khiên)!" };
    }
    if (maxStreakAchieved < minStreak) {
        return { success: false, message: `Bạn cần đạt kỷ lục chuỗi tối thiểu ${minStreak} ngày để đủ tư cách chế tác Khiên Băng!` };
    }
    if ((_gamification.userXP || 0) < costXP) {
        return { success: false, message: `Không đủ XP! Chế tác Khiên Băng cần ${costXP} XP (Bạn đang có ${_gamification.userXP || 0} XP).` };
    }

    _gamification.userXP -= costXP;
    _gamification.currentLevel = Math.floor(Math.sqrt(_gamification.userXP / 100)) + 1;
    _gamification.streakFreezeCount = 1;
    saveGamification();

    const event = new CustomEvent('gamification:update');
    document.getElementById('app-container')?.dispatchEvent(event);

    return { success: true, message: "Đã rèn thành công Khiên Băng Cổ Đại ❄️! Chuỗi học của bạn đã được bảo vệ an toàn." };
}

export function getStreakRecoveryStatus(todayStr = getLocalDateString()) {
    if (!_gamification.activityHeatmap) return { canRecover: false, reason: "Chưa có dữ liệu hoạt động" };

    const heatmap = _gamification.activityHeatmap;
    const frozen = _gamification.frozenDates;
    const recovered = _gamification.recoveredDates;
    const currentStreak = calculateStreakFromHeatmap(heatmap, todayStr, frozen, recovered).currentStreak;

    // Nếu người dùng đang duy trì chuỗi tốt từ 2 ngày trở lên -> Chuỗi đang hoạt động bình thường, không hiển thị cứu chuỗi
    if (currentStreak >= 2) {
        return { canRecover: false, reason: "Chuỗi học đang duy trì tốt, không có ngày gián đoạn cần cứu." };
    }

    let gapStartOffset = -1;
    const isTodayQ = isDayStreakQualified(heatmap, todayStr, frozen, recovered);
    const isYestQ = isDayStreakQualified(heatmap, getOffsetDateString(todayStr, -1), frozen, recovered);
    if (isTodayQ && !isYestQ) {
        gapStartOffset = -1;
    } else if (!isTodayQ && isYestQ) {
        gapStartOffset = -2;
    } else {
        gapStartOffset = -1;
    }

    // Quét vùng gián đoạn (gap) liên tiếp trong phạm vi 7 ngày gần nhất
    const missedDates = [];
    let gapOffset = gapStartOffset;

    while (gapOffset >= -7 && !isDayStreakQualified(heatmap, getOffsetDateString(todayStr, gapOffset), frozen, recovered)) {
        missedDates.push(getOffsetDateString(todayStr, gapOffset));
        gapOffset--;
    }

    // Không có ngày nào bị thiếu trong 7 ngày qua
    if (missedDates.length === 0) {
        return { canRecover: false, reason: "Chuỗi học đang duy trì tốt, không có ngày gián đoạn trong 7 ngày qua." };
    }

    // Nếu đã quét hết 7 ngày mà ngày thứ -8 vẫn là 0 (gap kéo dài quá 7 ngày)
    if (gapOffset < -7 && !isDayStreakQualified(heatmap, getOffsetDateString(todayStr, gapOffset), frozen, recovered)) {
        return {
            canRecover: false,
            reason: "Thời gian gián đoạn đã vượt quá 1 tuần (7 ngày). Chuỗi lửa đã hóa thành tro tàn cổ đại."
        };
    }

    // 3. Quét chuỗi học ngay trước vùng gián đoạn
    let priorStreak = 0;
    let priorOffset = gapOffset;
    while (isDayStreakQualified(heatmap, getOffsetDateString(todayStr, priorOffset), frozen, recovered)) {
        priorStreak++;
        priorOffset--;
    }

    // Yêu cầu chuỗi trước đó phải >= 2 ngày để việc tái sinh có giá trị
    if (priorStreak < 2) {
        return {
            canRecover: false,
            reason: priorStreak === 0
                ? "Không tìm thấy chuỗi học trước đợt gián đoạn."
                : "Chuỗi trước khi gián đoạn chỉ có 1 ngày, chưa đủ điều kiện tái sinh (cần tối thiểu 2 ngày)."
        };
    }

    // Đủ điều kiện thực hiện Thử Thách Tái Sinh trong vòng 1 tuần!
    const costXP = 500;
    const firstMissed = missedDates[missedDates.length - 1];
    const lastMissed = missedDates[0];
    const dateRangeStr = missedDates.length === 1 
        ? `ngày ${lastMissed}` 
        : `${missedDates.length} ngày (từ ${firstMissed} đến ${lastMissed})`;

    return {
        canRecover: true,
        missedDate: lastMissed, // Giữ thuộc tính tương thích ngược
        missedDates, // Danh sách toàn bộ các ngày gián đoạn trong 7 ngày qua
        missedDaysCount: missedDates.length,
        priorStreak,
        costXP,
        reason: `Bạn đã gián đoạn ${dateRangeStr}, làm nguội lạnh chuỗi ${priorStreak} ngày!`
    };
}

export function completeStreakRecovery(missedDates) {
    const datesToRecover = Array.isArray(missedDates) 
        ? missedDates.filter(Boolean) 
        : (missedDates ? [missedDates] : []);

    if (datesToRecover.length === 0) {
        return { success: false, message: "Ngày tái sinh chuỗi không hợp lệ" };
    }

    const costXP = 500;
    if ((_gamification.userXP || 0) < costXP) {
        return { success: false, message: `Không đủ Tinh Hoa XP để làm lễ vật tái sinh! Cần ${costXP} XP (bạn có ${_gamification.userXP || 0} XP).` };
    }

    _gamification.userXP -= costXP;
    _gamification.currentLevel = Math.floor(Math.sqrt(_gamification.userXP / 100)) + 1;
    
    if (!_gamification.activityHeatmap) _gamification.activityHeatmap = {};
    _gamification.recoveredDates = _gamification.recoveredDates || [];

    datesToRecover.forEach(dateStr => {
        _gamification.activityHeatmap[dateStr] = Math.max(_gamification.activityHeatmap[dateStr] || 0, 1);
        if (!_gamification.recoveredDates.includes(dateStr)) {
            _gamification.recoveredDates.push(dateStr);
        }
    });

    unlockBadge('special_phoenix');
    syncStreakFromHeatmap();

    const rangeText = datesToRecover.length === 1 
        ? datesToRecover[0] 
        : `${datesToRecover.length} ngày (${datesToRecover[datesToRecover.length - 1]} → ${datesToRecover[0]})`;

    return {
        success: true,
        message: `🔥 TÁI SINH THÀNH CÔNG! Ngọn lửa tinh tú đã bùng cháy trở lại, kết nối thành công chuỗi ngày (${rangeText})!`,
        recoveredDates: datesToRecover
    };
}

export function syncStreakFromHeatmap(options = {}) {
    const today = getLocalDateString();
    if (!_gamification.activityHeatmap) {
        _gamification.activityHeatmap = {};
    }

    // Hoàn trả Khiên Băng nếu phát hiện đã học nhưng bị trừ nhầm trước khi đồng bộ
    reconcileStreakFreeze(_gamification);

    // Tự động kích hoạt Khiên Băng nếu đủ điều kiện cứu ngày hôm qua (chỉ khi được phép)
    const allowFreeze = options.allowFreeze ?? (typeof navigator === 'undefined' || !navigator.onLine || _initialSyncDone);
    if (allowFreeze) {
        checkAndApplyStreakFreeze(today);
    }

    const { currentStreak, longestStreak } = calculateStreakFromHeatmap(
        _gamification.activityHeatmap,
        today,
        _gamification.frozenDates,
        _gamification.recoveredDates
    );
    _gamification.currentStreak = currentStreak;
    _gamification.longestStreak = Math.max(_gamification.longestStreak || 0, longestStreak);
    if (isDayStreakQualified(_gamification.activityHeatmap, today, _gamification.frozenDates, _gamification.recoveredDates)) {
        _gamification.lastStudyDate = today;
    } else {
        const activeDates = Object.keys(_gamification.activityHeatmap)
            .filter(d => isDayStreakQualified(_gamification.activityHeatmap, d, _gamification.frozenDates, _gamification.recoveredDates))
            .sort();
        if (activeDates.length > 0) {
            _gamification.lastStudyDate = activeDates[activeDates.length - 1];
        }
    }
    saveGamification();
    
    const event = new CustomEvent('gamification:update');
    document.getElementById('app-container')?.dispatchEvent(event);
}

export function logActivity() {
    const today = getLocalDateString(); // YYYY-MM-DD local
    if (!_gamification.activityHeatmap) {
        _gamification.activityHeatmap = {};
    }
    if (!_gamification.activityHeatmap[today]) {
        _gamification.activityHeatmap[today] = 0;
    }
    _gamification.activityHeatmap[today] += 1;
    const currentTodayCount = _gamification.activityHeatmap[today];
    if (currentTodayCount === MIN_STREAK_DAILY_REVIEWS) {
        showToast('Nối Chuỗi Thành Công! 🔥', `Tuyệt vời! Bạn đã hoàn thành ${MIN_STREAK_DAILY_REVIEWS} lượt ôn tập hôm nay để bảo toàn chuỗi tinh tú!`, 'ph-fire');
    }
    syncStreakFromHeatmap();
}

export function checkStreakStatusOnLoad() {
    // Không trừ khiên sớm khi vừa mở web nếu thiết bị đang online (chờ sync Firestore hoàn tất)
    const canApplyFreeze = typeof navigator === 'undefined' || !navigator.onLine || _initialSyncDone;
    syncStreakFromHeatmap({ allowFreeze: canApplyFreeze });
}

export function checkAndUpdateStreak() {
    syncStreakFromHeatmap();
}

export function unlockBadge(badgeId) {
    if (_isPreviewMode) {
        if (!_gamification.unlockedBadges) _gamification.unlockedBadges = [];
        if (!_gamification.unlockedBadges.includes(badgeId)) {
            _gamification.unlockedBadges.push(badgeId);
        }
        return;
    }
    
    if (!_gamification.unlockedBadges) _gamification.unlockedBadges = [];
    if (!_gamification.unlockedBadges.includes(badgeId)) {
        _gamification.unlockedBadges.push(badgeId);
        saveGamification();
        
        import('./sound.js').then(m => m.playSound('badgeUnlock'));

        // Cập nhật: Sử dụng Toast thay vì Modal Popup
        import('../ui/modal.js').then(m => {
            // Lấy tên huy hiệu để hiển thị cho Toast
            import('../features/badges.js').then(badgeModule => {
                const { BADGE_TRACKS, SPECIAL_BADGES } = badgeModule;
                let badgeInfo = null;
                
                // Check Special Badges
                badgeInfo = SPECIAL_BADGES.find(b => b.id === badgeId);
                
                // Check Tracks
                if (!badgeInfo) {
                    for (const track of BADGE_TRACKS) {
                        const index = track.ids.indexOf(badgeId);
                        if (index !== -1) {
                            badgeInfo = {
                                name: track.names[index],
                                icon: track.icons[index]
                            };
                            break;
                        }
                    }
                }

                const title = badgeInfo ? `Huy hiệu: ${badgeInfo.name}` : `Huy hiệu mới!`;
                const icon = badgeInfo ? badgeInfo.icon : 'ph-trophy';
                m.showToast(title, 'Bạn vừa mở khóa một thành tựu tuyệt vời!', icon);
            });
        });
    }
}

let _trackEventTimeout = null;

export function trackEvent(eventName, amount = 1) {
    if (!_gamification.stats) {
        _gamification.stats = {};
    }
    
    if (_gamification.stats[eventName] !== undefined) {
        _gamification.stats[eventName] += amount;
    } else {
        _gamification.stats[eventName] = amount;
    }
    
    // Debounce save and update to avoid I/O spam
    if (_trackEventTimeout) clearTimeout(_trackEventTimeout);
    _trackEventTimeout = setTimeout(() => {
        saveGamification();
        const event = new CustomEvent('gamification:update');
        document.getElementById('app-container')?.dispatchEvent(event);
    }, 1500); // Batch all events within 1.5 seconds
}

export async function seedIsolatedDemoVocabulary() {
    if (!isIsolatedStorage) throw new Error('Dữ liệu demo chỉ được dùng trong kho kiểm thử riêng.');
    sessionStorage.setItem('CHEAT_MODE', 'true');
    sessionStorage.setItem('ISOLATED_TEST_MODE', 'true');
    const mockCards = [
        { id: 'v5_c1', english: 'serendipity', vietnamese: 'Sự tình cờ may mắn, duyên kỳ ngộ', type: 'noun', pronunciation: '/ˌser.ənˈdɪp.ə.t̬i/', tags: ['Vocabulary', 'Advanced'], example: 'Finding this peaceful observatory was pure serendipity.', srsStatus: 'Mastered', srsInterval: 14.5, reps: 6, lapses: 0, difficulty: 4.2, stability: 14.8, stabilityShort: 11.8, isStarred: true, lastReviewDate: Date.now() - 3 * 86400000, srsDueDate: Date.now() + 11 * 86400000 },
        { id: 'v5_c2', english: 'ephemeral', vietnamese: 'Phù du, chóng tàn, ngắn ngủi', type: 'adjective', pronunciation: '/əˈfem.ər.əl/', tags: ['Philosophy', 'Literature'], example: 'Fame in the digital era can be remarkably ephemeral.', srsStatus: 'Learning', srsInterval: 2.1, reps: 3, lapses: 1, difficulty: 6.8, stability: 3.2, stabilityShort: 2.5, isStarred: false, lastReviewDate: Date.now() - 1 * 86400000, srsDueDate: Date.now() - 1000 },
        { id: 'v5_c3', english: 'quintessential', vietnamese: 'Tinh túy, hoàn hảo nhất, điển hình', type: 'adjective', pronunciation: '/ˌkwɪn.təˈsen.ʃəl/', tags: ['Academic'], example: 'Watermelon is the quintessential fruit of summer.', srsStatus: 'New', srsInterval: 0, reps: 0, lapses: 0, difficulty: 5.5, stability: 1.0, stabilityShort: 0.8, isStarred: false },
        { id: 'v5_c4', english: 'ubiquitous', vietnamese: 'Có mặt ở khắp nơi, phổ biến', type: 'adjective', pronunciation: '/juːˈbɪk.wə.t̬əs/', tags: ['Technology', 'Common'], example: 'Smartphones have become ubiquitous across all generations.', srsStatus: 'Mastered', srsInterval: 28.0, reps: 9, lapses: 0, difficulty: 3.9, stability: 28.4, stabilityShort: 22.7, isStarred: true, lastReviewDate: Date.now() - 5 * 86400000, srsDueDate: Date.now() + 23 * 86400000 },
        { id: 'v5_c5', english: 'resilience', vietnamese: 'Khả năng phục hồi, kiên cường', type: 'noun', pronunciation: '/rɪˈzɪl.jəns/', tags: ['Psychology'], example: 'Courage is going on when you do not have strength.', srsStatus: 'Learning', srsInterval: 3.5, reps: 4, lapses: 1, difficulty: 5.1, stability: 4.0, stabilityShort: 3.2, isStarred: false, lastReviewDate: Date.now() - 2 * 86400000, srsDueDate: Date.now() - 5000 },
        { id: 'v5_c6', english: 'meticulous', vietnamese: 'Tỉ mỉ, cẩn thận từng chi tiết', type: 'adjective', pronunciation: '/məˈtɪk.jə.ləs/', tags: ['Academic', 'Work'], example: 'He was meticulous about preserving the precision of the research.', srsStatus: 'Mastered', srsInterval: 18.0, reps: 7, lapses: 0, difficulty: 4.5, stability: 18.2, stabilityShort: 14.5, isStarred: false, lastReviewDate: Date.now() - 4 * 86400000, srsDueDate: Date.now() + 14 * 86400000 },
        { id: 'v5_c7', english: 'pragmatic', vietnamese: 'Thực dụng, thực tế, trọng hành động', type: 'adjective', pronunciation: '/præɡˈmæt̬.ɪk/', tags: ['Philosophy', 'Business'], example: 'We need to adopt a pragmatic approach to solving this crisis.', srsStatus: 'Learning', srsInterval: 2.8, reps: 3, lapses: 0, difficulty: 5.8, stability: 2.8, stabilityShort: 2.2, isStarred: false, lastReviewDate: Date.now() - 1 * 86400000, srsDueDate: Date.now() + 1.8 * 86400000 },
        { id: 'v5_c8', english: 'conundrum', vietnamese: 'Bài toán hóc búa, câu hỏi nan giải', type: 'noun', pronunciation: '/kəˈnʌn.drəm/', tags: ['Academic', 'Logic'], example: 'Arranging the schedule proved to be a difficult conundrum.', srsStatus: 'Learning', srsInterval: 1.2, reps: 5, lapses: 2, difficulty: 7.8, stability: 1.8, stabilityShort: 1.4, isStarred: false, lastReviewDate: Date.now() - 1 * 86400000, srsDueDate: Date.now() - 10000 },
        { id: 'v5_c9', english: 'empathy', vietnamese: 'Sự thấu cảm, đồng cảm sâu sắc', type: 'noun', pronunciation: '/ˈem.pə.θi/', tags: ['Psychology', 'Personal'], example: 'Empathy allows us to build meaningful connections with others.', srsStatus: 'Mastered', srsInterval: 21.0, reps: 8, lapses: 0, difficulty: 3.5, stability: 21.0, stabilityShort: 16.8, isStarred: true, lastReviewDate: Date.now() - 6 * 86400000, srsDueDate: Date.now() + 15 * 86400000 },
        { id: 'v5_c10', english: 'paradigm', vietnamese: 'Mô hình mẫu, hệ hình tư duy', type: 'noun', pronunciation: '/ˈper.ə.daɪm/', tags: ['Science', 'Research'], example: 'The discovery caused a major paradigm shift in modern physics.', srsStatus: 'New', srsInterval: 0, reps: 0, lapses: 0, difficulty: 6.0, stability: 1.0, stabilityShort: 0.8, isStarred: false }
    ];

    setVocabulary(mockCards);
    await saveAllVocabularyToDB(mockCards);

    _gamification.userXP = 1420;
    _gamification.currentLevel = 4;
    _gamification.currentStreak = 12;
    _gamification.totalReviews = 94;
    _gamification.activityHeatmap = {
        '2026-10-17': 18,
        '2026-10-16': 24,
        '2026-10-15': 15,
        '2026-10-14': 32,
        '2026-10-13': 14,
        '2026-10-12': 28,
        '2026-10-11': 20
    };
    await saveGamification();
    return mockCards;
}
