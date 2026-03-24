import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canRunCommand, requiresSuperuserWarning } from '../utils/permissions.js';
import { removeAllStaffRoles, addInvestigationRole, removeInvestigationRole, restorePositionRoles } from '../utils/roleManager.js';
import { startInvestigation, endInvestigation, getActiveInvestigation, addInfraction } from '../utils/botDb.js';
import { logAction } from '../utils/logger.js';
import { INVESTIGATION_LOG_CHANNEL_ID } from '../config.js';
import { getUserByDiscordId } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('investigate')
  .setDescription('Start or end a staff investigation')
  .addSubcommand(sub => sub
    .setName('start')
    .setDescription('Start an investigation')
    .addUserOption(opt => opt.setName('user').setDescription('Staff member').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Reason for investigation').setRequired(true))
  )
  .addSubcommand(sub => sub
    .setName('end')
    .setDescription('End an investigation and record outcome')
    .addUserOption(opt => opt.setName('user').setDescription('Staff member').setRequired(true))
    .addStringOption(opt => opt.setName('outcome').setDescription('Outcome').setRequired(true)
      .addChoices(
        { name: 'No Further Action', value: 'nfa' },
        { name: 'Staff Strike', value: 'strike' },
        { name: 'Verbal Warning', value: 'verbal_warning' },
        { name: 'Suspend', value: 'suspend' },
        { name: 'Staff Ban', value: 'staff_ban' },
        { name: 'Global Ban', value: 'global_ban' },
        { name: 'Terminate', value: 'terminate' }
      ))
    .addStringOption(opt => opt.setName('reason').setDescription('Reason/notes for outcome').setRequired(true))
  );

export async function execute(interaction) {
  const perm = canRunCommand(interaction.user.id, 5);
  if (!perm.allowed) return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });

  const sub = interaction.options.getSubcommand();
  const target = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason');
  const portalUser = getUserByDiscordId(target.id);

  if (requiresSuperuserWarning(target.id)) {
    return interaction.reply({ content: `⚠️ **Warning:** You are attempting to moderate a Superuser. This action has been logged.`, ephemeral: true });
  }

  await interaction.deferReply();

  if (sub === 'start') {
    const existing = getActiveInvestigation(target.id);
    if (existing) return interaction.editReply({ embeds: [new EmbedBuilder()
      .setTitle('❌ Already Under Investigation')
      .setColor(0xEF4444)
      .setDescription(`${target.username} is already under investigation.`)
    ]});

    await removeAllStaffRoles(interaction.client, target.id, `Under Investigation: ${reason}`);
    await addInvestigationRole(interaction.client, target.id);
    startInvestigation(target.id, reason, interaction.user.id);

    try {
      await target.send({
        embeds: [new EmbedBuilder()
          .setTitle('🔍 You are Under Investigation')
          .setColor(0xF59E0B)
          .setDescription('You have been placed under investigation by Community Organisation.')
          .addFields(
            { name: 'Reason', value: reason },
            { name: 'Moderator', value: interaction.user.username },
            { name: 'Note', value: 'Your roles have been temporarily removed pending the outcome of this investigation.' }
          )
          .setTimestamp()
        ]
      });
    } catch {}

    await logAction(interaction.client, {
      action: 'Investigation Started',
      moderator: { discordId: interaction.user.id, name: interaction.user.username },
      target: { discordId: target.id, name: portalUser?.display_name || target.username },
      reason, color: 0xF59E0B,
      specificChannelId: INVESTIGATION_LOG_CHANNEL_ID,
    guildId: interaction.guildId,
    logType: 'moderation.investigation',
    });

    await interaction.editReply({ embeds: [new EmbedBuilder()
      .setTitle('🔍 Investigation Started')
      .setColor(0xF59E0B)
      .setDescription(`Investigation started for **${portalUser?.display_name || target.username}**.`)
      .addFields(
        { name: 'Reason', value: reason, inline: false },
        { name: 'Moderator', value: interaction.user.username, inline: true },
        { name: 'Roles', value: 'Staff roles removed, Under Investigation role assigned.', inline: false }
      )
      .setFooter({ text: 'Community Organisation' })
      .setTimestamp()
    ]});

  } else if (sub === 'end') {
    const outcome = interaction.options.getString('outcome');
    const investigation = getActiveInvestigation(target.id);
    if (!investigation) return interaction.editReply({ embeds: [new EmbedBuilder()
      .setTitle('❌ Not Under Investigation')
      .setColor(0xEF4444)
      .setDescription(`${target.username} is not currently under investigation.`)
    ]});

    endInvestigation(target.id, outcome);
    await removeInvestigationRole(interaction.client, target.id);

    const outcomeLabels = { nfa: 'No Further Action', strike: 'Staff Strike', verbal_warning: 'Verbal Warning', suspend: 'Suspended', staff_ban: 'Staff Ban', global_ban: 'Global Ban', terminate: 'Terminated' };

    if (outcome === 'nfa') {
      if (portalUser?.position) await restorePositionRoles(interaction.client, target.id, portalUser.position);
    } else {
      addInfraction(target.id, outcome, reason, interaction.user.id, interaction.user.username);
    }

    try {
      await target.send({
        embeds: [new EmbedBuilder()
          .setTitle(`📋 Investigation Outcome: ${outcomeLabels[outcome]}`)
          .setColor(outcome === 'nfa' ? 0x22C55E : 0xEF4444)
          .addFields(
            { name: 'Outcome', value: outcomeLabels[outcome] },
            { name: 'Reason', value: reason },
            { name: 'Moderator', value: interaction.user.username }
          )
          .setTimestamp()
        ]
      });
    } catch {}

    await logAction(interaction.client, {
      action: `Investigation Ended — ${outcomeLabels[outcome]}`,
      moderator: { discordId: interaction.user.id, name: interaction.user.username },
      target: { discordId: target.id, name: portalUser?.display_name || target.username },
      reason, color: outcome === 'nfa' ? 0x22C55E : 0xEF4444,
      specificChannelId: INVESTIGATION_LOG_CHANNEL_ID,
    });

    await interaction.editReply({ embeds: [new EmbedBuilder()
      .setTitle('📋 Investigation Ended')
      .setColor(outcome === 'nfa' ? 0x22C55E : 0xEF4444)
      .setDescription(`Investigation ended for **${portalUser?.display_name || target.username}**.`)
      .addFields(
        { name: 'Outcome', value: outcomeLabels[outcome], inline: true },
        { name: 'Reason', value: reason, inline: false },
        { name: 'Moderator', value: interaction.user.username, inline: true }
      )
      .setFooter({ text: 'Community Organisation' })
      .setTimestamp()
    ]});
  }
}
