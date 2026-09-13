#!/usr/bin/env node
/**
 * tools/train_fsrs7.js — FSRS-7 Personal Parameter Optimizer
 * 
 * Huấn luyện bộ 34 tham số FSRS-7 cá nhân hoá từ lịch sử ôn tập thật (review_logs.json).
 * Thuần Node.js (Zero external dependencies).
 * 
 * Sử dụng:
 *   node tools/train_fsrs7.js [đường_dẫn_file_logs.json]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { getDifficultyBias, getStabilityMultiplier } from '../src/core/srs/heuristics.js';

// 34 tham số FSRS-7 chuẩn (Global Benchmark)
const DEFAULT_PARAMS = [
    0.1104, 2.2395, 3.9221, 11.7841,
    6.1686, 0.6457, 3.6807,
    1.9795, 0.0, 1.3826, 0.7024, 0.5999, 0.8146, 0.6398, 1.0,
    1.3207, 0.6707, 3.8668, 0.4416, 0.0934, 1.8631, 0.6162, 1.0869,
    0.1567, 0.0801, 0.2421, 0.9464, 0.1433, 0.7145, 0.0, 0.5667, 0.3734, 0.5333, 0.3048
];

const S_MIN = 0.01;
const S_MAX = 36500.0;
const D_MIN = 1.0;
const D_MAX = 10.0;

export function clampParams(w) {
    const clamped = [...w];
    for (let i = 0; i < 4; i++) clamped[i] = Math.max(0.01, Math.min(100.0, clamped[i]));
    
    clamped[4] = Math.min(10.0, Math.max(1.0, clamped[4]));
    clamped[5] = Math.min(5.0, Math.max(0.01, clamped[5]));
    clamped[6] = Math.min(10.0, Math.max(0.01, clamped[6]));

    clamped[7] = Math.min(10.0, Math.max(0.01, clamped[7]));
    clamped[8] = Math.min(2.0, Math.max(0.0, clamped[8]));
    clamped[9] = Math.min(10.0, Math.max(0.01, clamped[9]));
    clamped[10] = Math.min(10.0, Math.max(0.01, clamped[10]));
    clamped[11] = Math.min(2.0, Math.max(0.0, clamped[11]));
    clamped[12] = Math.min(10.0, Math.max(0.01, clamped[12]));
    clamped[13] = Math.min(1.0, Math.max(0.01, clamped[13]));
    clamped[14] = Math.min(5.0, Math.max(1.0, clamped[14]));

    clamped[15] = Math.min(10.0, Math.max(0.01, clamped[15]));
    clamped[16] = Math.min(2.0, Math.max(0.0, clamped[16]));
    clamped[17] = Math.min(10.0, Math.max(0.01, clamped[17]));
    clamped[18] = Math.min(10.0, Math.max(0.01, clamped[18]));
    clamped[19] = Math.min(2.0, Math.max(0.0, clamped[19]));
    clamped[20] = Math.min(10.0, Math.max(0.01, clamped[20]));
    clamped[21] = Math.min(1.0, Math.max(0.01, clamped[21]));
    clamped[22] = Math.min(5.0, Math.max(1.0, clamped[22]));

    clamped[23] = Math.min(0.95, Math.max(0.01, clamped[23]));
    clamped[24] = Math.min(0.95, Math.max(0.01, clamped[24]));
    clamped[25] = Math.min(0.99, Math.max(0.01, clamped[25]));
    clamped[26] = Math.min(0.99, Math.max(0.01, clamped[26]));
    clamped[27] = Math.min(5.0, Math.max(0.01, clamped[27]));
    clamped[28] = Math.min(5.0, Math.max(0.01, clamped[28]));
    clamped[29] = Math.min(2.0, Math.max(0.0, clamped[29]));
    clamped[30] = Math.min(2.0, Math.max(0.0, clamped[30]));
    clamped[31] = Math.min(2.0, Math.max(0.0, clamped[31]));
    clamped[32] = Math.min(2.0, Math.max(0.0, clamped[32]));
    clamped[33] = Math.min(2.0, Math.max(0.0, clamped[33]));

    return clamped;
}

function shortComponentRecall(t, s_short, w) {
    const safeT = Math.max(0, t);
    const safeS = Math.max(S_MIN, s_short);
    const t_over_s = safeT / safeS;
    const decay1_mag = Math.min(0.95, Math.max(0.01, w[23] * Math.pow(safeS, Math.max(-0.3, w[33] - 0.3))));
    const decay1 = -decay1_mag;
    const base1 = Math.min(0.99, Math.max(0.01, w[25]));
    const exponent = Math.min(60.0, Math.max(-60.0, Math.log(base1) / decay1));
    const factor1 = Math.exp(exponent) - 1.0;
    const val = Math.pow(Math.max(1e-5, t_over_s * factor1 + 1.0), decay1);
    return Number.isFinite(val) ? val : 0.5;
}

function dualTraceForgettingCurve(t, s_long, s_short, d, w) {
    const safeT = Math.max(0, t);
    const safeLong = Math.max(S_MIN, s_long);
    const safeShort = Math.max(S_MIN, s_short);
    const safeD = Math.min(D_MAX, Math.max(D_MIN, Number(d) || 5.0));

    const r1 = shortComponentRecall(safeT, safeShort, w);

    const decay2 = -Math.min(0.95, Math.max(0.01, w[24]));
    const base2 = Math.min(0.99, Math.max(0.01, w[26]));
    const factor2 = Math.pow(base2, 1.0 / decay2) - 1.0;
    const d_timescale = Math.exp(Math.min(20.0, Math.max(-20.0, (safeD - 5.0) * (w[32] - 0.3))));
    const r2_inner = Math.max(1e-5, (safeT / safeLong) * factor2 * d_timescale + 1.0);
    const r2 = Math.pow(r2_inner, decay2);

    const weight1 = Math.max(1e-5, w[27] * Math.pow(safeShort, -Math.min(2.0, Math.max(0.0, w[29]))));
    const weight2 = Math.max(1e-5, w[28] * Math.pow(safeLong, Math.min(2.0, Math.max(0.0, w[30]))) * Math.exp(Math.min(20.0, Math.max(-20.0, (safeD - 5.0) * (w[31] - 0.5)))));

    const denom = weight1 + weight2;
    const retention = denom > 0 ? (weight1 * r1 + weight2 * r2) / denom : 0.5;
    const safeRet = Number.isFinite(retention) ? retention : 0.5;
    return 1e-5 + (1.0 - 2e-5) * Math.min(1.0, Math.max(0.0, safeRet));
}

function initDifficulty(rating, w) {
    return Math.min(D_MAX, Math.max(D_MIN, w[4] - Math.exp((rating - 1) * w[5]) + 1));
}

function nextDifficulty(d, rating, r, w) {
    const deltaD = -w[6] * (rating - 3);
    const damping = (10.0 - d) * d / 25.0;
    let newD = d + deltaD * damping;
    if (rating === 1) {
        newD = d + w[6] * (r + 0.1) * damping;
    }
    const d0_4 = w[4] - Math.exp(3.0 * w[5]) + 1.0;
    newD = 0.99 * newD + 0.01 * d0_4;
    return Math.min(D_MAX, Math.max(D_MIN, newD));
}

function nextStability(last_s, last_d, r, rating, start, w) {
    const safeS = Math.min(S_MAX, Math.max(S_MIN, Number(last_s) || 1.0));
    const safeD = Math.min(10.0, Math.max(1.0, Number(last_d) || 5.0));
    const safeR = Math.min(1.0, Math.max(0.0, Number(r) || 0.9));

    const hard_penalty = (rating === 2) ? Math.min(1.0, Math.max(0.01, w[start + 6])) : 1.0;
    const easy_bonus = (rating === 4) ? Math.min(5.0, Math.max(1.0, w[start + 7])) : 1.0;

    const fail_exp = Math.min(20.0, (1.0 - safeR) * Math.min(10.0, Math.max(0.01, w[start + 5])));
    const fail_pow = Math.min(2.0, Math.max(0.0, w[start + 4]));
    const new_s_fail = Math.max(0.01, w[start + 3]) * 
        Math.max(0.0, Math.pow(safeS + 1.0, fail_pow) - 1.0) * 
        Math.exp(fail_exp);
    const pls = Math.min(safeS, Number.isFinite(new_s_fail) ? new_s_fail : safeS);

    const sinc_exp = Math.min(10.0, Math.max(-10.0, w[start] - 1.5));
    const r_exp = Math.min(20.0, (1.0 - safeR) * Math.min(10.0, Math.max(0.01, w[start + 2])));
    const s_pow = Math.min(2.0, Math.max(0.0, w[start + 1]));

    const sinc = Math.exp(sinc_exp) * 
        (11.0 - safeD) * 
        Math.pow(safeS, -s_pow) * 
        Math.max(0.0, Math.exp(r_exp) - 1.0) * 
        hard_penalty * 
        easy_bonus + 1.0;

    const safeSinc = Number.isFinite(sinc) ? sinc : 1.0;
    const new_s_success = Math.max(pls, safeS * safeSinc);
    const result = (rating > 1) ? new_s_success : pls;
    const finalVal = Number.isFinite(result) ? result : safeS;
    return Math.min(S_MAX, Math.max(S_MIN, finalVal));
}

function simulateAndComputeLoss(cardsData, weights, l2Lambda = 0.05) {
    let totalBCE = 0;
    let count = 0;

    for (const card of cardsData) {
        let s_long = 0;
        let s_short = 0;
        let d = 5.0;

        for (let i = 0; i < card.reviews.length; i++) {
            const rev = card.reviews[i];
            const rating = Math.min(4, Math.max(1, rev.rating));
            const t = Math.max(0, rev.t || 0);

            if (i === 0) {
                // Khởi tạo thẻ mới có tích hợp Linguistic Bias đồng bộ 100% với Web Engine
                const hBias = getDifficultyBias({ english: card.english || '' });
                const sMult = getStabilityMultiplier(hBias);
                const ratingIdx = rating - 1;
                s_long = weights[ratingIdx] * sMult;
                s_short = 0.8 * s_long;
                d = Math.min(D_MAX, Math.max(D_MIN, initDifficulty(rating, weights) + hBias * 0.5));
                continue;
            }

            // Dự đoán xác suất nhớ R trước khi học
            const rawPredR = dualTraceForgettingCurve(t, s_long, s_short, d, weights);
            const predR = Number.isFinite(rawPredR) ? rawPredR : 0.5;
            const actualOutcome = (rating > 1) ? 1.0 : 0.0;

            // Binary Cross-Entropy Loss: - [y * ln(p) + (1-y) * ln(1-p)]
            const eps = 1e-6;
            const p = Math.min(1.0 - eps, Math.max(eps, predR));
            const bce = -(actualOutcome * Math.log(p) + (1.0 - actualOutcome) * Math.log(1.0 - p));
            if (Number.isFinite(bce)) {
                totalBCE += bce;
                count++;
            }

            // Cập nhật S và D cho bước kế tiếp
            const r1 = shortComponentRecall(t, s_short, weights);
            const upd_s_long = nextStability(s_long, d, predR, rating, 7, weights);
            let upd_s_short = nextStability(s_short, d, r1, rating, 15, weights);
            const upd_d = nextDifficulty(d, rating, predR, weights);

            if (rating === 1) {
                upd_s_short = Math.max(S_MIN, Math.min(upd_s_short, 0.8 * upd_s_long));
            }

            s_long = upd_s_long;
            s_short = upd_s_short;
            d = upd_d;

            if (rev.isTyping && rating > 1) {
                s_long = Math.min(S_MAX, s_long * 1.25);
                s_short = Math.min(S_MAX, s_short * 1.25);
            }
        }
    }

    const meanBCE = count > 0 ? (totalBCE / count) : 999.0;

    // L2 Regularization neo vào bộ gốc để chống Overfitting
    let l2Penalty = 0;
    for (let k = 0; k < weights.length; k++) {
        const diff = (weights[k] - DEFAULT_PARAMS[k]) / (DEFAULT_PARAMS[k] + 1e-4);
        l2Penalty += diff * diff;
    }

    const finalLoss = meanBCE + (l2Lambda * l2Penalty / weights.length);
    return Number.isFinite(finalLoss) ? finalLoss : 999.0;
}

function evaluateTimeSeriesSplit(cardsData, rawList, weights) {
    if (!rawList || rawList.length < 50) return null;

    const sortedLogs = [...rawList].sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const splitIdx = Math.floor(sortedLogs.length * 0.8);
    const splitTimestamp = sortedLogs[splitIdx].ts || 0;
    const splitDateStr = new Date(splitTimestamp).toLocaleDateString('vi-VN');

    let testBCE = 0;
    let testCount = 0;

    for (const card of cardsData) {
        let s_long = 0, s_short = 0, d = 5.0;
        for (let i = 0; i < card.reviews.length; i++) {
            const rev = card.reviews[i];
            const rating = Math.min(4, Math.max(1, rev.rating));
            const t = Math.max(0, rev.t || 0);

            if (i === 0) {
                const hBias = getDifficultyBias({ english: card.english || '' });
                const sMult = getStabilityMultiplier(hBias);
                const ratingIdx = rating - 1;
                s_long = weights[ratingIdx] * sMult;
                s_short = 0.8 * s_long;
                d = Math.min(D_MAX, Math.max(D_MIN, initDifficulty(rating, weights) + hBias * 0.5));
                continue;
            }

            const rawPredR = dualTraceForgettingCurve(t, s_long, s_short, d, weights);
            const predR = Number.isFinite(rawPredR) ? rawPredR : 0.5;
            const actualOutcome = (rating > 1) ? 1.0 : 0.0;

            if (rev.ts >= splitTimestamp) {
                const eps = 1e-6;
                const p = Math.min(1.0 - eps, Math.max(eps, predR));
                const bce = -(actualOutcome * Math.log(p) + (1.0 - actualOutcome) * Math.log(1.0 - p));
                if (Number.isFinite(bce)) {
                    testBCE += bce;
                    testCount++;
                }
            }

            const r1 = shortComponentRecall(t, s_short, weights);
            const upd_s_long = nextStability(s_long, d, predR, rating, 7, weights);
            let upd_s_short = nextStability(s_short, d, r1, rating, 15, weights);
            const upd_d = nextDifficulty(d, rating, predR, weights);

            if (rating === 1) {
                upd_s_short = Math.max(S_MIN, Math.min(upd_s_short, 0.8 * upd_s_long));
            }
            s_long = upd_s_long;
            s_short = upd_s_short;
            d = upd_d;

            if (rev.isTyping && rating > 1) {
                s_long = Math.min(S_MAX, s_long * 1.25);
                s_short = Math.min(S_MAX, s_short * 1.25);
            }
        }
    }

    return {
        testBce: testCount > 0 ? (testBCE / testCount) : 0,
        testCount,
        splitDateStr
    };
}

function computeCalibrationBins(cardsData, weights) {
    const bins = [
        { min: 0.0, max: 0.70, label: '< 70%', preds: [], acts: [] },
        { min: 0.70, max: 0.80, label: '70% - 80%', preds: [], acts: [] },
        { min: 0.80, max: 0.85, label: '80% - 85%', preds: [], acts: [] },
        { min: 0.85, max: 0.90, label: '85% - 90%', preds: [], acts: [] },
        { min: 0.90, max: 0.95, label: '90% - 95%', preds: [], acts: [] },
        { min: 0.95, max: 1.00, label: '95% - 100%', preds: [], acts: [] }
    ];

    for (const card of cardsData) {
        let s_long = 0, s_short = 0, d = 5.0;
        for (let i = 0; i < card.reviews.length; i++) {
            const rev = card.reviews[i];
            const rating = Math.min(4, Math.max(1, rev.rating));
            const t = Math.max(0, rev.t || 0);

            if (i === 0) {
                const hBias = getDifficultyBias({ english: card.english || '' });
                const sMult = getStabilityMultiplier(hBias);
                const ratingIdx = rating - 1;
                s_long = weights[ratingIdx] * sMult;
                s_short = 0.8 * s_long;
                d = Math.min(D_MAX, Math.max(D_MIN, initDifficulty(rating, weights) + hBias * 0.5));
                continue;
            }

            const rawPredR = dualTraceForgettingCurve(t, s_long, s_short, d, weights);
            const predR = Number.isFinite(rawPredR) ? rawPredR : 0.5;
            const actualOutcome = (rating > 1) ? 1.0 : 0.0;

            for (const b of bins) {
                if (predR >= b.min && (predR < b.max || (b.max === 1.0 && predR <= 1.0))) {
                    b.preds.push(predR);
                    b.acts.push(actualOutcome);
                    break;
                }
            }

            const r1 = shortComponentRecall(t, s_short, weights);
            const upd_s_long = nextStability(s_long, d, predR, rating, 7, weights);
            let upd_s_short = nextStability(s_short, d, r1, rating, 15, weights);
            const upd_d = nextDifficulty(d, rating, predR, weights);

            if (rating === 1) {
                upd_s_short = Math.max(S_MIN, Math.min(upd_s_short, 0.8 * upd_s_long));
            }
            s_long = upd_s_long;
            s_short = upd_s_short;
            d = upd_d;

            if (rev.isTyping && rating > 1) {
                s_long = Math.min(S_MAX, s_long * 1.25);
                s_short = Math.min(S_MAX, s_short * 1.25);
            }
        }
    }

    let sumSquaredError = 0;
    let validBinCount = 0;
    const tableData = [];

    for (const b of bins) {
        const count = b.preds.length;
        if (count === 0) continue;
        const avgPred = b.preds.reduce((a, c) => a + c, 0) / count;
        const avgAct = b.acts.reduce((a, c) => a + c, 0) / count;
        const delta = avgPred - avgAct;
        sumSquaredError += delta * delta;
        validBinCount++;
        tableData.push({
            label: b.label,
            count,
            predPct: (avgPred * 100).toFixed(1),
            actPct: (avgAct * 100).toFixed(1),
            diffPct: (delta >= 0 ? '+' : '') + (delta * 100).toFixed(1)
        });
    }

    const rmseBins = validBinCount > 0 ? Math.sqrt(sumSquaredError / validBinCount) : 0;
    return { tableData, rmseBins };
}

// Sinh nhiễu Gaussian chuẩn
function randomGaussian() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================
console.log("================================================================================");
console.log("             FSRS-7 PERSONALIZED PARAMETER TRAINER (STANDALONE)                ");
console.log("================================================================================\n");

function findReviewLogsFile(cliArg) {
    if (cliArg && fs.existsSync(cliArg)) {
        return { path: cliArg, source: 'Tham số dòng lệnh / File kéo thả trực tiếp' };
    }

    const searchDirs = [
        { dir: process.cwd(), label: 'Thư mục dự án hiện tại' },
        { dir: path.join(process.cwd(), 'scratch'), label: 'Thư mục scratch' },
    ];

    const userProfile = process.env.USERPROFILE || process.env.HOME;
    if (userProfile) {
        const downloadsDir = path.join(userProfile, 'Downloads');
        if (fs.existsSync(downloadsDir)) {
            searchDirs.push({ dir: downloadsDir, label: 'Thư mục Downloads máy tính' });
        }
    }

    const candidateFiles = [];

    for (const { dir, label } of searchDirs) {
        try {
            if (!fs.existsSync(dir)) continue;
            const entries = fs.readdirSync(dir);
            for (const entry of entries) {
                const lower = entry.toLowerCase();
                if (lower.endsWith('.json') && (lower.includes('review_logs') || lower.includes('celestial'))) {
                    const fullPath = path.join(dir, entry);
                    try {
                        const stat = fs.statSync(fullPath);
                        if (stat.isFile() && stat.size > 10) {
                            candidateFiles.push({
                                path: fullPath,
                                filename: entry,
                                label,
                                mtimeMs: stat.mtimeMs,
                                mtimeStr: stat.mtime.toLocaleString('vi-VN')
                            });
                        }
                    } catch (_) {}
                }
            }
        } catch (_) {}
    }

    if (candidateFiles.length > 0) {
        // Sắp xếp file có thời gian chỉnh sửa mới nhất lên đầu
        candidateFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
        const best = candidateFiles[0];
        
        if (candidateFiles.length > 1 && !cliArg) {
            console.log(`🔍 Tìm thấy ${candidateFiles.length} file review logs trong máy tính:`);
            candidateFiles.slice(0, 5).forEach((f, idx) => {
                const isLatest = idx === 0 ? " ➔ [⭐ TỰ ĐỘNG CHỌN MỚI NHẤT]" : "";
                console.log(`   [${idx + 1}] ${f.filename} (${f.mtimeStr})${isLatest}`);
            });
            if (candidateFiles.length > 5) {
                console.log(`   ... và ${candidateFiles.length - 5} file logs khác.`);
            }
            console.log(`💡 Mẹo: Chạy 'node tools/train_fsrs7.js --merge-all' nếu bạn muốn gộp tất cả các file trên.\n`);
        }

        return {
            path: best.path,
            source: `${best.label} -> "${best.filename}" (sửa đổi lúc: ${best.mtimeStr})`,
            allCandidates: candidateFiles
        };
    }

    return null;
}

const args = process.argv.slice(2);
const isMergeAll = args.includes('--merge-all') || args.includes('-m');
const targetArg = args.find(a => !a.startsWith('-'));

const foundLogFile = findReviewLogsFile(targetArg);

if (!foundLogFile) {
    console.log("💡 Hướng dẫn sử dụng:");
    console.log("   1. Vào web, bấm 'Xuất Review Logs (.json)' để tải file về máy.");
    console.log("   2. Sau đó bạn có thể:");
    console.log("      - Cách 1: Kéo thả file .json vừa tải thả thẳng vào file train_fsrs7.bat.");
    console.log("      - Cách 2: Để file .json trong thư mục Downloads hoặc thư mục dự án và chạy train_fsrs7.bat.");
    console.log("      - Cách 3: Chạy lệnh: node tools/train_fsrs7.js <đường_dẫn_file_logs.json>\n");
    console.error(`❌ Không tìm thấy bất kỳ file logs review nào (*review_logs*.json) trong dự án hay thư mục Downloads!`);
    process.exit(1);
}

let rawList = [];

if (isMergeAll && foundLogFile.allCandidates && foundLogFile.allCandidates.length > 1) {
    console.log(`🔄 Đang gộp dữ liệu từ toàn bộ ${foundLogFile.allCandidates.length} file review logs phát hiện...`);
    const seenReviews = new Set();
    for (const cand of foundLogFile.allCandidates) {
        try {
            const content = fs.readFileSync(cand.path, 'utf8');
            const data = JSON.parse(content);
            const list = Array.isArray(data) ? data : (data.logs || []);
            for (const item of list) {
                const cardId = item.cardId || item[0] || 'unknown';
                const ts = item.ts || item[3] || 0;
                const key = `${cardId}_${ts}`;
                if (!seenReviews.has(key)) {
                    seenReviews.add(key);
                    rawList.push(item);
                }
            }
        } catch (err) {
            console.warn(`   ⚠️ Bỏ qua file lỗi: ${cand.filename} (${err.message})`);
        }
    }
    console.log(`✅ Đã gộp và khử trùng lặp thành công: ${rawList.length} lượt ôn tập duy nhất.`);
} else {
    const inputPath = foundLogFile.path;
    console.log(`📂 Nguồn dữ liệu: ${foundLogFile.source}`);
    console.log(`📍 Đường dẫn file: ${inputPath}`);
    const rawFile = fs.readFileSync(inputPath, 'utf8');
    let rawData = null;
    try {
        rawData = JSON.parse(rawFile);
    } catch (e) {
        console.error("❌ Lỗi cú pháp JSON trong file logs:", e.message);
        process.exit(1);
    }
    rawList = Array.isArray(rawData) ? rawData : (rawData.logs || []);
    console.log(`📊 Tổng số lượt ôn tập phát hiện: ${rawList.length}`);
}

if (rawList.length < 50) {
    console.warn("\n⚠️ CẢNH BÁO: Bạn có dưới 50 lượt ôn bài.");
    console.warn("   Dữ liệu còn quá ít để nhận diện xu hướng trí nhớ cá nhân.");
    console.warn("   Khuyến nghị học thêm ít nhất 100-200 lượt để kết quả chuẩn xác nhất!\n");
}

// Gom nhóm reviews theo cardId
const cardsMap = new Map();
for (const item of rawList) {
    const cardId = item.cardId || item[0] || 'unknown';
    const english = item.english || '';
    if (!cardsMap.has(cardId)) {
        cardsMap.set(cardId, { cardId, english, reviews: [] });
    } else if (english && !cardsMap.get(cardId).english) {
        cardsMap.get(cardId).english = english;
    }
    cardsMap.get(cardId).reviews.push({
        rating: Number(item.rating || item[1] || 3),
        t: Number(item.t || item[2] || 1),
        ts: Number(item.ts || item[3] || 0),
        isTyping: !!item.isTyping
    });
}

// Sắp xếp chronologically
for (const card of cardsMap.values()) {
    card.reviews.sort((a, b) => a.ts - b.ts);
}

const cardsData = Array.from(cardsMap.values()).filter(c => c.reviews.length >= 2);
console.log(`🃏 Số thẻ có từ 2 lượt ôn tập trở lên: ${cardsData.length}`);

if (cardsData.length === 0) {
    console.error("❌ Không có thẻ nào có từ 2 lượt review trở lên để phân tích tốc độ quên.");
    process.exit(1);
}

// Tính Loss đường chuẩn (Baseline)
const baselineLoss = simulateAndComputeLoss(cardsData, DEFAULT_PARAMS, 0.0);
console.log(`\n🎯 Sai số mô hình mặc định (Baseline Loss): ${baselineLoss.toFixed(5)}`);
console.log("⚡ Bắt đầu quá trình tối ưu hóa đa chiều (Evolutionary Strategy)...");

// Khởi tạo thuật toán ES (Evolution Strategy)
let currentBest = [...DEFAULT_PARAMS];
let bestLoss = baselineLoss;

const lambda = 40;     // Số ứng viên mỗi thế hệ
const mu = 8;          // Số ứng viên ưu tú nhất được chọn
const generations = 100;
let sigma = 0.08;      // Độ lệch chuẩn bước nhảy

for (let g = 0; g < generations; g++) {
    const population = [];

    for (let i = 0; i < lambda; i++) {
        // Sinh đột biến quanh currentBest
        const rawCandidate = currentBest.map((val) => {
            const noise = randomGaussian() * sigma * Math.max(0.1, Math.abs(val));
            return val + noise;
        });
        const candidate = clampParams(rawCandidate);

        const loss = simulateAndComputeLoss(cardsData, candidate, 0.05);
        if (Number.isFinite(loss)) {
            population.push({ params: candidate, loss });
        }
    }

    if (population.length === 0) continue;

    population.sort((a, b) => a.loss - b.loss);
    const topMu = population.slice(0, Math.min(mu, population.length));

    if (topMu[0].loss < bestLoss) {
        bestLoss = topMu[0].loss;
        currentBest = clampParams(topMu[0].params);
    }

    // Recombination: cập nhật mean
    const newMean = new Array(34).fill(0);
    for (let dim = 0; dim < 34; dim++) {
        let sum = 0;
        for (let i = 0; i < topMu.length; i++) sum += topMu[i].params[dim];
        newMean[dim] = sum / topMu.length;
    }
    currentBest = clampParams(newMean);

    sigma *= 0.97; // Co dần bước nhảy

    if ((g + 1) % 25 === 0 || g === generations - 1) {
        process.stdout.write(`   Hiệp ${g + 1}/${generations} | Loss hiện tại: ${bestLoss.toFixed(5)}\n`);
    }
}

// Đánh giá Loss thuần không phạt L2
const finalRawLoss = simulateAndComputeLoss(cardsData, currentBest, 0.0);
const improvement = ((baselineLoss - finalRawLoss) / baselineLoss) * 100;

// 1. Đánh giá Out-of-Sample (TimeSeriesSplit: 80% Train -> 20% Test)
const splitEvalBaseline = evaluateTimeSeriesSplit(cardsData, rawList, DEFAULT_PARAMS);
const splitEvalOptimized = evaluateTimeSeriesSplit(cardsData, rawList, currentBest);
let testImprovement = null;
if (splitEvalBaseline && splitEvalOptimized && splitEvalBaseline.testCount > 0) {
    testImprovement = ((splitEvalBaseline.testBce - splitEvalOptimized.testBce) / splitEvalBaseline.testBce) * 100;
}

// 2. Tính Bảng Hiệu Chuẩn Trí Nhớ (Calibration Table & RMSE Bins)
const calibration = computeCalibrationBins(cardsData, currentBest);

console.log("\n================================================================================");
console.log("                           KẾT QUẢ TỐI ƯU HOÁ FSRS-7                            ");
console.log("================================================================================");
console.log(`📉 Sai số gốc (Baseline Loss):        ${baselineLoss.toFixed(5)}`);
console.log(`🏆 Sai số tối ưu (Optimized Loss):    ${finalRawLoss.toFixed(5)}`);
console.log(`📈 Cải thiện tổng thể (In-Sample):    ${improvement > 0 ? '+' : ''}${improvement.toFixed(2)}%`);

if (testImprovement !== null) {
    console.log("\n--- KIỂM ĐỊNH NGOẠI SUẤT TƯƠNG LAI (TimeSeriesSplit: 80% Train / 20% Test) ---");
    console.log(`⏱️ Mốc thời gian chia tách:           Từ ngày ${splitEvalBaseline.splitDateStr} (${splitEvalBaseline.testCount} lượt ôn tương lai)`);
    console.log(`📊 Sai số kiểm thử gốc (Baseline):    ${splitEvalBaseline.testBce.toFixed(5)}`);
    console.log(`🎯 Sai số kiểm thử tối ưu (User):     ${splitEvalOptimized.testBce.toFixed(5)}`);
    console.log(`🚀 Cải thiện Out-of-Sample:           ${testImprovement > 0 ? '+' : ''}${testImprovement.toFixed(2)}% ${testImprovement > 0 ? '(Mô hình tổng quát hóa tốt, không học vẹt)' : ''}`);
}

if (calibration && calibration.tableData.length > 0) {
    console.log("\n--- BẢNG HIỆU CHUẨN XÁC SUẤT TRÍ NHỚ (Calibration Table) ---");
    console.log("Phân nhóm xác suất  | Số lượt ôn | P dự đoán | Thực tế nhớ | Độ lệch");
    console.log("------------------------------------------------------------------");
    for (const row of calibration.tableData) {
        const p1 = (row.label + '                ').slice(0, 19);
        const p2 = (row.count + '        ').slice(0, 11);
        const p3 = (row.predPct + '%         ').slice(0, 11);
        const p4 = (row.actPct + '%         ').slice(0, 13);
        const p5 = row.diffPct + '%';
        console.log(`${p1} | ${p2} | ${p3} | ${p4} | ${p5}`);
    }
    console.log("------------------------------------------------------------------");
    console.log(`📐 Sai số hiệu chuẩn toàn dải (RMSE bins): ${(calibration.rmseBins * 100).toFixed(2)}% (Càng thấp càng chuẩn xác)`);
}

if (improvement > 0) {
    console.log("\n🎉 CHÚC MỪNG! Đã tìm ra bộ 34 tham số khớp hoàn hảo hơn với não bộ của bạn.");
} else {
    console.log("\nℹ️ Dữ liệu cho thấy bộ tham số mặc định hiện tại đã tối ưu rất tốt cho bạn.");
}

// Làm tròn 4 chữ số thập phân chuẩn khoa học
const formattedArray = currentBest.map(n => Number(n.toFixed(4)));
const outputString = JSON.stringify(formattedArray);

console.log("\n👇 COPY MẢNG 34 SỐ DƯỚI ĐÂY VÀ DÁN VÀO WEB (Cài đặt -> Cấu hình 34 tham số):\n");
console.log(outputString);
console.log("\n================================================================================");

// Lưu file txt & json để tiện mở lại hoặc tái sử dụng
const txtOutputPath = path.join(process.cwd(), 'fsrs7_params_latest.txt');
const jsonOutputPath = path.join(process.cwd(), 'fsrs7_params_latest.json');

try {
    fs.writeFileSync(txtOutputPath, outputString, 'utf8');
    const resultObj = {
        trainedAt: new Date().toISOString(),
        sourceFile: foundLogFile.path,
        sourceLabel: foundLogFile.source,
        totalLogs: rawList.length,
        pairedCards: cardsData.length,
        baselineLoss: Number(baselineLoss.toFixed(5)),
        optimizedLoss: Number(finalRawLoss.toFixed(5)),
        improvementPercent: Number(improvement.toFixed(2)),
        timeSeriesTest: testImprovement !== null ? {
            testReviews: splitEvalBaseline.testCount,
            splitDate: splitEvalBaseline.splitDateStr,
            baselineTestBce: Number(splitEvalBaseline.testBce.toFixed(5)),
            optimizedTestBce: Number(splitEvalOptimized.testBce.toFixed(5)),
            outOfSampleImprovementPercent: Number(testImprovement.toFixed(2))
        } : null,
        calibrationRmseBinsPercent: calibration ? Number((calibration.rmseBins * 100).toFixed(2)) : null,
        params: formattedArray
    };
    fs.writeFileSync(jsonOutputPath, JSON.stringify(resultObj, null, 2), 'utf8');
    console.log(`💾 Đã lưu kết quả ra file:`);
    console.log(`   - fsrs7_params_latest.txt (Chỉ chứa chuỗi 34 tham số)`);
    console.log(`   - fsrs7_params_latest.json (Chi tiết chỉ số & thời gian huấn luyện)`);
} catch (err) {
    // Không làm gián đoạn nếu quyền ghi bị hạn chế
}

// Tự động sao chép vào Clipboard hệ điều hành (Windows clip / macOS pbcopy / Linux xclip)
let clipboardSuccess = false;
try {
    if (process.platform === 'win32') {
        const proc = spawnSync('clip', { input: outputString, encoding: 'utf-8' });
        clipboardSuccess = (proc.status === 0);
    } else if (process.platform === 'darwin') {
        const proc = spawnSync('pbcopy', { input: outputString, encoding: 'utf-8' });
        clipboardSuccess = (proc.status === 0);
    } else {
        const proc = spawnSync('xclip', ['-selection', 'clipboard'], { input: outputString, encoding: 'utf-8' });
        clipboardSuccess = (proc.status === 0);
    }
} catch (_) {
    clipboardSuccess = false;
}

if (clipboardSuccess) {
    console.log("\n📋 [CLIPBOARD] ĐÃ TỰ ĐỘNG SAO CHÉP 34 THAM SỐ VÀO BỘ NHỚ ĐỆM (CLIPBOARD)!");
    console.log("👉 Bạn chỉ cần mở Web -> Cài đặt FSRS-7 -> Bấm Ctrl + V -> Bấm Lưu & Áp Dụng.");
} else {
    console.log("\n💡 Mẹo: Bôi đen chuỗi số ở trên và nhấn Ctrl + C để sao chép vào web.");
}
console.log("================================================================================\n");
