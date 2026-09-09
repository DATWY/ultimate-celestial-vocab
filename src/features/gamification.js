// src/features/gamification.js
import { DOM } from '../ui/elements.js';
import { getState, unlockBadge, trackEvent } from '../core/state.js';
import { openModal, showPopup } from '../ui/modal.js';
import { getLocalDateString } from '../core/utils/date.js';

// Removed static import for BADGES to use dynamic import for BADGE_TRACKS and SPECIAL_BADGES
import { animateNumber, animateForecastChart, animateHeatmap } from '../core/animations.js';

export function openProfileModal() {
    trackEvent('profileViews');
    renderGamificationUI();
    openModal(DOM.profileModal);
}

export function renderGamificationUI() {
    const state = getState();
    const gamification = state.gamification || {};
    const { userXP = 0, currentLevel = 1, currentStreak = 0, activityHeatmap = {}, unlockedBadges = [] } = gamification;

    // Tính toán Rank
    const rankInfo = getRankInfo(currentLevel);
    
    // Áp dụng Style Rank cho Profile Card & Render SVG Emblem
    const levelCard = document.querySelector('.level-card');
    if (levelCard) {
        levelCard.className = `profile-card level-card rank-${rankInfo.id}`;
        
        const levelDisplay = levelCard.querySelector('.level-display');
        if (levelDisplay) {
            let emblemContainer = levelDisplay.querySelector('.rank-emblem-container');
            if (!emblemContainer) {
                emblemContainer = document.createElement('div');
                emblemContainer.className = 'rank-emblem-container';
                levelDisplay.insertBefore(emblemContainer, levelDisplay.firstChild);
            }
            emblemContainer.innerHTML = rankInfo.svg;
        }
    }

    // Render Level & Rank & XP
    if (DOM.profileLevel) animateNumber(DOM.profileLevel, currentLevel);
    const rankTitleElement = document.querySelector('.level-card h3');
    if (rankTitleElement) {
        rankTitleElement.innerHTML = `<i class="ph ${rankInfo.icon}"></i> ${rankInfo.name}`;
    }
    
    if (DOM.profileTotalXP) animateNumber(DOM.profileTotalXP, userXP, 2500, true);
    
    // XP Calculation
    const xpForCurrentLevel = Math.pow(currentLevel - 1, 2) * 100;
    const xpForNextLevel = Math.pow(currentLevel, 2) * 100;
    const xpInCurrentLevel = userXP - xpForCurrentLevel;
    const xpNeededTotalForCurrentLevel = xpForNextLevel - xpForCurrentLevel;
    
    let progressPercent = (xpInCurrentLevel / xpNeededTotalForCurrentLevel) * 100;
    progressPercent = Math.max(0, Math.min(100, progressPercent)); // Clamping

    if (DOM.profileXpFill) DOM.profileXpFill.style.width = `${progressPercent}%`;
    if (DOM.profileXpNeeded) animateNumber(DOM.profileXpNeeded, xpForNextLevel - userXP, 2500, true);

    // Render Memory Analytics
    const totalReviews = gamification.totalReviews || 0;
    const vocab = state.vocabulary || [];
    let totalStability = 0;
    let stabilityCount = 0;
    let totalLapses = 0;

    vocab.forEach(w => {
        if (!w.isDeleted && typeof w.stability === 'number' && w.stability > 0) {
            totalStability += w.stability;
            stabilityCount++;
        }
        if (w.lapses) totalLapses += w.lapses;
    });

    const avgStabilityNum = stabilityCount > 0 ? (totalStability / stabilityCount) : (totalReviews > 0 ? 1.0 : 0);
    const retentionRateNum = totalReviews > 0 ? Math.min(99.4, Math.max(82.0, (100 - (totalLapses / (totalReviews || 1)) * 100))) : 94.2;

    const avgStability = avgStabilityNum.toFixed(1);
    const retentionRate = retentionRateNum.toFixed(1);

    const elRetention = document.getElementById('profile-retention-rate');
    const elStability = document.getElementById('profile-avg-stability');
    const elTotalRev = document.getElementById('profile-total-reviews');
    const elRetentionSub = document.getElementById('profile-retention-sub');
    const elStabilitySub = document.getElementById('profile-stability-sub');
    const elMemoryStatus = document.getElementById('profile-memory-status');

    if (elRetention) elRetention.textContent = `${retentionRate}%`;
    if (elStability) elStability.textContent = `${avgStability} ngày`;
    if (elTotalRev) animateNumber(elTotalRev, totalReviews, 2000, true);

    if (elRetentionSub) {
        elRetentionSub.textContent = retentionRateNum >= 88 ? '🎯 Đang nhớ rất sâu' : (retentionRateNum >= 75 ? '👍 Duy trì ổn định' : '⚠️ Cần củng cố thêm');
    }

    if (elStabilitySub) {
        elStabilitySub.textContent = avgStabilityNum >= 14 ? '🧠 Trí nhớ dài hạn' : (avgStabilityNum >= 5 ? '⏳ Trí nhớ trung hạn' : '🌱 Trí nhớ ngắn hạn');
    }

    if (elMemoryStatus) {
        if (retentionRateNum >= 88) {
            elMemoryStatus.innerHTML = `<i class="ph-fill ph-check-circle" style="color: #4CAF50;"></i> Phong độ: Xuất sắc`;
        } else if (retentionRateNum >= 75) {
            elMemoryStatus.innerHTML = `<i class="ph-fill ph-sparkle" style="color: #FFC107;"></i> Phong độ: Ổn định`;
        } else {
            elMemoryStatus.innerHTML = `<i class="ph-fill ph-warning-circle" style="color: #FF5722;"></i> Cần củng cố ngay`;
        }
    }

    // Bind Memory Help Button
    const btnHelp = document.getElementById('btn-memory-info-help');
    if (btnHelp && !btnHelp.dataset.bound) {
        btnHelp.dataset.bound = 'true';
        btnHelp.addEventListener('click', () => {
            const detailsHtml = `
                <div style="text-align: left; padding: 5px;">
                    <h3 style="margin-bottom: 14px; color: var(--primary-color); font-size: 1.25rem; display: flex; align-items: center; gap: 8px;">
                        <i class="ph-bold ph-brain"></i> Sức Khỏe Trí Nhớ FusionSRS
                    </h3>
                    <p style="color: var(--text-color); font-size: 0.95rem; line-height: 1.5; margin-bottom: 16px;">
                        Thuật toán đo lường thông minh giúp bạn hiểu rõ tình trạng ghi nhớ từ vựng của bộ não:
                    </p>
                    <ul style="list-style: none; padding: 0; margin: 0 0 16px 0; display: flex; flex-direction: column; gap: 12px;">
                        <li style="padding: 12px; background: rgba(255,255,255,0.04); border-radius: 12px; border: 1px solid rgba(255,255,255,0.08);">
                            <strong style="color: #00E5FF; font-size: 0.98rem;">🎯 Mức Độ Thuộc Bài (%):</strong>
                            <p style="margin: 4px 0 0 0; color: var(--text-light); font-size: 0.88rem; line-height: 1.4;">Xác suất bạn sẽ nhớ ngay 1 từ nếu được kiểm tra bất ngờ. Khoảng lý tưởng nhất là 85% - 95%.</p>
                        </li>
                        <li style="padding: 12px; background: rgba(255,255,255,0.04); border-radius: 12px; border: 1px solid rgba(255,255,255,0.08);">
                            <strong style="color: #FFD700; font-size: 0.98rem;">🧠 Thời Gian Nhớ Tự Nhiên (Ngày):</strong>
                            <p style="margin: 4px 0 0 0; color: var(--text-light); font-size: 0.88rem; line-height: 1.4;">Số ngày trung bình một từ nằm yên trong đầu bạn mà không bị quên. Càng nhiều ngày nghĩa là từ đó đã đi sâu vào <em>Trí nhớ dài hạn</em>.</p>
                        </li>
                        <li style="padding: 12px; background: rgba(255,255,255,0.04); border-radius: 12px; border: 1px solid rgba(255,255,255,0.08);">
                            <strong style="color: #AB47BC; font-size: 0.98rem;">⚡ Tích Lũy Luyện Tập:</strong>
                            <p style="margin: 4px 0 0 0; color: var(--text-light); font-size: 0.88rem; line-height: 1.4;">Tổng số lần bạn đã lật thẻ hoặc làm Quiz. Hệ thống dựa vào đây để phân bổ lịch ôn tối ưu cho riêng bạn.</p>
                        </li>
                    </ul>
                </div>
            `;
            showPopup(detailsHtml, 'info', true);
        });
    }

    // Render Streak
    if (DOM.profileStreak) animateNumber(DOM.profileStreak, currentStreak);

    // Render Heatmap
    renderHeatmap(activityHeatmap);

    // Render Forecast
    renderForecast(state.vocabulary);

    // Render Badges
    renderBadges(unlockedBadges);
}


function getRankInfo(level) {
    if (level < 10) {
        return {
            id: 'bronze',
            name: 'Đồng (Bronze)',
            color: '#CD7F32',
            icon: 'ph-shield',
            svg: `<svg viewBox="0 0 100 100" class="rank-svg-emblem bronze-emblem" aria-hidden="true">
                <defs>
                    <linearGradient id="bronzeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#E59866" />
                        <stop offset="50%" stop-color="#CD7F32" />
                        <stop offset="100%" stop-color="#7E3817" />
                    </linearGradient>
                    <linearGradient id="bronzeCore" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="#F5B041" />
                        <stop offset="100%" stop-color="#A04000" />
                    </linearGradient>
                    <filter id="bronzeGlow" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="3" result="blur" />
                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                </defs>
                <path d="M50 5 L85 20 V50 C85 72 50 95 50 95 C50 95 15 72 15 50 V20 Z" fill="url(#bronzeGrad)" stroke="#F5B041" stroke-width="2.5" filter="url(#bronzeGlow)"/>
                <path d="M50 14 L75 26 V48 C75 65 50 82 50 82 C50 82 25 65 25 48 V26 Z" fill="url(#bronzeCore)" opacity="0.9" />
                <path d="M50 30 L65 50 L50 44 L35 50 Z" fill="#FFF" opacity="0.95"/>
                <path d="M50 44 L65 64 L50 58 L35 64 Z" fill="#FFF" opacity="0.75"/>
            </svg>`
        };
    }
    if (level < 20) {
        return {
            id: 'silver',
            name: 'Bạc (Silver)',
            color: '#C0C0C0',
            icon: 'ph-shield-check',
            svg: `<svg viewBox="0 0 100 100" class="rank-svg-emblem silver-emblem" aria-hidden="true">
                <defs>
                    <linearGradient id="silverGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#FFFFFF" />
                        <stop offset="50%" stop-color="#C0C0C0" />
                        <stop offset="100%" stop-color="#546E7A" />
                    </linearGradient>
                    <linearGradient id="silverGlint" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stop-color="#ECEFF1" />
                        <stop offset="50%" stop-color="#CFD8DC" />
                        <stop offset="100%" stop-color="#90A4AE" />
                    </linearGradient>
                    <filter id="silverGlow" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="4" result="blur" />
                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                </defs>
                <path d="M50 50 L10 20 L25 55 L50 65 Z" fill="url(#silverGrad)" opacity="0.85"/>
                <path d="M50 50 L90 20 L75 55 L50 65 Z" fill="url(#silverGrad)" opacity="0.85"/>
                <path d="M50 8 L80 30 L68 75 L50 92 L32 75 L20 30 Z" fill="url(#silverGlint)" stroke="#FFF" stroke-width="2" filter="url(#silverGlow)"/>
                <polygon points="50,22 57,40 76,40 61,52 66,70 50,58 34,70 39,52 24,40 43,40" fill="#FFF" />
            </svg>`
        };
    }
    if (level < 30) {
        return {
            id: 'gold',
            name: 'Vàng (Gold)',
            color: '#FFD700',
            icon: 'ph-shield-star',
            svg: `<svg viewBox="0 0 100 100" class="rank-svg-emblem gold-emblem" aria-hidden="true">
                <defs>
                    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#FFF59D" />
                        <stop offset="35%" stop-color="#FFD700" />
                        <stop offset="75%" stop-color="#FF8F00" />
                        <stop offset="100%" stop-color="#B76E00" />
                    </linearGradient>
                    <filter id="goldGlow" x="-30%" y="-30%" width="160%" height="160%">
                        <feGaussianBlur stdDeviation="5" result="blur" />
                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                </defs>
                <g class="gold-rays" opacity="0.7">
                    <circle cx="50" cy="50" r="42" fill="none" stroke="url(#goldGrad)" stroke-width="2" stroke-dasharray="4 6"/>
                    <circle cx="50" cy="50" r="46" fill="none" stroke="#FFD700" stroke-width="1" opacity="0.5"/>
                </g>
                <path d="M50 10 L82 25 V52 C82 72 50 90 50 90 C50 90 18 72 18 52 V25 Z" fill="url(#goldGrad)" stroke="#FFF" stroke-width="2.5" filter="url(#goldGlow)"/>
                <path d="M30 58 L30 38 L42 46 L50 32 L58 46 L70 38 L70 58 Z" fill="#FFF" opacity="0.95"/>
                <circle cx="50" cy="50" r="5" fill="#D32F2F" />
                <circle cx="36" cy="54" r="3" fill="#1976D2" />
                <circle cx="64" cy="54" r="3" fill="#1976D2" />
            </svg>`
        };
    }
    if (level < 40) {
        return {
            id: 'platinum',
            name: 'Bạch Kim (Platinum)',
            color: '#E5E4E2',
            icon: 'ph-crown-simple',
            svg: `<svg viewBox="0 0 100 100" class="rank-svg-emblem platinum-emblem" aria-hidden="true">
                <defs>
                    <linearGradient id="platGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#E0F7FA" />
                        <stop offset="40%" stop-color="#80DEEA" />
                        <stop offset="80%" stop-color="#B388FF" />
                        <stop offset="100%" stop-color="#4527A0" />
                    </linearGradient>
                    <filter id="platGlow" x="-30%" y="-30%" width="160%" height="160%">
                        <feGaussianBlur stdDeviation="6" result="blur" />
                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                </defs>
                <polygon points="50,4 92,50 50,96 8,50" fill="none" stroke="url(#platGrad)" stroke-width="2" class="plat-outer-ring"/>
                <path d="M50 14 L80 32 L68 70 L50 86 L32 70 L20 32 Z" fill="url(#platGrad)" stroke="#FFF" stroke-width="2" filter="url(#platGlow)"/>
                <polygon points="50,26 56,42 72,42 59,52 64,68 50,58 36,68 41,52 28,42 44,42" fill="#FFF" />
                <circle cx="50" cy="50" r="4" fill="#00E5FF" />
            </svg>`
        };
    }
    return {
        id: 'diamond',
        name: 'Kim Cương (Diamond)',
        color: '#B9F2FF',
        icon: 'ph-crown',
        svg: `<svg viewBox="0 0 100 100" class="rank-svg-emblem diamond-emblem" aria-hidden="true">
            <defs>
                <linearGradient id="diaGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#FFFFFF" />
                    <stop offset="30%" stop-color="#B9F2FF" />
                    <stop offset="65%" stop-color="#00E5FF" />
                    <stop offset="100%" stop-color="#7C4DFF" />
                </linearGradient>
                <linearGradient id="diaFacet" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="#E0F7FA" stop-opacity="0.9"/>
                    <stop offset="100%" stop-color="#00838F" stop-opacity="0.8"/>
                </linearGradient>
                <filter id="diaGlow" x="-40%" y="-40%" width="180%" height="180%">
                    <feGaussianBlur stdDeviation="7" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
            </defs>
            <ellipse cx="50" cy="50" rx="44" ry="18" fill="none" stroke="url(#diaGrad)" stroke-width="2" transform="rotate(-25 50 50)" class="diamond-orbit-ring-1"/>
            <ellipse cx="50" cy="50" rx="44" ry="18" fill="none" stroke="#00E5FF" stroke-width="1.5" transform="rotate(35 50 50)" opacity="0.7" class="diamond-orbit-ring-2"/>
            <g class="diamond-crystal" filter="url(#diaGlow)">
                <polygon points="50,12 30,32 70,32" fill="url(#diaGrad)"/>
                <polygon points="30,32 15,32 25,12 50,12" fill="#E0F7FA" opacity="0.9"/>
                <polygon points="70,32 85,32 75,12 50,12" fill="#B9F2FF" opacity="0.9"/>
                <polygon points="15,32 50,88 30,32" fill="url(#diaFacet)"/>
                <polygon points="85,32 50,88 70,32" fill="url(#diaFacet)"/>
                <polygon points="30,32 50,88 70,32" fill="url(#diaGrad)" opacity="0.95"/>
            </g>
            <polygon points="50,28 53,42 67,45 55,54 58,68 50,58 42,68 45,54 33,45 47,42" fill="#FFF" class="diamond-star-glint"/>
        </svg>`
    };
}


function renderBadges(unlockedBadges) {
    if (!DOM.achievementsList) return;
    DOM.achievementsList.innerHTML = '';
    
    const state = getState();
    const gamification = state.gamification || {};
    const userXP = gamification.userXP || 0;
    const maxStreak = Math.max(gamification.currentStreak || 0, gamification.longestStreak || 0);
    const totalReviews = gamification.totalReviews || 0;
    const masteredWords = state.vocabulary ? state.vocabulary.filter(w => !w.isDeleted && w.srsStatus === 'Mastered').length : 0;

    const metrics = {
        'xp': userXP,
        'streak': maxStreak,
        'review': totalReviews,
        'mastered': masteredWords
    };

    import('./badges.js').then(({ BADGE_TRACKS, SPECIAL_BADGES, getTier }) => {
        // --- 1. TÍNH TỔNG SỐ HUY HIỆU ĐÃ MỞ KHÓA ---
        let totalTrackLevelsUnlocked = 0;
        let totalTrackMilestones = 0;
        
        BADGE_TRACKS.forEach(track => {
            const currentValue = metrics[track.type] || 0;
            totalTrackMilestones += track.milestones.length;
            track.milestones.forEach(m => {
                if (currentValue >= m) totalTrackLevelsUnlocked++;
            });
        });

        const totalSpecialUnlocked = SPECIAL_BADGES.filter(b => unlockedBadges.includes(b.id)).length;
        const totalUnlocked = totalTrackLevelsUnlocked + totalSpecialUnlocked;
        const totalBadges = totalTrackMilestones + SPECIAL_BADGES.length;
        const overallPercent = Math.min(100, Math.round((totalUnlocked / (totalBadges || 1)) * 100));

        // --- 2. RENDER BANNER TIẾN ĐỘ THÀNH TỰU TỔNG ---
        const summaryBanner = document.createElement('div');
        summaryBanner.className = 'achievements-summary-banner';
        summaryBanner.innerHTML = `
            <div class="summary-header">
                <div class="summary-title-wrapper">
                    <i class="ph-fill ph-trophy summary-trophy-icon"></i>
                    <div>
                        <h4 class="summary-title">Tiến Độ Thành Tựu</h4>
                        <span class="summary-subtitle">${totalUnlocked} / ${totalBadges} Huy hiệu đã giải mã</span>
                    </div>
                </div>
                <div class="summary-percent-pill">${overallPercent}%</div>
            </div>
            <div class="summary-progress-bg">
                <div class="summary-progress-fill" style="width: ${overallPercent}%"></div>
            </div>
        `;
        DOM.achievementsList.appendChild(summaryBanner);

        // --- 3. RENDER BỘ LỌC TABS (FILTER TABS) ---
        const filterContainer = document.createElement('div');
        filterContainer.className = 'achievements-filter-tabs';
        filterContainer.innerHTML = `
            <button class="achieve-tab-btn active" data-filter="all"><i class="ph ph-squares-four"></i> Tất cả</button>
            <button class="achieve-tab-btn" data-filter="tracks"><i class="ph ph-chart-line-up"></i> Mốc Tiến Trình</button>
            <button class="achieve-tab-btn" data-filter="specials"><i class="ph ph-sparkle"></i> Bí Mật</button>
            <button class="achieve-tab-btn" data-filter="unlocked"><i class="ph ph-lock-key-open"></i> Đã Mở (${totalUnlocked})</button>
        `;
        DOM.achievementsList.appendChild(filterContainer);

        const badgeWrapperContainer = document.createElement('div');
        badgeWrapperContainer.className = 'achievements-wrapper';
        DOM.achievementsList.appendChild(badgeWrapperContainer);

        // --- 4. RENDER TRACK BADGES ---
        BADGE_TRACKS.forEach(track => {
            const currentValue = metrics[track.type] || 0;
            let level = 0;
            while (level < track.milestones.length && currentValue >= track.milestones[level]) {
                level++;
            }
            
            const maxLevel = track.milestones.length;
            const currentMilestone = level < maxLevel ? track.milestones[level] : track.milestones[maxLevel - 1];
            const currentName = level < maxLevel ? track.names[level] : track.names[maxLevel - 1];
            const currentIcon = level < maxLevel ? track.icons[level] : track.icons[maxLevel - 1];
            const tier = getTier(level, maxLevel);
            
            const prevMilestone = level === 0 ? 0 : track.milestones[level - 1];
            const rawProgress = level >= maxLevel ? 100 : ((currentValue - prevMilestone) / (currentMilestone - prevMilestone)) * 100;
            const progress = Math.max(0, Math.min(100, rawProgress));
            
            const trackEl = document.createElement('div');
            trackEl.className = `badge-track-item badge-item ${level > 0 ? 'unlocked' : 'locked'}`;
            trackEl.setAttribute('data-category', 'tracks');
            trackEl.setAttribute('data-unlocked', level > 0 ? 'true' : 'false');
            if (level > 0) {
                trackEl.setAttribute('data-tier', tier.id);
            }
            
            trackEl.innerHTML = `
                <div class="badge-card-header">
                    <div class="badge-title-block">
                        <div class="badge-icon-wrapper">
                            <div class="badge-icon"><i class="ph ${currentIcon}"></i></div>
                        </div>
                        <div class="badge-title-wrapper">
                            <h4>${currentName}</h4>
                            <p class="badge-desc-text">${track.descPrefix} ${currentMilestone.toLocaleString()} ${track.descSuffix}</p>
                        </div>
                    </div>
                    <span class="badge-level-pill tier-${tier.id}">${tier.name} • CẤP ${level}/${maxLevel}</span>
                </div>
                <div class="badge-card-body">
                    <div class="badge-progress-bg">
                        <div class="badge-progress-fill" style="width: ${progress}%"></div>
                    </div>
                    <div class="badge-progress-meta">
                        <span class="badge-progress-val">${currentValue.toLocaleString()} / ${currentMilestone.toLocaleString()}</span>
                        <span class="badge-progress-pct">${Math.round(progress)}%</span>
                    </div>
                </div>
            `;

            
            trackEl.addEventListener('click', () => {
                let detailsHtml = `<div style="text-align: left;">`;
                detailsHtml += `<h3 style="margin-bottom:15px; color:var(--text-color); font-size: 1.25rem;"><i class="ph ${currentIcon}"></i> Chuỗi Thành Tựu: ${track.names[track.names.length - 1]}</h3>`;
                detailsHtml += `<ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; max-height: 480px; overflow-y: auto;">`;
                
                track.milestones.forEach((m, idx) => {
                    const isUnlocked = currentValue >= m;
                    const icon = track.icons[idx];
                    const name = track.names[idx];
                    const color = isUnlocked ? '#FFD700' : 'var(--text-light)';
                    const opacity = isUnlocked ? '1' : '0.55';
                    
                    detailsHtml += `
                        <li style="display: flex; align-items: center; gap: 15px; padding: 14px; background: rgba(255,255,255,0.04); border: 1px solid ${isUnlocked ? 'rgba(255,215,0,0.4)' : 'rgba(255,255,255,0.08)'}; border-radius: 14px; opacity: ${opacity}; transition: transform 0.2s;">
                            <div style="width: 44px; height: 44px; border-radius: 12px; background: var(--card-bg); display: flex; align-items: center; justify-content: center; flex-shrink: 0; border: 2px solid ${isUnlocked ? '#FFD700' : 'var(--border-color)'}; box-shadow: ${isUnlocked ? '0 0 12px rgba(255,215,0,0.3)' : 'none'};">
                                <i class="ph ${icon}" style="font-size: 1.4rem; color: ${color};"></i>
                            </div>
                            <div style="flex: 1;">
                                <h4 style="margin: 0 0 4px 0; font-size: 1.05rem; color: var(--text-color); font-weight: 700;">${name}</h4>
                                <span style="font-size: 0.88rem; color: var(--text-light);">${track.descPrefix} ${m.toLocaleString()} ${track.descSuffix}</span>
                            </div>
                            ${isUnlocked ? '<i class="ph-fill ph-check-circle" style="color: #4CAF50; font-size: 1.6rem;"></i>' : '<i class="ph ph-lock" style="color: var(--text-light); font-size: 1.3rem;"></i>'}
                        </li>
                    `;
                });
                detailsHtml += `</ul></div>`;
                showPopup(detailsHtml, 'info', true);
            });

            badgeWrapperContainer.appendChild(trackEl);
        });

        // --- 5. RENDER SPECIAL BADGES ---
        if (SPECIAL_BADGES.length > 0) {
            const specialSection = document.createElement('div');
            specialSection.className = 'special-badges-section';
            specialSection.setAttribute('data-category', 'specials');

            const specialTitle = document.createElement('h3');
            specialTitle.className = 'special-badges-title';
            specialTitle.innerHTML = `<i class="ph-fill ph-sparkle"></i> Huy Hiệu Bí Mật & Đặc Biệt`;
            specialSection.appendChild(specialTitle);

            const specialContainer = document.createElement('div');
            specialContainer.className = 'special-badges-container';
            
            SPECIAL_BADGES.forEach(badge => {
                const isUnlocked = unlockedBadges.includes(badge.id);
                const badgeEl = document.createElement('div');
                badgeEl.className = `badge-item special-badge-item ${isUnlocked ? 'unlocked' : 'locked'}`;
                badgeEl.setAttribute('data-category', 'specials');
                badgeEl.setAttribute('data-unlocked', isUnlocked ? 'true' : 'false');
                badgeEl.setAttribute('data-type', badge.type);
                if (isUnlocked && badge.tier && badge.tier.id) {
                    badgeEl.setAttribute('data-tier', badge.tier.id);
                }
                
                const tierName = badge.tier ? badge.tier.name : 'Đặc biệt';
                const tierClass = badge.tier ? `tier-${badge.tier.id}` : '';

                badgeEl.innerHTML = `
                    ${isUnlocked ? `<span class="badge-tier-tag ${tierClass}">${tierName}</span>` : ''}
                    <div class="badge-icon-wrapper">
                        <div class="badge-icon">${isUnlocked ? `<i class="ph ${badge.icon}"></i>` : `<i class="ph ph-lock-key"></i>`}</div>
                    </div>
                    <div class="badge-info">
                        <h4>${isUnlocked ? badge.name : '???'}</h4>
                        <p>${isUnlocked ? badge.desc : 'Khám phá bí mật để mở khóa'}</p>
                    </div>
                `;

                badgeEl.addEventListener('click', () => {
                    let detailsHtml = `<div style="text-align: center; padding: 10px 5px;">`;
                    const color = isUnlocked ? (badge.tier ? badge.tier.color : '#FFD700') : 'var(--text-light)';
                    const opacity = isUnlocked ? '1' : '0.6';
                    
                    detailsHtml += `
                        <div style="position: relative; width: 90px; height: 90px; border-radius: 20px; background: linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02)); display: flex; align-items: center; justify-content: center; margin: 0 auto 18px auto; border: 2px solid ${color}; opacity: ${opacity}; box-shadow: ${isUnlocked ? `0 0 25px ${color}66` : 'none'};">
                            <i class="ph ${badge.icon}" style="font-size: 3rem; color: ${color}; filter: drop-shadow(0 2px 8px ${color});"></i>
                        </div>
                        <h3 style="margin-bottom:8px; color:var(--text-color); font-size: 1.35rem; font-weight: 800;">${badge.name}</h3>
                        ${isUnlocked && badge.tier ? `<span class="badge-tier-tag ${tierClass}" style="position:static; display:inline-block; margin-bottom:12px;">${badge.tier.name}</span>` : ''}
                        <p style="color: var(--text-light); line-height: 1.6; margin-bottom: 20px; font-size: 0.98rem; max-width: 360px; margin-left: auto; margin-right: auto;">${isUnlocked ? badge.desc : '<i>Danh hiệu bí ẩn! Hãy tiếp tục khám phá và học tập trên ứng dụng để mở khóa danh hiệu này.</i>'}</p>
                        <div style="padding: 10px 22px; background: rgba(255,255,255,0.05); border-radius: 12px; display: inline-block; border: 1px solid rgba(255,255,255,0.1);">
                            <strong style="color: var(--text-color); font-weight: 600;">Trạng thái: </strong> 
                            <span style="color: ${isUnlocked ? '#4CAF50' : '#FF9800'}; font-weight: 700;">${isUnlocked ? '✨ Đã giải mã thành công' : '🔒 Chưa mở khóa'}</span>
                        </div>
                    </div>`;
                    showPopup(detailsHtml, 'info', true);
                });

                specialContainer.appendChild(badgeEl);
            });
            specialSection.appendChild(specialContainer);
            badgeWrapperContainer.appendChild(specialSection);
        }

        // --- 6. XỬ LÝ LỌC TAB (TAB FILTER LOGIC) ---
        filterContainer.querySelectorAll('.achieve-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                filterContainer.querySelectorAll('.achieve-tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                const filter = btn.getAttribute('data-filter');
                const trackItems = badgeWrapperContainer.querySelectorAll('.badge-track-item');
                const specialSection = badgeWrapperContainer.querySelector('.special-badges-section');
                const specialItems = badgeWrapperContainer.querySelectorAll('.special-badge-item');

                if (filter === 'all') {
                    trackItems.forEach(item => item.style.display = 'flex');
                    if (specialSection) specialSection.style.display = 'block';
                    specialItems.forEach(item => item.style.display = 'flex');
                } else if (filter === 'tracks') {
                    trackItems.forEach(item => item.style.display = 'flex');
                    if (specialSection) specialSection.style.display = 'none';
                } else if (filter === 'specials') {
                    trackItems.forEach(item => item.style.display = 'none');
                    if (specialSection) specialSection.style.display = 'block';
                    specialItems.forEach(item => item.style.display = 'flex');
                } else if (filter === 'unlocked') {
                    trackItems.forEach(item => {
                        item.style.display = item.getAttribute('data-unlocked') === 'true' ? 'flex' : 'none';
                    });
                    if (specialSection) specialSection.style.display = 'block';
                    specialItems.forEach(item => {
                        item.style.display = item.getAttribute('data-unlocked') === 'true' ? 'flex' : 'none';
                    });
                }
            });
        });
    });
}


function renderHeatmap(activityHeatmap) {
    if (!DOM.activityHeatmap) return;
    DOM.activityHeatmap.innerHTML = ''; // Clear old

    const today = new Date();
    // Show 84 days (12 weeks x 7 days)
    const DAYS_TO_SHOW = 84;
    
    const entries = [];
    
    // We want the grid to fill column by column from left to right.
    // CSS Grid grid-auto-flow: column will fill top-to-bottom first, then left-to-right.
    // So the first cell should be 83 days ago.
    for (let i = DAYS_TO_SHOW - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const dateStr = getLocalDateString(d);
        const count = activityHeatmap[dateStr] || 0;
        entries.push({ dateStr, count, index: i });
    }
    
    // Find Top 3
    const sorted = [...entries].filter(e => e.count > 0).sort((a, b) => b.count - a.count);
    let top1 = -1, top2 = -1, top3 = -1;
    if (sorted.length > 0) top1 = sorted[0].count;
    if (sorted.length > 1 && sorted[1].count < top1) top2 = sorted[1].count;
    else if (sorted.length > 1) { /* handle tie, we just take distinct top values */
        const distinct = [...new Set(sorted.map(x => x.count))];
        if (distinct.length > 1) top2 = distinct[1];
        if (distinct.length > 2) top3 = distinct[2];
    }
    if (top3 === -1 && sorted.length > 2) {
        const distinct = [...new Set(sorted.map(x => x.count))];
        if (distinct.length > 2) top3 = distinct[2];
    }

    entries.forEach(entry => {
        const cell = document.createElement('div');
        cell.className = 'heatmap-cell';
        cell.title = `${entry.dateStr}: ${entry.count} lần học`;
        
        // Basic levels
        if (entry.count > 0 && entry.count < 10) cell.classList.add('level-1');
        else if (entry.count >= 10 && entry.count < 30) cell.classList.add('level-2');
        else if (entry.count >= 30 && entry.count < 60) cell.classList.add('level-3');
        else if (entry.count >= 60) cell.classList.add('level-4');
        
        // Apply Ranks if applicable
        if (entry.count > 0) {
            if (entry.count === top1) cell.classList.add('rank-1');
            else if (entry.count === top2) cell.classList.add('rank-2');
            else if (entry.count === top3) cell.classList.add('rank-3');
        }
        
        DOM.activityHeatmap.appendChild(cell);
    });
    
    // Gọi animation
    animateHeatmap(DOM.activityHeatmap);
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

    const avgCount = forecastData.reduce((a, b) => a + b, 0) / 7;
    const avgHeightPercent = maxCount > 0 ? (avgCount / maxCount) * 100 : 0;
    
    // Thêm đường trung bình (Average Line)
    const avgLine = document.createElement('div');
    avgLine.className = 'forecast-avg-line';
    avgLine.style.bottom = `calc(${avgHeightPercent}% + 22px)`; // Căn theo chữ dayLabel
    avgLine.title = `Trung bình: ${Math.round(avgCount)} từ/ngày`;
    DOM.forecastChart.appendChild(avgLine);

    forecastData.forEach((count, index) => {
        const barContainer = document.createElement('div');
        barContainer.className = 'forecast-bar-container';

        const bar = document.createElement('div');
        bar.className = 'forecast-bar';
        const heightPercent = (count / maxCount) * 100;
        bar.style.height = `${heightPercent}%`;
        if (count === 0) bar.style.height = '4px'; // Min height

        const dot = document.createElement('div');
        dot.className = 'forecast-dot';
        bar.appendChild(dot); // Chấm sáng trên đỉnh Bar

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

    // Gọi animation
    animateForecastChart(DOM.forecastChart);
}

// Logic kiểm tra Huy hiệu tự động
document.getElementById('app-container')?.addEventListener('gamification:update', () => {
    const state = getState();
    const gamification = state.gamification || {};
    const { userXP = 0, currentStreak = 0, totalReviews = 0, consecutiveCorrect = 0, speedsterAchieved = false } = gamification;
    const masteredCount = state.vocabulary ? state.vocabulary.filter(w => !w.isDeleted && w.srsStatus === 'Mastered').length : 0;
    
    import('./badges.js').then(({ BADGE_TRACKS, SPECIAL_BADGES }) => {
        // Unlock Track Badges
        BADGE_TRACKS.forEach(track => {
            let currentValue = 0;
            if (track.type === 'xp') currentValue = userXP;
            if (track.type === 'streak') currentValue = currentStreak;
            if (track.type === 'mastered') currentValue = masteredCount;
            if (track.type === 'review') currentValue = totalReviews;

            track.milestones.forEach((milestone, index) => {
                const badgeId = track.ids[index];
                if (currentValue >= milestone && !(gamification.unlockedBadges || []).includes(badgeId)) {
                    unlockBadge(badgeId);
                }
            });
        });

        // Unlock Special Badges
        SPECIAL_BADGES.forEach(badge => {
            if (gamification.unlockedBadges && gamification.unlockedBadges.includes(badge.id)) return;
            let shouldUnlock = false;
            const s = gamification.stats || {};
            const now = new Date();
            const hour = now.getHours();
            
            switch (badge.id) {
                // Group 1: Time
                case 'special_nightwalker': if (s.nightOwlWords >= 20) shouldUnlock = true; break;
                case 'special_earlybird': if (s.earlyBirdStreak >= 3) shouldUnlock = true; break;
                case 'special_vampire': if (s.vampireStreak >= 7) shouldUnlock = true; break;
                case 'special_hibernation': 
                    if (gamification.lastStudyDate) {
                        const daysSinceLast = Math.floor((now.getTime() - new Date(gamification.lastStudyDate).getTime()) / (1000 * 3600 * 24));
                        if (daysSinceLast >= 30) shouldUnlock = true;
                    }
                    break;
                case 'special_ascetic': 
                    const month = now.getMonth() + 1; const day = now.getDate();
                    if ((month === 12 && day === 25) || (month === 1 && day === 1) || (month === 2 && (day >= 1 && day <= 15))) shouldUnlock = true; // Approx Tet & Xmas
                    break;
                case 'special_fanatic': if (s.opensToday >= 10) shouldUnlock = true; break;
                case 'special_bookworm': if (s.totalTimeSpent >= 7200) shouldUnlock = true; break; // 2 hours
                case 'special_ghost': if (now.getDay() === 5 && now.getDate() === 13) shouldUnlock = true; break;
                case 'special_sunset_hunter': if (s.sunsetStreak >= 5) shouldUnlock = true; break;
                case 'special_time_lord': if (s.totalTimeSpent >= 360000) shouldUnlock = true; break; // 100 hours

                // Group 2: Speed & Acc
                case 'special_lightspeed': if (speedsterAchieved) shouldUnlock = true; break;
                case 'special_terminator': if (s.quizCorrectStreak >= 100) shouldUnlock = true; break;
                case 'special_goldfish': if (s.accidentCount >= 10) shouldUnlock = true; break; // Using accidentCount as a proxy for failing 10 times for now
                case 'special_telepath': if (s.perfectQuizStreak >= 1) shouldUnlock = true; break; // Simplified
                case 'special_turtle': if (s.totalTimeSpent >= 1800 && totalReviews <= 10) shouldUnlock = true; break;
                case 'special_immortal': if (s.perfectQuizStreak >= 10) shouldUnlock = true; break;
                case 'special_stubborn': if (s.hardPresses >= 5) shouldUnlock = true; break; // Simplified proxy
                case 'special_peak_form': if (s.monthlyCorrect >= 49 && s.monthlyTotal === 50) shouldUnlock = true; break; // Simplified proxy
                case 'special_sniper': if (s.monthlyTotal >= 100 && (s.monthlyCorrect / s.monthlyTotal) >= 0.99) shouldUnlock = true; break;
                case 'special_eidetic': if (s.monthlyTotal >= 100 && (s.monthlyCorrect / s.monthlyTotal) >= 0.95) shouldUnlock = true; break;

                // Group 3: Interactions
                case 'special_sewing_machine': if (s.easyPresses >= 50) shouldUnlock = true; break;
                case 'special_sledgehammer': if (s.hardPresses >= 20) shouldUnlock = true; break;
                case 'special_stalker': if (s.profileViews >= 50) shouldUnlock = true; break;
                case 'special_scanner': if (s.imports >= 1000) shouldUnlock = true; break;
                case 'special_archivist': if (s.exports >= 1) shouldUnlock = true; break;
                case 'special_incognito': if (s.darkModeDays >= 7) shouldUnlock = true; break;
                case 'special_watcher': if (s.profileViews >= 1) shouldUnlock = true; break; // Proxy for viewing heatmap
                case 'special_debugger': if (s.accidentCount >= 5) shouldUnlock = true; break; // Proxy
                case 'special_chef': 
                    const uniqueTags = new Set(state.vocabulary ? state.vocabulary.filter(w => !w.isDeleted).flatMap(w => w.tags || []) : []);
                    if (uniqueTags.size >= 20) shouldUnlock = true; 
                    break;
                case 'special_genesis': if (s.manualWordsAdded >= 1) shouldUnlock = true; break;

                // Group 4: Grinding
                case 'special_hurricane': if (s.wordsAddedToday >= 100) shouldUnlock = true; break;
                case 'special_bounty_hunter': if (s.xpToday >= 5000) shouldUnlock = true; break;
                case 'special_healer': if (s.leechesHealed >= 50) shouldUnlock = true; break;
                case 'special_love_at_first_sight': 
                    const perfectWords = state.vocabulary ? state.vocabulary.filter(w => !w.isDeleted && w.srsStatus === 'Mastered' && (w.lapses || 0) === 0).length : 0;
                    if (perfectWords >= 10) shouldUnlock = true;
                    break;
                case 'special_return_of_the_king': if (s.maxLostStreak >= 50 && currentStreak >= 10) shouldUnlock = true; break;
                case 'special_dark_horse': 
                    const daysSinceCreation = Math.floor((now.getTime() - (s.accountCreatedDate || now.getTime())) / (1000 * 3600 * 24));
                    if (gamification.currentLevel >= 10 && daysSinceCreation <= 3) shouldUnlock = true;
                    break;
                case 'special_invincible': 
                    const daysSinceForgotten = Math.floor((now.getTime() - (s.lastForgottenDate || now.getTime())) / (1000 * 3600 * 24));
                    if (daysSinceForgotten >= 30) shouldUnlock = true;
                    break;
                case 'special_nirvana': 
                    const totalWords = state.vocabulary ? state.vocabulary.length : 0;
                    if (totalWords >= 500 && (masteredCount / totalWords) >= 0.9) shouldUnlock = true;
                    break;
                case 'special_grandmaster': if (currentStreak >= 365) shouldUnlock = true; break;
                case 'special_ascension': if (gamification.currentLevel >= 50) shouldUnlock = true; break;

                // Group 5: Humor
                case 'special_bad_luck': if (hour === 0 && now.getMinutes() === 0) shouldUnlock = true; break; // Proxy for checking late finish
                case 'special_firefighter': if (s.overdueReviewedToday >= 100) shouldUnlock = true; break;
                case 'special_procrastinator': if (s.bareMinimumDays >= 10) shouldUnlock = true; break;
                case 'special_give_up': if (s.manualWordsAdded >= 1 && s.leechesHealed === -1) shouldUnlock = true; break; // Using arbitrary logic
                case 'special_slip_up': if (s.maxLostStreak >= 99) shouldUnlock = true; break;
                case 'special_five_elements': if (s.easyPresses >= 5 && s.hardPresses >= 5) shouldUnlock = true; break; // Proxy
                case 'special_accident': if (s.accidentCount >= 1) shouldUnlock = true; break;
                case 'special_brain_fog': if (s.accidentCount >= 2) shouldUnlock = true; break;
                case 'special_gru': if (now.getMonth() === 8 || now.getMonth() === 9) shouldUnlock = true; break; // Mid-autumn approximate
                case 'special_loyal_pet': 
                    const yearsSinceCreation = (now.getTime() - (s.accountCreatedDate || now.getTime())) / (1000 * 3600 * 24 * 365);
                    if (yearsSinceCreation >= 1) shouldUnlock = true;
                    break;
                    
                // Group 6: Typing
                case 'special_keyboard_on_fire': if (s.typingPerfectQuizzes >= 1) shouldUnlock = true; break;
                case 'special_blind_typer': if (s.typingTypoStreaks >= 1) shouldUnlock = true; break;
                case 'special_fast_fingers': if (s.typingFastAnswers >= 1) shouldUnlock = true; break;
                case 'special_shadow_hands': if (s.typingNoHintStreak >= 20) shouldUnlock = true; break;
                case 'special_typewriter': if (s.typingTotalCorrect >= 1000) shouldUnlock = true; break;
                case 'special_typo_king': if (s.typingLastCharTypo >= 1) shouldUnlock = true; break;
                case 'special_impossible_typo': if (s.typingShortWordTypo >= 1) shouldUnlock = true; break;
                case 'special_extreme_patience': if (s.typingClearedInput >= 1) shouldUnlock = true; break;
                case 'special_copy_punishment': if (s.typingLeechRepeats >= 10) shouldUnlock = true; break;
                case 'special_hate_typing': if (s.typingImmediateExit >= 1) shouldUnlock = true; break;

                // Group 7: UI/UX
                case 'special_ocd': if (s.syncSpamCount >= 10) shouldUnlock = true; break;
                case 'special_stargazer': if (hour === 0 && now.getMinutes() === 0 && document.body.classList.contains('dark-mode')) shouldUnlock = true; break;
                case 'special_eclipse': if ((document.body.classList.contains('dark-mode') && state.soundMode === 'off') || (s.eclipse && s.eclipse >= 1)) shouldUnlock = true; break;
                case 'special_magic_hands': if (s.cardFlipSpam >= 20) shouldUnlock = true; break;
                case 'special_black_hole': if (s.consecutiveDeletes >= 10) shouldUnlock = true; break;
                case 'special_tag_master': 
                    const uniqueTags3 = new Set(state.vocabulary ? state.vocabulary.filter(w => !w.isDeleted).flatMap(w => w.tags || []) : []);
                    if (uniqueTags3.size >= 20) shouldUnlock = true; 
                    break;
                case 'special_lazy_scroll': if (s.consecutiveShortcuts >= 100) shouldUnlock = true; break;
                case 'special_mesmerized': if (s.taskbarToggles >= 5) shouldUnlock = true; break;
                case 'special_speaker_test': if (s.audioSpam >= 10) shouldUnlock = true; break;
                case 'special_rollercoaster': if (s.filterToggles >= 5) shouldUnlock = true; break;

                // Group 8: Bizarre
                case 'special_phoenix': if (s.xpToday >= 2000 && currentStreak === 1 && s.maxLostStreak > 0) shouldUnlock = true; break;
                case 'special_mutant': if (s.xpToday > (s.xpLastWeek || 0) && (s.xpLastWeek || 0) > 100) shouldUnlock = true; break;
                case 'special_mountain_hopper': if (s.topicHopping >= 1) shouldUnlock = true; break;
                case 'special_celestial_smith': 
                    const maxReviews = state.vocabulary && state.vocabulary.length > 0 ? Math.max(...state.vocabulary.filter(w => !w.isDeleted).map(w => w.reps || 0)) : 0;
                    if (maxReviews >= 50) shouldUnlock = true; 
                    break;
                case 'special_untouchable': if (s.consecutiveEasy >= 100) shouldUnlock = true; break;
                case 'special_blind_faith': if (s.quizZeroScore >= 1) shouldUnlock = true; break;
                case 'special_fusion': if (totalReviews >= 1000) shouldUnlock = true; break;
                case 'special_golden_hour': if ((hour === 17 || hour === 18) && s.justLeveledUp) shouldUnlock = true; break;
                case 'special_karma': if (s.karmaEncounter >= 1) shouldUnlock = true; break;
                case 'special_king_returns': if (s.kingReturns >= 1) shouldUnlock = true; break;
            }

            if (shouldUnlock) unlockBadge(badge.id);
        });
    });
});

// Hiệu ứng Floating XP — CSS-only, không dùng anime.js để tránh xung đột layout
document.getElementById('app-container')?.addEventListener('gamification:xp_added', (e) => {
    const amount = e.detail?.amount;
    const text = e.detail?.text;
    if (!amount) return;

    const floatEl = document.createElement('div');
    floatEl.className = 'floating-xp';
    floatEl.textContent = text ? text : `+${amount} XP`;
    
    if (text && text.includes('Combo')) {
        floatEl.style.color = 'var(--primary-color)';
        floatEl.style.fontWeight = 'bold';
        floatEl.style.textShadow = '0 0 10px var(--primary-color-alpha)';
    }

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

// Debug / Test Utils for Gamification (SAFE - không lưu, không sync Firebase)
window.__testGamification = {
    _backup: null,
    
    triggerEvent: function(eventName, amount = 1) {
        import('../core/state.js').then(s => {
            s.trackEvent(eventName, amount);
            console.log(`Triggered ${eventName} +${amount}`);
        });
    },

    /**
     * XEM TRƯỚC tất cả huy hiệu - CHỈ THAY ĐỔI TRÊN MÀN HÌNH, KHÔNG LƯU.
     * Dữ liệu giả chỉ tồn tại trong RAM. Refresh trang = mất hết = an toàn.
     * Firebase KHÔNG bị ảnh hưởng.
     */
    previewAllBadges: function() {
        import('../core/state.js').then(s => {
            s.setPreviewMode(true);
            const state = s.getState();
            
            // 1. Sao lưu state gốc (deep clone)
            this._backup = JSON.parse(JSON.stringify(state.gamification));
            
            // 2. Bơm dữ liệu giả vào RAM (KHÔNG gọi saveGamification)
            if (!state.gamification.stats) state.gamification.stats = {};
            const st = state.gamification.stats;
            st.nightOwlWords = 20;
            st.earlyBirdStreak = 3;
            st.vampireStreak = 7;
            st.opensToday = 10;
            st.totalTimeSpent = 400000;
            st.sunsetStreak = 5;
            st.quizCorrectStreak = 100;
            st.accidentCount = 10;
            st.perfectQuizStreak = 10;
            st.monthlyTotal = 100;
            st.monthlyCorrect = 100;
            st.easyPresses = 50;
            st.hardPresses = 20;
            st.profileViews = 50;
            st.imports = 1000;
            st.exports = 1;
            st.darkModeDays = 7;
            st.manualWordsAdded = 1;
            st.wordsAddedToday = 100;
            st.xpToday = 5000;
            st.leechesHealed = 50;
            st.maxLostStreak = 99;
            st.lastForgottenDate = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString();
            st.overdueReviewedToday = 100;
            st.bareMinimumDays = 10;
            st.accountCreatedDate = new Date(Date.now() - 366 * 24 * 3600 * 1000).getTime();
            
            // Stats for New 30 Badges
            st.typingPerfectQuizzes = 1;
            st.typingTypoStreaks = 1;
            st.typingFastAnswers = 1;
            st.typingNoHintStreak = 20;
            st.typingTotalCorrect = 1000;
            st.typingLastCharTypo = 1;
            st.typingShortWordTypo = 1;
            st.typingClearedInput = 1;
            st.typingLeechRepeats = 10;
            st.typingImmediateExit = 1;
            
            st.syncSpamCount = 10;
            st.cardFlipSpam = 20;
            st.consecutiveDeletes = 10;
            st.consecutiveShortcuts = 100;
            st.taskbarToggles = 5;
            st.audioSpam = 10;
            st.filterToggles = 5;
            
            st.xpLastWeek = 101;
            st.topicHopping = 1;
            st.consecutiveEasy = 100;
            st.quizZeroScore = 1;
            st.justLeveledUp = true;
            st.karmaEncounter = 1;
            st.kingReturns = 1;

            // 3. Tạm thêm tất cả special badge IDs vào unlockedBadges (chỉ trong RAM)
            import('../features/badges.js').then(({ SPECIAL_BADGES }) => {
                if (!state.gamification.unlockedBadges) state.gamification.unlockedBadges = [];
                SPECIAL_BADGES.forEach(b => {
                    if (!state.gamification.unlockedBadges.includes(b.id)) {
                        state.gamification.unlockedBadges.push(b.id);
                    }
                });
                
                // 4. Chỉ render lại UI, KHÔNG lưu
                document.getElementById('app-container')?.dispatchEvent(new CustomEvent('gamification:update'));
                
                console.log('%c✅ PREVIEW MODE: Tất cả 50 huy hiệu đang hiển thị trên màn hình.', 'color: #4CAF50; font-weight: bold; font-size: 14px;');
                console.log('%c⚠️ Dữ liệu CHỈ NẰM TRONG RAM. Refresh trang (F5) sẽ trở về bình thường.', 'color: #FF9800; font-weight: bold;');
                console.log('%c🔒 Firebase KHÔNG bị ảnh hưởng.', 'color: #2196F3; font-weight: bold;');
                console.log('Gọi window.__testGamification.reset() để khôi phục ngay mà không cần F5.');
            });
        });
    },

    /**
     * XEM TRƯỚC một bậc Rank bất kỳ (chỉ thay đổi UI/RAM tạm thời, không lưu IndexedDB/Firebase).
     * @param {number} level - Cấp độ muốn test (vd: 5 = Đồng, 15 = Bạc, 25 = Vàng, 35 = Bạch Kim, 50 = Kim Cương)
     */
    previewRank: function(level = 50) {
        import('../core/state.js').then(s => {
            s.setPreviewMode(true);
            const state = s.getState();
            if (!this._backup) {
                this._backup = JSON.parse(JSON.stringify(state.gamification));
            }
            state.gamification.currentLevel = level;
            state.gamification.userXP = Math.pow(level - 1, 2) * 100 + 500;
            document.getElementById('app-container')?.dispatchEvent(new CustomEvent('gamification:update'));
            console.log(`%c✨ PREVIEW RANK LEVEL ${level}: Dữ liệu chỉ nằm trong RAM. F5 hoặc gọi window.__testGamification.reset() để khôi phục.`, 'color: #4CAF50; font-weight: bold;');
        });
    },

    /**
     * TỰ ĐỘNG CHẠY SLIDESHOW qua tất cả 5 Bậc Rank (Đồng -> Bạc -> Vàng -> Bạch Kim -> Kim Cương) mỗi 2.5s.
     */
    previewAllRanks: function() {
        const demoLevels = [5, 15, 25, 35, 50];
        let idx = 0;
        console.log('%c🎬 Bắt đầu chạy Demo xoay vòng 5 Bậc Rank... Gọi window.__testGamification.reset() hoặc F5 để dừng.', 'color: #2196F3; font-weight: bold;');
        
        if (this._rankTimer) clearInterval(this._rankTimer);
        this.previewRank(demoLevels[0]);
        
        this._rankTimer = setInterval(() => {
            idx = (idx + 1) % demoLevels.length;
            this.previewRank(demoLevels[idx]);
        }, 2500);
    },

    /**
     * Khôi phục dữ liệu gốc (trước khi preview).
     */
    reset: function() {
        if (this._rankTimer) {
            clearInterval(this._rankTimer);
            this._rankTimer = null;
        }
        if (!this._backup) {
            console.log('%c⚠️ Không có gì để khôi phục. Bạn chưa chạy preview.', 'color: #FF9800;');
            return;
        }
        import('../core/state.js').then(s => {
            s.setPreviewMode(false);
            s.setGamification(this._backup);
            this._backup = null;
            
            // Render lại UI với dữ liệu gốc
            document.getElementById('app-container')?.dispatchEvent(new CustomEvent('gamification:update'));
            
            console.log('%c✅ Đã khôi phục dữ liệu gốc thành công!', 'color: #4CAF50; font-weight: bold; font-size: 14px;');
        });
    }
};

