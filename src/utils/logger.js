import { EmbedBuilder } from 'discord.js';
import { LOG_CHANNEL_ID, MOD_LOG_CHANNEL_ID, BAN_UNBAN_LOG_CHANNEL_ID, GBAN_UNGBAN_LOG_CHANNEL_ID, SUSPEND_UNSUSPEND_LOG_CHANNEL_ID, TERMINATE_LOG_CHANNEL_ID, STRIKE_LOG_CHANNEL_ID, INFRACTIONS_CASES_LOG_CHANNEL_ID, INVESTIGATION_LOG_CHANNEL_ID, PURGE_SCRIBE_LOG_CHANNEL_ID, VERIFY_UNVERIFY_LOG_CHANNEL_ID, DM_LOG_CHANNEL_ID, BRAG_LOG_CHANNEL_ID, STAFF_LOG_CHANNEL_ID, USER_LOG_CHANNEL_ID, NID_LOG_CHANNEL_ID } from '../config.js';

export async function logAction(client, { action, moderator, target, reason, color = 0x5865F2, fields = [] }) {
  try {
    const channelId = MOD_LOG_CHANNEL_ID || LOG_CHANNEL_ID;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;
    const embed = new EmbedBuilder()
      .setTitle(`📋 ${action}`)
      .setColor(color)
      .addFields(
        { name: 'Target', value: target ? `<@${target.discordId || target}> ${target.name ? `(${target.name})` : ''}` : 'Unknown', inline: true },
        { name: 'Moderator', value: moderator ? `<@${moderator.discordId || moderator}> ${moderator.name ? `(${moderator.name})` : ''}` : 'Unknown', inline: true },
        { name: 'Reason', value: reason || 'No reason provided', inline: false },
        ...fields
      )
      .setTimestamp()
      .setFooter({ text: 'Community Organisation | Moderation Log' });
    await channel.send({ embeds: [embed] });
  } catch (e) {
    console.error('[Logger] Failed to log action:', e.message);
  }
}
