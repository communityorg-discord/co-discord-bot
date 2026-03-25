import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canRunCommand, isSuperuser } from '../utils/permissions.js';
import { getInfractions, getDeletedInfractions, deleteInfraction } from '../utils/botDb.js';
import { getUserByDiscordId } from '../db.js';
import { logAction } from '../utils/logger.js';
import { INFRACTIONS_CASES_LOG_CHANNEL_ID } from '../config.js';

export const data = new SlashCommandBuilder()
  .setName('infractions')
  .setDescription('View or manage infractions')
  .addSubcommand(sub => sub.setName('view').setDescription('View infractions for a user')
    .addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true))
    .addStringOption(opt => opt.setName('include_deleted').setDescription('Include deleted?').addChoices({ name: 'Yes', value: 'yes' })))
  .addSubcommand(sub => sub.setName('delete').setDescription('Delete an infraction — Superuser only')
    .addIntegerOption(opt => opt.setName('id').setDescription('Infraction ID').setRequired(true)));

export async function execute(interaction) {
  try {
  const sub = interaction.options.getSubcommand();

  if (sub === 'view') {
    const perm = await canRunCommand(interaction.user.id, 3);
    if (!perm.allowed) return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });

    const target = interaction.options.getUser('user');
    const includeDeleted = interaction.options.getString('include_deleted') === 'yes';
    const infractions = getInfractions(target.id, false);
    const deleted = includeDeleted ? getDeletedInfractions(target.id) : [];
    const portalUser = getUserByDiscordId(target.id);

    const embed = new EmbedBuilder()
      .setTitle(`📋 Infractions — ${portalUser?.display_name || target.username}`)
      .setColor(infractions.length ? 0xEF4444 : 0x22C55E)
      .setDescription(infractions.length === 0 ? 'No active infractions.' :
        infractions.map(i => `**#${i.id}** \`${i.type}\` — ${i.reason}\n*By ${i.moderator_name} on ${new Date(i.created_at).toLocaleDateString('en-GB')}*`).join('\n\n')
      );

    if (deleted.length) {
      embed.addFields({ name: '🗑️ Deleted Infractions', value: deleted.map(i => `**[Deleted]** \`${i.type}\` — ${i.reason}`).join('\n') });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });

  } else if (sub === 'delete') {
    if (!await isSuperuser(interaction.user.id)) return interaction.reply({ content: '❌ Superuser only.', ephemeral: true });
    const id = interaction.options.getInteger('id');
    const deleted = deleteInfraction(id, interaction.user.id);
    if (!deleted) return interaction.reply({ content: `❌ Infraction #${id} not found.`, ephemeral: true });

    await logAction(interaction.client, {
      action: '🗑️ Infraction Deleted',
      moderator: { discordId: interaction.user.id, name: interaction.user.username },
      target: { discordId: deleted.discord_id, name: getUserByDiscordId(deleted.discord_id)?.display_name || deleted.discord_id },
      reason: `Infraction #${id} (${deleted.type})`,
      color: 0x22C55E,
      fields: [
        { name: 'Infraction ID', value: `#${id}`, inline: true },
        { name: 'Type', value: deleted.type, inline: true },
        { name: 'Original Reason', value: deleted.reason || 'N/A', inline: false },
      ],
      specificChannelId: INFRACTIONS_CASES_LOG_CHANNEL_ID,
    guildId: interaction.guildId,
    logType: 'moderation.infractions_cases',
    });
    await interaction.reply({ embeds: [new EmbedBuilder()
      .setTitle('🗑️ Infraction Deleted')
      .setColor(0x22C55E)
      .setDescription(`Infraction #${id} has been deleted and moved to deleted history.`)
      .addFields(
        { name: 'Deleted By', value: interaction.user.username, inline: true }
      )
      .setFooter({ text: 'Community Organisation' })
      .setTimestamp()
    ]});
  }
  } catch (err) {
    console.error('[infractions] Error:', err);
    const msg = { content: 'An error occurred. Please try again.', flags: 64 };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg);
    } else {
      await interaction.reply(msg);
    }
  }
}
