const config = require("./config.json");
const Discord = require("discord.js");
const rest = new Discord.REST({
	version: '10'
}).setToken(config.discord.token);
const fs = require("fs");
const path = require("path");
const colors = require("colors");
const client = new Discord.Client({
	intents: [
		"GuildMessages",
		"GuildMembers",
		"Guilds"
	]
});

// Use sqlite3 for object storage, and create a database if it doesn't exist
const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./levels.db");

// Create table if it doesn't exist
db.run("CREATE TABLE IF NOT EXISTS levels (id TEXT, xp INTEGER, lvl INTEGER, totalXp INTEGER, msgCount INTEGER)");

client.on("ready", async () => {
	console.log(`${colors.cyan("[INFO]")} Logged in as ${colors.green(client.user.tag)}`)
	// Load Commands
	console.log(`${colors.cyan("[INFO]")} Loading Commands...`)
	const commands = require('./commands.json');
	await (async () => {
		try {
			console.log(`${colors.cyan("[INFO]")} Registering Commands...`)
			let start = Date.now()
			// For every guild
			for (const guild of client.guilds.cache.values()) {
				let gStart = Date.now();
				console.log(`${colors.cyan("[INFO]")} Registering Commands for ${colors.green(guild.name)}...`);
				// Register commands
				await rest.put(
					Discord.Routes.applicationGuildCommands(client.user.id, guild.id), {
						body: commands
					},
				);
				console.log(`${colors.cyan("[INFO]")} Successfully registered commands for ${colors.green(guild.name)}. Took ${colors.green((Date.now() - gStart) / 1000)} seconds.`);
			};
			console.log(`${colors.cyan("[INFO]")} Successfully registered commands. Took ${colors.green((Date.now() - start) / 1000)} seconds.`);
		} catch (error) {
			console.error(error);
		}
	})();

	// Log startup time in seconds
	console.log(`${colors.cyan("[INFO]")} Startup took ${colors.green((Date.now() - initTime) / 1000)} seconds.`)
});


client.on("messageCreate", async message => {
	if (message.author.bot) return;
	if (message.channel.type === "DM") return;

	// Calculate random xp
	let xp = Math.floor(Math.random() * 10) + 15;
	// If user is not in database, add them, {user: {xp = xp, lvl = 1, totalXp: xp, msgCount = 1}}
	await db.get(`SELECT * FROM levels WHERE id = '${message.author.id}'`, async (err, row) => {
		if (err) {
			console.error(err);
		}
		if (!row) {
			await db.run(`INSERT INTO levels (id, xp, lvl, totalXp, msgCount) VALUES ('${message.author.id}', ${xp}, 1, ${xp}, 1)`); // Add user to database
		}
	});

	// Get user data
	await db.get(`SELECT * FROM levels WHERE id = '${message.author.id}'`, async (err, row) => {
		if (err) {
			console.error(err);
		}
		if (row) {
			var data = row;
			let lvl = data.lvl;
			data.msgCount++;

			// Cooldown
			if (cooldowns[message.author.id] && new Date() - cooldowns[message.author.id] < config.discord.levels.cooldownMinutes * 60 * 1000) return await db.run(`UPDATE levels SET xp = ${data.xp}, lvl = ${data.lvl}, totalXp = ${data.totalXp}, msgCount = ${data.msgCount} WHERE id = '${message.author.id}'`);
			cooldowns[message.author.id] = new Date();

			data.xp += xp;
			data.totalXp += xp;

			// If user is in database, and xp is greater than or equal to the calculated level up XP, add 1 to lvl and add the remainder to xp
			let lvlUpXp = eval(config.discord.levels.lvlUpEquation);
			if (data.xp >= lvlUpXp) {
				data.lvl++;
				data.xp -= lvlUpXp;
				message.channel.send(`${message.author}, you have leveled up to level ${data.lvl}!`).then(msg => {
					setTimeout(() => {
						msg.delete();
					}, 10000);
				});
			}

			// Update database
			await db.run(`UPDATE levels SET xp = ${data.xp}, lvl = ${data.lvl}, totalXp = ${data.totalXp}, msgCount = ${data.msgCount} WHERE id = '${message.author.id}'`);
		}
	});

});

client.on("interactionCreate", async interaction => {
	if (!interaction.isCommand()) return;
	switch (interaction.commandName) {
		case "rank":
			var user;
			if (interaction.options.getMember("user")) {
				user = interaction.options.getMember("user").user;
			} else {
				user = interaction.user;
			}
			// Get user data
			await db.get(`SELECT * FROM levels WHERE id = '${user.id}'`, async (err, row) => {
				if (err) {
					console.error(err);
				}
				if (!row) return interaction.reply({
					content: "This user has not sent any messages yet.",
					ephemeral: true
				});
				if (row) {
					var data = row;
					let lvl = data.lvl;
					interaction.reply({
						embeds: [{
							title: `${user.tag}'s Rank`,
							fields: [{
									name: "Level",
									value: data.lvl,
									inline: true
								},
								{
									name: "XP",
									value: `${data.xp}/${eval(config.discord.levels.lvlUpEquation)}`,
								},
								{
									name: "Total XP",
									value: data.totalXp,
									inline: true
								},
								{
									name: "Messages Sent",
									value: data.msgCount,
									inline: true
								}
							],
							color: 0x00ff00
						}]
					})
				}
			});
			break;
		case "leaderboard":
			await db.all(`SELECT * FROM levels ORDER BY totalXp DESC`, async (err, rows) => {
				if (err) {
					console.error(err);
				}
				if (!rows) return interaction.reply({
					content: "No one has sent any messages yet.",
					ephemeral: true
				});
				if (rows) {
					let leaderboard = [];
					// Top 10
					for (let i = 0; i < 10; i++) {
						if (rows[i]) {
							let user = await client.users.fetch(rows[i].id);
							let lvl = rows[i].lvl;
							leaderboard.push(`${i + 1}. <@${user.id}> - Level ${rows[i].lvl} - ${rows[i].totalXp} XP - ${rows[i].msgCount} Messages`);
						}
					}
					interaction.reply({
						embeds: [{
							title: "Leaderboard",
							description: leaderboard.join("\n"),
							color: 0x00ff00
						}]
					});
				}
			});
			break;
	};
});

// Handle SIGINT gracefully
process.on('SIGINT', async () => {
	await console.log(`${colors.cyan("[INFO]")} Stop received, exiting...`);
	await client.user.setPresence({
		status: "invisible",
		activities: []
	});
	await client.destroy();
	await console.log(`${colors.cyan("[INFO]")} Goodbye!`);
	process.exit(0);
});

// Global error handler
/*
process.on('uncaughtException', async (error) => {
	await console.error(`${colors.red("[ERROR]")} Uncaught Exception: ${error}`);
	if (client.user.tag) {
		client.channels.fetch(config.discord.errorChannel).then(async channel => {
			await channel.send({
				embeds: [{
					title: "Uncaught Exception",
					description: `\`\`\`${error}\`\`\``,
					color: 0xff0000
				}]
			});
		});
		await client.user.setPresence({
			status: "invisible",
			activities: []
		});
		await client.destroy();
	}
	await process.exit(1);
});

*/
// Global Variables
var cooldowns = {};


console.log(`${colors.cyan("[INFO]")} Starting...`)
// Start timer to see how long startup takes
const initTime = Date.now()
// Login to Discord
client.login(config.discord.token);