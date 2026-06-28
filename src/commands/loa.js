// COMMAND_PERMISSION_FALLBACK: everyone
// /loa — request a Leave of Absence in plain English. With no text it opens the
// AI box (same as the #loa panel button); with `request:` text it's parsed
// straight away ("/loa request: I need an LOA next week for exams").
import { SlashCommandBuilder } from 'discord.js';
import { openRequestModal, handleAiText } from '../services/loa.js';

export const data = new SlashCommandBuilder()
  .setName('loa')
  .setDescription('Request a Leave of Absence — just describe it (e.g. "off next week for exams")')
  .addStringOption(opt => opt.setName('request')
    .setDescription('Describe your leave in your own words (optional — leave blank to open the box)')
    .setRequired(false));

export async function execute(interaction) {
  const text = (interaction.options.getString('request') || '').trim();
  if (text) return handleAiText(interaction, text);
  return openRequestModal(interaction);
}
