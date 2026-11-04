import { getState, setReviewQueue, ensureDailyStats } from './state.js';
import { getLocalDateString } from './utils/date.js';
import { isCardReviewable } from './review-policy.js';
import { isLeechCard } from './srs/index.js';
import { getSettingFromDB, saveSettingToDB } from './idb.js';
import { skipPersistence } from './state/preview-mode.js';

const INTERLEAVE_OFFSET = 5;
const MAX_NEW_PER_DAY_INITIAL = 15;
const MAX_ABSOLUTE_NEW = 40;
const CRAMMING_MAX = 10;
const DAYS_TO_MS = 24 * 60 * 60 * 1000;
// Thẻ vừa chấm chỉ được chèn lại ngay khi hạn của nó đã tới (sai số 10s do nhịp UI).
const LEARNING_REINSERT_GRACE_MS = 10000;

// ─── T1.5 — CAP SỐ LƯỢT ÔN / NGÀY ────────────────────────────────────────────
// Hai cap ĐỘC LẬP nhưng không cộng vượt trần:
//   • computeDailyNewLimit() giới hạn riêng thẻ MỚI (5–40/ngày, giữ nguyên).
//   • maxReviewsPerDay giới hạn tổng lượt của hai nhóm được đếm vào ngân sách:
//     thẻ mới + thẻ Mastered đến hạn (dailyStats.newCardsDoneToday +
//     dailyStats.dueDoneToday).
// Thẻ Learning sub-day (1p/10p) KHÔNG bị cap: chặn chúng sẽ phá đúng lịch
// 1p/10p mà T1.1 vừa dựng. Vì vậy cap chỉ cắt buckets.due (+ phần thẻ mới dùng
// chung ngân sách), không cắt buckets.learning.
export const REVIEW_CAP_SETTINGS_KEY = 'reviewCapSettings';
export const MAX_REVIEWS_PER_DAY_DEFAULT = 200;
export const MAX_REVIEWS_PER_DAY_MIN = 50;
export const MAX_REVIEWS_PER_DAY_MAX = 500;

let _maxReviewsPerDay = MAX_REVIEWS_PER_DAY_DEFAULT;
let _reviewCapUpdatedAt = 0;

/** Chuẩn hoá cấu hình: thiếu/rác → 200; số hợp lệ → kẹp [50, 500], làm tròn. */
export function normalizeMaxReviewsPerDay(value) {
    if ((typeof value !== 'number' && typeof value !== 'string')
        || (typeof value === 'string' && !value.trim())) return MAX_REVIEWS_PER_DAY_DEFAULT;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return MAX_REVIEWS_PER_DAY_DEFAULT;
    return Math.min(MAX_REVIEWS_PER_DAY_MAX, Math.max(MAX_REVIEWS_PER_DAY_MIN, Math.round(numeric)));
}

function normalizeReviewCapTimestamp(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function readReviewCapSettings(settings) {
    return {
        maxReviewsPerDay: normalizeMaxReviewsPerDay(settings?.maxReviewsPerDay),
        updatedAt: normalizeReviewCapTimestamp(settings?.updatedAt)
    };
}

export function getReviewCapSettings() {
    return { maxReviewsPerDay: _maxReviewsPerDay, updatedAt: _reviewCapUpdatedAt };
}

/** LWW theo updatedAt — dùng chung cho IDB reload và document settings trên Cloud. */
export function mergeReviewCapSettings(local, remote) {
    const a = readReviewCapSettings(local);
    const b = readReviewCapSettings(remote);
    return b.updatedAt && (!a.updatedAt || b.updatedAt > a.updatedAt) ? b : a;
}

async function persistReviewCapSettings() {
    if (skipPersistence()) return;
    await saveSettingToDB(REVIEW_CAP_SETTINGS_KEY, getReviewCapSettings()).catch(() => {});
}

/** Đọc lại cap đã lưu (gọi trong loadVocabulary, giống loadTtsSettings). */
export async function loadReviewCapSettings() {
    const saved = await getSettingFromDB(REVIEW_CAP_SETTINGS_KEY).catch(() => null);
    if (saved) {
        const loaded = readReviewCapSettings(saved);
        _maxReviewsPerDay = loaded.maxReviewsPerDay;
        _reviewCapUpdatedAt = loaded.updatedAt;
    }
    return getReviewCapSettings();
}

export async function setMaxReviewsPerDay(value, updatedAt = Date.now()) {
    _maxReviewsPerDay = normalizeMaxReviewsPerDay(value);
    _reviewCapUpdatedAt = normalizeReviewCapTimestamp(updatedAt) || Date.now();
    await persistReviewCapSettings();
    return _maxReviewsPerDay;
}

/**
 * Ngân sách còn lại của ngày. `used` = thẻ mới đã chấm đạt + thẻ Mastered đến
 * hạn đã chấm đạt. Thẻ Learning sub-day không nằm trong ngân sách này.
 */
export function getReviewBudget(dailyStats = getState().dailyStats) {
    const state = getState();
    const limit = _maxReviewsPerDay;
    const used = Math.max(0, Math.floor(Number(dailyStats?.dueDoneToday) || 0))
        + Math.max(0, Math.floor(Number(dailyStats?.newCardsDoneToday) || 0));
    // Thẻ đang mở trước mặt là một lượt ĐANG học: nếu rebuild queue lúc này
    // (Cloud sync, đổi topic, đổi cap...) mà không giữ chỗ, nó sẽ cộng thêm
    // một thẻ nữa và tổng ngày vượt trần đúng 1 thẻ.
    const current = state.vocabulary?.[state.currentCardIndex];
    const today = getLocalDateString();
    const reserved = current && !current.isDeleted && current.srsStatus === 'Mastered'
        && !(current.lastReviewDate && getLocalDateString(current.lastReviewDate) === today)
        && current.srsDueDate && current.srsDueDate <= new Date().setHours(23, 59, 59, 999) ? 1 : 0;
    return { limit, used, reserved, remaining: Math.max(0, limit - used - reserved) };
}

/** Các thẻ Mastered đang đến hạn (đúng predicate của buildReviewQueue). */
function collectDueMasteredIndexes(vocabulary, filterLowerCase, now = Date.now()) {
    const endOfDay = new Date(now).setHours(23, 59, 59, 999);
    const todayStr = getLocalDateString(now);
    const due = [];
    for (let i = 0; i < vocabulary.length; i++) {
        const word = vocabulary[i];
        if (!word || word.isDeleted || word.isSuspended || word.srsStatus !== 'Mastered') continue;
        if (!cardMatchesTopic(word, filterLowerCase)) continue;
        if (word.lastReviewDate && getLocalDateString(word.lastReviewDate) === todayStr) continue;
        if (!word.srsDueDate || word.srsDueDate <= endOfDay) due.push(i);
    }
    return due;
}

/**
 * Trạng thái cap cho UI. `deferredDue` = số thẻ đến hạn CHƯA được nạp
 * (vẫn due, không đổi hạn) — dùng cho câu "còn N thẻ đến hạn, mai học tiếp".
 */
export function getReviewCapStatus() {
    const state = getState();
    const budget = getReviewBudget(state.dailyStats);
    const queued = new Set(state.currentReviewQueue || []);
    const filter = (state.currentTopicFilter || 'all').trim().toLowerCase();
    const deferredDue = collectDueMasteredIndexes(state.vocabulary || [], filter)
        .filter(index => !queued.has(index)).length;
    return { ...budget, deferredDue, reached: !budget.remaining && deferredDue > 0 };
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

export function computeDailyNewLimit(dailyStats, today = getLocalDateString()) {
    if (!dailyStats) return MAX_NEW_PER_DAY_INITIAL;
    
    let limit = dailyStats.currentLimit || MAX_NEW_PER_DAY_INITIAL;
    if (dailyStats.limitAdjustedDate === today) return Math.max(5, Math.min(limit, MAX_ABSOLUTE_NEW));

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

function cardMatchesTopic(word, filterLowerCase) {
    if (!word || !filterLowerCase || filterLowerCase === 'all') return true;
    const tagsArr = Array.isArray(word.tags) ? word.tags : (typeof word.tags === 'string' ? word.tags.split(',') : []);
    return tagsArr.some(t => t && String(t).trim().toLowerCase() === filterLowerCase);
}

export function getPendingLearningCards(vocabulary, filterLowerCase = 'all') {
    const pending = [];
    for (let i = 0; i < vocabulary.length; i++) {
        const word = vocabulary[i];
        if (!word || word.isDeleted || word.isSuspended || word.srsStatus !== 'Learning') continue;
        const topicMatch = cardMatchesTopic(word, filterLowerCase);
        if (topicMatch) {
            pending.push({ index: i, dueDate: word.srsDueDate || 0 });
        }
    }
    pending.sort((a, b) => a.dueDate - b.dueDate);
    return pending.map(item => item.index);
}

/**
 * T1.1 — Thẻ Learning phải quay lại ĐÚNG hạn, không bị đảo thứ tự ngẫu nhiên:
 * sắp theo srsDueDate tăng dần (thẻ Quên 1 phút luôn đứng trước thẻ Khó 10 phút).
 * @param {Array} vocabulary
 * @param {number[]} indexes
 * @returns {number[]}
 */
export function orderLearningByDue(vocabulary, indexes) {
    return [...indexes].sort((a, b) => (vocabulary[a]?.srsDueDate || 0) - (vocabulary[b]?.srsDueDate || 0));
}

export function getSmartCramCards(vocabulary, filterLowerCase) {
    const now = Date.now();
    const todayStr = getLocalDateString();
    const candidates = [];

    for (let i = 0; i < vocabulary.length; i++) {
        const word = vocabulary[i];
        if (!word || word.isDeleted || word.isSuspended || word.srsStatus !== 'Mastered') continue;

        const topicMatch = cardMatchesTopic(word, filterLowerCase);
            
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
    ensureDailyStats();
    const state = getState();
    const vocabulary = state.vocabulary;
    const dailyStats = state.dailyStats || { newCardsDoneToday: 0 }; 
    const currentTopicFilter = state.currentTopicFilter || 'all';
    const now = Date.now();
    const filterLowerCase = currentTopicFilter.trim().toLowerCase();
    
    const dailyLimit = computeDailyNewLimit(dailyStats);
    // BUG-06 FIX: Ghi nhận limit đã tính vào state để giữ memory qua các session
    if (dailyStats.currentLimit !== dailyLimit || dailyStats.limitAdjustedDate !== getLocalDateString()) {
        dailyStats.limitAdjustedDate = getLocalDateString();
        dailyStats.currentLimit = dailyLimit;
        import('./state.js').then(m => m.saveDailyStats());
    }
    const newCardsRemaining = Math.max(0, dailyLimit - dailyStats.newCardsDoneToday);

    const buckets = { due: [], learning: [], new: [] };
    
    for (let i = 0; i < vocabulary.length; i++) {
        const word = vocabulary[i];
        if (!word || word.isDeleted || word.isSuspended) continue;
        
        const topicMatch = cardMatchesTopic(word, filterLowerCase);
            
        if (topicMatch) {
            // V3.2: Thẻ Mastered (đã thuộc) được tính là ĐẾN HẠN nếu hạn rơi vào bất kỳ lúc nào trong ngày hôm nay.
            // SỬA LỖI KB 2.1: Nếu đã ôn hôm nay rồi (isReviewedToday = true), tuyệt đối không coi là Đến Hạn trong cùng ngày nữa!
            // P2: dùng predicate dùng chung (isNaturallyDue) để dock thống kê và hàng đợi
            // không bao giờ lệch nhau nữa.
            const isDue = isNaturallyDue(word, now);
            
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
    
    // Thẻ Learning không xáo trộn: giữ đúng thứ tự hạn (1 phút trước 10 phút trước 1 ngày).
    buckets.learning = orderLearningByDue(vocabulary, buckets.learning);
    shuffleArray(buckets.due);
    shuffleArray(buckets.new);

    // T1.5 — hai cap độc lập nhưng tổng không vượt maxReviewsPerDay:
    //   thẻ mới vẫn được phần của cap riêng (không bị cap lượt ôn cắt riêng),
    //   thẻ đến hạn dùng phần ngân sách còn lại. Thẻ Learning sub-day nằm ngoài
    //   ngân sách nên luôn được nạp đủ.
    const reviewBudget = getReviewBudget(dailyStats);
    const newToAddCount = Math.min(buckets.new.length, newCardsRemaining, reviewBudget.remaining);
    const dueToAddCount = Math.min(buckets.due.length, Math.max(0, reviewBudget.remaining - newToAddCount));
    const deferredDue = buckets.due.length - dueToAddCount;
    let newQueue = [...buckets.learning, ...buckets.due.slice(0, dueToAddCount), ...buckets.new.slice(0, newToAddCount)];
    
    // LEARN AHEAD: chỉ nạp thẻ Đang học ĐÃ tới hạn.
    // Từ T1.1 thẻ Learning có bước 1 phút / 10 phút; nạp sớm sẽ vô hiệu hoá bước học
    // (thẻ vừa chấm hiện lại sau vài giây). Thẻ chưa tới hạn để nguyên cho lần build sau:
    // Victory Stage vẫn báo "còn N từ đang trong bước ghi nhớ ngắn hạn" và người dùng có thể
    // chủ động học sớm bằng nút "Học dứt điểm" (triggerSmartCramming).
    if (newQueue.length === 0) {
        const dueLearning = getPendingLearningCards(vocabulary, filterLowerCase)
            .filter(index => !vocabulary[index]?.srsDueDate || vocabulary[index].srsDueDate <= now);
        if (dueLearning.length > 0) {
            newQueue = dueLearning;
            console.log(`⚡ Learn Ahead kích hoạt: nạp ${newQueue.length} thẻ Đang học đã tới hạn.`);
        }
    }
    
    setReviewQueue(newQueue);
    console.log(`Hàng đợi ôn tập đã tạo: ${newQueue.length} thẻ. (Giới hạn từ mới hôm nay: ${dailyLimit}, còn lại: ${newCardsRemaining}; giới hạn lượt ôn: ${reviewBudget.limit}, đã dùng: ${reviewBudget.used}, hoãn ${deferredDue} thẻ đến hạn)`);
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
            // AUDIT-R2.4: thẻ có thể bị "Tạm ẩn" sau khi đã vào hàng đợi (đổi ở tab khác). Bỏ
            // qua bằng CÙNG điều kiện hợp lệ với cửa chấm, thay vì chỉ kiểm isDeleted rồi để
            // processSrsFeedback ghi SRS cho thẻ người dùng đã ẩn.
            isCardReviewable(vocabulary[nextIndex])
        ) {
            return nextIndex;
        }
        loopCount++;
    }
    return -1;
}

export function insertCardForLearningStep(cardIndex) {
    const { currentReviewQueue, vocabulary } = getState();
    
    // SỬA LỖI KB 3.2: Kiểm tra chống chèn trùng lặp thẻ vào hàng đợi
    if (currentReviewQueue.includes(cardIndex)) return;

    // T1.4: thẻ LEECH (đã quên >= 4 lần) không bao giờ được nhồi lại ngay trong phiên.
    // Engine đã hẹn nó +10 phút; chặn ở đây để kể cả khi nơi gọi bỏ qua mốc thời gian
    // thì thẻ vẫn không quay về vị trí thứ 5 như massed practice cũ.
    if (isLeechCard(vocabulary?.[cardIndex])) return;

    // T1.1: chỉ chèn lại khi hạn của thẻ đã tới. Thẻ còn đang trong bước 10 phút / 1 ngày
    // KHÔNG được hiện lại ngay; buildReviewQueue sẽ nhặt nó khi srsDueDate tới.
    const cardDueDate = vocabulary?.[cardIndex]?.srsDueDate;
    if (cardDueDate && cardDueDate > Date.now() + LEARNING_REINSERT_GRACE_MS) return;

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
        const { currentReviewQueue } = getState();
        let newQueue = [...currentReviewQueue, ...pendingLearning];
        newQueue = [...new Set(newQueue)];
        setReviewQueue(newQueue);
        console.log(`⚡ Đã nạp ưu tiên ${pendingLearning.length} thẻ Đang học vào hàng đợi.`);
        return true;
    }

    // ƯU TIÊN 2: Nạp thẻ Smart Cramming (Mastered)
    const cramCards = getSmartCramCards(vocabulary, filterLowerCase);
    if (cramCards.length > 0) {
        const { currentReviewQueue } = getState();
        let newQueue = [...currentReviewQueue, ...cramCards];
        newQueue = [...new Set(newQueue)];
        setReviewQueue(newQueue);
        console.log(`Đã nạp thủ công ${cramCards.length} thẻ Smart Cramming.`);
        return true;
    }
    return false;
}

/**
 * P2: predicate "thẻ đến hạn TỰ NHIÊN" — nguồn sự thật DUY NHẤT cho cả buildReviewQueue
 * và dock thống kê (render.js). Trước đây mỗi nơi tự viết một bản; bản trong render.js
 * thiếu điều kiện "Mastered đã ôn hôm nay thì không tính" nên dock báo "Cần ôn" cao hơn
 * số thẻ thật sự vào phiên học.
 *
 * Thẻ CHƯA có srsDueDate vẫn được coi là đến hạn (giữ đúng hành vi cũ của buildReviewQueue);
 * nơi nào không muốn vậy thì tự kiểm tra srsDueDate trước khi gọi.
 */
export function isNaturallyDue(word, now = Date.now()) {
    if (!word || word.isDeleted || word.isSuspended) return false;
    // C′-thay-thế (PHASE 9): thẻ TẠM ẨN không bao giờ tới hạn. Trước đây cờ
    // `isSuspended` có trong dữ liệu nhưng KHÔNG nơi nào đọc ⇒ không có cách
    // trung thực nào để nói "từ này tôi đã biết" (ngoài đường tắt sai khoa học).
    if (word.isSuspended) return false;
    // AUDIT-R3.3: thẻ Mastered phải xét "đã ôn hôm nay" TRƯỚC khi xét ngày hẹn. Bản trước trả
    // `true` ngay cho mọi thẻ thiếu `srsDueDate`, kể cả thẻ vừa ôn xong trong ngày — vừa mâu
    // thuẫn với `classifyReview`, vừa khiến thẻ legacy không ngày hẹn bị mời ôn lặp lại.
    if (word.srsStatus === 'Mastered') {
        const reviewedToday = word.lastReviewDate &&
            getLocalDateString(word.lastReviewDate) === getLocalDateString(now);
        if (reviewedToday) return false;
        if (!word.srsDueDate) return true;      // legacy: không có ngày hẹn ⇒ coi là đến hạn
        const endOfDay = new Date(now).setHours(23, 59, 59, 999);
        return word.srsDueDate <= endOfDay;
    }
    if (!word.srsDueDate) return true;
    return word.srsDueDate <= now;
}
