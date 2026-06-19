// COMMAND_PERMISSION_FALLBACK: everyone
// /panel — the USGRP Utilities hub. Opens an ephemeral panel with a "Go to…" menu
// that groups the less-used commands into sections (gov-bot style). The command
// logic lives in src/interactions/coPanel.js.
import { SlashCommandBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { buildHome } from '../interactions/coPanel.js';
import { E } from '../lib/emoji.js';

export const data = new SlashCommandBuilder()
  .setName('panel')
  .setDescription('Open the USGRP Utilities hub — tickets, logs, utilities, info and more');

export async function execute(interaction) {
  const perm = await canUseCommand('panel', interaction);
  if (!perm.allowed) return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });
  return interaction.reply(buildHome());
}
