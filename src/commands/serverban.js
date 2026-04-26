// COMMAND_PERMISSION_FALLBACK: auth_level >= 5
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { addInfraction } from '../utils/botDb.js';
import { logAction } from '../utils/logger.js';
import { MOD_LOG_CHANNEL_ID } from '../config.js';
import { getUserByDiscordId } from '../db.js';
import { resolveUser } from '../utils/resolveUser.js';

function parseDuration(str) {
  if (!str) return null;
  str = str.trim().toLowerCase();
  const unitMultipliers = {
    seconds: 1000, second: 1000, s: 1000,
    minutes: 60000, minute: 60000, m: 60000,
    hours: 3600000, hour: 3600000, h: 3600000,
    days: 86400000, day: 86400000, d: 86400000,
  };
  const pattern = /(?:(\d+)\s*(?:second(?:s)?|minute(?:s)?|hours?|hour|days?|d|h|m|s))/gi;
  let totalMs = 0;
  let found = false;
  for (const match of str.matchAll(pattern)) {
    const num = parseInt(match[1]);
    const unitStr = match[0].replace(/\d+/g, '').trim();
    const unitLower = unitStr.toLowerCase();
    const unit = unitLower.endsWith('s') ? unitLower.slice(0, -1) : unitLower;
    const multiplier = unitMultipliers[unit] || unitMultipliers[unitLower];
    if (multiplier && !isNaN(num)) {
      totalMs += num * multiplier;
      found = true;
    }
  }
  return found && totalMs > 0 ? totalMs : null;
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days} day${days !== 1 ? 's' : ''}`;
  if (hours > 0) return `${hours} hour${hours !== 1 ? 's' : ''}`;
  if (minutes > 0) return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  return `${seconds} second${seconds !== 1 ? 's' : ''}`;
}

// Renamed to /serverban so it stops colliding with /ban (which is the
// global cross-guild ban defined in ban.js). Both files used to register
// data.name = 'ban', so only one survived Discord's slash-command upsert
// at a time — depending on filesystem load order the wrong handler would
// run. /serverban is the single-server scope; /ban is the global one.
export const data = new SlashCommandBuilder()
  .setName('serverban')
  .setDescription('Ban a user from THIS server only (single-guild scope)')
  .addStringOption(opt => opt.setName('user').setDescription('User to ban (@mention or user ID)').setRequired(true))
  .addStringOption(opt => opt.setName('duration').setDescription('Duration for temp ban: 1d, 7d (omit for permanent)').setRequired(false))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for the ban').setRequired(false))
  .addIntegerOption(opt => opt.setName('delete_messages').setDescription('Delete message history: 0–7 days').setRequired(false));

export async function execute(interaction) {
  const perm = await canUseCommand('serverban', interaction);
  if (!perm.allowed) return interaction.reply({ content: `❌ ${perm.reason}` });

  const userArg = interaction.options.getString('user');
  const durationStr = interaction.options.getString('duration');
  const reason = interaction.options.getString('reason') || 'Not specified';
  const deleteDays = interaction.options.getInteger('delete_messages') ?? 0;

  if (!interaction.inGuild()) {
    return interaction.reply({ content: '❌ This command cannot be used in DMs.' });
  }

  if (deleteDays < 0 || deleteDays > 7) {
    return interaction.reply({ content: '❌ Delete messages must be between 0 and 7 days.' });
  }

  const resolved = await resolveUser(userArg, interaction.guild);
  if (!resolved) {
    return interaction.reply({ content: `❌ Could not find user: ${userArg}. Use @mention or a user ID.` });
  }
  const { id: targetId, user: target } = resolved;

  const portalUser = getUserByDiscordId(targetId);
  const targetName = portalUser?.display_name || target.username;

  // Check if already banned
  try {
    await interaction.guild.bans.fetch(targetId);
    return interaction.reply({ content: `❌ <@${targetId}> is already banned from this server.` });
  } catch {}

  const isTempBan = !!durationStr;
  let durationMs = null;
  if (isTempBan) {
    durationMs = parseDuration(durationStr);
    if (!durationMs || durationMs < 60000) {
      return interaction.reply({ content: '❌ Minimum temp ban duration is 1 minute. Use formats like: 1d, 7d, 12h, 30m' });
    }
    if (durationMs > 604800000) {
      return interaction.reply({ content: '❌ Maximum temp ban duration is 7 days.' });
    }
  }

  await interaction.deferReply();

  const auditReason = `${reason}${isTempBan ? ` | Temp: ${durationStr}` : ''} | Banned by ${interaction.user.username}`;

  try {
    await interaction.guild.bans.create(targetId, {
      reason: auditReason,
      deleteMessageSeconds: deleteDays * 86400,
    });
  } catch (err) {
    return interaction.editReply({ content: `❌ Failed to ban <@${targetId}>: ${err.message}` });
  }

  const inf = addInfraction(targetId, isTempBan ? 'temp_ban' : 'ban', reason, interaction.user.id, interaction.user.username);

  try {
    await target.send({
      embeds: [new EmbedBuilder()
        .setTitle(isTempBan ? '⏱️ You Have Been Temporarily Banned' : '🔨 You Have Been Banned')
        .setColor(0xEF4444)
        .setDescription(`You have been banned from **${interaction.guild.name}**.`)
        .addFields(
          { name: '📋 Reason', value: reason, inline: false },
          ...(isTempBan ? [{ name: '⏱️ Duration', value: formatDuration(durationMs), inline: true }, { name: 'Expires', value: `<t:${Math.floor((Date.now() + durationMs) / 1000)}:R>`, inline: true }] : []),
          { name: 'Banned By', value: `<@${interaction.user.id}>`, inline: true },
        )
        .setFooter({ text: 'Community Organisation | Staff Assistant' })
        .setTimestamp()
      ]
    });
  } catch {}

  await logAction(interaction.client, {
    action: `${isTempBan ? '⏱️ Temporary Ban' : '🔨 User Banned'}`,
    moderator: { discordId: interaction.user.id, name: interaction.user.username },
    target: { discordId: targetId, name: targetName },
    reason,
    color: 0xEF4444,
    fields: [
      { name: 'User', value: `<@${targetId}>`, inline: true },
      { name: 'Server', value: interaction.guild.name, inline: true },
      { name: 'Duration', value: isTempBan ? formatDuration(durationMs) : 'Permanent', inline: true },
      { name: 'Messages Deleted', value: deleteDays > 0 ? `${deleteDays} day${deleteDays !== 1 ? 's' : ''}` : 'None', inline: true },
      { name: 'Reason', value: reason, inline: false },
    ],
    specificChannelId: MOD_LOG_CHANNEL_ID,
    guildId: interaction.guildId,
    logType: 'moderation.ban',
  });

  const unbanTs = isTempBan ? Math.floor((Date.now() + durationMs) / 1000) : null;

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle(isTempBan ? '⏱️ User Temporarily Banned' : '🔨 User Banned')
      .setColor(0xEF4444)
      .setDescription(`**${targetName}** has been banned from this server.`)
      .addFields(
        { name: 'User', value: `<@${targetId}>`, inline: true },
        { name: 'Duration', value: isTempBan ? formatDuration(durationMs) : 'Permanent', inline: true },
        { name: 'Messages Deleted', value: deleteDays > 0 ? `${deleteDays} day${deleteDays !== 1 ? 's' : ''}` : 'None', inline: true },
        { name: 'Reason', value: reason, inline: false },
        { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Case ID', value: `#${inf.lastInsertRowid}`, inline: true },
        ...(isTempBan ? [{ name: 'Auto-Unban', value: `<t:${unbanTs}:R>`, inline: true }] : []),
      )
      .setFooter({ text: 'Community Organisation | Staff Assistant' })
      .setTimestamp()
    ]
  });

  // Schedule auto-unban for temp bans
  if (isTempBan) {
    setTimeout(async () => {
      try {
        await interaction.guild.members.unban(targetId, `Temporary ban (${durationStr}) expired.`);
        await logAction(interaction.client, {
          action: '✅ Temp Ban Expired — Auto Unbanned',
          moderator: { discordId: 'SYSTEM', name: 'Auto (Duration Expired)' },
          target: { discordId: targetId, name: targetName },
          reason: `Temp ban (${durationStr}) expired. Originally banned by <@${interaction.user.id}>`,
          color: 0x22C55E,
          fields: [
            { name: 'Duration', value: formatDuration(durationMs), inline: true },
            { name: 'Server', value: interaction.guild.name, inline: true },
          ],
          specificChannelId: MOD_LOG_CHANNEL_ID,
          guildId: interaction.guildId,
          logType: 'moderation.ban',
        });
      } catch {}
    }, durationMs);
  }
}
