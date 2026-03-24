import { randomBytes } from 'crypto';

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
    } else if (m.embeds && m.embeds.size > 0) {
      const firstEmbed = m.embeds[0];
      const desc = firstEmbed.description || firstEmbed.title || '[embed]';
      content = `<em style="color:#666">[Embed] ${desc.slice(0, 120)}</em>`;
    } else if (m.attachments && m.attachments.size > 0) {
      const attachmentNames = [...m.attachments.values()].map(a => a.name || a.filename).join(', ');
      content = `<em style="color:#666">[Attachment(s)] ${attachmentNames}</em>`;
    } else {
      content = '<em style="color:#666">No text content</em>';
    }

    const attachments = [...m.attachments.values()].map(a =>
      a.contentType?.startsWith('image/')
        ? `<img src="${a.url}" style="max-width:300px;max-height:200px;border-radius:4px;margin-top:4px;display:block" />`
        : `<a href="${a.url}" style="color:#7289da">${a.name}</a>`
    ).join('');
    const embeds = m.embeds.size > 0
      ? `<div style="border-left:3px solid #7289da;padding:4px 8px;margin-top:4px;color:#aaa;font-size:12px">[${m.embeds.size} embed(s)]</div>`
      : '';

    return `<div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid #2a2a2a">
 <img src="${avatar}" style="width:36px;height:36px;border-radius:50%;flex-shrink:0" onerror="this.style.display='none'" />
 <div style="flex:1;min-width:0">
 <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
 <span style="font-weight:700;color:#fff">${authorName}</span>
 <span style="font-size:11px;color:#666">${time} UTC</span>
 ${m.author.bot ? '<span style="font-size:10px;background:#5865f2;color:#fff;padding:1px 5px;border-radius:3px">BOT</span>' : ''}
 </div>
 <div style="color:#dcddde;margin-top:2px;word-break:break-word">${content}</div>
 ${attachments}
 ${embeds}
 </div></div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ticket Transcript — #${channel.name}</title>
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
   return `<div class="meta-item"><div class="label">${field}</div><div class="value">${val}</div></div>`;
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

        await fetch('http://localhost:3016/api/transcripts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET },
          body: JSON.stringify({
            id: transcriptId,
            type: 'ticket',
            title: `Ticket — ${panel.name} — ${ticketChannel.name} — ${new Date().toLocaleDateString('en-GB')}`,
            html,
            metadata: { ...ticketMeta, channelId: ticketChannel.id, guildId: guild.id }
          })
        }).catch(e => console.error('[ticket close] transcript save error:', e.message));

        // Send to transcripts channel
        const transcriptChannel = guild.channels.cache.get(panel.transcripts_channel_id) || await guild.channels.fetch(panel.transcripts_channel_id).catch(() => null);
        if (transcriptChannel) {
          const { EmbedBuilder } = await import('discord.js');
          const transcriptEmbed = new EmbedBuilder()
            .setTitle(`🎫 Ticket Closed — ${panel.name}`)
            .setColor(0x6b7280)
            .addFields(
              { name: 'Ticket Channel', value: ticketChannel.name || ticket.discord_channel_id, inline: true },
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
