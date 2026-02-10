const {
    Client,
    GatewayIntentBits,
    Partials,
    Collection,
    ActivityType,
    EmbedBuilder,
    MessageFlags
} = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { readJsonSafe, writeJsonAtomic, withFileLock } = require("./helpers/jsonStore");

const { sanitizeMessage } = require('./helpers/sanitize');
const { loadMultipliers, getEffectiveMultiplier } = require("./helpers/xpmult");
const { handleLevelUpRoles } = require('./helpers/functions');
const { getLevelFromXP } = require('./helpers/functions');
const { getISOWeekKey } = require('./helpers/functions'); // at top

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Channel],
});

client.on('error', err => {
  console.error('Discord client error:', err);
});

client.on('shardError', err => {
  console.error('Shard error:', err);
});

client.on('shardDisconnect', (event, shardId) => {
  console.warn(`Shard ${shardId} disconnected:`, event?.code, event?.reason);
});

client.on('shardReconnecting', shardId => {
  console.log(`Shard ${shardId} reconnecting...`);
});

// ===== gamble reminder tick setup =====
const gambleReminderPath = path.join(__dirname, "data", "gamble_reminders.json");

const GAMBLE_REMINDER_LINES = [
  "psst… the lever is calling your name...",
  "anyone else hear that ominous bell tolling????🤣🤣🤣 no?? just me??????😭😭😭😭😭😭",
  "your cooldown gamble has finished!",
  "your gamble cooldown has finished!",
  "ive been expecting you",
  "you're welcome!",
  "time to gamble!",
  "LETS GO GAMBLING!!",
  "lets be financially responsible!",
  "time to gamble!",
  "you're able to gamble again!",
  "you're gamble!",
  "hi dere",
  "time to make some bad decisions!",
  "gamble responsibly!",
  "where does all this milk come from??",
  "see you in 6 hours!",
  "lets run this back",
  "you've been expecting me?",
  "in soviet russia, the lever pulls you!",
  "fire in the hole!",
  "surely this time",
  "let's get this bread",
  "wee woo wee woo",
  "tick tock tick tock ding dong ding dong",
  "your cooldown expired!",
  "your cooldown is up!",
  "boo!",
  "did you miss me?",
  "surprise!",
  "you'll win big this time, i guarantee it!",
  "gamble gamble gamble gamble",
  "gaming",
  "me jumpscare",
  "gamer moment",
  "boss blind time",
  "hey. hey. the lever missed you.",
  "it's been thinking about you...",
  "the cooldown forgives you",
  "you know what time it is!",
  "the numbers are restless",
  "the lever yearns...", 
  "wake up!! gamble time!!",
  "back at it again!",
  "this is NOT a drill",
  "round 2 lets go", 
  "gambling o'clock!",
  "its gamblin time!",
  "spin that thing!",
  "do it again do it again do it again",
  "we go again!",
  "make good choices! (lie)",
  "statistically speaking, this is fine",
  "financial advisors hate this one simple trick!",
  "moderation is key",
  "nothing bad has ever happened from this",
  "risk-free activity",
  "this counts as budgeting",
  "i am legally required to tell you that it's ready",
  "cooldown finished btw",
  "this is a reminder i think",
  "automated message jumpscare",
  "you thought this notification was a friend messaging you, but it was me the whole time!!",
  "user has been notified",
  "again?",
  "now.",
  "your move.",
  "press it.",
  "go.",
  "do it.",
  "hi hello hi its so good to see youuu",
  "your awesome did anyone tell you",
  "🔔",
  "⏰",
  "surely nothing goes wrong",
  "one more for the road",
  "trust",
  "fortune favours the bold!",
  "loaded dice",
  "it's ready when you are",
  "the timer hit zero",
  "heyyy bestieee :)",
  "hihihihihi!!",
  "missed you!",
  "we should talk",
  "just checking in!",
  "this couldve been an email you know",
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}



// load commands from ./commands
client.commands = new Collection();
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
        console.log(`Loaded command: ${command.data.name}`);
    } else {
        console.log(`[WARNING] The command at ./commands/${file} is missing "data" or "execute".`);
    }
}

client.once('clientReady', () => {
    console.log(`Logged in as ${client.user.tag}!`);

    client.user.setPresence({
        activities: [
            {
                name: 'Tsera',
                type: ActivityType.Playing,
            },
        ],
        status: 'online',           // status can be online / idle / dnd / invisible
    });
        // ===== gamble reminder tick (runs every 60s) =====
        setInterval(async () => {
          try {
            const now = Date.now();

            await withFileLock(gambleReminderPath, async () => {
              const data = await readJsonSafe(gambleReminderPath, {});
              let changed = false;

              for (const [userId, entry] of Object.entries(data)) {
                if (!entry?.enabled) continue;
                if (!entry?.nextAt) continue;

                const nextAt = Number(entry.nextAt);
                if (!Number.isFinite(nextAt)) {
                  data[userId].nextAt = null;
                  changed = true;
                  continue;
                }

                if (now < nextAt) continue;

                // due: try DM
                try {
                  const user = await client.users.fetch(userId).catch(() => null);
                  if (user) {
                    await user.send(pick(GAMBLE_REMINDER_LINES));
                    console.log(`[gamblereminder] DM sent to ${userId}`);
                  }
                } catch (e) {
                  console.warn(`[gamblereminder] DM failed for ${userId}:`, e?.message ?? e);
                }

                // one-shot: clear nextAt, keep enabled
                data[userId].nextAt = null;
                changed = true;
              }

              if (changed) {
                await writeJsonAtomic(gambleReminderPath, data);
              }
            });
          } catch (e) {
            console.error("[gamblereminder] tick error:", e);
          }
        }, 6 * 100 * 1000);

});

// slash command handling
client.on("interactionCreate", async (interaction) => {
  try {
    // ---------- Slash Commands ----------
    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(error);
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({
            content: "There was an error while executing this command!",
            flags: MessageFlags.Ephemeral,
          });
        } else {
          await interaction.reply({
            content: "There was an error while executing this command!",
            flags: MessageFlags.Ephemeral,
          });
        }
      }
      return;
    }

    // ---------- Buttons ----------
    // ---------- Components (Buttons + Dropdowns) ----------
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
      const id = interaction.customId ?? "";

      // route leaderboard components
      if (id.startsWith("lbsel|") || id.startsWith("lbnav|")) {
        const leaderboardCmd = interaction.client.commands.get("leaderboard");
        if (leaderboardCmd?.handleComponent) {
          await leaderboardCmd.handleComponent(interaction);
        }
        return;
      }

      // (keep any other button systems you have below)
      return;
    }

  } catch (err) {
    console.error("interactionCreate error:", err);
  }
});


const logPath = path.join(__dirname, 'data', 'message_log.txt');

// xp + message logging
client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot) return;

    const original = message.content || "";
    const sanitized = sanitizeMessage(original);
    if (!sanitized) return;

    // message log (this can stay callback-based; it's append-only)
    fs.appendFile(logPath, sanitized + "\n", (err) => {
      if (err) console.error("Failed to append to message_log.txt:", err);
    });

    // paths
    const xpDataPath = path.join(__dirname, "data", "xp.json");
    const weeklyPath = path.join(__dirname, "data", "xp_weekly.json");
    const weeklyConfigPath = path.join(__dirname, "data", "weekly_config.json");

    const userId = message.author.id;
    const now = Date.now();

    // ---- multiplier + xpGain ----
    const mults = await loadMultipliers();
    let multiplier = getEffectiveMultiplier(message.member, message.channel, mults);

    // IMPORTANT: if any role is 0x, ensure multiplier is EXACTLY 0 (no rounding weirdness)
    if (!Number.isFinite(multiplier)) multiplier = 1;
    if (multiplier <= 0) multiplier = 0;

    const baseXP = Math.ceil(Math.random() * 65) + 85;
    const xpGain = Math.ceil(baseXP * multiplier);

    // If 0x, do nothing (and don't consume cooldown)
    if (xpGain <= 0) return;

    // We update BOTH files; lock in a consistent order to avoid deadlocks.
    await withFileLock(xpDataPath, async () => {
      await withFileLock(weeklyPath, async () => {
        // ---------- load weekly ----------
        let weekly = await readJsonSafe(weeklyPath, {
          weekKey: "",
          users: {},
          record: { userId: null, xp: 0 },
        });

        // back-compat
        weekly.users ??= {};
        weekly.record ??= { userId: null, xp: 0 };
        weekly.record.userId ??= null;
        weekly.record.xp = Number(weekly.record.xp ?? 0);

        const currentWeekKey = getISOWeekKey(new Date());

        // rollover if week changed
        if (weekly.weekKey !== currentWeekKey) {
          const entries = Object.entries(weekly.users || {})
            .map(([id, obj]) => [id, Number(obj?.xp ?? 0)])
            .sort((a, b) => b[1] - a[1]);

          const top10 = entries.slice(0, 10);

          // update record from last week's winner
          const winner = entries[0];
          if (winner) {
            const [winId, winXP] = winner;
            if (winXP > (weekly.record?.xp ?? 0)) {
              weekly.record = { userId: winId, xp: winXP };
            }
          }

          // announce (optional)
          try {
            const cfg = await readJsonSafe(weeklyConfigPath, { enabled: false });
            if (cfg?.enabled && cfg?.channelId && top10.length > 0) {
              const ch = await client.channels.fetch(cfg.channelId).catch(() => null);
              if (ch) {
                const medals = ["🥇", "🥈", "🥉"];
                const lines = top10.map(([id, xp], i) => {
                  const prefix = medals[i] ?? `**#${i + 1}**`;
                  return `${prefix} <@${id}> — **${xp} XP**`;
                });

                const recordLine = weekly.record?.userId
                  ? `\n🏆 **All-time best week:** <@${weekly.record.userId}> — **${weekly.record.xp} XP**`
                  : "";

                await ch.send(
                  `📊 **Weekly XP Results (${weekly.weekKey || "previous week"})**\n` +
                    lines.join("\n") +
                    recordLine
                );
              }
            }
          } catch (e) {
            console.error("Weekly announcement error:", e);
          }

          // reset for new week (keep record)
          weekly = {
            weekKey: currentWeekKey,
            users: {},
            record: weekly.record ?? { userId: null, xp: 0 },
          };

          // persist reset immediately
          await writeJsonAtomic(weeklyPath, weekly);
        }

        // ---------- load xp ----------
        const xpData = await readJsonSafe(xpDataPath, {});

        if (!xpData[userId]) xpData[userId] = { xp: 0, lastMessage: 0 };

        // cooldown: 60s
        const last = Number(xpData[userId].lastMessage ?? 0);
        if (now - last <= 60 * 1000) return;

        // old level before adding
        const oldXP = Number(xpData[userId].xp ?? 0);
        const oldLevel = getLevelFromXP(oldXP);

        // apply XP
        xpData[userId].xp = Math.floor(oldXP + xpGain);
        xpData[userId].lastMessage = now;

        // weekly XP
        if (!weekly.users[userId]) weekly.users[userId] = { xp: 0 };
        weekly.users[userId].xp = Math.floor(Number(weekly.users[userId].xp ?? 0) + xpGain);

        const newXP = xpData[userId].xp;
        const newLevel = getLevelFromXP(newXP);

        // write both atomically
        await writeJsonAtomic(xpDataPath, xpData);
        await writeJsonAtomic(weeklyPath, weekly);

        // level-up roles AFTER saving (so a crash doesn't lose XP)
        if (newLevel > oldLevel) {
          await handleLevelUpRoles(message.member, newLevel);
        }
      });
    });
  } catch (err) {
    console.error("Error in messageCreate handler:", err);
  }
});



// login
client.login(process.env.TOKEN);
