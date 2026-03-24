import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canRunCommand, requiresSuperuserWarning, isSuperuser } from '../utils/permissions.js';
import { terminateAcrossGuilds } from '../utils/roleManager.js';
import { addInfraction } from '../utils/botDb.js';
import { logAction } from '../utils/logger.js';
import { TERMINATE_LOG_CHANNEL_ID } from '../config.js';
import { getUserByDiscordId } from '../db.js';
import botDb from '../utils/botDb.js';

export const data = new SlashCommandBuilder()
  .setName('terminate')
  .setDescription('Terminate a staff member — removes roles, kicks from all servers')
  .addUserOption(opt => opt.setName('user').setDescription('Staff member to terminate').setRequired(true))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for termination').setRequired(true));

export async function execute(interaction) {
  const perm = canRunCommand(interaction.user.id, 5);
  if (!perm.allowed) return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });
  if (!isSuperuser(interaction.user.id) && !canRunCommand(interaction.user.id, 7).allowed) {
    return interaction.reply({ content: `❌ Termination requires Auth Level 7 or Superuser.`, ephemeral: true });
  }

  const target = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason');

  if (requiresSuperuserWarning(target.id)) {
    return interaction.reply({ content: `⚠️ **Warning:** You are attempting to moderate a Superuser. This has been logged.`, ephemeral: true });
  }

  const portalUser = getUserByDiscordId(target.id);
  await interaction.deferReply();

  try {
    await target.send({
      embeds: [new EmbedBuilder()
        .setTitle('🔴 Employment Terminated')
        .setColor(0xEF4444)
        .setDescription('Your employment with Community Organisation has been terminated.')
        .addFields(
          { name: 'Reason', value: reason },
          { name: 'Effective', value: new Date().toLocaleDateString('en-GB') }
        )
        .setFooter({ text: 'Community Organisation' })
        .setTimestamp()
      ]
    });
  } catch {}

  await terminateAcrossGuilds(interaction.client, target.id, botDb);
  addInfraction(target.id, 'termination', reason, interaction.user.id, interaction.user.username, null, 0);

  await logAction(interaction.client, {
    action: 'Staff Terminated',
    moderator: { discordId: interaction.user.id, name: interaction.user.username },
    target: { discordId: target.id, name: portalUser?.display_name || target.username },
    reason, color: 0x7F1D1D,
    specificChannelId: TERMINATE_LOG_CHANNEL_ID,
    guildId: interaction.guildId,
    logType: 'moderation.terminate',
  });

  await interaction.editReply({ embeds: [new EmbedBuilder()
    .setTitle('🔴 Staff Terminated')
    .setColor(0x7F1D1D)
    .setDescription(`**${portalUser?.display_name || target.username}** has been terminated.`)
    .addFields(
      { name: 'Reason', value: reason, inline: false },
      { name: 'Moderator', value: interaction.user.username, inline: true }
    )
    .setFooter({ text: 'Community Organisation' })
    .setTimestamp()
  ]});
}
