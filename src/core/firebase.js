// src/core/firebase.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager, collection, getDocs, writeBatch, doc, query, where, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";
import { getState, setVocabulary, saveVocabulary, setGamification, saveGamification, setDailyStats, saveDailyStats } from './state.js';
import { buildReviewQueue, getNextCardToReview } from './srs.js';
import { updateStats, updatePanelWordList, displayCard } from '../ui/render.js';
import { showPopup } from '../ui/modal.js';
import { DOM } from '../ui/elements.js';
import { startBackgroundAudioPreload } from './sound.js';
import { getSettingFromDB, saveSettingToDB } from './idb.js';

function updateLocalMemory(remoteWord) {
    const { vocabulary } = getState();
    const index = vocabulary.findIndex(w => w.id === remoteWord.id);
    if (index > -1) {
        vocabulary[index] = remoteWord;
    } else {
        vocabulary.push(remoteWord);
    }
}

const firebaseConfig = {/* cần bổ sung api firebase*/
};

const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
const VOCAB_COLLECTION = "celestial_vocab_sync"; // Dùng chung 1 collection cho cá nhân
export const storage = getStorage(app);

export async function smartSync() {
    console.log("🔄 Bắt đầu đồng bộ thông minh...");
    
    if (sessionStorage.getItem('CHEAT_MODE') === 'true') {
        showPopup("⛔️ Tài khoản đang dùng Cheat. Chặn đồng bộ để bảo vệ dữ liệu Cloud!", "warning");
        return;
    }
    
    // --- BẬT TRẠNG THÁI LOADING UI ---
    if (DOM.manualSyncBtn) {
        DOM.manualSyncBtn.classList.add('syncing-active');
        DOM.manualSyncBtn.innerHTML = '<i class="ph-duotone ph-arrows-clockwise animate-spin"></i>';
    }

    try {
        const { vocabulary } = getState();
        const lastSyncTime = await getSettingFromDB('lastSyncTime') || 0;
        const currentSyncTime = Date.now();

        // 1. Tải dữ liệu từ Cloud
        let querySnapshot;
        if (lastSyncTime === 0) {
            // Thiết bị mới hoặc lần đầu sync: Tải TẤT CẢ (bao gồm cả dữ liệu cũ không có updatedAt)
            querySnapshot = await getDocs(collection(db, VOCAB_COLLECTION));
        } else {
            // Thiết bị đã từng sync: Chỉ tải Delta (những từ có thay đổi sau lần cuối)
            const q = query(collection(db, VOCAB_COLLECTION), where("updatedAt", ">", lastSyncTime));
            querySnapshot = await getDocs(q);
        }
        
        const remoteMap = new Map();
        querySnapshot.forEach(doc => {
            remoteMap.set(doc.id, doc.data());
        });

        // 2. Chuyển Local data thành Map
        const localDeltaMap = new Map();
        vocabulary.forEach(w => {
            // Nếu là thiết bị mới (lastSyncTime = 0), xét tất cả local words.
            // Nếu không, chỉ xét những từ có thay đổi gần đây.
            if (lastSyncTime === 0 || (w.updatedAt && w.updatedAt > lastSyncTime)) {
                localDeltaMap.set(w.id, w);
            }
        });

        let uploadData = [];
        let needsLocalUpdate = false;
        const allDeltaIds = new Set([...localDeltaMap.keys(), ...remoteMap.keys()]);

        allDeltaIds.forEach(id => {
            const local = localDeltaMap.get(id);
            const remote = remoteMap.get(id);

            if (local && remote) {
                const localTime = local.updatedAt || 0;
                const remoteTime = remote.updatedAt || 0;
                
                if (localTime > remoteTime) {
                    uploadData.push({ id, data: local });
                } else if (remoteTime > localTime) {
                    updateLocalMemory(remote);
                    needsLocalUpdate = true;
                }
            } else if (local && !remote) {
                uploadData.push({ id, data: local });
            } else if (remote && !local) {
                updateLocalMemory(remote);
                needsLocalUpdate = true;
            }
        });

        // 5. Commit dữ liệu lên Cloud với Batch Limit 500
        if (uploadData.length > 0) {
            const LIMIT = 500;
            for (let i = 0; i < uploadData.length; i += LIMIT) {
                const batchChunk = writeBatch(db);
                uploadData.slice(i, i + LIMIT).forEach(item => {
                    const cleanData = JSON.parse(JSON.stringify(item.data));
                    batchChunk.set(doc(db, VOCAB_COLLECTION, item.id), cleanData);
                });
                await batchChunk.commit();
            }
            console.log(`☁️ Đã đẩy ${uploadData.length} cập nhật lên Cloud.`);
        }

        // --- 6. Đồng bộ Gamification & Stats ---
        const USER_SYNC_COLLECTION = "celestial_user_sync";
        
        // Gamification Sync
        const gamificationRef = doc(db, USER_SYNC_COLLECTION, "gamification");
        const remoteGamificationSnap = await getDoc(gamificationRef);
        const remoteGamification = remoteGamificationSnap.exists() ? remoteGamificationSnap.data() : null;
        const localGamification = getState().gamification || {};
        
        let mergedGamification = { ...localGamification };
        if (remoteGamification) {
            mergedGamification.userXP = Math.max(localGamification.userXP || 0, remoteGamification.userXP || 0);
            mergedGamification.currentLevel = Math.max(localGamification.currentLevel || 1, remoteGamification.currentLevel || 1);
            mergedGamification.currentStreak = Math.max(localGamification.currentStreak || 0, remoteGamification.currentStreak || 0);
            mergedGamification.totalReviews = Math.max(localGamification.totalReviews || 0, remoteGamification.totalReviews || 0);
            
            // Merge arrays (badges)
            const unlockedSet = new Set([...(localGamification.unlockedBadges || []), ...(remoteGamification.unlockedBadges || [])]);
            mergedGamification.unlockedBadges = Array.from(unlockedSet);
            
            // Merge heatmap
            const localHeatmap = localGamification.activityHeatmap || {};
            const remoteHeatmap = remoteGamification.activityHeatmap || {};
            const mergedHeatmap = { ...remoteHeatmap };
            for (const key in localHeatmap) {
                mergedHeatmap[key] = Math.max(localHeatmap[key] || 0, remoteHeatmap[key] || 0);
            }
            mergedGamification.activityHeatmap = mergedHeatmap;
        }
        
        setGamification(mergedGamification);
        await saveGamification();
        const cleanGamification = JSON.parse(JSON.stringify(mergedGamification));
        await setDoc(gamificationRef, cleanGamification);
        
        // Daily Stats Sync
        const statsRef = doc(db, USER_SYNC_COLLECTION, "dailyStats");
        const remoteStatsSnap = await getDoc(statsRef);
        const remoteStats = remoteStatsSnap.exists() ? remoteStatsSnap.data() : null;
        const localStats = getState().dailyStats || {};
        
        let mergedStats = { ...localStats };
        if (remoteStats) {
            const localDate = localStats.lastDate || "";
            const remoteDate = remoteStats.lastDate || "";
            
            if (remoteDate === localDate) {
                mergedStats.newCardsDoneToday = Math.max(localStats.newCardsDoneToday || 0, remoteStats.newCardsDoneToday || 0);
                mergedStats.todayCorrect = Math.max(localStats.todayCorrect || 0, remoteStats.todayCorrect || 0);
                mergedStats.todayTotal = Math.max(localStats.todayTotal || 0, remoteStats.todayTotal || 0);
            }
        }
        
        setDailyStats(mergedStats);
        await saveDailyStats();
        const cleanStats = JSON.parse(JSON.stringify(mergedStats));
        await setDoc(statsRef, cleanStats);

        // 7. Cập nhật lại giao diện nếu có tải dữ liệu mới về
        if (needsLocalUpdate) {
            const { vocabulary: updatedVocab } = getState();
            setVocabulary(updatedVocab);
            await saveVocabulary(true); 
            buildReviewQueue();
            updateStats();
            updatePanelWordList();
            displayCard(getNextCardToReview());
            console.log("📱 Đã cập nhật dữ liệu từ Cloud về máy.");
            showPopup("Đã đồng bộ dữ liệu với Cloud!", "success");
			startBackgroundAudioPreload(updatedVocab);
        } else if (uploadData.length === 0) {
            console.log("✅ Dữ liệu đã đồng bộ hoàn toàn.");
        }

        await saveSettingToDB('lastSyncTime', currentSyncTime);

    } catch (error) {
        console.error("Lỗi đồng bộ Firebase:", error);
        showPopup("Lỗi đồng bộ: " + error.message, "error");
    } finally {
        // --- TẮT TRẠNG THÁI LOADING VÀ BÁO CÁO KẾT QUẢ UI ---
        if (DOM.manualSyncBtn) {
            DOM.manualSyncBtn.classList.remove('syncing-active');
            DOM.manualSyncBtn.innerHTML = '<i class="ph-duotone ph-cloud-check"></i>';
            
            // Trả lại nút về trạng thái ban đầu sau 2.5 giây
            setTimeout(() => {
                if (DOM.manualSyncBtn) {
                    DOM.manualSyncBtn.innerHTML = '<i class="ph-duotone ph-arrows-clockwise"></i>';
                }
            }, 2500);
        }
    }
}