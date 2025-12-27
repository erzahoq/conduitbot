const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { loadMultipliers, saveMultipliers } = require("../helpers/xpmult");

/* ---------------- CONFIG ---------------- */

// Only these user IDs can use /xpmult commands
const ALLOWED_USERS = [
  "717099413138440252", // you
  "535478766739259436", // others if needed
];

/* ---------------- SLASH COMMAND ---------------- */

module.exports = {
  data: new SlashCommandBuilder()
    .setName("multipliers")
    .setDescription("view and manage XP multipliers")

    // /xpmult list
    .addSubcommand(sub =>
      sub
        .setName("list")
        .setDescription("show all active XP multipliers")
    )

    // /xpmult set ...
    .addSubcommandGroup(group =>
      group
        .setName("set")
        .setDescription("Set XP multipliers")
        .addSubcommand(sub =>
          sub
            .setName("role")
            .setDescription("set XP multiplier for a role")
            .addRoleOption(opt =>
              opt
                .setName("role")
                .setDescription("target role")
                .setRequired(true)
            )
            .addNumberOption(opt =>
              opt
                .setName("multiplier")
                .setDescription("multiplier value (e.g. 1.5 for 150%)")
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(100)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName("channel")
            .setDescription("Set XP multiplier for a channel")
            .addChannelOption(opt =>
              opt
                .setName("channel")
                .setDescription("target channel")
                .setRequired(true)
            )
            .addNumberOption(opt =>
              opt
                .setName("multiplier")
                .setDescription("multiplier value (e.g. 2 for double XP)")
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(100)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName("user")
            .setDescription("Set XP multiplier for a user")
            .addUserOption(opt =>
              opt
                .setName("user")
                .setDescription("target user")
                .setRequired(true)
            )
            .addNumberOption(opt =>
              opt
                .setName("multiplier")
                .setDescription("multiplier value (e.g. 3 for triple XP)")
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(100)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName("default")
            .setDescription("Set the default XP multiplier")
            .addNumberOption(opt =>
              opt
                .setName("multiplier")
                .setDescription("default multiplier (usually 1)")
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(100)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName("stacking")
            .setDescription("set how multipliers stack")
            .addStringOption(opt =>
              opt
                .setName("mode")
                .setDescription("how to combine multiple multipliers")
                .setRequired(true)
                .addChoices(
                  { name: "max (take the highest multiplier this person has)", value: "max" },
                  { name: "multiply (multiply all multipliers)", value: "multiply" },
                  { name: "sum (add extras)", value: "sum" },
                )
            )
        )
    )

    // /xpmult clear ...
    .addSubcommandGroup(group =>
      group
        .setName("clear")
        .setDescription("Clear XP multipliers")
        .addSubcommand(sub =>
          sub
            .setName("role")
            .setDescription("Clear XP multiplier for a role")
            .addRoleOption(opt =>
              opt
                .setName("role")
                .setDescription("target role")
                .setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName("channel")
            .setDescription("Clear XP multiplier for a channel")
            .addChannelOption(opt =>
              opt
                .setName("channel")
                .setDescription("target channel")
                .setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName("user")
            .setDescription("Clear XP multiplier for a user")
            .addUserOption(opt =>
              opt
                .setName("user")
                .setDescription("target user")
                .setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName("all")
            .setDescription("clears ALL role/channel/user multipliers")
        )
    ),

  async execute(interaction) {
    // ---- Permission check ----
    if (!ALLOWED_USERS.includes(interaction.user.id)) {
      return interaction.reply({
        content: "You don't have permission to use `/xpmult`.",
        ephemeral: true,
      });
    }

    const subcommandGroup = interaction.options.getSubcommandGroup(false); // "set" / "clear" / null
    const subcommand = interaction.options.getSubcommand();                // e.g. "list", "role", "channel", ...

    // /xpmult list
    if (!subcommandGroup && subcommand === "list") {
      const mults = await loadMultipliers();

      const fmtVal = v => `${v}x`;

      const roleEntries = Object.entries(mults.roles || {});
      const channelEntries = Object.entries(mults.channels || {});
      const userEntries = Object.entries(mults.users || {});

      const roleText =
        roleEntries.length === 0
          ? "_None_"
          : roleEntries
              .sort((a, b) => b[1] - a[1])
              .map(([id, val]) => `• <@&${id}> → **${fmtVal(val)}**`)
              .join("\n");

      const channelText =
        channelEntries.length === 0
          ? "_None_"
          : channelEntries
              .sort((a, b) => b[1] - a[1])
              .map(([id, val]) => `• <#${id}> → **${fmtVal(val)}**`)
              .join("\n");

      const userText =
        userEntries.length === 0
          ? "_None_"
          : userEntries
              .sort((a, b) => b[1] - a[1])
              .map(([id, val]) => `• <@${id}> → **${fmtVal(val)}**`)
              .join("\n");

      const embed = new EmbedBuilder()
        .setTitle("XP Multiplier Configuration")
        .setColor("#4fe4dc")
        .setDescription(
          [
            `**Default multiplier:** \`${mults.default ?? 1}x\``,
            `**Stacking mode:** \`${mults.stackingMode || "max"}\``,
          ].join("\n")
        )
        .addFields(
          {
            name: "Role multipliers",
            value: roleText,
            inline: false,
          },
          {
            name: "Channel multipliers",
            value: channelText,
            inline: false,
          },
          {
            name: "User multipliers",
            value: userText,
            inline: false,
          }
        )
        .setFooter({ text: "Values are applied when XP is awarded." });

      return interaction.reply({ embeds: [embed], ephemeral: false });
    }

    // everything else needs the JSON loaded
    const mults = await loadMultipliers();

    /* ---------- /xpmult set ... ---------- */

    if (subcommandGroup === "set") {
      // /xpmult set role
      if (subcommand === "role") {
        const role = interaction.options.getRole("role");
        const multiplier = interaction.options.getNumber("multiplier");

        mults.roles[role.id] = multiplier;
        await saveMultipliers(mults);

        return interaction.reply({
          content: `✅ Set XP multiplier for role ${role} to **${multiplier}x**.`,
          ephemeral: false,
        });
      }

      // /xpmult set channel
      if (subcommand === "channel") {
        const channel = interaction.options.getChannel("channel");
        const multiplier = interaction.options.getNumber("multiplier");

        mults.channels[channel.id] = multiplier;
        await saveMultipliers(mults);

        return interaction.reply({
          content: `✅ Set XP multiplier for channel ${channel} to **${multiplier}x**.`,
          ephemeral: false,
        });
      }

      // /xpmult set user
      if (subcommand === "user") {
        const user = interaction.options.getUser("user");
        const multiplier = interaction.options.getNumber("multiplier");

        mults.users[user.id] = multiplier;
        await saveMultipliers(mults);

        return interaction.reply({
          content: `✅ Set XP multiplier for user **${user.username}** to **${multiplier}x**.`,
          ephemeral: false,
        });
      }

      // /xpmult set default
      if (subcommand === "default") {
        const multiplier = interaction.options.getNumber("multiplier");
        mults.default = multiplier;
        await saveMultipliers(mults);

        return interaction.reply({
          content: `✅ Set **default** XP multiplier to **${multiplier}x**.`,
          ephemeral: false,
        });
      }

      // /xpmult set stacking
      if (subcommand === "stacking") {
        const mode = interaction.options.getString("mode");
        mults.stackingMode = mode;
        await saveMultipliers(mults);

        return interaction.reply({
          content: `✅ Set stacking mode to **\`${mode}\`**.`,
          ephemeral: false,
        });
      }
    }

    /* ---------- /xpmult clear ... ---------- */

    if (subcommandGroup === "clear") {
      // /xpmult clear role
      if (subcommand === "role") {
        const role = interaction.options.getRole("role");
        if (mults.roles[role.id] !== undefined) {
          delete mults.roles[role.id];
          await saveMultipliers(mults);
          return interaction.reply({
            content: `✅ Cleared XP multiplier for role ${role}.`,
            ephemeral: false,
          });
        } else {
          return interaction.reply({
            content: `Role ${role} has no custom XP multiplier set.`,
            ephemeral: false,
          });
        }
      }

      // /xpmult clear channel
      if (subcommand === "channel") {
        const channel = interaction.options.getChannel("channel");
        if (mults.channels[channel.id] !== undefined) {
          delete mults.channels[channel.id];
          await saveMultipliers(mults);
          return interaction.reply({
            content: `✅ Cleared XP multiplier for channel ${channel}.`,
            ephemeral: false,
          });
        } else {
          return interaction.reply({
            content: `Channel ${channel} has no custom XP multiplier set.`,
            ephemeral: false,
          });
        }
      }

      // /xpmult clear user
      if (subcommand === "user") {
        const user = interaction.options.getUser("user");
        if (mults.users[user.id] !== undefined) {
          delete mults.users[user.id];
          await saveMultipliers(mults);
          return interaction.reply({
            content: `✅ Cleared XP multiplier for user **${user.username}**.`,
            ephemeral: false,
          });
        } else {
          return interaction.reply({
            content: `User **${user.username}** has no custom XP multiplier set.`,
            ephemeral: false,
          });
        }
      }

      // /xpmult clear all
      if (subcommand === "all") {
        mults.roles = {};
        mults.channels = {};
        mults.users = {};
        await saveMultipliers(mults);

        return interaction.reply({
          content: "✅ Cleared **all** role, channel, and user XP multipliers.\n(Default multiplier and stacking mode were left unchanged.)",
          ephemeral: false,
        });
      }
    }

    // fallback
    return interaction.reply({
      content: "Something went wrong with `/xpmult`.",
      ephemeral: true,
    });
  },
};
