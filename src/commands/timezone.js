// COMMAND_PERMISSION_FALLBACK: everyone
// Show current time in a small set of common staff timezones, with an
// optional offset (e.g. "in 4h" → what time is it then in each zone).
// Useful for cross-timezone meeting scheduling without leaving Discord.
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { E } from '../lib/emoji.js';

const ZONES = [
  { label: 'UTC',           tz: 'UTC' },
  { label: 'London',        tz: 'Europe/London' },
  { label: 'Berlin',        tz: 'Europe/Berlin' },
  { label: 'New York',      tz: 'America/New_York' },
  { label: 'Los Angeles',   tz: 'America/Los_Angeles' },
  { label: 'Sydney',        tz: 'Australia/Sydney' },
  { label: 'Tokyo',         tz: 'Asia/Tokyo' },
  { label: 'Mumbai',        tz: 'Asia/Kolkata' },
];

function fmt(date, tz) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

export const data = new SlashCommandBuilder()
  .setName('timezone')
  .setDescription('Show current time in common staff timezones')
  .addStringOption(opt => opt
    .setName('offset')
    .setDescription('Optional offset like "in 4h", "in 30m", "in 2d"')
    .setMaxLength(30));

export async function execute(interaction) {
  const perm = await canUseCommand('timezone', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });
  }

  const offset = (interaction.options.getString('offset') || '').trim().toLowerCase();
  let when = new Date();
  let header = 'now';

  if (offset) {
    const m = offset.match(/in\s+(\d+)\s*(m|min|mins|minutes|h|hr|hrs|hours|d|day|days)/);
    if (!m) {
      return interaction.reply({ content: `${E.cross} Offset must look like \`in 4h\`, \`in 30m\`, or \`in 2d\`.`, ephemeral: true });
    }
    const n = Number(m[1]);
    const unit = m[2];
    let ms = 0;
    if (unit.startsWith('m')) ms = n * 60_000;
    else if (unit.startsWith('h')) ms = n * 3600_000;
    else if (unit.startsWith('d')) ms = n * 86_400_000;
    when = new Date(Date.now() + ms);
    header = `in ${n}${unit.startsWith('m') ? 'min' : unit.startsWith('h') ? 'h' : 'd'}`;
  }

  const lines = ZONES.map(z =>
    `**${z.label}** — ${fmt(when, z.tz)}`
  ).join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`World clock — ${header}`)
    .setColor(0x6366f1)
    .setDescription(`${E.calendar} ${lines}`)
    .setFooter({ text: `Discord-relative: <t:${Math.floor(when.getTime() / 1000)}:F>` });

  await interaction.reply({
    embeds: [embed],
    content: `Discord auto-time: <t:${Math.floor(when.getTime() / 1000)}:F> (renders in your local zone)`,
    ephemeral: true,
  });
}
