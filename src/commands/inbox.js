import {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
  StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, ComponentType,
} from 'discord.js';
import {
  getAccessibleInboxes, fetchEmailConfig,
  fetchInboxEmails, fetchEmailBody,
  sendReply, sendForward, archiveEmail,
  markdownToDiscord, paginateText,
} from '../services/emailService.js';

const PAGE_SIZE = 8;

async function safeReply(interaction, opts) {
  try {
    if (interaction.deferred) return interaction.editReply(opts);
    return interaction.editReply(opts);
  } catch {
    return interaction.followUp({ ...opts, ephemeral: true });
  }
}

async function verifyAccess(inboxId, discordUserId, discordRoleIds = []) {
  const inboxes = await getAccessibleInboxes(discordUserId, discordRoleIds);
  return inboxes.find(ib => ib.inbox_id === inboxId) || null;
}

async function buildInboxSelect(userId, roleIds) {
  const inboxes = await getAccessibleInboxes(userId, roleIds);
  if (inboxes.length === 0) return null;
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('inbox_select')
      .setPlaceholder('Select an inbox...')
      .setOptions(inboxes.map(ib => ({
        label: `${ib.emoji} ${ib.name}`,
        value: ib.inbox_id,
        description: ib.description?.slice(0, 80),
      })))
  );
}

function buildEmailListEmbed(inbox, result, page) {
  const { emails, total } = result;
  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;
  const rows = emails.map((email) => {
    const from = email.headers.from?.[0] || 'Unknown';
    const subject = email.headers.subject?.[0] || '(no subject)';
    const date = email.headers.date?.[0]
      ? new Date(email.headers.date[0]).toLocaleDateString()
      : '';
    const uid = email.uid;
    return {
      label: subject.slice(0, 60),
      value: String(uid),
      description: `From: ${from.slice(0, 40)} | ${date}`,
    };
  });
  const embed = new EmbedBuilder()
    .setTitle(`${inbox.emoji} ${inbox.name}`)
    .setColor(0x1a73e8)
    .setDescription(inbox.description || 'No description')
    .setFooter({ text: `Page ${page + 1}/${totalPages} • ${total} emails` });
  if (rows.length === 0) {
    embed.addFields({ name: 'No emails', value: 'This inbox is empty.' });
  }
  return { embed, rows, totalPages };
}

function buildEmailActionRow(uid, page, inboxId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`inbox_read|${inboxId}|${uid}`).setLabel('Read').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`inbox_reply|${uid}|${page}|${inboxId}`).setLabel('Reply').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`inbox_forward|${uid}|${page}|${inboxId}`).setLabel('Forward').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`inbox_copy|${inboxId}|${uid}`).setLabel('Copy').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`inbox_archive|${uid}|${page}|${inboxId}`).setLabel('Archive').setStyle(ButtonStyle.Danger),
  );
}

function buildPaginationRow(inboxId, page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`inbox_prev|${inboxId}|${page}`)
      .setLabel('← Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`inbox_next|${inboxId}|${page}`)
      .setLabel('Next →')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
  );
}

export const data = new SlashCommandBuilder()
  .setName('inbox')
  .setDescription('Access team email inboxes');

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const discordUserId = interaction.user.id;
  const discordRoleIds = interaction.member?.roles?.cache?.map(r => r.id) || [];
  const accessibleInboxes = await getAccessibleInboxes(discordUserId, discordRoleIds);
  if (accessibleInboxes.length === 0) {
    return interaction.editReply({ content: '❌ You do not have access to any email inboxes.' });
  }
  if (accessibleInboxes.length === 1) {
    const inbox = accessibleInboxes[0];
    return showInbox(interaction, inbox, discordUserId, discordRoleIds, 0);
  }
  const selectRow = await buildInboxSelect(discordUserId, discordRoleIds);
  const embed = new EmbedBuilder()
    .setTitle('📬 Select an Inbox')
    .setColor(0x1a73e8)
    .setDescription('Choose an inbox to access:')
    .addFields(accessibleInboxes.map(ib => ({
      name: `${ib.emoji} ${ib.name}`,
      value: ib.description || '\u200B',
      inline: false,
    })));
  await interaction.editReply({ embeds: [embed], components: [selectRow] });
}

async function showInbox(interaction, inbox, discordUserId, discordRoleIds, page) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
  }
  const verified = await verifyAccess(inbox.inbox_id, discordUserId, discordRoleIds);
  if (!verified) {
    return safeReply(interaction, { content: '❌ Access denied to this inbox.', components: [] });
  }
  try {
    const result = await fetchInboxEmails(inbox, page, PAGE_SIZE);
    const { embed, rows, totalPages } = buildEmailListEmbed(inbox, result, page);
    const selectRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`inbox_email_select|${inbox.inbox_id}|${page}`)
        .setPlaceholder('Go to email...')
        .setOptions(rows.length > 0 ? rows : [{ label: '(no emails)', value: 'none', description: '' }])
        .setDisabled(rows.length === 0)
    );
    const navRow = buildPaginationRow(inbox.inbox_id, page, totalPages);
    const backRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('inbox_back').setLabel('← Change Inbox').setStyle(ButtonStyle.Secondary),
    );
    await interaction.editReply({
      embeds: [embed],
      components: rows.length > 0 ? [selectRow, navRow, backRow] : [backRow],
    });
  } catch (err) {
    await safeReply(interaction, { content: `⚠️ Error loading inbox: \`${err.message}\`` });
  }
}

async function showEmail(interaction, inbox, uid, discordUserId, discordRoleIds, page) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
  }
  const verified = await verifyAccess(inbox.inbox_id, discordUserId, discordRoleIds);
  if (!verified) {
    return safeReply(interaction, { content: '❌ Access denied.' });
  }
  try {
    const email = await fetchEmailBody(inbox, uid);
    const fromAddr = email.from?.address || 'Unknown';
    const fromName = email.from?.name || fromAddr;
    const dateStr = email.date ? new Date(email.date).toLocaleString() : '';
    const body = email.textAsHtml || markdownToDiscord(email.text);
    const chunks = paginateText(body, 2000);
    const embed = new EmbedBuilder()
      .setTitle(email.subject || '(no subject)')
      .setColor(0x1a73e8)
      .addFields(
        { name: 'From', value: fromName, inline: true },
        { name: 'To', value: email.to?.map(t => t.address || t.name || '').join(', ') || inbox.imap.user, inline: true },
        { name: 'Date', value: dateStr, inline: false },
      )
      .setFooter({ text: `UID: ${uid} | ${inbox.name}` });
    const actionRow = buildEmailActionRow(uid, page, inbox.inbox_id);
    const backButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`inbox_back_email|${inbox.inbox_id}|${page}`)
        .setLabel('← Back')
        .setStyle(ButtonStyle.Secondary),
    );
    await interaction.editReply({
      embeds: [embed],
      content: chunks[0],
      components: [actionRow, backButton],
    });
    for (let i = 1; i < chunks.length; i++) {
      await interaction.followUp({ content: chunks[i], ephemeral: true });
    }
  } catch (err) {
    await safeReply(interaction, { content: `⚠️ Error loading email: \`${err.message}\`` });
  }
}

export async function handleInboxInteraction(interaction) {
  try {
    const { customId } = interaction;
    if (!customId?.startsWith('inbox_')) return;
    const discordUserId = interaction.user.id;
    const discordRoleIds = interaction.member?.roles?.cache?.map(r => r.id) || [];

    if (customId === 'inbox_select') {
      await interaction.deferReply({ ephemeral: true });
      const inboxId = interaction.values[0];
      const config = await fetchEmailConfig();
      const inbox = config[inboxId];
      if (!inbox) return safeReply(interaction, { content: '❌ Inbox not found.' });
      const verified = await verifyAccess(inboxId, discordUserId, discordRoleIds);
      if (!verified) return safeReply(interaction, { content: '❌ Access denied.' });
      return showInbox(interaction, inbox, discordUserId, discordRoleIds, 0);
    }

    if (customId.startsWith('inbox_email_select|')) {
      const parts = customId.split('|');
      const inboxId = parts[1];
      const page = parseInt(parts[2]) || 0;
      const uid = interaction.values[0];
      if (uid === 'none') return interaction.reply({ content: '❌ No email selected.', ephemeral: true });
      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      const config = await fetchEmailConfig();
      const inbox = config[inboxId];
      if (!inbox) return interaction.editReply({ content: '❌ Inbox not found.' });
      const verified = await verifyAccess(inboxId, discordUserId, discordRoleIds);
      if (!verified) return interaction.editReply({ content: '❌ Access denied.' });
      await interaction.message.delete().catch(() => {});
      return showEmail(interaction, inbox, uid, discordUserId, discordRoleIds, page);
    }

    if (customId === 'inbox_back') {
      await interaction.message.delete().catch(() => {});
      return execute(interaction);
    }

    if (customId.startsWith('inbox_prev|') || customId.startsWith('inbox_next|')) {
      const parts = customId.split('|');
      const action = parts[0].replace('inbox_', '');
      const inboxId = parts[1];
      const page = parseInt(parts[2]);
      const newPage = action === 'prev' ? page - 1 : page + 1;
      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      const config = await fetchEmailConfig();
      const inbox = config[inboxId];
      if (!inbox) return interaction.editReply({ content: '❌ Inbox not found.' });
      const verified = await verifyAccess(inboxId, discordUserId, discordRoleIds);
      if (!verified) return interaction.editReply({ content: '❌ Access denied.' });
      await interaction.message.delete().catch(() => {});
      return showInbox(interaction, inbox, discordUserId, discordRoleIds, newPage);
    }

    if (customId.startsWith('inbox_read|')) {
      const parts = customId.split('|');
      const inboxId = parts[1];
      const uid = parts[2];
      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      const config = await fetchEmailConfig();
      const inbox = config[inboxId];
      if (!inbox) return interaction.editReply({ content: '❌ Inbox not found.' });
      const verified = await verifyAccess(inboxId, discordUserId, discordRoleIds);
      if (!verified) return interaction.editReply({ content: '❌ Access denied.' });
      await interaction.message.delete().catch(() => {});
      return showEmail(interaction, inbox, uid, discordUserId, discordRoleIds, 0);
    }

    if (customId.startsWith('inbox_reply|')) {
      const parts = customId.split('|');
      const uid = parts[1];
      const page = parseInt(parts[2]) || 0;
      const inboxId = parts[3];
      const config = await fetchEmailConfig();
      const inbox = config[inboxId];
      if (!inbox) return;
      const verified = await verifyAccess(inboxId, discordUserId, discordRoleIds);
      if (!verified) return interaction.reply({ content: '❌ Access denied.', ephemeral: true });
      let original = {};
      try { original = await fetchEmailBody(inbox, uid); } catch {}
      const modal = new ModalBuilder()
        .setCustomId(`inbox_reply_send|${inboxId}|${uid}|${page}`)
        .setTitle(`Reply to: ${(original.subject || 'Email').slice(0, 40)}`);
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reply_to').setLabel('To').setStyle(1).setValue(original.from?.address || '').setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reply_subject').setLabel('Subject').setStyle(1).setValue(original.subject?.startsWith('Re:') ? original.subject : `Re: ${original.subject || ''}`).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reply_body').setLabel('Message').setStyle(2).setPlaceholder('Write your reply...').setRequired(true)),
      );
      await interaction.showModal(modal);
    }

    if (customId.startsWith('inbox_forward|')) {
      const parts = customId.split('|');
      const uid = parts[1];
      const page = parseInt(parts[2]) || 0;
      const inboxId = parts[3];
      const config = await fetchEmailConfig();
      const inbox = config[inboxId];
      if (!inbox) return;
      const verified = await verifyAccess(inboxId, discordUserId, discordRoleIds);
      if (!verified) return interaction.reply({ content: '❌ Access denied.', ephemeral: true });
      const modal = new ModalBuilder()
        .setCustomId(`inbox_forward_send|${inboxId}|${uid}|${page}`)
        .setTitle('Forward Email');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('forward_to').setLabel('To (email address)').setStyle(1).setPlaceholder('recipient@example.com').setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('forward_subject').setLabel('Subject').setStyle(1).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('forward_body').setLabel('Additional message').setStyle(2).setPlaceholder('Add a note...').setRequired(false)),
      );
      await interaction.showModal(modal);
    }

    if (customId.startsWith('inbox_copy|')) {
      const parts = customId.split('|');
      const inboxId = parts[1];
      const uid = parts[2];
      const config = await fetchEmailConfig();
      const inbox = config[inboxId];
      if (!inbox) return;
      const verified = await verifyAccess(inboxId, discordUserId, discordRoleIds);
      if (!verified) return interaction.reply({ content: '❌ Access denied.', ephemeral: true });
      try {
        const email = await fetchEmailBody(inbox, uid);
        const content = `**From:** ${email.from?.address || 'Unknown'}\n**To:** ${email.to?.map(t => t.address).join(', ') || ''}\n**Subject:** ${email.subject}\n\n${email.text || '(no content)'}`;
        const chunks = paginateText(content, 1900);
        await interaction.reply({ content: `📄 **${email.subject}**\n\n${chunks[0]}`, ephemeral: true });
        for (let i = 1; i < chunks.length; i++) {
          await interaction.followUp({ content: chunks[i], ephemeral: true });
        }
      } catch (err) {
        await interaction.reply({ content: `⚠️ Copy failed: \`${err.message}\``, ephemeral: true });
      }
    }

    if (customId.startsWith('inbox_archive|')) {
      const parts = customId.split('|');
      const uid = parts[1];
      const page = parseInt(parts[2]) || 0;
      const inboxId = parts[3];
      const config = await fetchEmailConfig();
      const inbox = config[inboxId];
      if (!inbox) return;
      const verified = await verifyAccess(inboxId, discordUserId, discordRoleIds);
      if (!verified) return interaction.reply({ content: '❌ Access denied.', ephemeral: true });
      try {
        await archiveEmail(inbox, uid);
        await interaction.reply({ content: '✅ Email archived.', ephemeral: true });
        await interaction.message.delete().catch(() => {});
        return showInbox(interaction, inbox, discordUserId, discordRoleIds, page);
      } catch (err) {
        await interaction.reply({ content: `⚠️ Archive failed: \`${err.message}\``, ephemeral: true });
      }
    }

    if (customId.startsWith('inbox_back_email|')) {
      const parts = customId.split('|');
      const inboxId = parts[1];
      const page = parseInt(parts[2]) || 0;
      const config = await fetchEmailConfig();
      const inbox = config[inboxId];
      if (!inbox) return;
      const verified = await verifyAccess(inboxId, discordUserId, discordRoleIds);
      if (!verified) return interaction.reply({ content: '❌ Access denied.', ephemeral: true });
      await interaction.message.delete().catch(() => {});
      return showInbox(interaction, inbox, discordUserId, discordRoleIds, page);
    }

  } catch (err) {
    console.error('[inbox] handleInboxInteraction error:', err.message);
    const msg = { content: `⚠️ An error occurred: \`${err.message}\``, ephemeral: true };
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(msg).catch(() => {});
      } else {
        await interaction.reply(msg).catch(() => {});
      }
    } catch (_) {}
  }
}

export async function handleInboxModal(interaction) {
  try {
    const { customId } = interaction;
    if (!customId?.startsWith('inbox_')) return;
    const parts = customId.split('|');
    const actionFull = parts[0];
    const inboxId = parts[1];
    const uid = parts[2];
    const page = parseInt(parts[3]) || 0;
    const discordUserId = interaction.user.id;
    const discordRoleIds = interaction.member?.roles?.cache?.map(r => r.id) || [];
    const config = await fetchEmailConfig();
    const inbox = config[inboxId];
    if (!inbox) return;
    const verified = await verifyAccess(inboxId, discordUserId, discordRoleIds);
    if (!verified) return interaction.reply({ content: '❌ Access denied.', ephemeral: true });

    if (actionFull === 'inbox_reply_send') {
      const replyTo = interaction.fields.getTextInputValue('reply_to');
      const subject = interaction.fields.getTextInputValue('reply_subject');
      const body = interaction.fields.getTextInputValue('reply_body');
      try {
        let original = {};
        try { original = await fetchEmailBody(inbox, uid); } catch {}
        await sendReply(inbox, {
          to: replyTo,
          subject,
          body,
          inReplyTo: original.headers?.['message-id']?.[0],
          references: original.headers?.['references']?.[0],
        }, discordUserId);
        await interaction.reply({ content: '✅ Reply sent.', ephemeral: true });
        await interaction.message.delete().catch(() => {});
        return showInbox(interaction, inbox, discordUserId, discordRoleIds, page);
      } catch (err) {
        await interaction.reply({ content: `⚠️ Send failed: \`${err.message}\``, ephemeral: true });
      }
    }

    if (actionFull === 'inbox_forward_send') {
      const forwardTo = interaction.fields.getTextInputValue('forward_to');
      const subject = interaction.fields.getTextInputValue('forward_subject');
      const note = interaction.fields.getTextInputValue('forward_body');
      try {
        let original = {};
        try { original = await fetchEmailBody(inbox, uid); } catch {}
        const forwardedBody = [
          note ? `${note}\n\n` : '',
          '--- Forwarded Email ---\n',
          `From: ${original.from?.address || 'Unknown'}\n`,
          `To: ${original.to?.map(t => t.address).join(', ') || ''}\n`,
          `Subject: ${original.subject || ''}\n`,
          `Date: ${original.date ? new Date(original.date).toLocaleString() : ''}\n\n`,
          original.text || '',
        ].join('');
        await sendForward(inbox, {
          to: forwardTo,
          subject: subject || `Fwd: ${original.subject || ''}`,
          body: forwardedBody,
        }, discordUserId);
        await interaction.reply({ content: '✅ Email forwarded.', ephemeral: true });
        await interaction.message.delete().catch(() => {});
        return showInbox(interaction, inbox, discordUserId, discordRoleIds, page);
      } catch (err) {
        await interaction.reply({ content: `⚠️ Forward failed: \`${err.message}\``, ephemeral: true });
      }
    }
  } catch (err) {
    console.error('[inbox] handleInboxModal error:', err.message);
    await interaction.reply({ content: `⚠️ An error occurred: \`${err.message}\``, ephemeral: true }).catch(() => {});
  }
}
