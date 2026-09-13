import { showPopup, showToast } from '../ui/modal.js';
import { updateStats } from '../ui/render.js';
import { initAppDB, getAllVocabularyFromDB, saveAllVocabularyToDB, saveWordToDB, getSettingFromDB, saveSettingToDB } from './idb.js';
import { getLocalDateString } from './utils/date.js';

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
let _soundMode = 'all'; // 'all', 'sfx', 'tts', 'off'
let _isTypingMode = false;
let _currentTopicFilter = 'all';
let _isPreviewMode = false;
let _isTransitioning = false;
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

export const getState = () => ({
    vocabulary: _vocabulary,
    currentReviewQueue: _currentReviewQueue,
    allTags: _allTags,
    currentCardIndex: _currentCardIndex,
    isFlipped: _isFlipped,
    isDarkMode: _isDarkMode,
    soundMode: _soundMode,
    isTypingMode: _isTypingMode,
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
export function setIsTypingMode(isTyping) { _isTypingMode = isTyping; }
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
        await saveAllVocabularyToDB(vocabToSave);
        await saveSettingToDB('dailyStats', _dailyStats);
        
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
    if (_isPreviewMode || sessionStorage.getItem('CHEAT_MODE') === 'true') return;
    try {
        await saveWordToDB({ ...word, srsDueDate: word.srsDueDate || null });
        updateStats();
        // Queue sync lên Cloud (batch 30s)
        syncCardToFirebase(word);
    } catch (e) {
        console.error("SaveOneWord error:", e);
    }
}

export async function loadVocabulary() {
    await initAppDB(); // Khởi tạo DB
    
    // Đọc từ IDB
    let savedVocab = await getAllVocabularyFromDB();
    
    // Nếu IDB trống, thử migrate từ localStorage sang IDB
    if (savedVocab.length === 0) {
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
            word.isSuspended = word.isSuspended || false;
            if (!word.id) word.id = crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).substring(2, 10));
            _vocabulary.push(word);
            word.tags.forEach(tag => _allTags.add(tag));
        });
    }

    // Load Daily Stats
    let parsedStats = await getSettingFromDB('dailyStats');
    if (!parsedStats) {
        const oldStatsStr = localStorage.getItem('celestialDailyStats');
        if (oldStatsStr) {
            try {
                parsedStats = JSON.parse(oldStatsStr);
                await saveSettingToDB('dailyStats', parsedStats);
                localStorage.removeItem('celestialDailyStats');
            } catch(e) {}
        }
    }

    if (parsedStats) {
        try {
            const todayStr = getLocalDateString();
            if (parsedStats.lastDate === todayStr) {
                _dailyStats = parsedStats;
            } else {
                // New day: save yesterday's retention to history if available
                if (parsedStats.todayTotal && parsedStats.todayTotal > 0) {
                    parsedStats.retentionHistory = parsedStats.retentionHistory || [];
                    parsedStats.retentionHistory.push({
                        date: parsedStats.lastDate,
                        correct: parsedStats.todayCorrect || 0,
                        total: parsedStats.todayTotal || 0
                    });
                    // Keep only last 3 days
                    if (parsedStats.retentionHistory.length > 3) {
                        parsedStats.retentionHistory.shift();
                    }
                }
                
                // Reset for today
                _dailyStats = {
                    newCardsDoneToday: 0,
                    dueDoneToday: 0,
                    learningDoneToday: 0,
                    retentionHistory: parsedStats.retentionHistory || [],
                    lastDate: todayStr,
                    todayCorrect: 0,
                    todayTotal: 0,
                    currentLimit: parsedStats.currentLimit
                };
                await saveSettingToDB('dailyStats', _dailyStats);
            }
        } catch (e) {
            console.error("Parse stats error:", e);
        }
    }

    // Load Gamification Stats
    let savedGamification = await getSettingFromDB('gamification');
    if (savedGamification) {
        _gamification = { ..._gamification, ...savedGamification };
        checkStreakStatusOnLoad(); // Check streak status on load (reset UI if missed days, do not grant streak without study)
    }



    let rawLogs = await getSettingFromDB('reviewLogs') || { dict: [], logs: [] };
    if (Array.isArray(rawLogs)) {
        console.log("Migrating reviewLogs to compressed format...");
        _reviewLogs = compressLogs(rawLogs);
        await saveSettingToDB('reviewLogs', _reviewLogs);
    } else {
        _reviewLogs = rawLogs;
        if (!_reviewLogs.dict) _reviewLogs = { dict: [], logs: [] };
    }

    _userRecallParams = await getSettingFromDB('userRecallParams') || null;
    _userLapseParams = await getSettingFromDB('userLapseParams') || null;
    _userFsrs7Params = await getSettingFromDB('userFsrs7Params') || null;
    _userFsrs7TrainedAt = await getSettingFromDB('userFsrs7TrainedAt') || null;
    if (typeof window !== 'undefined') window.__USER_FSRS7_PARAMS__ = _userFsrs7Params;

    // ===== V3 ONE-TIME MIGRATION =====
    const v3Done = await getSettingFromDB('v3MigrationDone');
    if (!v3Done) {
        console.log("[V3 Migration] Bắt đầu migration...");
        let healedCount = 0;

        // 1. Chữa lành thẻ Mastered có Stability <= 0.1 (bị phạt quá nặng bởi postLapseStability cũ)
        _vocabulary.forEach(word => {
            if (word.srsStatus === 'Mastered' && word.stability !== undefined && word.stability <= 0.1) {
                // Recalculate S dựa trên reps và difficulty hiện tại
                const reps = word.reps || 1;
                const d = word.difficulty || 5;
                // Công thức ước lượng: S = max(1, reps * (11 - d) / 5)
                const newS = Math.max(1, reps * (11 - d) / 5);
                word.stability = newS;
                word.srsInterval = Math.max(1, Math.round(newS));
                word.srsDueDate = Date.now() + word.srsInterval * 86400000;
                word.updatedAt = Date.now();
                healedCount++;
            }
        });
        if (healedCount > 0) {
            console.log(`[V3 Migration] Đã chữa lành ${healedCount} thẻ có Stability = 0.1`);
            await saveAllVocabularyToDB(_vocabulary.map(w => ({ ...w, srsDueDate: w.srsDueDate || null })));
            import('./sync.js').then(async syncModule => {
                _vocabulary.forEach(word => {
                    if (word.srsStatus === 'Mastered' && word.stability > 0.1) {
                        syncModule.syncCardToFirebase(word);
                    }
                });
                await syncModule.flushSyncQueue();
            });
        }

        // 2. Lọc bỏ noise entries trong reviewLogs (t < 0.25 ngày = 6 giờ)
        if (_reviewLogs && _reviewLogs.logs && _reviewLogs.logs.length > 0) {
            const beforeCount = _reviewLogs.logs.length;
            _reviewLogs.logs = _reviewLogs.logs.filter(log => {
                const t = log[2]; // [dictIndex, rating, t, timestamp]
                return t >= 0.25;
            });
            const removed = beforeCount - _reviewLogs.logs.length;
            if (removed > 0) {
                console.log(`[V3 Migration] Đã lọc bỏ ${removed}/${beforeCount} noise entries (t < 6h) trong reviewLogs`);
                await saveSettingToDB('reviewLogs', _reviewLogs);
            }
        }

        await saveSettingToDB('v3MigrationDone', Date.now());
        console.log("[V3 Migration] Hoàn tất!");
    }
    // ===== END V3 MIGRATION =====

    console.log(`Loaded: ${_vocabulary.length} words from IDB.`);
    _rebuildVocabIndex();
    updateStats();
}

export async function addReviewLog(log) {
    let dictIndex = _reviewLogs.dict.indexOf(log.cardId);
    if (dictIndex === -1) {
        dictIndex = _reviewLogs.dict.length;
        _reviewLogs.dict.push(log.cardId);
    }
    
    _reviewLogs.logs.push([dictIndex, log.rating, log.t, Date.now(), log.modality === 'typing' ? 1 : 0]);
    
    if (_reviewLogs.logs.length > 10000) {
        _reviewLogs.logs = _reviewLogs.logs.slice(_reviewLogs.logs.length - 10000);
    }
    await saveSettingToDB('reviewLogs', _reviewLogs);
}

export async function popLastReviewLog() {
    if (_reviewLogs && _reviewLogs.logs && _reviewLogs.logs.length > 0) {
        const removed = _reviewLogs.logs.pop();
        await saveSettingToDB('reviewLogs', _reviewLogs);
        return removed;
    }
    return null;
}

export async function clearReviewLogs() {
    _reviewLogs = { dict: [], logs: [] };
    await saveSettingToDB('reviewLogs', _reviewLogs);
}

export function compressLogs(rawArray) {
    const dict = [];
    const dictMap = new Map();
    const logs = [];
    for (let i = 0; i < rawArray.length; i++) {
        const log = rawArray[i];
        if (!log || !log.cardId) continue;
        let dictIndex = dictMap.get(log.cardId);
        if (dictIndex === undefined) {
            dictIndex = dict.length;
            dictMap.set(log.cardId, dictIndex);
            dict.push(log.cardId);
        }
        logs.push([
            dictIndex,
            log.rating,
            log.t,
            log.ts || (Date.now() - 1000000 + i),
            log.isTyping || log.modality === 'typing' ? 1 : 0
        ]);
    }
    return { dict, logs };
}

export function mergeReviewLogs(remoteLogs, localLogs) {
    if (!remoteLogs || !remoteLogs.logs || remoteLogs.logs.length === 0) return localLogs || { dict: [], logs: [] };
    if (!localLogs || !localLogs.logs || localLogs.logs.length === 0) return remoteLogs || { dict: [], logs: [] };

    const extractRaw = (compressed) => {
        if (!compressed || !compressed.dict || !Array.isArray(compressed.logs)) return [];
        return compressed.logs.map((log, idx) => {
            const cardId = compressed.dict[log[0]];
            if (!cardId) return null;
            return {
                cardId,
                rating: log[1],
                t: log[2],
                ts: log[3] || (Date.now() - 1000000 + idx),
                isTyping: log[4] === 1
            };
        }).filter(Boolean);
    };

    const rawRemote = extractRaw(remoteLogs);
    const rawLocal = extractRaw(localLogs);

    const combined = [...rawRemote, ...rawLocal].sort((a, b) => a.ts - b.ts);

    const uniqueLogs = [];
    const lastSeenByCard = new Map(); // cardId -> last log object

    for (const log of combined) {
        if (!log || !log.cardId) continue;
        const lastLog = lastSeenByCard.get(log.cardId);

        // Boundary-free sliding window deduplication (3000ms):
        // Phát hiện chính xác bản ghi trùng lặp từ sync đa thiết bị mà không bị lỗi biên bucket.
        const isDuplicate = lastLog && (
            (lastLog.ts === log.ts) ||
            (
                lastLog.rating === log.rating &&
                Math.abs((lastLog.t || 0) - (log.t || 0)) < 0.0001 &&
                Math.abs((log.ts || 0) - (lastLog.ts || 0)) <= 3000
            )
        );

        if (isDuplicate) {
            continue;
        }

        lastSeenByCard.set(log.cardId, log);
        uniqueLogs.push(log);
    }

    const finalRawLogs = uniqueLogs.slice(-10000);
    return compressLogs(finalRawLogs);
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

export async function setUserFsrs7Params(params34) {
    if (params34 === null) {
        _userFsrs7Params = null;
        _userFsrs7TrainedAt = null;
        if (typeof window !== 'undefined') window.__USER_FSRS7_PARAMS__ = null;
        await saveSettingToDB('userFsrs7Params', null);
        await saveSettingToDB('userFsrs7TrainedAt', null);
        return { success: true, reset: true };
    }
    if (Array.isArray(params34) && params34.length === 34 && params34.every(n => typeof n === 'number' && !isNaN(n) && isFinite(n))) {
        _userFsrs7Params = params34;
        _userFsrs7TrainedAt = Date.now();
        if (typeof window !== 'undefined') window.__USER_FSRS7_PARAMS__ = _userFsrs7Params;
        await saveSettingToDB('userFsrs7Params', params34);
        await saveSettingToDB('userFsrs7TrainedAt', _userFsrs7TrainedAt);
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
                isTyping: log[4] === 1
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

export function incrementNewCardsDone() {
    _dailyStats.newCardsDoneToday += 1;
    saveSettingToDB('dailyStats', _dailyStats).catch(() => {});
}
export function incrementDueCardsDone() {
    _dailyStats.dueDoneToday = (_dailyStats.dueDoneToday || 0) + 1;
    saveSettingToDB('dailyStats', _dailyStats).catch(() => {});
}
export function incrementLearningCardsDone() {
    _dailyStats.learningDoneToday = (_dailyStats.learningDoneToday || 0) + 1;
    saveSettingToDB('dailyStats', _dailyStats).catch(() => {});
}

export function recordReviewResult(isCorrect) {
    checkAndUpdateStreak(); // Đảm bảo cập nhật streak kể cả khi user treo tab sang ngày mới
    
    // CHAOS-02 FIX: Kiểm tra và reset daily stats nếu đã sang ngày mới giữa phiên học
    const todayStr = getLocalDateString();
    if (_dailyStats.lastDate && _dailyStats.lastDate !== todayStr) {
        // Lưu lịch sử retention của ngày cũ trước khi reset
        if (_dailyStats.todayTotal && _dailyStats.todayTotal > 0) {
            _dailyStats.retentionHistory = _dailyStats.retentionHistory || [];
            _dailyStats.retentionHistory.push({
                date: _dailyStats.lastDate,
                correct: _dailyStats.todayCorrect || 0,
                total: _dailyStats.todayTotal || 0
            });
            if (_dailyStats.retentionHistory.length > 3) {
                _dailyStats.retentionHistory.shift();
            }
        }
        // Reset cho ngày mới
        _dailyStats.newCardsDoneToday = 0;
        _dailyStats.todayCorrect = 0;
        _dailyStats.todayTotal = 0;
        _dailyStats.lastDate = todayStr;
    }
    
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
    saveSettingToDB('dailyStats', _dailyStats).catch(() => {});
    saveGamification();
}

export function recordQuizAnswer(isCorrect) {
    checkAndUpdateStreak();
    if (!_gamification.stats) _gamification.stats = {};
    
    if (isCorrect) {
        _gamification.consecutiveCorrect = (_gamification.consecutiveCorrect || 0) + 1;
        _gamification.stats.quizCorrectStreak = (_gamification.stats.quizCorrectStreak || 0) + 1;
        
        if (_gamification.consecutiveCorrect > 0 && _gamification.consecutiveCorrect % 10 === 0) {
            showToast('Chuỗi Combo Đỉnh Cao', `🔥 Đỉnh quá! Trả lời đúng liên tiếp: ${_gamification.consecutiveCorrect}`, 'ph-fire');
        }
    } else {
        // Option 3 Combo Degradation
        let currentCombo = _gamification.consecutiveCorrect || 0;
        if (currentCombo >= 30) {
            _gamification.consecutiveCorrect = 10;
        } else {
            _gamification.consecutiveCorrect = 0;
        }
        _gamification.stats.quizCorrectStreak = 0;
    }
    saveGamification();
}

export function toggleStarOnCurrentCard() {
    if (_currentCardIndex < 0 || !_vocabulary[_currentCardIndex]) return false;
    const card = _vocabulary[_currentCardIndex];
    card.isStarred = !card.isStarred;
	card.updatedAt = Date.now();
    // Incremental save + sync thay vì ghi toàn bộ vocabulary
    saveOneWord(card);
    return card.isStarred;
}

export async function saveGamification() {
    if (_isPreviewMode || sessionStorage.getItem('CHEAT_MODE') === 'true') return;
    try {
        await saveSettingToDB('gamification', _gamification);
        import('./sync.js').then(m => m.queueGamificationSync());
    } catch(e) {}
}

export async function saveDailyStats() {
    if (_isPreviewMode || sessionStorage.getItem('CHEAT_MODE') === 'true') return;
    try {
        await saveSettingToDB('dailyStats', _dailyStats);
    } catch(e) {}
}

export function addXP(amount, floatText = null) {
    if (amount <= 0) return;
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
    const today = getLocalDateString();
    if (_gamification.activityHeatmap && _gamification.activityHeatmap[today]) {
        _gamification.activityHeatmap[today] = Math.max(0, _gamification.activityHeatmap[today] - 1);
        if (_gamification.activityHeatmap[today] === 0) {
            delete _gamification.activityHeatmap[today];
        }
    }
    
    // 5. Khôi phục Daily Stats
    if (_dailyStats) {
        if (_dailyStats.todayTotal > 0) _dailyStats.todayTotal -= 1;
        if (snapshot.isCorrect && _dailyStats.todayCorrect > 0) _dailyStats.todayCorrect -= 1;
        if (snapshot.wasNewCard && snapshot.isCorrect && _dailyStats.newCardsDoneToday > 0) {
            _dailyStats.newCardsDoneToday -= 1;
        }
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
    
    // Đẩy thẳng lên Cloud nếu có kết nối Firebase
    try {
        const { db, USER_SYNC_COLLECTION } = await import('./firebase.js');
        if (db && USER_SYNC_COLLECTION) {
            const { doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js");
            const gamificationRef = doc(db, USER_SYNC_COLLECTION, "gamification");
            await setDoc(gamificationRef, JSON.parse(JSON.stringify(_gamification)));
            console.log("☁️ Đã ghi đè XP mới lên Cloud!");
        }
    } catch (e) {
        console.log("Lưu cục bộ thành công.");
    }

    const event = new CustomEvent('gamification:update');
    document.getElementById('app-container')?.dispatchEvent(event);
    console.log(`✨ XP đã được set thành ${xp} (Level ${_gamification.currentLevel})`);
}



export function logActivity() {
    const today = getLocalDateString(); // YYYY-MM-DD local
    if (!_gamification.activityHeatmap[today]) {
        _gamification.activityHeatmap[today] = 0;
    }
    _gamification.activityHeatmap[today] += 1;
    saveGamification();
}

export function checkStreakStatusOnLoad() {
    const today = getLocalDateString();
    if (_gamification.lastStudyDate && _gamification.lastStudyDate !== today) {
        const lastDate = new Date(_gamification.lastStudyDate);
        const currentDate = new Date(today);
        const diffTime = Math.abs(currentDate - lastDate);
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays > 1) {
            // Đã bỏ lỡ trên 1 ngày mà chưa học hôm nay -> Reset streak hiển thị UI về 0
            _gamification.currentStreak = 0;
            saveGamification();
            const event = new CustomEvent('gamification:update');
            document.getElementById('app-container')?.dispatchEvent(event);
        }
    }
}

export function checkAndUpdateStreak() {
    const today = getLocalDateString();
    if (_gamification.lastStudyDate === today) return; // Already studied today

    if (_gamification.lastStudyDate) {
        const lastDate = new Date(_gamification.lastStudyDate);
        const currentDate = new Date(today);
        const diffTime = Math.abs(currentDate - lastDate);
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays === 1) {
            _gamification.currentStreak = (_gamification.currentStreak || 0) + 1;
        } else {
            _gamification.currentStreak = 1; // Bắt đầu lại streak mới từ ngày 1
        }
    } else {
        _gamification.currentStreak = 1;
    }
    
    _gamification.longestStreak = Math.max(_gamification.longestStreak || 0, _gamification.currentStreak);
    _gamification.lastStudyDate = today;
    saveGamification();
    
    const event = new CustomEvent('gamification:update');
    document.getElementById('app-container')?.dispatchEvent(event);
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