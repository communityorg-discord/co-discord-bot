// COMMAND_PERMISSION_FALLBACK: auth_level >= 7
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { APPEALS_SERVER_ID, getEffectiveAllServerIds } from '../config.js';
import { getActiveGlobalBan } from '../utils/botDb.js';
import db, { addInfraction } from '../utils/botDb.js';
import { logAction } from '../utils/logger.js';
import { GBAN_UNGBAN_LOG_CHANNEL_ID } from '../config.js';
import { E } from '../lib/emoji.js';
import { BRAND } from '../utils/brand.js';

export const data = new SlashCommandBuilder()
  .setName('gunban')
  .setDescription('Remove a global ban (Administrators and above)')
  .addStringOption(opt => opt.setName('userid').setDescription('Discord User ID').setRequired(true))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for unbanning').setRequired(true));

export async function execute(interaction) {
  const perm = await canUseCommand('gunban', interaction);
  if (!perm.allowed) return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });

  const userId = interaction.options.getString('userid');
  const reason = interaction.options.getString('reason');

  await interaction.deferReply();

  // Unban from EVERY guild the bot is in — not just the configured
  // ALL_SERVER_IDS list, which can drift out of date (servers added after
  // the env was last set would be missed). getEffectiveAllServerIds falls
  // back to the live guild cache when the env list is empty.
  const targetIds = new Set(getEffectiveAllServerIds(interaction.client));
  for (const [gid] of interaction.client.guilds.cache) targetIds.add(gid);

  const serverResults = [];
  let unbannedCount = 0;
  for (const serverId of targetIds) {
    if (serverId === APPEALS_SERVER_ID) continue;
    let guild;
    try {
      guild = interaction.client.guilds.cache.get(serverId)
        || await interaction.client.guilds.fetch(serverId).catch(() => null);
      if (!guild) { serverResults.push({ name: serverId, success: false, reason: 'Guild not found' }); continue; }
    } catch (e) {
      serverResults.push({ name: serverId, success: false, reason: e.message }); continue;
    }
    // Attempt the removal DIRECTLY. Don't gate on bans.fetch() first — that
    // call can throw transiently (or on Unknown Ban) and the old code
    // swallowed ANY error into "Not banned here", silently skipping the
    // actual unban. Let remove() be the source of truth: code 10026
    // (Unknown Ban) means they simply weren't banned here; anything else is
    // a genuine failure worth surfacing.
    try {
      await guild.bans.remove(userId, reason);
      serverResults.push({ name: guild.name, success: true });
      unbannedCount++;
    } catch (e) {
      if (e.code === 10026 /* Unknown Ban */) {
        serverResults.push({ name: guild.name, success: false, reason: 'Not banned here', notBanned: true });
      } else {
        serverResults.push({ name: guild.name, success: false, reason: e.message });
      }
    }
  }

  db.prepare('UPDATE global_bans SET active = 0 WHERE discord_id = ? AND active = 1').run(userId);
  db.prepare('UPDATE infractions SET active = 0 WHERE discord_id = ? AND type = ? AND active = 1').run(userId, 'global_ban');
  db.prepare('DELETE FROM banned_users WHERE discord_id = ?').run(userId);

  const inf = addInfraction(userId, 'global_unban', reason, interaction.user.id, interaction.user.username);

  // Show the servers we actually unbanned from, plus any GENUINE failures
  // (permission/API errors) — but not the long tail of "wasn't banned here",
  // which is just noise across 20+ guilds.
  const unbanned = serverResults.filter(s => s.success);
  const failed = serverResults.filter(s => !s.success && !s.notBanned);
  const serverList = [
    ...unbanned.map(s => `${E.check} ${s.name}`),
    ...failed.map(s => `${E.cross} ${s.name} — ${s.reason}`),
  ].join('\n') || 'Not banned in any server the bot can see.';

  // Discord field-value cap is 1024 chars — long reasons overflow & 500
  // the whole embed. Truncate; full reason persists in infractions table.
  const safeReason = reason.length > 1000
    ? reason.slice(0, 1000) + '… [truncated for embed; full reason in /portal cases]'
    : reason;
  await logAction(interaction.client, {
    action: 'Global Unban',
    moderator: { discordId: interaction.user.id, name: interaction.user.username },
    target: { discordId: userId, name: userId },
    reason: safeReason, color: 0x22C55E,
    fields: [
      { name: 'Servers Unbanned', value: String(unbannedCount), inline: true },
      { name: 'Servers', value: serverList.slice(0, 1000), inline: false }
    ],
    specificChannelId: GBAN_UNGBAN_LOG_CHANNEL_ID,
    guildId: interaction.guildId,
    logType: 'moderation.gban_ungban',
  });

  // Try to show the unbanned member's avatar as the embed thumbnail (best-effort).
  const targetUser = await interaction.client.users.fetch(userId).catch(() => null);
  const serverWord = `${unbannedCount} server${unbannedCount === 1 ? '' : 's'}`;

  await interaction.editReply({ embeds: [new EmbedBuilder()
    .setColor(BRAND.accent)
    .setAuthor({ name: 'Global Unban', iconURL: BRAND.logo })
    .setThumbnail(targetUser ? targetUser.displayAvatarURL() : null)
    .setDescription(`${E.unban} The global ban on <@${userId}> has been lifted — they can rejoin ${BRAND.servers}.`)
    .addFields(
      { name: `${E.member} Member`, value: `<@${userId}>`, inline: true },
      { name: `${E.check} Restored to`, value: serverWord, inline: true },
      { name: `${E.id} Case`, value: `#${inf.lastInsertRowid}`, inline: true },
      { name: `${E.gavel} Reason`, value: reason.length > 1000 ? reason.slice(0, 1000) + '…' : reason, inline: false },
      { name: `${E.staff} Actioned by`, value: `<@${interaction.user.id}>`, inline: true },
    )
    .setFooter({ text: BRAND.footer, iconURL: BRAND.logo })
    .setTimestamp()
  ]});
}
