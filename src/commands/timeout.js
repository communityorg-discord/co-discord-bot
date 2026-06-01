// COMMAND_PERMISSION_FALLBACK: auth_level >= 5
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand, isSuperuser } from '../utils/permissions.js';
import { addInfraction } from '../utils/botDb.js';
import { logAction } from '../utils/logger.js';
import { MOD_LOG_CHANNEL_ID } from '../config.js';
import { getUserByDiscordId } from '../db.js';
import { E } from '../lib/emoji.js';

function parseDuration(str) {
  if (!str) return null;
  str = str.trim().toLowerCase();
  const unitMultipliers = {
    seconds: 1000, second: 1000, s: 1000,
    minutes: 60000, minute: 60000, m: 60000,
    hours: 3600000, hour: 3600000, h: 3600000,
    days: 86400000, day: 86400000, d: 86400000,
  };
  const pattern = /(?:(\d+)\s*(?:second(?:s)?|minute(?:s)?|hours?|hour|days?|d|h|m|s))/gi;
  let totalMs = 0;
  let found = false;
  for (const match of str.matchAll(pattern)) {
    const num = parseInt(match[1]);
    const unitStr = match[0].replace(/\d+/g, '').trim();
    const unitLower = unitStr.toLowerCase();
    const unit = unitLower.endsWith('s') ? unitLower.slice(0, -1) : unitLower;
    const multiplier = unitMultipliers[unit] || unitMultipliers[unitLower];
    if (multiplier && !isNaN(num)) {
      totalMs += num * multiplier;
      found = true;
    }
  }
  return found && totalMs > 0 ? totalMs : null;
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
    .addStringOption(opt => opt.setName('reason').setDescription('Reason for the timeout').setRequired(true)))
  .addSubcommand(sub => sub.setName('remove').setDescription('Remove a timeout from a user')
    .addUserOption(opt => opt.setName('user').setDescription('User to remove timeout from').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Reason for removing the timeout').setRequired(false)));

export async function execute(interaction) {
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

  const checkName = sub ? `timeout:${sub}` : 'timeout';
  const perm = await canUseCommand(checkName, interaction);
  if (!perm.allowed) return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });

  if (sub === 'add') {
    await handleAddTimeout(interaction);
  } else if (sub === 'remove') {
    await handleRemoveTimeout(interaction);
  }
}

async function handleAddTimeout(interaction) {
  const target = interaction.options.getUser('user');
  const targetId = target.id;
  const durationStr = interaction.options.getString('duration');
  const reason = interaction.options.getString('reason');

  if (!interaction.inGuild()) {
    return interaction.reply({ content: `${E.cross} This command cannot be used in DMs.`, ephemeral: true });
  }

  if (isSuperuser(targetId)) {
    return interaction.reply({ content: `${E.cross} <@${targetId}> is a Superuser and cannot be timed out.`, ephemeral: true });
  }

  const durationMs = parseDuration(durationStr);
  if (!durationMs || durationMs < 10000) {
    return interaction.reply({ content: `${E.cross} Invalid duration. Use formats like: 10s, 5m, 2h, 1d, 1 minute, 30 seconds, 1 hour 30 minutes`, ephemeral: true });
  }
  if (durationMs > 2419200000) {
    return interaction.reply({ content: `${E.cross} Maximum timeout duration is 28 days.`, ephemeral: true });
  }

  const member = await interaction.guild.members.fetch(targetId).catch(() => null);
  if (!member) {
    return interaction.reply({ content: `${E.cross} Could not find user <@${targetId}> in this server.` });
  }

  const portalUser = getUserByDiscordId(targetId);
  const targetName = portalUser?.display_name || target.username;

  await interaction.deferReply();

  const expiresAt = new Date(Date.now() + durationMs);
  try {
    await member.timeout(durationMs, reason);
  } catch (err) {
    return interaction.editReply({ content: `${E.cross} Failed to timeout <@${targetId}>: ${err.message}` });
  }

  const inf = addInfraction(targetId, 'timeout', reason, interaction.user.id, interaction.user.username);
  const durationDisplay = formatDuration(durationMs);

  try {
    await target.send({
      embeds: [new EmbedBuilder()
        .setTitle('You Have Been Timed Out')
        .setColor(0xF59E0B)
        .setDescription(`${E.suspend} You have been timed out in **Community Organisation**.`)
        .addFields(
          { name: 'Reason', value: reason, inline: false },
          { name: 'Duration', value: durationDisplay, inline: true },
          { name: 'Expires', value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>`, inline: true },
          { name: 'Issued By', value: `<@${interaction.user.id}>`, inline: true },
        )
        .setFooter({ text: 'Community Organisation | Staff Assistant' })
        .setTimestamp()
      ]
    });
  } catch {}

  await logAction(interaction.client, {
    action: 'User Timed Out',
    moderator: { discordId: interaction.user.id, name: interaction.user.username },
    target: { discordId: targetId, name: targetName },
    reason,
    color: 0xF59E0B,
    fields: [
      { name: 'User', value: `<@${targetId}>`, inline: true },
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
      .setTitle('User Timed Out')
      .setColor(0xF59E0B)
      .setDescription(`${E.suspend} **${targetName}** has been timed out.`)
      .addFields(
        { name: 'User', value: `<@${targetId}>`, inline: true },
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
  const targetId = target.id;
  const reason = interaction.options.getString('reason') || 'Not specified';

  if (!interaction.inGuild()) {
    return interaction.reply({ content: `${E.cross} This command cannot be used in DMs.` });
  }

  const member = await interaction.guild.members.fetch(targetId).catch(() => null);
  if (!member) {
    return interaction.reply({ content: `${E.cross} Could not find user <@${targetId}> in this server.` });
  }

  const portalUser = getUserByDiscordId(targetId);
  const targetName = portalUser?.display_name || target.username;

  await interaction.deferReply();

  try {
    await member.timeout(null, reason);
  } catch (err) {
    return interaction.editReply({ content: `${E.cross} Failed to remove timeout: ${err.message}` });
  }

  try {
    await target.send({
      embeds: [new EmbedBuilder()
        .setTitle('Timeout Removed')
        .setColor(0x22C55E)
        .setDescription(`${E.check} Your timeout in **Community Organisation** has been removed.`)
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
    action: 'Timeout Removed',
    moderator: { discordId: interaction.user.id, name: interaction.user.username },
    target: { discordId: targetId, name: targetName },
    reason,
    color: 0x22C55E,
    fields: [
      { name: 'User', value: `<@${targetId}>`, inline: true },
      { name: 'Reason', value: reason, inline: false },
    ],
    specificChannelId: MOD_LOG_CHANNEL_ID,
    guildId: interaction.guildId,
    logType: 'moderation.untimeout',
  });

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle('Timeout Removed')
      .setColor(0x22C55E)
      .setDescription(`${E.check} Timeout for **${targetName}** has been removed.`)
      .addFields(
        { name: 'User', value: `<@${targetId}>`, inline: true },
        { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
        ...(reason !== 'Not specified' ? [{ name: 'Reason', value: reason, inline: false }] : []),
      )
      .setFooter({ text: 'Community Organisation | Staff Assistant' })
      .setTimestamp()
    ]
  });
}
