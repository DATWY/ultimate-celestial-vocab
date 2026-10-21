// src/core/idb.js
import { openDB } from 'idb';
import { mergeProgress } from './progress-merge.js';
import { mergeCardFields } from './card-merge.js';
import { mergeReviewLogs } from './review-log-merge.js';
import { announceSyncStatus } from './sync-status.js';
let dbPromise;
const auditMode = import.meta.env?.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('audit') === '1';
const DB_NAME = auditMode ? 'celestial-vocab-audit-idb' : 'celestial-vocab-idb';
export const isIsolatedStorage = auditMode;
const VOCAB_STORE = 'vocabulary';
const SETTINGS_STORE = 'settings';
const OUTBOX_STORE = 'outbox';

export async function initAppDB() {
    dbPromise = openDB(DB_NAME, 2, {
        blocking() { void dbPromise?.then(database => database.close()); },
        blocked() {
            announceSyncStatus({ phase: 'storage-blocked' });
        },
        terminated() { announceSyncStatus({ phase: 'storage-error' }); },
        upgrade(db) {
            if (!db.objectStoreNames.contains(VOCAB_STORE)) {
                db.createObjectStore(VOCAB_STORE, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
                db.createObjectStore(SETTINGS_STORE);
            }
            if (!db.objectStoreNames.contains(OUTBOX_STORE)) db.createObjectStore(OUTBOX_STORE, { keyPath: 'id' });
        }
    });
    return dbPromise;
}

export async function getAllVocabularyFromDB() {
    const db = await dbPromise;
    if (!db) return [];
    return db.getAll(VOCAB_STORE);
}

export async function saveWordToDB(word, { markDirty = true } = {}) {
    const db = await dbPromise;
    if (!db) throw new Error('Kho dữ liệu chưa sẵn sàng.');
    const transaction = db.transaction([VOCAB_STORE, OUTBOX_STORE], 'readwrite');
    const words = transaction.objectStore(VOCAB_STORE), outbox = transaction.objectStore(OUTBOX_STORE);
    const previous = await words.get(word.id);
    const merged = mergeCardFields(word, previous);
    await words.put(merged);
    if (markDirty) {
        await outbox.put({ id: word.id, revision: crypto.randomUUID() });
    }
    await transaction.done;
    return merged;
}

export async function saveAllVocabularyToDB(vocabArray, { markDirty = false } = {}) {
    const db = await dbPromise;
    if (!db) throw new Error('Kho dữ liệu chưa sẵn sàng.');
    const tx = db.transaction([VOCAB_STORE, OUTBOX_STORE], 'readwrite');
    const words = tx.objectStore(VOCAB_STORE), outbox = tx.objectStore(OUTBOX_STORE);
    const stored = new Map((await words.getAll()).map(card => [card.id, card]));
    for (const word of vocabArray) {
        const merged = mergeCardFields(word, stored.get(word.id));
        stored.set(word.id, merged);
        await words.put(merged);
        if (markDirty) {
            await outbox.put({ id: word.id, revision: crypto.randomUUID() });
        }
    }
    await tx.done;
    return [...stored.values()];
}

export async function deleteWordFromDB(id) {
    const db = await dbPromise;
    if (!db) return;
    return db.delete(VOCAB_STORE, id);
}

export async function clearVocabularyDB() {
    const db = await dbPromise;
    if (!db) return;
    const transaction = db.transaction([VOCAB_STORE, OUTBOX_STORE], 'readwrite');
    await transaction.objectStore(VOCAB_STORE).clear();
    await transaction.objectStore(OUTBOX_STORE).clear();
    await transaction.done;
}

export async function getSettingFromDB(key) {
    const db = await dbPromise;
    if (!db) return null;
    return db.get(SETTINGS_STORE, key);
}

export async function saveSettingToDB(key, value) {
    const db = await dbPromise;
    if (!db) throw new Error('Kho dữ liệu chưa sẵn sàng.');
    return db.put(SETTINGS_STORE, value, key);
}

export async function getPendingCardIds() {
    const db = await dbPromise;
    return db ? db.getAllKeys(OUTBOX_STORE) : [];
}

export async function getPendingWriteSnapshot(ids) {
    const db = await dbPromise;
    if (!db) throw new Error('Kho dữ liệu chưa sẵn sàng.');
    const transaction = db.transaction([VOCAB_STORE, OUTBOX_STORE]);
    return Promise.all(ids.map(async id => {
        const [card, pending] = await Promise.all([
            transaction.objectStore(VOCAB_STORE).get(id), transaction.objectStore(OUTBOX_STORE).get(id)
        ]);
        return { id, card, revision: pending?.revision ?? null };
    }));
}

export async function acknowledgePendingWrites(records) {
    const db = await dbPromise;
    const transaction = db.transaction(OUTBOX_STORE, 'readwrite');
    const acknowledged = [];
    for (const { id, revision } of records) {
        const current = await transaction.store.get(id);
        if (!current || current.revision === revision) {
            if (current) await transaction.store.delete(id);
            acknowledged.push(id);
        }
    }
    await transaction.done;
    return acknowledged;
}

export async function saveProgressToDB(key, value, kind) {
    const db = await dbPromise;
    if (!db) throw new Error('Kho dữ liệu chưa sẵn sàng.');
    const transaction = db.transaction(SETTINGS_STORE, 'readwrite');
    const previous = await transaction.store.get(key);
    const merged = mergeProgress(value, previous || {}, kind, kind === 'daily' ? value.lastDate : null);
    await transaction.store.put(merged, key);
    await transaction.done;
    return merged;
}

export async function saveReviewLogsToDB(logs) {
    const db = await dbPromise;
    if (!db) throw new Error('Kho dữ liệu chưa sẵn sàng.');
    const transaction = db.transaction(SETTINGS_STORE, 'readwrite');
    const previous = await transaction.store.get('reviewLogs');
    const merged = mergeReviewLogs(logs, previous);
    await transaction.store.put(merged, 'reviewLogs');
    await transaction.done;
    return merged;
}
