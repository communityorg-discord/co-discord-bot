// COMMAND_PERMISSION_FALLBACK: auth_level >= 5
import { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ActionRowBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { getDmExemptions } from '../utils/botDb.js';
import { E } from '../lib/emoji.js';
import { BRAND } from '../utils/brand.js';

export const data = new SlashCommandBuilder()
  .setName('dm-exempt')
  .setDescription('View and manage users exempt from mass/team DMs');

export async function execute(interaction) {
  const perm = await canUseCommand('dm-exempt', interaction);
  if (!perm.allowed) return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });

  try {
    await interaction.deferReply({ ephemeral: true });

    const exempts = getDmExemptions();

    const buildEmbed = () => {
      if (exempts.length === 0) {
        return new EmbedBuilder()
          .setTitle('DM Exemptions')
          .setColor(0x5865F2)
          .setDescription(`${E.dm} No users are currently exempt from mass/team DMs.`)
          .setFooter({ text: BRAND.footer })
          .setTimestamp();
      }

      return new EmbedBuilder()
        .setTitle(`DM Exemptions (${exempts.length})`)
        .setColor(0x5865F2)
        .setDescription(`${E.dm} These users are skipped on mass/team DMs.`)
        .addFields(exempts.slice(0, 25).map(e => ({
          name: e.display_name || 'Unknown',
          value: `<@${e.discord_id}>\nAdded by: ${e.exempted_by} · <t:${Math.floor(new Date(e.created_at).getTime() / 1000)}:R>`,
          inline: true,
        })))
        .setFooter({ text: BRAND.footer })
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
      await interaction.editReply({ content: `${E.cross} Error: ${e.message}` }).catch(() => {});
    } else {
      await interaction.reply({ content: `${E.cross} Error: ${e.message}`, ephemeral: true }).catch(() => {});
    }
  }
}
