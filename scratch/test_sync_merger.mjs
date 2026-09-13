// Unit test script for Sync Merger & Multi-device Convergence
import assert from 'assert';

console.log("🚀 Starting Sync Merger Adversarial Verification...\n");

// 1. Emulate toMillis & getDeviceId & mergeCardFields & isSrsEqual from firebase.js
function toMillis(val) {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    if (typeof val.toMillis === 'function') return val.toMillis();
    if (val instanceof Date) return val.getTime();
    if (typeof val.seconds === 'number') return val.seconds * 1000 + (val.nanoseconds || 0) / 1e6;
    return 0;
}

let mockDeviceId = "dev_test_device_1";
function getDeviceId() { return mockDeviceId; }
function getCalibratedNow() { return 1700000000000; }

function mergeCardFields(local, remote) {
    if (!local) return remote;
    if (!remote) return local;

    const localTime = toMillis(local.updatedAt) || 0;
    const remoteTime = toMillis(remote.updatedAt) || 0;
    const maxUpdatedTime = Math.max(localTime, remoteTime, getCalibratedNow());

    // --- VECTOR 1: TOMBSTONE (DELETION) ---
    const localDeleted = !!local.isDeleted;
    const remoteDeleted = !!remote.isDeleted;

    if (localDeleted !== remoteDeleted) {
        if (remoteDeleted) {
            if (remoteTime >= localTime) {
                return { ...remote, isDeleted: true, updatedAt: maxUpdatedTime };
            }
        } else {
            if (localTime >= remoteTime) {
                return { ...local, isDeleted: true, updatedAt: maxUpdatedTime };
            }
        }
    } else if (localDeleted && remoteDeleted) {
        return { ...local, ...remote, isDeleted: true, updatedAt: maxUpdatedTime };
    }

    // --- VECTOR 2: SRS MEMORY STATE ---
    const localReviewTime = toMillis(local.lastReviewDate) || 0;
    const remoteReviewTime = toMillis(remote.lastReviewDate) || 0;
    const localReps = Number(local.reps) || 0;
    const remoteReps = Number(remote.reps) || 0;

    let srsWinner = local;
    if (remoteReviewTime > localReviewTime) {
        srsWinner = remote;
    } else if (localReviewTime > remoteReviewTime) {
        srsWinner = local;
    } else {
        if (remoteReps > localReps) {
            srsWinner = remote;
        } else if (localReps > remoteReps) {
            srsWinner = local;
        } else {
            const localIsNew = !local.srsStatus || local.srsStatus === 'New';
            const remoteIsNew = !remote.srsStatus || remote.srsStatus === 'New';
            if (localIsNew && !remoteIsNew) srsWinner = remote;
            else if (!localIsNew && remoteIsNew) srsWinner = local;
            else srsWinner = remoteTime > localTime ? remote : local;
        }
    }

    // --- VECTOR 3: CONTENT EDITORIAL DATA ---
    const contentWinner = remoteTime > localTime ? remote : local;
    const contentFallback = contentWinner === remote ? local : remote;

    const pickNonEmpty = (key) => {
        const val1 = contentWinner[key];
        const val2 = contentFallback[key];
        if (val1 !== undefined && val1 !== null && val1 !== '') return val1;
        return val2 !== undefined && val2 !== null ? val2 : val1;
    };

    // --- VECTOR 4: TAGS UNION ---
    const localTags = Array.isArray(local.tags) ? local.tags : [];
    const remoteTags = Array.isArray(remote.tags) ? remote.tags : [];
    const mergedTags = Array.from(new Set([...localTags, ...remoteTags]))
        .map(t => typeof t === 'string' ? t.trim() : String(t))
        .filter(t => t.length > 0 && t.toLowerCase() !== 'all');

    // --- VECTOR 5: FLAGS ---
    const flagsWinner = remoteTime > localTime ? remote : local;

    return {
        id: local.id || remote.id,
        english: pickNonEmpty('english') || local.english || remote.english,
        vietnamese: pickNonEmpty('vietnamese') || local.vietnamese || remote.vietnamese,
        phonetic: pickNonEmpty('phonetic') || '',
        type: pickNonEmpty('type') || local.type || remote.type || '',
        example: pickNonEmpty('example') || '',
        exampleMeaning: pickNonEmpty('exampleMeaning') || pickNonEmpty('exampleVi') || '',
        exampleVi: pickNonEmpty('exampleVi') || pickNonEmpty('exampleMeaning') || '',
        notes: pickNonEmpty('notes') || '',
        synonyms: pickNonEmpty('synonyms') || [],
        antonyms: pickNonEmpty('antonyms') || [],
        collocations: pickNonEmpty('collocations') || [],
        audio: pickNonEmpty('audio') || '',
        
        tags: mergedTags,

        isStarred: typeof flagsWinner.isStarred === 'boolean' ? flagsWinner.isStarred : (local.isStarred || remote.isStarred || false),
        isSuspended: typeof flagsWinner.isSuspended === 'boolean' ? flagsWinner.isSuspended : (local.isSuspended || remote.isSuspended || false),
        isDeleted: false,

        srsStatus: srsWinner.srsStatus || 'New',
        srsDueDate: srsWinner.srsDueDate ? toMillis(srsWinner.srsDueDate) : null,
        srsInterval: srsWinner.srsInterval !== undefined ? srsWinner.srsInterval : 0,
        stability: srsWinner.stability !== undefined ? srsWinner.stability : 0,
        stabilityShort: srsWinner.stabilityShort !== undefined ? srsWinner.stabilityShort : (srsWinner.stability || 0),
        difficulty: srsWinner.difficulty !== undefined ? srsWinner.difficulty : 0,
        reps: Number(srsWinner.reps) || 0,
        lapses: Number(srsWinner.lapses) || 0,
        lastReviewDate: srsWinner.lastReviewDate ? toMillis(srsWinner.lastReviewDate) : null,
        consecutiveCorrect: srsWinner.consecutiveCorrect !== undefined ? srsWinner.consecutiveCorrect : 0,

        updatedAt: maxUpdatedTime,
        _lastModifiedBy: getDeviceId()
    };
}

function isSrsEqual(a, b) {
    if (!a || !b) return a === b;
    if (a === b) return true;

    if (
        a.stability !== b.stability ||
        a.stabilityShort !== b.stabilityShort ||
        a.difficulty !== b.difficulty ||
        a.srsInterval !== b.srsInterval ||
        a.srsDueDate !== b.srsDueDate ||
        a.srsStatus !== b.srsStatus ||
        a.reps !== b.reps ||
        a.lapses !== b.lapses ||
        a.lastReviewDate !== b.lastReviewDate ||
        a.consecutiveCorrect !== b.consecutiveCorrect ||
        a.isDeleted !== b.isDeleted ||
        a.isStarred !== b.isStarred ||
        a.isSuspended !== b.isSuspended ||
        a.english !== b.english ||
        a.vietnamese !== b.vietnamese ||
        a.phonetic !== b.phonetic ||
        a.type !== b.type ||
        a.example !== b.example ||
        (a.exampleMeaning || a.exampleVi || '') !== (b.exampleMeaning || b.exampleVi || '') ||
        (a.notes || '') !== (b.notes || '')
    ) {
        return false;
    }

    const aTags = Array.isArray(a.tags) ? a.tags : [];
    const bTags = Array.isArray(b.tags) ? b.tags : [];
    if (aTags.length !== bTags.length) return false;
    for (let i = 0; i < aTags.length; i++) {
        if (aTags[i] !== bTags[i]) return false;
    }

    return true;
}

// 2. Emulate mergeReviewLogs and compressLogs
function compressLogs(expandedLogs) {
    const dict = [];
    const dictMap = new Map();
    const logs = [];

    const getWordId = (word) => {
        let id = dictMap.get(word);
        if (id === undefined) {
            id = dict.length;
            dict.push(word);
            dictMap.set(word, id);
        }
        return id;
    };

    for (let i = 0; i < expandedLogs.length; i++) {
        const item = expandedLogs[i];
        if (Array.isArray(item)) {
            logs.push(item);
        } else if (item && typeof item === 'object') {
            const cardId = getWordId(item.cardId);
            const r = item.rating;
            const t = parseFloat(item.t);
            const ts = item.timestamp ? Math.round(item.timestamp / 1000) : 0;
            logs.push([cardId, r, t, ts]);
        }
    }
    return { dict, logs };
}

function mergeReviewLogs(remoteLogs, localLogs) {
    const uncompress = (data) => {
        if (!data || !data.logs || !data.dict) return [];
        const dict = data.dict;
        return data.logs.map(log => {
            if (Array.isArray(log)) {
                return {
                    cardId: dict[log[0]],
                    rating: log[1],
                    t: log[2],
                    ts: log[3] || 0
                };
            }
            return log;
        });
    };

    const combined = [...uncompress(remoteLogs), ...uncompress(localLogs)].sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const uniqueLogs = [];
    const lastSeenByCard = new Map();

    for (const log of combined) {
        if (!log || !log.cardId) continue;
        const lastLog = lastSeenByCard.get(log.cardId);

        const isDuplicate = lastLog && (
            (lastLog.ts === log.ts) ||
            (
                lastLog.rating === log.rating &&
                Math.abs((lastLog.t || 0) - (log.t || 0)) < 0.0001 &&
                Math.abs((log.ts || 0) - (lastLog.ts || 0)) <= 3000
            )
        );

        if (isDuplicate) {
            continue;
        }

        lastSeenByCard.set(log.cardId, log);
        uniqueLogs.push(log);
    }

    return compressLogs(uniqueLogs);
}

// ==========================================
// TEST CASES
// ==========================================

// TEST 1: Disentangled Merging (SRS Review on Mobile vs Content Edit on PC)
console.log("Running TEST 1: Disentangled Merging (SRS vs Content)...");
const localPC = {
    id: "card_101",
    english: "Ephemeral",
    vietnamese: "Phù du, chóng tàn (Đã cập nhật nghĩa chi tiết)",
    example: "Fame in the modern world is ephemeral.",
    notes: "Rất hay gặp trong IELTS Reading",
    tags: ["ielts", "c2"],
    updatedAt: 1700000005000, // T_content = 5s
    // SRS cũ trước khi học trên mobile:
    srsStatus: "Learning",
    stability: 2.1,
    difficulty: 5.0,
    reps: 1,
    lapses: 0,
    lastReviewDate: 1700000001000
};

const remoteMobile = {
    id: "card_101",
    english: "Ephemeral",
    vietnamese: "Phù du", // Nghĩa cũ
    example: "",
    notes: "",
    tags: ["ielts"],
    updatedAt: 1700000004000, // T_review = 4s
    // Đã review xuất sắc trên mobile:
    srsStatus: "Review",
    stability: 8.5,
    difficulty: 4.2,
    reps: 2,
    lapses: 0,
    lastReviewDate: 1700000004000
};

const merged1 = mergeCardFields(localPC, remoteMobile);
assert.strictEqual(merged1.vietnamese, "Phù du, chóng tàn (Đã cập nhật nghĩa chi tiết)", "Content from PC must win because updatedAt is newer");
assert.strictEqual(merged1.notes, "Rất hay gặp trong IELTS Reading", "Notes from PC must be preserved");
assert.strictEqual(merged1.stability, 8.5, "SRS stability from mobile review must win because lastReviewDate is newer");
assert.strictEqual(merged1.reps, 2, "SRS reps from mobile review must win");
assert.strictEqual(merged1.srsStatus, "Review", "SRS status from mobile must be preserved");
assert(merged1.tags.includes("ielts") && merged1.tags.includes("c2"), "Tags must be a union of both devices");
assert.strictEqual(merged1._lastModifiedBy, mockDeviceId, "Must be tagged with current device ID");
console.log("✅ TEST 1 PASSED: Perfect disentangled merge!\n");

// TEST 2: Multi-device SRS Review Race
console.log("Running TEST 2: Concurrent SRS Reviews...");
const deviceA = {
    id: "card_202",
    english: "Ubiquitous",
    vietnamese: "Phổ biến",
    updatedAt: 1700000010000,
    srsStatus: "Review",
    stability: 15.0,
    difficulty: 3.5,
    reps: 5,
    lastReviewDate: 1700000010000
};

const deviceB = {
    id: "card_202",
    english: "Ubiquitous",
    vietnamese: "Phổ biến",
    updatedAt: 1700000020000,
    srsStatus: "Review",
    stability: 22.0,
    difficulty: 3.2,
    reps: 6,
    lastReviewDate: 1700000020000 // Newer review
};

const mergedSRS = mergeCardFields(deviceA, deviceB);
assert.strictEqual(mergedSRS.stability, 22.0, "Newer review stability must win");
assert.strictEqual(mergedSRS.reps, 6, "Newer review reps must win");
assert.strictEqual(mergedSRS.difficulty, 3.2, "Difficulty must stay atomic with winning review");
console.log("✅ TEST 2 PASSED: SRS Memory Vector preserved atomically!\n");

// TEST 3: Tombstone (Delete) vs Resurrect
console.log("Running TEST 3: Tombstone vs Resurrect...");
const deletedCard = {
    id: "card_303",
    english: "Obsolete",
    vietnamese: "Lỗi thời",
    isDeleted: true,
    updatedAt: 1700000030000
};

const editedLaterCard = {
    id: "card_303",
    english: "Obsolete",
    vietnamese: "Lỗi thời, không còn dùng (Đã sửa lại sau)",
    isDeleted: false,
    updatedAt: 1700000040000 // Sửa sau khi bị xóa
};

const resurrected = mergeCardFields(deletedCard, editedLaterCard);
assert.strictEqual(resurrected.isDeleted, false, "Card edited after deletion must be resurrected");
assert.strictEqual(resurrected.vietnamese, "Lỗi thời, không còn dùng (Đã sửa lại sau)");

const olderUnedited = {
    id: "card_303",
    english: "Obsolete",
    vietnamese: "Lỗi thời",
    isDeleted: false,
    updatedAt: 1700000010000 // Chưa sửa, cũ hơn thời điểm xóa
};

const remainsDeleted = mergeCardFields(olderUnedited, deletedCard);
assert.strictEqual(remainsDeleted.isDeleted, true, "Older card must respect newer deletion");
console.log("✅ TEST 3 PASSED: Tombstones and resurrection handled accurately!\n");

// TEST 4: Tags Union (No duplicates, no 'all')
console.log("Running TEST 4: Tags Union...");
const cardWithTags1 = { id: "c1", tags: ["all", "ielts", "business"], updatedAt: 100 };
const cardWithTags2 = { id: "c1", tags: ["academic", "business", " "], updatedAt: 200 };
const mergedTagsCard = mergeCardFields(cardWithTags1, cardWithTags2);
assert.deepStrictEqual(mergedTagsCard.tags.sort(), ["academic", "business", "ielts"].sort(), "Tags union should remove 'all', whitespace, and duplicates");
console.log("✅ TEST 4 PASSED: Tags union pristine!\n");

// TEST 5: Review Log Deduplication & Interval Precision
console.log("Running TEST 5: Review Log Deduplication...");
const remoteLogs = {
    dict: ["apple", "banana"],
    logs: [
        [0, 3, 1.5, 1700000], // apple, rating 3, t=1.5s, ts=1700000
        [1, 4, 3.2, 1700005]  // banana, rating 4, t=3.2s, ts=1700005
    ]
};

const localLogs = {
    dict: ["apple", "cherry"],
    logs: [
        [0, 3, 1.5, 1700001], // apple duplicate from sync within 1 second!
        [1, 2, 0.8, 1700010]  // cherry new review
    ]
};

const mergedLogs = mergeReviewLogs(remoteLogs, localLogs);
assert.strictEqual(mergedLogs.logs.length, 3, "Apple review within 3s window must be deduplicated, total logs should be 3");
assert(mergedLogs.dict.includes("apple") && mergedLogs.dict.includes("banana") && mergedLogs.dict.includes("cherry"));
console.log("✅ TEST 5 PASSED: Review logs deduplication accurate and lossless!\n");

// TEST 6: O(N) CompressLogs Benchmark
console.log("Running TEST 6: CompressLogs O(N) Benchmark (5,000 logs)...");
const hugeLogs = [];
for (let i = 0; i < 5000; i++) {
    hugeLogs.push({
        cardId: `word_${i % 200}`,
        rating: (i % 4) + 1,
        t: (i * 0.1) % 10,
        timestamp: Date.now() + i * 1000
    });
}

const startTime = Date.now();
const compressed = compressLogs(hugeLogs);
const durationMs = Date.now() - startTime;
console.log(`⏱️ Compress 5,000 logs took ${durationMs}ms`);
assert(durationMs < 200, `Compress 5,000 logs should take <200ms (was ${durationMs}ms)`);
assert.strictEqual(compressed.dict.length, 200);
assert.strictEqual(compressed.logs.length, 5000);
console.log("✅ TEST 6 PASSED: CompressLogs is blazingly fast O(N)!\n");

console.log("🎉 ALL ADVERSARIAL VERIFICATION TESTS PASSED SUCCESSFULLY!");
