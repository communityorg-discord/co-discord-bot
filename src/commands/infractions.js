import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canRunCommand, isSuperuser } from '../utils/permissions.js';
import { getInfractions, getDeletedInfractions, deleteInfraction } from '../utils/botDb.js';
import { getUserByDiscordId } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('infractions')
  .setDescription('View or manage infractions')
  .addSubcommand(sub => sub.setName('view').setDescription('View infractions for a user')
    .addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true))
    .addStringOption(opt => opt.setName('include_deleted').setDescription('Include deleted?').addChoices({ name: 'Yes', value: 'yes' })))
  .addSubcommand(sub => sub.setName('delete').setDescription('Delete an infraction — Superuser only')
    .addIntegerOption(opt => opt.setName('id').setDescription('Infraction ID').setRequired(true)));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'view') {
    const perm = canRunCommand(interaction.user.id, 3);
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
    if (!isSuperuser(interaction.user.id)) return interaction.reply({ content: '❌ Superuser only.', ephemeral: true });
    const id = interaction.options.getInteger('id');
    const deleted = deleteInfraction(id, interaction.user.id);
    if (!deleted) return interaction.reply({ content: `❌ Infraction #${id} not found.`, ephemeral: true });
    await interaction.reply({ content: `✅ Infraction #${id} deleted and moved to deleted history.`, ephemeral: true });
  }
}
