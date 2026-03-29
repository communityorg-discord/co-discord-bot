import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { isSuperuser, getPortalUser } from '../utils/permissions.js';
import { createAssignment, generateAssignmentNumber, getAssignment, updateAssignment, getAssignmentStats } from '../utils/botDb.js';
import { getUserByDiscordId } from '../db.js';
import { logAction } from '../utils/logger.js';
import fetch from 'node-fetch';

const ASSIGNMENTS_CHANNEL_ID = '1487630065008115824';
const SUPERUSER_IDS = ['723199054514749450', '415922272956710912', '1013486189891817563'];

const MANAGER_POSITIONS = [
  'Line Manager', 'Supervisor', 'Director', 'Secretary-General',
  'Deputy Secretary-General', 'Chef de Cabinet', 'Director-General',
  'Under Secretary-General', 'Assistant Secretary-General', 'Deputy Director',
  'Senior Advisor'
];

function canAssign(portalUser) {
  if (!portalUser) return false;
  if ((portalUser.auth_level || 0) >= 5) return true;
  const pos = (portalUser.position || '').toLowerCase();
  return MANAGER_POSITIONS.some(mp => pos.includes(mp.toLowerCase()));
}

function canDelegate(portalUser) {
  return canAssign(portalUser);
}

// Parse duration strings into a due Date
function parseDuration(input) {
  const now = new Date();
  const lower = input.toLowerCase().trim();

  // "until sunday", "until friday" etc.
  const untilMatch = lower.match(/^until\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i);
  if (untilMatch) {
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const targetDay = dayNames.indexOf(untilMatch[1].toLowerCase());
    const d = new Date(now);
    let daysAhead = targetDay - d.getDay();
    if (daysAhead <= 0) daysAhead += 7;
    d.setDate(d.getDate() + daysAhead);
    d.setHours(23, 59, 0, 0);
    return d;
  }

  // "3d", "1w", "24h", "30m", "3 days", "1 week", "24 hours", "30 minutes"
  const durationMatch = lower.match(/^(\d+)\s*(minute|minutes|min|hour|hours|day|days|week|weeks|month|months|m|h|d|w|mo)$/);
  if (durationMatch) {
    const num = parseInt(durationMatch[1]);
    const unit = durationMatch[2];
    const d = new Date(now);
    if (unit === 'm' || unit === 'min' || unit.startsWith('minute')) d.setMinutes(d.getMinutes() + num);
    else if (unit === 'h' || unit.startsWith('hour')) d.setHours(d.getHours() + num);
    else if (unit === 'd' || unit.startsWith('day')) d.setDate(d.getDate() + num);
    else if (unit === 'w' || unit.startsWith('week')) d.setDate(d.getDate() + num * 7);
    else if (unit === 'mo' || unit.startsWith('month')) d.setMonth(d.getMonth() + num);
    return d;
  }

  // Try parsing as a date directly
  const parsed = new Date(input);
  if (!isNaN(parsed.getTime()) && parsed > now) {
    parsed.setHours(23, 59, 0, 0);
    return parsed;
  }

  return null;
}

function getWeekKey(ts = Date.now()) {
  const d = new Date(ts);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function formatDate(d) {
  const date = new Date(d);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' at ' + date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatDateShort(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const STATUS_COLOURS = {
  pending: 0x5865F2,
  awaiting_confirmation: 0xF59E0B,
  complete: 0x22C55E,
  overdue: 0xEF4444,
  cancelled: 0x6B7280,
};

export function buildAssignmentEmbed(assignment, assignerName, assigneeName, opts = {}) {
  const status = assignment.status || 'pending';
  const statusLabels = {
    pending: '🟣 PENDING',
    awaiting_confirmation: '⏳ AWAITING CONFIRMATION',
    complete: '✅ COMPLETE',
    overdue: '🔴 OVERDUE',
    cancelled: '⬛ CANCELLED',
  };

  const embed = new EmbedBuilder()
    .setTitle(`🗂️ ${opts.delegated ? 'DELEGATED ASSIGNMENT' : 'NEW ASSIGNMENT'}`)
    .setColor(STATUS_COLOURS[status] || 0x5865F2)
    .setDescription(assignment.title + (assignment.description ? `\n\n${assignment.description}` : ''))
    .addFields(
      { name: 'Assigned To', value: `<@${assignment.assigned_to}>`, inline: true },
      { name: 'Assigned By', value: `<@${assignment.assigned_by}>`, inline: true },
      { name: 'Team', value: assignment.team || '—', inline: true },
      { name: 'Due Date', value: formatDate(assignment.due_date), inline: true },
      { name: 'Created', value: formatDateShort(assignment.created_at || new Date().toISOString()), inline: true },
      { name: 'Status', value: statusLabels[status] || status, inline: true },
    )
    .setFooter({ text: `Assignment ID: ${opts.assignmentNumber || 'ASN-????-???'} | Community Organisation` })
    .setTimestamp();

  if (assignment.completion_notes && status === 'awaiting_confirmation') {
    embed.addFields({ name: '📝 Completion Notes', value: assignment.completion_notes, inline: false });
  }

  if (opts.notes) {
    embed.addFields({ name: '📋 Notes', value: opts.notes, inline: false });
  }

  if (opts.delegatedTo) {
    embed.addFields({ name: '🔄 Delegated To', value: `<@${opts.delegatedTo}>`, inline: false });
  }

  if (opts.completedBy) {
    embed.addFields({ name: '✅ Completed By', value: opts.completedBy, inline: false });
  }

  if (opts.extensionNote) {
    embed.addFields({ name: '📅 Extension', value: opts.extensionNote, inline: false });
  }

  if (opts.caseNumber) {
    embed.addFields({ name: '📋 Case Raised', value: opts.caseNumber, inline: false });
  }

  return embed;
}

export function buildAssignmentButtons(assignmentId, status) {
  if (status === 'complete' || status === 'cancelled') return [];
  if (status === 'awaiting_confirmation') {
    return [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`assign_disabled`).setLabel('Awaiting assigner confirmation...').setStyle(ButtonStyle.Secondary).setDisabled(true)
    )];
  }
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`assign_complete_${assignmentId}`).setLabel('Mark as Complete').setStyle(ButtonStyle.Success).setEmoji('✅'),
    new ButtonBuilder().setCustomId(`assign_delegate_${assignmentId}`).setLabel('Delegate').setStyle(ButtonStyle.Primary).setEmoji('🔄'),
    new ButtonBuilder().setCustomId(`assign_cancel_${assignmentId}`).setLabel('Cancel').setStyle(ButtonStyle.Danger).setEmoji('❌'),
  )];
}

// ── Slash command ────────────────────────────────────────────────────────────

export const data = new SlashCommandBuilder()
  .setName('assign')
  .setDescription('Create a task assignment for a staff member')
  .addUserOption(opt => opt.setName('assigned_to').setDescription('Staff member to assign the task to').setRequired(true))
  .addStringOption(opt => opt.setName('task').setDescription('Task description').setRequired(true))
  .addStringOption(opt => opt.setName('duration').setDescription('Duration e.g. "3 days", "1 week", "until Sunday"').setRequired(true))
  .addStringOption(opt => opt.setName('team').setDescription('Team name for context').setRequired(false))
  .addStringOption(opt => opt.setName('notes').setDescription('Additional notes').setRequired(false));

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const assignerPortal = getPortalUser(interaction.user.id);
  if (!assignerPortal || !canAssign(assignerPortal)) {
    return interaction.editReply({ content: '❌ Only line managers and supervisors can create assignments.' });
  }

  const targetUser = interaction.options.getUser('assigned_to');
  const taskDesc = interaction.options.getString('task');
  const durationStr = interaction.options.getString('duration');
  const team = interaction.options.getString('team');
  const notes = interaction.options.getString('notes');

  const assigneePortal = getUserByDiscordId(targetUser.id);
  if (!assigneePortal) {
    return interaction.editReply({ content: '❌ The assigned user is not linked to the CO Staff Portal.' });
  }

  const dueDate = parseDuration(durationStr);
  if (!dueDate) {
    return interaction.editReply({ content: '❌ Could not parse duration. Use formats like: `3 days`, `1 week`, `24 hours`, `until Sunday`' });
  }

  const weekKey = getWeekKey(dueDate.getTime());
  const assignmentNumber = generateAssignmentNumber();

  // Create in portal DB via API
  let portalAssignmentId = null;
  try {
    const resp = await fetch('http://localhost:3016/api/assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET },
      body: JSON.stringify({
        assigned_to: assigneePortal.id,
        assigned_by: assignerPortal.id,
        title: taskDesc,
        description: notes || null,
        team: team || null,
        due_date: dueDate.toISOString(),
        week_key: weekKey,
      })
    });
    const data = await resp.json();
    if (data.id) portalAssignmentId = data.id;
  } catch (e) {
    console.error('[assign] Portal API error:', e.message);
  }

  // Create in bot DB
  const result = createAssignment({
    title: taskDesc,
    description: notes || null,
    assignedTo: targetUser.id,
    assignedBy: interaction.user.id,
    team: team || null,
    dueDate: dueDate.toISOString(),
    portalAssignmentId,
  });
  const botAssignmentId = result.lastInsertRowid;

  // Update portal with bot assignment ID
  if (portalAssignmentId) {
    try {
      await fetch(`http://localhost:3016/api/assignments/${portalAssignmentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET },
        body: JSON.stringify({ bot_assignment_id: botAssignmentId })
      });
    } catch {}
  }

  // Post embed to assignments channel
  const assignmentData = {
    title: taskDesc,
    description: notes || null,
    assigned_to: targetUser.id,
    assigned_by: interaction.user.id,
    team: team || null,
    due_date: dueDate.toISOString(),
    status: 'pending',
    created_at: new Date().toISOString(),
  };

  const embed = buildAssignmentEmbed(assignmentData, assignerPortal.display_name, assigneePortal.display_name, { assignmentNumber, notes });
  const buttons = buildAssignmentButtons(botAssignmentId, 'pending');

  try {
    const channel = await interaction.client.channels.fetch(ASSIGNMENTS_CHANNEL_ID);
    const msg = await channel.send({ embeds: [embed], components: buttons });
    updateAssignment(botAssignmentId, { message_id: msg.id, channel_id: msg.channelId });
  } catch (e) {
    console.error('[assign] Channel send error:', e.message);
  }

  // DM the assigned person
  try {
    await targetUser.send({ embeds: [new EmbedBuilder()
      .setTitle('📋 New Assignment')
      .setColor(0x5865F2)
      .setDescription(`You have been assigned a new task by **${assignerPortal.display_name}**.\n\n**Task:** ${taskDesc}\n**Due:** ${formatDate(dueDate)}\n\nCheck <#${ASSIGNMENTS_CHANNEL_ID}> for details.`)
      .setFooter({ text: `Assignment: ${assignmentNumber} | Community Organisation` })
      .setTimestamp()
    ]});
  } catch {}

  await logAction(interaction.client, {
    action: '📋 Assignment Created',
    moderator: { discordId: interaction.user.id, name: assignerPortal.display_name },
    target: { discordId: targetUser.id, name: assigneePortal.display_name },
    reason: taskDesc,
    color: 0x5865F2,
    fields: [
      { name: 'Due Date', value: formatDate(dueDate), inline: true },
      { name: 'Team', value: team || '—', inline: true },
      { name: 'Assignment', value: assignmentNumber, inline: true },
    ],
    logType: 'moderation.assignment',
    guildId: interaction.guildId
  });

  return interaction.editReply({ content: `✅ Assignment **${assignmentNumber}** created successfully. ${assigneePortal.display_name} has been notified.` });
}

// ── Button Handlers ──────────────────────────────────────────────────────────

export async function handleButton(interaction) {
  const customId = interaction.customId;

  // ── Mark as Complete ──
  if (customId.startsWith('assign_complete_')) {
    const assignmentId = parseInt(customId.split('_')[2]);
    const assignment = getAssignment(assignmentId);
    if (!assignment) return interaction.reply({ content: '❌ Assignment not found.', ephemeral: true });

    const isSU = SUPERUSER_IDS.includes(interaction.user.id);
    const isAssignee = interaction.user.id === assignment.assigned_to;

    if (!isAssignee && !isSU) {
      return interaction.reply({ content: '❌ Only the assigned person can mark this as complete.', ephemeral: true });
    }

    // Superuser override — skip confirmation
    if (isSU && !isAssignee) {
      updateAssignment(assignmentId, {
        status: 'complete',
        completed_at: new Date().toISOString(),
        confirmed_at: new Date().toISOString(),
        confirmed_by: interaction.user.id,
      });

      // Update portal
      if (assignment.portal_assignment_id) {
        try {
          await fetch(`http://localhost:3016/api/assignments/${assignment.portal_assignment_id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET },
            body: JSON.stringify({ status: 'complete', completed_at: new Date().toISOString(), confirmed_at: new Date().toISOString(), brag_counted: 1 })
          });
        } catch {}
      }

      const suName = getUserByDiscordId(interaction.user.id)?.display_name || interaction.user.username;
      const updated = getAssignment(assignmentId);
      const embed = buildAssignmentEmbed(updated, null, null, {
        assignmentNumber: `ASN-${assignmentId}`,
        completedBy: `${suName} (superuser override)`,
      });
      await interaction.update({ embeds: [embed], components: [] });

      // DM assigned person
      try {
        const assignee = await interaction.client.users.fetch(assignment.assigned_to);
        await assignee.send({ content: `✅ Your task **"${assignment.title}"** has been marked complete by **${suName}** (superuser override).` });
      } catch {}
      return;
    }

    // Normal flow — show completion modal
    await interaction.showModal(new ModalBuilder()
      .setCustomId(`assign_complete_modal_${assignmentId}`)
      .setTitle('Confirm Task Completion')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('completion_notes')
            .setLabel('Completion notes (optional)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(1000)
            .setPlaceholder('Any notes about task completion...')
        )
      )
    );
  }

  // ── Cancel Assignment ──
  if (customId.startsWith('assign_cancel_')) {
    const assignmentId = parseInt(customId.split('_')[2]);
    const assignment = getAssignment(assignmentId);
    if (!assignment) return interaction.reply({ content: '❌ Assignment not found.', ephemeral: true });

    const isSU = SUPERUSER_IDS.includes(interaction.user.id);
    const isAssigner = interaction.user.id === assignment.assigned_by;

    if (!isAssigner && !isSU) {
      return interaction.reply({ content: '❌ Only the assigner or a superuser can cancel this.', ephemeral: true });
    }

    updateAssignment(assignmentId, { status: 'cancelled' });

    if (assignment.portal_assignment_id) {
      try {
        await fetch(`http://localhost:3016/api/assignments/${assignment.portal_assignment_id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET },
          body: JSON.stringify({ status: 'cancelled' })
        });
      } catch {}
    }

    const updated = getAssignment(assignmentId);
    const embed = buildAssignmentEmbed(updated, null, null, { assignmentNumber: `ASN-${assignmentId}` });
    await interaction.update({ embeds: [embed], components: [] });

    try {
      const assignee = await interaction.client.users.fetch(assignment.assigned_to);
      const cancellerName = getUserByDiscordId(interaction.user.id)?.display_name || interaction.user.username;
      await assignee.send({ content: `❌ Your assignment **"${assignment.title}"** has been cancelled by **${cancellerName}**.` });
    } catch {}
  }

  // ── Delegate ──
  if (customId.startsWith('assign_delegate_')) {
    const assignmentId = parseInt(customId.split('_')[2]);
    const assignment = getAssignment(assignmentId);
    if (!assignment) return interaction.reply({ content: '❌ Assignment not found.', ephemeral: true });

    if (interaction.user.id !== assignment.assigned_to) {
      return interaction.reply({ content: '❌ Only the assigned person can delegate this task.', ephemeral: true });
    }

    const delegatorPortal = getPortalUser(interaction.user.id);
    if (!delegatorPortal || !canDelegate(delegatorPortal)) {
      return interaction.reply({ content: '❌ Only the assigned person can delegate, and only if they hold a line manager or supervisor role.', ephemeral: true });
    }

    await interaction.showModal(new ModalBuilder()
      .setCustomId(`assign_delegate_modal_${assignmentId}`)
      .setTitle('Delegate Assignment')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('delegate_to')
            .setLabel('Delegate to (Discord user ID)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('e.g. 723199054514749450')
            .setMaxLength(20)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('delegate_reason')
            .setLabel('Reason for delegation')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(500)
        )
      )
    );
  }

  // ── Assigner confirms completion ──
  if (customId.startsWith('assign_confirm_')) {
    const assignmentId = parseInt(customId.split('_')[2]);
    const assignment = getAssignment(assignmentId);
    if (!assignment) return interaction.reply({ content: '❌ Assignment not found.', ephemeral: true });

    updateAssignment(assignmentId, {
      status: 'complete',
      confirmed_at: new Date().toISOString(),
      confirmed_by: interaction.user.id,
    });

    // Update portal
    if (assignment.portal_assignment_id) {
      try {
        await fetch(`http://localhost:3016/api/assignments/${assignment.portal_assignment_id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET },
          body: JSON.stringify({ status: 'complete', confirmed_at: new Date().toISOString(), brag_counted: 1 })
        });
      } catch {}
    }

    // Update Discord embed
    try {
      const channel = await interaction.client.channels.fetch(assignment.channel_id);
      const msg = await channel.messages.fetch(assignment.message_id);
      const confirmerName = getUserByDiscordId(interaction.user.id)?.display_name || interaction.user.username;
      const updated = getAssignment(assignmentId);
      const embed = buildAssignmentEmbed(updated, null, null, { assignmentNumber: `ASN-${assignmentId}` });
      await msg.edit({ embeds: [embed], components: [] });
    } catch (e) { console.error('[assign] embed update error:', e.message); }

    // DM the assigned person
    try {
      const assignee = await interaction.client.users.fetch(assignment.assigned_to);
      const confirmerName = getUserByDiscordId(interaction.user.id)?.display_name || interaction.user.username;
      await assignee.send({ content: `✅ Your task completion for **"${assignment.title}"** has been confirmed by **${confirmerName}**. Well done.` });
    } catch {}

    await interaction.update({ content: '✅ Task completion confirmed. The assignee has been notified.', embeds: [], components: [] });
  }

  // ── Assigner rejects completion ──
  if (customId.startsWith('assign_reject_')) {
    const assignmentId = parseInt(customId.split('_')[2]);
    await interaction.showModal(new ModalBuilder()
      .setCustomId(`assign_reject_modal_${assignmentId}`)
      .setTitle('Rejection Feedback')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('reject_reason')
            .setLabel('What needs to be done?')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1000)
        )
      )
    );
  }
}

// ── Modal Handlers ───────────────────────────────────────────────────────────

export async function handleModal(interaction) {
  const customId = interaction.customId;

  // ── Completion modal submitted ──
  if (customId.startsWith('assign_complete_modal_')) {
    const assignmentId = parseInt(customId.split('_')[3]);
    const assignment = getAssignment(assignmentId);
    if (!assignment) return interaction.reply({ content: '❌ Assignment not found.', ephemeral: true });

    const completionNotes = interaction.fields.getTextInputValue('completion_notes') || '';

    updateAssignment(assignmentId, {
      status: 'awaiting_confirmation',
      completion_notes: completionNotes || null,
      completed_at: new Date().toISOString(),
    });

    // Update portal
    if (assignment.portal_assignment_id) {
      try {
        await fetch(`http://localhost:3016/api/assignments/${assignment.portal_assignment_id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET },
          body: JSON.stringify({ status: 'awaiting_confirmation', completion_notes: completionNotes || null, completed_at: new Date().toISOString() })
        });
      } catch {}
    }

    // Update embed
    try {
      const channel = await interaction.client.channels.fetch(assignment.channel_id);
      const msg = await channel.messages.fetch(assignment.message_id);
      const updated = getAssignment(assignmentId);
      const embed = buildAssignmentEmbed(updated, null, null, { assignmentNumber: `ASN-${assignmentId}` });
      await msg.edit({ embeds: [embed], components: buildAssignmentButtons(assignmentId, 'awaiting_confirmation') });
    } catch (e) { console.error('[assign] embed update error:', e.message); }

    // DM the assigner with confirm/reject buttons
    try {
      const assigner = await interaction.client.users.fetch(assignment.assigned_by);
      const assigneeName = getUserByDiscordId(assignment.assigned_to)?.display_name || 'Unknown';
      await assigner.send({
        embeds: [new EmbedBuilder()
          .setTitle('✅ Task Completion — Action Required')
          .setColor(0xF59E0B)
          .setDescription(`**${assigneeName}** has marked the following task as complete:\n\n> "${assignment.title}"\n\n**Assignment:** ASN-${assignmentId}\n**Completed at:** ${formatDate(new Date())}\n**Notes:** ${completionNotes || 'None provided'}\n\nDo you confirm this task was completed satisfactorily?`)
          .setFooter({ text: 'Community Organisation | Staff Assistant' })
          .setTimestamp()
        ],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`assign_confirm_${assignmentId}`).setLabel('Confirm Complete').setStyle(ButtonStyle.Success).setEmoji('✅'),
          new ButtonBuilder().setCustomId(`assign_reject_${assignmentId}`).setLabel('Not Satisfied').setStyle(ButtonStyle.Danger).setEmoji('❌'),
        )]
      });
    } catch (e) { console.error('[assign] assigner DM error:', e.message); }

    await interaction.reply({ content: '✅ Marked as complete. Your assigner has been notified for confirmation.', ephemeral: true });
  }

  // ── Rejection reason modal ──
  if (customId.startsWith('assign_reject_modal_')) {
    const assignmentId = parseInt(customId.split('_')[3]);
    const assignment = getAssignment(assignmentId);
    if (!assignment) return interaction.reply({ content: '❌ Assignment not found.', ephemeral: true });

    const rejectReason = interaction.fields.getTextInputValue('reject_reason');

    updateAssignment(assignmentId, {
      status: 'pending',
      completion_notes: null,
      completed_at: null,
    });

    // Update portal
    if (assignment.portal_assignment_id) {
      try {
        await fetch(`http://localhost:3016/api/assignments/${assignment.portal_assignment_id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET },
          body: JSON.stringify({ status: 'pending', completion_notes: null, completed_at: null })
        });
      } catch {}
    }

    // Update embed back to pending
    try {
      const channel = await interaction.client.channels.fetch(assignment.channel_id);
      const msg = await channel.messages.fetch(assignment.message_id);
      const updated = getAssignment(assignmentId);
      const embed = buildAssignmentEmbed(updated, null, null, { assignmentNumber: `ASN-${assignmentId}` });
      await msg.edit({ embeds: [embed], components: buildAssignmentButtons(assignmentId, 'pending') });
    } catch (e) { console.error('[assign] embed update error:', e.message); }

    // DM assigned person with feedback
    try {
      const assignee = await interaction.client.users.fetch(assignment.assigned_to);
      const assignerName = getUserByDiscordId(assignment.assigned_by)?.display_name || 'Your assigner';
      await assignee.send({ embeds: [new EmbedBuilder()
        .setTitle('❌ Task Completion Not Accepted')
        .setColor(0xEF4444)
        .setDescription(`Your task completion was not accepted by **${assignerName}**.\n\n**Task:** ${assignment.title}\n**Reason:** ${rejectReason}\n\nThe task remains open. Please address the feedback and mark it complete again when ready.`)
        .setFooter({ text: 'Community Organisation | Staff Assistant' })
        .setTimestamp()
      ]});
    } catch {}

    await interaction.update({ content: '✅ Rejection sent. The assignee has been notified with your feedback.', embeds: [], components: [] });
  }

  // ── Delegation modal ──
  if (customId.startsWith('assign_delegate_modal_')) {
    const assignmentId = parseInt(customId.split('_')[3]);
    const assignment = getAssignment(assignmentId);
    if (!assignment) return interaction.reply({ content: '❌ Assignment not found.', ephemeral: true });

    const delegateToId = interaction.fields.getTextInputValue('delegate_to').trim().replace(/[<@!>]/g, '');
    const delegateReason = interaction.fields.getTextInputValue('delegate_reason');

    const delegatePortal = getUserByDiscordId(delegateToId);
    if (!delegatePortal) {
      return interaction.reply({ content: '❌ That user is not linked to the CO Staff Portal.', ephemeral: true });
    }

    const weekKey = getWeekKey(new Date(assignment.due_date).getTime());
    const assignmentNumber = generateAssignmentNumber();

    // Create portal assignment for delegate
    let portalDelegateId = null;
    try {
      const resp = await fetch('http://localhost:3016/api/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET },
        body: JSON.stringify({
          assigned_to: delegatePortal.id,
          assigned_by: getPortalUser(assignment.assigned_by)?.id || delegatePortal.id,
          title: assignment.title,
          description: `[Delegated] ${assignment.description || ''}\nReason: ${delegateReason}`,
          team: assignment.team,
          due_date: assignment.due_date,
          week_key: weekKey,
          delegate_of: assignment.portal_assignment_id,
          delegated_by: getPortalUser(interaction.user.id)?.id,
        })
      });
      const data = await resp.json();
      if (data.id) portalDelegateId = data.id;
    } catch (e) { console.error('[assign] delegate portal error:', e.message); }

    // Create bot assignment for delegate
    const result = createAssignment({
      title: assignment.title,
      description: `[Delegated] ${assignment.description || ''}\nReason: ${delegateReason}`,
      assignedTo: delegateToId,
      assignedBy: assignment.assigned_by,
      team: assignment.team,
      dueDate: assignment.due_date,
      portalAssignmentId: portalDelegateId,
      delegateOf: assignmentId,
      delegatedBy: interaction.user.id,
    });
    const newBotId = result.lastInsertRowid;

    // Post new embed for delegated task
    try {
      const channel = await interaction.client.channels.fetch(ASSIGNMENTS_CHANNEL_ID);
      const delegateData = {
        title: assignment.title,
        description: `[Delegated] ${assignment.description || ''}\nReason: ${delegateReason}`,
        assigned_to: delegateToId,
        assigned_by: assignment.assigned_by,
        team: assignment.team,
        due_date: assignment.due_date,
        status: 'pending',
        created_at: new Date().toISOString(),
      };
      const embed = buildAssignmentEmbed(delegateData, null, null, { assignmentNumber, delegated: true });
      const buttons = buildAssignmentButtons(newBotId, 'pending');
      const msg = await channel.send({ embeds: [embed], components: buttons });
      updateAssignment(newBotId, { message_id: msg.id, channel_id: msg.channelId });
    } catch (e) { console.error('[assign] delegate embed error:', e.message); }

    // Update original embed with delegation note
    try {
      const channel = await interaction.client.channels.fetch(assignment.channel_id);
      const msg = await channel.messages.fetch(assignment.message_id);
      const updated = getAssignment(assignmentId);
      const embed = buildAssignmentEmbed(updated, null, null, { assignmentNumber: `ASN-${assignmentId}`, delegatedTo: delegateToId });
      await msg.edit({ embeds: [embed], components: buildAssignmentButtons(assignmentId, assignment.status) });
    } catch {}

    const delegatorName = getUserByDiscordId(interaction.user.id)?.display_name || interaction.user.username;
    const delegateName = delegatePortal.display_name;

    // DM delegate
    try {
      const delegateUser = await interaction.client.users.fetch(delegateToId);
      await delegateUser.send({ embeds: [new EmbedBuilder()
        .setTitle('🔄 Delegated Assignment')
        .setColor(0x5865F2)
        .setDescription(`**${delegatorName}** has delegated a task to you.\n\n**Task:** ${assignment.title}\n**Due:** ${formatDate(assignment.due_date)}\n**Reason:** ${delegateReason}\n\nCheck <#${ASSIGNMENTS_CHANNEL_ID}> for details.`)
        .setFooter({ text: `Assignment: ${assignmentNumber} | Community Organisation` })
        .setTimestamp()
      ]});
    } catch {}

    // DM original assignee
    try {
      await interaction.client.users.fetch(interaction.user.id).then(u => u.send({
        content: `🔄 You have delegated **"${assignment.title}"** to **${delegateName}**. Remember: delegation does not remove your responsibility — you are still accountable for ensuring this task is completed.`
      }));
    } catch {}

    // DM original assigner
    try {
      const assigner = await interaction.client.users.fetch(assignment.assigned_by);
      await assigner.send({ content: `🔄 **${delegatorName}** has delegated your task **"${assignment.title}"** to **${delegateName}**. You will be notified when it is completed.` });
    } catch {}

    await interaction.reply({ content: `✅ Task delegated to **${delegateName}** (${assignmentNumber}).`, ephemeral: true });
  }
}
