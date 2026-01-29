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

// --- Moderation filter (blocked.json + optional env fallback) ---

// Load blocked patterns from JSON
let blockedConfig = {
    enabled: true,
    mode: "drop", // "drop" or "replace"
    regex: [],
    phrases: [],
    options: {
        check_normalized: true,
        detect_spam: true,
    }
};

try {
    const blockedRaw = JSON.parse(
        fs.readFileSync(path.join(__dirname, '../data', 'blocked.json'), 'utf8')
    );

    blockedConfig = {
        enabled: blockedRaw?.enabled ?? true,
        mode: blockedRaw?.mode ?? "drop",
        regex: Array.isArray(blockedRaw?.regex) ? blockedRaw.regex : [],
        phrases: Array.isArray(blockedRaw?.phrases) ? blockedRaw.phrases : [],
        options: {
            check_normalized: blockedRaw?.options?.check_normalized ?? true,
            detect_spam: blockedRaw?.options?.detect_spam ?? true,
        }
    };
} catch (e) {
    // If blocked.json is missing/invalid, fall back to defaults (still safe)
}

// Compile JSON regex patterns
const JSON_BLOCK_PATTERNS = blockedConfig.regex
    .filter(s => typeof s === "string" && s.length > 0)
    .map(s => new RegExp(s, "i"));

// Lowercase phrase list
const JSON_BLOCK_PHRASES = blockedConfig.phrases
    .filter(s => typeof s === "string" && s.trim().length > 0)
    .map(s => s.trim().toLowerCase());

// Normalize text to catch simple obfuscation:
// - lowercases
// - strips diacritics
// - removes most punctuation/spaces
// - collapses repeats
function normalizeForFilter(input) {
    if (!input) return "";

    let t = input.toLowerCase();

    // Remove diacritics (é -> e)
    t = t.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

    // Replace common separators with nothing (so "n s f w" still matches)
    t = t.replace(/[\s\.\-_\*\~`'"“”‘’()\[\]{}<>|\\/]+/g, "");

    // Collapse long character runs (so "sexxxx" -> "sexx")
    t = t.replace(/(.)\1{3,}/g, "$1$1");

    return t;
}

// Optional env-based patterns (still supported)
function loadBlocklistRegexFromEnv() {
    try {
        const raw = process.env.BLOCKLIST_REGEX;
        if (!raw) return [];
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return [];
        return arr
            .filter(s => typeof s === "string" && s.length > 0)
            .map(s => new RegExp(s, "i"));
    } catch {
        return [];
    }
}
const ENV_BLOCK_PATTERNS = loadBlocklistRegexFromEnv();

// Heuristic spam checks (not wordlist-based)
function looksLikeSpam(message) {
    const text = message || "";

    // lots of @ mentions
    const mentionCount = (text.match(/<@!?(\d+)>/g) || []).length;
    if (mentionCount >= 6) return true;

    // too many links
    const linkCount = (text.match(/https?:\/\/\S+/gi) || []).length;
    if (linkCount >= 5) return true;

    // very long repeated chars (e.g. "!!!!!!!!!!!!!" / "aaaaaa...")
    if (/(.)\1{12,}/.test(text)) return true;

    return false;
}

function phraseBlocked(lowerText, normalizedText) {
    for (const p of JSON_BLOCK_PHRASES) {
        if (lowerText.includes(p)) return true;
    }
    if (blockedConfig.options.check_normalized) {
        for (const p of JSON_BLOCK_PHRASES) {
            const pNorm = normalizeForFilter(p);
            if (pNorm && normalizedText.includes(pNorm)) return true;
        }
    }
    return false;
}

// Main “should we block?” check.
// Returns { blocked: boolean, reason: string|null, mode: "drop"|"replace" }
function shouldBlockMessage(originalText) {
    if (!blockedConfig.enabled) return { blocked: false, reason: null, mode: blockedConfig.mode };

    const text = originalText || "";
    if (!text.trim()) return { blocked: false, reason: null, mode: blockedConfig.mode };

    // 1) Spam heuristics
    if (blockedConfig.options.detect_spam && looksLikeSpam(text)) {
        return { blocked: true, reason: "spam", mode: blockedConfig.mode };
    }

    // 2) Pattern checks on raw text
    for (const re of JSON_BLOCK_PATTERNS) {
        if (re.test(text)) return { blocked: true, reason: "blocked_json_raw", mode: blockedConfig.mode };
    }
    for (const re of ENV_BLOCK_PATTERNS) {
        if (re.test(text)) return { blocked: true, reason: "blocked_env_raw", mode: blockedConfig.mode };
    }

    // 3) Pattern checks on normalized text (spacing/punctuation bypass)
    const normalized = blockedConfig.options.check_normalized ? normalizeForFilter(text) : "";
    if (blockedConfig.options.check_normalized) {
        for (const re of JSON_BLOCK_PATTERNS) {
            if (re.test(normalized)) return { blocked: true, reason: "blocked_json_norm", mode: blockedConfig.mode };
        }
        for (const re of ENV_BLOCK_PATTERNS) {
            if (re.test(normalized)) return { blocked: true, reason: "blocked_env_norm", mode: blockedConfig.mode };
        }
    }

    // 4) Phrase checks
    const lower = text.toLowerCase();
    if (phraseBlocked(lower, normalized)) {
        return { blocked: true, reason: "blocked_phrase", mode: blockedConfig.mode };
    }

    return { blocked: false, reason: null, mode: blockedConfig.mode };
}


module.exports = {
    cleanExtraNewlines,
    applyReplacements,
    sanitizeMessage,
    shouldBlockMessage
};
