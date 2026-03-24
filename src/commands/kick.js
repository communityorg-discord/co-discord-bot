import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canRunCommand } from '../utils/permissions.js';
import { addInfraction } from '../utils/botDb.js';
import { logAction } from '../utils/logger.js';
import { MOD_LOG_CHANNEL_ID } from '../config.js';
import { getUserByDiscordId } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('kick')
  .setDescription('Kick a user from the server (they can rejoin)')
  .addUserOption(opt => opt.setName('user').setDescription('User to kick').setRequired(true))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for the kick').setRequired(false));

export async function execute(interaction) {
  const perm = await canRunCommand(interaction.user.id, 5);
  if (!perm.allowed) return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });

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

  if (!member.kickable) {
    return interaction.reply({ content: `❌ I cannot kick <@${target.id}>. They may have higher permissions than me.`, ephemeral: true });
  }

  await interaction.deferReply();

  const inf = addInfraction(target.id, 'kick', reason, interaction.user.id, interaction.user.username);

  // Kick the user
  await member.kick(reason).catch(err => {
    return interaction.editReply({ content: `❌ Failed to kick <@${target.id}>: ${err.message}` });
  });

  // DM the user
  try {
    await target.send({
      embeds: [new EmbedBuilder()
        .setTitle('👢 You Have Been Kicked')
        .setColor(0xEF4444)
        .setDescription(`You have been kicked from **${interaction.guild.name}**. You may rejoin if you believe this was a mistake.`)
        .addFields(
          { name: '📋 Reason', value: reason, inline: false },
          { name: 'Server', value: interaction.guild.name, inline: true },
          { name: 'Kicked By', value: `<@${interaction.user.id}>`, inline: true },
        )
        .setFooter({ text: 'Community Organisation | Staff Assistant' })
        .setTimestamp()
      ]
    });
  } catch {}

  // Log
  await logAction(interaction.client, {
    action: '👢 User Kicked',
    moderator: { discordId: interaction.user.id, name: interaction.user.username },
    target: { discordId: target.id, name: targetName },
    reason,
    color: 0xEF4444,
    fields: [
      { name: 'User', value: `<@${target.id}>`, inline: true },
      { name: 'Server', value: interaction.guild.name, inline: true },
      { name: 'Reason', value: reason, inline: false },
    ],
    specificChannelId: MOD_LOG_CHANNEL_ID,
    guildId: interaction.guildId,
    logType: 'moderation.kick',
  });

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle('👢 User Kicked')
      .setColor(0xEF4444)
      .setDescription(`**${targetName}** has been kicked from the server.`)
      .addFields(
        { name: 'User', value: `<@${target.id}>`, inline: true },
        { name: 'Reason', value: reason, inline: false },
        { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Case ID', value: `#${inf.lastInsertRowid}`, inline: true },
      )
      .setFooter({ text: 'Community Organisation | Staff Assistant' })
      .setTimestamp()
    ]
  });
}
