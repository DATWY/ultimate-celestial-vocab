
import './css/tokens/celestial-v5.css';
import './css/style.css';
import './css/transition.css';
import './css/study-polish.css';
import { loadVocabulary, getState, setVocabulary, seedIsolatedDemoVocabulary } from './core/state.js';
import { getNextCardToReview, buildReviewQueue } from './core/queue.js';
import { initializeSound, startBackgroundAudioPreload } from './core/sound.js';
import { displayCard, flipCard, populateTopicFilters, updateCustomTypingUI, applyDarkMode, applySoundSetting, applyBoostMode } from './ui/render.js';
import { setupEventListeners } from './events.js';
import { smartSync } from './core/firebase.js';
import { openManageModal, openAddEditModal, openDedupModal, openModal, showPopup } from './ui/modal.js';
import { showQuizSetup } from './features/quiz.js';
import { evaluateTyping, stripVietnameseDiacritics } from './features/typing.js';
import { calculateNextSrsState } from './core/srs/index.js';
import { getDifficultyBias, getStabilityMultiplier } from './core/srs/heuristics.js';
import { clearVocabularyDB } from './core/idb.js';
import { checkAppVersion, displayAppVersion } from './core/versionCheck.js';

if (import.meta.env.DEV && new URLSearchParams(location.search).get('audit') === '1') {
// Sample Vocabulary Seeder for Isolated Testing & First-Run Exploration
window.loadIsolatedSampleVocabulary = async function() {
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
        setVocabulary([]);
        await clearVocabularyDB();
        displayCard(null);
    },
    flipCard: async () => {
        await flipCard();
    },
    openHub: (tab = 'overview') => {
        openManageModal(tab);
    },
    openAddWord: () => {
        openAddEditModal(false);
    },
    openDedup: () => {
        openDedupModal();
    },
    openFsrs7Config: () => {
        const modal = document.getElementById('fsrs7-config-modal');
        if (modal) openModal(modal);
    },
    showQuizSetup: () => {
        showQuizSetup();
    },
    showVictoryStage: () => {
        displayCard(null);
    },
    setDarkMode: (isDark) => {
        applyDarkMode(isDark);
    },
    setBoostMode: (isBoost) => {
        applyBoostMode(isBoost, true);
    },
    getBoostMode: () => {
        return getState().isBoostMode;
    },
    evaluateTyping: (input, target) => {
        return {
            eval: evaluateTyping(input, target),
            stripped: stripVietnameseDiacritics(input)
        };
    },
    calculateSRS: (card, rating) => {
        return calculateNextSrsState(card, rating, 'en-vi');
    },
    getHeuristics: (card) => {
        const bias = getDifficultyBias(card);
        const mult = getStabilityMultiplier(bias);
        return { bias, mult };
    }
};

}

import { initCelestialCanvas, isMobileDevice } from './ui/celestial-canvas.js';

async function initializeApp() {
    console.log("Initializing Celestial Vocab App...");
    initializeSound();

    const urlParams = new URLSearchParams(window.location.search);
    const auditMode = import.meta.env.DEV && urlParams.get('audit') === '1';
    if (auditMode) {
        sessionStorage.setItem('CHEAT_MODE', 'true');
        sessionStorage.setItem('ISOLATED_TEST_MODE', 'true');
    }
    const themeParam = urlParams.get('theme');
    const savedDark = localStorage.getItem('celestialDarkMode');
    const systemPrefersDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialDarkMode = themeParam
        ? (themeParam === 'dark')
        : (savedDark !== null ? savedDark === 'true' : (systemPrefersDark !== false));
    applyDarkMode(initialDarkMode);

    const initialSoundMode = localStorage.getItem('celestialSoundMode') || 'all';
    applySoundSetting(initialSoundMode);

    // --- BOOST MODE (0% GPU & ECO HIGH PERFORMANCE) ---
    const mobileDevice = isMobileDevice();
    const boostParam = urlParams.get('boost');
    const hashBoost = typeof window !== 'undefined' && window.location.hash.toLowerCase() === '#boost';
    const pathBoost = typeof window !== 'undefined' && window.location.pathname.toLowerCase().endsWith('/boost');
    const savedBoost = localStorage.getItem('celestialBoostMode');

    let initialBoostMode = false;
    if (boostParam !== null || hashBoost || pathBoost) {
        initialBoostMode = (boostParam === '1' || boostParam === 'true' || boostParam === '' || hashBoost || pathBoost);
    } else if (savedBoost !== null) {
        initialBoostMode = (savedBoost === 'true');
    } else if (mobileDevice) {
        // Auto-enable Boost Mode on mobile devices for 0% GPU waste and maximum responsiveness
        initialBoostMode = true;
    }
    applyBoostMode(initialBoostMode, false);

    initCelestialCanvas();

    await loadVocabulary();
    if (auditMode && !getState().vocabulary.length) await seedIsolatedDemoVocabulary();
    populateTopicFilters();
    updateCustomTypingUI();
    buildReviewQueue();
    setupEventListeners();

    const firstCardIndex = getNextCardToReview();
    displayCard(firstCardIndex);
    document.body.classList.add('app-ready');
    console.log("App Initialized Successfully.");

    // Khởi tạo trước UI Gamification / Rank / XP bar từ dữ liệu IndexedDB local
    import('./features/gamification.js').then(m => m.renderGamificationUI?.({ isBackgroundUpdate: true, force: true }));

    // Kiểm tra phiên bản mới từ server để phát hiện và reset web cập nhật nếu cần
    checkAppVersion();

    // Recover pending sync IDs từ phiên trước (crash/đóng tab đột ngột)
    const { recoverPendingSyncIds, flushSyncQueueBeforeUnload, flushSyncQueue, syncGamificationToFirebase } = await import('./core/sync.js');
    await recoverPendingSyncIds();

    // Khởi tạo Bus đồng bộ đa tab (<2ms) & Bầu chọn Leader Tab
    const { initTabBus } = await import('./core/tab-bus.js');
    initTabBus();

    // Setup online/offline detection & Real-time Cloud Beacon listener
    const { setupOnlineOfflineListeners, setupRealtimeSyncListener } = await import('./core/firebase.js');
    setupOnlineOfflineListeners();
    setupRealtimeSyncListener();

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
            checkAppVersion();
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

// Keep storage problems visible without adding a status panel to the study screen.
let lastStorageIssue = null;
document.addEventListener('sync:status', ({ detail }) => {
    if (!['storage-error', 'storage-blocked'].includes(detail.phase)) { lastStorageIssue = null; return; }
    if (lastStorageIssue === detail.phase) return;
    lastStorageIssue = detail.phase;
    showPopup(detail.phase === 'storage-blocked'
        ? 'Hãy đóng các tab bản cũ để hoàn tất cập nhật dữ liệu.'
        : 'Chưa lưu được trên máy. Hãy xuất dữ liệu để giữ bản sao.', 'warning');
});

document.addEventListener('DOMContentLoaded', () => initializeApp().catch(error => {
    console.error('Không mở được ứng dụng:', error);
    showPopup('Chưa mở được dữ liệu. Hãy tải lại trang hoặc đóng các tab bản cũ.', 'error');
}));
