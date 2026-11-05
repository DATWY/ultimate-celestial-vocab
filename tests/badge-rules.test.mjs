// tests/badge-rules.test.mjs — khoá toàn bộ quy tắc mở huy hiệu.
//
// Bối cảnh: 80 huy hiệu đặc biệt + 4 track (100 mốc) từng nằm trong một listener
// DOM của gamification.js, coverage đo được 11% và không thể kiểm thử nếu không
// dựng cả app. Nay quy tắc là hàm THUẦN ở src/features/badge-rules.js; file này
// chạm từng nhánh để một lần sửa ngưỡng (hoặc thêm huy hiệu mà quên xử lý) là
// đỏ ngay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BADGE_TRACKS, SPECIAL_BADGES } from '../src/features/badges.js';
import {
    badgeTrackValue,
    unlockedTrackBadgeIds,
    specialBadgeUnlocked,
    unlockedSpecialBadgeIds
} from '../src/features/badge-rules.js';

// 10:30 sáng một ngày thường (10/03/2026): không rơi vào mốc thời gian nào
// (không phải 00:00, không 17–18h, tháng 3 không phải Trung thu, ngày 10 không
// phải thứ Sáu ngày 13) nên mọi huy hiệu thời gian phải TẮT.
const NEUTRAL_NOW = new Date(2026, 2, 10, 10, 30);
const DAY = 86400000;

const baseSnapshot = () => ({
    userXP: 0,
    currentStreak: 0,
    totalReviews: 0,
    masteredCount: 0,
    speedsterAchieved: false,
    gamification: { stats: {}, currentLevel: 0 },
    vocabulary: [],
    unlockedBadges: [],
    isDarkMode: false,
    soundMode: 'all'
});

/** Snapshot từ chỗi ghi đè phẳng: { stats: {...}, currentStreak: 10, ... } */
const snap = (overrides = {}) => {
    const base = baseSnapshot();
    const { stats = {}, gamification = {}, ...rest } = overrides;
    return {
        ...base,
        ...rest,
        gamification: { ...base.gamification, ...gamification, stats: { ...base.gamification.stats, ...stats } }
    };
};

const cards = (count, extra = () => ({})) =>
    Array.from({ length: count }, (_, i) => ({ id: 'c' + i, english: 'w' + i, isDeleted: false, ...extra(i) }));

// ─── 1. Bất biến: state rỗng thì KHÔNG mở gì ───────────────────────────────
test('state rỗng + thời điểm trung tính ⇒ không mở huy hiệu nào', () => {
    assert.deepEqual(unlockedSpecialBadgeIds(SPECIAL_BADGES, baseSnapshot(), NEUTRAL_NOW), []);
    assert.deepEqual(unlockedTrackBadgeIds(BADGE_TRACKS, baseSnapshot()), []);
});

test('mọi id đặc biệt đều được xử lý (không có nhánh chết/thiếu case)', () => {
    // Mỗi id phải trả boolean, không undefined — nếu ai thêm badge mới vào
    // danh mục mà quên thêm case, hàm vẫn trả false (an toàn) nhưng test dưới
    // đây bắt buộc phải khai báo kỳ vọng cho id đó.
    for (const badge of SPECIAL_BADGES) {
        assert.equal(typeof specialBadgeUnlocked(badge.id, baseSnapshot(), NEUTRAL_NOW), 'boolean',
            `${badge.id} phải trả boolean`);
    }
    assert.equal(specialBadgeUnlocked('special_khong_ton_tai', baseSnapshot(), NEUTRAL_NOW), false,
        'id lạ phải trả false');
});

// ─── 2. Bảng ngưỡng: một ca dương tính tối thiểu cho TỪNG huy hiệu ─────────
const POSITIVE = {
    special_nightwalker: { stats: { nightOwlWords: 20 } },
    special_earlybird: { stats: { earlyBirdStreak: 3 } },
    special_vampire: { stats: { vampireStreak: 7 } },
    special_hibernation: { gamification: { lastStudyDate: NEUTRAL_NOW.getTime() - 31 * DAY } },
    special_ascetic: { when: new Date(2026, 11, 25, 10, 0) },
    special_fanatic: { stats: { opensToday: 10 } },
    special_bookworm: { stats: { totalTimeSpent: 7200 } },
    special_ghost: { when: new Date(2026, 10, 13, 10, 0) }, // thứ Sáu 13/11/2026
    special_sunset_hunter: { stats: { sunsetStreak: 5 } },
    special_time_lord: { stats: { totalTimeSpent: 360000 } },
    special_lightspeed: { speedsterAchieved: true },
    special_terminator: { stats: { quizCorrectStreak: 100 } },
    special_goldfish: { stats: { accidentCount: 10 } },
    special_telepath: { stats: { perfectQuizStreak: 1 } },
    special_turtle: { stats: { totalTimeSpent: 1800 }, totalReviews: 3 },
    special_immortal: { stats: { perfectQuizStreak: 10 } },
    special_stubborn: { stats: { hardPresses: 5 } },
    special_peak_form: { stats: { monthlyCorrect: 49, monthlyTotal: 50 } },
    special_sniper: { stats: { monthlyCorrect: 99, monthlyTotal: 100 } },
    special_eidetic: { stats: { monthlyCorrect: 95, monthlyTotal: 100 } },
    special_sewing_machine: { stats: { easyPresses: 50 } },
    special_sledgehammer: { stats: { hardPresses: 20 } },
    special_stalker: { stats: { profileViews: 50 } },
    special_scanner: { stats: { imports: 1000 } },
    special_archivist: { stats: { exports: 1 } },
    special_incognito: { stats: { darkModeDays: 7 } },
    special_watcher: { stats: { profileViews: 1 } },
    special_debugger: { stats: { accidentCount: 5 } },
    special_chef: { vocabulary: cards(1, _i => ({ tags: Array.from({ length: 20 }, (_, n) => 'tag' + n) })) },
    special_genesis: { stats: { manualWordsAdded: 1 } },
    special_hurricane: { stats: { wordsAddedToday: 100 } },
    special_bounty_hunter: { stats: { xpToday: 5000 } },
    special_healer: { stats: { leechesHealed: 50 } },
    special_love_at_first_sight: {
        vocabulary: cards(10, () => ({ srsStatus: 'Mastered', lapses: 0 })),
        masteredCount: 10
    },
    special_return_of_the_king: { stats: { maxLostStreak: 50 }, currentStreak: 10 },
    special_dark_horse: {
        gamification: { currentLevel: 10 },
        stats: { accountCreatedDate: NEUTRAL_NOW.getTime() }
    },
    special_invincible: { stats: { lastForgottenDate: NEUTRAL_NOW.getTime() - 31 * DAY } },
    special_nirvana: { vocabulary: cards(500), masteredCount: 450 },
    special_grandmaster: { currentStreak: 365 },
    special_ascension: { gamification: { currentLevel: 50 } },
    special_bad_luck: { when: new Date(2026, 2, 10, 0, 0) },
    special_firefighter: { stats: { overdueReviewedToday: 100 } },
    special_procrastinator: { stats: { bareMinimumDays: 10 } },
    // GAME-01: "Bỏ Cuộc" = tạo một từ rồi xoá nó trong 60 giây. Điều kiện cũ
    // (leechesHealed === -1) là vô nghiệm nên huy hiệu chết 100%.
    special_give_up: { stats: { manualWordsAdded: 1, giveUpCount: 1 } },
    special_slip_up: { stats: { maxLostStreak: 99 } },
    special_five_elements: { stats: { easyPresses: 5, hardPresses: 5 } },
    special_accident: { stats: { accidentCount: 1 } },
    special_brain_fog: { stats: { accidentCount: 2 } },
    special_gru: { when: new Date(2026, 8, 15, 10, 0) },
    special_loyal_pet: {
        stats: { accountCreatedDate: NEUTRAL_NOW.getTime() - 400 * DAY }
    },
    special_keyboard_on_fire: { stats: { typingPerfectQuizzes: 1 } },
    special_blind_typer: { stats: { typingTypoStreaks: 1 } },
    special_fast_fingers: { stats: { typingFastAnswers: 1 } },
    special_shadow_hands: { stats: { typingNoHintStreak: 20 } },
    special_typewriter: { stats: { typingTotalCorrect: 1000 } },
    special_typo_king: { stats: { typingLastCharTypo: 1 } },
    special_impossible_typo: { stats: { typingShortWordTypo: 1 } },
    special_extreme_patience: { stats: { typingClearedInput: 1 } },
    special_copy_punishment: { stats: { typingLeechRepeats: 10 } },
    special_hate_typing: { stats: { typingImmediateExit: 1 } },
    special_ocd: { stats: { syncSpamCount: 10 } },
    special_stargazer: { when: new Date(2026, 2, 10, 0, 0), isDarkMode: true },
    special_eclipse: { isDarkMode: true, soundMode: 'off' },
    special_magic_hands: { stats: { cardFlipSpam: 20 } },
    special_black_hole: { stats: { consecutiveDeletes: 10 } },
    // GAME-01: Chuyên Gia Phân Loại phải khác Đầu Bếp — cần GẮN NHÃN cho số
    // lượng lớn thẻ, không chỉ tạo ra nhiều nhãn.
    special_tag_master: {
        vocabulary: Array.from({ length: 200 }, (_, i) => ({
            id: 'tag' + i, english: 'w' + i, isDeleted: false,
            tags: ['a','b','c','d','e','f','g','h','i','j','k','l','m','n','o','p','q','r','s','t']
        }))
    },
    special_lazy_scroll: { stats: { consecutiveShortcuts: 100 } },
    special_mesmerized: { stats: { taskbarToggles: 5 } },
    special_speaker_test: { stats: { audioSpam: 10 } },
    special_rollercoaster: { stats: { filterToggles: 5 } },
    special_phoenix: { stats: { xpToday: 2000, maxLostStreak: 5 }, currentStreak: 1 },
    special_mutant: { stats: { xpToday: 500, xpLastWeek: 200 } },
    special_mountain_hopper: { stats: { topicHopping: 1 } },
    special_celestial_smith: { vocabulary: cards(3, () => ({ reps: 50 })) },
    special_untouchable: { stats: { consecutiveEasy: 100 } },
    special_blind_faith: { stats: { quizZeroScore: 1 } },
    special_fusion: { totalReviews: 1000 },
    // GAME-01: golden_hour dùng MỐC THỜI GIAN lúc lên cấp (cùng ngày, 17–18h),
    special_golden_hour: { when: new Date(2026, 2, 12, 18, 0), stats: { justLeveledUp: new Date(2026, 2, 12, 17, 30).getTime() } },
    special_karma: { stats: { karmaEncounter: 1 } },
    special_king_returns: { stats: { kingReturns: 1 } }
};

test('bảng dương tính phủ ĐỦ 80 huy hiệu đặc biệt trong danh mục', () => {
    const catalog = SPECIAL_BADGES.map(badge => badge.id).sort();
    const covered = Object.keys(POSITIVE).sort();
    assert.deepEqual(catalog, covered,
        'Mỗi huy hiệu trong badges.js phải có một ca kiểm thử; lệch nghĩa là thêm/bớt huy hiệu mà quên cập nhật test');
});

test('mỗi huy hiệu mở đúng ở ngưỡng tối thiểu đã khai báo', () => {
    for (const [id, overrides] of Object.entries(POSITIVE)) {
        const { when, ...rest } = overrides;
        const snapshot = snap(rest);
        assert.equal(specialBadgeUnlocked(id, snapshot, when || NEUTRAL_NOW), true,
            `${id} phải MỞ với ${JSON.stringify(rest)}`);
    }
});

test('ca dương tính không kéo theo huy hiệu khác (ngưỡng không bị hạ nhầm)', () => {
    // Vài ca "nhạy" — nếu logic sai, chúng sẽ mở oan.
    const cases = [
        ['special_turtle', { stats: { totalTimeSpent: 1799 }, totalReviews: 3 }],
        ['special_phoenix', { stats: { xpToday: 2000, maxLostStreak: 0 }, currentStreak: 1 }],
        ['special_sniper', { stats: { monthlyCorrect: 98, monthlyTotal: 100 } }],
        ['special_peak_form', { stats: { monthlyCorrect: 48, monthlyTotal: 50 } }],
        ['special_return_of_the_king', { stats: { maxLostStreak: 49 }, currentStreak: 10 }],
        ['special_nirvana', { vocabulary: cards(500), masteredCount: 449 }],
        ['special_mutant', { stats: { xpToday: 500, xpLastWeek: 500 } }],
        ['special_grandmaster', { currentStreak: 364 }]
    ];
    for (const [id, overrides] of cases) {
        assert.equal(specialBadgeUnlocked(id, snap(overrides), NEUTRAL_NOW), false,
            `${id} KHÔNG được mở khi còn thiếu một đơn vị`);
    }
});

// ─── 3. Track huy hiệu ─────────────────────────────────────────────────────
test('track đạt mốc: giá trị đúng bằng mốc là mở, thiếu 1 là chưa', () => {
    for (const track of BADGE_TRACKS) {
        const first = track.milestones[0];
        assert.deepEqual(unlockedTrackBadgeIds([track], snap({ [track.type === 'mastered' ? 'masteredCount' : track.type === 'review' ? 'totalReviews' : track.type === 'xp' ? 'userXP' : 'currentStreak']: first })),
            [track.ids[0]], `${track.type} đạt mốc ${first} phải mở đúng 1 huy hiệu`);
        assert.deepEqual(unlockedTrackBadgeIds([track], snap({ [track.type === 'mastered' ? 'masteredCount' : track.type === 'review' ? 'totalReviews' : track.type === 'xp' ? 'userXP' : 'currentStreak']: first - 1 })),
            [], `${track.type} thiếu 1 đơn vị thì chưa mở`);
    }
});

test('track trả về mọi mốc đã vượt (không chỉ mốc đầu)', () => {
    const xp = BADGE_TRACKS.find(track => track.type === 'xp');
    const value = xp.milestones[4];
    const ids = unlockedTrackBadgeIds([xp], snap({ userXP: value }));
    assert.equal(ids.length, 5);
    assert.deepEqual(ids, xp.ids.slice(0, 5));
});

test('track không trả huy hiệu đã có, và chịu được track rác', () => {
    const xp = BADGE_TRACKS.find(track => track.type === 'xp');
    const snapshot = snap({ userXP: xp.milestones[0], unlockedBadges: [xp.ids[0]] });
    assert.deepEqual(unlockedTrackBadgeIds([xp], snapshot), []);
    assert.deepEqual(unlockedTrackBadgeIds([null, {}, { type: 'lạ', milestones: [1], ids: ['x'] }], snapshot), []);
    assert.equal(badgeTrackValue('lạ', snapshot), 0);
});

test('unlockedSpecialBadgeIds chỉ trả huy hiệu CHƯA có và đúng thứ tự danh mục', () => {
    const snapshot = snap({ stats: { accidentCount: 2 }, unlockedBadges: ['special_accident'] });
    const ids = unlockedSpecialBadgeIds(SPECIAL_BADGES, snapshot, NEUTRAL_NOW);
    assert.deepEqual(ids, ['special_brain_fog'], 'accidentCount=2 mở brain_fog nhưng accident đã có');
    const order = SPECIAL_BADGES.map(badge => badge.id);
    for (const id of ids) assert.ok(order.includes(id));
});

// ─── 4. Tính thuần: không đột biến, tất định ───────────────────────────────
test('hàm thuần: không sửa snapshot và kết quả lặp lại y hệt', () => {
    const snapshot = snap({ stats: { accidentCount: 3, xpToday: 2500 }, userXP: 120 });
    const frozen = structuredClone(snapshot);
    const first = unlockedSpecialBadgeIds(SPECIAL_BADGES, snapshot, NEUTRAL_NOW);
    const second = unlockedSpecialBadgeIds(SPECIAL_BADGES, snapshot, NEUTRAL_NOW);
    assert.deepEqual(first, second, 'cùng đầu vào phải cùng đầu ra');
    assert.deepEqual(snapshot, frozen, 'không được mutate snapshot của người gọi');
});
