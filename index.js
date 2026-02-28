require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

const DATA_FILE = './data.json';

/* ---------- Create data file if missing ---------- */
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({
        matches: [],
        predictions: {},
        leaderboard: {}
    }, null, 2));
}

function loadData() {
    return JSON.parse(fs.readFileSync(DATA_FILE));
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

/* ---------- Recalculate Leaderboard ---------- */
function recalculateLeaderboard(data) {
    data.leaderboard = {};

    data.matches.forEach(match => {
        if (!match.result) return;

        const [home, away] = match.result.split('-').map(Number);
        const preds = data.predictions[match.id] || {};

        for (const userId in preds) {
            const [ph, pa] = preds[userId].split('-').map(Number);
            let points = 0;

            if (ph === home && pa === away) {
                points = 3;
            } else if (
                (ph > pa && home > away) ||
                (ph < pa && home < away) ||
                (ph === pa && home === away)
            ) {
                points = 1;
            }

            data.leaderboard[userId] = (data.leaderboard[userId] || 0) + points;
        }
    });
}

/* ---------- Slash Commands ---------- */
const commands = [
    new SlashCommandBuilder()
        .setName('addmatch')
        .setDescription('Add match (Admin)')
        .addStringOption(o => o.setName('teams').setDescription('Team A vs Team B').setRequired(true))
        .addStringOption(o => o.setName('league').setDescription('League name').setRequired(true))
        .addStringOption(o => o.setName('time').setDescription('YYYY-MM-DD HH:MM').setRequired(true)),

    new SlashCommandBuilder()
        .setName('editmatch')
        .setDescription('Edit match (Admin)')
        .addIntegerOption(o => o.setName('matchid').setRequired(true))
        .addStringOption(o => o.setName('teams'))
        .addStringOption(o => o.setName('league'))
        .addStringOption(o => o.setName('time')),

    new SlashCommandBuilder()
        .setName('deletematch')
        .setDescription('Delete match (Admin)')
        .addIntegerOption(o => o.setName('matchid').setRequired(true)),

    new SlashCommandBuilder()
        .setName('predict')
        .setDescription('Predict match')
        .addIntegerOption(o => o.setName('matchid').setRequired(true))
        .addStringOption(o => o.setName('score').setDescription('Example: 2-1').setRequired(true)),

    new SlashCommandBuilder()
        .setName('setresult')
        .setDescription('Set result (Admin)')
        .addIntegerOption(o => o.setName('matchid').setRequired(true))
        .addStringOption(o => o.setName('score').setRequired(true)),

    new SlashCommandBuilder()
        .setName('editresult')
        .setDescription('Edit result (Admin)')
        .addIntegerOption(o => o.setName('matchid').setRequired(true))
        .addStringOption(o => o.setName('score').setRequired(true)),

    new SlashCommandBuilder()
        .setName('matches')
        .setDescription('View active matches'),

    new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View leaderboard'),

    new SlashCommandBuilder()
        .setName('resetseason')
        .setDescription('Reset season (Admin)')
];

/* ---------- Register Commands ---------- */
const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

client.once('ready', async () => {
    await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands }
    );
    console.log("Bot Ready");
});

/* ---------- Interaction Handler ---------- */
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const data = loadData();
    const adminRole = interaction.guild.roles.cache.find(r => r.name === "Match Admin");
    const isAdmin = adminRole && interaction.member.roles.cache.has(adminRole.id);

    /* ADD MATCH */
    if (interaction.commandName === 'addmatch') {
        if (!isAdmin) return interaction.reply({ content: "No permission.", ephemeral: true });

        if (data.matches.filter(m => !m.result).length >= 7)
            return interaction.reply("Max 7 active matches allowed.");

        const match = {
            id: Date.now(),
            teams: interaction.options.getString('teams'),
            league: interaction.options.getString('league'),
            time: new Date(interaction.options.getString('time')).getTime(),
            result: null
        };

        data.matches.push(match);
        saveData(data);

        return interaction.reply(`Match added with ID: ${match.id}`);
    }

    /* EDIT MATCH */
    if (interaction.commandName === 'editmatch') {
        if (!isAdmin) return interaction.reply({ content: "No permission.", ephemeral: true });

        const match = data.matches.find(m => m.id === interaction.options.getInteger('matchid'));
        if (!match) return interaction.reply("Match not found.");

        if (interaction.options.getString('teams')) match.teams = interaction.options.getString('teams');
        if (interaction.options.getString('league')) match.league = interaction.options.getString('league');
        if (interaction.options.getString('time')) match.time = new Date(interaction.options.getString('time')).getTime();

        saveData(data);
        return interaction.reply("Match updated.");
    }

    /* DELETE MATCH */
    if (interaction.commandName === 'deletematch') {
        if (!isAdmin) return interaction.reply({ content: "No permission.", ephemeral: true });

        const id = interaction.options.getInteger('matchid');

        data.matches = data.matches.filter(m => m.id !== id);
        delete data.predictions[id];

        recalculateLeaderboard(data);
        saveData(data);

        return interaction.reply("Match deleted and leaderboard updated.");
    }

    /* PREDICT */
    if (interaction.commandName === 'predict') {
        const match = data.matches.find(m => m.id === interaction.options.getInteger('matchid'));
        if (!match) return interaction.reply("Match not found.");
        if (match.result) return interaction.reply("Match already finished.");

        if (Date.now() > match.time - 10 * 60 * 1000)
            return interaction.reply("Prediction closed (10 mins before match).");

        if (!data.predictions[match.id])
            data.predictions[match.id] = {};

        data.predictions[match.id][interaction.user.id] =
            interaction.options.getString('score');

        saveData(data);

        return interaction.reply("Prediction saved.");
    }

    /* SET RESULT */
    if (interaction.commandName === 'setresult') {
        if (!isAdmin) return interaction.reply({ content: "No permission.", ephemeral: true });

        const match = data.matches.find(m => m.id === interaction.options.getInteger('matchid'));
        if (!match) return interaction.reply("Match not found.");

        match.result = interaction.options.getString('score');

        recalculateLeaderboard(data);
        saveData(data);

        const sorted = Object.entries(data.leaderboard)
            .sort((a, b) => b[1] - a[1]);

        let desc = sorted.map((u, i) =>
            `${i + 1}. <@${u[0]}> - ${u[1]} pts`
        ).join("\n");

        const embed = new EmbedBuilder()
            .setTitle("🏆 Leaderboard Updated")
            .setDescription(desc || "No predictions yet.");

        return interaction.reply({ content: "Result set!", embeds: [embed] });
    }

    /* EDIT RESULT */
    if (interaction.commandName === 'editresult') {
        if (!isAdmin) return interaction.reply({ content: "No permission.", ephemeral: true });

        const match = data.matches.find(m => m.id === interaction.options.getInteger('matchid'));
        if (!match || !match.result)
            return interaction.reply("Result not set yet.");

        match.result = interaction.options.getString('score');

        recalculateLeaderboard(data);
        saveData(data);

        return interaction.reply("Result corrected and leaderboard recalculated.");
    }

    /* MATCH LIST */
    if (interaction.commandName === 'matches') {
        const active = data.matches.filter(m => !m.result);
        if (!active.length)
            return interaction.reply("No active matches.");

        let desc = active.map(m =>
            `ID: ${m.id}\n${m.teams}\nLeague: ${m.league}\nTime: <t:${Math.floor(m.time / 1000)}:F>\n`
        ).join("\n");

        const embed = new EmbedBuilder()
            .setTitle("⚽ Active Matches")
            .setDescription(desc);

        return interaction.reply({ embeds: [embed] });
    }

    /* LEADERBOARD */
    if (interaction.commandName === 'leaderboard') {
        recalculateLeaderboard(data);
        saveData(data);

        const sorted = Object.entries(data.leaderboard)
            .sort((a, b) => b[1] - a[1]);

        if (!sorted.length)
            return interaction.reply("No leaderboard data yet.");

        let desc = sorted.map((u, i) =>
            `${i + 1}. <@${u[0]}> - ${u[1]} pts`
        ).join("\n");

        const embed = new EmbedBuilder()
            .setTitle("🏆 Leaderboard")
            .setDescription(desc);

        return interaction.reply({ embeds: [embed] });
    }

    /* RESET SEASON */
    if (interaction.commandName === 'resetseason') {
        if (!isAdmin) return interaction.reply({ content: "No permission.", ephemeral: true });

        data.matches = [];
        data.predictions = {};
        data.leaderboard = {};

        saveData(data);

        return interaction.reply("Season reset.");
    }
});

client.login(process.env.TOKEN);
