// COMMAND_PERMISSION_FALLBACK: auth_level >= 6
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { logAction } from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('gnick')
  .setDescription('Set a nickname for a user across all servers (auth 6+)')
  .addUserOption(opt => opt.setName('user').setDescription('The user to rename').setRequired(true))
  .addStringOption(opt => opt.setName('nickname').setDescription('The nickname to set (leave blank to reset)').setRequired(false));

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const perm = await canUseCommand('gnick', interaction);
  if (!perm.allowed) {
    return interaction.editReply({ content: `❌ ${perm.reason}` });
  }

  const targetUser = interaction.options.getUser('user');
  const nickname = interaction.options.getString('nickname') || null;
  const truncated = nickname ? nickname.slice(0, 32) : null;

  let success = 0;
  let failed = 0;
  const results = [];

  for (const [, guild] of interaction.client.guilds.cache) {
    const member = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) continue;
    try {
      await member.setNickname(truncated, `gnick by ${interaction.user.username}`);
      success++;
      results.push(`✅ ${guild.name}`);
    } catch (e) {
      failed++;
      results.push(`❌ ${guild.name} — ${e.message.includes('Missing') ? 'Missing Permissions' : e.message}`);
    }
  }

  await logAction(interaction.client, {
    action: nickname ? '✏️ Global Nickname Set' : '✏️ Global Nickname Reset',
    moderator: { discordId: interaction.user.id, name: interaction.user.username },
    target: { discordId: targetUser.id, name: targetUser.username },
    reason: nickname || 'Reset to default',
    color: 0x5865F2,
    guildId: interaction.guildId,
  });

  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(failed > 0 ? 0xF59E0B : 0x22C55E)
      .setTitle(nickname ? '✏️ Global Nickname Set' : '✏️ Global Nickname Reset')
      .setDescription(`${nickname ? `Set **${truncated}** for` : 'Reset nickname for'} <@${targetUser.id}>\n\n${results.join('\n')}`)
      .addFields(
        { name: 'Success', value: String(success), inline: true },
        { name: 'Failed', value: String(failed), inline: true },
      )
      .setTimestamp()
    ]
  });
}
