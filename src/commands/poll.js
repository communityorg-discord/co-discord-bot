import { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } from 'discord.js';
import { canRunCommand } from '../utils/permissions.js';
import { db } from '../utils/botDb.js';

// Ensure polls table exists
db.exec(`CREATE TABLE IF NOT EXISTS polls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT,
  channel_id TEXT,
  guild_id TEXT,
  creator_id TEXT,
  question TEXT,
  options TEXT,
  votes TEXT DEFAULT '{}',
  anonymous INTEGER DEFAULT 0,
  ends_at DATETIME,
  ended INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

export const data = new SlashCommandBuilder()
  .setName('poll')
  .setDescription('Create a poll')
  .addStringOption(opt => opt.setName('question').setDescription('The poll question').setRequired(true))
  .addStringOption(opt => opt.setName('options').setDescription('Comma-separated options (max 10)').setRequired(true))
  .addStringOption(opt => opt.setName('duration').setDescription('Duration e.g. 1h, 30m, 1d (default 24h)').setRequired(false))
  .addBooleanOption(opt => opt.setName('anonymous').setDescription('Hide who voted').setRequired(false));

function parseDuration(input) {
  if (!input) return 24 * 60 * 60 * 1000; // default 24h
  const lower = input.toLowerCase().trim();
  const match = lower.match(/^(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)$/);
  if (!match) return null;
  const num = parseInt(match[1]);
  const unit = match[2].charAt(0);
  if (unit === 'm') return num * 60 * 1000;
  if (unit === 'h') return num * 60 * 60 * 1000;
  if (unit === 'd') return num * 24 * 60 * 60 * 1000;
  return null;
}

export function buildPollEmbed(poll, options, votes, ended = false) {
  const totalVotes = Object.values(votes).reduce((sum, arr) => sum + arr.length, 0);

  const lines = options.map((opt, i) => {
    const count = (votes[String(i)] || []).length;
    const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
    const barLength = Math.round(pct / 5);
    const bar = '█'.repeat(barLength) + '░'.repeat(20 - barLength);
    return `${NUMBER_EMOJIS[i]} **${opt}**\n${bar} ${count} vote${count !== 1 ? 's' : ''} (${pct}%)`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`📊 ${poll.question}`)
    .setDescription(lines.join('\n\n'))
    .setColor(ended ? 0x808080 : 0x5865F2)
    .addFields(
      { name: 'Total Votes', value: String(totalVotes), inline: true },
      { name: 'Anonymous', value: poll.anonymous ? 'Yes' : 'No', inline: true },
    )
    .setFooter({ text: ended ? 'Poll ended' : `Ends ${new Date(poll.ends_at).toUTCString()}` })
    .setTimestamp();

  if (ended && totalVotes > 0) {
    // Find winner(s)
    let maxVotes = 0;
    for (const arr of Object.values(votes)) {
      if (arr.length > maxVotes) maxVotes = arr.length;
    }
    const winners = options.filter((_, i) => (votes[String(i)] || []).length === maxVotes);
    embed.addFields({ name: 'Winner', value: winners.join(', '), inline: false });
  }

  return embed;
}

export function buildPollButtons(pollId, options, disabled = false) {
  const rows = [];
  let currentRow = [];
  for (let i = 0; i < options.length; i++) {
    currentRow.push(
      new ButtonBuilder()
        .setCustomId(`poll_vote_${pollId}_${i}`)
        .setLabel(options[i].slice(0, 80))
        .setEmoji(NUMBER_EMOJIS[i])
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled)
    );
    if (currentRow.length === 5 || i === options.length - 1) {
      rows.push(new ActionRowBuilder().addComponents(...currentRow));
      currentRow = [];
    }
  }
  return rows;
}

export async function execute(interaction) {
  await interaction.deferReply();

  const check = canRunCommand(interaction.user.id, 1);
  if (!check.allowed) {
    return interaction.editReply({ content: `❌ ${check.reason}` });
  }

  const question = interaction.options.getString('question');
  const optionsStr = interaction.options.getString('options');
  const durationStr = interaction.options.getString('duration');
  const anonymous = interaction.options.getBoolean('anonymous') || false;

  const options = optionsStr.split(',').map(o => o.trim()).filter(Boolean);
  if (options.length < 2) {
    return interaction.editReply({ content: '❌ You need at least 2 options.' });
  }
  if (options.length > 10) {
    return interaction.editReply({ content: '❌ Maximum 10 options allowed.' });
  }

  const durationMs = parseDuration(durationStr);
  if (durationMs === null) {
    return interaction.editReply({ content: '❌ Invalid duration. Use formats like `30m`, `2h`, `1d`.' });
  }
  if (durationMs < 60000) {
    return interaction.editReply({ content: '❌ Minimum duration is 1 minute.' });
  }
  if (durationMs > 7 * 24 * 60 * 60 * 1000) {
    return interaction.editReply({ content: '❌ Maximum duration is 7 days.' });
  }

  const endsAt = new Date(Date.now() + durationMs).toISOString();
  const votes = {};

  // Insert poll into DB (message_id will be updated after sending)
  const result = db.prepare(`
    INSERT INTO polls (channel_id, guild_id, creator_id, question, options, votes, anonymous, ends_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    interaction.channelId,
    interaction.guildId,
    interaction.user.id,
    question,
    JSON.stringify(options),
    JSON.stringify(votes),
    anonymous ? 1 : 0,
    endsAt
  );

  const pollId = result.lastInsertRowid;
  const poll = { question, anonymous, ends_at: endsAt };

  const embed = buildPollEmbed(poll, options, votes, false);
  embed.addFields({ name: 'Created by', value: `<@${interaction.user.id}>`, inline: true });

  const buttons = buildPollButtons(pollId, options);

  const msg = await interaction.editReply({ embeds: [embed], components: buttons });

  // Store message_id
  db.prepare('UPDATE polls SET message_id = ? WHERE id = ?').run(msg.id, pollId);
}

export async function handleVoteButton(interaction) {
  const parts = interaction.customId.split('_');
  // poll_vote_<pollId>_<optionIndex>
  const pollId = parseInt(parts[2]);
  const optionIndex = parseInt(parts[3]);

  const poll = db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
  if (!poll) {
    return interaction.reply({ content: '❌ Poll not found.', ephemeral: true });
  }
  if (poll.ended) {
    return interaction.reply({ content: '❌ This poll has already ended.', ephemeral: true });
  }

  const options = JSON.parse(poll.options);
  const votes = JSON.parse(poll.votes || '{}');

  // Remove user's previous vote (if any)
  for (const key of Object.keys(votes)) {
    votes[key] = (votes[key] || []).filter(id => id !== interaction.user.id);
  }

  // Add new vote
  if (!votes[String(optionIndex)]) votes[String(optionIndex)] = [];
  votes[String(optionIndex)].push(interaction.user.id);

  // Save to DB
  db.prepare('UPDATE polls SET votes = ? WHERE id = ?').run(JSON.stringify(votes), pollId);

  // Update the embed
  const embed = buildPollEmbed(poll, options, votes, false);
  embed.addFields({ name: 'Created by', value: `<@${poll.creator_id}>`, inline: true });

  const buttons = buildPollButtons(pollId, options);

  await interaction.update({ embeds: [embed], components: buttons });
}
