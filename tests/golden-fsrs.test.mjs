// tests/golden-fsrs.test.mjs — T1.7: GOLDEN TEST cho engine FSRS-7
//
// Mục đích: khoá TOÀN BỘ hành vi số học của calculateNextSrsState() bằng một
// ma trận kịch bản cố định + snapshot ghi trực tiếp trong file. Lần sau ai sửa
// công thức (learning steps, trần interval, heuristics, dual-stability, leech…)
// sẽ thấy NGAY ca nào đổi và đổi bao nhiêu, thay vì chỉ đỏ ở một test lẻ.
//
// Đọc file theo thứ tự:
//   1. Factory thẻ  → dựng trạng thái bộ nhớ đầu vào
//   2. GOLDEN       → 50 ca: input + snapshot output
//   3. So khớp      → sai lệch in ra cả 3 số: nhận / snapshot / delta
//   4. Fuzz         → khử ngẫu nhiên bằng cách BƠM Math.random
//   5. Bất biến     → 200 tổ hợp ngẫu nhiên seed cố định, kiểm biên
//
// TẤT ĐỊNH 100%: mọi ca dùng `now` cố định NOW = 1_700_000_000_000 và chạy ở chế
// độ isSimulation = true (engine bỏ qua fuzz ±5%); riêng nhóm fuzz thì bơm
// Math.random = 0 / 0.5 / 1 để offset fuzz là hằng số đã biết.
//
// CÁCH CẬP NHẬT SNAPSHOT (khi cố ý đổi công thức): chạy `npm test`, mỗi ca lệch
// in ra danh sách trường lệch + câu "exp mới …: [ … ]" — copy nguyên dòng đó vào
// đúng ca trong GOLDEN. Đừng sửa tay từng số lẻ.

import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateNextSrsState } from '../src/core/srs/index.js';
import { S_MIN, S_MAX, D_MIN, D_MAX, MAX_INTERVAL_DAYS, MAX_GRADUATION_INTERVAL_DAYS } from '../src/core/srs/constants.js';

const NOW = 1_700_000_000_000; // cố định: 2023-11-14T22:13:20Z
const MIN = 60_000;
const DAY = 86_400_000;

// ─────────────────────────────────────────────────────────────────────────────
// 1. FACTORY THẺ — mọi ca đều suy ra từ 4 factory này để ma trận đọc được
// ─────────────────────────────────────────────────────────────────────────────

/** Thẻ New: chưa chấm lần nào (reps 0, lapses 0), chưa có trạng thái bộ nhớ. */
const newCard = (english = 'serendipity', extra = {}) => ({
    id: 'golden', english, vietnamese: '', type: '', srsStatus: 'New',
    reps: 0, lapses: 0, stability: 0, difficulty: 0, ...extra
});

/** Thẻ New kiểu cũ: thiếu hẳn difficulty/stability (đường migrate SM-2). */
const legacyNew = () => ({
    id: 'golden', english: 'serendipity', srsStatus: 'New', reps: 0, lapses: 0
});

/**
 * Thẻ đã Mastered. `elapsedDays` = số ngày kể từ lần ôn trước (NOW - elapsed).
 * Mặc định: S_long 10, S_short 8, D 5, reps 5, lapses 0, ôn đúng hạn 10 ngày trước.
 */
const review = ({
    english = 'serendipity', type = '', lapses = 0, reps = 5,
    stability = 10, stabilityShort = 8, difficulty = 5,
    srsInterval = 10, elapsedDays = 10, learningStep, anchor = 0, extra = {}
} = {}) => {
    const card = {
        id: 'golden', english, type, vietnamese: '',
        srsStatus: 'Mastered', reps, lapses, stability, stabilityShort, difficulty,
        srsInterval, anchor, lastReviewDate: NOW - elapsedDays * DAY, srsDueDate: NOW,
        ...extra
    };
    if (learningStep !== undefined) card.learningStep = learningStep;
    return card;
};

/** Thẻ đang Learning. step = 'NONE' để mô phỏng thẻ cũ thiếu trường learningStep. */
const learning = ({
    step = 0, lapses = 0, reps = 3, stability = 2, stabilityShort = 1.6,
    difficulty = 6, elapsedDays = 0.01, english = 'serendipity', extra = {}
} = {}) => {
    const card = review({ english, lapses, reps, stability, stabilityShort, difficulty, srsInterval: 0.5, elapsedDays, extra });
    card.srsStatus = 'Learning';
    if (step !== 'NONE') card.learningStep = step;
    return card;
};

/** Thẻ SM-2 cũ: chỉ có srsEaseFactor, không có stability/difficulty FSRS-7. */
const legacySm2Card = () => ({
    id: 'golden', english: 'serendipity', srsStatus: 'Mastered', reps: 5, lapses: 0,
    srsEaseFactor: 2.5, srsInterval: 10,
    lastReviewDate: NOW - 10 * DAY, srsDueDate: NOW
});

/** Như trên nhưng THIẾU reps → engine phải suy ra reps từ srsInterval. */
const legacySm2NoReps = () => ({
    id: 'golden', english: 'serendipity', srsStatus: 'Mastered', lapses: 0,
    srsEaseFactor: 2.5, srsInterval: 10,
    lastReviewDate: NOW - 10 * DAY, srsDueDate: NOW
});

const G = (id, card, rating, modality, exp, anchor = 0) => ({ id, card, rating, modality, anchor, exp });

// ─────────────────────────────────────────────────────────────────────────────
// 2. GOLDEN MATRIX — 50 ca
//
// exp = [ stability, stabilityShort, difficulty, srsInterval(ngày),
//         srsDueDate - NOW (ms), srsStatus, learningStep ('-' nếu không set),
//         isLeech, reps, lapses, srsUpdatedAt - NOW (ms) ]
//
// Phủ: New / Learning bước 0-1-2 / Mastered; rating 1-4; reps 0/1/5/20;
//      lapses 0/1/3/4 (ngưỡng leech); S nhỏ 0.5 → lớn 20000; modality
//      en-vi / typing / quiz; anchor 0/1; thẻ legacy SM-2; thẻ quá hạn 400 ngày.
// ─────────────────────────────────────────────────────────────────────────────
const GOLDEN = [
    // ── A. Thẻ New — lần chấm đầu tiên (reps 0, lapses 0) ──────────────────
    G('A1 New "serendipity" + Quên(1)', newCard(), 1, 'en-vi', [0.099360, 0.079488, 6.335267, 0.00069444, 60000, 'Learning', 0, false, 1, 0, 0]),
    G('A2 New "serendipity" + Khó(2) — lặp bước 0, 1 phút', newCard(), 2, 'en-vi', [2.015550, 1.612440, 5.427945, 0.00069444, 60000, 'Learning', 0, false, 1, 0, 0]),
    G('A3 New "serendipity" + Nhớ(3)', newCard(), 3, 'en-vi', [3.529890, 2.823912, 3.697391, 0.00694444, 600000, 'Learning', 1, false, 1, 0, 0]),
    G('A4 New "serendipity" + Dễ(4) — tốt nghiệp, trần 7 ngày', newCard(), 4, 'en-vi', [10.605690, 8.484552, 1.166667, 7.00000000, 604800000, 'Mastered', 2, false, 1, 0, 0]),
    G('A5 New "cat" (heuristics rất dễ: bias -0.5) + Nhớ(3)', newCard('cat'), 3, 'en-vi', [4.412362, 3.529890, 3.322391, 0.00694444, 600000, 'Learning', 1, false, 1, 0, 0]),
    G('A6 New "break the ice" idiom (heuristics rất khó: bias +0.4167) + Nhớ(3)', newCard('break the ice', { type: 'idiom' }), 3, 'en-vi', [3.431837, 2.745470, 3.739057, 0.00694444, 600000, 'Learning', 1, false, 1, 0, 0]),
    G('A7 New + Dễ(4) modality typing — thưởng typing KHÔNG áp cho lần đầu', newCard(), 4, 'typing', [10.605690, 8.484552, 1.166667, 7.00000000, 604800000, 'Mastered', 2, false, 1, 0, 0]),
    G('A8 New "cat" + Quên(1) — lapses 0, reps 1', newCard('cat'), 1, 'en-vi', [0.124200, 0.099360, 5.960267, 0.00069444, 60000, 'Learning', 0, false, 1, 0, 0]),
    G('A9 New thiếu hẳn difficulty/stability (thẻ legacy) + Nhớ(3)', legacyNew(), 3, 'en-vi', [3.529890, 2.823912, 3.697391, 0.00694444, 600000, 'Learning', 1, false, 1, 0, 0]),

    // ── B. Thẻ Learning — thang bước 1 phút → 10 phút → 1 ngày ─────────────
    G('B1 Learning bước 0 + Quên(1) — về bước 0, 1 phút', learning({ step: 0 }), 1, 'en-vi', [0.689433, 0.097918, 9.311130, 0.00069444, 60000, 'Learning', 0, false, 2, 1, 0]),
    G('B2 Learning bước 0 + Khó(2) — lặp bước 0, 1 phút', learning({ step: 0 }), 2, 'en-vi', [2.929618, 16.700705, 7.569508, 0.00069444, 60000, 'Learning', 0, false, 4, 0, 0]),
    G('B3 Learning bước 0 + Nhớ(3) — lên bước 1, 10 phút', learning({ step: 0 }), 3, 'en-vi', [3.452982, 26.106175, 5.950000, 0.00694444, 600000, 'Learning', 1, false, 4, 0, 0]),
    G('B4 Learning bước 0 + Dễ(4) — tốt nghiệp, trần 7 ngày', learning({ step: 0 }), 4, 'en-vi', [3.452982, 28.235761, 3.925615, 4.07994077, 352506883, 'Mastered', 2, false, 4, 0, 0]),
    G('B5 Learning bước 1 + Quên(1) — về bước 0', learning({ step: 1 }), 1, 'en-vi', [0.689433, 0.097918, 9.311130, 0.00069444, 60000, 'Learning', 0, false, 2, 1, 0]),
    G('B6 Learning bước 1 + Khó(2) — giữ bước 1, 10 phút', learning({ step: 1 }), 2, 'en-vi', [2.929618, 16.700705, 7.569508, 0.00694444, 600000, 'Learning', 1, false, 4, 0, 0]),
    G('B7 Learning bước 1 + Nhớ(3) — sang bước cuối, hẹn 1 ngày', learning({ step: 1 }), 3, 'en-vi', [3.452982, 26.106175, 5.950000, 1.00000000, 86400000, 'Learning', 2, false, 4, 0, 0]),
    G('B8 Learning bước 1 + Dễ(4) — tốt nghiệp ngay', learning({ step: 1 }), 4, 'en-vi', [3.452982, 28.235761, 3.925615, 4.07994077, 352506883, 'Mastered', 2, false, 4, 0, 0]),
    G('B9 Learning bước 2 + Quên(1) — rơi về bước 0', learning({ step: 2, elapsedDays: 1 }), 1, 'en-vi', [0.729439, 0.163446, 9.086844, 0.00069444, 60000, 'Learning', 0, false, 2, 1, 0]),
    G('B10 Learning bước 2 + Khó(2) — ở lại bước 2, 1 ngày', learning({ step: 2, elapsedDays: 1 }), 2, 'en-vi', [4.061330, 51.033573, 7.569508, 1.00000000, 86400000, 'Learning', 2, false, 4, 0, 0]),
    G('B11 Learning bước 2 + Nhớ(3) — tốt nghiệp', learning({ step: 2, elapsedDays: 1 }), 3, 'en-vi', [5.221836, 81.823261, 5.950000, 4.29472977, 371064652, 'Mastered', 2, false, 4, 0, 0]),
    G('B12 Learning bước 2 + Dễ(4) — tốt nghiệp', learning({ step: 2, elapsedDays: 1 }), 4, 'en-vi', [5.221836, 88.794662, 3.925615, 7.00000000, 604800000, 'Mastered', 2, false, 4, 0, 0]),
    G('B13 Learning bước 2, lapses 1 + Nhớ(3) — tái tốt nghiệp KHÔNG bị trần 7 ngày', learning({ step: 2, lapses: 1, reps: 6, stability: 300, stabilityShort: 900, difficulty: 3, elapsedDays: 1 }), 3, 'en-vi', [310.346723, 1027.825095, 2.980000, 365.00000000, 31536000000, 'Mastered', 2, false, 7, 1, 0]),
    G('B14 Learning thiếu trường learningStep (thẻ cũ) + Nhớ(3) — coi như bước 0', learning({ step: 'NONE' }), 3, 'en-vi', [3.452982, 26.106175, 5.950000, 0.00694444, 600000, 'Learning', 1, false, 4, 0, 0]),
    G('B15 Learning leech (lapses 4) + Quên(1) — bước relearning 10 phút', learning({ step: 1, lapses: 4 }), 1, 'en-vi', [0.689433, 0.097918, 9.311130, 0.00694444, 600000, 'Learning', 1, true, 2, 5, 0]),
    G('B16 Learning leech (lapses 4) + Nhớ(3)', learning({ step: 1, lapses: 4 }), 3, 'en-vi', [3.452982, 26.106175, 5.950000, 1.00000000, 86400000, 'Learning', 2, true, 4, 4, 0]),

    // ── C. Thẻ Mastered — vòng đời dài hạn, trần 365, leech, anchor, modality ──
    G('C1 Mastered S=10 + Quên(1)', review(), 1, 'en-vi', [2.430251, 0.419387, 9.047742, 0.00000000, 0, 'Learning', 0, false, 3, 1, 0]),
    G('C2 Mastered S=10 + Khó(2)', review(), 2, 'en-vi', [18.252714, 120.519472, 6.984385, 17.75564791, 1534087980, 'Mastered', '-', false, 6, 0, 0]),
    G('C3 Mastered S=10 + Nhớ(3)', review(), 3, 'en-vi', [22.898897, 190.602194, 4.960000, 42.76028370, 3694488512, 'Mastered', '-', false, 6, 0, 0]),
    G('C4 Mastered S=10 + Dễ(4)', review(), 4, 'en-vi', [22.898897, 206.470325, 3.340492, 66.72724611, 5765234064, 'Mastered', '-', false, 6, 0, 0]),
    G('C5 Mastered S nhỏ 0.5 (reps 1) + Khó(2) — sàn 1 ngày', review({ stability: 0.5, stabilityShort: 0.4, reps: 1, elapsedDays: 0.5, difficulty: 7 }), 2, 'en-vi', [1.414092, 28.357527, 8.154631, 1.00000000, 86400000, 'Mastered', '-', false, 2, 0, 0]),
    G('C6 Mastered S nhỏ 0.5 (reps 1) + Nhớ(3)', review({ stability: 0.5, stabilityShort: 0.4, reps: 1, elapsedDays: 0.5, difficulty: 7 }), 3, 'en-vi', [1.928715, 45.770865, 6.940000, 1.00000000, 86400000, 'Mastered', '-', false, 2, 0, 0]),
    G('C7 Mastered S lớn 200 (reps 20) + Nhớ(3) — chạm trần 365 ngày', review({ stability: 200, stabilityShort: 150, reps: 20, elapsedDays: 180, difficulty: 3 }), 3, 'en-vi', [348.923481, 785.523428, 2.980000, 365.00000000, 31536000000, 'Mastered', '-', false, 21, 0, 0]),
    G('C8 Mastered S lớn 200 + Quên(1) — trượt nhưng interval 0', review({ stability: 200, stabilityShort: 150, reps: 20, elapsedDays: 180, difficulty: 3 }), 1, 'en-vi', [16.756675, 1.097642, 8.985422, 0.00000000, 0, 'Learning', 0, false, 10, 1, 0]),
    G('C9 Mastered S=20000 (100 năm) + Nhớ(3) — vẫn bị trần 365', review({ stability: 20000, stabilityShort: 15000, reps: 20, elapsedDays: 365, difficulty: 2 }), 3, 'en-vi', [20403.209947, 16347.889604, 1.990000, 365.00000000, 31536000000, 'Mastered', '-', false, 21, 0, 0]),
    G('C10 Mastered lapses 1 + Nhớ(3)', review({ lapses: 1 }), 3, 'en-vi', [22.898897, 190.602194, 4.960000, 42.76028370, 3694488512, 'Mastered', '-', false, 6, 1, 0]),
    G('C11 Mastered lapses 3 + Quên(1) — trượt lần 4 ⇒ thành LEECH ngay lượt này', review({ lapses: 3 }), 1, 'en-vi', [2.430251, 0.419387, 9.047742, 0.00694444, 600000, 'Learning', 1, true, 3, 4, 0]),
    G('C12 Mastered leech (lapses 4) + Quên(1) — bước relearning 10 phút', review({ lapses: 4 }), 1, 'en-vi', [2.430251, 0.419387, 9.047742, 0.00694444, 600000, 'Learning', 1, true, 3, 5, 0]),
    G('C13 Mastered leech (lapses 4) + Nhớ(3) — vẫn là leech nhưng lên lịch bình thường', review({ lapses: 4 }), 3, 'en-vi', [22.898897, 190.602194, 4.960000, 42.76028370, 3694488512, 'Mastered', '-', true, 6, 4, 0]),
    G('C14 Mastered reps 1 + Nhớ(3)', review({ reps: 1 }), 3, 'en-vi', [22.898897, 190.602194, 4.960000, 42.76028370, 3694488512, 'Mastered', '-', false, 2, 0, 0]),
    G('C15 Mastered + Nhớ(3) có mnemonic anchor = 1', review({ anchor: 1 }), 3, 'en-vi', [22.898897, 190.602194, 4.960000, 53.39745127, 4613539790, 'Mastered', '-', false, 6, 0, 0], 1),
    G('C16 Mastered + Nhớ(3) modality typing — thưởng +25% gia số S', review(), 3, 'typing', [26.123621, 236.252743, 4.960000, 50.35976488, 4351083685, 'Mastered', '-', false, 6, 0, 0]),
    G('C17 Mastered + Dễ(4) modality typing', review(), 4, 'typing', [26.123621, 256.087906, 3.340492, 78.14620550, 6751832155, 'Mastered', '-', false, 6, 0, 0]),
    G('C18 Mastered + Nhớ(3) modality quiz — không thưởng', review(), 3, 'quiz', [22.898897, 190.602194, 4.960000, 42.76028370, 3694488512, 'Mastered', '-', false, 6, 0, 0]),
    G('C19 Mastered quá hạn 400 ngày + Nhớ(3)', review({ elapsedDays: 400 }), 3, 'en-vi', [57.462966, 285.199315, 4.960000, 125.19013342, 10816427527, 'Mastered', '-', false, 6, 0, 0]),
    G('C20 Mastered chấm lại ngay (elapsed 0) + Nhớ(3)', review({ elapsedDays: 0 }), 3, 'en-vi', [10.001340, 8.000000, 4.960000, 12.92218702, 1116476959, 'Mastered', '-', false, 6, 0, 0]),
    G('C21 Mastered reps 20 + Nhớ(3)', review({ reps: 20 }), 3, 'en-vi', [22.898897, 190.602194, 4.960000, 42.76028370, 3694488512, 'Mastered', '-', false, 21, 0, 0]),
    G('C22 Mastered S=10, lapses 1, reps 5 + Khó(2)', review({ lapses: 1 }), 2, 'en-vi', [18.252714, 120.519472, 6.984385, 17.75564791, 1534087980, 'Mastered', '-', false, 6, 1, 0]),
    G('C23 Legacy SM-2 (chỉ có srsEaseFactor) + Nhớ(3)', legacySm2Card(), 3, 'en-vi', [22.460176, 160.168495, 5.950000, 31.46024838, 2718165460, 'Mastered', '-', false, 6, 0, 0]),
    G('C24 Legacy thiếu reps (suy ra từ srsInterval) + Nhớ(3)', legacySm2NoReps(), 3, 'en-vi', [22.460176, 160.168495, 5.950000, 31.46024838, 2718165460, 'Mastered', '-', false, 4, 0, 0]),
    G('C25 Mastered đã có srsUpdatedAt tương lai + Nhớ(3) — đồng hồ merge chỉ được tiến', review({ extra: { srsUpdatedAt: NOW + 100 } }), 3, 'en-vi', [22.898897, 190.602194, 4.960000, 42.76028370, 3694488512, 'Mastered', '-', false, 6, 0, 101]),
];

// ─────────────────────────────────────────────────────────────────────────────
// 3. SO KHỚP SNAPSHOT
// ─────────────────────────────────────────────────────────────────────────────

/** Chạy engine ở chế độ mô phỏng (không fuzz, không log). */
function runGolden(c) {
    return calculateNextSrsState(c.card, c.rating, c.modality, c.anchor, null, true, { now: NOW }).newState;
}

// [tên trường, vị trí trong exp, sai số tuyệt đối cho phép]
// 1e-6 đủ chặt để bắt mọi thay đổi công thức thật (đổi 1% của 7 ngày = 0.07),
// nhưng đủ rộng để không đỏ vì khác biệt 1 ulp giữa các nền tảng math.
const NUMERIC_FIELDS = [
    ['stability', 0, 1e-6],
    ['stabilityShort', 1, 1e-6],
    ['difficulty', 2, 1e-6],
    ['srsInterval', 3, 1e-6],
    ['srsDueDate-NOW', 4, 0],
    ['reps', 8, 0],
    ['lapses', 9, 0],
    ['srsUpdatedAt-NOW', 10, 0],
];

// Định dạng lại thành 1 dòng exp y hệt chuẩn của file ⇒ lỗi in ra là copy/paste được.
const f6 = (x) => Number(x).toFixed(6);
const f8 = (x) => Number(x).toFixed(8);
const formatExp = (s) => [
    f6(s.stability), f6(s.stabilityShort), f6(s.difficulty), f8(s.srsInterval),
    String(s.srsDueDate - NOW), `'${s.srsStatus}'`,
    s.learningStep === undefined ? "'-'" : String(s.learningStep),
    String(s.isLeech === true), String(s.reps), String(s.lapses),
    String(s.srsUpdatedAt - NOW),
].join(', ');

test('T1.7: golden snapshot — 50 kịch bản FSRS-7 khớp từng trường số', () => {
    const drifted = [];

    for (const c of GOLDEN) {
        const s = runGolden(c);
        const actual = [
            s.stability, s.stabilityShort, s.difficulty, s.srsInterval,
            s.srsDueDate - NOW,
            s.srsStatus,
            s.learningStep === undefined ? '-' : s.learningStep,
            s.isLeech,
            s.reps, s.lapses,
            s.srsUpdatedAt - NOW,
        ];
        const problems = [];

        for (const [name, idx, tol] of NUMERIC_FIELDS) {
            const got = actual[idx];
            const want = c.exp[idx];
            if (!Number.isFinite(got)) {
                problems.push(`${name}: giá trị không hữu hạn (${got})`);
            } else if (tol === 0 && got !== want) {
                problems.push(`${name}: nhận ${got} — snapshot ${want}`);
            } else if (tol > 0 && Math.abs(got - want) > tol) {
                problems.push(`${name}: nhận ${got} — snapshot ${want} (lệch ${(got - want).toExponential(3)})`);
            }
        }
        if (actual[5] !== c.exp[5]) problems.push(`srsStatus: nhận ${actual[5]} — snapshot ${c.exp[5]}`);
        if (actual[6] !== c.exp[6]) problems.push(`learningStep: nhận ${actual[6]} — snapshot ${c.exp[6]}`);
        if (actual[7] !== c.exp[7]) problems.push(`isLeech: nhận ${actual[7]} — snapshot ${c.exp[7]}`);

        // Ràng buộc nền: due luôn = now + interval (làm tròn ms) — không ca nào lệch.
        if (s.srsDueDate - NOW !== Math.round(s.srsInterval * DAY)) {
            problems.push(`srsDueDate ≠ now + interval (${s.srsDueDate - NOW} vs ${Math.round(s.srsInterval * DAY)})`);
        }

        if (problems.length > 0) {
            drifted.push(`• ${c.id}\n    - ${problems.join('\n    - ')}\n    exp mới nếu thay đổi là CÓ CHỦ ĐÍCH: [${formatExp(s)}]`);
        }
    }

    assert.deepEqual(drifted, [],
        `${drifted.length}/${GOLDEN.length} ca lệch snapshot. Sửa công thức mà không cố ý đổi hành vi? ` +
        `Đây là hồi quy. Nếu cố ý: copy dòng "exp mới" vào đúng ca trong GOLDEN.\n\n${drifted.join('\n\n')}`);
});

test('T1.7: ma trận không trùng id và phủ đủ 3 trạng thái × 4 rating', () => {
    const ids = GOLDEN.map(c => c.id);
    assert.equal(new Set(ids).size, ids.length, 'id kịch bản bị trùng');
    assert.ok(GOLDEN.length >= 40, `ma trận quá nhỏ: ${GOLDEN.length} ca`);

    const seen = new Set(GOLDEN.map(c => `${c.card.srsStatus}|${c.rating}`));
    for (const status of ['New', 'Learning', 'Mastered']) {
        for (const rating of [1, 2, 3, 4]) {
            assert.ok(seen.has(`${status}|${rating}`), `thiếu ca ${status} + rating ${rating}`);
        }
    }
    // Mọi ca đều có snapshot đúng độ dài (tránh copy thiếu cột).
    for (const c of GOLDEN) assert.equal(c.exp.length, 11, `[${c.id}] exp phải có 11 phần tử`);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. FUZZ ±5% — khử ngẫu nhiên bằng cách BƠM Math.random
// ─────────────────────────────────────────────────────────────────────────────
// Engine fuzz interval khi interval >= 2.5 ngày:
//   fuzzOffset = (Math.random() * 2 - 1) * interval * 0.05
// ⇒ Math.random = 0 → −5%, 0.5 → 0%, 1 → +5%. Bơm hằng số là đủ để tất định,
// không cần sửa engine và không cần seed toàn cục.
function withRandom(value, fn) {
    const original = Math.random;
    Math.random = () => value;
    try {
        return fn();
    } finally {
        Math.random = original;
    }
}

test('T1.7: fuzz ±5% tất định — bơm Math.random cho 3 mốc 0 / 0.5 / 1', () => {
    const base = review(); // S=10, ôn đúng hạn 10 ngày
    const fuzzed = (value, card = base, rating = 3) => withRandom(value, () =>
        calculateNextSrsState(card, rating, 'en-vi', 0, null, false, { now: NOW }).newState);
    const noFuzz = runGolden({ card: base, rating: 3, modality: 'en-vi', anchor: 0 });

    // Math.random = 0.5 ⇒ offset 0 ⇒ trùng khít bản không fuzz.
    assert.equal(fuzzed(0.5).srsInterval, noFuzz.srsInterval, 'random 0.5 phải cho offset 0');
    assert.ok(Math.abs(noFuzz.srsInterval - 42.76028370372528) < 1e-9, `interval gốc đổi: ${noFuzz.srsInterval}`);

    // Hai biên fuzz, ghi trực tiếp giá trị kỳ vọng.
    assert.ok(Math.abs(fuzzed(0).srsInterval - 40.622269518539014) < 1e-9, `−5%: ${fuzzed(0).srsInterval}`);
    assert.ok(Math.abs(fuzzed(1).srsInterval - 44.89829788891154) < 1e-9, `+5%: ${fuzzed(1).srsInterval}`);
    assert.equal(fuzzed(0).srsDueDate - NOW, 3509764086);
    assert.equal(fuzzed(1).srsDueDate - NOW, 3879212938);

    // Fuzz chỉ áp cho interval >= 2.5 ngày: thẻ S nhỏ không bị xê dịch.
    const tiny = review({ stability: 0.5, stabilityShort: 0.4, reps: 1, elapsedDays: 0.5, difficulty: 7 });
    assert.equal(fuzzed(0, tiny).srsInterval, 1);
    assert.equal(fuzzed(1, tiny).srsInterval, 1);

    // Fuzz không được đẩy thẻ mới vượt trần tốt nghiệp 7 ngày.
    assert.equal(fuzzed(1, newCard(), 4).srsInterval, MAX_GRADUATION_INTERVAL_DAYS);
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. BẤT BIẾN — 200 tổ hợp ngẫu nhiên, seed cố định
// ─────────────────────────────────────────────────────────────────────────────
/** PRNG mulberry32: cùng seed ⇒ cùng dãy số ⇒ test tất định. */
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

test('T1.7: bất biến 200 tổ hợp — interval ∈ [0,365], S/D trong biên, không NaN', () => {
    const rnd = mulberry32(0xC0FFEE);
    const pick = arr => arr[Math.min(arr.length - 1, Math.floor(rnd() * arr.length))];
    const logUniform = (min, max) => Math.exp(Math.log(min) + rnd() * (Math.log(max) - Math.log(min)));
    const ENGLISH = ['cat', 'serendipity', 'break the ice', 'resilience', 'ubiquitous', 'put up with'];
    const ELAPSED = [0, 0.001, 0.02, 0.5, 1, 3, 10, 100, 400];

    for (let i = 0; i < 200; i++) {
        const status = pick(['New', 'Learning', 'Mastered']);
        const card = {
            id: `prop-${i}`,
            english: pick(ENGLISH),
            srsStatus: status,
            reps: pick([0, 1, 2, 3, 5, 8, 20]),
            lapses: pick([0, 1, 2, 3, 4, 6]),
            stability: logUniform(S_MIN, S_MAX),
            stabilityShort: logUniform(S_MIN, S_MAX),
            difficulty: D_MIN + rnd() * (D_MAX - D_MIN),
            srsInterval: 1 + rnd() * 30,
            anchor: rnd(),
        };
        if (rnd() < 0.7) card.learningStep = pick([0, 1, 2]);
        if (status !== 'New' || rnd() < 0.5) card.lastReviewDate = NOW - pick(ELAPSED) * DAY;

        const rating = 1 + Math.floor(rnd() * 4);
        const modality = pick(['en-vi', 'typing', 'quiz']);
        const { newState: s } = calculateNextSrsState(card, rating, modality, card.anchor, null, true, { now: NOW });
        const tag = `prop-${i} (${status}, rating ${rating}, ${modality}, reps ${card.reps}, lapses ${card.lapses})`;

        // Interval: hữu hạn, trong [0, 365] ngày.
        assert.ok(Number.isFinite(s.srsInterval), `${tag}: srsInterval không hữu hạn (${s.srsInterval})`);
        assert.ok(s.srsInterval >= 0, `${tag}: srsInterval âm (${s.srsInterval})`);
        assert.ok(s.srsInterval <= MAX_INTERVAL_DAYS, `${tag}: srsInterval ${s.srsInterval} > ${MAX_INTERVAL_DAYS}`);

        // Độ bền & độ khó trong biên FSRS-7.
        for (const key of ['stability', 'stabilityShort']) {
            assert.ok(Number.isFinite(s[key]), `${tag}: ${key} không hữu hạn (${s[key]})`);
            assert.ok(s[key] >= S_MIN && s[key] <= S_MAX, `${tag}: ${key}=${s[key]} ngoài [${S_MIN}, ${S_MAX}]`);
        }
        assert.ok(Number.isFinite(s.difficulty), `${tag}: difficulty không hữu hạn`);
        assert.ok(s.difficulty >= D_MIN && s.difficulty <= D_MAX, `${tag}: difficulty=${s.difficulty} ngoài [${D_MIN}, ${D_MAX}]`);

        // Bước học: không set (thẻ Mastered) hoặc 0/1/2.
        if (s.learningStep !== undefined) {
            assert.ok([0, 1, 2].includes(s.learningStep), `${tag}: learningStep=${s.learningStep} ngoài {0,1,2}`);
        }
        assert.ok(['New', 'Learning', 'Mastered'].includes(s.srsStatus), `${tag}: srsStatus lạ (${s.srsStatus})`);

        // Ngày hẹn: số nguyên ms, đúng bằng now + interval.
        assert.ok(Number.isSafeInteger(s.srsDueDate), `${tag}: srsDueDate không phải số nguyên ms (${s.srsDueDate})`);
        assert.equal(s.srsDueDate, NOW + Math.round(s.srsInterval * DAY), `${tag}: srsDueDate ≠ now + interval`);

        // Bộ đếm & cờ leech nhất quán.
        assert.ok(Number.isSafeInteger(s.reps) && s.reps >= 0, `${tag}: reps lạ (${s.reps})`);
        assert.ok(Number.isSafeInteger(s.lapses) && s.lapses >= 0, `${tag}: lapses lạ (${s.lapses})`);
        assert.equal(s.isLeech, s.lapses >= 4, `${tag}: isLeech=${s.isLeech} nhưng lapses=${s.lapses}`);
        assert.ok(s.srsUpdatedAt >= NOW, `${tag}: srsUpdatedAt phải >= now`);
    }
});
