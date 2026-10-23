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
 * For test harnesses only: allows overriding or resetting the cached device ID.
 */
export function setDeviceIdForTest(id) {
    _cachedDeviceId = id;
}
