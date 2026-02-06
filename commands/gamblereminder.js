const { SlashCommandBuilder } = require("discord.js");
const path = require("path");
const { readJsonSafe, writeJsonAtomic, withFileLock } = require("../helpers/jsonStore");

const gambleCooldownPath = path.join(__dirname, "..", "data", "gamble_cooldowns.json");
const gambleReminderPath = path.join(__dirname, "..", "data", "gamble_reminders.json");

const COOLDOWN_MS = 6 * 60 * 60 * 1000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("gamblereminder")
    .setDescription("toggle DMs when your gamble cooldown is ready")
    .addStringOption(opt =>
      opt
        .setName("mode")
        .setDescription("turn reminders on/off")
        .setRequired(true)
        .addChoices(
          { name: "on", value: "on" },
          { name: "off", value: "off" },
          { name: "toggle", value: "toggle" }
        )
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const mode = interaction.options.getString("mode");
    const now = Date.now();

    const result = await withFileLock(gambleReminderPath, async () => {
      const reminders = await readJsonSafe(gambleReminderPath, {});
      const current = reminders[userId] ?? { enabled: false, nextAt: null };

      let enabled = current.enabled;

      if (mode === "on") enabled = true;
      else if (mode === "off") enabled = false;
      else enabled = !enabled; // toggle

      // If enabling, compute nextAt from last gamble time (if any)
      let nextAt = null;
      if (enabled) {
        const cooldowns = await readJsonSafe(gambleCooldownPath, {});
        const last = Number(cooldowns[userId] ?? 0);
        if (last > 0) {
          const expires = last + COOLDOWN_MS;
          nextAt = expires > now ? expires : null; // if already ready, no need to schedule
        }
      }

      reminders[userId] = { enabled, nextAt };
      await writeJsonAtomic(gambleReminderPath, reminders);

      return { enabled, nextAt };
    });

    if (!result.enabled) {
      return interaction.reply({
        content: "✅ gamble reminder DMs **disabled**.",
        ephemeral: true,
      });
    }

    if (result.nextAt) {
      const unix = Math.floor(result.nextAt / 1000);
      return interaction.reply({
        content: `✅ gamble reminder DMs **enabled**.\n-# next reminder <t:${unix}:R>`,
        ephemeral: true,
      });
    }

    return interaction.reply({
      content: "✅ gamble reminder DMs **enabled**.\n-# (you’re already off cooldown, so no reminder is scheduled until after your next gamble.)",
      ephemeral: true,
    });
  },
};
