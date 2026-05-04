// COMMAND_PERMISSION_FALLBACK: everyone
// User-facing /leaderboard slash. The bot already posts auto-updating
// leaderboard embeds to a channel every 5 minutes — this is the
// on-demand version any staff member can pull anywhere.
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { db as botDb, getVoiceLeaderboard, flushActiveSessions } from '../utils/botDb.js';

function getBragWeekKey(ts = Date.now()) {
  const d = new Date(ts);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function fmtTime(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Top staff this week — voice channel time and messages sent')
  .addStringOption(opt => opt
    .setName('type')
    .setDescription('Which leaderboard to show')
    .addChoices(
      { name: 'voice (default)', value: 'voice' },
      { name: 'messages', value: 'messages' },
    ));

export async function execute(interaction) {
  const perm = await canUseCommand('leaderboard', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  const type = interaction.options.getString('type') || 'voice';
  const weekKey = getBragWeekKey();
  const portalDb = (await import('../db.js')).default;

  let rows = [];
  let title = '';
  if (type === 'voice') {
    try { flushActiveSessions(weekKey); } catch {}
    rows = getVoiceLeaderboard(weekKey).slice(0, 10);
    title = '🎙️ Voice channel leaderboard';
  } else {
    rows = botDb.prepare(
      `SELECT discord_id, SUM(message_count) AS total
       FROM brag_message_counts WHERE week_key = ? GROUP BY discord_id
       ORDER BY total DESC LIMIT 10`
    ).all(weekKey);
    title = '💬 Messages leaderboard';
  }

  if (!rows.length) {
    return interaction.editReply({ content: `📭 No ${type} data yet for week ${weekKey}.` });
  }

  const enriched = rows.map(r => {
    const u = portalDb.prepare("SELECT display_name, full_name, position FROM users WHERE discord_id = ?").get(r.discord_id);
    return { ...r, name: u?.display_name || u?.full_name || `<@${r.discord_id}>`, position: u?.position };
  });

  const lines = enriched.map((r, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
    const value = type === 'voice'
      ? fmtTime(r.total_seconds)
      : `${r.total} msgs`;
    return `${medal} ${r.name} — **${value}**`;
  });

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(type === 'voice' ? 0x22c55e : 0x6366f1)
    .setDescription(lines.join('\n'))
    .addFields({ name: 'Week', value: weekKey, inline: true })
    .setFooter({ text: 'Live data — updates every 5 minutes' })
    .setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}
