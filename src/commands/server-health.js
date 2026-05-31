// COMMAND_PERMISSION_FALLBACK: auth_level >= 7
// Per-guild health report: member count, role coverage vs POSITIONS,
// AutoMod state, baseline role presence (Verified / CO | Staff / Suspended /
// Under Investigation). Lets IT triage cross-guild config drift without
// opening Discord settings tab-by-tab.
import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { POSITIONS } from '../utils/positions.js';
import { db as botDb } from '../utils/botDb.js';
import { E } from '../lib/emoji.js';

const BASELINE_ROLES = ['Verified', 'CO | Staff', 'Suspended', 'Under Investigation'];

export const data = new SlashCommandBuilder()
  .setName('server-health')
  .setDescription('Per-guild health report — role coverage, AutoMod state, baseline roles (auth 7+)')
  .addStringOption(opt => opt
    .setName('scope')
    .setDescription('Run on this server or fan out across all CO guilds the bot is in')
    .addChoices(
      { name: 'this server only', value: 'here' },
      { name: 'every guild the bot is in', value: 'all' },
    ));

export async function execute(interaction) {
  const perm = await canUseCommand('server-health', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  const scope = interaction.options.getString('scope') || 'here';
  const client = interaction.client;
  const guilds = scope === 'all'
    ? [...client.guilds.cache.values()]
    : (interaction.guild ? [interaction.guild] : []);
  if (!guilds.length) {
    return interaction.editReply({ content: `${E.cross} No guild context. Run in a server or pass scope:all.` });
  }
  guilds.sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0));

  // Aggregate every role name referenced by any POSITIONS entry
  const expectedPositionRoles = new Set();
  for (const list of Object.values(POSITIONS)) for (const n of list) expectedPositionRoles.add(n);

  const reports = [];
  for (const g of guilds) {
    const me = g.members.me;
    const perms = me?.permissions;
    const roles = await g.roles.fetch().catch(() => null);
    const haveNames = roles ? new Set([...roles.values()].map(r => r.name)) : new Set();
    const missingPosRoles = [...expectedPositionRoles].filter(n => !haveNames.has(n)).sort();
    const baselinePresent = BASELINE_ROLES.filter(n => haveNames.has(n));
    const baselineMissing = BASELINE_ROLES.filter(n => !haveNames.has(n));

    let automod = '?';
    try {
      const cfg = botDb.prepare('SELECT enabled FROM automod_config WHERE guild_id = ?').get(g.id);
      automod = cfg ? (cfg.enabled ? 'on' : 'off') : 'no row';
    } catch {}

    const botRolePos = me?.roles.highest.position;
    const topRolePos = roles ? Math.max(...[...roles.values()].map(r => r.position)) : 0;
    const headroom = topRolePos - (botRolePos || 0);

    reports.push({
      g,
      members: g.memberCount || 0,
      roles: roles?.size || 0,
      botPosition: botRolePos,
      topPosition: topRolePos,
      headroom,
      automod,
      coverage: expectedPositionRoles.size - missingPosRoles.length,
      coverageTotal: expectedPositionRoles.size,
      missingPosRoles,
      baselinePresent,
      baselineMissing,
      canManageRoles: perms?.has(PermissionFlagsBits.ManageRoles) || false,
      canManageChannels: perms?.has(PermissionFlagsBits.ManageChannels) || false,
      canBan: perms?.has(PermissionFlagsBits.BanMembers) || false,
    });
  }

  // One embed per guild for readability — Discord caps at 10 embeds/reply
  const embeds = reports.slice(0, 9).map(r => {
    const colour = r.baselineMissing.length === 0 && r.automod === 'on' && r.coverage / r.coverageTotal > 0.95
      ? 0x22c55e
      : r.baselineMissing.length > 0 || r.automod !== 'on'
        ? 0xf59e0b
        : 0x6366f1;
    const baseline = r.baselineMissing.length
      ? `${E.warning} missing: ${r.baselineMissing.join(', ')}`
      : `${E.check} all 4 present`;
    const missing = r.missingPosRoles.length === 0
      ? `${E.check} all expected position roles present`
      : r.missingPosRoles.length <= 8
        ? `missing: ${r.missingPosRoles.join(', ')}`
        : `${r.missingPosRoles.length} missing — first 8: ${r.missingPosRoles.slice(0, 8).join(', ')}`;
    return new EmbedBuilder()
      .setTitle(`${r.g.name}`)
      .setColor(colour)
      .addFields(
        { name: 'Members', value: `${E.shield} ${String(r.members)}`, inline: true },
        { name: 'Roles', value: String(r.roles), inline: true },
        { name: 'AutoMod', value: r.automod, inline: true },
        { name: 'Bot perms', value: [
          r.canManageRoles ? '✓ManageRoles' : '✗ManageRoles',
          r.canManageChannels ? '✓Channels' : '✗Channels',
          r.canBan ? '✓Ban' : '✗Ban',
        ].join(' '), inline: false },
        { name: 'Bot role headroom', value: `bot at pos ${r.botPosition} / top role at ${r.topPosition} (${r.headroom} above)`, inline: false },
        { name: 'Baseline roles', value: baseline, inline: false },
        { name: `Position-role coverage (${r.coverage}/${r.coverageTotal})`, value: missing, inline: false },
      )
      .setFooter({ text: `Guild ID: ${r.g.id}` });
  });
  if (reports.length > 9) {
    embeds.push(new EmbedBuilder()
      .setTitle('+ more guilds')
      .setColor(0x6b7280)
      .setDescription(`${E.info} ${reports.length - 9} additional guilds not shown — Discord caps at 10 embeds per reply. Re-run with scope:here in the specific server you want to check.`));
  }
  await interaction.editReply({ embeds });
}
