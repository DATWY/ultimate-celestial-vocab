// src/features/streakRecovery.js
// Quản lý tính năng Khiên Băng Bảo Vệ (Streak Freeze) & Nghi Lễ Chuộc Tội (Streak Recovery)

import { getState, buyStreakFreeze, getStreakRecoveryStatus, completeStreakRecovery } from '../core/state.js';
import { showPopup } from '../ui/modal.js';
import { playSound } from '../core/sound.js';

let penanceQuizState = null;

/**
 * Khởi tạo hoặc cập nhật Widget Khiên Băng và Nút Cứu Chuỗi trên thẻ Streak
 * @param {HTMLElement} streakCard - Container của thẻ Streak trong Profile
 */
export function updateStreakControlsUI(streakCard) {
    if (!streakCard) return;

    let controlsContainer = streakCard.querySelector('.streak-recovery-controls');
    if (!controlsContainer) {
        controlsContainer = document.createElement('div');
        controlsContainer.className = 'streak-recovery-controls';
        streakCard.appendChild(controlsContainer);
    }

    const state = getState();
    const gamification = state.gamification || {};
    const freezeCount = gamification.streakFreezeCount || 0;
    const maxStreak = Math.max(gamification.currentStreak || 0, gamification.longestStreak || 0);
    const recoveryStatus = getStreakRecoveryStatus();

    let html = '';

    // Chỉ hiển thị 1 control phù hợp với trạng thái chuỗi:
    // Nếu chuỗi bị đứt (streak <= 1) và đủ điều kiện tái sinh -> Ưu tiên nút Thử Thách Tái Sinh
    if (recoveryStatus.canRecover) {
        html = `
            <button type="button" id="btn-open-penance" class="streak-recovery-btn pulse-glow" 
                title="Chuỗi lửa gián đoạn trong 7 ngày qua! Nhấn để bước vào Thử Thách Tái Sinh">
                <i class="ph-fill ph-fire"></i>
                <span>🔥 Thử Thách Tái Sinh (${recoveryStatus.priorStreak} Ngày)</span>
            </button>
        `;
    } 
    // Chuỗi đang hoạt động bình thường -> Hiển thị widget Khiên Băng
    else if (freezeCount > 0) {
        html = `
            <div class="streak-freeze-badge active" title="Khiên Băng đang sẵn sàng bảo vệ nếu bạn lỡ quên học 1 ngày">
                <i class="ph-fill ph-snowflake"></i>
                <span>Khiên Băng (1/1)</span>
            </div>
        `;
    } else {
        const canBuy = (gamification.userXP || 0) >= 800 && maxStreak >= 7;
        html = `
            <button type="button" id="btn-craft-freeze" class="streak-freeze-btn ${canBuy ? 'can-buy' : 'locked'}" 
                title="Rèn Khiên Băng (800 XP, yêu cầu kỷ lục >= 7 ngày)">
                <i class="ph-bold ph-snowflake"></i>
                <span>Rèn Khiên (800 XP)</span>
            </button>
        `;
    }

    controlsContainer.innerHTML = html;

    // Gán sự kiện
    const btnCraft = controlsContainer.querySelector('#btn-craft-freeze');
    if (btnCraft) {
        btnCraft.addEventListener('click', (e) => {
            e.stopPropagation();
            handleCraftFreeze();
        });
    }

    const btnPenance = controlsContainer.querySelector('#btn-open-penance');
    if (btnPenance) {
        btnPenance.addEventListener('click', (e) => {
            e.stopPropagation();
            openPenanceModal(recoveryStatus);
        });
    }
}

/**
 * Xử lý mua Khiên Băng
 */
function handleCraftFreeze() {
    const result = buyStreakFreeze();
    if (result.success) {
        playSound('levelUp');
        showPopup(result.message, 'success');
    } else {
        playSound('incorrect');
        showPopup(result.message, 'warning');
    }
}

/**
 * Mở Modal Thử Thách Tái Sinh: Hồi Sinh Tinh Hỏa
 */
export function openPenanceModal(status) {
    let modal = document.getElementById('penance-trial-modal');
    if (!modal) {
        modal = createPenanceModalDOM();
        document.body.appendChild(modal);
    }

    const state = getState();
    const userXP = state.gamification?.userXP || 0;
    const canAfford = userXP >= 500;

    const bodyContainer = modal.querySelector('.penance-modal-body');
    bodyContainer.innerHTML = `
        <div class="penance-intro-view">
            <div class="penance-flame-icon">
                <i class="ph-fill ph-fire"></i>
            </div>
            <h3 class="penance-title">Thử Thách Tái Sinh: Thắp Lại Tinh Hỏa</h3>
            <p class="penance-desc">
                ${status.reason || 'Ngọn lửa kiên trì của bạn đã gián đoạn trong 7 ngày qua.'}
                Để thắp lại Tinh Hỏa và kết nối lại chuỗi kiên trì, hãy chứng minh ý chí trước Tinh Thần Celestial!
            </p>

            <div class="penance-rules-card">
                <div class="penance-rule-item">
                    <div class="rule-icon"><i class="ph-fill ph-sparkle"></i></div>
                    <div class="rule-text">
                        <strong>Lễ Vật Tinh Hoa: 500 XP</strong>
                        <span>Cống hiến 500 XP Tinh hoa tích lũy (Bạn hiện có: <strong class="${canAfford ? 'text-success' : 'text-danger'}">${userXP} XP</strong>)</span>
                    </div>
                </div>
                <div class="penance-rule-item">
                    <div class="rule-icon"><i class="ph-fill ph-sword"></i></div>
                    <div class="rule-text">
                        <strong>Khảo Hạch Tinh Hỏa: 15 Câu Từ Vựng Hiểm Hóc</strong>
                        <span>Vượt qua 15 câu trắc nghiệm từ vựng hay quên / độ khó cao nhất trong kho từ</span>
                    </div>
                </div>
                <div class="penance-rule-item danger-rule">
                    <div class="rule-icon"><i class="ph-fill ph-shield-warning"></i></div>
                    <div class="rule-text">
                        <strong>Điều Kiện Tái Sinh Nghiêm Ngặt:</strong>
                        <span>Chỉ cho phép sai <strong>tối đa 1 câu duy nhất</strong> (Độ chính xác &ge; 93.3%). Sai từ câu thứ 2 sẽ lập tức <strong>THẤT BẠI</strong> và phải ôn luyện kỹ hơn để thử thách lại!</span>
                    </div>
                </div>
            </div>

            <div class="penance-actions">
                <button type="button" class="btn-penance-cancel">Để Chuỗi Bắt Đầu Lại</button>
                <button type="button" id="btn-start-penance-trial" class="btn-penance-start ${canAfford ? '' : 'disabled'}" ${canAfford ? '' : 'disabled'}>
                    <i class="ph-fill ph-fire"></i>
                    ${canAfford ? 'Bắt Đầu Thử Thách Tái Sinh' : 'Không Đủ 500 XP Làm Lễ Vật'}
                </button>
            </div>
        </div>
    `;

    modal.classList.remove('hidden');

    // Gán nút đóng / hủy
    modal.querySelector('.btn-penance-cancel')?.addEventListener('click', () => {
        closePenanceModal();
    });
    modal.querySelector('.modal-close-btn')?.addEventListener('click', () => {
        closePenanceModal();
    });

    // Bắt đầu thử thách
    modal.querySelector('#btn-start-penance-trial')?.addEventListener('click', () => {
        startPenanceTrial(status.missedDates || status.missedDate);
    });
}

function closePenanceModal() {
    const modal = document.getElementById('penance-trial-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

/**
 * Chuẩn bị bộ câu hỏi hiểm hóc (15 câu Leech / Hay quên)
 */
function preparePenanceQuestions() {
    const { vocabulary } = getState();
    const validWords = (vocabulary || []).filter(w => !w.isDeleted && w.english && w.vietnamese);
    if (validWords.length < 4) return [];

    // Ưu tiên các từ có nhiều lần quên (lapses cao), difficulty cao, hoặc status Learning
    const sorted = [...validWords].sort((a, b) => {
        const scoreA = (a.lapses || 0) * 10 + (a.difficulty || 0) + (a.srsStatus === 'Learning' ? 5 : 0);
        const scoreB = (b.lapses || 0) * 10 + (b.difficulty || 0) + (b.srsStatus === 'Learning' ? 5 : 0);
        return scoreB - scoreA;
    });

    // Lấy 15 từ khó nhất (hoặc toàn bộ nếu < 15, xáo trộn)
    const targetWords = sorted.slice(0, Math.min(15, sorted.length));
    
    // Nếu chưa đủ 15 từ, lấy thêm các từ ngẫu nhiên
    if (targetWords.length < 15) {
        const remaining = validWords.filter(w => !targetWords.includes(w));
        remaining.sort(() => Math.random() - 0.5);
        targetWords.push(...remaining.slice(0, 15 - targetWords.length));
    }

    // Xáo trộn 15 từ
    targetWords.sort(() => Math.random() - 0.5);

    // Tạo câu hỏi 4 lựa chọn cho mỗi từ
    return targetWords.map(word => {
        // Lấy 3 đáp án sai
        const distractors = validWords
            .filter(w => w.id !== word.id && w.vietnamese !== word.vietnamese)
            .sort(() => Math.random() - 0.5)
            .slice(0, 3)
            .map(w => w.vietnamese);

        const options = [word.vietnamese, ...distractors].sort(() => Math.random() - 0.5);

        return {
            word,
            question: word.english,
            correctAnswer: word.vietnamese,
            options
        };
    });
}

/**
 * Bắt đầu phiên Khảo Hạch Tinh Hỏa
 */
function startPenanceTrial(missedDates) {
    const questions = preparePenanceQuestions();
    if (questions.length < 5) {
        showPopup("Kho từ vựng của bạn chưa đủ để thiết lập Khảo Hạch Tinh Hỏa (Cần tối thiểu 5 từ).", "warning");
        return;
    }

    const datesList = Array.isArray(missedDates) ? missedDates : [missedDates];

    penanceQuizState = {
        missedDates: datesList,
        questions,
        currentIndex: 0,
        correctCount: 0,
        incorrectCount: 0,
        maxAllowedIncorrect: 1
    };

    playSound('quizStart');
    renderPenanceQuestion();
}

/**
 * Hiển thị từng câu hỏi trong Khảo Hạch Tinh Hỏa
 */
function renderPenanceQuestion() {
    const modal = document.getElementById('penance-trial-modal');
    if (!modal || !penanceQuizState) return;

    const { questions, currentIndex, correctCount, incorrectCount, maxAllowedIncorrect } = penanceQuizState;
    const bodyContainer = modal.querySelector('.penance-modal-body');

    // Kiểm tra nếu đã bị loại (sai quá 1 câu)
    if (incorrectCount > maxAllowedIncorrect) {
        renderPenanceFailure(bodyContainer);
        return;
    }

    // Kiểm tra nếu đã hoàn thành toàn bộ câu hỏi
    if (currentIndex >= questions.length) {
        renderPenanceSuccess(bodyContainer);
        return;
    }

    const currentQ = questions[currentIndex];
    const isLastWarning = incorrectCount === 1;

    bodyContainer.innerHTML = `
        <div class="penance-quiz-view">
            <div class="penance-quiz-header">
                <div class="quiz-progress-badge">
                    <i class="ph-fill ph-sparkle"></i>
                    <span>Khảo Hạch: Câu ${currentIndex + 1} / ${questions.length}</span>
                </div>
                <div class="quiz-lives-badge ${isLastWarning ? 'danger-lives' : ''}">
                    <i class="ph-fill ph-shield"></i>
                    <span>Sai: ${incorrectCount} / ${maxAllowedIncorrect} (Tối đa)</span>
                </div>
            </div>

            ${isLastWarning ? `
                <div class="penance-warning-banner">
                    <i class="ph-fill ph-warning-octagon"></i>
                    <span>CẢNH BÁO NGUY CƠ: Bạn đã sai 1 câu! Sai thêm 1 câu nữa thử thách sẽ THẤT BẠI NGAY LẬP TỨC!</span>
                </div>
            ` : ''}

            <div class="penance-question-box">
                <span class="question-label">Nghĩa tiếng Việt của từ:</span>
                <h2 class="question-word">${currentQ.question}</h2>
                ${currentQ.word.pronunciation ? `<span class="question-pron">${currentQ.word.pronunciation}</span>` : ''}
            </div>

            <div class="penance-options-grid">
                ${currentQ.options.map((opt, idx) => `
                    <button type="button" class="penance-opt-btn" data-answer="${escapeHtml(opt)}">
                        <span class="opt-key">${['A', 'B', 'C', 'D'][idx]}</span>
                        <span class="opt-text">${escapeHtml(opt)}</span>
                    </button>
                `).join('')}
            </div>
        </div>
    `;

    // Bắt sự kiện chọn đáp án
    const optButtons = bodyContainer.querySelectorAll('.penance-opt-btn');
    optButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            handlePenanceAnswer(btn.dataset.answer, currentQ.correctAnswer, optButtons);
        });
    });
}

function handlePenanceAnswer(selectedAnswer, correctAnswer, allButtons) {
    allButtons.forEach(b => b.disabled = true);

    const isCorrect = selectedAnswer === correctAnswer;
    allButtons.forEach(b => {
        if (b.dataset.answer === correctAnswer) {
            b.classList.add('correct-opt');
        } else if (b.dataset.answer === selectedAnswer && !isCorrect) {
            b.classList.add('wrong-opt');
        }
    });

    if (isCorrect) {
        playSound('correct');
        penanceQuizState.correctCount++;
    } else {
        playSound('incorrect');
        penanceQuizState.incorrectCount++;
    }

    setTimeout(() => {
        penanceQuizState.currentIndex++;
        renderPenanceQuestion();
    }, 900);
}

/**
 * Hiển thị màn hình Thất Bại
 */
function renderPenanceFailure(container) {
    playSound('delete');
    container.innerHTML = `
        <div class="penance-result-view failure-view">
            <div class="result-icon failure-icon"><i class="ph-fill ph-snowflake"></i></div>
            <h3 class="result-title">THỬ THÁCH CHƯA ĐẠT!</h3>
            <p class="result-desc">
                Bạn đã trả lời sai vượt quá số câu cho phép trong Khảo Hạch Tinh Hỏa. Ngọn lửa kiên trì chưa thể bùng cháy lại.
            </p>
            <div class="result-details">
                <span>Số câu đúng: <strong>${penanceQuizState.correctCount} / ${penanceQuizState.questions.length}</strong></span>
                <span>Số câu sai: <strong class="text-danger">${penanceQuizState.incorrectCount}</strong></span>
            </div>
            <p class="result-lesson">
                💡 <em>Lời khuyên: Hãy ôn luyện lại các từ vựng này trong thư viện và quay lại thử thách khi tự tin hơn!</em>
            </p>
            <button type="button" class="btn-penance-close">Đóng & Ôn Luyện Lại</button>
        </div>
    `;

    container.querySelector('.btn-penance-close')?.addEventListener('click', () => {
        closePenanceModal();
    });
}

/**
 * Hiển thị màn hình Thành Công & Hồi Sinh Chuỗi
 */
function renderPenanceSuccess(container) {
    const missedDates = penanceQuizState.missedDates;
    const recoveryResult = completeStreakRecovery(missedDates);

    playSound('levelUp');
    playSound('streak');

    const formattedDates = missedDates.length === 1 
        ? `ngày <strong>${missedDates[0]}</strong>` 
        : `<strong>${missedDates.length} ngày</strong> (${missedDates[missedDates.length - 1]} → ${missedDates[0]})`;

    container.innerHTML = `
        <div class="penance-result-view success-view">
            <div class="result-icon success-icon"><i class="ph-fill ph-fire"></i></div>
            <h3 class="result-title">TÁI SINH THÀNH CÔNG!</h3>
            <h4 class="result-sub">NGỌN LỬA TINH TÚ ĐÃ BÙNG CHÁY TRỞ LẠI!</h4>
            <p class="result-desc">
                Xuất sắc! Bạn đã vượt qua Khảo Hạch Tinh Hỏa với độ chính xác tuyệt đối.
                Chuỗi kiên trì ${formattedDates} đã được thắp sáng và kết nối lại!
            </p>
            <div class="result-details success-details">
                <span>Lễ vật tái sinh: <strong class="text-danger">-500 XP</strong></span>
                <span>Kết quả khảo hạch: <strong class="text-success">${penanceQuizState.correctCount} / ${penanceQuizState.questions.length} Đúng</strong></span>
            </div>
            <button type="button" class="btn-penance-claim">🔥 Tiếp Nhận Tinh Hỏa & Học Tiếp</button>
        </div>
    `;

    container.querySelector('.btn-penance-claim')?.addEventListener('click', () => {
        closePenanceModal();
    });
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Tạo DOM cho Penance Modal
 */
function createPenanceModalDOM() {
    const modal = document.createElement('div');
    modal.id = 'penance-trial-modal';
    modal.className = 'modal hidden';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    modal.innerHTML = `
        <div class="modal-overlay"></div>
        <div class="modal-content penance-modal-content">
            <button class="modal-close-btn" title="Đóng">&times;</button>
            <div class="penance-modal-body"></div>
        </div>
    `;

    return modal;
}
