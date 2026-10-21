let status = { phase: 'local', pending: 0 };
export function getSyncStatus() { return status; }
export function announceSyncStatus(update) {
    status = { ...status, ...update };
    if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('sync:status', { detail: status }));
}
