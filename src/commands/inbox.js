import {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
  StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder,
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
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply(opts);
    }
    return await interaction.reply({ ...opts, ephemeral: true });
  } catch (e) {
    try {
      return await interaction.followUp({ ...opts, ephemeral: true });
    } catch (_) {}
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
    const dateRaw = email.headers.date?.[0] ? new Date(email.headers.date[0]) : null;
    const date = dateRaw ? `<t:${Math.floor(dateRaw.getTime() / 1000)}:R>` : '';
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
    return interaction.editReply({ content: '❌ Access denied to this inbox.', components: [] });
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
      new ButtonBuilder().setCustomId(`inbox_compose|${inbox.inbox_id}`).setLabel('✉️ Compose').setStyle(ButtonStyle.Primary),
    );
    await interaction.editReply({
      embeds: [embed],
      components: rows.length > 0 ? [selectRow, navRow, backRow] : [backRow],
    });
  } catch (err) {
    return interaction.editReply({ content: `⚠️ Error loading inbox: \`${err.message}\`` });
  }
}

async function showEmail(interaction, inbox, uid, discordUserId, discordRoleIds, page) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
  }
  const verified = await verifyAccess(inbox.inbox_id, discordUserId, discordRoleIds);
  if (!verified) {
    return interaction.editReply({ content: '❌ Access denied.' });
  }
  try {
    const email = await fetchEmailBody(inbox, uid);
    const fromAddr = email.from?.address || '';
    const subject = email.subject || '';
    const fromName = email.from?.name || fromAddr;
    const dateStr = email.date ? `<t:${Math.floor(new Date(email.date).getTime() / 1000)}:F>` : '';
    const body = email.textAsHtml || markdownToDiscord(email.text);
    const chunks = paginateText(body, 2000);
    const embed = new EmbedBuilder()
      .setTitle(subject || '(no subject)')
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
    return interaction.editReply({ content: `⚠️ Error loading email: \`${err.message}\`` });
  }
}

async function showComposeModal(interaction, inboxId, cc) {
  const safeCc = (cc || '').slice(0, 40).replace(/\|/g, '');
  const modal = new ModalBuilder()
    .setCustomId(`inbox_compose_submit|${inboxId}|${safeCc}`)
    .setTitle('✉️ Compose New Email');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('compose_to')
        .setLabel('To')
        .setStyle(1)
        .setPlaceholder('recipient@example.com')
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('compose_cc')
        .setLabel('CC (comma separated, optional)')
        .setStyle(1)
        .setValue(cc || '')
        .setPlaceholder('cc@example.com, another@example.com')
        .setRequired(false)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('compose_subject')
        .setLabel('Subject')
        .setStyle(1)
        .setPlaceholder('Email subject...')
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('compose_body')
        .setLabel('Message')
        .setStyle(2)
        .setPlaceholder('Write your message...')
        .setRequired(true)
    ),
  );
  await interaction.showModal(modal);
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
      if (!inbox) return interaction.editReply({ content: '❌ Inbox not found.' });
      const verified = await verifyAccess(inboxId, discordUserId, discordRoleIds);
      if (!verified) return interaction.editReply({ content: '❌ Access denied.' });
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
      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      await interaction.message.delete().catch(() => {});
      const accessibleInboxes = await getAccessibleInboxes(discordUserId, discordRoleIds);
      if (accessibleInboxes.length === 0) {
        return interaction.editReply({ content: '❌ You do not have access to any email inboxes.' });
      }
      if (accessibleInboxes.length === 1) {
        return showInbox(interaction, accessibleInboxes[0], discordUserId, discordRoleIds, 0);
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
      return interaction.editReply({ embeds: [embed], components: [selectRow] });
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
      if (!inbox) return interaction.reply({ content: '❌ Inbox not found.', ephemeral: true });

      let original = {};
      try {
        original = await Promise.race([
          fetchEmailBody(inbox, uid),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
        ]);
      } catch { /* use empty pre-fill */ }

      const replySubject = original.subject
        ? (original.subject.startsWith('Re:') ? original.subject : `Re: ${original.subject}`)
        : '';
      const replyTo = original.from?.address || '';

      const modal = new ModalBuilder()
        .setCustomId(`inbox_reply_send|${inboxId}|${uid}|${page}`)
        .setTitle('Reply to Email');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('reply_to').setLabel('To').setStyle(1)
            .setValue(replyTo).setPlaceholder('recipient@example.com').setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('reply_subject').setLabel('Subject').setStyle(1)
            .setValue(replySubject).setPlaceholder('Re: ...').setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('reply_body').setLabel('Message').setStyle(2)
            .setPlaceholder('Write your reply...').setRequired(true)
        ),
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
      if (!inbox) return interaction.reply({ content: '❌ Inbox not found.', ephemeral: true });

      let original = {};
      try {
        original = await Promise.race([
          fetchEmailBody(inbox, uid),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
        ]);
      } catch { /* use empty pre-fill */ }

      const fwdSubject = original.subject
        ? (original.subject.startsWith('Fwd:') ? original.subject : `Fwd: ${original.subject}`)
        : '';

      const modal = new ModalBuilder()
        .setCustomId(`inbox_forward_send|${inboxId}|${uid}|${page}`)
        .setTitle('Forward Email');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('forward_to').setLabel('To (email address)').setStyle(1)
            .setPlaceholder('recipient@example.com').setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('forward_subject').setLabel('Subject').setStyle(1)
            .setValue(fwdSubject).setPlaceholder('Fwd: ...').setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('forward_body').setLabel('Additional message').setStyle(2)
            .setPlaceholder('Add a note...').setRequired(false)
        ),
      );
      await interaction.showModal(modal);
    }

    if (customId.startsWith('inbox_compose|')) {
      const inboxId = customId.split('|')[1];
      const config = await fetchEmailConfig();
      const allInboxes = Object.values(config);

      const ccOptions = allInboxes.map(ib => ({
        label: `${ib.emoji} ${ib.name}`,
        value: ib.imap.user || ib.inbox_id,
        description: ib.description?.slice(0, 50) || '',
      })).filter(opt => opt.value);

      if (ccOptions.length > 0) {
        const ccRow = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`inbox_compose_cc|${inboxId}`)
            .setPlaceholder('CC a team inbox (optional)...')
            .setMinValues(0)
            .setMaxValues(Math.min(ccOptions.length, 5))
            .addOptions(ccOptions.slice(0, 25))
        );
        const skipRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`inbox_compose_send|${inboxId}|`)
            .setLabel('Skip CC — Compose Now')
            .setStyle(ButtonStyle.Secondary),
        );
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        return interaction.editReply({
          content: '**✉️ New Email — Step 1:** Select team inboxes to CC (optional), or skip:',
          components: [ccRow, skipRow],
        });
      } else {
        return showComposeModal(interaction, inboxId, '');
      }
    }

    if (customId.startsWith('inbox_compose_cc|')) {
      const inboxId = customId.split('|')[1];
      const ccAddresses = interaction.values.join(', ');
      return showComposeModal(interaction, inboxId, ccAddresses);
    }

    if (customId.startsWith('inbox_compose_send|')) {
      const parts = customId.split('|');
      const inboxId = parts[1];
      const cc = parts[2] || '';
      return showComposeModal(interaction, inboxId, cc);
    }

    if (customId.startsWith('inbox_copy|')) {
      const parts = customId.split('|');
      const inboxId = parts[1];
      const uid = parts[2];
      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      const config = await fetchEmailConfig();
      const inbox = config[inboxId];
      if (!inbox) return interaction.editReply({ content: '❌ Inbox not found.' });
      const verified = await verifyAccess(inboxId, discordUserId, discordRoleIds);
      if (!verified) return interaction.editReply({ content: '❌ Access denied.' });
      try {
        const email = await fetchEmailBody(inbox, uid);
        const content = `**From:** ${email.from?.address || 'Unknown'}\n**To:** ${email.to?.map(t => t.address).join(', ') || ''}\n**Subject:** ${email.subject}\n\n${email.text || '(no content)'}`;
        const chunks = paginateText(content, 1900);
        await interaction.editReply({ content: `📄 **${email.subject}**\n\n${chunks[0]}` });
        for (let i = 1; i < chunks.length; i++) {
          await interaction.followUp({ content: chunks[i], ephemeral: true });
        }
      } catch (err) {
        await interaction.editReply({ content: `⚠️ Copy failed: \`${err.message}\`` });
      }
    }

    if (customId.startsWith('inbox_archive|')) {
      const parts = customId.split('|');
      const uid = parts[1];
      const page = parseInt(parts[2]) || 0;
      const inboxId = parts[3];
      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      const config = await fetchEmailConfig();
      const inbox = config[inboxId];
      if (!inbox) return interaction.editReply({ content: '❌ Inbox not found.' });
      const verified = await verifyAccess(inboxId, discordUserId, discordRoleIds);
      if (!verified) return interaction.editReply({ content: '❌ Access denied.' });
      try {
        await archiveEmail(inbox, uid);
        await interaction.editReply({ content: '✅ Email archived.' });
        await interaction.message.delete().catch(() => {});
        return showInbox(interaction, inbox, discordUserId, discordRoleIds, page);
      } catch (err) {
        await interaction.editReply({ content: `⚠️ Archive failed: \`${err.message}\`` });
      }
    }

    if (customId.startsWith('inbox_back_email|')) {
      const parts = customId.split('|');
      const inboxId = parts[1];
      const page = parseInt(parts[2]) || 0;
      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      const config = await fetchEmailConfig();
      const inbox = config[inboxId];
      if (!inbox) return interaction.editReply({ content: '❌ Inbox not found.' });
      const verified = await verifyAccess(inboxId, discordUserId, discordRoleIds);
      if (!verified) return interaction.editReply({ content: '❌ Access denied.' });
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

export async function handleNotifButton(interaction) {
  const { customId } = interaction;
  const parts = customId.split('|');
  const action = parts[0];
  const inboxId = parts[1];
  const uid = parseInt(parts[2]);
  const discordUserId = interaction.user.id;
  const discordRoleIds = interaction.member?.roles?.cache?.map(r => r.id) || [];

  const config = await fetchEmailConfig();
  const inbox = config[inboxId];
  if (!inbox) return interaction.reply({ content: '❌ Inbox not found.', ephemeral: true });

  const verified = await verifyAccess(inboxId, discordUserId, discordRoleIds);
  if (!verified) return interaction.reply({ content: '❌ Access denied.', ephemeral: true });

  if (action === 'inbox_notif_view') {
    await interaction.deferReply({ ephemeral: true });
    return showEmail(interaction, inbox, uid, discordUserId, discordRoleIds, 0);
  }

  if (action === 'inbox_notif_reply') {
    let original = {};
    try {
      original = await Promise.race([
        fetchEmailBody(inbox, uid),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
      ]);
    } catch { /* use empty pre-fill */ }

    const replySubject = original.subject
      ? (original.subject.startsWith('Re:') ? original.subject : `Re: ${original.subject}`)
      : '';
    const replyTo = original.from?.address || '';

    const modal = new ModalBuilder()
      .setCustomId(`inbox_notif_reply_send|${inboxId}|${uid}`)
      .setTitle('↩️ Reply to Email');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('reply_to').setLabel('To').setStyle(1)
          .setValue(replyTo).setPlaceholder('recipient@example.com').setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('reply_subject').setLabel('Subject').setStyle(1)
          .setValue(replySubject).setPlaceholder('Re: ...').setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('reply_body').setLabel('Message').setStyle(2)
          .setPlaceholder('Write your reply...').setRequired(true)
      ),
    );
    await interaction.showModal(modal);
  }

  if (action === 'inbox_notif_forward') {
    const modal = new ModalBuilder()
      .setCustomId(`inbox_notif_forward_send|${inboxId}|${uid}`)
      .setTitle('↪️ Forward Email');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('forward_to').setLabel('To').setStyle(1)
          .setPlaceholder('recipient@example.com').setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('forward_subject').setLabel('Subject').setStyle(1)
          .setPlaceholder('Fwd: ...').setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('forward_body').setLabel('Additional message').setStyle(2)
          .setPlaceholder('Add a note...').setRequired(false)
      ),
    );
    await interaction.showModal(modal);
  }
}


export async function handlePersonalEmailButton(interaction) {
  const parts = interaction.customId.split('|');
  const action = parts[0];
  const ownerDiscordId = parts[1];
  const uid = parseInt(parts[2]);

  if (interaction.user.id !== ownerDiscordId) {
    return interaction.reply({ content: '❌ This is not your email.', ephemeral: true });
  }

  const { getPersonalEmailSetup } = await import('../utils/botDb.js');
  const setup = getPersonalEmailSetup(ownerDiscordId);
  if (!setup) return interaction.reply({ content: '❌ Email setup not found.', ephemeral: true });

  const fakeInbox = {
    inbox_id: `personal_${ownerDiscordId}`,
    name: setup.co_email,
    emoji: '📧',
    imap: {
      host: setup.imap_host,
      port: setup.imap_port,
      user: setup.co_email,
      password: setup.imap_password,
      secure: setup.imap_port === 993,
    },
    folders: { inbox: 'INBOX' },
  };

  if (action === 'inbox_personal_reply') {
    let original = {};
    try {
      original = await Promise.race([
        fetchEmailBody(fakeInbox, uid),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
      ]);
    } catch { /* empty prefill */ }

    const replySubject = original.subject
      ? (original.subject.startsWith('Re:') ? original.subject : `Re: ${original.subject}`)
      : '';
    const replyTo = original.from?.address || '';

    const modal = new ModalBuilder()
      .setCustomId(`inbox_personal_reply_send|${ownerDiscordId}|${uid}`)
      .setTitle('↩️ Reply to Email');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('reply_to').setLabel('To').setStyle(1)
          .setValue(replyTo).setPlaceholder('recipient@example.com').setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('reply_subject').setLabel('Subject').setStyle(1)
          .setValue(replySubject).setPlaceholder('Re: ...').setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('reply_body').setLabel('Message').setStyle(2)
          .setPlaceholder('Write your reply...').setRequired(true)
      ),
    );
    await interaction.showModal(modal);
  }

  if (action === 'inbox_personal_forward') {
    const modal = new ModalBuilder()
      .setCustomId(`inbox_personal_forward_send|${ownerDiscordId}|${uid}`)
      .setTitle('↪️ Forward Email');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('forward_to').setLabel('To').setStyle(1)
          .setPlaceholder('recipient@example.com').setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('forward_subject').setLabel('Subject').setStyle(1)
          .setPlaceholder('Fwd: ...').setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('forward_body').setLabel('Additional message').setStyle(2)
          .setPlaceholder('Add a note...').setRequired(false)
      ),
    );
    await interaction.showModal(modal);
  }
}


