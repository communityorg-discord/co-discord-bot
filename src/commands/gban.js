import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canRunCommand, isSuperuser, requiresSuperuserWarning } from '../utils/permissions.js';
import { ALL_SERVER_IDS, APPEALS_SERVER_ID } from '../config.js';
import { addInfraction, addGlobalBan, getActiveGlobalBan } from '../utils/botDb.js';
import { logAction } from '../utils/logger.js';
import { getUserByDiscordId } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('gban')
  .setDescription('Globally ban a user from all CO servers')
  .addUserOption(opt => opt.setName('user').setDescription('User to globally ban').setRequired(true))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason').setRequired(true))
  .addStringOption(opt => opt.setName('appealable').setDescription('Can this be appealed?').setRequired(false)
    .addChoices({ name: 'Yes', value: 'yes' }, { name: 'No', value: 'no' }));

export async function execute(interaction) {
  const perm = canRunCommand(interaction.user.id, 7);
  if (!perm.allowed) return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });

  const target = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason');
  const appealable = interaction.options.getString('appealable') !== 'no' ? 1 : 0;

  if (requiresSuperuserWarning(target.id)) {
    return interaction.reply({ content: `⚠️ You are attempting to globally ban a Superuser. This has been logged.`, ephemeral: true });
  }

  const existing = getActiveGlobalBan(target.id);
  if (existing) return interaction.reply({ content: `❌ ${target.username} already has an active global ban.`, ephemeral: true });

  await interaction.deferReply();

  let bannedCount = 0;
  for (const serverId of ALL_SERVER_IDS) {
    if (serverId === APPEALS_SERVER_ID) continue;
    try {
      const guild = await interaction.client.guilds.fetch(serverId).catch(() => null);
      if (!guild) continue;
      await guild.bans.create(target.id, { reason: `Global Ban: ${reason}` });
      bannedCount++;
    } catch (e) {
      console.error(`[GBan] Failed in server ${serverId}:`, e.message);
    }
  }

  const inf = addInfraction(target.id, 'global_ban', reason, interaction.user.id, interaction.user.username, null, appealable);
  addGlobalBan(target.id, reason, interaction.user.id, appealable);

  try {
    await target.send({
      embeds: [new EmbedBuilder()
        .setTitle('🔨 Global Ban')
        .setColor(0x7F1D1D)
        .setDescription('You have been globally banned from all Community Organisation servers.')
        .addFields(
          { name: 'Reason', value: reason },
          { name: 'Appeal', value: appealable ? 'You may appeal this ban in the Appeals Server.' : 'This ban is **not appealable**.' }
        )
        .setTimestamp()
      ]
    });
  } catch {}

  await logAction(interaction.client, {
    action: 'Global Ban',
    moderator: { discordId: interaction.user.id, name: interaction.user.username },
    target: { discordId: target.id, name: getUserByDiscordId(target.id)?.display_name || target.username },
    reason, color: 0x7F1D1D,
    fields: [
      { name: 'Servers Banned', value: String(bannedCount), inline: true },
      { name: 'Appealable', value: appealable ? 'Yes' : 'No', inline: true }
    ]
  });

  await interaction.editReply({ embeds: [new EmbedBuilder()
    .setTitle('🔨 Global Ban')
    .setColor(0x7F1D1D)
    .setDescription(`**${target.username}** has been globally banned from all CO servers.`)
    .addFields(
      { name: 'Case ID', value: `#${inf.lastInsertRowid}`, inline: true },
      { name: 'Servers Banned', value: String(bannedCount), inline: true },
      { name: 'Reason', value: reason, inline: false },
      { name: 'Appealable', value: appealable ? 'Yes' : 'No', inline: true },
      { name: 'Moderator', value: interaction.user.username, inline: true }
    )
    .setFooter({ text: 'Community Organisation' })
    .setTimestamp()
  ]});
}
