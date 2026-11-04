// src/core/tab-bus.js — High-Performance Cross-Tab Bus (<2ms) & Web Locks Leader Election
import { getDeviceId } from './device.js';
import { mergeCardFields } from './card-merge.js';
import { storageDomain } from './idb.js';
import { channelNameFor, leaderLockNameFor, acceptsMessage } from './transport-domain.js';

// Tên kênh/khoá lock đi theo miền lưu trữ: tab audit (?audit=1) có kênh riêng nên không
// trao đổi card/progress với tab thường, và không giữ lock leader đồng bộ của tab thường.
const CHANNEL_NAME = channelNameFor(storageDomain);
const LEADER_LOCK_NAME = leaderLockNameFor(storageDomain);
// DEV: tab audit của mã CŨ cũng gửi thông điệp KHÔNG có `domain` trên kênh cũ ⇒ từ chối mọi
// thông điệp không khai báo miền. Production: không có audit, nên thông điệp không khai báo
// miền chỉ có thể từ tab thường bản deploy trước ⇒ vẫn nhận để không phá đồng bộ liên phiên bản.
const ALLOW_LEGACY_MESSAGES = !(typeof import.meta !== 'undefined' && import.meta.env?.DEV);

let _channel = null;
let _tabId = null;
let _isLeader = false;
const _leaderElectedCallbacks = [];

export function getTabId() {
    if (!_tabId) {
        _tabId = 'tab_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36);
    }
    return _tabId;
}

export function isLeaderTab() {
    return _isLeader;
}

export function onLeaderElected(callback) {
    if (typeof callback === 'function') {
        _leaderElectedCallbacks.push(callback);
        if (_isLeader) {
            try { callback(); } catch (e) { console.warn(e); }
        }
    }
}

/**
 * Broadcasts an event to all other open tabs in the same browser.
 */
export function broadcastTabMessage(type, payload = {}) {
    if (!_channel) return;
    try {
        _channel.postMessage({
            type,
            payload,
            // Khai báo miền để tab khác lọc được kể cả khi tên kênh bị trùng (tab bản cũ).
            domain: storageDomain,
            senderTabId: getTabId(),
            deviceId: getDeviceId(),
            ts: Date.now()
        });
    } catch (e) {
        console.warn("⚠️ [TabBus] Lỗi khi broadcast message:", e);
    }
}

export function broadcastCardUpdated(card) {
    broadcastTabMessage('CARD_UPDATED', { card });
}

export function broadcastProgressUpdated(gamification, dailyStats) {
    broadcastTabMessage('PROGRESS_UPDATED', { gamification, dailyStats });
}

export function broadcastRemoteSynced(meta = {}) {
    broadcastTabMessage('REMOTE_SYNCED', meta);
}

/**
 * Initializes the BroadcastChannel and Leader Election.
 */
export function initTabBus() {
    getTabId();

    // 1. Initialize BroadcastChannel
    if (typeof BroadcastChannel !== 'undefined') {
        try {
            _channel = new BroadcastChannel(CHANNEL_NAME);
            _channel.onmessage = async (event) => {
                const data = event.data;
                if (!data || data.senderTabId === getTabId()) return; // Ignore own messages
                // Tab audit và tab thường là hai miền lưu trữ khác nhau ⇒ không trao đổi gì.
                // Thông điệp cũ không có `domain` bị coi là miền `default` (tương thích ngược).
                if (!acceptsMessage(storageDomain, data.domain, ALLOW_LEGACY_MESSAGES)) return;

                switch (data.type) {
                    case 'CARD_UPDATED': {
                        const { card } = data.payload || {};
                        if (!card || !card.id) break;
                        const state = await import('./state.js');
                        const existing = state.getVocabById(card.id);
                        if (existing) {
                            const merged = mergeCardFields(existing, card);
                            state.updateCardInVocabulary(card.id, merged);
                        } else {
                            state.pushCardToVocabulary(card);
                        }
                        // Refresh UI if words modal is currently viewing
                        const isWordsActive = document.getElementById('manage-view-words')?.classList.contains('active');
                        if (isWordsActive) {
                            import('../ui/render.js').then(r => r.updatePanelWordList?.());
                        }
                        break;
                    }

                    case 'PROGRESS_UPDATED': {
                        const { gamification, dailyStats } = data.payload || {};
                        const state = await import('./state.js');
                        if (gamification) state.acceptProgress(gamification, 'gamification');
                        if (dailyStats) state.acceptProgress(dailyStats, 'daily');
                        import('../ui/render.js').then(r => r.updateStats?.());
                        import('../features/gamification.js').then(g => g.renderGamificationUI?.({ isBackgroundUpdate: true }));
                        break;
                    }

                    case 'REMOTE_SYNCED': {
                        // Leader tab finished cloud pull. Update follower tabs stats & UI silently
                        import('../ui/render.js').then(r => r.updateStats?.());
                        break;
                    }

                    default:
                        break;
                }
            };
        } catch (e) {
            console.warn("⚠️ [TabBus] BroadcastChannel không khả dụng:", e);
        }
    }

    // 2. Initialize Leader Election via Web Locks API
    if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
        navigator.locks.request(LEADER_LOCK_NAME, async () => {
            _isLeader = true;
            console.log("👑 [TabBus] Tab này đã trở thành SYNC LEADER.");
            _leaderElectedCallbacks.forEach(cb => {
                try { cb(); } catch (err) { console.warn(err); }
            });

            // Hold lock until window unloads
            await new Promise((resolve) => {
                window.addEventListener('beforeunload', resolve, { once: true });
            });
        }).catch((err) => {
            console.warn("⚠️ [TabBus] Lỗi khi bầu Leader:", err);
            _isLeader = true;
            _leaderElectedCallbacks.forEach(cb => {
                try { cb(); } catch (e) {}
            });
        });
    } else {
        // Fallback for browsers without Web Locks API: assume leader
        _isLeader = true;
        _leaderElectedCallbacks.forEach(cb => {
            try { cb(); } catch (e) {}
        });
    }
}
