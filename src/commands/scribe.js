import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canRunCommand } from '../utils/permissions.js';
import { getUserByDiscordId } from '../db.js';
import { randomBytes } from 'crypto';
import { logAction } from '../utils/logger.js';
import { PURGE_SCRIBE_LOG_CHANNEL_ID } from '../config.js';

function generateHTML(messages, channel, guild, requestedBy, limit) {
  const rows = messages.map(m => {
    const time = new Date(m.createdTimestamp).toLocaleString('en-GB', { timeZone: 'UTC' });
    const avatar = m.author.displayAvatarURL({ size: 64, extension: 'png' });
    const authorName = m.author.displayName || m.author.username;

    // Resolve Discord mentions (<@id>, <#id>, <@&id>) to actual names
    let resolvedContent = m.content || '';
    if (resolvedContent) {
      // Replace user mentions
      resolvedContent = resolvedContent.replace(/<@!?(\d+)>/g, (match, id) => {
        const user = m.mentions.users.get(id) || m.mentions.members?.get(id);
        if (user) return '@' + (user.displayName || user.username || id);
        return '@' + id;
      });
      // Replace channel mentions
      resolvedContent = resolvedContent.replace(/<#(\d+)>/g, (match, id) => {
        const ch = m.mentions.channels?.get(id);
        return ch ? '#' + ch.name : '#' + id;
      });
      // Replace role mentions
      resolvedContent = resolvedContent.replace(/<@&(\d+)>/g, (match, id) => {
        const role = m.mentions.roles?.get(id);
        return role ? '@' + role.name : '@' + id;
      });
      resolvedContent = resolvedContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // Show content summary if message has no text but has embeds or attachments
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
    return `
 <div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid #2a2a2a">
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
 </div>
 </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Channel Transcript — #${channel.name}</title>
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
 .scribe-badge { display:inline-block; margin-top:8px; margin-left:8px; padding:6px 12px; background:#22c55e22; border:1px solid #22c55e55; color:#22c55e; border-radius:6px; font-size:13px; font-weight:600; }
</style>
</head>
<body>
<div class="header">
 <h1>📜 Channel Transcript — #${channel.name}</h1>
 <div class="meta">
 <div class="meta-item"><div class="label">Server</div><div class="value">${guild.name}</div></div>
 <div class="meta-item"><div class="label">Channel</div><div class="value">#${channel.name}</div></div>
 <div class="meta-item"><div class="label">Requested By</div><div class="value">${requestedBy}</div></div>
 <div class="meta-item"><div class="label">Messages Captured</div><div class="value">${messages.length}</div></div>
 <div class="meta-item"><div class="label">Limit</div><div class="value">${limit}</div></div>
 <div class="meta-item"><div class="label">Generated</div><div class="value">${new Date().toLocaleString('en-GB', { timeZone: 'UTC' })} UTC</div></div>
 </div>
 <a href="https://portal.communityorg.co.uk" class="portal-badge">CO Staff Portal</a>
 <span class="scribe-badge">📜 Read-Only Transcript</span>
</div>
<div class="messages">
 <div class="count">${messages.length} message(s) — oldest first</div>
 ${rows}
</div>
</body>
</html>`;
}

export const data = new SlashCommandBuilder()
  .setName('scribe')
  .setDescription('Generate an HTML transcript of a channel without deleting any messages')
  .addIntegerOption(opt =>
    opt.setName('limit')
      .setDescription('Number of recent messages to capture (1–500, default 100)')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(500)
  )
  .addChannelOption(opt =>
    opt.setName('channel')
      .setDescription('Channel to transcribe (defaults to current channel)')
      .setRequired(false)
  )
  .addUserOption(opt =>
    opt.setName('user')
      .setDescription('Only capture messages from this user')
      .setRequired(false)
  );

export async function execute(interaction) {
  const perm = canRunCommand(interaction.user.id, 5);
  if (!perm.allowed) return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });

  const limit = interaction.options.getInteger('limit') || 100;
  const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
  const targetUser = interaction.options.getUser('user');
  const moderatorPortalUser = getUserByDiscordId(interaction.user.id);
  const requestedBy = moderatorPortalUser?.display_name || interaction.user.username;

  await interaction.deferReply({ ephemeral: true });

  try {
    // Fetch messages in batches if limit > 100
    let allMessages = [];
    let lastId = null;
    let remaining = limit;

    while (remaining > 0) {
      const batchSize = Math.min(remaining, 100);
      const options = { limit: batchSize };
      if (lastId) options.before = lastId;

      const batch = await targetChannel.messages.fetch(options);
      if (batch.size === 0) break;

      allMessages = [...allMessages, ...batch.values()];
      lastId = batch.last()?.id;
      remaining -= batch.size;
      if (batch.size < batchSize) break;
    }

    if (targetUser) allMessages = allMessages.filter(m => m.author.id === targetUser.id);

    if (allMessages.length === 0) {
      return interaction.editReply({ content: '❌ No messages found.' });
    }

    // Sort oldest first
    allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    // Generate transcript
    const transcriptId = randomBytes(8).toString('hex');
    const html = generateHTML(allMessages, targetChannel, interaction.guild, requestedBy, limit);
    const transcriptUrl = `https://portal.communityorg.co.uk/transcripts/${transcriptId}`;

    // Save to portal
    try {
      const res = await fetch('http://localhost:3016/api/transcripts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-bot-secret': process.env.BOT_WEBHOOK_SECRET
        },
        body: JSON.stringify({
          id: transcriptId,
          type: 'scribe',
          title: `Transcript — #${targetChannel.name} — ${new Date().toLocaleDateString('en-GB')}`,
          html,
          metadata: {
            channel: targetChannel.name,
            channelId: targetChannel.id,
            guild: interaction.guild.name,
            guildId: interaction.guild.id,
            requestedBy,
            requestedById: interaction.user.id,
            messageCount: allMessages.length,
            limit
          }
        })
      });
      const data = await res.json();
      if (!data.ok) console.error('[scribe] Transcript save failed:', data.error);
    } catch (e) {
      console.error('[scribe] Transcript save error:', e.message);
    }

    // Log to purge-scribe-logs + full-mod-logs
    await logAction(interaction.client, {
      action: '📜 Channel Transcribed',
      moderator: { discordId: interaction.user.id, name: requestedBy },
      target: { discordId: targetUser?.id || 'MULTIPLE', name: targetUser ? (getUserByDiscordId(targetUser.id)?.display_name || targetUser.username) : 'All messages' },
      reason: `Channel: #${targetChannel.name}`,
      color: 0x22c55e,
      fields: [
        { name: 'Channel', value: `<#${targetChannel.id}> (${targetChannel.name})`, inline: true },
        { name: 'Server', value: interaction.guild.name, inline: true },
        { name: 'Messages Captured', value: String(allMessages.length), inline: true },
        { name: 'Transcript', value: `[View Transcript](${transcriptUrl})`, inline: false },
        ...(targetUser ? [{ name: 'Filtered User', value: `<@${targetUser.id}>`, inline: true }] : []),
      ],
      specificChannelId: PURGE_SCRIBE_LOG_CHANNEL_ID
    });

    await interaction.editReply({ embeds: [new EmbedBuilder()
      .setTitle('📜 Transcript Generated')
      .setColor(0x22c55e)
      .setDescription(`Captured **${allMessages.length}** message${allMessages.length !== 1 ? 's' : ''} from <#${targetChannel.id}>.`)
      .addFields(
        { name: '📄 Transcript', value: `[View at portal.communityorg.co.uk](${transcriptUrl})`, inline: false },
        { name: '⏳ Expires', value: 'After 1 year', inline: true },
      )
      .setFooter({ text: 'Community Organisation | Staff Assistant' })
      .setTimestamp()
    ]});

  } catch (e) {
    console.error('[/scribe]', e.message);
    await interaction.editReply({ content: `❌ Failed to generate transcript: ${e.message}` });
  }
}
