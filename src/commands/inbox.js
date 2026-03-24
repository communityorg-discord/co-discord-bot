import {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
  StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, ComponentType,
} from 'discord.js';
import {
  getAccessibleInboxes, fetchEmailConfig,
  fetchInboxEmails, fetchEmailBody, sendEmail, archiveEmail,
  markdownToDiscord, paginateText,
} from '../services/emailService.js';

const PAGE_SIZE = 8;
const EMAIL_COLS = { from: 0, subject: 1, date: 2, uid: 3, seqno: 4 };

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Re-verify a user can access a given inbox. Call on every interaction. */
async function verifyAccess(inboxId, discordUserId, discordRoleIds = []) {
  const inboxes = await getAccessibleInboxes(discordUserId, discordRoleIds);
  return inboxes.find(ib => ib.inbox_id === inboxId) || null;
}

/** Build the inbox select menu for a user. */
async function buildInboxSelect(userId, roleIds) {
  const inboxes = await getAccessibleInboxes(userId, roleIds);
  if (inboxes.length === 0) return null;

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`inbox_select`)
      .setPlaceholder('Select an inbox...')
      .setOptions(inboxes.map(ib => ({
        label: `${ib.emoji} ${ib.name}`,
        value: ib.inbox_id,
        description: ib.description?.slice(0, 80),
      })))
  );
}

/** Build email list embed for an inbox. */
function buildEmailListEmbed(inbox, result, page) {
  const { emails, total } = result;
  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

  const rows = emails.map((email, i) => {
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

/** Build the email action buttons. */
function buildEmailActionRow(uid, page) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`inbox_read_${uid}`)
      .setLabel('Read')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`inbox_reply_${uid}_${page}`)
      .setLabel('Reply')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`inbox_forward_${uid}_${page}`)
      .setLabel('Forward')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`inbox_copy_${uid}`)
      .setLabel('Copy')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`inbox_archive_${uid}_${page}`)
      .setLabel('Archive')
      .setStyle(ButtonStyle.Danger),
  );
}

/** Build pagination row. */
function buildPaginationRow(inboxId, page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`inbox_prev_${inboxId}_${page}`)
      .setLabel('← Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`inbox_next_${inboxId}_${page}`)
      .setLabel('Next →')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
  );
}

// ─── Slash Command ────────────────────────────────────────────────────────────

export const data = new SlashCommandBuilder()
  .setName('inbox')
  .setDescription('Access team email inboxes');

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const discordUserId = interaction.user.id;
  const discordRoleIds = interaction.member?.roles?.cache?.map(r => r.id) || [];

  // Check if user has any accessible inbox
  const accessibleInboxes = await getAccessibleInboxes(discordUserId, discordRoleIds);

  if (accessibleInboxes.length === 0) {
    return interaction.editReply({
      content: '❌ You do not have access to any email inboxes.',
    });
  }

  // Single inbox — show directly
  if (accessibleInboxes.length === 1) {
    const inbox = accessibleInboxes[0];
    return showInbox(interaction, inbox, discordUserId, discordRoleIds, 0);
  }

  // Multiple inboxes — show select menu
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

// ─── Show Inbox (email list) ──────────────────────────────────────────────────

async function showInbox(interaction, inbox, discordUserId, discordRoleIds, page) {
  // Re-verify access on every call
  const verified = await verifyAccess(inbox.inbox_id, discordUserId, discordRoleIds);
  if (!verified) {
    return interaction.editReply({ content: '❌ Access denied to this inbox.', components: [] });
  }

  try {
    const result = await fetchInboxEmails(inbox, page, PAGE_SIZE);
    const { embed, rows, totalPages } = buildEmailListEmbed(inbox, result, page);

    const actionRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`inbox_email_select_${inbox.inbox_id}_${page}`)
        .setPlaceholder('Go to email...')
        .setOptions(rows.length > 0 ? rows : [{ label: '(no emails)', value: 'none', description: '' }])
        .setDisabled(rows.length === 0)
    );

    const navRow = buildPaginationRow(inbox.inbox_id, page, totalPages);
    const backRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('inbox_back')
        .setLabel('← Change Inbox')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.editReply({
      embeds: [embed],
      components: rows.length > 0 ? [actionRow, navRow, backRow] : [backRow],
    });
  } catch (err) {
    await interaction.editReply({ content: `⚠️ Error loading inbox: \`${err.message}\`` });
  }
}

// ─── Button/Select Interaction Handler ───────────────────────────────────────

export async function handleInboxInteraction(interaction) {
  const { customId } = interaction;
  if (!customId?.startsWith('inbox_')) return;

  const discordUserId = interaction.user.id;
  const discordRoleIds = interaction.member?.roles?.cache?.map(r => r.id) || [];

  // ── Inbox select (from main menu) ──────────────────────────────────────────
  if (customId === 'inbox_select') {
    const inboxId = interaction.values[0];
    const config = await fetchEmailConfig();
    const inbox = config[inboxId];
    if (!inbox) return;

    const verified = await verifyAccess(inboxId, discordUserId, discordRoleIds);
    if (!verified) {
      return interaction.reply({ content: '❌ Access denied.', ephemeral: true });
    }
    await interaction.message.delete();
    return showInbox(interaction, inbox, discordUserId, discordRoleIds, 0);
  }

  // ── Email select (from list) ───────────────────────────────────────────────
  if (customId.startsWith('inbox_email_select_')) {
    const parts = customId.split('_');
    const inboxId = parts[3];
    const page = parseInt(parts[4]);
    const uid = interaction.values[0];
    if (uid === 'none') return;

    const config = await fetchEmailConfig();
    const inbox = config[inboxId];
    if (!inbox) return;

    const verified = await verifyAccess(inboxId, discordUserId, discordRoleIds);
    if (!verified) {
      return interaction.reply({ content: '❌ Access denied.', ephemeral: true });
    }

    await interaction.message.delete();
    return showEmail(interaction, inbox, uid, discordUserId, discordRoleIds, page);
  }

  // ── Back to inbox select ───────────────────────────────────────────────────
  if (customId === 'inbox_back') {
    await interaction.message.delete();
    return execute(interaction);
  }

  // ── Pagination ─────────────────────────────────────────────────────────────
  if (customId.startsWith('inbox_prev_') || customId.startsWith('inbox_next_')) {
    const parts = customId.split('_');
    const action = parts[1]; // prev | next
    const inboxId = parts[2];
    const page = parseInt(parts[3]);
    const newPage = action === 'prev' ? page - 1 : page + 1;

    const config = await fetchEmailConfig();
    const inbox = config[inboxId];
    if (!inbox) return;

    const verified = await verifyAccess(inboxId, discordUserId, discordRoleIds);
    if (!verified) {
      return interaction.reply({ content: '❌ Access denied.', ephemeral: true });
    }

    await interaction.message.delete();
    return showInbox(interaction, inbox, discordUserId, discordRoleIds, newPage);
  }

  // ── Read email ─────────────────────────────────────────────────────────────
  if (customId.startsWith('inbox_read_')) {
    const uid = customId.replace('inbox_read_', '');
    const parts = customId.split('_');
    // inbox_read_<uid> — we stored uid after action
    // We need inbox info — get from message or re-fetch
    // Find inbox_id from email list message
    const content = interaction.message.embeds[0]?.title || '';
    // Can't easily get inbox from here — use ephemeral reply approach
    // Instead, let's get inbox from the message reference
    // Actually, let's store inbox_id in button customId: inbox_read_<inboxId>_<uid>
    return; // Will be handled with proper customId format after rewrite
  }

  // ── Archive email ──────────────────────────────────────────────────────────
  if (customId.startsWith('inbox_archive_')) {
    const parts = customId.split('_');
    const uid = parts[2];
    const page = parseInt(parts[3]);
    const inboxId = parts[4]; // last part

    const config = await fetchEmailConfig();
    const inbox = config[inboxId];
    if (!inbox) return;

    const verified = await verifyAccess(inboxId, discordUserId, discordRoleIds);
    if (!verified) {
      return interaction.reply({ content: '❌ Access denied.', ephemeral: true });
    }

    try {
      await archiveEmail(inbox, uid);
      await interaction.reply({ content: '✅ Email archived.', ephemeral: true });
      // Refresh the inbox
      await interaction.message.delete();
      return showInbox(interaction, inbox, discordUserId, discordRoleIds, page);
    } catch (err) {
      return interaction.reply({ content: `⚠️ Archive failed: \`${err.message}\``, ephemeral: true });
    }
  }

  // ── Reply ─────────────────────────────────────────────────────────────────
  if (customId.startsWith('inbox_reply_')) {
    const parts = customId.split('_');
    const uid = parts[2];
    const page = parseInt(parts[3]);
    const inboxId = parts[4];

    const config = await fetchEmailConfig();
    const inbox = config[inboxId];
    if (!inbox) return;

    const verified = await verifyAccess(inboxId, discordUserId, discordRoleIds);
    if (!verified) {
      return interaction.reply({ content: '❌ Access denied.', ephemeral: true });
    }

    // Fetch email to get original details
    let original = {};
    try {
      original = await fetchEmailBody(inbox, uid);
    } catch { /* ignore */ }

    const modal = new ModalBuilder()
      .setCustomId(`inbox_reply_send_${inboxId}_${uid}_${page}`)
      .setTitle(`Reply to: ${(original.subject || 'Email').slice(0, 40)}`);

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('reply_to')
          .setLabel('To')
          .setStyle(1)
          .setValue(original.from?.address || '')
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('reply_subject')
          .setLabel('Subject')
          .setStyle(1)
          .setValue(original.subject?.startsWith('Re:') ? original.subject : `Re: ${original.subject || ''}`)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('reply_body')
          .setLabel('Message')
          .setStyle(2)
          .setPlaceholder('Write your reply...')
          .setRequired(true)
      ),
    );

    await interaction.showModal(modal);
  }

  // ── Forward ────────────────────────────────────────────────────────────────
  if (customId.startsWith('inbox_forward_')) {
    const parts = customId.split('_');
    const uid = parts[2];
    const page = parseInt(parts[3]);
    const inboxId = parts[4];

    const config = await fetchEmailConfig();
    const inbox = config[inboxId];
    if (!inbox) return;

    const verified = await verifyAccess(inboxId, discordUserId, discordRoleIds);
    if (!verified) {
      return interaction.reply({ content: '❌ Access denied.', ephemeral: true });
    }

    const modal = new ModalBuilder()
      .setCustomId(`inbox_forward_send_${inboxId}_${uid}_${page}`)
      .setTitle('Forward Email');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('forward_to')
          .setLabel('To (email address)')
          .setStyle(1)
          .setPlaceholder('recipient@example.com')
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('forward_subject')
          .setLabel('Subject')
          .setStyle(1)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('forward_body')
          .setLabel('Additional message')
          .setStyle(2)
          .setPlaceholder('Add a note...')
          .setRequired(false)
      ),
    );

    await interaction.showModal(modal);
  }

  // ── Copy content ───────────────────────────────────────────────────────────
  if (customId.startsWith('inbox_copy_')) {
    const uid = customId.replace('inbox_copy_', '');
    // inbox_copy_<inboxId>_<uid>
    const parts = customId.split('_');
    const inboxId = parts[2];
    const emailUid = parts[3];

    const config = await fetchEmailConfig();
    const inbox = config[inboxId];
    if (!inbox) return;

    const verified = await verifyAccess(inboxId, discordUserId, discordRoleIds);
    if (!verified) {
      return interaction.reply({ content: '❌ Access denied.', ephemeral: true });
    }

    try {
      const email = await fetchEmailBody(inbox, emailUid);
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
}

// ─── Show Email Detail ────────────────────────────────────────────────────────

async function showEmail(interaction, inbox, uid, discordUserId, discordRoleIds, page) {
  const verified = await verifyAccess(inbox.inbox_id, discordUserId, discordRoleIds);
  if (!verified) {
    return interaction.editReply({ content: '❌ Access denied.' });
  }

  try {
    const email = await fetchEmailBody(inbox, uid);
    const fromAddr = email.from?.address || 'Unknown';
    const fromName = email.from?.name || fromAddr;
    const dateStr = email.date ? new Date(email.date).toLocaleString() : '';
    const body = email.textAsHtml || markdownToDiscord(email.text);
    const chunks = paginateText(body, 2000);

    const embed = new EmbedBuilder()
      .setTitle(`${email.subject || '(no subject)'}`)
      .setColor(0x1a73e8)
      .addFields(
        { name: 'From', value: fromName, inline: true },
        { name: 'To', value: email.to?.map(t => t.address || t.name || '').join(', ') || inbox.smtp.user, inline: true },
        { name: 'Date', value: dateStr, inline: false },
      )
      .setFooter({ text: `UID: ${uid} | ${inbox.name}` });

    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`inbox_reply_${uid}_${page}_${inbox.inbox_id}`)
        .setLabel('Reply')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`inbox_forward_${uid}_${page}_${inbox.inbox_id}`)
        .setLabel('Forward')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`inbox_copy_${inbox.inbox_id}_${uid}`)
        .setLabel('Copy')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`inbox_archive_${uid}_${page}_${inbox.inbox_id}`)
        .setLabel('Archive')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`inbox_back_email_${inbox.inbox_id}_${page}`)
        .setLabel('← Back')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({
      embeds: [embed],
      content: chunks[0],
      components: [actionRow],
    });

    for (let i = 1; i < chunks.length; i++) {
      await interaction.followUp({ content: chunks[i], ephemeral: true });
    }
  } catch (err) {
    await interaction.editReply({ content: `⚠️ Error loading email: \`${err.message}\`` });
  }
}

// ─── Modal Submit Handler ─────────────────────────────────────────────────────

export async function handleInboxModal(interaction) {
  const { customId } = interaction;
  if (!customId?.startsWith('inbox_reply_send_') && !customId?.startsWith('inbox_forward_send_')) return;

  const parts = customId.split('_');
  const action = parts[2]; // reply | forward
  const inboxId = parts[3];
  const uid = parts[4];
  const page = parseInt(parts[5]);

  const discordUserId = interaction.user.id;
  const discordRoleIds = interaction.member?.roles?.cache?.map(r => r.id) || [];

  const config = await fetchEmailConfig();
  const inbox = config[inboxId];
  if (!inbox) return;

  const verified = await verifyAccess(inboxId, discordUserId, discordRoleIds);
  if (!verified) {
    return interaction.reply({ content: '❌ Access denied.', ephemeral: true });
  }

  if (action === 'reply') {
    const replyTo = interaction.fields.getTextInputValue('reply_to');
    const subject = interaction.fields.getTextInputValue('reply_subject');
    const body = interaction.fields.getTextInputValue('reply_body');

    try {
      // Get original email for in-reply-to headers
      let original = {};
      try { original = await fetchEmailBody(inbox, uid); } catch { /* ok */ }

      await sendEmail(inbox, {
        to: replyTo,
        subject,
        body,
        inReplyTo: original.headers?.['message-id']?.[0],
        references: original.headers?.['references']?.[0],
      });

      await interaction.reply({ content: '✅ Reply sent.', ephemeral: true });
      await interaction.message.delete();
      return showInbox(interaction, inbox, discordUserId, discordRoleIds, page);
    } catch (err) {
      return interaction.reply({ content: `⚠️ Send failed: \`${err.message}\``, ephemeral: true });
    }
  }

  if (action === 'forward') {
    const forwardTo = interaction.fields.getTextInputValue('forward_to');
    const subject = interaction.fields.getTextInputValue('forward_subject');
    const note = interaction.fields.getTextInputValue('forward_body');

    try {
      let original = {};
      try { original = await fetchEmailBody(inbox, uid); } catch { /* ok */ }

      const forwardedBody = [
        note ? `${note}\n\n` : '',
        '--- Forwarded Email ---\n',
        `From: ${original.from?.address || 'Unknown'}\n`,
        `To: ${original.to?.map(t => t.address).join(', ') || ''}\n`,
        `Subject: ${original.subject || ''}\n`,
        `Date: ${original.date ? new Date(original.date).toLocaleString() : ''}\n\n`,
        original.text || '',
      ].join('');

      await sendEmail(inbox, {
        to: forwardTo,
        subject: subject || `Fwd: ${original.subject || ''}`,
        body: forwardedBody,
      });

      await interaction.reply({ content: '✅ Email forwarded.', ephemeral: true });
      await interaction.message.delete();
      return showInbox(interaction, inbox, discordUserId, discordRoleIds, page);
    } catch (err) {
      return interaction.reply({ content: `⚠️ Forward failed: \`${err.message}\``, ephemeral: true });
    }
  }
}
