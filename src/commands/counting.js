import { SlashCommandBuilder, EmbedBuilder, ChannelType } from 'discord.js';
import { db } from '../utils/botDb.js';
import { hasPortalAuth } from '../utils/permissions.js';

export const data = new SlashCommandBuilder()
  .setName('counting')
  .setDescription('Manage counting channels')
  .addSubcommand(sub =>
    sub.setName('setup')
      .setDescription('Enable counting in a channel')
      .addChannelOption(opt =>
        opt.setName('channel')
          .setDescription('The channel to enable counting in')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName('reset')
      .setDescription('Reset the count in a counting channel')
      .addChannelOption(opt =>
        opt.setName('channel')
          .setDescription('The counting channel to reset')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName('leaderboard')
      .setDescription('View counting stats for this server')
  );

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  if (!await hasPortalAuth(interaction.user.id, 5)) {
    return interaction.editReply({ content: '❌ You need authorisation level 5+ to manage counting channels.' });
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'setup') {
    const channel = interaction.options.getChannel('channel');

    const existing = db.prepare('SELECT * FROM counting_channels WHERE guild_id = ? AND channel_id = ?')
      .get(interaction.guildId, channel.id);

    if (existing) {
      return interaction.editReply({ content: `❌ Counting is already enabled in <#${channel.id}>.` });
    }

    db.prepare('INSERT INTO counting_channels (guild_id, channel_id) VALUES (?, ?)')
      .run(interaction.guildId, channel.id);

    await channel.send('🔢 Counting has been enabled in this channel! Start from **1**. You cannot count twice in a row.');
    return interaction.editReply({ content: `✅ Counting enabled in <#${channel.id}>.` });
  }

  if (sub === 'reset') {
    const channel = interaction.options.getChannel('channel');

    const existing = db.prepare('SELECT * FROM counting_channels WHERE guild_id = ? AND channel_id = ?')
      .get(interaction.guildId, channel.id);

    if (!existing) {
      return interaction.editReply({ content: `❌ <#${channel.id}> is not a counting channel.` });
    }

    const newHighScore = Math.max(existing.high_score, existing.current_count);

    db.prepare(`
      UPDATE counting_channels
      SET current_count = 0, last_user_id = NULL, last_message_id = NULL,
          high_score = ?
      WHERE guild_id = ? AND channel_id = ?
    `).run(newHighScore, interaction.guildId, channel.id);

    await channel.send(`🔄 The count has been reset by <@${interaction.user.id}>. Start from **1**!`);
    return interaction.editReply({ content: `✅ Count reset in <#${channel.id}>.` });
  }

  if (sub === 'leaderboard') {
    const channels = db.prepare('SELECT * FROM counting_channels WHERE guild_id = ? ORDER BY high_score DESC')
      .all(interaction.guildId);

    if (channels.length === 0) {
      return interaction.editReply({ content: 'No counting channels set up in this server.' });
    }

    const lines = channels.map(c => {
      const failedBy = c.failed_at !== null ? `Last ruined at **${c.failed_at}**` : 'Never ruined';
      return `<#${c.channel_id}> — Current: **${c.current_count}** | High score: **${c.high_score}** | ${failedBy}`;
    });

    const embed = new EmbedBuilder()
      .setTitle('🔢 Counting Leaderboard')
      .setColor(0x5865F2)
      .setDescription(lines.join('\n'))
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }
}
