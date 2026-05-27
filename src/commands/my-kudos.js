// COMMAND_PERMISSION_FALLBACK: everyone
// Personal kudos history — shows kudos you've received (with the
// message text) and a count of kudos you've given. Companion to
// /thanks and /kudos-leaderboard.
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { db } from '../utils/botDb.js';
import { E } from '../lib/emoji.js';

export const data = new SlashCommandBuilder()
  .setName('my-kudos')
  .setDescription('See kudos you\'ve received + count of kudos you\'ve given')
  .addUserOption(opt => opt
    .setName('user')
    .setDescription('Look up another user (default: yourself)'));

export async function execute(interaction) {
  const perm = await canUseCommand('my-kudos', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });
  }
  const target = interaction.options.getUser('user') || interaction.user;
  const isSelf = target.id === interaction.user.id;

  const received = db.prepare(`
    SELECT from_discord_id, message, created_at FROM kudos
    WHERE to_discord_id = ? ORDER BY created_at DESC LIMIT 10
  `).all(target.id);
  const receivedTotal = db.prepare(`SELECT COUNT(*) c FROM kudos WHERE to_discord_id = ?`).get(target.id).c;
  const givenTotal = db.prepare(`SELECT COUNT(*) c FROM kudos WHERE from_discord_id = ?`).get(target.id).c;
  const last30Received = db.prepare(`SELECT COUNT(*) c FROM kudos WHERE to_discord_id = ? AND created_at >= datetime('now', '-30 days')`).get(target.id).c;

  const embed = new EmbedBuilder()
    .setTitle(isSelf ? 'Your kudos' : `${target.username}'s kudos`)
    .setColor(0xfacc15)
    .setThumbnail(target.displayAvatarURL())
    .addFields(
      { name: 'Received (all time)', value: String(receivedTotal), inline: true },
      { name: 'Received (30d)', value: String(last30Received), inline: true },
      { name: 'Given (all time)', value: String(givenTotal), inline: true },
    );

  if (received.length === 0) {
    embed.setDescription(isSelf
      ? '_No kudos yet. The leaderboard\'s wide open — keep helping people_'
      : `_${target.username} hasn't received any kudos yet._`);
  } else {
    const lines = received.map(k => {
      const ts = Math.floor(new Date(k.created_at).getTime() / 1000);
      const msg = k.message.length > 200 ? k.message.slice(0, 200) + '…' : k.message;
      return `**<@${k.from_discord_id}>** · <t:${ts}:R>\n> ${msg.split('\n').join('\n> ')}`;
    });
    embed.addFields({
      name: `Recent received (top ${received.length}${receivedTotal > received.length ? ` of ${receivedTotal}` : ''})`,
      value: lines.join('\n\n').slice(0, 1024),
      inline: false,
    });
  }

  embed.setFooter({ text: 'Send your own with /thanks · public board at /kudos' });
  await interaction.reply({ embeds: [embed], ephemeral: true });
}
