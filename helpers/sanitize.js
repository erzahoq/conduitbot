// sanitize.js
const fs = require('fs');
const path = require('path');

// === cleanExtraNewlines (same as logger.js) ===
function cleanExtraNewlines(text) {
    if (!text) return "";

    // 1. Remove lines that are only spaces/tabs
    text = text.replace(/^[ \t]+$/gm, "");

    // 2. Collapse multiple blank lines into ONE blank line
    text = text.replace(/\n{3,}/g, "\n\n");

    return text.trim();
}

// === replacements (shared) ===
const replacementsRaw = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../data', 'replacements.json'), 'utf8')
);

const replacementPatterns = Object.entries(replacementsRaw).map(([pattern, replacement]) => ({
    regex: new RegExp(pattern, 'gi'),
    replacement,
}));

function applyReplacements(text) {
    if (!text) return '';

    let result = text;
    for (const { regex, replacement } of replacementPatterns) {
        result = result.replace(regex, replacement);
    }
    return result;
}

// For single messages (live logging)
function sanitizeMessage(text) {
    if (!text) return '';

    let result = applyReplacements(text);

    // Trim and collapse internal whitespace a bit so logs are cleaner
    result = result.replace(/\s+/g, ' ').trim();

    return result;
}

module.exports = {
    cleanExtraNewlines,
    applyReplacements,
    sanitizeMessage,
};
