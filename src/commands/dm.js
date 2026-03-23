import { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ActionRowBuilder } from 'discord.js';
import { canRunCommand, isSuperuser } from '../utils/permissions.js';
import { logAction } from '../utils/logger.js';
import { getUserByDiscordId } from '../db.js';
import Database from 'better-sqlite3';
import { config } from 'dotenv';
config();
const portalDb = new Database(process.env.PORTAL_DB_PATH, { readonly: true });

const TEAMS = {
  'executive_operations_board': 'Executive Operations Board',
  'board_of_directors': 'Board of Directors',
  'extended_board_of_directors': 'Extended Board of Directors',
  'dmspc': 'Department of Management Strategy, Policy and Compliance',
  'dss': 'Department for Safety and Security',
  'dcos': 'Department of Communications and Operational Support',
  'dgacm': 'Department of General Assembly and Conference Management',
  'ic': 'International Court',
};

export const data = new SlashCommandBuilder()
  .setName('dm')
  .setDescription('Send a direct message to a staff member, team or all staff via the bot')
  .addStringOption(opt =>
    opt.setName('message')
      .setDescription('The message to send')
      .setRequired(true)
      .setMaxLength(1900)
  )
  .addUserOption(opt =>
    opt.setName('user')
      .setDescription('A specific staff member to DM')
      .setRequired(false)
  )
  .addBooleanOption(opt =>
    opt.setName('mass')
      .setDescription('Send to ALL active staff (superusers only)')
      .setRequired(false)
  )
  .addStringOption(opt =>
    opt.setName('team')
      .setDescription('Send to a specific team')
      .setRequired(false)
      .addChoices(
        { name: 'Executive Operations Board', value: 'executive_operations_board' },
        { name: 'Board of Directors', value: 'board_of_directors' },
        { name: 'Extended Board of Directors', value: 'extended_board_of_directors' },
        { name: 'DMSPC', value: 'dmspc' },
        { name: 'Department for Safety and Security', value: 'dss' },
        { name: 'DCOS', value: 'dcos' },
        { name: 'DGACM', value: 'dgacm' },
        { name: 'International Court', value: 'ic' },
      )
  )
  .addStringOption(opt =>
    opt.setName('subject')
      .setDescription('Subject line for the DM (optional)')
      .setRequired(false)
      .setMaxLength(100)
  )
  .addBooleanOption(opt =>
    opt.setName('email')
      .setDescription('Require recipient to acknowledge receipt (adds confirmation button)')
      .setRequired(false)
  );

export async function execute(interaction) {
  const perm = canRunCommand(interaction.user.id, 5);
  if (!perm.allowed) return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });

  const target = interaction.options.getUser('user');
  const message = interaction.options.getString('message');
  const mass = interaction.options.getBoolean('mass');
  const team = interaction.options.getString('team');
  const subject = interaction.options.getString('subject') || 'Message from CO Staff Management';
  const emailConfirm = interaction.options.getBoolean('email') || false;
  const senderPortalUser = getUserByDiscordId(interaction.user.id);

  // Validate — must provide at least one target
  if (!target && !mass && !team) {
    return interaction.reply({ content: '❌ You must specify a `user`, set `mass: True`, or choose a `team`.', ephemeral: true });
  }

  // Mass DM requires superuser
  if (mass && !isSuperuser(interaction.user.id)) {
    return interaction.reply({ content: '❌ Mass DM requires superuser access.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const buildEmbed = () => new EmbedBuilder()
    .setTitle(`📩 ${subject}`)
    .setColor(0x5865F2)
    .setDescription(message)
    .addFields({ name: 'From', value: `${senderPortalUser?.display_name || interaction.user.username} — via CO Staff Management`, inline: false })
    .setFooter({ text: 'Community Organisation | Staff Assistant' })
    .setTimestamp();

  // Single user DM
  if (target && !mass && !team) {
    const portalUser = getUserByDiscordId(target.id);
    try {
      const msgPayload = {
        embeds: [buildEmbed()],
        components: emailConfirm ? [new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`dm_ack_${interaction.id}`)
            .setLabel('Acknowledge & Confirm Read')
            .setStyle(2)
        )] : []
      };

      if (emailConfirm) {
        msgPayload.embeds = [new EmbedBuilder()
          .setTitle(`📩 ${subject}`)
          .setColor(0x5865F2)
          .setDescription(`**📧 Please check your email for important information.**\n\n${message}`)
          .addFields({ name: 'From', value: `${senderPortalUser?.display_name || interaction.user.username} — via CO Staff Management`, inline: false })
          .setFooter({ text: 'Community Organisation | Staff Assistant' })
          .setTimestamp()
        ];
      }

      await target.send(msgPayload);

      await logAction(interaction.client, {
        action: '📩 Direct Message Sent',
        moderator: { discordId: interaction.user.id, name: senderPortalUser?.display_name || interaction.user.username },
        target: { discordId: target.id, name: portalUser?.display_name || target.username },
        reason: `Subject: ${subject}${emailConfirm ? ' [Email Confirmation Requested]' : ''}`,
        color: 0x5865F2,
        fields: [
          { name: '📋 Subject', value: subject, inline: false },
          { name: '💬 Message', value: message.length > 200 ? message.slice(0, 200) + '...' : message, inline: false },
          ...(emailConfirm ? [{ name: '📧 Email Confirm', value: 'Recipient must acknowledge', inline: false }] : []),
        ]
      });

      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('✅ Message Sent')
          .setColor(0x22c55e)
          .setDescription(
            `Message delivered to **${portalUser?.display_name || target.username}**.` +
            (emailConfirm ? '\n\n📧 Recipient must click **Acknowledge & Confirm Read** in the DM.' : '')
          )
          .addFields(
            { name: '📋 Subject', value: subject, inline: true },
            { name: '👤 Recipient', value: `<@${target.id}>`, inline: true },
            ...(emailConfirm ? [{ name: '📧 Email Confirm', value: 'Yes', inline: true }] : []),
          )
          .setFooter({ text: 'Community Organisation | Staff Assistant' })
          .setTimestamp()
        ]
      });
    } catch (e) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Failed to Send')
          .setColor(0xef4444)
          .setDescription(`Could not deliver message to **${portalUser?.display_name || target.username}**. They may have DMs disabled.`)
          .setFooter({ text: 'Community Organisation | Staff Assistant' })
          .setTimestamp()
        ]
      });
    }
  }

  // Mass or team DM
  let recipients = [];

  if (mass) {
    recipients = portalDb.prepare(
      `SELECT discord_id, display_name FROM users WHERE account_status = 'Active' AND discord_id IS NOT NULL AND discord_id != ''`
    ).all();
  } else if (team) {
    const teamDept = TEAMS[team];
    recipients = portalDb.prepare(
      `SELECT discord_id, display_name FROM users WHERE account_status = 'Active' AND discord_id IS NOT NULL AND discord_id != '' AND department = ?`
    ).all(teamDept);
  }

  if (recipients.length === 0) {
    return interaction.editReply({ content: `❌ No active staff found for that target.` });
  }

  let sent = 0;
  let failed = 0;
  let failedUsers = [];

  for (const recipient of recipients) {
    try {
      const discordUser = await interaction.client.users.fetch(recipient.discord_id).catch(() => null);
      if (!discordUser) { failed++; failedUsers.push(recipient.display_name || recipient.discord_id); continue; }

      const msgPayload = { embeds: [buildEmbed()] };

      if (emailConfirm) {
        msgPayload.embeds = [new EmbedBuilder()
          .setTitle(`📩 ${subject}`)
          .setColor(0x5865F2)
          .setDescription(`**📧 Please check your email for important information.**\n\n${message}`)
          .addFields({ name: 'From', value: `${senderPortalUser?.display_name || interaction.user.username} — via CO Staff Management`, inline: false })
          .setFooter({ text: 'Community Organisation | Staff Assistant' })
          .setTimestamp()
        ];
        msgPayload.components = [new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`dm_ack_${interaction.id}_${recipient.discord_id}`)
            .setLabel('Acknowledge & Confirm Read')
            .setStyle(2)
        )];
      }

      await discordUser.send(msgPayload);
      sent++;
      await new Promise(r => setTimeout(r, 500));
    } catch {
      failed++;
      failedUsers.push(recipient.display_name || recipient.discord_id);
    }
  }

  await logAction(interaction.client, {
    action: mass ? '📩 Mass DM Sent' : `📩 Team DM Sent — ${TEAMS[team]}`,
    moderator: { discordId: interaction.user.id, name: senderPortalUser?.display_name || interaction.user.username },
    target: { discordId: 'MULTIPLE', name: mass ? 'All Staff' : TEAMS[team] },
    reason: `Subject: ${subject}${emailConfirm ? ' [Email Confirmation Requested]' : ''}`,
    color: 0x5865F2,
    fields: [
      { name: '📋 Subject', value: subject, inline: false },
      { name: '💬 Message', value: message.length > 200 ? message.slice(0, 200) + '...' : message, inline: false },
      { name: '✅ Delivered', value: String(sent), inline: true },
      { name: '❌ Failed', value: String(failed), inline: true },
      { name: '👥 Total', value: String(recipients.length), inline: true },
      ...(emailConfirm ? [{ name: '📧 Email Confirm', value: `${recipients.length} recipients must acknowledge`, inline: false }] : []),
    ]
  });

  await interaction.editReply({ embeds: [new EmbedBuilder()
    .setTitle(mass ? '📩 Mass DM Complete' : `📩 Team DM Complete`)
    .setColor(failed === 0 ? 0x22c55e : 0xf59e0b)
    .setDescription(
      (mass ? `Message sent to all active CO staff.` : `Message sent to **${TEAMS[team]}**.`) +
      (emailConfirm ? `\n\n📧 All recipients must click **Acknowledge & Confirm Read** in their DM.` : '')
    )
    .addFields(
      { name: '✅ Delivered', value: String(sent), inline: true },
      { name: '❌ Failed', value: String(failed), inline: true },
      { name: '👥 Total', value: String(recipients.length), inline: true },
      ...(emailConfirm ? [{ name: '📧 Email Confirm', value: 'Yes — all recipients must acknowledge', inline: true }] : []),
      ...(failedUsers.length > 0 ? [{ name: 'Failed Recipients', value: failedUsers.slice(0, 10).join(', ') + (failedUsers.length > 10 ? ` +${failedUsers.length - 10} more` : ''), inline: false }] : [])
    )
    .setFooter({ text: 'Community Organisation | Staff Assistant' })
    .setTimestamp()
  ]});
}
