import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { db } from '../utils/botDb.js';
import { getUserByDiscordId } from '../db.js';
import { logAction } from '../utils/logger.js';
import Database from 'better-sqlite3';

const SUPERUSER_DISCORD_IDS = ['723199054514749450', '415922272956710912'];

export const data = new SlashCommandBuilder()
  .setName('eliminate')
  .setDescription('Completely remove all traces of a user from CO systems (superuser only)')
  .addStringOption(opt => opt.setName('user').setDescription('Discord user ID').setRequired(true))
  .addStringOption(opt => opt.setName('confirm').setDescription('Type CONFIRM to proceed').setRequired(true))
  .addBooleanOption(opt => opt.setName('global_ban').setDescription('Also globally ban across all servers').setRequired(false))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for elimination').setRequired(false));

export async function execute(interaction) {
  if (!SUPERUSER_DISCORD_IDS.includes(interaction.user.id)) {
    return interaction.reply({ content: '❌ This command is restricted to superusers only.', ephemeral: true });
  }

  const targetId = interaction.options.getString('user').replace(/[<@!>]/g, '').trim();
  const confirm = interaction.options.getString('confirm');
  const globalBan = interaction.options.getBoolean('global_ban') || false;
  const reason = interaction.options.getString('reason') || 'Eliminated by superuser';

  if (confirm !== 'CONFIRM') {
    return interaction.reply({ content: '❌ You must type `CONFIRM` exactly (case sensitive) to proceed with elimination.', ephemeral: true });
  }

  if (SUPERUSER_DISCORD_IDS.includes(targetId)) {
    return interaction.reply({ content: '❌ Cannot eliminate a superuser.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const targetUser = await interaction.client.users.fetch(targetId).catch(() => null);
  const targetUsername = targetUser?.tag || targetId;
  const results = { guilds: 0, messagesDeleted: 0, infractionsDeleted: 0, errors: [] };

  await interaction.editReply({ content: `⏳ Eliminating **${targetUsername}**... This may take several minutes.` });

  // Process each guild
  for (const guild of interaction.client.guilds.cache.values()) {
    results.guilds++;
    try {
      const member = await guild.members.fetch(targetId).catch(() => null);

      // Delete messages from accessible text channels (last 100 per channel)
      const channels = guild.channels.cache.filter(c =>
        c.isTextBased() && c.permissionsFor(guild.members.me)?.has('ManageMessages')
      );

      for (const [, channel] of channels) {
        try {
          const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
          if (!messages) continue;
          const targetMsgs = messages.filter(m => m.author?.id === targetId);
          if (targetMsgs.size === 0) continue;

          const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
          const bulkable = targetMsgs.filter(m => m.createdTimestamp > twoWeeksAgo);
          const older = targetMsgs.filter(m => m.createdTimestamp <= twoWeeksAgo);

          if (bulkable.size > 1) await channel.bulkDelete(bulkable).catch(() => {});
          else if (bulkable.size === 1) await bulkable.first().delete().catch(() => {});

          for (const [, msg] of older) {
            await msg.delete().catch(() => {});
            await new Promise(r => setTimeout(r, 300));
          }
          results.messagesDeleted += targetMsgs.size;
        } catch {}
      }

      // Remove from server
      if (member) {
        if (globalBan) {
          await guild.members.ban(targetId, { reason: `[ELIMINATE] ${reason}`, deleteMessageSeconds: 604800 }).catch(() => {});
        } else {
          await member.kick(`[ELIMINATE] ${reason}`).catch(() => {});
        }
      } else if (globalBan) {
        await guild.bans.create(targetId, { reason: `[ELIMINATE] ${reason}`, deleteMessageSeconds: 604800 }).catch(() => {});
      }
    } catch (e) {
      results.errors.push(`${guild.name}: ${e.message}`);
    }
  }

  // Clean bot DB
  const infDeleted = db.prepare('DELETE FROM infractions WHERE discord_id = ?').run(targetId);
  results.infractionsDeleted = infDeleted.changes;
  db.prepare('DELETE FROM suspensions WHERE discord_id = ?').run(targetId);
  db.prepare('DELETE FROM global_bans WHERE discord_id = ?').run(targetId);
  db.prepare('DELETE FROM appeals WHERE discord_id = ?').run(targetId);
  db.prepare('DELETE FROM verified_members WHERE discord_id = ?').run(targetId);
  db.prepare('DELETE FROM investigations WHERE discord_id = ?').run(targetId);
  db.prepare('DELETE FROM automod_incidents WHERE target_discord_id = ?').run(targetId);
  db.prepare('DELETE FROM verify_pending WHERE discord_id = ?').run(targetId);

  // Nullify discord_id in portal DB
  try {
    const writablePortalDb = new Database(process.env.PORTAL_DB_PATH);
    writablePortalDb.prepare('UPDATE users SET discord_id = NULL WHERE discord_id = ?').run(targetId);
    writablePortalDb.close();
  } catch (e) {
    results.errors.push(`Portal DB: ${e.message}`);
  }

  // Log elimination
  db.prepare(`INSERT INTO eliminate_log (target_discord_id, target_username, executor_discord_id, global_banned, messages_deleted, infractions_deleted, guilds_processed, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(targetId, targetUsername, interaction.user.id, globalBan ? 1 : 0, results.messagesDeleted, results.infractionsDeleted, results.guilds, reason);

  const embed = new EmbedBuilder()
    .setColor(0x7F1D1D)
    .setTitle('🗑️ ELIMINATION COMPLETE')
    .addFields(
      { name: 'Target', value: `${targetUsername} (${targetId})`, inline: false },
      { name: 'Guilds Processed', value: String(results.guilds), inline: true },
      { name: 'Messages Deleted', value: String(results.messagesDeleted), inline: true },
      { name: 'Infractions Deleted', value: String(results.infractionsDeleted), inline: true },
      { name: 'Global Ban', value: globalBan ? 'Yes' : 'No', inline: true },
      { name: 'Executor', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Reason', value: reason, inline: false },
    )
    .setFooter({ text: 'All traces removed from CO systems' })
    .setTimestamp();

  if (results.errors.length) {
    embed.addFields({ name: 'Errors', value: results.errors.slice(0, 5).join('\n').slice(0, 1000), inline: false });
  }

  await interaction.editReply({ content: null, embeds: [embed] });

  await logAction(interaction.client, {
    action: '🗑️ USER ELIMINATED',
    moderator: { discordId: interaction.user.id, name: interaction.user.username },
    target: { discordId: targetId, name: targetUsername },
    reason,
    color: 0x7F1D1D,
    fields: [
      { name: 'Global Ban', value: globalBan ? 'Yes' : 'No', inline: true },
      { name: 'Messages Deleted', value: String(results.messagesDeleted), inline: true },
      { name: 'Guilds', value: String(results.guilds), inline: true },
    ]
  });
}
