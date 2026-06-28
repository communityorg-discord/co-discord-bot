// COMMAND_PERMISSION_FALLBACK: superuser_only
// /loa-panel — (re)post the standing "How to request an LOA" info panel into the
// current channel and set it as THE LOA channel (where requests are posted).
import { SlashCommandBuilder } from 'discord.js';
import { isSuperuser } from '../utils/permissions.js';
import { postPanelTo } from '../services/loa.js';
import { E } from '../lib/emoji.js';

export const data = new SlashCommandBuilder()
  .setName('loa-panel')
  .setDescription('Post the LOA info panel here and set this as the LOA channel (superusers)');

export async function execute(interaction) {
  if (!isSuperuser(interaction.user.id)) return interaction.reply({ content: `${E.cross} Superusers only.`, ephemeral: true });
  await interaction.deferReply({ ephemeral: true });
  try {
    await postPanelTo(interaction.channel);
    return interaction.editReply({ content: `${E.check} LOA panel posted here. New LOA requests will now show in this channel.` });
  } catch (e) {
    return interaction.editReply({ content: `${E.cross} Couldn't post the panel: ${e.message}` });
  }
}
