export const BADGE_TIERS = {
    COMMON: { id: 'common', name: 'Thường', color: '#B0BEC5' }, // Gray
    UNCOMMON: { id: 'uncommon', name: 'Lục', color: '#81C784' }, // Green
    RARE: { id: 'rare', name: 'Lam', color: '#64B5F6' }, // Blue
    EPIC: { id: 'epic', name: 'Sử Thi', color: '#BA68C8' }, // Purple
    LEGENDARY: { id: 'legendary', name: 'Huyền Thoại', color: '#FFD54F' }, // Gold
    MYTHIC: { id: 'mythic', name: 'Thần Thoại', color: '#E57373' }, // Red
    DIVINE: { id: 'divine', name: 'Tối Thượng', color: '#F06292' } // Multi/Pink
};

export function getTier(index, total) {
    const ratio = index / total;
    if (ratio <= 0.2) return BADGE_TIERS.COMMON;
    if (ratio <= 0.4) return BADGE_TIERS.UNCOMMON;
    if (ratio <= 0.6) return BADGE_TIERS.RARE;
    if (ratio <= 0.8) return BADGE_TIERS.EPIC;
    if (ratio <= 0.92) return BADGE_TIERS.LEGENDARY;
    if (ratio <= 0.98) return BADGE_TIERS.MYTHIC;
    return BADGE_TIERS.DIVINE;
}

export const BADGE_TRACKS = [
    {
        id: 'xp',
        type: 'xp',
        title: 'Tu Luyện',
        descPrefix: 'Đạt',
        descSuffix: 'XP',
        milestones: [10, 50, 100, 200, 300, 500, 800, 1200, 1800, 2500, 3500, 5000, 7500, 10000, 15000, 20000, 30000, 50000, 75000, 100000, 150000, 250000, 500000, 750000, 1000000],
        names: ["Phàm Nhân", "Luyện Khí", "Trúc Cơ", "Kim Đan", "Nguyên Anh", "Hóa Thần", "Luyện Hư", "Hợp Thể", "Đại Thừa", "Độ Kiếp", "Tán Tiên", "Địa Tiên", "Thiên Tiên", "Chân Tiên", "Huyền Tiên", "Thái Ất", "Đại La", "Tiên Vương", "Tiên Tôn", "Tiên Đế", "Bán Thần", "Chân Thần", "Thần Vương", "Sáng Thế", "Hỗn Đôn"],
        icons: ["ph-fill ph-user", "ph-fill ph-wind", "ph-fill ph-columns", "ph-fill ph-sun-dim", "ph-fill ph-baby", "ph-fill ph-ghost", "ph-fill ph-spiral", "ph-fill ph-intersect-three", "ph-fill ph-mountains", "ph-fill ph-cloud-lightning", "ph-fill ph-star", "ph-fill ph-tree-evergreen", "ph-fill ph-cloud-sun", "ph-fill ph-moon-stars", "ph-fill ph-planet", "ph-fill ph-yin-yang", "ph-fill ph-infinity", "ph-fill ph-crown", "ph-fill ph-sparkle", "ph-fill ph-sun", "ph-fill ph-eye", "ph-fill ph-star-four", "ph-fill ph-crown-simple", "ph-fill ph-cube", "ph-fill ph-atom"]
    },
    {
        id: 'streak',
        type: 'streak',
        title: 'Bền Bỉ',
        descPrefix: 'Chuỗi',
        descSuffix: 'ngày',
        milestones: [2, 3, 5, 7, 10, 14, 21, 30, 45, 60, 90, 120, 150, 180, 210, 240, 270, 300, 365, 400, 500, 600, 730, 900, 1000],
        names: ["Đốm Lửa", "Mồi Lửa", "Hỏa Chủng", "Hỏa Cầu", "Hỏa Hậu", "Hỏa Sư", "Hỏa Tướng", "Hỏa Vương", "Hỏa Đế", "Hỏa Thần", "Bão Lửa", "Dung Nham", "Địa Ngục", "Thái Dương", "Thiên Thạch", "Sao Chổi", "Ngân Hà", "Tinh Vân", "Hố Đen", "Siêu Tân", "Bất Diệt", "Vĩnh Hằng", "Thời Không", "Khởi Nguyên", "Tận Cùng"],
        icons: ["ph-fill ph-sparkle", "ph-fill ph-flame", "ph-fill ph-fire-simple", "ph-fill ph-fire", "ph-fill ph-campfire", "ph-fill ph-sword", "ph-fill ph-shield-chevron", "ph-fill ph-crown", "ph-fill ph-castle-turret", "ph-fill ph-lightning", "ph-fill ph-tornado", "ph-fill ph-drop-half-bottom", "ph-fill ph-skull", "ph-fill ph-sun-horizon", "ph-fill ph-meteor", "ph-fill ph-shooting-star", "ph-fill ph-galaxy", "ph-fill ph-cloud-fog", "ph-fill ph-black-hole", "ph-fill ph-superset-of", "ph-fill ph-infinity", "ph-fill ph-hourglass", "ph-fill ph-clock-clockwise", "ph-fill ph-magic-wand", "ph-fill ph-prohibit"]
    },
    {
        id: 'mastered',
        type: 'mastered',
        title: 'Trí Tuệ',
        descPrefix: 'Thông thạo',
        descSuffix: 'từ',
        milestones: [5, 10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 600, 750, 900, 1000, 1250, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000],
        names: ["Ghi Chép", "Học Giả", "Trí Tôn", "Tàng Kinh", "Bách Khoa", "Thư Viện", "Vạn Dặm", "Minh Triết", "Thông Thái", "Thấu Thị", "Tiên Tri", "Chân Tướng", "Khai Sáng", "Giác Ngộ", "Thần Nhãn", "Tâm Nhãn", "Trí Óc", "Vô Niệm", "Vô Ngã", "Tinh Tế", "Đa Nguyên", "Toàn Tri", "Toàn Năng", "Akasha", "Chúa Tể"],
        icons: ["ph-fill ph-pencil-simple", "ph-fill ph-graduation-cap", "ph-fill ph-brain", "ph-fill ph-books", "ph-fill ph-book-open-text", "ph-fill ph-bookmarks", "ph-fill ph-compass", "ph-fill ph-lightbulb-filament", "ph-fill ph-sparkle", "ph-fill ph-eye", "ph-fill ph-magic-wand", "ph-fill ph-magnifying-glass-plus", "ph-fill ph-sun", "ph-fill ph-flower-lotus", "ph-fill ph-eye-closed", "ph-fill ph-heart", "ph-fill ph-cpu", "ph-fill ph-wind", "ph-fill ph-ghost", "ph-fill ph-atom", "ph-fill ph-intersect-three", "ph-fill ph-globe-hemisphere-east", "ph-fill ph-crown", "ph-fill ph-database", "ph-fill ph-key"]
    },
    {
        id: 'review',
        type: 'review',
        title: 'Luyện Tập',
        descPrefix: 'Ôn tập',
        descSuffix: 'lần',
        milestones: [10, 50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 15000, 20000, 30000, 50000, 75000, 100000, 150000, 200000, 300000, 500000, 1000000],
        names: ["Khởi Động", "Bánh Răng", "Tuần Hoàn", "Bền Bỉ", "Cỗ Máy", "Động Cơ", "Lõi Từ", "Nguyên Tử", "Đột Phá", "Giới Hạn", "Vô Khuyết", "Bất Bại", "Bất Khuất", "Kim Cang", "Tu Di", "Bát Nhã", "Bồ Đề", "Niết Bàn", "Vô Hạn", "Luân Hồi", "Vĩnh Kiếp", "Thời Gian", "Trọng Lực", "Hư Không", "Tuyệt Tích"],
        icons: ["ph-fill ph-play", "ph-fill ph-gear-six", "ph-fill ph-arrows-clockwise", "ph-fill ph-barbell", "ph-fill ph-robot", "ph-fill ph-engine", "ph-fill ph-magnet", "ph-fill ph-atom", "ph-fill ph-rocket-launch", "ph-fill ph-chart-line-up", "ph-fill ph-shield-check", "ph-fill ph-sword", "ph-fill ph-anchor", "ph-fill ph-diamond", "ph-fill ph-mountains", "ph-fill ph-flower-lotus", "ph-fill ph-tree-evergreen", "ph-fill ph-fire", "ph-fill ph-infinity", "ph-fill ph-arrows-counter-clockwise", "ph-fill ph-hourglass", "ph-fill ph-timer", "ph-fill ph-arrow-fat-lines-down", "ph-fill ph-aperture", "ph-fill ph-seal-warning"]
    }
];

export const SPECIAL_BADGES = [
    // --- Nhóm 1: Khung Giờ & Thói Quen (Thời Gian) ---
    { id: `special_nightwalker`, type: 'special', target: 1, name: "Kẻ Mộng Du", desc: "Học ít nhất 20 từ vựng vào khoảng 3h - 4h sáng.", icon: "ph-fill ph-moon-stars", tier: BADGE_TIERS.EPIC },
    { id: `special_earlybird`, type: 'special', target: 1, name: "Thần Gà Gáy", desc: "Hoàn thành bài ôn tập trước 5h sáng trong 3 ngày liên tiếp.", icon: "ph-fill ph-sun-horizon", tier: BADGE_TIERS.EPIC },
    { id: `special_vampire`, type: 'special', target: 1, name: "Ma Cà Rồng", desc: "Chỉ mở app vào ban đêm (sau 20h) liên tục trong 7 ngày.", icon: "ph-fill ph-skull", tier: BADGE_TIERS.LEGENDARY },
    { id: `special_hibernation`, type: 'special', target: 1, name: "Trú Đông", desc: "Không mở app trong đúng 1 tháng rồi quay lại học.", icon: "ph-fill ph-snowflake", tier: BADGE_TIERS.MYTHIC },
    { id: `special_ascetic`, type: 'special', target: 1, name: "Khổ Hạnh Tăng", desc: "Hoàn thành bài học vào đúng ngày Mùng 1 Tết hoặc Giáng Sinh.", icon: "ph-fill ph-hands-praying", tier: BADGE_TIERS.DIVINE },
    { id: `special_fanatic`, type: 'special', target: 1, name: "Cuồng Tín", desc: "Mở ứng dụng 10 lần trong cùng một ngày.", icon: "ph-fill ph-arrows-clockwise", tier: BADGE_TIERS.RARE },
    { id: `special_bookworm`, type: 'special', target: 1, name: "Mọt Sách", desc: "Học liên tục trên app quá 2 tiếng đồng hồ không thoát.", icon: "ph-fill ph-book-open-text", tier: BADGE_TIERS.EPIC },
    { id: `special_ghost`, type: 'special', target: 1, name: "Bóng Ma", desc: "Hoàn thành bài học vào thứ Sáu ngày 13.", icon: "ph-fill ph-ghost", tier: BADGE_TIERS.MYTHIC },
    { id: `special_sunset_hunter`, type: 'special', target: 1, name: "Kẻ Săn Hoàng Hôn", desc: "Học liên tục vào khung giờ 17:00 - 18:00 trong 5 ngày.", icon: "ph-fill ph-cloud-sun", tier: BADGE_TIERS.LEGENDARY },
    { id: `special_time_lord`, type: 'special', target: 1, name: "Chúa Tể Thời Gian", desc: "Tổng thời gian sử dụng ứng dụng vượt mốc 100 giờ.", icon: "ph-fill ph-hourglass", tier: BADGE_TIERS.DIVINE },

    // --- Nhóm 2: Tốc Độ & Độ Chính Xác ---
    { id: `special_lightspeed`, type: 'special', target: 1, name: "Tốc Độ Ánh Sáng", desc: "Hoàn thành một phiên Quiz 20 câu dưới 1 phút.", icon: "ph-fill ph-lightning", tier: BADGE_TIERS.LEGENDARY },
    { id: `special_terminator`, type: 'special', target: 1, name: "Kẻ Hủy Diệt", desc: "Làm đúng 100 câu liên tiếp không sai một lỗi nào.", icon: "ph-fill ph-crosshair", tier: BADGE_TIERS.MYTHIC },
    { id: `special_goldfish`, type: 'special', target: 1, name: "Não Cá Vàng", desc: "Trả lời sai cùng một từ vựng 10 lần liên tiếp.", icon: "ph-fill ph-fish-simple", tier: BADGE_TIERS.COMMON },
    { id: `special_telepath`, type: 'special', target: 1, name: "Ngoại Cảm", desc: "Trả lời đúng 5 từ mới tinh trong vòng 5 giây mỗi từ.", icon: "ph-fill ph-brain", tier: BADGE_TIERS.EPIC },
    { id: `special_turtle`, type: 'special', target: 1, name: "Rùa Bò", desc: "Một phiên ôn tập kéo dài 30 phút nhưng chỉ học được 10 từ.", icon: "ph-fill ph-clock-countdown", tier: BADGE_TIERS.COMMON },
    { id: `special_immortal`, type: 'special', target: 1, name: "Bất Tử", desc: "Đạt 100% tỷ lệ đúng trong 10 bài Quiz liên tiếp (mỗi bài tối thiểu 10 câu).", icon: "ph-fill ph-shield-star", tier: BADGE_TIERS.DIVINE },
    { id: `special_stubborn`, type: 'special', target: 1, name: "Cố Chấp", desc: "Làm sai 5 câu liên tiếp nhưng không chịu thoát bài học.", icon: "ph-fill ph-wall", tier: BADGE_TIERS.UNCOMMON },
    { id: `special_peak_form`, type: 'special', target: 1, name: "Đỉnh Cao Phong Độ", desc: "Làm 50 câu Quiz và chỉ sai đúng 1 câu duy nhất.", icon: "ph-fill ph-trophy", tier: BADGE_TIERS.EPIC },
    { id: `special_sniper`, type: 'special', target: 1, name: "Bắn Tỉa", desc: "Tỷ lệ chính xác trung bình trong tháng đạt 99%.", icon: "ph-fill ph-target", tier: BADGE_TIERS.LEGENDARY },
    { id: `special_eidetic`, type: 'special', target: 1, name: "Siêu Trí Nhớ", desc: "Học 100 từ một lúc mà tỷ lệ đúng lên tới 95%.", icon: "ph-fill ph-camera", tier: BADGE_TIERS.MYTHIC },

    // --- Nhóm 3: Phong Cách Tương Tác (Hành Động) ---
    { id: `special_sewing_machine`, type: 'special', target: 1, name: "Máy Khâu", desc: "Bấm nút Dễ cho 50 từ liên tiếp.", icon: "ph-fill ph-hand-tap", tier: BADGE_TIERS.RARE },
    { id: `special_sledgehammer`, type: 'special', target: 1, name: "Búa Tạ", desc: "Bấm nút Khó cho 20 từ liên tiếp.", icon: "ph-fill ph-hammer", tier: BADGE_TIERS.RARE },
    { id: `special_stalker`, type: 'special', target: 1, name: "Kẻ Bám Đuôi", desc: "Nhấp vào mục Hồ Sơ để xem thống kê 50 lần trong một ngày.", icon: "ph-fill ph-binoculars", tier: BADGE_TIERS.UNCOMMON },
    { id: `special_scanner`, type: 'special', target: 1, name: "Cỗ Máy Quét", desc: "Import (Nhập) thành công 1000 từ vựng vào app.", icon: "ph-fill ph-scan", tier: BADGE_TIERS.EPIC },
    { id: `special_archivist`, type: 'special', target: 1, name: "Kẻ Lưu Trữ", desc: "Export (Xuất) sao lưu dữ liệu lần đầu tiên.", icon: "ph-fill ph-floppy-disk", tier: BADGE_TIERS.RARE },
    { id: `special_incognito`, type: 'special', target: 1, name: "Ẩn Danh", desc: "Sử dụng chế độ Giao Diện Tối (Dark Mode) liên tục trong 1 tuần.", icon: "ph-fill ph-detective", tier: BADGE_TIERS.UNCOMMON },
    { id: `special_watcher`, type: 'special', target: 1, name: "Thích Ngắm Nhìn", desc: "Nhìn chằm chằm vào biểu đồ Heatmap quá 1 phút.", icon: "ph-fill ph-chart-bar", tier: BADGE_TIERS.COMMON },
    { id: `special_debugger`, type: 'special', target: 1, name: "Kẻ Bắt Lỗi", desc: "Click 10 lần liên tục vào logo của ứng dụng.", icon: "ph-fill ph-bug-beetle", tier: BADGE_TIERS.EPIC },
    { id: `special_chef`, type: 'special', target: 1, name: "Đầu Bếp", desc: "Tạo ra 20 Tag/Chủ đề khác nhau để phân loại từ vựng.", icon: "ph-fill ph-cooking-pot", tier: BADGE_TIERS.LEGENDARY },
    { id: `special_genesis`, type: 'special', target: 1, name: "Người Khởi Nguồn", desc: "Thêm thủ công từ vựng đầu tiên vào hệ thống.", icon: "ph-fill ph-plant", tier: BADGE_TIERS.RARE },

    // --- Nhóm 4: Cày Cuốc & Cống Hiến (Grinding) ---
    { id: `special_hurricane`, type: 'special', target: 1, name: "Cuồng Phong", desc: "Thêm 100 từ vựng mới vào app chỉ trong 1 ngày.", icon: "ph-fill ph-tornado", tier: BADGE_TIERS.LEGENDARY },
    { id: `special_bounty_hunter`, type: 'special', target: 1, name: "Thợ Săn Tiền Thưởng", desc: "Đạt số điểm XP kỷ lục (>5000 XP) trong 24 giờ.", icon: "ph-fill ph-coins", tier: BADGE_TIERS.MYTHIC },
    { id: `special_healer`, type: 'special', target: 1, name: "Bậc Thầy Phục Hồi", desc: "Đưa 50 từ vựng từ trạng thái Leech lên mức Thuộc.", icon: "ph-fill ph-first-aid", tier: BADGE_TIERS.EPIC },
    { id: `special_love_at_first_sight`, type: 'special', target: 1, name: "Nhất Kiến Chung Tình", desc: "Có 10 từ vựng chưa từng bấm sai lần nào từ lúc bắt đầu học đến khi Mastered.", icon: "ph-fill ph-heartbeat", tier: BADGE_TIERS.DIVINE },
    { id: `special_return_of_the_king`, type: 'special', target: 1, name: "Tái Xuất Giang Hồ", desc: "Lấy lại chuỗi học (Streak) 10 ngày sau khi làm đứt chuỗi 50 ngày.", icon: "ph-fill ph-crown", tier: BADGE_TIERS.MYTHIC },
    { id: `special_dark_horse`, type: 'special', target: 1, name: "Hắc Mã", desc: "Lên thẳng cấp độ 10 chỉ trong vòng 3 ngày từ lúc tạo tài khoản.", icon: "ph-fill ph-horse", tier: BADGE_TIERS.LEGENDARY },
    { id: `special_invincible`, type: 'special', target: 1, name: "Độc Cô Cầu Bại", desc: "Không có từ vựng nào rớt xuống mức quên trong trọn vẹn 1 tháng.", icon: "ph-fill ph-shield-star", tier: BADGE_TIERS.DIVINE },
    { id: `special_nirvana`, type: 'special', target: 1, name: "Cảnh Giới Vô Ngã", desc: "90% số lượng từ vựng trong app đều đạt trạng thái Mastered (Tối thiểu 500 từ).", icon: "ph-fill ph-flower-lotus", tier: BADGE_TIERS.DIVINE },
    { id: `special_grandmaster`, type: 'special', target: 1, name: "Khai Tông Lập Phái", desc: "Hoàn thành chuỗi học (Streak) 365 ngày liên tục.", icon: "ph-fill ph-scroll", tier: BADGE_TIERS.DIVINE },
    { id: `special_ascension`, type: 'special', target: 1, name: "Thiên Nhân Hợp Nhất", desc: "Đạt Cấp độ Tối đa (Level 50) và Rank Kim Cương.", icon: "ph-fill ph-planet", tier: BADGE_TIERS.DIVINE },

    // --- Nhóm 5: Tình Huống Hài Hước & Xui Xẻo ---
    { id: `special_bad_luck`, type: 'special', target: 1, name: "Số Nhọ", desc: "Mở app học lúc 23:59 nhưng vừa qua 00:00 mới xong bài, làm mất chuỗi Streak.", icon: "ph-fill ph-cloud-rain", tier: BADGE_TIERS.UNCOMMON },
    { id: `special_firefighter`, type: 'special', target: 1, name: "Chữa Cháy", desc: "Ôn tập 100 từ vựng đang quá hạn (Overdue) chỉ trong 1 ngày.", icon: "ph-fill ph-fire-extinguisher", tier: BADGE_TIERS.EPIC },
    { id: `special_procrastinator`, type: 'special', target: 1, name: "Nước Tới Chân...", desc: "Có 500 từ vựng Overdue nhưng mỗi ngày chỉ học đúng 1 từ để giữ Streak.", icon: "ph-fill ph-armchair", tier: BADGE_TIERS.RARE },
    { id: `special_give_up`, type: 'special', target: 1, name: "Bỏ Cuộc", desc: "Thêm 1 từ vựng vào rồi xóa nó đi ngay lập tức.", icon: "ph-fill ph-trash-simple", tier: BADGE_TIERS.COMMON },
    { id: `special_slip_up`, type: 'special', target: 1, name: "Cú Trượt Chân", desc: "Đứt chuỗi Streak ở đúng ngày thứ 99.", icon: "ph-fill ph-warning-diamond", tier: BADGE_TIERS.EPIC },
    { id: `special_five_elements`, type: 'special', target: 1, name: "Ngũ Hành Tương Sinh", desc: "Học đủ 5 chủ đề/tag từ vựng khác nhau trong cùng 1 buổi.", icon: "ph-fill ph-star-four", tier: BADGE_TIERS.RARE },
    { id: `special_accident`, type: 'special', target: 1, name: "Chỉ Là Tai Nạn", desc: "Đánh dấu Quên cho một từ vựng đã đạt mức Mastered.", icon: "ph-fill ph-siren", tier: BADGE_TIERS.UNCOMMON },
    { id: `special_brain_fog`, type: 'special', target: 1, name: "Não Đầy Nước", desc: "Bấm nhầm nút Dễ cho một từ khó, rồi ngay lập tức hoàn tác (Undo).", icon: "ph-fill ph-cloud-fog", tier: BADGE_TIERS.RARE },
    { id: `special_gru`, type: 'special', target: 1, name: "Kẻ Cắp Mặt Trăng", desc: "Học vào đêm Trung Thu.", icon: "ph-fill ph-moon", tier: BADGE_TIERS.LEGENDARY },
    { id: `special_loyal_pet`, type: 'special', target: 1, name: "Con Cưng Của App", desc: "Giữ ứng dụng trong máy và học được 1 năm kể từ ngày đầu tiên.", icon: "ph-fill ph-paw-print", tier: BADGE_TIERS.MYTHIC },

    // --- Nhóm 6: Thử Thách Gõ Từ (Typing Mode Mastery) ---
    { id: `special_keyboard_on_fire`, type: 'special', target: 1, name: "Bàn Phím Lửa", desc: "Hoàn thành 1 bài Typing 30 câu với độ chính xác 100%.", icon: "ph-fill ph-keyboard", tier: BADGE_TIERS.EPIC },
    { id: `special_blind_typer`, type: 'special', target: 1, name: "Nhắm Mắt Bấm Phím", desc: "Gõ sai chính tả 5 lần liên tiếp trên cùng 1 từ.", icon: "ph-fill ph-eye-closed", tier: BADGE_TIERS.COMMON },
    { id: `special_fast_fingers`, type: 'special', target: 1, name: "Múa Phím", desc: "Trả lời đúng trong Typing Mode chưa tới 1.5 giây sau khi hiện thẻ.", icon: "ph-fill ph-wind", tier: BADGE_TIERS.RARE },
    { id: `special_shadow_hands`, type: 'special', target: 1, name: "Vô Ảnh Thủ", desc: "Gõ đúng liên tiếp 20 từ mà không cần dùng đến Hint (gợi ý).", icon: "ph-fill ph-magic-wand", tier: BADGE_TIERS.LEGENDARY },
    { id: `special_typewriter`, type: 'special', target: 1, name: "Cỗ Máy Đánh Chữ", desc: "Trả lời đúng tổng cộng 1,000 từ bằng chế độ Gõ từ.", icon: "ph-fill ph-typewriter", tier: BADGE_TIERS.MYTHIC },
    { id: `special_typo_king`, type: 'special', target: 1, name: "Lỗi Đánh Máy", desc: "Bị bắt lỗi gõ sai chữ cái cuối cùng của một từ dài.", icon: "ph-fill ph-pencil-slash", tier: BADGE_TIERS.UNCOMMON },
    { id: `special_impossible_typo`, type: 'special', target: 1, name: "Bất Khả Thi", desc: "Gõ sai một từ siêu ngắn (dưới 3 ký tự).", icon: "ph-fill ph-prohibit", tier: BADGE_TIERS.COMMON },
    { id: `special_extreme_patience`, type: 'special', target: 1, name: "Kiên Nhẫn Tột Độ", desc: "Xóa toàn bộ câu đã gõ và gõ lại từ đầu thay vì chỉ sửa chữ sai.", icon: "ph-fill ph-backspace", tier: BADGE_TIERS.RARE },
    { id: `special_copy_punishment`, type: 'special', target: 1, name: "Chép Phạt", desc: "Gõ lại 1 từ khó (Leech) 10 lần trong lịch sử học.", icon: "ph-fill ph-copy", tier: BADGE_TIERS.EPIC },
    { id: `special_hate_typing`, type: 'special', target: 1, name: "Không Thích Gõ", desc: "Vừa chuyển sang Typing Mode chưa được 1 câu đã thoát về Flashcard.", icon: "ph-fill ph-door", tier: BADGE_TIERS.UNCOMMON },

    // --- Nhóm 7: Tương Tác & Giao Diện (UI/UX Explorers) ---
    { id: `special_ocd`, type: 'special', target: 1, name: "Ám Ảnh Cưỡng Chế", desc: "Bấm nút Đồng bộ (Sync) lên Cloud 10 lần trong 1 phút.", icon: "ph-fill ph-cloud-arrow-up", tier: BADGE_TIERS.EPIC },
    { id: `special_stargazer`, type: 'special', target: 1, name: "Ngắm Sao", desc: "Bật giao diện Dark Mode đúng vào lúc nửa đêm (00:00).", icon: "ph-fill ph-sparkle", tier: BADGE_TIERS.LEGENDARY },
    { id: `special_eclipse`, type: 'special', target: 1, name: "Nhật Thực", desc: "Vừa bật Dark Mode vừa Tắt Âm thanh để nhập định học tập.", icon: "ph-fill ph-moon-stars", tier: BADGE_TIERS.RARE },
    { id: `special_magic_hands`, type: 'special', target: 1, name: "Bàn Tay Ma Thuật", desc: "Bấm lật mặt thẻ liên tục 20 lần cho 1 từ mà không chọn đáp án.", icon: "ph-fill ph-hand-swipe-left", tier: BADGE_TIERS.UNCOMMON },
    { id: `special_black_hole`, type: 'special', target: 1, name: "Lỗ Hổng Không Gian", desc: "Bấm Xóa (Delete) liên tiếp 10 từ vựng.", icon: "ph-fill ph-trash", tier: BADGE_TIERS.EPIC },
    { id: `special_tag_master`, type: 'special', target: 1, name: "Chuyên Gia Phân Loại", desc: "Tạo ra hơn 20 chủ đề (tags) khác nhau để quản lý từ.", icon: "ph-fill ph-tag", tier: BADGE_TIERS.LEGENDARY },
    { id: `special_lazy_scroll`, type: 'special', target: 1, name: "Lười Biếng", desc: "Chỉ dùng phím tắt để ôn tập 100 thẻ liên tục thay vì dùng chuột.", icon: "ph-fill ph-armchair", tier: BADGE_TIERS.MYTHIC },
    { id: `special_mesmerized`, type: 'special', target: 1, name: "Không Thể Rời Mắt", desc: "Bật thanh Taskbar Menu lên rồi đóng lại 5 lần liên tục.", icon: "ph-fill ph-eye", tier: BADGE_TIERS.COMMON },
    { id: `special_speaker_test`, type: 'special', target: 1, name: "Test Loa", desc: "Bấm nút phát âm thanh của 1 từ liên tục 10 lần.", icon: "ph-fill ph-speaker-high", tier: BADGE_TIERS.RARE },
    { id: `special_rollercoaster`, type: 'special', target: 1, name: "Tàu Lượn Siêu Tốc", desc: "Chuyển liên tục giữa bộ lọc 'Tất cả' và chủ đề cụ thể 5 lần.", icon: "ph-fill ph-arrows-out-line-horizontal", tier: BADGE_TIERS.UNCOMMON },

    // --- Nhóm 8: Kỷ Lục Độc Lạ (Bizarre Milestones) ---
    { id: `special_phoenix`, type: 'special', target: 1, name: "Phượng Hoàng Tái Sinh", desc: "Cày 2000 XP ngay trong ngày đầu tiên làm đứt chuỗi Streak.", icon: "ph-fill ph-bird", tier: BADGE_TIERS.DIVINE },
    { id: `special_mutant`, type: 'special', target: 1, name: "Người Đột Biến", desc: "Số XP kiếm được trong 1 ngày lớn hơn tổng XP của cả tuần trước cộng lại.", icon: "ph-fill ph-alien", tier: BADGE_TIERS.MYTHIC },
    { id: `special_mountain_hopper`, type: 'special', target: 1, name: "Đứng Núi Này...", desc: "Đang ôn tập chủ đề này nhưng nhảy sang ôn tập chủ đề khác giữa chừng.", icon: "ph-fill ph-mountains", tier: BADGE_TIERS.UNCOMMON },
    { id: `special_celestial_smith`, type: 'special', target: 1, name: "Thợ Rèn Tiên Giới", desc: "Ôn tập cùng 1 từ vựng đạt mốc 50 lần trong suốt quá trình học.", icon: "ph-fill ph-hammer", tier: BADGE_TIERS.LEGENDARY },
    { id: `special_untouchable`, type: 'special', target: 1, name: "Không Thể Đụng Tới", desc: "Có 100 từ vựng liên tiếp được đánh giá 'Dễ' (Easy).", icon: "ph-fill ph-shield-check", tier: BADGE_TIERS.DIVINE },
    { id: `special_blind_faith`, type: 'special', target: 1, name: "Kẻ Mù Quáng", desc: "Hoàn thành một bài kiểm tra Quiz 20 câu mà sai 100% (0 điểm).", icon: "ph-fill ph-mask-sad", tier: BADGE_TIERS.EPIC },
    { id: `special_fusion`, type: 'special', target: 1, name: "Hợp Nhất Thể", desc: "Thực hiện 1000 lượt review (tổng số lần ôn) trong toàn bộ lịch sử.", icon: "ph-fill ph-atom", tier: BADGE_TIERS.MYTHIC },
    { id: `special_golden_hour`, type: 'special', target: 1, name: "Thời Khắc Vàng", desc: "Lên cấp (Level Up) đúng vào khoảng thời gian Hoàng hôn (17:00 - 18:00).", icon: "ph-fill ph-sun-horizon", tier: BADGE_TIERS.LEGENDARY },
    { id: `special_karma`, type: 'special', target: 1, name: "Nghiệp Chướng", desc: "Gặp lại đúng từ vựng mà hôm qua vừa đánh dấu 'Quên'.", icon: "ph-fill ph-arrows-clockwise", tier: BADGE_TIERS.RARE },
    { id: `special_king_returns`, type: 'special', target: 1, name: "Sự Trở Lại Của Nhà Vua", desc: "Bỏ app 1 tháng, quay lại và làm ngay một bài Quiz đạt 100% điểm.", icon: "ph-fill ph-crown", tier: BADGE_TIERS.DIVINE }
];

// Auto-generate ids for tracks
BADGE_TRACKS.forEach(track => {
    track.ids = track.milestones.map((_, index) => `${track.id}_${index}`);
});
