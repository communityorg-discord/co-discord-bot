import { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { canRunCommand } from '../utils/permissions.js';
import { getTicketPanelByName, getAllTicketPanels } from '../utils/botDb.js';

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
  } else {
    // Close
    const auth = await canRunCommand(interaction.user.id, 7);
    const isClaimer = ticket.claimed_by === interaction.user.id;
    if (!auth.allowed && !isClaimer) return interaction.editReply({ content: `❌ ${auth.reason}` });

    const ticketChannel = guild.channels.cache.get(channelId);
    if (ticketChannel) {
      const closeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_placeholder').setLabel('🔴 Closed').setStyle(ButtonStyle.Danger).setDisabled(true),
      );
      const msgs = await ticketChannel.messages.fetch({ limit: 1 });
      if (msgs.size > 0) {
        const lastMsg = msgs.first();
        if (lastMsg.author.bot && lastMsg.embeds.length > 0) {
          const closedEmbed = EmbedBuilder.from(lastMsg.embeds[0]).setColor(0x6b7280).spliceFields(2, 1, { name: 'Status', value: '🔴 Closed', inline: true });
          await lastMsg.edit({ embeds: [closedEmbed], components: [closeRow] }).catch(() => {});
        }
      }
      await ticketChannel.setName(`closed-${ticketChannel.name}`).catch(() => {});
      await ticketChannel.permissionOverwrites.delete(ticket.user_id).catch(() => {});
      if (ticket.claimed_by) {
        await ticketChannel.permissionOverwrites.delete(ticket.claimed_by).catch(() => {});
      }
    }

    closeTicket(channelId);
    await interaction.editReply({ content: `✅ Ticket has been closed and removed from the database.` });
  }
}
