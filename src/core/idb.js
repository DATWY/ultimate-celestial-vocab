// src/core/idb.js
import { openDB } from 'idb';
let dbPromise;
const DB_NAME = 'celestial-vocab-idb';
const VOCAB_STORE = 'vocabulary';
const SETTINGS_STORE = 'settings';

export async function initAppDB() {
    dbPromise = openDB(DB_NAME, 1, {
        upgrade(db) {
            if (!db.objectStoreNames.contains(VOCAB_STORE)) {
                db.createObjectStore(VOCAB_STORE, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
                db.createObjectStore(SETTINGS_STORE);
            }
        }
    });
    return dbPromise;
}

export async function getAllVocabularyFromDB() {
    const db = await dbPromise;
    if (!db) return [];
    return db.getAll(VOCAB_STORE);
}

export async function saveWordToDB(word) {
    const db = await dbPromise;
    if (!db) return;
    return db.put(VOCAB_STORE, word);
}

export async function saveAllVocabularyToDB(vocabArray) {
    const db = await dbPromise;
    if (!db) return;
    const tx = db.transaction(VOCAB_STORE, 'readwrite');
    for (const word of vocabArray) {
        tx.store.put(word);
    }
    await tx.done;
}

export async function deleteWordFromDB(id) {
    const db = await dbPromise;
    if (!db) return;
    return db.delete(VOCAB_STORE, id);
}

export async function getSettingFromDB(key) {
    const db = await dbPromise;
    if (!db) return null;
    return db.get(SETTINGS_STORE, key);
}

export async function saveSettingToDB(key, value) {
    const db = await dbPromise;
    if (!db) return;
    return db.put(SETTINGS_STORE, value, key);
}
