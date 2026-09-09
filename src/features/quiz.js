import { DOM } from '../ui/elements.js';
import { getState } from '../core/state.js';
import { showPopup, showConfirmation } from '../ui/modal.js';
import { playSound } from '../core/sound.js';
import { calculateNextSrsState } from '../core/srs/index.js';
import { buildReviewQueue, getNextCardToReview } from '../core/queue.js';
import { displayCard } from '../ui/render.js';
import { saveVocabulary, saveOneWord, addXP, recordQuizAnswer, getComboMultiplier, trackEvent } from '../core/state.js';
import { animateNumber } from '../core/animations.js';

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

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

export function showQuizSetup() {
    if (!DOM.quizArea) return;
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
    const potentialQuizVocab = vocabulary.filter(w =>
        !w.isDeleted && !w.isSuspended && (currentTopicFilter === 'all' || w.tags?.map(t => t.trim().toLowerCase()).includes(currentTopicFilter.toLowerCase()))
    );
    const now = Date.now();
    let dueWords = potentialQuizVocab.filter(w => w.srsDueDate && w.srsDueDate <= now);
    let learningWords = potentialQuizVocab.filter(w => w.srsStatus === 'Learning' && !dueWords.includes(w));
    let newWords = potentialQuizVocab.filter(w => w.srsStatus === 'New' && !dueWords.includes(w) && !learningWords.includes(w));
    let otherWords = potentialQuizVocab.filter(w => !dueWords.includes(w) && !learningWords.includes(w) && !newWords.includes(w));
    
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
    quizInProgress = true;
    currentQuizQuestionIndex = 0;
    quizScore = 0;
    quizIncorrect = 0;
    quizTimeLeft = timeLimitMinutes * 60;
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
    updateQuizProgress();
}

function checkQuizAnswer() {
    if (!quizInProgress) return;
    
    // Nâng cấp: Chuẩn hóa chuỗi (bỏ khoảng trắng thừa, dấu câu cơ bản)
    const normalize = str => str.trim().toLowerCase().replace(/[.,!?;:]/g, '');
    
    const userAnswer = normalize(DOM.quizAnswerInput.value);
    const currentWord = quizQuestions[currentQuizQuestionIndex];
    if (!currentWord) { goToNextQuizQuestion(); return; }
    
    DOM.quizAnswerInput.disabled = true;
    const correctAnswer = normalize(currentWord.english);
    
    if (userAnswer === correctAnswer) {
        if (!quizIsReviewing) {
            quizScore++;
            
            const isMastered = currentWord.srsStatus === 'Mastered';
            const isNotDue = currentWord.srsDueDate && currentWord.srsDueDate > Date.now();
            
            if (isMastered && isNotDue) {
                addXP(1, "+1 XP (Quá dễ)");
            } else {
                const wordLength = currentWord.english.trim().length;
                const baseExp = 2 + Math.floor(wordLength / 4);
                
                const combo = getComboMultiplier();
                const finalExp = Math.floor(baseExp * combo);
                
                let floatText = `+${finalExp} XP`;
                if (combo > 1) floatText += ` (Combo x${combo})`;
                
                addXP(finalExp, floatText);
            }
            
            recordQuizAnswer(true);
        }
        DOM.quizFeedback.textContent = "Đúng!";
        DOM.quizFeedback.className = 'quiz-feedback correct';
        playSound('correct');
    } else {
        if (!quizIsReviewing) {
            quizIncorrect++;
            recordQuizAnswer(false);
            quizIncorrectWordsInfo.push(currentWord);
            const { vocabulary } = getState();
            const originalIndex = vocabulary.findIndex(v => v.id === currentWord.id);
            if (originalIndex > -1) {
                const { newState: updatedCard, log } = calculateNextSrsState(vocabulary[originalIndex], 1, 'quiz', 0, getState().userFsrs7Params);
                vocabulary[originalIndex] = updatedCard;
                saveOneWord(updatedCard);
                if (log) {
                    import('../core/state.js').then(s => s.addReviewLog(log));
                }
            }
        } else {
            quizQuestions.push(currentWord);
        }
        DOM.quizFeedback.innerHTML = `Sai! Đáp án đúng: <strong>${currentWord.english}</strong>`;
        DOM.quizFeedback.className = 'quiz-feedback incorrect';
        playSound('incorrect');
    }
    updateQuizProgress();
    goToNextQuizQuestion();
}

function skipQuizQuestion() {
    if (!quizInProgress) return;
    const currentWord = quizQuestions[currentQuizQuestionIndex];
    if (!currentWord) { goToNextQuizQuestion(); return; }
    
    DOM.quizAnswerInput.disabled = true;
    if (!quizIsReviewing) {
        quizIncorrect++;
        quizIncorrectWordsInfo.push(currentWord);
        
        const { vocabulary } = getState();
        const originalIndex = vocabulary.findIndex(v => v.id === currentWord.id);
        if (originalIndex > -1) {
            const { newState: updatedCard, log } = calculateNextSrsState(vocabulary[originalIndex], 1, 'quiz', 0, getState().userFsrs7Params);
            vocabulary[originalIndex] = updatedCard;
            saveOneWord(updatedCard);
            if (log) {
                import('../core/state.js').then(s => s.addReviewLog(log));
            }
        }
    } else {
        quizQuestions.push(currentWord);
    }
    
    DOM.quizFeedback.innerHTML = `Đã bỏ qua! Đáp án đúng: <strong>${currentWord.english}</strong>`;
    
    updateQuizProgress();
    goToNextQuizQuestion();
}

function goToNextQuizQuestion() {
    setTimeout(() => {
        currentQuizQuestionIndex++;
        displayQuizQuestion();
    }, 1200);
}

function finishQuiz(isSilent = false) {
    if (!quizInProgress && !isSilent) return;
    quizInProgress = false;
    clearInterval(quizIntervalId);
    
    if (quizScore > 0 && quizQuestions.length >= 10) {
        const timeTaken = (Date.now() - quizRealStartTime) / 1000;
        const avgTime = timeTaken / quizQuestions.length;
        if (avgTime < 2) {
            import('../core/state.js').then(s => {
                const state = s.getState();
                if (!state.gamification) state.gamification = {};
                state.gamification.speedsterAchieved = true;
                s.saveGamification();
                document.getElementById('app-container')?.dispatchEvent(new CustomEvent('gamification:update'));
            });
        }
        
        // Track Immortal Badge & Telepath Badge: 100% correct, >= 10 questions, not reviewing incorrect
        if (!quizIsReviewing) {
            import('../core/state.js').then(s => {
                const state = s.getState();
                if (!state.gamification) state.gamification = {};
                if (!state.gamification.stats) state.gamification.stats = {};
                
                if (quizIncorrect === 0 && quizScore > 0) {
                    trackEvent('perfectQuizzes');
                    if (state.isTypingMode) {
                        trackEvent('typingPerfectQuizzes');
                    }
                    state.gamification.stats.perfectQuizStreak = (state.gamification.stats.perfectQuizStreak || 0) + 1;
                } else {
                    state.gamification.stats.perfectQuizStreak = 0;
                }
                
                if (quizScore === 0 && quizIncorrect > 0) {
                    trackEvent('quizZeroScore');
                }
                
                s.saveGamification();
            });
        }
    }
    
    if (isSilent) return;
    DOM.quizHeader?.classList.add('hidden');
    DOM.quizQuestionArea?.classList.add('hidden');
    DOM.quizControls?.classList.add('hidden');
    DOM.quizResultsArea?.classList.remove('hidden');
    if (DOM.resultsCorrect) animateNumber(DOM.resultsCorrect, quizScore);
    if (DOM.resultsIncorrect) animateNumber(DOM.resultsIncorrect, quizIncorrect);
    if (DOM.resultsScore) DOM.resultsScore.textContent = `${quizScore}/${quizQuestions.length}`;
    if (quizIncorrectWordsInfo.length > 0) {
        DOM.reviewIncorrectBtn?.classList.remove('hidden');
    } else {
        DOM.reviewIncorrectBtn?.classList.add('hidden');
    }
    playSound('quizEnd');
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
        quizTimeLeft--;
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
