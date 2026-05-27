// COMMAND_PERMISSION_FALLBACK: everyone
// Quick-access portal URLs. Useful for new staff who don't yet know
// where to find the dashboard, leave page, helpdesk, etc, and as a
// general "where's that page again?" lookup.
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { E } from '../lib/emoji.js';

const PORTAL = process.env.PORTAL_URL || 'https://portal.communityorg.co.uk';

const LINKS = [
  { section: 'Daily', items: [
    { label: 'Dashboard', path: '/dashboard', desc: 'Your personal homepage' },
    { label: 'Personal Queue', path: '/personal-queue', desc: 'Tasks routed to you' },
    { label: 'Help Desk', path: '/helpdesk', desc: 'IT tickets — submit & track' },
    { label: 'Calendar', path: '/calendar', desc: 'Org-wide events' },
  ]},
  { section: 'You', items: [
    { label: 'Activity Points', path: '/activity-points', desc: 'Your APS this week' },
    { label: 'Leave', path: '/leave', desc: 'Request and track time off' },
    { label: 'Performance', path: '/performance', desc: 'Reviews + history' },
    { label: 'My Cases', path: '/my-disciplinary-cases', desc: 'Disciplinary cases involving you' },
    { label: 'Preferences', path: '/preferences', desc: 'Your account settings' },
  ]},
  { section: 'Organisation', items: [
    { label: 'Staff Directory', path: '/staff', desc: 'Search staff' },
    { label: 'Hierarchy', path: '/hierarchy', desc: 'Org chart' },
    { label: 'Documents', path: '/documents', desc: 'Shared docs' },
    { label: 'Loop', path: '/news', desc: 'Latest org news' },
    { label: 'Kudos', path: '/kudos', desc: 'Peer-recognition board' },
    { label: 'Changelog', path: '/changelog', desc: "What's been shipping recently" },
  ]},
  { section: 'Reference', items: [
    { label: 'Policy', path: '/policy', desc: 'Policies & procedures' },
    { label: 'Documentation', path: '/docs', desc: 'How-to guides' },
    { label: 'Status', path: '/status', desc: 'Service status' },
  ]},
];

export const data = new SlashCommandBuilder()
  .setName('links')
  .setDescription('Quick-access list of important CO portal pages');

export async function execute(interaction) {
  const perm = await canUseCommand('links', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });
  }

  const embed = new EmbedBuilder()
    .setTitle('CO Staff Portal — quick links')
    .setColor(0x6366f1)
    .setURL(PORTAL)
    .setDescription(`Portal: **${PORTAL}**`)
    .setFooter({ text: 'Use /help for bot commands · /feedback to suggest a missing link' });

  for (const sec of LINKS) {
    const lines = sec.items.map(i =>
      `[${i.label}](${PORTAL}${i.path}) — ${i.desc}`
    ).join('\n');
    embed.addFields({ name: sec.section, value: lines, inline: false });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
