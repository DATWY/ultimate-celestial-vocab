// src/core/srs.js

import { getState, setReviewQueue } from './state.js';

// --- CẤU HÌNH THUẬT TOÁN SRS THÔNG MINH ---
const SRS_INITIAL_INTERVAL_MINUTES = 5;
const SRS_BASE_EASE_FACTOR = 2.5;
const SRS_MIN_EASE_FACTOR = 1.3;
const SRS_EASE_MODIFIER_EASY = 0.15;
const SRS_EASE_MODIFIER_FORGET = 0.20;
const EASY_BONUS = 1.3;
const LAPSE_MULTIPLIER = 0.2; 
const LEECH_THRESHOLD = 5;
const FUZZ_PERCENTAGE = 0.05;

const MINUTES_TO_MS = 60 * 1000;
const DAYS_TO_MS = 24 * 60 * 60 * 1000;

// --- CẤU HÌNH NÂNG CẤP MỚI ---
export const LEARNING_STEPS = 2;          // Số bước ươm mầm trong phiên
export const INTERLEAVE_OFFSET = 5;       // Khoảng cách chèn thẻ khi ươm mầm/quên
const MAX_NEW_PER_DAY_INITIAL = 15;
const MAX_ABSOLUTE_NEW = 40;
const CRAMMING_MAX = 10;
const LATE_REVIEW_CAP_MULTIPLIER = 2.5;   // Giới hạn review trễ không quá 2.5 lần chu kỳ
const HARD_INTERVAL_MULTIPLIER = 1.2;     // Nhấn Hard chỉ tăng chu kỳ lên 1.2 lần

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

/**
 * Tính toán giới hạn từ mới hôm nay dựa trên lịch sử ghi nhớ (dailyStats)
 */
export function computeDailyNewLimit(dailyStats) {
    // Nếu chưa có dữ liệu, dùng mặc định
    if (!dailyStats) return MAX_NEW_PER_DAY_INITIAL;
    
    let limit = dailyStats.currentLimit || MAX_NEW_PER_DAY_INITIAL;

    // Phân tích lịch sử 3 ngày gần nhất nếu có
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
                limit += 5; // Nhớ tốt -> Tăng tải
            } else if (avgRetention <= 0.70) {
                limit -= 5; // Nhớ kém -> Giảm tải
            }
        }
    }

    // Đảm bảo không vượt trần/sàn
    return Math.max(5, Math.min(limit, MAX_ABSOLUTE_NEW));
}

/**
 * Lấy danh sách thẻ để Smart Cramming (Ôn tập thông minh)
 */
function getSmartCramCards(vocabulary, filterLowerCase) {
    const now = Date.now();
    let candidates = [];

    for (let i = 0; i < vocabulary.length; i++) {
        const word = vocabulary[i];
        // Chỉ lấy thẻ đã Mastered, không bị đình chỉ hay xóa
        if (!word || word.isDeleted || word.isSuspended || word.srsStatus !== 'Mastered') continue;

        const topicMatch = filterLowerCase === 'all' ||
            (word.tags && word.tags.map(t => t.trim().toLowerCase()).includes(filterLowerCase));
            
        if (!topicMatch) continue;

        const daysUntilDue = (word.srsDueDate - now) / DAYS_TO_MS;
        
        // Tiêu chí: Sắp đến hạn (< 2 ngày), khó (ease < 2.0) hoặc hay quên (lapses >= 3)
        if (daysUntilDue <= 2 || word.srsEaseFactor < 2.0 || word.lapses >= 3) {
            candidates.push({ index: i, word });
        }
    }

    // Ưu tiên thẻ sắp đến hạn trước, sau đó ưu tiên thẻ có easeFactor thấp (khó)
    candidates.sort((a, b) => {
        if (a.word.srsDueDate !== b.word.srsDueDate) {
            return a.word.srsDueDate - b.word.srsDueDate;
        }
        return a.word.srsEaseFactor - b.word.srsEaseFactor;
    });

    // Lấy tối đa CRAMMING_MAX thẻ
    return candidates.slice(0, CRAMMING_MAX).map(item => item.index);
}

export function buildReviewQueue() {
    const state = getState();
    const vocabulary = state.vocabulary;
    // Khởi tạo dailyStats tạm nếu chưa có trong state
    const dailyStats = state.dailyStats || { newCardsDoneToday: 0 }; 
    const currentTopicFilter = state.currentTopicFilter || 'all';
    const now = Date.now();
    const filterLowerCase = currentTopicFilter.trim().toLowerCase();
    
    // Tính giới hạn thẻ mới hôm nay
    const dailyLimit = computeDailyNewLimit(dailyStats);
    const newCardsRemaining = Math.max(0, dailyLimit - dailyStats.newCardsDoneToday);

    const buckets = { due: [], learning: [], new: [] };
    
    for (let i = 0; i < vocabulary.length; i++) {
        const word = vocabulary[i];
        // Bỏ qua thẻ đã xóa (và thẻ cũ bị suspend nếu có)
        if (!word || word.isDeleted || word.isSuspended) continue;
        
        const topicMatch = filterLowerCase === 'all' ||
            (word.tags && word.tags.map(t => t.trim().toLowerCase()).includes(filterLowerCase));
            
        if (topicMatch) {
            const isLearningStep = word.learningStep > 0 && word.learningStep < LEARNING_STEPS;
            
            // Ưu tiên 1: Thẻ đang ươm mầm hoặc trạng thái Learning
            if (word.srsStatus === 'Learning' || isLearningStep) {
                buckets.learning.push(i);
            } 
            // Ưu tiên 2: Thẻ đến hạn
            else if (word.srsDueDate && word.srsDueDate <= now) {
                buckets.due.push(i);
            } 
            // Ưu tiên 3: Thẻ mới hoàn toàn
            else if (word.srsStatus === 'New' && (!word.learningStep || word.learningStep === 0)) {
                buckets.new.push(i);
            }
        }
    }
    
    // Trộn ngẫu nhiên từng xô
    shuffleArray(buckets.learning);
    shuffleArray(buckets.due);
    shuffleArray(buckets.new);
    
    // Giới hạn số lượng thẻ mới theo quota trong ngày
    let newToAdd = buckets.new.slice(0, newCardsRemaining);
    let newQueue = [...buckets.learning, ...buckets.due, ...newToAdd];
    
    // Smart Cramming: Nếu hàng đợi quá ít (< 5), tự động lấy thẻ khó/sắp đến hạn
    if (newQueue.length < 5) {
        console.log("Hàng đợi ít thẻ. Đang tìm thẻ ôn tập thông minh (Smart Cramming)...");
        const cramCards = getSmartCramCards(vocabulary, filterLowerCase);
        if (cramCards.length > 0) {
            newQueue = [...newQueue, ...cramCards];
            // Loại bỏ trùng lặp nếu có
            newQueue = [...new Set(newQueue)];
        }
    }
    
    setReviewQueue(newQueue);
    console.log(`Hàng đợi ôn tập đã tạo: ${newQueue.length} thẻ. (Giới hạn từ mới hôm nay: ${dailyLimit}, còn lại: ${newCardsRemaining})`);
}

export function getNextCardToReview() {
    let loopCount = 0;
    while (loopCount < 1000) { // Safety break
        let { currentReviewQueue, vocabulary } = getState(); 
        
        if (currentReviewQueue.length === 0) {
            buildReviewQueue();
            currentReviewQueue = getState().currentReviewQueue; 
            
            if (currentReviewQueue.length === 0) return -1; // Không còn gì để học
        }
        
        const nextIndex = currentReviewQueue.shift();
        setReviewQueue(currentReviewQueue);
        
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

/**
 * Hàm tiện ích để Controller gọi khi một thẻ cần được lặp lại (ươm mầm)
 * Chèn thẻ trở lại hàng đợi sau một khoảng offset.
 */
export function insertCardForLearningStep(cardIndex) {
    let { currentReviewQueue, vocabulary, currentTopicFilter } = getState();
    
    // Time Buffer Mechanism: If the queue is too short, fetch Cram Cards to interleave
    if (currentReviewQueue.length < INTERLEAVE_OFFSET) {
        const filterLowerCase = (currentTopicFilter || 'all').trim().toLowerCase();
        const cramCards = getSmartCramCards(vocabulary, filterLowerCase);
        const uniqueCramCards = cramCards.filter(idx => idx !== cardIndex && !currentReviewQueue.includes(idx));
        
        // Push up to 3 cram cards to create a time buffer
        currentReviewQueue.push(...uniqueCramCards.slice(0, 3));
    }
    
    // Chèn vào vị trí cách hiện tại INTERLEAVE_OFFSET, hoặc cuối mảng nếu mảng ngắn hơn
    const insertPos = Math.min(currentReviewQueue.length, INTERLEAVE_OFFSET);
    currentReviewQueue.splice(insertPos, 0, cardIndex);
    setReviewQueue(currentReviewQueue);
}

/**
 * Tính toán trạng thái SRS tiếp theo dựa trên 4 mức Rating
 * rating: 0 = Again, 1 = Hard, 2 = Good, 3 = Easy
 */
export function calculateNextSrsState(card, rating) {
    const now = Date.now();
    const newState = { ...card };

    // Khởi tạo các giá trị mặc định nếu thiếu
    newState.srsStatus = newState.srsStatus || 'New';
    newState.learningStep = newState.learningStep || 0;
    newState.srsInterval = newState.srsInterval || 0;
    newState.srsEaseFactor = newState.srsEaseFactor || SRS_BASE_EASE_FACTOR;
    newState.lapses = newState.lapses || 0;
    newState.isDifficult = newState.isDifficult || false;

    let nextIntervalDays = newState.srsInterval;
    let nextDueDate = now;

    // NÂNG CẤP LATE REVIEW: Tính số ngày thực tế đã trôi qua kèm giới hạn trần (Capped)
    const expectedLastReview = newState.srsDueDate 
        ? (newState.srsDueDate - newState.srsInterval * DAYS_TO_MS) 
        : now;
    let actualDaysElapsed = Math.max(newState.srsInterval, (now - expectedLastReview) / DAYS_TO_MS);
    
    // Giới hạn Late review không vượt quá 2.5 lần chu kỳ cũ để tránh thẻ bay quá xa
    actualDaysElapsed = Math.min(actualDaysElapsed, Math.max(1, newState.srsInterval * LATE_REVIEW_CAP_MULTIPLIER));

    // Xác định thẻ có đang trong giai đoạn ươm mầm (Learning Steps) hay không
    const isLearningStep = (newState.srsStatus === 'New' || newState.srsStatus === 'Learning') 
                           && newState.learningStep > 0 
                           && newState.learningStep < LEARNING_STEPS;

    if (rating === 0) { // --- 0: AGAIN (Quên) ---
        newState.lapses += 1;
        newState.srsEaseFactor = Math.max(SRS_MIN_EASE_FACTOR, newState.srsEaseFactor - SRS_EASE_MODIFIER_FORGET);

        // Xử lý Leech mềm (Không suspend)
        if (newState.lapses >= LEECH_THRESHOLD) {
            newState.isDifficult = true;
            newState.srsEaseFactor = SRS_MIN_EASE_FACTOR; // Khóa Ease ở mức thấp
            newState.srsStatus = 'Learning';
            newState.learningStep = 1; // Bắt đầu lại quy trình ươm mầm
            nextIntervalDays = 0;
            nextDueDate = now; // Cần chèn lại vào queue
        } else {
            if (isLearningStep) {
                // Đang ươm mầm mà quên -> Reset về bước 1
                newState.learningStep = 1;
                nextDueDate = now; // Báo hiệu cần chèn lại vào queue
            } else {
                // Đã Mastered mà quên -> rớt xuống Learning, giữ lại 20% chu kỳ
                if (newState.srsStatus === 'Mastered') {
                    nextIntervalDays = Math.max(1, Math.round(newState.srsInterval * LAPSE_MULTIPLIER));
                } else {
                    nextIntervalDays = 0;
                }
                newState.srsStatus = 'Learning';
                newState.learningStep = 1; // Khởi động lại learning steps
                nextDueDate = now; // Sẽ ôn lại ngay trong phiên
            }
        }
    } 
    else if (rating === 1 || rating === 2) { // --- 1: GOOD (Nhớ) / 2: EASY (Dễ) ---
        if (rating === 2) {
            // Escape Ease Hell Bonus
            if (newState.srsEaseFactor < 2.0) {
                newState.srsEaseFactor += 0.30; 
            } else {
                newState.srsEaseFactor += SRS_EASE_MODIFIER_EASY;
            }
        }

        // Nếu mới hoàn toàn, đánh dấu bắt đầu ươm mầm
        if (newState.srsStatus === 'New' && newState.learningStep === 0) {
            newState.learningStep = 1;
        }

        const currentlyLearning = isLearningStep || (newState.srsStatus === 'New' || newState.srsStatus === 'Learning');

        if (currentlyLearning && newState.learningStep > 0) {
            newState.learningStep += (rating === 2 ? 2 : 1); // Easy bỏ qua step, Good tăng 1 step

            if (newState.learningStep > LEARNING_STEPS) {
                // Tốt nghiệp ươm mầm -> Chuyển sang Mastered
                newState.srsStatus = 'Mastered';
                newState.learningStep = 0;
                
                // Chu kỳ đầu tiên sau tốt nghiệp
                nextIntervalDays = (rating === 2) ? 4 : 1;
                nextDueDate = now + nextIntervalDays * DAYS_TO_MS;
            } else {
                // Chưa tốt nghiệp -> Cần chèn lại vào hàng đợi trong phiên
                nextDueDate = now; 
            }
        } else {
            // Xử lý thẻ Mastered thông thường
            nextIntervalDays = Math.max(1, Math.round(actualDaysElapsed * newState.srsEaseFactor));
            if (rating === 2) {
                nextIntervalDays = Math.max(4, Math.round(nextIntervalDays * EASY_BONUS));
            }
            newState.srsStatus = 'Mastered';
            newState.learningStep = 0;
            nextDueDate = now + nextIntervalDays * DAYS_TO_MS;
        }
    }

    // FUZZING: Thêm độ nhiễu để tránh các thẻ tụ tập thành chùm (Chỉ áp dụng nếu >= 2 ngày và không phải thẻ chèn lại)
    if (nextIntervalDays > 1 && nextDueDate > now) {
        const fuzz = Math.max(1, Math.round(nextIntervalDays * FUZZ_PERCENTAGE));
        const fuzzOffset = Math.floor(Math.random() * (fuzz * 2 + 1)) - fuzz;
        nextIntervalDays = Math.max(1, nextIntervalDays + fuzzOffset);
        nextDueDate = now + nextIntervalDays * DAYS_TO_MS;
    }

    newState.srsInterval = nextIntervalDays;
    newState.srsDueDate = nextDueDate;
    newState.updatedAt = now;

    return newState;
}