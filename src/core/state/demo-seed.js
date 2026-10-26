// src/core/state/demo-seed.js — T4.5b: nạp 10 thẻ mẫu cho kho kiểm thử riêng (?audit=1).
//
// Chỉ chạy khi isIsolatedStorage = true, tức bản build production KHÔNG bao giờ
// đi qua phần dữ liệu mẫu bên dưới: `import.meta.env.DEV` là hằng false nên
// bundler đã loại toàn bộ mảng mockCards khỏi entry (đo trên dist: chuỗi
// 'serendipity'/'v5_c1' không xuất hiện ở bất kỳ chunk nào). Vì vậy tách file
// này KHÔNG làm entry nhẹ thêm — nó chỉ tách cho dễ đọc; đã đo và ghi lại trong
// báo cáo T4.5b thay vì thêm một dynamic import vô ích.
import { isIsolatedStorage, saveAllVocabularyToDB } from '../idb.js';
import { setVocabulary } from './vocabulary.js';
import { gamification } from './progress-store.js';
import { saveGamification } from './gamification.js';

export async function seedIsolatedDemoVocabulary() {
    if (!isIsolatedStorage) throw new Error('Dữ liệu demo chỉ được dùng trong kho kiểm thử riêng.');
    sessionStorage.setItem('CHEAT_MODE', 'true');
    sessionStorage.setItem('ISOLATED_TEST_MODE', 'true');
    const mockCards = [
        { id: 'v5_c1', english: 'serendipity', vietnamese: 'Sự tình cờ may mắn, duyên kỳ ngộ', type: 'noun', pronunciation: '/ˌser.ənˈdɪp.ə.t̬i/', tags: ['Vocabulary', 'Advanced'], example: 'Finding this peaceful observatory was pure serendipity.', srsStatus: 'Mastered', srsInterval: 14.5, reps: 6, lapses: 0, difficulty: 4.2, stability: 14.8, stabilityShort: 11.8, isStarred: true, lastReviewDate: Date.now() - 3 * 86400000, srsDueDate: Date.now() + 11 * 86400000 },
        { id: 'v5_c2', english: 'ephemeral', vietnamese: 'Phù du, chóng tàn, ngắn ngủi', type: 'adjective', pronunciation: '/əˈfem.ər.əl/', tags: ['Philosophy', 'Literature'], example: 'Fame in the digital era can be remarkably ephemeral.', srsStatus: 'Learning', srsInterval: 2.1, reps: 3, lapses: 1, difficulty: 6.8, stability: 3.2, stabilityShort: 2.5, isStarred: false, lastReviewDate: Date.now() - 1 * 86400000, srsDueDate: Date.now() - 1000 },
        { id: 'v5_c3', english: 'quintessential', vietnamese: 'Tinh túy, hoàn hảo nhất, điển hình', type: 'adjective', pronunciation: '/ˌkwɪn.təˈsen.ʃəl/', tags: ['Academic'], example: 'Watermelon is the quintessential fruit of summer.', srsStatus: 'New', srsInterval: 0, reps: 0, lapses: 0, difficulty: 5.5, stability: 1.0, stabilityShort: 0.8, isStarred: false },
        { id: 'v5_c4', english: 'ubiquitous', vietnamese: 'Có mặt ở khắp nơi, phổ biến', type: 'adjective', pronunciation: '/juːˈbɪk.wə.t̬əs/', tags: ['Technology', 'Common'], example: 'Smartphones have become ubiquitous across all generations.', srsStatus: 'Mastered', srsInterval: 28.0, reps: 9, lapses: 0, difficulty: 3.9, stability: 28.4, stabilityShort: 22.7, isStarred: true, lastReviewDate: Date.now() - 5 * 86400000, srsDueDate: Date.now() + 23 * 86400000 },
        { id: 'v5_c5', english: 'resilience', vietnamese: 'Khả năng phục hồi, kiên cường', type: 'noun', pronunciation: '/rɪˈzɪl.jəns/', tags: ['Psychology'], example: 'Her resilience helped her rebuild a life after the flood.', srsStatus: 'Learning', srsInterval: 3.5, reps: 4, lapses: 1, difficulty: 5.1, stability: 4.0, stabilityShort: 3.2, isStarred: false, lastReviewDate: Date.now() - 2 * 86400000, srsDueDate: Date.now() - 5000 },
        { id: 'v5_c6', english: 'meticulous', vietnamese: 'Tỉ mỉ, cẩn thận từng chi tiết', type: 'adjective', pronunciation: '/məˈtɪk.jə.ləs/', tags: ['Academic', 'Work'], example: 'She kept meticulous notes throughout the entire experiment.', srsStatus: 'Mastered', srsInterval: 18.0, reps: 7, lapses: 0, difficulty: 4.5, stability: 18.2, stabilityShort: 14.5, isStarred: false, lastReviewDate: Date.now() - 4 * 86400000, srsDueDate: Date.now() + 14 * 86400000 },
        { id: 'v5_c7', english: 'pragmatic', vietnamese: 'Thực dụng, thực tế, trọng hành động', type: 'adjective', pronunciation: '/præɡˈmæt̬.ɪk/', tags: ['Philosophy', 'Business'], example: 'We need to adopt a pragmatic approach to solving this crisis.', srsStatus: 'Learning', srsInterval: 2.8, reps: 3, lapses: 0, difficulty: 5.8, stability: 2.8, stabilityShort: 2.2, isStarred: false, lastReviewDate: Date.now() - 1 * 86400000, srsDueDate: Date.now() + 1.8 * 86400000 },
        { id: 'v5_c8', english: 'conundrum', vietnamese: 'Bài toán hóc búa, câu hỏi nan giải', type: 'noun', pronunciation: '/kəˈnʌn.drəm/', tags: ['Academic', 'Logic'], example: 'Arranging the schedule proved to be a difficult conundrum.', srsStatus: 'Learning', srsInterval: 1.2, reps: 5, lapses: 2, difficulty: 7.8, stability: 1.8, stabilityShort: 1.4, isStarred: false, lastReviewDate: Date.now() - 1 * 86400000, srsDueDate: Date.now() - 10000 },
        { id: 'v5_c9', english: 'empathy', vietnamese: 'Sự thấu cảm, đồng cảm sâu sắc', type: 'noun', pronunciation: '/ˈem.pə.θi/', tags: ['Psychology', 'Personal'], example: 'Empathy allows us to build meaningful connections with others.', srsStatus: 'Mastered', srsInterval: 21.0, reps: 8, lapses: 0, difficulty: 3.5, stability: 21.0, stabilityShort: 16.8, isStarred: true, lastReviewDate: Date.now() - 6 * 86400000, srsDueDate: Date.now() + 15 * 86400000 },
        { id: 'v5_c10', english: 'paradigm', vietnamese: 'Mô hình mẫu, hệ hình tư duy', type: 'noun', pronunciation: '/ˈper.ə.daɪm/', tags: ['Science', 'Research'], example: 'The discovery caused a major paradigm shift in modern physics.', srsStatus: 'New', srsInterval: 0, reps: 0, lapses: 0, difficulty: 6.0, stability: 1.0, stabilityShort: 0.8, isStarred: false }
    ];

    setVocabulary(mockCards);
    await saveAllVocabularyToDB(mockCards);

    gamification.userXP = 1420;
    gamification.currentLevel = 4;
    gamification.currentStreak = 12;
    gamification.totalReviews = 94;
    gamification.activityHeatmap = {
        '2026-10-17': 18,
        '2026-10-16': 24,
        '2026-10-15': 15,
        '2026-10-14': 32,
        '2026-10-13': 14,
        '2026-10-12': 28,
        '2026-10-11': 20
    };
    await saveGamification();
    return mockCards;
}
