import { SlashCommandBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { canRunCommand } from '../utils/permissions.js';
import { saveTicketPanel, getTicketPanelByName } from '../utils/botDb.js';

export const data = new SlashCommandBuilder()
  .setName('create-ticket-panel')
  .setDescription('Create a new ticket panel (opens a setup modal)');

export async function execute(interaction) {
  if (!await canRunCommand(interaction.user.id, 7)) {
    return interaction.reply({ content: '❌ You do not have permission to create ticket panels.', ephemeral: true });
  }

  const modal = new ModalBuilder()
    .setCustomId('create_ticket_panel_modal')
    .setTitle('Create Ticket Panel')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('panel_name')
          .setLabel('Panel Name')
          .setPlaceholder('e.g. General Support, Appeals, HR')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('intro_message')
          .setLabel('Intro Message')
          .setPlaceholder('Message shown when a ticket is created')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('staff_role_id')
          .setLabel('Staff Role ID (who gets access to tickets)')
          .setPlaceholder('Discord role ID — right-click role > Copy ID')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(30)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('ping_role_id')
          .setLabel('Role ID to ping when ticket is created')
          .setPlaceholder('Discord role ID to notify staff')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(30)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('category_id')
          .setLabel('Ticket Category ID (where channels are created)')
          .setPlaceholder('Discord category ID — right-click category > Copy ID')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(30)
      )
    );

  await interaction.showModal(modal);
}

// Handle modal submit — imported and called from index.js
export async function handleModal(interaction) {
  if (interaction.customId !== 'create_ticket_panel_modal') return;

  const panelName = interaction.fields.getTextInputValue('panel_name').trim();
  const introMessage = interaction.fields.getTextInputValue('intro_message').trim();
  const staffRoleId = interaction.fields.getTextInputValue('staff_role_id').trim();
  const pingRoleId = interaction.fields.getTextInputValue('ping_role_id').trim();
  const categoryId = interaction.fields.getTextInputValue('category_id').trim();

  // Validate IDs are numeric
  if (!/^\d+$/.test(staffRoleId) || !/^\d+$/.test(pingRoleId) || !/^\d+$/.test(categoryId)) {
    return interaction.reply({ content: '❌ All Role and Category IDs must be numeric Discord snowflakes.', ephemeral: true });
  }

  // Check for duplicate name
  const existing = getTicketPanelByName(panelName);
  if (existing) {
    return interaction.reply({ content: `❌ A panel named **${panelName}** already exists. Choose a different name.`, ephemeral: true });
  }

  // Validate roles and category exist
  const guild = interaction.guild;
  if (!guild) {
    return interaction.reply({ content: '❌ This command must be used in a server.', ephemeral: true });
  }

  const staffRole = await guild.roles.fetch(staffRoleId).catch(() => null);
  const pingRole = await guild.roles.fetch(pingRoleId).catch(() => null);
  const category = await guild.channels.fetch(categoryId).catch(() => null);

  if (!staffRole) {
    return interaction.reply({ content: `❌ Staff role not found. Check <@&${staffRoleId}> is a valid role.`, ephemeral: true });
  }
  if (!pingRole) {
    return interaction.reply({ content: `❌ Ping role not found. Check <@&${pingRoleId}> is a valid role.`, ephemeral: true });
  }
  if (!category || category.type !== 4) { // 4 = GUILD_CATEGORY
    return interaction.reply({ content: `❌ Category not found. Check that ${categoryId} is a valid category channel.`, ephemeral: true });
  }

  saveTicketPanel({
    name: panelName,
    introMessage,
    staffRoleId,
    pingRoleId,
    ticketCategoryId: categoryId,
    createdBy: interaction.user.id
  });

  const embed = new EmbedBuilder()
    .setTitle('✅ Ticket Panel Created')
    .setColor(0x22c55e)
    .addFields(
      { name: 'Panel Name', value: panelName, inline: true },
      { name: 'Staff Role', value: `<@&${staffRoleId}>`, inline: true },
      { name: 'Ping Role', value: `<@&${pingRoleId}>`, inline: true },
      { name: 'Category', value: `<#${categoryId}>`, inline: true },
      { name: 'Intro Message', value: introMessage.slice(0, 1024), inline: false },
    )
    .setFooter({ text: `Created by ${interaction.user.username} | Use /ticket-panel-send to deploy` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
