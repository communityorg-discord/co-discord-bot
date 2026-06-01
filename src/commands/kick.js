// COMMAND_PERMISSION_FALLBACK: auth_level >= 5
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { addInfraction } from '../utils/botDb.js';
import { logAction } from '../utils/logger.js';
import { MOD_LOG_CHANNEL_ID } from '../config.js';
import { getUserByDiscordId } from '../db.js';
import { E } from '../lib/emoji.js';

export const data = new SlashCommandBuilder()
  .setName('kick')
  .setDescription('Kick a user from the server (they can rejoin)')
  .addUserOption(opt => opt.setName('user').setDescription('User to kick').setRequired(true))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for the kick').setRequired(true));

export async function execute(interaction) {
  const perm = await canUseCommand('kick', interaction);
  if (!perm.allowed) return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });

  const target = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason');
  const targetId = target.id;

  if (!interaction.inGuild()) {
    return interaction.reply({ content: `${E.cross} This command cannot be used in DMs.` , ephemeral: true });
  }

  const member = await interaction.guild.members.fetch(targetId).catch(() => null);
  if (!member) {
    return interaction.reply({ content: `${E.cross} Could not find user <@${targetId}> in this server.`, ephemeral: true });
  }
  if (!member.kickable) {
    return interaction.reply({ content: `${E.cross} I cannot kick <@${targetId}>. They may have higher permissions than me.`, ephemeral: true });
  }

  const portalUser = getUserByDiscordId(targetId);
  const targetName = portalUser?.display_name || target.username;

  await interaction.deferReply();

  const kicked = await member.kick(reason).catch(() => null);
  if (!kicked) {
    return interaction.editReply({ content: `${E.cross} Failed to kick <@${targetId}>. They may have already left or I lack permission.` });
  }

  const inf = addInfraction(targetId, 'kick', reason, interaction.user.id, interaction.user.username);

  try {
    await target.send({
      embeds: [new EmbedBuilder()
        .setTitle('You Have Been Kicked')
        .setColor(0xEF4444)
        .setDescription(`${E.gavel} You have been kicked from **${interaction.guild.name}**. You may rejoin if you believe this was a mistake.`)
        .addFields(
          { name: 'Reason', value: reason, inline: false },
          { name: 'Server', value: interaction.guild.name, inline: true },
          { name: 'Kicked By', value: `<@${interaction.user.id}>`, inline: true },
        )
        .setFooter({ text: 'Community Organisation | Staff Assistant' })
        .setTimestamp()
      ]
    });
  } catch {}

  await logAction(interaction.client, {
    action: 'User Kicked',
    moderator: { discordId: interaction.user.id, name: interaction.user.username },
    target: { discordId: targetId, name: targetName },
    reason,
    color: 0xEF4444,
    fields: [
      { name: 'User', value: `<@${targetId}>`, inline: true },
      { name: 'Server', value: interaction.guild.name, inline: true },
      { name: 'Reason', value: reason, inline: false },
    ],
    specificChannelId: MOD_LOG_CHANNEL_ID,
    guildId: interaction.guildId,
    logType: 'moderation.kick',
  });

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle('User Kicked')
      .setColor(0xEF4444)
      .setDescription(`${E.gavel} **${targetName}** has been kicked from the server.`)
      .addFields(
        { name: 'User', value: `<@${targetId}>`, inline: true },
        { name: 'Reason', value: reason, inline: false },
        { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Case ID', value: `#${inf.lastInsertRowid}`, inline: true },
      )
      .setFooter({ text: 'Community Organisation | Staff Assistant' })
      .setTimestamp()
    ]
  });
}
