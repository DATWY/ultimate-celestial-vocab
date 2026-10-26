/**
 * Generate public/phosphor-subset.css + public/fonts/phosphor-<weight>.woff2
 * from the official Phosphor icon CSS.
 *
 * Why (T3.1): the 4 official stylesheets (regular/bold/fill/duotone) total
 * ~11.000 CSS rules, and the app only uses ~200 icon names. Every DOM insertion
 * (e.g. a page of 40 word cards) is matched against that whole rule set, which
 * shows up as "Recalculate Style" jank. Shipping a subset keeps the exact same
 * glyphs and classes, but cuts the rule set by ~80% and removes 4 cross-origin
 * requests.
 *
 * Two independent savings, both applied here:
 *   1. CSS  — only the @font-face/base-class/icon rules actually used.
 *   2. FONT — each .woff2 is re-subset (pyftsubset / fonttools) down to the
 *      exact codepoints referenced by that weight's kept rules. The full
 *      Phosphor font carries ~1.545 glyphs (duotone 3.027, two per icon); the
 *      app uses 198 (duotone 396). Result: 593.596 B of woff2 -> ~95.5 KB,
 *      with ZERO icons lost — no class had to be changed to another weight.
 *
 * Fonts are self-hosted: the official woff2 for each weight is downloaded once
 * into a temp cache (never into the repo) and the generated @font-face points
 * at /fonts/... so the app never depends on unpkg at runtime.
 *
 * Run: node tools/build-icon-subset.mjs
 * Requires: network (unpkg) + python fonttools (`pip install fonttools`).
 * If pyftsubset is missing the script still rewrites the CSS but leaves the
 * existing public/fonts/*.woff2 untouched (warns loudly).
 * The generated files are committed so normal builds need no network.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const ROOT = process.cwd();
const VERSION = '2.1.1';
const WEIGHTS = ['regular', 'bold', 'fill', 'duotone'];
const BASE_CLASS = { regular: '.ph', bold: '.ph-bold', fill: '.ph-fill', duotone: '.ph-duotone' };
const OUT = path.join(ROOT, 'public', 'phosphor-subset.css');
const FONTS_DIR = path.join(ROOT, 'public', 'fonts');
// Cache file gốc (full font) nằm ngoài repo để lần chạy sau có thể bổ sung icon
// mà không phải tải lại — và để public/fonts/ chỉ chứa bản đã subset.
const SRC_DIR = path.join(os.tmpdir(), 'celestial-phosphor-src');

function collectUsedIconNames() {
    const files = [path.join(ROOT, 'index.html')];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (/\.(js|css|html)$/i.test(entry.name)) files.push(full);
        }
    };
    walk(path.join(ROOT, 'src'));

    // (?<![\w-]) tránh bắt nhầm CSS custom property như --ph-duotone-opacity
    const regex = /(?<![\w-])ph-([a-z0-9-]+)\b/g;
    const ignored = new Set(['fill', 'bold', 'duotone', 'thin', 'light', 'regular', 'spin']);
    const used = new Set();
    for (const file of files) {
        const text = fs.readFileSync(file, 'utf8');
        for (const match of text.matchAll(regex)) {
            if (!ignored.has(match[1])) used.add(match[1]);
        }
    }
    return used;
}

/** Split a flat CSS file into top-level blocks: { selector, body } */
function parseBlocks(css) {
    const blocks = [];
    let i = 0;
    while (i < css.length) {
        const open = css.indexOf('{', i);
        if (open === -1) break;
        const selector = css.slice(i, open).trim();
        let depth = 1;
        let j = open + 1;
        while (j < css.length && depth > 0) {
            if (css[j] === '{') depth++;
            else if (css[j] === '}') depth--;
            j++;
        }
        const body = css.slice(open + 1, j - 1);
        if (selector) blocks.push({ selector, body });
        i = j;
    }
    return blocks;
}

/** Chạy pyftsubset; trả về {ok, error}. Thử binary trước, rồi `python -m fontTools.subset`. */
function runPyftsubset(src, dest, unicodes) {
    const args = [
        src,
        `--unicodes=${unicodes}`,
        `--output-file=${dest}`,
        '--flavor=woff2',
        '--notdef-glyph',
        '--notdef-outline',
        '--recommended-glyphs',
        '--name-IDs=*',
        '--name-legacy',
        '--name-languages=*'
    ];
    const attempts = [
        ['pyftsubset', args],
        ['pyftsubset.exe', args],
        [process.env.PYTHON || 'python', ['-m', 'fontTools.subset', ...args]]
    ];
    let lastErr = '';
    for (const [cmd, cmdArgs] of attempts) {
        const res = spawnSync(cmd, cmdArgs, { encoding: 'utf8' });
        if (res.error) { lastErr = `${cmd}: ${res.error.message}`; continue; }
        if (res.status === 0 && fs.existsSync(dest)) return { ok: true };
        lastErr = `${cmd} exited ${res.status}: ${(res.stderr || '').trim().split('\n')[0]}`;
    }
    return { ok: false, error: lastErr };
}

const used = collectUsedIconNames();
const sections = [];
/** codepoints (Set<int>) khai báo bởi các rule giữ lại, theo từng weight */
const codepointsByWeight = {};
let keptRules = 0;

for (const weight of WEIGHTS) {
    const cssUrl = `https://unpkg.com/@phosphor-icons/web@${VERSION}/src/${weight}/style.css`;
    const response = await fetch(cssUrl);
    if (!response.ok) throw new Error(`Cannot fetch ${cssUrl}: ${response.status}`);
    const css = await response.text();
    const blocks = parseBlocks(css);
    const baseClass = BASE_CLASS[weight];
    const iconRegex = new RegExp(`\\${baseClass}\\.ph-([a-z0-9-]+)(?::(?:before|after))?$`);

    const capWeight = weight[0].toUpperCase() + weight.slice(1);
    const family = weight === 'regular' ? 'Phosphor' : `Phosphor-${capWeight}`;
    const fontFile = weight === 'regular' ? 'Phosphor' : `Phosphor-${capWeight}`;
    const header = [`/* ${weight.toUpperCase()} */`];
    const iconRules = [];
    const codepoints = new Set();
    for (const block of blocks) {
        if (block.selector === '@font-face') {
            header.push(`@font-face {\n  font-family: "${family}";\n  src: url("/fonts/phosphor-${weight}.woff2") format("woff2");\n  font-weight: normal;\n  font-style: normal;\n  font-display: block;\n}`);
            continue;
        }
        if (block.selector === baseClass) {
            header.push(`${block.selector} {${block.body}}`);
            continue;
        }
        const match = block.selector.match(iconRegex);
        if (match && used.has(match[1])) {
            iconRules.push(`${block.selector} {${block.body}}`);
            keptRules++;
            // Mọi codepoint mà CSS tham chiếu đều phải có trong font subset;
            // duotone dùng 2 codepoint/icon (:before = nền, :after = nét).
            for (const cp of block.body.matchAll(/content:\s*"\\([0-9a-f]{4,6})"/gi)) {
                codepoints.add(parseInt(cp[1], 16));
            }
        }
    }
    codepointsByWeight[weight] = codepoints;
    sections.push(header.join('\n') + '\n' + iconRules.join('\n'));
}

const banner = `/*! Phosphor ${VERSION} subset — auto-generated by tools/build-icon-subset.mjs.
 *  ${used.size} icon names × ${WEIGHTS.length} weights. Do not edit by hand. */\n`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, banner + sections.join('\n\n') + '\n');

// ---- Font bytes: tải bản full (cache ngoài repo) rồi subset đúng codepoint ----
fs.mkdirSync(FONTS_DIR, { recursive: true });
fs.mkdirSync(SRC_DIR, { recursive: true });
let beforeBytes = 0;
let afterBytes = 0;

for (const weight of WEIGHTS) {
    const dest = path.join(FONTS_DIR, `phosphor-${weight}.woff2`);
    const capWeight = weight[0].toUpperCase() + weight.slice(1);
    const fontName = weight === 'regular' ? 'Phosphor' : `Phosphor-${capWeight}`;
    const cached = path.join(SRC_DIR, `phosphor-${weight}-full.woff2`);

    if (!fs.existsSync(cached) || fs.statSync(cached).size < 1000) {
        const fontUrl = `https://unpkg.com/@phosphor-icons/web@${VERSION}/src/${weight}/${fontName}.woff2`;
        const fontRes = await fetch(fontUrl);
        if (!fontRes.ok) throw new Error(`Cannot fetch ${fontUrl}: ${fontRes.status}`);
        fs.writeFileSync(cached, Buffer.from(await fontRes.arrayBuffer()));
        console.log(`Downloaded ${fontUrl} -> cache ${path.relative(os.tmpdir(), cached)}`);
    }
    beforeBytes += fs.statSync(cached).size;

    const unicodes = [...codepointsByWeight[weight]].sort((a, b) => a - b)
        .map((cp) => `U+${cp.toString(16).toUpperCase()}`).join(',');
    const result = runPyftsubset(cached, dest, unicodes);
    if (!result.ok) {
        console.warn(`⚠ Không subset được phosphor-${weight}.woff2 (${result.error}).`);
        console.warn('  Giữ nguyên file hiện có trong public/fonts/. Cài fonttools: pip install fonttools');
        if (fs.existsSync(dest)) afterBytes += fs.statSync(dest).size;
    } else {
        const size = fs.statSync(dest).size;
        afterBytes += size;
        console.log(`subsets: phosphor-${weight}.woff2  ${codepointsByWeight[weight].size} codepoints  ${(size / 1024).toFixed(1)} KiB`);
    }
}

const kib = (n) => `${(n / 1024).toFixed(1)} KiB`;
console.log(`icons used: ${used.size}`);
console.log(`rules kept: ${keptRules}`);
console.log(`written: ${path.relative(ROOT, OUT)} (${kib(fs.statSync(OUT).size)})`);
if (beforeBytes && afterBytes) {
    console.log(`icon fonts: ${kib(beforeBytes)} (full) -> ${kib(afterBytes)} (subset), saved ${kib(beforeBytes - afterBytes)}`);
}
