// COMMAND_PERMISSION_FALLBACK: everyone
// /loa — request a Leave of Absence. Opens the same modal as the #loa panel
// button. The request posts to #loa for the FSA to approve/decline.
import { SlashCommandBuilder } from 'discord.js';
import { openRequestModal } from '../services/loa.js';

export const data = new SlashCommandBuilder()
  .setName('loa')
  .setDescription('Request a Leave of Absence (away from the network for a while)');

export async function execute(interaction) {
  return openRequestModal(interaction);
}
