// src/features/typing.js

let typingStartTime = 0;
let totalPauseTime = 0;
let pauseStartTime = 0;
let isPaused = false;

import { trackEvent } from '../core/state.js';

export function startTypingTimer() {
    typingStartTime = Date.now();
    totalPauseTime = 0;
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
    let currentPause = 0;
    if (isPaused) {
        currentPause = Date.now() - pauseStartTime;
    }
    return Date.now() - typingStartTime - totalPauseTime - currentPause;
}

export function superNormalize(str) {
    if (!str) return "";
    let s = str.toLowerCase().trim();
    // Strip hyphens, apostrophes, and punctuation
    s = s.replace(/[\-'\.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");
    
    // Normalize common US/UK variants
    s = s.replace(/ise$/g, "ize");
    s = s.replace(/our$/g, "or");
    
    return s.replace(/\s+/g, ""); // remove all spaces for comparison
}

function levenshtein(a, b) {
    if(a.length === 0) return b.length;
    if(b.length === 0) return a.length;

    var matrix = [];
    for(var i = 0; i <= b.length; i++){
        matrix[i] = [i];
    }
    for(var j = 0; j <= a.length; j++){
        matrix[0][j] = j;
    }

    for(var i = 1; i <= b.length; i++){
        for(var j = 1; j <= a.length; j++){
            if(b.charAt(i-1) == a.charAt(j-1)){
                matrix[i][j] = matrix[i-1][j-1];
            } else {
                matrix[i][j] = Math.min(matrix[i-1][j-1] + 1, // substitution
                                        Math.min(matrix[i][j-1] + 1, // insertion
                                                 matrix[i-1][j] + 1)); // deletion
            }
        }
    }

    return matrix[b.length][a.length];
}

export function evaluateTyping(inputStr, targetStr) {
    const input = inputStr.trim();
    const target = targetStr.trim();
    
    // 1. Accidental Submit Guard
    if (input.length < 0.4 * target.length) {
        return { rating: 0, distance: -1, message: "Hãy gõ tiếp...", status: "too_short" };
    }

    const normInput = superNormalize(input);
    const normTarget = superNormalize(target);

    const d = levenshtein(normInput, normTarget);
    const responseTime = getResponseTime();

    if (d === 0) {
        // Tốc độ hợp lý phụ thuộc độ dài từ: ~300ms/ký tự, tối thiểu 3 giây
        const fastThreshold = Math.max(3000, normTarget.length * 350);
        trackEvent('typingTotalCorrect');
        
        if (responseTime <= fastThreshold) {
            trackEvent('typingFastAnswers');
            return { rating: 4, distance: d, message: "Hoàn hảo!", status: "perfect_fast" };
        } else {
            return { rating: 3, distance: d, message: "Chính xác!", status: "perfect" };
        }
    } else {
        // Đánh giá lỗi chính tả nhẹ (Typo) hợp lý theo độ dài từ:
        // - Từ ngắn (<= 3 ký tự): Không chấp nhận typo (sai 1 chữ là sai hẳn)
        // - Từ trung bình (4-7 ký tự): Cho phép sai tối đa 1 ký tự (d === 1)
        // - Từ dài (>= 8 ký tự): Cho phép sai tối đa 2 ký tự (d <= 2)
        const targetLen = normTarget.length;
        let isTypo = false;

        if (targetLen >= 8 && d <= 2) {
            isTypo = true;
            if (normInput.substring(0, targetLen - 1) === normTarget.substring(0, targetLen - 1)) {
                trackEvent('typingLastCharTypo');
                return { rating: 2, distance: d, message: "Lỗi chính tả nhẹ!", status: "typo" }; // Ngăn trigger event khác
            }
        } else if (targetLen >= 4 && d === 1) {
            isTypo = true;
            if (normInput.substring(0, targetLen - 1) === normTarget.substring(0, targetLen - 1)) {
                trackEvent('typingLastCharTypo');
                return { rating: 2, distance: d, message: "Lỗi chính tả nhẹ!", status: "typo" }; // Ngăn trigger event khác
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
