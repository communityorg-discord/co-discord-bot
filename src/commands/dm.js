import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canRunCommand } from '../utils/permissions.js';
import { logAction } from '../utils/logger.js';
import { getUserByDiscordId } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('dm')
  .setDescription('Send a direct message to a staff member via the bot')
  .addUserOption(opt =>
    opt.setName('user')
      .setDescription('The staff member to DM')
      .setRequired(true)
  )
  .addStringOption(opt =>
    opt.setName('message')
      .setDescription('The message to send')
      .setRequired(true)
      .setMaxLength(1900)
  )
  .addStringOption(opt =>
    opt.setName('subject')
      .setDescription('Subject line for the DM (optional)')
      .setRequired(false)
      .setMaxLength(100)
  );

export async function execute(interaction) {
  const perm = canRunCommand(interaction.user.id, 5);
  if (!perm.allowed) return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });

  await interaction.deferReply({ ephemeral: true });

  const target = interaction.options.getUser('user');
  const message = interaction.options.getString('message');
  const subject = interaction.options.getString('subject') || 'Message from CO Staff Management';
  const portalUser = getUserByDiscordId(target.id);
  const senderPortalUser = getUserByDiscordId(interaction.user.id);

  const embed = new EmbedBuilder()
    .setTitle(`📩 ${subject}`)
    .setColor(0x5865F2)
    .setDescription(message)
    .addFields(
      { name: 'From', value: `${senderPortalUser?.display_name || interaction.user.username} — via CO Staff Management`, inline: false }
    )
    .setFooter({ text: 'Community Organisation | Staff Management' })
    .setTimestamp();

  try {
    await target.send({ embeds: [embed] });

    await logAction(interaction.client, {
      action: '📩 Direct Message Sent',
      moderator: { discordId: interaction.user.id, name: senderPortalUser?.display_name || interaction.user.username },
      target: { discordId: target.id, name: portalUser?.display_name || target.username },
      reason: `Subject: ${subject}`,
      color: 0x5865F2,
      fields: [
        { name: '📋 Subject', value: subject, inline: false },
        { name: '💬 Message', value: message.length > 200 ? message.slice(0, 200) + '...' : message, inline: false },
      ]
    });

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle('✅ Message Sent')
        .setColor(0x22c55e)
        .setDescription(`Your message was successfully delivered to **${portalUser?.display_name || target.username}**.`)
        .addFields(
          { name: '📋 Subject', value: subject, inline: true },
          { name: '👤 Recipient', value: `<@${target.id}>`, inline: true },
        )
        .setFooter({ text: 'Community Organisation | Staff Management' })
        .setTimestamp()
      ]
    });
  } catch (e) {
    console.error('[/dm] Failed to send DM:', e.message);
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle('❌ Failed to Send')
        .setColor(0xef4444)
        .setDescription(`Could not deliver the message to **${portalUser?.display_name || target.username}**.\n\nThis usually means they have DMs disabled or have blocked the bot.`)
        .setFooter({ text: 'Community Organisation | Staff Management' })
        .setTimestamp()
      ]
    });
  }
}
