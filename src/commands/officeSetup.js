import { SlashCommandBuilder, EmbedBuilder, ChannelType } from 'discord.js';
import { isSuperuser } from '../utils/permissions.js';
import {
  upsertOffice, deleteOffice, getOffice, listOffices,
  setAllowlist, addAllowed, removeAllowed, getAllowlist,
  setRequestFeed, getRequestFeed,
  upsertWaitingRoom, deleteWaitingRoom, listWaitingRooms,
} from '../services/officeManager.js';
import { logAction } from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('office')
  .setDescription('Manage voice-channel access control (Superuser only)')
  .addSubcommand(sub => sub
    .setName('configure')
    .setDescription('Set or replace the allowlist for a voice channel (becomes managed)')
    .addChannelOption(opt => opt.setName('channel').setDescription('Voice channel to manage').setRequired(true).addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice))
    .addStringOption(opt => opt.setName('users').setDescription('Mentions or IDs separated by spaces. Leave empty to clear allowlist.').setRequired(false))
  )
  .addSubcommand(sub => sub
    .setName('add')
    .setDescription('Add a user to a managed channel\'s allowlist')
    .addChannelOption(opt => opt.setName('channel').setDescription('Managed voice channel').setRequired(true).addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice))
    .addUserOption(opt => opt.setName('user').setDescription('User to add').setRequired(true))
  )
  .addSubcommand(sub => sub
    .setName('remove')
    .setDescription('Remove a user from a managed channel\'s allowlist')
    .addChannelOption(opt => opt.setName('channel').setDescription('Managed voice channel').setRequired(true).addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice))
    .addUserOption(opt => opt.setName('user').setDescription('User to remove').setRequired(true))
  )
  .addSubcommand(sub => sub
    .setName('unmanage')
    .setDescription('Stop managing a voice channel (clears allowlist)')
    .addChannelOption(opt => opt.setName('channel').setDescription('Voice channel to unmanage').setRequired(true).addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice))
  )
  .addSubcommand(sub => sub
    .setName('list')
    .setDescription('List all managed voice channels and their allowlists')
  )
  .addSubcommand(sub => sub
    .setName('feed')
    .setDescription('Set the text channel where access requests get posted')
    .addChannelOption(opt => opt.setName('channel').setDescription('Text channel for access requests').setRequired(true).addChannelTypes(ChannelType.GuildText))
  )
  .addSubcommand(sub => sub
    .setName('waiting')
    .setDescription('Register a voice channel as a waiting room (joining auto-posts an access request)')
    .addChannelOption(opt => opt.setName('channel').setDescription('Voice channel to use as waiting room').setRequired(true).addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice))
  )
  .addSubcommand(sub => sub
    .setName('unwaiting')
    .setDescription('Stop treating a voice channel as a waiting room')
    .addChannelOption(opt => opt.setName('channel').setDescription('Waiting room channel').setRequired(true).addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice))
  );

function parseUserMentions(input) {
  if (!input) return [];
  const ids = new Set();
  for (const tok of input.split(/\s+/)) {
    const m = tok.match(/(\d{17,20})/);
    if (m) ids.add(m[1]);
  }
  return [...ids];
}

async function kickNonAllowlisted(guild, channelId) {
  const vc = guild.channels.cache.get(channelId);
  if (!vc) return;
  for (const [, member] of vc.members) {
    if (member.user.bot) continue;
    const { isAllowed } = await import('../services/officeManager.js');
    if (!isAllowed(channelId, member.id)) {
      await member.voice.disconnect(`[Office] ${member.user.tag} (${member.id}) not on allowlist for #${guild.channels.cache.get(channelId)?.name || channelId} (post-configure sweep)`).catch(() => {});
    }
  }
}

export async function execute(interaction) {
  if (!isSuperuser(interaction.user.id)) {
    return interaction.reply({ content: '❌ This command requires Superuser access.', ephemeral: true });
  }

  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;
  if (!guild) return interaction.reply({ content: '❌ Use this in a server.', ephemeral: true });

  if (sub === 'configure') {
    await interaction.deferReply({ ephemeral: true });
    const channel = interaction.options.getChannel('channel');
    const usersInput = interaction.options.getString('users') || '';
    const ids = parseUserMentions(usersInput);

    upsertOffice(guild.id, channel.id, channel.name);
    setAllowlist(channel.id, ids, interaction.user.id);
    await kickNonAllowlisted(guild, channel.id);

    const list = ids.length > 0 ? ids.map(i => `<@${i}>`).join(', ') : '*(empty — only superusers can join)*';
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0x22C55E).setTitle('✅ Office configured')
        .setDescription(`<#${channel.id}> is now managed.\n\n**Allowlist:** ${list}`)
        .setFooter({ text: 'Anyone not on the allowlist gets kicked and DMd a request button.' })]
    });

    await logAction(interaction.client, {
      action: '🏢 Office Configured',
      moderator: { discordId: interaction.user.id, name: interaction.user.tag },
      target: { discordId: channel.id, name: channel.name },
      reason: `Allowlist set: ${ids.length} user(s)`,
      color: 0x22C55E, logType: 'moderation.office', guildId: guild.id
    });
    return;
  }

  if (sub === 'add' || sub === 'remove') {
    await interaction.deferReply({ ephemeral: true });
    const channel = interaction.options.getChannel('channel');
    const user = interaction.options.getUser('user');

    const office = getOffice(channel.id);
    if (!office) {
      return interaction.editReply({ content: `❌ <#${channel.id}> isn't managed. Run \`/office configure\` first.` });
    }

    if (sub === 'add') {
      addAllowed(channel.id, user.id, interaction.user.id);
    } else {
      removeAllowed(channel.id, user.id);
    }
    if (sub === 'remove') await kickNonAllowlisted(guild, channel.id);

    const list = getAllowlist(channel.id);
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(sub === 'add' ? 0x22C55E : 0xF59E0B)
        .setTitle(`${sub === 'add' ? '✅ Added' : '🗑️ Removed'} ${user.tag}`)
        .setDescription(`<#${channel.id}> allowlist (${list.length}): ${list.length ? list.map(i => `<@${i}>`).join(', ') : '*(empty)*'}`)]
    });

    await logAction(interaction.client, {
      action: sub === 'add' ? '🏢 Office Allowlist Add' : '🏢 Office Allowlist Remove',
      moderator: { discordId: interaction.user.id, name: interaction.user.tag },
      target: { discordId: user.id, name: user.tag },
      reason: `${sub === 'add' ? 'Added to' : 'Removed from'} ${channel.name} allowlist`,
      color: sub === 'add' ? 0x22C55E : 0xF59E0B, logType: 'moderation.office', guildId: guild.id
    });
    return;
  }

  if (sub === 'unmanage') {
    await interaction.deferReply({ ephemeral: true });
    const channel = interaction.options.getChannel('channel');
    const office = getOffice(channel.id);
    if (!office) return interaction.editReply({ content: `❌ <#${channel.id}> isn't managed.` });

    deleteOffice(channel.id);

    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0xF59E0B).setTitle('🗑️ Unmanaged')
        .setDescription(`<#${channel.id}> is no longer managed.`)]
    });

    await logAction(interaction.client, {
      action: '🏢 Office Unmanaged',
      moderator: { discordId: interaction.user.id, name: interaction.user.tag },
      target: { discordId: channel.id, name: channel.name },
      reason: 'Channel removed from office management',
      color: 0xF59E0B, logType: 'moderation.office', guildId: guild.id
    });
    return;
  }

  if (sub === 'list') {
    await interaction.deferReply({ ephemeral: true });
    const offices = listOffices(guild.id);
    const feed = getRequestFeed(guild.id);
    const wrs = listWaitingRooms(guild.id);
    const officeLines = offices.length > 0
      ? offices.map(o => {
          const al = getAllowlist(o.channel_id);
          return `<#${o.channel_id}> — ${al.length} allowed${al.length ? ': ' + al.map(i => `<@${i}>`).join(', ') : ''}`;
        }).join('\n')
      : '*No managed channels.*';
    const wrLines = wrs.length > 0 ? wrs.map(w => `<#${w.channel_id}>`).join('\n') : '*None — run `/office waiting`*';
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🏢 Managed Offices')
        .setDescription(officeLines)
        .addFields(
          { name: 'Waiting rooms', value: wrLines, inline: false },
          { name: 'Request feed', value: feed ? `<#${feed}>` : '*Not set — run `/office feed`*', inline: false },
        )]
    });
    return;
  }

  if (sub === 'feed') {
    await interaction.deferReply({ ephemeral: true });
    const channel = interaction.options.getChannel('channel');
    setRequestFeed(guild.id, channel.id);
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0x22C55E).setTitle('✅ Request feed set')
        .setDescription(`Office access requests will be posted in <#${channel.id}>.`)]
    });
    await logAction(interaction.client, {
      action: '🏢 Office Request Feed Set',
      moderator: { discordId: interaction.user.id, name: interaction.user.tag },
      target: { discordId: channel.id, name: channel.name },
      reason: 'Set as request feed channel',
      color: 0x22C55E, logType: 'moderation.office', guildId: guild.id
    });
    return;
  }

  if (sub === 'waiting') {
    await interaction.deferReply({ ephemeral: true });
    const channel = interaction.options.getChannel('channel');
    upsertWaitingRoom(guild.id, channel.id, channel.name);
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0x22C55E).setTitle('✅ Waiting room registered')
        .setDescription(`<#${channel.id}> is now a waiting room. Anyone joining will trigger an access request in the feed channel.`)]
    });
    await logAction(interaction.client, {
      action: '🛎️ Office Waiting Room Set',
      moderator: { discordId: interaction.user.id, name: interaction.user.tag },
      target: { discordId: channel.id, name: channel.name },
      reason: 'Channel registered as office waiting room',
      color: 0x22C55E, logType: 'moderation.office', guildId: guild.id
    });
    return;
  }

  if (sub === 'unwaiting') {
    await interaction.deferReply({ ephemeral: true });
    const channel = interaction.options.getChannel('channel');
    deleteWaitingRoom(channel.id);
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0xF59E0B).setTitle('🗑️ Waiting room removed')
        .setDescription(`<#${channel.id}> is no longer a waiting room.`)]
    });
    await logAction(interaction.client, {
      action: '🛎️ Office Waiting Room Removed',
      moderator: { discordId: interaction.user.id, name: interaction.user.tag },
      target: { discordId: channel.id, name: channel.name },
      reason: 'Waiting room unregistered',
      color: 0xF59E0B, logType: 'moderation.office', guildId: guild.id
    });
    return;
  }
}
