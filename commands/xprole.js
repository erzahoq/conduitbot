const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const fs = require("fs").promises;
const path = require("path");

const ALLOWED_USERS = [
  "717099413138440252", // you
  "535478766739259436", // bot owner(s)
];

// xp role config file
const xpRolesPath = path.join(__dirname, "..", "data", "xp_roles.json");

async function loadXPRoleConfig() {
  try {
    const raw = await fs.readFile(xpRolesPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveXPRoleConfig(cfg) {
  await fs.writeFile(xpRolesPath, JSON.stringify(cfg, null, 2), "utf8");
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("autorole")
    .setDescription("Configure XP-based auto roles.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand(sub =>
      sub
        .setName("set")
        .setDescription("Award a role when a user reaches a specific level.")
        .addIntegerOption(opt =>
          opt
            .setName("level")
            .setDescription("The level that should award the role")
            .setRequired(true)
        )
        .addRoleOption(opt =>
          opt
            .setName("role")
            .setDescription("The role to give at this level")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("remove")
        .setDescription("Remove the role given by a specific level.")
        .addIntegerOption(opt =>
          opt
            .setName("level")
            .setDescription("The level to remove the mapping for")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("list")
        .setDescription("List all configured XP → role mappings.")
    ),

  async execute(interaction) {
    const userId = interaction.user.id;

    // Hardcoded owner permission check
    if (!ALLOWED_USERS.includes(userId)) {
      return interaction.reply({
        content: "Only bot owners can configure XP roles.",
        ephemeral: true
      });
    }

    const sub = interaction.options.getSubcommand();
    const cfg = await loadXPRoleConfig();

    // =============== SET =====================
    if (sub === "set") {
      const level = interaction.options.getInteger("level");
      const role = interaction.options.getRole("role");

      cfg[level] = role.id;
      await saveXPRoleConfig(cfg);

      return interaction.reply(
        `✅ Added XP role:\n**Level ${level} → <@&${role.id}>**`
      );
    }

    // =============== REMOVE ===================
    if (sub === "remove") {
      const level = interaction.options.getInteger("level");

      if (cfg[level]) {
        delete cfg[level];
        await saveXPRoleConfig(cfg);
        return interaction.reply(`Removed XP role mapping for **Level ${level}**.`);
      } else {
        return interaction.reply(`No role is assigned to Level ${level}.`);
      }
    }

    // =============== LIST =====================
    if (sub === "list") {
      if (Object.keys(cfg).length === 0) {
        return interaction.reply("No XP role mappings are configured.");
      }

      const lines = Object.entries(cfg)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([lvl, roleId]) => `**Level ${lvl}** → <@&${roleId}>`);

      const chunks = [];
      let current = "**XP Role Mappings:**\n";

      for (const line of lines) {
        // +1 for newline
        if (current.length + line.length + 1 > 1900) {
          chunks.push(current);
          current = "";
        }
        current += line + "\n";
      }

      if (current.length > 0) {
        chunks.push(current);
      }

      // Send first chunk as reply, rest as follow-ups
      await interaction.reply(chunks[0]);

      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp(chunks[i]);
      }

      return;
    }


  }
};
