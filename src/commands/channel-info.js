// COMMAND_PERMISSION_FALLBACK: everyone
// Channel inspector — type, parent category, position, slowmode, permission
// overwrites count, message archive duration. The "@everyone can see this?"
// check at the bottom is the most useful bit for non-mod staff.
import { SlashCommandBuilder, EmbedBuilder, ChannelType, PermissionFlagsBits } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';

const TYPE_LABEL = {
  [ChannelType.GuildText]: 'Text',
  [ChannelType.GuildVoice]: 'Voice',
  [ChannelType.GuildCategory]: 'Category',
  [ChannelType.GuildAnnouncement]: 'Announcement',
  [ChannelType.GuildForum]: 'Forum',
  [ChannelType.GuildStageVoice]: 'Stage',
  [ChannelType.PublicThread]: 'Public Thread',
  [ChannelType.PrivateThread]: 'Private Thread',
  [ChannelType.AnnouncementThread]: 'Announcement Thread',
  [ChannelType.GuildMedia]: 'Media',
};

export const data = new SlashCommandBuilder()
  .setName('channel-info')
  .setDescription('Inspect a Discord channel — type, slowmode, permissions, parent, etc.')
  .addChannelOption(opt => opt.setName('channel').setDescription('Channel to inspect (defaults to current)').setRequired(false));

export async function execute(interaction) {
  const perm = await canUseCommand('channel-info', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  const ch = interaction.options.getChannel('channel') || interaction.channel;
  const g = interaction.guild;
  if (!ch || !g) return interaction.editReply({ content: '❌ Channel context required — run in a server.' });

  const everyoneRole = g.roles.everyone;
  const everyoneOverwrite = ch.permissionOverwrites?.cache?.get(everyoneRole.id);
  const everyoneCanRead = !everyoneOverwrite ||
    !everyoneOverwrite.deny.has(PermissionFlagsBits.ViewChannel);

  const overwriteCount = ch.permissionOverwrites?.cache?.size || 0;
  const slowmode = ch.rateLimitPerUser ? `${ch.rateLimitPerUser}s` : 'off';

  const parent = ch.parent ? `#${ch.parent.name}` : '_top-level_';
  const archive = ch.defaultAutoArchiveDuration
    ? `${ch.defaultAutoArchiveDuration} min thread auto-archive` : null;

  const embed = new EmbedBuilder()
    .setTitle(`#${ch.name}`)
    .setColor(everyoneCanRead ? 0x6366f1 : 0xf59e0b)
    .addFields(
      { name: 'ID', value: `\`${ch.id}\``, inline: true },
      { name: 'Type', value: TYPE_LABEL[ch.type] || `unknown(${ch.type})`, inline: true },
      { name: 'Position', value: String(ch.position ?? '—'), inline: true },
      { name: 'Parent', value: parent, inline: true },
      { name: 'Slowmode', value: slowmode, inline: true },
      { name: 'Created', value: `<t:${Math.floor(ch.createdTimestamp / 1000)}:R>`, inline: true },
      { name: 'Permission overwrites', value: String(overwriteCount), inline: true },
      { name: '@everyone can see', value: everyoneCanRead ? '✅ Yes (public to all members)' : '🔒 No (restricted)', inline: true },
    );
  if (archive) embed.addFields({ name: 'Threads', value: archive, inline: true });
  if (ch.topic) embed.addFields({ name: 'Topic', value: String(ch.topic).slice(0, 1024), inline: false });
  if (ch.bitrate) embed.addFields({ name: 'Bitrate', value: `${ch.bitrate / 1000}kbps`, inline: true });
  if (ch.userLimit) embed.addFields({ name: 'User limit', value: String(ch.userLimit), inline: true });

  embed.setFooter({ text: g.name }).setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}
