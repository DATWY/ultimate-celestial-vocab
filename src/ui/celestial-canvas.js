// src/ui/celestial-canvas.js — Ultra High-FPS Eco Celestial Engine v5.0

let canvas, ctx;
let stars = [];
let shootingStars = [];
let mouse = { x: null, y: null, targetX: null, targetY: null };
let isDark = true;
let animFrameId = null;
let lastFrameTime = 0;
let lastActivityTime = performance.now();
let isTabVisible = true;
let isSuspended = false;
const IDLE_TIMEOUT_MS = 3000; // 3.0 seconds without mouse/key activity -> graceful drain then pause RAF loop

// Pre-rendered Sprite Cache for Ultra High FPS
let starSpritesDark = [];
let starSpritesLight = [];

function createStarSprite(size, isDarkMode) {
    const spriteCanvas = document.createElement('canvas');
    const padding = size * 4;
    const canvasSize = Math.ceil(size * 2 + padding * 2);
    spriteCanvas.width = canvasSize;
    spriteCanvas.height = canvasSize;
    const sCtx = spriteCanvas.getContext('2d');

    const center = canvasSize / 2;

    sCtx.save();
    sCtx.beginPath();
    sCtx.arc(center, center, size, 0, Math.PI * 2);

    if (isDarkMode) {
        sCtx.fillStyle = 'rgba(235, 230, 255, 1)';
        sCtx.shadowBlur = size * 3;
        sCtx.shadowColor = 'rgba(168, 85, 247, 0.9)';
    } else {
        sCtx.fillStyle = 'rgba(138, 43, 226, 0.9)';
        sCtx.shadowBlur = size * 2.5;
        sCtx.shadowColor = 'rgba(138, 43, 226, 0.6)';
    }

    sCtx.fill();
    sCtx.restore();

    return spriteCanvas;
}

function initSpriteCache() {
    starSpritesDark = [];
    starSpritesLight = [];
    const sizes = [0.8, 1.2, 1.8, 2.4];
    sizes.forEach(sz => {
        starSpritesDark.push({ size: sz, sprite: createStarSprite(sz, true) });
        starSpritesLight.push({ size: sz, sprite: createStarSprite(sz, false) });
    });
}

class Star {
    constructor(w, h) {
        this.reset(w, h);
    }

    reset(w, h) {
        this.x = Math.random() * w;
        this.y = Math.random() * h;
        this.size = Math.random() * 1.8 + 0.4;
        this.baseAlpha = Math.random() * 0.7 + 0.25;
        this.alpha = this.baseAlpha;
        this.twinkleSpeed = Math.random() * 0.02 + 0.005;
        this.twinkleDir = Math.random() > 0.5 ? 1 : -1;
        this.vx = (Math.random() - 0.5) * 0.18;
        this.vy = (Math.random() - 0.5) * 0.18;
        this.spriteIndex = Math.min(3, Math.floor(this.size * 1.5));
    }

    update(w, h, dtFactor) {
        this.x += this.vx * dtFactor;
        this.y += this.vy * dtFactor;

        if (this.x < 0) this.x = w;
        if (this.x > w) this.x = 0;
        if (this.y < 0) this.y = h;
        if (this.y > h) this.y = 0;

        // Twinkle
        this.alpha += this.twinkleSpeed * this.twinkleDir * dtFactor;
        if (this.alpha > 0.95 || this.alpha < 0.18) {
            this.twinkleDir *= -1;
        }

        // Smooth Mouse Parallax
        if (mouse.x !== null && mouse.y !== null) {
            const dx = mouse.x - this.x;
            const dy = mouse.y - this.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < 14400) { // 120 * 120
                const dist = Math.sqrt(distSq);
                const force = (120 - dist) / 120;
                this.x -= (dx / dist) * force * 0.8 * dtFactor;
                this.y -= (dy / dist) * force * 0.8 * dtFactor;
            }
        }
    }

    draw(ctx, isDark) {
        const sprites = isDark ? starSpritesDark : starSpritesLight;
        const spriteObj = sprites[this.spriteIndex] || sprites[0];
        const spr = spriteObj.sprite;
        const half = spr.width / 2;

        ctx.globalAlpha = Math.max(0.05, Math.min(1, this.alpha));
        ctx.drawImage(spr, this.x - half, this.y - half);
    }
}

class ShootingStar {
    constructor(w, h) {
        this.reset(w, h);
    }

    reset(w, h) {
        this.x = Math.random() * w;
        this.y = Math.random() * (h * 0.4);
        this.len = Math.random() * 80 + 40;
        this.speed = Math.random() * 8 + 4;
        this.size = Math.random() * 1.5 + 0.8;
        this.alpha = 1;
        this.active = false;
        this.timer = Math.random() * 300 + 150;
    }

    update(w, h, dtFactor, isIdle = false) {
        if (!this.active) {
            if (isIdle) return; // Do not spawn new shooting stars while idle
            this.timer -= dtFactor;
            if (this.timer <= 0) {
                this.active = true;
                this.x = Math.random() * (w * 0.8);
                this.y = Math.random() * (h * 0.3);
            }
            return;
        }

        this.x += this.speed * 1.2 * dtFactor;
        this.y += this.speed * 0.8 * dtFactor;
        this.alpha -= 0.015 * dtFactor;

        if (this.alpha <= 0 || this.x > w || this.y > h) {
            this.reset(w, h);
        }
    }

    draw(ctx, isDark) {
        if (!this.active) return;
        ctx.save();
        const gradient = ctx.createLinearGradient(
            this.x, this.y,
            this.x - this.len * 1.2, this.y - this.len * 0.8
        );
        if (isDark) {
            gradient.addColorStop(0, `rgba(255, 255, 255, ${this.alpha})`);
            gradient.addColorStop(0.3, `rgba(192, 132, 252, ${this.alpha * 0.6})`);
            gradient.addColorStop(1, 'rgba(192, 132, 252, 0)');
        } else {
            gradient.addColorStop(0, `rgba(138, 43, 226, ${this.alpha})`);
            gradient.addColorStop(1, 'rgba(138, 43, 226, 0)');
        }

        ctx.strokeStyle = gradient;
        ctx.lineWidth = this.size;
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        ctx.lineTo(this.x - this.len * 1.2, this.y - this.len * 0.8);
        ctx.stroke();
        ctx.restore();
    }
}

function wakeAndRecordActivity() {
    lastActivityTime = performance.now();
    if (isSuspended || !isTabVisible || document.hidden) return;
    if (document.body.classList.contains('modal-active')) return;
    if (animFrameId) return; // Already running: bypass DOM query & rAF queue
    if (document.querySelectorAll('.modal:not(.hidden)').length > 0) return;

    lastFrameTime = performance.now();
    animFrameId = requestAnimationFrame(animate);
}

export function suspendCelestialCanvas() {
    isSuspended = true;
    if (animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
    }
}

export function resumeCelestialCanvas() {
    if (document.hidden || !isTabVisible) return;
    if (document.body.classList.contains('modal-active')) return;
    if (document.querySelectorAll('.modal:not(.hidden)').length > 0) return;

    isSuspended = false;
    lastActivityTime = performance.now();
    lastFrameTime = performance.now();
    if (!animFrameId) {
        animFrameId = requestAnimationFrame(animate);
    }
}

export function initCelestialCanvas() {
    canvas = document.getElementById('celestial-canvas');
    if (!canvas) return;

    ctx = canvas.getContext('2d', { alpha: true });
    initSpriteCache();
    resizeCanvas();

    window.addEventListener('resize', () => {
        resizeCanvas();
        wakeAndRecordActivity();
    }, { passive: true });
    
    window.addEventListener('mousemove', (e) => {
        mouse.targetX = e.clientX;
        mouse.targetY = e.clientY;
        wakeAndRecordActivity();
    }, { passive: true });

    window.addEventListener('mouseleave', () => {
        mouse.targetX = null;
        mouse.targetY = null;
        mouse.x = null;
        mouse.y = null;
    }, { passive: true });

    window.addEventListener('pointerdown', wakeAndRecordActivity, { passive: true });
    window.addEventListener('touchstart', wakeAndRecordActivity, { passive: true });
    window.addEventListener('scroll', wakeAndRecordActivity, { passive: true });
    window.addEventListener('keydown', wakeAndRecordActivity, { passive: true });

    // Window blur & focus handlers: suspend on blur, resume on focus if no modal active
    window.addEventListener('blur', () => {
        document.body.classList.add('window-blurred');
        suspendCelestialCanvas();
    });

    window.addEventListener('focus', () => {
        document.body.classList.remove('window-blurred');
        if (!document.body.classList.contains('modal-active') && document.querySelectorAll('.modal:not(.hidden)').length === 0) {
            resumeCelestialCanvas();
        }
    });

    // Tab visibility handling
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            isTabVisible = false;
            document.body.classList.add('window-blurred');
            suspendCelestialCanvas();
        } else {
            isTabVisible = true;
            document.body.classList.remove('window-blurred');
            if (!document.body.classList.contains('modal-active') && document.querySelectorAll('.modal:not(.hidden)').length === 0) {
                resumeCelestialCanvas();
            }
        }
    });

    createElements();
    lastFrameTime = performance.now();
    lastActivityTime = performance.now();
    animFrameId = requestAnimationFrame(animate);
}

function resizeCanvas() {
    if (!canvas) return;
    // Lock DPR to 1: celestial stars are soft glowing points; DPR=1 saves 75% GPU fill rate
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
}

function createElements() {
    if (!canvas) return;
    const starCount = Math.floor((window.innerWidth * window.innerHeight) / 12000);
    stars = [];
    for (let i = 0; i < Math.min(starCount, 85); i++) {
        stars.push(new Star(window.innerWidth, window.innerHeight));
    }
    shootingStars = [
        new ShootingStar(window.innerWidth, window.innerHeight),
        new ShootingStar(window.innerWidth, window.innerHeight)
    ];
}

export function updateCanvasTheme(darkMode) {
    isDark = darkMode;
    wakeAndRecordActivity();
}

function animate(timestamp) {
    if (!ctx || !canvas || !isTabVisible || isSuspended) {
        if (animFrameId) {
            cancelAnimationFrame(animFrameId);
            animFrameId = null;
        }
        return;
    }

    const timeSinceActivity = timestamp - lastActivityTime;
    const isIdle = timeSinceActivity > IDLE_TIMEOUT_MS;
    const hasActiveShootingStars = shootingStars.some(ss => ss.active);

    // Graceful Drain: If idle and in-flight shooting stars finished their path, pause RAF loop
    if (isIdle && !hasActiveShootingStars) {
        if (animFrameId) {
            cancelAnimationFrame(animFrameId);
            animFrameId = null;
        }
        return; // Fully idle: 0 FPS, 0% GPU
    }

    animFrameId = requestAnimationFrame(animate);

    const targetInterval = isIdle ? 33.33 : 16.66; // 30 FPS while draining, ~60 FPS active
    const elapsed = timestamp - lastFrameTime;
    if (elapsed < targetInterval) {
        return;
    }

    lastFrameTime = timestamp - (elapsed % targetInterval);
    const dtFactor = Math.min(elapsed, 64) / 16.666; // Normalize to 60 FPS movement

    // Interpolate mouse position for smooth movement
    if (mouse.targetX !== null) {
        if (mouse.x === null) {
            mouse.x = mouse.targetX;
            mouse.y = mouse.targetY;
        } else {
            mouse.x += (mouse.targetX - mouse.x) * 0.15 * dtFactor;
            mouse.y += (mouse.targetY - mouse.y) * 0.15 * dtFactor;
        }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    stars.forEach(star => {
        star.update(canvas.width, canvas.height, dtFactor);
        star.draw(ctx, isDark);
    });

    ctx.globalAlpha = 1;

    shootingStars.forEach(ss => {
        ss.update(canvas.width, canvas.height, dtFactor, isIdle);
        ss.draw(ctx, isDark);
    });
}
