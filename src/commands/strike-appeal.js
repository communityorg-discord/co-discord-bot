import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canRunCommand } from '../utils/permissions.js';
import { getInfractions, updateInfraction } from '../utils/botDb.js';
import { logAction } from '../utils/logger.js';
import { STRIKE_LOG_CHANNEL_ID } from '../config.js';
import { getUserByDiscordId, getUserById } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('strike-appeal')
  .setDescription('Appeal a staff strike you have received')
  .addStringOption(opt => opt.setName('reason').setDescription('Your reason for appealing this strike').setRequired(true));

export async function execute(interaction) {
  // Any user can appeal — but they must be in a guild
  if (!interaction.inGuild()) {
    return interaction.reply({ content: '❌ This command cannot be used in DMs.' });
  }

  const reason = interaction.options.getString('reason');
  const userId = interaction.user.id;

  // Find the most recent active staff strike for this user
  const infractions = getInfractions(userId);
  const strike = infractions.find(inf => inf.type === 'staff_strike' && inf.active !== 0);

  if (!strike) {
    return interaction.reply({
      content: '❌ You have no active staff strikes to appeal. If you believe this is an error, contact a senior staff member directly.'
    });
  }

  // Get issuer info
  const issuer = await interaction.client.users.fetch(strike.moderator_id).catch(() => null);
  const issuerName = strike.moderator_name || (issuer ? issuer.username : strike.moderator_id);

  // Get issuer's portal info for line manager
  const issuerPortal = getUserByDiscordId(strike.moderator_id);
  let supervisor = null;
  if (issuerPortal?.line_manager_id) {
    supervisor = getUserById(issuerPortal.line_manager_id);
    if (supervisor?.discord_id) {
      try {
        supervisor.discordUser = await interaction.client.users.fetch(supervisor.discord_id).catch(() => null);
      } catch {}
    }
  }

  // Mark strike as appealed
  updateInfraction(strike.id, { appealed: 1, appeal_reason: reason, appeal_by: userId, appeal_at: new Date().toISOString() });

  const appealEmbed = new EmbedBuilder()
    .setTitle('⚠️ Strike Appeal Submitted')
    .setColor(0x3B82F6)
    .setDescription(`**${interaction.user.username}** has appealed their staff strike.`)
    .addFields(
      { name: 'Original Strike ID', value: `#${strike.id}`, inline: true },
      { name: 'Issued By', value: issuerName, inline: true },
      { name: 'Original Reason', value: strike.reason || '—', inline: false },
      { name: 'Appeal Reason', value: reason, inline: false },
    )
    .setFooter({ text: 'Community Organisation | Staff Strike Appeals' })
    .setTimestamp();

  const appealLogEmbed = new EmbedBuilder()
    .setTitle('⚠️ New Strike Appeal')
    .setColor(0x3B82F6)
    .setDescription(`**${interaction.user.username}** (<@${userId}>) has appealed their staff strike.`)
    .addFields(
      { name: 'Original Strike ID', value: `#${strike.id}`, inline: true },
      { name: 'Issued By', value: issuer ? `<@${strike.moderator_id}>` : issuerName, inline: true },
      { name: 'Original Reason', value: strike.reason || '—', inline: false },
      { name: 'Appeal Reason', value: reason, inline: false },
      { name: 'Appealed By', value: `<@${userId}>`, inline: true },
    )
    .setFooter({ text: 'Community Organisation | Staff Strike Appeals' })
    .setTimestamp();

  await interaction.deferReply();

  // Confirm to the user
  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle('✅ Strike Appeal Submitted')
      .setColor(0x22C55E)
      .setDescription(`Your appeal for strike **#${strike.id}** has been submitted.`)
      .addFields(
        { name: 'Original Reason', value: strike.reason || '—', inline: false },
        { name: 'Your Appeal', value: reason, inline: false },
      )
      .setFooter({ text: 'Community Organisation | Staff Strike Appeals' })
      .setTimestamp()
    ]
  });

  // DM the issuer
  if (issuer) {
    try {
      await issuer.send({
        embeds: [appealEmbed]
      }).catch(() => {});
    } catch {}
  }

  // DM the supervisor
  if (supervisor?.discordUser) {
    try {
      await supervisor.discordUser.send({
        embeds: [appealEmbed]
      }).catch(() => {});
    } catch {}
  }

  // Log to strike log channel
  await logAction(interaction.client, {
    action: '⚠️ Strike Appeal Submitted',
    moderator: { discordId: userId, name: interaction.user.username },
    target: { discordId: strike.moderator_id, name: issuerName },
    reason,
    color: 0x3B82F6,
    fields: [
      { name: 'Strike ID', value: `#${strike.id}`, inline: true },
      { name: 'Issuer', value: issuer ? `<@${strike.moderator_id}>` : issuerName, inline: true },
      { name: 'Original Reason', value: strike.reason || '—', inline: false },
      { name: 'Appeal Reason', value: reason, inline: false },
    ],
    specificChannelId: STRIKE_LOG_CHANNEL_ID,
    guildId: interaction.guildId,
    logType: 'moderation.strike_appeal',
  });
}
