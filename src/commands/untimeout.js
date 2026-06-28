// COMMAND_PERMISSION_FALLBACK: auth_level >= 5
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { logAction } from '../utils/logger.js';
import { MOD_LOG_CHANNEL_ID } from '../config.js';
import { getUserByDiscordId } from '../db.js';
import { addInfraction } from '../utils/botDb.js';
import { E } from '../lib/emoji.js';
import { BRAND } from '../utils/brand.js';

export const data = new SlashCommandBuilder()
  .setName('untimeout')
  .setDescription('Remove a timeout from a user')
  .addUserOption(opt => opt.setName('user').setDescription('User to remove timeout from').setRequired(true))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for removing the timeout').setRequired(false));

export async function execute(interaction) {
  const perm = await canUseCommand('untimeout', interaction);
  if (!perm.allowed) return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });

  const target = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason') || 'Not specified';

  if (!interaction.inGuild()) {
    return interaction.reply({ content: `${E.cross} This command cannot be used in DMs.`, ephemeral: true });
  }

  const portalUser = getUserByDiscordId(target.id);
  const targetName = portalUser?.display_name || target.username;
  const member = await interaction.guild.members.fetch(target.id).catch(() => null);

  if (!member) {
    return interaction.reply({ content: `${E.cross} Could not find user <@${target.id}> in this server.`, ephemeral: true });
  }

  await interaction.deferReply();

  // Remove timeout
  let inf;
  try {
    await member.timeout(null, reason);

    inf = addInfraction(target.id, 'untimeout', reason, interaction.user.id, interaction.user.username);
  } catch (err) {
    return interaction.editReply({ content: `${E.cross} Failed to remove timeout: ${err.message}` });
  }

  // DM the user
  try {
    await target.send({
      embeds: [new EmbedBuilder()
        .setTitle('Timeout Removed')
        .setColor(0x22C55E)
        .setDescription(`${E.check} Your timeout in **${BRAND.name}** has been removed.`)
        .addFields(
          { name: 'Removed By', value: `<@${interaction.user.id}>`, inline: true },
          ...(reason !== 'Not specified' ? [{ name: 'Reason', value: reason, inline: false }] : []),
        )
        .setFooter({ text: BRAND.footer })
        .setTimestamp()
      ]
    });
  } catch {}

  // Log
  await logAction(interaction.client, {
    action: 'Timeout Removed',
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
      .setTitle('Timeout Removed')
      .setColor(0x22C55E)
      .setDescription(`${E.check} Timeout for **${targetName}** has been removed.`)
      .addFields(
        { name: 'User', value: `<@${target.id}>`, inline: true },
        { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
        ...(reason !== 'Not specified' ? [{ name: 'Reason', value: reason, inline: false }] : []),
        { name: 'Case ID', value: `#${inf.lastInsertRowid}`, inline: true },
      )
      .setFooter({ text: BRAND.footer })
      .setTimestamp()
    ]
  });
}
