#!/usr/bin/env node
// tools/format_user_backup.mjs
//
// Chuyển một bản backup JSON (mảng thẻ) thành TSV CHUẨN của ứng dụng — đúng
// đúng thứ tự cột và đúng kiểu dữ liệu mà `parseVocabularyTsv()` đọc lại được.
//
// Vì sao phải viết lại (2026-10-28):
//   Bản cũ tự khai báo header riêng ('wordType', 'phonetic'…) trong khi importer
//   của ứng dụng ánh xạ theo VOCAB_COLUMNS ('Type', 'Pronunciation'). Kết quả đo
//   trên chính file backup của người dùng: 3.053/3.053 thẻ MẤT type + phiên âm
//   khi khôi phục, mà importer vẫn báo 0 lỗi — mất dữ liệu trong im lặng.
//   Bản mới dùng chính `exportVocabularyTsv()` của ứng dụng và tự kiểm tra
//   vòng lặp export → parse ngay sau khi ghi; lệch một trường là exit 1.
//
// Dùng:
//   node tools/format_user_backup.mjs <vocabulary.json|user_backup.json> [outDir]
//
// Nếu JSON là bản export đầy đủ (có `vocabulary`), chỉ phần từ vựng được xuất.

import fs from 'node:fs';
import path from 'node:path';
import { exportVocabularyTsv, parseVocabularyTsv, VOCAB_COLUMNS } from '../src/core/tabular.js';
import { findInternalDuplicateCards } from '../src/core/dedup.js';

const COMPARE_FIELDS = [
    'english', 'vietnamese', 'type', 'pronunciation', 'example', 'isStarred',
    'srsStatus', 'srsDueDate', 'lapses', 'srsInterval', 'srsEaseFactor', 'difficulty',
    'stability', 'reps', 'learningStep', 'lastReviewDate', 'stabilityShort',
    'notes', 'exampleMeaning', 'synonyms', 'antonyms', 'collocations'
];

function fail(message) {
    console.error('✖ ' + message);
    process.exit(1);
}

function readVocabulary(file) {
    let raw;
    try {
        raw = fs.readFileSync(file, 'utf8');
    } catch (error) {
        fail('Không đọc được ' + file + ': ' + error.message);
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        fail('JSON không hợp lệ: ' + error.message);
    }
    const list = Array.isArray(parsed) ? parsed
        : Array.isArray(parsed?.vocabulary) ? parsed.vocabulary
        : Array.isArray(parsed?.cards) ? parsed.cards
        : null;
    if (!list) fail('Không tìm thấy mảng từ vựng trong JSON (cần [] hoặc { vocabulary: [] }).');
    return list;
}

// Giá trị mặc định mà importer tự điền khi ô trống (xem cardFromParts()).
// Thiếu dữ liệu nguồn mà đọc lại đúng mặc định ⇒ KHÔNG phải mất dữ liệu.
const FIELD_DEFAULTS = {
    srsEaseFactor: 2.5, lapses: 0, srsInterval: 0, reps: 0, learningStep: 0,
    isStarred: false, srsStatus: 'New', srsDueDate: null, type: '', pronunciation: '',
    example: '', notes: '', exampleMeaning: '', synonyms: '', antonyms: '', collocations: ''
};

const same = (a, b, field) => {
    const hasDefault = Object.hasOwn(FIELD_DEFAULTS, field);
    const fallback = FIELD_DEFAULTS[field];
    if (a === null || a === undefined) {
        if (b === null || b === undefined) return true;
        if (hasDefault) return same(fallback, b, field);
        return false;
    }
    if (typeof a === 'number') return Math.abs(Number(b) - a) < 1e-9;
    if (typeof a === 'boolean') return String(b).toLowerCase() === String(a).toLowerCase();
    if (Array.isArray(a)) return String(b ?? '') === a.join(',');
    return String(b ?? '') === String(a);
};

const inputPath = process.argv[2];
if (!inputPath) {
    console.error('Dùng: node tools/format_user_backup.mjs <vocabulary.json> [outDir]');
    process.exit(1);
}
const outDir = process.argv[3] ? path.resolve(process.argv[3]) : path.dirname(path.resolve(inputPath));
fs.mkdirSync(outDir, { recursive: true });

const vocabulary = readVocabulary(inputPath);
const live = vocabulary.filter(card => card && !card.isDeleted);
const tsv = exportVocabularyTsv(vocabulary);
const baseName = path.basename(inputPath).replace(/\.json$/i, '');
const outPath = path.join(outDir, baseName + '.app.tsv');
fs.writeFileSync(outPath, tsv, 'utf8');

// --- Tự kiểm tra: export → parse → so từng trường ---
const reparsed = parseVocabularyTsv(tsv);
if (reparsed.errors.length > 0) {
    fail('TSV vừa ghi không parse lại được: ' + JSON.stringify(reparsed.errors.slice(0, 3)));
}
const problems = [];
if (reparsed.rows.length !== live.length) {
    problems.push('Số dòng: ghi ' + live.length + ' nhưng đọc lại ' + reparsed.rows.length);
}
for (let i = 0; i < Math.min(live.length, reparsed.rows.length); i++) {
    const source = live[i];
    const roundTrip = reparsed.rows[i].card;
    for (const field of COMPARE_FIELDS) {
        if (!same(source[field], roundTrip[field], field)) {
            problems.push('Dòng ' + (i + 1) + ' (' + (source.english || '?') + ') trường ' + field +
                ': ' + JSON.stringify(source[field]) + ' → ' + JSON.stringify(roundTrip[field]));
            break;
        }
    }
    if (problems.length >= 5) break;
}

const internalDups = findInternalDuplicateCards(vocabulary);
console.log('── BÁO CÁO BACKUP ─────────────────────────────');
console.log('Nguồn            : ' + path.resolve(inputPath));
console.log('Đích             : ' + outPath);
console.log('Tổng thẻ         : ' + vocabulary.length);
console.log('Thẻ đang dùng    : ' + live.length + (vocabulary.length !== live.length ? ' (bỏ ' + (vocabulary.length - live.length) + ' thẻ đã xoá)' : ''));
console.log('Dung lượng       : ' + (Buffer.byteLength(tsv, 'utf8') / 1024).toFixed(1) + ' kB');
console.log('Cột              : ' + VOCAB_COLUMNS.length + ' (' + VOCAB_COLUMNS.join(', ') + ')');
console.log('Nghĩa bị lặp nội bộ: ' + internalDups.length + ' thẻ');
if (problems.length > 0) {
    console.error('✖ ROUND-TRIP KHÔNG KHỚP:');
    problems.forEach(problem => console.error('   - ' + problem));
    process.exit(1);
}
console.log('✔ Round-trip: ' + live.length + '/' + live.length + ' thẻ khớp toàn bộ ' + COMPARE_FIELDS.length + ' trường.');
