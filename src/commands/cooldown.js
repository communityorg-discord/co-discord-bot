import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { isSuperuser } from '../utils/verifyHelper.js';
import { COOLDOWN_LOG_CHANNEL_ID, MOD_LOG_CHANNEL_ID } from '../config.js';
import { logAction } from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('cooldown')
  .setDescription('Set slowmode (cooldown) on a channel')
  .addIntegerOption(opt =>
    opt.setName('seconds')
      .setDescription('Cooldown duration in seconds (0 to disable)')
      .setRequired(true)
      .setMinValue(0)
      .setMaxValue(21600)
  )
  .addStringOption(opt =>
    opt.setName('reason')
      .setDescription('Reason for setting the cooldown')
      .setRequired(true)
  )
  .addChannelOption(opt =>
    opt.setName('channel')
      .setDescription('Channel to apply cooldown to (defaults to current channel)')
      .setRequired(false)
  );

export async function execute(interaction) {
  if (!await isSuperuser(interaction.user.id)) {
    return interaction.reply({ content: '❌ Only superusers can use this command.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const seconds = interaction.options.getInteger('seconds');
  const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
  const reason = interaction.options.getString('reason');

  try {
    await targetChannel.setRateLimitPerUser(seconds);
  } catch (e) {
    return interaction.editReply({ content: `❌ Failed to set cooldown: ${e.message}` });
  }

  const durationText = seconds === 0 ? 'Disabled (no slowmode)' : `${seconds} second${seconds !== 1 ? 's' : ''}`;
  const embed = new EmbedBuilder()
    .setTitle('⏱️ Channel Cooldown Set')
    .setColor(seconds === 0 ? 0x22C55E : 0xF59E0B)
    .addFields(
      { name: 'Channel', value: `<#${targetChannel.id}>`, inline: true },
      { name: 'Duration', value: durationText, inline: true },
      { name: 'Set By', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Reason', value: reason, inline: false }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });

  // Log to cooldown-logs + full-mod-logs
  await logAction(interaction.client, {
    action: '⏱️ Channel Cooldown Set',
    moderator: { discordId: interaction.user.id, name: interaction.user.username },
    target: { discordId: targetChannel.id, name: `#${targetChannel.name}` },
    reason: reason,
    color: seconds === 0 ? 0x22C55E : 0xF59E0B,
    fields: [
      { name: 'Channel', value: `<#${targetChannel.id}>`, inline: true },
      { name: 'Duration', value: durationText, inline: true },
      { name: 'Reason', value: reason, inline: false },
    ],
    specificChannelId: COOLDOWN_LOG_CHANNEL_ID,
    guildId: interaction.guildId,
    logType: 'moderation.cooldown',
    globalLogType: 'global_moderation',
  });
}
