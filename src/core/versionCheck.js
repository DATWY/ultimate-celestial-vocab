// src/core/versionCheck.js
import { APP_VERSION, BUILD_TIME } from './version.js';

// Nạp động modal để phá vòng import modal.js <-> versionCheck.js.
async function showToastAsync(title, message, icon = 'ph-trophy') {
    try {
        const modal = await import('../ui/modal.js');
        modal.showToast?.(title, message, icon);
    } catch (_) {}
}

// ============================================================================
// CHỐNG RELOAD LOOP (T2.1)
//
// Trước đây: /version.json khác bundle → xoá TOÀN BỘ CacheStorage + unregister
// SW + reload, không nhớ đã reload hay chưa. Hễ HTML còn cũ hơn server (deploy
// lệch, SW trả HTML cache, người dùng offline với HTML cũ) là lặp vô hạn và
// xoá sạch cache mỗi vòng.
//
// Bây giờ: mỗi lần auto-reload ghi lại { version, at } rồi mới reload. Cùng một
// phiên bản server chỉ được auto-reload 1 lần trong RELOAD_GUARD_WINDOW_MS;
// các lần sau chỉ hiện thông báo mềm để người dùng tự quyết định tải lại.
// ============================================================================
export const RELOAD_GUARD_KEY = 'celestial_last_reload';
export const RELOAD_GUARD_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
export const UPDATE_AVAILABLE_EVENT = 'app:update-available';

/**
 * Quyết định làm gì khi /version.json lệch với bundle đang chạy.
 * Hàm thuần (không đọc localStorage, không đụng DOM) để test được.
 *
 * @param {Object}  input
 * @param {string}  input.hosted     - version đọc từ /version.json
 * @param {string}  input.local      - APP_VERSION của bundle đang chạy
 * @param {Object}  [input.lastReload] - { version, at } của lần auto-reload gần nhất
 * @param {number}  [input.now]      - mốc thời gian hiện tại (ms)
 * @param {boolean} [input.online]   - navigator.onLine
 * @returns {'reload'|'notify'|'none'}
 */
export function decideVersionAction({
    hosted,
    local,
    hostedBuildTime = null,
    localBuildTime = null,
    lastReload = null,
    now = Date.now(),
    online = true
} = {}) {
    // 1) Offline: HTML có thể cũ hơn server một cách hợp lệ. Tuyệt đối không
    //    reload và không xoá cache — làm vậy chỉ tự phá bản offline đang chạy.
    if (online === false) return 'none';

    const hostedVersion = typeof hosted === 'string' ? hosted.trim() : '';
    const localVersion = typeof local === 'string' ? local.trim() : '';
    // Không đọc được version một trong hai phía → không đủ căn cứ để phá app.
    if (!hostedVersion || !localVersion) return 'none';

    // 2) Đang chạy đúng bản server đang phát.
    //
    //    So sánh CHUỖI KHÔNG ĐỦ: chuỗi chỉ có độ phân giải 1 GIỜ
    //    (DATWY.V{seq}.{yymmdd}.{hh}), nên hai lần deploy trong cùng một giờ cho
    //    ra chuỗi giống hệt nhau. Khi đó client cũ tưởng "đã mới nhất" và KHÔNG
    //    BAO GIỜ cập nhật (đúng sự cố 2026-10-29: sửa CSS đã deploy nhưng máy
    //    người dùng vẫn chạy bundle cũ). Vì vậy so thêm mốc dựng buildTime.
    const hostedAt = Date.parse(typeof hostedBuildTime === 'string' ? hostedBuildTime : '');
    const localAt = Date.parse(typeof localBuildTime === 'string' ? localBuildTime : '');
    const hostedBuildIsNewer = Number.isFinite(hostedAt) && Number.isFinite(localAt) && hostedAt > localAt;
    if (hostedVersion === localVersion && !hostedBuildIsNewer) return 'none';

    // 3) Đã auto-reload cho ĐÚNG phiên bản này trong 24h qua → đây là vòng lặp
    //    (hoặc deploy lệch không tự khỏi được). Chỉ cảnh báo, không reload.
    const guardVersion = lastReload && typeof lastReload === 'object' && typeof lastReload.version === 'string'
        ? lastReload.version.trim()
        : '';
    const guardBuildKey = lastReload && typeof lastReload === 'object' && typeof lastReload.buildTime === 'string'
        ? lastReload.buildTime.trim()
        : '';
    // Guard phải khớp CẢ mốc dựng, nếu không hai bản dựng cùng chuỗi version sẽ
    // dùng chung một guard và lần cập nhật thứ hai chỉ còn 'notify'.
    const sameGuardBuild = !hostedBuildTime || guardBuildKey === String(hostedBuildTime).trim();
    if (guardVersion && guardVersion === hostedVersion && sameGuardBuild) {
        const guardAt = Number(lastReload.at);
        const recent = !Number.isFinite(guardAt) || (Number(now) - guardAt) < RELOAD_GUARD_WINDOW_MS;
        // guardAt ở tương lai (lệch đồng hồ) cũng rơi vào đây → vẫn an toàn.
        if (recent) return 'notify';
    }

    // 4) Lệch thật và chưa từng auto-reload cho bản này → reload đúng 1 lần.
    return 'reload';
}

/**
 * Cache thuộc về app này: Workbox precache + các cacheName khai báo trong
 * vite.config.js. Chỉ những cache này mới được phép xoá khi cập nhật.
 */
const APP_CACHE_PREFIXES = [
    'workbox-precache',
    'celestial',
    'firebase-chunk-cache',
    'firebase-sdk-cache',
    'google-fonts-cache',
    'gstatic-fonts-cache',
    'unpkg-cache',
    'cdnjs-cache',
    'jsdelivr-cache',
];

export function isAppCacheName(name) {
    if (typeof name !== 'string') return false;
    return APP_CACHE_PREFIXES.some(prefix => name.startsWith(prefix));
}

/** Đọc guard auto-reload. Trả null nếu chưa có / hỏng / không có localStorage. */
export function readReloadGuard() {
    try {
        const raw = localStorage.getItem(RELOAD_GUARD_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || typeof parsed.version !== 'string') return null;
        return { version: parsed.version, buildTime: typeof parsed.buildTime === 'string' ? parsed.buildTime : null, at: Number(parsed.at) };
    } catch (_) {
        return null;
    }
}

function saveReloadGuard(version, buildTime = null) {
    try {
        localStorage.setItem(RELOAD_GUARD_KEY, JSON.stringify({ version, buildTime, at: Date.now() }));
    } catch (_) {}
}

let _isUpdating = false;
let _lastCheckTime = 0;
let _notifiedVersion = null;
const CHECK_COOLDOWN_MS = 60 * 1000; // Tối đa kiểm tra 1 lần mỗi phút khi tự động

/**
 * Hiển thị số phiên bản lên giao diện người dùng
 */
export function displayAppVersion() {
    const el = document.getElementById('app-version-display');
    if (el) {
        el.textContent = APP_VERSION;
        el.title = `Bản dựng: ${BUILD_TIME}`;
    }
}

/**
 * Báo "có bản mới" theo cách mềm: phát CustomEvent cho UI nào muốn bám vào,
 * đồng thời hiện toast (tự tắt) — không chặn, không reload, không xoá cache.
 * Mỗi phiên bản chỉ báo 1 lần để không spam khi tab visible nhiều lần.
 */
function notifyUpdateAvailable(hostedVersion) {
    try {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent(UPDATE_AVAILABLE_EVENT, {
                detail: { version: hostedVersion, localVersion: APP_VERSION }
            }));
        }
    } catch (_) {}

    if (_notifiedVersion === hostedVersion) return;
    _notifiedVersion = hostedVersion;
    void showToastAsync(
        'Có Bản Cập Nhật Mới',
        `Bản ${hostedVersion} đã sẵn sàng. Tải lại trang khi bạn rảnh để cập nhật.`,
        'ph-arrows-clockwise'
    );
}

/**
 * Thực hiện reset cache và cập nhật web lên phiên bản mới nhất.
 * CHỈ được gọi khi decideVersionAction() đã trả 'reload'.
 * @param {string} newVersion
 */
export async function performAppResetAndUpdate(newVersion, newBuildTime = null) {
    if (_isUpdating) return;
    _isUpdating = true;

    // Ghi guard TRƯỚC mọi thao tác khác: nếu bước sau lỗi giữa chừng và trang
    // vẫn reload, lần kiểm tra kế tiếp thấy guard và chỉ cảnh báo — không loop.
    if (newVersion) saveReloadGuard(newVersion, newBuildTime);

    console.log(`[VersionCheck] 🚀 Đang tiến hành reset web để cập nhật lên phiên bản: ${newVersion}`);
    await showToastAsync("Phát hiện Bản Cập Nhật Mới", `Hệ thống nâng cấp lên ${newVersion}. Đang làm mới dữ liệu...`, "ph-arrows-clockwise");

    try {
        // 1. Ghi nhận phiên bản mới (localStorage của app, KHÔNG bị xoá)
        try { localStorage.setItem('celestial_app_version', newVersion); } catch (_) {}

        // 2. Chỉ dọn cache của app (Workbox precache + runtime cache tự khai báo)
        //    để bundle JS/CSS cũ không bị kẹt. Không đụng cache của origin khác
        //    và không đụng localStorage/IndexedDB của người dùng.
        if (typeof caches !== 'undefined') {
            const cacheNames = await caches.keys();
            const appCaches = cacheNames.filter(isAppCacheName);
            await Promise.all(appCaches.map(name => caches.delete(name)));
            console.log(`[VersionCheck] ✓ Đã xóa ${appCaches.length}/${cacheNames.length} cache của app.`);
        }

        // 3. Bỏ đăng ký SW cũ để HTML mới không bị SW cũ phục vụ lại
        if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (const registration of registrations) {
                await registration.unregister();
            }
            console.log(`[VersionCheck] ✓ Đã unregister ${registrations.length} Service Worker.`);
        }
    } catch (err) {
        console.warn('[VersionCheck] Lỗi khi dọn dẹp cache:', err);
    }

    // 4. Reload lại ứng dụng với cache-buster query để buộc trình duyệt lấy HTML mới
    setTimeout(() => {
        const cleanUrl = window.location.origin + window.location.pathname;
        window.location.replace(`${cleanUrl}?_update=${Date.now()}`);
    }, 700);
}

/**
 * Kiểm tra phiên bản mới từ server
 * @param {Object} options
 * @param {boolean} options.isManual - Người dùng bấm nút thủ công
 */
export async function checkAppVersion(options = { isManual: false }) {
    const now = Date.now();
    if (!options.isManual && now - _lastCheckTime < CHECK_COOLDOWN_MS) {
        return;
    }
    _lastCheckTime = now;

    displayAppVersion();

    // Đồng bộ phiên bản hiện tại vào localStorage nếu chưa có
    const localSavedVersion = localStorage.getItem('celestial_app_version');
    if (!localSavedVersion) {
        localStorage.setItem('celestial_app_version', APP_VERSION);
    }

    try {
        // Fetch trực tiếp file /version.json với timestamp ngẫu nhiên và cache: no-store
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4500);

        const res = await fetch(`/version.json?_t=${Date.now()}`, {
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        const serverVersion = typeof data?.version === 'string' ? data.version : null;
        const serverBuildTime = typeof data?.buildTime === 'string' ? data.buildTime : null;
        const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;

        const action = decideVersionAction({
            hosted: serverVersion,
            local: APP_VERSION,
            hostedBuildTime: serverBuildTime,
            localBuildTime: BUILD_TIME,
            lastReload: readReloadGuard(),
            now,
            online
        });

        if (action === 'reload') {
            // Guard { version: hosted, at: now } được ghi TRƯỚC khi reload
            // (dòng đầu của performAppResetAndUpdate) để lần kiểm tra sau
            // không reload lần 2 cho cùng phiên bản.
            await performAppResetAndUpdate(serverVersion, serverBuildTime);
            return true;
        }

        if (action === 'notify') {
            // Bản mới đã có nhưng không tự reload nữa (tránh loop, tránh mất
            // ngữ cảnh đang gõ). Thông báo mềm do notifyUpdateAvailable lo.
            notifyUpdateAvailable(serverVersion);
            return false;
        }

        // Phiên bản đã là mới nhất
        if (options.isManual) {
            if (!serverVersion) {
                await showToastAsync("Không Thể Kiểm Tra", "Máy chủ không trả về số phiên bản hợp lệ", "ph-warning");
            } else {
                await showToastAsync("Hệ Thống Đã Mới Nhất", `Bạn đang chạy phiên bản ${APP_VERSION}`, "ph-check-circle");
            }
        }
        return false;
    } catch (err) {
        // Xử lý khi offline hoặc mạng gián đoạn: không đụng gì tới cache
        if (options.isManual) {
            await showToastAsync("Không Thể Kiểm Tra", "Không thể kết nối máy chủ để kiểm tra bản mới (Offline)", "ph-wifi-slash");
        } else {
            console.log('[VersionCheck] Không thể kiểm tra phiên bản từ xa (có thể đang offline):', err.message);
        }
        return false;
    }
}
