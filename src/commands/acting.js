import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { SUPERUSER_IDS } from '../config.js';
import { POSITIONS } from '../utils/positions.js';
import { getUserByDiscordId } from '../db.js';
import { getActiveActingAssignment, endActingAssignment } from '../utils/botDb.js';
import { applyActingRoles, revertActingRoles } from '../services/leaveRoles.js';
import { logAction } from '../utils/logger.js';

const SUPERUSER_DISCORD_IDS = ['723199054514749450', '415922272956710912', '1013486189891817563', '1355367209249148928', '878775920180228127'];

// Build position choices (Discord allows max 25)
const positionChoices = Object.keys(POSITIONS)
  .filter(p => !['CO | Official Account', 'Bot Developer', 'Founder'].includes(p))
  .slice(0, 25)
  .map(p => ({ name: p, value: p }));

export const data = new SlashCommandBuilder()
  .setName('acting')
  .setDescription('Manage acting position assignments')
  .addSubcommand(sub =>
    sub.setName('start')
      .setDescription('Assign an acting position to a staff member (applies immediately)')
      .addUserOption(opt => opt.setName('user').setDescription('Staff member to assign acting to').setRequired(true))
      .addStringOption(opt => opt.setName('position').setDescription('Position to act in').setRequired(true).addChoices(...positionChoices))
  )
  .addSubcommand(sub =>
    sub.setName('end')
      .setDescription('End an active acting assignment')
      .addUserOption(opt => opt.setName('user').setDescription('Staff member to remove acting from').setRequired(true))
  );

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  if (!SUPERUSER_DISCORD_IDS.includes(interaction.user.id) && !SUPERUSER_IDS.includes(interaction.user.id)) {
    return interaction.editReply({ content: '❌ Only superusers (dionm, evans) can manage acting assignments.' });
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'start') {
    const targetUser = interaction.options.getUser('user');
    const position = interaction.options.getString('position');

    const portalUser = getUserByDiscordId(targetUser.id);
    if (!portalUser) {
      return interaction.editReply({ content: '❌ That user is not linked to the CO Staff Portal.' });
    }

    const existing = getActiveActingAssignment(targetUser.id);
    if (existing) {
      return interaction.editReply({ content: `❌ ${portalUser.display_name} already has an active acting assignment for **${existing.position}**. End it first with \`/acting end\`.` });
    }

    await applyActingRoles(interaction.client, targetUser.id, position, null, null, interaction.user.username);
    await interaction.editReply({ content: `✅ Acting assignment applied. **${portalUser.display_name}** now has **${position}** roles.` });

    await logAction(interaction.client, {
      action: '📌 Acting Assignment (Manual)',
      moderator: { discordId: interaction.user.id, name: interaction.user.username },
      target: { discordId: targetUser.id, name: portalUser.display_name },
      reason: `Acting as ${position} — applied immediately`,
      color: 0x5865F2,
      fields: [
        { name: 'Position', value: position, inline: true },
      ],
      guildId: interaction.guildId
    });

  } else if (sub === 'end') {
    const targetUser = interaction.options.getUser('user');
    const portalUser = getUserByDiscordId(targetUser.id);

    const acting = getActiveActingAssignment(targetUser.id);
    if (!acting) {
      return interaction.editReply({ content: '❌ No active acting assignment found for that user.' });
    }

    await revertActingRoles(interaction.client, targetUser.id, acting.leave_request_id || 0);

    await interaction.editReply({ content: `✅ Acting assignment for **${acting.position}** ended. ${portalUser?.display_name || targetUser.username}'s original roles have been restored.` });

    await logAction(interaction.client, {
      action: '🔄 Acting Assignment Ended (Manual)',
      moderator: { discordId: interaction.user.id, name: interaction.user.username },
      target: { discordId: targetUser.id, name: portalUser?.display_name || targetUser.username },
      reason: `Acting as ${acting.position} ended by superuser`,
      color: 0x6B7280,
      guildId: interaction.guildId
    });
  }
}
