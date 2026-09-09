// test_fsrs7_validation.js
// Kiểm tra toàn bộ các kịch bản Validation cho 34 tham số FSRS-7

import { parseAndValidateFsrs7Params, DEFAULT_FSRS7_PARAMS } from '../src/core/srs/constants.js';

let passed = 0;
let total = 0;

function assert(condition, msg) {
    total++;
    if (!condition) {
        console.error(`❌ FAIL: ${msg}`);
        throw new Error(msg);
    } else {
        passed++;
        console.log(`✓ PASS: ${msg}`);
    }
}

console.log("=== KIỂM THỬ XÁC THỰC 34 THAM SỐ FSRS-7 ===");

// 1. Mảng JSON hợp lệ (34 số)
const jsonStr = JSON.stringify(DEFAULT_FSRS7_PARAMS);
const res1 = parseAndValidateFsrs7Params(jsonStr);
assert(res1.valid && res1.params.length === 34, "Case 1: Parse mảng JSON 34 số hợp lệ thành công");

// 2. Chuỗi phân cách bằng dấu phẩy hợp lệ
const commaStr = DEFAULT_FSRS7_PARAMS.join(', ');
const res2 = parseAndValidateFsrs7Params(commaStr);
assert(res2.valid && res2.params.length === 34, "Case 2: Parse chuỗi phân cách dấu phẩy thành công");

// 3. Chuỗi phân cách bằng khoảng trắng hoặc xuống dòng
const newlineStr = DEFAULT_FSRS7_PARAMS.join('\n');
const res3 = parseAndValidateFsrs7Params(newlineStr);
assert(res3.valid && res3.params.length === 34, "Case 3: Parse chuỗi phân cách xuống dòng thành công");

// 4. Chuỗi rỗng
const resEmpty = parseAndValidateFsrs7Params("");
assert(!resEmpty.valid && resEmpty.error.includes("Vui lòng nhập"), "Case 4: Bắt lỗi chuỗi rỗng");

// 5. Thiếu tham số (chỉ có 17 số FSRS-4.5)
const shortParams = DEFAULT_FSRS7_PARAMS.slice(0, 17);
const resShort = parseAndValidateFsrs7Params(JSON.stringify(shortParams));
assert(!resShort.valid && resShort.error.includes("hiện tại bạn nhập 17 số"), "Case 5: Bắt lỗi thiếu số (17/34)");

// 6. Thừa tham số (35 số)
const longParams = [...DEFAULT_FSRS7_PARAMS, 0.99];
const resLong = parseAndValidateFsrs7Params(JSON.stringify(longParams));
assert(!resLong.valid && resLong.error.includes("hiện tại bạn nhập 35 số"), "Case 6: Bắt lỗi thừa số (35/34)");

// 7. Chứa chữ cái hoặc ký tự lạ (NaN)
const corruptedStr = DEFAULT_FSRS7_PARAMS.slice(0, 33).join(', ') + ', abc';
const resCorrupted = parseAndValidateFsrs7Params(corruptedStr);
assert(!resCorrupted.valid && resCorrupted.error.includes("không phải là số hợp lệ"), "Case 7: Bắt lỗi ký tự lạ (NaN)");

// 8. Số âm ở tham số bắt buộc dương
const negativeParams = [...DEFAULT_FSRS7_PARAMS];
negativeParams[0] = -0.5;
const resNegative = parseAndValidateFsrs7Params(JSON.stringify(negativeParams));
assert(!resNegative.valid && resNegative.error.includes("phải là số dương"), "Case 8: Bắt lỗi số âm ngoài biên");

console.log(`\n🎉 TẤT CẢ ${passed}/${total} KỊCH BẢN VALIDATION ĐÃ VƯỢT QUA 100%!`);
