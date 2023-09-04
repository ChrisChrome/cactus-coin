const config = require("./config.json");
if (!config.debug) config.debug = false;
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
		"Guilds",
		"GuildMessages",
		"MessageContent"
	]
});


// Use sqlite3 for object storage, and create a database if it doesn't exist
const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./database.db");

// Create table if it doesn't exist
db.run("CREATE TABLE IF NOT EXISTS points (id TEXT, points INTEGER)");
db.run("CREATE TABLE IF NOT EXISTS cooldowns (id TEXT, type TEXT, cooldown TEXT)");

client.on("ready", async () => {
	console.log(`${colors.cyan("[INFO]")} Logged in as ${colors.green(client.user.tag)}`)
	// Load Commands
	console.log(`${colors.cyan("[INFO]")} Loading Commands...`)
	const commands = require('./commands.json');
	await (async () => {
		try {
			console.log(`${colors.cyan("[INFO]")} Registering Commands...`)
			start = Date.now()
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

checkAndModifyPoints = async (user, amount, override) => {
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
			if (override) {
				await db.run(`UPDATE points SET points = ${amount} WHERE id = '${user.id}'`);
				return amount;
			}
			await db.run(`UPDATE points SET points = ${row.points + amount} WHERE id = '${user.id}'`);
			return row.points + amount;
		}
		return false;
	});
}

checkPoints = (user) => {
	// Needs to be awaited
	return new Promise((resolve, reject) => {
		db.get(`SELECT * FROM points WHERE id = '${user.id}'`, async (err, row) => {
			if (err) {
				console.error(err);
				reject(err);
			}
			if (!row) {
				await db.run(`INSERT INTO points (id, points) VALUES ('${user.id}', 0)`);
				resolve(0);
			}
			if (row) {
				resolve(row.points);
			}
		});
	});
}

checkCooldown = (user, type) => {
	// Needs to be awaited
	return new Promise((resolve, reject) => {
		// If they are still within the cooldown period return true, if not return false
		db.get(`SELECT * FROM cooldowns WHERE id = '${user.id}' AND type = '${type}'`, async (err, row) => {
			if (err) {
				console.error(err);
				reject(err);
			}
			if (!row) {
				resolve(false);
			}
			if (row) {
				if (row.cooldown > Date.now()) {
					resolve(row.cooldown);
				} else {
					resolve(false);
				}
			}
		});
	});
}

setCooldown = (user, type, cooldown) => {
	// Needs to be awaited
	return new Promise((resolve, reject) => {
		// If any error occurs reject, otherwise return true
		// check if the user and type combo exists, if it does update it, if it doesnt create it
		db.get(`SELECT * FROM cooldowns WHERE id = '${user.id}' AND type = '${type}'`, async (err, row) => {
			if (err) {
				console.error(err);
				reject(err);
			}
			if (!row) {
				await db.run(`INSERT INTO cooldowns (id, type, cooldown) VALUES ('${user.id}', '${type}', '${Date.now() + cooldown}')`, (err) => {
					if (err) {
						console.error(err);
						reject(err);
					}
					resolve(true);
				});
			}
			if (row) {
				await db.run(`UPDATE cooldowns SET cooldown = '${Date.now() + cooldown}' WHERE id = '${user.id}' AND type = '${type}'`, (err) => {
					if (err) {
						console.error(err);
						reject(err);
					}
					resolve(true);
				});
			}
		});
	});
}

var slotResults = {};

client.on("interactionCreate", async interaction => {
	if (!interaction.isCommand()) return;
	switch (interaction.commandName) {
		case "coins":
			// Get user data
			user = interaction.options.getUser("user") || interaction.user;
			balance = await checkPoints(interaction.options.getUser("user") || interaction.user);
			interaction.reply({
				embeds: [{
					title: `${user.username}'s Coins`,
					description: `${config.discord.coin}${balance}`,
				}]
			});
			break;
		case "leaderboard":
			// Get the type option, if its "inverted" then order by points ASC, if its not set then order by points DESC
			type = interaction.options.getString("type") || "DESC";
			// Switch type for the header of the embed
			switch (type) {
				case "DESC":
					header = "Leaderboard";
					break;
				case "ASC":
					header = "Inverted Leaderboard";
					break;
			}
			await db.all(`SELECT * FROM points ORDER BY points ${type}`, async (err, rows) => {
				if (err) {
					console.error(err);
				}
				if (!rows) return interaction.reply({
					content: "It's quiet here...",
					ephemeral: true
				});
				if (rows) {
					leaderboard = [];
					// Top 10
					for (let i = 0; i < 10; i++) {
						if (rows[i]) {
							user = await client.users.fetch(rows[i].id);
							lvl = rows[i].lvl;
							leaderboard.push(`${i + 1}. <@${user.id}> • ${config.discord.coin} ${rows[i].points}`);
						}
					}
					interaction.reply({
						embeds: [{
							title: header,
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
			outputStatus = await checkAndModifyPoints(interaction.options.getMember("user").user, interaction.options.getNumber("amount"), interaction.options.getBoolean("override") || false);
			if (outputStatus !== false) {
				interaction.reply({
					content: `Gave ${interaction.options.getMember("user").user.username} ${interaction.options.getNumber("amount")} coins.`,
					ephemeral: true
				});
				// add + or - to the amount
				amount = interaction.options.getNumber("amount");
				if (amount > 0) {
					amount = `+${amount}`;
				}
				// Send the log to the log channel
				// Tell the user their coins were modified
				interaction.options.getMember("user").user.send({
					embeds: [{
						title: "Coins Modified",
						description: `${config.discord.coin}${amount}`,
						color: 0xFFff00
					}]
				}).catch(err => { });


			} else {
				interaction.reply({
					content: `An error occurred.\n`,
					ephemeral: true
				});
			}
			break;
		case "modifyrandom": // Allows a user to modify a random user's coins
			// check if the user is in the config.discord.givers array
			if (!config.discord.givers.includes(interaction.user.id)) return interaction.reply({
				content: "You do not have permission to use this command.",
				ephemeral: true
			});
			switch (interaction.options.getString("type")) {
				case "database":
					// Get a random user from the database
					await db.all(`SELECT * FROM points`, async (err, rows) => {
						if (err) {
							console.error(err);
						}
						if (!rows) return interaction.reply({
							content: "It's quiet here...",
							ephemeral: true
						});
						if (rows) {
							randomUser = await rows[Math.floor(Math.random() * rows.length)];
							randomUser = await client.users.fetch(randomUser.id);
							outputStatus = await checkAndModifyPoints(await client.users.fetch(randomUser.id), interaction.options.getNumber("amount"));
							if (outputStatus !== false) {
								interaction.reply({
									content: `Gave ${await client.users.fetch(randomUser.id)} ${interaction.options.getNumber("amount")} coins.`,
									ephemeral: true
								});
								// add + or - to the amount
								amount = interaction.options.getNumber("amount");
								if (amount > 0) {
									amount = `+${amount}`;
								}
								// Send the log to the log channel
								// Tell the user their coins were modified
								randomUser.send({
									embeds: [{
										title: "Coins Modified",
										description: `${config.discord.coin}${amount}`,
										color: 0xFFff00
									}]
								}).catch(err => { });

							} else {
								interaction.reply({
									content: `An error occurred.\n`,
									ephemeral: true
								});
							}
						}
					});
					break;
				case "guild":
					// Get a random user from the guild
					await interaction.guild.members.fetch();
					userList = await interaction.guild.members.cache.filter(member => !member.user.bot);
					randomUser = await userList[Math.floor(Math.random() * userList.length)];
					outputStatus = await checkAndModifyPoints(randomUser.user, interaction.options.getNumber("amount"));
					if (outputStatus !== false) {
						interaction.reply({
							content: `Gave ${randomUser.user.username} ${interaction.options.getNumber("amount")} coins.`,
							ephemeral: true
						});
						// add + or - to the amount
						amount = interaction.options.getNumber("amount");
						if (amount > 0) {
							amount = `+${amount}`;
						}
						// Send the log to the log channel
						// Tell the user their coins were modified
						randomUser.user.send({
							embeds: [{
								title: "Coins Modified",
								description: `${config.discord.coin}${amount}`,
								color: 0xFFff00
							}]
						}).catch(err => { });
					} else {
						interaction.reply({
							content: `An error occurred.\n`,
							ephemeral: true
						});
					}
					break;
			}
			break;
		case "modifyeveryone": // Modify the coins of everyone in the database
			// check if the user is in the config.discord.givers array
			if (!config.discord.givers.includes(interaction.user.id)) return interaction.reply({
				content: "You do not have permission to use this command.",
				ephemeral: true
			});
			// Run a lil db query to update every user's coins, dont bother sending a message to the user, it would take too long
			await db.all(`SELECT * FROM points`, async (err, rows) => {
				if (err) {
					console.error(err);
				}
				if (!rows) return interaction.reply({
					content: "It's quiet here...",
					ephemeral: true
				});
				if (rows) {
					for (let i = 0; i < rows.length; i++) {
						checkAndModifyPoints(await client.users.fetch(rows[i].id), interaction.options.getNumber("amount"));
					}
					interaction.reply({
						content: `Gave everyone ${interaction.options.getNumber("amount")} coins.`,
						ephemeral: true
					});
				}
			});
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
			// Sanity check to make sure they aren't trying to send negative coins and break the economy
			if (interaction.options.getNumber("amount") < 0) return interaction.reply({
				content: "You cannot send negative coins you lil goober.",
				ephemeral: true
			});
			// Check if they're trying to be funny and send money to themselves.
			if (interaction.user.id == interaction.options.getMember("user").user.id) return interaction.reply({
				content: "You can't send coins to yourself silly.",
				ephemeral: true
			});

			// Round the input up (these fuckers found a dupe one fucking day into the bot, fuck you krill issue)
			amount = interaction.options.getNumber("amount");

			balance = await checkPoints(interaction.user);
			if (balance < amount) return interaction.reply({
				content: "You do not have enough coins.",
				ephemeral: true
			});
			// If the user doesnt have any coins tell them.
			if (balance == 0) return interaction.reply({
				content: "You do not have any coins.",
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
					if (balance < amount) return interaction.reply({
						content: "You do not have enough coins.",
						ephemeral: true
					});
					// If the user doesnt have any coins tell them.
					if (balance == 0) return interaction.reply({
						content: "You do not have any coins.",
						ephemeral: true
					});
					// Now check if they have enough for the tax
					if (balance < amount * 1.25) return interaction.reply({
						content: `You do not have enough coins to pay the tax of ${config.discord.coin}${amount * 0.25}. You only have ${config.discord.coin}${balance}.`,
						ephemeral: true
					});
					// At this point we know they have enough coins, so we can take them away, make sure to take the tax away too
					checkAndModifyPoints(interaction.user, -amount * 1.25);
					// Now we can give the other user the coins
					checkAndModifyPoints(interaction.options.getMember("user").user, amount);
					// Now we can tell the user that it worked
					// get the amount sent with 2 decimal places if it has a decimal
					if (amount % 1 != 0) {
						amount = amount.toFixed(2);
					}
					interaction.reply({
						embeds: [{
							title: "Transfer Successful",
							color: 0x00ff00,
							description: `You sent ${config.discord.coin}${amount} to ${interaction.options.getMember("user").user.username}.`
						}]
					});
					// Tell the user being transferred from about the change as a sort of receipt
					interaction.options.getMember("user").user.send({
						embeds: [{
							title: "Transfer Receipt",
							color: 0xffff00,
							description: `You received ${config.discord.coin}${amount} from ${interaction.user}.`
						}]
					}).catch(err => { });
					interaction.user.send({
						embeds: [{
							title: "Transfer Receipt",
							color: 0xffff00,
							description: `You sent ${config.discord.coin}${amount} to ${interaction.options.getMember("user").user}.\nYou paid a tax of ${config.discord.coin}${amount * 0.25}.`
						}]
					}).catch(err => { });

				}
			});
			break;
		case "ledger": // Allows a user to see the balance of every user in the database
			db.all(`SELECT * FROM points`, async (err, rows) => {
				if (err) {
					console.error(err);
					return interaction.reply({
						content: "An error occurred.",
						ephemeral: true
					});
				}
				if (!rows) return interaction.reply({
					content: "It's quiet here...",
					ephemeral: true
				});
				if (rows) {
					ledger = [];
					for (let i = 0; i < rows.length; i++) {
						user = await client.users.fetch(rows[i].id);
						if (rows[i].points == 0) continue;
						ledger.push(`${user.username} - ${rows[i].points}`);
					}
					interaction.reply({
						embeds: [{
							title: "Ledger",
							description: ledger.join("\n"),
							color: 0x00ff00
						}]
					});
				}
			});
			break;
		case "play": // Allows a user to play a game to earn coins (or lose them)
			curCooldown = await checkCooldown(interaction.user, interaction.options.getString("game"))
			if (curCooldown) {
				return interaction.reply({
					content: `You can play again <t:${Math.floor(await checkCooldown(interaction.user, interaction.options.getString("game")) / 1000)}:R>.`,
					ephemeral: true
				});
			}
			setCooldown(interaction.user, interaction.options.getString("game"), config.games.waitPeriod * 60 * 1000);

			// Check if they're in debt, if they are dont let them play
			balance = await checkPoints(interaction.user);
			if (balance < 0) return interaction.reply({
				content: "You are in debt, you cannot play games until you are out of debt.",
				ephemeral: true
			});

			result = await playGame(interaction.options.getString("game"));
			await checkAndModifyPoints(interaction.user, result.difference);
			interaction.reply(result.string);
			break;
		case "slots": // Play some slots, 1 minute cooldown
			curCooldown = await checkCooldown(interaction.user, "slots")
			if (curCooldown) {
				return interaction.reply({
					content: `You can play again <t:${Math.floor(await checkCooldown(interaction.user, "slots") / 1000)}:R>.`,
					ephemeral: true
				});
			}

			// Check if they have enough money to play, 3 coins, if they do take it and continue
			balance = await checkPoints(interaction.user);
			if (balance < 3) return interaction.reply({
				content: "You do not have enough coins to play slots.",
				ephemeral: true
			});

			// Get the slot results, yes it's pre-defined, but it's not like it matters
			slotResults[interaction.user.id] = playSlotMachine();
			// If there is a slotResults[interaction.user.id].cooldownOverride use that instead
			if (slotResults[interaction.user.id].cooldownOverride) {
				setCooldown(interaction.user, "slots", slotResults[interaction.user.id].cooldownOverride * 60 * 1000)
			} else {
				setCooldown(interaction.user, "slots", config.games.slots.cooldown * 60 * 1000)
			}
			await interaction.reply({
				embeds: [{
					title: "Slots",
					description: `[${config.games.slots.spinning}][${config.games.slots.spinning}][${config.games.slots.spinning}]`,
					color: 0xffff00
				}]
			});

			// Check if they won or lost, if they won, give them the prize
			difference = await new Number(slotResults[interaction.user.id].coinDifference);
			// If they lost subtract 3 coins from the difference
			if (difference <= 0) difference -= 3;
			// Wait 4 seconds, then one at a time change the slots, 1 second apart
			setTimeout(async () => {
				await interaction.editReply({
					embeds: [{
						title: "Slots",
						description: `[${slotResults[interaction.user.id].spinResult[0]}][${config.games.slots.spinning}][${config.games.slots.spinning}]`,
						color: 0xffff00
					}]
				}, 1000);
				setTimeout(async () => {
					await interaction.editReply({
						embeds: [{
							title: "Slots",
							description: `[${slotResults[interaction.user.id].spinResult[0]}][${slotResults[interaction.user.id].spinResult[1]}][${config.games.slots.spinning}]`,
							color: 0xffff00
						}]
					}, 1000);
					setTimeout(async () => {
						await interaction.editReply({
							embeds: [{
								title: "Slots",
								description: `[${slotResults[interaction.user.id].spinResult[0]}][${slotResults[interaction.user.id].spinResult[1]}][${slotResults[interaction.user.id].spinResult[2]}]`,
								color: 0xffff00
							}]
						});
						if (difference > 0) {
							if (slotResults[interaction.user.id].jackpot) {
								return await interaction.editReply({
									embeds: [{
										title: "Jackpot!",
										description: `:rotating_light: [${slotResults[interaction.user.id].spinResult[0]}][${slotResults[interaction.user.id].spinResult[1]}][${slotResults[interaction.user.id].spinResult[2]}] :rotating_light:\nYou won the jackpot! (${difference} coins)`,
										color: 0xffffff
									}]
								});
							} else if (slotResults[interaction.user.id].triple) {
								return await interaction.editReply({
									embeds: [{
										title: "Triple!",
										description: `[${slotResults[interaction.user.id].spinResult[0]}][${slotResults[interaction.user.id].spinResult[1]}][${slotResults[interaction.user.id].spinResult[2]}]\nYou won ${difference} coins!`,
										color: 0x00ffff
									}]
								});
							} else {
								await interaction.editReply({
									embeds: [{
										title: "Slots",
										description: `[${slotResults[interaction.user.id].spinResult[0]}][${slotResults[interaction.user.id].spinResult[1]}][${slotResults[interaction.user.id].spinResult[2]}]\nYou won ${difference} coins! (You get your play fee back)`,
										color: 0x00ff00
									}]
								});
							}
						} else {
							// They lost, sad
							if (slotResults[interaction.user.id].bombs) {
								// Triple bombs, very sad
								await interaction.editReply({
									embeds: [{
										title: "Bombs!",
										description: `[${slotResults[interaction.user.id].spinResult[0]}][${slotResults[interaction.user.id].spinResult[1]}][${slotResults[interaction.user.id].spinResult[2]}]\nYou lost ${Math.abs(difference)} coins!`,
										color: 0xff0000
									}]
								});
							} else {
								await interaction.editReply({
									embeds: [{
										title: "Slots",
										description: `[${slotResults[interaction.user.id].spinResult[0]}][${slotResults[interaction.user.id].spinResult[1]}][${slotResults[interaction.user.id].spinResult[2]}]\nYou lost ${Math.abs(difference)} coins!`,
										color: 0xff0000
									}]
								});
							}
						}
						await checkAndModifyPoints(interaction.user, difference);
					}, 1000);
				}, 1000);
			}, 4000);
			break;
		case "coinflip": // Coinflip game
			/*
			Minimum Bet: 1
			Maximum Bet: 10
			*/

			// Check cooldown
			curCooldown = await checkCooldown(interaction.user, "coinflip")
			if (curCooldown) {
				return interaction.reply({
					content: `You can play again <t:${Math.floor(await checkCooldown(interaction.user, "coinflip") / 1000)}:R>.`,
					ephemeral: true
				});
			}
			setCooldown(interaction.user, "coinflip", config.games.coinflip.cooldown * 60 * 1000)

			bet = parseInt(interaction.options.get("amount").value);
			if (bet < 1 || bet > 10) return interaction.reply({
				content: "You can only bet between 1 and 10 coins.",
				ephemeral: true
			});

			// Check if they have enough coins
			points = await checkPoints(interaction.user);
			if (points < bet) return interaction.reply({
				content: "You do not have enough coins to play coinflip.",
				ephemeral: true
			});

			// Flip the coin
			coin = Math.random() < 0.5 ? "heads" : "tails";
			before = await checkPoints(interaction.user);
			side = interaction.options.getString("side");
			outcome = coin == side ? true : false;
			// If they win, give them the prize, if they lose, take the prize
			// if they lose inverse the bet
			if (!outcome) bet = -bet;
			await checkAndModifyPoints(interaction.user, bet);
			if (coin == "heads") return interaction.reply({
				embeds: [{
					title: "Coinflip",
					description: `You flipped ${config.games.coinflip.heads} and **${outcome ? "won" : "lost"}** ${Math.abs(bet)} coins!`,
					color: outcome ? 0x00ff00 : 0xff0000
				}]
			});
			else if (coin == "tails") return interaction.reply({
				embeds: [{
					title: "Coinflip",
					description: `You flipped ${config.games.coinflip.tails} and **${outcome ? "won" : "lost"}** ${Math.abs(bet)} coins!`,
					color: outcome ? 0x00ff00 : 0xff0000
				}]
			});
			else return interaction.reply({
				embeds: [{
					title: "Something Went Wrong",
					description: `The coin is neither heads nor tails, this shouldn't be possible!`,
					color: 0xff0000
				}]
			});
			break;
		case "snakeeyes": // Snakeeyes game
			/*
			Minimum Bet: 1
			Maximum Bet: 10
			roll a 6 sided dice, if the number lands on 1, you win.
			If you win your bet will be tripled, if you lose you lose your entire bet.
			*/

			// Check cooldown
			curCooldown = await checkCooldown(interaction.user, "snakeeyes")
			if (curCooldown) {
				return interaction.reply({
					content: `You can play again <t:${Math.floor(await checkCooldown(interaction.user, "snakeeyes") / 1000)}:R>.`,
					ephemeral: true
				});
			}
			setCooldown(interaction.user, "snakeeyes", config.games.snakeeyes.cooldown * 60 * 1000)

			bet = parseInt(interaction.options.get("amount").value);
			if (bet < 1 || bet > 10) return interaction.reply({
				content: "You can only bet between 1 and 10 coins.",
				ephemeral: true
			});

			// Check if they have enough coins
			points = await checkPoints(interaction.user);
			if (points < bet) return interaction.reply({
				content: "You do not have enough coins to play snakeeyes.",
				ephemeral: true
			});

			// Roll the dice
			dice = Math.floor(Math.random() * 6) + 1;
			before = points;
			// If they win, give them the prize, if they lose, take the prize
			// if they lose inverse the bet
			bet = new Number(bet);
			if (dice == 1) {
				await checkAndModifyPoints(interaction.user, bet * 3);
				interaction.reply({
					embeds: [{
						title: "Snakeeyes",
						description: `You rolled a ${config.games.snakeeyes.sides[dice - 1]} and **won** ${bet * 3} coins!\nYou now have ${before + (bet * 3)} coins.`,
						color: 0x00ff00
					}]
				});
			} else {
				bet = -bet;
				await checkAndModifyPoints(interaction.user, bet);
				interaction.reply({
					embeds: [{
						title: "Snakeeyes",
						description: `You rolled a ${config.games.snakeeyes.sides[dice - 1]} and **lost** ${Math.abs(bet)} coins!\nYou now have ${before + bet} coins.`,
						color: 0xff0000
					}]
				});
			}
			break;
		case "daily": // Daily 2 coins
			curCooldown = await checkCooldown(interaction.user, "daily")
			if (curCooldown) {
				return interaction.reply({
					content: `Check back <t:${Math.floor(await checkCooldown(interaction.user, "daily") / 1000)}:R>.`,
					ephemeral: true
				});
			}
			// 24 hours
			setCooldown(interaction.user, "daily", 24 * 60 * 60 * 1000)
			await checkAndModifyPoints(interaction.user, 2);
			interaction.reply({
				embeds: [{
					title: "Daily",
					description: `You got 2 coins!`,
					color: 0x00ff00
				}]
			});
			break;
		case "weekly": // Weekly 14 coins
			curCooldown = await checkCooldown(interaction.user, "weekly")
			if (curCooldown) {
				return interaction.reply({
					content: `Check back <t:${Math.floor(await checkCooldown(interaction.user, "weekly") / 1000)}:R>.`,
					ephemeral: true
				});
			}
			// 7 days
			setCooldown(interaction.user, "weekly", 7 * 24 * 60 * 60 * 1000)
			await checkAndModifyPoints(interaction.user, 14);
			interaction.reply({
				embeds: [{
					title: "Weekly",
					description: `You got 14 coins!`,
					color: 0x00ff00
				}]
			});
			break;
		case "wordscramble": // Word Scramble game (admin only)
			// check if the user is in the config.discord.givers array
			if (!config.discord.givers.includes(interaction.user.id)) return interaction.reply({
				content: "You do not have permission to use this command.",
				ephemeral: true
			});

			// Check if the channel already has a word scramble going
			if (wordScrambles[interaction.channel.id]) {
				return interaction.reply({
					content: "There is already a word scramble going in this channel.",
					ephemeral: true
				});
			}

			// Start a word scramble and check if we specified a word
			if (interaction.options.get("override")) {
				override = interaction.options.get("override").value;
			}
			else {
				override = false;
			}
			if (interaction.options.get("amount")) {
				amount = interaction.options.getNumber("amount");
			}
			else {
				amount = 2;
			}
			gameData = wordScramble(override);
			wordScrambles[interaction.channel.id] = {
				word: gameData.word,
				amount: amount,
				scrambledWord: gameData.scrambledWord,
				badGuesses: []
			}
			interaction.channel.send({
				embeds: [{
					title: "Word Scramble",
					description: `Unscramble the word **${gameData.scrambledWord}**!`,
					color: 0xffff00
				}]
			});
			interaction.reply({
				content: "Word scramble started.",
				ephemeral: true
			})
			// Set a timer for 30 seconds, if the word isn't guessed by then, delete the wordScrambles object
			wordScrambles[interaction.channel.id].timer = setTimeout(() => {
				interaction.channel.send({
					embeds: [{
						title: "Word Scramble",
						description: `The word was **${wordScrambles[interaction.channel.id].word}**!`,
						color: 0xff0000
					}]
				});
				delete wordScrambles[interaction.channel.id];
			}, 30 * 1000);
			break;
	};
});

var wordScrambles = {}

client.on('messageCreate', async message => {
	if (message.author.bot) return;
	if (!message.guild) return;
	if (message.channel.type == "dm") return;
	if (config.games.wordscramble.blacklist.includes(message.channel.id)) return;
	// Check if the channel already has a word scramble going
	if (wordScrambles[message.channel.id]) {
		if (wordScrambles[message.channel.id].badGuesses.includes(message.author.id)) return;
		// Check if the message is the correct answer
		if (message.content.toLowerCase() == wordScrambles[message.channel.id].word.toLowerCase()) {
			// Give the user a point
			await checkAndModifyPoints(message.author, ${wordScrambles[message.channel.id].amount});
			// Send the message
			message.channel.send({
				embeds: [{
					title: "Word Scramble",
					description: `**${message.author}** got the word **${wordScrambles[message.channel.id].word}**!\nYou got ${wordScrambles[message.channel.id].amount} coins!`,
					color: 0x00ff00
				}]
			});
			clearTimeout(wordScrambles[message.channel.id].timer)
			// Delete the wordScrambles object
			delete wordScrambles[message.channel.id];
		} else {
			wordScrambles[message.channel.id].badGuesses.push(message.author.id);
		}
	} else {
		curCooldown = await checkCooldown({id: 0}, "wordscramble")
		if (curCooldown) {
			return;
		}
		// 1 in 50 chance to start a word scramble
		if (Math.floor(Math.random() * 25) == 0) {
			// Start a word scramble
			setCooldown({id: 0}, "wordscramble", 5 * 60 * 1000)
			gameData = wordScramble();
			wordScrambles[message.channel.id] = {
				word: gameData.word,
				scrambledWord: gameData.scrambledWord,
				badGuesses: []
			}
			message.channel.send({
				embeds: [{
					title: "Word Scramble",
					description: `Unscramble the word **${gameData.scrambledWord}**!`,
					color: 0xffff00
				}]
			});
			// Set a timer for 30 seconds, if the word isn't guessed by then, delete the wordScrambles object
			return wordScrambles[message.channel.id].timer = setTimeout(() => {
				message.channel.send({
					embeds: [{
						title: "Word Scramble",
						description: `The word was **${wordScrambles[message.channel.id].word}**!`,
						color: 0xff0000
					}]
				});
				delete wordScrambles[message.channel.id];
			}, 30 * 1000);
		}
	}
	setCooldown({id: 0}, "wordscramble", 1 * 60 * 1000)
});

function wordScramble() {
	// Get a random word from config.games.wordscramble.words then scramble it
	if (!override) {
		word = config.games.wordscramble.words[Math.floor(Math.random() * config.games.wordscramble.words.length)];
	}
	else {
		word = override;
	}
	scrambledWord = word.split('').sort(function () {
		// Fully scramble the word 3 times to be safe
		return 0.5 - Math.random();
	}).sort(function () {
		return 0.5 - Math.random();
	}).join('');
	// if the scrambled word is the same as the word, scramble it again
	if (scrambledWord == word) {
		scrambledWord = word.split('').sort(function () {
			return 0.5 - Math.random();
		}).sort(function () {
			return 0.5 - Math.random();
		}).join('');
	}
	return {
		word: word,
		scrambledWord: scrambledWord
	};
}

// Game function
function playGame(gameName) {
	const randomNumber = Math.random() * 100;
	result = {
		string: "",
		difference: 0
	};

	switch (gameName) {
		case 'FISHING':
			if (randomNumber < 40) {
				result.string = "You caught water! Now how did you do that? No wonder your Dad left you.";
			} else if (randomNumber < 70) {
				result.string = "You caught a fish! That's pretty cool I guess. (+1 coin)";
				result.difference = 1;
			} else if (randomNumber < 90) {
				result.string = "You caught a fish but BIGGER! Neat! (+2 coins)";
				result.difference = 2;
			} else if (randomNumber < 95) {
				result.string = "You caught a WORM with your worm! Cactus likes worms! (+3 coins)";
				result.difference = 3;
			} else {
				result.string = "You caught a piranha. It didn't appreciate that and mugged you at gunpoint. (-3 coins)";
				result.difference = -3;
			}
			break;

		case 'DIGGING':
			if (randomNumber < 40) {
				result.string = "You dug up dirt! Real accomplishment there. Dummy.";
			} else if (randomNumber < 70) {
				result.string = "You dug up a shiny pebble! That's pretty rad. (+1 coin)";
				result.difference = 1;
			} else if (randomNumber < 90) {
				result.string = "You dug up a stick. Sticks are sticky! Nice! (+2 coins)";
				result.difference = 2;
			} else if (randomNumber < 95) {
				result.string = "You dug up a sick ass earthworm! Cactus likes worms, let me tell you. (+3 coins)";
				result.difference = 3;
			} else {
				result.string = "You dug up a pipe bomb. How could you be so dumb? Nice job idiot. (-3 coins)";
				result.difference = -3;
			}
			break;

		case 'HUNTING':
			if (randomNumber < 40) {
				result.string = "You came back empty handed like a loser. Nice job.";
			} else if (randomNumber < 70) {
				result.string = "You killed a rabbit. That's pretty cool I guess, you can make a jump boost from it. (+1 coin)";
				result.difference = 1;
			} else if (randomNumber < 90) {
				result.string = "You killed a deer! Nice shooting! Maybe you aren't a failure like your father said! (+2 coins)";
				result.difference = 2;
			} else if (randomNumber < 95) {
				result.string = "You killed a Bigfoot. Wait.... What? You killed a bigfo- The government pays to keep you quiet. (+3 coins.)";
				result.difference = 3;
			} else {
				result.string = "You were trying to shoot a deer, missed, and hit Carl. They fined you for the hospital bills. (-3 coins)";
				result.difference = -3;
			}
			break;

		default:
			result.string = "Unknown game";
			break;
	}

	return result;
}

// Slots
function playSlotMachine() {
	const icons = ['🍒', '🍎', '🍋', '🍓', '⭐', '🌵', '💣'];

	const getRandomIcon = () => icons[Math.floor(Math.random() * icons.length)];

	const spinResult = [getRandomIcon(), getRandomIcon(), getRandomIcon()];

	const iconCounts = spinResult.reduce((counts, icon) => {
		counts[icon] = (counts[icon] || 0) + 1;
		return counts;
	}, {});

	coinDifference = 0; // Default coin difference for no match, they just lose the play cost
	triple = false;
	jackpot = false;
	bombs = false;
	if (iconCounts['🍎'] === 2) {
		coinDifference = 1;
	} else if (iconCounts['🍎'] === 3) {
		triple = true;
		coinDifference = 2;
	} else if (iconCounts['🍋'] === 2) {
		coinDifference = 3;
	} else if (iconCounts['🍋'] === 3) {
		triple = true;
		coinDifference = 5;
	} else if (iconCounts['🍒'] === 2) {
		coinDifference = 5;
	} else if (iconCounts['🍒'] === 3) {
		triple = true;
		coinDifference = 7;
	} else if (iconCounts['🍓'] === 2) {
		coinDifference = 7;
	} else if (iconCounts['🍓'] === 3) {
		triple = true;
		coinDifference = 9;
	} else if (iconCounts['⭐'] === 2) {
		coinDifference = 9;
	} else if (iconCounts['⭐'] === 3) {
		triple = true;
		coinDifference = 12;
	} else if (iconCounts['🌵'] === 2) {
		coinDifference = 9;
	} else if (iconCounts['🌵'] === 3) {
		jackpot = true;
		coinDifference = 12;
	} else if (iconCounts['💣'] === 2) {
		bombs = true;
		coinDifference = -5;
	} else if (iconCounts['💣'] === 3) {
		bombs = true;
		coinDifference = -8;
	}

	if (iconCounts['💣'] === 1) {
		bombs = true;
		jackpot = false;
		triple = false;
		coinDifference = -1;
	}

	var cooldownOverride = 6 * iconCounts['💣']; // Change the cooldown to 6 minutes per bomb

	const result = {
		jackpot,
		triple,
		bombs,
		spinResult,
		cooldownOverride,
		coinDifference
	};

	return result;
}

const rockPaperScissors = (userChoice) => {
	const choices = ['🪨', '📄', '✂️'];
	const botChoice = choices[Math.floor(Math.random() * choices.length)];

	if (userChoice === botChoice) return 'It\'s a tie!';
	else if (
		(userChoice === '🪨' && botChoice === '✂️') ||
		(userChoice === '📄' && botChoice === '🪨') ||
		(userChoice === '✂️' && botChoice === '📄')
	) {
		return 'You won!';
	}
	else return 'You lost!';
};

//return console.log(playSlotMachine())

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
