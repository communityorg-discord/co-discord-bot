// COMMAND_PERMISSION_FALLBACK: everyone
// COMMAND_PERMISSION_FALLBACK: auth_level >= 4;option=target=other-user
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { db } from '../utils/botDb.js';
import { canUseCommand } from '../utils/permissions.js';

export const data = new SlashCommandBuilder()
  .setName('remind')
  .setDescription('Set a reminder — DMs you (or someone else) at the specified time')
  .addStringOption(opt => opt.setName('time').setDescription('When to remind: "30 minutes", "2 hours", "tomorrow 9am", "Sunday 12pm"').setRequired(true))
  .addStringOption(opt => opt.setName('message').setDescription('What to remind about').setRequired(true))
  .addUserOption(opt => opt.setName('target').setDescription('Who to remind (default: yourself, auth 4+ for others)').setRequired(false));

function parseTime(input) {
  const now = new Date();
  const lower = input.toLowerCase().trim();

  // Relative: "30 minutes", "2 hours", "3 days"
  const relMatch = lower.match(/^(\d+)\s*(minute|minutes|min|mins|m|hour|hours|hr|hrs|h|day|days|d|week|weeks|w)$/);
  if (relMatch) {
    const num = parseInt(relMatch[1]);
    const unit = relMatch[2].charAt(0);
    const d = new Date(now);
    if (unit === 'm') d.setMinutes(d.getMinutes() + num);
    else if (unit === 'h') d.setHours(d.getHours() + num);
    else if (unit === 'd') d.setDate(d.getDate() + num);
    else if (unit === 'w') d.setDate(d.getDate() + num * 7);
    return d;
  }

  // "tomorrow" or "tomorrow 9am"
  const tomorrowMatch = lower.match(/^tomorrow(?:\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/);
  if (tomorrowMatch) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    let hour = tomorrowMatch[1] ? parseInt(tomorrowMatch[1]) : 9;
    const min = tomorrowMatch[2] ? parseInt(tomorrowMatch[2]) : 0;
    const ampm = tomorrowMatch[3];
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    d.setHours(hour, min, 0, 0);
    return d;
  }

  // Day name: "sunday 12pm", "monday 9am"
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayMatch = lower.match(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/);
  if (dayMatch) {
    const targetDay = dayNames.indexOf(dayMatch[1]);
    const d = new Date(now);
    let daysAhead = targetDay - d.getDay();
    if (daysAhead <= 0) daysAhead += 7;
    d.setDate(d.getDate() + daysAhead);
    let hour = dayMatch[2] ? parseInt(dayMatch[2]) : 9;
    const min = dayMatch[3] ? parseInt(dayMatch[3]) : 0;
    const ampm = dayMatch[4];
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    d.setHours(hour, min, 0, 0);
    return d;
  }

  // Try direct date parse
  const parsed = new Date(input);
  if (!isNaN(parsed.getTime()) && parsed > now) return parsed;

  return null;
}

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const perm = await canUseCommand('remind', interaction);
  if (!perm.allowed) {
    return interaction.editReply({ content: `❌ ${perm.reason}` });
  }

  const timeStr = interaction.options.getString('time');
  const message = interaction.options.getString('message');
  const targetUser = interaction.options.getUser('target') || interaction.user;

  // Auth check for reminding others
  if (targetUser.id !== interaction.user.id) {
    const otherPerm = await canUseCommand('remind:other', interaction);
    if (!otherPerm.allowed) {
      return interaction.editReply({ content: `❌ ${otherPerm.reason}` });
    }
  }

  const remindAt = parseTime(timeStr);
  if (!remindAt) {
    return interaction.editReply({ content: '❌ Could not parse time. Use formats like: `30 minutes`, `2 hours`, `tomorrow 9am`, `Sunday 12pm`' });
  }

  if (remindAt.getTime() - Date.now() < 60000) {
    return interaction.editReply({ content: '❌ Reminder must be at least 1 minute in the future.' });
  }

  db.prepare(
    'INSERT INTO reminders (requester_discord_id, target_discord_id, guild_id, channel_id, message, remind_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(interaction.user.id, targetUser.id, interaction.guildId || null, interaction.channelId || null, message, remindAt.toISOString());

  const formatted = `<t:${Math.floor(remindAt.getTime() / 1000)}:F>`;
  const targetText = targetUser.id === interaction.user.id ? 'you' : `<@${targetUser.id}>`;

  await interaction.editReply({ content: `✅ Reminder set for ${formatted}. I'll DM ${targetText} with your message.` });
}
