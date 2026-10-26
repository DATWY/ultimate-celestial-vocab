#!/usr/bin/env node
// tools/simulate_intervals.mjs — T1.3: đo ảnh hưởng của Heuristics lên S0 / D0 / interval.
//
// Mục đích: chứng minh bằng SỐ THẬT rằng heuristics (đặc sản của app) không còn "bơm"
// tham số FSRS quá mạnh. Không sửa công thức FSRS: mọi phép tính bộ nhớ ở đây gọi
// đúng các module gốc (difficulty.js / stability.js / forgetting.js) và engine
// calculateNextSrsState() cho các lượt sau lượt đầu.
//
// Chạy:  node tools/simulate_intervals.mjs
//
// Cột "TRƯỚC" dùng bản heuristics ĐÓNG BĂNG (chép nguyên văn từ heuristics.js trước T1.3),
// cột "SAU" dùng heuristics hiện tại. Nhờ vậy so sánh là apples-to-apples: cùng một
// bộ máy FSRS, chỉ khác hệ số heuristics.

import {
    DEFAULT_FSRS7_PARAMS, DESIRED_RETENTION, S_MIN, S_MAX, D_MIN, D_MAX,
    MAX_INTERVAL_DAYS, MAX_GRADUATION_INTERVAL_DAYS, LEARNING_STEPS_MS, D0_BIAS_SCALE
} from '../src/core/srs/constants.js';
import { initDifficulty } from '../src/core/srs/difficulty.js';
import { nextIntervalNewton } from '../src/core/srs/forgetting.js';
import { calculateNextSrsState } from '../src/core/srs/index.js';
import { getDifficultyBias, getStabilityMultiplier } from '../src/core/srs/heuristics.js';
import { isCommonWord } from '../src/core/srs/frequency-data.js';

const DAY_MS = 86_400_000;
const MIN_MS = 60_000;
const W = DEFAULT_FSRS7_PARAMS;
const NOW = Date.UTC(2026, 0, 1, 8, 0, 0);
const GOOD = 3;

// ─────────────────────────────────────────────────────────────────────────────
// BẢN ĐÓNG BĂNG: heuristics.js trước T1.3 (chép nguyên văn, KHÔNG sửa).
// Giữ ở đây để bảng "TRƯỚC" là số thật của code cũ, không phải số nhớ lại.
// ─────────────────────────────────────────────────────────────────────────────
function legacyEstimateSyllables(word) {
    const w = String(word).toLowerCase().replace(/[^a-z]/g, '');
    if (w.length <= 2) return 1;
    const vowelGroups = w.match(/[aeiouy]+/gi);
    let count = vowelGroups ? vowelGroups.length : 1;
    if (w.endsWith('e') && !w.endsWith('le') && !w.endsWith('ie') && count > 1) count--;
    if (w.endsWith('es') && !w.endsWith('ses') && !w.endsWith('zes') && count > 1) count--;
    if (w.endsWith('ed') && !w.endsWith('ted') && !w.endsWith('ded') && count > 1) count--;
    return Math.max(1, count);
}

function legacyDifficultyBias(card) {
    if (!card || !card.english) return 0;
    const english = String(card.english).trim();
    if (english.length === 0) return 0;
    const words = english.split(/[\s-]+/).filter(Boolean);
    const wordCount = words.length;
    const type = String(card.type || '').toLowerCase();
    let bias = 0;

    const maxWordLen = Math.max(...words.map(w => w.length));
    if (wordCount === 1 && maxWordLen <= 4) bias -= 1.0;
    else if (maxWordLen >= 10) bias += 1.0;

    if (type.includes('idiom') || type.includes('thành ngữ')) bias += 2.5;
    else if (type.includes('phrasal')) bias += 2.0;
    else if (wordCount >= 2) bias += (type.includes('noun') || type.includes('danh từ')) ? 0.5 : 1.0;
    else if ((type === 'noun' || type === 'danh từ' || type.startsWith('noun ')) && !type.includes('pronoun')) bias -= 0.5;

    if (wordCount === 1) {
        const syllables = legacyEstimateSyllables(english);
        if (syllables >= 4) bias += 1.0;
    }

    if (wordCount === 1 && isCommonWord(english)) bias -= 1.5;

    return Math.min(3.0, Math.max(-3.0, bias));
}

function legacyStabilityMultiplier(bias) {
    return Math.max(0.5, Math.min(1.5, 1 - bias * 0.1));
}

// ─────────────────────────────────────────────────────────────────────────────
// 6 TỪ MẪU (đúng danh sách trong T1.3)
// ─────────────────────────────────────────────────────────────────────────────
const SAMPLES = [
    { label: 'Từ ngắn, dễ', card: { id: 'w1', english: 'cat', vietnamese: 'mèo', type: 'noun', pronunciation: '/kæt/' } },
    { label: 'Từ dài 14 ký tự', card: { id: 'w2', english: 'serendipitously', vietnamese: 'một cách tình cờ', type: 'adverb', pronunciation: '/ˌser.ənˈdɪp.ə.təs.li/' } },
    { label: 'Idiom', card: { id: 'w3', english: 'break the ice', vietnamese: 'phá tan bầu không khí ngượng ngùng', type: 'idiom', pronunciation: '/breɪk ði aɪs/' } },
    { label: 'Từ có phiên âm', card: { id: 'w4', english: 'meticulous', vietnamese: 'tỉ mỉ', type: 'adjective', pronunciation: '/məˈtɪk.jə.ləs/' } },
    { label: 'Từ KHÔNG phiên âm', card: { id: 'w5', english: 'meticulous', vietnamese: 'tỉ mỉ', type: 'adjective' } },
    { label: 'Từ nhiều âm tiết', card: { id: 'w6', english: 'extraordinarily', vietnamese: 'một cách phi thường', type: 'adverb' } }
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fmt = (v, digits = 2) => Number(v).toFixed(digits);
const fmtInterval = (days) => {
    const ms = days * DAY_MS;
    if (ms < 3_600_000) return `${Math.round(ms / MIN_MS)} phút`;
    if (ms < DAY_MS) return `${(ms / 3_600_000).toFixed(1)} giờ`;
    return `${fmt(days, 2)} ngày`;
};

/**
 * Lượt chấm ĐẦU của thẻ New với rating Good — tái lập đúng nhánh isFirstReview của
 * src/core/srs/index.js (S0 = w[2] * sMult, D0 = initDifficulty(3) + hBias * D0_BIAS_SCALE)
 * rồi trả về interval FSRS thô mà cặp (S0, D0) sinh ra (đây chính là số bị heuristics bơm).
 *
 * @param {{ biasFn: Function, multFn: Function, d0Scale: number }} model
 */
function firstReview(card, model, now = NOW) {
    const bias = model.biasFn(card);
    const mult = model.multFn(bias);
    const S0 = clamp(W[2] * mult, S_MIN, S_MAX);
    const D0 = clamp(initDifficulty(GOOD, W) + bias * model.d0Scale, D_MIN, D_MAX);
    const S0short = clamp(0.8 * S0, S_MIN, S_MAX);
    const rawInterval = nextIntervalNewton(S0, S0short, D0, DESIRED_RETENTION, W);

    // Trạng thái sau lượt 1 y như engine sinh ra (T1.1: New + Good → Learning bước 1, 10 phút).
    const state = {
        ...card,
        srsStatus: 'Learning',
        learningStep: 1,
        reps: 1,
        lapses: 0,
        isLeech: false,
        stability: S0,
        stabilityShort: S0short,
        difficulty: D0,
        anchor: 0,
        modality: 'en-vi',
        srsInterval: LEARNING_STEPS_MS[1] / DAY_MS,
        srsDueDate: now + LEARNING_STEPS_MS[1],
        lastReviewDate: now,
        srsUpdatedAt: now,
        updatedAt: now
    };
    return { bias, mult, S0, D0, rawInterval, state };
}

// "TRƯỚC" = heuristics cũ + đúng công thức D0 cũ (bias × 0.5).
const LEGACY_MODEL = { biasFn: legacyDifficultyBias, multFn: legacyStabilityMultiplier, d0Scale: 0.5 };
// "SAU" = heuristics hiện tại + hệ số D0 hiện tại trong constants.js.
const CURRENT_MODEL = { biasFn: getDifficultyBias, multFn: getStabilityMultiplier, d0Scale: D0_BIAS_SCALE };

/**
 * 5 lần Good liên tiếp: lượt 1 dựng cục bộ (để thay được heuristics cũ/mới),
 * lượt 2..5 chạy bằng CHÍNH engine thật ⇒ lịch/learning steps/trần interval
 * đều là hành vi production, không phải bản mô phỏng tự viết.
 */
function fiveGood(card, model, rounds = 5) {
    const first = firstReview(card, model);
    let state = first.state;
    for (let i = 1; i < rounds; i++) {
        state = calculateNextSrsState(state, GOOD, 'en-vi', 0, null, true, { now: state.srsDueDate }).newState;
    }
    return { ...first, finalState: state };
}

// ─── Kiểm chứng: bản dựng lượt-1 cục bộ phải khớp engine thật (heuristics hiện tại) ───
function crossCheckEngine() {
    const rows = [];
    for (const { label, card } of SAMPLES) {
        const local = firstReview(card, CURRENT_MODEL);
        const engine = calculateNextSrsState({ ...card, srsStatus: 'New', reps: 0, lapses: 0 }, GOOD, 'en-vi', 0, null, true, { now: NOW }).newState;
        const okS = Math.abs(local.state.stability - engine.stability) < 1e-9;
        const okD = Math.abs(local.state.difficulty - engine.difficulty) < 1e-9;
        const okDue = local.state.srsDueDate === engine.srsDueDate;
        const okStep = local.state.learningStep === engine.learningStep;
        rows.push({ label, ok: okS && okD && okDue && okStep, okS, okD, okDue, okStep });
    }
    return rows;
}

function buildRow(sample) {
    const before = fiveGood(sample.card, LEGACY_MODEL);
    const after = fiveGood(sample.card, CURRENT_MODEL);
    return { sample, before, after };
}

function printTable(rows) {
    const head = ['Từ mẫu', 'Từ', 'bias', 'xS', 'S0 (ngày)', 'D0', 'interval FSRS lần 1', 'lịch thật lần 1', 'interval sau 5 Good'];
    const table = [];
    for (const r of rows) {
        for (const [tag, phase] of [['TRƯỚC', r.before], ['SAU', r.after]]) {
            table.push([
                `${r.sample.label} [${tag}]`,
                r.sample.card.english,
                fmt(phase.bias),
                fmt(phase.mult, 3),
                fmt(phase.S0, 3),
                fmt(phase.D0, 3),
                fmtInterval(phase.rawInterval),
                fmtInterval(phase.state.srsInterval),
                `${fmt(phase.finalState.srsInterval, 2)} ngày`
            ]);
        }
    }
    const widths = head.map((h, i) => Math.max(h.length, ...table.map(row => row[i].length)));
    const line = (cells) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join(' | ');
    console.log(line(head));
    console.log(widths.map(w => '-'.repeat(w)).join('-+-'));
    for (const row of table) console.log(line(row));
}

function ratio(rows, pick) {
    const values = rows.map(pick).filter(v => Number.isFinite(v) && v > 0);
    const min = Math.min(...values);
    const max = Math.max(...values);
    return { min, max, ratio: max / min };
}

function printRatios(rows) {
    const cols = [
        ['interval FSRS lần 1', r => r.rawInterval],
        ['interval sau 5 Good', r => r.finalState.srsInterval]
    ];
    console.log('\nChênh lệch GIỮA các từ mẫu (max / min) — mục tiêu ≤ 2.00×:');
    for (const [name, pick] of cols) {
        const b = ratio(rows.map(r => r.before), pick);
        const a = ratio(rows.map(r => r.after), pick);
        console.log(`  • ${name}:`);
        console.log(`      TRƯỚC  ${fmt(b.ratio, 2)}×  (min ${fmtInterval(b.min)} → max ${fmtInterval(b.max)})`);
        console.log(`      SAU    ${fmt(a.ratio, 2)}×  (min ${fmtInterval(a.min)} → max ${fmtInterval(a.max)})   ${a.ratio <= 2 ? '✓ đạt' : '✗ chưa đạt'}`);
    }
}

function main() {
    console.log('T1.3 — Mô phỏng S0 / D0 / interval: heuristics TRƯỚC và SAU khi thu biên độ');
    console.log(`FSRS-7 w[2] (S0 cho Good) = ${W[2]} | initDifficulty(3) = ${fmt(initDifficulty(GOOD, W), 3)} | desired retention = ${DESIRED_RETENTION}`);
    console.log(`Trần: lần chấm đầu ${MAX_INTERVAL_DAYS} ngày (sau fuzz), tốt nghiệp ${MAX_GRADUATION_INTERVAL_DAYS} ngày cho thẻ lapses = 0\n`);

    const rows = SAMPLES.map(buildRow);
    printTable(rows);
    printRatios(rows);

    const checks = crossCheckEngine();
    const allOk = checks.every(c => c.ok);
    console.log(`\nCross-check engine thật (S0/D0/due/learningStep của lượt 1 phải khớp): ${allOk ? '✓ KHỚP toàn bộ 6 từ' : '✗ LỆCH'}`);
    if (!allOk) {
        for (const c of checks) if (!c.ok) console.log(`   ✗ ${c.label}: S=${c.okS} D=${c.okD} due=${c.okDue} step=${c.okStep}`);
        process.exitCode = 1;
    }
}

main();
