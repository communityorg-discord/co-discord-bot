// COMMAND_PERMISSION_FALLBACK: superuser_only
// One /office command → an interactive, menu-and-button panel (officePanel.js).
import { SlashCommandBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { buildHome } from '../interactions/officePanel.js';
import { E } from '../lib/emoji.js';

export const data = new SlashCommandBuilder()
  .setName('office')
  .setDescription('Manage office voice channels — access, keys and the waiting room (Superuser only)');

export async function execute(interaction) {
  const perm = await canUseCommand('office', interaction);
  if (!perm.allowed) return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });
  if (!interaction.guild) return interaction.reply({ content: `${E.cross} Use this in a server.`, ephemeral: true });
  return interaction.reply(buildHome(interaction.guild));
}
