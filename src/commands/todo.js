// COMMAND_PERMISSION_FALLBACK: everyone
// Personal todo list — per-user only. Quick capture during the day,
// list/check-off later. Survives bot restarts (sqlite). NOT shared.
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { db } from '../utils/botDb.js';
import { E } from '../lib/emoji.js';

export const data = new SlashCommandBuilder()
  .setName('todo')
  .setDescription('Personal todo list')
  .addSubcommand(s => s.setName('add').setDescription('Add an item to your list')
    .addStringOption(o => o.setName('text').setDescription('What to add').setRequired(true).setMaxLength(500)))
  .addSubcommand(s => s.setName('list').setDescription('Show your open items'))
  .addSubcommand(s => s.setName('done').setDescription('Mark an item as done')
    .addIntegerOption(o => o.setName('index').setDescription('Item number from /todo list').setRequired(true).setMinValue(1)))
  .addSubcommand(s => s.setName('undo').setDescription('Reopen an item you marked done')
    .addIntegerOption(o => o.setName('index').setDescription('Item number').setRequired(true).setMinValue(1)))
  .addSubcommand(s => s.setName('clear').setDescription('Delete all your completed items'))
  .addSubcommand(s => s.setName('remove').setDescription('Delete a specific open item')
    .addIntegerOption(o => o.setName('index').setDescription('Item number from /todo list').setRequired(true).setMinValue(1)));

function listOpen(ownerId) {
  return db.prepare('SELECT id, text, created_at FROM todos WHERE owner_id = ? AND done = 0 ORDER BY id ASC').all(ownerId);
}

function listAll(ownerId) {
  return db.prepare('SELECT id, text, done, created_at, completed_at FROM todos WHERE owner_id = ? ORDER BY done ASC, id ASC LIMIT 50').all(ownerId);
}

export async function execute(interaction) {
  const perm = await canUseCommand('todo', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });
  }
  const sub = interaction.options.getSubcommand();
  const userId = interaction.user.id;

  if (sub === 'add') {
    const text = interaction.options.getString('text').trim();
    db.prepare('INSERT INTO todos (owner_id, text) VALUES (?, ?)').run(userId, text);
    const open = listOpen(userId).length;
    return interaction.reply({
      content: `${E.check} Added — you now have **${open}** open item${open === 1 ? '' : 's'}.`,
      ephemeral: true,
    });
  }

  if (sub === 'list') {
    const all = listAll(userId);
    const open = all.filter(t => !t.done);
    const done = all.filter(t => t.done);

    const embed = new EmbedBuilder()
      .setTitle('Your todos')
      .setColor(open.length === 0 ? 0x22c55e : 0x6366f1)
      .setFooter({ text: 'Reference items by their number — /todo done index:N · /todo remove index:N' });

    if (open.length === 0) {
      embed.setDescription(`${E.check} _Inbox zero. Nothing open._`);
    } else {
      const lines = open.map((t, i) => `**${i + 1}.** ${t.text}`).join('\n');
      embed.addFields({ name: `Open (${open.length})`, value: `${E.pending} ` + lines.slice(0, 1018), inline: false });
    }
    if (done.length > 0) {
      const lines = done.slice(0, 5).map(t => `~~${t.text}~~`).join('\n');
      embed.addFields({ name: `Recently done${done.length > 5 ? ` (top 5 of ${done.length})` : ` (${done.length})`}`, value: lines.slice(0, 1024), inline: false });
    }
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // For done/undo/remove we need to map the user-facing index → row id
  const open = listOpen(userId);

  if (sub === 'done') {
    const idx = interaction.options.getInteger('index');
    const row = open[idx - 1];
    if (!row) return interaction.reply({ content: `${E.cross} No open item #${idx}. Run \`/todo list\`.`, ephemeral: true });
    db.prepare(`UPDATE todos SET done = 1, completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(row.id);
    return interaction.reply({ content: `${E.check} Done — _${row.text}_`, ephemeral: true });
  }

  if (sub === 'remove') {
    const idx = interaction.options.getInteger('index');
    const row = open[idx - 1];
    if (!row) return interaction.reply({ content: `${E.cross} No open item #${idx}.`, ephemeral: true });
    db.prepare('DELETE FROM todos WHERE id = ?').run(row.id);
    return interaction.reply({ content: `Removed — _${row.text}_`, ephemeral: true });
  }

  if (sub === 'undo') {
    // Map index across the recently-done list
    const done = db.prepare('SELECT id, text FROM todos WHERE owner_id = ? AND done = 1 ORDER BY completed_at DESC LIMIT 50').all(userId);
    const idx = interaction.options.getInteger('index');
    const row = done[idx - 1];
    if (!row) return interaction.reply({ content: `${E.cross} No completed item #${idx}.`, ephemeral: true });
    db.prepare('UPDATE todos SET done = 0, completed_at = NULL WHERE id = ?').run(row.id);
    return interaction.reply({ content: `Reopened — _${row.text}_`, ephemeral: true });
  }

  if (sub === 'clear') {
    const r = db.prepare('DELETE FROM todos WHERE owner_id = ? AND done = 1').run(userId);
    return interaction.reply({ content: `Cleared ${r.changes} completed item${r.changes === 1 ? '' : 's'}.`, ephemeral: true });
  }
}
