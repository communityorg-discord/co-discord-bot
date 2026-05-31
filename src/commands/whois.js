// COMMAND_PERMISSION_FALLBACK: auth_level >= 5
// Aggregator command — pulls everything the bot + portal know about
// a Discord user into one ephemeral embed. Useful for IT triage:
// "what roles do they have where, are they verified, suspended,
// banned, on probation, what's their position, etc."
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { db as botDb } from '../utils/botDb.js';
import { getUserByDiscordId } from '../db.js';
import { E } from '../lib/emoji.js';

export const data = new SlashCommandBuilder()
  .setName('whois')
  .setDescription('Aggregate everything the bot + portal know about a Discord user (auth 5+)')
  .addUserOption(opt => opt.setName('user').setDescription('Discord user to look up').setRequired(true));

export async function execute(interaction) {
  const perm = await canUseCommand('whois', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  const target = interaction.options.getUser('user');
  const targetId = target.id;
  const client = interaction.client;

  // ── Portal user
  const portalUser = getUserByDiscordId(targetId);

  // ── Bot data
  const verified = botDb.prepare("SELECT * FROM verified_members WHERE discord_id = ?").get(targetId);
  const lastQueue = botDb.prepare("SELECT id, status, reviewed_by FROM verification_queue WHERE discord_id = ? ORDER BY id DESC LIMIT 1").get(targetId);
  const activeSusp = botDb.prepare("SELECT * FROM suspensions WHERE discord_id = ? AND active = 1").get(targetId);
  const activeBan = botDb.prepare("SELECT * FROM banned_users WHERE discord_id = ? AND active = 1").get(targetId);
  const activeInv = botDb.prepare("SELECT * FROM investigations WHERE discord_id = ? AND active = 1").get(targetId);
  const infrCount = botDb.prepare("SELECT COUNT(*) AS c FROM infractions WHERE discord_id = ? AND deleted = 0").get(targetId).c;
  const activeWarns = botDb.prepare("SELECT COUNT(*) AS c FROM infractions WHERE discord_id = ? AND type = 'warning' AND active = 1 AND deleted = 0").get(targetId).c;

  // ── Guild presence — what guilds is the user in, and what roles
  const presence = [];
  for (const [, g] of client.guilds.cache) {
    const member = await g.members.fetch(targetId).catch(() => null);
    if (!member) { presence.push({ name: g.name, member: false }); continue; }
    const roleNames = [...member.roles.cache.values()]
      .filter(r => r.id !== g.id) // strip @everyone
      .map(r => r.name)
      .sort();
    presence.push({ name: g.name, member: true, nickname: member.nickname || null, roles: roleNames });
  }

  const embed = new EmbedBuilder()
    .setTitle(`whois — ${portalUser?.display_name || verified?.nickname || target.username}`)
    .setColor(activeBan ? 0xef4444 : activeSusp ? 0xf59e0b : verified ? 0x22c55e : 0x6b7280)
    .setThumbnail(target.displayAvatarURL())
    .addFields(
      { name: 'Discord', value: `<@${targetId}> (\`${targetId}\`)`, inline: false },
      ...(portalUser ? [
        { name: 'Portal Account', value: `${portalUser.display_name || portalUser.full_name || portalUser.username} (id=${portalUser.id})`, inline: false },
        { name: 'Position', value: `**${portalUser.position || '—'}**`, inline: true },
        { name: 'Department', value: portalUser.department || '—', inline: true },
        { name: 'Auth / Status', value: `\`${portalUser.auth_level ?? '?'}\` · \`${portalUser.account_status || '?'}\``, inline: true },
      ] : [
        { name: 'Portal Account', value: `${E.cross} Not linked to portal`, inline: false },
      ]),
      ...(verified ? [
        { name: 'Bot Verification', value: `${E.check} Verified as **${verified.position}** ${verified.nickname ? `(nick: ${verified.nickname})` : ''}`.trim(), inline: false },
        { name: 'Verified At', value: verified.verified_at || '?', inline: true },
        { name: 'Last Queue', value: lastQueue ? `#${lastQueue.id} (${lastQueue.status})` : '—', inline: true },
      ] : [
        { name: 'Bot Verification', value: `${E.cross} Not verified${lastQueue ? ` — last queue #${lastQueue.id} (${lastQueue.status})` : ''}`, inline: false },
      ]),
      { name: 'Status flags', value: [
        activeSusp ? `${E.suspend} Suspended` : null,
        activeBan ? `${E.ban} Banned` : null,
        activeInv ? `${E.investigate} Under investigation` : null,
        portalUser?.probation_end_date && !portalUser.probation_passed ? `${E.warning} On probation` : null,
        !activeSusp && !activeBan && !activeInv ? `${E.check} Clear` : null,
      ].filter(Boolean).join(' · '), inline: false },
      { name: 'Infractions', value: `${infrCount} total · ${activeWarns} active warning${activeWarns === 1 ? '' : 's'}`, inline: false },
    );

  // Kudos snapshot — receivers + givers stats. Cheap query, useful
  // sentiment signal alongside the moderation flags.
  try {
    const kReceived = botDb.prepare('SELECT COUNT(*) c FROM kudos WHERE to_discord_id = ?').get(targetId).c;
    const kGiven = botDb.prepare('SELECT COUNT(*) c FROM kudos WHERE from_discord_id = ?').get(targetId).c;
    const kRecent = botDb.prepare(`SELECT COUNT(*) c FROM kudos WHERE to_discord_id = ? AND created_at >= datetime('now', '-30 days')`).get(targetId).c;
    if (kReceived || kGiven) {
      embed.addFields({
        name: 'Kudos',
        value: `${E.kudos} **${kReceived}** received (all-time, ${kRecent} in last 30d) · **${kGiven}** given`,
        inline: false,
      });
    }
  } catch { /* kudos table might not exist on older dbs */ }

  // Per-guild presence — compact format, capped to fit embed limits
  const presLines = presence.map(p => {
    if (!p.member) return `${E.cross} **${p.name}** — not a member`;
    const nick = p.nickname ? ` (nick: \`${p.nickname}\`)` : '';
    const roleSummary = p.roles.length ? ` · ${p.roles.length} role${p.roles.length === 1 ? '' : 's'}` : '';
    return `${E.check} **${p.name}**${nick}${roleSummary}`;
  });
  embed.addFields({
    name: `Guild presence (${presence.filter(p => p.member).length}/${presence.length})`,
    value: presLines.join('\n').slice(0, 1024) || '_no guilds_',
    inline: false,
  });

  // First guild they're in — full role list as a separate field
  const firstGuild = presence.find(p => p.member && p.roles.length);
  if (firstGuild) {
    const roleStr = firstGuild.roles.join(', ').slice(0, 1024);
    embed.addFields({
      name: `Roles in ${firstGuild.name}`,
      value: roleStr || '_none_',
      inline: false,
    });
  }

  embed.setFooter({ text: `Lookup by ${interaction.user.username}` }).setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
