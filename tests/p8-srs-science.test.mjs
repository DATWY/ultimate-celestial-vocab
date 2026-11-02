// tests/p8-srs-science.test.mjs — PHASE 8: 3 nâng cấp SRS theo khoa học trí nhớ.
//
// Bối cảnh: người dùng báo "đã trả lời đúng liên tiếp mà web vẫn hiện lại".
// Dữ liệu thật (2154 từ) cho thấy 3 nguồn: 13 nhóm thẻ trùng, 97 thẻ leech
// (62 tới hạn ngay), và bậc học 1 phút → 10 phút. Ba nâng cấp dưới đây nhắm
// đúng 3 nguồn đó, và mỗi kết luận đều phải đứng được trước phản biện khoa học
// (xem docs/SRS-KHOA-HOC.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const { mergeDuplicateCards } = await import('../src/core/dedup.js');
const { calculateNextSrsState } = await import('../src/core/srs/index.js');

const DAY = 86400000;
const now = Date.now();
const card = (over = {}) => ({
    id: 'c1',
    english: 'petition',
    vietnamese: 'đơn thỉnh cầu',
    srsStatus: 'Mastered',
    srsDueDate: now + 5 * DAY,
    srsInterval: 5,
    stability: 20,
    stabilityShort: 16,
    difficulty: 5,
    reps: 5,
    lapses: 0,
    learningStep: 2,
    lastReviewDate: now - 5 * DAY,
    srsUpdatedAt: now - 5 * DAY,
    updatedAt: now,
    contentUpdatedAt: now,
    ...over
});

// ─────────────────────────── A′: gộp thẻ trùng ──────────────────────────────
test('A′: gộp thẻ KHÔNG được nuốt số lần quên của bản phụ', () => {
    // Ca thật trong dữ liệu người dùng: một bản Mastered rất "khoẻ" + một bản
    // đã quên 3 lần. Bản cũ lấy nguyên thẻ chính ⇒ thẻ biến mất 2 tháng.
    const strong = card({ id: 'a', stability: 60, srsInterval: 60, srsDueDate: now + 60 * DAY, reps: 9, lapses: 0 });
    const weak = card({
        id: 'b',
        stability: 2,
        srsInterval: 2,
        srsDueDate: now + 2 * DAY,
        reps: 3,
        lapses: 3,
        srsStatus: 'Learning'
    });
    const { mergedCard } = mergeDuplicateCards(strong, weak);

    assert.equal(mergedCard.lapses, 3, 'lapses phải CỘNG (3), không được lấy 0 của bản khoẻ');
    assert.ok(mergedCard.stability <= 2 + 1e-9, `stability phải lấy MIN (≤2), đang ${mergedCard.stability}`);
    assert.ok(mergedCard.srsInterval <= 10, `đã từng quên ⇒ interval ≤ 10 ngày, đang ${mergedCard.srsInterval}`);
    assert.ok(mergedCard.srsDueDate <= now + 10 * DAY, 'hạn không được đẩy xa quá 10 ngày');
    assert.equal(mergedCard.srsStatus, 'Learning', 'có bản chưa Mastered ⇒ phải coi là còn phải học');
    assert.equal(mergedCard.isLeech, false, 'lapses 3 < 4 nên chưa phải leech');
});

test('A′: difficulty lấy MAX (khó hơn) và reps lấy MAX (không cộng dồn ảo)', () => {
    const a = card({ id: 'a', difficulty: 3, reps: 9 });
    const b = card({ id: 'b', difficulty: 8.5, reps: 4 });
    const { mergedCard } = mergeDuplicateCards(a, b);
    assert.equal(mergedCard.difficulty, 8.5, 'difficulty phải là MAX để không đánh giá thấp độ khó');
    assert.equal(mergedCard.reps, 9, 'reps phải là MAX, không phải tổng');
});

test('A′: hai bản Mastered khoẻ thì giữ nguyên hạn gần nhất, không tự kéo dài', () => {
    const a = card({ id: 'a', srsDueDate: now + 30 * DAY, srsInterval: 30, stability: 30 });
    const b = card({ id: 'b', srsDueDate: now + 4 * DAY, srsInterval: 4, stability: 25 });
    const { mergedCard } = mergeDuplicateCards(a, b);
    assert.ok(mergedCard.srsDueDate <= now + 4 * DAY, 'phải lấy hạn SỚM hơn');
    assert.ok(mergedCard.stability <= 25, 'stability phải lấy MIN');
    assert.equal(mergedCard.lapses, 0);
});

test('A′: gộp vẫn giữ nguyên nội dung (nghĩa, ví dụ, tags, sao)', () => {
    const a = card({ id: 'a', vietnamese: 'đơn thỉnh cầu', example: 'short', tags: ['law'], isStarred: false });
    const b = card({
        id: 'b',
        vietnamese: 'kiến nghị',
        example: 'a much longer example sentence',
        tags: ['legal'],
        isStarred: true
    });
    const { mergedCard, deletedCardId } = mergeDuplicateCards(a, b);
    // cleanAndDeduplicateVietnamese viết hoa chữ đầu của nghĩa thứ nhất ⇒ so khớp không phân biệt hoa/thường
    assert.match(mergedCard.vietnamese, /đơn thỉnh cầu/i);
    assert.match(mergedCard.vietnamese, /kiến nghị/i);
    assert.equal(mergedCard.example, 'a much longer example sentence');
    assert.deepEqual([...mergedCard.tags].sort(), ['law', 'legal']);
    assert.equal(mergedCard.isStarred, true);
    assert.ok(['a', 'b'].includes(deletedCardId) && deletedCardId !== mergedCard.id);
});

// ─────────────────────────── B′: chính sách leech ───────────────────────────
const leechCard = (over = {}) =>
    card({
        srsStatus: 'Learning',
        learningStep: 1,
        lapses: 4,
        reps: 4,
        stability: 0.7,
        stabilityShort: 0.5,
        difficulty: 9,
        ...over
    });

test('B′: leech sai lần đầu trong ngày → relearning 10 phút (không chôn)', () => {
    const { newState } = calculateNextSrsState(
        leechCard({ lapseDay: new Date(now).toDateString(), lapsesToday: 0 }),
        1,
        'en-vi'
    );
    assert.equal(newState.srsStatus, 'Learning');
    assert.ok(newState.srsDueDate - now <= 11 * 60000, 'phải hẹn lại ~10 phút');
    assert.equal(newState.lapsesToday, 1);
    assert.notEqual(newState.needsReformulation, true, 'lần đầu chưa cần gắn cờ viết lại');
});

test('B′: leech sai lần THỨ HAI trong cùng ngày → chôn tới sáng mai', () => {
    const today = new Date(now).toDateString();
    const { newState } = calculateNextSrsState(leechCard({ lapseDay: today, lapsesToday: 1 }), 1, 'en-vi');
    const dueInHours = (newState.srsDueDate - now) / 3600000;
    assert.ok(dueInHours >= 3, `phải chôn tới sáng mai (≥3h), đang ${dueInHours.toFixed(1)}h`);
    assert.ok(dueInHours <= 32, `không được chôn quá ~1.3 ngày, đang ${dueInHours.toFixed(1)}h`);
    assert.equal(newState.lapsesToday, 2);
    assert.equal(newState.needsReformulation, true, 'thẻ cần được viết lại (thêm mnemonic/tách thẻ)');
    assert.ok(newState.lapses >= 5, 'lapses vẫn phải tăng, không được giả vờ là thẻ mới');
});

test('B′: sang ngày mới thì bộ đếm sai-trong-ngày reset (không chôn oan)', () => {
    const yesterday = new Date(now - DAY).toDateString();
    const { newState } = calculateNextSrsState(leechCard({ lapseDay: yesterday, lapsesToday: 5 }), 1, 'en-vi');
    assert.equal(newState.lapsesToday, 1, 'ngày mới ⇒ đếm lại từ 1');
    assert.ok(newState.srsDueDate - now <= 11 * 60000, 'vẫn relearning 10 phút, không bị chôn');
});

test('B′: trả lời đúng thì cờ "cần viết lại" được gỡ', () => {
    const { newState } = calculateNextSrsState(
        leechCard({ needsReformulation: true, lapseDay: new Date(now).toDateString(), lapsesToday: 0 }),
        3,
        'en-vi'
    );
    assert.notEqual(newState.needsReformulation, true);
});

// ─────────────────────────── C′: "Dễ" không nhảy cóc ────────────────────────
test('C′: thẻ đã từng quên mà bấm Dễ → tốt nghiệp nhưng bị trần 10 ngày', () => {
    const { newState } = calculateNextSrsState(
        card({
            srsStatus: 'Learning',
            learningStep: 2,
            lapses: 1,
            reps: 6,
            stability: 300,
            stabilityShort: 900,
            difficulty: 3
        }),
        4,
        'en-vi'
    );
    assert.equal(newState.srsStatus, 'Mastered');
    assert.ok(newState.srsInterval <= 10, `interval phải ≤10 ngày, đang ${newState.srsInterval.toFixed(2)}`);
});

test('C′: thẻ mới tinh bấm Dễ vẫn bị trần tốt nghiệp 7 ngày như trước', () => {
    const { newState } = calculateNextSrsState(
        card({ srsStatus: 'Learning', learningStep: 2, lapses: 0, reps: 2 }),
        4,
        'en-vi'
    );
    assert.equal(newState.srsStatus, 'Mastered');
    assert.ok(newState.srsInterval <= 7 + 1e-9, `thẻ mới ≤7 ngày, đang ${newState.srsInterval.toFixed(2)}`);
});

test('C′: KHÔNG có đường tắt nào đưa thẻ chưa qua retrieval 1 ngày lên lịch dài', () => {
    // Quét: bất kỳ lần chấm nào của thẻ mới/learning đều không được vượt trần
    for (const rating of [1, 2, 3, 4]) {
        const { newState } = calculateNextSrsState(
            card({ srsStatus: 'New', learningStep: 0, reps: 0, lapses: 0, lastReviewDate: null }),
            rating,
            'en-vi'
        );
        assert.ok(
            newState.srsInterval <= 7 + 1e-9 || newState.srsStatus !== 'Mastered',
            `rating ${rating}: thẻ New không được tốt nghiệp quá 7 ngày (đang ${newState.srsInterval.toFixed(2)})`
        );
    }
});

// ─────────────────────── UI: sao vẫn chạy khi đang gõ ───────────────────────
test('UI: engine sao KHÔNG dừng vòng vẽ khi có input được focus', () => {
    const src = read('src/ui/celestial-canvas.js');
    // Lỗi cũ: setTypingActive(true) → stopAnimationLoop() ⇒ cả bầu trời đứng im
    assert.doesNotMatch(
        src,
        /export function setTypingActive\(active\) \{\s*isTypingActive = !!active;\s*if \(isTypingActive\) \{\s*stopAnimationLoop\(\);/,
        'setTypingActive không được dừng vòng vẽ nữa'
    );
    assert.match(src, /const TYPING_INTERVAL_DESKTOP_MS = 50;/, 'phải có nhịp riêng khi gõ (20 FPS)');
    assert.match(src, /const targetInterval = isTypingActive/, 'nhịp vẽ phải phụ thuộc trạng thái gõ');
    // Đang gõ không được coi là idle (nếu không, sau 1.2s vòng vẽ tự ngủ)
    assert.match(src, /const isIdle = !isTypingActive && timeSinceActivity > IDLE_TIMEOUT_MS;/);
    // Gõ phím phải được tính là hoạt động
    assert.match(
        src,
        /addEventListener\('keydown'[\s\S]{0,400}wakeAndRecordActivity\(\)/,
        'phím gõ phải đánh thức engine'
    );
    // Và phải có diagnostics để đo được (đã dùng cho probe)
    assert.match(src, /export function getCelestialDiagnostics\(\)/);
});

// ── B′ (PHASE 9): bề mặt hiển thị — nhãn + hành động, không chỉ chôn im lặng ──
test('B′: badge đổi thành "Cần Viết Lại" khi thẻ vừa bị hoãn', () => {
    const render = read('src/ui/render.js');
    assert.match(render, /cardData\.needsReformulation === true/, 'badge phải đọc cờ needsReformulation');
    assert.match(render, /'Cần Viết Lại' : 'Cực Khó'/, 'phải đổi nhãn theo trạng thái');
    assert.match(render, /needs-rewrite/, 'phải có class riêng để khác sắc thái');
    assert.match(render, /VIẾT LẠI thẻ/, 'title phải nói việc cần làm (viết lại thẻ)');
});

test('B′: khi thẻ bị hoãn phải có toast giải thích, không im lặng', () => {
    const events = read('src/events.js');
    assert.match(events, /updatedCard\.needsReformulation && updatedCard\.buriedOn/, 'phải phát hiện thẻ vừa bị hoãn');
    assert.match(events, /buriedOn !== previousCard\.buriedOn/, 'chỉ báo MỘT lần cho mỗi lần bị hoãn');
    assert.match(events, /hẹn lại vào sáng mai/, 'toast phải nói rõ điều gì đã xảy ra');
    assert.match(events, /mnemonic/, 'toast phải gợi ý hành động cụ thể');
});

test('B′: có CSS riêng cho nhãn "Cần Viết Lại"', () => {
    assert.match(read('src/css/style.css'), /\.card-hard-badge\.needs-rewrite\s*\{/);
});

// ── C′-thay-thế: TẠM ẨN — cách trung thực để nói "tôi đã biết từ này" ────────
const { isNaturallyDue } = await import('../src/core/queue.js');

test('Tạm ẩn: thẻ đã tạm ẩn KHÔNG BAO GIỜ tới hạn (kể cả khi quá hạn nặng)', () => {
    const overdue = card({ srsStatus: 'New', srsDueDate: null });
    assert.equal(isNaturallyDue(overdue, now), true, 'thẻ bình thường vẫn tới hạn');
    assert.equal(isNaturallyDue({ ...overdue, isSuspended: true }, now), false, 'tạm ẩn phải bị loại');
    const masteredOverdue = card({ srsDueDate: now - 30 * DAY });
    assert.equal(isNaturallyDue(masteredOverdue, now), true);
    assert.equal(isNaturallyDue({ ...masteredOverdue, isSuspended: true }, now), false);
});

test('Tạm ẩn: hàng đợi lọc isSuspended ở MỌI vòng (không chỉ hàm due)', () => {
    const queue = read('src/core/queue.js');
    const guards = queue.match(/word\.isDeleted \|\| word\.isSuspended/g) || [];
    assert.ok(guards.length >= 5, `phải lọc ở >=5 chỗ, đang ${guards.length}`);
});

test('Tạm ẩn: form thêm/sửa có ô tick và submit ghi đúng cờ', () => {
    const html = read('index.html');
    assert.match(html, /id="input-suspended"/, 'phải có ô tick trong form');
    assert.match(html, /Tạm ẩn \(không đưa vào lịch ôn\)/, 'nhãn phải giải thích rõ');
    const modal = read('src/ui/modal.js');
    assert.match(
        modal,
        /isSuspended: DOM\.inputSuspended \? DOM\.inputSuspended\.checked === true/,
        'submit phải ghi cờ'
    );
    assert.match(
        modal,
        /inputSuspended\) DOM\.inputSuspended\.checked = wordData\.isSuspended === true/,
        'mở form phải nạp lại trạng thái'
    );
});

test('Tạm ẩn: thẻ đang tạm ẩn phải hiện nhãn, không biến mất im lặng', () => {
    const render = read('src/ui/render.js');
    assert.match(render, /const isSuspendedCard = cardData\.isSuspended === true;/);
    assert.match(render, /'Tạm Ẩn'/, 'nhãn riêng cho trạng thái tạm ẩn');
    assert.match(render, /is-suspended/, 'class riêng để CSS tách sắc thái');
    assert.match(read('src/css/style.css'), /\.card-hard-badge\.is-suspended\s*\{/);
});
