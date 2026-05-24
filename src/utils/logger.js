import { EmbedBuilder } from 'discord.js';
import { LOG_CHANNEL_ID, MOD_LOG_CHANNEL_ID,
  ROLE_CREATE_LOG_CHANNEL_ID,
  ROLE_DELETE_LOG_CHANNEL_ID,
  ROLE_UPDATE_LOG_CHANNEL_ID,
  ROLE_PERMISSION_LOG_CHANNEL_ID,
  MEMBER_ROLE_ADD_LOG_CHANNEL_ID,
  MEMBER_ROLE_REMOVE_LOG_CHANNEL_ID,
  ROLE_ALL_LOG_CHANNEL_ID,
  SUPERUSER_IDS,
} from '../config.js';
import { getLogChannel, getGlobalLogChannel, getLogChannelsForEvent } from './botDb.js';

// Watched log audience = the superuser set. Was previously a hardcoded
// 3-user list duplicated from config.js; now sourced from the same
// place so adding a new superuser auto-grants log DMs without two edits.
const WATCHED_LOG_USER_IDS = SUPERUSER_IDS;

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
// Render a { discordId, name } pair as a Discord mention only when the
// id is a real snowflake. Non-numeric ids like 'PORTAL' / 'SYSTEM' /
// 'MULTIPLE' were being emitted as literal "<@PORTAL>" which Discord
// can't resolve and displays as raw text. Also avoids the "<@id> (id)"
// double-print when the name fell back to the id itself.
function formatActor(actor, fallback = 'System') {
  if (!actor) return 'N/A';
  if (typeof actor === 'string') return actor;
  const id = actor.discordId ?? actor;
  const name = actor.name || '';
  const isSnowflake = typeof id === 'string' && /^\d{15,20}$/.test(id);
  if (isSnowflake) {
    return name && name !== id ? `<@${id}> (${name})` : `<@${id}>`;
  }
  // Pseudo-ids like 'PORTAL', 'SYSTEM', 'MULTIPLE', 'AUTOMATED'
  if (id && typeof id === 'string') {
    const label = id.charAt(0).toUpperCase() + id.slice(1).toLowerCase();
    return name || label;
  }
  return name || fallback;
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
 * THE single log emitter — every log in the bot funnels through here.
 * It sends `embed` to:
 *   1. any always-on hardcoded channels passed in `extraChannels`
 *   2. every channel bound to (category, type) via /logs / orglogs / panels
 *      (resolved by getLogChannelsForEvent)
 * …and then ALWAYS DMs the watched audience (Dion + Evan).
 *
 * That final DM is the guarantee: if a log goes through logEvent, it reaches
 * your DMs — no per-handler "remembered to DM" logic, no early-return gaps.
 *
 * @param {import('discord.js').Client} client
 * @param {Object} o
 * @param {import('discord.js').EmbedBuilder} o.embed
 * @param {string} [o.category]  e.g. 'message', 'moderation', 'membership'
 * @param {string} [o.type]      e.g. 'message_delete', 'member_join'
 * @param {string} [o.guildId]
 * @param {string[]} [o.extraChannels] hardcoded channel IDs to always include
 */
export async function logEvent(client, { embed, category, type, guildId, extraChannels = [] }) {
  const seen = new Set();
  const sendTo = async (channelId) => {
    if (!channelId || seen.has(channelId)) return;
    seen.add(channelId);
    try {
      const ch = await client.channels.fetch(channelId).catch(() => null);
      if (ch && ch.send) await ch.send({ embeds: [embed] });
    } catch (e) { console.error(`[logEvent] channel ${channelId}: ${e.message}`); }
  };
  for (const c of extraChannels) await sendTo(c);
  if (category && type) for (const c of getLogChannelsForEvent(guildId || '', category, type)) await sendTo(c);
  // The guarantee — always DM the watched audience.
  await sendToWatchedUsers(client, embed);
}

export async function logAction(client, {
  action, moderator, target, reason,
  color = 0x5865F2, fields = [],
  specificChannelId, logType, guildId,
}) {
  const embed = new EmbedBuilder()
    .setTitle(`📋 ${action}`)
    .setColor(color)
    .addFields(
      { name: 'Target', value: formatActor(target), inline: true },
      { name: 'Moderator', value: formatActor(moderator), inline: true },
      { name: 'Reason', value: reason || 'No reason provided', inline: false },
      ...fields
    )
    .setTimestamp()
    .setFooter({ text: 'Community Organisation | Moderation Log' });
  const [category, type] = (logType || '').split('.');
  await logEvent(client, { embed, category, type, guildId, extraChannels: [MOD_LOG_CHANNEL_ID || LOG_CHANNEL_ID, specificChannelId] });
}

/** Role management log — builds the embed, routes through logEvent. */
export async function logRoleAction(client, {
  action, target, moderator,
  color = 0x9B59B6, fields = [],
  roleLogType, guildId,
}) {
  const embed = new EmbedBuilder()
    .setTitle(`🎭 ${action}`)
    .setColor(color)
    .addFields(
      ...(target ? [{ name: 'Target', value: formatActor(target), inline: true }] : []),
      ...(moderator ? [{ name: 'Moderator', value: formatActor(moderator), inline: true }] : []),
      ...fields
    )
    .setTimestamp()
    .setFooter({ text: 'Community Organisation | Role Management Log' });
  await logEvent(client, { embed, category: 'role_management', type: roleLogType, guildId, extraChannels: [ROLE_ALL_LOG_CHANNEL_ID, ROLE_CHANNEL_MAP[roleLogType]] });
}
