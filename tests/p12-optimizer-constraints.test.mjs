// tests/p12-optimizer-constraints.test.mjs
//
// AUDIT-R2.1 — Gradient optimizer đi qua miền bất hợp lệ.
//
// Lỗi cũ (tái hiện trong reports/logic-audit-2026-11-03/recheck-reproduce.mjs):
//   • lossOf trả Infinity khi bộ weights vi phạm ràng buộc thứ tự;
//   • finiteDifferenceGradient vẫn tiến từng toạ độ ⇒ gradient w0 = Infinity;
//   • bước Adam thành NaN, m1/m2 bị nhiễm;
//   • projectFsrs7Params biến NaN thành MIN (w0: 4 → 0,01) rồi vòng lặp đi tiếp.
//
// Test này đi qua optimizeParameters THẬT (không chỉ hàm chiếu / evaluateParameters) với dữ liệu
// đủ ngưỡng, tại đúng hai loại biên: ràng buộc thứ tự (S0 bằng nhau, w25 = w26) và biên hộp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    optimizeParameters, finiteDifferenceGradient, projectFsrs7Params, prepareTrainingData
} from '../src/core/srs/training.js';
import { DEFAULT_FSRS7_PARAMS, FSRS7_PARAM_BOUNDS, validFsrs7Params, fsrs7OrderingError } from '../src/core/srs/constants.js';

const DAY = 86400000;
const NOW = new Date(2026, 10, 3, 15, 0).getTime();

/** 60 thẻ × 8 lượt = 480 log (đủ ngưỡng count≥400, train≥100, validation≥30). */
function buildLogs() {
    const logs = [];
    for (let r = 0; r < 8; r++) {
        for (let id = 0; id < 60; id++) {
            logs.push({
                id: `${id}-${r}`, cardId: String(id),
                rating: r && (id + r) % 5 === 0 ? 1 : 3,
                t: r ? 1 : 0,
                ts: NOW - (8 - r) * DAY + id * 1000,
                first: r === 0
            });
        }
    }
    return logs;
}

/** Bộ khởi đầu có S0 bằng nhau và w25 = w26 (đúng ca đã tái hiện lỗi). */
function equalStart() {
    const w = [...DEFAULT_FSRS7_PARAMS];
    w[0] = w[1] = w[2] = w[3] = 4;
    w[25] = w[26] = 0.5;
    assert.equal(fsrs7OrderingError(w), null, 'bộ khởi đầu phải hợp lệ');
    return w;
}

function assertSaneResult(result, label) {
    assert.ok(Array.isArray(result.params), `${label}: phải trả bộ tham số`);
    assert.equal(result.params.length, 34);
    assert.ok(result.params.every(Number.isFinite), `${label}: mọi tham số phải hữu hạn`);
    assert.ok(validFsrs7Params(result.params), `${label}: kết quả phải thoả ràng buộc + biên`);
    assert.equal(result.gradientFailures, 0, `${label}: không được có gradient không hữu hạn`);
    assert.equal(result.rejectedSteps, 0, `${label}: không được có bước bị loại`);
    assert.ok(Number.isFinite(result.trainLossBest), `${label}: loss phải hữu hạn`);
}

test('optimizeParameters chạy được với S0 bằng nhau và w25 = w26 (không sinh Infinity/NaN)', () => {
    const start = equalStart();
    const result = optimizeParameters(buildLogs(), [], start, { iterations: 6, budgetMs: 20000 });
    assertSaneResult(result, 'equal-start');
    // Biên ràng buộc PHẢI được chạm tới: 4 tham số S0 bằng nhau nên phần lớn toạ độ bị kẹp và
    // gradient phải lấy hướng lùi thay vì lao ra ngoài miền (đây là chỗ bản cũ sinh Infinity).
    assert.ok(result.pinnedCoordinates > 0, 'phải ghi nhận toạ độ bị ràng buộc kẹp');
    // Không được tái hiện lỗi "NaN bị chiếu thành min": w0 khởi đầu 4 không thể nhảy về 0,01.
    assert.ok(result.params[0] > FSRS7_PARAM_BOUNDS[0][0] + 1e-9,
        `w0 không được rơi về biên min do phép chiếu xử lý NaN (nhận ${result.params[0]})`);
    // Ràng buộc thứ tự vẫn đúng sau tối ưu.
    assert.ok(result.params[0] <= result.params[1] && result.params[1] <= result.params[2] && result.params[2] <= result.params[3]);
    assert.ok(result.params[26] >= result.params[25]);
});

test('optimizeParameters chạy được khi khởi đầu ở BIÊN HỘP (w0=min, w3=max, w25=min, w26=max)', () => {
    const start = equalStart();
    start[0] = FSRS7_PARAM_BOUNDS[0][0];
    start[1] = FSRS7_PARAM_BOUNDS[1][0];
    start[2] = FSRS7_PARAM_BOUNDS[2][0];
    start[3] = FSRS7_PARAM_BOUNDS[3][1];
    start[25] = FSRS7_PARAM_BOUNDS[25][1];
    start[26] = FSRS7_PARAM_BOUNDS[26][1];
    assert.equal(fsrs7OrderingError(start), null);
    const result = optimizeParameters(buildLogs(), [], start, { iterations: 6, budgetMs: 20000 });
    assertSaneResult(result, 'box-edge');
    assert.ok(result.pinnedCoordinates > 0, 'biên hộp cũng phải dùng hướng sai phân còn khả thi');
});

test('bộ mặc định vẫn tối ưu được (không chặn oan sau khi siết gradient)', () => {
    const result = optimizeParameters(buildLogs(), [], DEFAULT_FSRS7_PARAMS, { iterations: 6, budgetMs: 20000 });
    assertSaneResult(result, 'default');
    assert.ok(result.iterations >= 1, 'phải thực sự chạy vòng lặp');
});

test('finiteDifferenceGradient phân biệt "không có hướng khả thi" với "lỗi số thật"', () => {
    const fd = 1e-3, current = 1;
    // Hướng tiến không khả thi (null) ⇒ lấy hướng lùi.
    const backward = finiteDifferenceGradient(0.5, fd, current, x => (x > 0.5 ? null : 2));
    assert.ok(Number.isFinite(backward), 'phải dùng hướng lùi thay vì trả Infinity');
    assert.ok(Math.abs(backward - (current - 2) / fd) < 1e-3, 'gradient phải là sai phân LÙI thật');
    // Cả hai hướng đều không khả thi ⇒ null (toạ độ bị kẹp), KHÔNG phải Infinity/0 giả.
    assert.equal(finiteDifferenceGradient(0.5, fd, current, () => null), null);
    // Điểm khả thi nhưng không chấm được ⇒ NaN để nơi gọi LOẠI bước.
    assert.ok(Number.isNaN(finiteDifferenceGradient(0.5, fd, current, () => NaN)));
    // Biên hộp trên: không thể tiến ⇒ dùng lùi.
    assert.ok(Number.isFinite(finiteDifferenceGradient(1, fd, current, x => x * 2)));
});

test('projectFsrs7Params TỪ CHỐI giá trị không hữu hạn thay vì biến nó thành min', () => {
    const broken = [...DEFAULT_FSRS7_PARAMS];
    broken[0] = NaN;
    assert.equal(projectFsrs7Params(broken), null, 'NaN không được "chiếu" thành biên min');
    broken[0] = Infinity;
    assert.equal(projectFsrs7Params(broken), null);
    assert.equal(projectFsrs7Params(DEFAULT_FSRS7_PARAMS.slice(0, 10)), null, 'sai độ dài phải bị từ chối');
    const projected = projectFsrs7Params(DEFAULT_FSRS7_PARAMS);
    assert.ok(projected && validFsrs7Params(projected));
});

test('prepareTrainingData không lấy t = 0 làm bằng chứng khởi đầu (dữ liệu ở test này có cờ first)', () => {
    const data = prepareTrainingData(buildLogs(), []);
    assert.equal(data.cards.length, 60);
    assert.equal(data.verifiedChains, 60, 'cờ first do engine ghi phải được nhận');
    assert.equal(data.historyComplete, true);
});
