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
    .setDescription(`If you wish to make a ticket, please click the button below.`)
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

// ── Button handler — ticket_create_<panelId> ─────────────────────────────────

export async function handleTicketButton(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith('ticket_create_')) return;

  const panelId = parseInt(interaction.customId.replace('ticket_create_', ''));
  const { getTicketPanelById, getTicketChannelByUser, saveTicketChannel, incrementTicketCount } = await import('../utils/botDb.js');

  const panel = getTicketPanelById(panelId);
  if (!panel) {
    return interaction.reply({ content: '❌ Ticket panel not found.', ephemeral: true });
  }

  const guild = interaction.guild;
  if (!guild) {
    return interaction.reply({ content: '❌ This command must be used in a server.', ephemeral: true });
  }

  const userId = interaction.user.id;

  // Check if user already has an open ticket for this panel
  const existing = getTicketChannelByUser(panelId, userId);
  if (existing) {
    const existingChannel = guild.channels.cache.get(existing.discord_channel_id);
    if (existingChannel) {
      return interaction.reply({
        content: `❌ You already have an open ticket: ${existingChannel}`,
        ephemeral: true
      });
    }
  }

  const category = await guild.channels.fetch(panel.ticket_category_id).catch(() => null);
  if (!category || category.type !== 4) {
    return interaction.reply({ content: '❌ Ticket category not found. Contact an administrator.', ephemeral: true });
  }

  const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
  if (!member) {
    return interaction.reply({ content: '❌ Could not find your guild member info.', ephemeral: true });
  }

  // Get ticket number and increment counter
  const ticketNumber = incrementTicketCount(panelId);
  const username = member.user.username.replace(/\s+/g, '-').slice(0, 50);
  const channelName = `${username}-${ticketNumber}`.toLowerCase();

  try {
    const ticketChannel = await guild.channels.create({
      name: channelName,
      type: 0, // TEXT_CHANNEL
      parent: panel.ticket_category_id,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: ['ViewChannel'] },
        { id: panel.staff_role_id, allow: ['ViewChannel', 'ReadMessageHistory'] },
        { id: userId, allow: ['ViewChannel', 'ReadMessageHistory', 'SendMessages'] },
      ],
      reason: `Ticket created by ${member.user.tag} via ${panel.name} panel`
    });

    // Notify ping role
    const pingRole = await guild.roles.fetch(panel.ping_role_id).catch(() => null);
    const staffRole = await guild.roles.fetch(panel.staff_role_id).catch(() => null);

    const notifyContent = pingRole ? `<@&${panel.ping_role_id}> — New ticket from ${member.user}` : `@here — New ticket from ${member.user}`;

    const ticketEmbed = new EmbedBuilder()
      .setTitle(`🎫 Ticket — ${panel.name}`)
      .setColor(0x5865F2)
      .setDescription(panel.intro_message)
      .addFields(
        { name: 'Opened By', value: `${member.user} (<@${userId}>)`, inline: true },
        { name: 'Ticket #', value: String(ticketNumber), inline: true },
        { name: 'Staff Role', value: staffRole ? `<@&${panel.staff_role_id}>` : 'Unknown', inline: true },
      )
      .setFooter({ text: 'Community Organisation | Ticket System' })
      .setTimestamp();

    await ticketChannel.send({ content: notifyContent, embeds: [ticketEmbed] });

    // Save ticket to DB
    saveTicketChannel({ panelId, discordChannelId: ticketChannel.id, userId });

    await interaction.reply({
      content: `✅ Your ticket has been created: ${ticketChannel}`,
      ephemeral: true
    });
  } catch (err) {
    console.error('[Ticket Create] Error:', err.message);
    await interaction.reply({
      content: `❌ Failed to create ticket: ${err.message}`,
      ephemeral: true
    });
  }
}
