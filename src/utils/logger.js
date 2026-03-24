import { EmbedBuilder } from 'discord.js';
import { LOG_CHANNEL_ID, MOD_LOG_CHANNEL_ID } from '../config.js';
import { getLogChannel, getGlobalLogChannel } from './botDb.js';

/**
 * Send a moderation log embed.
 * @param {import('discord.js').Client} client
 * @param {Object} opts
 * @param {string} opts.action - Action title
 * @param {Object} opts.moderator - { discordId, name }
 * @param {Object|string} opts.target - { discordId, name } or string
 * @param {string} opts.reason
 * @param {number} [opts.color=0x5865F2]
 * @param {Array} [opts.fields=[]]
 * @param {string} [opts.specificChannelId] - Hardcoded specific channel (from channels.js)
 * @param {string} [opts.logType] - Log type key e.g. 'moderation.ban_unban' for per-guild config lookup
 * @param {string} [opts.guildId] - Guild ID for per-guild config lookup
 * @param {string} [opts.globalLogType] - Global log type key e.g. 'global_moderation' for global config lookup
 */
export async function logAction(client, {
  action, moderator, target, reason,
  color = 0x5865F2, fields = [],
  specificChannelId,
  logType, guildId,
  globalLogType
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

  // Always log to full-mod-logs (hardcoded)
  const fullModLogChannelId = MOD_LOG_CHANNEL_ID || LOG_CHANNEL_ID;
  if (fullModLogChannelId) {
    try {
      const channel = await client.channels.fetch(fullModLogChannelId).catch(() => null);
      if (channel) await channel.send({ embeds: [embed] });
    } catch (e) {
      console.error('[Logger] Failed to send to full-mod-logs:', e.message);
    }
  }

  // Also log to specific hardcoded channel (from channels.js)
  if (specificChannelId) {
    try {
      const channel = await client.channels.fetch(specificChannelId).catch(() => null);
      if (channel) await channel.send({ embeds: [embed] });
    } catch (e) {
      console.error('[Logger] Failed to send to specific channel:', e.message);
    }
  }

  // Also log to per-guild panel-configured channel (from log_config DB)
  if (guildId && logType) {
    const [category, type] = logType.split('.');
    const configuredChannelId = getLogChannel(guildId, category, type);
    if (configuredChannelId) {
      try {
        const channel = await client.channels.fetch(configuredChannelId).catch(() => null);
        if (channel) await channel.send({ embeds: [embed] });
      } catch (e) {
        console.error('[Logger] Failed to send to per-guild log channel:', e.message);
      }
    }
  }

  // Also log to global panel-configured channel (from global_log_config DB)
  if (globalLogType) {
    const configuredChannelId = getGlobalLogChannel(globalLogType);
    if (configuredChannelId) {
      try {
        const channel = await client.channels.fetch(configuredChannelId).catch(() => null);
        if (channel) await channel.send({ embeds: [embed] });
      } catch (e) {
        console.error('[Logger] Failed to send to global log channel:', e.message);
      }
    }
  }
}
