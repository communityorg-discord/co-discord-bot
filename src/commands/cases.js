// COMMAND_PERMISSION_FALLBACK: everyone
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getUserByDiscordId, getRecentCases } from '../db.js';
import { canUseCommand } from '../utils/permissions.js';
import { E } from '../lib/emoji.js';
import { BRAND } from '../utils/brand.js';

export const data = new SlashCommandBuilder()
  .setName('cases')
  .setDescription('View your recent cases in Case Management');

export async function execute(interaction) {
  try {
  const perm = await canUseCommand('cases', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });
  }
  const user = getUserByDiscordId(interaction.user.id);
  if (!user) {
    return interaction.reply({ content: `${E.cross} Your Discord account is not linked to a CO Staff Portal account.`, ephemeral: true });
  }

  const cases = getRecentCases(user.id);

  if (!cases.length) {
    return interaction.reply({ content: `You have no cases in Case Management.`, ephemeral: true });
  }

  const typeEmojis = {
    DISCIPLINARY: E.gavel,
    GENERAL_HR: E.logs,
    OFFBOARDING: E.member,
    RETURN_TO_WORK: '',
    PERFORMANCE_ADJUSTMENT: E.aps,
    LETTER_REQUEST: E.dm,
    LEAVE_QUERY: '',
    APS_DISPUTE: E.aps,
    // Legacy types still in the map for any historical rows
    WELLBEING: '', TRANSFER: '', LEAVE: '', BRAG: E.aps, GENERAL: E.logs,
  };

  const embed = new EmbedBuilder()
    .setTitle(`Recent Cases — ${user.display_name || user.full_name}`)
    .setColor(0x5865F2)
    .setDescription(`${E.logs} Your ${cases.length} most recent case${cases.length === 1 ? '' : 's'} in Case Management.`)
    .addFields(cases.slice(0, 24).map(c => ({
      name: c.case_number,
      value: `${typeEmojis[c.case_type] || E.logs} ${c.case_type}\nStatus: \`${c.status?.toUpperCase()}\` · Stage: \`${c.stage}\`\n${c.subject || 'No subject'}`,
      inline: false,
    })))
    .addFields({ name: 'View in Portal', value: `[Open Case Management](${process.env.PORTAL_URL}/cases)`, inline: false })
    .setFooter({ text: `${BRAND.name} | Case Management` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
  } catch (err) {
    console.error('[cases] Error:', err);
    const msg = { content: 'An error occurred. Please try again.', flags: 64 };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg);
    } else {
      await interaction.reply(msg);
    }
  }
}
