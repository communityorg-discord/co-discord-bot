import { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { canRunCommand } from '../utils/permissions.js';
import { logAction } from '../utils/logger.js';
import { getTicketChannelByChannelId, closeTicket, getTicketPanelById } from '../utils/botDb.js';
import { closeTicketWithTranscript } from '../utils/ticketTranscript.js';

export const data = new SlashCommandBuilder()
  .setName('ticket-options')
  .setDescription('Show ticket management options (must be used in a ticket channel)');

export async function execute(interaction) {
  try {
  const auth = await canRunCommand(interaction.user.id, 5);
  if (!auth.allowed) {
    return interaction.reply({ content: `❌ ${auth.reason}`, ephemeral: true });
  }

  const channelId = interaction.channel.id;
  const ticket = getTicketChannelByChannelId(channelId);

  if (!ticket) {
    return interaction.reply({ content: '❌ This channel is not registered as a ticket.', ephemeral: true });
  }

  const guild = interaction.guild;
  const member = guild.members.cache.get(interaction.user.id) || await guild.members.fetch(interaction.user.id).catch(() => null);
  const isClaimer = ticket.claimed_by === interaction.user.id;
  const isSuper = auth.reason === 'Superuser';

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticketopts_close_${channelId}`)
      .setLabel('🔴 Close')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(ticket.status === 'closed'),
    new ButtonBuilder()
      .setCustomId(`ticketopts_delete_${channelId}`)
      .setLabel('🗑️ Delete Channel')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(ticket.status !== 'closed'),
    new ButtonBuilder()
      .setCustomId(`ticketopts_rename_${channelId}`)
      .setLabel('✏️ Rename')
      .setStyle(ButtonStyle.Secondary),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticketopts_unclaim_${channelId}`)
      .setLabel('🔓 Unclaim')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!isClaimer && !isSuper),
    new ButtonBuilder()
      .setCustomId(`ticketopts_reopen_${channelId}`)
      .setLabel('🔓 Reopen')
      .setStyle(ButtonStyle.Success)
      .setDisabled(ticket.status !== 'closed'),
  );

  const embed = new EmbedBuilder()
    .setTitle('🎫 Ticket Options')
    .setColor(0x5865F2)
    .setDescription('Select an action to manage this ticket.')
    .addFields(
      { name: 'Opened By', value: `<@${ticket.user_id}>`, inline: true },
      { name: 'Claimed By', value: ticket.claimed_by ? `<@${ticket.claimed_by}>` : 'Nobody', inline: true },
    )
    .setFooter({ text: 'Community Organisation | Ticket System' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], components: [row1, row2], ephemeral: true });
  } catch (err) {
    console.error('[ticket-options] Error:', err);
    const msg = { content: 'An error occurred. Please try again.', flags: 64 };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg);
    } else {
      await interaction.reply(msg);
    }
  }
}

// ── Button handlers for ticket-options ─────────────────────────────────────

export async function handleTicketOptionsButton(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith('ticketopts_')) return;

  const { isSuperuser } = await import('../utils/permissions.js');
  const { getTicketChannelByChannelId, reopenTicket, unclaimTicket } = await import('../utils/botDb.js');

  const parts = interaction.customId.split('_');
  const action = parts[1]; // close, delete, unclaim, rename, reopen
  const channelId = parts.slice(2).join('_');
  const guild = interaction.guild;

  if (!guild) return interaction.reply({ content: '❌ Not in a server.', flags: 64 });

  const ticket = getTicketChannelByChannelId(channelId);
  if (!ticket) return interaction.reply({ content: '❌ Ticket not found in database.', flags: 64 });

  const isClaimer = ticket.claimed_by === interaction.user.id;
  const isSuper = await isSuperuser(interaction.user.id);
  const auth = await canRunCommand(interaction.user.id, 5);

  // rename uses showModal() which auto-acknowledges — do NOT defer
  if (action === 'rename') {
    const modal = new ModalBuilder()
      .setCustomId(`ticketopts_renamemodal_${channelId}`)
      .setTitle('Rename Ticket Channel')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('new_name')
            .setLabel('New channel name')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100)
        )
      );
    return interaction.showModal(modal);
  }

  // All other actions need a deferred reply
  await interaction.deferReply({ ephemeral: true });

  if (action === 'close') {
    if (!auth.allowed && !isClaimer) return interaction.editReply({ content: `❌ ${auth.reason}` });
    const panel = getTicketPanelById(ticket.panel_id);
    const ticketChannel = guild.channels.cache.get(channelId);
    const transcriptUrl = await closeTicketWithTranscript(ticket, ticketChannel, panel, interaction, closeTicket);
    const transcriptNote = transcriptUrl ? `\n📄 Transcript: ${transcriptUrl}` : '';
    return interaction.editReply({ content: `🔴 Ticket closed.${transcriptNote}` });
  }

  if (action === 'delete') {
    if (!auth.allowed) return interaction.editReply({ content: `❌ ${auth.reason}` });
    const ticketChannel = guild.channels.cache.get(channelId);
    if (ticketChannel) await ticketChannel.delete('Ticket deleted by staff').catch(() => {});
    return interaction.editReply({ content: '🗑️ Ticket channel deleted.' });
  }

  if (action === 'unclaim') {
    if (!auth.allowed && !isClaimer) return interaction.editReply({ content: `❌ ${auth.reason}` });
    unclaimTicket(channelId);
    const ticketChannel = guild.channels.cache.get(channelId);
    if (ticketChannel) {
      await ticketChannel.permissionOverwrites.edit(interaction.user.id, { SendMessages: null }).catch(() => {});
      await ticketChannel.permissionOverwrites.edit(ticket.user_id, { SendMessages: true }).catch(() => {});
    }
    return interaction.editReply({ content: '🔓 Ticket unclaimed. User can now reply again.' });
  }

  if (action === 'reopen') {
    if (!auth.allowed) return interaction.editReply({ content: `❌ ${auth.reason}` });
    reopenTicket(channelId);
    const ticketChannel = guild.channels.cache.get(channelId);
    if (ticketChannel) {
      await ticketChannel.permissionOverwrites.edit(ticket.user_id, { SendMessages: true }).catch(() => {});
      if (ticket.claimed_by) await ticketChannel.permissionOverwrites.edit(ticket.claimed_by, { SendMessages: true }).catch(() => {});
      const nameParts = ticketChannel.name.split('-');
      const newName = nameParts.filter(p => !p.startsWith('closed')).join('-').replace(/^closed-/, '');
      if (newName && newName !== ticketChannel.name) {
        await ticketChannel.setName(newName).catch(() => {});
      }
    }
    return interaction.editReply({ content: '🔓 Ticket reopened.' });
  }
}

// Modal handler for rename
export async function handleTicketOptionsModal(interaction) {
  if (!interaction.customId.startsWith('ticketopts_renamemodal_')) return;
  await interaction.deferReply({ ephemeral: true });

  const channelId = interaction.customId.replace('ticketopts_renamemodal_', '');
  const newName = interaction.fields.getTextInputValue('new_name').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 100);

  const guild = interaction.guild;
  if (!guild) return interaction.editReply({ content: '❌ Not in a server.' });

  const ticketChannel = guild.channels.cache.get(channelId);
  if (ticketChannel) {
    await ticketChannel.setName(newName).catch(() => {});
  }

  await interaction.editReply({ content: `✏️ Channel renamed to \`${newName}\`.` });

    await logAction(interaction.client, {
      action: '✏️ Ticket Renamed',
      target: { discordId: interaction.user.id, name: interaction.user.username },
      moderator: { discordId: interaction.user.id, name: interaction.user.username },
      color: 0x6366F1,
      description: `Ticket renamed to \`${newName}\``,
      guildId: interaction.guildId
    });
}
