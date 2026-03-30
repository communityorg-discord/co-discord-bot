import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getUserByDiscordId, getBragStatus } from '../db.js';
import portalDb from '../db.js';
import { canRunCommand } from '../utils/permissions.js';

function getWeekKey(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function getLast8Weeks() {
  const weeks = [];
  for (let i = 0; i < 8; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i * 7);
    const day = d.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    weeks.push({
      key: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
    });
  }
  return weeks;
}

export const data = new SlashCommandBuilder()
  .setName('brag')
  .setDescription('Check your current BRAG activity status')
  .addUserOption(opt => opt.setName('user').setDescription('Staff member to view (Auth Level 5+ required)').setRequired(false));

export async function execute(interaction) {
  try {
    const commandUser = getUserByDiscordId(interaction.user.id);
    if (!commandUser) {
      return interaction.reply({ content: '❌ Your Discord account is not linked to a CO Staff Portal account. Contact DMSPC.', ephemeral: true });
    }

    const targetUserOption = interaction.options.getUser('user');
    let targetDbUser = commandUser;
    let isViewingOther = false;

    if (targetUserOption && targetUserOption.id !== interaction.user.id) {
      const canView = await canRunCommand(interaction.user.id, 5);
      if (!canView.allowed) {
        return interaction.reply({ content: `❌ ${canView.reason}`, ephemeral: true });
      }
      const targetLinkedUser = getUserByDiscordId(targetUserOption.id);
      if (!targetLinkedUser) {
        return interaction.reply({ content: `❌ <@${targetUserOption.id}> is not linked to a CO Staff Portal account.`, ephemeral: true });
      }
      targetDbUser = targetLinkedUser;
      isViewingOther = true;
    }

    const brag = getBragStatus(targetDbUser.id);
    const weeks = getLast8Weeks();
    const currentWeekKey = weeks[0]?.key;
    const previousWeekKey = weeks[1]?.key;

    const currentWeekRecord = portalDb.prepare(
      'SELECT * FROM brag_records WHERE discord_id = ? AND week_key = ?'
    ).get(targetDbUser.discord_id, currentWeekKey);

    const previousWeekRecord = portalDb.prepare(
      'SELECT * FROM brag_records WHERE discord_id = ? AND week_key = ?'
    ).get(targetDbUser.discord_id, previousWeekKey);

    // Fetch threshold from portal settings (may be overridden for specific weeks)
    let thresholdsGreen = 150;
    try {
      const resp = await fetch('http://localhost:3016/api/brag/threshold', { headers: { 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET } }).catch(() => null);
      if (resp?.ok) {
        const data = await resp.json();
        if (data.green) thresholdsGreen = data.green;
      }
    } catch {}
    const thresholdsAmber = Math.round(thresholdsGreen * 0.6667);
    const thresholdsRed = Math.round(thresholdsGreen * 0.3333);

    let projected = null;
    const currentCount = currentWeekRecord?.message_count || 0;
    if (currentCount > 0 && currentWeekRecord?.week_key) {
      const start = new Date(currentWeekRecord?.week_key);
      const now = new Date();
      const daysElapsed = Math.max(1, Math.ceil((now - start) / 86400000));
      projected = Math.round((currentCount / daysElapsed) * 7);
    }

    const gradeEmoji = (g) => ({ green: '🟢', amber: '🟡', red: '🔴', black: '⚫' }[g?.toLowerCase()] || '⚪');
    const gradeColor = (g) => ({ green: 0x22C55E, amber: 0xF59E0B, red: 0xEF4444, black: 0x1F2937 }[g?.toLowerCase()] || 0x5865F2);

    const currentGrade = currentWeekRecord?.final_grade || brag?.messages_grade || 'unknown';
    const lastWeekGrade = previousWeekRecord?.final_grade || brag?.messages_grade || 'unknown';
    const lastWeekCount = previousWeekRecord?.message_count || brag?.message_count || 0;

    const viewingNote = isViewingOther ? ` (viewing ${commandUser.display_name || commandUser.full_name})` : '';
    const embed = new EmbedBuilder()
      .setTitle(`${gradeEmoji(currentGrade)} BRAG Status — ${targetDbUser.display_name || targetDbUser.full_name}${viewingNote}`)
      .setColor(gradeColor(currentGrade))
      .addFields(
        { name: 'Position', value: targetDbUser.position || 'N/A', inline: true },
        { name: 'Department', value: targetDbUser.department || 'N/A', inline: true },
        { name: '\u200B', value: '\u200B', inline: true },
        { name: '📊 This Week', value: String(currentCount), inline: true },
        { name: '🎯 Target', value: `🟢 ${thresholdsGreen}+\n🟡 ${thresholdsAmber}-${thresholdsGreen}\n🔴 ${thresholdsRed}-${thresholdsAmber}\n⚫ 0-${thresholdsRed}`, inline: true },
        { name: '📈 Projected', value: projected !== null ? String(projected) : 'N/A', inline: true },
        { name: '🏆 Last Week', value: lastWeekCount > 0 ? `${lastWeekCount} — ${gradeEmoji(lastWeekGrade)} ${lastWeekGrade?.toUpperCase()}` : 'No data', inline: true },
        { name: 'Overall Grade', value: `${gradeEmoji(lastWeekGrade)} ${(lastWeekGrade || 'N/A').toUpperCase()}`, inline: true },
        { name: 'Last Submitted', value: brag?.submitted_at ? `<t:${Math.floor(new Date(brag.submitted_at).getTime() / 1000)}:R>` : 'No reports', inline: true },
        { name: 'Tasks Rating', value: brag?.tasks_self_rating || 'N/A', inline: true },
        { name: 'Notes', value: brag?.additional_comments || brag?.tasks_notes || 'No notes', inline: false }
      )
      .setFooter({ text: 'Community Organisation | Staff Assistant' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    console.error('[brag] Error:', err);
    const msg = { content: 'An error occurred. Please try again.', flags: 64 };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg);
    } else {
      await interaction.reply(msg);
    }
  }
}
