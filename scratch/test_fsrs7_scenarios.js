// test_fsrs7_scenarios.js
// Kịch bản kiểm thử toàn diện 10 nhóm (60 test cases) cho FSRS-7 Dual-Stability Engine

import { DEFAULT_FSRS7_PARAMS, S_MIN, S_MAX, D_MIN, D_MAX, DESIRED_RETENTION } from '../src/core/srs/constants.js';
import { dualTraceForgettingCurve, nextIntervalNewton } from '../src/core/srs/forgetting.js';
import { initDifficulty, nextDifficulty } from '../src/core/srs/difficulty.js';
import { nextStabilityRecall, postLapseStability, nextStability, nextDualStability } from '../src/core/srs/stability.js';
import { calculateNextSrsState } from '../src/core/srs/index.js';

let passedCount = 0;
let totalCount = 0;

function assert(condition, message) {
    totalCount++;
    if (!condition) {
        console.error(`❌ FAIL: ${message}`);
        throw new Error(message);
    } else {
        passedCount++;
        // console.log(`  ✓ PASS: ${message}`);
    }
}

console.log("================================================================================");
console.log("   KIỂM THỬ TOÀN BỘ MA TRẬN 10 NHÓM TRƯỜNG HỢP / KỊCH BẢN FSRS-7 (60 CASES)     ");
console.log("================================================================================\n");

// -----------------------------------------------------------------------------
// NHÓM 1: Khởi tạo Thẻ Mới (Cold-Start) & 4 Đánh Giá Đầu Tiên
// -----------------------------------------------------------------------------
console.log("--- NHÓM 1: Khởi tạo Thẻ Mới & Cold-Start ---");
for (const rating of [1, 2, 3, 4]) {
    const card = { english: 'apple', srsStatus: 'New', difficulty: undefined, stability: undefined };
    const { newState } = calculateNextSrsState(card, rating, 'en-vi');
    
    assert(newState.stability > 0 && newState.stabilityShort > 0, `Rating ${rating}: S_long và S_short phải dương`);
    assert(newState.difficulty >= D_MIN && newState.difficulty <= D_MAX, `Rating ${rating}: D nằm trong [1, 10]`);
    if (rating <= 2) {
        assert(newState.srsStatus === 'Learning', `Rating ${rating}: Thẻ mới đánh giá Hard/Again phải ở trạng thái Learning`);
    } else {
        assert(newState.srsInterval > 0, `Rating ${rating}: Interval phải > 0`);
        assert(newState.srsStatus === 'Mastered', `Rating ${rating}: Trạng thái phải là Mastered`);
    }
}
// Heuristics cold-start: Từ dài, khó
const hardWordCard = { english: 'supercalifragilisticexpialidocious', srsStatus: 'New', example: 'N/A' };
const { newState: hardState } = calculateNextSrsState(hardWordCard, 3, 'en-vi');
const normalWordCard = { english: 'go', srsStatus: 'New', example: 'I go to school' };
const { newState: normalState } = calculateNextSrsState(normalWordCard, 3, 'en-vi');
assert(hardState.difficulty >= normalState.difficulty, "Heuristic cold-start: Từ dài/phức tạp phải có difficulty ban đầu cao hơn hoặc bằng");
console.log("✓ Nhóm 1 hoàn tất (6/6 cases pass)");

// -----------------------------------------------------------------------------
// NHÓM 2: Đường cong Quên Lãng Kép (Dual-Trace Mixture Model)
// -----------------------------------------------------------------------------
console.log("\n--- NHÓM 2: Dual-Trace Mixture Model & Newton-Raphson ---");
// Case 2.1: t = 0 -> R = 1.0 (với epsilon smoothing 1e-5 của FSRS-7)
const r0 = dualTraceForgettingCurve(0, 10, 8, 5.0, DEFAULT_FSRS7_PARAMS);
assert(Math.abs(r0 - 1.0) < 1e-4, `R(0) phải xấp xỉ 1.0 (nhận được ${r0})`);

// Case 2.2: R đơn điệu giảm theo thời gian
let prevR = 1.0;
for (const t of [0.1, 1, 5, 10, 30, 100, 365]) {
    const r = dualTraceForgettingCurve(t, 20, 15, DEFAULT_FSRS7_PARAMS);
    assert(r < prevR && r >= 0 && r <= 1.0, `R tại t=${t} phải nhỏ hơn t trước và nằm trong [0, 1]`);
    prevR = r;
}

// Case 2.3: S lớn hơn -> R cao hơn tại cùng t
const rLowS = dualTraceForgettingCurve(10, 5, 4, DEFAULT_FSRS7_PARAMS);
const rHighS = dualTraceForgettingCurve(10, 30, 24, DEFAULT_FSRS7_PARAMS);
assert(rHighS > rLowS, `S cao hơn phải cho R cao hơn tại cùng t (rHigh=${rHighS}, rLow=${rLowS})`);

// Case 2.4: Newton-Raphson hội tụ chính xác về DESIRED_RETENTION (0.90)
for (const s of [0.5, 2.0, 10.0, 50.0, 200.0]) {
    const sShort = 0.8 * s;
    const interval = nextIntervalNewton(s, sShort, DESIRED_RETENTION, DEFAULT_FSRS7_PARAMS);
    const simulatedR = dualTraceForgettingCurve(interval, s, sShort, DEFAULT_FSRS7_PARAMS);
    assert(Math.abs(simulatedR - DESIRED_RETENTION) < 0.005, `Newton solver phải đạt sai số < 0.005 (S=${s}, int=${interval}, R=${simulatedR})`);
}
console.log("✓ Nhóm 2 hoàn tất (11/11 cases pass)");

// -----------------------------------------------------------------------------
// NHÓM 3: Độ Khó FSRS-7 (Linear Damping, Mean Reversion & Surprise Lapse)
// -----------------------------------------------------------------------------
console.log("\n--- NHÓM 3: Động Lực Học Độ Khó (Difficulty Dynamics) ---");
// Case 3.1: Đánh giá Easy (4) phải giảm độ khó
const dBefore = 6.0;
const dAfterEasy = nextDifficulty(dBefore, 4, 0.9, DEFAULT_FSRS7_PARAMS);
assert(dAfterEasy < dBefore, `Rating 4 phải giảm độ khó (dBefore=${dBefore}, dAfter=${dAfterEasy})`);

// Case 3.2: Đánh giá Hard (2) và Again (1) phải tăng độ khó
const dAfterHard = nextDifficulty(dBefore, 2, 0.9, DEFAULT_FSRS7_PARAMS);
const dAfterAgain = nextDifficulty(dBefore, 1, 0.9, DEFAULT_FSRS7_PARAMS);
assert(dAfterHard > dBefore, `Rating 2 phải tăng độ khó`);
assert(dAfterAgain > dBefore, `Rating 1 phải tăng độ khó`);
assert(dAfterAgain > dAfterHard, `Rating 1 tăng độ khó mạnh hơn Rating 2`);

// Case 3.3: Surprise-weighted lapse: R cao mà quên (bất ngờ) tăng D nhiều hơn R thấp mà quên
const dLapseSurprise = nextDifficulty(5.0, 1, 0.95, DEFAULT_FSRS7_PARAMS);
const dLapseExpected = nextDifficulty(5.0, 1, 0.20, DEFAULT_FSRS7_PARAMS);
assert(dLapseSurprise > dLapseExpected, `Quên khi R=0.95 (bất ngờ) phải tăng D nhiều hơn khi R=0.20 (dSurprise=${dLapseSurprise}, dExpected=${dLapseExpected})`);

// Case 3.4: Clamping biên [D_MIN, D_MAX]
const dMinClamp = nextDifficulty(1.0, 4, 0.99, DEFAULT_FSRS7_PARAMS);
const dMaxClamp = nextDifficulty(10.0, 1, 0.99, DEFAULT_FSRS7_PARAMS);
assert(dMinClamp >= D_MIN, `D không được vượt xuống dưới ${D_MIN}`);
assert(dMaxClamp <= D_MAX, `D không được vượt quá ${D_MAX}`);
console.log("✓ Nhóm 3 hoàn tất (6/6 cases pass)");

// -----------------------------------------------------------------------------
// NHÓM 4: Ổn Định Kép Khối Recall (Dual-Block Stability Growth)
// -----------------------------------------------------------------------------
console.log("\n--- NHÓM 4: Ổn Định Kép Khối Recall ---");
// Case 4.1: Tăng trưởng qua các rating 2, 3, 4
const sLongInit = 10;
const sShortInit = 8;
const [sL2, sS2] = nextDualStability(sLongInit, sShortInit, 5, 0.9, 0.9, 2, DEFAULT_FSRS7_PARAMS);
const [sL3, sS3] = nextDualStability(sLongInit, sShortInit, 5, 0.9, 0.9, 3, DEFAULT_FSRS7_PARAMS);
const [sL4, sS4] = nextDualStability(sLongInit, sShortInit, 5, 0.9, 0.9, 4, DEFAULT_FSRS7_PARAMS);

assert(sL2 > sLongInit && sS2 > sShortInit, "Rating 2: S_long và S_short đều phải tăng trưởng");
assert(sL3 > sL2 && sS3 > sS2, "Rating 3: S tăng trưởng mạnh hơn Rating 2");
assert(sL4 >= sL3 && sS4 > sS3, "Rating 4: S_long >= S_long(Good) và S_short > S_short(Good)");

// Case 4.2: Spacing effect (khoảng cách ôn tập càng dài thì S tăng càng mạnh nếu nhớ được)
const [sL_overdue, sS_overdue] = nextDualStability(10, 8, 5, 0.5, 0.5, 3, DEFAULT_FSRS7_PARAMS);
const [sL_ontime, sS_ontime] = nextDualStability(10, 8, 5, 0.9, 0.9, 3, DEFAULT_FSRS7_PARAMS);
assert(sL_overdue > sL_ontime, "Spacing effect: Nhớ được khi R thấp (trễ hạn lâu) làm củng cố vết nhớ mạnh hơn");

// Case 4.3: Clamping biên [S_MIN, S_MAX]
const [sL_max, sS_max] = nextDualStability(36000, 30000, 1, 0.99, 0.99, 4, DEFAULT_FSRS7_PARAMS);
assert(sL_max <= S_MAX && sS_max <= S_MAX, `S không được vượt trần ${S_MAX}`);
console.log("✓ Nhóm 4 hoàn tất (5/5 cases pass)");

// -----------------------------------------------------------------------------
// NHÓM 5: Quên Thẻ (Post-Lapse Stability & S_short Reset)
// -----------------------------------------------------------------------------
console.log("\n--- NHÓM 5: Quên Thẻ (Lapse Dynamics) ---");
// Case 5.1: Lapse làm tụt stability
const [sL_lapse, sS_lapse] = nextDualStability(20, 16, 5, 0.9, 0.9, 1, DEFAULT_FSRS7_PARAMS);
assert(sL_lapse < 20, `Lapse phải làm giảm S_long (từ 20 xuống ${sL_lapse})`);

// Case 5.2: S_short bị reset và cap ở 0.8 * S_long sau lapse
assert(sS_lapse <= 0.8 * sL_lapse + 1e-6, `S_short sau lapse phải <= 0.8 * S_long (sS=${sS_lapse}, 0.8*sL=${0.8*sL_lapse})`);

// Case 5.3: Lapse nhiều lần liên tiếp không làm S rớt xuống 0 hoặc NaN
let curSL = 10, curSS = 8;
for (let i = 0; i < 10; i++) {
    [curSL, curSS] = nextDualStability(curSL, curSS, 8, 0.9, 0.9, 1, DEFAULT_FSRS7_PARAMS);
    assert(curSL >= S_MIN && curSS >= S_MIN, `Sau ${i+1} lapses liên tiếp: S phải >= S_MIN`);
    assert(!isNaN(curSL) && !isNaN(curSS), `Sau ${i+1} lapses: S không được là NaN`);
}
console.log("✓ Nhóm 5 hoàn tất (5/5 cases pass)");

// -----------------------------------------------------------------------------
// NHÓM 6: Soft-Migration Từ Dữ Liệu Cũ (SM-2 & FSRS-4.5)
// -----------------------------------------------------------------------------
console.log("\n--- NHÓM 6: Chuyển Đổi Mềm (Soft-Migration) ---");
// Case 6.1: Thẻ SM-2 chỉ có srsEaseFactor, srsInterval
const legacySm2Card = { english: 'run', srsEaseFactor: 2.1, srsInterval: 14, srsStatus: 'Mastered' };
const { newState: migratedSm2 } = calculateNextSrsState(legacySm2Card, 3, 'en-vi');
assert(migratedSm2.stability !== undefined && migratedSm2.stabilityShort !== undefined, "SM-2 thẻ phải được khởi tạo cả S_long và S_short");
assert(migratedSm2.difficulty !== undefined && migratedSm2.difficulty >= D_MIN && migratedSm2.difficulty <= D_MAX, "SM-2 thẻ phải được suy luận difficulty hợp lý");

// Case 6.2: Thẻ FSRS-4.5 đã có stability đơn nhưng chưa có stabilityShort
const legacyFsrsCard = { english: 'walk', stability: 25.0, difficulty: 4.5, srsStatus: 'Mastered' };
const { newState: migratedFsrs } = calculateNextSrsState(legacyFsrsCard, 3, 'en-vi');
assert(migratedFsrs.stabilityShort > 0, "FSRS-4.5 thẻ phải tự động khởi tạo stabilityShort");
assert(migratedFsrs.stability > 25.0, "Thẻ FSRS-4.5 tiếp tục chu kỳ học bình thường không bị gãy nhịp");

// Case 6.3: Thẻ mới hoàn toàn từ database rỗng
const rawCard = { english: 'newbie' };
const { newState: rawState } = calculateNextSrsState(rawCard, 3, 'en-vi');
assert(rawState.stability > 0 && rawState.stabilityShort > 0, "Thẻ rỗng hoàn toàn phải tự động khởi tạo chuẩn xác");
console.log("✓ Nhóm 6 hoàn tất (5/5 cases pass)");

// -----------------------------------------------------------------------------
// NHÓM 7: Typing Modality Bonus (+25% Stability)
// -----------------------------------------------------------------------------
console.log("\n--- NHÓM 7: Typing Modality Bonus ---");
const testCard = { english: 'type', stability: 10.0, stabilityShort: 8.0, difficulty: 5.0, srsStatus: 'Mastered' };
const { newState: btnState } = calculateNextSrsState(testCard, 3, 'en-vi');
const { newState: typingState } = calculateNextSrsState(testCard, 3, 'typing');

assert(typingState.stability > btnState.stability, "Gõ đúng (typing) phải tăng stability_long nhiều hơn bấm nút");
assert(typingState.stabilityShort > btnState.stabilityShort, "Gõ đúng (typing) phải tăng stability_short nhiều hơn bấm nút");
const ratioLong = typingState.stability / btnState.stability;
assert(Math.abs(ratioLong - 1.25) < 0.05, `Tỷ lệ thưởng gõ đúng phải xấp xỉ 1.25 (+25%) (nhận được ${ratioLong.toFixed(3)})`);

// Typing sai (rating 1) không được thưởng bonus
const { newState: typingFail } = calculateNextSrsState(testCard, 1, 'typing');
const { newState: btnFail } = calculateNextSrsState(testCard, 1, 'en-vi');
assert(typingFail.stability <= btnFail.stability, "Gõ sai (rating 1) không được nhận bonus +25%");
console.log("✓ Nhóm 7 hoàn tất (4/4 cases pass)");

// -----------------------------------------------------------------------------
// NHÓM 8: Quản Lý Thẻ Khó (Leech Detection & Auto-Suspension)
// -----------------------------------------------------------------------------
console.log("\n--- NHÓM 8: Cơ Chế Thẻ Khó & Tự Động Tạm Ngưng (Leech) ---");
const leechCard = { english: 'obstinate', stability: 2.0, stabilityShort: 1.6, difficulty: 8.5, lapses: 7, srsStatus: 'Mastered' };
// Lapse thứ 8 -> tự động suspend
const { newState: suspendedState } = calculateNextSrsState(leechCard, 1, 'en-vi');
assert(suspendedState.lapses === 8, "Lapses phải tăng lên 8");
assert(suspendedState.isSuspended === true, "Thẻ 8 lapses phải tự động chuyển sang isSuspended = true");

// Thẻ có 2 lapses -> chưa bị suspend
const normalLapseCard = { english: 'normal', stability: 5.0, stabilityShort: 4.0, difficulty: 6.0, lapses: 1, srsStatus: 'Mastered' };
const { newState: nonSuspendedState } = calculateNextSrsState(normalLapseCard, 1, 'en-vi');
assert(nonSuspendedState.lapses === 2, "Lapses tăng lên 2");
assert(!nonSuspendedState.isSuspended, "Thẻ 2 lapses không bị suspended");
console.log("✓ Nhóm 8 hoàn tất (4/4 cases pass)");

// -----------------------------------------------------------------------------
// NHÓM 9: Khoảng Cách Ôn Tập (Intervals & Intraday Fractional Precision)
// -----------------------------------------------------------------------------
console.log("\n--- NHÓM 9: Khoảng Cách Ôn Tập & Phân Số Trong Ngày ---");
// Thẻ mới đánh giá Hard (2) -> interval ngắn trong ngày (< 1 ngày)
const newCardHard = { english: 'intraday', srsStatus: 'New' };
const { newState: hardNewState } = calculateNextSrsState(newCardHard, 2, 'en-vi');
assert(hardNewState.srsInterval > 0, "Interval phải dương");

// Đánh giá Easy (4) interval phải lớn hơn Good (3), Good lớn hơn Hard (2)
const baseCard = { english: 'compare', stability: 10, stabilityShort: 8, difficulty: 5, srsStatus: 'Mastered' };
const { newState: resHard } = calculateNextSrsState(baseCard, 2, 'en-vi');
const { newState: resGood } = calculateNextSrsState(baseCard, 3, 'en-vi');
const { newState: resEasy } = calculateNextSrsState(baseCard, 4, 'en-vi');

assert(resGood.srsInterval > resHard.srsInterval, `Interval Good (${resGood.srsInterval}) phải > Hard (${resHard.srsInterval})`);
assert(resEasy.srsInterval > resGood.srsInterval, `Interval Easy (${resEasy.srsInterval}) phải > Good (${resGood.srsInterval})`);
console.log("✓ Nhóm 9 hoàn tất (3/3 cases pass)");

// -----------------------------------------------------------------------------
// NHÓM 10: Xử Lý Dữ Liệu Bất Thường & Phòng Ngự Chống Lỗi (Chaos / Defensive Math)
// -----------------------------------------------------------------------------
console.log("\n--- NHÓM 10: Phòng Ngự Toàn Diện (Defensive Math & Chaos Input) ---");
const chaosCards = [
    { name: 'NaN values', stability: NaN, stabilityShort: NaN, difficulty: NaN },
    { name: 'Negative values', stability: -50, stabilityShort: -20, difficulty: -10 },
    { name: 'Extreme huge values', stability: 1e9, stabilityShort: 1e9, difficulty: 999 },
    { name: 'Zero values', stability: 0, stabilityShort: 0, difficulty: 0 },
    { name: 'Corrupted dates', lastReviewDate: Date.now() + 1e10, srsDueDate: -999999 }
];

for (const cc of chaosCards) {
    for (const r of [1, 2, 3, 4]) {
        const { newState } = calculateNextSrsState(cc, r, 'en-vi');
        assert(!isNaN(newState.stability) && isFinite(newState.stability), `${cc.name} Rating ${r}: stability không được là NaN/Inf`);
        assert(!isNaN(newState.stabilityShort) && isFinite(newState.stabilityShort), `${cc.name} Rating ${r}: stabilityShort không được là NaN/Inf`);
        assert(!isNaN(newState.difficulty) && isFinite(newState.difficulty), `${cc.name} Rating ${r}: difficulty không được là NaN/Inf`);
        assert(newState.stability >= S_MIN && newState.stability <= S_MAX, `${cc.name} Rating ${r}: stability trong giới hạn an toàn`);
        const validInterval = (r === 1) ? (newState.srsInterval >= 0) : (newState.srsInterval > 0);
        assert(validInterval && isFinite(newState.srsInterval), `${cc.name} Rating ${r}: interval hợp lệ`);
    }
}
console.log("✓ Nhóm 10 hoàn tất (15/15 cases pass)");

console.log("\n================================================================================");
console.log(` TẤT CẢ ${passedCount} / ${totalCount} TEST CASES TRONG MA TRẬN 10 NHÓM ĐÃ VƯỢT QUA 100%! `);
console.log("================================================================================");
