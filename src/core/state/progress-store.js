// src/core/state/progress-store.js — T4.5b: HAI object tiến độ gốc của app.
//
// Đây là "nguồn sự thật" duy nhất cho gamification + dailyStats. Chúng là live
// binding (export let) nên mọi nơi đọc/ghi thuộc tính đều dùng ĐÚNG biến đó sau
// khi Rollup gộp chunk — không tốn byte getter, không đổi hành vi.
// Chỉ nơi GÁN LẠI cả object (acceptProgress, loadVocabulary, setGamification)
// mới phải đi qua setter, vì ESM không cho module khác gán vào binding.
//
// Nội dung default giữ NGUYÊN 100% bản cũ trong state.js — đây là shape được
// ghi xuống IndexedDB/Firestore, đổi một field là đổi dữ liệu người dùng.
import { getLocalDateString } from '../utils/date.js';

export let dailyStats = {
    newCardsDoneToday: 0,
    dueDoneToday: 0,
    learningDoneToday: 0,
    retentionHistory: [],
    lastDate: getLocalDateString()
};

export let gamification = {
    userXP: 0,
    currentLevel: 1,
    currentStreak: 0,
    lastStudyDate: "",
    activityHeatmap: {},
    unlockedBadges: [],
    totalReviews: 0,
    streakFreezeCount: 0,
    lastStreakFreezeDate: "",
    frozenDates: [],
    recoveredDates: [],
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

export function setGamification(data) { gamification = data; }
export function setDailyStats(data) { dailyStats = data; }
