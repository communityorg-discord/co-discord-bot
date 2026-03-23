import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getUserByDiscordId } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('brag')
  .setDescription('Check your current BRAG activity status');

export async function execute(interaction) {
  const user = getUserByDiscordId(interaction.user.id);
  if (!user) {
    return interaction.reply({ content: '❌ Your Discord account is not linked to a CO Staff Portal account. Contact DMSPC.', ephemeral: true });
  }

  // Fetch full BRAG data from portal API
  let bragData = null;
  try {
    const { default: fetch } = await import('node-fetch');
    const r = await fetch(`http://localhost:3016/api/brag/my`, {
      credentials: 'include',
      headers: { 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET }
    });
    if (r.ok) bragData = await r.json();
  } catch {}

  const currentWeek = bragData?.data?.currentWeek;
  const thresholds = bragData?.data?.thresholds || {};
  const weekStart = currentWeek?.week_start
    ? new Date(currentWeek.week_start).toLocaleDateString('en-GB', { timeZone: 'UTC' })
    : 'N/A';
  const weekEnd = currentWeek?.week_end
    ? new Date(currentWeek.week_end).toLocaleDateString('en-GB', { timeZone: 'UTC' })
    : 'N/A';

  // Current week message count
  const currentMessages = currentWeek?.message_count || 0;
  const greenTarget = thresholds?.green?.messages || 150;

  // Projected: messages per day * 7, or if already past target show "On track"
  const daysInWeek = 7;
  const today = new Date();
  const dayOfWeek = today.getDay() === 0 ? 7 : today.getDay(); // Monday = 1, Sunday = 7
  const projectedTotal = Math.round((currentMessages / dayOfWeek) * daysInWeek);
  const projectedLabel = currentMessages >= greenTarget
    ? '🟢 On track'
    : projectedTotal >= greenTarget
      ? `~${projectedTotal} (on pace)`
      : `~${projectedTotal} (unlikely)`;

  const gradeEmoji = (g) => ({ green: '🟢', amber: '🟡', red: '🔴', black: '⚫' }[g?.toLowerCase()] || '⚪');
  const gradeColor = (g) => ({ green: 0x22C55E, amber: 0xF59E0B, red: 0xEF4444, black: 0x1F2937 }[g?.toLowerCase()] || 0x5865F2);

  const messagesGrade = currentWeek?.message_grade || currentWeek?.messages_grade || 'N/A';
  const tasksGrade = currentWeek?.tasks_grade || 'N/A';
  const overallGrade = messagesGrade !== 'N/A' ? messagesGrade : tasksGrade !== 'N/A' ? tasksGrade : 'N/A';

  const embed = new EmbedBuilder()
    .setTitle(`${gradeEmoji(overallGrade)} BRAG Status — ${user.display_name || user.full_name}`)
    .setColor(gradeColor(overallGrade))
    .addFields(
      { name: 'Position', value: user.position || 'N/A', inline: true },
      { name: 'Department', value: user.department || 'N/A', inline: true },
      { name: '\u200B', value: '\u200B', inline: true },
      { name: 'Messages Grade', value: (messagesGrade || 'No data').toUpperCase(), inline: true },
      { name: 'Tasks Grade', value: (tasksGrade || 'No data').toUpperCase(), inline: true },
      { name: 'Tasks Rating', value: currentWeek?.tasks_self_rating || 'N/A', inline: true },
      { name: `📊 This Week (${weekStart} – ${weekEnd})`, value: '\u200B', inline: false },
      { name: 'Messages', value: String(currentMessages), inline: true },
      { name: 'Target', value: String(greenTarget), inline: true },
      { name: 'Projected', value: projectedLabel, inline: true },
      { name: 'Last Submitted', value: currentWeek?.submitted_at ? new Date(currentWeek.submitted_at).toLocaleDateString('en-GB') : 'No reports', inline: true },
      { name: 'Notes', value: currentWeek?.additional_comments || currentWeek?.tasks_notes || 'No notes', inline: false }
    )
    .setFooter({ text: 'Community Organisation | Staff Portal' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
