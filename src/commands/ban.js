import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { logAction } from '../utils/logger.js';
import db, { addInfraction } from '../utils/botDb.js';
import { isSuperuser } from '../utils/permissions.js';
import { ALL_SERVER_IDS } from '../config.js';

// Uses ALL_SERVER_IDS from config.js

export const data = new SlashCommandBuilder()
  .setName('ban')
  .setDescription('Permanently or temporarily ban a user from all CO servers. Requires superuser.')
  .addStringOption(opt =>
    opt.setName('user_id')
      .setDescription('The user\'s Discord ID or mention')
      .setRequired(true)
  )
  .addStringOption(opt =>
    opt.setName('reason')
      .setDescription('Reason for the ban')
      .setRequired(false)
  )
  .addStringOption(opt =>
    opt.setName('duration')
      .setDescription('Temp ban duration: 30s, 5m, 2h, 1d (omit for permanent)')
      .setRequired(false)
  );

export async function execute(interaction) {
    if (!await isSuperuser(interaction.user.id)) {
      return interaction.reply({ content: '❌ Insufficient permissions.', ephemeral: true });
    }

    if (!interaction.inGuild()) {
      return interaction.reply({ content: '❌ This command cannot be used in DMs.', ephemeral: true });
    }

    const targetUserId = interaction.options.getString('user_id').replace(/[<@!>]/g, '');
    const durationStr = interaction.options.getString('duration');
    const reason = interaction.options.getString('reason') || 'Not specified';

    if (!/^\d{17,19}$/.test(targetUserId)) {
      return interaction.reply({ content: '❌ Invalid user ID format.', ephemeral: true });
    }

    // Parse duration (e.g. "30s", "5m", "2h", "1d")
    const isTempBan = !!durationStr;
    let durationMs = null;
    if (isTempBan) {
      const match = durationStr.match(/^(\d+)([smhd])$/);
      if (!match) {
        return interaction.reply({ content: '❌ Invalid duration format. Use: 30s, 5m, 2h, 1d', ephemeral: true });
      }
      const value = parseInt(match[1]);
      const unit = match[2];
      const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
      durationMs = value * multipliers[unit];
      if (durationMs < 30000) {
        return interaction.reply({ content: '❌ Minimum ban duration is 30 seconds.', ephemeral: true });
      }
      if (durationMs > 604800000) {
        return interaction.reply({ content: '❌ Maximum ban duration is 7 days.', ephemeral: true });
      }
    }

    const existingBan = db.prepare("SELECT * FROM banned_users WHERE discord_id = ?").get(targetUserId);
    if (existingBan) {
      return interaction.reply({ content: `❌ <@${targetUserId}> is already in the global ban list.`, ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const results = [];
    const failedGuilds = [];
    const alreadyBanned = [];

    for (const guildId of ALL_SERVER_IDS) {
      const guild = await interaction.client.guilds.fetch(guildId).catch(() => null);
      if (!guild) continue;

      try {
        const currentBans = await guild.bans.fetch();
        const existingBanEntry = currentBans.find(b => b.user.id === targetUserId);
        if (existingBanEntry) {
          alreadyBanned.push(guild.name);
          continue;
        }

        await guild.bans.create(targetUserId, {
          reason: `${reason}${isTempBan ? ` | Temp: ${durationStr}` : ''} | Banned by ${interaction.user.username}`,
          deleteMessageSeconds: 0,
        });
        results.push(guild.name);
      } catch (err) {
        failedGuilds.push({ guild: guild.name, reason: err.message });
      }
    }

    if (results.length === 0 && alreadyBanned.length === 0) {
      return interaction.reply({ content: `❌ Failed to ban <@${targetUserId}> from all servers.`, ephemeral: true });
    }

    // Save to DB
    const unbanAt = isTempBan ? new Date(Date.now() + durationMs).toISOString() : null;
    db.prepare(
      "INSERT INTO banned_users (discord_id, username, banned_at, reason, banned_by, unban_at) VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?)"
    ).run(targetUserId, targetUserId, reason, interaction.user.id, unbanAt);

    const inf = addInfraction(targetUserId, isTempBan ? 'temp_ban' : 'global_ban', reason, interaction.user.id, interaction.user.username, isTempBan ? new Date(Date.now() + durationMs).toISOString() : null, 1);

    const titlePrefix = isTempBan ? '⏱️ Temporary Ban' : '🔨 Global Ban';
    const statusColor = failedGuilds.length === 0 && results.length > 0 ? 0xef4444 : 0xf59e0b;
    const unbanTs = isTempBan ? Math.floor((Date.now() + durationMs) / 1000) : null;

    const embed = new EmbedBuilder()
      .setTitle(`${titlePrefix} Complete`)
      .setColor(statusColor)
      .addFields(
        { name: 'User', value: `<@${targetUserId}>`, inline: false },
        { name: 'Scope', value: 'All Servers', inline: true },
        { name: 'Duration', value: isTempBan ? durationStr : 'Permanent', inline: true },
        { name: 'Banned From', value: results.join(', ') || 'None', inline: false },
        { name: 'Already Banned', value: alreadyBanned.join(', ') || 'None', inline: false },
        { name: 'Failed', value: failedGuilds.length > 0 ? failedGuilds.map(g => `${g.guild}: ${g.reason}`).join('\n') : 'None', inline: false },
        { name: 'Reason', value: reason, inline: false },
        ...(isTempBan ? [{ name: 'Auto-Unban', value: `<t:${unbanTs}:R>`, inline: true }] : []),
        { name: 'Banned By', value: `<@${interaction.user.id}>`, inline: false },
        { name: 'Case ID', value: `#${inf.lastInsertRowid}`, inline: true },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    // Schedule auto-unban for temp bans
    if (isTempBan) {
      setTimeout(async () => {
        const unbannedIn = [];
        const failedIn = [];
        for (const guildId of ALL_SERVER_IDS) {
          const guild = await interaction.client.guilds.fetch(guildId).catch(() => null);
          if (!guild) continue;
          try {
            await guild.members.unban(targetUserId, `Temporary ban (${durationStr}) expired.`);
            unbannedIn.push(guild.name);
          } catch (err) {
            failedIn.push({ guild: guild.name, reason: err.message });
          }
        }
        db.prepare("DELETE FROM banned_users WHERE discord_id = ? AND unban_at IS NOT NULL").run(targetUserId);

        await logAction(interaction.client, {
          action: `⏱️ Temp Ban Expired — Auto Unbanned`,
          moderator: { discordId: 'SYSTEM', name: 'Auto (Duration Expired)' },
          target: { discordId: targetUserId, name: targetUserId },
          reason: `Temp ban (${durationStr}) expired. Originally banned by <@${interaction.user.id}>`,
          color: 0x22c55e,
          fields: [
            { name: 'Duration', value: durationStr, inline: true },
            { name: 'Servers Unbanned', value: unbannedIn.join(', ') || 'None', inline: false },
            { name: 'Failed Servers', value: failedIn.length > 0 ? failedIn.map(g => `${g.guild}: ${g.reason}`).join('\n') : 'None', inline: false },
          ],
        });
      }, durationMs);
    }

    await logAction(interaction.client, {
      action: `${titlePrefix}${isTempBan ? ` (${durationStr})` : ''}`,
      moderator: { discordId: interaction.user.id, name: interaction.user.username },
      target: { discordId: targetUserId, name: targetUserId },
      reason,
      color: 0xef4444,
      fields: [
        { name: 'Scope', value: 'All Servers', inline: true },
        { name: 'Duration', value: isTempBan ? durationStr : 'Permanent', inline: true },
        { name: 'Servers Banned', value: results.join(', ') || 'None', inline: false },
        { name: 'Already Banned', value: alreadyBanned.join(', ') || 'None', inline: false },
        { name: 'Failed Servers', value: failedGuilds.length > 0 ? failedGuilds.map(g => `${g.guild}: ${g.reason}`).join('\n') : 'None', inline: false },
        ...(isTempBan ? [{ name: 'Auto-Unban At', value: `<t:${unbanTs}:F>`, inline: false }] : []),
      ],
    });
}
