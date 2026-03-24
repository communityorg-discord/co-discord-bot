import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getUserByDiscordId, getLeaveBalance, getPendingLeaveRequests } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('leave')
  .setDescription('Check your leave balance and pending requests');

export async function execute(interaction) {
  try {
  const user = getUserByDiscordId(interaction.user.id);
  if (!user) {
    return interaction.reply({ content: '❌ Your Discord account is not linked to a CO Staff Portal account.', ephemeral: true });
  }

  const balance = getLeaveBalance(user.id);
  const pending = getPendingLeaveRequests(user.id);

  const annualUsed = balance?.annual_leave_used || 0;
  const annualTotal = balance?.annual_leave_total || 0;
  const annualRemaining = annualTotal - annualUsed + (balance?.annual_leave_carried_over || 0);
  const wellbeingUsed = balance?.wellbeing_days_used || 0;
  const wellbeingTotal = balance?.wellbeing_days_total || 2;
  const wellbeingRemaining = wellbeingTotal - wellbeingUsed;

  const embed = new EmbedBuilder()
    .setTitle(`🏖️ Leave Balance — ${user.display_name || user.full_name}`)
    .setColor(0x5865F2)
    .addFields(
      { name: 'Annual Leave', value: `${annualRemaining} / ${annualTotal} days remaining`, inline: true },
      { name: 'Wellbeing Days', value: `${wellbeingRemaining} / ${wellbeingTotal} remaining`, inline: true },
      { name: 'Pending Requests', value: String(pending.length), inline: true }
    )
    .setFooter({ text: `Visit ${process.env.PORTAL_URL} to submit leave requests` })
    .setTimestamp();

  if (pending.length > 0) {
    embed.addFields({
      name: 'Pending Leave Requests',
      value: pending.map(r => `• ${r.leave_type || r.type} — ${r.start_date} to ${r.end_date}`).join('\n'),
      inline: false
    });
  }

  await interaction.reply({ embeds: [embed] });
  } catch (err) {
    console.error('[leave] Error:', err);
    const msg = { content: 'An error occurred. Please try again.', flags: 64 };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg);
    } else {
      await interaction.reply(msg);
    }
  }
}
