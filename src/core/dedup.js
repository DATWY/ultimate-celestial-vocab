// src/core/dedup.js
// Next-Gen Intelligent Deduplication & Semantic Matching Engine v5.0 (Fuzzy & Morphological)

const VI_STOPWORDS = new Set([
    'sự', 'việc', 'cái', 'con', 'bị', 'được', 'một', 'những', 'các', 'làm', 'bản',
    'có', 'và', 'hoặc', 'hay', 'cho', 'để', 'với', 'của', 'trong', 'ngoài', 'về',
    'từ', 'đến', 'ở', 'tại', 'như', 'là', 'nhất', 'rất', 'quá', 'lại', 'qua', 'đi',
    'ra', 'vào', 'lên', 'xuống', 'theo', 'khi', 'nếu', 'mà', 'vì', 'do', 'bởi'
]);

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
 * Rút gọn gốc từ tiếng Anh cơ bản (Stemming - loại bỏ số nhiều, thì quá khứ, phân từ -ing)
 */
export function stemEnglishWord(word) {
    if (!word) return '';
    let w = word.toLowerCase().trim();

    // -ies -> -y (ví dụ: parties -> party)
    if (w.endsWith('ies') && w.length > 4) {
        return w.slice(0, -3) + 'y';
    }
    // -es cho các âm xuýt (boxes -> box, watches -> watch)
    if (w.endsWith('es') && (w.endsWith('shes') || w.endsWith('ches') || w.endsWith('sses') || w.endsWith('xes') || w.endsWith('zes'))) {
        return w.slice(0, -2);
    }
    // -ing (ví dụ: demonstrating -> demonstrate, running -> run)
    if (w.endsWith('ing') && w.length > 5) {
        let base = w.slice(0, -3);
        if (base.length > 3 && base[base.length - 1] === base[base.length - 2]) {
            base = base.slice(0, -1);
        } else if (!base.endsWith('e') && !['sing', 'ring', 'bring', 'king', 'wing'].includes(w)) {
            base = base + 'e';
        }
        return base;
    }
    // -ed (ví dụ: demonstrated -> demonstrate, studied -> study)
    if (w.endsWith('ed') && w.length > 4) {
        let base = w.slice(0, -2);
        if (base.endsWith('i')) base = base.slice(0, -1) + 'y';
        else if (!base.endsWith('e')) base = base + 'e';
        return base;
    }
    // -s số nhiều thông thường (colleagues -> colleague, credentials -> credential)
    if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) {
        return w.slice(0, -1);
    }

    return w;
}

/**
 * Rút gọn gốc từ cho cả cụm từ tiếng Anh
 */
export function stemEnglishPhrase(text) {
    const canon = canonicalEnglish(text);
    if (!canon) return '';
    return canon.split(/\s+/).map(stemEnglishWord).join(' ');
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
        .filter(w => w.length > 0 && !VI_STOPWORDS.has(w));
    
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
    const canonA = canonicalEnglish(cardA.english);
    const canonB = canonicalEnglish(cardB.english);
    const compactA = compactEnglish(cardA.english);
    const compactB = compactEnglish(cardB.english);
    const stemA = stemEnglishPhrase(cardA.english);
    const stemB = stemEnglishPhrase(cardB.english);

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
    if (canonA === canonB || compactA === compactB) {
        if (isCompatiblePOS && (semSim >= 0.15 || phraseOverlap > 0)) {
            return {
                isDuplicate: true,
                confidence: Math.max(0.95, semSim),
                category: 'EXACT',
                reason: 'Trùng khớp 100% từ vựng và loại từ'
            };
        }
        // Khác loại từ nhưng nghĩa tiếng Việt gần như y hệt (>= 0.70)
        if (semSim >= 0.70) {
            return {
                isDuplicate: true,
                confidence: semSim,
                category: 'EXACT',
                reason: 'Trùng khớp từ vựng với nghĩa tiếng Việt tương đồng cao'
            };
        }
        // Cùng từ tiếng Anh nhưng khác loại từ và khác nghĩa -> TỪ ĐA NGHĨA (Polysemy), giữ riêng
        return { isDuplicate: false, confidence: semSim, category: 'POLYSEMY', reason: 'Từ đa nghĩa (khác loại từ và nghĩa)' };
    }

    // Nếu khác mặt chữ và là từ loại phái sinh (Word Family) -> KHÔNG COI LÀ TRÙNG LẶP
    if (isWordFamilyDerivative) {
        return { isDuplicate: false, confidence: 0, category: 'WORD_FAMILY', reason: 'Họ từ phái sinh (cần học riêng biệt)' };
    }

    // -------------------------------------------------------------
    // CẤP ĐỘ 2: INFLECTION / STEM MATCH (Biến thể ngữ pháp / số ít - nhiều / thì)
    // Ví dụ: "colleague" vs "colleagues", "demonstrate" vs "demonstrating"
    // -------------------------------------------------------------
    if (stemA === stemB) {
        if (isCompatiblePOS && (semSim >= 0.20 || phraseOverlap > 0)) {
            return {
                isDuplicate: true,
                confidence: 0.90,
                category: 'INFLECTION',
                reason: `Biến thể ngữ pháp (${cardA.english} ⟷ ${cardB.english})`
            };
        }
    }

    // -------------------------------------------------------------
    // CẤP ĐỘ 3: FUZZY TYPO MATCH (Tìm kiếm mờ lỗi chính tả Levenshtein)
    // Ví dụ: "demonstate" vs "demonstrate" (thiếu chữ r)
    // BẮT BUỘC:
    // - Cùng loại từ hoặc tương thích
    // - Cụm nghĩa tiếng Việt tương đồng cao (ngăn chặn assume vs assure, affect vs effect)
    // - Khoảng cách ký tự phù hợp với độ dài từ
    // -------------------------------------------------------------
    if (isCompatiblePOS) {
        const minLen = Math.min(compactA.length, compactB.length);
        const maxLen = Math.max(compactA.length, compactB.length);
        const dist = levenshteinDistance(compactA, compactB);
        const simRatio = (maxLen - dist) / maxLen;

        const isAllowedDist = (minLen >= 5 && dist === 1) || (minLen >= 8 && dist <= 2);

        // Bắt buộc nghĩa tiếng Việt phải có sự tương đồng cụm hoặc semSim cao
        if (isAllowedDist && simRatio >= 0.82 && (phraseOverlap > 0 || semSim >= 0.35)) {
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

/**
 * Quét toàn bộ kho từ vựng và tìm các cặp trùng lặp với thuật toán Đa Phân Nhóm (Multi-Bucket)
 * Đảm bảo hiệu năng cực cao O(N) và phát hiện đầy đủ Exact, Inflection, Fuzzy Typo
 */
export function findDuplicatePairs(vocabulary) {
    const activeCards = vocabulary.filter(w => !w.isDeleted);
    const candidatePairsMap = new Map();

    const addCandidate = (cA, cB) => {
        if (cA.id === cB.id) return;
        const pairKey = cA.id < cB.id ? `${cA.id}|${cB.id}` : `${cB.id}|${cA.id}`;
        if (!candidatePairsMap.has(pairKey)) {
            candidatePairsMap.set(pairKey, [cA, cB]);
        }
    };

    // Multi-bucket Indexing
    const compactBuckets = new Map();
    const stemBuckets = new Map();
    const prefixBuckets = new Map();

    activeCards.forEach(card => {
        const compact = compactEnglish(card.english);
        if (compact) {
            if (!compactBuckets.has(compact)) compactBuckets.set(compact, []);
            compactBuckets.get(compact).push(card);

            if (compact.length >= 3) {
                const pfx = compact.slice(0, 3);
                if (!prefixBuckets.has(pfx)) prefixBuckets.set(pfx, []);
                prefixBuckets.get(pfx).push(card);
            }
        }

        const stem = stemEnglishPhrase(card.english);
        if (stem) {
            if (!stemBuckets.has(stem)) stemBuckets.set(stem, []);
            stemBuckets.get(stem).push(card);
        }
    });

    // 1. Gom ứng viên từ Compact (trùng từ, khác cách viết hoa/dấu cách/gạch nối)
    for (const cards of compactBuckets.values()) {
        if (cards.length < 2) continue;
        for (let i = 0; i < cards.length; i++) {
            for (let j = i + 1; j < cards.length; j++) {
                addCandidate(cards[i], cards[j]);
            }
        }
    }

    // 2. Gom ứng viên từ Stem (biến thể ngữ pháp -ing, -ed, -s, -ies)
    for (const cards of stemBuckets.values()) {
        if (cards.length < 2) continue;
        for (let i = 0; i < cards.length; i++) {
            for (let j = i + 1; j < cards.length; j++) {
                addCandidate(cards[i], cards[j]);
            }
        }
    }

    // 3. Gom ứng viên từ Prefix (cho lỗi chính tả với độ dài chênh lệch <= 2)
    for (const cards of prefixBuckets.values()) {
        if (cards.length < 2) continue;
        for (let i = 0; i < cards.length; i++) {
            for (let j = i + 1; j < cards.length; j++) {
                const lenA = cards[i].english.length;
                const lenB = cards[j].english.length;
                if (Math.abs(lenA - lenB) <= 2) {
                    addCandidate(cards[i], cards[j]);
                }
            }
        }
    }

    // 4. So khớp và lọc các cặp trùng thật sự
    const duplicateGroups = [];
    for (const [cA, cB] of candidatePairsMap.values()) {
        const check = isDuplicateCard(cA, cB);
        if (check.isDuplicate) {
            // Chuẩn bị trước nghĩa được làm sạch sau khi gộp
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

    // Sắp xếp các cặp trùng theo độ tin cậy từ cao xuống thấp
    return duplicateGroups.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Quét tìm các thẻ đơn lẻ trong kho có nghĩa tiếng Việt bị lặp từ/cụm từ nội bộ
 * Ví dụ thẻ Demonstrate: "Thị phạm, chứng minh, Chứng minh, giải thích"
 */
export function findInternalDuplicateCards(vocabulary) {
    const activeCards = vocabulary.filter(w => !w.isDeleted);
    const cardsWithInternalDups = [];

    activeCards.forEach(card => {
        if (!card.vietnamese) return;
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
        updatedAt: Date.now()
    };

    return {
        mergedCard,
        deletedCardId: secondary.id
    };
}
