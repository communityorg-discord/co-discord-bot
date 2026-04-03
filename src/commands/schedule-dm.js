import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canRunCommand } from '../utils/permissions.js';
import { db } from '../utils/botDb.js';
import { getUserByDiscordId } from '../db.js';

// Ensure scheduled_dms table exists
db.exec(`CREATE TABLE IF NOT EXISTS scheduled_dms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  subject TEXT,
  message TEXT NOT NULL,
  send_at DATETIME NOT NULL,
  sent INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

export const data = new SlashCommandBuilder()
  .setName('schedule-dm')
  .setDescription('Schedule a DM to be sent later')
  .addUserOption(opt => opt.setName('user').setDescription('The user to DM').setRequired(true))
  .addStringOption(opt => opt.setName('message').setDescription('The message to send').setRequired(true).setMaxLength(1900))
  .addStringOption(opt => opt.setName('when').setDescription('When to send: "2h", "30m", "1d", "tomorrow 9am"').setRequired(true))
  .addStringOption(opt => opt.setName('subject').setDescription('Optional subject line').setRequired(false));

function parseWhen(input) {
  const now = new Date();
  const lower = input.toLowerCase().trim();

  // Relative: "30m", "2h", "1d"
  const relMatch = lower.match(/^(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|weeks?)$/);
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

  // Day name: "monday 9am"
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

  const check = canRunCommand(interaction.user.id, 5);
  if (!check.allowed) {
    return interaction.editReply({ content: `❌ ${check.reason}` });
  }

  const targetUser = interaction.options.getUser('user');
  const message = interaction.options.getString('message');
  const whenStr = interaction.options.getString('when');
  const subject = interaction.options.getString('subject') || null;

  const sendAt = parseWhen(whenStr);
  if (!sendAt) {
    return interaction.editReply({ content: '❌ Could not parse the time. Use formats like `2h`, `30m`, `1d`, `tomorrow 9am`.' });
  }

  if (sendAt <= new Date()) {
    return interaction.editReply({ content: '❌ The scheduled time must be in the future.' });
  }

  // Max 30 days in advance
  if (sendAt - Date.now() > 30 * 24 * 60 * 60 * 1000) {
    return interaction.editReply({ content: '❌ Cannot schedule more than 30 days in advance.' });
  }

  const sendAtIso = sendAt.toISOString().replace('T', ' ').slice(0, 19);

  db.prepare(`
    INSERT INTO scheduled_dms (sender_id, recipient_id, subject, message, send_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(interaction.user.id, targetUser.id, subject, message, sendAtIso);

  const senderPortal = getUserByDiscordId(interaction.user.id);
  const senderName = senderPortal?.display_name || interaction.user.username;

  const embed = new EmbedBuilder()
    .setTitle('📨 DM Scheduled')
    .setColor(0x22C55E)
    .addFields(
      { name: 'Recipient', value: `<@${targetUser.id}>`, inline: true },
      { name: 'Send At', value: `<t:${Math.floor(sendAt.getTime() / 1000)}:F> (<t:${Math.floor(sendAt.getTime() / 1000)}:R>)`, inline: true },
      { name: 'Subject', value: subject || 'None', inline: true },
      { name: 'Message Preview', value: message.slice(0, 200) + (message.length > 200 ? '...' : ''), inline: false },
    )
    .setFooter({ text: `Scheduled by ${senderName} | Community Organisation` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
