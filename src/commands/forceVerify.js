import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { applyVerification } from '../utils/verifyHelper.js';
import { POSITIONS } from '../utils/positions.js';
import { db } from '../utils/botDb.js';
import { getUserByDiscordId } from '../db.js';
import { logAction } from '../utils/logger.js';
import { VERIFY_UNVERIFY_LOG_CHANNEL_ID } from '../config.js';

const SUPERUSER_IDS = ['723199054514749450', '415922272956710912', '1013486189891817563'];

export const data = new SlashCommandBuilder()
  .setName('force-verify')
  .setDescription('Force verify a user as a specific position (superuser only)')
  .addUserOption(opt =>
    opt.setName('user')
      .setDescription('The user to force verify')
      .setRequired(true)
  )
  .addStringOption(opt =>
    opt.setName('position')
      .setDescription('Their position e.g. Secretary-General')
      .setRequired(true)
  )
  .addStringOption(opt =>
    opt.setName('nickname')
      .setDescription('Their full nickname e.g. Evan S. | Secretary-General')
      .setRequired(true)
  );

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  if (!SUPERUSER_IDS.includes(interaction.user.id)) {
    return interaction.editReply({ content: 'This command is restricted to superusers only.' });
  }

  const targetUser = interaction.options.getUser('user');
  const position = interaction.options.getString('position');
  const nickname = interaction.options.getString('nickname');

  // Look up portal record
  const portalUser = getUserByDiscordId(targetUser.id);

  // Apply verification across all guilds
  const results = await applyVerification(
    interaction.client,
    targetUser.id,
    position,
    nickname,
    { isProbation: false, overrideAuthLevel: null }
  );

  // Save to verified_members
  db.prepare(`
    INSERT OR REPLACE INTO verified_members (discord_id, portal_user_id, position, employee_number, nickname, verified_at, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(
    targetUser.id,
    portalUser?.id || null,
    position,
    portalUser?.employee_number || 'N/A',
    nickname
  );

  // DM the verified user
  try {
    await targetUser.send({
      embeds: [new EmbedBuilder()
        .setColor(0x22C55E)
        .setTitle('✅ You Have Been Verified')
        .setDescription(`You have been verified by **${interaction.user.username}**.\n\nYour position is **${position}** and your nickname has been set to **${nickname}**.`)
        .setFooter({ text: 'Community Organisation | Staff Verification' })
        .setTimestamp()
      ]
    });
  } catch (e) {
    console.warn('[Force Verify] Could not DM user:', e.message);
  }

  // Log to verify-log
  const successCount = results.filter(r => r.success).length;
  const failedCount = results.filter(r => !r.success).length;

  await logAction(interaction.client, {
    action: '✅ Staff Force Verified',
    moderator: { discordId: interaction.user.id, name: interaction.user.username },
    target: { discordId: targetUser.id, name: nickname },
    reason: position,
    color: 0x22C55E,
    fields: [
      { name: 'Position', value: position, inline: true },
      { name: 'Nickname', value: nickname, inline: true },
      { name: 'Servers Applied', value: `${successCount} ✅ | ${failedCount} ❌`, inline: false },
    ],
    specificChannelId: VERIFY_UNVERIFY_LOG_CHANNEL_ID,
    guildId: interaction.guildId,
    logType: 'verification.verify_unverify',
  });

  return interaction.editReply({ content: `✅ ${targetUser.tag} has been force verified as **${position}** with nickname **${nickname}**.` });
}
