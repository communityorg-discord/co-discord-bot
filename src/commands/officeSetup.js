// COMMAND_PERMISSION_FALLBACK: superuser_only
import { SlashCommandBuilder, EmbedBuilder, ChannelType } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import {
  upsertOffice, deleteOffice, getOffice, listOffices,
  upsertWaitingRoom, firstWaitingRoom, listWaitingRooms,
  grantKey, revokeKey, listKeys, canAccessOffice,
} from '../services/officeManager.js';
import { logAction } from '../utils/logger.js';
import { E } from '../lib/emoji.js';

// Offices use ROLE + HIERARCHY access: each office is owned by a role and has a
// rank (lower number = higher / more senior). A member can join an office if
// they hold its owner role, hold a higher-ranked office role (so seniors reach
// junior offices), have a temporary key, or are a superuser. Anyone else who
// joins is moved to the waiting room.
export const data = new SlashCommandBuilder()
  .setName('office')
  .setDescription('Manage office voice channels (role-based access, keys, waiting room) — Superuser only')
  .addSubcommand(s => s.setName('set').setDescription('Set up / update an office: owner role + hierarchy rank')
    .addChannelOption(o => o.setName('channel').setDescription('Office voice channel').setRequired(true).addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice))
    .addRoleOption(o => o.setName('owner_role').setDescription('Role that owns this office').setRequired(true))
    .addIntegerOption(o => o.setName('rank').setDescription('Seniority — lower = higher (0 = top). Seniors can access junior offices.').setRequired(true).setMinValue(0).setMaxValue(100)))
  .addSubcommand(s => s.setName('waiting').setDescription('Set the waiting room (unauthorised joiners are moved here)')
    .addChannelOption(o => o.setName('channel').setDescription('Waiting room voice channel').setRequired(true).addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)))
  .addSubcommand(s => s.setName('key').setDescription('Give someone temporary access to an office')
    .addUserOption(o => o.setName('user').setDescription('Who gets the key').setRequired(true))
    .addChannelOption(o => o.setName('channel').setDescription('Office voice channel').setRequired(true).addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice))
    .addIntegerOption(o => o.setName('minutes').setDescription('How long the key lasts, in minutes').setRequired(true).setMinValue(1).setMaxValue(20160)))
  .addSubcommand(s => s.setName('revoke').setDescription('Revoke someone\'s temporary key for an office')
    .addUserOption(o => o.setName('user').setDescription('Whose key to revoke').setRequired(true))
    .addChannelOption(o => o.setName('channel').setDescription('Office voice channel').setRequired(true).addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)))
  .addSubcommand(s => s.setName('list').setDescription('List the configured offices, their roles, ranks and the waiting room'))
  .addSubcommand(s => s.setName('remove').setDescription('Stop managing an office')
    .addChannelOption(o => o.setName('channel').setDescription('Office voice channel').setRequired(true).addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)));

// Move anyone in the office who isn't authorised into the waiting room.
async function sweep(guild, channelId) {
  const vc = guild.channels.cache.get(channelId);
  const office = getOffice(channelId);
  const wr = firstWaitingRoom(guild.id);
  if (!vc?.members || !office) return;
  for (const [, m] of vc.members) {
    if (m.user.bot) continue;
    if (!canAccessOffice(m, office)) {
      if (wr && wr.channel_id !== channelId) await m.voice.setChannel(wr.channel_id).catch(() => {});
      else await m.voice.disconnect('[Office] not authorised (sweep)').catch(() => {});
    }
  }
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand(false);
  const perm = await canUseCommand(sub ? `office:${sub}` : 'office', interaction);
  if (!perm.allowed) return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });
  const guild = interaction.guild;
  if (!guild) return interaction.reply({ content: `${E.cross} Use this in a server.`, ephemeral: true });
  await interaction.deferReply({ ephemeral: true });

  if (sub === 'set') {
    const channel = interaction.options.getChannel('channel');
    const role = interaction.options.getRole('owner_role');
    const rank = interaction.options.getInteger('rank');
    upsertOffice(guild.id, channel.id, channel.name, role.id, rank);
    await sweep(guild, channel.id);
    await logAction(interaction.client, { action: 'Office Configured', moderator: { discordId: interaction.user.id, name: interaction.user.tag }, target: { discordId: channel.id, name: channel.name }, reason: `Owner ${role.name}, rank ${rank}`, color: 0x22C55E, logType: 'moderation.office', guildId: guild.id });
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x22C55E).setTitle('Office set up').setDescription(`${E.check} <#${channel.id}> is now owned by <@&${role.id}> at rank **${rank}**.`).addFields({ name: 'Who can join', value: `That role, anyone of a higher rank, key-holders, and superusers. Everyone else is moved to the waiting room.` })] });
  }

  if (sub === 'waiting') {
    const channel = interaction.options.getChannel('channel');
    upsertWaitingRoom(guild.id, channel.id, channel.name);
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x22C55E).setTitle('Waiting room set').setDescription(`${E.check} <#${channel.id}> is the waiting room. Unauthorised joiners are moved here, and members with access are offered their office(s).`)] });
  }

  if (sub === 'key') {
    const user = interaction.options.getUser('user');
    const channel = interaction.options.getChannel('channel');
    const minutes = interaction.options.getInteger('minutes');
    if (!getOffice(channel.id)) return interaction.editReply({ content: `${E.cross} <#${channel.id}> isn't a managed office. Run \`/office set\` first.` });
    const expires = Date.now() + minutes * 60_000;
    grantKey(channel.id, user.id, expires, interaction.user.id);
    await logAction(interaction.client, { action: 'Office Key Granted', moderator: { discordId: interaction.user.id, name: interaction.user.tag }, target: { discordId: user.id, name: user.tag }, reason: `${minutes} min key for ${channel.name}`, color: 0x5865F2, logType: 'moderation.office', guildId: guild.id });
    await user.send({ embeds: [new EmbedBuilder().setColor(0x22C55E).setTitle('Office key granted').setDescription(`${E.check} You've been given access to **${channel.name}** until <t:${Math.floor(expires / 1000)}:f> (<t:${Math.floor(expires / 1000)}:R>).`)] }).catch(() => {});
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x22C55E).setTitle('Key granted').setDescription(`${E.check} <@${user.id}> can access <#${channel.id}> until <t:${Math.floor(expires / 1000)}:R>.`)] });
  }

  if (sub === 'revoke') {
    const user = interaction.options.getUser('user');
    const channel = interaction.options.getChannel('channel');
    revokeKey(channel.id, user.id);
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xF59E0B).setTitle('Key revoked').setDescription(`${E.warning} <@${user.id}>'s key for <#${channel.id}> has been revoked.`)] });
  }

  if (sub === 'remove') {
    const channel = interaction.options.getChannel('channel');
    deleteOffice(channel.id);
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xF59E0B).setTitle('Office removed').setDescription(`${E.warning} <#${channel.id}> is no longer a managed office.`)] });
  }

  if (sub === 'list') {
    const offices = listOffices(guild.id);
    const wrs = listWaitingRooms(guild.id);
    const lines = offices.length ? offices.map(o => {
      const keys = listKeys(o.channel_id).length;
      return `**rank ${o.rank ?? 100}** · <#${o.channel_id}> → ${o.owner_role_id ? `<@&${o.owner_role_id}>` : '*(no role)*'}${keys ? ` · ${keys} key(s)` : ''}`;
    }).join('\n') : '*No offices configured. Use `/office set`.*';
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Offices').setDescription(lines).addFields({ name: 'Waiting room', value: wrs.length ? wrs.map(w => `<#${w.channel_id}>`).join(', ') : '*none — set with `/office waiting`*' }).setFooter({ text: 'Lower rank = more senior. Seniors can access junior offices.' })] });
  }
}
