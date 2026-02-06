const { SlashCommandBuilder } = require("discord.js");
const path = require("path");

const { readJsonSafe, writeJsonAtomic, withFileLock } = require("../helpers/jsonStore");
const { getISOWeekKey } = require("../helpers/functions");

/* ---------------- CONFIG ---------------- */

// Only these user IDs can use /xp commands
const ALLOWED_USERS = [
  "717099413138440252",
  "535478766739259436",
];

/* ---------------- XP + LEVEL FUNCTIONS ---------------- */

function xpForLevel(L) {
  if (L <= 0) return 0;
  return 500 * L + 12 * Math.pow(L, 2.5) + Math.pow(L, Math.sqrt(L) / 3);
}

function getLevelFromXP(xp) {
  let lvl = 0;
  while (xp >= xpForLevel(lvl + 1)) lvl++;
  return lvl;
}

/* ---------------- PATHS ---------------- */

const xpPath = path.join(__dirname, "..", "data", "xp.json");
const weeklyPath = path.join(__dirname, "..", "data", "xp_weekly.json");

/* ---------------- HELPERS ---------------- */

function ensureUserEntry(xpData, userId) {
  if (!xpData[userId]) {
    xpData[userId] = { xp: 0, lastMessage: 0 };
  }
}

function ensureWeeklyShape(weekly) {
  weekly.weekKey ??= "";
  weekly.users ??= {};
  weekly.record ??= { userId: null, xp: 0 };
  weekly.record.userId ??= null;
  weekly.record.xp = Number(weekly.record.xp ?? 0);
  return weekly;
}

function resetWeeklyIfNeeded(weekly) {
  const currentWeekKey = getISOWeekKey(new Date());

  if (weekly.weekKey !== currentWeekKey) {
    // Keep record, reset users. (Announcement + record updates happen in your messageCreate handler.)
    weekly = {
      weekKey: currentWeekKey,
      users: {},
      record: weekly.record ?? { userId: null, xp: 0 },
    };
  }
  return weekly;
}

function getWeeklyXP(weekly, userId) {
  const v = weekly?.users?.[userId]?.xp;
  return Math.floor(Number(v ?? 0));
}

function setWeeklyXP(weekly, userId, xp) {
  weekly.users[userId] ??= { xp: 0 };
  weekly.users[userId].xp = Math.max(0, Math.floor(Number(xp ?? 0)));
}

function addWeeklyDelta(weekly, userId, delta) {
  const oldW = getWeeklyXP(weekly, userId);
  const newW = Math.max(0, oldW + Math.floor(Number(delta ?? 0)));
  setWeeklyXP(weekly, userId, newW);
  return { oldW, newW };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("xp")
    .setDescription("admin controls for xp")

    // ---------------- /xp add ----------------
    .addSubcommand(sub =>
      sub
        .setName("add")
        .setDescription("add/subtract xp from a member")
        .addUserOption(opt =>
          opt.setName("member").setDescription("target member").setRequired(true)
        )
        .addIntegerOption(opt =>
          opt
            .setName("amount")
            .setDescription("xp to add (negative to remove)")
            .setRequired(true)
            .setMinValue(-1_000_000_000)
            .setMaxValue(1_000_000_000)
        )
        .addBooleanOption(opt =>
          opt
            .setName("weekly")
            .setDescription("also apply to weekly leaderboard (default: true)")
            .setRequired(false)
        )
    )

    // ---------------- /xp reset ----------------
    .addSubcommand(sub =>
      sub
        .setName("reset")
        .setDescription("reset a specific member's xp to 0")
        .addUserOption(opt =>
          opt.setName("member").setDescription("target member").setRequired(true)
        )
        .addBooleanOption(opt =>
          opt
            .setName("weekly")
            .setDescription("also apply to weekly leaderboard (default: true)")
            .setRequired(false)
        )
    )

    // ---------------- /xp set ... ----------------
    .addSubcommandGroup(group =>
      group
        .setName("set")
        .setDescription("set xp or level directly")
        .addSubcommand(sub =>
          sub
            .setName("level")
            .setDescription("change the member's level")
            .addUserOption(opt =>
              opt.setName("member").setDescription("target member").setRequired(true)
            )
            .addIntegerOption(opt =>
              opt
                .setName("level")
                .setDescription("target level (0+).")
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(500)
            )
            .addBooleanOption(opt =>
              opt
                .setName("weekly")
                .setDescription("also apply to weekly leaderboard (default: true)")
                .setRequired(false)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName("xp")
            .setDescription("change the member's xp")
            .addUserOption(opt =>
              opt.setName("member").setDescription("target member").setRequired(true)
            )
            .addIntegerOption(opt =>
              opt
                .setName("amount")
                .setDescription("Total XP to set (0+).")
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(100_000_000_000)
            )
            .addBooleanOption(opt =>
              opt
                .setName("weekly")
                .setDescription("also apply to weekly leaderboard (default: true)")
                .setRequired(false)
            )
        )
    ),

  async execute(interaction) {
    try {
      if (!ALLOWED_USERS.includes(interaction.user.id)) {
        return interaction.reply({
          content: "You don't have permission to use `/xp` commands.",
          ephemeral: true,
        });
      }

      const subcommandGroup = interaction.options.getSubcommandGroup(false);
      const subcommand = interaction.options.getSubcommand();

      const reply = (msg) =>
        interaction.reply({ content: msg, ephemeral: false });

      // default weekly toggle = true
      const weeklyToggle = interaction.options.getBoolean("weekly");
      const applyWeekly = weeklyToggle !== false;

      // Lock in SAME ORDER as your messageCreate handler to avoid deadlocks.
      return await withFileLock(xpPath, async () => {
        return await withFileLock(weeklyPath, async () => {
          // Load files
          const xpData = await readJsonSafe(xpPath, {});
          let weekly = await readJsonSafe(weeklyPath, {
            weekKey: "",
            users: {},
            record: { userId: null, xp: 0 },
          });

          weekly = ensureWeeklyShape(weekly);
          weekly = resetWeeklyIfNeeded(weekly);

          const targetUser = interaction.options.getUser("member");

          // ---------------- /xp add ----------------
          if (!subcommandGroup && subcommand === "add") {
            const amount = interaction.options.getInteger("amount");

            ensureUserEntry(xpData, targetUser.id);

            const oldXP = Math.floor(Number(xpData[targetUser.id].xp ?? 0));
            let newXP = oldXP + amount;
            if (newXP < 0) newXP = 0;

            xpData[targetUser.id].xp = newXP;

            // weekly: add the SAME delta, clamp >= 0
            let weeklyInfo = null;
            if (applyWeekly) {
              weeklyInfo = addWeeklyDelta(weekly, targetUser.id, amount);
            }

            await writeJsonAtomic(xpPath, xpData);
            await writeJsonAtomic(weeklyPath, weekly);

            const oldLevel = getLevelFromXP(oldXP);
            const newLevel = getLevelFromXP(newXP);

            const weeklyLine = applyWeekly
              ? `Weekly: \`${weeklyInfo.oldW}\` → \`${weeklyInfo.newW}\` (clamped at 0)\n`
              : `Weekly: *(unchanged)*\n`;

            return reply(
              `✅ Updated **${targetUser.username}**\n` +
              `XP: \`${oldXP}\` → \`${newXP}\` (Δ ${amount >= 0 ? "+" : ""}${amount})\n` +
              weeklyLine +
              `Level: \`${oldLevel}\` → \`${newLevel}\``
            );
          }

          // ---------------- /xp reset ----------------
          if (!subcommandGroup && subcommand === "reset") {
            ensureUserEntry(xpData, targetUser.id);

            const oldXP = Math.floor(Number(xpData[targetUser.id].xp ?? 0));
            xpData[targetUser.id].xp = 0;

            // weekly: subtract what you removed (delta = -oldXP)
            let weeklyInfo = null;
            if (applyWeekly) {
              weeklyInfo = addWeeklyDelta(weekly, targetUser.id, -oldXP);
            }

            await writeJsonAtomic(xpPath, xpData);
            await writeJsonAtomic(weeklyPath, weekly);

            const weeklyLine = applyWeekly
              ? `Weekly: \`${weeklyInfo.oldW}\` → \`${weeklyInfo.newW}\` (clamped at 0)\n`
              : `Weekly: *(unchanged)*\n`;

            return reply(
              `✅ Reset XP for **${targetUser.username}**.\n` +
              `XP: \`${oldXP}\` → \`0\`\n` +
              weeklyLine +
              `Level: \`${getLevelFromXP(oldXP)}\` → \`0\``
            );
          }

          // ---------------- /xp set level ----------------
          if (subcommandGroup === "set" && subcommand === "level") {
            const newLevel = interaction.options.getInteger("level");

            ensureUserEntry(xpData, targetUser.id);

            const oldXP = Math.floor(Number(xpData[targetUser.id].xp ?? 0));
            const oldLevel = getLevelFromXP(oldXP);

            const newXP = Math.floor(xpForLevel(newLevel)) + 1;
            xpData[targetUser.id].xp = newXP;

            // weekly: apply delta between totals (can be negative), clamp weekly >= 0
            const delta = newXP - oldXP;
            let weeklyInfo = null;
            if (applyWeekly) {
              weeklyInfo = addWeeklyDelta(weekly, targetUser.id, delta);
            }

            await writeJsonAtomic(xpPath, xpData);
            await writeJsonAtomic(weeklyPath, weekly);

            const weeklyLine = applyWeekly
              ? `Weekly: \`${weeklyInfo.oldW}\` → \`${weeklyInfo.newW}\` (Δ ${delta >= 0 ? "+" : ""}${delta}, clamped at 0)\n`
              : `Weekly: *(unchanged)*\n`;

            return reply(
              `✅ Set level for **${targetUser.username}**.\n` +
              `Level: \`${oldLevel}\` → \`${newLevel}\`\n` +
              `XP: \`${oldXP}\` → \`${newXP}\` (Δ ${delta >= 0 ? "+" : ""}${delta})\n` +
              weeklyLine
            );
          }

          // ---------------- /xp set xp ----------------
          if (subcommandGroup === "set" && subcommand === "xp") {
            const amount = interaction.options.getInteger("amount");

            ensureUserEntry(xpData, targetUser.id);

            const oldXP = Math.floor(Number(xpData[targetUser.id].xp ?? 0));
            const oldLevel = getLevelFromXP(oldXP);

            const newXP = Math.max(0, Math.floor(Number(amount ?? 0)));
            const newLevel = getLevelFromXP(newXP);

            xpData[targetUser.id].xp = newXP;

            // weekly: apply delta between totals, clamp weekly >= 0
            const delta = newXP - oldXP;
            let weeklyInfo = null;
            if (applyWeekly) {
              weeklyInfo = addWeeklyDelta(weekly, targetUser.id, delta);
            }

            await writeJsonAtomic(xpPath, xpData);
            await writeJsonAtomic(weeklyPath, weekly);

            const weeklyLine = applyWeekly
              ? `Weekly: \`${weeklyInfo.oldW}\` → \`${weeklyInfo.newW}\` (Δ ${delta >= 0 ? "+" : ""}${delta}, clamped at 0)\n`
              : `Weekly: *(unchanged)*\n`;

            return reply(
              `✅ Set XP for **${targetUser.username}**.\n` +
              `XP: \`${oldXP}\` → \`${newXP}\` (Δ ${delta >= 0 ? "+" : ""}${delta})\n` +
              weeklyLine +
              `Level: \`${oldLevel}\` → \`${newLevel}\``
            );
          }

          return reply("Something went wrong with the `/xp` command.");
        });
      });
    } catch (err) {
      console.error("Error in /xp command:", err);
      if (interaction.replied || interaction.deferred) {
        return interaction.editReply?.("❌ An error occurred while running this command.").catch(() => {});
      }
      return interaction.reply({
        content: "❌ An error occurred while running this command.",
        ephemeral: true,
      }).catch(() => {});
    }
  },
};
