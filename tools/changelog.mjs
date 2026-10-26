// tools/changelog.mjs — sinh CHANGELOG.md từ git log (không phụ thuộc thư viện ngoài).
// Dùng: node tools/changelog.mjs [--from <ref>]   (mặc định: tag nâng cấp gần nhất hoặc toàn bộ)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const args = process.argv.slice(2);
const fromIdx = args.indexOf('--from');
const from = fromIdx >= 0 ? args[fromIdx + 1] : null;

function git(cmdArgs) {
    return execFileSync('git', cmdArgs, { encoding: 'utf8' }).trimEnd();
}

// commit dạng: <sha>\x1f<ISO date>\x1f<subject>\x1f<body>
const SEP = '\x1f';
const REC = '\x1e';
const range = from ? `${from}..HEAD` : 'HEAD';
const raw = git(['log', range, `--pretty=format:%h${SEP}%ad${SEP}%s${SEP}%b${REC}`, '--date=short']);
const commits = raw.split(REC).map(s => s.trim()).filter(Boolean).map(rec => {
    const [sha, date, subject, body = ''] = rec.split(SEP);
    // Một số commit message cũ bị dính BOM (do `Set-Content -Encoding utf8` trên PowerShell 5.1)
    // → phải bỏ ký tự U+FEFF ở đầu, nếu không regex conventional commits sẽ trượt.
    const clean = (str = '') => str.replace(/^\uFEFF/, '').trim();
    const subj = clean(subject);
    const m = /^(\w+)(?:\(([^)]+)\))?!?:\s*(.*)$/s.exec(subj);
    return {
        sha, date, subject: subj,
        type: m ? m[1].toLowerCase() : 'other',
        scope: m ? (m[2] || '') : '',
        title: m ? m[3] : subj,
        body: (body || '').split('\n').map(l => clean(l)).filter(Boolean)
    };
});

const GROUPS = [
    ['feat', 'Tính năng'],
    ['fix', 'Sửa lỗi'],
    ['perf', 'Hiệu năng'],
    ['refactor', 'Tái cấu trúc'],
    ['docs', 'Tài liệu'],
    ['test', 'Kiểm thử'],
    ['chore', 'Khác'],
    ['other', 'Không theo conventional commits']
];

const total = commits.length;
const byType = new Map(GROUPS.map(([t]) => [t, []]));
for (const c of commits) (byType.get(c.type) || byType.get('other')).push(c);

const dates = commits.map(c => c.date).sort();
const span = dates.length ? `${dates[0]} → ${dates[dates.length - 1]}` : '—';

let out = `# CHANGELOG\n\n`;
out += `> File này được **sinh tự động** từ git log bằng \`node tools/changelog.mjs\` — đừng sửa tay,\n`;
out += `> sửa commit message rồi chạy lại. Nhóm theo tiền tố conventional commits (\`feat:\`, \`fix:\`, …).\n\n`;
out += `- Phạm vi: ${from ? `\`${from}..HEAD\`` : 'toàn bộ lịch sử'}\n`;
out += `- Số commit: **${total}**\n`;
out += `- Khoảng thời gian: **${span}**\n`;
out += `- Sinh lúc: ${new Date().toISOString().slice(0, 10)}\n\n`;

for (const [type, label] of GROUPS) {
    const list = byType.get(type) || [];
    if (!list.length) continue;
    out += `## ${label} (${list.length})\n\n`;
    for (const c of list) {
        const scope = c.scope ? `**${c.scope}:** ` : '';
        out += `- ${scope}${c.title} — \`${c.sha}\` (${c.date})\n`;
        // 1-2 dòng đầu của body làm ngữ cảnh, cắt ngắn để file không phình
        const first = c.body.find(l => !l.startsWith('BREAKING'));
        if (first && first.length <= 160) out += `  ${first}\n`;
    }
    out += `\n`;
}

fs.writeFileSync('CHANGELOG.md', out, 'utf8');
console.log(`CHANGELOG.md: ${total} commit, ${span}`);
for (const [type, label] of GROUPS) {
    const n = (byType.get(type) || []).length;
    if (n) console.log(`  ${label}: ${n}`);
}
