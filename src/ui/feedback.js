/**
 * A short, study-focused feedback burst shown after an SRS rating.
 * It is intentionally separate from the card DOM so it cannot affect the
 * 3D flip or the layout, and it only animates transform/opacity.
 */
let feedbackEl = null;
let hideTimer = null;

const FEEDBACK = {
    1: { label: 'ÔN LẠI', sub: 'Từ này sẽ quay lại sớm', icon: 'ph-arrow-counter-clockwise', tone: 'again' },
    2: { label: 'KHÓ', sub: 'Đã ghi nhận — ôn sớm hơn', icon: 'ph-fire', tone: 'again' },
    3: { label: 'CHÍNH XÁC', sub: 'Nhịp độ ghi nhớ ổn định', icon: 'ph-check-circle', tone: 'correct' },
    4: { label: 'HOÀN HẢO', sub: 'Đã đưa vào trí nhớ dài hạn', icon: 'ph-sparkle', tone: 'correct' },
};

function ensureFeedbackEl() {
    if (feedbackEl && feedbackEl.isConnected) return feedbackEl;
    feedbackEl = document.createElement('div');
    feedbackEl.id = 'answer-feedback';
    feedbackEl.setAttribute('aria-hidden', 'true');
    document.body.appendChild(feedbackEl);
    return feedbackEl;
}

export function showAnswerFeedback({ rating = 3, combo = 0 } = {}) {
    if (typeof document === 'undefined') return;
    // Boost mode promises zero decorative GPU work; the XP float and sound still
    // confirm the rating, so skip the full-screen burst there.
    if (document.body.classList.contains('boost-mode')) return;
    const data = FEEDBACK[rating] || FEEDBACK[3];
    const el = ensureFeedbackEl();

    el.classList.remove('show', 'is-correct', 'is-again');
    el.classList.add(data.tone === 'again' ? 'is-again' : 'is-correct');

    const comboHtml = combo >= 3
        ? `<div class="af-combo"><i class="ph-fill ph-fire"></i> COMBO ×${combo}</div>`
        : '';

    el.innerHTML = `
        <div class="af-halo"></div>
        <div class="af-ring"></div>
        <div class="af-icon"><i class="ph-fill ${data.icon}"></i></div>
        <div class="af-text">${data.label}</div>
        <div class="af-sub">${data.sub}</div>
        ${comboHtml}
    `;

    el.setAttribute('aria-hidden', 'false');
    // Force a reflow so a second rating restarts the animation from frame 0.
    void el.offsetWidth;
    el.classList.add('show');

    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
        el.classList.remove('show');
        el.setAttribute('aria-hidden', 'true');
        hideTimer = null;
    }, 950);
}
