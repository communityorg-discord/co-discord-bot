import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { getPortalUser, isSuperuser, applyVerification, getOrCreateVerificationChannel } from '../utils/verifyHelper.js';
import { POSITIONS } from '../utils/positions.js';
import db from '../utils/botDb.js';
import { VERIFY_UNVERIFY_LOG_CHANNEL_ID } from '../config.js';
import { logAction } from '../utils/logger.js';

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

// Build per-guild result lines for the embed
function buildGuildResultsField(results, type) {
  const lines = [];
  for (const r of results) {
    if (r.error && !r.success) {
      lines.push(`❌ **${r.guild}** — ${r.error}`);
      continue;
    }
    if (type === 'verify') {
      let line = `✅ **${r.guild}**`;
      const parts = [];
      if (r.nicknameSet) parts.push('Nickname set');
      else if (r.nicknameError) parts.push(`Nickname failed: ${r.nicknameError}`);
      if (r.rolesAdded.length) parts.push(`+${r.rolesAdded.length} role(s)`);
      if (r.rolesRemoveFailed.length) parts.push(`⚠️ Could not remove: ${r.rolesRemoveFailed.join(', ')}`);
      if (r.rolesAddFailed.length) parts.push(`⚠️ Could not add: ${r.rolesAddFailed.join(', ')}`);
      if (!parts.length && !r.nicknameSet) parts.push('No changes needed');
      if (parts.length) line += ` — ${parts.join(' | ')}`;
      lines.push(line);
    } else {
      let line = r.success ? `✅ **${r.guild}**` : `❌ **${r.guild}**`;
      const parts = [];
      if (r.nicknameReset) parts.push('Nickname reset');
      else if (r.nicknameError) parts.push(`Nickname failed: ${r.nicknameError}`);
      if (r.rolesRemoved.length) parts.push(`-${r.rolesRemoved.length} role(s)`);
      if (r.rolesRemoveFailed.length) parts.push(`⚠️ Could not remove: ${r.rolesRemoveFailed.join(', ')}`);
      if (!parts.length) parts.push('No roles to remove');
      line += ` — ${parts.join(' | ')}`;
      lines.push(line);
    }
  }
  return lines.join('\n');
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

    const isOfficial = Number(entry.verified_official) === 1;

    await interaction.deferUpdate();

    // Apply roles + nickname across all guilds — get detailed results
    const results = await applyVerification(interaction.client, entry.discord_id, entry.position, entry.requested_nickname);

    // Save to verified_members
    db.prepare(`
      INSERT OR REPLACE INTO verified_members (discord_id, portal_user_id, position, employee_number, nickname, verified_at, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(entry.discord_id, entry.portal_user_id || null, entry.position, entry.employee_number, entry.requested_nickname);

    // Update queue status
    db.prepare("UPDATE verification_queue SET status = 'approved', reviewed_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(interaction.user.id, queueId);

    const guildFieldLines = buildGuildResultsField(results, 'verify');
    const successCount = results.filter(r => r.success && !r.rolesAddFailed.length && !r.rolesRemoveFailed.length).length;
    const partialCount = results.filter(r => r.success && (r.rolesAddFailed.length || r.rolesRemoveFailed.length)).length;
    const failedCount = results.filter(r => !r.success).length;

    const fields = [
      { name: 'User', value: `<@${entry.discord_id}> (${entry.discord_id})`, inline: false },
      { name: 'Position', value: entry.position, inline: true },
      { name: 'Nickname', value: entry.requested_nickname, inline: true },
      { name: 'Approved By', value: `<@${interaction.user.id}>`, inline: false },
    ];

    if (isOfficial) fields.push({ name: 'Account Type', value: 'Official Account (Bypass)', inline: false });

    const updatedEmbed = new EmbedBuilder()
      .setColor(0x22C55E)
      .setTitle(`✅ Verification #${queueId} — Approved${isOfficial ? ' [OFFICIAL ACCOUNT]' : ''}`)
      .addFields(...fields)
      .setTimestamp();

    try {
      if (originalMsg) {
        await originalMsg.edit({ embeds: [updatedEmbed], components: [] });
      } else {
        await interaction.editReply({ content: `✅ Verification **#${queueId}** approved.`, ephemeral: true });
      }
    } catch (e) {
      console.warn(`[Verify] Could not edit message: ${e.message}`);
      try {
        await interaction.editReply({ content: `✅ Verification **#${queueId}** approved — could not edit original message.`, ephemeral: true });
      } catch (_) {}
    }

    // Log to verify-unverify-logs + full-mod-logs
    await logAction(interaction.client, {
      action: `✅ Staff Verified${isOfficial ? ' [Official Account]' : ''}`,
      moderator: { discordId: interaction.user.id, name: interaction.user.username },
      target: { discordId: entry.discord_id, name: entry.requested_nickname },
      reason: entry.position,
      color: 0x22C55E,
      fields: [
        { name: 'Position', value: entry.position, inline: true },
        { name: 'Nickname', value: entry.requested_nickname, inline: true },
        { name: 'Servers Applied', value: `${successCount} ✅ | ${partialCount} ⚠️ | ${failedCount} ❌`, inline: false },
        { name: 'Per-Server Results', value: guildFieldLines.slice(0, 1024) || 'None', inline: false },
      ],
      specificChannelId: VERIFY_UNVERIFY_LOG_CHANNEL_ID
    });

    // DM the user
    try {
      const user = await interaction.client.users.fetch(entry.discord_id);
      const summary = guildFieldLines.split('\n').slice(0, 20).join('\n');
      const note = isOfficial ? 'Official Account' : `Employee: ${entry.employee_number || 'N/A'}`;
      await user.send({
        embeds: [new EmbedBuilder()
          .setTitle('✅ CO Verification Approved')
          .setColor(0x22C55E)
          .setDescription(`Your CO staff verification has been approved by <@${interaction.user.id}>.`)
          .addFields(
            { name: 'Position', value: entry.position, inline: true },
            { name: 'Note', value: `Verified - ${note}`, inline: false },
            { name: 'Per-Server Results', value: summary || 'None', inline: false },
            { name: 'Servers Applied', value: `${successCount} ✅ | ${partialCount} ⚠️ | ${failedCount} ❌`, inline: false },
          )
          .setFooter({ text: 'Community Organisation | Staff Assistant' })
          .setTimestamp()
        ]
      });
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

  const updatedEmbed = new EmbedBuilder()
    .setColor(0xef4444)
    .setTitle(`❌ Verification Request #${queueId} — Denied`)
    .addFields(
      { name: 'User', value: `<@${entry.discord_id}> (${entry.discord_id})`, inline: false },
      { name: 'Position Requested', value: entry.position, inline: false },
      { name: 'Nickname Requested', value: entry.requested_nickname, inline: false },
      { name: 'Supervisor', value: entry.supervisor_name || 'N/A', inline: false },
      { name: 'Employee Number', value: entry.employee_number || 'N/A', inline: false },
      { name: 'Verification ID', value: `#${queueId}`, inline: false },
      { name: 'Denied By', value: `<@${interaction.user.id}>`, inline: false },
      { name: 'Reason', value: reason, inline: false },
    )
    .setTimestamp();

  await interaction.deferUpdate();
  await interaction.message.edit({ embeds: [updatedEmbed], components: [] });

  try {
    const user = await interaction.client.users.fetch(entry.discord_id);
    await user.send(`❌ Your CO verification request has been **denied**.\n\n**Reason:** ${reason}\n\nIf you believe this is an error, please contact a superuser.`);
  } catch (e) {
    console.warn('[Verify] Could not DM user:', e.message);
  }
}
