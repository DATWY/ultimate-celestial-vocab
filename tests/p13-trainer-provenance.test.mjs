// tests/p13-trainer-provenance.test.mjs
//
// AUDIT-R3.1 — Trainer xác minh nhầm lượt đầu và áp dụng weights từ lịch sử bị cắt.
//
// Hai lỗi riêng:
//   (a) GHI SAI BẰNG CHỨNG: thẻ Mastered legacy thiếu `reps`/`lastReviewDate` nhưng có
//       `srsInterval`/`srsDueDate` ⇒ engine tính t = 15 mà vẫn ghi `first = true`.
//   (b) DÙNG SAI BẰNG CHỨNG: chuỗi có đầu `first = false, t = 0` vẫn được replay như thể bắt
//       đầu từ thẻ New, rồi optimizer báo `validated` và worker tự ghi weights.
//
// Ba trạng thái được giữ xuyên suốt: true (biết chắc lượt đầu), false (biết chắc không phải),
// thiếu trường (log cũ chưa biết). Thiếu KHÔNG được tự ghi thành false.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculateNextSrsState } from '../src/core/srs/index.js';
import { prepareTrainingData, optimizeParameters } from '../src/core/srs/training.js';
import { DEFAULT_FSRS7_PARAMS, validFsrs7Params } from '../src/core/srs/constants.js';
import { resolveOptimizationOutcome, optimizerMessage } from '../src/core/srs/worker-manager.js';
import {
    compressLogs, expandReviewLogRows, mergeReviewLogs, buildReviewLogsExport, readFirstFlag
} from '../src/core/review-log-merge.js';

const DAY = 86400000;
const NOW = new Date(2026, 10, 3, 15, 0).getTime();
const DAY_MS = DAY;

/** 60 thẻ × 8 lượt; `head` quyết định cờ của lượt đầu mỗi chuỗi. */
function chainLogs({ chains = 60, head = true } = {}) {
    const logs = [];
    for (let r = 0; r < 8; r++) {
        for (let id = 0; id < chains; id++) {
            logs.push({
                id: `${id}-${r}`, cardId: String(id),
                rating: r && (id + r) % 5 === 0 ? 1 : 3,
                t: r ? 1 : 0,
                ts: NOW - (8 - r) * DAY + id * 1000,
                first: r === 0 ? head : false
            });
        }
    }
    return logs;
}

// ───────────────────────── (a) Ghi đúng bằng chứng ─────────────────────────
test('R3.1a: thẻ Mastered legacy (interval 15, due now, thiếu reps/lastReviewDate) KHÔNG phải lượt đầu', () => {
    const legacy = {
        id: 'legacy-mastered', english: 'obfuscate', srsStatus: 'Mastered',
        srsInterval: 15, srsDueDate: NOW, stability: 15, stabilityShort: 12, difficulty: 5
    };
    const first = calculateNextSrsState(legacy, 3, 'en-vi', 0, null, true, { now: NOW });
    // Engine vẫn suy ra thời gian đã trôi từ lịch sử ⇒ t > 0.
    assert.ok(first.log.t > 0, `phải suy ra t > 0 (nhận ${first.log.t})`);
    assert.equal(first.log.t, 15);
    // ...nên cờ phải là FALSE, không được là true.
    assert.equal(first.log.first, false, 'thiếu reps/lastReviewDate không đủ để xác nhận lượt đầu');

    const second = calculateNextSrsState(first.newState, 3, 'en-vi', 0, null, true, { now: NOW + 6 * DAY });
    const data = prepareTrainingData([first.log, second.log], []);
    assert.equal(data.cards.length, 0, 'chuỗi bắt đầu bằng first = false bị loại khỏi replay');
    assert.equal(data.verifiedChains, 0);
    assert.equal(data.historyComplete, false, 'không được báo lịch sử đầy đủ');
});

test('R3.1a: thẻ New thật vẫn được ghi first = true, và không bị siết oan', () => {
    const fresh = { id: 'new-one', english: 'apple', srsStatus: 'New', reps: 0 };
    const first = calculateNextSrsState(fresh, 3, 'en-vi', 0, null, true, { now: NOW });
    assert.equal(first.log.t, 0);
    assert.equal(first.log.first, true);
    const second = calculateNextSrsState(first.newState, 3, 'en-vi', 0, null, true, { now: NOW + DAY });
    assert.equal(second.log.first, false);
    const data = prepareTrainingData([first.log, second.log], []);
    assert.equal(data.verifiedChains, 1);
    assert.equal(data.historyComplete, true);

    // Thẻ New nhưng ĐÃ có reps > 0 (legacy) ⇒ không phải lượt đầu.
    const legacyNew = calculateNextSrsState({ id: 'n2', english: 'x', srsStatus: 'New', reps: 2 }, 3, 'en-vi', 0, null, true, { now: NOW });
    assert.equal(legacyNew.log.first, false);
});

// ───────────────────────── (b) Không dùng bằng chứng sai ─────────────────────────
test('R3.1b: 60 chuỗi có đầu first = false, t = 0 bị loại và GIỮ weights đang dùng', () => {
    const logs = chainLogs({ head: false });
    const data = prepareTrainingData(logs, []);
    assert.equal(data.totalChains, 60);
    assert.equal(data.cards.length, 0, 'first = false phải bị loại, không cứu bằng t = 0');
    assert.equal(data.verifiedChains, 0);
    assert.equal(data.assumedStartChains, 0);
    assert.equal(data.historyComplete, false);

    const result = optimizeParameters(logs, [], DEFAULT_FSRS7_PARAMS, { iterations: 3, budgetMs: 5000 });
    assert.equal(result.improved, false);
    assert.equal(result.reason, 'truncated-history');
    assert.equal(result.startEvidence, 'none');
    // Quyết định ÁP DỤNG của worker (hàm thật dùng trong runOptimizer).
    const outcome = resolveOptimizationOutcome(result, { baselineTrainedAt: 7, currentTrainedAt: 7 });
    assert.equal(outcome.apply, false, 'worker không được ghi weights từ lịch sử bị cắt');
    assert.match(optimizerMessage(result), /bị cắt/i);
});

test('R3.1b: dữ liệu TRỘN nhưng phần đáng tin chưa đủ ngưỡng ⇒ từ chối áp dụng', () => {
    // 4 chuỗi đáng tin (32 lượt) + 60 chuỗi bị cắt ⇒ đủ 400 lượt tổng nhưng KHÔNG đủ phần tin cậy.
    const trusted = chainLogs({ chains: 4, head: true })
        .map(log => ({ ...log, cardId: `t${log.cardId}`, id: `t${log.id}` }));
    const truncated = chainLogs({ chains: 60, head: false })
        .map(log => ({ ...log, cardId: `x${log.cardId}`, id: `x${log.id}` }));
    const logs = [...trusted, ...truncated].sort((a, b) => a.ts - b.ts);
    const data = prepareTrainingData(logs, []);
    assert.ok(data.count >= 400, 'điều kiện tái hiện: tổng số lượt đủ lớn');
    assert.equal(data.verifiedChains, 4);
    assert.equal(data.assumedStartChains, 0);
    assert.equal(data.totalChains, 64);

    const result = optimizeParameters(logs, [], DEFAULT_FSRS7_PARAMS, { iterations: 2, budgetMs: 5000 });
    assert.equal(result.startEvidence, 'mixed');
    assert.equal(result.improved, false, 'không được áp dụng khi phần tin cậy chưa đủ');
    assert.equal(result.reason, 'insufficient-verified-history');
    assert.ok(result.trustedRows < 400);
    assert.deepEqual(result.params ?? DEFAULT_FSRS7_PARAMS, DEFAULT_FSRS7_PARAMS, 'giữ nguyên bộ đang dùng');
    const outcome = resolveOptimizationOutcome(result, { baselineTrainedAt: 1, currentTrainedAt: 1 });
    assert.equal(outcome.apply, false);
    assert.match(optimizerMessage(result), /bằng chứng lượt ôn đầu tiên/);
});

test('R3.1b: dữ liệu trộn ĐỦ phần đáng tin thì mới được áp dụng (và worker áp dụng đúng)', () => {
    // 60 chuỗi đáng tin (480 lượt) + 20 chuỗi bị cắt ⇒ phần tin cậy tự đạt 400/100/30.
    const trusted = chainLogs({ chains: 60, head: true });
    const truncated = chainLogs({ chains: 20, head: false })
        .map(log => ({ ...log, cardId: `y${log.cardId}`, id: `y${log.id}` }));
    const logs = [...trusted, ...truncated].sort((a, b) => a.ts - b.ts);
    const result = optimizeParameters(logs, [], DEFAULT_FSRS7_PARAMS, { iterations: 4, budgetMs: 20000 });
    assert.equal(result.startEvidence, 'mixed');
    assert.equal(result.trustedChains, 60);
    assert.ok(result.trustedRows === undefined || result.trustedRows >= 400 || result.improved === false);
    if (result.improved) {
        assert.ok(validFsrs7Params(result.params));
        const outcome = resolveOptimizationOutcome(result, { baselineTrainedAt: 3, currentTrainedAt: 3 });
        assert.equal(outcome.apply, true, 'worker phải áp dụng khi phần tin cậy tự đạt ngưỡng');
    } else {
        // Không cải thiện là kết quả hợp lệ (cổng thống kê), nhưng KHÔNG được áp dụng gì.
        assert.deepEqual(result.params ?? DEFAULT_FSRS7_PARAMS, DEFAULT_FSRS7_PARAMS);
        assert.equal(resolveOptimizationOutcome(result, { baselineTrainedAt: 3, currentTrainedAt: 3 }).apply, false);
    }
});

test('R3.1b: quyết định áp dụng của worker xử lý đủ các nhánh (đổi cấu hình, preview, không cải thiện)', () => {
    const improved = { improved: true, reason: 'validated', params: [...DEFAULT_FSRS7_PARAMS] };
    assert.equal(resolveOptimizationOutcome(improved, { baselineTrainedAt: 1, currentTrainedAt: 1 }).apply, true);
    const changed = resolveOptimizationOutcome(improved, { baselineTrainedAt: 1, currentTrainedAt: 2 });
    assert.equal(changed.apply, false);
    assert.equal(changed.reason, 'configuration-changed');
    const preview = resolveOptimizationOutcome(improved, { baselineTrainedAt: 1, currentTrainedAt: 1, preview: true });
    assert.equal(preview.apply, false);
    assert.equal(preview.reason, 'preview-only');
    const cheat = resolveOptimizationOutcome(improved, { baselineTrainedAt: 1, currentTrainedAt: 1, cheat: true });
    assert.equal(cheat.apply, false);
    const refused = resolveOptimizationOutcome({ improved: false, reason: 'not-significant' }, { baselineTrainedAt: 1, currentTrainedAt: 1 });
    assert.equal(refused.apply, false);
    assert.equal(refused.reason, 'not-significant');
    // runOptimizer dùng chính hàm này để quyết định ghi weights.
    const manager = fs.readFileSync(new URL('../src/core/srs/worker-manager.js', import.meta.url), 'utf8');
    assert.match(manager, /resolveOptimizationOutcome\(result/);
    assert.match(manager, /if \(outcome\.apply\)[\s\S]{0,120}setUserFsrs7Params/);
});

// ───────────────── Trạng thái đi qua toàn bộ đường dữ liệu ─────────────────
test('R3.1: hàng nén giữ ba trạng thái và CLI trainer đọc bằng CÙNG hàm', () => {
    const dict = ['a', 'b'];
    const rows = [
        [0, 3, 0, NOW - DAY, 0, 'a-first', 1],
        [0, 3, 1, NOW, 0, 'a-later', 0],
        [1, 3, 0, NOW - DAY, 0, 'b-legacy']          // log cũ: thiếu cột
    ];
    const expanded = expandReviewLogRows(dict, rows);
    assert.equal(expanded[0].first, true);
    assert.equal(expanded[1].first, false);
    assert.equal('first' in expanded[2] ? expanded[2].first : undefined, undefined, 'thiếu cột ⇒ chưa biết');
    assert.equal(readFirstFlag(rows[2]), undefined);
    assert.equal(readFirstFlag(rows[1]), false);

    // CLI `tools/train_fsrs7.js` phải dùng đúng hàm này (không tự viết lại rồi làm rơi cột).
    const cli = fs.readFileSync(new URL('../tools/train_fsrs7.js', import.meta.url), 'utf8');
    assert.match(cli, /expandReviewLogRows\(data\.dict, rows\)/);
});

test('R3.1: compress KHÔNG tự sinh cột first cho log chưa biết; merge và export giữ nguyên', () => {
    const compressed = compressLogs([
        { cardId: 'k', rating: 3, t: 0, ts: NOW - DAY, id: 'k1' },              // chưa biết
        { cardId: 'k', rating: 3, t: 1, ts: NOW, id: 'k2', first: false }        // biết chắc
    ]);
    assert.equal(compressed.logs[0].length, 6, 'chưa biết ⇒ không có cột 6');
    assert.equal(compressed.logs[1][6], 0);

    const merged = mergeReviewLogs(compressed, { dict: ['k'], logs: [[0, 3, 0, NOW - DAY, 0, 'k1']] });
    assert.equal(merged.logs.find(row => row[5] === 'k1').length, 6, 'merge không được bịa false');

    const exported = buildReviewLogsExport(merged, [{ id: 'k', english: 'k' }]);
    const json = JSON.parse(JSON.stringify(exported));
    assert.equal('first' in json[0], false);
    assert.equal(json[1].first, false);

    // Log legacy vẫn ĐỌC và XUẤT được (không mất dữ liệu, không ném lỗi).
    const data = prepareTrainingData(json, []);
    assert.equal(data.assumedStartChains, 1, 'chuỗi legacy vẫn dùng được ở mức phỏng đoán');
    assert.equal(data.verifiedChains, 0);
    assert.equal(data.historyComplete, false);
    assert.ok(data.count >= 2);
});

test('R3.1: thẻ Mastered legacy đi qua đúng chuỗi engine → log → trainer, không được xác minh', () => {
    const legacy = {
        id: 'tsv-mastered', english: 'ubiquitous', srsStatus: 'Mastered',
        srsInterval: 15, srsDueDate: NOW, stability: 15, stabilityShort: 12, difficulty: 5
    };
    const r1 = calculateNextSrsState(legacy, 3, 'en-vi', 0, null, true, { now: NOW });
    const r2 = calculateNextSrsState(r1.newState, 3, 'en-vi', 0, null, true, { now: NOW + DAY_MS });
    const compressed = compressLogs([r1.log, r2.log]);
    // Dòng do engine ghi luôn có cột (true/false), không phải "chưa biết".
    assert.equal(compressed.logs[0][6], 0);
    const data = prepareTrainingData(compressed, []);
    assert.equal(data.verifiedChains, 0);
    assert.equal(data.truncatedChains, 1);
    assert.equal(data.historyComplete, false);
    assert.ok(fs.existsSync(new URL('../src/core/review-log-merge.js', import.meta.url)));
});
