import { DOM } from '../ui/elements.js';
import { getState } from '../core/state.js';
import { showPopup, showConfirmation } from '../ui/modal.js';
import { playSound } from '../core/sound.js';
import { calculateNextSrsState } from '../core/srs/index.js';
import { buildReviewQueue, getNextCardToReview } from '../core/queue.js';
import { displayCard, launchVictoryConfetti } from '../ui/render.js';
import { saveVocabulary, saveOneWord, addXP, recordQuizAnswer, getComboMultiplier, trackEvent, saveGamification, addReviewLog, clearLastReviewSnapshot, incrementNewCardsDone, incrementDueCardsDone, incrementLearningCardsDone } from '../core/state.js';
import { animateNumber } from '../core/animations.js';
import { superNormalize, stripVietnameseDiacritics } from './typing.js';
import { escapeHTML } from '../core/utils/sanitize.js';
import { suspendCelestialCanvas, resumeCelestialCanvas } from '../ui/celestial-canvas.js';

let quizIntervalId = null;
let quizTimeLeft = 0;
let quizQuestions = [];
let currentQuizQuestionIndex = 0;
let quizScore = 0;
let quizIncorrect = 0;
let quizInProgress = false;
let quizIncorrectWordsInfo = [];
let quizIsReviewing = false;
let currentReviewIndex = -1;
let quizRealStartTime = 0;
let quizSessionXP = 0;
let quizAdvanceTimer = null;
let quizSessionId = 0;
let quizAnswerSettled = false;
let quizDeadline = 0;
let quizOriginalTotal = 0;
let quizOriginalDuration = 0;
let quizQuestionStartTime = 0;

function resetQuizFlow() {
    clearTimeout(quizAdvanceTimer);
    clearInterval(quizIntervalId);
    quizAdvanceTimer = null;
    quizSessionId++;
    quizAnswerSettled = false;
}

function lockQuizAnswer() {
    if (!quizInProgress || quizAnswerSettled) return false;
    quizAnswerSettled = true;
    if (DOM.quizAnswerInput) DOM.quizAnswerInput.disabled = true;
    if (DOM.skipQuizBtn) DOM.skipQuizBtn.disabled = true;
    return true;
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

export function showQuizSetup() {
    resetQuizFlow();
    clearLastReviewSnapshot();
    if (!DOM.quizArea) return;
    suspendCelestialCanvas();
    DOM.mainFlashcardView?.classList.add('hidden');
    DOM.statsArea?.classList.add('hidden');
    DOM.quizArea.classList.remove('hidden');
    DOM.quizSetupArea?.classList.remove('hidden');
    DOM.quizHeader?.classList.add('hidden');
    DOM.quizQuestionArea?.classList.add('hidden');
    DOM.quizResultsArea?.classList.add('hidden');
    DOM.reviewIncorrectBtn?.classList.add('hidden');
    DOM.quizControls?.classList.add('hidden');
    quizInProgress = false;
    quizIsReviewing = false;
    clearInterval(quizIntervalId);
    quizQuestions = [];
    quizIncorrectWordsInfo = [];
    playSound('next');
    DOM.quizNumQuestions?.focus();
}

function startQuiz() {
    const { vocabulary, currentTopicFilter } = getState();
    const numQuestionsOption = DOM.quizNumQuestions?.value;
    const timeLimitMinutes = parseInt(DOM.quizTimeLimit?.value, 10) || 5;
    const filterLower = (currentTopicFilter || 'all').toLowerCase();
    const potentialQuizVocab = vocabulary.filter(w => {
        if (!w || w.isDeleted) return false;
        if (filterLower === 'all') return true;
        const tagsArr = Array.isArray(w.tags) ? w.tags : (typeof w.tags === 'string' ? w.tags.split(',') : []);
        return tagsArr.some(t => t && String(t).trim().toLowerCase() === filterLower);
    });
    const now = Date.now();
    const dueWords = [];
    const learningWords = [];
    const newWords = [];
    const otherWords = [];
    const dueSet = new Set();
    const learningSet = new Set();
    const newSet = new Set();

    for (const w of potentialQuizVocab) {
        if (w.srsDueDate && w.srsDueDate <= now) {
            dueWords.push(w);
            dueSet.add(w);
        } else if (w.srsStatus === 'Learning' && !dueSet.has(w)) {
            learningWords.push(w);
            learningSet.add(w);
        } else if (w.srsStatus === 'New' && !dueSet.has(w) && !learningSet.has(w)) {
            newWords.push(w);
            newSet.add(w);
        } else if (!dueSet.has(w) && !learningSet.has(w) && !newSet.has(w)) {
            otherWords.push(w);
        }
    }
    
    shuffleArray(dueWords);
    shuffleArray(learningWords);
    shuffleArray(newWords);
    shuffleArray(otherWords);
    
    const targetCount = (numQuestionsOption === 'all') ? potentialQuizVocab.length : parseInt(numQuestionsOption, 10);
    
    let quizPool = [...dueWords, ...learningWords, ...newWords, ...otherWords];
    
    quizQuestions = (numQuestionsOption === 'all')
        ? quizPool
        : quizPool.slice(0, targetCount);
        
    shuffleArray(quizQuestions);
    if (quizQuestions.length === 0) {
        showPopup("Không có từ nào phù hợp để bắt đầu kiểm tra. Hãy thử học thêm hoặc đổi bộ lọc.", "info");
        return;
    }
    resetQuizFlow();
    quizInProgress = true;
    quizOriginalTotal = quizQuestions.length;
    quizOriginalDuration = 0;
    currentQuizQuestionIndex = 0;
    quizScore = 0;
    quizIncorrect = 0;
    quizSessionXP = 0;
    quizTimeLeft = Math.max(1, Math.min(180, timeLimitMinutes)) * 60;
    quizDeadline = Date.now() + quizTimeLeft * 1000;
    quizRealStartTime = Date.now();
    DOM.quizSetupArea?.classList.add('hidden');
    DOM.quizHeader?.classList.remove('hidden');
    DOM.quizQuestionArea?.classList.remove('hidden');
    DOM.quizResultsArea?.classList.add('hidden');
    DOM.endQuizBtn?.classList.remove('hidden');
    DOM.quizControls?.classList.remove('hidden');
    updateQuizProgress();
    displayQuizQuestion();
    startQuizTimer();
    playSound('quizStart');
}

function displayQuizQuestion() {
    if (!quizInProgress || currentQuizQuestionIndex >= quizQuestions.length) {
        finishQuiz();
        return;
    }
    quizAnswerSettled = false;
    if (DOM.skipQuizBtn) DOM.skipQuizBtn.disabled = false;
    const word = quizQuestions[currentQuizQuestionIndex];
    if (!word) { goToNextQuizQuestion(); return; }
    if (DOM.quizVietnamesePrompt) DOM.quizVietnamesePrompt.textContent = word.vietnamese;
    if (DOM.quizAnswerInput) {
        DOM.quizAnswerInput.value = '';
        DOM.quizAnswerInput.disabled = false;
        setTimeout(() => DOM.quizAnswerInput.focus(), 50);
    }
    if (DOM.quizFeedback) {
        DOM.quizFeedback.textContent = '';
        DOM.quizFeedback.className = 'quiz-feedback';
    }
    quizQuestionStartTime = Date.now();
    updateQuizProgress();
}

function checkQuizAnswer() {
    if (!quizInProgress || quizAnswerSettled || !DOM.quizAnswerInput.value.trim()) return;
    
    // Nâng cấp: Chuẩn hóa chuỗi (bỏ khoảng trắng thừa, dấu câu cơ bản)
    const normalize = str => stripVietnameseDiacritics(superNormalize(str));
    
    const userAnswer = normalize(DOM.quizAnswerInput.value);
    const currentWord = quizQuestions[currentQuizQuestionIndex];
    if (!currentWord) { goToNextQuizQuestion(); return; }
    
    if (!lockQuizAnswer()) return;
    const correctAnswer = normalize(currentWord.english);
    
    if (userAnswer === correctAnswer) {
        if (!quizIsReviewing) {
            quizScore++;
            
            const isMastered = currentWord.srsStatus === 'Mastered';
            const isNotDue = currentWord.srsDueDate && currentWord.srsDueDate > Date.now();
            
            if (isMastered && isNotDue) {
                addXP(1, "+1 XP (Quá dễ)");
                quizSessionXP += 1;
            } else {
                const wordLength = currentWord.english.trim().length;
                const baseExp = 2 + Math.floor(wordLength / 4);
                
                const combo = getComboMultiplier();
                const finalExp = Math.floor(baseExp * combo);
                
                let floatText = `+${finalExp} XP`;
                if (combo > 1) floatText += ` (Combo x${combo})`;
                
                addXP(finalExp, floatText);
                quizSessionXP += finalExp;
            }
            
            recordQuizAnswer(true);
            const elapsedMs = Date.now() - (quizQuestionStartTime || Date.now());
            const wordLen = currentWord.english.trim().length;
            const isFast = elapsedMs <= Math.max(3500, wordLen * 350);
            const isHard = elapsedMs > 15000;
            const quizRating = isFast ? 4 : (isHard ? 2 : 3);
            applyQuizReview(currentWord, quizRating);
        }
        DOM.quizFeedback.textContent = "Đúng!";
        DOM.quizFeedback.className = 'quiz-feedback correct';
        playSound('correct');
    } else {
        if (!quizIsReviewing) {
            quizIncorrect++;
            recordQuizAnswer(false);
            quizIncorrectWordsInfo.push(currentWord);
            applyQuizReview(currentWord, 1);
        } else {
            quizQuestions.push(currentWord);
        }
        DOM.quizFeedback.innerHTML = `Sai! Đáp án đúng: <strong>${escapeHTML(currentWord.english)}</strong>`;
        DOM.quizFeedback.className = 'quiz-feedback incorrect';
        playSound('incorrect');
    }
    updateQuizProgress();
    goToNextQuizQuestion();
}

function applyQuizReview(word, rating) {
    const { vocabulary } = getState();
    const index = vocabulary.findIndex(card => card.id === word.id && !card.isDeleted);
    if (index < 0) return;
    const current = vocabulary[index];
    if (current.srsStatus === 'New') incrementNewCardsDone();
    else if (current.srsStatus === 'Learning') incrementLearningCardsDone();
    else if (current.srsDueDate && current.srsDueDate <= new Date().setHours(23,59,59,999)) incrementDueCardsDone();
    const { newState, log } = calculateNextSrsState(current, rating, 'quiz', 0, getState().userFsrs7Params);
    vocabulary[index] = newState;
    void saveOneWord(newState);
    if (log) void addReviewLog(log);
}
function skipQuizQuestion() {
    if (!quizInProgress || quizAnswerSettled) return;
    const currentWord = quizQuestions[currentQuizQuestionIndex];
    if (!currentWord) { goToNextQuizQuestion(); return; }
    
    if (!lockQuizAnswer()) return;
    if (!quizIsReviewing) {
        quizIncorrect++;
        recordQuizAnswer(false);
        quizIncorrectWordsInfo.push(currentWord);
        
        applyQuizReview(currentWord, 1);
    } else {
        quizQuestions.push(currentWord);
    }
    
    DOM.quizFeedback.innerHTML = `Đã bỏ qua! Đáp án đúng: <strong>${escapeHTML(currentWord.english)}</strong>`;
    
    updateQuizProgress();
    goToNextQuizQuestion();
}

function goToNextQuizQuestion() {
    clearTimeout(quizAdvanceTimer);
    const session = quizSessionId;
    const question = currentQuizQuestionIndex;
    quizAdvanceTimer = setTimeout(() => {
        quizAdvanceTimer = null;
        if (!quizInProgress || session !== quizSessionId || question !== currentQuizQuestionIndex) return;
        currentQuizQuestionIndex++;
        displayQuizQuestion();
    }, 1200);
}

function finishQuiz(isSilent = false) {
    if (!quizInProgress) return;
    quizInProgress = false;
    resetQuizFlow();
    
    const totalQuestions = quizOriginalTotal;
    if (!quizIsReviewing) quizOriginalDuration = (Date.now() - quizRealStartTime) / 1000;
    const timeTaken = quizOriginalDuration;
    const answered = quizScore + quizIncorrect;
    const avgTime = answered > 0 ? (timeTaken / answered).toFixed(1) : '0.0';

    if (!quizIsReviewing && answered > 0) {
        const state = getState();
        const stats = state.gamification.stats ||= {};
        const perfect = totalQuestions >= 10 && quizScore === totalQuestions;
        stats.perfectQuizStreak = perfect ? (stats.perfectQuizStreak || 0) + 1 : 0;
        if (perfect) {
            trackEvent('perfectQuizzes');
            if (state.isTypingMode) trackEvent('typingPerfectQuizzes');
        }
        if (quizScore === 0) trackEvent('quizZeroScore');
        if (answered === totalQuestions && totalQuestions >= 10 && Number(avgTime) < 2) state.gamification.speedsterAchieved = true;
        void saveGamification();
    }

    if (isSilent) return;
    DOM.quizHeader?.classList.add('hidden');
    DOM.quizQuestionArea?.classList.add('hidden');
    DOM.quizControls?.classList.add('hidden');
    DOM.quizResultsArea?.classList.remove('hidden');

    const scorePct = totalQuestions > 0 ? Math.round((quizScore / totalQuestions) * 100) : 0;

    // 1. Animate Numerical Counters
    if (DOM.resultsCorrect) animateNumber(DOM.resultsCorrect, quizScore);
    if (DOM.resultsIncorrect) animateNumber(DOM.resultsIncorrect, quizIncorrect);
    if (DOM.resultsScore) DOM.resultsScore.textContent = `${quizScore}/${totalQuestions}`;

    // 2. Animate Circular Radial Gauge
    const circleProgress = document.getElementById('score-circle-progress');
    const pctValEl = document.getElementById('quiz-percentage-val');
    if (pctValEl) {
        animateNumber(pctValEl, scorePct);
        setTimeout(() => { pctValEl.textContent = `${scorePct}%`; }, 600);
    }
    if (circleProgress) {
        const circumference = 314.16; // 2 * PI * 50
        const strokeOffset = circumference - (scorePct / 100) * circumference;
        circleProgress.style.strokeDashoffset = strokeOffset;
        if (scorePct >= 80) {
            circleProgress.style.stroke = '#10b981';
        } else if (scorePct >= 50) {
            circleProgress.style.stroke = '#8b5cf6';
        } else {
            circleProgress.style.stroke = '#ef4444';
        }
    }

    // 3. Dynamic Celestial Tier Badge
    const tierBadge = document.getElementById('quiz-tier-badge');
    if (tierBadge) {
        tierBadge.className = 'quiz-tier-badge';
        if (scorePct === 100) {
            tierBadge.classList.add('tier-grandmaster');
            tierBadge.innerHTML = '<i class="ph-fill ph-trophy"></i> <span>Celestial Grandmaster</span>';
        } else if (scorePct >= 80) {
            tierBadge.classList.add('tier-scholar');
            tierBadge.innerHTML = '<i class="ph-fill ph-sparkle"></i> <span>Starlight Scholar</span>';
        } else if (scorePct >= 50) {
            tierBadge.classList.add('tier-explorer');
            tierBadge.innerHTML = '<i class="ph-fill ph-compass"></i> <span>Nebula Explorer</span>';
        } else {
            tierBadge.classList.add('tier-novice');
            tierBadge.innerHTML = '<i class="ph-fill ph-rocket-launch"></i> <span>Cosmic Novice</span>';
        }
    }

    // 4. Update Speed & XP Earned
    const speedEl = document.getElementById('results-speed');
    if (speedEl) speedEl.textContent = `${avgTime}s / câu`;

    const xpEl = document.getElementById('results-xp-earned');
    if (xpEl) xpEl.textContent = `+${quizSessionXP} XP`;

    // 5. Render Missed Words Interactive Section
    const missedSection = document.getElementById('quiz-missed-section');
    const missedList = document.getElementById('quiz-missed-list');
    const missedCount = document.getElementById('missed-count');

    if (quizIncorrectWordsInfo.length > 0) {
        DOM.reviewIncorrectBtn?.classList.remove('hidden');
        if (missedSection) missedSection.classList.remove('hidden');
        if (missedCount) missedCount.textContent = quizIncorrectWordsInfo.length;

        if (missedList) {
            missedList.innerHTML = quizIncorrectWordsInfo.map(w => `
                <div class="missed-word-card">
                    <div class="missed-word-info">
                        <span class="missed-word-eng">${escapeHTML(w.english)} <span class="missed-word-type">${escapeHTML(w.type || '')}</span></span>
                        <span class="missed-word-vi">${escapeHTML(w.vietnamese || '')}</span>
                    </div>
                    <button class="missed-tts-btn" title="Nghe phát âm" data-word="${escapeHTML(w.english)}">
                        <i class="ph-duotone ph-speaker-high"></i>
                    </button>
                </div>
            `).join('');

            missedList.querySelectorAll('.missed-tts-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const wordToSpeak = btn.dataset.word;
                    if (wordToSpeak) {
                        import('../core/sound.js').then(m => m.speakText(wordToSpeak));
                    }
                });
            });
        }
        playSound('quizEnd');
    } else {
        DOM.reviewIncorrectBtn?.classList.add('hidden');
        if (missedSection) missedSection.classList.add('hidden');
        if (scorePct >= 80) {
            launchVictoryConfetti();
            playSound('complete');
        } else {
            playSound('quizEnd');
        }
    }

    DOM.returnToFlashcardsBtn?.focus();
}

function returnToFlashcards() {
    DOM.quizArea?.classList.add('hidden');
    DOM.mainFlashcardView?.classList.remove('hidden');
    DOM.statsArea?.classList.remove('hidden');
    finishQuiz(true);
    buildReviewQueue();
    displayCard(getNextCardToReview());
    playSound('next');
    resumeCelestialCanvas();
}

function updateQuizProgress() {
    if (!DOM.quizProgress || !DOM.quizScore) return;
    const totalQ = quizQuestions.length;
    DOM.quizProgress.textContent = `Câu: ${Math.min(currentQuizQuestionIndex + 1, totalQ)}/${totalQ}`;
    DOM.quizScore.textContent = `Điểm: ${quizScore}`;
}

function startQuizTimer() {
    clearInterval(quizIntervalId);
    updateQuizTimerDisplay();
    quizIntervalId = setInterval(() => {
        quizTimeLeft = Math.max(0, Math.ceil((quizDeadline - Date.now()) / 1000));
        updateQuizTimerDisplay();
        if (quizTimeLeft <= 0) {
            showPopup("Hết giờ!", "info");
            finishQuiz();
        }
    }, 1000);
}

function updateQuizTimerDisplay() {
    if (!DOM.quizTimer) return;
    const minutes = Math.floor(quizTimeLeft / 60);
    const seconds = quizTimeLeft % 60;
    DOM.quizTimer.textContent = `TG: ${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function startReviewIncorrect() {
    if (quizIncorrectWordsInfo.length === 0) return;
    resetQuizFlow();
    quizQuestions = [...quizIncorrectWordsInfo];
    quizIncorrectWordsInfo = [];
    quizIsReviewing = true;
    quizInProgress = true;
    currentQuizQuestionIndex = 0;
    
    DOM.quizSetupArea?.classList.add('hidden');
    DOM.quizHeader?.classList.remove('hidden');
    DOM.quizQuestionArea?.classList.remove('hidden');
    DOM.quizResultsArea?.classList.add('hidden');
    DOM.endQuizBtn?.classList.remove('hidden');
    DOM.quizControls?.classList.remove('hidden');
    
    clearInterval(quizIntervalId);
    if (DOM.quizTimer) DOM.quizTimer.textContent = "ÔN TẬP";
    
    updateQuizProgress();
    displayQuizQuestion();
    playSound('quizStart');
}

DOM.confirmStartQuizBtn?.addEventListener('click', startQuiz);
DOM.cancelQuizSetupBtn?.addEventListener('click', returnToFlashcards);
document.getElementById('quiz-setup-back-btn')?.addEventListener('click', returnToFlashcards);
document.getElementById('quiz-back-btn')?.addEventListener('click', () => {
    if (quizInProgress) showConfirmation("Bạn có muốn kết thúc bài kiểm tra sớm không?", () => returnToFlashcards());
    else returnToFlashcards();
});
DOM.quizAnswerInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && quizInProgress) checkQuizAnswer();
});
DOM.endQuizBtn?.addEventListener('click', () => {
    if (quizInProgress) showConfirmation("Bạn có muốn kết thúc bài kiểm tra sớm không?", () => finishQuiz());
});
DOM.skipQuizBtn?.addEventListener('click', skipQuizQuestion);
DOM.restartQuizBtn?.addEventListener('click', showQuizSetup);
DOM.returnToFlashcardsBtn?.addEventListener('click', returnToFlashcards);
DOM.reviewIncorrectBtn?.addEventListener('click', startReviewIncorrect);
