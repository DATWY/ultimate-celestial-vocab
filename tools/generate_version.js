import fs from 'fs';
import path from 'path';

// Đọc số thứ tự từ file cấu hình version_seq.json (nếu có, mặc định là 1)
const seqFile = path.resolve('version_seq.json');
let seq = 1;
if (fs.existsSync(seqFile)) {
  try {
    const data = JSON.parse(fs.readFileSync(seqFile, 'utf8'));
    if (typeof data.seq === 'number') seq = data.seq;
  } catch (e) {}
}

// Kiểm tra tham số dòng lệnh nếu người dùng muốn tăng số thứ tự: --bump hoặc --seq N
const args = process.argv.slice(2);
if (args.includes('--bump')) {
  seq += 1;
}
const seqIdx = args.indexOf('--seq');
if (seqIdx !== -1 && args[seqIdx + 1]) {
  const customSeq = parseInt(args[seqIdx + 1], 10);
  if (!isNaN(customSeq)) seq = customSeq;
}

// Lưu lại seq
fs.writeFileSync(seqFile, JSON.stringify({ seq }, null, 2), 'utf8');

// Định dạng yymmdd.hh theo múi giờ địa phương (GMT+7 Việt Nam)
const now = new Date();
// Chuyển đổi sang múi giờ VN (Asia/Ho_Chi_Minh) nếu môi trường khác múi giờ
const vnDateStr = now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' });
const vnDate = new Date(vnDateStr);

const yy = String(vnDate.getFullYear()).slice(-2);
const mm = String(vnDate.getMonth() + 1).padStart(2, '0');
const dd = String(vnDate.getDate()).padStart(2, '0');
const hh = String(vnDate.getHours()).padStart(2, '0');

const versionString = `DATWY.V${seq}.${yy}${mm}${dd}.${hh}`;
const isoTimestamp = now.toISOString();

console.log(`\n======================================================`);
console.log(`🚀 CELESTIAL VERSION GENERATOR: ${versionString}`);
console.log(`📅 Timestamp: ${isoTimestamp}`);
console.log(`======================================================\n`);

// 1. Ghi ra public/version.json để client fetch kiểm tra từ xa
const publicDir = path.resolve('public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}
const versionJsonPath = path.join(publicDir, 'version.json');
fs.writeFileSync(versionJsonPath, JSON.stringify({
  version: versionString,
  seq,
  buildTime: isoTimestamp
}, null, 2), 'utf8');

// 2. Ghi ra src/core/version.js để client import trực tiếp vào bundle
const versionJsPath = path.resolve('src/core/version.js');
const jsContent = `// Tự động tạo bởi tools/generate_version.js - KHÔNG SỬA THỦ CÔNG
export const APP_VERSION = '${versionString}';
export const APP_VERSION_SEQ = ${seq};
export const BUILD_TIME = '${isoTimestamp}';
`;
fs.writeFileSync(versionJsPath, jsContent, 'utf8');

console.log(`✓ Đã tạo file ${versionJsonPath}`);
console.log(`✓ Đã tạo file ${versionJsPath}`);
