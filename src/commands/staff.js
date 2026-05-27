// COMMAND_PERMISSION_FALLBACK: everyone
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getUserByDiscordId, getStaffByName } from '../db.js';
import { canUseCommand } from '../utils/permissions.js';
import { E } from '../lib/emoji.js';

export const data = new SlashCommandBuilder()
  .setName('staff')
  .setDescription('Look up a staff member')
  .addStringOption(opt => opt.setName('name').setDescription('Name or username to search').setRequired(true));

export async function execute(interaction) {
  try {
  const perm = await canUseCommand('staff', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });
  }
  const requestingUser = getUserByDiscordId(interaction.user.id);
  if (!requestingUser) {
    return interaction.reply({ content: `${E.cross} Your Discord account is not linked to a CO Staff Portal account.`, ephemeral: true });
  }

  const query = interaction.options.getString('name');
  const results = getStaffByName(query);

  if (!results.length) {
    return interaction.reply({ content: `${E.cross} No staff found matching "${query}"`, ephemeral: true });
  }

  const SHOWN = 3;
  const embeds = results.slice(0, SHOWN).map(s => new EmbedBuilder()
    .setTitle(`${s.display_name || s.full_name || s.username}`)
    .setColor(0x5865F2)
    .addFields(
      { name: 'Position', value: s.position || 'N/A', inline: true },
      { name: 'Department', value: s.department || 'N/A', inline: true },
      { name: 'Discord', value: s.discord_id ? `<@${s.discord_id}>` : 'Not linked', inline: true }
    )
    .setFooter({ text: results.length > SHOWN
      ? `Showing ${SHOWN} of ${results.length} matches — refine your search to narrow down`
      : 'Community Organisation | Staff Directory' })
  );

  await interaction.reply({ embeds, ephemeral: true });
  } catch (err) {
    console.error('[staff] Error:', err);
    const msg = { content: 'An error occurred. Please try again.', flags: 64 };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg);
    } else {
      await interaction.reply(msg);
    }
  }
}
