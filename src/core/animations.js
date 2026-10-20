
import { getState } from './state.js';

// 'anime' là biến toàn cục từ CDN, không cần import

const DEFAULT_DURATION = 400;
const EASE_OUT_EXPO = 'easeOutExpo';
const EASE_IN_OUT_SINE = 'easeInOutSine';

export async function animateFlip(cardElement) {
    if (!cardElement) return;
    const isBoost = typeof getState === 'function' && getState()?.isBoostMode;
    const currentRotation = typeof anime !== 'undefined' && anime.get ? anime.get(cardElement, 'rotateY', 'deg') : 0;
    cardElement.style.pointerEvents = 'none';
    if (isBoost) {
        if (typeof anime !== 'undefined') {
            await anime({
                targets: cardElement,
                rotateY: `${parseFloat(currentRotation) + 180}deg`,
                easing: 'easeOutQuad',
                duration: 120,
            }).finished;
        }
    } else {
        await anime({
            targets: cardElement,
            rotateY: `${parseFloat(currentRotation) + 180}deg`,
            easing: 'easeInOutSine',
            duration: 500,
        }).finished;
    }
    cardElement.style.pointerEvents = 'auto';
}

let lastExitDirection = -1; // -1 for left, 1 for right

export async function animateCardOut(cardElement) {
    if (!cardElement) return;
    const isBoost = typeof getState === 'function' && getState()?.isBoostMode;
    if (isBoost) return;
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
    const isBoost = typeof getState === 'function' && getState()?.isBoostMode;
    if (isBoost) {
        if (typeof anime !== 'undefined') {
            anime.set(cardElement, {
                translateX: '0%',
                opacity: 1,
                rotate: '0deg'
            });
        }
        return;
    }
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
 * Animate đếm số siêu mượt (Animated Stats with Decimal & Suffix Support).
 * @param {HTMLElement} element - Phần tử cần animate số.
 * @param {number} endValue - Giá trị kết thúc.
 * @param {number} duration - Thời gian chạy animation (ms).
 * @param {boolean|object} options - Format boolean hoặc object { format, decimals, suffix, prefix }.
 */
export function animateNumber(element, endValue, duration = 1600, options = false) {
    if (!element) return;
    
    // Normalize options (backward-compatible)
    const opts = typeof options === 'boolean' ? { format: options } : (options || {});
    const isFormat = !!opts.format;
    const decimals = typeof opts.decimals === 'number' ? opts.decimals : (String(endValue).includes('.') ? 1 : 0);
    const suffix = opts.suffix || '';
    const prefix = opts.prefix || '';

    // Parse start value
    let startValue = 0;
    const rawText = element.textContent || '';
    if (decimals > 0) {
        const match = rawText.match(/[-+]?[0-9]*\.?[0-9]+/);
        startValue = match ? parseFloat(match[0]) : 0;
    } else {
        startValue = parseInt(rawText.replace(/\D/g, '')) || 0;
    }

    const formatVal = (v) => {
        let numStr = '';
        if (decimals > 0) {
            numStr = Number(v).toFixed(decimals);
        } else {
            const rounded = Math.round(v);
            numStr = isFormat ? rounded.toLocaleString('vi-VN') : String(rounded);
        }
        return `${prefix}${numStr}${suffix}`;
    };

    const isBoost = typeof getState === 'function' && getState()?.isBoostMode;
    if (isBoost) {
        element.textContent = formatVal(endValue);
        return;
    }

    if (startValue === endValue) {
        element.textContent = formatVal(endValue);
        return;
    }

    if (element._animeObj) {
        anime.remove(element._animeObj);
    }

    const obj = { val: startValue };
    element._animeObj = obj;

    let lastRenderedVal = null;

    anime({
        targets: obj,
        val: endValue,
        duration: duration,
        easing: 'easeOutCubic',
        update: function() {
            const currentStr = formatVal(obj.val);
            if (lastRenderedVal !== currentStr) {
                element.textContent = currentStr;
                lastRenderedVal = currentStr;
            }
        },
        complete: function() {
            element.textContent = formatVal(endValue);
        }
    });
}

/**
 * Animate biểu đồ Forecast (Dự báo ôn tập 7 ngày với hiệu ứng nảy kinetic spring)
 * @param {HTMLElement} chartContainer 
 */
export function animateForecastChart(chartContainer) {
    if (!chartContainer) return;
    const bars = chartContainer.querySelectorAll('.forecast-bar');
    const counts = chartContainer.querySelectorAll('.forecast-count');
    const days = chartContainer.querySelectorAll('.forecast-day');
    const avgLine = chartContainer.querySelector('.forecast-avg-line');
    const summaryStrip = document.getElementById('forecast-summary-strip');

    if (bars.length === 0) return;

    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        bars.forEach(bar => {
            bar.style.height = bar.dataset.targetHeight || bar.style.height || '4px';
        });
        return;
    }

    // Chuẩn bị trạng thái ban đầu
    bars.forEach(bar => {
        bar.dataset.targetHeight = bar.style.height || '2px';
        bar.style.height = '0%';
    });

    counts.forEach(c => {
        c.dataset.targetCount = c.textContent.trim();
        c.textContent = '0';
    });

    anime.set(counts, { opacity: 0, scale: 0.4, translateY: 14 });
    anime.set(days, { opacity: 0, translateY: -8 });
    if (avgLine) {
        anime.set(avgLine, { opacity: 0, scaleX: 0, transformOrigin: 'left center' });
    }
    if (summaryStrip) {
        anime.set(summaryStrip, { opacity: 0, translateY: 10 });
    }

    // Timeline cho biểu đồ
    const tl = anime.timeline({
        easing: 'easeOutCubic',
    });

    // 1. Cột mọc lên tuần tự với hiệu ứng lò xo bật nảy (kinetic overshoot)
    tl.add({
        targets: bars,
        height: function(el) { return el.dataset.targetHeight; },
        duration: 650,
        delay: anime.stagger(50),
        easing: 'cubicBezier(0.34, 1.4, 0.64, 1)' // Elastic overshoot bounce
    })
    // 2. Hiện nhãn ngày trượt xuống
    .add({
        targets: days,
        opacity: [0, 1],
        translateY: [-8, 0],
        duration: 400,
        delay: anime.stagger(35),
        easing: 'easeOutQuad'
    }, '-=520')
    // 3. Số đếm trên đỉnh cột nảy bung ra và chạy số đồng bộ
    .add({
        targets: counts,
        opacity: [0, 1],
        scale: [0.4, 1.25, 1],
        translateY: [14, 0],
        duration: 480,
        delay: anime.stagger(40),
        easing: 'easeOutBack',
        begin: function() {
            counts.forEach(c => {
                const targetNum = parseInt(c.dataset.targetCount, 10) || 0;
                animateNumber(c, targetNum, 480);
            });
        }
    }, '-=460');

    // 4. Đường trung bình (dashed average line) quét ngang mượt mà
    if (avgLine) {
        tl.add({
            targets: avgLine,
            opacity: [0, 1],
            scaleX: [0, 1],
            duration: 650,
            easing: 'cubicBezier(0.16, 1, 0.3, 1)'
        }, '-=380');
    }

    // 5. Thanh tóm tắt tải thông minh trượt lên êm ái
    if (summaryStrip) {
        tl.add({
            targets: summaryStrip,
            opacity: [0, 1],
            translateY: [10, 0],
            duration: 450,
            easing: 'cubicBezier(0.16, 1, 0.3, 1)'
        }, '-=300');
    }
}

/**
 * Animate biểu đồ Heatmap (Làn sóng ma trận 84 ô Cosmic Ripple)
 * @param {HTMLElement} heatmapContainer 
 */
export function animateHeatmap(heatmapContainer) {
    if (!heatmapContainer) return;
    const cells = heatmapContainer.querySelectorAll('.heatmap-cell');
    const monthTitles = heatmapContainer.querySelectorAll('.heatmap-month-block-title');
    const weekdayLabels = heatmapContainer.querySelectorAll('.heatmap-weekday-labels');
    const summaryText = heatmapContainer.closest('.heatmap-card')?.querySelector('.heatmap-summary-text strong');
    const legend = heatmapContainer.closest('.heatmap-card')?.querySelector('.heatmap-legend');

    if (cells.length === 0) return;

    const isBoost = typeof getState === 'function' && getState()?.isBoostMode;
    if (isBoost || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
        cells.forEach(c => {
            c.style.opacity = '';
            c.style.transform = '';
        });
        if (summaryText) {
            const totalReviews = parseInt(summaryText.textContent.replace(/\D/g, ''), 10) || 0;
            summaryText.textContent = totalReviews.toLocaleString('vi-VN');
        }
        return;
    }

    // Tiêu đề tháng trượt nhẹ từ trên xuống
    if (monthTitles.length > 0) {
        anime.set(monthTitles, { opacity: 0, translateY: -8 });
        anime({
            targets: monthTitles,
            opacity: [0, 1],
            translateY: [-8, 0],
            duration: 420,
            delay: anime.stagger(70),
            easing: 'easeOutCubic'
        });
    }

    // Nhãn thứ trong tuần mờ dần vào
    if (weekdayLabels.length > 0) {
        anime.set(weekdayLabels, { opacity: 0 });
        anime({
            targets: weekdayLabels,
            opacity: [0, 1],
            duration: 420,
            easing: 'easeOutCubic'
        });
    }

    // Animate đếm số tổng lượt ôn 84 ngày qua
    if (summaryText) {
        const totalReviews = parseInt(summaryText.textContent.replace(/\D/g, ''), 10) || 0;
        if (totalReviews > 0) {
            summaryText.textContent = '0';
            animateNumber(summaryText, totalReviews, 1200, { format: true });
        }
    }

    if (legend) {
        anime.set(legend, { opacity: 0, translateY: 6 });
        anime({
            targets: legend,
            opacity: [0, 1],
            translateY: [6, 0],
            duration: 400,
            delay: 300,
            easing: 'easeOutCubic'
        });
    }

    // Hiệu ứng lan tỏa ma trận 84 ô (Cosmic Ripple)
    anime.set(cells, { scale: 0.55, opacity: 0.2, borderRadius: '6px' });

    anime({
        targets: cells,
        scale: [
            { value: 1.25, easing: 'easeOutSine', duration: 140 },
            { value: 1, easing: 'easeInOutQuad', duration: 180 }
        ],
        opacity: [0.2, 1],
        borderRadius: ['6px', '4px'],
        delay: anime.stagger(7, { from: 'last' }), // ~580ms lan tỏa mượt mà từ ngày gần nhất
        easing: 'easeOutQuad',
        complete: () => {
            cells.forEach(c => {
                c.style.opacity = '';
                c.style.transform = '';
            });
        }
    });
}

/**
 * Animate xuất hiện đồng bộ cho toàn bộ Trung Tâm Bento HUD (Tổng Quan & Trí Nhớ)
 * @param {HTMLElement} container 
 */
export function animateOverviewEntrance(container = document.getElementById('profile-view-overview')) {
    if (!container || container.classList.contains('hidden')) return;

    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return;
    }

    const tier1 = container.querySelector('.profile-hero-bento');
    const tier2 = container.querySelector('.fusionsrs-bento-section');
    const tier3 = container.querySelector('.bento-charts-row');

    // 1. So le 3 hàng Bento Cards với chuyển động nâng nhẹ
    const tiers = [tier1, tier2, tier3].filter(Boolean);
    if (tiers.length > 0) {
        anime.set(tiers, { opacity: 0, translateY: 16 });
        anime({
            targets: tiers,
            opacity: [0, 1],
            translateY: [16, 0],
            duration: 520,
            delay: anime.stagger(85, { start: 40 }),
            easing: 'cubicBezier(0.16, 1, 0.3, 1)'
        });
    }

    // 2. Huy hiệu cấp độ & Vòng tròn Level nở ra kiêu hãnh
    const levelCircle = container.querySelector('.level-circle');
    const rankEmblem = container.querySelector('.rank-emblem-container');
    if (levelCircle || rankEmblem) {
        anime.set([rankEmblem, levelCircle].filter(Boolean), { scale: 0.8, opacity: 0 });
        anime({
            targets: [rankEmblem, levelCircle].filter(Boolean),
            scale: [0.8, 1.06, 1],
            opacity: [0, 1],
            duration: 650,
            delay: 120,
            easing: 'easeOutBack'
        });
    }

    // 3. Ngọn lửa Streak bùng cháy
    const streakIcon = container.querySelector('.streak-icon-wrapper');
    if (streakIcon) {
        anime.set(streakIcon, { scale: 0.75, rotate: -12 });
        anime({
            targets: streakIcon,
            scale: [0.75, 1.18, 1],
            rotate: [-12, 4, 0],
            duration: 700,
            delay: 160,
            easing: 'easeOutBack'
        });
    }

    // 4. Thanh tiến trình XP mọc lên với dải sáng (Ưu tiên dataset.targetWidth, chống xung đột CSS transition)
    const xpFill = container.querySelector('#profile-xp-fill') || document.getElementById('profile-xp-fill');
    if (xpFill) {
        const targetWidth = xpFill.dataset.targetWidth || (xpFill.style.width && xpFill.style.width !== '0%' ? xpFill.style.width : '0%');
        xpFill.dataset.targetWidth = targetWidth;

        const prevTransition = xpFill.style.transition;
        xpFill.style.transition = 'none';
        xpFill.style.width = '0%';
        void xpFill.offsetWidth;

        anime({
            targets: xpFill,
            width: targetWidth,
            duration: 850,
            delay: 180,
            easing: 'cubicBezier(0.16, 1, 0.3, 1)',
            complete: () => {
                if (xpFill) {
                    xpFill.style.transition = prevTransition || '';
                    xpFill.style.width = targetWidth;
                }
            }
        });
    }

    // 5. Ba thước đo vi mô (Micro-meters) của FusionSRS mở rộng
    const meters = container.querySelectorAll('.meter-fill');
    meters.forEach((meter, idx) => {
        const targetWidth = meter.dataset.targetWidth || (meter.style.width && meter.style.width !== '0%' ? meter.style.width : '50%');
        meter.dataset.targetWidth = targetWidth;

        const prevTransition = meter.style.transition;
        meter.style.transition = 'none';
        meter.style.width = '0%';
        void meter.offsetWidth;

        anime({
            targets: meter,
            width: targetWidth,
            duration: 800,
            delay: 200 + idx * 60,
            easing: 'cubicBezier(0.16, 1, 0.3, 1)',
            complete: () => {
                if (meter) {
                    meter.style.transition = prevTransition || '';
                    meter.style.width = targetWidth;
                }
            }
        });
    });

    // 6. Hiệu ứng nâng cho 3 thẻ con của FusionSRS
    const metricCards = container.querySelectorAll('.fusionsrs-metric-card');
    if (metricCards.length > 0) {
        anime.set(metricCards, { opacity: 0, translateY: 10 });
        anime({
            targets: metricCards,
            opacity: [0, 1],
            translateY: [10, 0],
            duration: 480,
            delay: anime.stagger(50, { start: 140 }),
            easing: 'cubicBezier(0.16, 1, 0.3, 1)'
        });
    }
}