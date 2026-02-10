const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
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

function makeSelectId(ownerId) {
  return `lbsel|${ownerId}`;
}

function makeNavId(ownerId, dir) {
  return `lbnav|${ownerId}|${dir}`; // dir = -1 / +1
}

function buildComponents(ownerId, category, page, maxPage) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(makeSelectId(ownerId))
    .setPlaceholder("Select leaderboard")
    .addOptions(
      { label: "Total XP", value: "total", emoji: "🏆", default: category === "total" },
      { label: "Weekly XP", value: "weekly", emoji: "📅", default: category === "weekly" },
      { label: "Most Gambles", value: "gamble", emoji: "🎰", default: category === "gamble" },
      { label: "Largest Win From Gamble", value: "gamble_best", emoji: "💎", default: category === "gamble_best" }
    );

  const row1 = new ActionRowBuilder().addComponents(select);

  const prev = new ButtonBuilder()
    .setCustomId(makeNavId(ownerId, "-1"))
    .setLabel("←")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page <= 0);

  const next = new ButtonBuilder()
    .setCustomId(makeNavId(ownerId, "+1"))
    .setLabel("→")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page >= maxPage);

  const row2 = new ActionRowBuilder().addComponents(prev, next);

  return [row1, row2];
}


function makeLine({ rank, name, midText, rightText }) {
  const NAME_W = 26;
  const MID_W = 7;

  const leftRaw = `#${String(rank).padStart(2, " ")} ${name}`;
  const left = padEndDisplay(clampDisplay(leftRaw, NAME_W), NAME_W);

  const midBox = padEndDisplay(clampDisplay(midText, MID_W), MID_W);

  return `\`${left}\` \`${midBox}\` \`${rightText}\``;
}



async function loadEntries(category) {
  if (category === "weekly") {
    const weeklyPath = path.join(__dirname, "..", "data", "xp_weekly.json");
    const raw = await fs.readFile(weeklyPath, "utf8");
    const weeklyData = JSON.parse(raw);
    const xpData = weeklyData.users || {};
    return Object.entries(xpData).map(([id, obj]) => ({
      id,
      value: Math.floor(obj?.xp ?? 0),
    }));
  }

  if (category === "gamble") {
    const statsPath = path.join(__dirname, "..", "data", "gamble_stats.json");
    const raw = await fs.readFile(statsPath, "utf8");
    const stats = JSON.parse(raw);

    // leaderboard by most gambles (count)
    return Object.entries(stats).map(([id, obj]) => ({
      id,
      value: Math.floor(obj?.count ?? 0),
    }));
  }

    if (category === "gamble_best") {
      const statsPath = path.join(__dirname, "..", "data", "gamble_stats.json");
      const raw = await fs.readFile(statsPath, "utf8");
      const stats = JSON.parse(raw);

      // leaderboard by largest single win (best)
      return Object.entries(stats).map(([id, obj]) => ({
        id,
        value: Math.floor(obj?.best ?? 0),
      }));
    }


  // total
  const xpPath = path.join(__dirname, "..", "data", "xp.json");
  const raw = await fs.readFile(xpPath, "utf8");
  const xpData = JSON.parse(raw);

  return Object.entries(xpData).map(([id, obj]) => ({
    id,
    value: Math.floor(obj?.xp ?? 0),
  }));
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

  // membersMap is used for filtering + naming
  const members = await interaction.guild.members.fetch().catch(() => null);
  const membersMap = members ?? new Map();

  // Confirm membership for IDs we have stats for (important if bulk fetch is incomplete)
  const ids = [...new Set(entries.map((e) => e.id))];

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

  // Filter to present members only
  const filtered = entries.filter((e) => presentIds.has(e.id));

  // Sort high -> low
  filtered.sort((a, b) => b.value - a.value);

  const resolveName = buildNameResolver(interaction.guild, membersMap);

  const maxPage = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1);
  const embeds = [];

  for (let page = 0; page <= maxPage; page++) {
    const start = page * PAGE_SIZE;
    const slice = filtered.slice(start, start + PAGE_SIZE);

    const lines = [];
    for (let i = 0; i < slice.length; i++) {
      const { id: userId, value } = slice[i];
      const rank = start + i + 1;

      const name = resolveName(userId, `<@${userId}>`);

        if (category === "gamble" || category === "gamble_best") {
          const rightText = category === "gamble" ? "gambles" : "best";
          const midText = category === "gamble"
            ? String(value)
            : formatNum(value);

          lines.push(
            makeLine({
              rank,
              name,
              midText,
              rightText,
            })
          );
        } else {

        const xp = value;
        const lvl = getLevelFromXP(xp);
        lines.push(
          makeLine({
            rank,
            name,
            midText: formatNum(xp),
            rightText: `Lv ${String(lvl).padStart(2, " ")}`,
          })
        );
      }
    }

        const title =
      category === "weekly"
        ? "🏆 Weekly Leaderboard"
        : category === "gamble"
        ? "🎰 Gambling Leaderboard"
        : category === "gamble_best"
        ? "💎 Largest Win Leaderboard"
        : "🏆 Leaderboard";


        const emptyMsg =
      category === "gamble" || category === "gamble_best"
        ? "*No gamble stats yet.*"
        : "*No data yet.*";


    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(0x4fe4dc)
      .setDescription(lines.length ? lines.join("\n") : emptyMsg)
      .setFooter({ text: `Page ${page + 1}/${maxPage + 1}` });

    embeds.push(embed);
  }

  return { embeds, maxPage };
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
          { name: "Weekly", value: "weekly" },
          { name: "Gambling", value: "gamble" },
          { name: "Largest Win", value: "gamble_best" }
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

  // initial category from option (keep your old option if you want)
  const category = interaction.options.getString("category") ?? "total";
  const pageOpt = interaction.options.getInteger("page");
  const page = pageOpt ? pageOpt - 1 : 0;

  // build ALL categories up-front
  const [totalPack, weeklyPack, gamblePack, bestPack] = await Promise.all([
    buildPagesForCategory(interaction, "total"),
    buildPagesForCategory(interaction, "weekly"),
    buildPagesForCategory(interaction, "gamble"),
    buildPagesForCategory(interaction, "gamble_best"),
  ]);

  const packs = { total: totalPack, weekly: weeklyPack, gamble: gamblePack, gamble_best: bestPack };
  const chosen = packs[category] ?? packs.total;
  const safePage = clamp(page, 0, chosen.maxPage);

  const components = buildComponents(ownerId, category, safePage, chosen.maxPage);

  const msg = await interaction.editReply({
    embeds: [chosen.embeds[safePage]],
    components,
  });

  cacheSet(msg.id, {
    ownerId,
    category,
    page: safePage,
    packs,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}
,


async handleComponent(interaction) {
  const msgId = interaction.message.id;
  const cache = cacheGet(msgId);

  // Lock controls to original invoker
  if (!cache) {
    await interaction.deferUpdate().catch(() => {});
    return interaction.editReply({
      content: "Leaderboard expired — run `/leaderboard` again.",
      embeds: [],
      components: [],
    });
  }

  if (interaction.user.id !== cache.ownerId) {
    return interaction.reply({
      content: "This leaderboard isn't yours!",
      flags: MessageFlags.Ephemeral,
    });
  }

  // ACK immediately
  await interaction.deferUpdate();

  // Dropdown selection
  if (interaction.isStringSelectMenu()) {
    const nextCategory = interaction.values?.[0] ?? cache.category;

    const pack = cache.packs[nextCategory] ?? cache.packs.total;
    const nextPage = 0; // reset to first page when switching categories

    cache.category = nextCategory;
    cache.page = nextPage;
    cache.expiresAt = Date.now() + CACHE_TTL_MS;

    const components = buildComponents(cache.ownerId, nextCategory, nextPage, pack.maxPage);

    return interaction.editReply({
      embeds: [pack.embeds[nextPage]],
      components,
    });
  }

  // Prev/Next buttons
  if (interaction.isButton()) {
    const [prefix, ownerId, dirRaw] = interaction.customId.split("|");
    if (prefix !== "lbnav") return;

    const dir = Number(dirRaw) || 0;

    const pack = cache.packs[cache.category] ?? cache.packs.total;
    const nextPage = clamp(cache.page + dir, 0, pack.maxPage);

    cache.page = nextPage;
    cache.expiresAt = Date.now() + CACHE_TTL_MS;

    const components = buildComponents(cache.ownerId, cache.category, nextPage, pack.maxPage);

    return interaction.editReply({
      embeds: [pack.embeds[nextPage]],
      components,
    });
  }
}


};


