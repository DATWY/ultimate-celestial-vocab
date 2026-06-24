export const BADGE_TIERS = {
    COMMON: { id: 'common', name: 'Thường', color: '#B0BEC5' }, // Gray
    UNCOMMON: { id: 'uncommon', name: 'Lục', color: '#81C784' }, // Green
    RARE: { id: 'rare', name: 'Lam', color: '#64B5F6' }, // Blue
    EPIC: { id: 'epic', name: 'Sử Thi', color: '#BA68C8' }, // Purple
    LEGENDARY: { id: 'legendary', name: 'Huyền Thoại', color: '#FFD54F' }, // Gold
    MYTHIC: { id: 'mythic', name: 'Thần Thoại', color: '#E57373' }, // Red
    DIVINE: { id: 'divine', name: 'Tối Thượng', color: '#F06292' } // Multi/Pink
};

function getTier(index, total) {
    const ratio = index / total;
    if (ratio <= 0.2) return BADGE_TIERS.COMMON;
    if (ratio <= 0.4) return BADGE_TIERS.UNCOMMON;
    if (ratio <= 0.6) return BADGE_TIERS.RARE;
    if (ratio <= 0.8) return BADGE_TIERS.EPIC;
    if (ratio <= 0.92) return BADGE_TIERS.LEGENDARY;
    if (ratio <= 0.98) return BADGE_TIERS.MYTHIC;
    return BADGE_TIERS.DIVINE;
}

const BADGES = [];

// 1. Nhánh Tu Luyện (XP) - 25 danh hiệu
const xpMilestones = [
    10, 50, 100, 200, 300, 500, 800, 1200, 1800, 2500, 3500, 5000, 7500, 10000, 15000, 
    20000, 30000, 50000, 75000, 100000, 150000, 250000, 500000, 750000, 1000000
];
const xpNames = [
    "Tân Binh", "Học Việc", "Lính Mới", "Thực Tập Sinh", "Mọt Sách", "Học Giả", "Trí Thức", "Khai Sáng", "Học Bá", "Nhà Thông Thái",
    "Kẻ Khám Phá", "Nhà Triết Học", "Sứ Giả Ánh Sáng", "Người Đạt Đạo", "Bậc Thầy", "Đại Sư", "Huyền Thoại", "Vị Thần Trí Tuệ", "Chúa Tể Thời Gian", "Đấng Toàn Năng",
    "Vũ Trụ Thức Tỉnh", "Kẻ Thách Thức Hư Không", "Chân Thần", "Khởi Nguyên", "Đấng Sáng Tạo"
];
const xpIcons = [
    "ph-egg", "ph-wrench", "ph-shield", "ph-briefcase", "ph-books", 
    "ph-student", "ph-certificate", "ph-lightbulb", "ph-medal", "ph-brain", 
    "ph-compass", "ph-scroll", "ph-sun", "ph-yin-yang", "ph-graduation-cap", 
    "ph-crown-simple", "ph-star", "ph-eye", "ph-hourglass", "ph-lightning", 
    "ph-planet", "ph-sword", "ph-sparkle", "ph-atom", "ph-magic-wand"
];
for (let i = 0; i < 25; i++) {
    BADGES.push({
        id: `xp_${xpMilestones[i]}`,
        type: 'xp',
        target: xpMilestones[i],
        name: xpNames[i],
        desc: `Đạt ${xpMilestones[i].toLocaleString()} XP`,
        icon: xpIcons[i],
        tier: getTier(i, 25)
    });
}

// 2. Nhánh Bền Bỉ (Streak) - 25 danh hiệu
const streakMilestones = [
    2, 3, 5, 7, 10, 14, 21, 30, 45, 60, 90, 120, 150, 180, 210, 240, 270, 300, 365, 400, 500, 600, 730, 900, 1000
];
const streakNames = [
    "Khởi Động", "Bắt Nhịp", "Quyết Tâm", "Tuần Đầu Tiên", "10 Ngày Lửa", "Hai Tuần Kỷ Luật", "Hình Thành Thói Quen", "Bền Bỉ (Tháng)", "Băng Băng", "Hai Tháng Liền",
    "Quý Một", "Vượt Giới Hạn", "Nửa Chặng Đường", "Nửa Năm Chăm Chỉ", "Kẻ Cuồng Tín", "Không Thể Cản Phá", "Cỗ Máy Thời Gian", "Bất Tử", "Một Năm Trọn Vẹn", "Người Hùng",
    "500 Anh Em", "Siêu Nhân", "Hai Năm Liên Tục", "Huyền Thoại Sống", "Đại Kỷ Nguyên"
];
const streakIcons = [
    "ph-sneaker", "ph-music-note", "ph-target", "ph-calendar-blank", "ph-fire", 
    "ph-calendar-check", "ph-recycle", "ph-calendar-star", "ph-person-simple-run", "ph-calendar-plus", 
    "ph-chart-pie-slice", "ph-trend-up", "ph-flag-banner", "ph-clock-clockwise", "ph-alien", 
    "ph-shield-chevron", "ph-clock-countdown", "ph-infinity", "ph-heart", "ph-shield-star", 
    "ph-users", "ph-flying-saucer", "ph-diamonds-four", "ph-crown", "ph-globe-hemisphere-west"
];
for (let i = 0; i < 25; i++) {
    BADGES.push({
        id: `streak_${streakMilestones[i]}`,
        type: 'streak',
        target: streakMilestones[i],
        name: streakNames[i],
        desc: `Chuỗi học ${streakMilestones[i]} ngày`,
        icon: streakIcons[i],
        tier: getTier(i, 25)
    });
}

// 3. Nhánh Trí Tuệ (Mastered Words) - 25 danh hiệu
const masteredMilestones = [
    5, 10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 600, 750, 900, 1000, 1250, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000
];
const masteredNames = [
    "Viên Gạch Đầu", "Tích Tiểu", "Thành Đại", "Hiểu Biết", "Cứng Cáp", "Bách Khoa", "Nắm Bắt", "Quen Thuộc", "Nằm Lòng", "Như In",
    "Ghi Tạc", "Khắc Cốt", "Ghi Tâm", "Lão Luyện", "Uyên Bác", "Từ Điển Sống", "Bậc Thầy Ngôn Ngữ", "Bộ Não Máy Tính", "Bách Khoa Toàn Thư", "Đại Uyên Bác",
    "Thông Hiểu Vạn Vật", "Bậc Thầy Cổ Đại", "Giới Tinh Anh", "Chúa Tể Ngôn Từ", "Ngôn Ngữ Học Thần"
];
const masteredIcons = [
    "ph-wall", "ph-coins", "ph-piggy-bank", "ph-info", "ph-barbell", 
    "ph-book-open", "ph-hand-fist", "ph-handshake", "ph-heart", "ph-printer", 
    "ph-pen-nib", "ph-bone", "ph-brain", "ph-medal-military", "ph-student", 
    "ph-books", "ph-translate", "ph-cpu", "ph-archive", "ph-graduation-cap", 
    "ph-globe", "ph-scroll", "ph-diamonds-four", "ph-crown", "ph-sparkle"
];
for (let i = 0; i < 25; i++) {
    BADGES.push({
        id: `mastered_${masteredMilestones[i]}`,
        type: 'mastered',
        target: masteredMilestones[i],
        name: masteredNames[i],
        desc: `Thuộc ${masteredMilestones[i].toLocaleString()} từ vựng`,
        icon: masteredIcons[i],
        tier: getTier(i, 25)
    });
}

// 4. Nhánh Luyện Tập (Total Reviews) - 25 danh hiệu
const reviewMilestones = [
    10, 50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 15000, 20000, 30000, 50000, 75000, 100000, 150000, 200000, 300000, 500000, 1000000
];
const reviewNames = [
    "Làm Quen", "Khởi Động Tay", "Chăm Chỉ Xoay Thẻ", "Người Ôn Tập", "Thuộc Lòng", "Bền Chí", "Không Bỏ Cuộc", "Nghìn Trận", "Luyện Tập Hăng Say", "Cày Cuốc",
    "Người Chăm Chỉ", "Cỗ Máy Học Tập", "Ong Thợ", "Vạn Trận Đánh", "Người Gác Đêm", "Chuyên Gia Đảo Thẻ", "Bậc Thầy Trí Nhớ", "Thần Đồng", "Người Không Thể Quên", "Sách Ghi Nhớ",
    "Não Bộ Tuyệt Đối", "Đại Sứ Ánh Sáng", "Chúa Tể Không Gian", "Vua Của Các Vị Vua", "Đấng Kiến Tạo Hệ Thống"
];
const reviewIcons = [
    "ph-hand-waving", "ph-hand", "ph-arrows-clockwise", "ph-eye", "ph-check-circle", 
    "ph-anchor", "ph-flag-banner", "ph-sword", "ph-barbell", "ph-hammer", 
    "ph-briefcase", "ph-robot", "ph-hexagon", "ph-shield-check", "ph-moon", 
    "ph-cards", "ph-brain", "ph-star", "ph-lock-key", "ph-address-book", 
    "ph-cpu", "ph-sun", "ph-planet", "ph-crown", "ph-hard-drives"
];
for (let i = 0; i < 25; i++) {
    BADGES.push({
        id: `review_${reviewMilestones[i]}`,
        type: 'review',
        target: reviewMilestones[i],
        name: reviewNames[i],
        desc: `Ôn tập ${reviewMilestones[i].toLocaleString()} thẻ`,
        icon: reviewIcons[i],
        tier: getTier(i, 25)
    });
}

export { BADGES };
