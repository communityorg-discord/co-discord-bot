import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canRunCommand } from '../utils/permissions.js';
import { saveTicketPanel, getTicketPanelByName } from '../utils/botDb.js';

export const data = new SlashCommandBuilder()
  .setName('create-ticket-panel')
  .setDescription('Create a new ticket panel')
  .addStringOption(opt => opt.setName('name').setDescription('Panel name (e.g. General Support)').setRequired(true).setMaxLength(100))
  .addStringOption(opt => opt.setName('intro_message').setDescription('Message shown when a ticket is created').setRequired(true).setMaxLength(1000))
  .addRoleOption(opt => opt.setName('staff_role').setDescription('Role that gets access to tickets').setRequired(true))
  .addRoleOption(opt => opt.setName('ping_role').setDescription('Role to ping when a ticket is created').setRequired(true))
  .addChannelOption(opt => opt.setName('category').setDescription('Category where ticket channels are created').setRequired(true));

export async function execute(interaction) {
  const auth = await canRunCommand(interaction.user.id, 7);
  if (!auth.allowed) {
    return interaction.reply({ content: `❌ ${auth.reason}`, ephemeral: true });
  }

  const panelName = interaction.options.getString('name').trim();
  const introMessage = interaction.options.getString('intro_message').trim();
  const staffRole = interaction.options.getRole('staff_role');
  const pingRole = interaction.options.getRole('ping_role');
  const category = interaction.options.getChannel('category');

  if (category.type !== 4) {
    return interaction.reply({ content: '❌ The category must be a text channel category.', ephemeral: true });
  }

  const existing = getTicketPanelByName(panelName);
  if (existing) {
    return interaction.reply({ content: `❌ A panel named **${panelName}** already exists. Choose a different name.`, ephemeral: true });
  }

  saveTicketPanel({
    name: panelName,
    introMessage,
    staffRoleId: staffRole.id,
    pingRoleId: pingRole.id,
    ticketCategoryId: category.id,
    createdBy: interaction.user.id
  });

  const embed = new EmbedBuilder()
    .setTitle('✅ Ticket Panel Created')
    .setColor(0x22c55e)
    .addFields(
      { name: 'Panel Name', value: panelName, inline: true },
      { name: 'Staff Role', value: `<@&${staffRole.id}>`, inline: true },
      { name: 'Ping Role', value: `<@&${pingRole.id}>`, inline: true },
      { name: 'Category', value: category.name, inline: true },
      { name: 'Intro Message', value: introMessage.slice(0, 1024), inline: false },
    )
    .setFooter({ text: `Created by ${interaction.user.username} | Use /ticket-panel-send to deploy` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
