// COMMAND_PERMISSION_FALLBACK: everyone
// Show every verified staff member who's currently online (per Discord
// presence), grouped by status. Helps answer "who can I ask for help
// right now" without scrolling member lists per guild.
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { db as botDb } from '../utils/botDb.js';
import { getEffectiveAllServerIds, getEffectiveStaffHqId } from '../config.js';

const STATUS_BUCKETS = ['online', 'idle', 'dnd'];
const STATUS_EMOJI = { online: '🟢', idle: '🟡', dnd: '🔴' };

export const data = new SlashCommandBuilder()
  .setName('staff-online')
  .setDescription('Show every verified staff member currently online');

export async function execute(interaction) {
  const perm = await canUseCommand('staff-online', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  const verified = botDb.prepare('SELECT discord_id, position, nickname FROM verified_members').all();
  if (!verified.length) {
    return interaction.editReply({ content: '_No verified staff in the bot DB._' });
  }
  const verifiedById = new Map(verified.map(v => [v.discord_id, v]));

  // Pick the Staff HQ guild as the canonical source for presence (it's
  // where every staffer is). Falls back to the current guild if no HQ.
  const client = interaction.client;
  const hqId = getEffectiveStaffHqId(client) || interaction.guildId;
  const guild = client.guilds.cache.get(hqId);
  if (!guild) {
    return interaction.editReply({ content: '❌ Staff HQ guild not in cache.' });
  }
  await guild.members.fetch().catch(() => null);

  // Bucket by status
  const buckets = { online: [], idle: [], dnd: [], offline: [] };
  for (const v of verified) {
    const m = guild.members.cache.get(v.discord_id);
    if (!m) { buckets.offline.push({ ...v, displayName: '(not in HQ)' }); continue; }
    const status = m.presence?.status || 'offline';
    const display = m.displayName || m.user.username;
    const target = STATUS_BUCKETS.includes(status) ? buckets[status] : buckets.offline;
    target.push({ ...v, displayName: display });
  }

  // Sort each bucket by position then name
  for (const k of Object.keys(buckets)) {
    buckets[k].sort((a, b) => (a.position || '').localeCompare(b.position || '') || a.displayName.localeCompare(b.displayName));
  }

  const onlineTotal = buckets.online.length + buckets.idle.length + buckets.dnd.length;

  const embed = new EmbedBuilder()
    .setTitle(`👥 Staff online — ${onlineTotal} of ${verified.length}`)
    .setColor(onlineTotal === 0 ? 0x64748b : 0x22c55e)
    .setFooter({ text: `Presence sourced from ${guild.name}` })
    .setTimestamp();

  for (const status of STATUS_BUCKETS) {
    const list = buckets[status];
    if (!list.length) continue;
    const lines = list.map(s => `<@${s.discord_id}> — ${s.position}`).join('\n');
    embed.addFields({
      name: `${STATUS_EMOJI[status]} ${status} (${list.length})`,
      value: lines.slice(0, 1024),
      inline: false,
    });
  }

  if (onlineTotal === 0) {
    embed.setDescription(`_All ${verified.length} verified staff are offline._`);
  } else if (buckets.offline.length > 0) {
    embed.addFields({
      name: `⚫ offline (${buckets.offline.length})`,
      value: '_(hidden — use `/staff` to see everyone)_',
      inline: false,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}
