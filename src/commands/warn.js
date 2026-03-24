import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canRunCommand } from '../utils/permissions.js';
import { addInfraction } from '../utils/botDb.js';
import { logAction } from '../utils/logger.js';
import { MOD_LOG_CHANNEL_ID } from '../config.js';
import { getUserByDiscordId } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('warn')
  .setDescription('Warn a user for misconduct')
  .addUserOption(opt => opt.setName('user').setDescription('User to warn').setRequired(true))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for the warning').setRequired(true));

export async function execute(interaction) {
  const perm = await canRunCommand(interaction.user.id, 4);
  if (!perm.allowed) return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });

  const target = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason');

  if (!interaction.inGuild()) {
    return interaction.reply({ content: '❌ This command cannot be used in DMs.', ephemeral: true });
  }

  const portalUser = getUserByDiscordId(target.id);
  const targetName = portalUser?.display_name || target.username;

  await interaction.deferReply();

  const inf = addInfraction(target.id, 'warning', reason, interaction.user.id, interaction.user.username);

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

  // Log
  await logAction(interaction.client, {
    action: '⚠️ Warning Issued',
    moderator: { discordId: interaction.user.id, name: interaction.user.username },
    target: { discordId: target.id, name: targetName },
    reason,
    color: 0xF59E0B,
    fields: [
      { name: 'User', value: `<@${target.id}>`, inline: true },
      { name: 'Reason', value: reason, inline: false },
    ],
    specificChannelId: MOD_LOG_CHANNEL_ID,
    guildId: interaction.guildId,
    logType: 'moderation.warn',
  });

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle('⚠️ Warning Issued')
      .setColor(0xF59E0B)
      .setDescription(`**${targetName}** has been warned.`)
      .addFields(
        { name: 'Case ID', value: `#${inf.lastInsertRowid}`, inline: true },
        { name: 'Reason', value: reason, inline: false },
        { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
      )
      .setFooter({ text: 'Community Organisation | Staff Assistant' })
      .setTimestamp()
    ]
  });
}
