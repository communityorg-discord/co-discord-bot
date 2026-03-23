import { EmbedBuilder } from 'discord.js';
import { LOG_CHANNEL_ID, MOD_LOG_CHANNEL_ID } from '../config.js';

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
 * @param {string} [opts.specificChannelId] - If set, log to BOTH this channel AND full-mod-logs
 */
export async function logAction(client, { action, moderator, target, reason, color = 0x5865F2, fields = [], specificChannelId }) {
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

  // Always log to full-mod-logs
  const fullModLogChannelId = MOD_LOG_CHANNEL_ID || LOG_CHANNEL_ID;
  if (fullModLogChannelId) {
    try {
      const channel = await client.channels.fetch(fullModLogChannelId).catch(() => null);
      if (channel) await channel.send({ embeds: [embed] });
    } catch (e) {
      console.error('[Logger] Failed to send to full-mod-logs:', e.message);
    }
  }

  // Also log to the specific channel if provided
  if (specificChannelId) {
    try {
      const channel = await client.channels.fetch(specificChannelId).catch(() => null);
      if (channel) await channel.send({ embeds: [embed] });
    } catch (e) {
      console.error('[Logger] Failed to send to specific channel:', e.message);
    }
  }
}
