// COMMAND_PERMISSION_FALLBACK: everyone
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import db, { getUserByDiscordId } from '../db.js';
import { canUseCommand } from '../utils/permissions.js';

// ISO week key helper (matches portal's getWeekKey)
function weekKey(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((t - yearStart) / 86400000) + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

const CATEGORY_LABEL = {
  messages: 'Messages', welcome: 'Welcome', daily_activity: 'Daily activity', available: 'Availability',
  meeting: 'Meetings', weekly_bonus: 'Weekly bonus', voice: 'Voice/VC', task_small: 'Small tasks',
  task_medium: 'Medium tasks', task_large: 'Large tasks', co_work: 'Co-work', user_satisfaction: 'User satisfaction',
  feedback: 'Feedback', suggestion: 'Suggestion', bug_report: 'Bug report', training: 'Training',
};

export const data = new SlashCommandBuilder()
  .setName('aps')
  .setDescription('Show your Activity Points System summary for this week');

export async function execute(interaction) {
  try {
    const perm = await canUseCommand('aps', interaction);
    if (!perm.allowed) {
      return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });
    }
    const user = getUserByDiscordId(interaction.user.id);
    if (!user) {
      return interaction.reply({ content: '❌ Your Discord account is not linked to a CO Staff Portal account.', ephemeral: true });
    }
    const wk = weekKey();

    // Resolve tier via POSITION_TO_TIER mirror (simplified — fall back to Department Staff)
    const tier = db.prepare(`SELECT * FROM activity_tier_config ORDER BY green_target LIMIT 1`).get();
    const userTier = (() => {
      const pos = (user.position || '').toLowerCase();
      const all = db.prepare(`SELECT * FROM activity_tier_config ORDER BY green_target DESC`).all();
      // Simple keyword mapping
      if (/secretary-general|chef de cabinet|director-general|senior advisor/.test(pos)) return all.find(t => t.team_name === 'Executive Operations Board') || tier;
      if (/under secretary-general/.test(pos)) return all.find(t => t.team_name === 'Board of Directors') || tier;
      if (/assistant secretary-general/.test(pos)) return all.find(t => t.team_name === 'Extended Board of Directors') || tier;
      if (/^director|president/.test(pos)) return all.find(t => t.team_name === 'Department Leadership Team') || tier;
      if (/^deputy director|vice-president/.test(pos)) return all.find(t => t.team_name === 'Deputy Department Leadership') || tier;
      if (/senior/.test(pos)) return all.find(t => t.team_name === 'Senior Department Staff') || tier;
      return all.find(t => t.team_name === 'Department Staff') || tier;
    })();

    const rows = db.prepare(`
      SELECT category, SUM(points) as total
      FROM activity_point_records WHERE user_id = ? AND week_key = ?
      GROUP BY category
    `).all(user.id, wk);
    const byCat = {};
    let total = 0;
    rows.forEach(r => { byCat[r.category] = r.total; total += r.total; });
    const catsMet = Object.values(byCat).filter(v => v > 0).length;

    const grade = total === 0 ? 'pending'
      : (total >= userTier.green_target && catsMet >= 3) ? 'green'
      : total >= userTier.green_target ? 'amber'
      : total >= userTier.amber_target ? 'amber'
      : total >= userTier.red_target   ? 'red'
      : 'black';

    const gradeEmoji = { green: '🟢', amber: '🟡', red: '🔴', black: '⚫', pending: '⏳' }[grade];
    const gradeColor = { green: 0x10b981, amber: 0xfbbf24, red: 0xef4444, black: 0x475569, pending: 0x64748b }[grade];

    const catLines = Object.entries(byCat)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `• ${CATEGORY_LABEL[k] || k}: **${v}**`)
      .join('\n') || '_No points scored yet this week._';

    const remaining = Math.max(0, userTier.green_target - total);
    const catsNeeded = Math.max(0, 3 - catsMet);

    const embed = new EmbedBuilder()
      .setTitle(`${gradeEmoji} APS — ${user.display_name || user.full_name || 'You'}`)
      .setColor(gradeColor)
      .setDescription(`Week **${wk}** · Tier **${userTier.team_name}**`)
      .addFields(
        { name: 'Grade', value: grade.toUpperCase(), inline: true },
        { name: 'Points', value: `${total} / ${userTier.green_target}`, inline: true },
        { name: 'Categories', value: `${catsMet} / 3 needed`, inline: true },
        { name: 'By category', value: catLines, inline: false },
      )
      .setFooter({ text: (remaining > 0 || catsNeeded > 0)
        ? `Need ${remaining}pt${remaining === 1 ? '' : 's'} more${catsNeeded > 0 ? ` + ${catsNeeded} more categor${catsNeeded === 1 ? 'y' : 'ies'}` : ''} for Green.`
        : 'You\'re on track for Green.' });

    const base = process.env.PORTAL_URL || 'https://portal.communityorg.co.uk';
    embed.setURL(`${base}/activity-points`);

    await interaction.reply({ embeds: [embed], ephemeral: true });
  } catch (err) {
    console.error('[aps] Error:', err);
    const msg = { content: 'An error occurred.', flags: 64 };
    if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
    else await interaction.reply(msg);
  }
}
