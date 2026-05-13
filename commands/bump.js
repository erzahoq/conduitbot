const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { readJsonSafe, writeJsonAtomic } = require('../helpers/jsonStore');
const { PATHS } = require('../config');

const bumpsPath = PATHS.data.bumps;
const COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours

module.exports = {
	data: new SlashCommandBuilder()
		.setName('bump')
		.setDescription('bump returns'),
	async execute(interaction) {
		const userId = interaction.user.id;
		const now = Date.now();

		// Read the current bumps data
		let bumpsData = await readJsonSafe(bumpsPath, {});

		// Check global cooldown
		if (bumpsData.lastGlobalBump && (now - bumpsData.lastGlobalBump) < COOLDOWN_MS) {
			const expirationTime = Math.floor((bumpsData.lastGlobalBump + COOLDOWN_MS) / 1000);
			await interaction.reply({ content: `bump is on cooldown! next bump available <t:${expirationTime}:R>`, ephemeral: true });
			return;
		}

		// Ensure the user has an entry
		if (!bumpsData[userId]) {
			bumpsData[userId] = { totalBumps: 0 };
		}

		// Increment the total bumps
		bumpsData[userId].totalBumps += 1;

		// Update last global bump
		bumpsData.lastGlobalBump = now;

		// Write back to file
		await writeJsonAtomic(bumpsPath, bumpsData);

		// Respond to the user
		const randomColor = Math.floor(Math.random() * 0xFFFFFF);
		const embed = new EmbedBuilder()
			.setTitle('Server Bumped!')
			.setDescription(`You now have ${bumpsData[userId].totalBumps} total bumps!`)
			.setColor(randomColor)
		await interaction.reply({ embeds: [embed], ephemeral: false });
	},
};