// COMMAND_PERMISSION_FALLBACK: everyone
// /idea — crowdsourced suggestions board. Distinct from /feedback
// (bugs / questions / direct asks): ideas are nice-to-haves that can
// be voted on. Three subcommands: post / list / vote (with up|down).
// Moderator actions (mark shipped, respond, decline, delete) live on
// the portal /ideas admin surface.
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { db } from '../utils/botDb.js';
import { E } from '../lib/emoji.js';

export const data = new SlashCommandBuilder()
  .setName('idea')
  .setDescription('Suggest a feature or improvement (crowdsourced + votable)')
  .addSubcommand(s => s.setName('post').setDescription('Post a new idea')
    .addStringOption(o => o.setName('text').setDescription('Your suggestion').setRequired(true).setMaxLength(500)))
  .addSubcommand(s => s.setName('list').setDescription('Top open ideas by net score'))
  .addSubcommand(s => s.setName('vote').setDescription('Upvote or downvote an idea')
    .addIntegerOption(o => o.setName('id').setDescription('Idea id from /idea list').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('direction').setDescription('Up or down').setRequired(true)
      .addChoices({ name: 'Upvote', value: 'up' }, { name: 'Downvote', value: 'down' })));

export async function execute(interaction) {
  const perm = await canUseCommand('idea', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });
  }
  const sub = interaction.options.getSubcommand();
  const userId = interaction.user.id;

  if (sub === 'post') {
    const text = interaction.options.getString('text').trim();
    const r = db.prepare('INSERT INTO ideas (owner_discord_id, text) VALUES (?, ?)').run(userId, text);
    // Auto-upvote your own idea
    try { db.prepare('INSERT INTO idea_votes (idea_id, voter_discord_id, value) VALUES (?, ?, 1)').run(r.lastInsertRowid, userId); } catch {}
    return interaction.reply({
      content: `Idea **#${r.lastInsertRowid}** posted (and auto-upvoted by you). Others can vote with \`/idea vote id:${r.lastInsertRowid} direction:Upvote\` or \`direction:Downvote\`.`,
      ephemeral: true,
    });
  }

  if (sub === 'list') {
    const rows = db.prepare(`
      SELECT i.id, i.text, i.owner_discord_id, i.status, i.created_at,
        COALESCE((SELECT SUM(v.value) FROM idea_votes v WHERE v.idea_id = i.id), 0) AS votes
      FROM ideas i
      WHERE i.status = 'open'
      ORDER BY votes DESC, i.created_at DESC LIMIT 15
    `).all();
    if (!rows.length) {
      return interaction.reply({
        content: 'No open ideas yet. Be the first — `/idea post text:<your suggestion>`.',
        ephemeral: true,
      });
    }
    const fmt = (n) => (n > 0 ? `+${n}` : `${n}`);
    const lines = rows.map(r => `**#${r.id}** · ${fmt(r.votes)} · <@${r.owner_discord_id}>\n   _${r.text.slice(0, 200)}_`);
    const embed = new EmbedBuilder()
      .setTitle(`Top open ideas — ${rows.length}`)
      .setColor(0x6366f1)
      .setDescription(lines.join('\n\n').slice(0, 4000))
      .setFooter({ text: 'Vote with /idea vote id:N direction:Upvote|Downvote · post your own with /idea post' });
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (sub === 'vote') {
    const id = interaction.options.getInteger('id');
    const direction = interaction.options.getString('direction');
    const value = direction === 'down' ? -1 : 1;

    const idea = db.prepare('SELECT id, status FROM ideas WHERE id = ?').get(id);
    if (!idea) return interaction.reply({ content: `${E.cross} No idea #${id}.`, ephemeral: true });
    if (idea.status !== 'open') return interaction.reply({ content: `${E.cross} Idea #${id} is ${idea.status}, voting closed.`, ephemeral: true });

    const existing = db.prepare('SELECT value FROM idea_votes WHERE idea_id = ? AND voter_discord_id = ?').get(id, userId);
    let action;
    if (existing && Number(existing.value) === value) {
      // Same direction → toggle off (unvote)
      db.prepare('DELETE FROM idea_votes WHERE idea_id = ? AND voter_discord_id = ?').run(id, userId);
      action = 'removed';
    } else if (existing) {
      // Opposite direction → flip
      db.prepare('UPDATE idea_votes SET value = ? WHERE idea_id = ? AND voter_discord_id = ?').run(value, id, userId);
      action = value === 1 ? 'switched to upvote' : 'switched to downvote';
    } else {
      db.prepare('INSERT INTO idea_votes (idea_id, voter_discord_id, value) VALUES (?, ?, ?)').run(id, userId, value);
      action = value === 1 ? 'upvoted' : 'downvoted';
    }
    const net = db.prepare('SELECT COALESCE(SUM(value), 0) c FROM idea_votes WHERE idea_id = ?').get(id).c;
    return interaction.reply({
      content: `#${id} ${action} — net score now **${net}**. (Voting the same direction again removes your vote.)`,
      ephemeral: true,
    });
  }
}
