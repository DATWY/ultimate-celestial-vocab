// tests/export-roundtrip.test.mjs
//
// Backup chỉ có giá trị khi KHÔI PHỤC được. Test này khoá hợp đồng
// exportVocabularyTsv() → parseVocabularyTsv(): mọi trường đi ra phải đi về.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportVocabularyTsv, parseVocabularyTsv, VOCAB_COLUMNS } from '../src/core/tabular.js';

const fixture = [
    {
        english: 'apple', vietnamese: 'táo "ngọt"', type: 'noun', pronunciation: '/ˈæp.əl/',
        example: 'An apple a\tday\nkeeps the doctor away', isStarred: true, srsStatus: 'Mastered',
        srsDueDate: 1730000000000, tags: ['food', 'A1'], lapses: 2, isSuspended: false,
        srsInterval: 12, srsEaseFactor: 2.5, difficulty: 5.2, stability: 30.1, reps: 7,
        learningStep: 2, lastReviewDate: 1729000000000, stabilityShort: 24.08,
        notes: 'ghi chú "có nháy"', exampleMeaning: 'mỗi ngày một quả', synonyms: 'pome',
        antonyms: '', collocations: 'green apple|apple pie'
    },
    {
        english: 'run', vietnamese: 'chạy; vận hành', type: 'verb', pronunciation: '',
        example: '', isStarred: false, srsStatus: 'New', srsDueDate: null, tags: [],
        lapses: 0, isSuspended: false, srsInterval: 0, srsEaseFactor: 2.5, difficulty: undefined,
        stability: undefined, reps: 0, learningStep: 0, lastReviewDate: undefined, stabilityShort: undefined
    },
    {
        english: 'take off', vietnamese: 'cất cánh', type: 'phrase', tags: ['aviation'],
        srsStatus: 'Learning', srsInterval: 0.0069, srsDueDate: 1730000600000, reps: 1, lapses: 0
    }
];

const _pick = (card) => {
    const out = {};
    for (const column of VOCAB_COLUMNS) {
        const key = column.charAt(0).toLowerCase() + column.slice(1);
        out[key] = card[key];
    }
    return out;
};

test('round-trip: TSV sinh ra có BOM + CRLF và đủ 24 cột', () => {
    const tsv = exportVocabularyTsv(fixture);
    assert.equal(tsv.charCodeAt(0), 0xFEFF);
    assert.ok(tsv.includes('\r\n'));
    assert.equal(tsv.split('\r\n')[0].split('\t').length, VOCAB_COLUMNS.length);
});

test('round-trip: parse lại không lỗi và giữ nguyên số dòng', () => {
    const parsed = parseVocabularyTsv(exportVocabularyTsv(fixture));
    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.rows.length, fixture.length);
});

test('round-trip: mọi trường văn bản/số/boolean đi ra rồi đi về như cũ', () => {
    const parsed = parseVocabularyTsv(exportVocabularyTsv(fixture));
    const first = parsed.rows[0].card;
    for (const field of ['english', 'vietnamese', 'type', 'pronunciation', 'example', 'notes',
        'exampleMeaning', 'synonyms', 'antonyms', 'collocations', 'srsStatus']) {
        assert.equal(first[field], fixture[0][field], 'trường ' + field);
    }
    for (const field of ['srsDueDate', 'lapses', 'srsInterval', 'srsEaseFactor', 'difficulty',
        'stability', 'reps', 'learningStep', 'lastReviewDate', 'stabilityShort']) {
        assert.ok(Math.abs(Number(first[field]) - Number(fixture[0][field])) < 1e-9, 'trường ' + field);
    }
    assert.equal(first.isStarred, true);
    assert.deepEqual(first.tags, ['food', 'A1']);
});

test('round-trip: ô chứa tab, xuống dòng và dấu nháy kép không làm vỡ cột', () => {
    const parsed = parseVocabularyTsv(exportVocabularyTsv([fixture[0]]));
    const card = parsed.rows[0].card;
    assert.ok(card.example.includes('\t'), 'tab trong ô phải được giữ');
    assert.ok(card.example.includes('\n'), 'xuống dòng trong ô phải được giữ');
    assert.equal(card.vietnamese, 'táo "ngọt"');
    assert.equal(card.notes, 'ghi chú "có nháy"');
});

test('round-trip: thẻ thiếu trường nhận giá trị mặc định đã tài liệu hoá', () => {
    const parsed = parseVocabularyTsv(exportVocabularyTsv([fixture[1]]));
    const card = parsed.rows[0].card;
    assert.equal(card.srsEaseFactor, 2.5);
    assert.equal(card.lapses, 0);
    assert.equal(card.srsInterval, 0);
    assert.equal(card.reps, 0);
    assert.equal(card.isStarred, false);
    assert.equal(card.srsStatus, 'New');
});

test('round-trip: kho rỗng vẫn xuất được header và parse lại ra 0 dòng', () => {
    const parsed = parseVocabularyTsv(exportVocabularyTsv([]));
    assert.equal(parsed.rows.length, 0);
    assert.deepEqual(parsed.errors, []);
});

test('round-trip: thẻ đã xoá (tombstone) không lọt vào bản backup', () => {
    const tsv = exportVocabularyTsv([...fixture, { ...fixture[0], id: 'dead', english: 'ghost', isDeleted: true }]);
    assert.ok(!tsv.includes('ghost'));
});
