// tests/p0-progress-crdt.test.mjs — CRDT-01.
//
// Hai lỗi thật trong progress-merge.js:
//   1. `captureProgress` tính delta bằng `val - Math.max(0, before[key])` (dòng 83).
//      Khi tổng hiện tại đã ÂM (đã tiêu/undo vượt mức), lần capture kế tiếp tính
//      nhầm thành "tăng thêm" ⇒ nợ âm bị TRỪ HAI LẦN. Vi phạm tính bất biến cơ bản:
//      capture cùng một trạng thái hai lần phải không đổi tổng.
//   2. `mergeProgress` chỉ kẹp sàn `Math.max(0, val)` cho mọi bộ đếm (dòng 135),
//      nên `streakFreezeCount` có thể cộng dồn thành 2, 3… trong khi luật game
//      (`buyStreakFreeze`) chỉ cho giữ tối đa 1 Khiên Băng.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeProgress, captureProgress, mergeProgress } from '../src/core/progress-merge.js';
import { buildActorId } from '../src/core/device.js';

const gamification = (over = {}) => ({
    userXP: 0,
    totalReviews: 0,
    streakFreezeCount: 0,
    currentStreak: 0,
    activityHeatmap: {},
    stats: {},
    lastStreakFreezeDate: '',
    lastStudyDate: '',
    ...over
});

test('captureProgress là idempotent kể cả khi tổng đang âm (hết nợ âm)', () => {
    const progress = gamification({ userXP: 0 });
    initializeProgress(progress, 'xp');

    // Người dùng tiêu/Undo vượt số XP đang có ⇒ tổng trong CRDT thành ÂM. Đây là
    // trạng thái hợp lệ và KHÔNG hiện ra UI (output kẹp sàn 0), nhưng nếu bị trừ
    // hai lần thì người dùng phải cày thêm đúng phần âm bị nhân đôi mới thấy XP.
    progress.userXP = -200;
    captureProgress(progress, 'xp', 'actorA', 1000);

    // Capture lại NGUYÊN trạng thái đó (không đổi gì) — tổng không được xê dịch.
    captureProgress(progress, 'xp', 'actorA', 2000);

    // Cày thêm 250 XP: nếu nợ âm bị nhân đôi (-400) thì UI vẫn 0; đúng phải là 50.
    progress.userXP = 50;
    captureProgress(progress, 'xp', 'actorA', 3000);

    const merged = mergeProgress(progress, gamification({ userXP: 0 }), 'xp');
    assert.equal(
        merged.userXP,
        50,
        'capture lặp lại cùng trạng thái không được nhân đôi khoản nợ (lỗi Math.max(0, before[key]))'
    );
});

test('captureProgress vẫn đúng khi giá trị tăng rồi giảm (undo)', () => {
    const progress = gamification({ userXP: 1000 });
    initializeProgress(progress, 'xp');
    captureProgress(progress, 'xp', 'actorA', 1000);

    progress.userXP = 400; // undo / chi tiêu 600
    captureProgress(progress, 'xp', 'actorA', 2000);

    const merged = mergeProgress(progress, gamification({ userXP: 1000 }), 'xp');
    assert.equal(merged.userXP, 400, 'delta âm phải được giữ đúng, không bị kẹp về 0');
});

test('mergeProgress kẹp streakFreezeCount về [0, 1] theo luật game', () => {
    const local = gamification({ streakFreezeCount: 1 });
    const remote = gamification({ streakFreezeCount: 1 });
    const merged = mergeProgress(initializeProgress(local, 'xp'), initializeProgress(remote, 'xp'), 'xp');
    assert.ok(
        merged.streakFreezeCount <= 1,
        `hai máy cùng có 1 khiên không được cộng thành ${merged.streakFreezeCount}`
    );
    assert.ok(merged.streakFreezeCount >= 0);
});

test('mergeProgress giữ nguyên currentStreak phái sinh (không cộng dồn)', () => {
    const merged = mergeProgress(
        initializeProgress(gamification({ currentStreak: 13 }), 'xp'),
        initializeProgress(gamification({ currentStreak: 15 }), 'xp'),
        'xp'
    );
    assert.ok(
        merged.currentStreak === 13 || merged.currentStreak === 15,
        `streak phải là LWW, không phải tổng; nhận ${merged.currentStreak}`
    );
});

test('buildActorId tách actor theo tab để hai tab không ghi đè delta của nhau', () => {
    const a = buildActorId('dev_abc', 'tab_1');
    const b = buildActorId('dev_abc', 'tab_2');
    assert.notEqual(a, b, 'cùng thiết bị nhưng khác tab phải là hai actor riêng');
    assert.ok(a.startsWith('dev_abc'), 'vẫn giữ tiền tố thiết bị để lần vết');
    // Thiếu tabId (môi trường test) thì thoái hoá về deviceId — không vỡ.
    assert.equal(buildActorId('dev_abc', ''), 'dev_abc');
});
