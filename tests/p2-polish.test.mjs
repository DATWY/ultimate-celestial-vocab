// tests/p2-polish.test.mjs — PHASE 3 (P2/P3).
//
// Các lỗi "nhỏ nhưng nhìn thấy" và các cặp logic lệch nhau:
//   1. quiz: animateNumber 1600ms ghi đè setTimeout 600ms ⇒ mất dấu "%".
//   2. dedup: -sion ⇢ -de (decision/decide…) không nhận ra; tỉ lệ phủ > 1.0.
//   3. training: gradient bằng 0 ở biên; dead zone 30–39 mẫu validation.
//   4. dock "Cần ôn" dùng predicate khác buildReviewQueue.
//   5. tooltip thanh tiến độ in số thực chưa làm tròn.
//   6. heatmap 3 khối × 4 tuần ⇒ hai khối cùng tháng trùng tiêu đề.
//   7. persistPendingIds gọi ở mọi lần enqueue (O(N²)).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDerivationalVariant, calculatePhraseOverlap } from '../src/core/dedup.js';
import { finiteDifferenceGradient } from '../src/core/srs/training.js';
import { isNaturallyDue } from '../src/core/queue.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const DAY = 86_400_000;

test('quiz: phần trăm dùng suffix của animateNumber, không vá sau 600ms', () => {
    const quiz = read('src/features/quiz.js');
    assert.match(
        quiz,
        /animateNumber\(pctValEl, scorePct, 1600, \{ suffix: '%' \}\)/,
        'phải truyền suffix cho animation (animation ghi đè text ở update/complete)'
    );
    assert.doesNotMatch(
        quiz,
        /setTimeout\(\(\) => \{ pctValEl\.textContent/,
        'không được vá "%" bằng setTimeout — nó bị animation ghi đè'
    );
});

test('dedup: nhận ra biến thể -sion ⇢ -de', () => {
    for (const [noun, verb] of [
        ['decision', 'decide'],
        ['division', 'divide'],
        ['conclusion', 'conclude'],
        ['explosion', 'explode'],
        ['invasion', 'invade']
    ]) {
        assert.equal(isDerivationalVariant(noun, verb), true, `${noun} ⇢ ${verb} phải là biến thể`);
    }
    // Không được nhận bừa hai từ không liên quan.
    assert.equal(isDerivationalVariant('television', 'telescope'), false);
    assert.equal(isDerivationalVariant('mission', 'mistake'), false);
});

test('dedup: tỉ lệ phủ cụm nghĩa không bao giờ vượt 1.0', () => {
    const overlap = calculatePhraseOverlap('a, b, c, d, e', 'a, b');
    assert.ok(overlap <= 1, `tỉ lệ phải ≤ 1.0, nhận ${overlap}`);
    assert.equal(overlap, 1);
});

test('training: gradient tại biên trên vẫn khác 0 (sai phân lùi)', () => {
    // Loss giảm khi tham số tăng: L(x) = x. Tại x = 1 không thể tiến, phải lùi.
    const gradAtBoundary = finiteDifferenceGradient(1, 1e-3, 1, x => x);
    assert.ok(Number.isFinite(gradAtBoundary));
    assert.ok(gradAtBoundary > 0, `gradient ở biên phải > 0, nhận ${gradAtBoundary}`);

    // Ở giữa khoảng thì vẫn là sai phân tiến, đúng dấu.
    assert.ok(Math.abs(finiteDifferenceGradient(0.5, 1e-3, 0.5, x => x) - 1) < 1e-6);
});

test('training: ngưỡng half-gain trùng ngưỡng validation (hết dead zone 30–39)', () => {
    const src = read('src/core/srs/training.js');
    assert.match(src, /baselineValidation\.count < 30/, 'cổng validation là 30');
    assert.match(
        src,
        /baselineLosses\.length >= 30/,
        'half-gain phải dùng CÙNG ngưỡng 30, nếu 40 thì dải 30–39 không bao giờ đánh giá được'
    );
    assert.doesNotMatch(src, /baselineLosses\.length >= 40/);
    // Chú thích phải khớp mã: losses thu theo TỪNG THẺ, không phải theo thời gian.
    assert.match(src, /hai nửa TẬP THẺ/);
});

test('dock "Cần ôn" dùng chung predicate với buildReviewQueue', () => {
    const render = read('src/ui/render.js');
    assert.match(render, /isNaturallyDue\(word, now\)/, 'render.js phải gọi predicate dùng chung');
    assert.doesNotMatch(
        render,
        /status === 'Mastered' \? word\.srsDueDate <= endOfDay/,
        'không được giữ bản predicate thứ hai'
    );

    const now = new Date(2026, 2, 12, 10, 0).getTime();
    const masteredReviewedToday = {
        srsStatus: 'Mastered',
        srsDueDate: now - DAY,
        lastReviewDate: now
    };
    assert.equal(
        isNaturallyDue(masteredReviewedToday, now),
        false,
        'Mastered vừa ôn hôm nay không được tính là cần ôn'
    );
    assert.equal(
        isNaturallyDue({ srsStatus: 'Mastered', srsDueDate: now - DAY, lastReviewDate: now - 3 * DAY }, now),
        true
    );
    assert.equal(isNaturallyDue({ srsStatus: 'Learning', srsDueDate: now + 10 * 60_000 }, now), false);
    assert.equal(isNaturallyDue({ srsStatus: 'Learning', srsDueDate: now - 1 }, now), true);
    assert.equal(isNaturallyDue({ srsStatus: 'New' }, now), true, 'thẻ mới (chưa có hạn) vẫn là đến hạn');
    assert.equal(isNaturallyDue({ isDeleted: true, srsStatus: 'New' }, now), false);
});

test('tooltip thanh tiến độ làm tròn 1 chữ số', () => {
    const render = read('src/ui/render.js');
    assert.match(render, /const pct1 = value => Math\.round\(value \* 10\) \/ 10;/);
    assert.match(render, /const pBarMastered = pct1\(masteredNonDue \/ baseCount \* 100\)/);
});

test('heatmap: hai khối cùng tháng được đánh dấu "(tiếp)" + tooltip khoảng ngày', () => {
    const src = read('src/features/gamification.js');
    assert.match(src, /let lastMonthLabel = ''/);
    assert.match(src, /\(tiếp\)/);
    assert.match(src, /fmtDayMonth\(blockStart\)/);
});

test('persistPendingIds không serialize cả hàng chờ ở mọi lần enqueue', () => {
    const src = read('src/core/sync.js');
    assert.match(src, /let _persistTimer = null/, 'phải có debounce');
    assert.match(src, /persistPendingIds\(\{ immediate: true \}\)/, 'các mốc quan trọng ghi ngay');
    assert.match(src, /const _persistTimer = setTimeout\(flush, 500\)|_persistTimer = setTimeout\(flush, 500\)/);
});

test('P3: "Chân Dung Não Bộ" thật sự hiển thị (không còn là code chết)', () => {
    const html = read('index.html');
    const overviewAt = html.indexOf('id="profile-view-overview"');
    const personaAt = html.indexOf('id="profile-view-persona"');
    const wordsAt = html.indexOf('id="manage-view-words"');
    assert.ok(personaAt > 0, 'phải có pane #profile-view-persona');
    assert.ok(
        personaAt > overviewAt && personaAt < wordsAt,
        'pane phải nằm TRONG tab Tổng quan (không phải trong tab Dữ liệu bị ẩn)'
    );

    const src = read('src/features/gamification.js');
    assert.match(src, /renderFsrsPersonaTab\(\)/, 'renderGamificationUI phải gọi renderFsrsPersonaTab()');
});

test('P4: bareMinimumDays dùng currentLimit của DAILYSTATS (không phải gamification)', () => {
    const main = read('src/main.js');
    assert.match(main, /dailyStats: d/, 'phải đọc dailyStats từ state');
    assert.match(
        main,
        /rolloverDailyStats\(g\.stats, getLocalDateString\(\), d\?\.currentLimit \|\| 0\)/,
        'cap phải lấy từ dailyStats.currentLimit — gamification KHÔNG có trường này'
    );
    // Chỉ soi LỜI GỌI, không soi chú thích (chú thích có nhắc lại lỗi cũ).
    assert.doesNotMatch(
        main,
        /rolloverDailyStats\([^)]*g\.currentLimit/,
        'gamification không có currentLimit ⇒ cap luôn 0'
    );
});

test('P4: không còn dòng "void audioBtn" thừa trong events.js', () => {
    const events = read('src/events.js');
    assert.doesNotMatch(events, /^\s*void audioBtn;\s*$/m, 'audioBtn vẫn được dùng trong guard đầu hàm');
});

test('P4: "Chân Dung Não Bộ" không dựng lại DOM khi tab ẩn hoặc dữ liệu không đổi', () => {
    const wrap = read('src/features/gamification.js');
    assert.match(wrap, /panePersona\.offsetParent !== null/, 'phải kiểm tra tab đang hiện');
    assert.match(wrap, /dataset\.personaRendered/, 'phải nhớ đã dựng hay chưa');

    const persona = read('src/features/fsrsPersona.js');
    assert.match(persona, /dataset\.personaSig/, 'phải so chữ ký dữ liệu trước khi gán innerHTML');
});
