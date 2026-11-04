// tests/p11-backup-and-params.test.mjs
//
// Regression cho:
//  (4) TSV làm mất quyết định "Tạm ẩn" ở CẢ hai chiều (export và import đều hardcode false).
//      Điểm cần bảo vệ: khôi phục vào kho RỖNG (máy mới / sau sự cố) phải giữ nguyên tạm ẩn.
//  (5) Validator chỉ kiểm biên từng tham số, không kiểm ràng buộc thứ tự (w0 ≤ w1 ≤ w2 ≤ w3,
//      w26 ≥ w25) ⇒ chấp nhận cấu hình đảo nghĩa rating; solver trả interval mà không kiểm
//      sai số, và không phân biệt "mục tiêu ngoài miền" với "Newton không hội tụ".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportVocabularyTsv, parseVocabularyTsv } from '../src/core/tabular.js';
import { planVocabularyImport } from '../src/core/import-plan.js';
import { DEFAULT_FSRS7_PARAMS, FSRS7_PARAM_BOUNDS, validFsrs7Params, fsrs7OrderingError,
    parseAndValidateFsrs7Params, DESIRED_RETENTION, S_MIN, S_MAX } from '../src/core/srs/constants.js';
import { projectFsrs7Params } from '../src/core/srs/training.js';
import { nextIntervalNewton, dualTraceForgettingCurve, bisectIntervalForRetention } from '../src/core/srs/forgetting.js';

const NOW = new Date(2026, 10, 3, 15, 0).getTime();
const card = (over = {}) => ({ id: 't1', english: 'obfuscate', vietnamese: 'làm khó hiểu', type: 'verb',
    srsStatus: 'Mastered', stability: 12, difficulty: 6, reps: 8, lapses: 3, srsInterval: 10,
    srsDueDate: NOW, lastReviewDate: NOW - 86400000, updatedAt: NOW, contentUpdatedAt: NOW,
    srsUpdatedAt: NOW, flagsUpdatedAt: NOW, tags: [], ...over });

// ─────────────────────────────── (4) TSV: Tạm ẩn ───────────────────────────────
test('TSV export ghi ĐÚNG giá trị isSuspended', () => {
    const tsv = exportVocabularyTsv([card({ isSuspended: true }), card({ id: 't2', isSuspended: false })]);
    const lines = tsv.replace('\uFEFF', '').split('\r\n');
    const col = lines[0].split('\t').indexOf('isSuspended');
    assert.ok(col >= 0, 'cột isSuspended phải tồn tại');
    assert.equal(lines[1].split('\t')[col], 'true');
    assert.equal(lines[2].split('\t')[col], 'false');
});

test('TSV round-trip giữ tạm ẩn; file CŨ (không có giá trị) vẫn đọc được', () => {
    const parsed = parseVocabularyTsv(exportVocabularyTsv([card({ isSuspended: true })]));
    assert.equal(parsed.rows[0].card.isSuspended, true);

    // Định dạng cũ: ô isSuspended là 'false' hoặc rỗng (chưa từng có true).
    const header = 'English\tVietnamese\tType\tPronunciation\tExample\tisStarred\tsrsStatus\tsrsDueDate\tTags\tlapses\tisSuspended\tsrsInterval\tsrsEaseFactor\tdifficulty\tstability\treps\tlearningStep\tlastReviewDate\tstabilityShort';
    const legacy = header + '\ncat\tmèo\tnoun\t\t\tfalse\tMastered\t\t\t1\t\t10\t2.5\t5\t5\t3\t0\t\t4';
    const legacyEmpty = header + '\ncat\tmèo\tnoun\t\t\tfalse\tMastered\t\t\t1\t\t10\t2.5\t5\t5\t3\t0\t\t4';
    assert.equal(parseVocabularyTsv('\uFEFF' + legacy).rows[0].card.isSuspended, false);
    const blankCell = '\uFEFF' + legacyEmpty.replace('\t\t10', '\t\t10');
    assert.equal(parseVocabularyTsv(blankCell).rows[0].card.isSuspended, false);
});

test('TSV từ chối giá trị isSuspended không hợp lệ (không đoán bừa)', () => {
    const tsv = exportVocabularyTsv([card({ isSuspended: true })]).replace('true', 'maybe');
    const parsed = parseVocabularyTsv(tsv);
    assert.equal(parsed.rows.length, 0);
    assert.equal(parsed.errors.length, 1);
    assert.match(parsed.errors[0].message, /isSuspended/);
});

test('khôi phục vào kho RỖNG (máy mới) phải giữ nguyên tạm ẩn — đây là ca hỏng cũ', () => {
    const original = card({ id: 'orig', isSuspended: true });
    const tsv = exportVocabularyTsv([original]);
    const plan = planVocabularyImport(tsv, []);
    assert.equal(plan.newItems.length, 1);
    assert.equal(plan.newItems[0].isSuspended, true,
        'thẻ tạm ẩn không được sống lại sau khi khôi phục vào kho rỗng');
});

test('nhập lại vào kho ĐANG CÓ dữ liệu không ghi đè trạng thái học và không nhân đôi thẻ', () => {
    const existing = card({ id: 'keep', isSuspended: true, srsStatus: 'Mastered', lapses: 7, srsDueDate: NOW + 86400000 });
    const tsv = exportVocabularyTsv([existing]);
    const plan = planVocabularyImport(tsv, [existing]);
    assert.equal(plan.newItems.length, 0, 'không được tạo thẻ trùng');
    assert.equal(existing.isSuspended, true, 'chính sách import tại chỗ giữ nguyên tạm ẩn');
    assert.equal(existing.lapses, 7, 'không được ghi đè lịch sử học');
    assert.equal(existing.srsStatus, 'Mastered');
});

// ────────────────────────── (5) Ràng buộc tham số ──────────────────────────
test('validator TỪ CHỐI thứ tự S0 đảo ngược và base2 < base1', () => {
    const inverted = [...DEFAULT_FSRS7_PARAMS];
    inverted[0] = 100; inverted[3] = 0.01; // "Quên" bền hơn "Dễ" 10.000 lần
    assert.equal(validFsrs7Params(inverted), false);
    assert.match(fsrs7OrderingError(inverted), /w1 .*w0/);

    const baseInverted = [...DEFAULT_FSRS7_PARAMS];
    baseInverted[25] = 5; baseInverted[26] = 0.01;
    assert.equal(validFsrs7Params(baseInverted), false);
    assert.match(fsrs7OrderingError(baseInverted), /w26/);

    // Bộ mặc định vẫn hợp lệ (không được chặn oan).
    assert.equal(validFsrs7Params([...DEFAULT_FSRS7_PARAMS]), true);
    // Lỗi biên vẫn bị bắt như trước.
    const outOfBox = [...DEFAULT_FSRS7_PARAMS]; outOfBox[4] = 99;
    assert.equal(validFsrs7Params(outOfBox), false);
});

test('projectFsrs7Params CHIẾU về miền hợp lệ (dùng cho optimizer, không dùng cho nhập tay)', () => {
    const inverted = [...DEFAULT_FSRS7_PARAMS];
    inverted[0] = 100; inverted[1] = 2; inverted[2] = 3; inverted[3] = 0.01;
    inverted[25] = 5; inverted[26] = 0.01;
    const projected = projectFsrs7Params(inverted);
    assert.equal(fsrs7OrderingError(projected), null);
    assert.equal(validFsrs7Params(projected), true);
    assert.ok(projected[1] >= projected[0] && projected[2] >= projected[1] && projected[3] >= projected[2]);
    assert.ok(projected[26] >= projected[25]);
});

test('nhập tay bị TỪ CHỐI kèm lý do (khác với chiếu tự động)', () => {
    const inverted = [...DEFAULT_FSRS7_PARAMS];
    inverted[2] = 0.5; inverted[3] = 0.1;
    const result = parseAndValidateFsrs7Params(inverted.join(' '));
    assert.equal(result.valid, false);
    assert.match(result.error, /w3|w2|thứ tự|≥/);
    assert.equal(parseAndValidateFsrs7Params(DEFAULT_FSRS7_PARAMS.join(' ')).valid, true);
});

// ─────────────────────────────── Solver ───────────────────────────────
test('solver: bộ mặc định hội tụ — sai số retention rất nhỏ trên lưới S/D', () => {
    let worst = 0;
    for (const S of [0.1, 1, 5, 30, 365, 5000]) {
        for (const D of [1, 3, 5, 7, 10]) {
            for (const ratio of [0.5, 1, 2]) {
                const sShort = Math.max(S_MIN, S * ratio);
                const t = nextIntervalNewton(S, sShort, D, DESIRED_RETENTION, DEFAULT_FSRS7_PARAMS);
                const r = dualTraceForgettingCurve(t, S, sShort, D, DEFAULT_FSRS7_PARAMS);
                worst = Math.max(worst, Math.abs(r - DESIRED_RETENTION));
            }
        }
    }
    assert.ok(worst <= 1e-4, `sai số tối đa ${worst} vượt 1e-4`);
});

test('solver: phân biệt "mục tiêu ngoài miền" (trả biên) với "không hội tụ"', () => {
    // Mục tiêu CAO hơn cả R tại interval ngắn nhất ⇒ không thể đạt, trả biên dưới.
    // Dùng bộ weights làm đường cong rất dốc để R(1 phút) thấp hơn 0.9.
    const steep = projectFsrs7Params([...DEFAULT_FSRS7_PARAMS].map((v, i) => {
        if (i === 23) return FSRS7_PARAM_BOUNDS[23][1];   // decay1 lớn
        if (i === 33) return FSRS7_PARAM_BOUNDS[33][0];   // s_decay1 nhỏ
        return v;
    }));
    const tMin = 1 / 86400;
    const rAtMin = dualTraceForgettingCurve(tMin, 0.5, 0.5, 5, steep);
    if (rAtMin < DESIRED_RETENTION) {
        const t = nextIntervalNewton(0.5, 0.5, 5, DESIRED_RETENTION, steep);
        assert.ok(Math.abs(t - tMin) < 1e-9, `kỳ vọng trả biên dưới, nhận ${t}`);
    }

    // Mục tiêu THẤP hơn R tại trần 365 ngày ⇒ cũng ngoài miền, trả biên trên.
    const nearFlat = projectFsrs7Params([...DEFAULT_FSRS7_PARAMS].map((v, i) => {
        if (i === 24) return FSRS7_PARAM_BOUNDS[24][0];
        if (i === 25 || i === 26) return 0.99;
        return v;
    }));
    const rAtMax = dualTraceForgettingCurve(S_MAX, 36500, 36500, 1, nearFlat);
    if (rAtMax > 0.70) {
        const t = nextIntervalNewton(36500, 36500, 1, 0.70, nearFlat);
        assert.equal(t, S_MAX, 'ngoài miền phía trên phải trả trần, không phải NaN/vòng lặp');
    }
});

test('solver: với mọi bộ tham số HỢP LỆ, kết quả hữu hạn, trong miền, và hoặc đạt sai số hoặc ở biên có lý do', () => {
    let seed = 20261103;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const tMin = 1 / 86400;
    let boundaryCases = 0, converged = 0;
    for (let i = 0; i < 200; i++) {
        const raw = DEFAULT_FSRS7_PARAMS.map((v, k) => {
            const [lo, hi] = FSRS7_PARAM_BOUNDS[k];
            return lo + rnd() * (hi - lo);
        });
        const w = projectFsrs7Params(raw);
        assert.equal(validFsrs7Params(w), true);
        const S = S_MIN + rnd() * 50;
        const sShort = S_MIN + rnd() * 50;
        const D = 1 + rnd() * 9;
        const t = nextIntervalNewton(S, sShort, D, DESIRED_RETENTION, w);
        assert.ok(Number.isFinite(t), 'interval phải hữu hạn');
        assert.ok(t >= tMin && t <= S_MAX, 'interval phải nằm trong miền');
        const r = dualTraceForgettingCurve(t, S, sShort, D, w);
        assert.ok(Number.isFinite(r), 'retention phải hữu hạn');

        const rAtMin = dualTraceForgettingCurve(tMin, S, sShort, D, w);
        const rAtMax = dualTraceForgettingCurve(S_MAX, S, sShort, D, w);
        const outOfDomain = DESIRED_RETENTION >= rAtMin || DESIRED_RETENTION <= rAtMax;
        if (outOfDomain) {
            boundaryCases++;
            assert.ok(t === tMin || t === S_MAX, 'mục tiêu ngoài miền phải trả đúng biên');
        } else {
            // Chỉ những ca nghiệm THỰC SỰ nằm trong miền mới được chấm sai số.
            assert.ok(Math.abs(r - DESIRED_RETENTION) <= 5e-4,
                `nghiệm trong miền nhưng sai số ${Math.abs(r - DESIRED_RETENTION)}`);
            converged++;
        }
    }
    assert.ok(converged > 0, 'phải có ca nghiệm trong miền để kiểm tra hội tụ');
    assert.ok(boundaryCases >= 0);
});

test('phương án dự phòng chia đôi tìm đúng nghiệm khi biết trước khoảng ôn', () => {
    // Dựng bài toán CÓ nghiệm đã biết: chọn t* rồi tính mức retention tại đó làm mục tiêu.
    // Chia đôi phải trả lại đúng t* (sai số tương đối rất nhỏ) — đây là phần đảm bảo cho
    // nhánh dự phòng của solver, thay vì cố tạo một ca Newton hỏng trong miền.
    const cases = [
        { S: 10, sShort: 8, D: 5, t: 7 },
        { S: 0.4, sShort: 0.3, D: 9, t: 0.01 },
        { S: 300, sShort: 120, D: 2, t: 90 },
    ];
    for (const c of cases) {
        const target = dualTraceForgettingCurve(c.t, c.S, c.sShort, c.D, DEFAULT_FSRS7_PARAMS);
        // Bracket hợp lệ: R(1 phút) > target > R(S_MAX).
        assert.ok(dualTraceForgettingCurve(1 / 86400, c.S, c.sShort, c.D, DEFAULT_FSRS7_PARAMS) > target);
        assert.ok(dualTraceForgettingCurve(S_MAX, c.S, c.sShort, c.D, DEFAULT_FSRS7_PARAMS) < target);
        const solved = bisectIntervalForRetention(c.S, c.sShort, c.D, target, DEFAULT_FSRS7_PARAMS);
        assert.ok(Math.abs(solved - c.t) / c.t < 1e-6, `S=${c.S}: ${solved} lệch khỏi ${c.t}`);
        assert.ok(Math.abs(dualTraceForgettingCurve(solved, c.S, c.sShort, c.D, DEFAULT_FSRS7_PARAMS) - target) < 1e-9);
        // Và solver công khai phải cho cùng nghiệm đó (dù đi bằng Newton hay dự phòng).
        const viaSolver = nextIntervalNewton(c.S, c.sShort, c.D, target, DEFAULT_FSRS7_PARAMS);
        assert.ok(Math.abs(viaSolver - c.t) / c.t < 1e-4, `solver lệch: ${viaSolver} vs ${c.t}`);
    }
});

test('với 3.000 bộ tham số ngẫu nhiên, KHÔNG có ca nào nghiệm trong miền mà chia đôi trượt — nên dự phòng chỉ là lưới an toàn', () => {
    // Khẳng định lại kết luận audit: các ca "solver sai" trước đây là mục tiêu NGOÀI miền.
    // Test này ghim lại sự thật đó để không ai dùng lại con số 24/400 như "tỷ lệ lỗi hội tụ".
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const tMin = 1 / 86400;
    let checked = 0, inDomain = 0, newtonMisses = 0;
    for (let i = 0; i < 3000; i++) {
        const w = projectFsrs7Params(DEFAULT_FSRS7_PARAMS.map((v, k) => {
            const [lo, hi] = FSRS7_PARAM_BOUNDS[k];
            return lo + rnd() * (hi - lo);
        }));
        const S = 0.02 + rnd() * 40, sShort = 0.02 + rnd() * 40, D = 1 + rnd() * 9;
        const rMin = dualTraceForgettingCurve(tMin, S, sShort, D, w);
        const rMax = dualTraceForgettingCurve(S_MAX, S, sShort, D, w);
        checked++;
        if (!(DESIRED_RETENTION < rMin && DESIRED_RETENTION > rMax)) continue;
        inDomain++;
        const direct = bisectIntervalForRetention(S, sShort, D, DESIRED_RETENTION, w);
        const residual = Math.abs(dualTraceForgettingCurve(direct, S, sShort, D, w) - DESIRED_RETENTION);
        if (residual > 5e-4) newtonMisses++;
        const viaSolver = nextIntervalNewton(S, sShort, D, DESIRED_RETENTION, w);
        assert.ok(Math.abs(dualTraceForgettingCurve(viaSolver, S, sShort, D, w) - DESIRED_RETENTION) <= 5e-4);
    }
    assert.ok(inDomain > 50, `chỉ có ${inDomain}/${checked} ca nghiệm nằm trong miền`);
    assert.equal(newtonMisses, 0, 'nghiệm trong miền luôn đạt được bằng chia đôi (nên dự phòng không phải nguồn lỗi)');
});
