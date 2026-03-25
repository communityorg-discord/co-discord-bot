import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canRunCommand } from '../utils/permissions.js';
import { addInfraction } from '../utils/botDb.js';
import { logAction } from '../utils/logger.js';
import { MOD_LOG_CHANNEL_ID } from '../config.js';
import { getUserByDiscordId } from '../db.js';

function parseDuration(str) {
  if (!str) return null;
  const match = str.match(/^(\d+)([smhd])$/);
  if (!match) return null;
  const value = parseInt(match[1]);
  const unit = match[2];
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return value * multipliers[unit];
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days} day${days !== 1 ? 's' : ''}`;
  if (hours > 0) return `${hours} hour${hours !== 1 ? 's' : ''}`;
  if (minutes > 0) return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  return `${seconds} second${seconds !== 1 ? 's' : ''}`;
}

export const data = new SlashCommandBuilder()
  .setName('timeout')
  .setDescription('Timeout management — add or remove a timeout from a user')
  .addSubcommand(sub => sub.setName('add').setDescription('Apply a timeout to a user')
    .addUserOption(opt => opt.setName('user').setDescription('User to timeout').setRequired(true))
    .addStringOption(opt => opt.setName('duration').setDescription('Duration: 10s, 5m, 2h, 1d').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Reason for the timeout').setRequired(false)))
  .addSubcommand(sub => sub.setName('remove').setDescription('Remove a timeout from a user')
    .addUserOption(opt => opt.setName('user').setDescription('User to remove timeout from').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Reason for removing the timeout').setRequired(false)));

export async function execute(interaction) {
  const perm = await canRunCommand(interaction.user.id, 5);
  if (!perm.allowed) return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });

  let sub;
  try {
    sub = interaction.options.getSubcommand();
  } catch {
    const msg = { content: '**Available subcommands:**\n`/timeout add` — Apply a timeout to a user\n`/timeout remove` — Remove a timeout from a user' };
    if (interaction.deferred || interaction.replied) {
      return interaction.editReply(msg).catch(() => {});
    }
    return interaction.reply(msg).catch(() => {});
  }

  if (sub === 'add') {
    await handleAddTimeout(interaction);
  } else if (sub === 'remove') {
    await handleRemoveTimeout(interaction);
  }
}

async function handleAddTimeout(interaction) {
  const target = interaction.options.getUser('user');
  const durationStr = interaction.options.getString('duration');
  const reason = interaction.options.getString('reason') || 'Not specified';

  if (!interaction.inGuild()) {
    return interaction.reply({ content: '❌ This command cannot be used in DMs.', ephemeral: true });
  }

  const durationMs = parseDuration(durationStr);
  if (!durationMs || durationMs < 10000) {
    return interaction.reply({ content: '❌ Minimum timeout duration is 10 seconds. Use format: 10s, 5m, 2h, 1d', ephemeral: true });
  }
  if (durationMs > 2419200000) {
    return interaction.reply({ content: '❌ Maximum timeout duration is 28 days.', ephemeral: true });
  }

  const portalUser = getUserByDiscordId(target.id);
  const targetName = portalUser?.display_name || target.username;
  const member = await interaction.guild.members.fetch(target.id).catch(() => null);

  if (!member) {
    return interaction.reply({ content: `❌ Could not find user <@${target.id}> in this server.`, ephemeral: true });
  }

  await interaction.deferReply();

  const expiresAt = new Date(Date.now() + durationMs);
  try {
    await member.timeout(expiresAt, reason);
  } catch (err) {
    return interaction.editReply({ content: `❌ Failed to timeout <@${target.id}>: ${err.message}` });
  }

  const inf = addInfraction(target.id, 'timeout', reason, interaction.user.id, interaction.user.username);
  const durationDisplay = formatDuration(durationMs);

  try {
    await target.send({
      embeds: [new EmbedBuilder()
        .setTitle('⏱️ You Have Been Timed Out')
        .setColor(0xF59E0B)
        .setDescription(`You have been timed out in **Community Organisation**.`)
        .addFields(
          { name: '📋 Reason', value: reason, inline: false },
          { name: '⏱️ Duration', value: durationDisplay, inline: true },
          { name: 'Expires', value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>`, inline: true },
          { name: 'Issued By', value: `<@${interaction.user.id}>`, inline: true },
        )
        .setFooter({ text: 'Community Organisation | Staff Assistant' })
        .setTimestamp()
      ]
    });
  } catch {}

  await logAction(interaction.client, {
    action: '⏱️ User Timed Out',
    moderator: { discordId: interaction.user.id, name: interaction.user.username },
    target: { discordId: target.id, name: targetName },
    reason,
    color: 0xF59E0B,
    fields: [
      { name: 'User', value: `<@${target.id}>`, inline: true },
      { name: 'Duration', value: durationDisplay, inline: true },
      { name: 'Expires', value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:F>`, inline: true },
      { name: 'Reason', value: reason, inline: false },
    ],
    specificChannelId: MOD_LOG_CHANNEL_ID,
    guildId: interaction.guildId,
    logType: 'moderation.timeout',
  });

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle('⏱️ User Timed Out')
      .setColor(0xF59E0B)
      .setDescription(`**${targetName}** has been timed out.`)
      .addFields(
        { name: 'User', value: `<@${target.id}>`, inline: true },
        { name: 'Duration', value: durationDisplay, inline: true },
        { name: 'Expires', value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>`, inline: true },
        { name: 'Reason', value: reason, inline: false },
        { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Case ID', value: `#${inf.lastInsertRowid}`, inline: true },
      )
      .setFooter({ text: 'Community Organisation | Staff Assistant' })
      .setTimestamp()
    ]
  });
}

async function handleRemoveTimeout(interaction) {
  const target = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason') || 'Not specified';

  if (!interaction.inGuild()) {
    return interaction.reply({ content: '❌ This command cannot be used in DMs.', ephemeral: true });
  }

  const portalUser = getUserByDiscordId(target.id);
  const targetName = portalUser?.display_name || target.username;
  const member = await interaction.guild.members.fetch(target.id).catch(() => null);

  if (!member) {
    return interaction.reply({ content: `❌ Could not find user <@${target.id}> in this server.`, ephemeral: true });
  }

  await interaction.deferReply();

  try {
    await member.timeout(null, reason);
  } catch (err) {
    return interaction.editReply({ content: `❌ Failed to remove timeout: ${err.message}` });
  }

  try {
    await target.send({
      embeds: [new EmbedBuilder()
        .setTitle('✅ Timeout Removed')
        .setColor(0x22C55E)
        .setDescription(`Your timeout in **Community Organisation** has been removed.`)
        .addFields(
          { name: 'Removed By', value: `<@${interaction.user.id}>`, inline: true },
          ...(reason !== 'Not specified' ? [{ name: 'Reason', value: reason, inline: false }] : []),
        )
        .setFooter({ text: 'Community Organisation | Staff Assistant' })
        .setTimestamp()
      ]
    });
  } catch {}

  await logAction(interaction.client, {
    action: '✅ Timeout Removed',
    moderator: { discordId: interaction.user.id, name: interaction.user.username },
    target: { discordId: target.id, name: targetName },
    reason,
    color: 0x22C55E,
    fields: [
      { name: 'User', value: `<@${target.id}>`, inline: true },
      { name: 'Reason', value: reason, inline: false },
    ],
    specificChannelId: MOD_LOG_CHANNEL_ID,
    guildId: interaction.guildId,
    logType: 'moderation.untimeout',
  });

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle('✅ Timeout Removed')
      .setColor(0x22C55E)
      .setDescription(`Timeout for **${targetName}** has been removed.`)
      .addFields(
        { name: 'User', value: `<@${target.id}>`, inline: true },
        { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
        ...(reason !== 'Not specified' ? [{ name: 'Reason', value: reason, inline: false }] : []),
      )
      .setFooter({ text: 'Community Organisation | Staff Assistant' })
      .setTimestamp()
    ]
  });
}
