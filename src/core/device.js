// src/core/device.js — Persistent Device Identification for Multi-Device Sync & CRDT Actors

let _cachedDeviceId = null;

/**
 * Returns a persistent device ID unique to this physical device/browser profile.
 * Stored in localStorage so it survives page reloads, tab closures, and app restarts.
 * Falls back to an in-memory session ID in restricted/test environments.
 */
export function getDeviceId() {
    if (_cachedDeviceId) return _cachedDeviceId;
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            let id = localStorage.getItem('celestial_device_id');
            if (!id) {
                id = 'dev_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString(36);
                localStorage.setItem('celestial_device_id', id);
            }
            _cachedDeviceId = id;
            return _cachedDeviceId;
        }
    } catch (_) {
        // Fallback for restricted storage or private browsing mode
    }
    _cachedDeviceId = 'temp_dev_' + Math.random().toString(36).substring(2, 8);
    return _cachedDeviceId;
}

/**
 * CRDT-01: id actor cho tiến độ = thiết bị + TAB.
 *
 * Trước đây mọi tab dùng chung getDeviceId(), nên hai tab học cùng lúc ghi vào
 * CÙNG một component trong meta.actors; mergeProgress chỉ giữ component có seq
 * cao hơn (progress-merge.js:117) ⇒ toàn bộ delta của tab kia biến mất. Tách
 * theo tab để mỗi tab là một actor độc lập và cộng dồn được.
 */
export function buildActorId(deviceId, tabId) {
    const dev = typeof deviceId === 'string' ? deviceId.trim() : '';
    const tab = typeof tabId === 'string' ? tabId.trim() : '';
    return dev && tab ? `${dev}:${tab}` : (dev || tab);
}

let _tabId = null;

/** Id tab ổn định trong vòng đời tab (sessionStorage), khác nhau giữa các tab. */
export function getTabId() {
    if (_tabId) return _tabId;
    try {
        if (typeof window !== 'undefined' && window.sessionStorage) {
            let id = sessionStorage.getItem('celestial_tab_id');
            if (!id) {
                id = 'tab_' + Math.random().toString(36).substring(2, 10);
                sessionStorage.setItem('celestial_tab_id', id);
            }
            _tabId = id;
            return _tabId;
        }
    } catch (_) {
        // sessionStorage bị chặn: vẫn tách được tab trong phiên hiện tại.
    }
    _tabId = 'tab_' + Math.random().toString(36).substring(2, 8);
    return _tabId;
}

/** Actor id dùng cho CRDT tiến độ (thiết bị + tab). */
export function getActorId() {
    return buildActorId(getDeviceId(), getTabId());
}

/**
 * For test harnesses only: allows overriding or resetting the cached device ID.
 */
export function setDeviceIdForTest(id) {
    _cachedDeviceId = id;
}
