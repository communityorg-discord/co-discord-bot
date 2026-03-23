import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canRunCommand } from '../utils/permissions.js';
import { addInfraction } from '../utils/botDb.js';
import { logAction } from '../utils/logger.js';
import { getUserByDiscordId } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('strike')
  .setDescription('Issue a staff strike to a staff member')
  .addUserOption(opt => opt.setName('user').setDescription('Staff member').setRequired(true))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for strike').setRequired(true));

export async function execute(interaction) {
  const perm = canRunCommand(interaction.user.id, 4);
  if (!perm.allowed) return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });

  const target = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason');
  const portalUser = getUserByDiscordId(target.id);

  const inf = addInfraction(target.id, 'staff_strike', reason, interaction.user.id, interaction.user.username);

  try {
    await target.send({
      embeds: [new EmbedBuilder()
        .setTitle('⚠️ Staff Strike Issued')
        .setColor(0xF59E0B)
        .addFields(
          { name: 'Reason', value: reason },
          { name: 'Issued By', value: interaction.user.username }
        )
        .setTimestamp()
      ]
    });
  } catch {}

  await logAction(interaction.client, {
    action: 'Staff Strike',
    moderator: { discordId: interaction.user.id, name: interaction.user.username },
    target: { discordId: target.id, name: portalUser?.display_name || target.username },
    reason, color: 0xF59E0B
  });

  await interaction.reply({ content: `✅ Staff strike issued to **${portalUser?.display_name || target.username}**. Infraction ID: #${inf.lastInsertRowid}`, ephemeral: true });
}
