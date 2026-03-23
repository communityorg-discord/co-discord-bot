import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { getPortalUser, isSuperuser, applyVerification, getOrCreateVerificationChannel } from '../utils/verifyHelper.js';
import { POSITIONS } from '../utils/positions.js';
import db from '../utils/botDb.js';

export const data = new SlashCommandBuilder()
  .setName('verify')
  .setDescription('Verify your CO staff identity and apply your roles across all servers')
  .addStringOption(opt =>
    opt.setName('nickname')
      .setDescription('Your display name (e.g. Aaron C)')
      .setRequired(true)
  );

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const discordId = interaction.user.id;
  const nickname = interaction.options.getString('nickname').trim();

  // Check if already pending
  const pending = db.prepare("SELECT id FROM verification_queue WHERE discord_id = ? AND status = 'pending'").get(discordId);
  if (pending) {
    return interaction.editReply({ content: '⏳ You already have a pending verification request. Please wait for it to be reviewed.' });
  }

  // Look up in portal
  const portalUser = await getPortalUser(discordId);
  if (!portalUser) {
    return interaction.editReply({ content: '❌ You are not found in the CO Staff Portal. You must be an active staff member to verify.\n\nIf you believe this is an error, please contact a superuser.' });
  }

  const position = portalUser.position;
  if (!position || !POSITIONS[position]) {
    return interaction.editReply({ content: `❌ Your position **${position || 'Unknown'}** is not recognised in the roles system. Please contact a superuser.` });
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
    INSERT INTO verification_queue (discord_id, guild_id, requested_nickname, portal_user_id, position, employee_number, supervisor_name, channel_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(discordId, interaction.guildId, nickname, portalUser.id, position, portalUser.employee_number || 'N/A', portalUser.supervisor_name || 'None', verifyChannel.id);

  const queueId = result.lastInsertRowid;

  // Build approval embed
  const embed = new EmbedBuilder()
    .setTitle(`Verification Request #${queueId}`)
    .setColor(0x8B4513)
    .addFields(
      { name: 'User', value: `<@${discordId}> (${discordId})`, inline: false },
      { name: 'Position Requested', value: position, inline: false },
      { name: 'Nickname Requested', value: nickname, inline: false },
      { name: 'Supervisor', value: portalUser.supervisor_name || 'None', inline: false },
      { name: 'Employee Number', value: portalUser.employee_number || 'N/A', inline: false },
      { name: 'Verification ID', value: `#${queueId}`, inline: false },
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
}

// Button interaction handler — exported so index.js can register it
export async function handleButton(interaction) {
  const customId = interaction.customId;

  // Approve
  if (customId.startsWith('verify_approve_')) {
    const queueId = customId.replace('verify_approve_', '');

    if (!await isSuperuser(interaction.user.id)) {
      return interaction.reply({ content: '❌ Only superusers can approve verifications.', ephemeral: true });
    }

    const entry = db.prepare("SELECT * FROM verification_queue WHERE id = ? AND status = 'pending'").get(queueId);
    if (!entry) return interaction.reply({ content: '❌ Request not found or already processed.', ephemeral: true });

    await interaction.deferUpdate();

    // Apply roles + nickname across all guilds
    await applyVerification(interaction.client, entry.discord_id, entry.position, entry.requested_nickname);

    // Save to verified_members
    db.prepare(`
      INSERT OR REPLACE INTO verified_members (discord_id, portal_user_id, position, employee_number, nickname, verified_at, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(entry.discord_id, entry.portal_user_id, entry.position, entry.employee_number, entry.requested_nickname);

    // Update queue status
    db.prepare("UPDATE verification_queue SET status = 'approved', reviewed_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(interaction.user.id, queueId);

    // Update the embed
    const embed = EmbedBuilder.from(interaction.message.embeds[0])
      .setColor(0x22c55e)
      .setTitle(`✅ Verification Request #${queueId} — Approved`)
      .addFields({ name: 'Approved By', value: `<@${interaction.user.id}>`, inline: false })
      .addFields({ name: 'Note', value: `Verified - Employee: ${entry.employee_number || 'N/A'}`, inline: false });

    await interaction.message.edit({ embeds: [embed], components: [] });

    // DM the user
    try {
      const user = await interaction.client.users.fetch(entry.discord_id);
      await user.send(`✅ Your CO verification has been **approved** by <@${interaction.user.id}>.\n\nYour roles and nickname have been applied across all CO servers.\n**Note:** Verified - Employee: ${entry.employee_number || 'N/A'}`);
    } catch {}
  }

  // Deny — show modal for reason
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
  }
}

// Modal submit handler
export async function handleModal(interaction) {
  if (!interaction.customId.startsWith('verify_deny_reason_')) return;
  const queueId = interaction.customId.replace('verify_deny_reason_', '');
  const reason = interaction.fields.getTextInputValue('reason');

  await interaction.deferUpdate();

  const entry = db.prepare("SELECT * FROM verification_queue WHERE id = ? AND status = 'pending'").get(queueId);
  if (!entry) return;

  db.prepare("UPDATE verification_queue SET status = 'denied', reviewed_by = ?, deny_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(interaction.user.id, reason, queueId);

  const embed = EmbedBuilder.from(interaction.message.embeds[0])
    .setColor(0xef4444)
    .setTitle(`❌ Verification Request #${queueId} — Denied`)
    .addFields({ name: 'Denied By', value: `<@${interaction.user.id}>`, inline: false })
    .addFields({ name: 'Reason', value: reason, inline: false });

  await interaction.message.edit({ embeds: [embed], components: [] });

  try {
    const user = await interaction.client.users.fetch(entry.discord_id);
    await user.send(`❌ Your CO verification request has been **denied**.\n\n**Reason:** ${reason}\n\nIf you believe this is an error, please contact a superuser.`);
  } catch {}
}
