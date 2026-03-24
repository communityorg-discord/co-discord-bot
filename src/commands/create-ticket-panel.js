import { SlashCommandBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { canRunCommand } from '../utils/permissions.js';
import { saveTicketPanel, getTicketPanelByName } from '../utils/botDb.js';

export const data = new SlashCommandBuilder()
  .setName('create-ticket-panel')
  .setDescription('Create a new ticket panel (opens a setup modal)');

export async function execute(interaction) {
  console.error('[create-ticket-panel] 1 - user:', interaction.user.id);
  const auth = await canRunCommand(interaction.user.id, 7);
  console.error('[create-ticket-panel] 2 - auth result:', JSON.stringify(auth));
  if (!auth.allowed) {
    return interaction.reply({ content: `❌ ${auth.reason}`, ephemeral: true });
  }
  console.error('[create-ticket-panel] 3 - building modal');

  const modal = new ModalBuilder()
    .setCustomId('create_ticket_panel_modal')
    .setTitle('Create Ticket Panel')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('panel_name')
          .setLabel('Panel Name')
          .setPlaceholder('e.g. General Support')
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
          .setLabel('Staff Role ID')
          .setPlaceholder('Discord role ID')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(30)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('ping_role_id')
          .setLabel('Role ID to Ping')
          .setPlaceholder('Discord role ID')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(30)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('category_id')
          .setLabel('Category ID')
          .setPlaceholder('Discord category ID')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(30)
      )
    );

  console.error('[create-ticket-panel] 4 - showing modal');
  await interaction.showModal(modal);
  console.error('[create-ticket-panel] 5 - modal shown');
}

// Handle modal submit — imported and called from index.js
export async function handleModal(interaction) {
  if (interaction.customId !== 'create_ticket_panel_modal') return;
  await interaction.deferReply({ ephemeral: true });

  const panelName = interaction.fields.getTextInputValue('panel_name').trim();
  const introMessage = interaction.fields.getTextInputValue('intro_message').trim();
  const staffRoleId = interaction.fields.getTextInputValue('staff_role_id').trim();
  const pingRoleId = interaction.fields.getTextInputValue('ping_role_id').trim();
  const categoryId = interaction.fields.getTextInputValue('category_id').trim();

  if (!/^\d+$/.test(staffRoleId) || !/^\d+$/.test(pingRoleId) || !/^\d+$/.test(categoryId)) {
    return interaction.editReply({ content: '❌ All Role and Category IDs must be numeric Discord snowflakes.' });
  }

  const existing = getTicketPanelByName(panelName);
  if (existing) {
    return interaction.editReply({ content: `❌ A panel named **${panelName}** already exists. Choose a different name.` });
  }

  const guild = interaction.guild;
  if (!guild) return interaction.editReply({ content: '❌ This command must be used in a server.' });

  const staffRole = await guild.roles.fetch(staffRoleId).catch(() => null);
  const pingRole = await guild.roles.fetch(pingRoleId).catch(() => null);
  const category = await guild.channels.fetch(categoryId).catch(() => null);

  if (!staffRole) return interaction.editReply({ content: `❌ Staff role not found: <@&${staffRoleId}>` });
  if (!pingRole) return interaction.editReply({ content: `❌ Ping role not found: <@&${pingRoleId}>` });
  if (!category || category.type !== 4) return interaction.editReply({ content: `❌ Category not found: ${categoryId}` });

  saveTicketPanel({ name: panelName, introMessage, staffRoleId, pingRoleId, ticketCategoryId: categoryId, createdBy: interaction.user.id });

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

  await interaction.editReply({ embeds: [embed] });
}
