// COMMAND_PERMISSION_FALLBACK: everyone
// Bot ↔ Discord ↔ portal latency check. Useful when staff suspect
// the bot is slow / unreachable, or when triaging a portal incident.
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { E } from '../lib/emoji.js';

export const data = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Show bot, Discord gateway, and portal latency');

const PORTAL_URL = process.env.PORTAL_HEALTH_URL || 'http://localhost:3016/api/health';

export async function execute(interaction) {
  const perm = await canUseCommand('ping', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });
  }
  const sentAt = Date.now();
  await interaction.deferReply({ ephemeral: true });

  const replyLatency = Date.now() - sentAt;
  const gatewayPing = interaction.client.ws.ping;

  // Portal probe with a short timeout
  let portalLatency = null;
  let portalError = null;
  try {
    const t0 = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(PORTAL_URL, { signal: ctrl.signal });
    clearTimeout(timer);
    portalLatency = Date.now() - t0;
    if (!r.ok) portalError = `HTTP ${r.status}`;
  } catch (e) {
    portalError = e.name === 'AbortError' ? 'timeout (>3s)' : e.message;
  }

  const fmtMs = (ms) => ms == null ? '—' : `${ms}ms`;
  const colour = (gatewayPing > 0 && gatewayPing < 200) && (portalLatency != null && portalLatency < 1000)
    ? 0x22c55e
    : (portalError ? 0xef4444 : 0xf59e0b);

  const embed = new EmbedBuilder()
    .setTitle('Pong')
    .setColor(colour)
    .addFields(
      { name: 'Discord gateway', value: gatewayPing >= 0 ? fmtMs(gatewayPing) : '_unknown_', inline: true },
      { name: 'Bot reply', value: fmtMs(replyLatency), inline: true },
      { name: 'Portal API', value: portalError ? `${E.cross} ${portalError}` : fmtMs(portalLatency), inline: true },
      { name: 'Bot uptime', value: humanUptime(process.uptime()), inline: true },
      { name: 'Guilds', value: String(interaction.client.guilds.cache.size), inline: true },
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

function humanUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
