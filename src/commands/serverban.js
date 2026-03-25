import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canRunCommand } from '../utils/permissions.js';
import { addInfraction } from '../utils/botDb.js';
import { logAction } from '../utils/logger.js';
import { MOD_LOG_CHANNEL_ID } from '../config.js';
import { getUserByDiscordId } from '../db.js';

function parseDuration(str) {
  if (!str) return null;
  const match = str.match(/^(\d+)([smhd])$/);
  if (!match) return null;
  const value = parseInt(match[1]);
  const unit = match[2];
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return value * multipliers[unit];
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

export const data = new SlashCommandBuilder()
  .setName('serverban')
  .setDescription('Ban a user from this server only')
  .addUserOption(opt => opt.setName('user').setDescription('User to ban').setRequired(true))
  .addStringOption(opt => opt.setName('duration').setDescription('Duration for temp ban: 1d, 7d (omit for permanent)').setRequired(false))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for the ban').setRequired(false))
  .addIntegerOption(opt => opt.setName('delete_messages').setDescription('Delete message history: 0–7 days').setRequired(false));

export async function execute(interaction) {
  const perm = await canRunCommand(interaction.user.id, 5);
  if (!perm.allowed) return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });

  const target = interaction.options.getUser('user');
  const durationStr = interaction.options.getString('duration');
  const reason = interaction.options.getString('reason') || 'Not specified';
  const deleteDays = interaction.options.getInteger('delete_messages') ?? 0;

  if (!interaction.inGuild()) {
    return interaction.reply({ content: '❌ This command cannot be used in DMs.', ephemeral: true });
  }

  if (deleteDays < 0 || deleteDays > 7) {
    return interaction.reply({ content: '❌ Delete messages must be between 0 and 7 days.', ephemeral: true });
  }

  const portalUser = getUserByDiscordId(target.id);
  const targetName = portalUser?.display_name || target.username;
  const member = await interaction.guild.members.fetch(target.id).catch(() => null);

  // Check if already banned
  try {
    await interaction.guild.bans.fetch(target.id);
    return interaction.reply({ content: `❌ <@${target.id}> is already banned from this server.`, ephemeral: true });
  } catch {}

  const isTempBan = !!durationStr;
  let durationMs = null;
  if (isTempBan) {
    durationMs = parseDuration(durationStr);
    if (!durationMs || durationMs < 60000) {
      return interaction.reply({ content: '❌ Minimum temp ban duration is 1 minute. Use format: 1d, 7d, 12h, 30m', ephemeral: true });
    }
    if (durationMs > 604800000) {
      return interaction.reply({ content: '❌ Maximum temp ban duration is 7 days.', ephemeral: true });
    }
  }

  await interaction.deferReply();

  // Create audit reason string
  const auditReason = `${reason}${isTempBan ? ` | Temp: ${durationStr}` : ''} | Banned by ${interaction.user.username}`;

  // Ban options
  const banOptions = {
    reason: auditReason,
    deleteMessageSeconds: deleteDays * 86400,
  };

  try {
    await interaction.guild.bans.create(target.id, banOptions);
  } catch (err) {
    return interaction.editReply({ content: `❌ Failed to ban <@${target.id}>: ${err.message}` });
  }

  const inf = addInfraction(target.id, isTempBan ? 'temp_ban' : 'ban', reason, interaction.user.id, interaction.user.username);

  // DM the user
  try {
    const dmEmbed = new EmbedBuilder()
      .setTitle(isTempBan ? '⏱️ You Have Been Temporarily Banned' : '🔨 You Have Been Banned')
      .setColor(0xEF4444)
      .setDescription(`You have been banned from **${interaction.guild.name}**.`)
      .addFields(
        { name: '📋 Reason', value: reason, inline: false },
        ...(isTempBan ? [{ name: '⏱️ Duration', value: formatDuration(durationMs), inline: true }, { name: 'Expires', value: `<t:${Math.floor((Date.now() + durationMs) / 1000)}:R>`, inline: true }] : []),
        { name: 'Banned By', value: `<@${interaction.user.id}>`, inline: true },
      )
      .setFooter({ text: 'Community Organisation | Staff Assistant' })
      .setTimestamp();
    await target.send({ embeds: [dmEmbed] });
  } catch {}

  // Log
  await logAction(interaction.client, {
    action: `${isTempBan ? '⏱️ Temporary Ban' : '🔨 User Banned'}`,
    moderator: { discordId: interaction.user.id, name: interaction.user.username },
    target: { discordId: target.id, name: targetName },
    reason,
    color: 0xEF4444,
    fields: [
      { name: 'User', value: `<@${target.id}>`, inline: true },
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
        { name: 'User', value: `<@${target.id}>`, inline: true },
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
        await interaction.guild.members.unban(target.id, `Temporary ban (${durationStr}) expired.`);
        await logAction(interaction.client, {
          action: '✅ Temp Ban Expired — Auto Unbanned',
          moderator: { discordId: 'SYSTEM', name: 'Auto (Duration Expired)' },
          target: { discordId: target.id, name: targetName },
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
