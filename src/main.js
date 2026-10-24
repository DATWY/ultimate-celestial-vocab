
import './css/tokens/celestial-v5.css';
import './css/style.css';
import './css/transition.css';
import './css/study-polish.css';
import { loadVocabulary, getState, setVocabulary, seedIsolatedDemoVocabulary } from './core/state.js';
import { getNextCardToReview, buildReviewQueue } from './core/queue.js';
import { initializeSound } from './core/sound.js';
import { displayCard, flipCard, populateTopicFilters, updateCustomTypingUI, applyDarkMode, applySoundSetting, applyBoostMode } from './ui/render.js';
import { setupEventListeners } from './events.js';
import { openManageModal, openAddEditModal, openDedupModal, openModal, showPopup } from './ui/modal.js';
import { checkAppVersion } from './core/versionCheck.js';
import { initTabBus } from './core/tab-bus.js';

// Cloud (firebase 547 kB) được nạp SAU khi giao diện sẵn sàng, không nằm trên
// critical path của entry chunk. Trước đây main.js import tĩnh firebase nên mọi
// lần mở app đều phải tải 547 kB trước khi hiển thị thẻ đầu tiên.
let _cloudModulePromise = null;
let _syncQueueModulePromise = null;
function loadCloud() {
    if (!_cloudModulePromise) _cloudModulePromise = import('./core/firebase.js');
    return _cloudModulePromise;
}
function loadSyncQueue() {
    if (!_syncQueueModulePromise) _syncQueueModulePromise = import('./core/sync.js');
    return _syncQueueModulePromise;
}

/** Chạy sau khi app đã ổn định: ưu tiên requestIdleCallback, fallback setTimeout. */
function runWhenIdle(task, { delay = 6000, timeout = 3000 } = {}) {
    const run = () => {
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
        try { task(); } catch (error) { console.warn('Idle task failed:', error); }
    };
    setTimeout(() => {
        if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(run, { timeout });
        } else {
            run();
        }
    }, delay);
}

if (import.meta.env?.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).get('audit') === '1') {
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
        const { clearVocabularyDB } = await import('./core/idb.js');
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
    showQuizSetup: async () => {
        const { showQuizSetup } = await import('./features/quiz.js');
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
    evaluateTyping: async (input, target) => {
        const { evaluateTyping, stripVietnameseDiacritics } = await import('./features/typing.js');
        return {
            eval: evaluateTyping(input, target),
            stripped: stripVietnameseDiacritics(input)
        };
    },
    calculateSRS: async (card, rating) => {
        const { calculateNextSrsState } = await import('./core/srs/index.js');
        return calculateNextSrsState(card, rating, 'en-vi');
    },
    getHeuristics: async (card) => {
        const { getDifficultyBias, getStabilityMultiplier } = await import('./core/srs/heuristics.js');
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
    const auditMode = (import.meta.env?.DEV ?? false) && urlParams.get('audit') === '1';
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

    // Khởi tạo UI Gamification / Rank / XP bar SAU khi màn học đã vẽ xong.
    // Toàn bộ UI này nằm trong Hub (đang đóng) nên không cần render trên
    // critical path; dời sang idle giúp first paint/typing mượt hơn.
    // Hub vẫn force-render lại mỗi lần mở nên không có dữ liệu cũ.
    runWhenIdle(() => {
        // Nếu người dùng đã mở Hub trước mốc idle, Hub đã tự force-render;
        // không render lại để tránh animation đếm số chạy lần hai.
        const hubEl = document.getElementById('manage-modal');
        if (hubEl && !hubEl.classList.contains('hidden')) return;
        import('./features/gamification.js')
            .then(m => m.renderGamificationUI?.({ isBackgroundUpdate: true, force: true }))
            .catch(() => {});
    }, { delay: 4000, timeout: 3000 });

    // Kiểm tra phiên bản mới từ server để phát hiện và reset web cập nhật nếu cần
    checkAppVersion();

    // Khởi tạo Bus đồng bộ đa tab (<2ms) & Bầu chọn Leader Tab
    initTabBus();

    // --- CLOUD: nạp muộn, sau khi UI đã hiển thị ---
    // Recover pending sync IDs + listener online/offline + smart sync đầu tiên.
    // 6 giây + requestIdleCallback: không tranh main thread với lần vẽ đầu.
    runWhenIdle(() => {
        loadSyncQueue().then(m => m.recoverPendingSyncIds()).catch(() => {});
        // Nạp module Cloud kể cả khi đang offline để gắn listener online/offline;
        // smartSync tự bỏ qua và giữ trạng thái offline nếu chưa có mạng.
        loadCloud().then(m => {
            m.setupOnlineOfflineListeners();
            m.setupRealtimeSyncListener();
            if (typeof navigator !== 'undefined' && !navigator.onLine) return null;
            return m.smartSync({ isManual: false });
        }).catch(error => console.warn('Cloud sync chưa sẵn sàng:', error));
    }, { delay: 6000 });

    // --- VISIBILITYCHANGE: Sync nhẹ nhàng khi chuyển tab ---
    // Khi user rời tab: flush pending changes lên Cloud
    // Khi user quay lại tab: pull dữ liệu mới từ Cloud (cooldown 5 phút)
    let _lastVisibilitySync = 0;
    const VISIBILITY_SYNC_COOLDOWN_MS = 5 * 60 * 1000; // 5 phút cooldown (tránh spam khi alt-tab nhanh)

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            // User rời tab → flush ngầm dữ liệu để thiết bị khác nhận được
            loadSyncQueue().then(m => {
                m.flushSyncQueue();
                m.syncGamificationToFirebase();
            }).catch(() => {});
        } else if (document.visibilityState === 'visible') {
            const now = Date.now();
            if (now - _lastVisibilitySync > VISIBILITY_SYNC_COOLDOWN_MS) {
                _lastVisibilitySync = now;
                console.log("👀 Tab active trở lại. Đồng bộ dữ liệu nền...");
                loadCloud().then(m => m.smartSync({ isManual: false })).catch(() => {});
            }
            checkAppVersion();
        }
    });

    // --- BEFOREUNLOAD: Flush sync queue an toàn trước khi đóng tab ---
    window.addEventListener('beforeunload', () => {
        // Module sync thường đã được nạp sau lượt học đầu tiên; nếu chưa thì việc
        // persist pending IDs đã diễn ra ngay khi thẻ được xếp hàng.
        if (_syncQueueModulePromise) {
            _syncQueueModulePromise.then(m => m.flushSyncQueueBeforeUnload()).catch(() => {});
        }
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
