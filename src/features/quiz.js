
import { DOM } from '../ui/elements.js';
import { getState } from '../core/state.js';
import { showPopup, showConfirmation } from '../ui/modal.js';
import { playSound } from '../core/sound.js';
import { calculateNextSrsState, buildReviewQueue, getNextCardToReview } from '../core/srs.js';
import { displayCard } from '../ui/render.js';
import { saveVocabulary, addXP } from '../core/state.js';

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
        !w.isSuspended && (currentTopicFilter === 'all' || w.tags?.map(t => t.trim().toLowerCase()).includes(currentTopicFilter.toLowerCase()))
    );
    const now = Date.now();
    let quizPool = potentialQuizVocab.filter(w => w.srsDueDate && w.srsDueDate <= now);
    if (quizPool.length < 10) {
        const newWords = potentialQuizVocab.filter(w => w.srsStatus === 'New' && !quizPool.includes(w));
        quizPool = [...quizPool, ...newWords];
    }
    shuffleArray(quizPool);
    quizQuestions = (numQuestionsOption === 'all')
        ? quizPool
        : quizPool.slice(0, parseInt(numQuestionsOption, 10));
    if (quizQuestions.length === 0) {
        showPopup("Không có từ nào phù hợp để bắt đầu kiểm tra. Hãy thử học thêm hoặc đổi bộ lọc.", "info");
        return;
    }
    quizInProgress = true;
    currentQuizQuestionIndex = 0;
    quizScore = 0;
    quizIncorrect = 0;
    quizTimeLeft = timeLimitMinutes * 60;
    DOM.quizSetupArea?.classList.add('hidden');
    DOM.quizHeader?.classList.remove('hidden');
    DOM.quizQuestionArea?.classList.remove('hidden');
    DOM.quizResultsArea?.classList.add('hidden');
    DOM.endQuizBtn?.classList.remove('hidden');
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
        DOM.quizAnswerInput.focus();
    }
    if (DOM.quizFeedback) {
        DOM.quizFeedback.textContent = '';
        DOM.quizFeedback.className = 'quiz-feedback';
    }
    updateQuizProgress();
}

function checkQuizAnswer() {
    if (!quizInProgress || quizIsReviewing) return;
    const userAnswer = DOM.quizAnswerInput.value.trim().toLowerCase();
    const currentWord = quizQuestions[currentQuizQuestionIndex];
    if (!currentWord) { goToNextQuizQuestion(); return; }
    DOM.quizAnswerInput.disabled = true;
    const correctAnswer = currentWord.english.toLowerCase();
    if (userAnswer === correctAnswer) {
        quizScore++;
        addXP(1); // Thêm 1 XP cho mỗi câu đúng trong quiz
        DOM.quizFeedback.textContent = "Đúng!";
        DOM.quizFeedback.className = 'quiz-feedback correct';
        playSound('correct');
    } else {
        quizIncorrect++;
        DOM.quizFeedback.innerHTML = `Sai! Đáp án đúng: <strong>${currentWord.english}</strong>`;
        DOM.quizFeedback.className = 'quiz-feedback incorrect';
        playSound('incorrect');
        quizIncorrectWordsInfo.push(currentWord);
        const { vocabulary } = getState();
        const originalIndex = vocabulary.findIndex(v => v.id === currentWord.id);
        if (originalIndex > -1) {
            const updatedCard = calculateNextSrsState(vocabulary[originalIndex], 0);
            vocabulary[originalIndex] = updatedCard;
            saveVocabulary();
        }
    }
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
    if (isSilent) return;
    DOM.quizHeader?.classList.add('hidden');
    DOM.quizQuestionArea?.classList.add('hidden');
    DOM.quizResultsArea?.classList.remove('hidden');
    if (DOM.resultsCorrect) DOM.resultsCorrect.textContent = quizScore;
    if (DOM.resultsIncorrect) DOM.resultsIncorrect.textContent = quizIncorrect;
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

DOM.confirmStartQuizBtn?.addEventListener('click', startQuiz);
DOM.quizAnswerInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && quizInProgress && !quizIsReviewing) checkQuizAnswer();
});
DOM.endQuizBtn?.addEventListener('click', () => {
    if (quizInProgress) showConfirmation("Bạn có muốn kết thúc bài kiểm tra sớm không?", () => finishQuiz());
});
DOM.restartQuizBtn?.addEventListener('click', showQuizSetup);
DOM.returnToFlashcardsBtn?.addEventListener('click', returnToFlashcards);
