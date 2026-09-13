
// 'anime' là biến toàn cục từ CDN, không cần import

const DEFAULT_DURATION = 400;
const EASE_OUT_EXPO = 'easeOutExpo';
const EASE_IN_OUT_SINE = 'easeInOutSine';

export async function animateFlip(cardElement) {
    if (!cardElement) return;
    const currentRotation = anime.get(cardElement, 'rotateY', 'deg');
    cardElement.style.pointerEvents = 'none';
    await anime({
        targets: cardElement,
        rotateY: `${parseFloat(currentRotation) + 180}deg`,
        easing: 'easeInOutSine',
        duration: 500,
    }).finished;
    cardElement.style.pointerEvents = 'auto';
}

let lastExitDirection = -1; // -1 for left, 1 for right

export async function animateCardOut(cardElement) {
    if (!cardElement) return;
    lastExitDirection = Math.random() > 0.5 ? 1 : -1;
    const targetX = lastExitDirection * 150;
    const targetRot = lastExitDirection * 15;

    await anime({
        targets: cardElement,
        translateX: { value: `${targetX}%`, duration: DEFAULT_DURATION },
        opacity: { value: 0, duration: DEFAULT_DURATION * 0.8 },
        rotate: { value: `${targetRot}deg`, duration: DEFAULT_DURATION },
        easing: 'easeInBack'
    }).finished;
}

export async function animateCardIn(cardElement) {
    if (!cardElement) return;
    const enterDirection = -lastExitDirection; // come from the opposite side
    const startX = enterDirection * 150;
    const startRot = enterDirection * 15;

    anime.set(cardElement, {
        translateX: `${startX}%`,
        rotate: `${startRot}deg`,
        opacity: 0
    });
    await anime({
        targets: cardElement,
        translateX: '0%',
        opacity: 1,
        rotate: '0deg',
        duration: DEFAULT_DURATION,
        easing: 'easeOutBack'
    }).finished;
}

export function animateModalOpen(modalElement) {
    const overlay = modalElement.querySelector('.modal-overlay');
    const content = modalElement.querySelector('.modal-content');
    
    // Overlay fade in
    anime({
        targets: overlay,
        opacity: [0, 1],
        duration: 350,
        easing: 'easeOutCubic'
    });
    
    // Content scale in with Material motion
    anime({
        targets: content,
        opacity: [0, 1],
        scale: [0.92, 1],
        translateY: [24, 0],
        duration: 500,
        easing: 'cubicBezier(0.2, 0, 0, 1)' // Material standard easing
    });
    
    // Stagger children — manage panel vs form modal
    const isManagePanel = content.classList.contains('manage-panel');
    const childSelector = isManagePanel 
        ? '.manage-panel-header, .manage-controls, #word-list-section, .manage-io-clean-grid'
        : '.form-group, h3, button[type="submit"]';
    
    const children = content.querySelectorAll(childSelector);
    if (children.length > 0) {
        anime.set(children, { opacity: 0, translateY: 20 });
        anime({
            targets: children,
            opacity: 1,
            translateY: 0,
            duration: 450,
            delay: anime.stagger(60, { start: 200 }),
            easing: 'cubicBezier(0.2, 0, 0, 1)'
        });
    }
}

export async function animateModalClose(modalElement) {
    const overlay = modalElement.querySelector('.modal-overlay');
    const content = modalElement.querySelector('.modal-content');
    await Promise.all([
        anime({
            targets: overlay,
            opacity: 0,
            duration: 250,
            easing: 'easeOutCubic'
        }).finished,
        anime({
            targets: content,
            opacity: 0,
            scale: 0.95,
            translateY: 10,
            duration: 250,
            easing: 'cubicBezier(0.4, 0, 1, 1)' // Material decelerate
        }).finished
    ]);
}

export function animatePulse(element) {
    anime({
        targets: element,
        scale: [
            { value: 1.1, duration: 150 },
            { value: 1, duration: 150 }
        ],
        easing: 'easeInOutSine'
    });
}
/**
 * Animate lắc một element để báo hiệu lỗi.
 * @param {HTMLElement} element - Phần tử cần animate.
 */
export function animateShake(element) {
    anime({
        targets: element,
        translateX: [
            { value: -10, duration: 50, easing: 'easeInOutSine' },
            { value: 10, duration: 100, easing: 'easeInOutSine' },
        ],
    });
}

/**
 * Animate đếm số (Animated Stats).
 * @param {HTMLElement} element - Phần tử cần animate số.
 * @param {number} endValue - Giá trị kết thúc.
 * @param {number} duration - Thời gian chạy animation (ms).
 */
export function animateNumber(element, endValue, duration = 2500, format = false) {
    if (!element) return;
    const startValue = parseInt(element.textContent.replace(/\D/g, '')) || 0;
    if (startValue === endValue) {
        element.textContent = format ? endValue.toLocaleString('vi-VN') : endValue;
        return;
    }

    // Tối ưu hóa: Xóa animation cũ đang chạy trên element này để tránh giật lag
    if (element._animeObj) {
        anime.remove(element._animeObj);
    }

    const obj = { val: startValue };
    element._animeObj = obj; // Lưu tham chiếu

    let lastRenderedVal = null; // Tối ưu DOM Update (chỉ render khi số thực sự thay đổi)

    anime({
        targets: obj,
        val: endValue,
        round: 1, // Làm tròn đến số nguyên
        duration: duration,
        easing: 'easeOutCubic', // Chuyển từ easeOutExpo sang easeOutCubic để mượt mà hơn, đỡ gắt lúc đầu
        update: function() {
            if (lastRenderedVal !== obj.val) {
                element.textContent = format ? obj.val.toLocaleString('vi-VN') : obj.val;
                lastRenderedVal = obj.val;
            }
        }
    });
}

/**
 * Animate biểu đồ Forecast (Dự báo ôn tập)
 * @param {HTMLElement} chartContainer 
 */
export function animateForecastChart(chartContainer) {
    if (!chartContainer) return;
    const bars = chartContainer.querySelectorAll('.forecast-bar');
    const counts = chartContainer.querySelectorAll('.forecast-count');
    const days = chartContainer.querySelectorAll('.forecast-day');

    if (bars.length === 0) return;

    // Chuẩn bị trạng thái ban đầu
    bars.forEach(bar => {
        bar.dataset.targetHeight = bar.style.height || '2px';
        bar.style.height = '0%';
    });
    anime.set(counts, { opacity: 0, translateY: 15 });
    anime.set(days, { opacity: 0, translateY: -10 });

    // Timeline cho biểu đồ
    const tl = anime.timeline({
        easing: 'easeOutElastic(1, 0.8)',
    });

    // 1. Cột mọc lên tuần tự
    tl.add({
        targets: bars,
        height: function(el) { return el.dataset.targetHeight; },
        duration: 1000,
        delay: anime.stagger(80)
    })
    // 2. Hiện số và tên ngày
    .add({
        targets: [counts, days],
        opacity: 1,
        translateY: 0,
        duration: 600,
        easing: 'easeOutCubic',
        delay: anime.stagger(50)
    }, '-=800');
}

/**
 * Animate biểu đồ Heatmap (Chuỗi hoạt động)
 * @param {HTMLElement} heatmapContainer 
 */
export function animateHeatmap(heatmapContainer) {
    if (!heatmapContainer) return;
    const cells = heatmapContainer.querySelectorAll('.heatmap-cell');
    if (cells.length === 0) return;

    anime.set(cells, { scale: 0, opacity: 0, borderRadius: '50%' });

    anime({
        targets: cells,
        scale: [
            { value: 1.3, easing: 'easeOutSine', duration: 200 },
            { value: 1, easing: 'easeInOutQuad', duration: 400 }
        ],
        opacity: [0, 1],
        borderRadius: ['50%', '4px'],
        delay: anime.stagger(30, { from: 'last' }), // Lan tỏa từ ngày gần nhất ngược về quá khứ
        easing: 'easeOutQuad'
    });
}