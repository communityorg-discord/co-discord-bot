// COMMAND_PERMISSION_FALLBACK: auth_level >= 5
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { unsuspendAcrossGuilds } from '../utils/roleManager.js';
import { liftSuspension, getActiveSuspension, addInfraction } from '../utils/botDb.js';
import { logAction } from '../utils/logger.js';
import { SUSPEND_UNSUSPEND_LOG_CHANNEL_ID } from '../config.js';
import { getUserByDiscordId } from '../db.js';
import botDb from '../utils/botDb.js';
import { E } from '../lib/emoji.js';
import { BRAND } from '../utils/brand.js';

export const data = new SlashCommandBuilder()
  .setName('unsuspend')
  .setDescription('Lift a suspension from a staff member')
  .addUserOption(opt => opt.setName('user').setDescription('Staff member to unsuspend').setRequired(true))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for lifting suspension').setRequired(false));

export async function execute(interaction) {
  const perm = await canUseCommand('unsuspend', interaction);
  if (!perm.allowed) return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });

  const target = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason') || 'Suspension lifted by moderator';
  const portalUser = getUserByDiscordId(target.id);
  const suspension = getActiveSuspension(target.id);

  if (!suspension) return interaction.reply({ content: `${E.cross} ${target.username} is not currently suspended.`, ephemeral: true });

  await interaction.deferReply();

  liftSuspension(target.id);
  const inf = addInfraction(target.id, 'unsuspend', reason, interaction.user.id, interaction.user.username);
  await unsuspendAcrossGuilds(interaction.client, target.id, botDb);

  try { await target.send({ content: `${E.check} Your suspension from ${BRAND.name} has been lifted. Your roles have been restored.` }); } catch {}

  await logAction(interaction.client, {
    action: 'Suspension Lifted',
    moderator: { discordId: interaction.user.id, name: interaction.user.username },
    target: { discordId: target.id, name: portalUser?.display_name || target.username },
    reason, color: 0x22C55E,
    specificChannelId: SUSPEND_UNSUSPEND_LOG_CHANNEL_ID,
    guildId: interaction.guildId,
    logType: 'moderation.suspend_unsuspend',
  });

  await interaction.editReply({ embeds: [new EmbedBuilder()
    .setColor(0x22C55E)
    .setAuthor({ name: 'Suspension Lifted', iconURL: BRAND.logo })
    .setThumbnail(target.displayAvatarURL())
    .setDescription(`${E.check} **${portalUser?.display_name || target.username}**'s suspension has been lifted and their roles restored.`)
    .addFields(
      { name: `${E.member} Member`, value: `<@${target.id}>`, inline: true },
      { name: `${E.id} Case`, value: `#${inf.lastInsertRowid}`, inline: true },
      { name: `${E.gavel} Reason`, value: reason.length > 1000 ? reason.slice(0, 1000) + '…' : reason, inline: false },
      { name: `${E.staff} Actioned by`, value: `<@${interaction.user.id}>`, inline: true }
    )
    .setFooter({ text: BRAND.footer, iconURL: BRAND.logo })
    .setTimestamp()
  ]});
}
