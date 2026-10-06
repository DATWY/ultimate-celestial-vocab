// src/core/utils/sanitize.js
// Ultra-safe HTML escaping and data sanitization for commercial security integrity

/**
 * Escapes unsafe HTML characters in a string to prevent Cross-Site Scripting (XSS).
 * @param {string|any} str - Input string or primitive
 * @returns {string} Sanitized string safe for HTML interpolation
 */
export function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    const stringVal = String(str);
    return stringVal
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Sanitizes an array of tags, escaping each individual tag.
 * @param {string[]} tags 
 * @returns {string[]}
 */
export function sanitizeTags(tags) {
    if (!Array.isArray(tags)) return [];
    return tags.map(tag => escapeHTML(tag));
}
