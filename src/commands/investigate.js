import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';
import { canRunCommand } from '../utils/permissions.js';
import { getPortalUser } from '../utils/verifyHelper.js';
import { addInvestigationRole, removeInvestigationRole, restorePositionRoles } from '../utils/roleManager.js';
import { addInfraction } from '../utils/botDb.js';
import { logAction } from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('investigate')
  .setDescription('Open a formal investigation case for a staff member.')
  .addUserOption(opt =>
    opt.setName('user')
      .setDescription('The staff member to investigate.')
      .setRequired(true)
  )
  .addStringOption(opt =>
    opt.setName('description')
      .setDescription('Brief description of the issue requiring investigation.')
      .setRequired(true)
  );

export async function execute(interaction) {
  const target = interaction.options.getUser('user');
  const reason = interaction.options.getString('description');

  const perm = await canRunCommand(interaction.user.id, 5);
  if (!perm) {
    return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
  }

  const portalUser = await getPortalUser(target.id);
  const displayName = portalUser?.display_name || target.username;

  const caseRef = `INV-${Date.now().toString(36).toUpperCase()}`;

  const embed = new EmbedBuilder()
    .setTitle('📋 Investigation Opened')
    .setColor(0xF59E0B)
    .setDescription(`Investigation **${caseRef}** opened for **${displayName}**.\n\nReason: ${reason}`)
    .addFields(
      { name: 'Investigated User', value: `<@${target.id}>`, inline: true },
      { name: 'Opened By', value: interaction.user.username, inline: true },
      { name: 'Case ID', value: caseRef, inline: true }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });

  await logAction(interaction.client, {
    action: '🔍 Investigation Opened',
    target: { discordId: target.id, name: displayName },
    moderator: { discordId: interaction.user.id, name: interaction.user.username },
    color: 0xF59E0B,
    description: `Case **${caseRef}**: ${reason}`
  });

  const { createPortalCase } = await import('../utils/verifyHelper.js');
  await createPortalCase({
    case_type: 'investigation',
    case_ref: caseRef,
    discord_id: target.id,
    reporter_id: interaction.user.id,
    description: reason,
  });
}

export async function handleSelect(interaction) {
  if (!interaction.customId.startsWith('investigate_')) return;

  const [action, caseId] = interaction.customId.replace('investigate_', '').split('_');
  const { getPortalCase } = await import('../utils/verifyHelper.js');
  const caseData = getPortalCase(caseId);

  if (action === 'view') {
    const target = await interaction.client.users.fetch(caseData.discord_id).catch(() => null);
    const displayName = caseData.portal_user?.display_name || target?.username || caseData.discord_id;
    const embed = new EmbedBuilder()
      .setTitle(`📋 Case ${caseData.case_ref}`)
      .setColor(0xF59E0B)
      .setDescription(caseData.description || 'No description provided.')
      .addFields(
        { name: 'Type', value: caseData.case_type, inline: true },
        { name: 'Status', value: caseData.status, inline: true },
        { name: 'Investigated', value: `<@${caseData.discord_id}> (${displayName})`, inline: false },
        { name: 'Opened', value: new Date(caseData.created_at).toLocaleString(), inline: false }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (action === 'start') {
    const target = await interaction.client.users.fetch(caseData.discord_id).catch(() => null);
    const displayName = caseData.portal_user?.display_name || target?.username || caseData.discord_id;

    if (caseData.status === 'open') {
      await addInvestigationRole(interaction.client, target.id);
      await logAction(interaction.client, {
        action: '🔍 Investigation Started',
        target: { discordId: target.id, name: displayName },
        moderator: { discordId: interaction.user.id, name: interaction.user.username },
        color: 0xF59E0B,
        description: `Investigation **${caseData.case_ref}** started for **${displayName}**.`
      });

      const embed = new EmbedBuilder()
        .setTitle('🔍 Investigation Started')
        .setColor(0xF59E0B)
        .setDescription(`Investigation **${caseData.case_ref}** has been started for **${displayName}**.\n\nThis user has been notified via DM and their access has been restricted.`)
        .addFields(
          { name: 'Case', value: caseData.case_ref, inline: true },
          { name: 'Investigated', value: displayName, inline: true }
        )
        .setTimestamp();

      await interaction.update({ embeds: [embed], components: [] });
      return;
    }

    if (caseData.status === 'in_progress') {
      const portalUser = await getPortalUser(caseData.discord_id);
      const displayName = portalUser?.display_name || caseData.discord_id;

      const outcomeOptions = [
        { label: '🔒 Suspend', value: 'suspend', description: 'Suspend the staff member' },
        { label: '🔨 Staff Ban', value: 'staff_ban', description: 'Staff ban the member' },
        { label: '🌐 Global Ban', value: 'global_ban', description: 'Globally ban the member' },
        { label: '❌ Terminate', value: 'terminate', description: 'Terminate employment' },
        { label: '⚠️ NFA — No Further Action', value: 'nfa', description: 'Close with no action' },
      ];

      const embed = new EmbedBuilder()
        .setTitle(`📋 Case ${caseData.case_ref} — Investigation In Progress`)
        .setColor(0xF59E0B)
        .setDescription(`Investigation for **${displayName}** is currently in progress.\n\nUse the select menu below to record the outcome.`)
        .addFields(
          { name: 'Reason', value: caseData.description || 'No description', inline: false },
          { name: 'Investigated', value: `<@${caseData.discord_id}>`, inline: true },
          { name: 'Investigator', value: `<@${caseData.reporter_id}>`, inline: true }
        )
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`investigate_outcome_${caseData.case_ref}`)
          .setPlaceholder('Select investigation outcome')
          .addOptions(outcomeOptions)
      );

      await interaction.update({ embeds: [embed], components: [row] });
      return;
    }

    await interaction.update({ content: 'This case is already closed.', embeds: [], components: [] });
    return;
  }

  if (action === 'outcome') {
    const [outcome, ...rest] = interaction.values[0].split('_');
    const reason2 = interaction.message.embeds[0].data.description.split('\n\n')[1]?.replace('Reason: ', '') || 'No reason provided';

    const portalUser = await getPortalUser(caseData.discord_id);
    const target = await interaction.client.users.fetch(caseData.discord_id).catch(() => null);
    const displayName = portalUser?.display_name || target?.username || caseData.discord_id;

    const outcomeLabels = { nfa: 'No Further Action', strike: 'Staff Strike', verbal_warning: 'Verbal Warning', suspend: 'Suspended', staff_ban: 'Staff Ban', global_ban: 'Global Ban', terminate: 'Terminated' };
    const outcomeManualNote = {
      suspend: '⚠️ Please run /suspend to apply the suspension.',
      staff_ban: '⚠️ Please run /ban to apply the staff ban.',
      global_ban: '⚠️ Please run /gban to apply the global ban.',
      terminate: '⚠️ Please run /terminate to end employment.',
    };

    if (outcome === 'nfa') {
      if (portalUser?.position) await restorePositionRoles(interaction.client, target.id, portalUser.position);
    } else {
      addInfraction(target.id, outcome, reason2, interaction.user.id, interaction.user.username);
    }

    await interaction.editReply({ embeds: [new EmbedBuilder()
      .setTitle('📋 Investigation Ended')
      .setColor(outcome === 'nfa' ? 0x22C55E : 0xEF4444)
      .setDescription(`Investigation ended for **${displayName}**.`)
      .addFields(
        { name: 'Outcome', value: outcomeLabels[outcome], inline: true },
        { name: 'Reason', value: reason2, inline: false },
        { name: 'Moderator', value: interaction.user.username, inline: true },
        ...(outcomeManualNote[outcome] ? [{ name: '⚠️ Next Step', value: outcomeManualNote[outcome], inline: false }] : [])
      )
      .setTimestamp()
    ], ephemeral: true });
  }
}
