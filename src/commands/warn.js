import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canRunCommand } from '../utils/permissions.js';
import { addInfraction, getInfractions } from '../utils/botDb.js';
import { logAction } from '../utils/logger.js';
import { MOD_LOG_CHANNEL_ID } from '../config.js';
import { getUserByDiscordId } from '../db.js';
import { resolveUser } from '../utils/resolveUser.js';

// Auto-escalation thresholds for active warnings
const THRESHOLDS = [
  { count: 5, action: 'ban', label: 'Banned', color: 0x7F1D1D, emoji: '🔨' },
  { count: 3, action: 'kick', label: 'Kicked', color: 0xEF4444, emoji: '👢' },
];

export const data = new SlashCommandBuilder()
  .setName('warn')
  .setDescription('Warn a user')
  .addStringOption(opt => opt.setName('user').setDescription('User to warn (@mention or user ID)').setRequired(true))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for the warning').setRequired(true));

export async function execute(interaction) {
  const perm = await canRunCommand(interaction.user.id, 4);
  if (!perm.allowed) return interaction.reply({ content: `❌ ${perm.reason}` });

  const userArg = interaction.options.getString('user');
  const reason = interaction.options.getString('reason');

  if (!interaction.inGuild()) {
    return interaction.reply({ content: '❌ This command cannot be used in DMs.' });
  }

  const resolved = await resolveUser(userArg, interaction.guild);
  if (!resolved) {
    return interaction.reply({ content: `❌ Could not find user: ${userArg}. Use @mention or a user ID.` });
  }
  const { id: targetId, user: target } = resolved;

  const portalUser = getUserByDiscordId(targetId);
  const targetName = portalUser?.display_name || target.username;

  await interaction.deferReply();

  const inf = addInfraction(targetId, 'warning', reason, interaction.user.id, interaction.user.username);

  // DM the user
  try {
    await target.send({
      embeds: [new EmbedBuilder()
        .setTitle('⚠️ Warning Issued')
        .setColor(0xF59E0B)
        .setDescription(`You have received a warning in **Community Organisation**.`)
        .addFields(
          { name: '📋 Reason', value: reason, inline: false },
          { name: 'Issued By', value: `<@${interaction.user.id}>`, inline: true },
        )
        .setFooter({ text: 'Community Organisation | Staff Assistant' })
        .setTimestamp()
      ]
    });
  } catch {}

  // Count active warnings for auto-escalation
  const activeWarnings = getInfractions(targetId).filter(i => i.type === 'warning' && i.active);
  const warningCount = activeWarnings.length;

  let escalation = null;
  for (const threshold of THRESHOLDS) {
    if (warningCount >= threshold.count) {
      escalation = threshold;
      break;
    }
  }

  // Execute auto-escalation
  if (escalation) {
    const member = await interaction.guild.members.fetch(targetId).catch(() => null);
    if (member) {
      const escalationReason = `Auto-escalation: ${warningCount} active warnings (threshold: ${escalation.count})`;

      if (escalation.action === 'ban') {
        await interaction.guild.members.ban(targetId, {
          reason: `[Auto-Escalation] ${escalationReason}`,
          deleteMessageSeconds: 86400
        }).catch(() => {});

        // Log the infraction
        addInfraction(targetId, 'ban', escalationReason, 'AUTOMOD', 'Auto-Escalation');
      } else if (escalation.action === 'kick') {
        await member.kick(`[Auto-Escalation] ${escalationReason}`).catch(() => {});
        addInfraction(targetId, 'kick', escalationReason, 'AUTOMOD', 'Auto-Escalation');
      }

      // DM about escalation
      try {
        await target.send({
          embeds: [new EmbedBuilder()
            .setTitle(`${escalation.emoji} Auto-Escalation — ${escalation.label}`)
            .setColor(escalation.color)
            .setDescription(`You have been **${escalation.label.toLowerCase()}** from **Community Organisation** due to reaching **${warningCount} active warnings**.`)
            .addFields(
              { name: 'Threshold', value: `${escalation.count} warnings → ${escalation.label}`, inline: true },
              { name: 'Active Warnings', value: String(warningCount), inline: true },
            )
            .setFooter({ text: 'Community Organisation | Moderation' })
            .setTimestamp()
          ]
        });
      } catch {}

      // Log escalation
      await logAction(interaction.client, {
        action: `${escalation.emoji} Auto-Escalation — ${escalation.label}`,
        moderator: { discordId: 'AUTOMOD', name: 'Auto-Escalation' },
        target: { discordId: targetId, name: targetName },
        reason: escalationReason,
        color: escalation.color,
        fields: [
          { name: 'Warnings', value: `${warningCount} active`, inline: true },
          { name: 'Threshold', value: `${escalation.count} → ${escalation.action}`, inline: true },
          { name: 'Triggered By', value: `Warning from <@${interaction.user.id}>`, inline: false },
        ],
        specificChannelId: MOD_LOG_CHANNEL_ID,
        guildId: interaction.guildId,
        logType: 'moderation.warn',
      });
    }
  }

  // Log the warning itself
  await logAction(interaction.client, {
    action: '⚠️ Warning Issued',
    moderator: { discordId: interaction.user.id, name: interaction.user.username },
    target: { discordId: targetId, name: targetName },
    reason,
    color: 0xF59E0B,
    fields: [
      { name: 'User', value: `<@${targetId}>`, inline: true },
      { name: 'Reason', value: reason, inline: false },
      { name: 'Active Warnings', value: `${warningCount}`, inline: true },
      ...(escalation ? [{ name: '⚠️ AUTO-ESCALATION', value: `**${escalation.label}** triggered (${escalation.count} warning threshold)`, inline: false }] : []),
    ],
    specificChannelId: MOD_LOG_CHANNEL_ID,
    guildId: interaction.guildId,
    logType: 'moderation.warn',
  });

  // Build reply embed
  const replyEmbed = new EmbedBuilder()
    .setTitle('⚠️ Warning Issued')
    .setColor(escalation ? escalation.color : 0xF59E0B)
    .setDescription(`**${targetName}** has been warned.`)
    .addFields(
      { name: 'Case ID', value: `#${inf.lastInsertRowid}`, inline: true },
      { name: 'Reason', value: reason, inline: false },
      { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Active Warnings', value: `**${warningCount}** / 3 (kick) / 5 (ban)`, inline: false },
    )
    .setFooter({ text: 'Community Organisation | Staff Assistant' })
    .setTimestamp();

  if (escalation) {
    replyEmbed.addFields({
      name: `${escalation.emoji} AUTO-ESCALATION TRIGGERED`,
      value: `User has been **${escalation.label.toLowerCase()}** — reached ${warningCount} active warnings.`,
      inline: false
    });
  }

  await interaction.editReply({ embeds: [replyEmbed] });
}
