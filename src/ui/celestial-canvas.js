// src/ui/celestial-canvas.js — Ultra High-FPS Eco Celestial Engine v5.5 (Boost & Mobile Optimized)

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
let isBoostMode = false;
let isTypingActive = false;
const IDLE_TIMEOUT_MS = 1200; // 1.2s without interaction -> graceful sleep to 0% GPU

// Device detection helper: true only for real mobile screens/devices (never touch laptops)
export function isMobileDevice() {
    if (typeof window === 'undefined') return false;
    const isSmallScreen = window.innerWidth <= 768;
    const isMobileUserAgent = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || '');
    const isCoarseTouchOnly = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse) and (hover: none)').matches;
    return isSmallScreen || isMobileUserAgent || isCoarseTouchOnly;
}

// Pre-rendered Sprite Cache for Ultra High FPS
let starSpritesDark = [];
let starSpritesLight = [];

function createStarSprite(size, isDarkMode) {
    const spriteCanvas = document.createElement('canvas');
    const padding = size * 3;
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
        sCtx.shadowBlur = size * 2.5;
        sCtx.shadowColor = 'rgba(168, 85, 247, 0.85)';
    } else {
        sCtx.fillStyle = 'rgba(138, 43, 226, 0.9)';
        sCtx.shadowBlur = size * 2;
        sCtx.shadowColor = 'rgba(138, 43, 226, 0.5)';
    }

    sCtx.fill();
    sCtx.restore();

    return spriteCanvas;
}

function initSpriteCache() {
    starSpritesDark = [];
    starSpritesLight = [];
    const sizes = [0.8, 1.2, 1.8, 2.2];
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
        this.size = Math.random() * 1.6 + 0.4;
        this.baseAlpha = Math.random() * 0.65 + 0.25;
        this.alpha = this.baseAlpha;
        this.twinkleSpeed = Math.random() * 0.02 + 0.006;
        this.twinkleDir = Math.random() > 0.5 ? 1 : -1;
        this.vx = (Math.random() - 0.5) * 0.15;
        this.vy = (Math.random() - 0.5) * 0.15;
        this.spriteIndex = Math.min(3, Math.floor(this.size * 1.5));
    }

    update(w, h, dtFactor, enableParallax = true) {
        this.x += this.vx * dtFactor;
        this.y += this.vy * dtFactor;

        if (this.x < 0) this.x = w;
        if (this.x > w) this.x = 0;
        if (this.y < 0) this.y = h;
        if (this.y > h) this.y = 0;

        // Twinkle
        this.alpha += this.twinkleSpeed * this.twinkleDir * dtFactor;
        if (this.alpha > 0.95) {
            this.alpha = 0.95;
            this.twinkleDir = -1;
        } else if (this.alpha < 0.18) {
            this.alpha = 0.18;
            this.twinkleDir = 1;
        }

        // Smooth Mouse Parallax (only if mouse active and enabled)
        if (enableParallax && mouse.x !== null && mouse.y !== null) {
            const dx = mouse.x - this.x;
            const dy = mouse.y - this.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < 14400) { // 120 * 120
                const dist = Math.sqrt(distSq);
                const force = (120 - dist) / 120;
                this.x -= (dx / dist) * force * 0.7 * dtFactor;
                this.y -= (dy / dist) * force * 0.7 * dtFactor;
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
        this.y = Math.random() * (h * 0.35);
        this.len = Math.random() * 70 + 35;
        this.speed = Math.random() * 7 + 4;
        this.size = Math.random() * 1.4 + 0.8;
        this.alpha = 1;
        this.active = false;
        this.timer = Math.random() * 350 + 200;
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
        this.alpha -= 0.016 * dtFactor;

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
    if (isBoostMode || isSuspended || !isTabVisible || document.hidden || isTypingActive) return;
    if (document.body.classList.contains('modal-active') || document.body.classList.contains('window-blurred')) return;
    if (document.querySelectorAll('.modal:not(.hidden)').length > 0) return;
    if (animFrameId) return; // Already running

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
    if (isBoostMode || document.hidden || !isTabVisible || isTypingActive) return;
    if (document.body.classList.contains('modal-active') || document.body.classList.contains('window-blurred')) return;
    if (document.querySelectorAll('.modal:not(.hidden)').length > 0) return;

    isSuspended = false;
    lastActivityTime = performance.now();
    lastFrameTime = performance.now();
    if (!animFrameId) {
        animFrameId = requestAnimationFrame(animate);
    }
}

export function setTypingActive(active) {
    isTypingActive = !!active;
    if (isTypingActive) {
        if (animFrameId) {
            cancelAnimationFrame(animFrameId);
            animFrameId = null;
        }
    } else {
        if (!isBoostMode && isTabVisible && !isSuspended) {
            wakeAndRecordActivity();
        }
    }
}

export function setBoostMode(enabled) {
    isBoostMode = !!enabled;
    if (isBoostMode) {
        if (animFrameId) {
            cancelAnimationFrame(animFrameId);
            animFrameId = null;
        }
        if (ctx && canvas) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        if (canvas) {
            canvas.style.display = 'none';
        }
        stars = [];
        shootingStars = [];
    } else {
        if (!canvas) {
            canvas = document.getElementById('celestial-canvas');
        }
        if (canvas) {
            canvas.style.display = 'block';
            if (!ctx) {
                ctx = canvas.getContext('2d', { alpha: true });
                initSpriteCache();
                resizeCanvas();
            }
            attachEventListeners();
            createElements();
            wakeAndRecordActivity();
        }
    }
}

export function getBoostMode() {
    return isBoostMode;
}

let listenersAttached = false;

function attachEventListeners() {
    if (listenersAttached || typeof window === 'undefined') return;
    listenersAttached = true;

    const isMobile = isMobileDevice();

    let resizeTimer = null;
    window.addEventListener('resize', () => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (isBoostMode) return;
            resizeCanvas();
            createElements();
            wakeAndRecordActivity();
        }, 150);
    }, { passive: true });
    
    // Mouse movement only tracked on non-touch desktop to save CPU/GPU
    if (!isMobile) {
        let lastMouseWake = 0;
        window.addEventListener('mousemove', (e) => {
            if (isBoostMode) return;
            mouse.targetX = e.clientX;
            mouse.targetY = e.clientY;
            const now = performance.now();
            if (now - lastMouseWake > 500) {
                lastMouseWake = now;
                wakeAndRecordActivity();
            }
        }, { passive: true });

        window.addEventListener('mouseleave', () => {
            mouse.targetX = null;
            mouse.targetY = null;
            mouse.x = null;
            mouse.y = null;
        }, { passive: true });
    }

    window.addEventListener('pointerdown', (e) => {
        if (isBoostMode) return;
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
        wakeAndRecordActivity();
    }, { passive: true });

    window.addEventListener('keydown', (e) => {
        if (isBoostMode) return;
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
        wakeAndRecordActivity();
    }, { passive: true });

    // Window blur & focus handlers: suspend on blur, resume on focus
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
}

export function initCelestialCanvas() {
    canvas = document.getElementById('celestial-canvas');
    if (!canvas) return;

    attachEventListeners();

    if (isBoostMode) {
        canvas.style.display = 'none';
        return;
    }

    ctx = canvas.getContext('2d', { alpha: true });
    initSpriteCache();
    resizeCanvas();
    createElements();
    lastFrameTime = performance.now();
    lastActivityTime = performance.now();
    animFrameId = requestAnimationFrame(animate);
}

function resizeCanvas() {
    if (!canvas) return;
    // Lock DPR to 1: celestial stars are soft points; DPR=1 saves 75%+ GPU fill rate
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
}

function createElements() {
    if (!canvas || isBoostMode) return;
    const isMobile = isMobileDevice();
    const w = window.innerWidth;
    const h = window.innerHeight;

    stars = [];
    if (isMobile) {
        // Mobile: Ultra-lightweight 12 stars maximum, zero shooting stars
        const mobileStarCount = Math.min(Math.floor((w * h) / 38000), 12);
        for (let i = 0; i < Math.max(6, mobileStarCount); i++) {
            stars.push(new Star(w, h));
        }
        shootingStars = [];
    } else {
        // Desktop: Optimized 32 stars maximum, 1 shooting star
        const desktopStarCount = Math.min(Math.floor((w * h) / 26000), 32);
        for (let i = 0; i < Math.max(12, desktopStarCount); i++) {
            stars.push(new Star(w, h));
        }
        shootingStars = [
            new ShootingStar(w, h)
        ];
    }
}

export function updateCanvasTheme(darkMode) {
    isDark = darkMode;
    wakeAndRecordActivity();
}

function animate(timestamp) {
    if (!ctx || !canvas || !isTabVisible || isSuspended || isBoostMode || isTypingActive) {
        if (animFrameId) {
            cancelAnimationFrame(animFrameId);
            animFrameId = null;
        }
        return;
    }

    if (document.hidden || document.body.classList.contains('modal-active') || document.body.classList.contains('window-blurred')) {
        if (animFrameId) {
            cancelAnimationFrame(animFrameId);
            animFrameId = null;
        }
        return;
    }

    const timeSinceActivity = timestamp - lastActivityTime;
    const isIdle = timeSinceActivity > IDLE_TIMEOUT_MS;
    const hasActiveShootingStars = shootingStars.some(ss => ss.active);

    // Graceful Drain: If idle and in-flight shooting stars finished their path, pause RAF loop completely
    if (isIdle && !hasActiveShootingStars) {
        if (animFrameId) {
            cancelAnimationFrame(animFrameId);
            animFrameId = null;
        }
        return; // Fully idle: 0 FPS, 0% GPU
    }

    animFrameId = requestAnimationFrame(animate);

    // Eco Frame Rate Throttling:
    // Desktop: 30 FPS active (33.3ms), 15 FPS idle (66.6ms)
    // Mobile:  20 FPS active (50.0ms), 10 FPS idle (100ms)
    const isMobile = isMobileDevice();
    const targetInterval = isMobile 
        ? (isIdle ? 100 : 50) 
        : (isIdle ? 66.6 : 33.33);

    const elapsed = timestamp - lastFrameTime;
    if (elapsed < targetInterval) {
        return;
    }

    lastFrameTime = timestamp - (elapsed % targetInterval);
    const dtFactor = Math.min(elapsed, 100) / 16.666; // Normalize movement

    // Interpolate mouse position for smooth desktop parallax
    if (!isMobile && mouse.targetX !== null) {
        if (mouse.x === null) {
            mouse.x = mouse.targetX;
            mouse.y = mouse.targetY;
        } else {
            mouse.x += (mouse.targetX - mouse.x) * 0.15 * dtFactor;
            mouse.y += (mouse.targetY - mouse.y) * 0.15 * dtFactor;
        }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < stars.length; i++) {
        stars[i].update(canvas.width, canvas.height, dtFactor, !isMobile);
        stars[i].draw(ctx, isDark);
    }

    if (shootingStars.length > 0) {
        ctx.globalAlpha = 1;
        for (let i = 0; i < shootingStars.length; i++) {
            shootingStars[i].update(canvas.width, canvas.height, dtFactor, isIdle);
            shootingStars[i].draw(ctx, isDark);
        }
    }
}
