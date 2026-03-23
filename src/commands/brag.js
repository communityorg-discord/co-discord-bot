import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getUserByDiscordId, getBragStatus } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('brag')
  .setDescription('Check your current BRAG activity status');

export async function execute(interaction) {
  const user = getUserByDiscordId(interaction.user.id);
  if (!user) {
    return interaction.reply({ content: '❌ Your Discord account is not linked to a CO Staff Portal account. Contact DMSPC.', ephemeral: true });
  }

  const brag = getBragStatus(user.id);
  
  const gradeEmoji = (g) => ({ green: '🟢', amber: '🟡', red: '🔴', black: '⚫' }[g?.toLowerCase()] || '⚪');
  const gradeColor = (g) => ({ green: 0x22C55E, amber: 0xF59E0B, red: 0xEF4444, black: 0x1F2937 }[g?.toLowerCase()] || 0x5865F2);
  
  const overallGrade = brag?.messages_grade || brag?.tasks_grade || 'unknown';

  const embed = new EmbedBuilder()
    .setTitle(`${gradeEmoji(overallGrade)} BRAG Status — ${user.display_name || user.full_name}`)
    .setColor(gradeColor(overallGrade))
    .addFields(
      { name: 'Position', value: user.position || 'N/A', inline: true },
      { name: 'Department', value: user.department || 'N/A', inline: true },
      { name: 'Messages Grade', value: (brag?.messages_grade || 'No data').toUpperCase(), inline: true },
      { name: 'Tasks Grade', value: (brag?.tasks_grade || 'No data').toUpperCase(), inline: true },
      { name: 'Tasks Rating', value: brag?.tasks_self_rating || 'N/A', inline: true },
      { name: 'Last Submitted', value: brag?.submitted_at ? new Date(brag.submitted_at).toLocaleDateString('en-GB') : 'No reports', inline: true },
      { name: 'Notes', value: brag?.additional_comments || brag?.tasks_notes || 'No notes', inline: false }
    )
    .setFooter({ text: 'Community Organisation | Staff Portal' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
