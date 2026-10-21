#!/usr/bin/env node
// Browser and offline training intentionally share one scheduler and one holdout gate.
import fs from 'node:fs';
import path from 'node:path';
import { optimizeParameters } from '../src/core/srs/training.js';

const args = process.argv.slice(2);
const mergeAll = args.includes('--merge-all') || args.includes('-m');
const explicit = args.find(arg => !arg.startsWith('-'));
const candidates = explicit ? [path.resolve(explicit)] : fs.readdirSync(process.cwd())
    .filter(name => /^celestial_review_logs_.*\.json$|^review_logs\.json$/i.test(name))
    .map(name => path.resolve(name)).sort((a,b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
const files = mergeAll ? candidates : candidates.slice(0,1);
if (!files.length || files.some(file => !fs.existsSync(file))) {
    console.error('Cách dùng: npm run train -- "duong-dan/celestial_review_logs.json"');
    console.error('Hoặc đặt file xuất lịch sử học trong thư mục dự án rồi chạy npm run train.');
    process.exitCode = 1;
} else {
    try {
        const raw = [];
        for (const file of files) {
            const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
            const rows = Array.isArray(data) ? data : data.logs;
            if (!Array.isArray(rows)) throw new Error('Tệp không chứa danh sách lịch sử học.');
            if (data.dict) rows.forEach(row => raw.push({ cardId: data.dict[row[0]], rating: row[1], t: row[2], ts: row[3], isTyping: !!row[4], id: row[5] }));
            else raw.push(...rows);
        }
        const vocabulary = [...new Map(raw.map(log => [log.cardId, { id: log.cardId, english: log.english || '' }])).values()];
        const result = optimizeParameters(raw, vocabulary, undefined, { budgetMs: 60000, iterations: 340 });
        console.log(JSON.stringify({ ...result, params: undefined }, null, 2));
        fs.writeFileSync('fsrs7_params_latest.report.json', JSON.stringify({ ...result, params: undefined }, null, 2));
        if (result.improved) {
            fs.writeFileSync('fsrs7_params_latest.json', JSON.stringify(result.params));
            fs.writeFileSync('fsrs7_params_latest.txt', JSON.stringify(result.params));
            console.log('Đã lưu 34 tham số được kiểm tra. Nhập fsrs7_params_latest.json trong phần cấu hình lịch ôn.');
        } else {
            console.log('Chưa tạo bộ tham số thay thế. Giữ bộ hiện tại; xem lý do trong báo cáo.');
        }
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}