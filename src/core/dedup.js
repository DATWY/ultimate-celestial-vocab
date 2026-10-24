// src/core/dedup.js
import { nextRevision } from './card-merge.js';
// Next-Gen Intelligent Deduplication & Semantic Matching Engine v5.0 (Fuzzy & Morphological)

const VI_STOPWORDS = new Set([
    'sự', 'việc', 'cái', 'con', 'bị', 'được', 'một', 'những', 'các', 'làm', 'bản',
    'có', 'và', 'hoặc', 'hay', 'cho', 'để', 'với', 'của', 'trong', 'ngoài', 'về',
    'từ', 'đến', 'ở', 'tại', 'như', 'là', 'nhất', 'rất', 'quá', 'lại', 'qua', 'đi',
    'ra', 'vào', 'lên', 'xuống', 'theo', 'khi', 'nếu', 'mà', 'vì', 'do', 'bởi',
    'nghĩa', 'nghia', 'nghĩa là', 'nghia la', 'ý nghĩa', 'y nghia'
]);

// Danh sách cặp từ tiếng Anh dễ nhầm lẫn nhưng là các từ độc lập khác nhau, không được gộp mờ (confusables/homophones)
const ENGLISH_CONFUSABLES = new Set([
    'accept|except',
    'adapt|adopt',
    'advice|advise',
    'affect|effect',
    'allusion|illusion',
    'bare|bear',
    'capital|capitol',
    'cite|sight',
    'cite|site',
    'coarse|course',
    'compliment|complement',
    'desert|dessert',
    'elicit|illicit',
    'eminent|imminent',
    'form|from',
    'loose|lose',
    'peace|piece',
    'principal|principle',
    'quiet|quite',
    'sight|site',
    'stationary|stationery',
    'weather|whether'
]);

function isConfusablePair(wordA, wordB) {
    const a = (wordA || '').toLowerCase().trim();
    const b = (wordB || '').toLowerCase().trim();
    if (a === b) return false;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    return ENGLISH_CONFUSABLES.has(key);
}

// Danh sách các động từ phổ biến hay tạo phrasal verbs
const COMMON_VERBS = new Set([
    'go', 'come', 'get', 'take', 'make', 'put', 'set', 'look', 'give', 'keep',
    'bring', 'hold', 'turn', 'call', 'run', 'break', 'fall', 'carry', 'stand',
    'cut', 'pull', 'pass', 'catch', 'move', 'build', 'pay', 'work', 'lead',
    'point', 'hand', 'draw', 'grow', 'hang', 'drop', 'push', 'speak', 'write'
]);

/**
 * Tính khoảng cách Levenshtein giữa 2 chuỗi
 */
export function levenshteinDistance(s1, s2) {
    if (s1 === s2) return 0;
    const len1 = s1.length;
    const len2 = s2.length;
    if (len1 === 0) return len2;
    if (len2 === 0) return len1;

    let prevRow = new Array(len2 + 1);
    let currRow = new Array(len2 + 1);
    for (let j = 0; j <= len2; j++) prevRow[j] = j;

    for (let i = 1; i <= len1; i++) {
        currRow[0] = i;
        const char1 = s1.charCodeAt(i - 1);
        for (let j = 1; j <= len2; j++) {
            const cost = char1 === s2.charCodeAt(j - 1) ? 0 : 1;
            currRow[j] = Math.min(
                currRow[j - 1] + 1,      // insertion
                prevRow[j] + 1,          // deletion
                prevRow[j - 1] + cost    // substitution
            );
        }
        [prevRow, currRow] = [currRow, prevRow];
    }
    return prevRow[len2];
}

/**
 * Tính tỷ lệ tương đồng ký tự (0.0 -> 1.0)
 */
export function stringSimilarity(s1, s2) {
    const maxLen = Math.max(s1.length, s2.length);
    if (maxLen === 0) return 1.0;
    const dist = levenshteinDistance(s1, s2);
    return Math.max(0, (maxLen - dist) / maxLen);
}

/**
 * Loại bỏ dấu tiếng Việt (ví dụ: "thị phạm" -> "thi pham", "chứng minh" -> "chung minh")
 */
export function removeVietnameseTones(str) {
    if (!str) return '';
    return str.normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D')
        .toLowerCase();
}

/**
 * Tìm kiếm mờ thông minh cho ô tìm kiếm từ vựng (hỗ trợ không dấu, multi-token, typo Levenshtein)
 */
export function isFuzzySearchMatch(query, english, vietnamese) {
    if (!query) return true;
    const q = query.trim().toLowerCase();
    const eng = (english || '').toLowerCase();
    const vie = (vietnamese || '').toLowerCase();

    // 1. Khớp chuỗi trực tiếp
    if (eng.includes(q) || vie.includes(q)) return true;

    // 2. Tiếng Việt không dấu
    const qNoTone = removeVietnameseTones(q);
    const vieNoTone = removeVietnameseTones(vie);
    if (vieNoTone.includes(qNoTone)) return true;

    // 3. Khớp đa từ khóa (Multi-token match)
    const tokens = qNoTone.split(/\s+/).filter(Boolean);
    if (tokens.length > 1) {
        const engTokens = eng.replace(/[^a-z0-9]/g, ' ').split(/\s+/);
        const vieTokens = vieNoTone.replace(/[^a-z0-9]/g, ' ').split(/\s+/);
        const allTokens = [...engTokens, ...vieTokens];
        const allTokensMatch = tokens.every(tok => allTokens.some(t => t.includes(tok)));
        if (allTokensMatch) return true;
    }

    // 4. Tìm kiếm mờ tiếng Anh (Levenshtein Fuzzy Match)
    if (q.length >= 4) {
        const engWords = eng.replace(/[^a-z0-9]/g, ' ').split(/\s+/);
        for (const w of engWords) {
            if (w.length >= 4 && Math.abs(w.length - q.length) <= 2) {
                const dist = levenshteinDistance(q, w);
                const maxLen = Math.max(q.length, w.length);
                if (dist <= 1 || (maxLen >= 8 && dist <= 2)) {
                    return true;
                }
            }
        }
    }

    return false;
}

/**
 * Chuẩn hóa mặt chữ tiếng Anh (gọt sạch ngoặc đơn, gạch nối, chuẩn hóa US/UK)
 */
export function canonicalEnglish(text) {
    if (!text) return '';
    let s = text.toLowerCase().trim();

    // 1. Lấy phần trước dấu gạch chéo đầu tiên nếu có (ví dụ: "put off / delay" -> "put off")
    if (s.includes('/')) {
        s = s.split('/')[0].trim();
    }

    // 2. Loại bỏ phần chú thích trong ngoặc đơn (ví dụ: "take off (clothing)" -> "take off")
    s = s.replace(/\([^)]*\)/g, '').trim();

    // 3. Chuẩn hóa chính tả Anh - Mỹ / Anh - Anh
    s = s.replace(/ise$/g, 'ize')
         .replace(/ising$/g, 'izing')
         .replace(/ised$/g, 'ized')
         .replace(/our$/g, 'or')
         .replace(/fulfil$/g, 'fulfill')
         .replace(/centre$/g, 'center')
         .replace(/programme$/g, 'program');

    // 4. Bỏ ký tự đặc biệt, gạch ngang, giữ lại chữ cái và khoảng trắng đơn
    s = s.replace(/[\-'\.,\/#!$%\^&\*;:{}=\-_`~()]/g, ' ')
         .replace(/\s+/g, ' ')
         .trim();

    return s;
}

/**
 * Chuẩn hóa chuỗi tiếng Anh cô đặc (bỏ hoàn toàn khoảng trắng, dấu gạch nối)
 * Ví dụ: "take-off", "take off", "takeoff" đều quy về "takeoff"
 */
export function compactEnglish(text) {
    if (!text) return '';
    return canonicalEnglish(text).replace(/[^a-z0-9]/g, '');
}

/**
 * Sinh tập gốc từ khả dĩ cho một từ tiếng Anh.
 *
 * Trả về NHIỀU ứng viên thay vì một gốc duy nhất vì tiếng Anh có hiện tượng nhập nhằng:
 * "worked" có thể là "work" + "-ed" hoặc "worke" + "-d"; "demonstrated" là
 * "demonstrat" + "-ed" nhưng từ gốc đúng là "demonstrate". Chỉ một gốc duy nhất
 * sẽ bỏ sót một trong hai trường hợp (lỗi cũ: worked → worke nên không khớp work).
 *
 * Quy tắc -er so sánh hơn đã được TÁCH khỏi đây: nó chỉ đúng khi cả hai thẻ là
 * tính từ/trạng từ (xem isComparativeVariant), nếu không sẽ biến matter→mat,
 * corner→corn, farmer→farm... thành cặp trùng giả.
 */
export function stemCandidatesWord(word) {
    const candidates = new Set();
    if (!word) return candidates;
    const w = word.toLowerCase().trim();
    if (!w) return candidates;
    candidates.add(w);

    const add = (value) => { if (value && value.length >= 2) candidates.add(value); };

    // -ies -> -y (parties -> party)
    if (w.endsWith('ies') && w.length > 4) add(w.slice(0, -3) + 'y');
    // -es cho các âm xuýt (boxes -> box, watches -> watch)
    if (w.endsWith('es') && (w.endsWith('shes') || w.endsWith('ches') || w.endsWith('sses') || w.endsWith('xes') || w.endsWith('zes'))) {
        add(w.slice(0, -2));
    }
    // -ing (demonstrating -> demonstrat / demonstrate; running -> run / runn)
    if (w.endsWith('ing') && w.length > 5) {
        const base = w.slice(0, -3);
        add(base);
        if (base.length > 3 && base[base.length - 1] === base[base.length - 2]) add(base.slice(0, -1));
        if (!base.endsWith('e')) add(base + 'e');
    }
    // -ed (worked -> work; demonstrated -> demonstrat / demonstrate; studied -> study)
    if (w.endsWith('ed') && w.length > 4) {
        const base = w.slice(0, -2);
        add(base);
        add(base + 'e');
        if (base.endsWith('i')) add(base.slice(0, -1) + 'y');
        if (base.length > 3 && base[base.length - 1] === base[base.length - 2]) add(base.slice(0, -1));
    }
    // -iest / -ier -> -y (happiest -> happy, happier -> happy)
    if (w.endsWith('iest') && w.length > 5) add(w.slice(0, -4) + 'y');
    if (w.endsWith('ier') && w.length > 4) add(w.slice(0, -3) + 'y');
    // -s số nhiều thông thường (colleagues -> colleague)
    if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) add(w.slice(0, -1));

    return candidates;
}

/**
 * Rút gọn gốc từ tiếng Anh (giữ API cũ). Trả về gốc "gần đúng" đầu tiên;
 * việc so khớp thực tế dùng stemCandidatesPhrase() để không bỏ sót.
 */
export function stemEnglishWord(word) {
    if (!word) return '';
    const w = word.toLowerCase().trim();
    if (!w) return '';
    const candidates = [...stemCandidatesWord(w)];
    const derived = candidates.find(c => c !== w);
    return derived || w;
}

/**
 * Sinh tập gốc từ cho cả cụm từ tiếng Anh (tổ hợp ứng viên từng từ).
 */
export function stemCandidatesPhrase(text) {
    const canon = canonicalEnglish(text);
    if (!canon) return new Set();
    const words = canon.split(/\s+/).filter(Boolean);
    if (words.length === 0) return new Set();
    let combos = [''];
    for (const word of words) {
        const wordCandidates = stemCandidatesWord(word);
        const next = [];
        for (const prefix of combos) {
            for (const candidate of wordCandidates) {
                next.push(prefix ? `${prefix} ${candidate}` : candidate);
                if (next.length >= 32) break;
            }
            if (next.length >= 32) break;
        }
        combos = next;
    }
    return new Set(combos);
}

/**
 * Rút gọn gốc từ cho cả cụm từ tiếng Anh (API cũ, một gốc duy nhất).
 */
export function stemEnglishPhrase(text) {
    const canon = canonicalEnglish(text);
    if (!canon) return '';
    return canon.split(/\s+/).map(stemEnglishWord).join(' ');
}

function stemsIntersect(candidatesA, candidatesB) {
    if (candidatesA.size === 0 || candidatesB.size === 0) return false;
    const [small, large] = candidatesA.size <= candidatesB.size ? [candidatesA, candidatesB] : [candidatesB, candidatesA];
    for (const value of small) {
        if (large.has(value)) return true;
    }
    return false;
}

/**
 * So sánh hơn (-er) chỉ hợp lệ khi cả hai thẻ cùng là tính từ/trạng từ và nghĩa tương đồng.
 * Ngăn false positive kiểu matter/mat, corner/corn, farmer/farm, worker/work, mother/moth.
 */
function isComparativeVariant(cardA, cardB, posA, posB, semSim) {
    if (!((posA === 'adjective' || posA === 'adverb') && posA === posB)) return false;
    if (semSim < 0.5) return false;
    const a = compactEnglish(cardA.english);
    const b = compactEnglish(cardB.english);
    if (!a || !b || a === b) return false;
    const short = a.length <= b.length ? a : b;
    const long = a.length <= b.length ? b : a;
    if (long.length === short.length) return false;
    // slow -> slower, late -> later, big -> bigger (gấp đôi phụ âm cuối: +3 ký tự)
    if (long === `${short}er` || long === `${short}r`) return true;
    if (long === `${short}${short.slice(-1)}er`) return true;
    return false;
}

/**
 * Chuẩn hóa loại từ (Part of Speech) về các nhóm cốt lõi
 */
export function canonicalPartOfSpeech(typeStr, englishText = '') {
    if (!typeStr) return 'unknown';
    const t = typeStr.toLowerCase().trim().replace(/[\.\(\)]/g, '');

    // Nhóm Động từ
    if (['v', 'verb', 'phr v', 'phral v', 'phrasal verb', 'v phr', 'verb phrase'].includes(t)) {
        return 'verb';
    }

    // Nhóm Danh từ
    if (['n', 'noun', 'noun phrase', 'n phr'].includes(t)) {
        return 'noun';
    }

    // Nhóm Tính từ
    if (['adj', 'adjective', 'adj phr'].includes(t)) {
        return 'adjective';
    }

    // Nhóm Trạng từ
    if (['adv', 'adverb', 'adv phr'].includes(t)) {
        return 'adverb';
    }

    // Nhóm Giới từ / Liên từ
    if (['prep', 'preposition', 'conj', 'conjunction'].includes(t)) {
        return 'preposition';
    }

    // Xử lý loại từ "phrase" / "cụm từ":
    // Nếu từ tiếng Anh có động từ gốc ở đầu (ví dụ: "build up", "go ahead", "set up") -> quy về 'verb'
    if (['phrase', 'cụm từ', 'phr', 'idiom'].includes(t)) {
        const firstWord = (englishText || '').toLowerCase().trim().split(/[\s\-]+/)[0];
        if (firstWord && COMMON_VERBS.has(firstWord)) {
            return 'verb';
        }
        return 'phrase';
    }

    return t;
}

/**
 * Làm sạch, chuẩn hóa và khử trùng lặp nghĩa tiếng Việt triệt để (Case-insensitive)
 * Khắc phục hoàn toàn lỗi lặp: "Thị phạm, chứng minh, Chứng minh, giải thích" -> "Thị phạm, chứng minh, giải thích"
 */
export function cleanAndDeduplicateVietnamese(rawText) {
    if (!rawText) return '';
    // Tách theo dấu phẩy, chấm phẩy, xuống dòng, gạch chéo
    const parts = rawText.split(/[,;\n\/]+/).map(p => p.trim()).filter(Boolean);
    const uniqueMap = new Map();

    for (const part of parts) {
        // Gọt sạch các ký tự rác ở đầu/cuối: bullet, gạch ngang, dấu chấm, dấu phẩy
        const cleanPart = part.replace(/^[\-\•\*\s\d\.\)]+|[\.\;\,\s\-]+$/g, '').trim();
        if (!cleanPart) continue;

        // Chuẩn hóa key so sánh: chữ thường và thu gọn khoảng trắng
        const normKey = cleanPart.toLowerCase().replace(/\s+/g, ' ');
        if (!uniqueMap.has(normKey)) {
            uniqueMap.set(normKey, cleanPart);
        } else {
            // Giữ lại định dạng đầy đủ hơn hoặc có chú thích nếu có
            const existing = uniqueMap.get(normKey);
            if (cleanPart.length > existing.length) {
                uniqueMap.set(normKey, cleanPart);
            }
        }
    }

    const list = Array.from(uniqueMap.values());
    if (list.length === 0) return '';

    // Viết hoa chữ cái đầu tiên của cụm từ đầu tiên
    list[0] = list[0].charAt(0).toUpperCase() + list[0].slice(1);
    
    // Các cụm từ tiếp theo: viết thường chữ cái đầu trừ khi là từ viết hoa toàn bộ (viết tắt)
    for (let i = 1; i < list.length; i++) {
        if (list[i].length > 1 && list[i][0] === list[i][0].toUpperCase() && list[i][1] === list[i][1].toLowerCase()) {
            list[i] = list[i].charAt(0).toLowerCase() + list[i].slice(1);
        }
    }

    return list.join(', ');
}

/**
 * Trích xuất các cụm từ ghép tiếng Việt (Phrase-level)
 */
export function extractVietnamesePhrases(text) {
    if (!text) return new Set();
    const clean = text.replace(/[\(\[\{].*?[\)\]\}]/g, ' ');
    const parts = clean.split(/[,;\n\/]+/).map(p => p.trim().toLowerCase()).filter(Boolean);
    const phrases = new Set();
    parts.forEach(p => {
        const norm = p.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
        if (norm) phrases.add(norm);
    });
    return phrases;
}

/**
 * Tính mức độ trùng lặp cụm từ tiếng Việt giữa 2 thẻ (Phrase Overlap)
 */
export function calculatePhraseOverlap(textA, textB) {
    const setA = extractVietnamesePhrases(textA);
    const setB = extractVietnamesePhrases(textB);
    if (setA.size === 0 || setB.size === 0) return 0;

    let matchCount = 0;
    for (const pA of setA) {
        for (const pB of setB) {
            if (pA === pB || pA.includes(pB) || pB.includes(pA)) {
                matchCount++;
                break;
            }
        }
    }
    return matchCount / Math.min(setA.size, setB.size);
}

/**
 * Trích xuất từ khóa đơn lẻ tiếng Việt
 */
export function extractVietnameseKeywords(text) {
    if (!text) return new Set();
    const cleanText = text.replace(/[\(\[\{].*?[\)\]\}]/g, ' ');
    const tokens = cleanText.toLowerCase()
        .replace(/[^a-zà-ỹ0-9]/gi, ' ')
        .split(/\s+/)
        .filter(w => w.length > 1 && !VI_STOPWORDS.has(w));
    
    return new Set(tokens);
}

/**
 * Tính toán độ tương đồng ngữ nghĩa tiếng Việt đa chiều (Phrase Overlap + Jaccard + Substring)
 */
export function calculateSemanticSimilarity(vietnameseA, vietnameseB) {
    if (!vietnameseA || !vietnameseB) return 0;
    const strA = vietnameseA.toLowerCase().trim();
    const strB = vietnameseB.toLowerCase().trim();

    if (strA === strB) return 1.0;

    // Kiểm tra bao hàm trực tiếp
    if (strA.includes(strB) || strB.includes(strA)) {
        return 0.90;
    }

    // 1. So khớp cụm nghĩa (Phrase-level) - Rất chính xác cho tiếng Việt
    const phraseOverlap = calculatePhraseOverlap(vietnameseA, vietnameseB);
    if (phraseOverlap >= 0.5) {
        return Math.max(0.85, phraseOverlap);
    }

    // 2. Tính Jaccard Token
    const setA = extractVietnameseKeywords(vietnameseA);
    const setB = extractVietnameseKeywords(vietnameseB);

    if (setA.size === 0 && setB.size === 0) return 0.5;
    if (setA.size === 0 || setB.size === 0) return 0;

    let intersectionCount = 0;
    for (const item of setA) {
        if (setB.has(item)) intersectionCount++;
    }
    const unionCount = setA.size + setB.size - intersectionCount;
    const jaccard = unionCount > 0 ? intersectionCount / unionCount : 0;

    // 3. Shared compound root bonus
    let sharedRootBonus = 0;
    if (intersectionCount > 0) {
        sharedRootBonus = 0.15;
    }

    return Math.min(1.0, Math.max(phraseOverlap, jaccard + sharedRootBonus));
}

/**
 * Kiểm tra 2 thẻ có phải là trùng lặp (Duplicate) với thuật toán Tìm Kiếm Mờ v5.0
 * Có cơ chế bảo vệ ngăn chặn gộp nhầm Word Families (adj/adv, verb/noun) và từ khác nghĩa.
 */
export function isDuplicateCard(cardA, cardB) {
    if (!cardA || !cardB || !cardA.english || !cardB.english) {
        return { isDuplicate: false, confidence: 0, category: 'DIFFERENT', reason: 'Không trùng lặp' };
    }
    const rawA = String(cardA.english).trim();
    const rawB = String(cardB.english).trim();
    if (!rawA || !rawB) {
        return { isDuplicate: false, confidence: 0, category: 'DIFFERENT', reason: 'Không trùng lặp' };
    }

    const canonA = canonicalEnglish(rawA);
    const canonB = canonicalEnglish(rawB);
    const compactA = compactEnglish(rawA);
    const compactB = compactEnglish(rawB);
    const stemCandidatesA = stemCandidatesPhrase(rawA);
    const stemCandidatesB = stemCandidatesPhrase(rawB);

    const posA = canonicalPartOfSpeech(cardA.type, cardA.english);
    const posB = canonicalPartOfSpeech(cardB.type, cardB.english);
    
    // Kiểm tra tính tương thích của loại từ (POS Compatibility)
    // Cùng POS, hoặc Động từ & Cụm động từ
    const isExactSamePOS = posA === posB;
    const isVerbPhraseCompat = (posA === 'phrase' && posB === 'verb') || (posA === 'verb' && posB === 'phrase');
    const isCompatiblePOS = isExactSamePOS || isVerbPhraseCompat;

    const semSim = calculateSemanticSimilarity(cardA.vietnamese, cardB.vietnamese);
    const phraseOverlap = calculatePhraseOverlap(cardA.vietnamese, cardB.vietnamese);

    // BẢO VỆ CHỐNG GỘP NHẦM TỪ LOẠI PHÁI SINH (Word Families):
    // Ví dụ: manufacture (verb) vs manufacturer (noun), accurate (adj) vs accurately (adv)
    const isWordFamilyDerivative = (
        (posA === 'adjective' && posB === 'adverb') || (posA === 'adverb' && posB === 'adjective') ||
        (posA === 'verb' && posB === 'noun') || (posA === 'noun' && posB === 'verb') ||
        (posA === 'noun' && posB === 'adjective') || (posA === 'adjective' && posB === 'noun')
    );

    // -------------------------------------------------------------
    // CẤP ĐỘ 1: EXACT MATCH (Trùng khớp chính xác từ vựng hoặc dạng viết gạch nối/cách)
    // Ví dụ: "demonstrate" vs "Demonstrate", "take off" vs "take-off"
    // -------------------------------------------------------------
    // -------------------------------------------------------------
    // CẤP ĐỘ 1: EXACT MATCH (Trùng khớp chính xác từ vựng hoặc dạng viết gạch nối/cách)
    // Ví dụ: "demonstrate" vs "Demonstrate", "take off" vs "take-off", "Color" vs "colour"
    // -------------------------------------------------------------
    if (canonA === canonB || compactA === compactB) {
        // Cùng từ tiếng Anh nhưng khác hẳn loại từ (ví dụ noun vs verb) và nghĩa không tương đồng -> POLYSEMY
        if (!isCompatiblePOS && posA !== 'unknown' && posB !== 'unknown' && semSim < 0.70) {
            return { isDuplicate: false, confidence: semSim, category: 'POLYSEMY', reason: 'Từ đa nghĩa (khác loại từ và nghĩa)' };
        }
        return {
            isDuplicate: true,
            confidence: Math.max(0.95, semSim),
            category: 'EXACT',
            reason: isCompatiblePOS && posA !== 'unknown'
                ? 'Trùng khớp 100% từ vựng và loại từ'
                : 'Trùng khớp từ vựng (biến thể chính tả / viết hoa / cách viết)'
        };
    }

    // Nếu khác mặt chữ và là từ loại phái sinh (Word Family) -> KHÔNG COI LÀ TRÙNG LẶP
    if (isWordFamilyDerivative) {
        return { isDuplicate: false, confidence: 0, category: 'WORD_FAMILY', reason: 'Họ từ phái sinh (cần học riêng biệt)' };
    }

    // -------------------------------------------------------------
    // CẤP ĐỘ 2: INFLECTION / STEM MATCH (Biến thể ngữ pháp / số ít - nhiều / thì / so sánh)
    // Ví dụ: "colleague" vs "colleagues", "demonstrate" vs "demonstrating", "run" vs "running", "happy" vs "happier"
    // -------------------------------------------------------------
    // Chỉ nhận biến thể khi gốc từ giao nhau VÀ nghĩa đủ tương đồng (hoặc thiếu dữ liệu nghĩa).
    // Nếu không có cổng ngữ nghĩa, các cặp như seed/see, mater/mat sẽ bị gộp nhầm.
    const hasMeaning = Boolean(cardA.vietnamese && cardB.vietnamese);
    const stemMeaningOk = !hasMeaning || semSim >= 0.45 || phraseOverlap >= 0.5;
    if (stemsIntersect(stemCandidatesA, stemCandidatesB) && stemMeaningOk) {
        if (isCompatiblePOS || posA === 'unknown' || posB === 'unknown') {
            return {
                isDuplicate: true,
                confidence: Math.max(0.90, semSim),
                category: 'INFLECTION',
                reason: `Biến thể ngữ pháp (${cardA.english} ⟷ ${cardB.english})`
            };
        }
    }

    // So sánh hơn (-er) chỉ dành cho tính từ/trạng từ cùng loại và cùng nghĩa.
    if (isComparativeVariant(cardA, cardB, posA, posB, semSim)) {
        return {
            isDuplicate: true,
            confidence: Math.max(0.88, semSim),
            category: 'INFLECTION',
            reason: `Biến thể so sánh hơn (${cardA.english} ⟷ ${cardB.english})`
        };
    }

    // -------------------------------------------------------------
    // CẤP ĐỘ 3: FUZZY TYPO MATCH (Tìm kiếm mờ lỗi chính tả Levenshtein)
    // Ví dụ: "demonstate" vs "demonstrate" (thiếu chữ r)
    // BẮT BUỘC:
    // - Cùng loại từ hoặc tương thích
    // - Không phải cặp từ confusable/homophone độc lập trong tiếng Anh
    // - Cụm nghĩa tiếng Việt tương đồng cao
    // - Khoảng cách ký tự phù hợp với độ dài từ
    // -------------------------------------------------------------
    if (isCompatiblePOS && !isConfusablePair(cardA.english, cardB.english) && !isConfusablePair(canonA, canonB)) {
        const minLen = Math.min(compactA.length, compactB.length);
        const maxLen = Math.max(compactA.length, compactB.length);
        const dist = levenshteinDistance(compactA, compactB);
        const simRatio = (maxLen - dist) / maxLen;

        const isAllowedDist = (minLen >= 5 && dist === 1) || (minLen >= 8 && dist <= 2);

        // Bắt buộc nghĩa tiếng Việt phải có sự tương đồng cụm hoặc semSim cao
        if (isAllowedDist && simRatio >= 0.82 && (phraseOverlap >= 0.5 || semSim >= 0.60)) {
            return {
                isDuplicate: true,
                confidence: Math.round(simRatio * Math.max(0.85, semSim) * 100) / 100,
                category: 'FUZZY_TYPO',
                reason: `Tìm kiếm mờ: Lệch chính tả (${cardA.english} ⟷ ${cardB.english}, giống ${(simRatio * 100).toFixed(0)}%)`
            };
        }
    }

    return { isDuplicate: false, confidence: 0, category: 'DIFFERENT', reason: 'Không trùng lặp' };
}

// Giới hạn bucket: trước đây là 100 và mọi bucket lớn hơn bị BỎ IM LẶNG, khiến
// các cặp lỗi chính tả trong kho lớn không bao giờ được báo. Nâng ngưỡng và chỉ
// bỏ qua khi bucket thực sự phi thực tế (dữ liệu nhân tạo hàng nghìn từ cùng gốc).
const MAX_DELETION_BUCKET = 512;
const MAX_PREFIX_BUCKET = 600;
const MAX_STEM_BUCKET = 200;

// Thẻ thiếu id (dữ liệu import lỗi) vẫn phải có khoá ổn định riêng, nếu không
// mọi thẻ sẽ va vào cùng khoá "undefined|undefined" và chỉ giữ lại một cặp.
const _anonCardKeys = new WeakMap();
let _anonCardKeySeq = 0;
function cardPairKey(card) {
    if (card.id !== undefined && card.id !== null && card.id !== '') return String(card.id);
    if (!_anonCardKeys.has(card)) _anonCardKeys.set(card, `__anon_${++_anonCardKeySeq}`);
    return _anonCardKeys.get(card);
}

function addPairCandidate(map, cardA, cardB) {
    if (!cardA || !cardB) return;
    const keyA = cardPairKey(cardA);
    const keyB = cardPairKey(cardB);
    if (keyA === keyB) return;
    const key = keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
    if (!map.has(key)) map.set(key, [cardA, cardB]);
}

function addExactBucketPairs(map, buckets) {
    for (const cards of buckets.values()) {
        if (cards.length < 2) continue;
        if (cards.length <= 100) {
            for (let i = 0; i < cards.length; i++) {
                for (let j = i + 1; j < cards.length; j++) {
                    addPairCandidate(map, cards[i], cards[j]);
                }
            }
            continue;
        }
        // Bucket lớn không thể ghép mọi cặp (O(n^2)). Nhưng KHÔNG được chỉ so với cards[0]:
        // khi bucket trộn nhiều từ loại/nghĩa (vd "run" noun + 200 "run" verb) cách đó bỏ sót
        // mọi cặp hợp lệ còn lại. Thay vào đó giữ một đại diện cho MỖI nhóm tương thích
        // (so sánh thật bằng isDuplicateCard) và nối mọi thẻ vào đại diện của nhóm đó.
        const representatives = [];
        for (const card of cards) {
            let matched = false;
            for (const rep of representatives) {
                if (isDuplicateCard(rep, card).isDuplicate) {
                    addPairCandidate(map, rep, card);
                    matched = true;
                    break;
                }
            }
            if (!matched) representatives.push(card);
        }
    }
}

function addBucketPairs(map, buckets, maxBucket, lengthTolerance = 0, stats = null) {
    for (const cards of buckets.values()) {
        if (cards.length < 2) continue;
        if (cards.length > maxBucket) {
            if (stats) stats.skippedOversizedBuckets = (stats.skippedOversizedBuckets || 0) + 1;
            continue;
        }
        for (let i = 0; i < cards.length; i++) {
            for (let j = i + 1; j < cards.length; j++) {
                if (lengthTolerance > 0) {
                    const lenA = cards[i].english.length;
                    const lenB = cards[j].english.length;
                    if (Math.abs(lenA - lenB) > lengthTolerance) continue;
                }
                addPairCandidate(map, cards[i], cards[j]);
            }
        }
    }
}

/**
 * Xây chỉ mục ứng viên dùng chung cho cả bản đồng bộ và bản bất đồng bộ.
 * - Compact: trùng mặt chữ, khác hoa/thường, dấu cách, gạch nối.
 * - Stem: biến thể ngữ pháp (-s, -ies, -ing, -ed, -ier).
 * - Deletion: lỗi chính tả Levenshtein 1 (SymSpell) và 2 (xóa kép cho từ >= 8 ký tự).
 * - Prefix: lỗi chính tả 2 ký tự ở giữa từ (maintenance/maintainance) mà vùng xóa đơn không bắt được.
 */
function indexCard(card, indexes) {
    const compact = compactEnglish(card.english);
    if (compact) {
        if (!indexes.compactBuckets.has(compact)) indexes.compactBuckets.set(compact, []);
        indexes.compactBuckets.get(compact).push(card);

        if (compact.length >= 5) {
            const addDeletionKey = (key) => {
                if (!indexes.deletionBuckets.has(key)) indexes.deletionBuckets.set(key, []);
                indexes.deletionBuckets.get(key).push(card);
            };
            addDeletionKey(compact);
            for (let i = 0; i < compact.length; i++) {
                addDeletionKey(compact.slice(0, i) + compact.slice(i + 1));
            }
        }

        // Prefix/suffix 4 ký tự: bắt lỗi chính tả 2 ký tự không chia sẻ vùng xóa đơn
        // (maintenance/maintainance). Không sinh xóa kép cho mọi từ vì sẽ bùng nổ bộ nhớ.
        if (compact.length >= 5) {
            const prefix = compact.slice(0, Math.min(4, compact.length - 1));
            if (!indexes.prefixBuckets.has(prefix)) indexes.prefixBuckets.set(prefix, []);
            indexes.prefixBuckets.get(prefix).push(card);

            if (compact.length >= 8) {
                const suffix = compact.slice(-4);
                if (!indexes.suffixBuckets.has(suffix)) indexes.suffixBuckets.set(suffix, []);
                indexes.suffixBuckets.get(suffix).push(card);
            }
        }
    }

    for (const stem of stemCandidatesPhrase(card.english)) {
        if (!stem) continue;
        if (!indexes.stemBuckets.has(stem)) indexes.stemBuckets.set(stem, []);
        indexes.stemBuckets.get(stem).push(card);
    }
}

function createIndexes() {
    return {
        compactBuckets: new Map(),
        stemBuckets: new Map(),
        deletionBuckets: new Map(),
        prefixBuckets: new Map(),
        suffixBuckets: new Map()
    };
}

function collectCandidatePairs(indexes, stats = null) {
    const candidatePairsMap = new Map();
    addExactBucketPairs(candidatePairsMap, indexes.compactBuckets);
    addBucketPairs(candidatePairsMap, indexes.stemBuckets, MAX_STEM_BUCKET, 0, stats);
    addBucketPairs(candidatePairsMap, indexes.deletionBuckets, MAX_DELETION_BUCKET, 2, stats);
    addBucketPairs(candidatePairsMap, indexes.prefixBuckets, MAX_PREFIX_BUCKET, 2, stats);
    addBucketPairs(candidatePairsMap, indexes.suffixBuckets, MAX_PREFIX_BUCKET, 2, stats);
    return candidatePairsMap;
}

function matchCandidatePairs(candidatePairsMap) {
    const duplicateGroups = [];
    for (const [cA, cB] of candidatePairsMap.values()) {
        const check = isDuplicateCard(cA, cB);
        if (check.isDuplicate) {
            const cleanedSuggestedMeaning = cleanAndDeduplicateVietnamese(`${cA.vietnamese}, ${cB.vietnamese}`);
            duplicateGroups.push({
                key: `${cA.english}_${cB.english}`,
                cardA: cA,
                cardB: cB,
                confidence: check.confidence,
                category: check.category,
                reason: check.reason,
                suggestedVietnamese: cleanedSuggestedMeaning
            });
        }
    }
    return duplicateGroups.sort((a, b) => b.confidence - a.confidence);
}

function activeDuplicateCards(vocabulary) {
    if (!Array.isArray(vocabulary)) return [];
    return vocabulary.filter(w => w && !w.isDeleted && typeof w.english === 'string' && w.english.trim().length > 0);
}

function yieldToMainThread() {
    if (typeof requestIdleCallback === 'function') {
        return new Promise(resolve => requestIdleCallback(() => resolve(), { timeout: 50 }));
    }
    return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Quét toàn bộ kho từ vựng và tìm các cặp trùng lặp với thuật toán Đa Phân Nhóm
 * (Multi-Bucket & SymSpell Deletion). Bản đồng bộ dùng cho test và kho nhỏ.
 */
export function findDuplicatePairs(vocabulary, options = {}) {
    const activeCards = activeDuplicateCards(vocabulary);
    const indexes = createIndexes();
    for (const card of activeCards) indexCard(card, indexes);
    const stats = { skippedOversizedBuckets: 0 };
    const result = matchCandidatePairs(collectCandidatePairs(indexes, stats));
    Object.defineProperty(result, 'skippedOversizedBuckets', { value: stats.skippedOversizedBuckets, writable: true, configurable: true, enumerable: false });
    Object.defineProperty(result, 'skippedBuckets', { value: stats.skippedOversizedBuckets, writable: true, configurable: true, enumerable: false });
    if (options && typeof options === 'object' && options.stats && typeof options.stats === 'object') {
        options.stats.skippedOversizedBuckets = stats.skippedOversizedBuckets;
        options.stats.skippedBuckets = stats.skippedOversizedBuckets;
    }
    return result;
}

/**
 * Bản bất đồng bộ: chia nhỏ theo lô và nhường main thread giữa các lô.
 * Dùng cho giao diện để không chặn 1,3 giây với kho 3.000 từ.
 * @param {Array} vocabulary
 * @param {{onProgress?: (phase: 'index'|'match', done: number, total: number) => void, chunkSize?: number}} options
 */
export async function findDuplicatePairsAsync(vocabulary, options = {}) {
    const { onProgress = null, chunkSize = 200 } = options;
    const activeCards = activeDuplicateCards(vocabulary);
    const indexes = createIndexes();

    for (let i = 0; i < activeCards.length; i++) {
        indexCard(activeCards[i], indexes);
        if ((i + 1) % chunkSize === 0) {
            onProgress?.('index', i + 1, activeCards.length);
            await yieldToMainThread();
        }
    }
    onProgress?.('index', activeCards.length, activeCards.length);

    const stats = { skippedOversizedBuckets: 0 };
    const candidatePairsMap = collectCandidatePairs(indexes, stats);
    const entries = [...candidatePairsMap.values()];
    const duplicateGroups = [];
    for (let i = 0; i < entries.length; i++) {
        const [cA, cB] = entries[i];
        const check = isDuplicateCard(cA, cB);
        if (check.isDuplicate) {
            duplicateGroups.push({
                key: `${cA.english}_${cB.english}`,
                cardA: cA,
                cardB: cB,
                confidence: check.confidence,
                category: check.category,
                reason: check.reason,
                suggestedVietnamese: cleanAndDeduplicateVietnamese(`${cA.vietnamese}, ${cB.vietnamese}`)
            });
        }
        if ((i + 1) % chunkSize === 0) {
            onProgress?.('match', i + 1, entries.length);
            await yieldToMainThread();
        }
    }
    onProgress?.('match', entries.length, entries.length);
    const result = duplicateGroups.sort((a, b) => b.confidence - a.confidence);
    Object.defineProperty(result, 'skippedOversizedBuckets', { value: stats.skippedOversizedBuckets, writable: true, configurable: true, enumerable: false });
    Object.defineProperty(result, 'skippedBuckets', { value: stats.skippedOversizedBuckets, writable: true, configurable: true, enumerable: false });
    if (options && typeof options === 'object' && options.stats && typeof options.stats === 'object') {
        options.stats.skippedOversizedBuckets = stats.skippedOversizedBuckets;
        options.stats.skippedBuckets = stats.skippedOversizedBuckets;
    }
    return result;
}

/**
 * Quét tìm các thẻ đơn lẻ trong kho có nghĩa tiếng Việt bị lặp từ/cụm từ nội bộ
 * Ví dụ thẻ Demonstrate: "Thị phạm, chứng minh, Chứng minh, giải thích"
 */
export function findInternalDuplicateCards(vocabulary) {
    if (!Array.isArray(vocabulary)) return [];
    const activeCards = vocabulary.filter(w => w && typeof w === 'object' && !w.isDeleted);
    const cardsWithInternalDups = [];

    activeCards.forEach(card => {
        if (!card.vietnamese || typeof card.vietnamese !== 'string') return;
        const cleaned = cleanAndDeduplicateVietnamese(card.vietnamese);
        
        // Kiểm tra xem chuỗi ban đầu có bị lặp từ hay không
        // Bằng cách đếm số cụm từ trước và sau khi khử trùng
        const rawParts = card.vietnamese.split(/[,;\n\/]+/).map(p => p.trim().toLowerCase()).filter(Boolean);
        const cleanedParts = cleaned.split(/[,;\n\/]+/).map(p => p.trim().toLowerCase()).filter(Boolean);

        if (rawParts.length > cleanedParts.length) {
            cardsWithInternalDups.push({
                card,
                originalMeaning: card.vietnamese,
                cleanedMeaning: cleaned
            });
        }
    });

    return cardsWithInternalDups;
}

/**
 * Gộp 2 thẻ trùng lặp thành 1 thẻ hoàn hảo duy nhất (Bảo toàn tiến trình SRS cao nhất)
 * Áp dụng làm sạch và khử trùng nghĩa tiếng Việt triệt để (cleanAndDeduplicateVietnamese)
 */
export function mergeDuplicateCards(cardA, cardB) {
    // Xác định thẻ chính (Primary): Ưu tiên thẻ có trạng thái học cao hơn, stability lớn hơn hoặc reps nhiều hơn
    let primary = cardA;
    let secondary = cardB;

    const rankStatus = (st) => (st === 'Mastered' ? 3 : (st === 'Learning' ? 2 : 1));
    const rankA = rankStatus(cardA.srsStatus) * 1000 + (cardA.stability || 1) * 10 + (cardA.reps || 0);
    const rankB = rankStatus(cardB.srsStatus) * 1000 + (cardB.stability || 1) * 10 + (cardB.reps || 0);

    if (rankB > rankA) {
        primary = cardB;
        secondary = cardA;
    }

    // Gộp nghĩa tiếng Việt với thuật toán khử trùng Case-insensitive
    const mergedVietnamese = cleanAndDeduplicateVietnamese(`${primary.vietnamese}, ${secondary.vietnamese}`);

    // Lấy câu ví dụ dài và đầy đủ nhất
    const exA = (primary.example || '').trim();
    const exB = (secondary.example || '').trim();
    const mergedExample = exA.length >= exB.length ? exA : exB;

    // Gộp toàn bộ tags độc nhất
    const tagSet = new Set();
    [primary.tags, secondary.tags].forEach(t => {
        if (!t) return;
        if (Array.isArray(t)) {
            t.forEach(item => tagSet.add(item));
        } else if (typeof t === 'string') {
            t.split(/[,;\n]+/).map(item => item.trim()).filter(Boolean).forEach(item => tagSet.add(item));
        }
    });

    // Lấy phiên âm chuẩn nhất
    const mergedPron = primary.pronunciation || secondary.pronunciation || '';

    // Thẻ được gộp hoàn chỉnh
    const mergedCard = {
        ...primary,
        vietnamese: mergedVietnamese || primary.vietnamese,
        example: mergedExample || primary.example,
        pronunciation: mergedPron,
        tags: Array.from(tagSet),
        isStarred: primary.isStarred || secondary.isStarred,
        updatedAt: Date.now(),
        contentUpdatedAt: nextRevision({ contentUpdatedAt: Math.max(primary.contentUpdatedAt || primary.updatedAt || 0, secondary.contentUpdatedAt || secondary.updatedAt || 0) }, 'contentUpdatedAt'),
        flagsUpdatedAt: nextRevision({ flagsUpdatedAt: Math.max(primary.flagsUpdatedAt || primary.updatedAt || 0, secondary.flagsUpdatedAt || secondary.updatedAt || 0) }, 'flagsUpdatedAt')
    };

    return {
        mergedCard,
        deletedCardId: secondary.id
    };
}
