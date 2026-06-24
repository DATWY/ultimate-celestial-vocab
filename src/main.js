
import './css/style.css';
import { loadVocabulary, getState, addXP, saveGamification } from './core/state.js';
import { getNextCardToReview, buildReviewQueue } from './core/srs.js';
import { initializeSound, startBackgroundAudioPreload } from './core/sound.js';
import { displayCard, populateTopicFilters, applyDarkMode, applySoundSetting } from './ui/render.js';
import { setupEventListeners } from './events.js';
import { smartSync } from './core/firebase.js';

// --- CHEAT ENGINE CHO DEV ---
if (import.meta.env && import.meta.env.DEV) {
window.cheat = {
    addXP: (amount) => {
        sessionStorage.setItem('CHEAT_MODE', 'true');
        addXP(amount);
        console.log(`✨ Đã buff ${amount} XP! Mở Profile để xem rank mới.`);
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
            userXP: 0, currentLevel: 1, currentStreak: 0, longestStreak: 0, totalReviews: 0, unlockedBadges: [], lastStudyDate: null
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
    }
};
}

async function initializeApp() {
    console.log("Initializing Celestial Vocab App...");
    initializeSound();

    const initialDarkMode = localStorage.getItem('celestialDarkMode') === 'true';
    applyDarkMode(initialDarkMode);

    const initialSoundEnabled = localStorage.getItem('celestialSoundEnabled') !== 'false';
    applySoundSetting(initialSoundEnabled);

    await loadVocabulary();
    populateTopicFilters();
    buildReviewQueue();
    setupEventListeners();

    const firstCardIndex = getNextCardToReview();
    displayCard(firstCardIndex);
    console.log("App Initialized Successfully.");
	setTimeout(() => {
        smartSync();
    }, 2000);
	setTimeout(() => {
        startBackgroundAudioPreload(getState().vocabulary);
    }, 3000); // Chờ 3 giây để app load mượt xong xuôi rồi mới rục rịch tải âm thanh
}

document.addEventListener('DOMContentLoaded', initializeApp);
