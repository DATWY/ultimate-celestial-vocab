// src/core/versionCheck.js
import { APP_VERSION, BUILD_TIME } from './version.js';

// Nạp động modal để phá vòng import modal.js <-> versionCheck.js.
async function showToastAsync(title, message, icon = 'ph-trophy') {
    try {
        const modal = await import('../ui/modal.js');
        modal.showToast?.(title, message, icon);
    } catch (_) {}
}

let _isUpdating = false;
let _lastCheckTime = 0;
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
 * Thực hiện reset cache và cập nhật web lên phiên bản mới nhất
 * @param {string} newVersion 
 */
export async function performAppResetAndUpdate(newVersion) {
    if (_isUpdating) return;
    _isUpdating = true;

    console.log(`[VersionCheck] 🚀 Đang tiến hành reset web để cập nhật lên phiên bản: ${newVersion}`);
    await showToastAsync("Phát hiện Bản Cập Nhật Mới", `Hệ thống nâng cấp lên ${newVersion}. Đang làm mới dữ liệu...`, "ph-arrows-clockwise");

    try {
        // 1. Lưu phiên bản mới vào localStorage
        localStorage.setItem('celestial_app_version', newVersion);

        // 2. Dọn dẹp sạch sẽ toàn bộ Cache Storage của trình duyệt (tránh kẹt bundle JS/CSS cũ)
        if ('caches' in window) {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map(name => caches.delete(name)));
            console.log(`[VersionCheck] ✓ Đã xóa ${cacheNames.length} caches trong CacheStorage.`);
        }

        // 3. Cập nhật và unregister Service Worker cũ
        if ('serviceWorker' in navigator) {
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
        const serverVersion = data?.version;

        if (serverVersion && serverVersion !== APP_VERSION) {
            // Phát hiện phiên bản mới từ server khác với bundle hiện tại
            await performAppResetAndUpdate(serverVersion);
            return true;
        }

        // Phiên bản đã là mới nhất
        if (options.isManual) {
            await showToastAsync("Hệ Thống Đã Mới Nhất", `Bạn đang chạy phiên bản ${APP_VERSION}`, "ph-check-circle");
        }
        return false;
    } catch (err) {
        // Xử lý khi offline hoặc mạng gián đoạn
        if (options.isManual) {
            await showToastAsync("Không Thể Kiểm Tra", "Không thể kết nối máy chủ để kiểm tra bản mới (Offline)", "ph-wifi-slash");
        } else {
            console.log('[VersionCheck] Không thể kiểm tra phiên bản từ xa (có thể đang offline):', err.message);
        }
        return false;
    }
}
