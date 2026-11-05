// tests/p19-upgrades-and-bottlenecks.test.mjs
// Test suite for the 5 upgraded features and architectural bottlenecks:
// 1. Cloze Deletion in Sentence (Điền khuyết câu ví dụ)
// 2. Interleaved Practice Queue (Hàng đợi ôn tập xen kẽ)
// 3. Time-Decayed Retrievability Rate R̄ (Đo lường sức khỏe trí nhớ thời gian thực)
// 4. Multiple Choice Quiz Arena (Đấu trường trắc nghiệm 4 lựa chọn & phím 1-4)
// 5. FSRS-7 Syllable Counting Heuristics (estimateSyllables: -ee, [aeiouy]le$)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { estimateSyllables } from '../src/core/srs/heuristics.js';
import { computeAverageRetrievability } from '../src/core/srs/forgetting.js';
import {
    normalizeInterleavedPractice,
    mergeInterleavedPracticeSettings,
    interleaveBuckets,
    INTERLEAVE_MODES
} from '../src/core/queue.js';
import { generateClozeDeletion } from '../src/features/typing.js';
import { matchesTypingFilter } from '../src/core/state/typing-filter.js';
import { generateQuizOptions, handleQuizKeyDown, getQuizQuestionMode, setQuizQuestionMode } from '../src/features/quiz.js';
import { DEFAULT_FSRS7_PARAMS } from '../src/core/srs/constants.js';

// ============================================================================
// 1. CLOZE DELETION IN SENTENCE
// ============================================================================
test('P19.1 — generateClozeDeletion xử lý an toàn đầu vào rỗng, thiếu dữ liệu hoặc N/A', () => {
    assert.equal(generateClozeDeletion('', 'apple').hasCloze, false);
    assert.equal(generateClozeDeletion(null, 'apple').hasCloze, false);
    assert.equal(generateClozeDeletion('N/A', 'apple').hasCloze, false);
    assert.equal(generateClozeDeletion('A fruit', '').hasCloze, false);
    assert.equal(generateClozeDeletion('A fruit', null).hasCloze, false);
});

test('P19.1 — generateClozeDeletion ẩn chính xác từ đơn mục tiêu trong câu ví dụ', () => {
    const example = 'He bought a shiny new car yesterday.';
    const result = generateClozeDeletion(example, 'car');
    assert.equal(result.hasCloze, true);
    assert.ok(result.clozeHtml.includes('class="cloze-blank"'));
    assert.ok(result.clozeHtml.includes('[ ______ ]'));
    assert.ok(!result.clozeHtml.toLowerCase().includes(' car '));
});

test('P19.1 — generateClozeDeletion không phân biệt hoa thường và bắt được từ ở đầu câu', () => {
    const example = 'Coffee gives me energy in the morning.';
    const result = generateClozeDeletion(example, 'coffee');
    assert.equal(result.hasCloze, true);
    assert.ok(result.clozeHtml.startsWith('<span class="cloze-gap"'));
});

test('P19.1 — generateClozeDeletion nhận diện biến thể hình thái (stemming / inflected form)', () => {
    const example = 'Children are swimming in the fresh lake.';
    const result = generateClozeDeletion(example, 'swim');
    assert.equal(result.hasCloze, true);
    assert.ok(result.clozeHtml.includes('[ ______ ]'));
});

test('P19.1 — generateClozeDeletion xử lý cụm từ nhiều từ (multi-word phrase / idiom)', () => {
    const example = 'The host told a joke to break the ice among guests.';
    const result = generateClozeDeletion(example, 'break the ice');
    assert.equal(result.hasCloze, true);
    assert.ok(result.clozeHtml.includes('[ ______ ]'));
    assert.ok(!result.clozeHtml.replace(/<[^>]*>/g, '').includes('break the ice'));
});

test('P19.1 — generateClozeDeletion xử lý từ có dấu gạch chéo đồng nghĩa (slash alternatives)', () => {
    const example = 'She visited the clinic to see a physician.';
    const result = generateClozeDeletion(example, 'doctor / physician');
    assert.equal(result.hasCloze, true);
    assert.ok(result.clozeHtml.includes('[ ______ ]'));
});

test('P19.1 — generateClozeDeletion bảo vệ XSS an toàn qua escapeHTML', () => {
    const unsafeExample = 'She said <script>alert("hack")</script> about apples.';
    const result = generateClozeDeletion(unsafeExample, 'apple');
    assert.ok(!result.clozeHtml.includes('<script>'));
    assert.ok(result.clozeHtml.includes('&lt;script&gt;'));
});

test('P19.1 — generateClozeDeletion không bắt nhầm từ khác có chung tiền tố (plan != planet, state != station)', () => {
    // Thẻ 'plan' trong câu có 'planet' -> không được che 'planet'
    const resPlanet = generateClozeDeletion('Jupiter is a giant planet.', 'plan');
    assert.equal(resPlanet.hasCloze, false);
    assert.ok(resPlanet.clozeHtml.includes('planet'));

    // Thẻ 'state' trong câu có 'station' -> không được che 'station'
    const resStation = generateClozeDeletion('The railway station was full of people.', 'state');
    assert.equal(resStation.hasCloze, false);
    assert.ok(resStation.clozeHtml.includes('station'));

    // Thẻ 'cat' trong câu có 'cater' hoặc 'category' -> không được che
    const resCat = generateClozeDeletion('We cater to special requests.', 'cat');
    assert.equal(resCat.hasCloze, false);

    // Khi câu có CẢ từ đúng 'plan' và từ 'planetarium' -> chỉ che 'plan'
    const resBoth = generateClozeDeletion('We have a plan to visit the planetarium.', 'plan');
    assert.equal(resBoth.hasCloze, true);
    assert.ok(resBoth.clozeHtml.includes('planetarium'));
    assert.ok(resBoth.clozeHtml.includes('[ ______ ]'));
});

test('P19.1 — generateClozeDeletion nhận diện dạng bất quy tắc hoặc biến thể trong ngoặc đơn (take (took))', () => {
    const resTook = generateClozeDeletion('He took the bus to school yesterday.', 'take (took)');
    assert.equal(resTook.hasCloze, true);
    assert.ok(resTook.clozeHtml.includes('[ ______ ]'));

    const resBrought = generateClozeDeletion('She brought a delicious homemade cake.', 'bring (brought, brought)');
    assert.equal(resBrought.hasCloze, true);
    assert.ok(resBrought.clozeHtml.includes('[ ______ ]'));
});

test('P19.1 — matchesTypingFilter với bộ lọc "cloze" phát hiện đúng thẻ có câu ví dụ', () => {
    assert.equal(matchesTypingFilter({ example: 'This is an example.' }, 'cloze'), true);
    assert.equal(matchesTypingFilter({ example: '   ' }, 'cloze'), false);
    assert.equal(matchesTypingFilter({ example: 'N/A' }, 'cloze'), false);
    assert.equal(matchesTypingFilter({ example: null }, 'cloze'), false);
    assert.equal(matchesTypingFilter({}, 'cloze'), false);
    assert.equal(matchesTypingFilter(null, 'cloze'), false);
});

// ============================================================================
// 2. INTERLEAVED PRACTICE QUEUE
// ============================================================================
test('P19.2 — normalizeInterleavedPractice chuẩn hóa cài đặt đúng hợp đồng', () => {
    assert.deepEqual(normalizeInterleavedPractice(true), { enabled: true, mode: 'balanced', updatedAt: 0 });
    assert.deepEqual(normalizeInterleavedPractice(false), { enabled: false, mode: 'balanced', updatedAt: 0 });
    assert.deepEqual(normalizeInterleavedPractice({ enabled: true, mode: 'topic', updatedAt: 12345 }), {
        enabled: true,
        mode: 'topic',
        updatedAt: 12345
    });
    // Mode không hợp lệ quay về 'balanced'
    assert.deepEqual(normalizeInterleavedPractice({ enabled: true, mode: 'invalid' }), {
        enabled: true,
        mode: 'balanced',
        updatedAt: 0
    });
    assert.deepEqual(INTERLEAVE_MODES, ['balanced', 'topic', 'blocked']);
});

test('P19.2 — mergeInterleavedPracticeSettings ưu tiên bản ghi có mốc thời gian mới hơn (LWW)', () => {
    const local = { enabled: false, mode: 'balanced', updatedAt: 1000 };
    const remoteNewer = { enabled: true, mode: 'topic', updatedAt: 2000 };
    const remoteOlder = { enabled: true, mode: 'blocked', updatedAt: 500 };

    assert.deepEqual(mergeInterleavedPracticeSettings(local, remoteNewer), {
        enabled: true,
        mode: 'topic',
        updatedAt: 2000
    });
    assert.deepEqual(mergeInterleavedPracticeSettings(local, remoteOlder), {
        enabled: false,
        mode: 'balanced',
        updatedAt: 1000
    });
});

test('P19.2 — interleaveBuckets ở chế độ "blocked" giữ nguyên trật tự tuần tự truyền thống', () => {
    const buckets = {
        learning: [1, 2],
        due: [10, 20],
        new: [100, 200]
    };
    const result = interleaveBuckets(buckets, { mode: 'blocked' });
    assert.deepEqual(result, [1, 2, 10, 20, 100, 200]);
});

test('P19.2 — interleaveBuckets ở chế độ "balanced" xen kẽ tỉ lệ đồng đều theo thuật toán Bresenham', () => {
    // 4 thẻ đến hạn và 4 thẻ mới -> xen kẽ 1:1 hoàn hảo
    const buckets = {
        learning: [99],
        due: [1, 2, 3, 4],
        new: [10, 20, 30, 40]
    };
    const result = interleaveBuckets(buckets, { mode: 'balanced' });
    assert.equal(result[0], 99, 'Thẻ learning luôn đứng đầu');
    const withoutLearning = result.slice(1);
    // Kiểm tra xen kẽ due và new
    const dueSet = new Set([1, 2, 3, 4]);
    const newSet = new Set([10, 20, 30, 40]);
    assert.equal(withoutLearning.length, 8);
    // Không bao giờ có 3 thẻ cùng loại liên tiếp khi số lượng bằng nhau
    for (let i = 0; i < withoutLearning.length - 2; i++) {
        const isAllDue = dueSet.has(withoutLearning[i]) && dueSet.has(withoutLearning[i + 1]) && dueSet.has(withoutLearning[i + 2]);
        const isAllNew = newSet.has(withoutLearning[i]) && newSet.has(withoutLearning[i + 1]) && newSet.has(withoutLearning[i + 2]);
        assert.ok(!isAllDue, 'Không dồn 3 thẻ due liên tiếp');
        assert.ok(!isAllNew, 'Không dồn 3 thẻ new liên tiếp');
    }
});

test('P19.2 — interleaveBuckets xử lý an toàn khi một trong các bucket rỗng', () => {
    assert.deepEqual(interleaveBuckets({ due: [1, 2], new: [] }), [1, 2]);
    assert.deepEqual(interleaveBuckets({ due: [], new: [10, 20] }), [10, 20]);
    assert.deepEqual(interleaveBuckets({ learning: [5], due: [], new: [] }), [5]);
    assert.deepEqual(interleaveBuckets({}), []);
});

test('P19.2 — interleaveBuckets chế độ "topic" phân tán các thẻ có cùng chủ đề liên tiếp', () => {
    const vocab = [
        { id: '0', tags: ['travel'] },
        { id: '1', tags: ['travel'] },
        { id: '2', tags: ['tech'] },
        { id: '3', tags: ['business'] }
    ];
    const buckets = {
        learning: [],
        due: [0, 1],
        new: [2, 3]
    };
    const result = interleaveBuckets(buckets, { mode: 'topic', vocabulary: vocab });
    assert.equal(result.length, 4);
    // Hai thẻ cùng tag 'travel' (0 và 1) không đứng cạnh nhau nếu có thẻ khác chủ đề
    for (let i = 0; i < result.length - 1; i++) {
        const tagA = vocab[result[i]]?.tags[0];
        const tagB = vocab[result[i + 1]]?.tags[0];
        if (tagA === 'travel' && tagB === 'travel') {
            assert.fail('Hai thẻ cùng chủ đề travel không được dính liền nhau');
        }
    }
});

test('P19.2 — interleaveBuckets chế độ "topic" vẫn phân tán chủ đề khi chỉ có thẻ due (N = 0) hoặc chỉ có thẻ new (D = 0)', () => {
    const vocab = [
        { id: 0, tags: ['medical'] },
        { id: 1, tags: ['medical'] },
        { id: 2, tags: ['medical'] },
        { id: 3, tags: ['business'] },
        { id: 4, tags: ['business'] }
    ];

    // Chỉ có thẻ due, 0 thẻ new (trường hợp cực kỳ phổ biến trong học thực tế)
    const dueOnly = interleaveBuckets({ learning: [], due: [0, 1, 2, 3, 4], new: [] }, { mode: 'topic', vocabulary: vocab });
    assert.equal(dueOnly.length, 5);
    const tagsDue = dueOnly.map(idx => vocab[idx].tags[0]);
    // Kiểm tra không có 3 thẻ medical liên tiếp
    for (let i = 0; i < tagsDue.length - 2; i++) {
        const triple = tagsDue[i] === 'medical' && tagsDue[i + 1] === 'medical' && tagsDue[i + 2] === 'medical';
        assert.ok(!triple, 'Không dồn 3 thẻ medical liên tiếp');
    }

    // Chỉ có thẻ new, 0 thẻ due
    const newOnly = interleaveBuckets({ learning: [], due: [], new: [0, 1, 3, 4] }, { mode: 'topic', vocabulary: vocab });
    assert.equal(newOnly.length, 4);
    assert.ok(newOnly.length > 0);
});

test('P19.2 — interleaveBuckets chế độ "topic" xử lý thẻ có tags dạng chuỗi có dấu phẩy hoặc thiếu tag', () => {
    const vocab = [
        { id: 0, tags: 'science, physics' },
        { id: 1, tags: 'science' },
        { id: 2, tags: 'history, art' },
        { id: 3, tags: null }
    ];
    const res = interleaveBuckets({ due: [0, 1, 2, 3], new: [] }, { mode: 'topic', vocabulary: vocab });
    assert.equal(res.length, 4);
    assert.doesNotThrow(() => interleaveBuckets({ due: [0, 1], new: [] }, { mode: 'topic', vocabulary: null }));
});


// ============================================================================
// 3. REAL-TIME TIME-DECAYED RETRIEVABILITY RATE R̄
// ============================================================================
test('P19.3 — computeAverageRetrievability trả về null khi không có thẻ nào đã học', () => {
    assert.equal(computeAverageRetrievability([]), null);
    assert.equal(computeAverageRetrievability(null), null);
    assert.equal(computeAverageRetrievability([{ english: 'cat', srsStatus: 'New', reps: 0 }]), null);
    assert.equal(computeAverageRetrievability([{ english: 'cat', isDeleted: true, reps: 5, stability: 10 }]), null);
});

test('P19.3 — computeAverageRetrievability tính đúng R ≈ 100% khi thẻ vừa mới ôn xong (elapsedDays = 0)', () => {
    const now = Date.now();
    const vocab = [
        {
            english: 'cat',
            srsStatus: 'Mastered',
            reps: 2,
            stability: 10.0,
            stabilityShort: 8.0,
            difficulty: 4.0,
            lastReviewDate: now
        }
    ];
    const r = computeAverageRetrievability(vocab, { now });
    assert.ok(typeof r === 'number');
    assert.ok(r >= 95 && r <= 100, `Retrievability vừa ôn phải gần 100%, nhận ${r}`);
});

test('P19.3 — computeAverageRetrievability suy giảm đơn điệu theo thời gian trôi qua (decay with elapsed time)', () => {
    const now = Date.now();
    const dayMs = 86400000;
    const makeCard = (elapsedDays) => ({
        english: 'solar',
        srsStatus: 'Mastered',
        reps: 3,
        stability: 5.0,
        difficulty: 5.0,
        lastReviewDate: now - (elapsedDays * dayMs)
    });

    const rDay1 = computeAverageRetrievability([makeCard(1)], { now });
    const rDay5 = computeAverageRetrievability([makeCard(5)], { now });
    const rDay30 = computeAverageRetrievability([makeCard(30)], { now });

    assert.ok(rDay1 > rDay5, `R ngày 1 (${rDay1}) phải lớn hơn R ngày 5 (${rDay5})`);
    assert.ok(rDay5 > rDay30, `R ngày 5 (${rDay5}) phải lớn hơn R ngày 30 (${rDay30})`);
    assert.ok(rDay30 >= 0 && rDay30 <= 100, 'Giá trị luôn trong khoảng [0, 100]');
});

test('P19.3 — computeAverageRetrievability tính trung bình chuẩn xác trên nhiều thẻ có độ bền khác nhau', () => {
    const now = Date.now();
    const vocab = [
        { english: 'easy', srsStatus: 'Mastered', reps: 5, stability: 30.0, difficulty: 2.0, lastReviewDate: now - 86400000 },
        { english: 'hard', srsStatus: 'Mastered', reps: 2, stability: 2.0, difficulty: 8.0, lastReviewDate: now - 86400000 * 5 }
    ];
    const r = computeAverageRetrievability(vocab, { now, params: DEFAULT_FSRS7_PARAMS });
    assert.ok(typeof r === 'number');
    assert.ok(r > 0 && r < 100);
});

// ============================================================================
// 4. MULTIPLE CHOICE QUIZ ARENA (4 OPTIONS & NUMERIC KEYS 1-4)
// ============================================================================
test('P19.4 — getQuizQuestionMode & setQuizQuestionMode lưu chuyển chính xác', () => {
    setQuizQuestionMode('typing');
    assert.equal(getQuizQuestionMode(), 'typing');
    setQuizQuestionMode('mc');
    assert.equal(getQuizQuestionMode(), 'mc');
    setQuizQuestionMode('other');
    assert.equal(getQuizQuestionMode(), 'mc');
});

test('P19.4 — generateQuizOptions tạo đủ 4 lựa chọn với đúng 1 đáp án đúng', () => {
    const current = { id: 'c1', english: 'serendipity', vietnamese: 'sự tình cờ may mắn', type: 'noun', tags: ['advanced'] };
    const vocab = [
        current,
        { id: 'c2', english: 'epiphany', type: 'noun', tags: ['advanced'] },
        { id: 'c3', english: 'resilience', type: 'noun', tags: ['life'] },
        { id: 'c4', english: 'eloquent', type: 'adjective', tags: ['speech'] },
        { id: 'c5', english: 'ubiquitous', type: 'adjective', tags: ['common'] }
    ];

    const options = generateQuizOptions(current, vocab, 4);
    assert.equal(options.length, 4);

    const correctOpts = options.filter(o => o.isCorrect);
    assert.equal(correctOpts.length, 1);
    assert.equal(correctOpts[0].text, 'serendipity');

    const keys = options.map(o => o.key);
    assert.deepEqual(keys.sort(), ['1', '2', '3', '4']);

    // Không có đáp án trùng chữ
    const texts = options.map(o => o.text);
    assert.equal(new Set(texts).size, 4);
});

test('P19.4 — generateQuizOptions xử lý an toàn khi kho từ vựng quá ít từ (< 4 từ)', () => {
    const current = { id: 'c1', english: 'sun', vietnamese: 'mặt trời' };
    const vocab = [current, { id: 'c2', english: 'moon', vietnamese: 'mặt trăng' }];

    const options = generateQuizOptions(current, vocab, 4);
    assert.equal(options.length, 2);
    assert.equal(options.filter(o => o.isCorrect).length, 1);
    assert.ok(['1', '2'].includes(options.find(o => o.isCorrect).key));
});

test('P19.4 — handleQuizKeyDown xử lý an toàn khi gọi trong môi trường không DOM và hỗ trợ cả code Digit/Numpad', () => {
    // Không ném lỗi dù truyền phím gì khi không có DOM
    assert.doesNotThrow(() => {
        handleQuizKeyDown({ key: '1', code: 'Digit1', preventDefault() {} });
        handleQuizKeyDown({ key: '2', code: 'Numpad2', preventDefault() {} });
        handleQuizKeyDown({ key: 'Unidentified', code: 'Numpad3', preventDefault() {} });
        handleQuizKeyDown({ key: 'Enter', code: 'Enter', preventDefault() {} });
        handleQuizKeyDown({ key: 'Escape', code: 'Escape', preventDefault() {} });
    });
});

// ============================================================================
// 5. ESTIMATE SYLLABLES ALGORITHM IN FSRS-7 (HEURISTICS.JS)
// ============================================================================
test('P19.5 — estimateSyllables: từ tận cùng "-ee" KHÔNG bị tính là e câm (coffee, agree)', () => {
    assert.equal(estimateSyllables('coffee'), 2, 'coffee: cof-fee (2 âm tiết)');
    assert.equal(estimateSyllables('agree'), 2, 'agree: a-gree (2 âm tiết)');
    assert.equal(estimateSyllables('degree'), 2, 'degree: de-gree (2 âm tiết)');
    assert.equal(estimateSyllables('referee'), 3, 'referee: ref-er-ee (3 âm tiết)');
    assert.equal(estimateSyllables('committee'), 3, 'committee: com-mit-tee (3 âm tiết)');
    assert.equal(estimateSyllables('guarantee'), 3, 'guarantee: guar-an-tee (3 âm tiết)');
    assert.equal(estimateSyllables('see'), 1, 'see: 1 âm tiết');
    assert.equal(estimateSyllables('free'), 1, 'free: 1 âm tiết');
    assert.equal(estimateSyllables('tree'), 1, 'tree: 1 âm tiết');
});

test('P19.5 — estimateSyllables: các từ tận cùng -ees, -eed, -ies, -ied không bị trừ nhầm âm tiết', () => {
    // Đuôi -ees (plural / 3rd person của -ee):
    assert.equal(estimateSyllables('agrees'), 2, 'agrees: a-grees (2 âm tiết)');
    assert.equal(estimateSyllables('coffees'), 2, 'coffees: cof-fees (2 âm tiết)');
    assert.equal(estimateSyllables('degrees'), 2, 'degrees: de-grees (2 âm tiết)');
    assert.equal(estimateSyllables('referees'), 3, 'referees: ref-er-ees (3 âm tiết)');
    assert.equal(estimateSyllables('guarantees'), 3, 'guarantees: guar-an-tees (3 âm tiết)');

    // Đuôi -eed (past / participle của -ee hoặc từ gốc -eed):
    assert.equal(estimateSyllables('agreed'), 2, 'agreed: a-greed (2 âm tiết)');
    assert.equal(estimateSyllables('proceed'), 2, 'proceed: pro-ceed (2 âm tiết)');
    assert.equal(estimateSyllables('exceed'), 2, 'exceed: ex-ceed (2 âm tiết)');
    assert.equal(estimateSyllables('succeed'), 2, 'succeed: suc-ceed (2 âm tiết)');
    assert.equal(estimateSyllables('decreed'), 2, 'decreed: de-creed (2 âm tiết)');

    // Đuôi -ies và -ied của từ đa âm tiết:
    assert.equal(estimateSyllables('studies'), 2, 'studies: stu-dies (2 âm tiết)');
    assert.equal(estimateSyllables('studied'), 2, 'studied: stu-died (2 âm tiết)');
    assert.equal(estimateSyllables('worries'), 2, 'worries: wor-ries (2 âm tiết)');
    assert.equal(estimateSyllables('worried'), 2, 'worried: wor-ried (2 âm tiết)');
    assert.equal(estimateSyllables('parties'), 2, 'parties: par-ties (2 âm tiết)');
    assert.equal(estimateSyllables('babies'), 2, 'babies: ba-bies (2 âm tiết)');
    assert.equal(estimateSyllables('replied'), 2, 'replied: re-plied (2 âm tiết)');
    assert.equal(estimateSyllables('denied'), 2, 'denied: de-nied (2 âm tiết)');
});

test('P19.5 — estimateSyllables: các từ câm chữ s tận cùng -isle (aisle, isle) đếm chính xác 1 âm tiết', () => {
    assert.equal(estimateSyllables('aisle'), 1, 'aisle: 1 âm tiết');
    assert.equal(estimateSyllables('isle'), 1, 'isle: 1 âm tiết');
});

test('P19.5 — estimateSyllables: từ tận cùng [aeiouy]le$ là e câm kéo dài nguyên âm -> CẦN TRỪ (scale, hole)', () => {
    assert.equal(estimateSyllables('scale'), 1, 'scale: 1 âm tiết');
    assert.equal(estimateSyllables('hole'), 1, 'hole: 1 âm tiết');
    assert.equal(estimateSyllables('whale'), 1, 'whale: 1 âm tiết');
    assert.equal(estimateSyllables('mile'), 1, 'mile: 1 âm tiết');
    assert.equal(estimateSyllables('stole'), 1, 'stole: 1 âm tiết');
    assert.equal(estimateSyllables('file'), 1, 'file: 1 âm tiết');
    assert.equal(estimateSyllables('tale'), 1, 'tale: 1 âm tiết');
    assert.equal(estimateSyllables('style'), 1, 'style: 1 âm tiết');
});

test('P19.5 — estimateSyllables: từ tận cùng phụ âm + "le" tạo âm tiết riêng [l̩] -> KHÔNG TRỪ (bottle, table)', () => {
    assert.equal(estimateSyllables('bottle'), 2, 'bottle: bot-tle (2 âm tiết)');
    assert.equal(estimateSyllables('table'), 2, 'table: ta-ble (2 âm tiết)');
    assert.equal(estimateSyllables('apple'), 2, 'apple: ap-ple (2 âm tiết)');
    assert.equal(estimateSyllables('simple'), 2, 'simple: sim-ple (2 âm tiết)');
    assert.equal(estimateSyllables('middle'), 2, 'middle: mid-dle (2 âm tiết)');
    assert.equal(estimateSyllables('candle'), 2, 'candle: can-dle (2 âm tiết)');
    assert.equal(estimateSyllables('little'), 2, 'little: lit-tle (2 âm tiết)');
    assert.equal(estimateSyllables('subtle'), 2, 'subtle: sub-tle (2 âm tiết)');
});

test('P19.5 — estimateSyllables: đuôi "-es" và "-ed" phân biệt sibilants chính xác', () => {
    // Sau sibilants (s, z, x, ch, sh) tạo âm tiết [ɪz] -> không trừ
    assert.equal(estimateSyllables('boxes'), 2, 'boxes: 2 âm tiết');
    assert.equal(estimateSyllables('watches'), 2, 'watches: 2 âm tiết');
    assert.equal(estimateSyllables('wishes'), 2, 'wishes: 2 âm tiết');
    // Đuôi es thường -> trừ
    assert.equal(estimateSyllables('cats'), 1, 'cats: 1 âm tiết');
    // Đuôi ed sau t/d -> không trừ
    assert.equal(estimateSyllables('waited'), 2, 'waited: 2 âm tiết');
    assert.equal(estimateSyllables('needed'), 2, 'needed: 2 âm tiết');
    // Đuôi ed thường -> trừ
    assert.equal(estimateSyllables('played'), 1, 'played: 1 âm tiết');
});

test('P19.5 — estimateSyllables: xử lý biên với chuỗi rỗng, số, dấu câu và từ cực ngắn', () => {
    assert.equal(estimateSyllables(''), 1);
    assert.equal(estimateSyllables(null), 1);
    assert.equal(estimateSyllables(undefined), 1);
    assert.equal(estimateSyllables('123'), 1);
    assert.equal(estimateSyllables('a'), 1);
    assert.equal(estimateSyllables('to'), 1);
    assert.equal(estimateSyllables('in'), 1);
    assert.equal(estimateSyllables('the'), 1);
});
