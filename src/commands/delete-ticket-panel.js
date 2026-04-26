// COMMAND_PERMISSION_FALLBACK: superuser_only
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { getTicketPanelById, getTicketPanelByName, deleteTicketPanel, getAllTicketPanels } from '../utils/botDb.js';

export const data = new SlashCommandBuilder()
  .setName('ticket-panel-delete')
  .setDescription('Delete a ticket panel (superusers only)')
  .addStringOption(opt =>
    opt.setName('name')
      .setDescription('Exact name of the panel to delete')
      .setRequired(true)
      .setAutocomplete(true)
  );

export async function execute(interaction) {
  const perm = await canUseCommand('ticket-panel-delete', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });
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
