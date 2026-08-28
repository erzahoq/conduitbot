const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { readJsonSafe, writeJsonAtomic, withFileLock } = require("../../helpers/jsonStore");
const { loadMultipliers, getEffectiveMultiplier } = require("../../helpers/xpmult");
const { getLevelFromXP, handleLevelUpRoles } = require("../../helpers/functions");
const { PATHS, DEFAULTS } = require("../../config");

const gambleCooldownPath = PATHS.data.gambleCooldowns;
const gambleReminderPath = PATHS.data.gambleReminders;
const gambleStatsPath = PATHS.data.gambleStats;



// 8 hours
const COOLDOWN_MS = DEFAULTS.gambleCooldownMs;

const FLAVOUR_TIERS = [
  {
    min: 1,
    max: 199,
    emoji: "🪦",
    title: "absolutely nothing :(",
    lines: ["aw dangit",
    "this was a terrible decision", 
    "you feel ashamed", 
    "my face when",
    "i can't believe i just did that", 
    "surely next time", 
    "it is so joever", "well damn", 
    "lets not go gambling ??",
    "erm", 
    "this is NOT awesome sauce horse emoji", 
    "this thing is evil",
    "this was a mistake actually",
    "i regret everything",
    "my lawyer advised me not to continue",
    "this run is cursed",
    "who could have seen this coming",
    "this hurts spiritually",
    "the universe laughed",
    "never again (lying)",
    "this game hates me",
    "i've learned nothing",
    "rock bottom speedrun any%",
    "the numbers are mocking me",
    "skill issue", 
    "skillet shoe",
    "the house kinda won but not really (what)",
    "why did i believe",
    "a fool's errand",
    "never punished btw (punished)",
    "this was hubris",
    "catastrophic misplay",
    "this outcome was guaranteed actually",
    "i have been humbled",
    "astronomically unlucky",
    "this hurts in ways i cant explain",
    "never again (definitely again)",
    "the odds personally hate me",
    "this was deeply unserious",
    "i got scammed by a random number generator",
    "pain and also, suffering",
    "the machine blinked and gave me lint",
    "why did it even bother",
    "i have made a grave error",
    "the xp economy is in shambles",
    "i lost the vibe check :(",
    "this is why people fear probability",
    "absolutely cooked",
    "truely one of the gambles ever",
    "we are in the bad timeline",
    ":(",
    "the gambler's despair",
    "the crushing weight of inevitability",
    "frown",
    "it was not worth it",
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
      "this buys like nothing",
      "better than nothing i guess",
      "meh",
      "this barely counts",
      "i see the vision",
      "we take those?", 
      "it couldve been worse", 
      "i guess", 
      "the grind continues",
      "well it exists",
      "modest little win",
      "not terrible not amazing just kind of there",
      "that sure is some xp",
      "small but distinct",
      "i mean ill take it",
      "the machine tipped me",
      "light snack",
      "not enough to brag about",
      "this is like finding a coin in the sofa",
      "we take those i suppose",
      "its giving minimum effort",
      "a humble donation",
      "tiny win, microscopic even",
      "not bad for a silly little button",
      "it could have insulted me harder",
      "this moved the needle by a pixel",
      "some xp has occurred",
      "the bar went up a little bit yippee",
      "respectable-ish",
      "just enough to keep the lore going",
      "budget win",
      "not exactly cinematic but ok",
      "this was serviceable",
      "mid but in a survivable way",
      "the machine spared me",
      "i've had worse. many worse actually",
      "its the thought that counts",
      "small victory parade",
      "financially tiny"
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
      "acceptable",
      "this feels intentional",
      "worth the risk (get it because theres no risk)",
      "this is a win in my book",
      "ok now we're talking",
      "respectable little creature",
      "the machine nodded approvingly",
      "this one had some kick",
      "we are medium back",
      "that felt pretty good actually",
      "oh yeah thats good",
      "good honest xp",
      "this has range",
      "i can work with this",
      "the numbers aligned for a moment!",
      "solid roll",
      "this one passes inspection",
      "nice",
      "the machine cooked a bit",
      "thats enough to",
      "clean respectable work",
      "this was not embarrassing",
      "love to see a 4 digit number",
      "we're shopping in the real store now",
      "this one sparkles a little",
      "mildly blessed outcome",
      "decent is right honestly",
      "that had some momentum",
      "we got movement",
      "good soup",
      "that landed nicely",
      "rrr, shiny!"
    ],
  },
  {
    min: 5000,
    max: 9999,
    emoji: "🔥",
    title: "big win",
    lines: ["let's be financially responsible!", 
      "i cant stop winning!", 
      "no credit card debt!", 
      "heads up penny!", 
      "diversified investment portfolio!", 
      "paying bills on time!",
      "awesome!", "yippee!",
      "oh this is real!!",
      "i knew it!", 
      "💰💰💰",
      "huge W!!", 
      "i should do this more!!", 
      "the strategy worked",
      "im cooking",
      "OH thats real money",
      "the machine is locked in",
      "ok im hearing the music now",
      "we are moving with intent",
      "someone clip that",
      "i knew the vision was real",
      "massive",
      "ok yeah this machine loves me",
      "insane pull actually",
      "thats a proper win",
      "the crowd goes wild",
      "i am looking respectfully",
      "that was a statement",
      "peak",
      "this changes my life for 4 seconds",
      "big number make brain happy",
      "the house slipped",
      "this was worth the button press",
  ]
  },
  {
    min: 10000,
    max: Infinity,
    emoji: "💎",
    title: "jackpot!",
    lines: ["LETS GO GAMBLING!!!!!!", 
      "GAMBLING GAMBLING GAMBLING",
      "im rich!!!", 
      "mom look im on TV", 
      "NEVER GONNA QUIT",
      "See kids? Gambling is a real source of income",
      "💸💸💸", 
      "awesome sauce 🐴", 
      "this is huge", 
      "this is true"],
  },
];

function pickFlavour(xp) {
  const tier = FLAVOUR_TIERS.find(t => xp >= t.min && xp <= t.max) ?? FLAVOUR_TIERS[0];
  const line = tier.lines[Math.floor(Math.random() * tier.lines.length)];
  return { ...tier, line };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const REVEAL_LINES = [
  "gambling...",
  "pulling the lever...",
  "shaking the xp...",
  "consulting themachine...",
  "counting tiny little xp particles...",
  "rolling the world's least trustworthy number...",
  "the lever is doing something...",
  "asking the dice to lock in...",
  "processing questionable financial decisions...",
  "the machine is thinking very hard",
  "spinning that thing...",
  "warming up the probability engine...",
  "searching for a funny amount...",
  "manufacturing a number...",
  "checking behind the couch for spare xp...",
  "the casino department is reviewing your request...",
  "holding the button down with intent...",
  "the machine is rummaging around...",
  "the numbers are entering the arena...",
  "please hold while we do something unwise...",
  "gently disturbing the economy...",
  "measuring out some xp...",
  "i'm so tired of this...",
  "please set me free...",
  "YOU HAVE NO IDEA...",
  "loading gamble...",
  "one sec the xp is still loading",
  "the little xp particles are waking up...",
  "the dice are rotating in their enclosure...",
  "letting the machine cook...",
  "doing maths probably...",
  "asking fate for a favour...",
  "preparing the silly number...",
  "the machine is considering your vibes...",
  "the lever cleared its throat",
  "checking if this is the one...",
  "probability is being consulted",
  "the machine is stretching first...",
  "digging around for a 4 digit roll...",
  "please stand by while we locate some xp...",
  "this could go so hard or not at all...",
  "tapping on the glass to wake it up...",
  "the xp goblins are discussing...",
  "we are so about to find out",
  "one moment while the nonsense loads...",
  "the machine is acting suspiciously",
  "applying advanced gambling techniques...",
  "shuffling the integers...",
  "the dice are whispering...",
  "gathering the crumbs...",
  "attempting to source a victory...",
  "negotiating with the house...",
  "the machine is looking at me weird",
  "brb spinning the wheel of something",
  "the numbers are marinating...",
  "summoning a quantity...",
  "coaxing the xp out of hiding...",
  "the probability engine is purring...",
  "please wait while we roll something probably embarrassing...",
  "the machine is meowing softly...",
  "poking the random number generator with a stick...",
  "reaching into the xp bag...",
  "the lever has been pulled with confidence",
  "putting the machine under pressure...",
  "consulting the stupid numbers...",
  "trying to manifest a huge one...",
  "the machine has clocked in",
  "generating a financially questionable outcome...",
  "we're doing science to it...",
  "hold on its buffering",
  "loading suspicious amounts of hope...",
  "cranking the nonsense dial...",
  "the machine is searching for something shiny...",
  "aligning the silly little integers...",
  "asking the universe to be funny...",
  "the machine blinked. good sign probably",
  "PLEASE GOD HELP ME IM STUCK IN THIS FUCKASS MACHINE..."
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getTierColor(xp) {
  if (xp >= 10000) return "#7c3aed"; // jackpot
  if (xp >= 5000) return "#ef4444";  // big win
  if (xp >= 1000) return "#22c55e";  // decent
  if (xp >= 200) return "#f59e0b";   // pocket change
  return "#6b7280";                  // terrible
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
          reminders[userId] = {
            enabled: true,
            nextAt: now + COOLDOWN_MS,
          };
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
    const xpDataPath = PATHS.data.xp;

    // ---- roll XP ----
    let baseWin = sampleFastDecayInt(50000);

    // 1/10 chance for critical fail: if roll is 1, it becomes -1
    if (baseWin === 1 && Math.random() < 0.1) {
      baseWin = -1;
    }

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

    const revealEmbed = new EmbedBuilder()
      .setTitle("rolling...")
      .setDescription(`*${pick(REVEAL_LINES)}*`);

    await interaction.editReply({ embeds: [revealEmbed] });

    // small suspense delay
    await sleep(1200 + Math.floor(Math.random() * 800));

    if (finalGain <= 0) {
      return interaction.editReply({
        content: `you pulled the lever... and got **${finalGain} XP**. (what?)`,
        embeds: [],
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
      .setColor(getTierColor(finalGain))
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
        value: `you're more degenerate than **${percentile}%** of gamblers`,
        inline: false,
      },

      { name: "next gamble", value: `<t:${nextUnix}:R>`, inline: false }
    );

    console.log(`User ${targetUser.username} gambled and won ${finalGain} XP`);

    return interaction.editReply({ embeds: [embed] });
  },
};
