// src/core/dedup-preferences.js — P10: nhớ quyết định "giữ riêng" của người dùng.
//
// Vì sao cần: các cặp BIẾN THỂ NGỮ PHÁP (facility⟷facilities, advise⟷advised)
// không nên gộp, nhưng lần quét nào chúng cũng hiện lại ở đầu danh sách "cần xử lý".
// Sự dai dẳng đó chính là thứ khiến người dùng bấm "Gộp" cho xong — rồi mất một từ.
// Ghi nhớ quyết định ⇒ lần sau không hỏi lại, không còn áp lực phải gộp bừa.

const STORAGE_KEY = 'celestial_dedup_kept_separate';
const MAX_ENTRIES = 2000;

function storage() {
    try {
        if (typeof localStorage === 'undefined') return null;
        return localStorage;
    } catch {
        return null;
    }
}

/** Đọc danh sách khoá cặp đã "giữ riêng". Hỏng dữ liệu ⇒ coi như rỗng, không ném lỗi. */
export function loadKeptSeparate() {
    const s = storage();
    if (!s) return new Set();
    try {
        const raw = s.getItem(STORAGE_KEY);
        if (!raw) return new Set();
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return new Set();
        return new Set(parsed.filter(k => typeof k === 'string' && k.includes('|')));
    } catch {
        return new Set();
    }
}

function persist(set) {
    const s = storage();
    if (!s) return;
    try {
        const list = [...set].slice(-MAX_ENTRIES);
        s.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
        // Hết quota: bỏ qua, không được làm hỏng luồng gộp thẻ.
    }
}

export function isKeptSeparate(key) {
    return loadKeptSeparate().has(key);
}

export function keepPairSeparate(key) {
    if (typeof key !== 'string' || !key.includes('|')) return false;
    const set = loadKeptSeparate();
    set.add(key);
    persist(set);
    return true;
}

export function keepPairsSeparate(keys) {
    const set = loadKeptSeparate();
    let added = 0;
    for (const key of Array.isArray(keys) ? keys : []) {
        if (typeof key === 'string' && key.includes('|') && !set.has(key)) {
            set.add(key);
            added++;
        }
    }
    persist(set);
    return added;
}

export function restorePair(key) {
    const set = loadKeptSeparate();
    const had = set.delete(key);
    if (had) persist(set);
    return had;
}

export function clearKeptSeparate() {
    const s = storage();
    if (!s) return;
    try {
        s.removeItem(STORAGE_KEY);
    } catch {
        // ignore
    }
}

/** Dọn các khoá trỏ tới thẻ đã bị xoá để danh sách không phình vô hạn. */
export function pruneKeptSeparate(validIds) {
    const valid = validIds instanceof Set ? validIds : new Set(validIds || []);
    const set = loadKeptSeparate();
    let removed = 0;
    for (const key of [...set]) {
        const [a, b] = key.split('|');
        const keepOne = valid.has(a) || valid.has(b);
        if (!keepOne) {
            set.delete(key);
            removed++;
        }
    }
    if (removed) persist(set);
    return removed;
}
