// tests/fsrs-persona.test.mjs — khoá "Chân Dung Não Bộ" (analyzeFsrs7Persona).
//
// Vì sao: hàm này biến 34 tham số FSRS-7 đã huấn luyện thành 4 điểm số 0-100,
// 4 nhãn trạng thái và 1 hình mẫu người học để hiển thị. Nó là hàm THUẦN nhưng
// trước đây phủ test 3% — nghĩa là một thay đổi chỉ số (hoặc clamp sai) có thể
// làm thanh điểm vượt 100/âm, hoặc chọn sai hình mẫu, mà không test nào bắt.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    body: { classList: { add() {}, remove() {}, contains: () => false } },
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
};

const { DEFAULT_FSRS7_PARAMS } = await import('../src/core/srs/constants.js');
const { analyzeFsrs7Persona } = await import('../src/features/fsrsPersona.js');

const BASE = DEFAULT_FSRS7_PARAMS;
const withParam = (index, value) => {
    const next = [...BASE];
    next[index] = value;
    return next;
};
const clone = () => [...BASE];

test('tham số mặc định: không cá nhân hoá, điểm trong [50,99], đủ 4 siêu năng lực', () => {
    const persona = analyzeFsrs7Persona(clone(), null);
    assert.equal(persona.isPersonalized, false, 'trùng bộ mặc định ⇒ chưa cá nhân hoá');
    assert.equal(persona.superpowers.length, 4);
    assert.equal(persona.proTips.length, 3);
    assert.equal(persona.techMetrics.length, 5);
    for (const power of persona.superpowers) {
        assert.ok(Number.isInteger(power.score), `${power.id}: điểm phải là số nguyên`);
        assert.ok(power.score >= 50 && power.score <= 99, `${power.id}: ${power.score} ngoài [50,99]`);
        assert.equal(typeof power.status, 'string');
        assert.ok(power.status.length > 0);
        assert.ok(power.desc.length > 0, `${power.id}: phải có mô tả`);
    }
    assert.ok(persona.archetype.title.length > 0);
    assert.ok(persona.archetype.traits.length >= 3);
});

test('tham số khác mặc định ⇒ isPersonalized = true', () => {
    assert.equal(analyzeFsrs7Persona(withParam(2, BASE[2] * 1.2), 123).isPersonalized, true);
});

test('delta dương lớn ở S0 (p[2]) ⇒ điểm tiếp thu tăng, nhãn "Nhạy bén xuất sắc", hình mẫu Tia Chớp', () => {
    const persona = analyzeFsrs7Persona(withParam(2, BASE[2] * 1.2), 1); // +20%
    const learning = persona.superpowers.find(power => power.id === 'learning');
    assert.ok(learning.score > 75, 'điểm phải cao hơn mức trung tính 75');
    assert.equal(learning.status, 'Nhạy bén xuất sắc');
    assert.equal(persona.archetype.title, 'Tia Chớp Nhanh Nhẹn');
    assert.equal(persona.archetype.enTitle, 'Fast Sprinter');
});

test('delta âm lớn ở sinc (p[7]) ⇒ nhãn "Giữ nhịp an toàn", điểm bị sàn 50', () => {
    const persona = analyzeFsrs7Persona(withParam(7, BASE[7] * 0.5), 1); // -50%
    const stamina = persona.superpowers.find(power => power.id === 'stamina');
    assert.equal(stamina.status, 'Giữ nhịp an toàn');
    assert.equal(stamina.score, 50, 'không được xuống dưới sàn 50');
});

test('cực trị được kẹp trong [50,99] ở cả hai phía', () => {
    const huge = analyzeFsrs7Persona([...BASE].map((value, i) => (i < 34 ? value * 1000 : value)), 1);
    const tiny = analyzeFsrs7Persona([...BASE].map((value, i) => (i < 34 ? value / 1000 : value)), 1);
    for (const persona of [huge, tiny]) {
        for (const power of persona.superpowers) {
            assert.ok(power.score >= 50 && power.score <= 99, `${power.id}: ${power.score} ngoài [50,99]`);
        }
    }
});

test('delta nhỏ (<15% và >-10%) giữ nhãn trung tính', () => {
    const persona = analyzeFsrs7Persona(withParam(2, BASE[2] * 1.05), 1);
    const learning = persona.superpowers.find(power => power.id === 'learning');
    assert.equal(learning.status, 'Tiếp thu nhanh nhẹn');
});

test('hình mẫu mặc định khi không có điểm mạnh vượt +10%', () => {
    const persona = analyzeFsrs7Persona(withParam(10, BASE[10] * 1.05), 1); // +5%: dưới ngưỡng 10%
    assert.equal(persona.archetype.title, 'Chiến Binh Thích Ứng');
    assert.equal(persona.archetype.enTitle, 'Adaptive Explorer');
});

test('đầu vào hỏng (null / mảng sai độ dài / NaN) rơi về mặc định, không ném lỗi', () => {
    for (const bad of [null, undefined, [], BASE.slice(0, 33), [...BASE, 1], 'chuỗi', 42]) {
        assert.doesNotThrow(() => analyzeFsrs7Persona(bad, null), `đầu vào ${String(bad)} không được ném lỗi`);
        const persona = analyzeFsrs7Persona(bad, null);
        assert.equal(persona.isPersonalized, false);
        assert.equal(persona.superpowers.length, 4);
    }
});

test('p[24] = 0 không gây chia cho 0 khi tính haft-life metric', () => {
    const persona = analyzeFsrs7Persona(withParam(24, 0), 1);
    const metric = persona.techMetrics.find(item => item.name.includes('w24'));
    assert.ok(metric, 'phải có metric w24');
    assert.ok(!/NaN|Infinity/.test(metric.userVal), `giá trị không được là NaN/Infinity: ${metric.userVal}`);
    assert.ok(!/NaN|Infinity/.test(JSON.stringify(persona)), 'không được có NaN/Infinity trong toàn bộ output');
});

test('trainedAt được truyền nguyên vẹn và hàm là thuần (không đổi mảng đầu vào)', () => {
    const params = withParam(4, BASE[4] * 1.3);
    const snapshot = [...params];
    const stamp = 1700000000000;
    const persona = analyzeFsrs7Persona(params, stamp);
    assert.equal(persona.trainedAt, stamp);
    assert.deepEqual(params, snapshot, 'không được mutate mảng tham số của người gọi');
    assert.deepEqual(analyzeFsrs7Persona(params, stamp), persona, 'cùng đầu vào phải cùng đầu ra');
});
