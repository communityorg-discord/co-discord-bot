import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getPortalUser, getOrCreateVerificationChannel } from '../utils/verifyHelper.js';
import { POSITIONS } from '../utils/positions.js';
import { db } from '../utils/botDb.js';
import { logAction } from '../utils/logger.js';
import { OFFICIAL_BYPASS_IDS } from '../config.js';

const SUPERUSER_IDS = ['723199054514749450', '415922272956710912', '1013486189891817563'];

export const data = new SlashCommandBuilder()
  .setName('force-verify')
  .setDescription('Submit a verification request on behalf of another user (superuser only)')
  .addUserOption(opt =>
    opt.setName('user')
      .setDescription('The user to verify')
      .setRequired(true)
  );

export async function execute(interaction) {
  try {
    await interaction.deferReply({ ephemeral: true });

    if (!SUPERUSER_IDS.includes(interaction.user.id)) {
      return interaction.editReply({ content: 'This command is restricted to superusers only.' });
    }

    const targetUser = interaction.options.getUser('user');
    const discordId = targetUser.id;
    const nickname = '(pending approver input)';

    // Check if already pending
    const pending = db.prepare("SELECT id FROM verification_queue WHERE discord_id = ? AND status = 'pending'").get(discordId);
    if (pending) {
      return interaction.editReply({ content: `⏳ <@${discordId}> already has a pending verification request (#${pending.id}).` });
    }

    // Check official account bypass
    const isOfficial = OFFICIAL_BYPASS_IDS.includes(discordId);
    let portalUser = null;
    let position = null;

    if (isOfficial) {
      position = 'CO | Official Account';
    } else {
      portalUser = await getPortalUser(discordId);
      if (!portalUser) {
        return interaction.editReply({ content: `❌ <@${discordId}> is not found in the CO Staff Portal. They must be an active staff member to verify.` });
      }
      position = portalUser.position;
      if (!position || !POSITIONS[position]) {
        return interaction.editReply({ content: `❌ Position **${position || 'Unknown'}** is not recognised in the roles system.` });
      }
    }

    // Get verification channel
    let verifyChannel;
    try {
      verifyChannel = await getOrCreateVerificationChannel(interaction.client);
    } catch (e) {
      return interaction.editReply({ content: '❌ Could not find the verification channel.' });
    }

    const isProbation = !isOfficial && portalUser?.on_probation === true;

    // Insert into queue
    const result = db.prepare(`
      INSERT INTO verification_queue (discord_id, guild_id, requested_nickname, portal_user_id, position, employee_number, supervisor_name, channel_id, verified_official, is_probation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      discordId, interaction.guildId, nickname,
      isOfficial ? null : portalUser.id,
      position,
      isOfficial ? 'N/A' : (portalUser?.employee_number || 'N/A'),
      isOfficial ? 'None' : (portalUser?.supervisor_name || 'None'),
      verifyChannel.id,
      isOfficial ? 1 : 0,
      isProbation ? 1 : 0
    );

    const queueId = result.lastInsertRowid;

    // Build approval embed — same as normal verify
    const embed = new EmbedBuilder()
      .setTitle(`Verification Request #${queueId}${isOfficial ? ' [OFFICIAL ACCOUNT]' : ''} [Force]`)
      .setColor(isOfficial ? 0xFFD700 : 0x8B4513)
      .addFields(
        { name: 'User', value: `<@${discordId}> (${discordId})`, inline: false },
        { name: 'Position Requested', value: position, inline: false },
        { name: 'Nickname Requested', value: nickname, inline: false },
        { name: 'Supervisor', value: isOfficial ? 'None' : (portalUser?.supervisor_name || 'N/A'), inline: false },
        { name: 'Employee Number', value: isOfficial ? 'N/A' : (portalUser?.employee_number || 'N/A'), inline: false },
        { name: 'Verification ID', value: `#${queueId}`, inline: false },
        { name: 'Submitted By', value: `<@${interaction.user.id}> (force-verify)`, inline: false },
        ...(isOfficial ? [{ name: 'Account Type', value: 'Official Account (Bypass)', inline: false }] : []),
      )
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`verify_approve_${queueId}_0`).setLabel('Confirm').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`verify_auth_override_${queueId}`).setLabel('Authorisation Level').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`verify_deny_${queueId}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
    );

    const msg = await verifyChannel.send({ embeds: [embed], components: [row] });
    db.prepare("UPDATE verification_queue SET message_id = ? WHERE id = ?").run(msg.id, queueId);

    await logAction(interaction.client, {
      action: '📝 Force Verification Request Submitted',
      target: { discordId, name: targetUser.username },
      moderator: { discordId: interaction.user.id, name: interaction.user.username },
      color: 0x5865F2,
      description: `Force verification request **#${queueId}** submitted for <@${discordId}> by <@${interaction.user.id}>`,
      guildId: interaction.guildId
    });

    return interaction.editReply({ content: `✅ Verification request **#${queueId}** submitted for <@${discordId}> as **${position}**. Awaiting approval in the verification queue.` });
  } catch (err) {
    console.error('[Force Verify] Error:', err.message);
    try {
      await interaction.editReply({ content: '❌ An error occurred. Please try again.' });
    } catch (_) {}
  }
}
