import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canRunCommand } from '../utils/permissions.js';
import { getUserByDiscordId } from '../db.js';
import { randomBytes } from 'crypto';
import { logAction } from '../utils/logger.js';
import { PURGE_SCRIBE_LOG_CHANNEL_ID } from '../config.js';

function generateHTML(messages, channel, guild, moderator, reason) {
  const rows = messages.map(m => {
    const time = new Date(m.createdTimestamp).toLocaleString('en-GB', { timeZone: 'UTC' });
    const avatar = m.author.displayAvatarURL({ size: 64, extension: 'png' });
    const content = m.content
      ? m.content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      : '<em style="color:#666">No text content</em>';
    const attachments = [...m.attachments.values()].map(a =>
      a.contentType?.startsWith('image/')
        ? `<img src="${a.url}" style="max-width:300px;max-height:200px;border-radius:4px;margin-top:4px;display:block" />`
        : `<a href="${a.url}" style="color:#7289da">${a.name}</a>`
    ).join('');
    const embeds = m.embeds.length > 0
      ? `<div style="border-left:3px solid #7289da;padding:4px 8px;margin-top:4px;color:#aaa;font-size:12px">[${m.embeds.length} embed(s)]</div>`
      : '';
    return `
 <div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid #2a2a2a">
 <img src="${avatar}" style="width:36px;height:36px;border-radius:50%;flex-shrink:0" onerror="this.style.display='none'" />
 <div style="flex:1;min-width:0">
 <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
 <span style="font-weight:700;color:#fff">${m.author.username}</span>
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
<title>Purge Log — #${channel.name}</title>
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
 <h1>🗑️ Purge Log — #${channel.name}</h1>
 <div class="meta">
 <div class="meta-item"><div class="label">Server</div><div class="value">${guild.name}</div></div>
 <div class="meta-item"><div class="label">Channel</div><div class="value">#${channel.name}</div></div>
 <div class="meta-item"><div class="label">Moderator</div><div class="value">${moderator}</div></div>
 <div class="meta-item"><div class="label">Messages Deleted</div><div class="value">${messages.length}</div></div>
 <div class="meta-item"><div class="label">Reason</div><div class="value">${reason || 'No reason provided'}</div></div>
 <div class="meta-item"><div class="label">Date</div><div class="value">${new Date().toLocaleString('en-GB', { timeZone: 'UTC' })} UTC</div></div>
 </div>
 <a href="https://portal.communityorg.co.uk" class="portal-badge">CO Staff Portal</a>
</div>
<div class="messages">
 <div class="count">${messages.length} message(s) — oldest first</div>
 ${rows}
</div>
</body>
</html>`;
}

export const data = new SlashCommandBuilder()
  .setName('purge')
  .setDescription('Delete messages from a channel with a full HTML transcript log')
  .addIntegerOption(opt =>
    opt.setName('amount')
      .setDescription('Number of messages to delete (1–100)')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(100)
  )
  .addStringOption(opt =>
    opt.setName('reason')
      .setDescription('Reason for purge')
      .setRequired(false)
  )
  .addUserOption(opt =>
    opt.setName('user')
      .setDescription('Only delete messages from this user')
      .setRequired(false)
  )
  .addBooleanOption(opt =>
    opt.setName('bots')
      .setDescription('Only delete bot messages')
      .setRequired(false)
  );

export async function execute(interaction) {
  const perm = await canRunCommand(interaction.user.id, 5);
  if (!perm.allowed) return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });

  const amount = interaction.options.getInteger('amount');
  const reason = interaction.options.getString('reason') || 'No reason provided';
  const targetUser = interaction.options.getUser('user');
  const botsOnly = interaction.options.getBoolean('bots') || false;
  const channel = interaction.channel;
  const moderatorPortalUser = getUserByDiscordId(interaction.user.id);
  const moderatorName = moderatorPortalUser?.display_name || interaction.user.username;

  await interaction.deferReply({ ephemeral: true });

  try {
    let messages = await channel.messages.fetch({ limit: 100 });
    messages = [...messages.values()];

    if (targetUser) messages = messages.filter(m => m.author.id === targetUser.id);
    if (botsOnly) messages = messages.filter(m => m.author.bot);
    messages = messages.slice(0, amount);

    if (messages.length === 0) {
      return interaction.editReply({ content: '❌ No messages found matching your filters.' });
    }

    const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const deletable = messages.filter(m => m.createdTimestamp > twoWeeksAgo);
    const tooOld = messages.length - deletable.length;
    const sortedForLog = [...messages].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    // Generate unique transcript ID and HTML
    const transcriptId = randomBytes(8).toString('hex');
    const html = generateHTML(sortedForLog, channel, interaction.guild, moderatorName, reason);
    const transcriptUrl = `https://portal.communityorg.co.uk/transcripts/${transcriptId}`;

    // Save transcript to portal
    try {
      const res = await fetch('http://localhost:3016/api/transcripts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-bot-secret': process.env.BOT_WEBHOOK_SECRET
        },
        body: JSON.stringify({
          id: transcriptId,
          type: 'purge',
          title: `Purge — #${channel.name} — ${new Date().toLocaleDateString('en-GB')}`,
          html,
          metadata: {
            channel: channel.name,
            channelId: channel.id,
            guild: interaction.guild.name,
            guildId: interaction.guild.id,
            moderator: moderatorName,
            moderatorId: interaction.user.id,
            reason,
            count: messages.length
          }
        })
      });
      const data = await res.json();
      if (!data.ok) console.error('[purge] Transcript save failed:', data.error);
    } catch (e) {
      console.error('[purge] Transcript save error:', e.message);
    }

    // Delete messages
    let deleted = 0;
    if (deletable.length === 1) {
      await deletable[0].delete();
      deleted = 1;
    } else if (deletable.length > 1) {
      const result = await channel.bulkDelete(deletable, true);
      deleted = result.size;
    }

    // Summary in purged channel (auto-delete after 8s)
    const summaryEmbed = new EmbedBuilder()
      .setTitle('🗑️ Channel Purged')
      .setColor(0xef4444)
      .setDescription(`**${deleted}** message${deleted !== 1 ? 's' : ''} deleted from <#${channel.id}>`)
      .addFields(
        { name: '👤 Moderator', value: moderatorName, inline: true },
        { name: '📋 Reason', value: reason, inline: true },
        { name: '📄 Transcript', value: `[View Transcript](${transcriptUrl})`, inline: false },
        ...(targetUser ? [{ name: '🎯 Filtered User', value: `<@${targetUser.id}>`, inline: true }] : []),
        ...(tooOld > 0 ? [{ name: '⚠️ Skipped', value: `${tooOld} older than 14 days`, inline: false }] : [])
      )
      .setFooter({ text: 'Community Organisation | Staff Assistant' })
      .setTimestamp();

    const summaryMsg = await channel.send({ embeds: [summaryEmbed] });
    setTimeout(() => summaryMsg.delete().catch(() => {}), 8000);

    // Log to purge-scribe-logs + full-mod-logs
    await logAction(interaction.client, {
      action: '🗑️ Channel Purged',
      moderator: { discordId: interaction.user.id, name: moderatorName },
      target: { discordId: targetUser?.id || 'UNKNOWN', name: targetUser ? (getUserByDiscordId(targetUser.id)?.display_name || targetUser.username) : 'Multiple Users' },
      reason,
      color: 0xef4444,
      fields: [
        { name: 'Channel', value: `<#${channel.id}> (${channel.name})`, inline: true },
        { name: 'Server', value: interaction.guild.name, inline: true },
        { name: 'Messages Deleted', value: `${deleted}`, inline: true },
        { name: 'Transcript', value: `[View Transcript](${transcriptUrl})`, inline: false },
        ...(targetUser ? [{ name: 'Filtered User', value: `<@${targetUser.id}>`, inline: true }] : []),
        ...(tooOld > 0 ? [{ name: 'Skipped (14d+)', value: String(tooOld), inline: true }] : []),
      ],
      specificChannelId: PURGE_SCRIBE_LOG_CHANNEL_ID,
    guildId: interaction.guildId,
    logType: 'moderation.purge_scribe',
    });

    await interaction.editReply({ embeds: [new EmbedBuilder()
      .setTitle('✅ Purge Complete')
      .setColor(0x22c55e)
      .setDescription(`Deleted **${deleted}** message${deleted !== 1 ? 's' : ''} from <#${channel.id}>.`)
      .addFields(
        { name: '📄 Transcript', value: `[View at portal.communityorg.co.uk](${transcriptUrl})`, inline: false },
        ...(tooOld > 0 ? [{ name: '⚠️ Note', value: `${tooOld} message(s) skipped — older than 14 days.`, inline: false }] : [])
      )
      .setFooter({ text: 'Community Organisation | Staff Assistant' })
      .setTimestamp()
    ]});

  } catch (e) {
    console.error('[/purge]', e.message);
    await interaction.editReply({ content: `❌ Purge failed: ${e.message}` });
  }
}
