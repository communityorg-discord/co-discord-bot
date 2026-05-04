// COMMAND_PERMISSION_FALLBACK: auth_5
// Surface recent Discord audit-log entries via the bot. Staff without
// admin perms can't see Server Settings → Audit Log directly; this lets
// them ask "who kicked who" / "what role changes happened today" without
// a permission grant. Filters by action type and target user.
import { SlashCommandBuilder, EmbedBuilder, AuditLogEvent } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';

const ACTION_LABEL = {
  [AuditLogEvent.MemberKick]: '👢 Kick',
  [AuditLogEvent.MemberBanAdd]: '🔨 Ban',
  [AuditLogEvent.MemberBanRemove]: '✅ Unban',
  [AuditLogEvent.MemberUpdate]: '✏️ Member edit',
  [AuditLogEvent.MemberRoleUpdate]: '🎭 Role change',
  [AuditLogEvent.MessageDelete]: '🗑️ Msg delete',
  [AuditLogEvent.MessageBulkDelete]: '🗑️🗑️ Bulk delete',
  [AuditLogEvent.RoleCreate]: '➕ Role create',
  [AuditLogEvent.RoleDelete]: '➖ Role delete',
  [AuditLogEvent.RoleUpdate]: '✏️ Role edit',
  [AuditLogEvent.ChannelCreate]: '➕ Channel create',
  [AuditLogEvent.ChannelDelete]: '➖ Channel delete',
  [AuditLogEvent.ChannelUpdate]: '✏️ Channel edit',
  [AuditLogEvent.MemberMove]: '🔀 VC move',
  [AuditLogEvent.MemberDisconnect]: '🔇 VC disconnect',
};

const ACTION_CHOICES = [
  { name: 'Any', value: 'any' },
  { name: 'Kicks', value: 'kick' },
  { name: 'Bans', value: 'ban' },
  { name: 'Unbans', value: 'unban' },
  { name: 'Role changes', value: 'roles' },
  { name: 'Message deletions', value: 'msgdel' },
  { name: 'Channel changes', value: 'channels' },
];

const ACTION_FILTER = {
  any: null,
  kick: [AuditLogEvent.MemberKick],
  ban: [AuditLogEvent.MemberBanAdd],
  unban: [AuditLogEvent.MemberBanRemove],
  roles: [AuditLogEvent.MemberRoleUpdate, AuditLogEvent.RoleCreate, AuditLogEvent.RoleDelete, AuditLogEvent.RoleUpdate],
  msgdel: [AuditLogEvent.MessageDelete, AuditLogEvent.MessageBulkDelete],
  channels: [AuditLogEvent.ChannelCreate, AuditLogEvent.ChannelDelete, AuditLogEvent.ChannelUpdate],
};

export const data = new SlashCommandBuilder()
  .setName('audit-log')
  .setDescription('Show recent Discord audit-log entries for the current server')
  .addStringOption(opt => opt
    .setName('action')
    .setDescription('Filter to a specific action type (default: any)')
    .addChoices(...ACTION_CHOICES))
  .addUserOption(opt => opt
    .setName('user')
    .setDescription('Filter to actions affecting this user'))
  .addIntegerOption(opt => opt
    .setName('limit')
    .setDescription('Number of entries to fetch (1-25, default 10)')
    .setMinValue(1)
    .setMaxValue(25));

export async function execute(interaction) {
  const perm = await canUseCommand('audit-log', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild;
  if (!guild) return interaction.editReply({ content: '❌ Run in a server.' });

  const action = interaction.options.getString('action') || 'any';
  const target = interaction.options.getUser('user');
  const limit = interaction.options.getInteger('limit') || 10;
  const wantedTypes = ACTION_FILTER[action];

  let entries = [];
  try {
    if (wantedTypes && wantedTypes.length === 1) {
      const log = await guild.fetchAuditLogs({ limit, type: wantedTypes[0], user: target?.id });
      entries = [...log.entries.values()];
    } else {
      // Fetch broader — request 100 then filter client-side for multi-type filters
      const log = await guild.fetchAuditLogs({ limit: wantedTypes ? 100 : limit, user: target?.id });
      entries = [...log.entries.values()];
      if (wantedTypes) entries = entries.filter(e => wantedTypes.includes(e.action));
      entries = entries.slice(0, limit);
    }
  } catch (e) {
    return interaction.editReply({ content: `❌ Couldn't fetch audit log — bot needs ViewAuditLog perm. (${e.message})` });
  }

  if (!entries.length) {
    return interaction.editReply({ content: `📭 No audit-log entries match those filters.` });
  }

  const lines = entries.map(e => {
    const label = ACTION_LABEL[e.action] || `Action ${e.action}`;
    const exec = e.executor ? `<@${e.executor.id}>` : '_unknown_';
    const targ = e.target?.id ? ` → <@${e.target.id}>` : (e.target?.name ? ` → \`${e.target.name}\`` : '');
    const reason = e.reason ? ` *(${e.reason.slice(0, 80)})*` : '';
    const when = `<t:${Math.floor(e.createdTimestamp / 1000)}:R>`;
    return `${label} by ${exec}${targ}${reason} · ${when}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`📜 Audit log — ${guild.name}`)
    .setColor(0x6366f1)
    .setDescription(lines.join('\n').slice(0, 4096))
    .setFooter({
      text: `Filter: ${action}${target ? ` · target ${target.username}` : ''} · ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`,
    })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
