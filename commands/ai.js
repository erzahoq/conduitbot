const { SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const cooldowns = new Map(); // userId → last-used timestamp

// ====== markov setup — learn from messages ======

let markovChain = {};
let markovStartKeys = [];
const order = 2; // adjust if you want

let lastReloadTime = 0; // timestamp of the last rebuild
const reloadInterval = 60 * 60 * 1000; // 1 hour in ms (change for testing)

// build markov chain from text (higher-order)
function buildHigherOrderMarkovChain(text, order = 2) {
    const sentences = text
        .split(/(?<=[.!?])\s+|\n+/)
        .map(s => s.trim())
        .filter(Boolean);

    const chain = {};
    const startKeys = [];

    for (const sentence of sentences) {
        const words = sentence.split(/\s+/);
        if (words.length <= order) continue;

        const firstKey = words.slice(0, order).join(' ');
        startKeys.push(firstKey);

        for (let i = 0; i <= words.length - order - 1; i++) {
            const key = words.slice(i, i + order).join(' ');
            const value = words[i + order];

            if (!chain[key]) chain[key] = [];
            chain[key].push(value);
        }
    }

    return { chain, startKeys };
}

function generateTextHigherOrder(markovChain, startKeys, order, length = 200) {
    const keys = startKeys && startKeys.length ? startKeys : Object.keys(markovChain);
    if (!keys.length) return "(no data lol)";

    let currentKey = keys[Math.floor(Math.random() * keys.length)];
    let result = currentKey.split(' ');

    for (let i = 0; i < length; i++) {
        const possibleNext = markovChain[currentKey];
        if (!possibleNext || !possibleNext.length) break;

        const next = possibleNext[Math.floor(Math.random() * possibleNext.length)];
        result.push(next);

        currentKey = result.slice(result.length - order, result.length).join(' ');

        if (result.length > order + 4) {
            const lastWord = result[result.length - 1];
            if (/[.!?]$/.test(lastWord)) break;
        }
    }

    let sentence = result.join(' ').trim();
    if (sentence.length > 0) {
        sentence = sentence[0].toUpperCase() + sentence.slice(1);
    }

    return sentence;
}

// replaced: fix unbalanced parentheses-only with a general fixer for (), " and '
function fixUnbalancedPairs(text) {
    // 1) parentheses: prepend '(' for unmatched ')' and append ')' for unmatched '('
    let parenBalance = 0;
    let missingOpensAtStart = 0;

    for (const ch of text) {
        if (ch === '(') {
            parenBalance++;
        } else if (ch === ')') {
            if (parenBalance === 0) {
                missingOpensAtStart++;
            } else {
                parenBalance--;
            }
        }
    }

    let prefix = '('.repeat(missingOpensAtStart);
    let suffix = ')'.repeat(parenBalance);
    text = prefix + text + suffix;

    // 2) double quotes: if odd count, decide to prepend or append using context
    const dqIndices = [];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '"') dqIndices.push(i);
    }
    if (dqIndices.length % 2 === 1) {
        const firstIdx = dqIndices[0];
        const before = firstIdx > 0 ? text[firstIdx - 1] : null;
        // heuristic: if char before first quote is non-whitespace and not an opening bracket,
        // treat the first quote as a closing quote and prepend a quote at start; otherwise append at end.
        const shouldPrepend = !!before && !/[\s\(\[\{]/.test(before);
        if (shouldPrepend) {
            text = '"' + text;
        } else {
            text = text + '"';
        }
    }

    // 3) single quotes: ignore apostrophes inside words (like don't). Balance the rest similarly.
    const sqIndices = [];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === "'") {
            const prev = i > 0 ? text[i - 1] : '';
            const next = i < text.length - 1 ? text[i + 1] : '';
            const prevIsAlnum = /[A-Za-z0-9]/.test(prev);
            const nextIsAlnum = /[A-Za-z0-9]/.test(next);
            // skip apostrophes embedded in words
            if (prevIsAlnum && nextIsAlnum) continue;
            sqIndices.push(i);
        }
    }
    if (sqIndices.length % 2 === 1) {
        const firstIdx = sqIndices[0];
        const before = firstIdx > 0 ? text[firstIdx - 1] : null;
        const shouldPrepend = !!before && !/[\s\(\[\{]/.test(before);
        if (shouldPrepend) {
            text = "'" + text;
        } else {
            text = text + "'";
        }
    }

    return text;
}

// ====== reload chain from file (rate-limited) ======
function reloadMarkovFromFile(force = false) {
    const now = Date.now();

    if (!force && now - lastReloadTime < reloadInterval) {
        // too soon — skipping rebuild
        return;
    }

    lastReloadTime = now;

    let textData;
    try {
        textData = fs.readFileSync(
            path.join(__dirname, '..', 'data', 'message_log.txt'),
            'utf8'
        );
    } catch (err) {
        console.error('[markovai] Failed reading message_log.txt:', err);
        markovChain = {};
        markovStartKeys = [];
        return;
    }

    const built = buildHigherOrderMarkovChain(textData, order);
    markovChain = built.chain;
    markovStartKeys = built.startKeys;

    console.log(
        `[markovai] Rebuilt Markov chain (${Object.keys(markovChain).length} keys)`
    );
}

// initial build on startup
reloadMarkovFromFile(true);

// ====== slash command registration ======

module.exports = {
    data: new SlashCommandBuilder()
        .setName('markovai')
        .setDescription('get cursed sentence from server chat')
        .addStringOption(option =>
            option
                .setName('prompt')
                .setDescription('word or phrase to influence the response')
                .setRequired(false)
        ),

    async execute(interaction) {

        // try reload (rate-limited)
        reloadMarkovFromFile();

        // per-user cooldown
        const userId = interaction.user.id;
        const now = Date.now();
        const cooldownAmount = 60 * 1000; // 1 minute

        if (cooldowns.has(userId)) {
            const expirationTime = cooldowns.get(userId) + cooldownAmount;

            if (now < expirationTime) {
                const expirationUnix = Math.floor(expirationTime / 1000);

                return interaction.reply({
                    content: [
                        '🕒 recharging...',
                        `-# you can use this again <t:${expirationUnix}:R>.`
                    ].join('\n'),
                    ephemeral: true
                });
            }
        }

        cooldowns.set(userId, now);

        if (!markovChain || !Object.keys(markovChain).length) {
            return interaction.reply({
                content: "i don't have any messages to learn from yet :(",
                ephemeral: true,
            });
        }

        // handle optional prompt to bias start keys
        const prompt = interaction.options.getString('prompt');
        let candidateStartKeys = markovStartKeys;

        if (prompt && prompt.trim().length > 0) {
            const lowerPrompt = prompt.toLowerCase();
            const allKeys = Object.keys(markovChain);

            const matchedKeys = allKeys.filter(key =>
                key.toLowerCase().includes(lowerPrompt)
            );

            if (matchedKeys.length > 0) {
                candidateStartKeys = matchedKeys;
            }
        }

        // generate sentence
        const generatedText = generateTextHigherOrder(
            markovChain,
            candidateStartKeys,
            order,
            Math.floor(Math.random() * 7 + 10)
        );

        // fix unbalanced parentheses/quotes before replying
        const fixedText = fixUnbalancedPairs(generatedText);

        await interaction.reply(fixedText);
    }
};
