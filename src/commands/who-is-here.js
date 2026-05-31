// COMMAND_PERMISSION_FALLBACK: everyone
// Show who's currently in any voice channel in the current guild.
// Helpful for "is anyone around?" — saves clicking through channels
// in the sidebar.
import { SlashCommandBuilder, EmbedBuilder, ChannelType } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { getEffectiveAllServerIds } from '../config.js';
import { E } from '../lib/emoji.js';

export const data = new SlashCommandBuilder()
  .setName('who-is-here')
  .setDescription('Show who is currently in voice channels in this server')
  .addBooleanOption(opt => opt
    .setName('all_servers')
    .setDescription('Walk every CO guild instead of just this one'));

export async function execute(interaction) {
  const perm = await canUseCommand('who-is-here', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  const allServers = interaction.options.getBoolean('all_servers') || false;
  const client = interaction.client;
  const guildIds = allServers
    ? getEffectiveAllServerIds(client)
    : (interaction.guildId ? [interaction.guildId] : []);

  if (!guildIds.length) {
    return interaction.editReply({ content: `${E.cross} Run in a server (or pass all_servers).` });
  }

  const sections = []; // [{ guildName, channels: [{name, members: [...]}], totalPeople }]
  let grandTotal = 0;

  for (const gid of guildIds) {
    const guild = client.guilds.cache.get(gid) || await client.guilds.fetch(gid).catch(() => null);
    if (!guild) continue;

    // We need fresh voice state info. members.fetch ensures presences are in cache.
    await guild.members.fetch().catch(() => null);

    const channels = [...guild.channels.cache.values()]
      .filter(c => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice)
      .filter(c => c.members && c.members.size > 0)
      .sort((a, b) => (b.members?.size || 0) - (a.members?.size || 0));

    if (!channels.length) continue;

    const guildPeople = channels.reduce((s, c) => s + c.members.size, 0);
    grandTotal += guildPeople;

    sections.push({
      guildName: guild.name,
      total: guildPeople,
      channels: channels.map(c => ({
        name: c.name,
        members: [...c.members.values()].map(m => ({
          id: m.id,
          name: m.displayName || m.user.username,
          muted: m.voice.selfMute || m.voice.serverMute,
          deafened: m.voice.selfDeaf || m.voice.serverDeaf,
          stream: m.voice.streaming,
          camera: m.voice.selfVideo,
        })),
      })),
    });
  }

  if (grandTotal === 0) {
    return interaction.editReply({
      content: allServers
        ? `${E.suspend} No-one is in any voice channel across ${guildIds.length} CO guild${guildIds.length === 1 ? '' : 's'}.`
        : `${E.suspend} No-one is in voice in this server.`,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle(`${grandTotal} ${grandTotal === 1 ? 'person is' : 'people are'} in voice`)
    .setColor(0x22c55e)
    .setTimestamp();

  for (const sec of sections) {
    const lines = sec.channels.map(c => {
      const mems = c.members.map(m => {
        const flags = [];
        if (m.muted) flags.push(E.suspend);
        if (m.deafened) flags.push('(deaf)');
        if (m.stream) flags.push('(stream)');
        if (m.camera) flags.push('(cam)');
        return `<@${m.id}>${flags.length ? ` ${flags.join(' ')}` : ''}`;
      }).join(', ');
      return `**${c.name}** (${c.members.length})\n${mems}`;
    }).join('\n\n');

    embed.addFields({
      name: allServers ? `${sec.guildName} (${sec.total})` : `${sec.total} in voice`,
      value: `${E.member} ` + lines.slice(0, 1018),
      inline: false,
    });
  }

  embed.setFooter({
    text: allServers
      ? `Across ${sections.length} CO guild${sections.length === 1 ? '' : 's'} with people in voice`
      : (interaction.guild?.name || ''),
  });

  await interaction.editReply({ embeds: [embed] });
}
