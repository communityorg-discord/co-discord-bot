// COMMAND_PERMISSION_FALLBACK: superuser_only
// /emergency — Dion + Evan only. Generates a single-use override code that
// can push a pending action through on the dev site WITHOUT the second admin.
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { SUPERUSER_IDS } from '../config.js';
import { createEmergencyCode } from '../utils/botDb.js';
import { E } from '../lib/emoji.js';
import { BRAND } from '../utils/brand.js';

export const data = new SlashCommandBuilder()
  .setName('emergency')
  .setDescription('Generate a one-time emergency override code for the dev site.');

export async function execute(interaction) {
  if (!SUPERUSER_IDS.includes(interaction.user.id)) {
    return interaction.reply({ content: 'Not authorised — this is restricted to the founders.', flags: 64 });
  }
  const { code, expiresAt } = createEmergencyCode(interaction.user.id, interaction.user.username);
  const embed = new EmbedBuilder()
    .setColor(0xf87171)
    .setTitle('Emergency override code')
    .setDescription(`${E.warning} Enter this on the dev site’s **Pending approvals** to push a pending action through **without the second admin** — for emergencies only.`)
    .addFields(
      { name: 'Code', value: `\`\`\`\n${code}\n\`\`\``, inline: false },
      { name: 'Uses', value: 'Single use', inline: true },
      { name: 'Expires', value: `<t:${Math.floor(expiresAt / 1000)}:R>`, inline: true },
    )
    .setFooter({ text: `${BRAND.name} · emergency override` });
  return interaction.reply({ embeds: [embed], flags: 64 });
}
