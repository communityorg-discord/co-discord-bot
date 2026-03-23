import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { getPortalUser, isSuperuser, applyVerification, getOrCreateVerificationChannel } from '../utils/verifyHelper.js';
import { POSITIONS } from '../utils/positions.js';
import db from '../utils/botDb.js';

// Official account bypass IDs — can verify as CO | Official Account without portal entry
const OFFICIAL_BYPASS_IDS = ['878775920180228127', '1355367209249148928'];
function isOfficialBypass(discordId) {
  return OFFICIAL_BYPASS_IDS.includes(discordId);
}

export const data = new SlashCommandBuilder()
  .setName('verify')
  .setDescription('Verify your CO staff identity and apply your roles across all servers')
  .addStringOption(opt =>
    opt.setName('nickname')
      .setDescription('Your display name (e.g. Aaron C)')
      .setRequired(true)
  );

export async function execute(interaction) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const discordId = interaction.user.id;
    const nickname = interaction.options.getString('nickname').trim();

    // Check if already pending
    const pending = db.prepare("SELECT id FROM verification_queue WHERE discord_id = ? AND status = 'pending'").get(discordId);
    if (pending) {
      return interaction.editReply({ content: '⏳ You already have a pending verification request. Please wait for it to be reviewed.' });
    }

    // Official account bypass — verify as CO | Official Account without portal
    const isOfficial = isOfficialBypass(discordId);
    let portalUser = null;
    let position = null;

    if (isOfficial) {
      position = 'CO | Official Account';
    } else {
      // Look up in portal
      portalUser = await getPortalUser(discordId);
      if (!portalUser) {
        return interaction.editReply({ content: '❌ You are not found in the CO Staff Portal. You must be an active staff member to verify.\n\nIf you believe this is an error, please contact a superuser.' });
      }
      position = portalUser.position;
      if (!position || !POSITIONS[position]) {
        return interaction.editReply({ content: `❌ Your position **${position || 'Unknown'}** is not recognised in the roles system. Please contact a superuser.` });
      }
    }

    // Get verification channel
    let verifyChannel;
    try {
      verifyChannel = await getOrCreateVerificationChannel(interaction.client);
    } catch (e) {
      return interaction.editReply({ content: '❌ Could not find the verification channel. Please contact a superuser.' });
    }

    // Insert into queue
    const result = db.prepare(`
      INSERT INTO verification_queue (discord_id, guild_id, requested_nickname, portal_user_id, position, employee_number, supervisor_name, channel_id, verified_official)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      discordId, interaction.guildId, nickname,
      isOfficial ? null : portalUser.id,
      position,
      isOfficial ? 'N/A' : (portalUser?.employee_number || 'N/A'),
      isOfficial ? 'None' : (portalUser?.supervisor_name || 'None'),
      verifyChannel.id,
      isOfficial ? 1 : 0
    );

    const queueId = result.lastInsertRowid;

    // Build approval embed
    const embed = new EmbedBuilder()
      .setTitle(`Verification Request #${queueId}${isOfficial ? ' [OFFICIAL ACCOUNT]' : ''}`)
      .setColor(isOfficial ? 0xFFD700 : 0x8B4513)
      .addFields(
        { name: 'User', value: `<@${discordId}> (${discordId})`, inline: false },
        { name: 'Position Requested', value: position, inline: false },
        { name: 'Nickname Requested', value: nickname, inline: false },
        { name: 'Supervisor', value: 'N/A', inline: false },
        { name: 'Employee Number', value: 'CO999998', inline: false },
        { name: 'Verification ID', value: `#${queueId}`, inline: false },
        ...(isOfficial ? [{ name: 'Account Type', value: 'Official Account (Bypass)', inline: false }] : []),
      )
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`verify_approve_${queueId}`).setLabel('Confirm').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`verify_deny_${queueId}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
    );

    const msg = await verifyChannel.send({ embeds: [embed], components: [row] });

    // Save message ID
    db.prepare("UPDATE verification_queue SET message_id = ? WHERE id = ?").run(msg.id, queueId);

    await interaction.editReply({ content: `✅ Your verification request **#${queueId}** has been submitted and is awaiting approval from a superuser.` });
  } catch (err) {
    console.error('[Verify] Error:', err.message);
    try {
      await interaction.editReply({ content: '❌ An error occurred while processing your verification. Please try again or contact a superuser.' });
    } catch (_) {}
  }
}

// Button interaction handler
export async function handleButton(interaction) {
  const customId = interaction.customId;

  // ── Approve ──────────────────────────────────────────────────────────────
  if (customId.startsWith('verify_approve_')) {
    const queueId = customId.replace('verify_approve_', '');

    if (!await isSuperuser(interaction.user.id)) {
      return interaction.reply({ content: '❌ Only superusers can approve verifications.', ephemeral: true });
    }

    const entry = db.prepare("SELECT * FROM verification_queue WHERE id = ? AND status = 'pending'").get(queueId);
    if (!entry) return interaction.reply({ content: '❌ Request not found or already processed.', ephemeral: true });

    // Use update() to replace the button message with the approval embed
    const isOfficial = Number(entry.verified_official) === 1;

    // Apply roles + nickname across all guilds
    await applyVerification(interaction.client, entry.discord_id, entry.position, entry.requested_nickname);

    // Save to verified_members
    db.prepare(`
      INSERT OR REPLACE INTO verified_members (discord_id, portal_user_id, position, employee_number, nickname, verified_at, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(entry.discord_id, entry.portal_user_id || null, entry.position, entry.employee_number, entry.requested_nickname);

    // Update queue status
    db.prepare("UPDATE verification_queue SET status = 'approved', reviewed_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(interaction.user.id, queueId);

    // Update the message to show approval
    const approvedEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle(`✅ Verification Request #${queueId} — Approved${isOfficial ? ' [OFFICIAL ACCOUNT]' : ''}`)
      .addFields({ name: 'Approved By', value: `<@${interaction.user.id}>`, inline: false })
      .addFields({ name: 'Note', value: `Verified - Employee: ${entry.employee_number || 'N/A'}`, inline: false });

    await interaction.update({ embeds: [approvedEmbed], components: [] });

    // DM the user
    try {
      const user = await interaction.client.users.fetch(entry.discord_id);
      const note = isOfficial ? 'Official Account' : `Employee: ${entry.employee_number || 'N/A'}`;
      await user.send(`✅ Your CO verification has been **approved** by <@${interaction.user.id}>.\n\nYour roles and nickname have been applied across all CO servers.\n**Note:** Verified - ${note}`);
    } catch (e) {
      console.warn('[Verify] Could not DM user:', e.message);
    }
    return;
  }

  // ── Deny — show modal for reason ─────────────────────────────────────────
  if (customId.startsWith('verify_deny_')) {
    const queueId = customId.replace('verify_deny_', '');

    if (!await isSuperuser(interaction.user.id)) {
      return interaction.reply({ content: '❌ Only superusers can deny verifications.', ephemeral: true });
    }

    const modal = new ModalBuilder()
      .setCustomId(`verify_deny_reason_${queueId}`)
      .setTitle('Deny Verification')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('reason')
            .setLabel('Reason for denial')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
        )
      );

    await interaction.showModal(modal);
    return;
  }
}

// Modal submit handler
export async function handleModal(interaction) {
  if (!interaction.customId.startsWith('verify_deny_reason_')) return;
  const queueId = interaction.customId.replace('verify_deny_reason_', '');
  const reason = interaction.fields.getTextInputValue('reason');

  const entry = db.prepare("SELECT * FROM verification_queue WHERE id = ? AND status = 'pending'").get(queueId);
  if (!entry) return;

  db.prepare("UPDATE verification_queue SET status = 'denied', reviewed_by = ?, deny_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(interaction.user.id, reason, queueId);

  const deniedEmbed = new EmbedBuilder()
    .setColor(0xef4444)
    .setTitle(`❌ Verification Request #${queueId} — Denied`)
    .addFields({ name: 'Denied By', value: `<@${interaction.user.id}>`, inline: false })
    .addFields({ name: 'Reason', value: reason, inline: false });

  await interaction.update({ embeds: [deniedEmbed], components: [] });

  try {
    const user = await interaction.client.users.fetch(entry.discord_id);
    await user.send(`❌ Your CO verification request has been **denied**.\n\n**Reason:** ${reason}\n\nIf you believe this is an error, please contact a superuser.`);
  } catch (e) {
    console.warn('[Verify] Could not DM user:', e.message);
  }
}
