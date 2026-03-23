import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canRunCommand, requiresSuperuserWarning } from '../utils/permissions.js';
import { removeAllStaffRoles, addSuspendedRole } from '../utils/roleManager.js';
import { addInfraction, addSuspension } from '../utils/botDb.js';
import { logAction } from '../utils/logger.js';
import { getUserByDiscordId } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('suspend')
  .setDescription('Suspend a staff member — removes roles and assigns Suspended role')
  .addUserOption(opt => opt.setName('user').setDescription('Staff member to suspend').setRequired(true))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for suspension').setRequired(true))
  .addStringOption(opt => opt.setName('duration').setDescription('Duration e.g. 7d, 24h (leave blank for indefinite)').setRequired(false));

export async function execute(interaction) {
  const perm = canRunCommand(interaction.user.id, 5);
  if (!perm.allowed) return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });

  const target = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason');
  const durationStr = interaction.options.getString('duration');

  if (requiresSuperuserWarning(target.id)) {
    return interaction.reply({ content: `⚠️ **Warning:** You are attempting to moderate a Superuser. This action has been logged.`, ephemeral: true });
  }

  const portalUser = getUserByDiscordId(target.id);
  let duration = null;
  if (durationStr) {
    const { default: ms } = await import('ms');
    duration = ms(durationStr);
  }
  const expiresAt = duration ? new Date(Date.now() + duration).toISOString() : null;

  await interaction.deferReply({ ephemeral: true });

  await removeAllStaffRoles(interaction.client, target.id, `Suspended: ${reason}`);
  await addSuspendedRole(interaction.client, target.id);

  const inf = addInfraction(target.id, 'suspension', reason, interaction.user.id, interaction.user.username);
  addSuspension(target.id, reason, interaction.user.id, expiresAt, inf.lastInsertRowid);

  try {
    await target.send({
      embeds: [new EmbedBuilder()
        .setTitle('🔴 You have been Suspended')
        .setColor(0xEF4444)
        .setDescription(`You have been suspended from Community Organisation.`)
        .addFields(
          { name: 'Reason', value: reason, inline: false },
          { name: 'Duration', value: durationStr || 'Indefinite', inline: true },
          { name: 'Moderator', value: interaction.user.username, inline: true },
          { name: 'Appeal', value: `You may appeal this decision in the Appeals Server.`, inline: false }
        )
        .setFooter({ text: 'Community Organisation' })
        .setTimestamp()
      ]
    });
  } catch {}

  await logAction(interaction.client, {
    action: 'Staff Suspended',
    moderator: { discordId: interaction.user.id, name: interaction.user.username },
    target: { discordId: target.id, name: portalUser?.display_name || target.username },
    reason,
    color: 0xEF4444,
    fields: [{ name: 'Duration', value: durationStr || 'Indefinite', inline: true }]
  });

  if (duration) {
    setTimeout(async () => {
      const { removeSuspendedRole, restorePositionRoles } = await import('../utils/roleManager.js');
      const { liftSuspension } = await import('../utils/botDb.js');
      await removeSuspendedRole(interaction.client, target.id);
      if (portalUser?.position) await restorePositionRoles(interaction.client, target.id, portalUser.position);
      liftSuspension(target.id);
      try { await target.send({ content: `✅ Your suspension from Community Organisation has ended. Your roles have been restored.` }); } catch {}
      await logAction(interaction.client, {
        action: 'Suspension Lifted (Auto)',
        moderator: { discordId: 'SYSTEM', name: 'Auto' },
        target: { discordId: target.id, name: portalUser?.display_name || target.username },
        reason: 'Suspension duration expired',
        color: 0x22C55E
      });
    }, duration);
  }

  await interaction.editReply({ content: `✅ **${portalUser?.display_name || target.username}** has been suspended${durationStr ? ` for ${durationStr}` : ' indefinitely'}.` });
}
