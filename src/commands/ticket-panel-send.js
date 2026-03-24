import { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { canRunCommand } from '../utils/permissions.js';
import { getTicketPanelByName, getAllTicketPanels } from '../utils/botDb.js';
import { logAction } from '../utils/logger.js';
import { closeTicketWithTranscript } from '../utils/ticketTranscript.js';

// ── Shared transcript HTML generator ─────────────────────────────────────────

function generateTranscriptHTML(messages, channel, guild, ticketMeta) {
  const rows = messages.map(m => {
    const time = new Date(m.createdTimestamp).toLocaleString('en-GB', { timeZone: 'UTC' });
    const avatar = m.author.displayAvatarURL({ size: 64, extension: 'png' });
    const authorName = m.author.displayName || m.author.username;

    let resolvedContent = m.content || '';
    if (resolvedContent) {
      resolvedContent = resolvedContent.replace(/<@!?(\d+)>/g, (match, id) => {
        const user = m.mentions.users.get(id) || m.mentions.members?.get(id);
        return user ? '@' + (user.displayName || user.username || id) : '@' + id;
      });
      resolvedContent = resolvedContent.replace(/<#(\d+)>/g, (match, id) => {
        const ch = m.mentions.channels?.get(id);
        return ch ? '#' + ch.name : '#' + id;
      });
      resolvedContent = resolvedContent.replace(/<@&(\d+)>/g, (match, id) => {
        const role = m.mentions.roles?.get(id);
        return role ? '@' + role.name : '@' + id;
      });
      resolvedContent = resolvedContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    const hasTextContent = resolvedContent.trim().length > 0;
    let content;
    if (hasTextContent) {
      content = resolvedContent;
    } else if (m.embeds && m.embeds.size > 0) {
      const firstEmbed = m.embeds[0];
      const desc = firstEmbed.description || firstEmbed.title || '[embed]';
      content = `<em style="color:#666">[Embed] ${desc.slice(0, 120)}</em>`;
    } else if (m.attachments && m.attachments.size > 0) {
      const attachmentNames = [...m.attachments.values()].map(a => a.name || a.filename).join(', ');
      content = `<em style="color:#666">[Attachment(s)] ${attachmentNames}</em>`;
    } else {
      content = '<em style="color:#666">No text content</em>';
    }

    const attachments = [...m.attachments.values()].map(a =>
      a.contentType?.startsWith('image/')
        ? `<img src="${a.url}" style="max-width:300px;max-height:200px;border-radius:4px;margin-top:4px;display:block" />`
        : `<a href="${a.url}" style="color:#7289da">${a.name}</a>`
    ).join('');
    const embeds = m.embeds.size > 0
      ? `<div style="border-left:3px solid #7289da;padding:4px 8px;margin-top:4px;color:#aaa;font-size:12px">[${m.embeds.size} embed(s)]</div>`
      : '';

    return `<div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid #2a2a2a">
 <img src="${avatar}" style="width:36px;height:36px;border-radius:50%;flex-shrink:0" onerror="this.style.display='none'" />
 <div style="flex:1;min-width:0">
 <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
 <span style="font-weight:700;color:#fff">${authorName}</span>
 <span style="font-size:11px;color:#666">${time} UTC</span>
 ${m.author.bot ? '<span style="font-size:10px;background:#5865f2;color:#fff;padding:1px 5px;border-radius:3px">BOT</span>' : ''}
 </div>
 <div style="color:#dcddde;margin-top:2px;word-break:break-word">${content}</div>
 ${attachments}
 ${embeds}
 </div></div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ticket Transcript — #${channel.name}</title>
<style>
 * { box-sizing:border-box; margin:0; padding:0; }
 body { background:#1a1a1a; color:#dcddde; font-family:'Segoe UI',sans-serif; font-size:14px; padding:20px; }
 .header { background:#111; border:1px solid #333; border-radius:8px; padding:16px 20px; margin-bottom:20px; }
 .header h1 { color:#fff; font-size:18px; margin-bottom:8px; }
 .meta { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:8px; }
 .meta-item { background:#222; border-radius:6px; padding:8px 12px; }
 .meta-item .label { font-size:11px; color:#888; text-transform:uppercase; letter-spacing:.05em; }
 .meta-item .value { color:#fff; font-weight:600; margin-top:2px; }
 .messages { background:#111; border:1px solid #333; border-radius:8px; padding:0 16px; }
 .count { color:#888; font-size:12px; margin-bottom:12px; padding-top:12px; }
 .portal-badge { display:inline-block; margin-top:12px; padding:6px 12px; background:#5865f2; color:#fff; border-radius:6px; text-decoration:none; font-size:13px; font-weight:600; }
</style>
</head>
<body>
<div class="header">
 <h1>🎫 Ticket Transcript</h1>
 <div class="meta">
 ${['Panel','Ticket #','Opened By','Claimed By','Server','Closed By','Status'].map(field => {
   const key = field.toLowerCase().replace(/ /g,'_');
   const val = ticketMeta[key] || ticketMeta[field.toLowerCase()] || '—';
   return `<div class="meta-item"><div class="label">${field}</div><div class="value">${val}</div></div>`;
 }).join('')}
 </div>
</div>
<div class="messages">
 <div class="count">${messages.length} message${messages.length !== 1 ? 's' : ''}</div>
 ${rows}
</div>
</body>
</html>`;
}

export const data = new SlashCommandBuilder()
  .setName('ticket-panel-send')
  .setDescription('Send a ticket panel to the current channel')
  .addStringOption(opt =>
    opt.setName('panel_name')
      .setDescription('Name of the ticket panel to send')
      .setRequired(true)
      .setAutocomplete(true)
  );

export async function execute(interaction) {
  const auth = await canRunCommand(interaction.user.id, 7);
  if (!auth.allowed) {
    return interaction.reply({ content: `❌ ${auth.reason}`, ephemeral: true });
  }

  const panelName = interaction.options.getString('panel_name');
  const panel = getTicketPanelByName(panelName);

  if (!panel) {
    const allPanels = getAllTicketPanels();
    const panelList = allPanels.length
      ? allPanels.map(p => `• **${p.name}**`).join('\n')
      : 'No panels exist yet.';
    return interaction.reply({
      content: `❌ Panel **${panelName}** not found.\n\nAvailable panels:\n${panelList}`,
      ephemeral: true
    });
  }

  const guild = interaction.guild;
  if (!guild) {
    return interaction.reply({ content: '❌ This command must be used in a server.', ephemeral: true });
  }

  const embed = new EmbedBuilder()
    .setTitle(`🎫 ${panel.name}`)
    .setColor(0x5865F2)
    .setDescription('If you wish to make a ticket, please click the button below.')
    .setFooter({ text: 'Community Organisation | Ticket System' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_create_${panel.id}`)
      .setLabel('🎫 Create Ticket')
      .setStyle(ButtonStyle.Primary)
  );

  await interaction.channel.send({ embeds: [embed], components: [row] });
  await interaction.reply({ content: `✅ Ticket panel **${panel.name}** sent to ${interaction.channel}`, ephemeral: true });
}

// ── Ticket creation button — ticket_create_<panelId> ─────────────────────────

export async function handleTicketButton(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith('ticket_create_')) return;

  await interaction.deferReply({ ephemeral: true });

  const panelId = parseInt(interaction.customId.replace('ticket_create_', ''));
  const { getTicketPanelById, getTicketChannelByUser, saveTicketChannel, incrementTicketCount } = await import('../utils/botDb.js');

  const panel = getTicketPanelById(panelId);
  if (!panel) {
    return interaction.editReply({ content: '❌ Ticket panel not found.' });
  }

  const guild = interaction.guild;
  if (!guild) {
    return interaction.editReply({ content: '❌ This command must be used in a server.' });
  }

  const userId = interaction.user.id;

  const existing = getTicketChannelByUser(panelId, userId);
  if (existing) {
    const existingChannel = guild.channels.cache.get(existing.discord_channel_id);
    if (existingChannel) {
      return interaction.editReply({ content: `❌ You already have an open ticket: ${existingChannel}` });
    }
  }

  const category = await guild.channels.fetch(panel.ticket_category_id).catch(() => null);
  if (!category || category.type !== 4) {
    return interaction.editReply({ content: '❌ Ticket category not found. Contact an administrator.' });
  }

  const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
  if (!member) {
    return interaction.editReply({ content: '❌ Could not find your guild member info.' });
  }

  const ticketNumber = incrementTicketCount(panelId);
  const username = member.user.username.replace(/\s+/g, '-').slice(0, 50);
  const channelName = `${username}-${ticketNumber}`.toLowerCase();

  try {
    const ticketChannel = await guild.channels.create({
      name: channelName,
      type: 0,
      parent: panel.ticket_category_id,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: ['ViewChannel'] },
        { id: panel.staff_role_id, allow: ['ViewChannel', 'ReadMessageHistory'] },
        { id: userId, allow: ['ViewChannel', 'ReadMessageHistory', 'SendMessages'] },
      ],
      reason: `Ticket created by ${member.user.tag} via ${panel.name} panel`
    });

    const pingRole = await guild.roles.fetch(panel.ping_role_id).catch(() => null);
    const staffRole = await guild.roles.fetch(panel.staff_role_id).catch(() => null);
    const notifyContent = pingRole ? `<@&${panel.ping_role_id}> — New ticket from ${member.user}` : `@here — New ticket from ${member.user}`;

    const ticketEmbed = new EmbedBuilder()
      .setTitle(`🎫 Ticket — ${panel.name} #${ticketNumber}`)
      .setColor(0x5865F2)
      .setDescription(panel.intro_message)
      .addFields(
        { name: 'Opened By', value: `${member.user} (<@${userId}>)`, inline: true },
        { name: 'Ticket #', value: String(ticketNumber), inline: true },
        { name: 'Status', value: '🟢 Open', inline: true },
      )
      .setFooter({ text: 'Community Organisation | Ticket System' })
      .setTimestamp();

    const ticketRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ticket_claim_${ticketChannel.id}`).setLabel('📌 Claim').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`ticket_close_${ticketChannel.id}`).setLabel('🔴 Close Ticket').setStyle(ButtonStyle.Danger),
    );

    const msg = await ticketChannel.send({ content: notifyContent, embeds: [ticketEmbed], components: [ticketRow] });

    saveTicketChannel({ panelId, discordChannelId: ticketChannel.id, userId });

    await interaction.editReply({ content: `✅ Your ticket has been created: ${ticketChannel}` });

    await logAction(interaction.client, {
      action: '🎫 Ticket Created',
      target: { discordId: interaction.user.id, name: interaction.user.username },
      moderator: null,
      color: 0x22C55E,
      description: `Ticket created: ${ticketChannel}`,
      guildId: interaction.guildId
    });
  } catch (err) {
    console.error('[Ticket Create] Error:', err.message);
    await interaction.editReply({ content: `❌ Failed to create ticket: ${err.message}` });
  }
}

// ── Ticket channel buttons — claim / close ─────────────────────────────────

export async function handleTicketChannelButton(interaction) {
  if (!interaction.isButton()) return;
  const customId = interaction.customId;

  if (!customId.startsWith('ticket_claim_') && !customId.startsWith('ticket_close_')) return;

  await interaction.deferReply({ ephemeral: true });

  const { isSuperuser } = await import('../utils/permissions.js');
  const { getTicketChannelByChannelId, claimTicket, closeTicket, getTicketPanelById } = await import('../utils/botDb.js');

  const isClaim = customId.startsWith('ticket_claim_');
  const channelId = customId.replace('ticket_claim_', '').replace('ticket_close_', '');
  const guild = interaction.guild;

  if (!guild) return interaction.editReply({ content: '❌ Not in a server.' });

  const ticket = getTicketChannelByChannelId(channelId);
  if (!ticket) return interaction.editReply({ content: '❌ Ticket not found in database.' });

  if (isClaim) {
    const { getUserByDiscordId } = await import('../db.js');
    const auth = await canRunCommand(interaction.user.id, 5);
    if (!auth.allowed) return interaction.editReply({ content: `❌ ${auth.reason}` });

    claimTicket(channelId, interaction.user.id);

    // Deny the ticket opener messaging ability, allow claimer full access
    const ticketChannel = guild.channels.cache.get(channelId);
    if (ticketChannel) {
      await ticketChannel.permissionOverwrites.edit(ticket.user_id, { SendMessages: false }).catch(() => {});
      await ticketChannel.permissionOverwrites.edit(interaction.user.id, { SendMessages: true, ViewChannel: true, ReadMessageHistory: true }).catch(() => {});
    }

    const panel = getTicketPanelById(ticket.panel_id);
    const updatedEmbed = new EmbedBuilder()
      .setTitle(`🎫 Ticket — ${panel?.name || 'Ticket'}`)
      .setColor(0xf59e0b)
      .setDescription(panel?.intro_message || '')
      .addFields(
        { name: 'Opened By', value: `<@${ticket.user_id}>`, inline: true },
        { name: 'Claimed By', value: `${interaction.user} (<@${interaction.user.id}>)`, inline: true },
        { name: 'Status', value: '🟡 Claimed', inline: true },
      )
      .setFooter({ text: 'Community Organisation | Ticket System' })
      .setTimestamp();

    const claimerRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ticket_claim_${channelId}`).setLabel(`📌 Claimed by ${interaction.user.username}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId(`ticket_close_${channelId}`).setLabel('🔴 Close Ticket').setStyle(ButtonStyle.Danger),
    );

    if (ticketChannel) {
      const msgs = await ticketChannel.messages.fetch({ limit: 1 });
      if (msgs.size > 0) {
        const lastMsg = msgs.first();
        if (lastMsg.author.bot && lastMsg.embeds.length > 0) {
          await lastMsg.edit({ embeds: [updatedEmbed], components: [claimerRow] }).catch(() => {});
        }
      }
    }

    await interaction.editReply({ content: `✅ You have claimed this ticket. The user can no longer message this channel.` });

    await logAction(interaction.client, {
      action: '📌 Ticket Claimed',
      target: { discordId: ticket.user_id, name: ticket.user_id },
      moderator: { discordId: interaction.user.id, name: interaction.user.username },
      color: 0xF59E0B,
      description: `Ticket claimed by <@${interaction.user.id}>`,
      guildId: interaction.guildId
    });
  } else {
    // Close
    const auth = await canRunCommand(interaction.user.id, 7);
    const isClaimer = ticket.claimed_by === interaction.user.id;
    if (!auth.allowed && !isClaimer) return interaction.editReply({ content: `❌ ${auth.reason}` });

    const panel = getTicketPanelById(ticket.panel_id);
    const ticketChannel = guild.channels.cache.get(channelId);

    const transcriptUrl = await closeTicketWithTranscript(
      ticket, ticketChannel, panel, interaction, closeTicket
    );

    const transcriptNote = transcriptUrl ? `\n📄 Transcript: ${transcriptUrl}` : '';
    await interaction.editReply({ content: `✅ Ticket has been closed.${transcriptNote}` });
  }
}
