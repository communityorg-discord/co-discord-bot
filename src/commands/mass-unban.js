import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { isSuperuser } from '../utils/verifyHelper.js';
import { MASS_UNBAN_LOG_CHANNEL_ID, ALL_SERVER_IDS } from '../config.js';
import { logAction } from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('mass-unban')
  .setDescription('Unban all previously banned members in a specific server or globally')
  .addStringOption(opt =>
    opt.setName('scope')
      .setDescription('unban_scope')
      .setRequired(true)
      .addChoices(
        { name: 'This Server Only', value: 'local' },
        { name: 'All Servers (Global)', value: 'global' }
      )
  )
  .addStringOption(opt =>
    opt.setName('reason')
      .setDescription('Reason for the mass unbans')
      .setRequired(true)
  );

export async function execute(interaction) {
  if (!await isSuperuser(interaction.user.id)) {
    return interaction.reply({ content: '❌ Only superusers can use this command.', ephemeral: true });
  }

  await interaction.deferReply();

  const scope = interaction.options.getString('scope');
  const reason = interaction.options.getString('reason');

  if (scope === 'global') {
    // Unban across all servers
    const results = [];
    let totalUnbanned = 0;
    let totalFailed = 0;

    for (const guildId of interaction.client.guilds.cache.keys()) {
      try {
        const guild = interaction.client.guilds.cache.get(guildId);
        const bans = await guild.bans.fetch();
        if (bans.size === 0) {
          results.push({ guild: guild.name, unbanned: 0, failed: 0 });
          continue;
        }

        let unbanned = 0;
        let failed = 0;
        for (const banEntry of bans.entries()) {
          try {
            await guild.bans.remove(banEntry[0], reason);
            unbanned++;
          } catch {
            failed++;
          }
        }
        totalUnbanned += unbanned;
        totalFailed += failed;
        results.push({ guild: guild.name, unbanned, failed });
      } catch (e) {
        totalFailed++;
        results.push({ guild: guildId, unbanned: 0, failed: 1, error: e.message });
      }
    }

    const lines = results.map(r =>
      r.error
        ? `❌ **${r.guild}:** Error — ${r.error}`
        : r.unbanned === 0 && r.failed === 0
        ? `⚪ **${r.guild}:** No bans to remove`
        : r.failed === 0
        ? `✅ **${r.guild}:** ${r.unbanned} unbanned`
        : `⚠️ **${r.guild}:** ${r.unbanned} unbanned, ${r.failed} failed`
    );

    const embed = new EmbedBuilder()
      .setTitle('🌐 Mass Unban (Global)')
      .setColor(0x22C55E)
      .addFields(
        { name: 'Total Unbanned', value: String(totalUnbanned), inline: true },
        { name: 'Total Failed', value: String(totalFailed), inline: true },
        { name: 'Servers Processed', value: String(results.length), inline: true },
        { name: 'Reason', value: reason, inline: false },
        { name: 'Per-Server Results', value: lines.join('\n') || 'None', inline: false }
      )
      .setFooter({ text: 'Community Organisation | Staff Assistant' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    // Log to mass-unban-logs + global moderation
    await logAction(interaction.client, {
      action: '🌐 Mass Unban (Global)',
      moderator: { discordId: interaction.user.id, name: interaction.user.username },
      target: { discordId: 'MULTIPLE', name: `All Servers (${results.length} servers)` },
      reason,
      color: 0x22C55E,
      fields: [
        { name: 'Total Unbanned', value: String(totalUnbanned), inline: true },
        { name: 'Total Failed', value: String(totalFailed), inline: true },
        { name: 'Servers Processed', value: String(results.length), inline: true },
      ],
      specificChannelId: MASS_UNBAN_LOG_CHANNEL_ID,
      guildId: interaction.guildId,
      logType: 'moderation.mass_unban'
    });

  } else {
    // Unban in current server only
    const guild = interaction.guild;
    const bans = await guild.bans.fetch();
    const results = [];
    let unbanned = 0;
    let failed = 0;

    for (const banEntry of bans.entries()) {
      try {
        await guild.bans.remove(banEntry[0], reason);
        unbanned++;
      } catch {
        failed++;
      }
    }

    const embed = new EmbedBuilder()
      .setTitle('🛡️ Mass Unban (Local)')
      .setColor(0x22C55E)
      .addFields(
        { name: 'Server', value: guild.name, inline: true },
        { name: 'Unbanned', value: String(unbanned), inline: true },
        { name: 'Failed', value: String(failed), inline: true },
        { name: 'Reason', value: reason, inline: false }
      )
      .setFooter({ text: 'Community Organisation | Staff Assistant' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    // Log to mass-unban-logs + global moderation
    await logAction(interaction.client, {
      action: '🛡️ Mass Unban (Local)',
      moderator: { discordId: interaction.user.id, name: interaction.user.username },
      target: { discordId: 'MULTIPLE', name: guild.name },
      reason,
      color: 0x22C55E,
      fields: [
        { name: 'Server', value: guild.name, inline: true },
        { name: 'Unbanned', value: String(unbanned), inline: true },
        { name: 'Failed', value: String(failed), inline: true },
      ],
      specificChannelId: MASS_UNBAN_LOG_CHANNEL_ID,
      guildId: interaction.guildId,
      logType: 'moderation.mass_unban'
    });
  }
}
