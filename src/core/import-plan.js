import { parseVocabularyTsv } from './tabular.js';
import { canonicalEnglish, isDuplicateCard, cleanAndDeduplicateVietnamese } from './dedup.js';
import { nextRevision } from './card-merge.js';

export function planVocabularyImport(text, vocabulary, makeId = () => crypto.randomUUID(), now = Date.now()) {
    const parsed = parseVocabularyTsv(text);
    const byEnglish = new Map(), additions = new Map(), updates = new Map();
    let skipped = 0;
    for (const card of vocabulary.filter(card => !card.isDeleted)) {
        const key = canonicalEnglish(card.english);
        if (!byEnglish.has(key)) byEnglish.set(key, []);
        byEnglish.get(key).push({ ...card, tags: [...(card.tags || [])] });
    }
    for (const { card: raw } of parsed.rows) {
        const incoming = { ...raw, vietnamese: cleanAndDeduplicateVietnamese(raw.vietnamese) };
        const key = canonicalEnglish(incoming.english);
        const candidates = byEnglish.get(key) || [];
        const matched = candidates.find(card => isDuplicateCard(incoming, card).isDuplicate);
        if (matched) {
            const before = JSON.stringify(matched);
            if (incoming.example.trim().length > (matched.example || '').trim().length) matched.example = incoming.example;
            if (!matched.pronunciation?.trim() && incoming.pronunciation) matched.pronunciation = incoming.pronunciation;
            matched.tags = [...new Set([...(matched.tags || []), ...incoming.tags])];
            for (const field of ['notes', 'exampleMeaning', 'synonyms', 'antonyms', 'collocations']) {
                if (!matched[field] && incoming[field]) matched[field] = incoming[field];
            }
            if (before === JSON.stringify(matched)) { skipped++; continue; }
            matched.contentUpdatedAt = nextRevision(matched, 'contentUpdatedAt', now);
            matched.updatedAt = Math.max(now, matched.updatedAt || 0, matched.contentUpdatedAt);
            // A later row can enrich an earlier new row before either is saved.
            if (!additions.has(matched.id)) updates.set(matched.id, matched);
        } else {
            const card = { ...incoming, id: makeId(), updatedAt: now, contentUpdatedAt: now,
                srsUpdatedAt: now, flagsUpdatedAt: now };
            candidates.push(card); byEnglish.set(key, candidates); additions.set(card.id, card);
        }
    }
    return { newItems: [...additions.values()], updateItems: [...updates.values()], skipped, errors: parsed.errors };
}
