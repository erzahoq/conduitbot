// Import necessary modules
const { Client, GatewayIntentBits, Partials } = require('discord.js');
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

    const channelId = "1323025075917688872"; // Replace with your channel ID
    const channel = await client.channels.fetch(channelId);

    if (!channel || !channel.isTextBased()) {
        console.error("Channel not found or is not a text-based channel! Please check the channel ID.");
        process.exit(1);
    }

    console.log(`Fetching messages from channel: #${channel.name}`);

    // Fetch all messages from the channel
    await fetchAllMessages(channel);

    console.log("Finished fetching messages.");
    process.exit(0); // Exit the script when done
});

// Function to fetch all messages from a specific channel
async function fetchAllMessages(channel) {
    let lastMessageId = null;
    let totalFetched = 0;

    while (true) {
        const options = { limit: 100 };
        if (lastMessageId) options.before = lastMessageId;

        // Fetch messages from the channel
        const fetchedMessages = await channel.messages.fetch(options);

        // Log messages to the console
        fetchedMessages.forEach(msg => {
            console.log(`[${msg.author.tag}] ${msg.content}`);
        });

        totalFetched += fetchedMessages.size;

        if (fetchedMessages.size === 0) {
            break; // Exit loop if no more messages are fetched
        }

        // Get the ID of the last message fetched for pagination
        lastMessageId = fetchedMessages.last().id;
    }

    console.log(`Total messages fetched: ${totalFetched}`);
}

// Login the bot
client.login(process.env.TOKEN);
