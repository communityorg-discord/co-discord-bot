import express from 'express';
import { Client, GatewayIntentBits, Collection, REST, Routes, StringSelectMenuBuilder, ActionRowBuilder, ButtonBuilder, EmbedBuilder } from 'discord.js';
import { config } from 'dotenv';
import { COMMAND_LOG_CHANNEL_ID, MESSAGE_DELETE_LOG_CHANNEL_ID, MESSAGE_EDIT_LOG_CHANNEL_ID, FULL_MESSAGE_LOGS_CHANNEL_ID } from './config.js';
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

config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent]
});

client.commands = new Collection();
const commands = [dm, dmExempt, purge, scribe, brag, leave, staff, cases, nid, suspend, unsuspend, investigate, terminate, gban, gunban, infractions, strike, user, botInfo, ban, unban, verify, unverify, authorisationOverride];
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

  if (interaction.isButton()) {
    // Verify/Unverify button handlers
    if (interaction.customId.startsWith('verify_')) return verifyButton(interaction);
    if (interaction.customId.startsWith('unverify_')) return unverifyButton(interaction);
  }

  if (interaction.isStringSelectMenu()) {
    // Verify/Unverify select menu handlers
    if (interaction.customId.startsWith('verify_')) return verifyButton(interaction);
    if (interaction.customId.startsWith('unverify_')) return unverifyButton(interaction);
  }

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

  // Verify/Unverify modal handlers
  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('verify_deny_reason_')) return verifyModal(interaction);
    if (interaction.customId.startsWith('unverify_approve_reason_')) return unverifyModal(interaction);

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
    if (!deleteChannelId && !FULL_MESSAGE_LOGS_CHANNEL_ID) return;

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
    if (!editChannelId && !FULL_MESSAGE_LOGS_CHANNEL_ID) return;

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
  } catch (e) {
    console.error('[messageUpdate log error]', e.message);
  }
});

// ============ BOT WEBHOOK SERVER ============
const webhookApp = express();
webhookApp.use(express.json());

function verifyBotSecret(req, res) {
  const secret = req.headers['x-bot-secret'];
  if (!secret || secret !== process.env.BOT_WEBHOOK_SECRET) {
    res.status(401).json({ ok: false, error: 'Unauthorised' });
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
