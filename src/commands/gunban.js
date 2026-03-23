import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { isSuperuser } from '../utils/permissions.js';
import { ALL_SERVER_IDS, APPEALS_SERVER_ID } from '../config.js';
import { getActiveGlobalBan } from '../utils/botDb.js';
import db from '../utils/botDb.js';
import { logAction } from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('gunban')
  .setDescription('Remove a global ban — Superuser only')
  .addStringOption(opt => opt.setName('userid').setDescription('Discord User ID').setRequired(true))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason for unbanning').setRequired(true));

export async function execute(interaction) {
  if (!isSuperuser(interaction.user.id)) return interaction.reply({ content: '❌ Superuser only.', ephemeral: true });

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

  const serverList = serverResults.map(s => `${s.success ? '🟢' : '🔴'} ${s.name}`).join('\n');

  await logAction(interaction.client, {
    action: 'Global Unban',
    moderator: { discordId: interaction.user.id, name: interaction.user.username },
    target: { discordId: userId, name: userId },
    reason, color: 0x22C55E,
    fields: [{ name: 'Servers Unbanned', value: String(unbannedCount), inline: true }]
  });

  await interaction.editReply({ embeds: [new EmbedBuilder()
    .setTitle('✅ Global Unban')
    .setColor(0x22C55E)
    .setDescription(`Global ban removed from <@${userId}>.`)
    .addFields(
      { name: 'Unbanned From', value: String(unbannedCount), inline: true },
      { name: 'Reason', value: reason, inline: false },
      { name: 'Moderator', value: interaction.user.username, inline: true },
      { name: 'Servers', value: serverList, inline: false }
    )
    .setFooter({ text: 'Community Organisation' })
    .setTimestamp()
  ]});
}
