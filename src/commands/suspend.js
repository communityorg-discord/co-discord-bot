import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canRunCommand } from '../utils/permissions.js';
import { removeAllStaffRoles, addSuspendedRole, suspendAcrossGuilds } from '../utils/roleManager.js';
import { addInfraction, addSuspension } from '../utils/botDb.js';
import { logAction } from '../utils/logger.js';
import { SUSPEND_UNSUSPEND_LOG_CHANNEL_ID } from '../config.js';
import { getUserByDiscordId } from '../db.js';

function formatDuration(ms) {
  if (!ms) return 'Indefinite';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days} day${days !== 1 ? 's' : ''}`;
  if (hours > 0) return `${hours} hour${hours !== 1 ? 's' : ''}`;
  if (minutes > 0) return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  return `${seconds} second${seconds !== 1 ? 's' : ''}`;
}

export const data = new SlashCommandBuilder()
  .setName('suspend')
  .setDescription('Suspend a staff member — removes roles and assigns Suspended role')
  .addUserOption(opt => opt.setName('user').setDescription('Staff member to suspend').setRequired(true))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for suspension').setRequired(true))
  .addStringOption(opt => opt.setName('duration').setDescription('Duration e.g. 7d, 24h, 1m (leave blank for indefinite)').setRequired(false));

export async function execute(interaction) {
  const perm = canRunCommand(interaction.user.id, 5);
  if (!perm.allowed) return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });

  const target = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason');
  const durationStr = interaction.options.getString('duration');

  const portalUser = getUserByDiscordId(target.id);

  let duration = null;
  if (durationStr) {
    const { default: ms } = await import('ms');
    duration = ms(durationStr);
    if (!duration) return interaction.reply({ content: `❌ Invalid duration format. Use e.g. \`7d\`, \`24h\`, \`30m\`.`, ephemeral: true });
  }

  const expiresAt = duration ? new Date(Date.now() + duration).toISOString() : null;
  const durationDisplay = formatDuration(duration);
  const expiresDisplay = expiresAt ? `<t:${Math.floor(new Date(expiresAt).getTime() / 1000)}:F>` : 'Never';
  const moderatorName = portalUser ? interaction.user.username : interaction.user.username;
  const targetName = portalUser?.display_name || target.username;

  await interaction.deferReply();

  await removeAllStaffRoles(interaction.client, target.id, `Suspended: ${reason}`);
  await addSuspendedRole(interaction.client, target.id);
  await suspendAcrossGuilds(interaction.client, target.id);

  const inf = addInfraction(target.id, 'suspension', reason, interaction.user.id, interaction.user.username);
  addSuspension(target.id, reason, interaction.user.id, expiresAt, inf.lastInsertRowid);

  // DM the suspended user
  try {
    await target.send({
      embeds: [new EmbedBuilder()
        .setTitle('🔴 You Have Been Suspended')
        .setColor(0xEF4444)
        .setDescription(`You have been suspended from **Community Organisation**.\n\nIf you believe this is an error, you may appeal in the Appeals Server.`)
        .addFields(
          { name: '📋 Reason', value: reason, inline: false },
          { name: '⏱️ Duration', value: durationDisplay, inline: true },
          { name: '📅 Expires', value: expiresDisplay, inline: true },
          { name: '👤 Actioned By', value: `<@${interaction.user.id}>`, inline: true },
        )
        .setFooter({ text: 'Community Organisation | Staff Assistant' })
        .setTimestamp()
      ]
    });
  } catch {}

  // Audit log
  await logAction(interaction.client, {
    action: '🔴 Staff Suspended',
    moderator: { discordId: interaction.user.id, name: interaction.user.username },
    target: { discordId: target.id, name: targetName },
    reason,
    color: 0xEF4444,
    fields: [
      { name: '⏱️ Duration', value: durationDisplay, inline: true },
      { name: '📅 Expires', value: expiresDisplay, inline: true },
      { name: '👤 Actioned By', value: `<@${interaction.user.id}> (${interaction.user.username})`, inline: true },
    ],
    specificChannelId: SUSPEND_UNSUSPEND_LOG_CHANNEL_ID
  });

  // Auto-lift if timed
  if (duration) {
    setTimeout(async () => {
      const { removeSuspendedRole, restorePositionRoles } = await import('../utils/roleManager.js');
      const { liftSuspension } = await import('../utils/botDb.js');
      await removeSuspendedRole(interaction.client, target.id);
      if (portalUser?.position) await restorePositionRoles(interaction.client, target.id, portalUser.position);
      liftSuspension(target.id);
      try {
        await target.send({
          embeds: [new EmbedBuilder()
            .setTitle('✅ Suspension Lifted')
            .setColor(0x22C55E)
            .setDescription(`Your suspension from **Community Organisation** has ended and your roles have been restored.`)
            .setFooter({ text: 'Community Organisation | Staff Assistant' })
            .setTimestamp()
          ]
        });
      } catch {}
      await logAction(interaction.client, {
        action: '✅ Suspension Lifted (Auto)',
        moderator: { discordId: 'SYSTEM', name: 'Automated' },
        target: { discordId: target.id, name: targetName },
        reason: 'Suspension duration expired',
        color: 0x22C55E,
        fields: [
          { name: '⏱️ Original Duration', value: durationDisplay, inline: true },
          { name: '👤 Originally Actioned By', value: `<@${interaction.user.id}> (${interaction.user.username})`, inline: true },
        ],
        specificChannelId: SUSPEND_UNSUSPEND_LOG_CHANNEL_ID
      });
    }, duration);
  }

  // Reply embed
  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle('🔴 Staff Suspended')
      .setColor(0xEF4444)
      .setDescription(`**${targetName}** has been suspended from Community Organisation.`)
      .addFields(
        { name: '📋 Reason', value: reason, inline: false },
        { name: '⏱️ Duration', value: durationDisplay, inline: true },
        { name: '📅 Expires', value: expiresDisplay, inline: true },
        { name: '👤 Actioned By', value: `<@${interaction.user.id}>`, inline: true },
      )
      .setFooter({ text: 'Community Organisation | Staff Assistant' })
      .setTimestamp()
    ]
  });
}
