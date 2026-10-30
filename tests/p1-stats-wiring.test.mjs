// tests/p1-stats-wiring.test.mjs — chống tái phát GAME-01.
//
// Báo cáo kiểm toán phát hiện 33/80 huy hiệu đặc biệt KHÔNG BAO GIỜ mở được vì
// điều kiện đọc `s.<khoá>` mà không nơi nào ghi khoá đó. Test này khoá lại hợp
// đồng: mọi khoá stats mà badge-rules đọc đều phải có ít nhất một nơi GHI.
//
// Ba kiểu ghi được chấp nhận:
//   1. gán trực tiếp:  s.xpToday = … / stats.xpToday++ / g.xpToday += 1
//   2. qua trackEvent: trackEvent('manualWordsAdded')   (eventName → stats[eventName] +=)
//   3. qua stat-trackers: tên khoá nằm trong danh sách ensureStats (được trackXxx ghi)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : /\.js$/.test(entry.name) ? [full] : [];
    });
}

const srcFiles = walk(path.join(root, 'src')).map(abs => ({
    rel: path.relative(root, abs).replace(/\\/g, '/'),
    text: fs.readFileSync(abs, 'utf8')
}));
const rules = srcFiles.find(f => f.rel.endsWith('features/badge-rules.js')).text;
const trackers = srcFiles.find(f => f.rel.endsWith('features/stat-trackers.js')).text;

// Khoá stats được badge-rules ĐỌC.
const readKeys = new Set([...rules.matchAll(/\bs\.([A-Za-z_][A-Za-z0-9_]*)/g)].map(m => m[1]));

const writerPattern = key => new RegExp(`\\.\\s*${key}\\s*(?:\\+\\+|--|[-+*/]?=(?!=))`);
const eventPattern = key => new RegExp(`trackEvent\\(\\s*['"]${key}['"]`);

function hasWriter(key) {
    if (srcFiles.some(f => writerPattern(key).test(f.text))) return true;
    if (srcFiles.some(f => eventPattern(key).test(f.text))) return true;
    // stat-trackers: khoá nằm trong danh sách ensureStats ⇒ có trackXxx ghi giá trị.
    const listMatch = trackers.match(/for \(const key of \[([\s\S]*?)\]\) \{\s*if \(!Number\.isFinite/);
    if (listMatch && new RegExp(`['"]${key}['"]`).test(listMatch[1])) return true;
    return false;
}

test('mọi khoá stats badge-rules đọc đều có nơi GHI', () => {
    const orphans = [...readKeys].filter(key => !hasWriter(key)).sort();
    assert.deepEqual(
        orphans,
        [],
        `khoá stats chỉ được ĐỌC mà không ai ghi ⇒ huy hiệu tương ứng chết vĩnh viễn: ${orphans.join(', ')}`
    );
});

test('stat-trackers có mặt và được gọi từ các luồng thật', () => {
    assert.ok(trackers, 'phải tồn tại src/features/stat-trackers.js');
    const callSites = [
        'src/events.js',
        'src/core/state/gamification.js',
        'src/main.js',
        'src/ui/modal.js',
        'src/ui/render.js'
    ];
    for (const rel of callSites) {
        const file = srcFiles.find(f => f.rel === rel);
        assert.ok(file, `thiếu ${rel}`);
        assert.match(
            file.text,
            /track(Review|XP|HourBonus|WordAdded|Deletion|DarkMode|AppOpen|LevelUp|StreakLoss)/,
            `${rel} chưa nối bộ đếm nào`
        );
    }
});

test('ba huy hiệu từng sai điều kiện nay đọc đúng dữ liệu mới', () => {
    assert.match(rules, /giveUpCount/, 'special_give_up phải dùng giveUpCount (điều kiện cũ vô nghiệm)');
    // Chỉ soi DÒNG LUẬT, không soi chú thích (chú thích có nhắc lại điều kiện cũ).
    assert.doesNotMatch(
        rules,
        /case 'special_give_up'[^\n]*leechesHealed === -1/,
        'điều kiện "leechesHealed === -1" vẫn còn trong luật ⇒ huy hiệu vẫn chết'
    );
    assert.match(rules, /taggedCards >= 200/, 'special_tag_master phải khác special_chef');
    assert.match(rules, /forgottenAt > 0/, 'special_invincible không được mở miễn phí sau 30 ngày');
    assert.match(rules, /filter\(w => !w\.isDeleted\)/, 'special_nirvana phải bỏ thẻ đã xoá khỏi mẫu số');
});
