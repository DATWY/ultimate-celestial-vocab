
import './css/tokens/celestial-v5.css';
import './css/style.css';
import './css/transition.css';
import { loadVocabulary, getState, addXP, setXP, saveGamification } from './core/state.js';
import { getNextCardToReview, buildReviewQueue } from './core/queue.js';
import { initializeSound, startBackgroundAudioPreload } from './core/sound.js';
import { displayCard, populateTopicFilters, updateCustomTypingUI, applyDarkMode, applySoundSetting } from './ui/render.js';
import { setupEventListeners } from './events.js';
import { smartSync } from './core/firebase.js';

// --- CHEAT ENGINE & DEV TOOLS (Development Mode Only) ---
if (import.meta.env.DEV || (typeof window !== 'undefined' && window.__ENABLE_DEV_TOOLS__)) {
window.cheat = {
    addXP: (amount) => {
        sessionStorage.setItem('CHEAT_MODE', 'true');
        addXP(amount);
        console.log(`✨ Đã buff ${amount} XP! Mở Profile để xem rank mới.`);
    },
    setXP: async (amount) => {
        sessionStorage.setItem('CHEAT_MODE', 'true');
        await setXP(amount);
        console.log(`✨ Đã set XP thành ${amount}!`);
    },
    setStreak: (days) => {
        sessionStorage.setItem('CHEAT_MODE', 'true');
        const state = getState();
        state.gamification.currentStreak = days;
        saveGamification();
        document.getElementById('app-container')?.dispatchEvent(new CustomEvent('gamification:update'));
        console.log(`🔥 Streak đã được set thành ${days} ngày.`);
    },
    setReviews: (count) => {
        sessionStorage.setItem('CHEAT_MODE', 'true');
        const state = getState();
        state.gamification.totalReviews = count;
        saveGamification();
        document.getElementById('app-container')?.dispatchEvent(new CustomEvent('gamification:update'));
        console.log(`🗂 Total Reviews đã được set thành ${count}.`);
    },
    resetAll: async () => {
        console.log("Đang tiến hành Reset dữ liệu...");
        // Xóa trên Local State (IndexedDB)
        const state = getState();
        state.gamification = {
            userXP: 0, currentLevel: 1, currentStreak: 0, longestStreak: 0, consecutiveCorrect: 0, totalReviews: 0, unlockedBadges: [], lastStudyDate: null
        };
        saveGamification(); // Ghi đè IndexedDB
        
        // Xóa trên Cloud (Firebase)
        try {
            const { db } = await import('./core/firebase.js');
            const { doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js");
            await setDoc(doc(db, "celestial_user_sync", "gamification"), state.gamification);
            console.log("✅ Đã xóa dữ liệu Gamification trên Cloud!");
        } catch (error) {
            console.error("Lỗi khi xóa Cloud:", error);
        }
        
        sessionStorage.removeItem('CHEAT_MODE');
        console.log("✅ Đã xóa Local. Đang tải lại trang...");
        setTimeout(() => location.reload(), 1000);
    },
    resetSrs: async () => {
        const { setUserSrsParams, clearReviewLogs } = await import('./core/state.js');
        await setUserSrsParams(null, null);
        await clearReviewLogs();
        // Sync lên Firebase
        try {
            const { db } = await import('./core/firebase.js');
            const { doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js");
            await setDoc(doc(db, "celestial_user_sync", "reviewLogs"), { dict: [], logs: [] });
            await setDoc(doc(db, "celestial_user_sync", "settings"), {
                userRecallParams: null,
                userLapseParams: null,
                trainedAt: Date.now(),
                version: '1.0',
                source: 'personal'
            });
        } catch(e) { console.error(e); }
        console.log("✅ Đã reset toàn bộ:");
        console.log("   • Review Logs: Xóa sạch (local + Cloud)");
        console.log("   • Optimizer Params: Về mặc định (local + Cloud)");
        console.log("   → Optimizer sẽ tự train lại khi đủ 400+ reviews.");
    }
};
}

// Sample Vocabulary Seeder for Isolated Testing & First-Run Exploration
window.loadIsolatedSampleVocabulary = async function() {
    const { seedIsolatedDemoVocabulary } = await import('./core/state.js');
    await seedIsolatedDemoVocabulary();
    populateTopicFilters(true);
    buildReviewQueue();
    const nextIdx = getNextCardToReview();
    displayCard(nextIdx);
    console.log("✨ 10 từ vựng thiên hà mẫu đã sẵn sàng trong kho học!");
};

// Celestial Audit & Test Automation Harness
window.__celestialAudit = {
    seed: window.loadIsolatedSampleVocabulary,
    clear: async () => {
        const { setVocabulary } = await import('./core/state.js');
        const { saveAllVocabularyToDB } = await import('./core/idb.js');
        setVocabulary([]);
        await saveAllVocabularyToDB([]);
        displayCard(null);
    },
    flipCard: async () => {
        const { flipCard } = await import('./ui/render.js');
        flipCard();
    },
    openHub: async (tab = 'overview') => {
        const { openManageModal } = await import('./ui/modal.js');
        openManageModal(tab);
    },
    openAddWord: async () => {
        const { openAddEditModal } = await import('./ui/modal.js');
        openAddEditModal(false);
    },
    openDedup: async () => {
        const { openDedupModal } = await import('./ui/modal.js');
        openDedupModal();
    },
    openFsrs7Config: async () => {
        const { openModal } = await import('./ui/modal.js');
        const modal = document.getElementById('fsrs7-config-modal');
        if (modal) openModal(modal);
    },
    showQuizSetup: async () => {
        const { showQuizSetup } = await import('./features/quiz.js');
        showQuizSetup();
    },
    showVictoryStage: () => {
        displayCard(null);
    },
    setDarkMode: async (isDark) => {
        const { applyDarkMode } = await import('./ui/render.js');
        applyDarkMode(isDark);
    }
};

import { initCelestialCanvas } from './ui/celestial-canvas.js';

async function initializeApp() {
    console.log("Initializing Celestial Vocab App...");
    initializeSound();
    initCelestialCanvas();

    const urlParams = new URLSearchParams(window.location.search);
    const themeParam = urlParams.get('theme');
    const savedDark = localStorage.getItem('celestialDarkMode');
    const systemPrefersDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialDarkMode = themeParam 
        ? (themeParam === 'dark') 
        : (savedDark !== null ? savedDark === 'true' : (systemPrefersDark !== false));
    applyDarkMode(initialDarkMode);

    const initialSoundMode = localStorage.getItem('celestialSoundMode') || 'all';
    applySoundSetting(initialSoundMode);

    await loadVocabulary();
    populateTopicFilters();
    updateCustomTypingUI();
    buildReviewQueue();
    setupEventListeners();

    const firstCardIndex = getNextCardToReview();
    displayCard(firstCardIndex);
    console.log("App Initialized Successfully.");

    // Recover pending sync IDs từ phiên trước (crash/đóng tab đột ngột)
    const { recoverPendingSyncIds, flushSyncQueueBeforeUnload, flushSyncQueue, syncGamificationToFirebase } = await import('./core/sync.js');
    await recoverPendingSyncIds();

    // Setup online/offline detection (Real-time listener đã tắt)
    const { setupOnlineOfflineListeners } = await import('./core/firebase.js');
    setupOnlineOfflineListeners();

    // Đồng bộ lần đầu sau 2 giây (chờ DOM ổn định)
	setTimeout(() => {
        smartSync({ isManual: false });
    }, 2000);
	setTimeout(() => {
        startBackgroundAudioPreload(getState().vocabulary);
    }, 3000);

    // --- VISIBILITYCHANGE: Sync nhẹ nhàng khi chuyển tab ---
    // Khi user rời tab: flush pending changes lên Cloud
    // Khi user quay lại tab: pull dữ liệu mới từ Cloud (cooldown 5 phút)
    let _lastVisibilitySync = 0;
    const VISIBILITY_SYNC_COOLDOWN_MS = 5 * 60 * 1000; // 5 phút cooldown (tránh spam khi alt-tab nhanh)
    
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            // User rời tab → flush ngầm dữ liệu để thiết bị khác nhận được
            flushSyncQueue();
            syncGamificationToFirebase();
        } else if (document.visibilityState === 'visible') {
            const now = Date.now();
            if (now - _lastVisibilitySync > VISIBILITY_SYNC_COOLDOWN_MS) {
                _lastVisibilitySync = now;
                console.log("👀 Tab active trở lại. Đồng bộ dữ liệu nền...");
                smartSync({ isManual: false });
            }
        }
    });

    // --- BEFOREUNLOAD: Flush sync queue an toàn trước khi đóng tab ---
    window.addEventListener('beforeunload', () => {
        flushSyncQueueBeforeUnload();
    });
    // Auto-open manage tab if specified in URL query (for direct routing and verification)
    const initialTab = urlParams.get('tab');
    if (initialTab) {
        import('./ui/modal.js').then(({ openManageModal }) => {
            openManageModal(initialTab);
        });
    }
}

document.addEventListener('DOMContentLoaded', initializeApp);

// --- CÁC LỆNH ẨN DEVTOOLS CHO OPTIMIZER ---

window.checkOptimizerStatus = async function() {
    const { getSettingFromDB } = await import('./core/idb.js');
    const status = await getSettingFromDB('lastOptimizationStatus');
    if (!status) {
        console.log("Chưa có dữ liệu về lần chạy optimizer nào trước đây.");
        return;
    }
    console.log("📊 Trạng thái lần chạy Optimizer gần nhất:", status);
    if (status.improved) {
        console.log("✅ Thành công: Bộ thông số mới đã được áp dụng vì có sai số thấp hơn.");
    } else {
        console.log("❌ Không áp dụng: Bộ thông số mặc định tốt hơn hoặc bằng bộ thông số mới.");
    }
};

window.forceRunOptimizer = async function() {
    const { getState } = await import('./core/state.js');
    const { runOptimizer } = await import('./core/srs/worker-manager.js');
    const { reviewLogs } = getState();
    const logsLen = reviewLogs && (reviewLogs.logs ? reviewLogs.logs.length : reviewLogs.length);
    if (!logsLen || logsLen < 1) {
        console.warn("Không có đủ dữ liệu review logs để chạy optimizer.");
        return;
    }
    console.log(`🚀 Bắt đầu ép chạy Optimizer với ${logsLen} bản ghi...`);
    runOptimizer(reviewLogs, 0);
};

window.testFusionOptimizer = async function() {
    const { runOptimizer } = await import('./core/srs/worker-manager.js');
    console.log("🛠 Đang tạo 500 logs giả lập để test Optimizer...");
    const mockLogs = [];
    for(let i=0; i<500; i++) {
        mockLogs.push({
            cardId: 'card_' + Math.floor(i/5),
            rating: Math.floor(Math.random() * 4) + 1,
            t: Math.floor(Math.random() * 5) + 1
        });
    }
    runOptimizer(mockLogs, 0);
};