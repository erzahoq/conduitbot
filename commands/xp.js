const { SlashCommandBuilder } = require("discord.js");
const fs = require("fs").promises;
const path = require("path");

/* ---------------- CONFIG ---------------- */

// Only these user IDs can use /xp commands
const ALLOWED_USERS = [
  "717099413138440252", // replace with your ID
  "535478766739259436", // add/remove as needed
];

/* ---------------- XP + LEVEL FUNCTIONS ---------------- */

function xpForLevel(L) {
  if (L <= 0) return 0; // level 0 starts at 0 XP
  // use the same formula your rank command is using
  return 500 * L + 12 * Math.pow(L, 2.5) + Math.pow(L, Math.sqrt(L) / 3);
}

function getLevelFromXP(xp) {
  let lvl = 0;
  while (xp >= xpForLevel(lvl + 1)) lvl++;
  return lvl;
}

/* ---------------- FILE HELPERS ---------------- */

const xpPath = path.join(__dirname, "..", "data", "xp.json");

async function loadXPData() {
  try {
    const raw = await fs.readFile(xpPath, "utf8");
    if (!raw.trim()) return {}; // empty file → empty object
    return JSON.parse(raw);
  } catch (err) {
    // if file doesn't exist, just start with empty object
    if (err.code === "ENOENT") {
      return {};
    }
    console.error("Error loading xp.json:", err);
    throw err;
  }
}

async function saveXPData(data) {
  try {
    await fs.writeFile(xpPath, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("Error saving xp.json:", err);
    throw err;
  }
}

function ensureUserEntry(xpData, userId) {
  if (!xpData[userId]) {
    xpData[userId] = {
      xp: 0,
      lastMessage: 0,
    };
  }
}

/* ---------------- SLASH COMMAND ---------------- */

module.exports = {
  data: new SlashCommandBuilder()
    .setName("xp")
    .setDescription("admin controls for xp")
    .addSubcommand(sub =>
      sub
        .setName("add")
        .setDescription("add/subtract xp from a member")
        .addUserOption(opt =>
          opt
            .setName("member")
            .setDescription("target member")
            .setRequired(true)
        )
        .addIntegerOption(opt =>
          opt
            .setName("amount")
            .setDescription("xp to add (negative to remove)")
            .setRequired(true)
            .setMinValue(-1_000_000_000)
            .setMaxValue(1_000_000_000)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("reset")
        .setDescription("reset a specific member's xp to 0")
        .addUserOption(opt =>
          opt
            .setName("member")
            .setDescription("target member")
            .setRequired(true)
        )
    )
    .addSubcommandGroup(group =>
      group
        .setName("set")
        .setDescription("set xp or level directly")
        .addSubcommand(sub =>
          sub
            .setName("level")
            .setDescription("change the member's level")
            .addUserOption(opt =>
              opt
                .setName("member")
                .setDescription("target member")
                .setRequired(true)
            )
            .addIntegerOption(opt =>
              opt
                .setName("level")
                .setDescription("target level (0+).")
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(500)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName("xp")
            .setDescription("change the member's xp")
            .addUserOption(opt =>
              opt
                .setName("member")
                .setDescription("target member")
                .setRequired(true)
            )
            .addIntegerOption(opt =>
              opt
                .setName("amount")
                .setDescription("Total XP to set (0+).")
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(100_000_000_000)
            )
        )
    ),

  async execute(interaction) {
    try {
      // ---- Permission check ----
      if (!ALLOWED_USERS.includes(interaction.user.id)) {
        return interaction.reply({
          content: "You don't have permission to use `/xp` commands.",
          ephemeral: true,
        });
      }

      const subcommandGroup = interaction.options.getSubcommandGroup(false); // "set" or null
      const subcommand = interaction.options.getSubcommand();

      const xpData = await loadXPData();

      // Helper to reply with a consistent style
      const reply = (msg) =>
        interaction.reply({
          content: msg,
          ephemeral: false,
        });

      // ---------------- /xp add ----------------
      if (!subcommandGroup && subcommand === "add") {
        const targetUser = interaction.options.getUser("member");
        const amount = interaction.options.getInteger("amount");

        ensureUserEntry(xpData, targetUser.id);

        const oldXP = Math.floor(xpData[targetUser.id].xp || 0);
        let newXP = oldXP + amount;
        if (newXP < 0) newXP = 0;

        xpData[targetUser.id].xp = newXP;

        await saveXPData(xpData);

        const oldLevel = getLevelFromXP(oldXP);
        const newLevel = getLevelFromXP(newXP);

        return reply(
          `✅ Updated **${targetUser.username}**\n` +
            `XP: \`${oldXP}\` → \`${newXP}\` (Δ ${amount >= 0 ? "+" : ""}${amount})\n` +
            `Level: \`${oldLevel}\` → \`${newLevel}\``
        );
      }

      // ---------------- /xp reset ----------------
      if (!subcommandGroup && subcommand === "reset") {
        const targetUser = interaction.options.getUser("member");

        ensureUserEntry(xpData, targetUser.id);

        xpData[targetUser.id].xp = 0;

        await saveXPData(xpData);

        return reply(
          `Reset XP for **${targetUser.username}**.\nXP is now \`0\` (Level \`0\`).`
        );
      }

      // ---------------- /xp set level ----------------
      if (subcommandGroup === "set" && subcommand === "level") {
        const targetUser = interaction.options.getUser("member");
        const newLevel = interaction.options.getInteger("level");

        ensureUserEntry(xpData, targetUser.id);

        const oldXP = Math.floor(xpData[targetUser.id].xp || 0);
        const oldLevel = getLevelFromXP(oldXP);

        const newXP = Math.floor(xpForLevel(newLevel)) + 1; // minimum XP to be at that level

        xpData[targetUser.id].xp = newXP;

        await saveXPData(xpData);

        return reply(
          `Set level for **${targetUser.username}**.\n` +
            `Level: \`${oldLevel}\` → \`${newLevel}\`\n` +
            `XP: \`${oldXP}\` → \`${newXP}\``
        );
      }

      // ---------------- /xp set xp ----------------
      if (subcommandGroup === "set" && subcommand === "xp") {
        const targetUser = interaction.options.getUser("member");
        const amount = interaction.options.getInteger("amount");

        ensureUserEntry(xpData, targetUser.id);

        const oldXP = Math.floor(xpData[targetUser.id].xp || 0);
        const oldLevel = getLevelFromXP(oldXP);

        const newXP = Math.max(0, amount);
        const newLevel = getLevelFromXP(newXP);

        xpData[targetUser.id].xp = newXP;

        await saveXPData(xpData);

        return reply(
          `Set XP for **${targetUser.username}**.\n` +
            `XP: \`${oldXP}\` → \`${newXP}\`\n` +
            `Level: \`${oldLevel}\` → \`${newLevel}\``
        );
      }

      // Fallback (should never hit)
      return reply("Something went wrong with the `/xp` command.");
    } catch (err) {
      console.error("Error in /xp command:", err);
      // try to inform user if possible
      if (interaction.replied || interaction.deferred) {
        return interaction.editReply?.("❌ An error occurred while running this command.").catch(() => {});
      } else {
        return interaction.reply({
          content: "❌ An error occurred while running this command.",
          ephemeral: true,
        }).catch(() => {});
      }
    }
  },
};
