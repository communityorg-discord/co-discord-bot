import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { isSuperuser } from '../utils/permissions.js';
import { SUPERUSER_IDS } from '../config.js';
import db from '../utils/botDb.js';
import { getUserByDiscordId } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('election')
  .setDescription('Manage CO elections')
  .addSubcommand(sub => sub.setName('create').setDescription('Create a new election')
    .addStringOption(opt => opt.setName('title').setDescription('Election title').setRequired(true))
    .addIntegerOption(opt => opt.setName('hours').setDescription('Duration in hours (default 48)').setRequired(false))
  )
  .addSubcommand(sub => sub.setName('whitelist').setDescription('Add a candidate to the election')
    .addUserOption(opt => opt.setName('user').setDescription('Candidate').setRequired(true))
  )
  .addSubcommand(sub => sub.setName('vote').setDescription('Cast your vote')
    .addIntegerOption(opt => opt.setName('candidate_id').setDescription('Candidate ID from /election status').setRequired(true))
  )
  .addSubcommand(sub => sub.setName('status').setDescription('View current election status'))
  .addSubcommand(sub => sub.setName('end').setDescription('End the election and announce results'));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'create') {
    if (!isSuperuser(interaction.user.id)) return interaction.reply({ content: '❌ Superuser only.', ephemeral: true });
    const title = interaction.options.getString('title');
    const hours = interaction.options.getInteger('hours') || 48;
    const endsAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();

    const existing = db.prepare('SELECT * FROM elections WHERE active = 1').get();
    if (existing) return interaction.reply({ content: '❌ An election is already active.', ephemeral: true });

    const result = db.prepare('INSERT INTO elections (title, created_by, ends_at) VALUES (?, ?, ?)').run(title, interaction.user.id, endsAt);

    await interaction.reply({ content: `✅ Election **"${title}"** created! Ends in ${hours} hours. Use \`/election whitelist\` to add candidates.`, ephemeral: false });

  } else if (sub === 'whitelist') {
    if (!isSuperuser(interaction.user.id)) return interaction.reply({ content: '❌ Superuser only.', ephemeral: true });
    const election = db.prepare('SELECT * FROM elections WHERE active = 1').get();
    if (!election) return interaction.reply({ content: '❌ No active election.', ephemeral: true });
    const target = interaction.options.getUser('user');
    const portalUser = getUserByDiscordId(target.id);
    db.prepare('INSERT INTO election_candidates (election_id, discord_id, name, whitelisted) VALUES (?, ?, ?, 1)')
      .run(election.id, target.id, portalUser?.display_name || target.username);
    await interaction.reply({ content: `✅ **${portalUser?.display_name || target.username}** added as a candidate.`, ephemeral: false });

  } else if (sub === 'vote') {
    const election = db.prepare('SELECT * FROM elections WHERE active = 1').get();
    if (!election) return interaction.reply({ content: '❌ No active election.', ephemeral: true });
    const candidateId = interaction.options.getInteger('candidate_id');
    const existingVote = db.prepare('SELECT * FROM election_votes WHERE election_id = ? AND voter_id = ?').get(election.id, interaction.user.id);
    if (existingVote) return interaction.reply({ content: '❌ You have already voted.', ephemeral: true });
    const candidate = db.prepare('SELECT * FROM election_candidates WHERE id = ? AND election_id = ?').get(candidateId, election.id);
    if (!candidate) return interaction.reply({ content: '❌ Invalid candidate.', ephemeral: true });
    if (candidate.discord_id === interaction.user.id) return interaction.reply({ content: '❌ You cannot vote for yourself.', ephemeral: true });
    db.prepare('INSERT INTO election_votes (election_id, voter_id, candidate_id) VALUES (?, ?, ?)').run(election.id, interaction.user.id, candidateId);
    await interaction.reply({ content: `✅ Vote cast for **${candidate.name}**.`, ephemeral: true });

  } else if (sub === 'status') {
    const election = db.prepare('SELECT * FROM elections WHERE active = 1').get();
    if (!election) return interaction.reply({ content: '❌ No active election.', ephemeral: true });
    const votes = db.prepare('SELECT ec.id, ec.name, ec.discord_id, COUNT(ev.id) as vote_count FROM election_candidates ec LEFT JOIN election_votes ev ON ec.id = ev.candidate_id WHERE ec.election_id = ? AND ec.whitelisted = 1 GROUP BY ec.id ORDER BY vote_count DESC').all(election.id);
    const embed = new EmbedBuilder()
      .setTitle(`🗳️ Election — ${election.title}`)
      .setColor(0x5865F2)
      .setDescription(votes.length ? votes.map((v, i) => `${i + 1}. **${v.name}** (ID: ${v.id}) — ${v.vote_count} votes`).join('\n') : 'No candidates yet.')
      .addFields({ name: 'Ends', value: new Date(election.ends_at).toLocaleString('en-GB'), inline: true })
      .setFooter({ text: 'Use /election vote candidate_id:<ID> to cast your vote' });
    await interaction.reply({ embeds: [embed], ephemeral: false });

  } else if (sub === 'end') {
    if (!isSuperuser(interaction.user.id)) return interaction.reply({ content: '❌ Superuser only.', ephemeral: true });
    const election = db.prepare('SELECT * FROM elections WHERE active = 1').get();
    if (!election) return interaction.reply({ content: '❌ No active election.', ephemeral: true });
    const votes = db.prepare('SELECT ec.name, ec.discord_id, COUNT(ev.id) as vote_count FROM election_candidates ec LEFT JOIN election_votes ev ON ec.id = ev.candidate_id WHERE ec.election_id = ? AND ec.whitelisted = 1 GROUP BY ec.id ORDER BY vote_count DESC').all(election.id);
    db.prepare('UPDATE elections SET active = 0, result = ? WHERE id = ?').run(JSON.stringify(votes), election.id);
    const embed = new EmbedBuilder()
      .setTitle(`🏆 Election Results — ${election.title}`)
      .setColor(0x22C55E)
      .setDescription(votes.map((v, i) => `${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`} **${v.name}** — ${v.vote_count} votes`).join('\n'));
    await interaction.reply({ embeds: [embed], ephemeral: false });
  }
}
