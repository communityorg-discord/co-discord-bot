import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getUserByDiscordId, getRecentCases } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('cases')
  .setDescription('View your recent cases in Case Management');

export async function execute(interaction) {
  try {
  const user = getUserByDiscordId(interaction.user.id);
  if (!user) {
    return interaction.reply({ content: '❌ Your Discord account is not linked to a CO Staff Portal account.', ephemeral: true });
  }

  const cases = getRecentCases(user.id);

  if (!cases.length) {
    return interaction.reply({ content: '📂 You have no cases in Case Management.', ephemeral: true });
  }

  const typeEmojis = { DISCIPLINARY: '⚖️', WELLBEING: '💚', TRANSFER: '🔄', LEAVE: '🏖️', BRAG: '📊', GENERAL: '📋' };

  const embed = new EmbedBuilder()
    .setTitle(`📂 Recent Cases — ${user.display_name || user.full_name}`)
    .setColor(0x5865F2)
    .setDescription(cases.map(c =>
      `${typeEmojis[c.case_type] || '📋'} **${c.case_number}** — ${c.case_type}\n` +
      `Status: \`${c.status?.toUpperCase()}\` | Stage: \`${c.stage}\`\n` +
      `${c.subject || 'No subject'}`
    ).join('\n\n'))
    .addFields({ name: 'View in Portal', value: `[Open Case Management](${process.env.PORTAL_URL}/cases)`, inline: false })
    .setFooter({ text: 'Community Organisation | Case Management' })
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
