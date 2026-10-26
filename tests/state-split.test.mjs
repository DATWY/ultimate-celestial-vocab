// tests/state-split.test.mjs — T4.5b: khoá "hợp đồng" của việc tách src/core/state.js.
//
// T4.5b tách state.js (1.621 dòng, 91 export) thành store + barrel + các module
// nhỏ trong src/core/state/. Rủi ro của kiểu tách này KHÔNG phải cú pháp mà là
// ba thứ âm thầm: (1) rơi mất một export khi dọn barrel, (2) tạo vòng import
// tĩnh giữa các module (chạy được trên máy này, chết trên máy khác), (3) biến
// live binding thành bản sao (setTtsRate xong getState() vẫn thấy giá trị cũ).
// Test này canh đúng ba thứ đó, cộng vài hành vi tiêu biểu của các cụm đã tách.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE_FILE = path.join(ROOT, 'src', 'core', 'state.js');
const STATE_DIR = path.join(ROOT, 'src', 'core', 'state');

/** Toàn bộ tên mà `import { … } from '../core/state.js'` được phép dùng (API công khai). */
const PUBLIC_API = [
    'MAX_REVIEW_LOG_BYTES', 'MAX_REVIEW_LOG_DELETED_IDS', 'MAX_REVIEW_LOG_ENTRIES',
    'MIN_STREAK_DAILY_REVIEWS', 'STREAK_LEGACY_CUTOFF_DATE',
    'TTS_RATE_DEFAULT', 'TTS_RATE_MAX', 'TTS_RATE_MIN', 'TTS_SETTINGS_KEY',
    'acceptProgress', 'addReviewLog', 'addXP', 'buyStreakFreeze',
    'calculateStreakFromHeatmap', 'checkAndApplyStreakFreeze', 'checkAndUpdateStreak',
    'checkStreakStatusOnLoad', 'clearLastReviewSnapshot', 'clearReviewLogs',
    'completeStreakRecovery', 'compressLogs', 'ensureDailyStats', 'exportReviewLogsAsJson',
    'getComboMultiplier', 'getLastReviewSnapshot', 'getLocalDateString', 'getOffsetDateString',
    'getState', 'getStreakRecoveryStatus', 'getTtsSettings', 'getTypingFilterStats',
    'getVocabById', 'getVocabIndexById',
    'incrementDueCardsDone', 'incrementLearningCardsDone', 'incrementNewCardsDone',
    'isCardLeech', 'isDayStreakQualified', 'isInitialSyncDone', 'isPreviewMode',
    'loadTtsSettings', 'loadVocabulary', 'logActivity', 'measureReviewLogBytes',
    'mergeReviewLogs', 'normalizeTtsRate', 'normalizeTtsSource', 'normalizeTtsVoice', 'popLastReviewLog',
    'prepareProgress', 'prepareReviewLogsForCloud', 'pruneReviewLogs', 'pushCardToVocabulary',
    'reconcileStreakFreeze', 'recordQuizAnswer', 'recordReviewResult', 'removeReviewLog',
    'revertGamificationAfterUndo', 'saveDailyStats', 'saveGamification', 'saveOneWord',
    'saveVocabulary', 'seedIsolatedDemoVocabulary',
    'setAllTags', 'setCurrentCardIndex', 'setCurrentTopicFilter', 'setDailyStats',
    'setGamification', 'setInitialSyncDone', 'setIsBoostMode', 'setIsDarkMode', 'setIsFlipped',
    'setIsTransitioning', 'setIsTypingMode', 'setLastReviewSnapshot', 'setPreviewMode',
    'setReviewLogs', 'setReviewQueue', 'setSoundMode', 'setTtsRate', 'setTtsSource', 'setTtsVoice',
    'setTypingFilter', 'setUserFsrs7Params', 'setUserSrsParams', 'setVocabulary', 'setXP',
    'shouldCardUseTyping', 'syncStreakFromHeatmap', 'toCloudReviewLogPayload',
    'toggleStarOnCurrentCard', 'trackEvent', 'ttsSource', 'unlockBadge', 'updateCardInVocabulary',
    'utf8ByteLength',
];

/**
 * Export "nội bộ" của các module con — CHƯA TỪNG có trong API công khai trước
 * T4.5b (chúng là biến/hàm phụ mà state.js dùng, không phải thứ call site import).
 * Danh sách này phải khớp CHÍNH XÁC: thêm tên mới ⇒ test đỏ để người viết tự hỏi
 * "mình vừa làm rò một tên nội bộ ra ngoài à?".
 */
const INTERNAL_EXPORTS = [
    'dailyStats', 'gamification', 'isHardCard', 'isLearningCard', 'isLongWord',
    'matchesTypingFilter', 'rebuildVocabIndex', 'resetVocabulary', 'safeShowPopup',
    'safeShowToast', 'safeUpdateStats', 'skipPersistence', 'ttsRate', 'ttsVoice', 'vocabulary',
];

const submoduleFiles = fs.readdirSync(STATE_DIR).filter(f => f.endsWith('.js')).sort();
const readSource = file => fs.readFileSync(file, 'utf8');
const lineCount = file => readSource(file).split('\n').length;

/** Chỉ lấy import TĨNH ở đầu dòng (bỏ qua `import(...)` động — những cạnh đó là lazy, không tạo vòng). */
function staticImports(file) {
    const src = readSource(file);
    const out = [];
    const re = /^import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
    let m;
    while ((m = re.exec(src))) out.push(m[1]);
    return out;
}

/** Đổi specifier tương đối thành đường dẫn tuyệt đối, CHỈ giữ các file trong cụm state. */
function resolveInCluster(fromFile, spec) {
    if (!spec.startsWith('.')) return null;
    const target = path.resolve(path.dirname(fromFile), spec);
    if (target === STATE_FILE) return STATE_FILE;
    if (path.dirname(target) === STATE_DIR && target.endsWith('.js')) return target;
    return null;
}

test('T4.5b — barrel state.js giữ đúng bộ API công khai (không rơi, không đổi tên)', async () => {
    const stateModule = await import('../src/core/state.js');
    assert.deepEqual(Object.keys(stateModule).sort(), [...PUBLIC_API].sort());
    // 93 → 96 (UI-FIX): thêm ttsSource / normalizeTtsSource / setTtsSource để
    // modal giọng đọc chọn được nguồn Cloud vs giọng máy (live binding + lưu).
    assert.equal(Object.keys(stateModule).length, 96);
});

test('T4.5b — mọi module con đều được barrel re-export, không trùng tên giữa 2 module', async () => {
    const stateModule = await import('../src/core/state.js');
    const owners = new Map();
    const internal = [];

    for (const file of submoduleFiles) {
        const mod = await import(new URL(`../src/core/state/${file}`, import.meta.url).href);
        for (const name of Object.keys(mod)) {
            assert.ok(!owners.has(name), `"${name}" bị export ở cả ${owners.get(name)} và ${file}`);
            owners.set(name, file);
            if (!Object.prototype.hasOwnProperty.call(stateModule, name)) internal.push(name);
        }
    }
    assert.deepEqual(internal.sort(), [...INTERNAL_EXPORTS].sort(),
        'tập export nội bộ của cụm state đã đổi — kiểm lại xem có tên công khai bị rơi');
    assert.equal(submoduleFiles.length, 10, 'số module con đã đổi — cập nhật test nếu đây là chủ ý');
    assert.ok(owners.size > 60, 'chỉ gom được ' + owners.size + ' export từ module con');
});

test('T4.5b — không có vòng import TĨNH trong cụm state (chỉ có cạnh lazy import())', () => {
    const files = [STATE_FILE, ...submoduleFiles.map(f => path.join(STATE_DIR, f))];
    const graph = new Map(files.map(f => [f, staticImports(f).map(s => resolveInCluster(f, s)).filter(Boolean)]));

    const state = new Map(); // 0 = chưa thăm, 1 = đang thăm, 2 = xong
    const cycles = [];
    const walk = (node, stack) => {
        state.set(node, 1);
        for (const next of graph.get(node) || []) {
            if (state.get(next) === 1) cycles.push([...stack, node, next].map(f => path.relative(ROOT, f)).join(' → '));
            else if (!state.get(next)) walk(next, [...stack, node]);
        }
        state.set(node, 2);
    };
    for (const file of files) if (!state.get(file)) walk(file, []);
    assert.deepEqual(cycles, [], `phát hiện vòng import tĩnh:\n${cycles.join('\n')}`);
});

test('T4.5b — live binding sống thật: setter ở module con thì getState()/barrel thấy ngay', async () => {
    const state = await import('../src/core/state.js');

    await state.setTtsRate(1.0);
    const ttsSettings = state.getTtsSettings();
    assert.equal(typeof ttsSettings.voice, 'string');
    assert.equal(ttsSettings.rate, 1);
    assert.ok(['cloud', 'device'].includes(ttsSettings.source), 'getTtsSettings phải có source');
    assert.equal(state.getState().ttsRate, 1);
    assert.equal(state.getState().ttsSource, ttsSettings.source, 'getState phải thấy live binding ttsSource');

    state.setVocabulary([
        { id: 'a', english: 'alpha', srsStatus: 'New', tags: [] },
        { id: 'b', english: 'beta', srsStatus: 'New', tags: [] },
    ]);
    assert.equal(state.getState().vocabulary.length, 2);
    assert.equal(state.getVocabById('b').english, 'beta');
    assert.equal(state.getVocabIndexById('b'), 1);

    state.setIsDarkMode(true);
    assert.equal(state.getState().isDarkMode, true);
});

test('T4.5b — streak đọc đúng state hiện tại qua tham số mặc định (không phải bản sao)', async () => {
    const state = await import('../src/core/state.js');
    const original = state.getState().gamification;

    state.setGamification({ ...original, frozenDates: ['2099-01-01'], recoveredDates: [], activityHeatmap: {} });
    // Nhờ live binding, ngày đóng băng mới có hiệu lực mà không phải truyền tham số.
    assert.equal(state.isDayStreakQualified({}, '2099-01-01'), true);
    assert.equal(state.isDayStreakQualified({}, '2000-01-01'), false);
    // Ngày cũ (trước mốc legacy) chỉ cần > 0 lượt ôn.
    assert.equal(state.isDayStreakQualified({ '2026-01-02': 1 }, '2026-01-02'), true);
    // Từ mốc legacy trở đi mới cần đủ 10 lượt/ngày.
    assert.equal(state.isDayStreakQualified({ '2026-11-02': 9 }, '2026-11-02'), false);
    assert.equal(state.isDayStreakQualified({ '2026-11-02': 10 }, '2026-11-02'), true);

    state.setGamification(original);
});

test('T4.5b — prune/từ vựng/bộ lọc gõ phím: barrel và module là CÙNG một hàm', async () => {
    const state = await import('../src/core/state.js');
    const prune = await import('../src/core/state/review-log-prune.js');
    const vocab = await import('../src/core/state/vocabulary.js');
    const typing = await import('../src/core/state/typing-filter.js');
    const streak = await import('../src/core/state/streak.js');

    assert.equal(state.pruneReviewLogs, prune.pruneReviewLogs);
    assert.equal(state.prepareReviewLogsForCloud, prune.prepareReviewLogsForCloud);
    assert.equal(state.setVocabulary, vocab.setVocabulary);
    assert.equal(state.isCardLeech, typing.isCardLeech);
    assert.equal(state.calculateStreakFromHeatmap, streak.calculateStreakFromHeatmap);
});

test('T4.5b — hành vi các cụm đã tách không đổi (TTS, leech, bộ lọc, chuỗi ngày)', async () => {
    const state = await import('../src/core/state.js');

    // TTS: kẹp trong [0.6, 1.4], làm tròn 1 chữ số.
    assert.equal(state.normalizeTtsRate(0.1), state.TTS_RATE_MIN);
    assert.equal(state.normalizeTtsRate(9), state.TTS_RATE_MAX);
    assert.equal(state.normalizeTtsRate('1.06'), 1.1);
    assert.equal(state.normalizeTtsRate('không phải số'), state.TTS_RATE_DEFAULT);
    assert.equal(state.normalizeTtsRate(null), state.TTS_RATE_DEFAULT);

    // Leech / khó / learning / từ dài — ngưỡng giữ nguyên như trước khi tách.
    assert.equal(state.isCardLeech({ lapses: 2 }), true);
    assert.equal(state.isCardLeech({ lapses: 1 }), false);
    assert.equal(state.isCardLeech({ difficulty: 7.5 }), true);
    assert.equal(state.isCardLeech(null), false);

    // Chuỗi ngày: 10 lượt/ngày là mốc, ngày đóng băng luôn tính là đủ.
    const heatmap = { '2026-03-01': 10, '2026-03-02': 10, '2026-03-03': 10 };
    assert.deepEqual(
        state.calculateStreakFromHeatmap(heatmap, '2026-03-03', [], []),
        { currentStreak: 3, longestStreak: 3 }
    );
    // 2 ngày đóng băng (04 + 05/03) nối tiếp 3 ngày đã học ⇒ chuỗi 5, không đứt.
    assert.deepEqual(
        state.calculateStreakFromHeatmap(heatmap, '2026-03-05', ['2026-03-04', '2026-03-05'], []),
        { currentStreak: 5, longestStreak: 5 }
    );
});

test('T4.5b — chặn "phình lại": không file nào trong cụm được vượt 700 dòng', () => {
    const files = [STATE_FILE, ...submoduleFiles.map(f => path.join(STATE_DIR, f))];
    for (const file of files) {
        const lines = lineCount(file);
        assert.ok(lines <= 700, `${path.relative(ROOT, file)} phình lên ${lines} dòng (> 700)`);
    }
});
