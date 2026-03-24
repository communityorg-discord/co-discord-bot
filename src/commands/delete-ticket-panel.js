import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canRunCommand } from '../utils/permissions.js';
import { getTicketPanelById, getTicketPanelByName, deleteTicketPanel, getAllTicketPanels } from '../utils/botDb.js';

export const data = new SlashCommandBuilder()
  .setName('delete-ticket-panel')
  .setDescription('Delete a ticket panel (superusers only)')
  .addStringOption(opt =>
    opt.setName('name')
      .setDescription('Exact name of the panel to delete')
      .setRequired(true)
      .setAutocomplete(true)
  );

export async function execute(interaction) {
  const auth = await canRunCommand(interaction.user.id, 99);
  if (!auth.allowed) {
    return interaction.reply({ content: `❌ ${auth.reason}`, ephemeral: true });
  }

  const panelName = interaction.options.getString('name');
  const panel = getTicketPanelByName(panelName);

  if (!panel) {
    const allPanels = getAllTicketPanels();
    const panelList = allPanels.length
      ? allPanels.map(p => `• **${p.name}**`).join('\n')
      : 'No panels exist.';
    return interaction.reply({
      content: `❌ Panel **${panelName}** not found.\n\nAvailable panels:\n${panelList}`,
      ephemeral: true
    });
  }

  deleteTicketPanel(panel.id);

  await interaction.reply({
    content: `✅ Panel **${panel.name}** has been deleted.`,
    ephemeral: true
  });
}
