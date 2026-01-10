// tools/export_markov_graph.js
// Run with: node tools/export_markov_graph.js "optional prompt"
const fs = require('fs');
const path = require('path');

// Load/build your chain however you want.
// Easiest: copy/paste or require the builder functions from your bot file.
// For now, assume you have message_log.txt like your bot.

const order = 2;

function tokenize(text) {
  const re =
    /https?:\/\/\S+|<a?:\w+:\d+>|<[@#&]!?[\d]+>|[A-Za-z0-9]+(?:'[A-Za-z0-9]+)*|[.,!?;:()[\]{}"“”‘’\-–—…]/g;
  return text.match(re) ?? [];
}

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

function pickSeedKeys(markovChain, prompt) {
  const allKeys = Object.keys(markovChain);
  if (!prompt) return allKeys;

  const p = prompt.toLowerCase();
  const matched = allKeys.filter(k => k.toLowerCase().includes(p));
  return matched.length ? matched : allKeys;
}

function buildStateEdges(markovChain, order) {
  // produces edges of key -> nextKey with weight=count
  const edges = []; // {source, target, weight, nextToken}
  for (const [key, nextMap] of Object.entries(markovChain)) {
    const parts = key.split(' ');
    if (parts.length !== order) continue;

    for (const [nextToken, count] of Object.entries(nextMap)) {
      const nextKey = [...parts.slice(1), nextToken].join(' ');
      edges.push({ source: key, target: nextKey, weight: count, nextToken });
    }
  }
  return edges;
}

function buildSubgraph(markovChain, seedKeys, opts) {
  const {
    hops = 3,
    topK = 6,
    minCount = 2,
    maxNodes = 600,
  } = opts;

  // Precompute outgoing edges per key (filtered, topK)
  const out = new Map();
  for (const key of Object.keys(markovChain)) {
    const nextMap = markovChain[key];
    const parts = key.split(' ');
    if (parts.length !== order) continue;

    let items = Object.entries(nextMap)
      .map(([nextToken, count]) => ({
        source: key,
        nextToken,
        target: `${parts[1]} ${nextToken}`,
        weight: count,
      }))
      .filter(e => e.weight >= minCount);

    items.sort((a, b) => b.weight - a.weight);
    items = items.slice(0, topK);

    out.set(key, items);
  }

  // BFS from a random seed key
  const start = seedKeys[Math.floor(Math.random() * seedKeys.length)];
  const visited = new Set([start]);
  const q = [{ key: start, d: 0 }];

  const chosenEdges = [];
  while (q.length) {
    const { key, d } = q.shift();
    if (d >= hops) continue;

    const edges = out.get(key) ?? [];
    for (const e of edges) {
      chosenEdges.push(e);

      if (!visited.has(e.target)) {
        visited.add(e.target);
        if (visited.size >= maxNodes) break;
        q.push({ key: e.target, d: d + 1 });
      }
    }
    if (visited.size >= maxNodes) break;
  }

  // Build Cytoscape elements
  const nodes = Array.from(visited).map(id => ({
    data: { id, label: id },
  }));

  const edges = chosenEdges.map((e, i) => ({
    data: {
      id: `e${i}`,
      source: e.source,
      target: e.target,
      weight: e.weight,
      nextToken: e.nextToken,
    },
  }));

  return { nodes, edges, meta: { start, opts } };
}



// ---- main ----
const prompt = process.argv.slice(2).join(' ').trim() || null;

const textData = fs.readFileSync(
  path.join(__dirname, '..', 'data', 'message_log.txt'),
  'utf8'
);

const { chain: markovChain } = buildHigherOrderMarkovChain(textData, order);
const seedKeys = pickSeedKeys(markovChain, prompt);

function buildNextIndex(markovChain, topN = 50) {
  // key -> { total, next: [[token, count], ...] }
  const out = {};
  for (const [key, nextMap] of Object.entries(markovChain)) {
    const entries = Object.entries(nextMap);
    if (!entries.length) continue;

    let total = 0;
    for (const [, c] of entries) total += c;

    entries.sort((a, b) => b[1] - a[1]);
    const trimmed = entries.slice(0, topN);

    out[key] = { total, next: trimmed };
  }
  return out;
}


const graph = buildSubgraph(markovChain, seedKeys, {
  hops: 4,
  topK: 10,
  minCount: 1,
  maxNodes: 1200
});

fs.writeFileSync(
  path.join(__dirname, '..', 'web', 'graph.json'),
  JSON.stringify(graph, null, 2),
  'utf8'
);

console.log(`[export] wrote web/graph.json (${graph.nodes.length} nodes, ${graph.edges.length} edges)`);


const nextIndex = buildNextIndex(markovChain, 80);

fs.writeFileSync(
  path.join(__dirname, '..', 'web', 'next_index.json'),
  JSON.stringify({ order, nextIndex }, null, 2),
  'utf8'
);

console.log(`[export] wrote web/next_index.json (${Object.keys(nextIndex).length} keys)`);

