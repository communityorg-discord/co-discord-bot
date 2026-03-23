import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canRunCommand, requiresSuperuserWarning } from '../utils/permissions.js';
import { addInfraction } from '../utils/botDb.js';
import { logAction } from '../utils/logger.js';
import { getUserByDiscordId } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('ban')
  .setDescription('Ban a user from this server only')
  .addUserOption(opt => opt.setName('user').setDescription('User to ban').setRequired(true))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for the ban').setRequired(true));

export async function execute(interaction) {
  const perm = canRunCommand(interaction.user.id, 5);
  if (!perm.allowed) return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });

  const target = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason');

  if (requiresSuperuserWarning(target.id)) {
    return interaction.reply({ content: `⚠️ **Warning:** You are attempting to moderate a Superuser. This action has been logged.`, ephemeral: true });
  }

  const portalUser = getUserByDiscordId(target.id);
  await interaction.deferReply({ ephemeral: true });

  const inf = addInfraction(target.id, 'ban', reason, interaction.user.id, interaction.user.username);
  const caseId = inf.lastInsertRowid;

  try {
    await target.send({
      embeds: [new EmbedBuilder()
        .setTitle('🔨 You Have Been Banned')
        .setColor(0x7F1D1D)
        .setDescription(`You have been banned from **${interaction.guild.name}**.`)
        .addFields(
          { name: 'Case ID', value: `#${caseId}`, inline: true },
          { name: 'Reason', value: reason, inline: false },
          { name: 'Moderator', value: interaction.user.username, inline: true },
          { name: 'Appeals', value: 'You may appeal this ban at: https://discord.gg/TeAJ6Tjxuk', inline: false }
        )
        .setFooter({ text: 'Community Organisation' })
        .setTimestamp()
      ]
    });
  } catch {}

  try {
    await interaction.guild.bans.create(target.id, { reason: `Ban | Case #${caseId} | ${reason}` });
  } catch (e) {
    await interaction.editReply({ content: `❌ Failed to ban ${target.username}: ${e.message}` });
    return;
  }

  await logAction(interaction.client, {
    action: 'Local Ban',
    moderator: { discordId: interaction.user.id, name: interaction.user.username },
    target: { discordId: target.id, name: portalUser?.display_name || target.username },
    reason,
    color: 0x7F1D1D,
    fields: [
      { name: 'Case ID', value: `#${caseId}`, inline: true },
      { name: 'Server', value: interaction.guild.name, inline: true }
    ]
  });

  await interaction.editReply({ content: `✅ **${portalUser?.display_name || target.username}** has been banned from this server. Case ID: #${caseId}` });
}
