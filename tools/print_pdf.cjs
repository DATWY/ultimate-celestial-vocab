const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const htmlPath = path.resolve(__dirname, '..', 'BAO_CAO_DANH_GIA_VA_KHAC_PHUC_TOAN_DIEN.html');
const pdfPath = path.resolve(__dirname, '..', 'BAO_CAO_DANH_GIA_VA_KHAC_PHUC_TOAN_DIEN.pdf');

console.log('Generating PDF from:', htmlPath);
console.log('Target PDF:', pdfPath);

const cmd = `"${chromePath}" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="${pdfPath}" "file:///${htmlPath.replace(/\\/g, '/')}"`;
execSync(cmd, { stdio: 'inherit' });

if (fs.existsSync(pdfPath)) {
  const stat = fs.statSync(pdfPath);
  console.log(`SUCCESS: PDF generated successfully (${(stat.size / 1024).toFixed(1)} KB)`);
} else {
  console.error('ERROR: PDF file not found after Chrome execution.');
}
