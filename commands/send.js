const { SlashCommandBuilder } = require('discord.js');
const { SEND_AUTHORIZED_IDS } = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('send')
    .setDescription('Send a message to a specified channel by ID')
    .addChannelOption(opt =>
      opt
        .setName('channel')
        .setDescription('Target text channel')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt
        .setName('message')
        .setDescription('Text to send in the channel')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!SEND_AUTHORIZED_IDS.includes(interaction.user.id)) {
      return interaction.reply({ content: 'You are not authorized to use this command.', ephemeral: true });
    }

    const targetChannel = interaction.options.getChannel('channel');
    const text = interaction.options.getString('message');

    if (!targetChannel || !targetChannel.isTextBased()) {
      return interaction.reply({ content: 'Please provide a valid text channel.', ephemeral: true });
    }

    try {
      await targetChannel.send(text);
      await interaction.reply({ content: `Message sent to <#${targetChannel.id}>.`, ephemeral: true });
    } catch (error) {
      console.error('[send command error]', error);
      await interaction.reply({ content: `Failed to send message: ${error.message || error}`, ephemeral: true });
    }
  },
};
