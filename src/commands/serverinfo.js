// COMMAND_PERMISSION_FALLBACK: everyone
// Comprehensive guild overview — member counts by status, channel counts
// by type, role count, owner, creation date, boost level. Replaces the
// "click around in Server Settings" workflow when staff want a quick read.
import { SlashCommandBuilder, EmbedBuilder, ChannelType } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { E } from '../lib/emoji.js';

export const data = new SlashCommandBuilder()
  .setName('serverinfo')
  .setDescription('Comprehensive info about the current Discord server');

export async function execute(interaction) {
  const perm = await canUseCommand('serverinfo', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  const g = interaction.guild;
  if (!g) return interaction.editReply({ content: `${E.cross} Run in a server.` });

  const channels = await g.channels.fetch();
  const counts = {
    text: 0, voice: 0, category: 0, announcement: 0, forum: 0, stage: 0, thread: 0, other: 0,
  };
  for (const [, ch] of channels) {
    switch (ch.type) {
      case ChannelType.GuildText:               counts.text++; break;
      case ChannelType.GuildVoice:              counts.voice++; break;
      case ChannelType.GuildCategory:           counts.category++; break;
      case ChannelType.GuildAnnouncement:       counts.announcement++; break;
      case ChannelType.GuildForum:              counts.forum++; break;
      case ChannelType.GuildStageVoice:         counts.stage++; break;
      case ChannelType.PublicThread:
      case ChannelType.PrivateThread:
      case ChannelType.AnnouncementThread:      counts.thread++; break;
      default: counts.other++;
    }
  }

  // Member presence breakdown — relies on GuildPresences intent (already on)
  await g.members.fetch().catch(() => null);
  const presence = { online: 0, idle: 0, dnd: 0, offline: 0, bots: 0 };
  for (const [, m] of g.members.cache) {
    if (m.user.bot) { presence.bots++; continue; }
    const s = m.presence?.status || 'offline';
    if (s in presence) presence[s]++;
    else presence.offline++;
  }
  const humans = g.memberCount - presence.bots;

  const owner = await g.fetchOwner().catch(() => null);
  const boostLevel = g.premiumTier; // 0 = none, 1 = lvl 1, etc.
  const boostCount = g.premiumSubscriptionCount || 0;

  const channelLine = [
    counts.category && `${counts.category} categor${counts.category === 1 ? 'y' : 'ies'}`,
    counts.text && `${counts.text} text`,
    counts.voice && `${counts.voice} voice`,
    counts.announcement && `${counts.announcement} announcement`,
    counts.forum && `${counts.forum} forum`,
    counts.stage && `${counts.stage} stage`,
    counts.thread && `${counts.thread} thread`,
  ].filter(Boolean).join(' · ') || '_no channels_';

  const presenceLine = `Online ${presence.online} · Idle ${presence.idle} · DND ${presence.dnd} · Offline ${presence.offline}${presence.bots ? ` · ${E.bot} ${presence.bots}` : ''}`;

  const embed = new EmbedBuilder()
    .setTitle(`${g.name}`)
    .setColor(0x6366f1)
    .setThumbnail(g.iconURL() || null)
    .addFields(
      { name: 'ID', value: `${E.server} \`${g.id}\``, inline: true },
      { name: 'Created', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:R>`, inline: true },
      { name: 'Owner', value: owner ? `<@${owner.id}>` : `\`${g.ownerId}\``, inline: true },
      { name: 'Members', value: `**${g.memberCount}** total · ${humans} human · ${presence.bots} bot`, inline: false },
      { name: 'Presence', value: presenceLine, inline: false },
      { name: 'Channels', value: channelLine, inline: false },
      { name: 'Roles', value: String(g.roles.cache.size), inline: true },
      { name: 'Boost level', value: `Tier ${boostLevel} (${boostCount} boost${boostCount === 1 ? '' : 's'})`, inline: true },
      { name: 'Vanity', value: g.vanityURLCode ? `discord.gg/${g.vanityURLCode}` : 'none', inline: true },
    );
  if (g.description) embed.setDescription(g.description);
  embed.setFooter({ text: `Run /server-health for the per-guild role + AutoMod audit` }).setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
