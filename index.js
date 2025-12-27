const {
    Client,
    GatewayIntentBits,
    Partials,
    Collection,
    ActivityType,
    EmbedBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

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

client.once('ready', () => {
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
});

// slash command handling
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
        } else {
            await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
        }
    }
});

const logPath = path.join(__dirname, 'data', 'message_log.txt');

// xp + message logging
client.on('messageCreate', async message => {
  try {
    // ignore bots
    if (message.author.bot) return;

    const original = message.content || '';
    let sanitized = sanitizeMessage(original);

    if (!sanitized) return; // skip empty after cleaning
    

    // one line per message
    fs.appendFile(logPath, sanitized + '\n', err => {
      if (err) console.error('Failed to append to message_log.txt:', err);
    });

    // xp system
    const xpDataPath = path.join(__dirname, 'data', 'xp.json');
const weeklyPath = path.join(__dirname, 'data', 'xp_weekly.json');
const weeklyConfigPath = path.join(__dirname, 'data', 'weekly_config.json');

// weekly xp — load and rollover
let weekly = {
  weekKey: "",
  users: {},
  record: { userId: null, xp: 0 }, // all-time best single-week XP
};

try {
  const rawWeekly = fs.readFileSync(weeklyPath, "utf8");
  weekly = JSON.parse(rawWeekly);

  // back-compat if old file is missing keys
  weekly.users ??= {};
  weekly.record ??= { userId: null, xp: 0 };
  weekly.record.userId ??= null;
  weekly.record.xp = Number(weekly.record.xp ?? 0);
} catch {
  weekly = {
    weekKey: "",
    users: {},
    record: { userId: null, xp: 0 },
  };
}

const currentWeekKey = getISOWeekKey(new Date());

if (weekly.weekKey !== currentWeekKey) {
  // announce last week's winners (if enabled)
  const entries = Object.entries(weekly.users || {})
    .map(([id, obj]) => [id, Number(obj?.xp ?? 0)])
    .sort((a, b) => b[1] - a[1]);

  const top10 = entries.slice(0, 10);

  // update all-time best-week record from last week's winner
  const winner = entries[0]; // [userId, xp]
  if (winner) {
    const [winId, winXP] = winner;
    if (winXP > (weekly.record?.xp ?? 0)) {
      weekly.record = { userId: winId, xp: winXP };
    }
  }

  try {
    const cfg = JSON.parse(fs.readFileSync(weeklyConfigPath, "utf8"));
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
  } catch {
    // ignore errors sending announcement
  }

  // reset for the new week (keep the all-time record)
  weekly = {
    weekKey: currentWeekKey,
    users: {},
    record: weekly.record ?? { userId: null, xp: 0 },
  };

  // write reset right away so it doesn't re-announce
  fs.writeFile(weeklyPath, JSON.stringify(weekly, null, 2), err => {
    if (err) console.error("Failed to write xp_weekly.json (rollover):", err);
  });
}


    let xpData = {};

    try {
      const rawData = fs.readFileSync(xpDataPath);
      xpData = JSON.parse(rawData);
    } catch (err) {
      console.error('Failed to read xp.json, starting fresh:', err);
    }

    const mults = await loadMultipliers();
    let multiplier = getEffectiveMultiplier(message.member, message.channel, mults);

    // clamp BEFORE using it
    multiplier = Math.max(0, multiplier);

    const userId = message.author.id;
    const now = Date.now();
    const baseXP = Math.ceil(Math.random() * 65) + 85;
    const xpGain = Math.ceil(baseXP * multiplier);

    if (!xpData[userId]) {
      xpData[userId] = { xp: 0, lastMessage: 0 };
    }

    // compute old level before adding xp
    const oldXP = xpData[userId].xp;
    const oldLevel = getLevelFromXP(oldXP);

    // 60s cooldown
    if (now - xpData[userId].lastMessage > 60 * 1000) {
      xpData[userId].xp += xpGain;
      // weekly xp
      if (!weekly.users[userId]) weekly.users[userId] = { xp: 0 };
      weekly.users[userId].xp += xpGain;

      xpData[userId].lastMessage = now;

      const newXP = xpData[userId].xp;
      const newLevel = getLevelFromXP(newXP);

      if (xpGain === 0) return;

      console.log(`Gave ${xpGain} XP to user ${message.author.tag} (Total: ${newXP}, mult: ${multiplier})`);

      if (newLevel > oldLevel) {
        await handleLevelUpRoles(message.member, newLevel);
      }

      fs.writeFile(xpDataPath, JSON.stringify(xpData, null, 2), err => {
        if (err) console.error('Failed to write xp.json:', err);
      });

      fs.writeFile(weeklyPath, JSON.stringify(weekly, null, 2), err => {
        if (err) console.error("Failed to write xp_weekly.json:", err);
      });

    }
  } catch (err) {
    console.error('Error in messageCreate handler:', err);
  }
});



// login
client.login(process.env.TOKEN);
