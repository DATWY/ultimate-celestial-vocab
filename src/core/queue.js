import { getState, setReviewQueue } from './state.js';
import { getLocalDateString } from './utils/date.js';

const INTERLEAVE_OFFSET = 5;
const MAX_NEW_PER_DAY_INITIAL = 15;
const MAX_ABSOLUTE_NEW = 40;
const CRAMMING_MAX = 10;
const DAYS_TO_MS = 24 * 60 * 60 * 1000;
const LEARNING_STEPS = 2;

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

export function computeDailyNewLimit(dailyStats) {
    if (!dailyStats) return MAX_NEW_PER_DAY_INITIAL;
    
    let limit = dailyStats.currentLimit || MAX_NEW_PER_DAY_INITIAL;

    if (dailyStats.retentionHistory && dailyStats.retentionHistory.length > 0) {
        const recent = dailyStats.retentionHistory.slice(-3);
        let totalCorrect = 0;
        let total = 0;
        
        recent.forEach(day => {
            totalCorrect += (day.correct || 0);
            total += (day.total || 0);
        });

        if (total > 0) {
            const avgRetention = totalCorrect / total;
            if (avgRetention >= 0.90) {
                limit += 5;
            } else if (avgRetention <= 0.70) {
                limit -= 5;
            }
        }
    }
    return Math.max(5, Math.min(limit, MAX_ABSOLUTE_NEW));
}

const CRAM_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 giờ cooldown sau review cuối

export function getPendingLearningCards(vocabulary, filterLowerCase = 'all') {
    const pending = [];
    for (let i = 0; i < vocabulary.length; i++) {
        const word = vocabulary[i];
        if (!word || word.isDeleted || word.isSuspended || word.srsStatus !== 'Learning') continue;
        const topicMatch = filterLowerCase === 'all' ||
            (word.tags && word.tags.map(t => t.trim().toLowerCase()).includes(filterLowerCase));
        if (topicMatch) {
            pending.push({ index: i, dueDate: word.srsDueDate || 0 });
        }
    }
    pending.sort((a, b) => a.dueDate - b.dueDate);
    return pending.map(item => item.index);
}

export function getSmartCramCards(vocabulary, filterLowerCase) {
    const now = Date.now();
    const todayStr = getLocalDateString();
    let candidates = [];

    for (let i = 0; i < vocabulary.length; i++) {
        const word = vocabulary[i];
        if (!word || word.isDeleted || word.isSuspended || word.srsStatus !== 'Mastered') continue;

        const topicMatch = filterLowerCase === 'all' ||
            (word.tags && word.tags.map(t => t.trim().toLowerCase()).includes(filterLowerCase));
            
        if (!topicMatch) continue;

        // V3: Đã sửa lại lỗi logic: Cram thẻ sẽ đến hạn trong vòng 2 ngày tới (tương lai gần)
        // thay vì tìm thẻ trễ hạn (daysUntilDue < 0) vì thẻ trễ hạn đã được buckets.due gom hết.
        const daysUntilDue = (word.srsDueDate - now) / DAYS_TO_MS;
        if (daysUntilDue < 0 || daysUntilDue > 2) continue;

        // V3: Cooldown — không Cram thẻ đã ôn trong 4 giờ gần đây
        if (word.lastReviewDate && (now - word.lastReviewDate) < CRAM_COOLDOWN_MS) continue;

        // V3: Không Cram thẻ đã ôn hôm nay (Today Filter)
        if (word.lastReviewDate) {
            const lastReviewDay = getLocalDateString(word.lastReviewDate);
            if (lastReviewDay === todayStr) continue;
        }

        candidates.push({ index: i, word, overdueDays: Math.abs(daysUntilDue) });
    }

    // Ưu tiên thẻ trễ hạn lâu nhất + khó nhất
    candidates.sort((a, b) => {
        if (a.overdueDays !== b.overdueDays) {
            return b.overdueDays - a.overdueDays; // Trễ hạn lâu nhất lên đầu
        }
        const diffA = a.word.difficulty !== undefined ? a.word.difficulty : (11 - (a.word.srsEaseFactor || 2.5) * 2);
        const diffB = b.word.difficulty !== undefined ? b.word.difficulty : (11 - (b.word.srsEaseFactor || 2.5) * 2);
        return diffB - diffA; 
    });

    return candidates.slice(0, CRAMMING_MAX).map(item => item.index);
}

export function buildReviewQueue() {
    const state = getState();
    const vocabulary = state.vocabulary;
    const dailyStats = state.dailyStats || { newCardsDoneToday: 0 }; 
    const currentTopicFilter = state.currentTopicFilter || 'all';
    const now = Date.now();
    const filterLowerCase = currentTopicFilter.trim().toLowerCase();
    
    const dailyLimit = computeDailyNewLimit(dailyStats);
    // BUG-06 FIX: Ghi nhận limit đã tính vào state để giữ memory qua các session
    if (dailyStats.currentLimit !== dailyLimit) {
        dailyStats.currentLimit = dailyLimit;
        import('./state.js').then(m => m.saveDailyStats());
    }
    const newCardsRemaining = Math.max(0, dailyLimit - dailyStats.newCardsDoneToday);

    const buckets = { due: [], learning: [], new: [] };
    
    for (let i = 0; i < vocabulary.length; i++) {
        const word = vocabulary[i];
        if (!word || word.isDeleted || word.isSuspended) continue;
        
        const topicMatch = filterLowerCase === 'all' ||
            (word.tags && word.tags.map(t => t.trim().toLowerCase()).includes(filterLowerCase));
            
        if (topicMatch) {
            // V3.2: Thẻ Mastered (đã thuộc) được tính là ĐẾN HẠN nếu hạn rơi vào bất kỳ lúc nào trong ngày hôm nay.
            // Điều này giúp Dashboard khớp với Bảng Dự Báo, và người dùng không phải chờ đến đúng giờ/phút.
            const endOfDay = new Date(now).setHours(23, 59, 59, 999);
            const isReviewedToday = word.lastReviewDate && getLocalDateString(word.lastReviewDate) === getLocalDateString(now);
            const isDue = !word.srsDueDate || 
                word.srsDueDate <= now || 
                (word.srsStatus === 'Mastered' && !isReviewedToday && word.srsDueDate <= endOfDay);
            
            if (word.srsStatus === 'Learning') {
                // V3: Phải đợi hết 5/10 phút (delay) mới được nhét lại vào hàng đợi
                if (isDue) buckets.learning.push(i);
            } else if (word.srsStatus === 'New') {
                buckets.new.push(i);
            } else if (isDue) {
                buckets.due.push(i);
            }
        }
    }
    
    shuffleArray(buckets.learning);
    shuffleArray(buckets.due);
    shuffleArray(buckets.new);
    
    let newToAdd = buckets.new.slice(0, newCardsRemaining);
    let newQueue = [...buckets.learning, ...buckets.due, ...newToAdd];
    
    // LEARN AHEAD OPTIMIZATION:
    // Nếu hàng đợi thông thường rỗng (đã xong thẻ New hôm nay và hết thẻ Due đến hạn)
    // nhưng trong kho VẪN CÒN các thẻ Đang học (Learning) đang chờ đếm ngược:
    // Tự động nạp các thẻ Learning này vào để người dùng được học dứt điểm,
    // không bắt người dùng phải chờ 5-10 phút và không hiện màn hình hoàn thành giả mạo!
    if (newQueue.length === 0) {
        const pendingLearning = getPendingLearningCards(vocabulary, filterLowerCase);
        if (pendingLearning.length > 0) {
            newQueue = [...pendingLearning];
            console.log(`⚡ Learn Ahead kích hoạt: Tự động nạp ${newQueue.length} thẻ Đang học vào hàng đợi để học liền mạch.`);
        }
    }
    
    setReviewQueue(newQueue);
    console.log(`Hàng đợi ôn tập đã tạo: ${newQueue.length} thẻ. (Giới hạn từ mới hôm nay: ${dailyLimit}, còn lại: ${newCardsRemaining})`);
}

export function getNextCardToReview() {
    let loopCount = 0;
    while (loopCount < 1000) { 
        let { currentReviewQueue, vocabulary } = getState(); 
        
        if (currentReviewQueue.length === 0) {
            buildReviewQueue();
            currentReviewQueue = getState().currentReviewQueue; 
            
            if (currentReviewQueue.length === 0) return -1;
        }
        
        // BUG-03 FIX: Tạo bản sao mới, tránh mutate trực tiếp shared reference
        const newQueue = currentReviewQueue.slice(1);
        const nextIndex = currentReviewQueue[0];
        setReviewQueue(newQueue);
        
        if (
            nextIndex !== undefined && 
            nextIndex >= 0 && 
            nextIndex < vocabulary.length && 
            vocabulary[nextIndex] && 
            !vocabulary[nextIndex].isDeleted
        ) {
            return nextIndex;
        }
        loopCount++;
    }
    return -1;
}

export function insertCardForLearningStep(cardIndex) {
    let { currentReviewQueue } = getState();
    
    // V3: Chỉ chèn lại thẻ Learning, KHÔNG gọi getSmartCramCards()
    // để tránh kéo thêm thẻ Mastered vào và gây "Review Storm"
    const newQueue = [...currentReviewQueue];
    const insertPos = Math.min(newQueue.length, INTERLEAVE_OFFSET);
    newQueue.splice(insertPos, 0, cardIndex);
    setReviewQueue(newQueue);
}

export function triggerSmartCramming() {
    const state = getState();
    const vocabulary = state.vocabulary;
    const filterLowerCase = (state.currentTopicFilter || 'all').trim().toLowerCase();
    
    // ƯU TIÊN 1: Nếu còn thẻ Đang Học chưa xong, nạp thẻ Đang Học để học dứt điểm trước
    const pendingLearning = getPendingLearningCards(vocabulary, filterLowerCase);
    if (pendingLearning.length > 0) {
        let { currentReviewQueue } = getState();
        let newQueue = [...currentReviewQueue, ...pendingLearning];
        newQueue = [...new Set(newQueue)];
        setReviewQueue(newQueue);
        console.log(`⚡ Đã nạp ưu tiên ${pendingLearning.length} thẻ Đang học vào hàng đợi.`);
        return true;
    }

    // ƯU TIÊN 2: Nạp thẻ Smart Cramming (Mastered)
    const cramCards = getSmartCramCards(vocabulary, filterLowerCase);
    if (cramCards.length > 0) {
        let { currentReviewQueue } = getState();
        let newQueue = [...currentReviewQueue, ...cramCards];
        newQueue = [...new Set(newQueue)];
        setReviewQueue(newQueue);
        console.log(`Đã nạp thủ công ${cramCards.length} thẻ Smart Cramming.`);
        return true;
    }
    return false;
}
