import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } from 'discord.js';
import { db } from '../utils/botDb.js';
import { execFile } from 'child_process';
import { writeFile, readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import fetch from 'node-fetch';

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

// ── Download Google Doc as PDF via portal API ────────────────────────────────

async function downloadGoogleDocAsPdf(documentId) {
  const res = await fetch(`http://localhost:3016/api/drive/export-pdf/${documentId}`, {
    headers: { 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET }
  });
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ── Get PDF: try Drive export first, pdfkit fallback ─────────────────────────

async function getDirectivePdf(data) {
  // Try 1: Export Google Doc via portal API
  if (data.document_id) {
    try {
      const buffer = await downloadGoogleDocAsPdf(data.document_id);
      if (buffer && buffer.length > 100) {
        console.log(`[Directive PDF] Got PDF from Drive export (${buffer.length} bytes)`);
        return { buffer, filename: `${data.directive_number}.pdf` };
      }
    } catch (e) {
      console.error('[Directive PDF] Drive export failed:', e.message);
    }
  }

  // Try 2: Extract doc ID from URL
  if (data.document_url && !data.document_id) {
    const docId = data.document_url.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1];
    if (docId) {
      try {
        const buffer = await downloadGoogleDocAsPdf(docId);
        if (buffer && buffer.length > 100) {
          console.log(`[Directive PDF] Got PDF from URL-derived ID (${buffer.length} bytes)`);
          return { buffer, filename: `${data.directive_number}.pdf` };
        }
      } catch (e) {
        console.error('[Directive PDF] URL export failed:', e.message);
      }
    }
  }

  // Fallback: generate with pdfkit
  console.warn('[Directive PDF] Falling back to pdfkit generation');
  return generateDirectivePdfFallback(data);
}

async function getMemoPdf(data) {
  // Memos may not have a document_id — use pdfkit directly
  return generateMemoPdfFallback(data);
}

// ── pdfkit fallback generators ───────────────────────────────────────────────

async function generateDirectivePdfFallback(data) {
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
    console.error('[Directive PDF fallback]', e.message);
    return null;
  }
}

async function generateMemoPdfFallback(data) {
  try {
    const PDFDocument = (await import('pdfkit')).default;
    const doc = new PDFDocument({ margin: 60 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));

    return new Promise((resolve) => {
      doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), filename: `${data.memo_number}.pdf` }));

      doc.fontSize(18).font('Helvetica-Bold').text(`IAC Memo — ${data.memo_number}`, { align: 'center' });
      doc.moveDown(0.5);
      const dateStr = new Date(data.created_at).toLocaleDateString('en-GB');
      doc.fontSize(11).font('Helvetica').text(`${dateStr} — ${data.title}`);
      doc.moveDown(0.5);
      doc.moveTo(60, doc.y).lineTo(540, doc.y).stroke();
      doc.moveDown(0.5);
      if (data.description) { doc.font('Helvetica').text(data.description); doc.moveDown(0.5); }
      if (data.action_required) { doc.font('Helvetica-Bold').text('Action Required:'); doc.font('Helvetica').text(data.action_required); doc.moveDown(0.5); }
      doc.moveTo(60, doc.y).lineTo(540, doc.y).stroke();
      doc.moveDown(0.5);
      doc.font('Helvetica').fontSize(10).text(`Issued by: ${data.issued_by}`);
      doc.text(`Urgency: ${data.urgency || 'Medium'}`);
      doc.moveDown(1);
      doc.fontSize(8).fillColor('#666').text('Internal Audit and Compliance Team | Community Organisation', { align: 'center' });
      doc.end();
    });
  } catch (e) {
    console.error('[Memo PDF fallback]', e.message);
    return null;
  }
}

// ── PDF first page to image via pdftoppm ─────────────────────────────────────

async function pdfFirstPageToImage(pdfBuffer, filename) {
  const id = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const pdfPath = join(tmpdir(), `directive-${id}.pdf`);
  const outPrefix = join(tmpdir(), `directive-${id}`);
  const outPath = `${outPrefix}-1.png`;

  try {
    await writeFile(pdfPath, pdfBuffer);

    await new Promise((resolve, reject) => {
      execFile('pdftoppm', ['-png', '-f', '1', '-l', '1', '-r', '150', pdfPath, outPrefix], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const imgBuffer = await readFile(outPath);
    console.log(`[PDF→Image] pdftoppm success (${imgBuffer.length} bytes)`);
    return { buffer: imgBuffer, filename: filename.replace('.pdf', '.png') };
  } catch (e) {
    console.error('[PDF→Image] pdftoppm failed:', e.message);
    return null;
  } finally {
    await unlink(pdfPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}

// ── Post directive embed ─────────────────────────────────────────────────────

export async function postDirectiveEmbed(client, data) {
  const channel = await client.channels.fetch(DIRECTIVES_CHANNEL).catch(() => null);
  if (!channel) return console.error('[Directive] Channel not found:', DIRECTIVES_CHANNEL);

  // If no document_id, wait 10s and retry (doc generation is async)
  if (!data.document_id) {
    console.log('[Directive] No document_id — waiting 10s for doc generation...');
    await new Promise(r => setTimeout(r, 10000));
    try {
      const freshData = await fetch(`http://localhost:3016/api/directives/${data.directive_id}`, {
        headers: { 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET }
      }).then(r => r.ok ? r.json() : null);
      if (freshData?.directive?.document_id) {
        data.document_id = freshData.directive.document_id;
        data.document_url = freshData.directive.document_url;
        console.log('[Directive] Got document_id from retry:', data.document_id);
      }
    } catch (e) {
      console.error('[Directive] Retry fetch failed:', e.message);
    }
  }

  const pdf = await getDirectivePdf(data);
  const image = pdf ? await pdfFirstPageToImage(pdf.buffer, pdf.filename) : null;

  const attachments = [];
  if (pdf) attachments.push(new AttachmentBuilder(pdf.buffer, { name: pdf.filename }));
  if (image) attachments.push(new AttachmentBuilder(image.buffer, { name: image.filename }));

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

  if (image) embed.setThumbnail(`attachment://${image.filename}`);

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

  console.log(`[Directive] Posted ${data.directive_number} to ${DIRECTIVES_CHANNEL} (PDF: ${pdf ? 'yes' : 'no'}, Image: ${image ? 'yes' : 'no'})`);
}

// ── Post memo embed ──────────────────────────────────────────────────────────

export async function postMemoEmbed(client, data) {
  const channel = await client.channels.fetch(DIRECTIVES_CHANNEL).catch(() => null);
  if (!channel) return console.error('[Memo] Channel not found:', DIRECTIVES_CHANNEL);

  const pdf = await getMemoPdf(data);
  const image = pdf ? await pdfFirstPageToImage(pdf.buffer, pdf.filename) : null;

  const attachments = [];
  if (pdf) attachments.push(new AttachmentBuilder(pdf.buffer, { name: pdf.filename }));
  if (image) attachments.push(new AttachmentBuilder(image.buffer, { name: image.filename }));

  let pingContent = '';
  if (data.affected_user_discord_id) pingContent = `<@${data.affected_user_discord_id}>`;

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

  if (data.action_required) embed.addFields({ name: '⚠️ Action Required', value: data.action_required, inline: false });
  if (image) embed.setThumbnail(`attachment://${image.filename}`);

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

  console.log(`[Memo] Posted ${data.memo_number} (PDF: ${pdf ? 'yes' : 'no'}, Image: ${image ? 'yes' : 'no'})`);
}

// ── Revoke directive embed ───────────────────────────────────────────────────

export async function revokeDirectiveEmbed(client, data) {
  const stored = db.prepare('SELECT * FROM directive_messages WHERE directive_id = ?').get(data.directive_id);
  if (!stored) return;

  const channel = await client.channels.fetch(stored.channel_id).catch(() => null);
  if (!channel) return;

  const msg = await channel.messages.fetch(stored.message_id).catch(() => null);
  if (!msg || !msg.embeds[0]) return;

  const updatedEmbed = EmbedBuilder.from(msg.embeds[0]).setColor(0xEF4444);
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

  const updatedEmbed = EmbedBuilder.from(msg.embeds[0]).setColor(0xEF4444);
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

  const oldRoles = POSITIONS[data.old_position] || [];
  const newRoles = POSITIONS[data.new_position] || [];

  for (const guild of client.guilds.cache.values()) {
    try {
      const member = await guild.members.fetch(data.discord_id).catch(() => null);
      if (!member) continue;

      for (const roleName of oldRoles) {
        const role = guild.roles.cache.find(r => r.name === roleName);
        if (role && member.roles.cache.has(role.id)) await member.roles.remove(role).catch(() => {});
      }
      for (const roleName of newRoles) {
        const role = guild.roles.cache.find(r => r.name === roleName);
        if (role && !member.roles.cache.has(role.id)) await member.roles.add(role).catch(() => {});
      }
    } catch (e) {
      console.error(`[Transfer] Role sync failed in ${guild.name}:`, e.message);
    }
  }

  db.prepare("UPDATE verified_members SET position = ?, updated_at = CURRENT_TIMESTAMP WHERE discord_id = ?")
    .run(data.new_position, data.discord_id);

  try {
    const user = await client.users.fetch(data.discord_id);
    await user.send({ embeds: [new EmbedBuilder()
      .setTitle('🔄 Transfer Processed')
      .setColor(0x22C55E)
      .setDescription(`Your transfer to **${data.new_position}** has been processed. Your Discord roles have been updated.`)
      .addFields(
        { name: 'Old Position', value: data.old_position || 'Unknown', inline: true },
        { name: 'New Position', value: data.new_position, inline: true },
      )
      .setFooter({ text: 'Community Organisation | Staff Management' })
      .setTimestamp()
    ]});
  } catch {}

  const { logAction } = await import('../utils/logger.js');
  await logAction(client, {
    action: '🔄 Transfer Role Sync',
    moderator: { discordId: 'SYSTEM', name: 'Transfer System' },
    target: { discordId: data.discord_id, name: data.display_name || data.discord_id },
    reason: `${data.old_position} → ${data.new_position}`,
    color: 0x22C55E,
    logType: 'verification.verify_unverify'
  });

  console.log(`[Transfer] Role sync complete: ${data.old_position} → ${data.new_position}`);
}
