import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { canRunCommand, isSuperuser } from '../utils/permissions.js';
import { getInfractions, getDeletedInfractions, deleteInfraction } from '../utils/botDb.js';
import { getUserByDiscordId } from '../db.js';
import { logAction } from '../utils/logger.js';
import { INFRACTIONS_CASES_LOG_CHANNEL_ID } from '../config.js';

const PAGE_SIZE = 10;

function buildInfractionsPage(infractions, page, total, target, includeDeleted, deleted = []) {
  const start = (page - 1) * PAGE_SIZE;
  const pageItems = infractions.slice(start, start + PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const portalUser = getUserByDiscordId(target.id);

  const embed = new EmbedBuilder()
    .setTitle(`📋 Infractions — ${portalUser?.display_name || target.username}`)
    .setColor(infractions.length ? 0xEF4444 : 0x22C55E)
    .setFooter({ text: `Community Organisation | Page ${page} of ${totalPages}` });

  if (infractions.length === 0) {
    embed.setDescription('No active infractions.');
  } else {
    const descLines = pageItems.map(i => {
      const exp = i.expires_at ? ` ⏱ <t:${Math.floor(new Date(i.expires_at).getTime()/1000)}:R>` : '';
      const active = i.active === 0 ? ' ~~(deleted)~~' : '';
      return `**#${i.id}** \`${i.type}\`${exp}${active} — ${i.reason}\n*By ${i.moderator_name || 'Unknown'} on ${new Date(i.created_at).toLocaleDateString('en-GB')}*`;
    });
    let description = descLines.join('\n\n');
    if (description.length > 4096) description = description.substring(0, 4090) + '...';
    embed.setDescription(description);
  }

  if (includeDeleted && deleted.length > 0) {
    const delDesc = deleted.map(i => `**#${i.id}** \`${i.type}\` — ~~${i.reason}~~`).join('\n');
    embed.addFields({ name: `🗑️ Deleted (${deleted.length})`, value: delDesc.length > 1024 ? delDesc.substring(0, 1021) + '...' : delDesc });
  }

  const row = new ActionRowBuilder();
  row.addComponents(
    new ButtonBuilder().setCustomId(`infr_prev_${page}_${target.id}_${includeDeleted ? 1 : 0}`).setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
    new ButtonBuilder().setCustomId(`infr_info_${page}`).setLabel(`Page ${page}/${totalPages}`).setStyle(ButtonStyle.Primary).setDisabled(true),
    new ButtonBuilder().setCustomId(`infr_next_${page}_${target.id}_${includeDeleted ? 1 : 0}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages),
  );

  return { embeds: [embed], components: [row] };
}

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

      const reply = buildInfractionsPage(infractions, 1, infractions.length, target, includeDeleted, deleted);
      await interaction.reply(reply);
      return;
    }

    if (sub === 'delete') {
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
        .addFields({ name: 'Deleted By', value: interaction.user.username, inline: true })
        .setFooter({ text: 'Community Organisation' })
        .setTimestamp()
      ]});
      return;
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

// Handle pagination button clicks
export async function handleButton(interaction) {
  const customId = interaction.customId;
  if (!customId.startsWith('infr_prev_') && !customId.startsWith('infr_next_')) return false;

  await interaction.deferUpdate();

  const parts = customId.split('_');
  const direction = parts[1]; // prev or next
  const currentPage = parseInt(parts[2]);
  const targetId = parts[3];
  const includeDeleted = parts[4] === '1';

  const infractions = getInfractions(targetId, false);
  const deleted = includeDeleted ? getDeletedInfractions(targetId) : [];
  const newPage = direction === 'next' ? currentPage + 1 : currentPage - 1;

  const reply = buildInfractionsPage(infractions, newPage, infractions.length, { id: targetId }, includeDeleted, deleted);
  await interaction.editReply(reply);
  return true;
}
