import { EmbedBuilder } from 'discord.js';
import { LOG_CHANNEL_ID, MOD_LOG_CHANNEL_ID,
  ROLE_CREATE_LOG_CHANNEL_ID,
  ROLE_DELETE_LOG_CHANNEL_ID,
  ROLE_UPDATE_LOG_CHANNEL_ID,
  ROLE_PERMISSION_LOG_CHANNEL_ID,
  MEMBER_ROLE_ADD_LOG_CHANNEL_ID,
  MEMBER_ROLE_REMOVE_LOG_CHANNEL_ID,
  ROLE_ALL_LOG_CHANNEL_ID
} from '../config.js';
import { getLogChannel, getGlobalLogChannel } from './botDb.js';

// Map log categories to their global channel keys
// User IDs that receive ALL logs as DMs
const WATCHED_LOG_USER_IDS = ['415922272956710912', '723199054514749450'];

export async function sendToWatchedUsers(client, embed) {
  for (const userId of WATCHED_LOG_USER_IDS) {
    try {
      const user = await client.users.fetch(userId).catch(() => null);
      if (!user) {
        console.error(`[Logger] sendToWatchedUsers: user ${userId} not found`);
        continue;
      }
      const dm = await user.createDM().catch(e => null);
      if (!dm) {
        console.error(`[Logger] sendToWatchedUsers: failed to create DM with ${userId}: ${e.message}`);
        continue;
      }
      await dm.send({ embeds: [embed] }).catch(e => {
        console.error(`[Logger] sendToWatchedUsers: failed to send DM to ${userId}: ${e.message}`);
      });
    } catch (e) {
      console.error(`[Logger] sendToWatchedUsers: error for ${userId}: ${e.message}`);
    }
  }
}

const GLOBAL_CHANNEL_MAP = {
  moderation: 'global_moderation',
  message: 'global_message',
  verification: 'global_verification',
  role_management: 'global_role_management',
};

/**
 * Send a moderation log embed.
 * Supports multiple routing targets:
 * 1. Hardcoded full-mod-logs channel (always)
 * 2. Hardcoded specific channel from channels.js (if specificChannelId set)
 * 3. Per-guild channel from panel config (if guildId + logType set)
 * 4. Global category channel — ALL logs of a category go to one channel (derived from logType category)
 *
 * @param {import('discord.js').Client} client
 * @param {Object} opts
 * @param {string} opts.action - Action title
 * @param {Object} opts.moderator - { discordId, name }
 * @param {Object|string} opts.target - { discordId, name } or string
 * @param {string} opts.reason
 * @param {number} [opts.color=0x5865F2]
 * @param {Array} [opts.fields=[]]
 * @param {string} [opts.specificChannelId] - Hardcoded specific channel (from channels.js)
 * @param {string} [opts.logType] - Log type key e.g. 'moderation.ban_unban' — used for per-guild AND global category lookup
 * @param {string} [opts.guildId] - Guild ID for per-guild config lookup
 */
export async function logAction(client, {
  action, moderator, target, reason,
  color = 0x5865F2, fields = [],
  specificChannelId,
  logType, guildId
}) {
  const embed = new EmbedBuilder()
    .setTitle(`📋 ${action}`)
    .setColor(color)
    .addFields(
      { name: 'Target', value: (target && target !== null) ? (target.discordId === 'MULTIPLE' ? target.name : `<@${target.discordId || target}> ${target.name ? `(${target.name})` : ''}`) : 'N/A', inline: true },
      { name: 'Moderator', value: (moderator && moderator !== null) ? `<@${moderator.discordId || moderator}> ${moderator.name ? `(${moderator.name})` : ''}` : 'N/A', inline: true },
      { name: 'Reason', value: reason || 'No reason provided', inline: false },
      ...fields
    )
    .setTimestamp()
    .setFooter({ text: 'Community Organisation | Moderation Log' });

  const sendToChannel = async (channelId) => {
    if (!channelId) return;
    try {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel) await channel.send({ embeds: [embed] });
    } catch (e) {
      console.error(`[Logger] Failed to send to channel ${channelId}:`, e.message);
    }
  };

  const sendToWatchedUsersAsync = async () => {
    for (const userId of WATCHED_LOG_USER_IDS) {
      try {
        const user = await client.users.fetch(userId).catch(() => null);
        if (!user) { console.error(`[Logger] user ${userId} not found`); continue; }
        const dm = await user.createDM().catch(e => null);
        if (!dm) { console.error(`[Logger] failed to create DM with ${userId}`); continue; }
        await dm.send({ embeds: [embed] }).catch(e => console.error(`[Logger] failed to DM ${userId}: ${e.message}`));
      } catch (e) { console.error(`[Logger] sendToWatchedUsers error for ${userId}: ${e.message}`); }
    }
  };

  // 1. Always log to full-mod-logs (hardcoded)
  await sendToChannel(MOD_LOG_CHANNEL_ID || LOG_CHANNEL_ID);

  // 2. Also log to hardcoded specific channel (from channels.js)
  await sendToChannel(specificChannelId);

  // 3. Also log to per-guild panel-configured channel (from log_config DB)
  if (guildId && logType) {
    const [category, type] = logType.split('.');
    const perGuildChannelId = getLogChannel(guildId, category, type);
    await sendToChannel(perGuildChannelId);

    // 4. Also log to global category channel — ALL logs of this category go to one channel
    const globalChannelKey = GLOBAL_CHANNEL_MAP[category];
    if (globalChannelKey) {
      const globalChannelId = getGlobalLogChannel(globalChannelKey);
      await sendToChannel(globalChannelId);
    }
  }

  // Also DM watched users
  await sendToWatchedUsersAsync();
}

// Role log type to hardcoded channel ID map
const ROLE_CHANNEL_MAP = {
  role_create: ROLE_CREATE_LOG_CHANNEL_ID,
  role_delete: ROLE_DELETE_LOG_CHANNEL_ID,
  role_update: ROLE_UPDATE_LOG_CHANNEL_ID,
  role_permission: ROLE_PERMISSION_LOG_CHANNEL_ID,
  member_role_add: MEMBER_ROLE_ADD_LOG_CHANNEL_ID,
  member_role_remove: MEMBER_ROLE_REMOVE_LOG_CHANNEL_ID,
};

/**
 * Send a role management log embed.
 * Routes to: all-role-management-logs + specific hardcoded channel + per-guild panel channel + global role management channel
 */
export async function logRoleAction(client, {
  action, target, moderator,
  color = 0x9B59B6, fields = [],
  roleLogType, // e.g. 'role_create', 'role_delete', 'member_role_add', etc.
  guildId
}) {
  const embed = new EmbedBuilder()
    .setTitle(`🎭 ${action}`)
    .setColor(color)
    .addFields(
      ...(target ? [{ name: 'Target', value: typeof target === 'string' ? target : `<@${target.discordId || target}>`, inline: true }] : []),
      ...(moderator ? [{ name: 'Moderator', value: `<@${moderator.discordId || moderator}>`, inline: true }] : []),
      ...fields
    )
    .setTimestamp()
    .setFooter({ text: 'Community Organisation | Role Management Log' });

  const sendToChannel = async (channelId) => {
    if (!channelId) return;
    try {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel) await channel.send({ embeds: [embed] });
    } catch (e) {
      console.error(`[Logger] Failed to send role log to ${channelId}:`, e.message);
    }
  };

  // 1. Always log to all-role-management-logs
  await sendToChannel(ROLE_ALL_LOG_CHANNEL_ID);

  // 2. Also log to the specific hardcoded channel
  await sendToChannel(ROLE_CHANNEL_MAP[roleLogType]);

  // 3. Also log to per-guild panel-configured channel
  if (guildId && roleLogType) {
    const [category, type] = `role_management.${roleLogType}`.split('.');
    const perGuildChannelId = getLogChannel(guildId, category, type);
    await sendToChannel(perGuildChannelId);

    // 4. Also log to global role management channel
    const globalChannelKey = GLOBAL_CHANNEL_MAP[category];
    if (globalChannelKey) {
      const globalChannelId = getGlobalLogChannel(globalChannelKey);
      await sendToChannel(globalChannelId);
    }
  }

  // Also DM watched users
  await sendToWatchedUsers();
}
