// COMMAND_PERMISSION_FALLBACK: everyone
// Open a new case from Discord. Pairs with the existing /case (ref lookup)
// and /cases (my cases list) commands.
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getUserByDiscordId } from '../db.js';
import { canUseCommand } from '../utils/permissions.js';

const PORTAL_HTTP = process.env.PORTAL_HTTP || 'http://localhost:3016';
const PORTAL_URL  = process.env.PORTAL_URL  || 'https://portal.communityorg.co.uk';

const CASE_TYPES = [
  { name: 'General HR',          value: 'GENERAL_HR' },
  { name: 'Wellbeing',           value: 'WELLBEING' },
  { name: 'Leave Query',         value: 'LEAVE_QUERY' },
  { name: 'Letter Request',      value: 'LETTER_REQUEST' },
  { name: 'APS Dispute',         value: 'APS_DISPUTE' },
  { name: 'Transfer',            value: 'TRANSFER' },
  { name: 'Performance Adjustment', value: 'PERFORMANCE_ADJUSTMENT' },
];

export const data = new SlashCommandBuilder()
  .setName('caseopen')
  .setDescription('Open a new case in Case Management')
  .addStringOption(o => o.setName('subject').setDescription('Short subject line').setRequired(true).setMaxLength(120))
  .addStringOption(o => o.setName('description').setDescription('Details of your request').setRequired(true).setMaxLength(2000))
  .addStringOption(o => o.setName('type').setDescription('Case type').setRequired(false).addChoices(...CASE_TYPES));

export async function execute(interaction) {
  try {
    const perm = await canUseCommand('caseopen', interaction);
    if (!perm.allowed) return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });

    const user = getUserByDiscordId(interaction.user.id);
    if (!user) {
      return interaction.reply({ content: '❌ Your Discord account is not linked to a CO Staff Portal account.', ephemeral: true });
    }

    const subject     = interaction.options.getString('subject', true);
    const description = interaction.options.getString('description', true);
    const case_type   = interaction.options.getString('type') || 'GENERAL_HR';

    await interaction.deferReply({ ephemeral: true });

    let resp;
    try {
      const r = await fetch(`${PORTAL_HTTP}/api/cases-bot/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-bot-secret': process.env.BOT_WEBHOOK_SECRET,
        },
        body: JSON.stringify({
          case_type,
          subject,
          description: `${description}\n\n_(opened via Discord by @${interaction.user.username})_`,
          raised_by: user.id,
          subject_user_id: user.id,
          priority: 'medium',
        }),
      });
      resp = await r.json();
      if (!r.ok) throw new Error(resp?.error || `HTTP ${r.status}`);
    } catch (e) {
      return interaction.editReply({ content: `❌ Couldn't open case: ${e.message}` });
    }

    const embed = new EmbedBuilder()
      .setTitle(`📂 Case opened — ${resp.case_number}`)
      .setColor(0x10b981)
      .setDescription(`**${subject}**\n\nA case officer will be in touch.`)
      .addFields(
        { name: 'Type',   value: case_type.replace(/_/g, ' '), inline: true },
        { name: 'Status', value: 'Open · Intake', inline: true },
        { name: 'View',   value: `[Open in portal](${PORTAL_URL}/cases/${resp.id})`, inline: false },
      )
      .setFooter({ text: 'Community Organisation · Case Management' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error('[caseopen] error:', err);
    if (interaction.deferred || interaction.replied) {
      try { await interaction.editReply({ content: '❌ An error occurred opening the case.' }); } catch {}
    } else {
      try { await interaction.reply({ content: '❌ An error occurred opening the case.', ephemeral: true }); } catch {}
    }
  }
}
