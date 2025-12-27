// Import necessary modules
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
require("dotenv").config();

const { cleanExtraNewlines, applyReplacements } = require('./sanitize');

const BOT_ID = "1439791725576192110";

// Clear the log file before starting fresh
fs.writeFileSync(path.join(__dirname, '..','data', 'message_log.txt'), '');
console.log('Cleared message_log.txt');



// Load replacement patterns from JSON
const replacementsRaw = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'data', 'replacements.json'), 'utf8')
);

// Compile them into RegExp objects (with global + case-insensitive flags, tweak as you like)
const replacementPatterns = Object.entries(replacementsRaw).map(([pattern, replacement]) => ({
    regex: new RegExp(pattern, 'gi'),
    replacement,
}));

require("dotenv").config();

// Create a client with the required intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message, Partials.Channel],
});

// On ready, start fetching messages
client.on('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    const serverId = "1286348686619705374"; // Replace with your server ID
    const guild = client.guilds.cache.get(serverId);

    if (!guild) {
        console.error("Server not found! Please check the server ID.");
        process.exit(1);
    }

    console.log(`Fetching messages from all channels in server: ${guild.name}`);

    // Loop through all channels in the server
    for (const [channelId, channel] of guild.channels.cache) {
        // Only process text channels
        if (channel.isTextBased()) {
            console.log(`Collecting messages from #${channel.name}...`);
            await fetchAllMessages(channel);
        }
    }

    console.log("Finished fetching messages from all channels.");
    process.exit(0); // Exit the script when done
});

// Function to fetch all messages from a specific channel
async function fetchAllMessages(channel) {
    let count = 0;
    let lastMessageId = null;
    let fetching = true;

    while (fetching) {
        const options = { limit: 100 };
        if (lastMessageId) options.before = lastMessageId;

        // Fetch messages from the channel
        const fetchedMessages = await channel.messages.fetch(options);

        let messageLog = fetchedMessages
        .filter(msg => !msg.author?.bot)
        .map(msg => {
            const original = msg.content || '';
            const sanitized = applyReplacements(original);
            return sanitized;
        })
        .join('\n');

    messageLog = cleanExtraNewlines(messageLog);
    fs.appendFileSync('./data/message_log.txt', messageLog + '\n');




        // Check if we've reached the end of the channel
        if (fetchedMessages.size < 100) {
            fetching = false;
        } else {
            // Get the ID of the last message fetched for pagination
            lastMessageId = fetchedMessages.last().id;
            count++;
            console.log(`Fetched ${count * 100} messages from #${channel.name}`);
        }
    }
}

// Login the bot
client.login(process.env.TOKEN);