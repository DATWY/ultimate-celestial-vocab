export const VOCAB_COLUMNS = ['English', 'Vietnamese', 'Type', 'Pronunciation', 'Example', 'isStarred',
    'srsStatus', 'srsDueDate', 'Tags', 'lapses', 'isSuspended', 'srsInterval', 'srsEaseFactor',
    'difficulty', 'stability', 'reps', 'learningStep', 'lastReviewDate', 'stabilityShort', 'notes',
    'exampleMeaning', 'synonyms', 'antonyms', 'collocations'];

export function parseTsv(text) {
    const rows = [];
    let row = [], field = '', quoted = false, closed = false, line = 1, rowLine = 1;
    text = String(text).replace(/^\uFEFF/, '');
    const endField = () => { row.push(field); field = ''; closed = false; };
    const endRow = () => { endField(); if (row.some(cell => cell.trim())) rows.push({ line: rowLine, parts: row }); row = []; rowLine = line + 1; };
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (quoted) {
            if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
            else if (char === '"') { quoted = false; closed = true; }
            else { field += char; if (char === '\n') line++; }
        } else if (char === '"' && field === '' && !closed) quoted = true;
        else if (char === '\t') endField();
        else if (char === '\r' || char === '\n') {
            if (char === '\r' && text[i + 1] === '\n') i++;
            endRow(); line++;
        } else {
            if (closed) throw new Error(`Dòng ${line}: có ký tự sau dấu ngoặc kép đóng.`);
            field += char;
        }
    }
    if (quoted) throw new Error(`Dòng ${rowLine}: thiếu dấu ngoặc kép đóng.`);
    if (field || row.length || closed) endRow();
    return rows;
}

function numeric(raw, name, fallback, min, max, integer = false) {
    if (raw === undefined || raw.trim() === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
        throw new Error(`${name} phải ${integer ? 'là số nguyên' : 'là số'} trong khoảng ${min}–${max}.`);
    }
    return value;
}

export function cardFromParts(parts) {
    const [english = '', vietnamese = ''] = parts;
    if (!english.trim() || !vietnamese.trim()) throw new Error('Thiếu từ tiếng Anh hoặc nghĩa tiếng Việt.');
    if (parts.some(field => field.length > 100000)) throw new Error('Một ô vượt quá 100.000 ký tự.');
    const status = parts[6]?.trim() || 'New';
    if (!['New', 'Learning', 'Mastered'].includes(status)) throw new Error('Trạng thái chỉ nhận New, Learning hoặc Mastered.');
    const starred = parts[5]?.trim().toLowerCase() || 'false';
    if (!['true', 'false', '1', '0'].includes(starred)) throw new Error('isStarred chỉ nhận true/false hoặc 1/0.');
    const card = {
        english: english.trim(), vietnamese: vietnamese.trim(), type: parts[2]?.trim() || '',
        pronunciation: parts[3]?.trim() || '', example: parts[4] || '', isStarred: ['true', '1'].includes(starred),
        srsStatus: status, srsDueDate: numeric(parts[7], 'Ngày đến hạn', null, 0, 8640000000000000),
        tags: [...new Set((parts[8] || '').split(',').map(tag => tag.trim()).filter(Boolean))],
        lapses: numeric(parts[9], 'Số lần quên', 0, 0, 100000000, true), isSuspended: false,
        srsInterval: numeric(parts[11], 'Khoảng ôn', 0, 0, 36500),
        srsEaseFactor: numeric(parts[12], 'Hệ số dễ', 2.5, 0.01, 10),
        difficulty: numeric(parts[13], 'Độ khó', undefined, 1, 10),
        stability: numeric(parts[14], 'Độ bền', undefined, 0.01, 36500),
        reps: numeric(parts[15], 'Số lượt nhớ', 0, 0, 100000000, true),
        learningStep: numeric(parts[16], 'Bước học', 0, 0, 100000000, true),
        lastReviewDate: numeric(parts[17], 'Ngày ôn gần nhất', undefined, 0, 8640000000000000),
        stabilityShort: numeric(parts[18], 'Độ bền ngắn hạn', undefined, 0.01, 36500),
    };
    ['notes', 'exampleMeaning', 'synonyms', 'antonyms', 'collocations'].forEach((field, i) => { card[field] = parts[19 + i] || ''; });
    if (status === 'New') card.srsDueDate = null;
    if (card.stability && card.stabilityShort > card.stability) throw new Error('Độ bền ngắn hạn không được lớn hơn độ bền dài hạn.');
    return card;
}

export function parseVocabularyTsv(text) {
    if (text.length > 10 * 1024 * 1024) throw new Error('Tệp quá lớn. Vui lòng chia thành các tệp dưới 10 MB.');
    const parsed = parseTsv(text);
    const header = parsed[0]?.parts.map(value => value.trim().toLowerCase());
    const hasHeader = header?.includes('english') && header?.includes('vietnamese');
    const errors = [], rows = [];
    const input = hasHeader ? parsed.slice(1) : parsed;
    if (input.length > 20000) throw new Error('Mỗi lần nhập tối đa 20.000 dòng.');
    for (const entry of input) {
        const parts = hasHeader ? VOCAB_COLUMNS.map(name => entry.parts[header.indexOf(name.toLowerCase())] || '') : [...entry.parts];
        // Files exported by the old application encoded line breaks as literal \n.
        if (hasHeader && header.length <= 19) parts[4] = (parts[4] || '').replace(/\\n/g, '\n');
        try { rows.push({ ...entry, parts, card: cardFromParts(parts) }); }
        catch (error) { errors.push({ line: entry.line, message: error.message }); }
    }
    return { rows, errors };
}

export function exportVocabularyTsv(vocabulary) {
    const quote = value => {
        const text = String(value ?? '');
        return /[\t\r\n"]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    };
    const rows = vocabulary.filter(card => !card.isDeleted).map(card => VOCAB_COLUMNS.map(name => {
        if (name === 'English') return card.english;
        if (name === 'Vietnamese') return card.vietnamese;
        if (name === 'Type') return card.type;
        if (name === 'Pronunciation') return card.pronunciation;
        if (name === 'Example') return card.example;
        if (name === 'Tags') return (card.tags || []).join(',');
        if (name === 'isSuspended') return false;
        if (name === 'srsStatus') return card.srsStatus || 'New';
        return card[name];
    }));
    return '\uFEFF' + [VOCAB_COLUMNS, ...rows].map(row => row.map(quote).join('\t')).join('\r\n');
}
