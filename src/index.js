import express from 'express';
import { Client, GatewayIntentBits, Collection, REST, Routes, StringSelectMenuBuilder, ActionRowBuilder, ButtonBuilder, EmbedBuilder } from 'discord.js';
import { config } from 'dotenv';
import { COMMAND_LOG_CHANNEL_ID, MESSAGE_DELETE_LOG_CHANNEL_ID, MESSAGE_EDIT_LOG_CHANNEL_ID, FULL_MESSAGE_LOGS_CHANNEL_ID } from './config.js';
import { getLogChannel, getGlobalLogChannel } from './utils/botDb.js';
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
import * as ban from './commands/ban.js';
import * as unban from './commands/unban.js';
import { handleButton as verifyButton, handleModal as verifyModal } from './commands/verify.js';
import { handleButton as unverifyButton, handleModal as unverifyModal } from './commands/unverify.js';
import * as verify from './commands/verify.js';
import * as dm from './commands/dm.js';
import * as dmExempt from './commands/dm-exempt.js';
import * as purge from './commands/purge.js';
import * as scribe from './commands/scribe.js';
import * as unverify from './commands/unverify.js';
import * as authorisationOverride from './commands/authorisation-override.js';
import * as logspanel from './commands/logspanel.js';
import * as cooldown from './commands/cooldown.js';
import * as massUnban from './commands/mass-unban.js';
import * as createTicketPanel from './commands/create-ticket-panel.js';
import * as ticketPanelSend from './commands/ticket-panel-send.js';
import * as deleteTicketPanel from './commands/delete-ticket-panel.js';
import { handleTicketButton, handleTicketChannelButton } from './commands/ticket-panel-send.js';
import { handleTicketOptionsButton, handleTicketOptionsModal } from './commands/ticket-options.js';
import * as ticketOptions from './commands/ticket-options.js';

config();
import { logRoleAction } from './utils/logger.js';

if (!process.env.BOT_WEBHOOK_SECRET) {
  console.error('[FATAL] BOT_WEBHOOK_SECRET is not set. Webhook server will not start.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent]
});

client.commands = new Collection();
const commands = [dm, dmExempt, purge, scribe, brag, leave, staff, cases, nid, suspend, unsuspend, investigate, terminate, gban, gunban, infractions, strike, user, botInfo, ban, unban, verify, unverify, authorisationOverride, cooldown, massUnban, logspanel, createTicketPanel, ticketPanelSend, deleteTicketPanel, ticketOptions];
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

  // C-05: Re-schedule timed suspensions and bans on startup
  const { default: db, getActiveSuspension, liftSuspension, getActiveGlobalBan } = await import('./utils/botDb.js');
  const { unsuspendAcrossGuilds } = await import('./utils/roleManager.js');
  const { EmbedBuilder } = await import('discord.js');

  // Suspensions
  const activeSuspensions = db.prepare("SELECT * FROM suspensions WHERE expires_at IS NOT NULL AND active = 1").all();
  for (const sus of activeSuspensions) {
    const expiresAt = new Date(sus.expires_at).getTime();
    if (expiresAt > Date.now()) {
      const remaining = expiresAt - Date.now();
      console.log('[C-05] Scheduling suspension lift for', sus.discord_id, 'in', Math.round(remaining / 1000 / 60), 'mins');
      setTimeout(async () => {
        try {
          await unsuspendAcrossGuilds(client, sus.discord_id);
          liftSuspension(sus.discord_id);
          const user = await client.users.fetch(sus.discord_id).catch(() => null);
          if (user) await user.send({ embeds: [new EmbedBuilder().setTitle('✅ Suspension Lifted').setColor(0x22C55E).setDescription('Your suspension from **Community Organisation** has ended and your roles have been restored.').setFooter({ text: 'Community Organisation | Staff Assistant' }).setTimestamp()] }).catch(() => {});
          const { logAction } = await import('./utils/logger.js');
          await logAction(client, { action: '✅ Suspension Lifted (Auto)', moderator: { discordId: 'SYSTEM', name: 'Automated' }, target: { discordId: sus.discord_id, name: sus.discord_id }, reason: 'Suspension duration expired', color: 0x22C55E });
        } catch (e) { console.error('[C-05 suspension lift error]', e.message); }
      }, remaining);
    } else {
      await unsuspendAcrossGuilds(client, sus.discord_id);
      liftSuspension(sus.discord_id);
    }
  }

  // Bans
  const activeBans = db.prepare("SELECT * FROM banned_users WHERE unban_at IS NOT NULL AND active = 1").all();
  for (const ban of activeBans) {
    const unbanAt = new Date(ban.unban_at).getTime();
    if (unbanAt > Date.now()) {
      const remaining = unbanAt - Date.now();
      console.log('[C-05] Scheduling ban lift for', ban.discord_id, 'in', Math.round(remaining / 1000 / 60), 'mins');
      setTimeout(async () => {
        try {
          const GUILD_IDS = ['1485422910972760176','1485423163817988186','1485423682980675729','1485423935569920135','1485424535405723729'];
          for (const gid of GUILD_IDS) {
            const g = await client.guilds.fetch(gid).catch(() => null);
            if (g) await g.members.unban(ban.discord_id, 'Temporary ban expired').catch(() => {});
          }
          db.prepare("DELETE FROM banned_users WHERE discord_id = ? AND unban_at IS NOT NULL").run(ban.discord_id);
          const { logAction } = await import('./utils/logger.js');
          await logAction(client, { action: '✅ Temp Ban Expired — Auto Unbanned', moderator: { discordId: 'SYSTEM', name: 'Auto (Duration Expired)' }, target: { discordId: ban.discord_id, name: ban.discord_id }, reason: 'Temp ban expired', color: 0x22c55e });
        } catch (e) { console.error('[C-05 ban lift error]', e.message); }
      }, remaining);
    }
  }

  // Safety net: run every 60 seconds
  setInterval(async () => {
    try {
      const now = Date.now();
      const expiredSuspensions = db.prepare("SELECT * FROM suspensions WHERE expires_at IS NOT NULL AND active = 1 AND expires_at <= ?").all(new Date(now).toISOString());
      for (const sus of expiredSuspensions) {
        await unsuspendAcrossGuilds(client, sus.discord_id);
        liftSuspension(sus.discord_id);
        const user = await client.users.fetch(sus.discord_id).catch(() => null);
        if (user) await user.send({ embeds: [new EmbedBuilder().setTitle('✅ Suspension Lifted').setColor(0x22C55E).setDescription('Your suspension has ended.').setFooter({ text: 'Community Organisation | Staff Assistant' }).setTimestamp()] }).catch(() => {});
      }
      const expiredBans = db.prepare("SELECT * FROM banned_users WHERE unban_at IS NOT NULL AND active = 1 AND unban_at <= ?").all(new Date(now).toISOString());
      for (const ban of expiredBans) {
        const GUILD_IDS = ['1485422910972760176','1485423163817988186','1485423682980675729','1485423935569920135','1485424535405723729'];
        for (const gid of GUILD_IDS) {
          const g = await client.guilds.fetch(gid).catch(() => null);
          if (g) await g.members.unban(ban.discord_id, 'Temporary ban expired').catch(() => {});
        }
        db.prepare("DELETE FROM banned_users WHERE discord_id = ? AND unban_at IS NOT NULL").run(ban.discord_id);
      }
      if (expiredSuspensions.length > 0 || expiredBans.length > 0) {
        console.log('[C-05 safety net] Processed', expiredSuspensions.length, 'suspensions and', expiredBans.length, 'bans');
      }
    } catch (e) { console.error('[C-05 safety net error]', e.message); }
  }, 60000);

});

client.on('interactionCreate', async interaction => {
  try {
  console.log('[Interaction]', interaction.type, interaction.isChatInputCommand() ? interaction.commandName : '');
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    let commandError = null;
    try {
      await command.execute(interaction);
    } catch (e) {
      commandError = e.message;
      console.error(`[CO Bot] Command error (${interaction.commandName}):`, e.message);
      const msg = { content: '❌ An error occurred. Please try again or contact an administrator.', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(msg).catch(() => {});
      } else {
        await interaction.reply(msg).catch(() => {});
      }
    }

    const success = !commandError && !interaction._commandFailed;
    const errorMsg = commandError || (typeof interaction._commandFailed === 'string' ? interaction._commandFailed : null);

    // Always log the command attempt
    if (COMMAND_LOG_CHANNEL_ID) {
      const portalUser = getUserByDiscordId(interaction.user.id);
      const logChannel = await interaction.client.channels.fetch(COMMAND_LOG_CHANNEL_ID).catch(() => null);
      if (logChannel) {
        const options = interaction.options?._hoistedOptions?.map(o => `**${o.name}:** ${o.value}`).join('\n') || '';
        const embed = new EmbedBuilder()
          .setTitle(success ? `✅ Command Executed` : `❌ Command Failed`)
          .setColor(success ? 0x22c55e : 0xef4444)
          .addFields(
            { name: 'Command', value: `/${interaction.commandName}`, inline: true },
            { name: 'User', value: `${portalUser?.display_name || interaction.user.username} (<@${interaction.user.id}>)`, inline: true },
            { name: 'Guild', value: interaction.guild?.name || 'DM', inline: true },
            { name: 'Status', value: success ? '✅ Success' : '❌ Failed', inline: true },
            ...(options ? [{ name: 'Options', value: options, inline: false }] : []),
            ...(errorMsg ? [{ name: 'Error', value: String(errorMsg).slice(0, 500), inline: false }] : []),
          )
          .setFooter({ text: 'Community Organisation | Staff Assistant' })
          .setTimestamp();
        await logChannel.send({ embeds: [embed] }).catch(() => {});
      }
    }
  }

  // Autocomplete for ticket-panel-send and ticket-panel-delete
  if (interaction.isAutocomplete() && (interaction.commandName === 'ticket-panel-send' || interaction.commandName === 'ticket-panel-delete')) {
    const { getAllTicketPanels } = await import('./utils/botDb.js');
    const panels = getAllTicketPanels();
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'panel_name' || focused.name === 'name') {
      const value = focused.value.toLowerCase();
      const choices = panels
        .filter(p => p.name.toLowerCase().includes(value))
        .slice(0, 25)
        .map(p => ({ name: p.name, value: p.name }));
      return interaction.respond(choices).catch(() => {});
    }
  }

  if (interaction.isButton()) {
    // Verify/Unverify button handlers
    if (interaction.customId.startsWith('verify_')) return verifyButton(interaction);
    if (interaction.customId.startsWith('unverify_')) return unverifyButton(interaction);
    // Logspanel back button handlers
    if (interaction.customId?.startsWith('logspanel_back')) {
      try { return logspanel.handleSelect(interaction); }
      catch(e) { console.error('[logspanel btn error]', e.message, 'customId:', interaction.customId); throw e; }
    }

    // Ticket create button
    if (interaction.customId.startsWith('ticket_create_')) {
      return handleTicketButton(interaction);
    }

    // Ticket channel buttons (claim / close)
    if (interaction.customId.startsWith('ticket_claim_') || interaction.customId.startsWith('ticket_close_')) {
      return handleTicketChannelButton(interaction);
    }

    // Ticket options buttons
    if (interaction.isButton() && interaction.customId.startsWith('ticketopts_')) {
      return handleTicketOptionsButton(interaction);
    }

    // NID button handlers
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

    // DM acknowledgement button — dm_ack_<moderatorId> or dm_ack_<moderatorId>_<recipientId>
    if (interaction.customId.startsWith('dm_ack_')) {
      const parts = interaction.customId.split('_');
      const moderatorId = parts[2];
      const recipientId = parts[3] || null;

      await interaction.update({
        content: `✅ **Acknowledged.** The sender has been notified that you have read this message.`,
        embeds: [],
        components: []
      });

      try {
        const sender = await interaction.client.users.fetch(moderatorId).catch(() => null);
        if (sender) {
          await sender.send({
            content: `📧 **Acknowledgement received.** ${recipientId ? `<@${recipientId}>` : 'A recipient'} has confirmed reading your DM.`
          });
        }
      } catch {}
    }

    // DM exempt button handlers
    if (interaction.customId === 'dm_exempt_add') {
      // Fetch guild members for select menu
      const guild = interaction.guild;
      if (!guild) {
        await interaction.update({ content: '❌ This command must be used in a server.', components: [] });
        return;
      }

      await guild.members.fetch();

      const members = guild.members.cache
        .filter(m => !m.user.bot)
        .map(m => ({
          label: m.displayName.slice(0, 100),
          value: m.user.id,
          description: (m.user.username || '').slice(0, 100) || null
        }))
        .slice(0, 25);

      if (members.length === 0) {
        await interaction.update({ content: '❌ No members found in this server.', components: [] });
        return;
      }

      await interaction.update({
        content: '**Select a server member to exempt from mass/team DMs:**',
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('dm_exempt_user_select')
              .setPlaceholder('Choose a member...')
              .addOptions(members)
          ),
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('dm_exempt_cancel').setLabel('Cancel').setStyle(2)
          )
        ]
      });
      return;
    }

    if (interaction.customId === 'dm_exempt_remove') {
      await interaction.showModal({
        title: 'Remove DM Exemption',
        customId: 'dm_exempt_remove_modal',
        components: [
          {
            type: 1,
            components: [{
              type: 4,
              style: 1,
              label: 'User mention or ID',
              placeholder: '@username or 123456789',
              customId: 'user_input',
              maxLength: 50,
            }]
          }
        ]
      });
      return;
    }

  }

  // String select menu handlers
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'dm_exempt_user_select') {
      const { addDmExemption, getDmExemptions } = await import('./utils/botDb.js');

      const discordId = interaction.values[0];
      const member = interaction.guild?.members.cache.get(discordId);
      const displayName = member?.displayName || member?.user.username || discordId;

      addDmExemption(discordId, displayName, interaction.user.id);

      const exempts = getDmExemptions();
      const rows = exempts.map(e =>
        `**${e.display_name || 'Unknown'}** — <@${e.discord_id}>\n   Added by: ${e.exempted_by} · ${new Date(e.created_at).toLocaleDateString('en-GB')}`
      );

      await interaction.update({
        content: null,
        embeds: [new EmbedBuilder()
          .setTitle(`📋 DM Exemptions (${exempts.length})`)
          .setColor(0x22c55e)
          .setDescription(rows.join('\n\n'))
          .setFooter({ text: 'Community Organisation | Staff Assistant' })
          .setTimestamp()
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('dm_exempt_add').setLabel('Add Exemption').setStyle(3),
            new ButtonBuilder().setCustomId('dm_exempt_remove').setLabel('Remove Exemption').setStyle(4),
          )
        ]
      });
      return;
    }

    if (interaction.customId === 'dm_exempt_cancel') {
      const { getDmExemptions } = await import('./utils/botDb.js');
      const exempts = getDmExemptions();
      const rows = exempts.map(e =>
        `**${e.display_name || 'Unknown'}** — <@${e.discord_id}>\n   Added by: ${e.exempted_by} · ${new Date(e.created_at).toLocaleDateString('en-GB')}`
      );

      await interaction.update({
        content: null,
        embeds: [new EmbedBuilder()
          .setTitle(`📋 DM Exemptions (${exempts.length})`)
          .setColor(0x5865F2)
          .setDescription(rows.join('\n\n'))
          .setFooter({ text: 'Community Organisation | Staff Assistant' })
          .setTimestamp()
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('dm_exempt_add').setLabel('Add Exemption').setStyle(3),
            new ButtonBuilder().setCustomId('dm_exempt_remove').setLabel('Remove Exemption').setStyle(4),
          )
        ]
      });
      return;
    }
    if (interaction.customId.startsWith('verify_')) return verifyButton(interaction);
    if (interaction.customId.startsWith('unverify_')) return unverifyButton(interaction);
    if (interaction.customId?.startsWith('logspanel_')) {
      try { return logspanel.handleSelect(interaction); }
      catch(e) { console.error('[logspanel handleSelect error]', e.message, 'customId:', interaction.customId, 'values:', interaction.values); throw e; }
    }
  }

  // Verify/Unverify modal handlers
  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('verify_deny_reason_')) return verifyModal(interaction);
    if (interaction.customId.startsWith('unverify_approve_reason_')) return unverifyModal(interaction);
    if (interaction.customId?.startsWith('logspanel_')) {
      try { return logspanel.handleModal(interaction); }
      catch(e) { console.error('[logspanel handleModal error]', e.message, 'customId:', interaction.customId); throw e; }
    }

    if (interaction.customId.startsWith('ticketopts_renamemodal_')) {
      return handleTicketOptionsModal(interaction);
    }

    if (interaction.customId === 'dm_exempt_add_modal') {
      const { addDmExemption, getDmExemptions } = await import('./utils/botDb.js');
      const { getUserByDiscordId } = await import('./db.js');
      const userInput = interaction.fields.getTextInputValue('user_input');
      const reason = interaction.fields.getTextInputValue('reason_input') || null;

      // Extract user ID from mention or raw ID
      const userId = userInput.replace(/<@!?/g, '').replace(/>/g, '').trim();
      const portalUser = getUserByDiscordId(userId);
      const displayName = portalUser?.display_name || userInput;

      addDmExemption(userId, displayName, interaction.user.id);

      const exempts = getDmExemptions();
      const rows = exempts.map(e =>
        `**${e.display_name || 'Unknown'}** — <@${e.discord_id}>\n   Added by: ${e.exempted_by} · ${new Date(e.created_at).toLocaleDateString('en-GB')}`
      );

      await interaction.update({
        content: null,
        embeds: [new EmbedBuilder()
          .setTitle(`📋 DM Exemptions (${exempts.length})`)
          .setColor(0x22c55e)
          .setDescription(exempts.length > 0 ? rows.join('\n\n') : 'No users are currently exempt.')
          .setFooter({ text: 'Community Organisation | Staff Assistant' })
          .setTimestamp()
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('dm_exempt_add').setLabel('Add Exemption').setStyle(3),
            new ButtonBuilder().setCustomId('dm_exempt_remove').setLabel('Remove Exemption').setStyle(4),
          )
        ]
      });
    }

    if (interaction.customId === 'dm_exempt_remove_modal') {
      const { removeDmExemption, getDmExemptions } = await import('./utils/botDb.js');
      const userInput = interaction.fields.getTextInputValue('user_input');
      const userId = userInput.replace(/<@!?/g, '').replace(/>/g, '').trim();

      removeDmExemption(userId);

      const exempts = getDmExemptions();
      const rows = exempts.map(e =>
        `**${e.display_name || 'Unknown'}** — <@${e.discord_id}>\n   Added by: ${e.exempted_by} · ${new Date(e.created_at).toLocaleDateString('en-GB')}`
      );

      await interaction.update({
        content: null,
        embeds: [new EmbedBuilder()
          .setTitle(`📋 DM Exemptions (${exempts.length})`)
          .setColor(0x22c55e)
          .setDescription(exempts.length > 0 ? rows.join('\n\n') : 'No users are currently exempt.')
          .setFooter({ text: 'Community Organisation | Staff Assistant' })
          .setTimestamp()
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('dm_exempt_add').setLabel('Add Exemption').setStyle(3),
            new ButtonBuilder().setCustomId('dm_exempt_remove').setLabel('Remove Exemption').setStyle(4),
          )
        ]
      });
    }
  }
  } catch (e) {
    console.error('[interactionCreate] Unhandled error:', e.message);
    const msg = { content: '❌ An unexpected error occurred. Please try again.', ephemeral: true };
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(msg).catch(() => {});
      } else {
        await interaction.reply(msg).catch(() => {});
      }
    } catch (_) {}
  }
});

// Auto-apply roles when a verified member joins any server
client.on('guildMemberAdd', async (member) => {
  try {
    const { default: botDb } = await import('./utils/botDb.js');
    const verified = botDb.prepare("SELECT * FROM verified_members WHERE discord_id = ?").get(member.user.id);
    if (!verified) return;

    const { applyVerification } = await import('./utils/verifyHelper.js');
    const { POSITIONS } = await import('./utils/positions.js');
    const roleNames = POSITIONS[verified.position] || [];
    const toAssign = member.guild.roles.cache.filter(r => roleNames.includes(r.name));
    if (toAssign.size > 0) await member.roles.add(toAssign).catch(() => {});
    await member.setNickname(verified.nickname || null).catch(() => {});
    console.log('[Verify] Auto-applied roles for', member.user.tag, 'on join to', member.guild.name);
  } catch (e) {
    console.error('[guildMemberAdd verify error]', e.message);
  }
});


// Message delete log — tracked globally across all servers
client.on('messageDelete', async (message) => {
  if (!message || message.author?.bot) return;
  try {
    const deleteChannelId = MESSAGE_DELETE_LOG_CHANNEL_ID;
    const guildId = message.guildId;
    const perGuildChannelId = guildId ? getLogChannel(guildId, 'message', 'message_delete') : null;
    const globalChannelId = getGlobalLogChannel('global_message');

    if (!deleteChannelId && !FULL_MESSAGE_LOGS_CHANNEL_ID && !perGuildChannelId && !globalChannelId) return;

    const content = message.content?.slice(0, 1500) || '*No text content*';
    const attachments = message.attachments.size > 0 ? `\n📎 ${message.attachments.size} attachment(s)` : '';
    const jumpLink = message.url ? `\n🔗 [Jump to message](${message.url})` : '';

    const embed = new EmbedBuilder()
      .setTitle('🗑️ Message Deleted')
      .setColor(0xef4444)
      .addFields(
        { name: '👤 Author', value: `${message.author.username} (<@${message.author.id}>)`, inline: true },
        { name: '📌 Channel', value: message.channel?.name ? `#${message.channel.name}` : message.channelId, inline: true },
        { name: '🏠 Server', value: message.guild?.name || 'DM', inline: true },
        { name: '💬 Content', value: content + attachments + jumpLink, inline: false },
      )
      .setFooter({ text: 'Community Organisation | Staff Assistant' })
      .setTimestamp();

    // Send to delete log channel
    if (deleteChannelId) {
      const deleteChannel = await client.channels.fetch(deleteChannelId).catch(() => null);
      if (deleteChannel) await deleteChannel.send({ embeds: [embed] });
    }
    // Also send to full-message-logs
    if (FULL_MESSAGE_LOGS_CHANNEL_ID) {
      const fullMsgChannel = await client.channels.fetch(FULL_MESSAGE_LOGS_CHANNEL_ID).catch(() => null);
      if (fullMsgChannel) await fullMsgChannel.send({ embeds: [embed] });
    }
    // Also send to per-guild configured channel
    if (perGuildChannelId) {
      const perGuildChannel = await client.channels.fetch(perGuildChannelId).catch(() => null);
      if (perGuildChannel) await perGuildChannel.send({ embeds: [embed] });
    }
    // Also send to global message log channel
    if (globalChannelId) {
      const globalChannel = await client.channels.fetch(globalChannelId).catch(() => null);
      if (globalChannel) await globalChannel.send({ embeds: [embed] });
    }
  } catch (e) {
    console.error('[messageDelete log error]', e.message);
  }
});

// Message edit log — tracked globally across all servers
client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (!oldMessage || !newMessage || oldMessage.author?.bot) return;
  if (oldMessage.content === newMessage.content) return;
  try {
    const editChannelId = MESSAGE_EDIT_LOG_CHANNEL_ID;
    const guildId = newMessage.guildId;
    const perGuildChannelId = guildId ? getLogChannel(guildId, 'message', 'message_edit') : null;
    const globalChannelId = getGlobalLogChannel('global_message');

    if (!editChannelId && !FULL_MESSAGE_LOGS_CHANNEL_ID && !perGuildChannelId && !globalChannelId) return;

    const oldContent = oldMessage.content?.slice(0, 750) || '*No text content*';
    const newContent = newMessage.content?.slice(0, 750) || '*No text content*';
    const jumpLink = newMessage.url ? `\n🔗 [Jump to message](${newMessage.url})` : '';

    const embed = new EmbedBuilder()
      .setTitle('✏️ Message Edited')
      .setColor(0xf59e0b)
      .addFields(
        { name: '👤 Author', value: `${newMessage.author.username} (<@${newMessage.author.id}>)`, inline: true },
        { name: '📌 Channel', value: newMessage.channel?.name ? `#${newMessage.channel.name}` : newMessage.channelId, inline: true },
        { name: '🏠 Server', value: newMessage.guild?.name || 'DM', inline: true },
        { name: '📝 Before', value: oldContent, inline: false },
        { name: '📝 After', value: newContent + jumpLink, inline: false },
      )
      .setFooter({ text: 'Community Organisation | Staff Assistant' })
      .setTimestamp();

    // Send to edit log channel
    if (editChannelId) {
      const editChannel = await client.channels.fetch(editChannelId).catch(() => null);
      if (editChannel) await editChannel.send({ embeds: [embed] });
    }
    // Also send to full-message-logs
    if (FULL_MESSAGE_LOGS_CHANNEL_ID) {
      const fullMsgChannel = await client.channels.fetch(FULL_MESSAGE_LOGS_CHANNEL_ID).catch(() => null);
      if (fullMsgChannel) await fullMsgChannel.send({ embeds: [embed] });
    }
    // Also send to per-guild configured channel
    if (perGuildChannelId) {
      const perGuildChannel = await client.channels.fetch(perGuildChannelId).catch(() => null);
      if (perGuildChannel) await perGuildChannel.send({ embeds: [embed] });
    }
    // Also send to global message log channel
    if (globalChannelId) {
      const globalChannel = await client.channels.fetch(globalChannelId).catch(() => null);
      if (globalChannel) await globalChannel.send({ embeds: [embed] });
    }
  } catch (e) {
    console.error('[messageUpdate log error]', e.message);
  }
});

// ============ ROLE MANAGEMENT LOGGING ============

// Role created
client.on('roleCreate', async (role) => {
  try {
    if (!role || !role.guild) return;
    const guildId = role.guild.id;
    await logRoleAction(role.client, {
      action: 'Role Created',
      target: `@${role.name}`,
      moderator: null,
      color: 0x22C55E,
      fields: [
        { name: 'Role Name', value: role.name, inline: true },
        { name: 'Role ID', value: role.id, inline: true },
        { name: 'Color', value: role.hexColor === '#000000' ? 'Default' : role.hexColor, inline: true },
        { name: 'Server', value: role.guild.name, inline: false },
      ],
      roleLogType: 'role_create',
      guildId
    });
  } catch (e) {
    console.error('[roleCreate log error]', e.message);
  }
});

// Role deleted
client.on('roleDelete', async (role) => {
  try {
    if (!role || !role.guild) return;
    const guildId = role.guild.id;
    await logRoleAction(role.client, {
      action: 'Role Deleted',
      target: `@${role.name}`,
      moderator: null,
      color: 0xEF4444,
      fields: [
        { name: 'Role Name', value: role.name, inline: true },
        { name: 'Role ID', value: role.id, inline: true },
        { name: 'Color', value: role.hexColor === '#000000' ? 'Default' : role.hexColor, inline: true },
        { name: 'Server', value: role.guild.name, inline: false },
      ],
      roleLogType: 'role_delete',
      guildId
    });
  } catch (e) {
    console.error('[roleDelete log error]', e.message);
  }
});

// Role updated (name, color, permissions, etc.)
client.on('roleUpdate', async (oldRole, newRole) => {
  try {
    const changes = [];
    if (oldRole.name !== newRole.name) changes.push(`Name: "${oldRole.name}" → "${newRole.name}"`);
    if (oldRole.hexColor !== newRole.hexColor) changes.push(`Color: ${oldRole.hexColor || 'Default'} → ${newRole.hexColor || 'Default'}`);
    if (oldRole.position !== newRole.position) changes.push(`Position: ${oldRole.position} → ${newRole.position}`);
    if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) changes.push(`Permissions changed`);

    if (changes.length === 0) return; // No meaningful changes

    const guildId = newRole.guild.id;
    const isPermissionChange = oldRole.permissions.bitfield !== newRole.permissions.bitfield;

    await logRoleAction(newRole.client, {
      action: 'Role Updated',
      target: `@${newRole.name}`,
      moderator: null,
      color: 0xF59E0B,
      fields: [
        { name: 'Role', value: `<@&${newRole.id}>`, inline: true },
        { name: 'Server', value: newRole.guild.name, inline: true },
        { name: 'Changes', value: changes.join('\n'), inline: false },
      ],
      roleLogType: isPermissionChange ? 'role_permission' : 'role_update',
      guildId
    });
  } catch (e) {
    console.error('[roleUpdate log error]', e.message);
  }
});

// Member role added
// Member roles updated (added or removed)
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  try {
    if (!oldMember || !newMember || newMember.user?.bot) return;
    const guildId = newMember.guild.id;

    const oldRoles = oldMember.roles.cache;
    const newRoles = newMember.roles.cache;

    const addedRoles = newRoles.filter(r => !oldRoles.has(r.id));
    const removedRoles = oldRoles.filter(r => !newRoles.has(r.id));

    for (const role of addedRoles.values()) {
      await logRoleAction(newMember.client, {
        action: 'Member Role Added',
        target: { discordId: newMember.user.id, name: newMember.user.username },
        moderator: null,
        color: 0x22C55E,
        fields: [
          { name: 'Member', value: `<@${newMember.user.id}>`, inline: true },
          { name: 'Role Added', value: role.name, inline: false },
          { name: 'Server', value: newMember.guild.name, inline: false },
        ],
        roleLogType: 'member_role_add',
        guildId
      });
    }

    for (const role of removedRoles.values()) {
      await logRoleAction(newMember.client, {
        action: 'Member Role Removed',
        target: { discordId: newMember.user.id, name: newMember.user.username },
        moderator: null,
        color: 0xEF4444,
        fields: [
          { name: 'Member', value: `<@${newMember.user.id}>`, inline: true },
          { name: 'Role Removed', value: role.name, inline: false },
          { name: 'Server', value: newMember.guild.name, inline: false },
        ],
        roleLogType: 'member_role_remove',
        guildId
      });
    }
  } catch (e) {
    console.error('[guildMemberUpdate log error]', e.message);
  }
});

// ============ BOT WEBHOOK SERVER ============
const webhookApp = express();
webhookApp.use(express.json());

function verifyBotSecret(req, res) {
  const secret = req.headers['x-bot-secret'];
  if (!secret || !process.env.BOT_WEBHOOK_SECRET || secret !== process.env.BOT_WEBHOOK_SECRET) {
    res.status(401).json({ error: 'Unauthorised' });
    return false;
  }
  return true;
}

// POST /bot/suspend
webhookApp.post('/bot/suspend', async (req, res) => {
  if (!verifyBotSecret(req, res)) return;
  const { discordId, reason, duration, moderatorId, moderatorName, targetName } = req.body;
  if (!discordId) return res.status(400).json({ ok: false, error: 'discordId required' });
  try {
    const { suspendAcrossGuilds } = await import('./utils/roleManager.js');
    const { addInfraction, addSuspension } = await import('./utils/botDb.js');
    const { logAction } = await import('./utils/logger.js');

    await suspendAcrossGuilds(client, discordId);

    function formatDuration(ms) {
      if (!ms) return 'Indefinite';
      const minutes = Math.floor(ms / 60000);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);
      if (days > 0) return days + ' day' + (days !== 1 ? 's' : '');
      if (hours > 0) return hours + ' hour' + (hours !== 1 ? 's' : '');
      if (minutes > 0) return minutes + ' minute' + (minutes !== 1 ? 's' : '');
      return 'Less than a minute';
    }

    let durationMs = null;
    if (duration) {
      const { default: ms } = await import('ms');
      durationMs = ms(duration);
    }
    const expiresAt = durationMs ? new Date(Date.now() + durationMs).toISOString() : null;
    const durationDisplay = formatDuration(durationMs);
    const expiresDisplay = expiresAt ? new Date(expiresAt).toUTCString() : 'Never';

    const inf = addInfraction(discordId, 'suspension', reason, moderatorId || 'PORTAL', moderatorName || 'Portal');
    addSuspension(discordId, reason, moderatorId || 'PORTAL', expiresAt, inf.lastInsertRowid);

    // DM the user
    try {
      const { EmbedBuilder } = await import('discord.js');
      const user = await client.users.fetch(discordId).catch(() => null);
      if (user) {
        await user.send({ embeds: [new EmbedBuilder()
          .setTitle('🔴 You Have Been Suspended')
          .setColor(0xEF4444)
          .setDescription('You have been suspended from **Community Organisation**.\n\nIf you believe this is an error, you may appeal in the Appeals Server.')
          .addFields(
            { name: '📋 Reason', value: reason || 'No reason provided', inline: false },
            { name: '⏱️ Duration', value: durationDisplay, inline: true },
            { name: '📅 Expires', value: expiresDisplay, inline: true },
            { name: '👤 Actioned By', value: moderatorName || 'Staff Management', inline: true },
          )
          .setFooter({ text: 'Community Organisation | Staff Assistant' })
          .setTimestamp()
        ]});
      }
    } catch {}

    await logAction(client, {
      action: '🔴 Staff Suspended (Portal)',
      moderator: { discordId: moderatorId || 'PORTAL', name: moderatorName || 'Portal' },
      target: { discordId, name: targetName || discordId },
      reason: reason || 'No reason provided',
      color: 0xEF4444,
      fields: [
        { name: '⏱️ Duration', value: durationDisplay, inline: true },
        { name: '📅 Expires', value: expiresDisplay, inline: true },
        { name: '👤 Actioned By', value: moderatorName || 'Portal', inline: true },
        { name: '🌐 Source', value: 'CO Staff Portal — Case Management', inline: true },
      ]
    });

    // Auto-lift if timed
    if (durationMs) {
      setTimeout(async () => {
        const { unsuspendAcrossGuilds } = await import('./utils/roleManager.js');
        const { liftSuspension } = await import('./utils/botDb.js');
        const botDbMod = await import('./utils/botDb.js');
        await unsuspendAcrossGuilds(client, discordId, botDbMod.default);
        liftSuspension(discordId);
        try {
          const { EmbedBuilder } = await import('discord.js');
          const user = await client.users.fetch(discordId).catch(() => null);
          if (user) await user.send({ embeds: [new EmbedBuilder()
            .setTitle('✅ Suspension Lifted')
            .setColor(0x22C55E)
            .setDescription('Your suspension from **Community Organisation** has ended and your roles have been restored.')
            .setFooter({ text: 'Community Organisation | Staff Assistant' })
            .setTimestamp()
          ]});
        } catch {}
        await logAction(client, {
          action: '✅ Suspension Lifted (Auto)',
          moderator: { discordId: 'SYSTEM', name: 'Automated' },
          target: { discordId, name: targetName || discordId },
          reason: 'Suspension duration expired',
          color: 0x22C55E
        });
      }, durationMs);
    }

    res.json({ ok: true, duration: durationDisplay, expires: expiresAt });
  } catch (e) {
    console.error('[BOT WEBHOOK /suspend]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /bot/unsuspend
webhookApp.post('/bot/unsuspend', async (req, res) => {
  if (!verifyBotSecret(req, res)) return;
  const { discordId, moderatorName, targetName } = req.body;
  if (!discordId) return res.status(400).json({ ok: false, error: 'discordId required' });
  try {
    const { unsuspendAcrossGuilds } = await import('./utils/roleManager.js');
    const { liftSuspension } = await import('./utils/botDb.js');
    const botDbMod = await import('./utils/botDb.js');
    await unsuspendAcrossGuilds(client, discordId, botDbMod.default);
    liftSuspension(discordId);

    try {
      const { EmbedBuilder } = await import('discord.js');
      const user = await client.users.fetch(discordId).catch(() => null);
      if (user) await user.send({ embeds: [new EmbedBuilder()
        .setTitle('✅ Suspension Lifted')
        .setColor(0x22C55E)
        .setDescription('Your suspension from **Community Organisation** has ended and your roles have been restored.')
        .addFields({ name: '👤 Actioned By', value: moderatorName || 'Staff Management', inline: true })
        .setFooter({ text: 'Community Organisation | Staff Assistant' })
        .setTimestamp()
      ]});
    } catch {}

    const { logAction } = await import('./utils/logger.js');
    await logAction(client, {
      action: '✅ Suspension Lifted (Portal)',
      moderator: { discordId: 'PORTAL', name: moderatorName || 'Portal' },
      target: { discordId, name: targetName || discordId },
      reason: 'Lifted via CO Staff Portal',
      color: 0x22C55E,
      fields: [{ name: '🌐 Source', value: 'CO Staff Portal — Case Management', inline: true }]
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('[BOT WEBHOOK /unsuspend]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

webhookApp.listen(3017, () => console.log('[CO Bot] Webhook server listening on port 3017'));

client.login(process.env.DISCORD_BOT_TOKEN);
