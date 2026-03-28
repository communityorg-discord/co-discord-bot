import { SlashCommandBuilder } from 'discord.js';
import { isSuperuser } from '../utils/permissions.js';
import {
  getMasterPanel, saveMasterPanel, getOfficesByGuild,
  buildMasterEmbed, buildMasterButtons,
  buildOfficeEmbed, buildOfficeButtons
} from '../services/officeManager.js';

export const data = new SlashCommandBuilder()
  .setName('office-setup')
  .setDescription('Post the office management master panel in this channel (Superuser only)');

export async function execute(interaction) {
  await interaction.deferReply();

  if (!isSuperuser(interaction.user.id)) {
    interaction._commandFailed = 'Insufficient permissions';
    return interaction.editReply({ content: '❌ This command requires Superuser access.' });
  }

  const guild = interaction.guild;
  if (!guild) {
    return interaction.editReply({ content: '❌ This command must be used in a server.' });
  }

  const channel = interaction.channel;

  // Delete old master panel if exists
  const existing = getMasterPanel(guild.id);
  if (existing) {
    try {
      const oldChannel = guild.channels.cache.get(existing.channel_id);
      if (oldChannel) {
        const oldMsg = await oldChannel.messages.fetch(existing.message_id).catch(() => null);
        if (oldMsg) await oldMsg.delete().catch(() => {});
      }
    } catch {}
  }

  const offices = getOfficesByGuild(guild.id);

  // Post master panel
  const masterMsg = await channel.send({
    embeds: [buildMasterEmbed(offices, guild)],
    components: [buildMasterButtons()]
  });

  saveMasterPanel(guild.id, channel.id, masterMsg.id);

  // Post per-office embeds for any existing offices
  for (const office of offices) {
    const officeMsg = await channel.send({
      embeds: [buildOfficeEmbed(office, guild)],
      components: [buildOfficeButtons(office.id)]
    });
    // Update stored panel message ID
    const { updateOffice } = await import('../services/officeManager.js');
    updateOffice(office.id, { panel_message_id: officeMsg.id });
  }

  await interaction.editReply({ content: '✅ Office management panel posted successfully.' });
}
