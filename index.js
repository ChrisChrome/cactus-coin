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
	const items = require("./items.json")

	// Create tables if they don't exist
	db.exec("CREATE TABLE IF NOT EXISTS points (id TEXT, points INTEGER)");
	db.exec("CREATE TABLE IF NOT EXISTS cooldowns (id TEXT, type TEXT, cooldown INTEGER)");

	// We can just use the normal cooldown table for item use, but specific effects would be better off making a new table
	db.exec("CREATE TABLE IF NOT EXISTS items (id TEXT)");

	// This is bad, dumb code that can and will throw an error if it tries adding an existing column, too bad!
	// Figure out a better, less hacky way of adding columns later if it's a problem, but assuming nobody uses an ancient SQLite, we'll be fine
	for(var i=0, l=items.list.all.length; i<l; i++){
		db.exec(`ALTER TABLE items ADD COLUMN ${items.list.all[i]} INTEGER DEFAULT 0`, (err) => {
			if(!err){
			//ignoring this harmless error is simpler than making logic to check for it, since ALTER TABLES doesn't support IF EXISTS in most SQL implementations, SQLite included
			//besides, SQLite doesn't do anything if it throws that error
			} else if(err && !err.message.includes("duplicate column name:")) 
				console.error(`Received SQLite Error: "${err.message}"`);
		});
	}


	client.on("ready", async () => {
		console.log(`${colors.cyan("[INFO]")} Logged in as ${colors.green(client.user.tag)}`);
		loginTime = performance.now();
		// Load Commands
		console.log(`${colors.cyan("[INFO]")} Loading Commands...`);
		const commands = require('./commands.json');
		await (async () => {
			try {
				console.log(`${colors.cyan("[INFO]")} Registering Commands...`);
				regStart = performance.now();
				// Global commands
				//await rest.put(Discord.Routes.applicationCommands(client.user.id), {body: []}); //clear all of our commands to purge any old ones, uncomment when commands.json has renamed/removed a command
				await rest.put(Discord.Routes.applicationCommands(client.user.id), {
					body: commands
				});
				regEnd = performance.now();
				
			} catch (error) {
				console.error(error);
			}
		})();

		// Log startup time in seconds
		initEndTime = performance.now();
		console.log(`${colors.cyan("[INFO]")} Successfully registered commands. Took ${colors.green(Math.round(regEnd - regStart) / 1000)} seconds.`);
		console.log(`${colors.cyan("[INFO]")} Startup took ${colors.green(Math.round(initEndTime - initTime) / 1000)} seconds.`)
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
				await db.exec(`INSERT INTO points (id, points) VALUES ('${user.id}', ${amount})`);
				return amount;
			}
			if (row) {
				if (override) {
					await db.exec(`UPDATE points SET points = ${amount} WHERE id = '${user.id}'`);
					return amount;
				}
				await db.exec(`UPDATE points SET points = ${row.points + amount} WHERE id = '${user.id}'`);
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
					await db.exec(`INSERT INTO points (id, points) VALUES ('${user.id}', 0)`);
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
					await db.exec(`INSERT INTO cooldowns (id, type, cooldown) VALUES ('${user.id}', '${type}', '${Date.now() + cooldown}')`, (err) => {
						if (err) {
							console.error(err);
							reject(err);
						}
						resolve(true);
					});
				}
				if (row) {
					await db.exec(`UPDATE cooldowns SET cooldown = '${Date.now() + cooldown}' WHERE id = '${user.id}' AND type = '${type}'`, (err) => {
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


	// TODO: figure out if this actually works, then make the other functions
	checkAndModifyItem = (user, type, amount, override) => {
		// Check if the user exists, if not, add them to the database
		return new Promise((resolve,reject) => {
			db.get(`SELECT * FROM items WHERE id = '${user.id}'`, async (err, row) => {
				if (err) {
					console.error(`Smthn went wrong: ${err.message}`);
					reject(false);
				}
				if (!row) {
					db.exec(`INSERT INTO items (id, ${type}) VALUES ('${user.id}', ${amount})`);
					resolve(amount);
				}
				if (row) {
					if (override) {
						db.exec(`UPDATE items SET ${type} = ${amount} WHERE id = '${user.id}'`);
						resolve(amount);
					}
					db.exec(`UPDATE items SET ${type} = ${Math.max(row[type] + amount, 0)} WHERE id = '${user.id}'`); //if they have literally anything, it won't zero them
					resolve(row[type] + amount);
				}
				reject(false);
			});
		});
	}

	checkAndModifyAllItems = (user, amount, override) => {
		// Check if the user exists, if not, add them to the database
		// Needs to be awaited
		return new Promise((resolve, reject) => {
			var amounts = [];
			/*var rowCol = [`id`];
			var rowVal = [`${user.id}`];
			var OvrVal = [`${user.id}`]
			var rowCombine = [];
			var OVRCombine
			for (var i=0; i < items.list.all.length; i++) {
				rowVal.push(`${items.list.all[i]}`)
			}*/

			db.get(`SELECT * FROM items WHERE id = '${user.id}'`, async (err, row) => {
				if (err) {
					console.error(`Smthn went wrong: ${err.message}`);
					reject(false);
					}
				if(!row){
					db.exec(`INSERT INTO items (id) VALUES ('${user.id}')`, async (err2, row2) => {
						for(var i = 0; i < items.list.all.length; i++){
							if (err2) {
							console.error(`Smthn went wrong: ${err.message}`);
							reject(false);
							}
							if (row2) {
								if (override) {
									db.exec(`UPDATE items SET ${items.list.all[i]} = ${amount} WHERE id = '${user.id}'`);
									amounts.push(amount);
								}
								db.exec(`UPDATE items SET ${items.list.all[i]} = ${row2[items.list.all[i]] ? row2[items.list.all[i]] + amount : amount} WHERE id = '${user.id}'`);
								amounts.push(row2[items.list.all[i]] +amount);
							}
						}
					});
				}
				if (row) {
					for(var i = 0; i < items.list.all.length; i++){
						if(override){
							db.exec(`UPDATE items SET ${items.list.all[i]} = ${amount} WHERE id = '${user.id}'`);
							amounts.push(amount);
						} else {
						db.exec(`UPDATE items SET ${items.list.all[i]} = ${row[items.list.all[i]] + amount} WHERE id = '${user.id}'`);
						amounts.push(row[items.list.all[i]] + amount);
						}
					}
				}
				});
			resolve(amounts);
		}); 
	}
	

	checkItem = (user, type) => {
		// Needs to be awaited
		return new Promise((resolve, reject) => {
			db.get(`SELECT * FROM items WHERE id = '${user.id}'`, async (err, row) => {
				if (err) {
					console.error(`Something went wrong: ${err}`);
					reject(err);
				}
				if (!row) {
					await db.exec(`INSERT INTO items (id) VALUES ('${user.id}')`);
					resolve(0);
				}
				if (row) {
					resolve(row[type]);
				}
			});
		});
	}

	checkAllItems = (user) => {
		// Needs to be awaited
		return new Promise((resolve, reject) => {
			values = [];
			rowExists = true;
			db.get(`SELECT * FROM items WHERE id = '${user.id}'`, async (err, row) => {
				 	console.log(row[items.list.all[0]]);
					var values = [];
					for (var i=0, l=items.list.all.length; i<l; i++) {
						if (err) {
							console.error(`Something went wrong: ${err}`);
							reject(err);
						}
						if (!row) {
							if(!rowExists) continue;//if we've already evaluated this chunk, we know he rest aren't gonna exist

							db.exec(`INSERT INTO items (id) VALUES ('${user.id}')`);
							rowExists = false;
							values.push(0);
						}
						if (row) {
							values.push(row[items.list.all[i]]);
						}
					}
					resolve(values);
				});
		});
	}

	var slotResults = {};

	client.on("interactionCreate", async interaction => {
		if (!interaction.isCommand()) return;
		startTime = (performance.now() * 10);
		switch (interaction.commandName) {
			case "coins":
				// Get user data

				user = interaction.options.getUser("user") || interaction.user;
				await interaction.deferReply({
					ephemeral: false
				})
				startTime = (performance.now() * 10);
				balance = await checkPoints(interaction.options.getUser("user") || interaction.user);
				
				interaction.followUp({
					embeds: [{
						...(config.discord.debugUser.includes(interaction.user.id) && {footer: {text: `Took ${Math.round((performance.now() * 10)-startTime)/10} ms`}}),
						title: `${user.username}'s Coins`,
						description: `${config.discord.coin}${balance}`,
					}]
				});
				break;

			case "inventory":
				// Get user data
				inv = [];
				await interaction.deferReply({
					ephemeral: false
				})
				startTime = (performance.now() * 10);
				var amounts = await checkAllItems(interaction.options.getUser("user") || interaction.user);
				for (var i=0, l=items.list.all.length; i<l; i++) {
					user = interaction.options.getUser("user") || interaction.user;
					_item = items.list.all[i].charAt(0).toUpperCase() + items.list.all[i].slice(1)
					if (amounts[i] >  0 ||  amounts[i] == -Infinity || isNaN(amounts[i])) { //why let -inf and nan through? funny mostly, and so it's obvious if one somehow got into the table
						console.log(`${amounts[i]/2}` )
						inv.push(`${config.items[items.list.all[i]]} ${_item}: ${amounts[i]}` /*${Math.abs(amounts[i]) == Infinity || isNaN(amounts[i])  ? ` (!!!)` : ``}`*/)
					}
				}
				interaction.followUp({
					embeds: [{
						...(config.discord.debugUser.includes(interaction.user.id) && {footer: {text: `Took ${Math.round((performance.now() * 10)-startTime)/10} ms`}}),
						title: `${user.username}'s Inventory`,
						description: inv.join("\n"),
						color: 0x00ff00
					}]
					//(embeds.footer =  ?   : undefined)
				});
				break;
			
			case "leaderboard":
				// Get the type option, if its "inverted" then order by points ASC, if its not set then order by points DESC
				await interaction.deferReply({
					ephemeral: false
				})
				startTime = (performance.now() * 10);
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
				db.all(`SELECT * FROM points ORDER BY points ${type}`, async (err, rows) => {
					if (err) {
						console.error(err);
					}
					if (!rows) return interaction.followUp({
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
						interaction.followUp({
							embeds: [{
								...(config.discord.debugUser.includes(interaction.user.id) && {footer: {text: `Took ${Math.round((performance.now() * 10)-startTime)/10} ms`}}),
								title: header,
								description: leaderboard.join("\n"),
								color: 0x00ff00
							}]
						});
					}
				});
				break;

			case "modify":
				await interaction.deferReply({ephemeral: true});
				startTime = (performance.now() * 10);
				// check if the user is in the config.discord.givers array
				if (!config.discord.givers.includes(interaction.user.id)) return interaction.followUp({
					content: "You do not have permission to use this command.",
					ephemeral: true
				});
				outputStatus = await checkAndModifyPoints(interaction.options.getUser("user"), interaction.options.getNumber("amount"), interaction.options.getBoolean("override") || false);
				if (outputStatus !== false) {
					interaction.followUp({
						embeds: [{
							...(config.discord.debugUser.includes(interaction.user.id) && {footer: {text: `Took ${Math.round((performance.now() * 10)-startTime)/10} ms`}}),
							title: "Success",
							description: `Gave ${interaction.options.getUser("user").username} ${interaction.options.getNumber("amount")} coins.`,
						}]
					});
					// add + or - to the amount
					amount = interaction.options.getNumber("amount");
					if (amount > 0) {
						amount = `+${amount}`;
					}
					// Send the log to the log channel
					// Tell the user their coins were modified
					interaction.options.getUser("user").send({
						embeds: [{
							title: "Coins Modified",
							description: `${config.discord.coin}${amount}`,
							color: 0xFFff00
						}]
					}).catch(err => { });


				} else {
					interaction.followUp({
						content: `An error occurred.\n`,
						ephemeral: true
					});
				}
				break;
			case "modifyrandom": // Allows a user to modify a random user's coins
				// check if the user is in the config.discord.givers array
				if (!config.discord.givers.includes(interaction.user.id)) return interaction.reply({
					content: "You do not have permission to use this command.",
				});
				await interaction.deferReply({ephemeral: true});
				startTime = (performance.now() * 10);
				switch (interaction.options.getString("type")) {
					case "database":
						// Get a random user from the database
						db.all(`SELECT * FROM points`, async (err, rows) => {
							if (err) {
								console.error(err);
							}
							if (!rows) return interaction.followUp({
								content: "It's quiet here...",
								ephemeral: true
							});
							if (rows) {
								randomUser = await rows[Math.floor(Math.random() * rows.length)];
								randomUser = await client.users.fetch(randomUser.id);
								outputStatus = await checkAndModifyPoints(await client.users.fetch(randomUser.id), interaction.options.getNumber("amount"));
								if (outputStatus !== false) {
									interaction.followUp({
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
									interaction.followUp({
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
							interaction.followUp({
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
							interaction.followUp({
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
				await interaction.deferReply({ephemeral: true});
				startTime = (performance.now() * 10);
				// Run a lil db query to update every user's coins, dont bother sending a message to the user, it would take too long
				db.all(`SELECT * FROM points`, async (err, rows) => {
					if (err) {
						console.error(err);
					}
					if (!rows) return interaction.followUp({
						content: "It's quiet here...",
						ephemeral: true
					});
					if (rows) {
						for (let i = 0; i < rows.length; i++) {
							checkAndModifyPoints(await client.users.fetch(rows[i].id), interaction.options.getNumber("amount"));
						}
						interaction.followUp({
							content: `Gave everyone ${interaction.options.getNumber("amount")} coins.`,
							ephemeral: true
						});
					}
				});
				break;

			case "moditems":
				// check if the user is in the config.discord.givers array
				if (!config.discord.givers.includes(interaction.user.id)) return interaction.reply({
					content: "You do not have permission to use this command.",
					ephemeral: true
				});
				await interaction.deferReply({ephemeral: true});
				startTime = (performance.now() * 10);
				outputStatus = await checkAndModifyItem(interaction.options.getUser("user"), interaction.options.get("type").value, interaction.options.getNumber("amount"), interaction.options.getBoolean("override") || false);
				if (outputStatus !== false) {
					interaction.followUp({
						content: `Gave ${interaction.options.getUser("user").username} ${interaction.options.getNumber("amount")} ${interaction.options.get("type").value}s.`, // Who cares about grammar? This is an admin-only command!
						ephemeral: true
					});
					// add + or - to the amount
					amount = interaction.options.getNumber("amount");
					if (amount > 0) {
						amount = `+${amount}`;
					}
					// Send the log to the log channel
					// Tell the user their items were modified
					type = interaction.options.get("type").value;
					interaction.options.getUser("user").send({
						embeds: [{
							title: "Item Modified",
							description: `${config.games.placeholder}${type}: ${amount}`,
							color: 0xFFff00
						}]
					}).catch(err => { });
				
				
				} else {
					interaction.followUp({
						content: `An error occurred.\n`,
						ephemeral: true
					});
				}
				break;
					
			case "modallitems":
				// check if the user is in the config.discord.givers array
				if (!config.discord.givers.includes(interaction.user.id)) return interaction.reply({
					content: "You do not have permission to use this command.",
					ephemeral: true
				});
				await interaction.deferReply({ephemeral: true});
				startTime = (performance.now() * 10);
				outputStatus = await checkAndModifyAllItems(interaction.options.getUser("user"), interaction.options.getNumber("amount"), interaction.options.getBoolean("override") || false);
				
				//console.debug(`checkAndModifyAllItems took ${(performance.now() * 10)-startTime} ms`)
				if (outputStatus !== false) {
					interaction.followUp({
						content: `Gave ${interaction.options.getUser("user").username} ${interaction.options.getNumber("amount")} of all items.`,
						ephemeral: true
					});
					// add + or - to the amount
					amount = interaction.options.getNumber("amount");
					if (amount > 0) {
						amount = `+${amount}`;
					}
					// Send the log to the log channel
					// Tell the user their items were modified
					interaction.options.getUser("user").send({
						embeds: [{
							title: "Items Modified",
							description: `All items${config.games.placeholder}: ${amount}`,
							color: 0xFFff00
						}]
					}).catch(err => { });
		
		
				} else {
					interaction.followUp({
						content: `An error has occurred.\n`,
						ephemeral: true
					});
				}
				break;
			case "transfer": // Allows a user to transfer a positive amount of coins to another user at a 50% tax, rounded down, if the user sends 2 coins, the other user will receive 1, the other gets sent to the abyss.
				// check if the arguments are there
				await interaction.deferReply(); //only defer once we start poking the DB, given it will almost always evaluate the checks in < 1000ms
				startTime = (performance.now() * 10);
				target = interaction.options.getUser("user");
				amount = interaction.options.getNumber("amount");

				if (!target) return interaction.followUp({
					content: "You must specify a user.",
					ephemeral: true
				});
				if (!interaction.options.getNumber("amount")) return interaction.followUp({
					content: "You must specify an amount.",
					ephemeral: true
				});
				// Sanity check to make sure they aren't trying to send negative coins and break the economy
				if (interaction.options.getNumber("amount") < 0) return interaction.followUp({
					content: "What are you, a debt collector? You can't give them negative money.",
					ephemeral: true
				});
				// Check if they're trying to be funny and send money to themselves.
				if (interaction.user.id == target.id) return interaction.followUp({
					content: "You can't send coins to yourself silly.",
					ephemeral: true
				});

				
				// Round the input up (these fuckers found a dupe one fucking day into the bot, fuck you krill issue)

				balance = await checkPoints(interaction.user);
				if (balance < amount) return interaction.followUp({
					content: "You do not have enough coins.",
					ephemeral: true
				});
				// If the user doesnt have any coins tell them.
				if (balance == 0) return interaction.followUp({
					content: "You do not have any coins.",
					ephemeral: true
				});
				if(balance < 0) return interaction.followUp({
					content:"You're in debt, stinky."

				});

				// check if the user has enough coins for tax -- apparently we forgone checkPoints entirely, then just ended up not even using that query lmao
				if (balance < amount * 1.25) return interaction.reply({
					content: `You do not have enough coins to pay the tax of ${config.discord.coin}${amount * 0.25}. You only have ${config.discord.coin}${balance}.`,
					ephemeral: true
				});
				// At this point we know they have enough coins, so we can take them away, make sure to take the tax away too
				checkAndModifyPoints(interaction.user, -amount * 1.25);
				// Now we can give the other user the coins
				checkAndModifyPoints(target, amount);
				// Now we can tell the user that it worked
				// get the amount sent with 2 decimal places if it has a decimal
				if (amount % 1 != 0) {
					amount = amount.toFixed(2);
				}
				interaction.reply({
					embeds: [{
						title: "Transfer Successful",
						color: 0x00ff00,
						description: `You sent ${config.discord.coin}${amount} to ${target.username}.`
					}]
				});
				// Tell the user being transferred from about the change as a sort of receipt
				target.send({
					embeds: [{
						title: "Transfer Receipt",
						color: 0xffff00,
						description: `You received ${config.discord.coin}${amount} from ${interaction.user}.`
					}]
				});
				interaction.user.send({
					embeds: [{
						title: "Transfer Receipt",
						color: 0xffff00,
						description: `You sent ${config.discord.coin}${amount} to ${target}.\nYou paid a tax of ${config.discord.coin}${amount * 0.25}.`
					}]
				});
				break;
			case "ledger": // Allows a user to see the balance of every user in the database
				await interaction.deferReply();
				startTime = (performance.now() * 10);
				db.all(`SELECT * FROM points`, async (err, rows) => {
					if (err) {
						console.error(err);
						return interaction.followUp({
							content: "An error occurred.",
							ephemeral: true
						});
					}
					if (!rows) return interaction.followUp({
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
						interaction.followUp({
							embeds: [{
								...(config.discord.debugUser.includes(interaction.user.id) && {footer: {text: `Took ${Math.round((performance.now() * 10)-startTime)/10} ms`}}),
								title: "Ledger",
								description: ledger.join("\n"),
								color: 0x00ff00
							}]
						});
					}
				});
				break;
			case "play": // Allows a user to play a game to earn coins (or lose them)
				await interaction.deferReply();
				startTime = (performance.now() * 10);
				curCooldown = await checkCooldown(interaction.user, interaction.options.getString("game"))
				if (curCooldown) {
					return interaction.followUp({
						content: `You can play again <t:${Math.floor(await checkCooldown(interaction.user, interaction.options.getString("game")) / 1000)}:R>.`,
						ephemeral: true
					});
				}
				setCooldown(interaction.user, interaction.options.getString("game"), config.games.waitPeriod * 60 * 1000);

				// Check if they're in debt, if they are dont let them play
				balance = await checkPoints(interaction.user);
				if (balance < 0) return interaction.followUp({
					content: "You are in debt, you cannot play games until you are out of debt.",
					ephemeral: true
				});

				result = await playGame(interaction.options.getString("game"));
				await checkAndModifyPoints(interaction.user, result.difference);
				interaction.followUp(result.string);
				break;
			case "slots": // Play some slots, 30 second cooldown
				await interaction.deferReply();
				startTime = (performance.now() * 10);
				curCooldown = await checkCooldown(interaction.user, "slots")
				if (curCooldown) {
					return interaction.followUp({
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
					setCooldown(interaction.user, "slots", slotResults[interaction.user.id].cooldownOverride * 30 * 1000)
				} else {
					setCooldown(interaction.user, "slots", config.games.slots.cooldown * 30 * 1000)
				}

				await interaction.followUp({
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
				checkAndModifyPoints(interaction.user, difference);
				endTime = (performance.now() * 10); //we are checking for when actual processing ended
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
											...(config.discord.debugUser.includes(interaction.user.id) && {footer: {text: `Took ${Math.round(endTime-startTime)/10} ms`}}), 
											title: "Jackpot!",
											description: `:rotating_light: [${slotResults[interaction.user.id].spinResult[0]}][${slotResults[interaction.user.id].spinResult[1]}][${slotResults[interaction.user.id].spinResult[2]}] :rotating_light:\nYou won the jackpot! (${difference} coins)`,
											color: 0xffffff
										}]
									});
								} else if (slotResults[interaction.user.id].triple) {
									return await interaction.editReply({
										embeds: [{
											...(config.discord.debugUser.includes(interaction.user.id) && {footer: {text: `Took ${Math.round(endTime-startTime)/10} ms`}}),
											title: "Triple!",
											description: `[${slotResults[interaction.user.id].spinResult[0]}][${slotResults[interaction.user.id].spinResult[1]}][${slotResults[interaction.user.id].spinResult[2]}]\nYou won ${difference} coins!`,
											color: 0x00ffff
										}]
									});
								} else {
									await interaction.editReply({
										embeds: [{
											...(config.discord.debugUser.includes(interaction.user.id) && {footer: {text: `Took ${Math.round(endTime-startTime)/10} ms`}}),
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
											...(config.discord.debugUser.includes(interaction.user.id) && {footer: {text: `Took ${Math.round(endTime-startTime)/10} ms`}}),
											title: "Bombs!",
											description: `[${slotResults[interaction.user.id].spinResult[0]}][${slotResults[interaction.user.id].spinResult[1]}][${slotResults[interaction.user.id].spinResult[2]}]\nYou lost ${Math.abs(difference)} coins!`,
											color: 0xff0000
										}]
									});
								} else {
									await interaction.editReply({
										embeds: [{
											...(config.discord.debugUser.includes(interaction.user.id) && {footer: {text: `Took ${Math.round(endTime-startTime)/10} ms`}}),
											title: "Slots",
											description: `[${slotResults[interaction.user.id].spinResult[0]}][${slotResults[interaction.user.id].spinResult[1]}][${slotResults[interaction.user.id].spinResult[2]}]\nYou lost ${Math.abs(difference)} coins!`,
											color: 0xff0000
										}]
									});
								}
							}
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
				await interaction.deferReply();
				startTime = (performance.now() * 10);
				curCooldown = await checkCooldown(interaction.user, "coinflip");	
				if (curCooldown) {
					return interaction.followUp({
						content: `You can play again <t:${Math.floor(await checkCooldown(interaction.user, "coinflip") / 1000)}:R>.`,
						ephemeral: true
					});
				}
				
				bet = parseInt(interaction.options.get("amount").value);
				if (bet < 1 || bet > 10) return interaction.followUp({
					content: "You can only bet between 1 and 10 coins.",
					ephemeral: true
				});

				// Check if they have enough coins
				points = await checkPoints(interaction.user);
				if (points < bet) return interaction.followUp({
					content: "You do not have enough coins to play coinflip.",
					ephemeral: true
				});

				// Flip the coin
				coin = Math.random() <= 0.5 ? "heads" : "tails";
				side = interaction.options.getString("side");
				outcome = coin == side ? true : false;
				// If they win, give them the prize, if they lose take the prize away
				if (!outcome) bet = -bet;
				checkAndModifyPoints(interaction.user, bet);
				setCooldown(interaction.user, "coinflip", config.games.coinflip.cooldown * 60 * 1000) 
				
				if (coin == "heads") return interaction.followUp({
					embeds: [{
						...(config.discord.debugUser.includes(interaction.user.id) && {footer: {text: `Took ${Math.round((performance.now() * 10)-startTime)/10} ms`}}),
						title: "Coinflip",
						description: `You flipped ${config.games.coinflip.heads} and **${outcome ? "won" : "lost"}** ${Math.abs(bet)} coins!`, // sanity check
						color: outcome ? 0x00ff00 : 0xff0000
					}]
				});
				else if (coin == "tails") return interaction.followUp({
					embeds: [{
						...(config.discord.debugUser.includes(interaction.user.id) && {footer: {text: `Took ${Math.round((performance.now() * 10)-startTime)/10} ms`}}),
						title: "Coinflip",
						description: `You flipped ${config.games.coinflip.tails} and **${outcome ? "won" : "lost"}** ${Math.abs(bet)} coins!`,
						color: outcome ? 0x00ff00 : 0xff0000
					}]
				});
				else return interaction.followUp({
					embeds: [{
						...(config.discord.debugUser.includes(interaction.user.id) && {footer: {text: `Took ${Math.round((performance.now() * 10)-startTime)/10} ms`}}),
						title: "Something Went Wrong",
						description: `The coin is neither heads nor tails, this shouldn't be possible!`,
						color: 0xff0000
					}]
				});
				break;
			case "chuckaluck": // Chuck-a-Luck gambling game
				/*
				Minimum Bet: 1
				Maximum Bet: 10
				pick a number between 1-6 and roll three 6-sided dice.
				if one matches your bet is doubled (1/6), two and your bet gets tripled (1/36), all three and your bet's decupled (1/216).
				*/

				await interaction.deferReply();
				startTime = (performance.now() * 10);
				// Check cooldown
				curCooldown = await checkCooldown(interaction.user, "chuckaluck")
				if (curCooldown) {
					return interaction.followUp({
						content: `You can play again <t:${Math.floor(await checkCooldown(interaction.user, "chuckaluck") / 1000)}:R>.`,
						ephemeral: true
					});
				}
				

				bet = interaction.options.get("amount").value;
				target = interaction.options.get("target").value;

				if (bet < 1 || bet > 10) return interaction.followUp({
					content: "You can only bet between 1 and 10 coins.",
					ephemeral: true
				});

				// Check if they have enough coins
				points = await checkPoints(interaction.user);
				if (points < bet) return interaction.followUp({
					content: "You do not have enough coins to play Chuck-a-luck.",
					ephemeral: true
				});
				setCooldown(interaction.user, "chuckaluck", config.games.chuckaluck.cooldown * 60 * 1000)
				// Roll the dice
				dice = [Math.floor(Math.random() * 6) + 1, Math.floor(Math.random() * 6) + 1, Math.floor(Math.random() * 6) + 1];
				before = points;
				matches = 0;
				for(i = 0; i < 3; i++) matches += dice[i] == target ? 1 : 0;
				// If they win, give them the prize, if they lose, take the prize
				if (matches == 3) {
					checkAndModifyPoints(interaction.user, bet * 10);
					interaction.followUp({
						embeds: [{
							title: "Chuck-a-luck",
							description: `You rolled ${config.games.chuckaluck.sides[dice[0] - 1]} ${config.games.chuckaluck.sides[dice[1] - 1]} ${config.games.chuckaluck.sides[dice[2] - 1]} and **won** ${bet * 10} coins!!!\nYou now have ${before + (bet * 10)} coins.`,
							color: 0x00ff00
						}]
					});
				} else if (matches == 2) {
					checkAndModifyPoints(interaction.user, bet * 3);
					interaction.followUp({
						embeds: [{
							title: "Chuck-a-luck",
							description: `You rolled ${config.games.chuckaluck.sides[dice[0] - 1]} ${config.games.chuckaluck.sides[dice[1] - 1]} ${config.games.chuckaluck.sides[dice[2] - 1]} and **won** ${bet * 3} coins!!!\nYou now have ${before + (bet * 3)} coins.`,
							color: 0x00ff00
						}]
					});
				} else if (matches == 1) {
					checkAndModifyPoints(interaction.user, bet * 2);
					interaction.followUp({
						embeds: [{
							title: "Chuck-a-luck",
							description: `You rolled ${config.games.chuckaluck.sides[dice[0] - 1]} ${config.games.chuckaluck.sides[dice[1] - 1]} ${config.games.chuckaluck.sides[dice[2] - 1]} and **won** ${bet * 2} coins!\nYou now have ${before + (bet * 2)} coins.`,
							color: 0x00ff00
						}]
					});
				} else {
					await checkAndModifyPoints(interaction.user, -bet);
					interaction.followUp({
						embeds: [{
							title: "Chuck-a-luck",
							description: `You rolled ${config.games.chuckaluck.sides[dice[0] - 1]} ${config.games.chuckaluck.sides[dice[1] - 1]} ${config.games.chuckaluck.sides[dice[2] - 1]} and **lost** ${Math.abs(bet)} coins!\nYou now have ${before - bet} coins.`,
							color: 0xff0000
						}]
					});
				}
				break;
			case "daily": // Daily 2 coins
				await interaction.deferReply();
				startTime = performance.now() * 10;
				curCooldown = await checkCooldown(interaction.user, "daily")
				if (curCooldown) {
					return interaction.followUp({
						content: `Check back <t:${Math.floor(await checkCooldown(interaction.user, "daily") / 1000)}:R>.`,
						ephemeral: true
					});
				}
				// 24 hours
				setCooldown(interaction.user, "daily", 24 * 60 * 60 * 1000)
				await checkAndModifyPoints(interaction.user, 1);
				interaction.followUp({
					embeds: [{
						...(config.discord.debugUser.includes(interaction.user.id) && {footer: {text: `Took ${Math.round((performance.now() * 10)-startTime)/10} ms`}}),
						title: "Daily",
						description: `You got 1 coin!`,
						color: 0x00ff00
					}]
				});
				break;
			case "weekly": // Weekly 14 coins
				await interaction.deferReply();
				startTime = performance.now() * 10;
				curCooldown = await checkCooldown(interaction.user, "weekly")
				if (curCooldown) {
					return interaction.followUp({
						content: `Check back <t:${Math.floor(await checkCooldown(interaction.user, "weekly") / 1000)}:R>.`,
						ephemeral: true
					});
				}
				// 7 days
				setCooldown(interaction.user, "weekly", 7 * 24 * 60 * 60 * 1000)
				await checkAndModifyPoints(interaction.user, 4);
				interaction.followUp({
					embeds: [{
						...(config.discord.debugUser.includes(interaction.user.id) && {footer: {text: `Took ${Math.round((performance.now() * 10)-startTime)/10} ms`}}),
						title: "Weekly",
						description: `You got 4 coins!`,
						color: 0x00ff00
					}]
				});
				break;
			case "wordscramble": // Word Scramble game (admin only)
				await interaction.deferReply({ephemeral: true});
				startTime = (performance.now() * 10);

				// check if the user is in the config.discord.givers array
				if (!config.discord.givers.includes(interaction.user.id)) return interaction.followUp({
					content: "You do not have permission to use this command.",
					ephemeral: true
				});

				// Check if the channel already has a word scramble going
				if (wordScrambles[interaction.channel.id]) {
					return interaction.followUp({
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
					coinamount = interaction.options.getNumber("amount");
				}
				else {
					coinamount = 1;
				}
				gameData = wordScramble(override);
				wordScrambles[interaction.channel.id] = {
					word: gameData.word,
					amount: coinamount,
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
				interaction.followUp({
					content: "Word scramble started.",
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
		case "handcuff":
			interaction.reply({
				embeds: [{
					title: "Placeholder",
					description: `This does nothing ${config.games.placeholder}`,
					color: 0x00ffff
				}]
			});
			break;
		case "bait":
			interaction.reply({
				embeds: [{
					title: "Placeholder",
					description: `This does nothing ${config.games.placeholder}`,
					color: 0x00ffff
				}]
			});
			break;
		case "bodyguard":
			interaction.reply({
				embeds: [{
					title: "Placeholder",
					description: `This does nothing ${config.games.placeholder}`,
					color: 0x00ffff
				}]
			});
			break;
		case "panhandle":
			interaction.reply({
				embeds: [{
					title: "Placeholder",
					description: `This does nothing ${config.games.placeholder}`,
					color: 0x00ffff
				}]
			});
			break;

		};
	});

	var wordScrambles = {}

	client.on('messageCreate', async message => {
		if (message.author.bot) return;
		if (!message.guild) return;
		if (message.channel.type == "dm") return;
		// Check if the channel already has a word scramble going
		if (wordScrambles[message.channel.id]) {
			if (wordScrambles[message.channel.id].badGuesses.includes(message.author.id)) return;
			// Check if the message is the correct answer
			if (message.content.toLowerCase() == wordScrambles[message.channel.id].word.toLowerCase()) {
				// Give the user a point
				await checkAndModifyPoints(message.author, wordScrambles[message.channel.id].amount);
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
			if (!config.games.wordscramble.whitelist.includes(message.channel.id) && !config.games.wordscramble.whitelist.includes(message.channel.parentId)) return;
			curCooldown = await checkCooldown({ id: 0 }, "wordscramble")
			if (curCooldown) {
				return;
			}
			// 2.5% chance for scramble
			if (Math.random < 0.025) {
				// Start a word scramble and clear any vars set by a forced scramble
				setCooldown({ id: 0 }, "wordscramble", 5 * 60 * 1000)
				override = false
				coinamount = 1
				gameData = wordScramble(override);
				wordScrambles[message.channel.id] = {
					word: gameData.word,
					scrambledWord: gameData.scrambledWord,
					amount: 1,
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
		setCooldown({ id: 0 }, "wordscramble", 1 * 60 * 1000)
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
		// if the scrambled word is the same as the word, keep scrambling it until they are different
		if (scrambledWord == word) {
			while (scrambledWord == word) {
				scrambledWord = word.split('').sort(function () {
					return 0.5 - Math.random();
				}).sort(function () {
					return 0.5 - Math.random();
				}).join('');
			}
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

		// we know what switch cases are and actually use them, unlike yandev
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

	const roshambo = (userChoice) => { 
		const choices = ['🪨', '📄', '✂️'];
		//Changed it to be hardcoded because RPS only ever has 3 choices.
		const botChoice = choices[Math.floor(Math.random() * 3)]; 
		
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
	const initTime = performance.now();
	// Login to Discord
	client.login(config.discord.token);
