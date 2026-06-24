import { showPopup } from '../ui/modal.js';
import { updateStats } from '../ui/render.js';
import { initAppDB, getAllVocabularyFromDB, saveAllVocabularyToDB, getSettingFromDB, saveSettingToDB } from './idb.js';

let _vocabulary = [];
let _currentReviewQueue = [];
let _allTags = new Set(['all']);
let _currentCardIndex = -1;
let _isFlipped = false;
let _isDarkMode = false;
let _isSoundEnabled = true;
let _currentTopicFilter = 'all';
let _dailyStats = {
    newCardsDoneToday: 0,
    retentionHistory: [],
    lastDate: new Date().toLocaleDateString()
};

let _gamification = {
    userXP: 0,
    currentLevel: 1,
    currentStreak: 0,
    lastStudyDate: "",
    activityHeatmap: {},
    unlockedBadges: [],
    totalReviews: 0
};

export const getState = () => ({
    vocabulary: _vocabulary,
    currentReviewQueue: _currentReviewQueue,
    allTags: _allTags,
    currentCardIndex: _currentCardIndex,
    isFlipped: _isFlipped,
    isDarkMode: _isDarkMode,
    isSoundEnabled: _isSoundEnabled,
    currentTopicFilter: _currentTopicFilter,
    dailyStats: _dailyStats,
    gamification: _gamification,
});

export function setVocabulary(newVocab) { _vocabulary = newVocab; }
export function setReviewQueue(newQueue) { _currentReviewQueue = newQueue; }
export function setAllTags(newTags) { _allTags = newTags; }
export function setCurrentCardIndex(index) { _currentCardIndex = index; }
export function setIsFlipped(flipped) { _isFlipped = flipped; }
export function setIsDarkMode(isDark) { _isDarkMode = isDark; }
export function setCurrentTopicFilter(topic) { _currentTopicFilter = topic; }
export function setSoundEnabled(enabled) { _isSoundEnabled = enabled; }
export function setGamification(data) { _gamification = data; }
export function setDailyStats(data) { _dailyStats = data; }

export async function saveVocabulary(skipSync = false) {
    try {
        const vocabToSave = _vocabulary.map(w => ({ ...w, srsDueDate: w.srsDueDate || null }));
        
        // Lưu vào IndexedDB thay vì localStorage
        await saveAllVocabularyToDB(vocabToSave);
        await saveSettingToDB('dailyStats', _dailyStats);
        
        updateStats();
        
        // Gọi sync ngầm sau khi lưu (nếu không bị cấm)
        if (!skipSync) {
            import('./firebase.js').then(module => module.smartSync());
        }
    } catch (e) {
        console.error("Save error:", e);
        showPopup("Lỗi không thể lưu dữ liệu!", "error");
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
            const todayStr = new Date().toLocaleDateString();
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
        checkAndUpdateStreak(); // Check streak on load
    }

    console.log(`Loaded: ${_vocabulary.length} words from IDB.`);
    updateStats();
}

export function incrementNewCardsDone() {
    _dailyStats.newCardsDoneToday += 1;
    saveVocabulary(true);
}

export function recordReviewResult(isCorrect) {
    _dailyStats.todayTotal = (_dailyStats.todayTotal || 0) + 1;
    if (isCorrect) {
        _dailyStats.todayCorrect = (_dailyStats.todayCorrect || 0) + 1;
    }
    _gamification.totalReviews = (_gamification.totalReviews || 0) + 1;
    saveVocabulary(true);
    saveGamification();
}

export function toggleStarOnCurrentCard() {
    if (_currentCardIndex < 0 || !_vocabulary[_currentCardIndex]) return false;
    const card = _vocabulary[_currentCardIndex];
    card.isStarred = !card.isStarred;
	card.updatedAt = Date.now();
    saveVocabulary();
    return card.isStarred;
}

export async function saveGamification() {
    try {
        await saveSettingToDB('gamification', _gamification);
        // Optionally update UI here
    } catch(e) {}
}

export async function saveDailyStats() {
    try {
        await saveSettingToDB('dailyStats', _dailyStats);
    } catch(e) {}
}

export function addXP(amount) {
    if (amount <= 0) return;
    _gamification.userXP += amount;
    _gamification.currentLevel = Math.floor(Math.sqrt(_gamification.userXP / 100)) + 1;
    saveGamification();
    
    // Gọi event cho UI (hiệu ứng +XP)
    const xpEvent = new CustomEvent('gamification:xp_added', { detail: { amount } });
    document.getElementById('app-container')?.dispatchEvent(xpEvent);

    // Gọi event để check badge
    const event = new CustomEvent('gamification:update');
    document.getElementById('app-container')?.dispatchEvent(event);
}

export function logActivity() {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    if (!_gamification.activityHeatmap[today]) {
        _gamification.activityHeatmap[today] = 0;
    }
    _gamification.activityHeatmap[today] += 1;
    saveGamification();
}

export function checkAndUpdateStreak() {
    const today = new Date().toISOString().split('T')[0];
    if (_gamification.lastStudyDate === today) return; // Already studied today

    if (_gamification.lastStudyDate) {
        const lastDate = new Date(_gamification.lastStudyDate);
        const currentDate = new Date(today);
        const diffTime = Math.abs(currentDate - lastDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays === 1) {
            _gamification.currentStreak += 1;
        } else if (diffDays > 1) {
            _gamification.currentStreak = 1; // Reset streak if missed a day
        }
    } else {
        _gamification.currentStreak = 1;
    }
    
    _gamification.lastStudyDate = today;
    saveGamification();
    
    const event = new CustomEvent('gamification:update');
    document.getElementById('app-container')?.dispatchEvent(event);
}

export function unlockBadge(badgeId) {
    if (!_gamification.unlockedBadges) _gamification.unlockedBadges = [];
    if (!_gamification.unlockedBadges.includes(badgeId)) {
        _gamification.unlockedBadges.push(badgeId);
        saveGamification();
        
        // Cập nhật: Sử dụng Toast thay vì Modal Popup
        import('../ui/modal.js').then(m => {
            // Lấy tên huy hiệu để hiển thị cho Toast
            import('../features/badges.js').then(badgeModule => {
                const BADGES = badgeModule.BADGES;
                const badgeInfo = BADGES.find(b => b.id === badgeId);
                const title = badgeInfo ? `Huy hiệu: ${badgeInfo.name}` : `Huy hiệu mới!`;
                const icon = badgeInfo ? badgeInfo.icon : 'ph-trophy';
                m.showToast(title, 'Bạn vừa mở khóa một thành tựu tuyệt vời!', icon);
            });
        });
    }
}