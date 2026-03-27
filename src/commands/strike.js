import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canRunCommand } from '../utils/permissions.js';
import { addInfraction } from '../utils/botDb.js';
import { logAction } from '../utils/logger.js';
import { STRIKE_LOG_CHANNEL_ID } from '../config.js';
import { getUserByDiscordId } from '../db.js';
import { resolveUser } from '../utils/resolveUser.js';

export const data = new SlashCommandBuilder()
  .setName('strike')
  .setDescription('Issue a staff strike to a staff member')
  .addStringOption(opt => opt.setName('user').setDescription('Staff member (@mention or user ID)').setRequired(true))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for strike').setRequired(true));

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

  const inf = addInfraction(targetId, 'staff_strike', reason, interaction.user.id, interaction.user.username);

  try {
    await target.send({
      embeds: [new EmbedBuilder()
        .setTitle('⚠️ Staff Strike Issued')
        .setColor(0xF59E0B)
        .setDescription(`You have received a staff strike in **Community Organisation**.`)
        .addFields(
          { name: '📋 Reason', value: reason, inline: false },
          { name: 'Issued By', value: `<@${interaction.user.id}>`, inline: true },
        )
        .setFooter({ text: 'Community Organisation | Staff Assistant' })
        .setTimestamp()
      ]
    });
  } catch {}

  await logAction(interaction.client, {
    action: '⚠️ Staff Strike Issued',
    moderator: { discordId: interaction.user.id, name: interaction.user.username },
    target: { discordId: targetId, name: targetName },
    reason,
    color: 0xF59E0B,
    fields: [
      { name: 'Staff Member', value: `<@${targetId}>`, inline: true },
      { name: 'Reason', value: reason, inline: false },
    ],
    specificChannelId: STRIKE_LOG_CHANNEL_ID,
    guildId: interaction.guildId,
    logType: 'moderation.strike',
  });

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle('⚠️ Staff Strike Issued')
      .setColor(0xF59E0B)
      .setDescription(`Strike issued to **${targetName}**.`)
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
