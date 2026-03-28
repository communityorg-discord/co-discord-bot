import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } from 'discord.js';
import { db } from '../utils/botDb.js';

const DIRECTIVES_CHANNEL = '1487321447461556354';

const PURPOSE_LABELS = {
  implementing_modifying_overriding: 'Implementing, Modifying or Overriding',
  critical_challenges: 'Critical Organisational Challenge',
  temporary_permanent_measures: 'Temporary or Permanent Measures',
  clarifying_reinforcing: 'Clarifying or Reinforcing Policy',
  emergency_decisions: 'Emergency Decision',
  appointments: 'Appointment',
};

const URGENCY_COLORS = { High: 0xEF4444, Medium: 0xF59E0B, Low: 0x3B82F6 };

// ── PDF generation via pdfkit ────────────────────────────────────────────────

async function generateDirectivePdf(data) {
  try {
    const PDFDocument = (await import('pdfkit')).default;
    const doc = new PDFDocument({ margin: 60 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));

    return new Promise((resolve) => {
      doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), filename: `${data.directive_number}.pdf` }));

      doc.fontSize(18).font('Helvetica-Bold')
        .text(`CO | Secretariat Directive No. ${data.directive_number}`, { align: 'center' });
      doc.moveDown(0.5);

      const dateStr = new Date(data.issued_at).toLocaleDateString('en-GB');
      doc.fontSize(11).font('Helvetica').text(`${dateStr} — Subject: ${data.subject}`);
      doc.moveDown(0.5);
      doc.moveTo(60, doc.y).lineTo(540, doc.y).stroke();
      doc.moveDown(0.5);

      doc.font('Helvetica-Bold').text('Purpose:');
      doc.font('Helvetica').text(PURPOSE_LABELS[data.purpose] || data.purpose || 'Not specified');
      doc.moveDown(0.5);

      doc.font('Helvetica-Bold').text('Directive:');
      doc.font('Helvetica').text(data.directive_text || '');
      doc.moveDown(1);
      doc.moveTo(60, doc.y).lineTo(540, doc.y).stroke();
      doc.moveDown(0.5);

      doc.font('Helvetica-Bold').text('Issued by:');
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(10);
      doc.text(`Secretary-General: ${data.issued_by_sg}`);
      doc.text(`Deputy Secretary-General: ${data.issued_by_dsg}`);

      doc.moveDown(1);
      doc.fontSize(8).fillColor('#666')
        .text('This directive is immediately binding on all staff from the time of issue.', { align: 'center' });

      doc.end();
    });
  } catch (e) {
    console.error('[Directive PDF]', e.message);
    return null;
  }
}

async function generateMemoPdf(data) {
  try {
    const PDFDocument = (await import('pdfkit')).default;
    const doc = new PDFDocument({ margin: 60 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));

    return new Promise((resolve) => {
      doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), filename: `${data.memo_number}.pdf` }));

      doc.fontSize(18).font('Helvetica-Bold')
        .text(`IAC Memo — ${data.memo_number}`, { align: 'center' });
      doc.moveDown(0.5);

      const dateStr = new Date(data.created_at).toLocaleDateString('en-GB');
      doc.fontSize(11).font('Helvetica').text(`${dateStr} — ${data.title}`);
      doc.moveDown(0.5);
      doc.moveTo(60, doc.y).lineTo(540, doc.y).stroke();
      doc.moveDown(0.5);

      if (data.description) {
        doc.font('Helvetica').text(data.description);
        doc.moveDown(0.5);
      }

      if (data.action_required) {
        doc.font('Helvetica-Bold').text('Action Required:');
        doc.font('Helvetica').text(data.action_required);
        doc.moveDown(0.5);
      }

      doc.moveTo(60, doc.y).lineTo(540, doc.y).stroke();
      doc.moveDown(0.5);
      doc.font('Helvetica').fontSize(10).text(`Issued by: ${data.issued_by}`);
      doc.text(`Urgency: ${data.urgency || 'Medium'}`);

      doc.moveDown(1);
      doc.fontSize(8).fillColor('#666')
        .text('Internal Audit and Compliance Team | Community Organisation', { align: 'center' });

      doc.end();
    });
  } catch (e) {
    console.error('[Memo PDF]', e.message);
    return null;
  }
}

// ── Post directive embed ─────────────────────────────────────────────────────

export async function postDirectiveEmbed(client, data) {
  const channel = await client.channels.fetch(DIRECTIVES_CHANNEL).catch(() => null);
  if (!channel) return console.error('[Directive] Channel not found:', DIRECTIVES_CHANNEL);

  const pdf = await generateDirectivePdf(data);
  const attachments = [];
  if (pdf) attachments.push(new AttachmentBuilder(pdf.buffer, { name: pdf.filename }));

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`📋 Secretariat Directive — ${data.directive_number}`)
    .setDescription(`**${data.subject}**`)
    .addFields(
      { name: 'Directive', value: (data.directive_text || '').slice(0, 1000), inline: false },
      { name: 'Purpose', value: PURPOSE_LABELS[data.purpose] || data.purpose || 'Not specified', inline: true },
      { name: 'Issued By', value: `${data.issued_by_sg} (SG) & ${data.issued_by_dsg} (DSG)`, inline: true },
      { name: 'Issued At', value: new Date(data.issued_at).toLocaleString('en-GB'), inline: true },
      { name: 'Status', value: '🟢 **ACTIVE**', inline: true },
      { name: 'Dispute Window', value: 'IAC have 2 hours to dispute from time of issue', inline: false },
    )
    .setFooter({ text: `Directive ${data.directive_number} | Immediately binding on all staff` })
    .setTimestamp(new Date(data.issued_at));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`directive_ack_${data.directive_id}`)
      .setLabel('Acknowledge')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅'),
  );

  const msg = await channel.send({
    content: '@everyone',
    embeds: [embed],
    files: attachments,
    components: [row]
  });

  db.prepare('INSERT OR REPLACE INTO directive_messages (directive_id, message_id, channel_id) VALUES (?, ?, ?)')
    .run(data.directive_id, msg.id, DIRECTIVES_CHANNEL);

  console.log(`[Directive] Posted ${data.directive_number} to ${DIRECTIVES_CHANNEL}`);
}

// ── Post memo embed ──────────────────────────────────────────────────────────

export async function postMemoEmbed(client, data) {
  const channel = await client.channels.fetch(DIRECTIVES_CHANNEL).catch(() => null);
  if (!channel) return console.error('[Memo] Channel not found:', DIRECTIVES_CHANNEL);

  const pdf = await generateMemoPdf(data);
  const attachments = [];
  if (pdf) attachments.push(new AttachmentBuilder(pdf.buffer, { name: pdf.filename }));

  let pingContent = '';
  if (data.affected_user_discord_id) {
    pingContent = `<@${data.affected_user_discord_id}>`;
  }

  const embed = new EmbedBuilder()
    .setColor(URGENCY_COLORS[data.urgency] || URGENCY_COLORS.Medium)
    .setTitle(`📄 IAC Memo — ${data.memo_number}`)
    .setDescription(`**${data.title}**`)
    .addFields(
      { name: 'Details', value: (data.description || 'No details provided').slice(0, 1000), inline: false },
      { name: 'Urgency', value: data.urgency || 'Medium', inline: true },
      { name: 'Issued By', value: data.issued_by || 'IAC', inline: true },
      { name: 'Status', value: '🟢 **ACTIVE**', inline: true },
    )
    .setFooter({ text: `Memo ${data.memo_number} | Internal Audit and Compliance Team` })
    .setTimestamp(new Date(data.created_at));

  if (data.action_required) {
    embed.addFields({ name: '⚠️ Action Required', value: data.action_required, inline: false });
  }

  const msg = await channel.send({
    content: pingContent || undefined,
    embeds: [embed],
    files: attachments,
  });

  db.prepare('INSERT OR REPLACE INTO memo_messages (memo_id, message_id, channel_id) VALUES (?, ?, ?)')
    .run(data.memo_id, msg.id, DIRECTIVES_CHANNEL);

  // DM affected person
  if (data.affected_user_discord_id) {
    try {
      const user = await client.users.fetch(data.affected_user_discord_id);
      await user.send({
        embeds: [new EmbedBuilder()
          .setColor(URGENCY_COLORS[data.urgency] || URGENCY_COLORS.Medium)
          .setTitle(`📄 IAC Memo Issued — ${data.memo_number}`)
          .setDescription(`An IAC Memo has been issued that affects you directly.\n\n**${data.title}**\n\n${(data.description || '').slice(0, 500)}`)
          .addFields(data.action_required ? [{ name: '⚠️ Action Required', value: data.action_required }] : [])
          .setFooter({ text: 'Internal Audit and Compliance Team' })
          .setTimestamp()
        ],
        files: pdf ? [new AttachmentBuilder(pdf.buffer, { name: pdf.filename })] : []
      });
    } catch (e) {
      console.error('[Memo DM]', e.message);
    }
  }

  console.log(`[Memo] Posted ${data.memo_number} to ${DIRECTIVES_CHANNEL}`);
}

// ── Revoke directive embed ───────────────────────────────────────────────────

export async function revokeDirectiveEmbed(client, data) {
  const stored = db.prepare('SELECT * FROM directive_messages WHERE directive_id = ?').get(data.directive_id);
  if (!stored) return;

  const channel = await client.channels.fetch(stored.channel_id).catch(() => null);
  if (!channel) return;

  const msg = await channel.messages.fetch(stored.message_id).catch(() => null);
  if (!msg || !msg.embeds[0]) return;

  const updatedEmbed = EmbedBuilder.from(msg.embeds[0])
    .setColor(0xEF4444);

  // Update status field
  const statusIdx = updatedEmbed.data.fields?.findIndex(f => f.name === 'Status');
  if (statusIdx >= 0) {
    updatedEmbed.data.fields[statusIdx] = {
      name: 'Status', value: `🔴 **REVOKED**\nReason: ${data.revocation_reason || 'No reason'}\nRevoked by: ${data.revoked_by || 'Unknown'}`, inline: false
    };
  }

  updatedEmbed.setFooter({ text: `Directive ${data.directive_number} | REVOKED — No longer in effect` });

  await msg.edit({ embeds: [updatedEmbed], components: [] });
  console.log(`[Directive] Revoked ${data.directive_number}`);
}

// ── Revoke memo embed ────────────────────────────────────────────────────────

export async function revokeMemoEmbed(client, data) {
  const stored = db.prepare('SELECT * FROM memo_messages WHERE memo_id = ?').get(data.memo_id);
  if (!stored) return;

  const channel = await client.channels.fetch(stored.channel_id).catch(() => null);
  if (!channel) return;

  const msg = await channel.messages.fetch(stored.message_id).catch(() => null);
  if (!msg || !msg.embeds[0]) return;

  const updatedEmbed = EmbedBuilder.from(msg.embeds[0])
    .setColor(0xEF4444);

  const statusIdx = updatedEmbed.data.fields?.findIndex(f => f.name === 'Status');
  if (statusIdx >= 0) {
    updatedEmbed.data.fields[statusIdx] = {
      name: 'Status', value: `🔴 **CANCELLED**\nReason: ${data.revocation_reason || 'No reason'}`, inline: false
    };
  }

  updatedEmbed.setFooter({ text: `Memo ${data.memo_number} | CANCELLED — No longer in effect` });

  await msg.edit({ embeds: [updatedEmbed], components: [] });
  console.log(`[Memo] Cancelled ${data.memo_number}`);
}

// ── Handle directive acknowledge button ──────────────────────────────────────

export async function handleDirectiveAcknowledge(interaction) {
  const directiveId = parseInt(interaction.customId.replace('directive_ack_', ''));

  try {
    const portalUser = await fetch(`http://localhost:3016/api/staff/by-discord/${interaction.user.id}`, {
      headers: { 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET }
    }).then(r => r.ok ? r.json() : null).catch(() => null);

    if (!portalUser?.id) {
      return interaction.reply({ content: '❌ Could not find your portal account. Please verify first.', ephemeral: true });
    }

    await fetch(`http://localhost:3016/api/directives/${directiveId}/acknowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET },
      body: JSON.stringify({ user_id: portalUser.id })
    });

    await interaction.reply({ content: `✅ You have acknowledged this directive. This has been recorded on the portal.`, ephemeral: true });
  } catch (e) {
    console.error('[Directive Ack]', e.message);
    await interaction.reply({ content: '❌ An error occurred. Please try again.', ephemeral: true });
  }
}

// ── Handle transfer role sync ────────────────────────────────────────────────

export async function handleTransferApproved(client, data) {
  if (!data.discord_id) return console.warn('[Transfer] No discord_id for transferred user');

  const { POSITIONS } = await import('../utils/positions.js');
  const { applyVerification } = await import('../utils/verifyHelper.js');

  const oldRoles = POSITIONS[data.old_position] || [];
  const newRoles = POSITIONS[data.new_position] || [];

  // Strip old position roles + apply new ones across all guilds
  for (const guild of client.guilds.cache.values()) {
    try {
      const member = await guild.members.fetch(data.discord_id).catch(() => null);
      if (!member) continue;

      // Remove old position-specific roles
      for (const roleName of oldRoles) {
        const role = guild.roles.cache.find(r => r.name === roleName);
        if (role && member.roles.cache.has(role.id)) {
          await member.roles.remove(role).catch(() => {});
        }
      }

      // Add new position roles
      for (const roleName of newRoles) {
        const role = guild.roles.cache.find(r => r.name === roleName);
        if (role && !member.roles.cache.has(role.id)) {
          await member.roles.add(role).catch(() => {});
        }
      }
    } catch (e) {
      console.error(`[Transfer] Role sync failed in ${guild.name}:`, e.message);
    }
  }

  // Update verified_members
  const { db: botDb } = await import('../utils/botDb.js');
  botDb.prepare("UPDATE verified_members SET position = ?, updated_at = CURRENT_TIMESTAMP WHERE discord_id = ?")
    .run(data.new_position, data.discord_id);

  // DM the transferred staff member
  try {
    const user = await client.users.fetch(data.discord_id);
    await user.send({ embeds: [new EmbedBuilder()
      .setTitle('🔄 Transfer Processed')
      .setColor(0x22C55E)
      .setDescription(`Your transfer to **${data.new_position}** has been processed. Your Discord roles and nickname have been updated.`)
      .addFields(
        { name: 'Old Position', value: data.old_position || 'Unknown', inline: true },
        { name: 'New Position', value: data.new_position, inline: true },
      )
      .setFooter({ text: 'Community Organisation | Staff Management' })
      .setTimestamp()
    ]});
  } catch {}

  // Log
  const { logAction } = await import('../utils/logger.js');
  await logAction(client, {
    action: '🔄 Transfer Role Sync',
    moderator: { discordId: 'SYSTEM', name: 'Transfer System' },
    target: { discordId: data.discord_id, name: data.display_name || data.discord_id },
    reason: `${data.old_position} → ${data.new_position}`,
    color: 0x22C55E,
    fields: [
      { name: 'Old Position', value: data.old_position || 'Unknown', inline: true },
      { name: 'New Position', value: data.new_position, inline: true },
    ],
    logType: 'verification.verify_unverify'
  });

  console.log(`[Transfer] Role sync complete for ${data.display_name}: ${data.old_position} → ${data.new_position}`);
}
