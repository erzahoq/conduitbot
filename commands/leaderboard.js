const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

const fs = require("fs").promises;
const path = require("path");

const { formatNum, getLevelFromXP } = require("../helpers/functions");

const PAGE_SIZE = 10;

// ---------- helpers ----------
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// messageId -> { ownerId, total: { embeds, maxPage }, weekly: { embeds, maxPage }, expiresAt }
const LB_CACHE = new Map();
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

function cacheGet(messageId) {
  const entry = LB_CACHE.get(messageId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    LB_CACHE.delete(messageId);
    return null;
  }
  return entry;
}


function cacheSet(messageId, value) {
  LB_CACHE.set(messageId, value);
}


function hasCombiningMarks(str) {
  // needs Node 16+ (you have Node 23 so you're fine)
  return /\p{M}/u.test(str);
}

function hasEmojiLike(str) {
  // catches most emoji / pictographs
  return /\p{Extended_Pictographic}/u.test(str);
}

function hasNonAscii(str) {
  return /[^\x20-\x7E]/.test(str); // outside basic printable ASCII
}

function shouldFallbackToUsername(displayName) {
  if (!displayName) return true;
  return hasNonAscii(displayName) || hasCombiningMarks(displayName) || hasEmojiLike(displayName);
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const cur = idx++;
      try {
        results[cur] = await fn(items[cur], cur);
      } catch {
        results[cur] = null;
      }
    }
  });

  await Promise.all(workers);
  return results;
}



function monoClamp(str, max) {
  const s = (str ?? "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

// Splits-style line
function isCombining(code) {
  return (
    (code >= 0x0300 && code <= 0x036F) ||
    (code >= 0x1AB0 && code <= 0x1AFF) ||
    (code >= 0x1DC0 && code <= 0x1DFF) ||
    (code >= 0x20D0 && code <= 0x20FF) ||
    (code >= 0xFE20 && code <= 0xFE2F)
  );
}

// best-effort terminal-style width: ASCII=1, many CJK/emoji-ish=2, combining=0
function displayWidth(str) {
  let w = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0);
    if (code == null) continue;

    if (isCombining(code)) continue;

    // crude "wide" ranges (CJK + fullwidth + many symbols)
    const wide =
      (code >= 0x1100 && code <= 0x115F) ||
      (code >= 0x2329 && code <= 0x232A) ||
      (code >= 0x2E80 && code <= 0xA4CF) ||
      (code >= 0xAC00 && code <= 0xD7A3) ||
      (code >= 0xF900 && code <= 0xFAFF) ||
      (code >= 0xFE10 && code <= 0xFE19) ||
      (code >= 0xFE30 && code <= 0xFE6F) ||
      (code >= 0xFF00 && code <= 0xFF60) ||
      (code >= 0xFFE0 && code <= 0xFFE6) ||
      (code >= 0x1F300 && code <= 0x1FAFF); // emoji block (imperfect)

    w += wide ? 2 : 1;
  }
  return w;
}

function padEndDisplay(str, targetWidth) {
  const w = displayWidth(str);
  if (w >= targetWidth) return str;
  return str + " ".repeat(targetWidth - w);
}

function clampDisplay(str, targetWidth) {
  // clamp to a display width (not .length)
  let out = "";
  let w = 0;

  for (const ch of str) {
    const code = ch.codePointAt(0);
    if (code == null) continue;

    if (isCombining(code)) {
      // keep combining marks if we already have a base char
      if (out.length) out += ch;
      continue;
    }

    const wide =
      (code >= 0x1100 && code <= 0x115F) ||
      (code >= 0x2329 && code <= 0x232A) ||
      (code >= 0x2E80 && code <= 0xA4CF) ||
      (code >= 0xAC00 && code <= 0xD7A3) ||
      (code >= 0xF900 && code <= 0xFAFF) ||
      (code >= 0xFE10 && code <= 0xFE19) ||
      (code >= 0xFE30 && code <= 0xFE6F) ||
      (code >= 0xFF00 && code <= 0xFF60) ||
      (code >= 0xFFE0 && code <= 0xFFE6) ||
      (code >= 0x1F300 && code <= 0x1FAFF);

    const inc = wide ? 2 : 1;
    if (w + inc > targetWidth) break;
    out += ch;
    w += inc;
  }

  // if we cut anything, add …
  if (out !== str) {
    // try to fit ellipsis
    if (targetWidth >= 1) {
      // remove last char if needed to fit ellipsis cleanly
      while (displayWidth(out + "…") > targetWidth && out.length) out = out.slice(0, -1);
      out += "…";
    }
  }

  return out;
}

function makeLine({ rank, name, xpText, level }) {
  // widths in "display cells" (best-effort)
  const NAME_W = 26;
  const XP_W = 7;

  const leftRaw = `#${String(rank).padStart(2, " ")} ${name}`;
  const left = padEndDisplay(clampDisplay(leftRaw, NAME_W), NAME_W);

  const xpBox = padEndDisplay(clampDisplay(xpText, XP_W), XP_W);
  const right = `Lv ${String(level).padStart(2, " ")}`;

  return `\`${left}\` \`${xpBox}\` \`${right}\``;
}



async function loadEntries(category) {
  if (category === "weekly") {
    const weeklyPath = path.join(__dirname, "..", "data", "xp_weekly.json");
    const raw = await fs.readFile(weeklyPath, "utf8");
    const weeklyData = JSON.parse(raw);
    const xpData = weeklyData.users || {};
    return Object.entries(xpData).map(([id, obj]) => [id, Math.floor(obj?.xp ?? 0)]);
  }

  const xpPath = path.join(__dirname, "..", "data", "xp.json");
  const raw = await fs.readFile(xpPath, "utf8");
  const xpData = JSON.parse(raw);
  return Object.entries(xpData).map(([id, obj]) => [id, Math.floor(obj?.xp ?? 0)]);
}

function buildNameResolver(guild, membersMap) {
  return (userId, fallbackName) => {
    const m = membersMap.get(userId);
    if (!m) return fallbackName ?? `<@${userId}>`;

    const display = m.displayName ?? "";
    const username = m.user?.username ?? `<@${userId}>`;

    return shouldFallbackToUsername(display) ? username : display;
  };
}

async function buildPagesForCategory(interaction, category) {
  const entries = await loadEntries(category);

  // bulk fetch (nice-to-have) + map we can fill as we probe
  const members = await interaction.guild.members.fetch().catch(() => null);
  const membersMap = members ?? new Map();

  // probe only needed IDs to confirm membership
  const ids = [...new Set(entries.map(([id]) => id))];

  const presentPairs = await mapWithConcurrency(ids, 8, async (id) => {
    if (membersMap.has(id)) return [id, true];

    const m = await interaction.guild.members.fetch(id).catch(() => null);
    if (m) {
      membersMap.set(id, m);
      return [id, true];
    }
    return [id, false];
  });

  const presentIds = new Set(
    presentPairs.filter(Boolean).filter(([, ok]) => ok).map(([id]) => id)
  );

  const filtered = entries.filter(([id]) => presentIds.has(id));
  filtered.sort((a, b) => b[1] - a[1]);

  const resolveName = buildNameResolver(interaction.guild, membersMap);

  const maxPage = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1);
  const embeds = [];

  for (let page = 0; page <= maxPage; page++) {
    const start = page * PAGE_SIZE;
    const slice = filtered.slice(start, start + PAGE_SIZE);

    const lines = [];
    for (let i = 0; i < slice.length; i++) {
      const [userId, xp] = slice[i];
      const rank = start + i + 1;

      const name = resolveName(userId, `<@${userId}>`);
      const level = getLevelFromXP(xp);
      const xpText = formatNum(xp);

      lines.push(makeLine({ rank, name, xpText, level }));
    }

    const title = category === "weekly" ? "🏆 Weekly Leaderboard" : "🏆 Leaderboard";

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(0x4fe4dc)
      .setDescription(lines.length ? lines.join("\n") : "*No data yet.*")
      .setFooter({ text: `Page ${page + 1}/${maxPage + 1}` });

    embeds.push(embed);
  }

  return { embeds, maxPage };
}



function makeCustomId(ownerId, category, page) {
  return `lb|${ownerId}|${category}|${page}`;
}

function buildComponents(ownerId, category, page, maxPage) {
  const totalBtn = new ButtonBuilder()
    .setCustomId(makeCustomId(ownerId, "total", page))
    .setLabel("Total")
    .setStyle(category === "total" ? ButtonStyle.Primary : ButtonStyle.Secondary);

  const weeklyBtn = new ButtonBuilder()
    .setCustomId(makeCustomId(ownerId, "weekly", page))
    .setLabel("Weekly")
    .setStyle(category === "weekly" ? ButtonStyle.Primary : ButtonStyle.Secondary);

  const prevBtn = new ButtonBuilder()
    .setCustomId(makeCustomId(ownerId, category, page - 1))
    .setLabel("←")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page <= 0);

  const nextBtn = new ButtonBuilder()
    .setCustomId(makeCustomId(ownerId, category, page + 1))
    .setLabel("→")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page >= maxPage);

  return [new ActionRowBuilder().addComponents(totalBtn, weeklyBtn, prevBtn, nextBtn)];
}

async function render(interaction, ownerId, category, page) {
  const entries = await loadEntries(category);

  // OPTIONAL: hide 0 XP users
  // const filtered = entries.filter(([, xp]) => xp > 0);
  const filtered = entries;

  filtered.sort((a, b) => b[1] - a[1]);

  const maxPage = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1);
  page = clamp(page, 0, maxPage);

  const start = page * PAGE_SIZE;
  const slice = filtered.slice(start, start + PAGE_SIZE);

  const lines = [];
  for (let i = 0; i < slice.length; i++) {
    const [userId, xp] = slice[i];
    const rank = start + i + 1;

    const memberName = await fetchMemberName(interaction.guild, userId);
    const level = getLevelFromXP(xp);

    // include XP in the name area (nice + readable)
    const xpText = formatNum(xp); // or `XP ${formatNum(xp)}`
    lines.push(makeLine({ rank, name: memberName, xpText, level }));


  }

  const title = category === "weekly" ? "🏆 Weekly Leaderboard" : "🏆 Leaderboard";

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(0x4fe4dc)
    .setDescription(lines.length ? lines.join("\n") : "*No data yet.*")
    .setFooter({ text: `Page ${page + 1}/${maxPage + 1}` });

  const components = buildComponents(ownerId, category, page, maxPage);

  return { embed, components };
}

// ---------- command ----------
module.exports = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Shows the XP leaderboard (Total/Weekly) with pages.")
    .addStringOption((opt) =>
      opt
        .setName("category")
        .setDescription("Which leaderboard to view")
        .addChoices(
          { name: "Total", value: "total" },
          { name: "Weekly", value: "weekly" }
        )
        .setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("page")
        .setDescription("Page number (starts at 1)")
        .setMinValue(1)
        .setRequired(false)
    ),

async execute(interaction) {
  await interaction.deferReply();

  const ownerId = interaction.user.id;
  const category = interaction.options.getString("category") ?? "total";
  const pageOpt = interaction.options.getInteger("page");
  const page = pageOpt ? pageOpt - 1 : 0;

  // Build both categories up-front
  const [totalPages, weeklyPages] = await Promise.all([
    buildPagesForCategory(interaction, "total"),
    buildPagesForCategory(interaction, "weekly"),
  ]);

  // pick initial
  const chosen = category === "weekly" ? weeklyPages : totalPages;
  const safePage = clamp(page, 0, chosen.maxPage);

  const components = buildComponents(ownerId, category, safePage, chosen.maxPage);

  const msg = await interaction.editReply({
    embeds: [chosen.embeds[safePage]],
    components,
  });

  // cache per-message
  cacheSet(msg.id, {
    ownerId,
    total: totalPages,
    weekly: weeklyPages,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
},


async handleButton(interaction) {
  const [prefix, ownerId, categoryRaw, pageRaw] = interaction.customId.split("|");
  if (prefix !== "lb") return;

  if (interaction.user.id !== ownerId) {
    return interaction.reply({
      content: "This leaderboard isn't yours!",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferUpdate();

  const cache = cacheGet(interaction.message.id);
  if (!cache) {
    // cache expired (or bot restarted) — tell them to rerun
    return interaction.editReply({
      content: "Leaderboard expired — run `/leaderboard` again.",
      embeds: [],
      components: [],
    });
  }

  const category = categoryRaw === "weekly" ? "weekly" : "total";
  const page = Number(pageRaw) || 0;

  const pack = cache[category];
  const safePage = clamp(page, 0, pack.maxPage);

  const components = buildComponents(ownerId, category, safePage, pack.maxPage);

  await interaction.editReply({
    embeds: [pack.embeds[safePage]],
    components,
  });
}

};
