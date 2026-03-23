import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canRunCommand } from '../utils/permissions.js';
import { logAction } from '../utils/logger.js';
import { BAN_UNBAN_LOG_CHANNEL_ID } from '../config.js';
import { getUserByDiscordId } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('unban')
  .setDescription('Unban a user from this server')
  .addStringOption(opt => opt.setName('userid').setDescription('Discord User ID to unban').setRequired(true))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for unbanning').setRequired(true));

export async function execute(interaction) {
  const perm = canRunCommand(interaction.user.id, 5);
  if (!perm.allowed) return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });

  const userId = interaction.options.getString('userid');
  const reason = interaction.options.getString('reason');
  const portalUser = getUserByDiscordId(userId);

  await interaction.deferReply();

  try {
    const banEntry = await interaction.guild.bans.fetch(userId).catch(() => null);
    if (!banEntry) {
      await interaction.editReply({ embeds: [new EmbedBuilder()
        .setTitle('❌ Not Banned')
        .setColor(0xEF4444)
        .setDescription(`<@${userId}> is not currently banned from this server.`)
      ]});
      return;
    }
    await interaction.guild.bans.remove(userId, `Unban | ${reason}`);
  } catch (e) {
    await interaction.editReply({ embeds: [new EmbedBuilder()
      .setTitle('❌ Unban Failed')
      .setColor(0xEF4444)
      .setDescription(`Failed to unban <@${userId}>: ${e.message}`)
    ]});
    return;
  }

  await logAction(interaction.client, {
    action: 'Local Unban',
    moderator: { discordId: interaction.user.id, name: interaction.user.username },
    target: { discordId: userId, name: portalUser?.display_name || userId },
    reason,
    color: 0x22C55E,
    fields: [
      { name: 'Server', value: interaction.guild.name, inline: true }
    ],
    specificChannelId: BAN_UNBAN_LOG_CHANNEL_ID
  });

  await interaction.editReply({ embeds: [new EmbedBuilder()
    .setTitle('✅ User Unbanned')
    .setColor(0x22C55E)
    .setDescription(`<@${userId}> has been unbanned from this server.`)
    .addFields(
      { name: 'Reason', value: reason, inline: false },
      { name: 'Moderator', value: interaction.user.username, inline: true }
    )
    .setFooter({ text: 'Community Organisation' })
    .setTimestamp()
  ]});
}
