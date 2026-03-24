import { EmbedBuilder } from 'discord.js';
import { LOG_CHANNEL_ID, MOD_LOG_CHANNEL_ID } from '../config.js';
import { getLogChannel, getGlobalLogChannel } from './botDb.js';

// Map log categories to their global channel keys
const GLOBAL_CHANNEL_MAP = {
  moderation: 'global_moderation',
  message: 'global_message',
  verification: 'global_verification',
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
      { name: 'Target', value: target ? (target.discordId === 'MULTIPLE' ? target.name : `<@${target.discordId || target}> ${target.name ? `(${target.name})` : ''}`) : 'Unknown', inline: true },
      { name: 'Moderator', value: moderator ? `<@${moderator.discordId || moderator}> ${moderator.name ? `(${moderator.name})` : ''}` : 'Unknown', inline: true },
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
}
