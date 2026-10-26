#!/usr/bin/env node
// tools/bundle_budget.mjs — T3.5: cổng chặn bundle "tăng cân" trong CI
//
// Đọc dist/ ĐÃ BUILD SẴN (không tự build — CI chạy `npm run build` ngay trước),
// tính dung lượng thô + gzip của từng asset, in bảng và so với ngân sách khai
// báo ngay trong file này. Vượt ngưỡng ⇒ exit code 1 để CI đỏ.
//
// Cách dùng:
//   npm run budget
//
// Exit code:
//   0  mọi ngưỡng đều đạt
//   1  có ít nhất một ngưỡng bị vượt
//   2  không đọc được dist/ (chưa build) — KHÔNG tự build, chỉ báo cách sửa
//
// Đơn vị in ra là kB/MB THẬP PHÂN (1 kB = 1000 B) để khớp với log của Vite
// (`index-*.js 240.55 kB │ gzip: 78.06 kB`). Gzip dùng zlib mức mặc định (6) —
// đúng mức Vite dùng khi in "gzip:", nên số trong báo cáo và số ở đây trùng khớp.
//
// Ngân sách đặt theo số đo hiện tại +5% (đo trên dist ngày 2026-10-26):
//   entry gzip 78.06 kB → 82 kB | firebase gzip 113.69 kB → 120 kB
//   toàn bộ dist 2.49 MB → 2.7 MB | CSS Vite 325.60 kB → 350 kB
// KHÔNG nới ngưỡng cho vừa số đo. Muốn tăng ngân sách thì phải sửa file này
// trong một commit riêng nêu rõ lý do (thêm tính năng, thêm thư viện…).

import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST_DIR = 'dist';

// ─── NGÂN SÁCH (byte) ────────────────────────────────────────────────────────
const BUDGET = {
    entryGzip: 82_000,     // chunk entry (assets/index-*.js) sau gzip
    firebaseGzip: 120_000, // chunk firebase lớn nhất sau gzip
    cssTotal: 350_000,     // tổng CSS do Vite sinh ra (assets/*.css), dung lượng thô
    distTotal: 2_700_000,  // tổng TOÀN BỘ file trong dist/, dung lượng thô
};

// ─── Helpers ────────────────────────────────────────────────────────────────
const kB = (bytes) => bytes / 1000;
const fmtKb = (bytes) => kB(bytes).toFixed(2);

function walk(dir) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (entry.isFile()) out.push(full);
    }
    return out;
}

function fail(message) {
    console.error(`\n[LOI] ${message}`);
    process.exit(2);
}

// ─── 0. Kiểm tra dist/ có sẵn sàng không ────────────────────────────────────
if (!existsSync(DIST_DIR) || !statSync(DIST_DIR).isDirectory()) {
    fail(`Không tìm thấy thư mục "${DIST_DIR}/".\n` +
        '     Công cụ này KHÔNG tự build. Hãy chạy:\n' +
        '         npm run build\n' +
        '     rồi chạy lại:\n' +
        '         npm run budget');
}

const indexPath = join(DIST_DIR, 'index.html');
if (!existsSync(indexPath)) {
    fail(`"${DIST_DIR}/" không có index.html — có vẻ đây không phải output của Vite.\n` +
        '     Hãy chạy "npm run build" rồi thử lại.');
}

// ─── 1. Thu thập số đo ──────────────────────────────────────────────────────
const files = walk(DIST_DIR).map((path) => {
    const buf = readFileSync(path);
    return {
        path: path.split('\\').join('/'),
        name: basename(path),
        ext: extname(path).toLowerCase(),
        raw: buf.length,
        gzip: gzipSync(buf).length, // mức mặc định 6 — cùng mức Vite dùng
    };
}).sort((a, b) => b.raw - a.raw);

const assetFiles = files.filter((f) => f.path.startsWith(`${DIST_DIR}/assets/`));
if (assetFiles.length === 0) {
    fail(`"${DIST_DIR}/assets/" rỗng — build chưa hoàn tất. Hãy chạy lại "npm run build".`);
}

// Entry = script module mà index.html nạp. Fallback: index-*.js lớn nhất.
function detectEntry() {
    const html = readFileSync(indexPath, 'utf8');
    const scriptTags = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+\.js)"[^>]*>/gi)];
    const moduleTag = scriptTags.find((m) => /\btype="module"/i.test(m[0])) || scriptTags[0];
    if (moduleTag) {
        const src = moduleTag[1].replace(/^\.?\//, '');
        const found = files.find((f) => f.path === `${DIST_DIR}/${src}` || f.path.endsWith(`/${basename(src)}`));
        if (found) return found;
    }
    const candidates = assetFiles.filter((f) => /^index-.*\.js$/.test(f.name));
    return candidates.sort((a, b) => b.raw - a.raw)[0] || null;
}

const entry = detectEntry();
if (!entry) fail('Không xác định được chunk entry (index.html không trỏ tới JS nào trong dist/assets).');

const firebaseChunks = assetFiles.filter((f) => /^firebase-.*\.js$/.test(f.name));
const firebaseMain = firebaseChunks.sort((a, b) => b.raw - a.raw)[0] || null;
if (!firebaseMain) fail('Không tìm thấy chunk firebase-*.js trong dist/assets — kiểm tra lại vite.config.js?');

// CSS do Vite sinh ra. CSS copy tay từ public/ (vd phosphor-subset.css ở gốc dist)
// KHÔNG tính vào ngân sách này vì nó không đi qua pipeline của Vite — vẫn in ra
// ở bảng file để thấy đủ.
const cssAssets = assetFiles.filter((f) => f.ext === '.css');
const cssAssetsTotal = cssAssets.reduce((sum, f) => sum + f.raw, 0);
const cssEverythingTotal = files.filter((f) => f.ext === '.css').reduce((sum, f) => sum + f.raw, 0);

const totalRaw = files.reduce((sum, f) => sum + f.raw, 0);
const totalGzip = files.reduce((sum, f) => sum + f.gzip, 0);

// ─── 2. In bảng file ────────────────────────────────────────────────────────
const padStart = (s, n) => String(s).padStart(n);
const padEnd = (s, n) => String(s).padEnd(n);

console.log('\n=== NGÂN SÁCH BUNDLE — ' + DIST_DIR + '/ (' + files.length + ' file) ===\n');
console.log(`${padEnd('FILE', 46)}${padStart('RAW kB', 10)}${padStart('GZIP kB', 10)}${padStart('GZIP %', 8)}`);
console.log('-'.repeat(74));
for (const f of files) {
    const ratio = f.raw > 0 ? (f.gzip / f.raw) * 100 : 0;
    console.log(`${padEnd(f.path.slice(0, 45), 46)}${padStart(fmtKb(f.raw), 10)}${padStart(fmtKb(f.gzip), 10)}${padStart(ratio.toFixed(1) + '%', 8)}`);
}
console.log('-'.repeat(74));
console.log(`${padEnd('TỔNG CỘNG', 46)}${padStart(fmtKb(totalRaw), 10)}${padStart(fmtKb(totalGzip), 10)}${padStart(((totalGzip / totalRaw) * 100).toFixed(1) + '%', 8)}`);

// ─── 3. So ngưỡng ──────────────────────────────────────────────────────────
const cssChunkGzip = cssAssets.reduce((sum, f) => sum + f.gzip, 0);

const checks = [
    {
        label: `Entry gzip (${entry.name})`,
        value: entry.gzip,
        budget: BUDGET.entryGzip,
        unit: 'gzip',
    },
    {
        label: `Firebase chunk gzip (${firebaseMain.name})`,
        value: firebaseMain.gzip,
        budget: BUDGET.firebaseGzip,
        unit: 'gzip',
    },
    {
        label: `CSS do Vite sinh (assets/*.css, ${cssAssets.length} file)`,
        value: cssAssetsTotal,
        budget: BUDGET.cssTotal,
        unit: 'raw',
    },
    {
        label: `Toàn bộ dist (${files.length} file)`,
        value: totalRaw,
        budget: BUDGET.distTotal,
        unit: 'raw',
    },
];

console.log('\n--- TÓM TẮT NHÓM ---');
console.log(`  Entry          : ${padStart(fmtKb(entry.raw), 9)} kB raw | ${padStart(fmtKb(entry.gzip), 8)} kB gzip`);
console.log(`  Firebase chunk : ${padStart(fmtKb(firebaseMain.raw), 9)} kB raw | ${padStart(fmtKb(firebaseMain.gzip), 8)} kB gzip` +
    (firebaseChunks.length > 1 ? `  (+${firebaseChunks.length - 1} chunk firebase nhỏ khác)` : ''));
console.log(`  CSS Vite       : ${padStart(fmtKb(cssAssetsTotal), 9)} kB raw | ${padStart(fmtKb(cssChunkGzip), 8)} kB gzip`);
console.log(`  Toàn bộ dist   : ${padStart(fmtKb(totalRaw), 9)} kB raw | ${padStart(fmtKb(totalGzip), 8)} kB gzip`);

console.log('\n--- SO NGƯỠNG ---');
let failed = false;
for (const c of checks) {
    const used = (c.value / c.budget) * 100;
    const headroom = c.budget - c.value;
    const ok = c.value <= c.budget;
    if (!ok) failed = true;
    const mark = ok ? '[OK]  ' : '[FAIL]';
    const note = ok
        ? `còn ${fmtKb(headroom)} kB (dùng ${used.toFixed(1)}%)`
        : `VƯỢT ${fmtKb(-headroom)} kB (dùng ${used.toFixed(1)}%)`;
    console.log(`${mark} ${padEnd(c.label, 44)} ${padStart(fmtKb(c.value), 9)} kB ${c.unit === 'gzip' ? 'gzip' : 'raw '} ≤ ${padStart(fmtKb(c.budget), 9)} kB  — ${note}`);
}

// Ghi chú minh bạch: CSS copy tay từ public/ không thuộc pipeline của Vite.
if (cssEverythingTotal !== cssAssetsTotal) {
    console.log(`\n  Ghi chú: mọi file .css trong dist/ (gồm CSS copy từ public/) = ${fmtKb(cssEverythingTotal)} kB;` +
        `\n  ngân sách CSS ở trên chỉ tính ${cssAssetsTotal / 1000} kB do Vite sinh ra trong dist/assets/.`);
}

// Cảnh báo dist cũ (không ảnh hưởng exit code): CI luôn build ngay trước khi đo.
try {
    const distTime = statSync(indexPath).mtimeMs;
    const srcFiles = walk('src');
    const newestSrc = Math.max(...srcFiles.map((p) => statSync(p).mtimeMs));
    if (newestSrc > distTime) {
        console.log(`\n  [CANH BAO] dist/ cũ hơn src/ (${new Date(distTime).toLocaleString('vi-VN')} < ` +
            `${new Date(newestSrc).toLocaleString('vi-VN')}). Số đo dưới đây KHÔNG phản ánh code hiện tại — hãy "npm run build" lại.`);
    }
} catch { /* cảnh báo là tuỳ chọn, bỏ qua lỗi đọc mtime */ }

console.log('');
if (failed) {
    console.error('[KET LUAN] VƯỢT NGÂN SÁCH — hãy giảm bundle hoặc sửa ngưỡng trong tools/bundle_budget.mjs (kèm lý do).\n');
    process.exit(1);
}
console.log('[KET LUAN] Tất cả ngưỡng đều đạt.\n');
process.exit(0);
