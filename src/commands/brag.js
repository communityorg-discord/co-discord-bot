import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getUserByDiscordId, getBragStatus } from '../db.js';
import Database from 'better-sqlite3';
import { config } from 'dotenv';
config();

function getWeekKey(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay() + 1); // Monday
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function getLast8Weeks() {
  const weeks = [];
  for (let i = 0; i < 8; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i * 7);
    weeks.push({ key: getWeekKey(d), label: new Date(d.setDate(d.getDate() - d.getDay() + 1)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) });
  }
  return weeks;
}

export const data = new SlashCommandBuilder()
  .setName('brag')
  .setDescription('Check your current BRAG activity status');

export async function execute(interaction) {
  const user = getUserByDiscordId(interaction.user.id);
  if (!user) {
    return interaction.reply({ content: '❌ Your Discord account is not linked to a CO Staff Portal account. Contact DMSPC.', ephemeral: true });
  }

  const brag = getBragStatus(user.id);
  const portalDb = new Database(process.env.PORTAL_DB_PATH, { readonly: true });

  const weeks = getLast8Weeks();
  const currentWeekKey = weeks[0]?.key;
  const previousWeekKey = weeks[1]?.key;

  // Current week record
  const currentWeekRecord = portalDb.prepare(
    'SELECT * FROM brag_records WHERE discord_id = ? AND week_key = ?'
  ).get(user.discord_id, currentWeekKey);

  // Previous week record
  const previousWeekRecord = portalDb.prepare(
    'SELECT * FROM brag_records WHERE discord_id = ? AND week_key = ?'
  ).get(user.discord_id, previousWeekKey);

  // Base thresholds (no overrides — fetching per-user overrides requires portal auth)
  const thresholdsGreen = 150;
  const thresholdsAmber = 100;

  // Project weekly total: current count / days elapsed * 7
  let projected = null;
  const currentCount = currentWeekRecord?.message_count || 0;
  if (currentCount > 0 && currentWeekRecord?.week_start) {
    const start = new Date(currentWeekRecord.week_start);
    const now = new Date();
    const daysElapsed = Math.max(1, Math.ceil((now - start) / 86400000));
    projected = Math.round((currentCount / daysElapsed) * 7);
  }

  const gradeEmoji = (g) => ({ green: '🟢', amber: '🟡', red: '🔴', black: '⚫' }[g?.toLowerCase()] || '⚪');
  const gradeColor = (g) => ({ green: 0x22C55E, amber: 0xF59E0B, red: 0xEF4444, black: 0x1F2937 }[g?.toLowerCase()] || 0x5865F2);

  const currentGrade = currentWeekRecord?.final_grade || brag?.messages_grade || 'unknown';
  const lastWeekGrade = previousWeekRecord?.final_grade || brag?.messages_grade || 'unknown';
  const lastWeekCount = previousWeekRecord?.message_count || brag?.message_count || 0;

  const embed = new EmbedBuilder()
    .setTitle(`${gradeEmoji(currentGrade)} BRAG Status — ${user.display_name || user.full_name}`)
    .setColor(gradeColor(currentGrade))
    .addFields(
      { name: 'Position', value: user.position || 'N/A', inline: true },
      { name: 'Department', value: user.department || 'N/A', inline: true },
      { name: '\u200B', value: '\u200B', inline: true },
      { name: '📊 This Week', value: String(currentCount), inline: true },
      { name: '🎯 Target', value: `${thresholdsGreen}+ 🟢 | ${thresholdsAmber}+ 🟡`, inline: true },
      { name: '📈 Projected', value: projected !== null ? String(projected) : 'N/A', inline: true },
      { name: '🏆 Last Week', value: lastWeekCount > 0 ? `${lastWeekCount} — ${gradeEmoji(lastWeekGrade)} ${lastWeekGrade?.toUpperCase()}` : 'No data', inline: true },
      { name: 'Overall Grade', value: `${gradeEmoji(lastWeekGrade)} ${(lastWeekGrade || 'N/A').toUpperCase()}`, inline: true },
      { name: 'Last Submitted', value: brag?.submitted_at ? new Date(brag.submitted_at).toLocaleDateString('en-GB') : 'No reports', inline: true },
      { name: 'Tasks Rating', value: brag?.tasks_self_rating || 'N/A', inline: true },
      { name: 'Notes', value: brag?.additional_comments || brag?.tasks_notes || 'No notes', inline: false }
    )
    .setFooter({ text: 'Community Organisation | Staff Assistant' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
