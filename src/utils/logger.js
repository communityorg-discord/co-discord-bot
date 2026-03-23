import { EmbedBuilder } from 'discord.js';
import { LOG_CHANNEL_ID } from '../config.js';

export async function logAction(client, { action, moderator, target, reason, color = 0x5865F2, fields = [] }) {
  try {
    const channel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
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
