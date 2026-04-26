// COMMAND_PERMISSION_FALLBACK: everyone
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import {
  getUserByDiscordId,
  getHelpdeskTicketByRef,
  getRecentHelpdeskTickets,
} from '../db.js';
import { canUseCommand } from '../utils/permissions.js';

const STATUS_EMOJI = {
  open: '🟢',
  acknowledged: '🔵',
  in_review: '🔵',
  waiting_response: '🟡',
  resolved: '🟣',
  closed: '⚫',
};
const PRIORITY_COLOR = {
  low: 0x6b7280,
  normal: 0x6366f1,
  high: 0xf59e0b,
  critical: 0xef4444,
};
const PORTAL_URL = 'https://portal.communityorg.co.uk/helpdesk';

const title = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const fmtDate = (unix) => new Date(Number(unix || 0) * 1000).toLocaleString('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London',
});

export const data = new SlashCommandBuilder()
  .setName('helpdesk')
  .setDescription('Interact with the CO IT Help Desk')
  .addSubcommand(sc => sc.setName('my').setDescription('List your most recent Help Desk tickets'))
  .addSubcommand(sc =>
    sc.setName('status').setDescription('Look up a ticket by reference')
      .addStringOption(o => o.setName('ref').setDescription('Ticket ref, e.g. HD-2026-0042').setRequired(true)))
  .addSubcommand(sc => sc.setName('new').setDescription('Open the Help Desk create form in the portal'));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const checkName = sub ? `helpdesk:${sub}` : 'helpdesk';
  const perm = await canUseCommand(checkName, interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });
  }

  // Every subcommand other than 'new' needs a linked portal user.
  const portalUser = getUserByDiscordId(interaction.user.id);

  if (sub === 'new') {
    return interaction.reply({
      ephemeral: true,
      content: `Open the Help Desk create form: ${PORTAL_URL}?create=1`,
    });
  }

  if (!portalUser) {
    return interaction.reply({
      ephemeral: true,
      content: '❌ Your Discord account is not linked to a CO Staff Portal account. Contact IT to link it.',
    });
  }

  if (sub === 'my') {
    const tickets = getRecentHelpdeskTickets(portalUser.id, { limit: 5 });
    if (!tickets.length) {
      return interaction.reply({ ephemeral: true, content: '📭 No Help Desk tickets for you yet.' });
    }
    const embed = new EmbedBuilder()
      .setTitle('🎫 Your recent Help Desk tickets')
      .setColor(0xc9a84c)
      .setURL(PORTAL_URL);
    for (const t of tickets.slice(0, 5)) {
      const badges = [
        t.escalated ? '🔥 Escalated' : null,
        t.sla_breached ? '⏰ SLA breach' : null,
      ].filter(Boolean).join(' · ');
      embed.addFields({
        name: `${STATUS_EMOJI[t.status] || '•'} \`${t.ticket_ref}\` — ${title(t.status)}`,
        value: `**${t.title || '(no title)'}**\n${title(t.priority)} priority · ${fmtDate(t.created_at)}${badges ? `\n${badges}` : ''}`,
      });
    }
    embed.setFooter({ text: 'Open the portal to see more →' });
    return interaction.reply({ ephemeral: true, embeds: [embed] });
  }

  if (sub === 'status') {
    const ref = interaction.options.getString('ref', true).trim().toUpperCase();
    const t = getHelpdeskTicketByRef(ref);
    if (!t) {
      return interaction.reply({ ephemeral: true, content: `❌ No Help Desk ticket with ref \`${ref}\`.` });
    }
    const embed = new EmbedBuilder()
      .setTitle(`${STATUS_EMOJI[t.status] || '•'} ${ref} — ${title(t.status)}`)
      .setDescription(t.title || '(no title)')
      .setColor(PRIORITY_COLOR[t.priority] ?? 0x6366f1)
      .setURL(`${PORTAL_URL}?tab=admin&ticket=${t.id}`)
      .addFields(
        { name: 'Priority', value: title(t.priority), inline: true },
        { name: 'Type', value: title(t.type), inline: true },
        { name: 'Submitter', value: t.submitter_name || t.submitter_username || (t.external_name || 'External'), inline: true },
      );
    if (t.escalated) embed.addFields({ name: '🔥 Escalated', value: t.escalation_reason || 'Yes', inline: false });
    if (t.sla_breached) embed.addFields({ name: '⏰ SLA', value: 'Breached', inline: true });
    embed.addFields({ name: 'Created', value: fmtDate(t.created_at), inline: false });
    return interaction.reply({ ephemeral: true, embeds: [embed] });
  }

  return interaction.reply({ ephemeral: true, content: 'Unknown subcommand.' });
}
