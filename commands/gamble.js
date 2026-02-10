const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const path = require("path");

const { readJsonSafe, writeJsonAtomic, withFileLock } = require("../helpers/jsonStore");
const { loadMultipliers, getEffectiveMultiplier } = require("../helpers/xpmult");
const { getLevelFromXP, handleLevelUpRoles } = require("../helpers/functions");
const gambleCooldownPath = path.join(__dirname, "..", "data", "gamble_cooldowns.json");
const gambleReminderPath = path.join(__dirname, "..", "data", "gamble_reminders.json");
const gambleStatsPath = path.join(__dirname, "..", "data", "gamble_stats.json");



// 8 hours
const COOLDOWN_MS = 8 * 60 * 60 * 1000;

const FLAVOUR_TIERS = [
  {
    min: 1,
    max: 199,
    emoji: "🪦",
    title: "absolutely nothing :(",
    lines: ["aw dangit", "this was a terrible decision", "you feel ashamed", "my face when",
      "i can't believe i just did that", "surely next time", "it is so joever", "well damn", "lets not go gambling ??",
      "erm", "this is NOT awesome sauce horse emoji", "this thing is evil",
    "this was a mistake actually",
    "i regret everything",
    "my lawyer advised me not to continue",
    "this run is cursed",
    "who could have seen this coming",
    "this hurts spiritually",
    "the universe laughed",
    "never again (lying)",
    "this game hates me",
    "i've learned nothing","rock bottom speedrun any%",
    "the numbers are mocking me","skill issue", "skillet shoe",
    "the house kinda won but not really (what)",
    "why did i believe","a fool's errand","never punished btw (punished)",
    "this was hubris",
    "catastrophic misplay",
    "this outcome was guaranteed actually",
    "i have been humbled",
    "astronomically unlucky",
    "this hurts in ways i cant explain",
    "never again (definitely again)",
    "the odds personally hate me",
    ],
  },
  {
    min: 200,
    max: 999,
    emoji: "🪙",
    title: "pocket change",
    lines: [
      "lets be financially responsible!!!",
      "this is a step in the right direction? i think?",
      "idk if that was worth it",
      "surely next time",
      "it is somewhat over",
      "i guess that's it",
      "that was lame",
      "better luck next time",
      "this buys like nothing","better than nothing i guess","meh","this barely counts",
      "i see the vision", "we take those?", "it couldve been worse", "i guess", "the grind continues"
    ],
  },
  {
    min: 1000,
    max: 4999,
    emoji: "✨",
    title: "decent",
    lines: [
      "okay yeah that's fair.",
      "i think i won",
      "this milk can pay for my cat",
      "surely next time",
      "i'll take what i can get",
      "i guess that's it",
      "that was ok",
      "meow",
      "purr",
      "oo shiny",
      "ok yeah that felt good",
      "this sparks joy","respectable outcome",
      "the number went up!",
      "acceptable","this feels intentional",
      "worth the risk (get it because theres no risk)",
      "this is a win in my book"
    ],
  },
  {
    min: 5000,
    max: 9999,
    emoji: "🔥",
    title: "big win",
    lines: ["let's be financially responsible!", "i cant stop winning!", "no credit card debt!", "heads up penny!", "diversified investment portfolio!", "paying bills on time!",
      "awesome!", "yippee!", "oh this is real!!", "i knew it!", "💰💰💰", "huge W!!", "i should do this more!!", "the strategy worked", "im cooking"]
  },
  {
    min: 10000,
    max: Infinity,
    emoji: "💎",
    title: "jackpot!",
    lines: ["LETS GO GAMBLING!!!!!!", "GAMBLING GAMBLING GAMBLING", "im rich!!!", "mom look im on TV", "💸💸💸", "awesome sauce 🐴", "this is huge", "this is true"],
  },
];

function pickFlavour(xp) {
  const tier = FLAVOUR_TIERS.find(t => xp >= t.min && xp <= t.max) ?? FLAVOUR_TIERS[0];
  const line = tier.lines[Math.floor(Math.random() * tier.lines.length)];
  return { ...tier, line };
}

function makeSampler({
  N = 50000,
  cutoff = 10000,
  tailAtCutoff = 0.01,   // P(X >= 10000)
  xLow = 1000,
  underLow = 0.80        // P(X < 1000)  <-- THIS is your main "power" knob
} = {}) {
  // Weibull-style survival: P(X >= x) ≈ exp(-a * x^p)
  // Enforce: P(X >= cutoff) = tailAtCutoff, and P(X >= xLow) = 1 - underLow
  const tailAtLow = 1 - underLow;

  // Solve for p, a
  const p =
    Math.log(Math.log(tailAtLow) / Math.log(tailAtCutoff)) /
    Math.log(xLow / cutoff);

  const a = -Math.log(tailAtCutoff) / Math.pow(cutoff, p);

  const denom = 1 - Math.exp(-a * Math.pow(N, p));

  return function sample() {
    const u = Math.random();
    const y = Math.pow(-Math.log(1 - u * denom) / a, 1 / p);
    const x = Math.ceil(y);
    return Math.min(N, Math.max(1, x));
  };
}

const sampleFastDecayInt = makeSampler({underLow: 0.65})

module.exports = {
  data: new SlashCommandBuilder()
    .setName("gamble")
    .setDescription("lets go gambling!!! aww dangit"),

  async execute(interaction) {
    const userId = interaction.user.id;
    const now = Date.now();

    // ---- cooldown check (file-backed, NO THROW) ----
    const cd = await withFileLock(gambleCooldownPath, async () => {
      const cooldownData = await readJsonSafe(gambleCooldownPath, {});
      const last = Number(cooldownData[userId] ?? 0);
      const expirationTime = last + COOLDOWN_MS;

      if (now < expirationTime) {
        return { ok: false, expirationUnix: Math.floor(expirationTime / 1000) };
      }

      // consume cooldown immediately
      cooldownData[userId] = now;
      await writeJsonAtomic(gambleCooldownPath, cooldownData);
      // If reminders are enabled, set nextAt = now + cooldown
      await withFileLock(gambleReminderPath, async () => {
        const reminders = await readJsonSafe(gambleReminderPath, {});
        const entry = reminders[userId];
        if (entry?.enabled) {
          reminders[userId].nextAt = now + COOLDOWN_MS;
          await writeJsonAtomic(gambleReminderPath, reminders);
        }
      });


      return { ok: true };
    });

    if (!cd.ok) {
      return interaction.reply({
        content: [
          "🕒 your luck is recharging...",
          `-# you can gamble again <t:${cd.expirationUnix}:R>.`,
        ].join("\n"),
        ephemeral: true,
      });
    }

    // ---- paths ----
    const xpDataPath = path.join(__dirname, "..", "data", "xp.json");

    // ---- roll XP ----
    const baseWin = sampleFastDecayInt(50000);
    const targetUser = interaction.user;

    const APPLY_MULTS = false;
    let finalGain = baseWin;

    if (APPLY_MULTS) {
      const mults = await loadMultipliers();
      let mult = getEffectiveMultiplier(interaction.member, interaction.channel, mults);
      if (!Number.isFinite(mult)) mult = 1;
      if (mult <= 0) mult = 0;
      finalGain = Math.floor(baseWin * mult);
    }

    await interaction.deferReply({ ephemeral: false });

    if (finalGain <= 0) {
      return interaction.editReply({
        content: "🎰 you pulled the lever... and got **0 XP**. (what?)",
      });
    }

    // ---- update gamble stats tally ----
    await withFileLock(gambleStatsPath, async () => {
      const stats = await readJsonSafe(gambleStatsPath, {});
      const s = stats[userId] ?? { count: 0, totalXP: 0, best: 0, lastWin: 0 };

      s.count = Number(s.count ?? 0) + 1;
      s.totalXP = Number(s.totalXP ?? 0) + finalGain;
      s.best = Math.max(Number(s.best ?? 0), finalGain);
      s.lastWin = finalGain;

      stats[userId] = s;
      await writeJsonAtomic(gambleStatsPath, stats);
    });

    // ---- compute gamble percentile ----
    const statsAll = await readJsonSafe(gambleStatsPath, {});
    const counts = Object.values(statsAll)
      .map(s => Number(s?.count ?? 0))
      .filter(n => n > 0);

    let percentile = 100;

    if (counts.length > 1) {
      const myCount = Number(statsAll[userId]?.count ?? 0);
      const belowOrEqual = counts.filter(c => c <= myCount).length;
      percentile = Math.round((belowOrEqual / counts.length) * 100);
    }



    // ---- write XP safely ----
    let oldLevel = 0;
    let newLevel = 0;

    await withFileLock(xpDataPath, async () => {
      const xpData = await readJsonSafe(xpDataPath, {});
      if (!xpData[userId]) xpData[userId] = { xp: 0, lastMessage: 0 };

      const oldXP = Number(xpData[userId].xp ?? 0);
      oldLevel = getLevelFromXP(oldXP);

      const updatedXP = Math.floor(oldXP + finalGain);
      xpData[userId].xp = updatedXP;

      await writeJsonAtomic(xpDataPath, xpData);
      newLevel = getLevelFromXP(updatedXP);
    });

    if (newLevel > oldLevel) {
      await handleLevelUpRoles(interaction.member, newLevel);
    }

    const flavour = pickFlavour(finalGain);
    const nextUnix = Math.floor((now + COOLDOWN_MS) / 1000);

    const embed = new EmbedBuilder()
      .setTitle(`${flavour.emoji} ${flavour.title}`)
      .setColor("#f5b942")
      .setDescription(
        [
          `you gambled and won **${finalGain.toLocaleString()} XP**.`,
          `*${flavour.line}*`,
        ].join("\n")
      );

    if (newLevel > oldLevel) {
      embed.addFields({
        name: "⬆️ level up!",
        value: `you went from **${oldLevel} → ${newLevel}**.`,
        inline: false,
      });
    }

    const stats = await readJsonSafe(gambleStatsPath, {});
    const s = stats[userId] ?? { count: 0, totalXP: 0, best: 0 };

    embed.addFields(
      { name: "gambles", value: String(s.count ?? 0), inline: true },
      { name: "total won", value: `${Number(s.totalXP ?? 0).toLocaleString()} XP`, inline: true },
      { name: "best win", value: `${Number(s.best ?? 0).toLocaleString()} XP`, inline: true },
      {
        name: "🎲 gambling rank",
        value: `you're more committed than **${percentile}%** of gamblers`,
        inline: false,
      },

      { name: "next gamble", value: `<t:${nextUnix}:R>`, inline: false }
    );

    console.log(`User ${targetUser.username} gambled and won ${finalGain} XP`);

    return interaction.editReply({ embeds: [embed] });
  },
};
