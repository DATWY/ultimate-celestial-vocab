import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignore = new Set(['fill', 'bold', 'duotone', 'thin', 'light', 'regular', 'spin']);

function collectIcons() {
    const files = [path.join(root, 'index.html')];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (/\.(js|css|html)$/i.test(entry.name)) files.push(full);
        }
    };
    walk(path.join(root, 'src'));
    const used = new Set();
    for (const file of files) {
        const text = fs.readFileSync(file, 'utf8');
        for (const match of text.matchAll(/(?<![\w-])ph-([a-z0-9-]+)\b/g)) {
            if (!ignore.has(match[1])) used.add(match[1]);
        }
    }
    return used;
}

test('every Phosphor icon used by the app exists in the local subset CSS', () => {
    const css = fs.readFileSync(path.join(root, 'public', 'phosphor-subset.css'), 'utf8');
    const icons = collectIcons();
    assert.ok(icons.size > 100, `expected a meaningful icon set, got ${icons.size}`);

    const weights = [
        { cls: '.ph', name: 'regular' },
        { cls: '.ph-bold', name: 'bold' },
        { cls: '.ph-fill', name: 'fill' },
        { cls: '.ph-duotone', name: 'duotone' }
    ];
    const missing = [];
    for (const icon of icons) {
        for (const weight of weights) {
            // Selectors end with `:before` in every weight (duotone also adds :after).
            if (!css.includes(`${weight.cls}.ph-${icon}:before`)) {
                missing.push(`${weight.name}:${icon}`);
            }
        }
    }
    assert.deepEqual(missing, [], `missing icon glyphs (run: node tools/build-icon-subset.mjs):\n${missing.join('\n')}`);
});
