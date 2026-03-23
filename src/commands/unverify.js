import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { isSuperuser, stripVerification, getOrCreateVerificationChannel } from '../utils/verifyHelper.js';
import db from '../utils/botDb.js';

export const data = new SlashCommandBuilder()
  .setName('unverify')
  .setDescription("Remove a staff member's CO roles and nickname across all servers")
  .addUserOption(opt =>
    opt.setName('user')
      .setDescription('The staff member to unverify')
      .setRequired(true)
  );

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  if (!await isSuperuser(interaction.user.id)) {
    return interaction.editReply({ content: '❌ Only superusers can run /unverify.' });
  }

  const target = interaction.options.getUser('user');
  const verified = db.prepare("SELECT * FROM verified_members WHERE discord_id = ?").get(target.id);

  let verifyChannel;
  try {
    verifyChannel = await getOrCreateVerificationChannel(interaction.client);
  } catch (e) {
    return interaction.editReply({ content: '❌ Could not find the verification channel.' });
  }

  // Insert unverify request into queue
  const result = db.prepare(`
    INSERT INTO verification_queue (discord_id, guild_id, requested_nickname, portal_user_id, position, employee_number, status, channel_id)
    VALUES (?, ?, ?, ?, ?, ?, 'pending_unverify', ?)
  `).run(target.id, interaction.guildId, '', verified?.portal_user_id || 0, verified?.position || 'Unknown', verified?.employee_number || 'N/A', verifyChannel.id);

  const queueId = result.lastInsertRowid;

  const embed = new EmbedBuilder()
    .setTitle(`Unverification Request #${queueId}`)
    .setColor(0x8B1A1A)
    .addFields(
      { name: 'User', value: `<@${target.id}> (${target.id})`, inline: false },
      { name: 'Current Position', value: verified?.position || 'Unknown', inline: false },
      { name: 'Employee Number', value: verified?.employee_number || 'N/A', inline: false },
      { name: 'Requested By', value: `<@${interaction.user.id}>`, inline: false },
      { name: 'Request ID', value: `#${queueId}`, inline: false },
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`unverify_approve_${queueId}`).setLabel('Confirm').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`unverify_deny_${queueId}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
  );

  const msg = await verifyChannel.send({ embeds: [embed], components: [row] });
  db.prepare("UPDATE verification_queue SET message_id = ? WHERE id = ?").run(msg.id, queueId);

  await interaction.editReply({ content: `✅ Unverification request **#${queueId}** submitted for <@${target.id}>.` });
}

export async function handleButton(interaction) {
  const customId = interaction.customId;

  if (customId.startsWith('unverify_approve_')) {
    const queueId = customId.replace('unverify_approve_', '');

    if (!await isSuperuser(interaction.user.id)) {
      return interaction.reply({ content: '❌ Only superusers can approve unverifications.', ephemeral: true });
    }

    const modal = new ModalBuilder()
      .setCustomId(`unverify_approve_reason_${queueId}`)
      .setTitle('Confirm Unverification')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('reason')
            .setLabel('Reason for unverification')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
        )
      );

    await interaction.showModal(modal);
  }

  if (customId.startsWith('unverify_deny_')) {
    const queueId = customId.replace('unverify_deny_', '');

    if (!await isSuperuser(interaction.user.id)) {
      return interaction.reply({ content: '❌ Only superusers can deny this.', ephemeral: true });
    }

    await interaction.deferUpdate();

    db.prepare("UPDATE verification_queue SET status = 'cancelled', reviewed_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(interaction.user.id, queueId);

    const embed = EmbedBuilder.from(interaction.message.embeds[0])
      .setColor(0x6b7280)
      .setTitle(`Unverification Request #${queueId} — Cancelled`);

    await interaction.message.edit({ embeds: [embed], components: [] });
  }
}

export async function handleModal(interaction) {
  if (!interaction.customId.startsWith('unverify_approve_reason_')) return;
  const queueId = interaction.customId.replace('unverify_approve_reason_', '');
  const reason = interaction.fields.getTextInputValue('reason');

  await interaction.deferUpdate();

  const entry = db.prepare("SELECT * FROM verification_queue WHERE id = ?").get(queueId);
  if (!entry) return;

  // Strip roles and nickname
  const targetUser = await interaction.client.users.fetch(entry.discord_id).catch(() => null);
  await stripVerification(interaction.client, entry.discord_id, targetUser?.username);

  // Remove from verified_members
  db.prepare("DELETE FROM verified_members WHERE discord_id = ?").run(entry.discord_id);
  db.prepare("UPDATE verification_queue SET status = 'unverified', reviewed_by = ?, deny_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(interaction.user.id, reason, queueId);

  const embed = EmbedBuilder.from(interaction.message.embeds[0])
    .setColor(0xef4444)
    .setTitle(`✅ Unverification Request #${queueId} — Completed`)
    .addFields({ name: 'Approved By', value: `<@${interaction.user.id}>`, inline: false })
    .addFields({ name: 'Reason', value: reason, inline: false });

  await interaction.message.edit({ embeds: [embed], components: [] });

  try {
    if (targetUser) {
      await targetUser.send(`Your CO verification has been **removed**.\n\n**Reason:** ${reason}\n\nYour roles and nickname have been reset across all CO servers.`);
    }
  } catch {}
}
