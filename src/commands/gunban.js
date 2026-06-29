// COMMAND_PERMISSION_FALLBACK: auth_level >= 7
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { ALL_SERVER_IDS, APPEALS_SERVER_ID } from '../config.js';
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

  const serverResults = [];
  let unbannedCount = 0;
  for (const serverId of ALL_SERVER_IDS) {
    if (serverId === APPEALS_SERVER_ID) continue;
    try {
      const guild = await interaction.client.guilds.fetch(serverId).catch(() => null);
      if (!guild) { serverResults.push({ name: serverId, success: false, reason: 'Guild not found' }); continue; }
      const banEntry = await guild.bans.fetch(userId).catch(() => null);
      if (!banEntry) { serverResults.push({ name: guild.name, success: false, reason: 'Not banned here' }); continue; }
      await guild.bans.remove(userId, reason);
      serverResults.push({ name: guild.name, success: true });
      unbannedCount++;
    } catch (e) {
      serverResults.push({ name: serverId, success: false, reason: e.message });
    }
  }

  db.prepare('UPDATE global_bans SET active = 0 WHERE discord_id = ? AND active = 1').run(userId);
  db.prepare('UPDATE infractions SET active = 0 WHERE discord_id = ? AND type = ? AND active = 1').run(userId, 'global_ban');
  db.prepare('DELETE FROM banned_users WHERE discord_id = ?').run(userId);

  const inf = addInfraction(userId, 'global_unban', reason, interaction.user.id, interaction.user.username);

  const serverList = serverResults.map(s => `${s.success ? E.check : E.cross} ${s.name}`).join('\n');

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

  await interaction.editReply({ embeds: [new EmbedBuilder()
    .setTitle('Global Unban')
    .setColor(0x22C55E)
    .setDescription(`${E.unban} Global ban removed from <@${userId}>.`)
    .addFields(
      { name: 'Unbanned From', value: String(unbannedCount), inline: true },
      { name: 'Reason', value: reason, inline: false },
      { name: 'Moderator', value: interaction.user.username, inline: true },
      { name: 'Case ID', value: `#${inf.lastInsertRowid}`, inline: true }
    )
    .setFooter({ text: BRAND.name })
    .setTimestamp()
  ]});
}
