// src/features/typing.js

let typingStartTime = 0;
let cognitiveRetrievalTime = -1; // Chốt thời gian nhận thức ròng ngay tại ký tự hợp lệ đầu tiên
let totalPauseTime = 0;
let pauseStartTime = 0;
let isPaused = false;

let _stateTrackEvent = null;
function trackEvent(name, amount = 1) {
    if (_stateTrackEvent) {
        _stateTrackEvent(name, amount);
    } else if (typeof window !== 'undefined') {
        import('../core/state.js').then(m => {
            _stateTrackEvent = m.trackEvent;
            if (_stateTrackEvent) _stateTrackEvent(name, amount);
        }).catch(() => {});
    }
}

export function startTypingTimer() {
    typingStartTime = Date.now();
    cognitiveRetrievalTime = -1;
    totalPauseTime = 0;
    pauseStartTime = 0;
    isPaused = false;
}

export function handleVisibilityChange() {
    if (document.hidden) {
        if (!isPaused) {
            pauseStartTime = Date.now();
            isPaused = true;
        }
    } else {
        if (isPaused) {
            totalPauseTime += (Date.now() - pauseStartTime);
            isPaused = false;
        }
    }
}

export function handleBlur() {
    if (!isPaused && !document.hidden) {
        pauseStartTime = Date.now();
        isPaused = true;
    }
}

export function handleFocus() {
    if (isPaused && !document.hidden) {
        totalPauseTime += (Date.now() - pauseStartTime);
        isPaused = false;
    }
}

export function getResponseTime() {
    if (typingStartTime === 0) return 0;
    let currentPause = isPaused ? (Date.now() - pauseStartTime) : 0;
    return Math.max(0, Date.now() - typingStartTime - totalPauseTime - currentPause);
}

/**
 * Gắn trực tiếp vào sự kiện 'input' của DOM.typingInput
 * Chốt thời gian nhận thức tại ký tự chữ/số đầu tiên; tự động reset nếu xóa trắng ô nhập
 */
export function recordFirstKeystroke(e) {
    if (typingStartTime === 0) return;

    const currentVal = (typeof e === 'string')
        ? e
        : (e?.target?.value ?? '');

    // Nếu người dùng xóa sạch ô input (hoặc chỉ gõ toàn dấu cách), reset lại mốc nhận thức
    if (!/[a-zA-Z0-9]/.test(currentVal)) {
        cognitiveRetrievalTime = -1;
        return;
    }

    // Chốt thời gian phản xạ ròng ngay khi xuất hiện ký tự chữ/số hợp lệ đầu tiên
    if (cognitiveRetrievalTime === -1) {
        cognitiveRetrievalTime = getResponseTime();
    }
}

export function getCognitiveRetrievalTime() {
    return cognitiveRetrievalTime !== -1 ? cognitiveRetrievalTime : getResponseTime();
}

// Bảng Set O(1) bảo vệ từ vựng nguyên vẹn không bị biến dạng
const KEEP_OUR_WORDS = new Set([
    'our', 'four', 'hour', 'pour', 'sour', 'tour', 'your', 'dour',
    'flour', 'scour', 'devour', 'detour', 'contour', 'velour',
    'paramour', 'troubadour', 'downpour', 'outpour'
]);

const KEEP_ISE_WORDS = new Set([
    'rise', 'wise', 'advise', 'devise', 'revise', 'supervise', 'televise', 'improvise',
    'promise', 'compromise', 'premise', 'demise', 'surmise', 'enterprise', 'franchise',
    'merchandise', 'advertise', 'chastise', 'despise', 'disguise', 'excise', 'incise',
    'exercise', 'paradise', 'precise', 'concise', 'imprecise', 'noise', 'poise',
    'bruise', 'cruise', 'guise', 'treatise', 'expertise', 'otherwise', 'likewise', 'clockwise'
]);

export function superNormalize(str) {
    if (!str) return "";
    let s = str.toLowerCase().trim();

    // 1a. Đổi dấu gạch nối, gạch chéo thành khoảng trắng (bảo toàn ranh giới từ: well-known -> well known)
    s = s.replace(/[\-_\/]+/g, " ");

    // 1b. Bóc tách các dấu câu còn lại
    s = s.replace(/['\.,#!$%\^&\*;:{}=`~()]/g, "");

    // 2. Chuẩn hóa Anh - Mỹ có kiểm soát O(1) Set (hỗ trợ cả dạng nguyên mẫu và số nhiều -s)
    s = s.replace(/\b([a-z]+)our(s?)\b/g, (match, prefix, plural) => {
        const base = prefix + 'our';
        return KEEP_OUR_WORDS.has(base) ? match : prefix + 'or' + plural;
    });
    s = s.replace(/\b([a-z]{3,})ise(s?|d)\b/g, (match, prefix, suffix) => {
        const base = prefix + 'ise';
        return KEEP_ISE_WORDS.has(base) ? match : prefix + 'ize' + suffix;
    });

    // 3. Thu gọn khoảng trắng về 1 dấu cách đơn duy nhất
    return s.replace(/\s+/g, " ").trim();
}

/**
 * Thuật toán Damerau-Levenshtein (Optimal String Alignment)
 * Hỗ trợ nhận diện lỗi đảo 2 ký tự liền kề (Transposition) chỉ tính d = 1
 */
export function damerauLevenshtein(a, b) {
    const al = a.length, bl = b.length;
    if (al === 0) return bl;
    if (bl === 0) return al;

    const m = [];
    for (let i = 0; i <= al; i++) m[i] = [i];
    for (let j = 0; j <= bl; j++) m[0][j] = j;

    for (let i = 1; i <= al; i++) {
        for (let j = 1; j <= bl; j++) {
            const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
            m[i][j] = Math.min(
                m[i - 1][j] + 1,        // deletion
                m[i][j - 1] + 1,        // insertion
                m[i - 1][j - 1] + cost   // substitution
            );
            // Bước kiểm tra hoán vị liền kề (Transposition)
            if (i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) {
                m[i][j] = Math.min(m[i][j], m[i - 2][j - 2] + 1);
            }
        }
    }
    return m[al][bl];
}

export function stripVietnameseDiacritics(str) {
    if (!str) return "";
    return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[đ]/g, 'd')
        .replace(/[Đ]/g, 'D');
}

export function evaluateTyping(inputStr, targetStr) {
    const input = inputStr.trim();
    const target = targetStr.trim();

    // 1. Accidental Submit Guard
    if (input.length < 0.4 * target.length) {
        return { rating: 0, distance: -1, message: "Hãy gõ tiếp...", status: "too_short" };
    }

    let normInput = superNormalize(input);
    const normTarget = superNormalize(target);

    // If target is pure ASCII (standard English), strip accidental Vietnamese IME diacritics
    if (/^[\x00-\x7F\s]+$/.test(normTarget)) {
        normInput = stripVietnameseDiacritics(normInput);
    }

    const d = damerauLevenshtein(normInput, normTarget);
    const responseTime = getResponseTime();

    if (d === 0) {
        trackEvent('typingTotalCorrect');

        // 1. Thời gian nhận thức (đọc đề + nhớ ra chữ cái đầu tiên): cho phép tối đa 2500ms
        const retrievalMs = getCognitiveRetrievalTime();

        // 2. Thời gian thực thi gõ phím cơ học (từ ký tự đầu tiên đến khi Enter)
        const typingExecutionMs = Math.max(0, responseTime - retrievalMs);
        const maxTypingExecutionMs = Math.max(1200, normTarget.length * 280);

        // 3. Ngưỡng tổng thời gian fallback
        const fastTotalThreshold = Math.max(3000, normTarget.length * 350);

        // Khắc phục triệt để: Đạt Easy khi nhận thức nhanh VÀ gõ liền mạch, hoặc tổng thời gian cực nhanh
        const isFastRecallAndFluentTyping = (retrievalMs <= 2500) && (typingExecutionMs <= maxTypingExecutionMs);

        if (responseTime <= fastTotalThreshold || isFastRecallAndFluentTyping) {
            trackEvent('typingFastAnswers');
            return { rating: 4, distance: d, message: "Hoàn hảo!", status: "perfect_fast" };
        } else {
            return { rating: 3, distance: d, message: "Chính xác!", status: "perfect" };
        }
    } else {
        const targetLen = normTarget.length;
        let isTypo = false;

        if (targetLen >= 8 && d <= 2) {
            isTypo = true;
            if (normInput.substring(0, targetLen - 1) === normTarget.substring(0, targetLen - 1)) {
                trackEvent('typingLastCharTypo');
                return { rating: 2, distance: d, message: "Lỗi chính tả nhẹ!", status: "typo" };
            }
        } else if (targetLen >= 4 && d === 1) {
            isTypo = true;
            if (normInput.substring(0, targetLen - 1) === normTarget.substring(0, targetLen - 1)) {
                trackEvent('typingLastCharTypo');
                return { rating: 2, distance: d, message: "Lỗi chính tả nhẹ!", status: "typo" };
            }
        }

        if (isTypo) {
            trackEvent('typingTypoStreaks');
            return { rating: 2, distance: d, message: "Lỗi chính tả nhẹ!", status: "typo" };
        } else {
            if (targetLen <= 3) {
                trackEvent('typingShortWordTypo');
            }
            return { rating: 1, distance: d, message: "Sai rồi!", status: "incorrect" };
        }
    }
}
