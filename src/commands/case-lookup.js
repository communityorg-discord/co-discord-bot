import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import db, { getUserByDiscordId } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('case')
  .setDescription('Look up a case by its reference number (e.g. CAS-2026-0001)')
  .addStringOption(o => o.setName('ref').setDescription('Case reference').setRequired(true));

export async function execute(interaction) {
  try {
    const caller = getUserByDiscordId(interaction.user.id);
    if (!caller) {
      return interaction.reply({ content: '❌ Your Discord account is not linked to a CO Staff Portal account.', ephemeral: true });
    }
    const ref = (interaction.options.getString('ref') || '').trim();
    if (!ref) return interaction.reply({ content: '❌ Please supply a case reference.', ephemeral: true });

    const row = db.prepare(`
      SELECT c.*,
             u_raised.display_name AS raised_by_name, u_raised.full_name AS raised_by_full,
             u_ass.display_name AS assignee_name, u_ass.full_name AS assignee_full,
             u_sub.display_name AS subject_name, u_sub.full_name AS subject_full
      FROM cases c
      LEFT JOIN users u_raised ON u_raised.id = c.raised_by
      LEFT JOIN users u_ass    ON u_ass.id    = c.assigned_to
      LEFT JOIN users u_sub    ON u_sub.id    = c.subject_user_id
      WHERE c.case_number = ? COLLATE NOCASE
      LIMIT 1
    `).get(ref);

    if (!row) {
      return interaction.reply({ content: `❌ Case \`${ref}\` not found.`, ephemeral: true });
    }

    // Permission: a user can see a case if they're the raiser, subject,
    // assignee, or have auth_level ≥ 5.
    const canView = caller.auth_level >= 5
      || caller.id === row.raised_by
      || caller.id === row.assigned_to
      || caller.id === row.subject_user_id;
    if (!canView) {
      return interaction.reply({ content: `❌ You don't have access to \`${ref}\`.`, ephemeral: true });
    }

    const typeEmojis = { DISCIPLINARY: '⚖️', INVESTIGATION: '🔍', WELLBEING: '💚', TRANSFER: '🔄', LEAVE_QUERY: '🏖️', APS_DISPUTE: '📊', OFFBOARDING: '🚪', PROBATION_REVIEW: '⏳', PERFORMANCE_REVIEW: '🎯', RETURN_TO_WORK: '🔁', SHUTDOWN_WORK_REQUEST: '🗓️', GENERAL_HR: '📋', LETTER_REQUEST: '✉️', DOCUMENT_SIGNING: '✍️' };
    const statusColour = { open: 0x60a5fa, new: 0x60a5fa, in_progress: 0xfbbf24, pending: 0xa78bfa, escalated: 0xef4444, resolved: 0x10b981, closed: 0x64748b }[row.status] || 0x5865F2;

    const ageH = Math.round((Date.now() - new Date(row.created_at).getTime()) / 3600000);
    const ageStr = ageH < 48 ? `${ageH}h ago` : `${Math.round(ageH / 24)}d ago`;

    const embed = new EmbedBuilder()
      .setTitle(`${typeEmojis[row.case_type] || '📋'} ${row.case_number}`)
      .setDescription(row.subject || '_No subject_')
      .setColor(statusColour)
      .addFields(
        { name: 'Type',     value: row.case_type, inline: true },
        { name: 'Status',   value: String(row.status || '—').toUpperCase(), inline: true },
        { name: 'Stage',    value: String(row.stage || '—').replace(/_/g, ' '), inline: true },
        { name: 'Priority', value: String(row.priority || 'medium'), inline: true },
        { name: 'Raised by', value: row.raised_by_name || row.raised_by_full || '—', inline: true },
        { name: 'Assignee',  value: row.assignee_name || row.assignee_full || 'Unassigned', inline: true },
      );
    if (row.subject_user_id) {
      embed.addFields({ name: 'Subject', value: row.subject_name || row.subject_full || '—', inline: true });
    }
    if (row.sla_breached) {
      embed.addFields({ name: 'SLA', value: '🚨 **Breached**', inline: true });
    }
    embed.addFields({ name: 'Opened', value: ageStr, inline: true });

    const base = process.env.PORTAL_URL || 'https://portal.communityorg.co.uk';
    embed.setURL(`${base}/management/cases/${row.id}`)
      .setFooter({ text: 'Community Organisation | Case Management' })
      .setTimestamp(new Date(row.created_at));

    await interaction.reply({ embeds: [embed], ephemeral: true });
  } catch (err) {
    console.error('[case] Error:', err);
    const msg = { content: 'An error occurred.', flags: 64 };
    if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
    else await interaction.reply(msg);
  }
}
