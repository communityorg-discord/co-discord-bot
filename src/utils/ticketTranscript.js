import { randomBytes } from 'crypto';
import { E } from '../lib/emoji.js';

// HTML-escape any user/attachment-derived text before interpolating into the
// transcript. The transcript is served same-origin on the staff portal, so an
// attacker-controlled filename, embed body, display name, channel name, etc.
// would otherwise be a stored-XSS sink.
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Escape a URL for use inside an attribute and neutralise dangerous schemes
// (javascript:, data:, vbscript:) so an attacker-supplied href/src can't run script.
function escUrl(value) {
  const raw = String(value ?? '').trim();
  if (/^(?:javascript|data|vbscript):/i.test(raw)) return '#';
  return esc(raw);
}

// Render Discord-flavoured text (mentions + light markdown) to SAFE HTML. Mentions
// are resolved BEFORE escaping; everything else is HTML-escaped, then a small set
// of markdown tokens are turned into tags. Used for message content and embeds.
function renderText(raw, m) {
  let s = String(raw ?? '');
  s = s.replace(/<@!?(\d+)>/g, (_x, id) => { const u = m?.mentions?.users?.get(id) || m?.client?.users?.cache?.get(id); return '@' + (u ? (u.displayName || u.username) : id); });
  s = s.replace(/<#(\d+)>/g, (_x, id) => { const c = m?.mentions?.channels?.get(id) || m?.client?.channels?.cache?.get(id); return '#' + (c ? c.name : id); });
  s = s.replace(/<@&(\d+)>/g, (_x, id) => { const r = m?.mentions?.roles?.get(id) || m?.guild?.roles?.cache?.get(id); return '@' + (r ? r.name : id); });
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // light markdown — order matters (bold before italic)
  s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
       .replace(/(^|[^*])\*([^*\n]+?)\*/g, '$1<em>$2</em>')
       .replace(/__([^_]+?)__/g, '<u>$1</u>')
       .replace(/`([^`]+?)`/g, '<code style="background:#1e1f22;padding:1px 4px;border-radius:3px">$1</code>')
       .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_x, t, u) => `<a href="${escUrl(u)}" style="color:#00aff4;text-decoration:none">${t}</a>`);
  return s.replace(/\n/g, '<br>');
}

// Render one Discord embed as a Discord-like card (coloured left bar, author,
// title, description, fields, image, footer) instead of a "[N embeds]" stub.
function renderEmbedHTML(embed, m) {
  const color = typeof embed.color === 'number' ? '#' + embed.color.toString(16).padStart(6, '0') : '#5865f2';
  let inner = '';
  if (embed.author?.name) inner += `<div style="font-weight:600;color:#fff;font-size:13px;margin-bottom:4px">${esc(embed.author.name)}</div>`;
  if (embed.title) inner += `<div style="font-weight:700;color:#fff;margin-bottom:4px">${embed.url ? `<a href="${escUrl(embed.url)}" style="color:#00aff4;text-decoration:none">${renderText(embed.title, m)}</a>` : renderText(embed.title, m)}</div>`;
  if (embed.description) inner += `<div style="color:#dcddde;margin-bottom:6px">${renderText(embed.description, m)}</div>`;
  if (embed.fields?.length) {
    inner += '<div style="margin-bottom:4px">' + embed.fields.map(f =>
      `<div style="${f.inline ? 'display:inline-block;min-width:140px;margin:0 16px 6px 0;vertical-align:top' : 'margin-bottom:6px'}"><div style="font-weight:700;color:#fff;font-size:13px">${renderText(f.name, m)}</div><div style="color:#dcddde;font-size:13px">${renderText(f.value, m)}</div></div>`
    ).join('') + '</div>';
  }
  if (embed.image?.url) inner += `<img src="${escUrl(embed.image.url)}" style="max-width:400px;border-radius:4px;margin-top:6px;display:block" onerror="this.style.display='none'" />`;
  if (embed.footer?.text) inner += `<div style="color:#888;font-size:11px;margin-top:6px">${esc(embed.footer.text)}</div>`;
  const thumb = embed.thumbnail?.url ? `<img src="${escUrl(embed.thumbnail.url)}" style="width:56px;height:56px;border-radius:4px;margin-left:12px;flex-shrink:0;object-fit:cover" onerror="this.style.display='none'" />` : '';
  return `<div style="display:flex;background:#2b2d31;border-left:4px solid ${color};border-radius:4px;padding:8px 12px;margin-top:6px;max-width:540px"><div style="flex:1;min-width:0">${inner}</div>${thumb}</div>`;
}

export function generateTranscriptHTML(messages, channel, guild, ticketMeta) {
  const rows = messages.map(m => {
    const time = new Date(m.createdTimestamp).toLocaleString('en-GB', { timeZone: 'UTC' });
    const avatar = m.author.displayAvatarURL({ size: 64, extension: 'png' });
    const authorName = m.author.displayName || m.author.username;

    let resolvedContent = m.content || '';
    if (resolvedContent) {
      resolvedContent = resolvedContent.replace(/<@!?(\d+)>/g, (match, id) => {
        const user = m.mentions.users.get(id) || m.mentions.members?.get(id);
        return user ? '@' + (user.displayName || user.username || id) : '@' + id;
      });
      resolvedContent = resolvedContent.replace(/<#(\d+)>/g, (match, id) => {
        const ch = m.mentions.channels?.get(id);
        return ch ? '#' + ch.name : '#' + id;
      });
      resolvedContent = resolvedContent.replace(/<@&(\d+)>/g, (match, id) => {
        const role = m.mentions.roles?.get(id);
        return role ? '@' + role.name : '@' + id;
      });
      resolvedContent = resolvedContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    const hasTextContent = resolvedContent.trim().length > 0;
    let content;
    if (hasTextContent) {
      content = resolvedContent;
    } else if (m.embeds && m.embeds.length > 0) {
      content = ''; // the full embed card(s) render below
    } else if (m.attachments && m.attachments.size > 0) {
      const attachmentNames = [...m.attachments.values()].map(a => a.name || a.filename).join(', ');
      content = `<em style="color:#666">[Attachment(s)] ${esc(attachmentNames)}</em>`;
    } else {
      content = '<em style="color:#666">No text content</em>';
    }

    const attachments = [...m.attachments.values()].map(a =>
      a.contentType?.startsWith('image/')
        ? `<img src="${escUrl(a.url)}" style="max-width:300px;max-height:200px;border-radius:4px;margin-top:4px;display:block" />`
        : `<a href="${escUrl(a.url)}" style="color:#7289da">${esc(a.name)}</a>`
    ).join('');
    const embeds = m.embeds.length > 0
      ? m.embeds.map(e => renderEmbedHTML(e, m)).join('')
      : '';

    return `<div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid #2a2a2a">
 <img src="${escUrl(avatar)}" style="width:36px;height:36px;border-radius:50%;flex-shrink:0" onerror="this.style.display='none'" />
 <div style="flex:1;min-width:0">
 <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
 <span style="font-weight:700;color:#fff">${esc(authorName)}</span>
 <span style="font-size:11px;color:#666">${esc(time)} UTC</span>
 ${m.author.bot ? '<span style="font-size:10px;background:#5865f2;color:#fff;padding:1px 5px;border-radius:3px">BOT</span>' : ''}
 </div>
 ${content ? `<div style="color:#dcddde;margin-top:2px;word-break:break-word">${content}</div>` : ''}
 ${attachments}
 ${embeds}
 </div></div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ticket Transcript — #${esc(channel.name)}</title>
<style>
 * { box-sizing:border-box; margin:0; padding:0; }
 body { background:#1a1a1a; color:#dcddde; font-family:'Segoe UI',sans-serif; font-size:14px; padding:20px; }
 .header { background:#111; border:1px solid #333; border-radius:8px; padding:16px 20px; margin-bottom:20px; }
 .header h1 { color:#fff; font-size:18px; margin-bottom:8px; }
 .meta { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:8px; }
 .meta-item { background:#222; border-radius:6px; padding:8px 12px; }
 .meta-item .label { font-size:11px; color:#888; text-transform:uppercase; letter-spacing:.05em; }
 .meta-item .value { color:#fff; font-weight:600; margin-top:2px; }
 .messages { background:#111; border:1px solid #333; border-radius:8px; padding:0 16px; }
 .count { color:#888; font-size:12px; margin-bottom:12px; padding-top:12px; }
 .portal-badge { display:inline-block; margin-top:12px; padding:6px 12px; background:#5865f2; color:#fff; border-radius:6px; text-decoration:none; font-size:13px; font-weight:600; }
</style>
</head>
<body>
<div class="header">
 <h1>🎫 Ticket Transcript</h1>
 <div class="meta">
 ${['Panel','Ticket #','Opened By','Claimed By','Server','Closed By','Status'].map(field => {
   const key = field.toLowerCase().replace(/ /g,'_');
   const val = ticketMeta[key] || ticketMeta[field.toLowerCase()] || '—';
   return `<div class="meta-item"><div class="label">${esc(field)}</div><div class="value">${esc(val)}</div></div>`;
 }).join('')}
 </div>
</div>
<div class="messages">
 <div class="count">${messages.length} message${messages.length !== 1 ? 's' : ''}</div>
 ${rows}
</div>
</body>
</html>`;
}

export async function closeTicketWithTranscript(ticket, ticketChannel, panel, closerInteraction, closeTicket) {
  const guild = closerInteraction.guild;

  // Generate transcript if transcripts channel configured
  let transcriptUrl = null;
  if (ticketChannel && panel?.transcripts_channel_id) {
    try {
      const allMessages = await ticketChannel.messages.fetch({ limit: 100 }).catch(() => new Map());
      const sortedMessages = [...allMessages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

      if (sortedMessages.length > 0) {
        const transcriptId = randomBytes(8).toString('hex');
        const ticketMeta = {
          panel: panel.name,
          ticket_number: ticket.id,
          opened_by: `<@${ticket.user_id}>`,
          claimed_by: ticket.claimed_by ? `<@${ticket.claimed_by}>` : 'Nobody',
          server: guild.name,
          closed_by: `${closerInteraction.user.username} (${closerInteraction.user.id})`,
          status: 'Closed',
        };
        const html = generateTranscriptHTML(sortedMessages, ticketChannel, guild, ticketMeta);
        transcriptUrl = `https://portal.communityorg.co.uk/transcripts/${transcriptId}`;

        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 10000);
        await fetch('http://localhost:3016/api/transcripts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET },
          body: JSON.stringify({
            id: transcriptId,
            type: 'ticket',
            title: `Ticket — ${panel.name} — ${ticketChannel.name} — ${new Date().toLocaleDateString('en-GB')}`,
            html,
            metadata: { ...ticketMeta, channelId: ticketChannel.id, guildId: guild.id }
          }),
          signal: ac.signal,
        }).finally(() => clearTimeout(timer)).catch(e => console.error('[ticket close] transcript save error:', e.message));

        // Send to transcripts channel
        const transcriptChannel = guild.channels.cache.get(panel.transcripts_channel_id) || await guild.channels.fetch(panel.transcripts_channel_id).catch(() => null);
        if (transcriptChannel) {
          const { EmbedBuilder } = await import('discord.js');
          const transcriptEmbed = new EmbedBuilder()
            .setTitle(`🎫 Ticket Closed — ${panel.name}`)
            .setColor(0x6b7280)
            .addFields(
              { name: 'Ticket Channel', value: `${E.ticket} ${ticketChannel.name || ticket.discord_channel_id}`, inline: true },
              { name: 'Opened By', value: `<@${ticket.user_id}>`, inline: true },
              { name: 'Claimed By', value: ticket.claimed_by ? `<@${ticket.claimed_by}>` : 'Nobody', inline: true },
              { name: 'Closed By', value: `${closerInteraction.user} (<@${closerInteraction.user.id}>)`, inline: true },
              { name: 'Messages', value: String(sortedMessages.length), inline: true },
            )
            .setFooter({ text: 'Community Organisation | Ticket System' })
            .setTimestamp();

          await transcriptChannel.send({ content: transcriptUrl, embeds: [transcriptEmbed] }).catch(e => console.error('[ticket close] failed to send transcript:', e.message));
        }
      }
    } catch (e) {
      console.error('[ticket close] transcript error:', e.message);
    }
  }

  // Update ticket channel UI
  if (ticketChannel) {
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = await import('discord.js');
    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_placeholder').setLabel('🔴 Closed').setStyle(ButtonStyle.Danger).setDisabled(true),
      new ButtonBuilder().setCustomId(`ticket_delete_${ticketChannel.id}`).setLabel('Delete').setStyle(ButtonStyle.Secondary).setEmoji('🗑️'),
    );
    const msgs = await ticketChannel.messages.fetch({ limit: 1 });
    if (msgs.size > 0) {
      const lastMsg = msgs.first();
      if (lastMsg.author.bot && lastMsg.embeds.length > 0) {
        const closedEmbed = EmbedBuilder.from(lastMsg.embeds[0]).setColor(0x6b7280).spliceFields(2, 1, { name: 'Status', value: '🔴 Closed', inline: true });
        await lastMsg.edit({ embeds: [closedEmbed], components: [closeRow] }).catch(() => {});
      }
    }
    await ticketChannel.setName(`closed-${ticketChannel.name}`).catch(() => {});
    await ticketChannel.permissionOverwrites.delete(ticket.user_id).catch(() => {});
    if (ticket.claimed_by) {
      await ticketChannel.permissionOverwrites.delete(ticket.claimed_by).catch(() => {});
    }
  }

  closeTicket(ticket.discord_channel_id);
  return transcriptUrl;
}
