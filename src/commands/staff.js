import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getUserByDiscordId, getStaffByName } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('staff')
  .setDescription('Look up a staff member')
  .addStringOption(opt => opt.setName('name').setDescription('Name or username to search').setRequired(true));

export async function execute(interaction) {
  const requestingUser = getUserByDiscordId(interaction.user.id);
  if (!requestingUser) {
    return interaction.reply({ content: '❌ Your Discord account is not linked to a CO Staff Portal account.', ephemeral: true });
  }

  const query = interaction.options.getString('name');
  const results = getStaffByName(query);

  if (!results.length) {
    return interaction.reply({ content: `❌ No staff found matching "${query}"`, ephemeral: true });
  }

  const embeds = results.map(s => new EmbedBuilder()
    .setTitle(`👤 ${s.display_name || s.full_name || s.username}`)
    .setColor(0x5865F2)
    .addFields(
      { name: 'Position', value: s.position || 'N/A', inline: true },
      { name: 'Department', value: s.department || 'N/A', inline: true },
      { name: 'Discord', value: s.discord_id ? `<@${s.discord_id}>` : 'Not linked', inline: true }
    )
    .setFooter({ text: 'Community Organisation | Staff Directory' })
  );

  await interaction.reply({ embeds: embeds.slice(0, 3) });
}
