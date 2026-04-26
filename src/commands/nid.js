// COMMAND_PERMISSION_FALLBACK: auth_level >= 3
import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getUserByDiscordId } from '../db.js';
import { canUseCommand } from '../utils/permissions.js';

export const data = new SlashCommandBuilder()
  .setName('nid')
  .setDescription('Raise a Non-Investigational Disciplinary Action for a direct report')
  .addStringOption(opt => opt.setName('staff').setDescription('Discord mention or username of staff member').setRequired(true))
  .addStringOption(opt => opt.setName('action').setDescription('Action type').setRequired(true)
    .addChoices(
      { name: 'Verbal Warning', value: 'verbal_warning' },
      { name: 'First Written Warning', value: 'first_written_warning' }
    ))
  .addStringOption(opt => opt.setName('incident').setDescription('Brief description of the incident').setRequired(true));

export async function execute(interaction) {
  try {
  const perm = await canUseCommand('nid', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });
  }
  const supervisor = getUserByDiscordId(interaction.user.id);
  if (!supervisor) {
    return interaction.reply({ content: '❌ Your Discord account is not linked to a CO Staff Portal account.', ephemeral: true });
  }

  const staffInput = interaction.options.getString('staff');
  const actionType = interaction.options.getString('action');
  const incident = interaction.options.getString('incident');

  // Extract Discord ID from mention or search by username
  const mentionMatch = staffInput.match(/\d{17,19}/);
  let targetUser = null;
  if (mentionMatch) {
    targetUser = getUserByDiscordId(mentionMatch[0]);
  }

  if (!targetUser) {
    return interaction.reply({ content: `❌ Could not find staff member "${staffInput}". Use a Discord mention (@user).`, ephemeral: true });
  }

  const embed = new EmbedBuilder()
    .setTitle('⚖️ Raise Non-Investigational Disciplinary Action')
    .setColor(0xF59E0B)
    .addFields(
      { name: 'Staff Member', value: targetUser.display_name || targetUser.full_name, inline: true },
      { name: 'Action Type', value: actionType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), inline: true },
      { name: 'Incident Summary', value: incident, inline: false },
      { name: 'Submitted By', value: supervisor.display_name || supervisor.full_name, inline: true }
    )
    .setDescription('Please confirm this NID submission. This will be sent to DMSPC for review.')
    .setFooter({ text: 'Section 5.1 — CO Internal Staff Policy' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`nid_confirm_${targetUser.id}_${actionType}`).setLabel('Confirm & Submit').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('nid_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
  );

  await interaction.reply({ embeds: [embed], components: [row] });
  } catch (err) {
    console.error('[nid] Error:', err);
    const msg = { content: 'An error occurred. Please try again.', flags: 64 };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg);
    } else {
      await interaction.reply(msg);
    }
  }
}
