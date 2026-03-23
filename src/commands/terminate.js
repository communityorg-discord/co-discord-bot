import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canRunCommand, requiresSuperuserWarning, isSuperuser } from '../utils/permissions.js';
import { removeAllStaffRoles, kickFromAllServers } from '../utils/roleManager.js';
import { addInfraction } from '../utils/botDb.js';
import { logAction } from '../utils/logger.js';
import { getUserByDiscordId } from '../db.js';

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
  await interaction.deferReply({ ephemeral: true });

  await removeAllStaffRoles(interaction.client, target.id, `Terminated: ${reason}`);

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

  await kickFromAllServers(interaction.client, target.id, `Terminated: ${reason}`);
  addInfraction(target.id, 'termination', reason, interaction.user.id, interaction.user.username, null, 0);

  await logAction(interaction.client, {
    action: 'Staff Terminated',
    moderator: { discordId: interaction.user.id, name: interaction.user.username },
    target: { discordId: target.id, name: portalUser?.display_name || target.username },
    reason, color: 0x7F1D1D
  });

  await interaction.editReply({ content: `✅ **${portalUser?.display_name || target.username}** has been terminated. Roles removed and kicked from all servers.` });
}
