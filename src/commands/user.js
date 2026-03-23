import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getUserByDiscordId } from '../db.js';
import { getInfractions, getActiveSuspension, getActiveInvestigation, getActiveGlobalBan } from '../utils/botDb.js';

export const data = new SlashCommandBuilder()
  .setName('user')
  .setDescription('View information about a user')
  .addUserOption(opt => opt.setName('user').setDescription('User to look up').setRequired(false));

export async function execute(interaction) {
  const target = interaction.options.getUser('user') || interaction.user;
  const portalUser = getUserByDiscordId(target.id);
  const infractions = getInfractions(target.id);
  const suspension = getActiveSuspension(target.id);
  const investigation = getActiveInvestigation(target.id);
  const gban = getActiveGlobalBan(target.id);

  const embed = new EmbedBuilder()
    .setTitle(`👤 ${portalUser?.display_name || target.username}`)
    .setColor(0x5865F2)
    .setThumbnail(target.displayAvatarURL())
    .addFields(
      { name: 'Discord', value: `<@${target.id}>`, inline: true },
      { name: 'Account Created', value: `<t:${Math.floor(target.createdTimestamp / 1000)}:D>`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: 'Portal Account', value: portalUser ? '✅ Linked' : '❌ Not linked', inline: true },
      { name: 'Position', value: portalUser?.position || 'N/A', inline: true },
      { name: 'Auth Level', value: portalUser?.auth_level ? `Level ${portalUser.auth_level}` : 'N/A', inline: true },
      { name: 'Employee ID', value: portalUser?.employee_number || 'N/A', inline: true },
      { name: 'Department', value: portalUser?.department || 'N/A', inline: true },
      { name: 'Status', value: portalUser?.account_status || 'N/A', inline: true },
      { name: '⚖️ Infractions', value: String(infractions.length), inline: true },
      { name: '🔍 Under Investigation', value: investigation ? '⚠️ Yes' : '✅ No', inline: true },
      { name: '🔴 Suspended', value: suspension ? '⚠️ Yes' : '✅ No', inline: true },
      { name: '🔨 Global Ban', value: gban ? '🔴 Yes' : '✅ No', inline: true }
    )
    .setFooter({ text: 'Community Organisation | Staff Portal' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
