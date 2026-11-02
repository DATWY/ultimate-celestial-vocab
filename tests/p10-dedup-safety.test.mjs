// tests/p10-dedup-safety.test.mjs — PHASE 10: hệ thống lọc trùng an toàn.
//
// Bối cảnh thật (ảnh người dùng gửi): bảng lọc trùng đề xuất gộp
//   Facilities ⟷ Facility, Advise ⟷ Advised, Leasing ⟷ Lease
// với nút duy nhất "Gộp 2 thẻ này". Đó là ba cặp BIẾN THỂ HÌNH THÁI / KHÁC NGHĨA,
// không phải trùng lặp: gộp sẽ xoá một dạng và trộn nghĩa khác vai trò ngữ pháp.
// Bộ test này khoá lại: phân loại đúng, chính sách gộp đúng, quyết định "giữ riêng"
// được nhớ, và UI không còn mời gộp biến thể bằng một cú bấm.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const { classifyDedupPair, dedupPairKey, selectAutoMergePairs, mergeDuplicateCards } =
    await import('../src/core/dedup.js');

// localStorage giả để test phần "giữ riêng" chạy được ngoài trình duyệt
const mem = new Map();
globalThis.localStorage = {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: k => mem.delete(k),
    clear: () => mem.clear()
};
const prefs = await import('../src/core/dedup-preferences.js');

const card = (english, vietnamese, type = 'noun', id = english.toLowerCase()) => ({
    id,
    english,
    vietnamese,
    type,
    srsStatus: 'New',
    srsDueDate: null,
    srsInterval: 0,
    stability: 1,
    difficulty: 5,
    reps: 0,
    lapses: 0,
    learningStep: 0
});

// ── 1. Ba cặp THẬT từ ảnh: KHÔNG được phép gộp ───────────────────────────────
const REAL_VARIANT_PAIRS = [
    ['Facilities', 'Cơ sở vật chất, tiện nghi', 'Facility', 'Cơ sở vật chất, nhà máy'],
    ['Advise', 'Khuên bảo, tư vấn', 'Advised', 'Được khuyến nghị, tư vấn'],
    ['Leasing', 'Hoạt động cho thuê theo hợp đồng', 'Lease', 'Hợp đồng cho thuê']
];

for (const [engA, viA, engB, viB] of REAL_VARIANT_PAIRS) {
    test(`P10: "${engA} ⟷ ${engB}" phải có chính sách KHÔNG gộp`, () => {
        const a = card(engA, viA);
        const b = card(engB, viB);
        const result = classifyDedupPair(a, b);
        assert.equal(
            result.mergePolicy,
            'never',
            `${engA}⟷${engB} là biến thể hình thái ⇒ không được gộp (nhận: ${result.mergePolicy}, category ${result.category})`
        );
        if (result.isDuplicate) {
            assert.match(result.practiceNote, /Hai dạng|hai dạng/, 'phải giải thích cho người dùng vì sao giữ riêng');
        }
    });
}

// ── 2. Trùng thật vẫn gộp được ───────────────────────────────────────────────
test('P10: hai thẻ CÙNG từ, cùng nghĩa vẫn là "safe" để gộp', () => {
    const a = card('store', 'cửa hàng', 'noun', 'id-a');
    const b = card('store', 'cửa hàng', 'noun', 'id-b');
    const result = classifyDedupPair(a, b);
    assert.equal(result.isDuplicate, true);
    assert.equal(result.category, 'EXACT');
    assert.equal(result.mergePolicy, 'safe');
});

test('P10: đa nghĩa cùng mặt chữ (commission: hoa hồng vs hội đồng) không phải trùng', () => {
    const a = card('commission', 'hoa hồng', 'noun', 'id-a');
    const b = card('commission', 'hội đồng', 'noun', 'id-b');
    const result = classifyDedupPair(a, b);
    assert.equal(result.mergePolicy, 'never');
});

test('P10: lệch chính tả rõ ràng (demonstate/demonstrate) là "review", không tự gộp', () => {
    const a = card('demonstate', 'chứng minh, thị phạm', 'verb', 'id-a');
    const b = card('demonstrate', 'chứng minh, thị phạm', 'verb', 'id-b');
    const result = classifyDedupPair(a, b);
    if (result.isDuplicate) {
        assert.equal(result.mergePolicy, 'review', 'lệch chính tả phải để người xác nhận');
        assert.match(result.practiceNote, /chính tả/);
    } else {
        assert.equal(result.mergePolicy, 'never');
    }
});

// ── 3. Khoá cặp ổn định ──────────────────────────────────────────────────────
test('P10: dedupPairKey không phụ thuộc thứ tự và ổn định giữa các lần quét', () => {
    const a = card('Advise', 'x', 'verb', 'id-a');
    const b = card('Advised', 'y', 'verb', 'id-b');
    assert.equal(dedupPairKey(a, b), dedupPairKey(b, a));
    assert.equal(dedupPairKey(a, b), 'id-a|id-b');
    assert.equal(dedupPairKey({ english: 'A' }, { english: 'B' }), 'a|b', 'thiếu id thì dùng english');
});

// ── 4. Gộp hàng loạt không bao giờ chạm biến thể ─────────────────────────────
test('P10: selectAutoMergePairs chỉ đưa cặp EXACT vào rổ an toàn', () => {
    const exactA = card('store', 'cửa hàng', 'noun', 'e1');
    const exactB = card('store', 'cửa hàng', 'noun', 'e2');
    const varA = card('Advise', 'khuên bảo', 'verb', 'v1');
    const varB = card('Advised', 'được khuyến nghị', 'verb', 'v2');
    const pairs = [
        { cardA: exactA, cardB: exactB, confidence: 0.99, category: 'EXACT' },
        { cardA: varA, cardB: varB, confidence: 0.95, category: 'INFLECTION' }
    ];
    const { safe, review } = selectAutoMergePairs(pairs);
    assert.equal(safe.length, 1, 'chỉ 1 cặp an toàn');
    assert.equal(safe[0].category, 'EXACT');
    assert.equal(review.length, 1);
    assert.equal(review[0].category, 'INFLECTION');
});

// ── 5. Nhớ quyết định "giữ riêng" ────────────────────────────────────────────
test('P10: "giữ riêng" được lưu, đọc lại được, hoàn tác được', () => {
    mem.clear();
    const key = dedupPairKey(card('Advise', 'x', 'verb', 'id-a'), card('Advised', 'y', 'verb', 'id-b'));
    assert.equal(prefs.isKeptSeparate(key), false);
    assert.equal(prefs.keepPairSeparate(key), true);
    assert.equal(prefs.isKeptSeparate(key), true);
    assert.equal(prefs.keepPairsSeparate([key, 'x|y']), 1, 'chỉ thêm khoá mới');
    assert.equal(prefs.loadKeptSeparate().size, 2);
    assert.equal(prefs.restorePair(key), true);
    assert.equal(prefs.isKeptSeparate(key), false);
    prefs.clearKeptSeparate();
    assert.equal(prefs.loadKeptSeparate().size, 0);
});

test('P10: khoá rác bị từ chối, dữ liệu hỏng không làm sập app', () => {
    mem.clear();
    assert.equal(prefs.keepPairSeparate('khong-co-dau-pipe'), false);
    assert.equal(prefs.keepPairSeparate(null), false);
    mem.set('celestial_dedup_kept_separate', '{ hỏng json');
    assert.equal(prefs.loadKeptSeparate().size, 0, 'JSON hỏng ⇒ coi như rỗng, không ném lỗi');
    mem.set('celestial_dedup_kept_separate', '"không phải mảng"');
    assert.equal(prefs.loadKeptSeparate().size, 0);
});

test('P10: pruneKeptSeparate dọn khoá trỏ tới thẻ đã xoá', () => {
    mem.clear();
    prefs.keepPairsSeparate(['a|b', 'c|d']);
    assert.equal(prefs.pruneKeptSeparate(['a', 'b']), 1, 'x|y không còn thẻ nào tồn tại ⇒ dọn');
    assert.equal(prefs.loadKeptSeparate().size, 1);
});

// ── 6. Gộp biến thể (nếu người dùng vẫn cố) không được làm mất nghĩa ─────────
test('P10: nếu buộc gộp biến thể, nghĩa hai bên vẫn phải còn đủ', () => {
    const a = card('Advise', 'khuên bảo, tư vấn', 'verb', 'id-a');
    const b = card('Advised', 'được khuyến nghị, tư vấn', 'verb', 'id-b');
    const { mergedCard } = mergeDuplicateCards(a, b);
    assert.match(mergedCard.vietnamese, /khuên bảo/i);
    assert.match(mergedCard.vietnamese, /khuyến nghị/i);
    assert.ok(mergedCard.isLeech === false || mergedCard.isLeech === true);
});

// ── 7. UI: mặc định an toàn, hành động hàng loạt, không mời gộp bừa ──────────
test('P10 UI: biến thể có nút chính là "Giữ riêng", gộp phải qua cảnh báo', () => {
    const modal = read('src/ui/modal.js');
    assert.match(modal, /Giữ riêng \(2 từ khác nhau\)/, 'nút chính cho cặp không nên gộp');
    assert.match(modal, /force-merge-btn/, 'vẫn cho gộp nhưng là hành động phụ');
    assert.match(modal, /hai DẠNG của cùng một từ/, 'phải cảnh báo hậu quả trước khi gộp biến thể');
    assert.match(modal, /showConfirmation\(\s*[\s\S]{0,400}executeMergeSingle/, 'gộp biến thể phải qua xác nhận');
});

test('P10 UI: cặp đã "giữ riêng" không hiện lại, có đường hoàn tác', () => {
    const modal = read('src/ui/modal.js');
    assert.match(modal, /loadKeptSeparate\(\)/, 'phải đọc danh sách đã giữ riêng');
    assert.match(modal, /const actionable = dups\.filter\(d => !keptSeparate\.has\(d\.key\)\)/);
    assert.match(modal, /clearKeptSeparate\(\)/, 'phải có hoàn tác');
    assert.match(modal, /setReviewQueue|renderDedupPairs\(\);\s*\n\s*\}\);/, 'render lại sau khi đổi quyết định');
});

test('P10 UI: hàng hành động hàng loạt chỉ gộp cặp trùng thật', () => {
    const modal = read('src/ui/modal.js');
    assert.match(modal, /bulk-merge-exact-btn/, 'nút gộp hàng loạt');
    assert.match(modal, /filter\(d => d\.mergePolicy === 'safe'\)|mergeableCount/);
    assert.match(modal, /bulk-keep-variants-btn/, 'nút giữ riêng hàng loạt cho biến thể');
    assert.match(modal, /keepPairsSeparate\(/, 'giữ riêng hàng loạt dùng hàm batch');
});

test('P10 UI: hiển thị lý do + ghi chú sư phạm cho từng cặp', () => {
    const modal = read('src/ui/modal.js');
    assert.match(modal, /dedup-reason/, 'phải hiện reason');
    assert.match(modal, /dedup-practice-note/, 'phải hiện ghi chú vì sao giữ riêng');
    assert.match(modal, /dedup-policy-badge/, 'phải có nhãn chính sách gộp');
});

test('P10 CSS: có style cho nhãn chính sách, hành động và mobile 44px', () => {
    const css = read('src/css/style.css');
    for (const cls of [
        '.dedup-policy-badge',
        '.policy-safe',
        '.policy-review',
        '.policy-never',
        '.dedup-action-btn',
        '.dedup-bulk-row',
        '.dedup-practice-note',
        '.dedup-link-btn'
    ]) {
        assert.ok(css.includes(cls), 'thiếu CSS ' + cls);
    }
    assert.match(css, /\.dedup-action-btn\s*\{[\s\S]{0,200}min-height:\s*44px/, 'nút phải >= 44px');
});

// ── 8. Light mode: KHÔNG được viết màu chỉ cho dark ──────────────────────────
// Lỗi thật đã xảy ra: block CSS v1 chỉ có màu cho dark mode ⇒ ở light mode chữ
// hồng nhạt trên nền hồng nhạt (đo 1,28:1) và nút header trắng-trên-trắng (1,00:1).
// Nếu ai đó lại viết màu cứng không có biến thể light, test này phải đỏ.
test('P10 CSS LIGHT mode: mọi token phải có biến thể body.dark-mode', () => {
    const css = read('src/css/style.css');
    const start = css.indexOf('P10 DEDUP SAFETY');
    const end = css.indexOf('/P10 DEDUP SAFETY');
    assert.ok(start > 0 && end > start, 'phải có block P10');
    const block = css.slice(start, end);
    // Mọi biến --dd-* khai báo trong #dedup-modal phải được override trong body.dark-mode
    const lightVars = [...block.matchAll(/^\s{4}--(dd-[a-z-]+):/gm)].map(m => m[1]);
    assert.ok(lightVars.length >= 15, 'phải khai báo token cho light mode, đang ' + lightVars.length);
    const darkIdx = block.indexOf('body.dark-mode #dedup-modal');
    assert.ok(darkIdx > 0, 'phải có block dark-mode');
    const darkBlock = block.slice(darkIdx, block.indexOf('}', darkIdx));
    const missing = lightVars.filter(v => !darkBlock.includes('--' + v + ':'));
    assert.deepEqual(missing, [], 'token thiếu biến thể dark: ' + missing.join(', '));
});

test('P10 CSS: không còn màu chữ sáng cứng dùng chung cho cả 2 chế độ', () => {
    const css = read('src/css/style.css');
    const start = css.indexOf('P10 DEDUP SAFETY');
    const end = css.indexOf('/P10 DEDUP SAFETY');
    const full = css.slice(start, end);
    // Bỏ khối dark-mode ra khỏi vùng kiểm: màu pastel trong đó là HỢP LỆ.
    const darkStart = full.indexOf('body.dark-mode #dedup-modal');
    const darkEnd = darkStart >= 0 ? full.indexOf('}', darkStart) : -1;
    const block = darkStart >= 0 ? full.slice(0, darkStart) + full.slice(darkEnd) : full;
    // các màu pastel chỉ dùng được trên nền tối
    // Chỉ chặn việc DÙNG pastel làm MÀU CHỮ trực tiếp (viền/nền pastel là hợp lệ).
    for (const bad of ['#fbcfe8', '#f9d5e5', '#a5b4fc', '#86efac', '#fcd34d']) {
        const re = new RegExp('color:\\s*' + bad, 'gi');
        const hits = block.match(re) || [];
        assert.equal(hits.length, 0, 'dùng ' + bad + ' làm color: ngoài dark-mode ⇒ vô hình ở light mode');
    }
});

test('P10 UI: nhãn preview không nói "sau khi gộp" với cặp không nên gộp', () => {
    const modal = read('src/ui/modal.js');
    assert.match(modal, /item\.mergePolicy === 'never' \? 'Nếu gộp, nghĩa sẽ thành:'/, 'phải dùng nhãn có điều kiện');
});
