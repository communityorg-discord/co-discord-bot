import { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ActionRowBuilder } from 'discord.js';
import { canRunCommand } from '../utils/permissions.js';
import { getDmExemptions } from '../utils/botDb.js';

export const data = new SlashCommandBuilder()
  .setName('dm-exempt')
  .setDescription('View and manage users exempt from mass/team DMs');

export async function execute(interaction) {
  const perm = await canRunCommand(interaction.user.id, 5);
  if (!perm.allowed) return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });

  try {
    await interaction.deferReply({ ephemeral: true });

    const exempts = getDmExemptions();

    const buildEmbed = () => {
      if (exempts.length === 0) {
        return new EmbedBuilder()
          .setTitle('📋 DM Exemptions')
          .setColor(0x5865F2)
          .setDescription('No users are currently exempt from mass/team DMs.')
          .setFooter({ text: 'Community Organisation | Staff Assistant' })
          .setTimestamp();
      }

      const rows = exempts.map(e =>
        `**${e.display_name || 'Unknown'}** — <@${e.discord_id}>\n` +
        `   Added by: ${e.exempted_by} · ${new Date(e.created_at).toLocaleDateString('en-GB')}`
      );

      return new EmbedBuilder()
        .setTitle(`📋 DM Exemptions (${exempts.length})`)
        .setColor(0x5865F2)
        .setDescription(rows.join('\n\n'))
        .setFooter({ text: 'Community Organisation | Staff Assistant' })
        .setTimestamp();
    };

    const components = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('dm_exempt_add').setLabel('Add Exemption').setStyle(3),
        new ButtonBuilder().setCustomId('dm_exempt_remove').setLabel('Remove Exemption').setStyle(4),
      )
    ];

    await interaction.editReply({ embeds: [buildEmbed()], components });
  } catch (e) {
    console.error('[/dm-exempt]', e.message);
    if (interaction.deferred) {
      await interaction.editReply({ content: `❌ Error: ${e.message}` }).catch(() => {});
    } else {
      await interaction.reply({ content: `❌ Error: ${e.message}`, ephemeral: true }).catch(() => {});
    }
  }
}
