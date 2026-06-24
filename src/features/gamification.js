// src/features/gamification.js
import { DOM } from '../ui/elements.js';
import { getState, unlockBadge } from '../core/state.js';
import { openModal, showPopup } from '../ui/modal.js';

import { BADGES } from './badges.js';

export function openProfileModal() {
    renderGamificationUI();
    openModal(DOM.profileModal);
}

export function renderGamificationUI() {
    const state = getState();
    const gamification = state.gamification || {};
    const { userXP = 0, currentLevel = 1, currentStreak = 0, activityHeatmap = {}, unlockedBadges = [] } = gamification;

    // Tính toán Rank
    const rankInfo = getRankInfo(currentLevel);
    
    // Áp dụng Style Rank cho Profile Card
    const levelCard = document.querySelector('.level-card');
    if (levelCard) {
        levelCard.className = `profile-card level-card rank-${rankInfo.id}`;
    }

    // Render Level & Rank & XP
    if (DOM.profileLevel) DOM.profileLevel.textContent = currentLevel;
    const rankTitleElement = document.querySelector('.level-card h3');
    if (rankTitleElement) {
        rankTitleElement.innerHTML = `<i class="ph ${rankInfo.icon}"></i> ${rankInfo.name}`;
        // Loại bỏ ghi đè màu inline để sử dụng CSS Gradient sang trọng
    }
    
    if (DOM.profileTotalXP) DOM.profileTotalXP.textContent = userXP.toLocaleString('vi-VN');
    
    // XP Calculation
    const xpForCurrentLevel = Math.pow(currentLevel - 1, 2) * 100;
    const xpForNextLevel = Math.pow(currentLevel, 2) * 100;
    const xpInCurrentLevel = userXP - xpForCurrentLevel;
    const xpNeededTotalForCurrentLevel = xpForNextLevel - xpForCurrentLevel;
    
    let progressPercent = (xpInCurrentLevel / xpNeededTotalForCurrentLevel) * 100;
    progressPercent = Math.max(0, Math.min(100, progressPercent)); // Clamping

    if (DOM.profileXpFill) DOM.profileXpFill.style.width = `${progressPercent}%`;
    if (DOM.profileXpNeeded) DOM.profileXpNeeded.textContent = (xpForNextLevel - userXP).toLocaleString('vi-VN');

    // Render Streak
    if (DOM.profileStreak) DOM.profileStreak.textContent = currentStreak;

    // Render Heatmap
    renderHeatmap(activityHeatmap);

    // Render Forecast
    renderForecast(state.vocabulary);

    // Render Badges
    renderBadges(unlockedBadges);
}

function getRankInfo(level) {
    if (level < 10) return { id: 'bronze', name: 'Đồng', color: '#cd7f32', icon: 'ph-shield' };
    if (level < 20) return { id: 'silver', name: 'Bạc', color: '#c0c0c0', icon: 'ph-shield-check' };
    if (level < 30) return { id: 'gold', name: 'Vàng', color: '#ffd700', icon: 'ph-shield-star' };
    if (level < 40) return { id: 'platinum', name: 'Bạch Kim', color: '#e5e4e2', icon: 'ph-crown-simple' };
    return { id: 'diamond', name: 'Kim Cương', color: '#b9f2ff', icon: 'ph-crown' };
}

function renderBadges(unlockedBadges) {
    if (!DOM.achievementsList) return;
    DOM.achievementsList.innerHTML = '';
    
    BADGES.forEach(badge => {
        const isUnlocked = unlockedBadges.includes(badge.id);
        const badgeEl = document.createElement('div');
        badgeEl.className = `badge-item ${isUnlocked ? 'unlocked' : 'locked'}`;
        if (isUnlocked && badge.tier && badge.tier.id) {
            badgeEl.setAttribute('data-tier', badge.tier.id);
        }
        badgeEl.innerHTML = `
            <div class="badge-icon"><i class="ph ${badge.icon}"></i></div>
            <div class="badge-info">
                <h4>${badge.name}</h4>
                <p>${badge.desc}</p>
            </div>
        `;
        DOM.achievementsList.appendChild(badgeEl);
    });
}

function renderHeatmap(activityHeatmap) {
    if (!DOM.activityHeatmap) return;
    DOM.activityHeatmap.innerHTML = ''; // Clear old

    const today = new Date();
    // Show last 30 days
    const DAYS_TO_SHOW = 30;
    
    for (let i = DAYS_TO_SHOW - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        
        const count = activityHeatmap[dateStr] || 0;
        
        const cell = document.createElement('div');
        cell.className = 'heatmap-cell';
        cell.title = `${dateStr}: ${count} lần học`;
        
        // Color logic
        if (count > 0 && count < 10) cell.classList.add('level-1');
        else if (count >= 10 && count < 30) cell.classList.add('level-2');
        else if (count >= 30 && count < 60) cell.classList.add('level-3');
        else if (count >= 60) cell.classList.add('level-4');
        
        DOM.activityHeatmap.appendChild(cell);
    }
}

function renderForecast(vocabulary) {
    if (!DOM.forecastChart) return;
    DOM.forecastChart.innerHTML = '';

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today

    const forecastData = Array(7).fill(0);
    const forecastWords = Array(7).fill(null).map(() => []); // Lưu danh sách từ vựng
    
    vocabulary.forEach(word => {
        if (!word.isSuspended && !word.isDeleted && word.srsDueDate) {
            const dueDate = new Date(word.srsDueDate);
            dueDate.setHours(0, 0, 0, 0);
            
            const diffTime = dueDate.getTime() - today.getTime();
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays <= 0) {
                forecastData[0]++;
                forecastWords[0].push(word.english);
            } else if (diffDays < 7) {
                forecastData[diffDays]++;
                forecastWords[diffDays].push(word.english);
            }
        }
    });

    const maxCount = Math.max(...forecastData, 1); // Avoid div by 0

    const dayLabels = ['H.Nay', 'N.Mai'];
    for(let i=2; i<7; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        const vnDay = d.getDay();
        const days = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
        dayLabels.push(days[vnDay]);
    }

    forecastData.forEach((count, index) => {
        const barContainer = document.createElement('div');
        barContainer.className = 'forecast-bar-container';

        const bar = document.createElement('div');
        bar.className = 'forecast-bar';
        const heightPercent = (count / maxCount) * 100;
        bar.style.height = `${heightPercent}%`;
        if (count === 0) bar.style.height = '2px'; // Min height

        const countLabel = document.createElement('span');
        countLabel.className = 'forecast-count';
        countLabel.textContent = count;

        const dayLabel = document.createElement('span');
        dayLabel.className = 'forecast-day';
        dayLabel.textContent = dayLabels[index];

        barContainer.appendChild(countLabel);
        barContainer.appendChild(bar);
        barContainer.appendChild(dayLabel);
        
        // Nâng cấp: Cho phép click để xem danh sách từ
        barContainer.style.cursor = 'pointer';
        barContainer.title = 'Bấm để xem danh sách từ vựng cần ôn';
        barContainer.addEventListener('mouseenter', () => {
            bar.style.filter = 'brightness(1.5)';
            bar.style.transform = 'scaleY(1.05)';
        });
        barContainer.addEventListener('mouseleave', () => {
            bar.style.filter = 'none';
            bar.style.transform = 'none';
        });
        bar.style.transition = 'all 0.2s ease';

        barContainer.addEventListener('click', () => {
            if (count > 0) {
                const wordsHtml = forecastWords[index].map(w => `<span style="display:inline-block; padding: 6px 12px; background: rgba(138,43,226,0.15); border: 1px solid rgba(138,43,226,0.3); border-radius: 8px; margin: 4px; font-size: 0.95rem; font-weight: 500; color: var(--primary-color)">${w}</span>`).join('');
                showPopup(`<h3 style="margin-bottom:15px; color:var(--text-color); font-size: 1.1rem;">Dự báo <strong>${dayLabels[index]}</strong>: Có <strong style="color:var(--primary-color)">${count}</strong> từ cần ôn</h3><div style="max-height: 250px; overflow-y: auto; padding: 5px; text-align: left;">${wordsHtml}</div>`, 'info', true);
            } else {
                showPopup(`<strong>${dayLabels[index]}</strong> chưa có từ nào cần ôn.<br>Chúc bạn một ngày thảnh thơi!`, 'info', true);
            }
        });

        DOM.forecastChart.appendChild(barContainer);
    });
}

// Logic kiểm tra Huy hiệu tự động
document.getElementById('app-container')?.addEventListener('gamification:update', () => {
    const state = getState();
    const gamification = state.gamification || {};
    const { userXP = 0, currentStreak = 0, totalReviews = 0 } = gamification;
    const masteredCount = state.vocabulary ? state.vocabulary.filter(w => w.srsStatus === 'Mastered').length : 0;
    
    BADGES.forEach(badge => {
        if (gamification.unlockedBadges && gamification.unlockedBadges.includes(badge.id)) return;
        
        let shouldUnlock = false;
        if (badge.type === 'xp' && userXP >= badge.target) shouldUnlock = true;
        if (badge.type === 'streak' && currentStreak >= badge.target) shouldUnlock = true;
        if (badge.type === 'mastered' && masteredCount >= badge.target) shouldUnlock = true;
        if (badge.type === 'review' && totalReviews >= badge.target) shouldUnlock = true;
        
        if (shouldUnlock) unlockBadge(badge.id);
    });
});

// Hiệu ứng Floating XP — CSS-only, không dùng anime.js để tránh xung đột layout
document.getElementById('app-container')?.addEventListener('gamification:xp_added', (e) => {
    const amount = e.detail?.amount;
    if (!amount) return;

    const floatEl = document.createElement('div');
    floatEl.className = 'floating-xp';
    floatEl.textContent = `+${amount} XP`;

    // Vị trí ngẫu nhiên nhẹ quanh trung tâm để tránh chồng chéo
    const offsetX = (Math.random() - 0.5) * 60;
    floatEl.style.left = `calc(50% + ${offsetX}px)`;
    floatEl.style.top = '65%';

    document.body.appendChild(floatEl);

    // Tự hủy sau khi animation kết thúc
    floatEl.addEventListener('animationend', () => {
        if (floatEl.parentNode) floatEl.parentNode.removeChild(floatEl);
    });
});
