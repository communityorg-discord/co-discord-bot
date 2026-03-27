import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canRunCommand } from '../utils/permissions.js';
import { addInfraction } from '../utils/botDb.js';
import { logAction } from '../utils/logger.js';
import { MOD_LOG_CHANNEL_ID } from '../config.js';
import { getUserByDiscordId } from '../db.js';
import { resolveUser } from '../utils/resolveUser.js';

export const data = new SlashCommandBuilder()
  .setName('kick')
  .setDescription('Kick a user from the server (they can rejoin)')
  .addStringOption(opt => opt.setName('user').setDescription('User to kick (@mention or user ID)').setRequired(true))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for the kick').setRequired(false));

export async function execute(interaction) {
  const perm = await canRunCommand(interaction.user.id, 5);
  if (!perm.allowed) return interaction.reply({ content: `❌ ${perm.reason}` });

  const userArg = interaction.options.getString('user');
  const reason = interaction.options.getString('reason') || 'Not specified';

  if (!interaction.inGuild()) {
    return interaction.reply({ content: '❌ This command cannot be used in DMs.' });
  }

  const resolved = await resolveUser(userArg, interaction.guild);
  if (!resolved) {
    return interaction.reply({ content: `❌ Could not find user: ${userArg}. Use @mention or a user ID.` });
  }
  const { id: targetId, user: target } = resolved;

  const member = await interaction.guild.members.fetch(targetId).catch(() => null);
  if (!member) {
    return interaction.reply({ content: `❌ Could not find user <@${targetId}> in this server.` });
  }
  if (!member.kickable) {
    return interaction.reply({ content: `❌ I cannot kick <@${targetId}>. They may have higher permissions than me.` });
  }

  const portalUser = getUserByDiscordId(targetId);
  const targetName = portalUser?.display_name || target.username;

  await interaction.deferReply();

  const inf = addInfraction(targetId, 'kick', reason, interaction.user.id, interaction.user.username);

  await member.kick(reason).catch(err => {
    return interaction.editReply({ content: `❌ Failed to kick <@${targetId}>: ${err.message}` });
  });

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

  await logAction(interaction.client, {
    action: '👢 User Kicked',
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
      .setTitle('👢 User Kicked')
      .setColor(0xEF4444)
      .setDescription(`**${targetName}** has been kicked from the server.`)
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
