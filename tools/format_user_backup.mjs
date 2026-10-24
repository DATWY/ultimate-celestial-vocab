import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const step288Path = 'C:\\Users\\ASUS\\.gemini\\antigravity\\brain\\8c0155af-5ac4-4055-a70b-7222abf95287\\.system_generated\\steps\\288\\output.txt';
const step290Path = 'C:\\Users\\ASUS\\.gemini\\antigravity\\brain\\8c0155af-5ac4-4055-a70b-7222abf95287\\.system_generated\\steps\\290\\output.txt';

const targetDir = path.resolve('backups', 'celestial_user_data_backup');
fs.mkdirSync(targetDir, { recursive: true });

console.log('Reading extracted vocabulary from step 288...');
const rawVocabOutput = fs.readFileSync(step288Path, 'utf8');
// The output file contains "Script ran on page and returned:\n```json\n[...]```"
const jsonMatch = rawVocabOutput.match(/```json\s*([\s\S]*?)\s*```/) || [null, rawVocabOutput];
const vocabJsonStr = jsonMatch[1].trim();
const vocab = JSON.parse(vocabJsonStr);

console.log(`Successfully parsed ${vocab.length} vocabulary words!`);

// 1. Write vocabulary JSON
const vocabJsonPath = path.join(targetDir, 'vocabulary_3053_words.json');
fs.writeFileSync(vocabJsonPath, JSON.stringify(vocab, null, 2), 'utf8');
console.log(`Saved: ${vocabJsonPath} (${(fs.statSync(vocabJsonPath).size / 1024).toFixed(1)} KB)`);

// 2. Write vocabulary TSV (Compatible with Import/Export TSV feature of Celestial Vocab)
const headers = [
  'english', 'vietnamese', 'wordType', 'phonetic', 'example', 
  'srsStatus', 'srsInterval', 'srsDueDate', 'difficulty', 'stability', 
  'reps', 'lapses', 'tags'
];
const tsvRows = [headers.join('\t')];

for (const card of vocab) {
  const row = headers.map(key => {
    let val = card[key] ?? card[key === 'wordType' ? 'type' : ''] ?? '';
    if (Array.isArray(val)) val = val.join(',');
    return String(val).replace(/[\t\r\n]+/g, ' ');
  });
  tsvRows.push(row.join('\t'));
}

const vocabTsvPath = path.join(targetDir, 'vocabulary_3053_words.tsv');
fs.writeFileSync(vocabTsvPath, tsvRows.join('\n'), 'utf8');
console.log(`Saved: ${vocabTsvPath} (${(fs.statSync(vocabTsvPath).size / 1024).toFixed(1)} KB)`);

// 3. Write Settings
console.log('Reading settings from step 290...');
const rawSettingsOutput = fs.readFileSync(step290Path, 'utf8');
const settingsMatch = rawSettingsOutput.match(/```json\s*([\s\S]*?)\s*```/) || [null, rawSettingsOutput];
const settings = JSON.parse(settingsMatch[1].trim());

const settingsPath = path.join(targetDir, 'settings.json');
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
console.log(`Saved: ${settingsPath} (${settings.length} settings records)`);

// 4. Create README / Manifest
const readmeContent = `# BẢN SAO LƯU DỮ LIỆU TỪ VỰNG & TIẾN ĐỘ HỌC TẬP (LIVE DATA BACKUP)
Ngày sao lưu: ${new Date().toLocaleString('vi-VN')}
Số lượng từ vựng: ${vocab.length} thẻ
Phiên bản hệ thống: DATWY.V2.261023.23

DANH SÁCH TỆP:
1. vocabulary_3053_words.tsv: Tệp TSV chuẩn chứa đầy đủ 3.053 từ vựng cùng các thông số FSRS-7 (Stability, Difficulty, Interval, Reps, Tags, Ví dụ...). Có thể nạp lại trực tiếp qua tab "Nhập & Xuất" của ứng dụng bất cứ lúc nào.
2. vocabulary_3053_words.json: Toàn bộ dữ liệu raw của store 'vocabulary' từ IndexedDB.
3. settings.json: Cấu hình cá nhân, điểm XP, gamification, huy hiệu, streak từ store 'settings'.

HƯỚNG DẪN KHÔI PHỤC:
- Mở ứng dụng web (hoặc localhost) -> Vào "Celestial Hub" -> Tab "Dữ liệu (I/O)".
- Kéo thả tệp vocabulary_3053_words.tsv vào khung Dropzone hoặc nhấn "Nhập TSV".
- Toàn bộ 3.053 từ vựng và lịch ôn sẽ được nạp lại nguyên vẹn 100%!
`;
fs.writeFileSync(path.join(targetDir, 'README_RESTORE.txt'), readmeContent, 'utf8');

// 5. Zip the data backup folder
const zipDst = path.resolve('backups', 'celestial_user_data_backup_3053_words.zip');
execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${targetDir}\\*' -DestinationPath '${zipDst}' -CompressionLevel Optimal -Force"`, { stdio: 'inherit' });
console.log(`SUCCESS! Created standalone data zip: ${zipDst} (${(fs.statSync(zipDst).size / 1024).toFixed(1)} KB)`);
