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

function tokenize(text) {
    // Matches:
    // - URLs
    // - Discord mentions/emoji-like tokens (<:name:id>, <@id>, etc.)
    // - Words with apostrophes (don't, I'm)
    // - Punctuation as separate tokens (.,!?;:()[]{}" etc.)
    //
    // Note: This is intentionally "simple but good".
    const re =
        /https?:\/\/\S+|<a?:\w+:\d+>|<[@#&]!?[\d]+>|[A-Za-z0-9]+(?:'[A-Za-z0-9]+)*|[.,!?;:()[\]{}"“”‘’\-–—…]/g;

    return text.match(re) ?? [];
}

function detokenize(tokens) {
    let out = '';
    let lastWasOpeningQuote = false;

    for (const t of tokens) {

        // Closing punctuation: no space before
        if (/^[.,!?;:\)\]\}…]+$/.test(t)) {
            out += t;
            lastWasOpeningQuote = false;
            continue;
        }

        // Opening brackets
        if (/^[\(\[\{]+$/.test(t)) {
            out += (out && !out.endsWith(' ') ? ' ' : '') + t;
            lastWasOpeningQuote = false;
            continue;
        }

        // Opening quotes
        if (/^[“"‘']$/.test(t)) {
            out += (out && !out.endsWith(' ') ? ' ' : '') + t;
            lastWasOpeningQuote = true;
            continue;
        }

        // Closing quotes
        if (/^[”"’']$/.test(t) && lastWasOpeningQuote === false) {
            out += t;
            continue;
        }

        // Normal word
        if (lastWasOpeningQuote) {
            out += t; // no space after opening quote
            lastWasOpeningQuote = false;
        } else {
            out += (out && !out.endsWith(' ') ? ' ' : '') + t;
        }
    }

    return out.replace(/\s{2,}/g, ' ').trim();
}


function countUniqueTokens(markovChain) {
    const tokens = new Set();

    for (const key of Object.keys(markovChain)) {
        // tokens from the key
        key.split(' ').forEach(t => tokens.add(t));

        // tokens from next-token map
        for (const next of Object.keys(markovChain[key])) {
            tokens.add(next);
        }
    }

    return tokens.size;
}


//prevent repeats
let corpusSentencesSet = new Set();

function normalizeForMatch(s) {
  return s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSentenceSet(text) {
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => normalizeForMatch(s))
    .filter(Boolean);

  return new Set(sentences);
}


function generateNonCopiedSentence(candidateStartKeys, targetLength, genOpts = {}, tries = 12) {
  let lastFixed = null;

  for (let t = 0; t < tries; t++) {
    const generatedText = generateTextHigherOrder(
      markovChain,
      candidateStartKeys,
      order,
      targetLength,
      genOpts
    );

    const fixedText = fixUnbalancedPairs(generatedText);
    lastFixed = fixedText;

    const norm = normalizeForMatch(fixedText);

    if (!corpusSentencesSet || corpusSentencesSet.size === 0) return fixedText;

    if (!corpusSentencesSet.has(norm)) {
      if (t > 0) {
        console.log(`[markovai] Regenerated ${t} time${t === 1 ? '' : 's'} to avoid copying`);
      }
      return fixedText;
    }
  }

  console.log('[markovai] Returned fallback after max regenerations');
  return lastFixed ?? "(no data lol)";
}



function weightedRandomChoice(countMap, temperature = 1.0) {
  const entries = Object.entries(countMap);
  if (!entries.length) return null;

  // temperature transform:
  // temp < 1 => sharpen (more likely common tokens)
  // temp > 1 => flatten (rarer tokens show up more)
  const temp = Math.max(0.05, temperature);

  let total = 0;
  const weights = entries.map(([token, count]) => {
    const w = Math.pow(count, 1 / temp);
    total += w;
    return [token, w];
  });

  let r = Math.random() * total;
  for (const [token, w] of weights) {
    r -= w;
    if (r <= 0) return token;
  }
  return weights[weights.length - 1][0];
}


function countTotalTokenOccurrences(markovChain) {
    let total = 0;

    for (const nextMap of Object.values(markovChain)) {
        for (const count of Object.values(nextMap)) {
            total += count;
        }
    }

    return total;
}


// build markov chain from text (higher-order)
function buildHigherOrderMarkovChain(text, order = 2) {
    const sentences = text
        .split(/(?<=[.!?])\s+|\n+/)
        .map(s => s.trim())
        .filter(Boolean);

    const chain = {};
    const startKeys = [];

    for (const sentence of sentences) {
        const words = tokenize(sentence);
        if (words.length <= order) continue;

        const firstKey = words.slice(0, order).join(' ');
        startKeys.push(firstKey);

        for (let i = 0; i <= words.length - order - 1; i++) {
            const key = words.slice(i, i + order).join(' ');
            const next = words[i + order];

            if (!chain[key]) chain[key] = {};
            chain[key][next] = (chain[key][next] || 0) + 1;
        }
    }

    return { chain, startKeys };
}

function generateTextHigherOrder(markovChain, startKeys, order, length = 200, opts = {}) {
    const keys = startKeys && startKeys.length ? startKeys : Object.keys(markovChain);
    if (!keys.length) return "(no data lol)";

    let currentKey = keys[Math.floor(Math.random() * keys.length)];
    let result = currentKey.split(' ');

    for (let i = 0; i < length; i++) {
        const possibleNextMap = markovChain[currentKey];
        if (!possibleNextMap) break;

        const next = weightedRandomChoice(possibleNextMap, opts.temperature ?? 1.0);
        if (!next) break;

        result.push(next);
        currentKey = result.slice(result.length - order).join(' ');

        if (result.length > order + 4) {
            const lastWord = result[result.length - 1];
            if (/^[.!?]$/.test(lastWord)) break;
        }
    }

    let sentence = detokenize(result);
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
    
    corpusSentencesSet = buildSentenceSet(textData);
    console.log(`[markovai] Corpus sentence set: ${corpusSentencesSet.size} sentences`);


    const built = buildHigherOrderMarkovChain(textData, order);
    markovChain = built.chain;
    markovStartKeys = built.startKeys;

    const uniqueTokenCount = countUniqueTokens(markovChain);
    const totalTokens = countTotalTokenOccurrences(markovChain);

    console.log(
        `[markovai] Rebuilt Markov chain — ${Object.keys(markovChain).length} keys, ${uniqueTokenCount} unique tokens, ${totalTokens} total token transitions`
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
            option.setName('prompt')
            .setDescription('word or phrase to influence the response')
            .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('length')
            .setDescription('how long the response should be')
            .addChoices(
                { name: 'short', value: 'short' },
                { name: 'medium', value: 'medium' },
                { name: 'long', value: 'long' }
            )
            .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('chaos')
            .setDescription('how chaotic the word choice should be')
            .addChoices(
                { name: 'low', value: 'low' },
                { name: 'normal', value: 'normal' },
                { name: 'high', value: 'high' }
            )
            .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('mode')
            .setDescription('style preset')
            .addChoices(
                { name: 'coherent', value: 'coherent' },
                { name: 'cursed', value: 'cursed' },
                { name: 'gremlin', value: 'gremlin' }
            )
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
        const lengthOpt = interaction.options.getString('length') ?? 'medium';
        const chaosOpt = interaction.options.getString('chaos') ?? 'normal';
        const modeOpt = interaction.options.getString('mode') ?? 'cursed';
        const userOpt = interaction.options.getUser('user'); // can be null

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

        const targetLength = pickLength(lengthOpt, modeOpt);
        const genOpts = { temperature: pickTemperature(chaosOpt, modeOpt) };

        const fixedText = generateNonCopiedSentence(candidateStartKeys, targetLength, genOpts);
        await interaction.reply(fixedText);

    }
};

//user options
function pickLength(lengthOpt, modeOpt) {
  // You can tweak these numbers freely.
  if (lengthOpt === 'short') return Math.floor(Math.random() * 5 + 8);   // 8–12
  if (lengthOpt === 'long')  return Math.floor(Math.random() * 18 + 22); // 22–39
  return Math.floor(Math.random() * 9 + 12); // medium: 12–20
}

function pickTemperature(chaosOpt, modeOpt) {
  let t = 1.0;
  if (chaosOpt === 'low') t = 0.7;
  if (chaosOpt === 'high') t = 1.35;

  // Mode nudges (optional)
  if (modeOpt === 'coherent') t *= 0.85;
  if (modeOpt === 'gremlin') t *= 1.2;

  return Math.max(0.05, t);
}

