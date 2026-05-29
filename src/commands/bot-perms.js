// COMMAND_PERMISSION_FALLBACK: auth_level >= 5
// Diagnose missing bot permissions per-channel in the current guild.
// When staff report "the bot didn't post in #X", run this — it lists
// every channel where the bot is missing a critical perm (View, Send,
// Embed Links, Attach Files, Manage Messages where relevant). Sorted
// worst-first.
import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { E } from '../lib/emoji.js';

// Perms we consider critical for the bot to function in a text-like channel
const TEXT_PERMS = [
  ['ViewChannel', PermissionFlagsBits.ViewChannel],
  ['SendMessages', PermissionFlagsBits.SendMessages],
  ['EmbedLinks', PermissionFlagsBits.EmbedLinks],
  ['AttachFiles', PermissionFlagsBits.AttachFiles],
  ['ReadMessageHistory', PermissionFlagsBits.ReadMessageHistory],
  ['UseExternalEmojis', PermissionFlagsBits.UseExternalEmojis],
  ['AddReactions', PermissionFlagsBits.AddReactions],
];

// Mod-tier perms — only flagged where missing in a logs/mod channel
const MOD_PERMS = [
  ['ManageMessages', PermissionFlagsBits.ManageMessages],
  ['ManageThreads', PermissionFlagsBits.ManageThreads],
];

const VOICE_PERMS = [
  ['ViewChannel', PermissionFlagsBits.ViewChannel],
  ['Connect', PermissionFlagsBits.Connect],
  ['Speak', PermissionFlagsBits.Speak],
  ['MoveMembers', PermissionFlagsBits.MoveMembers],
];

export const data = new SlashCommandBuilder()
  .setName('bot-perms')
  .setDescription('Audit missing bot permissions per-channel in this server')
  .addBooleanOption(opt => opt
    .setName('include_ok')
    .setDescription('Show channels where the bot has all expected perms (default: only show problems)'));

export async function execute(interaction) {
  const perm = await canUseCommand('bot-perms', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild;
  if (!guild) return interaction.editReply({ content: `${E.cross} Run in a server.` });

  const includeOk = interaction.options.getBoolean('include_ok') || false;

  const me = await guild.members.fetchMe();
  const channels = await guild.channels.fetch();

  let totalChecked = 0;
  let totalProblems = 0;
  const problemLines = [];
  const okLines = [];

  for (const [, ch] of channels) {
    if (!ch) continue;
    const isText = [
      ChannelType.GuildText,
      ChannelType.GuildAnnouncement,
      ChannelType.GuildForum,
      ChannelType.GuildMedia,
    ].includes(ch.type);
    const isVoice = [ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(ch.type);
    if (!isText && !isVoice) continue;

    totalChecked++;
    const myPerms = ch.permissionsFor(me);
    if (!myPerms) continue;

    const checks = isText ? TEXT_PERMS : VOICE_PERMS;
    const isLogChannel = isText && /log|audit|report/i.test(ch.name);
    const fullChecks = isLogChannel ? [...checks, ...MOD_PERMS] : checks;

    const missing = fullChecks.filter(([, flag]) => !myPerms.has(flag)).map(([name]) => name);

    if (missing.length) {
      totalProblems++;
      const sev = missing.includes('ViewChannel') || missing.includes('SendMessages') ? E.cross : E.warning;
      problemLines.push({
        sev,
        channelType: '#',
        text: `${sev} #${ch.name} — missing: ${missing.join(', ')}`,
      });
    } else if (includeOk) {
      okLines.push(`${E.check} #${ch.name}`);
    }
  }

  // Critical-first sort
  problemLines.sort((a, b) => (a.sev === E.cross ? 0 : 1) - (b.sev === E.cross ? 0 : 1));

  const embed = new EmbedBuilder()
    .setTitle(`Bot perms audit — ${guild.name}`)
    .setColor(totalProblems === 0 ? 0x22c55e : (problemLines.some(p => p.sev === E.cross) ? 0xef4444 : 0xf59e0b))
    .setDescription(
      totalProblems === 0
        ? `${E.check} Bot has all expected perms across ${totalChecked} channel${totalChecked === 1 ? '' : 's'}.`
        : `${E.warning} ${totalProblems} of ${totalChecked} channels have missing perms.`
    );

  if (problemLines.length) {
    const chunks = [];
    let cur = '';
    for (const p of problemLines) {
      if (cur.length + p.text.length + 1 > 1024) { chunks.push(cur); cur = ''; }
      cur += (cur ? '\n' : '') + p.text;
    }
    if (cur) chunks.push(cur);
    chunks.slice(0, 5).forEach((c, i) => {
      embed.addFields({ name: i === 0 ? 'Problems' : `Problems (cont. ${i + 1})`, value: c, inline: false });
    });
    if (chunks.length > 5) {
      embed.addFields({ name: '…', value: `(+${chunks.length - 5} more pages truncated)`, inline: false });
    }
  }

  if (includeOk && okLines.length) {
    const okText = okLines.join(', ').slice(0, 1024);
    embed.addFields({ name: `Healthy (${okLines.length})`, value: okText, inline: false });
  }

  embed.setFooter({ text: `Bot: ${me.user.username} · Run /server-health for cross-guild audit` }).setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}
