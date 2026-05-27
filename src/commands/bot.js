// COMMAND_PERMISSION_FALLBACK: everyone
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { E } from '../lib/emoji.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
let cachedVersion = null;
function getBotVersion() {
  if (cachedVersion) return cachedVersion;
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'));
    cachedVersion = pkg.version || '0.0.0';
  } catch { cachedVersion = '?'; }
  return cachedVersion;
}

function fmtBytes(n) {
  const mb = n / (1024 * 1024);
  return mb < 1024 ? `${mb.toFixed(1)} MB` : `${(mb / 1024).toFixed(2)} GB`;
}

function fmtUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

const MAINTAINERS = [
  '723199054514749450', // dionm — Deputy Secretary-General
  '415922272956710912', // evans — Secretary-General
];

export const data = new SlashCommandBuilder()
  .setName('bot')
  .setDescription('Information about the CO Bot — version, uptime, servers, maintainers');

export async function execute(interaction) {
  const perm = await canUseCommand('bot', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });
  }

  await interaction.deferReply();

  const client = interaction.client;
  const procStart = Math.floor((Date.now() - process.uptime() * 1000) / 1000);
  const guilds = [...client.guilds.cache.values()];
  const totalMembers = guilds.reduce((s, g) => s + (g.memberCount || 0), 0);
  const guildList = guilds
    .sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0))
    .slice(0, 10)
    .map(g => `• ${g.name} — ${g.memberCount} members`)
    .join('\n') || '_None_';
  const moreGuilds = guilds.length > 10 ? `\n_+${guilds.length - 10} more_` : '';

  const mem = process.memoryUsage();
  const maintainerLines = MAINTAINERS.map(id => `<@${id}>`).join(' · ');

  const embed = new EmbedBuilder()
    .setTitle('CO Bot — system info')
    .setColor(0x5865F2)
    .setThumbnail(client.user.displayAvatarURL())
    .addFields(
      { name: 'Version', value: `\`v${getBotVersion()}\``, inline: true },
      { name: 'Uptime', value: `${fmtUptime(process.uptime())} (started <t:${procStart}:R>)`, inline: true },
      { name: 'Node', value: `\`${process.version}\``, inline: true },
      { name: 'Servers', value: String(guilds.length), inline: true },
      { name: 'Total members', value: String(totalMembers), inline: true },
      { name: 'Memory', value: `${fmtBytes(mem.rss)} RSS`, inline: true },
      { name: 'Top servers', value: guildList + moreGuilds, inline: false },
      { name: 'Maintainers', value: maintainerLines, inline: false },
    )
    .setFooter({ text: 'Community Organisation · Staff Assistant' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
