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
		"GuildMembers",
		"Guilds"
	]
});


// Use sqlite3 for object storage, and create a database if it doesn't exist
const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./database.db");

// Create table if it doesn't exist
db.run("CREATE TABLE IF NOT EXISTS points (id TEXT, points INTEGER)");
// update table if it does exist

client.on("ready", async () => {
	console.log(`${colors.cyan("[INFO]")} Logged in as ${colors.green(client.user.tag)}`)
	// Load Commands
	console.log(`${colors.cyan("[INFO]")} Loading Commands...`)
	const commands = require('./commands.json');
	await (async () => {
		try {
			console.log(`${colors.cyan("[INFO]")} Registering Commands...`)
			let start = Date.now()
			// Global commands
			await rest.put(Discord.Routes.applicationCommands(client.user.id), {
				body: commands
			});

			console.log(`${colors.cyan("[INFO]")} Successfully registered commands. Took ${colors.green((Date.now() - start) / 1000)} seconds.`);
		} catch (error) {
			console.error(error);
		}
	})();

	// Log startup time in seconds
	console.log(`${colors.cyan("[INFO]")} Startup took ${colors.green((Date.now() - initTime) / 1000)} seconds.`)
});

// Functions

checkAndModifyPoints = async (user, amount) => {
	// Check if the user exists, if not, add them to the database
	await db.get(`SELECT * FROM points WHERE id = '${user.id}'`, async (err, row) => {

		if (err) {
			console.error(`Smthn went wrong: ${err}`);
			return false;
		}
		if (!row) {
			await db.run(`INSERT INTO points (id, points) VALUES ('${user.id}', ${amount})`);
			return amount;
		}
		if (row) {
			await db.run(`UPDATE points SET points = ${row.points + amount} WHERE id = '${user.id}'`);
			return row.points + amount;
		}
		return false;
	});
}

client.on("interactionCreate", async interaction => {
	if (!interaction.isCommand()) return;
	switch (interaction.commandName) {
		case "points":
			var user;
			if (interaction.options.getMember("user")) {
				user = interaction.options.getMember("user").user;
			} else {
				user = interaction.user;
			}
			// Get user data
			await db.get(`SELECT * FROM points WHERE id = '${user.id}'`, async (err, row) => {
				if (err) {
					console.error(err);
				}
				if (!row) return interaction.reply({
					content: "This user does not have any coins.",
					ephemeral: true
				});
				if (row) {
					var data = row;
					interaction.reply({
						embeds: [{
							title: `${user.username}'s Coins`,
							description: `${config.discord.coin} ${data.points}`,
						}]
					});
				}
			});
			break;
		case "leaderboard":
			await db.all(`SELECT * FROM points ORDER BY points DESC`, async (err, rows) => {
				if (err) {
					console.error(err);
				}
				if (!rows) return interaction.reply({
					content: "It's quiet here...",
					ephemeral: true
				});
				if (rows) {
					let leaderboard = [];
					// Top 10
					for (let i = 0; i < 10; i++) {
						if (rows[i]) {
							let user = await client.users.fetch(rows[i].id);
							let lvl = rows[i].lvl;
							leaderboard.push(`${i + 1}. <@${user.id}> - ${rows[i].points}`);
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

		case "modify":
			// check if the user is in the config.discord.givers array
			if (!config.discord.givers.includes(interaction.user.id)) return interaction.reply({
				content: "You do not have permission to use this command.",
				ephemeral: true
			});
			// check if the arguments are there
			if (!interaction.options.getMember("user")) return interaction.reply({
				content: "You must specify a user.",
				ephemeral: true
			});
			if (!interaction.options.getNumber("amount")) return interaction.reply({
				content: "You must specify an amount.",
				ephemeral: true
			});
			let outputStatus = await checkAndModifyPoints(interaction.options.getMember("user").user, interaction.options.getNumber("amount"));
			if (outputStatus !== false) {
				interaction.reply({
					content: `Gave ${interaction.options.getMember("user").user.username} ${interaction.options.getNumber("amount")} coins.`,
					ephemeral: true
				});
			} else {
				interaction.reply({
					content: `An error occurred.\n`,
					ephemeral: true
				});
			}
			break;
		case "transfer": // Allows a user to transfer a positive amount of coins to another user at a 50% tax, rounded down, if the user sends 2 coins, the other user will receive 1, the other gets sent to the abyss.
			// check if the arguments are there
			if (!interaction.options.getMember("user")) return interaction.reply({
				content: "You must specify a user.",
				ephemeral: true
			});
			if (!interaction.options.getNumber("amount")) return interaction.reply({
				content: "You must specify an amount.",
				ephemeral: true
			});
			// Sanity check to make sure they arent trying to send negative coins and break the economy
			if (interaction.options.getNumber("amount") < 0) return interaction.reply({
				content: "You cannot send negative coins you lil goober.",
				ephemeral: true
			});
			// check if the user has enough coins
			await db.get(`SELECT * FROM points WHERE id = '${interaction.user.id}'`, async (err, row) => {
				if (err) {
					console.error(err);
					return interaction.reply({
						content: "An error occurred.",
						ephemeral: true
					});
				}
				if (!row) return interaction.reply({
					content: "You do not have any coins.",
					ephemeral: true
				});
				if (row) {
					if (row.points < interaction.options.getNumber("amount")) return interaction.reply({
						content: "You do not have enough coins.",
						ephemeral: true
					});
					// If the user doesnt have any coins tell them.
					if (row.points == 0) return interaction.reply({
						content: "You do not have any coins.",
						ephemeral: true
					});
					// Now check if they have enough for the tax
					if (row.points < Math.floor(interaction.options.getNumber("amount") * 2)) return interaction.reply({
						content: "You do not have enough coins to pay the tax.",
						ephemeral: true
					});
					// At this point we know they have enough coins, so we can take them away, make sure to take the tax away too
					checkAndModifyPoints(interaction.user, -Math.floor(interaction.options.getNumber("amount") * 2));
					// Now we can give the other user the coins
					checkAndModifyPoints(interaction.options.getMember("user").user, Math.floor(interaction.options.getNumber("amount")));
					// Now we can tell the user that it worked
					interaction.reply({
						embeds: [{
							title: "Transfer Successful",
							color: 0x00ff00,
							description: `You sent ${interaction.options.getNumber("amount")} coins to ${interaction.options.getMember("user").user.username}.`
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
/*process.on('uncaughtException', async (error) => {
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
	}
});*/



console.log(`${colors.cyan("[INFO]")} Starting...`)
// Start timer to see how long startup takes
const initTime = Date.now()
// Login to Discord
client.login(config.discord.token);