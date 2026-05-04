// COMMAND_PERMISSION_FALLBACK: everyone
// /idea — crowdsourced suggestions board. Distinct from /feedback
// (bugs / questions / direct asks): ideas are nice-to-haves that
// can be voted on. Subcommands: post / list / vote / unvote /
// shipped (superuser).
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand, isSuperuser } from '../utils/permissions.js';
import { db } from '../utils/botDb.js';

export const data = new SlashCommandBuilder()
  .setName('idea')
  .setDescription('Suggest a feature or improvement (crowdsourced + votable)')
  .addSubcommand(s => s.setName('post').setDescription('Post a new idea')
    .addStringOption(o => o.setName('text').setDescription('Your suggestion').setRequired(true).setMaxLength(500)))
  .addSubcommand(s => s.setName('list').setDescription('Top open ideas by vote count'))
  .addSubcommand(s => s.setName('vote').setDescription('Upvote an idea')
    .addIntegerOption(o => o.setName('id').setDescription('Idea id from /idea list').setRequired(true).setMinValue(1)))
  .addSubcommand(s => s.setName('unvote').setDescription('Remove your upvote')
    .addIntegerOption(o => o.setName('id').setDescription('Idea id').setRequired(true).setMinValue(1)))
  .addSubcommand(s => s.setName('shipped').setDescription('Mark an idea as shipped (superuser)')
    .addIntegerOption(o => o.setName('id').setDescription('Idea id').setRequired(true).setMinValue(1)));

export async function execute(interaction) {
  const perm = await canUseCommand('idea', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });
  }
  const sub = interaction.options.getSubcommand();
  const userId = interaction.user.id;

  if (sub === 'post') {
    const text = interaction.options.getString('text').trim();
    const r = db.prepare('INSERT INTO ideas (owner_discord_id, text) VALUES (?, ?)').run(userId, text);
    // Auto-upvote your own idea
    try { db.prepare('INSERT INTO idea_votes (idea_id, voter_discord_id) VALUES (?, ?)').run(r.lastInsertRowid, userId); } catch {}
    return interaction.reply({
      content: `💡 Idea **#${r.lastInsertRowid}** posted (and auto-upvoted by you). Others can vote with \`/idea vote id:${r.lastInsertRowid}\`.`,
      ephemeral: true,
    });
  }

  if (sub === 'list') {
    const rows = db.prepare(`
      SELECT i.id, i.text, i.owner_discord_id, i.status, i.created_at,
        (SELECT COUNT(*) FROM idea_votes v WHERE v.idea_id = i.id) AS votes
      FROM ideas i
      WHERE i.status = 'open'
      ORDER BY votes DESC, i.created_at DESC LIMIT 15
    `).all();
    if (!rows.length) {
      return interaction.reply({
        content: '💡 No open ideas yet. Be the first — `/idea post text:<your suggestion>`.',
        ephemeral: true,
      });
    }
    const lines = rows.map(r => `**#${r.id}** · 👍 ${r.votes} · <@${r.owner_discord_id}>\n   _${r.text.slice(0, 200)}_`);
    const embed = new EmbedBuilder()
      .setTitle(`💡 Top open ideas — ${rows.length}`)
      .setColor(0x6366f1)
      .setDescription(lines.join('\n\n').slice(0, 4000))
      .setFooter({ text: 'Vote with /idea vote id:N · post your own with /idea post' });
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (sub === 'vote') {
    const id = interaction.options.getInteger('id');
    const idea = db.prepare('SELECT id, text, status FROM ideas WHERE id = ?').get(id);
    if (!idea) return interaction.reply({ content: `❌ No idea #${id}.`, ephemeral: true });
    if (idea.status !== 'open') return interaction.reply({ content: `❌ Idea #${id} is ${idea.status}, voting closed.`, ephemeral: true });
    try {
      db.prepare('INSERT INTO idea_votes (idea_id, voter_discord_id) VALUES (?, ?)').run(id, userId);
    } catch (e) {
      if (e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        return interaction.reply({ content: `🤷 You\'ve already voted for #${id}.`, ephemeral: true });
      }
      throw e;
    }
    const votes = db.prepare('SELECT COUNT(*) c FROM idea_votes WHERE idea_id = ?').get(id).c;
    return interaction.reply({ content: `👍 Voted for #${id} — now at ${votes} vote${votes === 1 ? '' : 's'}.`, ephemeral: true });
  }

  if (sub === 'unvote') {
    const id = interaction.options.getInteger('id');
    const r = db.prepare('DELETE FROM idea_votes WHERE idea_id = ? AND voter_discord_id = ?').run(id, userId);
    if (r.changes === 0) {
      return interaction.reply({ content: `🤷 You hadn\'t voted for #${id}.`, ephemeral: true });
    }
    const votes = db.prepare('SELECT COUNT(*) c FROM idea_votes WHERE idea_id = ?').get(id).c;
    return interaction.reply({ content: `↩️ Unvoted #${id} — now at ${votes} vote${votes === 1 ? '' : 's'}.`, ephemeral: true });
  }

  if (sub === 'shipped') {
    if (!isSuperuser(userId)) {
      return interaction.reply({ content: '❌ Superusers only.', ephemeral: true });
    }
    const id = interaction.options.getInteger('id');
    const r = db.prepare(`UPDATE ideas SET status = 'shipped' WHERE id = ? AND status = 'open'`).run(id);
    if (r.changes === 0) return interaction.reply({ content: `❌ No open idea #${id}.`, ephemeral: true });
    return interaction.reply({ content: `🚀 Marked idea #${id} as shipped.` });
  }
}
