/**
 * Quy tắc mở HUY HIỆU — tách khỏi gamification.js để test được.
 *
 * Vì sao tách: đây là khối rẽ nhánh dày nhất của app (≈70 nhánh huy hiệu đặc
 * biệt + 4 track), trước nằm trong một listener DOM của gamification.js nên
 * coverage đo được chỉ 11% và không thể kiểm thử nếu không dựng cả app. Sau khi
 * tách, logic là hàm THUẦN: đầu vào là ảnh chụp state, đầu ra là danh sách id
 * huy hiệu cần mở — không DOM, không thời gian thực (nhận `now` từ tham số).
 *
 * Hợp đồng quan trọng:
 *   • Hàm KHÔNG tự ghi state và KHÔNG phát âm thanh — người gọi quyết định.
 *   • Chỉ trả về id CHƯA có trong `unlockedBadges` (không trả trùng).
 *   • `stats` thiếu trường ⇒ coi như 0/false, không ném lỗi.
 */

/** Giá trị hiện tại của một track huy hiệu (xp / streak / mastered / review). */
export function badgeTrackValue(type, snapshot) {
    switch (type) {
        case 'xp': return snapshot.userXP || 0;
        case 'streak': return snapshot.currentStreak || 0;
        case 'mastered': return snapshot.masteredCount || 0;
        case 'review': return snapshot.totalReviews || 0;
        default: return 0;
    }
}

/** Danh sách id huy hiệu TRACK đã đạt mốc mà người dùng chưa mở. */
export function unlockedTrackBadgeIds(tracks, snapshot) {
    const unlocked = new Set(snapshot.unlockedBadges || []);
    const ids = [];
    for (const track of Array.isArray(tracks) ? tracks : []) {
        const value = badgeTrackValue(track?.type, snapshot);
        const milestones = Array.isArray(track?.milestones) ? track.milestones : [];
        const badgeIds = Array.isArray(track?.ids) ? track.ids : [];
        milestones.forEach((milestone, index) => {
            const badgeId = badgeIds[index];
            if (!badgeId || unlocked.has(badgeId)) return;
            if (value >= milestone) ids.push(badgeId);
        });
    }
    return ids;
}

/**
 * Một huy hiệu ĐẶC BIỆT có thoả điều kiện mở hay không.
 * @param {string} badgeId
 * @param {object} snapshot ảnh chụp state (xem tests/badge-rules.test.mjs)
 * @param {Date} [now] thời điểm xét — bơm vào để test tất định
 */
export function specialBadgeUnlocked(badgeId, snapshot, now = new Date()) {
    const gamification = snapshot.gamification || {};
    const s = gamification.stats || {};
    const vocabulary = snapshot.vocabulary;
    const masteredCount = snapshot.masteredCount || 0;
    const totalReviews = snapshot.totalReviews || 0;
    const currentStreak = snapshot.currentStreak || 0;
    const speedsterAchieved = snapshot.speedsterAchieved || false;
    const isDarkMode = snapshot.isDarkMode || false;
    const soundMode = snapshot.soundMode;
    const hour = now.getHours();
    let shouldUnlock = false;

                switch (badgeId) {
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
                    case 'special_ascetic': {
                        const month = now.getMonth() + 1; const day = now.getDate();
                        if ((month === 12 && day === 25) || (month === 1 && day === 1) || (month === 2 && (day >= 1 && day <= 15))) shouldUnlock = true; // Approx Tet & Xmas
                        break;
                    }
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
                    case 'special_chef': {
                        const uniqueTags = new Set(vocabulary ? vocabulary.filter(w => !w.isDeleted).flatMap(w => w.tags || []) : []);
                        if (uniqueTags.size >= 20) shouldUnlock = true; 
                        break;
                    }
                    case 'special_genesis': if (s.manualWordsAdded >= 1) shouldUnlock = true; break;
    
                    // Group 4: Grinding
                    case 'special_hurricane': if (s.wordsAddedToday >= 100) shouldUnlock = true; break;
                    case 'special_bounty_hunter': if (s.xpToday >= 5000) shouldUnlock = true; break;
                    case 'special_healer': if (s.leechesHealed >= 50) shouldUnlock = true; break;
                    case 'special_love_at_first_sight': {
                        const perfectWords = vocabulary ? vocabulary.filter(w => !w.isDeleted && w.srsStatus === 'Mastered' && (w.lapses || 0) === 0).length : 0;
                        if (perfectWords >= 10) shouldUnlock = true;
                        break;
                    }
                    case 'special_return_of_the_king': if (s.maxLostStreak >= 50 && currentStreak >= 10) shouldUnlock = true; break;
                    case 'special_dark_horse': {
                        const daysSinceCreation = Math.floor((now.getTime() - (s.accountCreatedDate || now.getTime())) / (1000 * 3600 * 24));
                        if (gamification.currentLevel >= 10 && daysSinceCreation <= 3) shouldUnlock = true;
                        break;
                    }
                    case 'special_invincible': {
                        // GAME-01: bản cũ mở MIỄN PHÍ sau 30 ngày kể từ ngày tạo hồ sơ vì
                        // lastForgottenDate khởi tạo bằng Date.now() và không bao giờ cập nhật.
                        // Giờ mốc này được ghi mỗi lần bấm Quên, và huy hiệu đòi có lần quên thật.
                        const forgottenAt = Number(s.lastForgottenDate) || 0;
                        const daysSinceForgotten = Math.floor((now.getTime() - forgottenAt) / (1000 * 3600 * 24));
                        if (forgottenAt > 0 && daysSinceForgotten >= 30) shouldUnlock = true;
                        break;
                    }
                    case 'special_nirvana': {
                        // GAME-01: mẫu số phải là thẻ SỐNG — bản cũ đếm cả thẻ đã xoá nên
                        // xoá bớt từ lại làm tỉ lệ tụt và huy hiệu không bao giờ mở.
                        const totalWords = vocabulary ? vocabulary.filter(w => !w.isDeleted).length : 0;
                        if (totalWords >= 500 && (masteredCount / totalWords) >= 0.9) shouldUnlock = true;
                        break;
                    }
                    case 'special_grandmaster': if (currentStreak >= 365) shouldUnlock = true; break;
                    case 'special_ascension': if (gamification.currentLevel >= 50) shouldUnlock = true; break;
    
                    // Group 5: Humor
                    case 'special_bad_luck': if (hour === 0 && now.getMinutes() === 0) shouldUnlock = true; break; // Proxy for checking late finish
                    case 'special_firefighter': if (s.overdueReviewedToday >= 100) shouldUnlock = true; break;
                    case 'special_procrastinator': if (s.bareMinimumDays >= 10) shouldUnlock = true; break;
                    // GAME-01: điều kiện cũ (leechesHealed === -1) là VÔ NGHIỆM nên huy hiệu
                    // chết 100%. "Bỏ cuộc" = tạo một từ rồi xoá nó trong vòng 60 giây.
                    case 'special_give_up': if ((s.giveUpCount || 0) >= 1) shouldUnlock = true; break;
                    case 'special_slip_up': if (s.maxLostStreak >= 99) shouldUnlock = true; break;
                    case 'special_five_elements': if (s.easyPresses >= 5 && s.hardPresses >= 5) shouldUnlock = true; break; // Proxy
                    case 'special_accident': if (s.accidentCount >= 1) shouldUnlock = true; break;
                    case 'special_brain_fog': if (s.accidentCount >= 2) shouldUnlock = true; break;
                    case 'special_gru': if (now.getMonth() === 8 || now.getMonth() === 9) shouldUnlock = true; break; // Mid-autumn approximate
                    case 'special_loyal_pet': {
                        const yearsSinceCreation = (now.getTime() - (s.accountCreatedDate || now.getTime())) / (1000 * 3600 * 24 * 365);
                        if (yearsSinceCreation >= 1) shouldUnlock = true;
                        break;
                    }
                        
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
                    case 'special_stargazer': if (hour === 0 && now.getMinutes() === 0 && isDarkMode) shouldUnlock = true; break;
                    case 'special_eclipse': if ((isDarkMode && soundMode === 'off') || (s.eclipse && s.eclipse >= 1)) shouldUnlock = true; break;
                    case 'special_magic_hands': if (s.cardFlipSpam >= 20) shouldUnlock = true; break;
                    case 'special_black_hole': if (s.consecutiveDeletes >= 10) shouldUnlock = true; break;
                    case 'special_tag_master': {
                        // GAME-01: bản cũ TRÙNG HOÀN TOÀN với special_chef (cùng >= 20 nhãn) nên hai
                        // huy hiệu luôn mở cùng lúc. Chuyên Gia Phân Loại phải là người gắn nhãn cho
                        // số lượng lớn thẻ, không chỉ tạo ra nhiều nhãn.
                        const live = vocabulary ? vocabulary.filter(w => !w.isDeleted) : [];
                        const uniqueTags3 = new Set(live.flatMap(w => w.tags || []));
                        const taggedCards = live.filter(w => (w.tags || []).length > 0).length;
                        if (uniqueTags3.size >= 20 && taggedCards >= 200) shouldUnlock = true;
                        break;
                    }
                    case 'special_lazy_scroll': if (s.consecutiveShortcuts >= 100) shouldUnlock = true; break;
                    case 'special_mesmerized': if (s.taskbarToggles >= 5) shouldUnlock = true; break;
                    case 'special_speaker_test': if (s.audioSpam >= 10) shouldUnlock = true; break;
                    case 'special_rollercoaster': if (s.filterToggles >= 5) shouldUnlock = true; break;
    
                    // Group 8: Bizarre
                    case 'special_phoenix': if (s.xpToday >= 2000 && currentStreak === 1 && s.maxLostStreak > 0) shouldUnlock = true; break;
                    case 'special_mutant': if (s.xpToday > (s.xpLastWeek || 0) && (s.xpLastWeek || 0) > 100) shouldUnlock = true; break;
                    case 'special_mountain_hopper': if (s.topicHopping >= 1) shouldUnlock = true; break;
                    case 'special_celestial_smith': {
                        const maxReviews = vocabulary && vocabulary.length > 0 ? Math.max(...vocabulary.filter(w => !w.isDeleted).map(w => w.reps || 0)) : 0;
                        if (maxReviews >= 50) shouldUnlock = true; 
                        break;
                    }
                    case 'special_untouchable': if (s.consecutiveEasy >= 100) shouldUnlock = true; break;
                    case 'special_blind_faith': if (s.quizZeroScore >= 1) shouldUnlock = true; break;
                    case 'special_fusion': if (totalReviews >= 1000) shouldUnlock = true; break;
                    case 'special_golden_hour': {
                        // GAME-01: kiểm tra giờ của LÚC LÊN CẤP (cùng ngày) thay vì giờ hiện tại —
                        // bản cũ chỉ mở nếu tình cờ kiểm tra badge đúng 17–18h.
                        const leveledAt = Number(s.justLeveledUp) || 0;
                        if (leveledAt > 0) {
                            const at = new Date(leveledAt);
                            const sameDay = at.toDateString() === now.toDateString();
                            const h = at.getHours();
                            if (sameDay && (h === 17 || h === 18)) shouldUnlock = true;
                        }
                        break;
                    }
                    case 'special_karma': if (s.karmaEncounter >= 1) shouldUnlock = true; break;
                    case 'special_king_returns': if (s.kingReturns >= 1) shouldUnlock = true; break;
                }

    return shouldUnlock;
}

/** Danh sách id huy hiệu ĐẶC BIỆT cần mở (đã loại cái đã có). */
export function unlockedSpecialBadgeIds(badges, snapshot, now = new Date()) {
    const unlocked = new Set(snapshot.unlockedBadges || []);
    const ids = [];
    for (const badge of Array.isArray(badges) ? badges : []) {
        if (!badge?.id || unlocked.has(badge.id)) continue;
        if (specialBadgeUnlocked(badge.id, snapshot, now)) ids.push(badge.id);
    }
    return ids;
}
