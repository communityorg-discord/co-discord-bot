// COMMAND_PERMISSION_FALLBACK: everyone
// Top recipients of /thanks kudos in the chosen window. Quick visibility
// into who the team is recognising — meant to surface contribution that
// might otherwise go unnoticed.
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { db } from '../utils/botDb.js';
import { E } from '../lib/emoji.js';

const WINDOW_DAYS = { week: 7, month: 30, all: null };

export const data = new SlashCommandBuilder()
  .setName('kudos-leaderboard')
  .setDescription('Top recipients of /thanks kudos')
  .addStringOption(opt => opt
    .setName('window')
    .setDescription('Time window (default: month)')
    .addChoices(
      { name: 'Week (7d)', value: 'week' },
      { name: 'Month (30d)', value: 'month' },
      { name: 'All time', value: 'all' },
    ));

export async function execute(interaction) {
  const perm = await canUseCommand('kudos-leaderboard', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });
  }
  const winKey = interaction.options.getString('window') || 'month';
  const days = WINDOW_DAYS[winKey];

  let recipients;
  if (days != null) {
    recipients = db.prepare(`
      SELECT to_discord_id, COUNT(*) c
      FROM kudos WHERE created_at >= datetime('now', ?)
      GROUP BY to_discord_id ORDER BY c DESC LIMIT 15
    `).all(`-${days} days`);
  } else {
    recipients = db.prepare(`
      SELECT to_discord_id, COUNT(*) c
      FROM kudos GROUP BY to_discord_id ORDER BY c DESC LIMIT 15
    `).all();
  }

  if (!recipients.length) {
    return interaction.reply({
      content: `No kudos in the ${winKey === 'all' ? 'all-time' : `last ${days}d`} window. Be the first — try \`/thanks\`!`,
      ephemeral: true,
    });
  }

  const lines = recipients.map((r, i) =>
    `**${i + 1}.** <@${r.to_discord_id}> — ${r.c} kudo${r.c === 1 ? '' : 's'}`
  );

  const totalThisWindow = recipients.reduce((s, r) => s + r.c, 0);
  const embed = new EmbedBuilder()
    .setTitle(`Kudos leaderboard — ${winKey === 'all' ? 'all time' : `last ${days}d`}`)
    .setColor(0xfacc15)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `${totalThisWindow} kudo${totalThisWindow === 1 ? '' : 's'} across ${recipients.length} staff · use /thanks to add to it` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
