// Destruction watcher — alerts on any deletion / purge / role / ban event
// in the network servers. Any of these could be a Hayden-style attack.
//
// Watches:
//   ChannelDelete           — every channel deletion, anywhere
//   GuildRoleDelete         — every role deletion
//   MessageDeleteBulk       — purges (any /purge run)
//   GuildBanAdd             — bans (manual /serverban or otherwise)
//   GuildBanRemove          — unbans (someone restoring a banned account)
//   GuildAuditLogEntryCreate — catches admin-side actions Discord.js
//                              doesn't surface as discrete events
//                              (kicks, bot adds, channel renames, etc.)
//
// All alerts DM Dion + Evan and post to SECURITY_ALERTS_CHANNEL_ID if set.
// Designed to be noisy but not crashing — every handler is wrapped.

import { Events, AuditLogEvent, EmbedBuilder } from 'discord.js';
import { E } from '../lib/emoji.js';

const ALERT_USER_IDS = ['723199054514749450', '415922272956710912'];
const SUPPRESS_ACTORS = new Set([
  '723199054514749450',  // dionm — actions you take won't ping you
  '415922272956710912',  // evans
  '1501640075597975582', // aspire-bot (USGRP | Services) — network-verify role syncs are audited in the verification queue
]);

// Discord renders <t:unix:F> as a localized full date and <t:unix:R> as a relative
// "x minutes ago" — far friendlier than a raw UTC string the reader has to parse.
const ts = () => { const s = Math.floor(Date.now() / 1000); return `<t:${s}:F> · <t:${s}:R>`; };
// A mention resolves to the live username (and is clickable); keep the tag in parens
// for the permanent record in case the account later changes name or leaves.
const execLabel = (u) => u ? `<@${u.id}>${u.tag ? ` (${u.tag})` : ''}` : 'unknown';

// Friendly, human names for the audit-log actions we surface. Raw enum names like
// "MemberKick" read as developer jargon — these read like plain English.
const ACTION_LABEL = {
  [AuditLogEvent.ChannelCreate]:     '➕ Channel created',
  [AuditLogEvent.WebhookCreate]:     '🪝 Webhook created',
  [AuditLogEvent.WebhookDelete]:     '🪝 Webhook deleted',
  [AuditLogEvent.MemberKick]:        '👢 Member kicked',
  [AuditLogEvent.IntegrationCreate]: '🔌 Integration added',
  [AuditLogEvent.IntegrationDelete]: '🔌 Integration removed',
  [AuditLogEvent.GuildUpdate]:       '🏠 Server settings changed',
  [AuditLogEvent.RoleUpdate]:        '🎭 Role updated',
  [AuditLogEvent.MemberRoleUpdate]:  '🎭 Member roles changed',
};

// Render an audit-log target as something a human can read — a @user / @role / #channel
// mention rather than a bare "User 1507290590000189560".
function targetLabel(entry) {
  const id = entry.targetId;
  if (!id) return entry.targetType || 'unknown';
  switch (entry.targetType) {
    case 'User':    return `<@${id}>`;
    case 'Role':    return `<@&${id}>`;
    case 'Channel': return `<#${id}>`;
    default:        return `${entry.targetType || 'item'} \`${id}\``;
  }
}

async function alert(client, body) {
  const embed = new EmbedBuilder()
    .setColor(0xEF4444)
    .setDescription(`${E.warning} **Security alert · admin-only (you + Evan)**\n\n` + body.slice(0, 4000))
    .setFooter({ text: 'Security alert · admin-only · Community Organisation' })
    .setTimestamp();
  for (const uid of ALERT_USER_IDS) {
    try {
      const u = await client.users.fetch(uid).catch(() => null);
      if (!u) continue;
      await u.send({ embeds: [embed] }).catch(() => {});
    } catch {}
  }
  const channelId = process.env.SECURITY_ALERTS_CHANNEL_ID;
  if (channelId) {
    try {
      const ch = await client.channels.fetch(channelId).catch(() => null);
      if (ch) await ch.send({ embeds: [embed] }).catch(() => {});
    } catch {}
  }
}

// Try to find who initiated something via the audit log (Discord.js doesn't
// always surface the executor on the discrete event).
async function executorFromAuditLog(guild, type, targetId) {
  try {
    const fetched = await guild.fetchAuditLogs({ type, limit: 4 });
    const entry = fetched.entries.find(e => e.target?.id === targetId)
               || fetched.entries.first();
    return entry?.executor;
  } catch { return null; }
}

export function setupDestructionWatcher(client) {
  client.on(Events.ChannelDelete, async (channel) => {
    if (!channel.guild) return;
    const exec = await executorFromAuditLog(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
    if (exec && SUPPRESS_ACTORS.has(exec.id)) return;
    await alert(client,
      `${E.cross} **CHANNEL DELETED** — ${channel.guild.name}\n` +
      `Channel: #${channel.name} (${channel.id})\n` +
      `Type: ${channel.type}\n` +
      `By: ${execLabel(exec)}\n` +
      `When: ${ts()}`);
  });

  client.on(Events.GuildRoleDelete, async (role) => {
    const exec = await executorFromAuditLog(role.guild, AuditLogEvent.RoleDelete, role.id);
    if (exec && SUPPRESS_ACTORS.has(exec.id)) return;
    await alert(client,
      `${E.cross} **ROLE DELETED** — ${role.guild.name}\n` +
      `Role: ${role.name} (${role.id}) — ${role.members?.size || '?'} members had it\n` +
      `By: ${execLabel(exec)}\n` +
      `When: ${ts()}`);
  });

  client.on(Events.MessageBulkDelete, async (messages, channel) => {
    if (!channel?.guild) return;
    const exec = await executorFromAuditLog(channel.guild, AuditLogEvent.MessageBulkDelete);
    if (exec && SUPPRESS_ACTORS.has(exec.id)) return;
    await alert(client,
      `${E.cross} **BULK MESSAGE DELETE** — ${channel.guild.name}\n` +
      `#${channel.name} — ${messages?.size || '?'} messages\n` +
      `By: ${execLabel(exec)}\n` +
      `When: ${ts()}`);
  });

  client.on(Events.GuildBanAdd, async (ban) => {
    const exec = await executorFromAuditLog(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
    if (exec && SUPPRESS_ACTORS.has(exec.id)) return;
    await alert(client,
      `${E.ban} **MEMBER BANNED** — ${ban.guild.name}\n` +
      `Target: <@${ban.user.id}> (${ban.user.tag})\n` +
      `Reason: ${ban.reason || '_none given_'}\n` +
      `By: ${execLabel(exec)}\n` +
      `When: ${ts()}`);
  });

  client.on(Events.GuildBanRemove, async (ban) => {
    const exec = await executorFromAuditLog(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);
    if (exec && SUPPRESS_ACTORS.has(exec.id)) return;
    // Unban is HIGH SIGNAL — someone undoing a security action
    await alert(client,
      `${E.warning} **MEMBER UNBANNED** — ${ban.guild.name}\n` +
      `Target: <@${ban.user.id}> (${ban.user.tag})\n` +
      `By: ${execLabel(exec)}\n` +
      `When: ${ts()}\n` +
      `**This undoes a previous ban — investigate.**`);
  });

  // Catch-all via audit log entries — covers events that Discord.js doesn't
  // emit as discrete events (e.g. integrations added, webhooks created,
  // member kicked, role permission changes).
  client.on(Events.GuildAuditLogEntryCreate, async (entry, guild) => {
    if (entry.executor && SUPPRESS_ACTORS.has(entry.executor.id)) return;
    // Only alert on the high-signal subset — channel/role/webhook changes,
    // member kicks, integrations.
    const ALERT_ON = new Set([
      AuditLogEvent.ChannelCreate,
      AuditLogEvent.WebhookCreate,
      AuditLogEvent.WebhookDelete,
      AuditLogEvent.MemberKick,
      AuditLogEvent.IntegrationCreate,
      AuditLogEvent.IntegrationDelete,
      AuditLogEvent.GuildUpdate,
      AuditLogEvent.RoleUpdate,
      AuditLogEvent.MemberRoleUpdate,
    ]);
    if (!ALERT_ON.has(entry.action)) return;
    const label = ACTION_LABEL[entry.action]
      || Object.keys(AuditLogEvent).find(k => AuditLogEvent[k] === entry.action)
      || `Action #${entry.action}`;
    await alert(client,
      `${E.shield} **${label}** — ${guild.name}\n` +
      `Target: ${targetLabel(entry)}\n` +
      `By: ${execLabel(entry.executor)}\n` +
      `Reason: ${entry.reason || '_none given_'}\n` +
      `When: ${ts()}`);
  });

  console.log('[destructionWatcher] active — channel/role deletions, bulk deletes, bans/unbans, high-signal audit log entries');
}
