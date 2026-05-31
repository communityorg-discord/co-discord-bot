// COMMAND_PERMISSION_FALLBACK: everyone
// COMMAND_PERMISSION_FALLBACK: auth_level >= 5;option=user=other
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getUserByDiscordId, getBragStatus } from '../db.js';
import portalDb from '../db.js';
import { canUseCommand } from '../utils/permissions.js';
import { E } from '../lib/emoji.js';

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
    const perm = await canUseCommand('brag', interaction);
    if (!perm.allowed) {
      return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });
    }
    const commandUser = getUserByDiscordId(interaction.user.id);
    if (!commandUser) {
      return interaction.reply({ content: `${E.cross} Your Discord account is not linked to a CO Staff Portal account. Contact DMSPC.`, ephemeral: true });
    }

    const targetUserOption = interaction.options.getUser('user');
    let targetDbUser = commandUser;
    let isViewingOther = false;

    if (targetUserOption && targetUserOption.id !== interaction.user.id) {
      const canView = await canUseCommand('brag:other', interaction);
      if (!canView.allowed) {
        return interaction.reply({ content: `${E.cross} ${canView.reason}`, ephemeral: true });
      }
      const targetLinkedUser = getUserByDiscordId(targetUserOption.id);
      if (!targetLinkedUser) {
        return interaction.reply({ content: `${E.cross} <@${targetUserOption.id}> is not linked to a CO Staff Portal account.`, ephemeral: true });
      }
      targetDbUser = targetLinkedUser;
      isViewingOther = true;
    }

    // BRAG was retired in the 2026-04-26 migration — read from
    // activity_weekly_grades (the canonical APS aggregate) and
    // activity_point_records (live points for projection). brag_records,
    // brag_reports, and getBragStatus all referenced tables that no
    // longer exist; queries against them threw "no such table".
    const weeks = getLast8Weeks();
    const currentWeekKey = weeks[0]?.key;
    const previousWeekKey = weeks[1]?.key;

    const currentWeekRecord = portalDb.prepare(
      'SELECT * FROM activity_weekly_grades WHERE user_id = ? AND week_key = ?'
    ).get(targetDbUser.id, currentWeekKey);

    const previousWeekRecord = portalDb.prepare(
      'SELECT * FROM activity_weekly_grades WHERE user_id = ? AND week_key = ?'
    ).get(targetDbUser.id, previousWeekKey);

    // Live current-week total in case the cron hasn't yet re-baked the
    // grade row for today's activity.
    const liveCurrent = portalDb.prepare(
      "SELECT COALESCE(SUM(points), 0) AS p FROM activity_point_records WHERE user_id = ? AND week_key = ?"
    ).get(targetDbUser.id, currentWeekKey);
    const currentCount = liveCurrent?.p || currentWeekRecord?.total_points || 0;

    // Tier thresholds: prefer the user's own row; fall back to the most
    // common tier band so the embed still has reasonable numbers when no
    // grade row exists yet (first week of activity).
    const fallbackTier = portalDb.prepare(
      'SELECT green_target, amber_target, red_target FROM activity_tier_config ORDER BY id LIMIT 1'
    ).get();
    const thresholdsGreen = currentWeekRecord?.green_target || fallbackTier?.green_target || 300;
    const thresholdsAmber = currentWeekRecord?.amber_target || fallbackTier?.amber_target || 200;
    const thresholdsRed   = currentWeekRecord?.red_target   || fallbackTier?.red_target   || 100;

    let projected = null;
    if (currentCount > 0 && currentWeekKey) {
      const start = new Date(currentWeekKey);
      const now = new Date();
      const daysElapsed = Math.max(1, Math.ceil((now - start) / 86400000));
      projected = Math.round((currentCount / daysElapsed) * 7);
    }

    const gradeColor = (g) => ({ green: 0x22C55E, amber: 0xF59E0B, red: 0xEF4444, black: 0x1F2937 }[g?.toLowerCase()] || 0x5865F2);

    const currentGrade = currentWeekRecord?.grade || (currentCount > 0 ? 'pending' : 'unknown');
    const lastWeekGrade = previousWeekRecord?.grade || 'unknown';
    const lastWeekCount = previousWeekRecord?.total_points || 0;

    const viewingNote = isViewingOther ? ` (viewing ${commandUser.display_name || commandUser.full_name})` : '';
    const embed = new EmbedBuilder()
      .setTitle(`Activity Points — ${targetDbUser.display_name || targetDbUser.full_name}${viewingNote}`)
      .setColor(gradeColor(currentGrade))
      .setDescription(`${E.aps} _BRAG was retired in 2026-04-26 — this view now reads from Activity Points._`)
      .addFields(
        { name: 'Position', value: targetDbUser.position || 'N/A', inline: true },
        { name: 'Department', value: targetDbUser.department || 'N/A', inline: true },
        { name: '\u200B', value: '\u200B', inline: true },
        { name: 'This Week (points)', value: String(currentCount), inline: true },
        { name: 'Target', value: `${thresholdsGreen}+\n${thresholdsAmber}-${thresholdsGreen}\n${thresholdsRed}-${thresholdsAmber}\n0-${thresholdsRed}`, inline: true },
        { name: 'Projected', value: projected !== null ? String(projected) : 'N/A', inline: true },
        { name: 'Last Week', value: lastWeekCount > 0 ? `${lastWeekCount} pts — ${lastWeekGrade?.toUpperCase()}` : 'No data', inline: true },
        { name: 'Current Grade', value: `${(currentGrade || 'N/A').toUpperCase()}`, inline: true },
        { name: 'Categories met', value: String(currentWeekRecord?.categories_met ?? '—'), inline: true },
      )
      .setFooter({ text: 'Community Organisation | Staff Assistant — try /aps for the live tier breakdown' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
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
