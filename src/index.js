import { Client, GatewayIntentBits, Collection, REST, Routes } from 'discord.js';
import { config } from 'dotenv';
import { getUserByDiscordId } from './db.js';
import * as brag from './commands/brag.js';
import * as leave from './commands/leave.js';
import * as staff from './commands/staff.js';
import * as cases from './commands/cases.js';
import * as nid from './commands/nid.js';
import * as suspend from './commands/suspend.js';
import * as unsuspend from './commands/unsuspend.js';
import * as investigate from './commands/investigate.js';
import * as terminate from './commands/terminate.js';
import * as gban from './commands/gban.js';
import * as gunban from './commands/gunban.js';
import * as infractions from './commands/infractions.js';
import * as strike from './commands/strike.js';
import * as user from './commands/user.js';
import * as botInfo from './commands/bot.js';
import * as election from './commands/election.js';

config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.GuildMessages]
});

client.commands = new Collection();
const commands = [brag, leave, staff, cases, nid, suspend, unsuspend, investigate, terminate, gban, gunban, infractions, strike, user, botInfo, election];
for (const cmd of commands) {
  client.commands.set(cmd.data.name, cmd);
}

client.once('ready', async () => {
  console.log(`[CO Bot] Logged in as ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands.map(c => c.data.toJSON()) }
    );
    console.log('[CO Bot] Slash commands registered');
  } catch (e) {
    console.error('[CO Bot] Failed to register commands:', e.message);
  }
});

client.on('interactionCreate', async interaction => {
  if (interaction.isCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction);
    } catch (e) {
      console.error(`[CO Bot] Command error (${interaction.commandName}):`, e.message);
      const msg = { content: '❌ An error occurred. Please try again or contact an administrator.', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(msg);
      } else {
        await interaction.reply(msg);
      }
    }
  }

  if (interaction.isButton()) {
    if (interaction.customId.startsWith('nid_confirm_')) {
      const [, , userId, actionType] = interaction.customId.split('_');
      const supervisor = getUserByDiscordId(interaction.user.id);

      try {
        const { default: fetch } = await import('node-fetch');
        const response = await fetch('http://localhost:3016/api/disciplinary/non-investigational', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Bot-Secret': process.env.BOT_SECRET || 'co-bot-internal' },
          body: JSON.stringify({
            user_id: Number(userId),
            action_type: actionType,
            violation_description: 'Submitted via Discord bot',
            _bot_supervisor_id: supervisor?.id
          })
        });
        const data = await response.json();

        if (response.ok) {
          await interaction.update({
            content: `✅ NID submitted successfully. Case reference: **${data.case_ref}**\n[View in Portal](${process.env.PORTAL_URL}/cases)`,
            embeds: [], components: []
          });
        } else {
          await interaction.update({ content: `❌ Failed: ${data.error}`, embeds: [], components: [] });
        }
      } catch (e) {
        await interaction.update({ content: `❌ Error: ${e.message}`, embeds: [], components: [] });
      }
    }

    if (interaction.customId === 'nid_cancel') {
      await interaction.update({ content: 'NID submission cancelled.', embeds: [], components: [] });
    }
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
