// COMMAND_PERMISSION_FALLBACK: everyone
// View and cancel your active /remind reminders. Companion to
// /remind — closes the loop so users aren't stuck with reminders
// they set and now want to remove.
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { db } from '../utils/botDb.js';
import { E } from '../lib/emoji.js';

export const data = new SlashCommandBuilder()
  .setName('reminders')
  .setDescription('View and cancel your active reminders')
  .addSubcommand(s => s.setName('list').setDescription('Show your pending reminders'))
  .addSubcommand(s => s.setName('cancel').setDescription('Cancel a pending reminder')
    .addIntegerOption(o => o.setName('index').setDescription('Number from /reminders list').setRequired(true).setMinValue(1)));

function listPending(userId) {
  // Show reminders the user EITHER set for themselves OR set for someone else
  return db.prepare(`
    SELECT id, requester_discord_id, target_discord_id, message, remind_at, channel_id
    FROM reminders
    WHERE sent = 0 AND (requester_discord_id = ? OR target_discord_id = ?)
    ORDER BY remind_at ASC LIMIT 25
  `).all(userId, userId);
}

export async function execute(interaction) {
  const perm = await canUseCommand('reminders', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });
  }
  const sub = interaction.options.getSubcommand();
  const userId = interaction.user.id;

  if (sub === 'list') {
    const rows = listPending(userId);
    if (!rows.length) {
      return interaction.reply({ content: `${E.inbox} No pending reminders. Set one with \`/remind\`.`, ephemeral: true });
    }
    const lines = rows.map((r, i) => {
      const ts = Math.floor(new Date(r.remind_at).getTime() / 1000);
      const direction = r.target_discord_id === userId
        ? r.requester_discord_id === userId ? 'self → self' : `from <@${r.requester_discord_id}>`
        : `you → <@${r.target_discord_id}>`;
      return `**${i + 1}.** <t:${ts}:R> · ${direction}\n   _${r.message.slice(0, 200)}_`;
    });
    const embed = new EmbedBuilder()
      .setTitle(`Your reminders — ${rows.length}`)
      .setColor(0x6366f1)
      .setDescription(`${E.calendar} ` + lines.join('\n\n').slice(0, 4000))
      .setFooter({ text: 'Cancel one with /reminders cancel index:N' });
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (sub === 'cancel') {
    const rows = listPending(userId);
    const idx = interaction.options.getInteger('index');
    const row = rows[idx - 1];
    if (!row) {
      return interaction.reply({ content: `${E.cross} No reminder #${idx}. Run \`/reminders list\`.`, ephemeral: true });
    }
    // Mark as sent=1 (effectively cancelled — won't be picked up by the cron)
    // We don't delete so any audit/history surfaces still see it.
    const r = db.prepare('UPDATE reminders SET sent = 1 WHERE id = ?').run(row.id);
    if (r.changes === 0) {
      return interaction.reply({ content: `${E.warning} Already fired or removed — refresh with /reminders list.`, ephemeral: true });
    }
    const ts = Math.floor(new Date(row.remind_at).getTime() / 1000);
    return interaction.reply({
      content: `${E.cross} Cancelled — reminder due <t:${ts}:R> ("${row.message.slice(0, 100)}").`,
      ephemeral: true,
    });
  }
}
