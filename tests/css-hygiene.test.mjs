// tests/css-hygiene.test.mjs — khoá kết quả T3.2 (giảm !important bằng layer)
// và T4.3 (safe-area ngang). Test chỉ đọc đúng các file CSS thật:
//   src/css/*.css + src/css/tokens/*.css
// Không quét đệ quy bừa để một thư mục copy lạ không thể làm sai số đếm.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const postcss = require('postcss');
const cssDir = path.join(root, 'src', 'css');

function cssFiles() {
    const top = fs.readdirSync(cssDir, { withFileTypes: true });
    const unexpectedDirs = top
        .filter((entry) => entry.isDirectory() && entry.name !== 'tokens')
        .map((entry) => entry.name);
    assert.deepEqual(unexpectedDirs, [], `src/css chỉ được có thư mục con "tokens", thấy: ${unexpectedDirs.join(', ')}`);

    const files = top
        .filter((entry) => entry.isFile() && entry.name.endsWith('.css'))
        .map((entry) => path.join(cssDir, entry.name));
    const tokensDir = path.join(cssDir, 'tokens');
    if (fs.existsSync(tokensDir)) {
        for (const entry of fs.readdirSync(tokensDir, { withFileTypes: true })) {
            if (entry.isFile() && entry.name.endsWith('.css')) files.push(path.join(tokensDir, entry.name));
        }
    }
    return files.sort();
}

const files = cssFiles();
const roots = files.map((file) => ({
    file,
    rel: path.relative(root, file).split(path.sep).join('/'),
    root: postcss.parse(fs.readFileSync(file, 'utf8'), { from: file }),
}));

function declarations() {
    const out = [];
    for (const { file, rel, root: ast } of roots) {
        ast.walkDecls((decl) => out.push({ file, rel, decl, rule: decl.parent }));
    }
    return out;
}

test('T3.2: ngưỡng !important không tăng lại (toàn src/css và style.css)', () => {
    const all = declarations();
    const important = all.filter(({ decl }) => decl.important);
    const styleCount = important.filter(({ rel }) => rel === 'src/css/style.css').length;

    // Đo sau T3.2: 286 toàn bộ, 188 trong style.css. DoD gốc là < 800;
    // test khoá chặt hơn ở đúng số hiện tại để không thể lặng lẽ tăng lại.
    assert.ok(important.length <= 800, `!important toàn src/css phải < 800, đang ${important.length}`);
    assert.ok(important.length <= 286, `!important toàn src/css đã tăng: ${important.length} > 286`);
    assert.ok(styleCount <= 188, `!important trong style.css đã tăng: ${styleCount} > 188`);
    assert.ok(fs.existsSync(path.join(cssDir, 'style.css')), 'thiếu src/css/style.css');
    assert.equal(fs.existsSync(path.join(cssDir, 'css')), false, 'không được có bản copy lạ src/css/css');
});

const CLEAN_CLUSTERS = [
    {
        name: 'header brand',
        selector: /\.brand-(?:container|title-wrap|title|title-row|text-block|logo-pod)|\.app-logo-mark/,
    },
    { name: 'header divider', selector: /\.header-divider/ },
    {
        name: 'status dock chips',
        selector: /\.dock-chips-row|\.stat-chip|\.chip-(?:mastered|due|learning|new)|\.chip-icon-box/,
    },
    {
        name: 'FusionSRS analytics',
        selector: /\.analytics-(?:item|label|value|subtext|meter-bar|card-header)|\.fusionsrs-metric-card/,
    },
    {
        name: 'data/IO cards',
        selector: /\.io-(?:clean-card|card-header|card-icon|card-titles|card-title|card-desc|card-actions|action-btn)/,
    },
    {
        name: 'sync cards',
        selector: /\.sync-(?:box-card|box-header|box-label|box-hint|input-pill|action-btn|input-button-group)/,
    },
    {
        name: 'word card content',
        selector: /\.word-card-(?:header|title-group|footer|tags)|\.word-english|\.word-pronunciation/,
    },
    {
        name: 'empty onboarding',
        selector: /\.onboarding-|\.celestial-onboarding-container/,
    },
    {
        name: 'dock meta & segmented progress',
        selector: /\.dock-meta-row|\.meta-pill|\.segmented-progress/,
    },
    {
        name: 'quiz results',
        selector: /quiz-results|results-(?:score|correct|incorrect|speed)|score-circle|quiz-tier/,
    },
];

test('T3.2: 10 cụm đã dọn không còn !important', () => {
    const byCluster = new Map(CLEAN_CLUSTERS.map((cluster) => [cluster.name, []]));
    for (const { rel, decl, rule } of declarations()) {
        if (!decl.important) continue;
        const selector = String(rule.selector || '');
        for (const cluster of CLEAN_CLUSTERS) {
            if (cluster.selector.test(selector)) byCluster.get(cluster.name).push(`${rel}: ${selector} { ${decl.prop} }`);
        }
    }
    for (const [name, hits] of byCluster) {
        assert.deepEqual(hits, [], `cụm "${name}" còn !important:\n${hits.slice(0, 6).join('\n')}`);
    }
});

test('T4.3: env(safe-area-inset-*) đúng cú pháp, có trái/phải trong landscape', () => {
    const safeNames = new Set(['safe-area-inset-top', 'safe-area-inset-right', 'safe-area-inset-bottom', 'safe-area-inset-left']);
    const envCalls = [];
    for (const { rel, decl } of declarations()) {
        const value = String(decl.value || '');
        const opens = (value.match(/\benv\s*\(/g) || []).length;
        const calls = [...value.matchAll(/\benv\s*\(([^()]*)\)/g)];
        assert.equal(calls.length, opens, `${rel}: ${decl.prop} có env() thiếu ngoặc/không đọc được: ${value}`);
        for (const match of calls) {
            const arg = match[1].trim();
            if (!arg.startsWith('safe-area')) continue;
            const [name, ...fallbackParts] = arg.split(',').map((part) => part.trim());
            assert.ok(safeNames.has(name), `${rel}: tên safe-area sai cú pháp "${name}" trong ${value}`);
            if (fallbackParts.length) {
                assert.ok(fallbackParts.every(Boolean), `${rel}: fallback env() rỗng trong ${value}`);
            }
            envCalls.push({ rel, name, value });
        }
    }

    const names = new Set(envCalls.map((call) => call.name));
    assert.ok(names.has('safe-area-inset-left'), 'phải có env(safe-area-inset-left)');
    assert.ok(names.has('safe-area-inset-right'), 'phải có env(safe-area-inset-right)');
    assert.ok(names.has('safe-area-inset-bottom'), 'phải giữ env(safe-area-inset-bottom) cũ');

    const styleAst = roots.find(({ rel }) => rel === 'src/css/style.css').root;
    const safeLayer = styleAst.nodes.find((node) => node.type === 'atrule' && node.name === 'layer' && node.params.trim() === 'safe-area');
    assert.ok(safeLayer, 'thiếu @layer safe-area trong style.css');
    const safeSelectors = [];
    let hasLandscape = false;
    safeLayer.walkAtRules('media', (atRule) => {
        if (/orientation\s*:\s*landscape/.test(atRule.params)) hasLandscape = true;
    });
    safeLayer.walkRules((rule) => safeSelectors.push(rule.selector.replace(/\s+/g, ' ')));
    assert.ok(hasLandscape, '@layer safe-area phải có @media (orientation: landscape)');
    assert.ok(safeSelectors.some((selector) => /\bbody\b/.test(selector)), 'body padding phải bù safe-area cho header/app');
    assert.ok(safeSelectors.some((selector) => /\.modal\b/.test(selector)), 'modal phải có guard safe-area trái/phải');
    assert.ok(safeSelectors.some((selector) => /\.celestial-stats-dock\b/.test(selector)), 'dock phải có guard safe-area');

    // Bảo đảm quy ước layer được khai báo một lần, đúng thứ tự.
    const tokensAst = roots.find(({ rel }) => rel === 'src/css/tokens/celestial-v5.css').root;
    const layerStatement = tokensAst.nodes.find((node) => node.type === 'atrule' && node.name === 'layer' && !node.nodes);
    assert.ok(layerStatement, 'thiếu @layer base, overrides, safe-area; trong tokens');
    assert.match(layerStatement.params, /base\s*,\s*overrides\s*,\s*safe-area/);
});
