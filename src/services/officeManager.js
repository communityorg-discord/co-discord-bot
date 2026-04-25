import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import db from '../utils/botDb.js';
import { logAction } from '../utils/logger.js';
import { SUPERUSER_IDS } from '../config.js';

const APPROVE_WINDOW_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10 * 60_000;

// In-memory passes — `${channelId}:${userId}` strings. Granted on approve, cleared after window or on first join.
const PASSES = new Set();
function passKey(channelId, userId) { return `${channelId}:${userId}`; }
export function grantPass(channelId, userId) { PASSES.add(passKey(channelId, userId)); }
export function clearPass(channelId, userId) { PASSES.delete(passKey(channelId, userId)); }
export function hasPass(channelId, userId) { return PASSES.has(passKey(channelId, userId)); }

// ── DB helpers ──────────────────────────────────────────────────────────────

export function getOffice(channelId) {
  return db.prepare('SELECT * FROM managed_offices WHERE channel_id = ?').get(channelId);
}

export function listOffices(guildId) {
  return db.prepare('SELECT * FROM managed_offices WHERE guild_id = ? ORDER BY channel_name').all(guildId);
}

export function upsertOffice(guildId, channelId, channelName) {
  db.prepare(`INSERT INTO managed_offices (channel_id, guild_id, channel_name)
    VALUES (?, ?, ?)
    ON CONFLICT(channel_id) DO UPDATE SET channel_name = excluded.channel_name`).run(channelId, guildId, channelName);
}

export function deleteOffice(channelId) {
  db.prepare('DELETE FROM managed_offices WHERE channel_id = ?').run(channelId);
}

export function getAllowlist(channelId) {
  return db.prepare('SELECT discord_id FROM office_allowlist WHERE channel_id = ?').all(channelId).map(r => r.discord_id);
}

export function setAllowlist(channelId, discordIds, addedBy) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM office_allowlist WHERE channel_id = ?').run(channelId);
    const ins = db.prepare('INSERT OR IGNORE INTO office_allowlist (channel_id, discord_id, added_by) VALUES (?, ?, ?)');
    for (const id of discordIds) ins.run(channelId, id, addedBy);
  });
  tx();
}

export function addAllowed(channelId, discordId, addedBy) {
  db.prepare('INSERT OR IGNORE INTO office_allowlist (channel_id, discord_id, added_by) VALUES (?, ?, ?)').run(channelId, discordId, addedBy);
}

export function removeAllowed(channelId, discordId) {
  db.prepare('DELETE FROM office_allowlist WHERE channel_id = ? AND discord_id = ?').run(channelId, discordId);
}

export function setRequestFeed(guildId, channelId) {
  db.prepare(`INSERT INTO office_request_feed (guild_id, channel_id)
    VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET channel_id = excluded.channel_id`).run(guildId, channelId);
}

export function getRequestFeed(guildId) {
  return db.prepare('SELECT channel_id FROM office_request_feed WHERE guild_id = ?').get(guildId)?.channel_id || null;
}

export function isAllowed(channelId, discordId) {
  if (SUPERUSER_IDS.includes(String(discordId))) return true;
  return !!db.prepare('SELECT 1 FROM office_allowlist WHERE channel_id = ? AND discord_id = ?').get(channelId, discordId);
}

// Waiting rooms
export function getWaitingRoom(channelId) {
  return db.prepare('SELECT * FROM office_waiting_rooms WHERE channel_id = ?').get(channelId);
}
export function listWaitingRooms(guildId) {
  return db.prepare('SELECT * FROM office_waiting_rooms WHERE guild_id = ? ORDER BY channel_name').all(guildId);
}
export function upsertWaitingRoom(guildId, channelId, channelName) {
  db.prepare(`INSERT INTO office_waiting_rooms (channel_id, guild_id, channel_name)
    VALUES (?, ?, ?)
    ON CONFLICT(channel_id) DO UPDATE SET channel_name = excluded.channel_name`).run(channelId, guildId, channelName);
}
export function deleteWaitingRoom(channelId) {
  db.prepare('DELETE FROM office_waiting_rooms WHERE channel_id = ?').run(channelId);
}

function createRequest({ guildId, channelId, requesterId, requesterTag, source, sourceChannelId }) {
  return db.prepare(`INSERT INTO office_requests (guild_id, channel_id, requester_id, requester_tag, source, source_channel_id)
    VALUES (?, ?, ?, ?, ?, ?)`).run(guildId, channelId || null, requesterId, requesterTag, source, sourceChannelId || null).lastInsertRowid;
}

function getRequest(id) {
  return db.prepare('SELECT * FROM office_requests WHERE id = ?').get(id);
}

function getPendingRequest(guildId, requesterId) {
  return db.prepare(`SELECT * FROM office_requests
    WHERE guild_id = ? AND requester_id = ? AND status = 'pending'`).get(guildId, requesterId);
}

function setRequestMessage(id, messageId) {
  db.prepare('UPDATE office_requests SET feed_message_id = ? WHERE id = ?').run(messageId, id);
}

function resolveRequest(id, status, resolverTag, officeChannelId) {
  db.prepare(`UPDATE office_requests SET status = ?, resolved_by = ?, resolved_office_id = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(status, resolverTag || null, officeChannelId || null, id);
}

export function cancelPendingForUser(guildId, requesterId) {
  const reqs = db.prepare(`SELECT id FROM office_requests WHERE guild_id = ? AND requester_id = ? AND status = 'pending'`).all(guildId, requesterId);
  for (const r of reqs) {
    db.prepare(`UPDATE office_requests SET status = 'cancelled', resolved_at = CURRENT_TIMESTAMP WHERE id = ?`).run(r.id);
  }
  return reqs.map(r => r.id);
}

// ── Enforcement: kick non-allowlisted joiners and DM request button ────────

export async function enforceJoin(client, voiceState) {
  const member = voiceState.member;
  const guild = voiceState.guild;
  const channelId = voiceState.channelId;
  if (!member || !guild || !channelId) return;
  if (member.user.bot) return;

  const office = getOffice(channelId);
  if (!office) return;

  if (isAllowed(channelId, member.id)) return;

  // One-shot pass from a recent approval — let them in, consume the pass
  if (hasPass(channelId, member.id)) {
    clearPass(channelId, member.id);
    return;
  }

  await member.voice.disconnect(`[Office] ${member.user.tag} (${member.id}) not on allowlist for #${office.channel_name || channelId}`).catch(() => {});

  await logAction(client, {
    action: '🔒 Office Kick',
    moderator: { discordId: 'SYSTEM', name: 'Office System' },
    target: { discordId: member.id, name: member.user.tag },
    reason: `Not on allowlist for ${office.channel_name || channelId}`,
    color: 0xEF4444, logType: 'moderation.office', guildId: guild.id
  });

  const existing = getPendingRequest(guild.id, member.id);
  if (existing) {
    await member.send({
      embeds: [new EmbedBuilder()
        .setColor(0xF59E0B)
        .setTitle('⏳ Request already pending')
        .setDescription(`You already have a pending request. Please wait for a response.`)
      ]
    }).catch(() => {});
    return;
  }

  const requestBtn = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`office_req_${channelId}`).setLabel('Request access').setStyle(ButtonStyle.Primary).setEmoji('🔓'),
    new ButtonBuilder().setCustomId('office_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
  );

  await member.send({
    embeds: [new EmbedBuilder()
      .setColor(0xEF4444)
      .setTitle('🔒 Restricted Office')
      .setDescription(`**${office.channel_name || 'That voice channel'}** is restricted. You're not on the allowlist.\n\nClick **Request access** to ask the people inside to let you in.`)
      .setFooter({ text: 'Approval grants 60 seconds to join. Leaving requires a new request.' })
    ],
    components: [requestBtn]
  }).catch(() => {});
}

// Waiting room: user joins the lobby VC, request is auto-posted in the feed
export async function handleWaitingRoomJoin(client, voiceState) {
  const member = voiceState.member;
  const guild = voiceState.guild;
  const channelId = voiceState.channelId;
  if (!member || !guild || !channelId || member.user.bot) return;

  const wr = getWaitingRoom(channelId);
  if (!wr) return;

  // Skip if already pending
  const existing = getPendingRequest(guild.id, member.id);
  if (existing) return;

  const allOffices = listOffices(guild.id);
  if (allOffices.length === 0) {
    await member.send({
      embeds: [new EmbedBuilder().setColor(0x6b7280).setTitle('No offices configured')
        .setDescription('There are no managed offices to request access to in this server.')]
    }).catch(() => {});
    return;
  }

  // Only consider offices that currently have at least one non-bot member — empty offices
  // have nobody to approve from anyway.
  const occupiedOffices = allOffices.filter(o => {
    const vc = guild.channels.cache.get(o.channel_id);
    return vc?.members?.some(m => !m.user.bot);
  });

  if (occupiedOffices.length === 0) {
    await member.send({
      embeds: [new EmbedBuilder().setColor(0x6b7280).setTitle('No occupied offices')
        .setDescription('All offices are currently empty — there is no one to approve your request. Please try again later.')]
    }).catch(() => {});
    // Kick them out of the waiting room since there's no point waiting
    await member.voice.disconnect(`[Office] No occupied offices to request from`).catch(() => {});
    return;
  }

  const requestId = createRequest({
    guildId: guild.id, channelId: null, requesterId: member.id,
    requesterTag: member.user.tag || member.user.username,
    source: 'waiting_room', sourceChannelId: channelId
  });

  await postWaitingRoomRequest(client, guild, wr, requestId, member, occupiedOffices);

  await logAction(client, {
    action: '🛎️ Office Waiting-Room Request',
    moderator: { discordId: member.id, name: member.user.tag },
    target: { discordId: channelId, name: wr.channel_name || channelId },
    reason: `Joined waiting room — request posted to feed`,
    color: 0x5865F2, logType: 'moderation.office', guildId: guild.id
  });
}

async function postWaitingRoomRequest(client, guild, wr, requestId, requester, offices) {
  const feedChannelId = getRequestFeed(guild.id);
  if (!feedChannelId) {
    await client.users.fetch(requester.id).then(u => u.send({
      embeds: [new EmbedBuilder().setColor(0xEF4444).setTitle('❌ No request feed configured')
        .setDescription('Tell a superuser to run `/office feed`.')]
    })).catch(() => {});
    return null;
  }
  const feedChannel = guild.channels.cache.get(feedChannelId) || await guild.channels.fetch(feedChannelId).catch(() => null);
  if (!feedChannel) return null;

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🛎️ Waiting Room — Access Request')
    .setDescription(`<@${requester.id}> is in <#${wr.channel_id}> and is requesting access to an office.`)
    .addFields(
      { name: 'Requester', value: `${requester.user?.tag || requester.tag || requester.username} (\`${requester.id}\`)`, inline: false },
      { name: offices.length === 1 ? 'Office' : 'Currently-occupied offices', value: offices.map(o => `<#${o.channel_id}>`).join('\n'), inline: false },
    )
    .setFooter({ text: `Request #${requestId} • Expires in 10 min` })
    .setTimestamp();

  // Build approve buttons — one per office (or single 'Approve' if only one)
  const components = [];
  if (offices.length === 1) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`office_wrapprove_${requestId}_${offices[0].channel_id}`).setLabel('Approve').setStyle(ButtonStyle.Success).setEmoji('✅'),
      new ButtonBuilder().setCustomId(`office_deny_${requestId}`).setLabel('Deny').setStyle(ButtonStyle.Danger).setEmoji('❌'),
    ));
  } else {
    // Up to 5 office buttons per row, max 4 rows of office buttons + 1 deny row
    const officeButtons = offices.slice(0, 20).map(o =>
      new ButtonBuilder()
        .setCustomId(`office_wrapprove_${requestId}_${o.channel_id}`)
        .setLabel(`Bring to ${o.channel_name || o.channel_id}`.slice(0, 80))
        .setStyle(ButtonStyle.Success)
    );
    for (let i = 0; i < officeButtons.length; i += 5) {
      components.push(new ActionRowBuilder().addComponents(officeButtons.slice(i, i + 5)));
    }
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`office_deny_${requestId}`).setLabel('Deny').setStyle(ButtonStyle.Danger).setEmoji('❌'),
    ));
  }

  // Mention everyone allowlisted across the offices so approvers see it
  const allMentions = new Set();
  for (const o of offices) for (const id of getAllowlist(o.channel_id)) allMentions.add(id);
  const mentionList = [...allMentions];

  const msg = await feedChannel.send({
    content: mentionList.length > 0 ? mentionList.map(i => `<@${i}>`).join(' ') : undefined,
    embeds: [embed],
    components,
    allowedMentions: mentionList.length > 0 ? { users: mentionList } : { parse: [] },
  }).catch(e => { console.error('[Office] WR feed post failed:', e.message); return null; });

  if (msg) setRequestMessage(requestId, msg.id);

  setTimeout(async () => {
    const req = getRequest(requestId);
    if (!req || req.status !== 'pending') return;
    resolveRequest(requestId, 'expired', null, null);
    if (msg) {
      const m = await feedChannel.messages.fetch(msg.id).catch(() => null);
      if (m) {
        const expEmbed = EmbedBuilder.from(m.embeds[0] || embed).setColor(0x6b7280).setTitle('⏰ Waiting-Room Request Expired');
        await m.edit({ embeds: [expEmbed], components: [], content: null }).catch(() => {});
      }
    }
    // If they're still in the waiting room, kick them
    const stillThere = guild.channels.cache.get(wr.channel_id)?.members?.get(requester.id);
    if (stillThere) {
      await stillThere.voice.disconnect(`[Office] Waiting-room request for ${requester.user?.tag || requester.id} expired with no response`).catch(() => {});
    }
    const u = await client.users.fetch(requester.id).catch(() => null);
    if (u) {
      await u.send({
        embeds: [new EmbedBuilder().setColor(0x6b7280).setTitle('⏰ Request Expired')
          .setDescription('Your waiting-room request expired with no response.')]
      }).catch(() => {});
    }
  }, REQUEST_TIMEOUT_MS);

  return msg;
}

// Called from voiceStateUpdate when someone leaves a waiting room
export async function handleWaitingRoomLeave(client, voiceState) {
  const member = voiceState.member;
  const guild = voiceState.guild;
  if (!member || !guild) return;
  const cancelled = cancelPendingForUser(guild.id, member.id);
  if (cancelled.length === 0) return;
  // Edit any feed messages to "cancelled"
  const feedChannelId = getRequestFeed(guild.id);
  if (!feedChannelId) return;
  const feedChannel = guild.channels.cache.get(feedChannelId) || await guild.channels.fetch(feedChannelId).catch(() => null);
  if (!feedChannel) return;
  for (const id of cancelled) {
    const r = getRequest(id);
    if (!r?.feed_message_id) continue;
    const m = await feedChannel.messages.fetch(r.feed_message_id).catch(() => null);
    if (m) {
      const cEmbed = EmbedBuilder.from(m.embeds[0]).setColor(0x6b7280).setTitle('🚪 Cancelled (left waiting room)');
      await m.edit({ embeds: [cEmbed], components: [], content: null }).catch(() => {});
    }
  }
}

// ── Request flow ───────────────────────────────────────────────────────────

async function postRequestToFeed(client, guild, office, requestId, requesterUser) {
  const feedChannelId = getRequestFeed(guild.id);
  if (!feedChannelId) return null;
  const feedChannel = guild.channels.cache.get(feedChannelId) || await guild.channels.fetch(feedChannelId).catch(() => null);
  if (!feedChannel) return null;

  const allowlist = getAllowlist(office.channel_id);
  const allowedMentions = allowlist.length > 0 ? allowlist.map(id => `<@${id}>`).join(' ') : '*(no allowlist set)*';

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🔓 Office Access Request')
    .setDescription(`<@${requesterUser.id}> is requesting access to <#${office.channel_id}>.`)
    .addFields(
      { name: 'Requester', value: `${requesterUser.tag || requesterUser.username} (\`${requesterUser.id}\`)`, inline: false },
      { name: 'Office', value: `<#${office.channel_id}>`, inline: true },
      { name: 'Allowlist', value: allowedMentions, inline: false },
    )
    .setFooter({ text: `Request #${requestId} • Expires in 10 min • Anyone in the office (or a superuser) can approve` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`office_approve_${requestId}`).setLabel('Approve').setStyle(ButtonStyle.Success).setEmoji('✅'),
    new ButtonBuilder().setCustomId(`office_deny_${requestId}`).setLabel('Deny').setStyle(ButtonStyle.Danger).setEmoji('❌'),
  );

  const allowedPings = allowlist.length > 0 ? { users: allowlist } : { parse: [] };
  const msg = await feedChannel.send({
    content: allowlist.length > 0 ? allowedMentions : undefined,
    embeds: [embed],
    components: [row],
    allowedMentions: allowedPings,
  }).catch(e => { console.error('[Office] Feed post failed:', e.message); return null; });

  if (msg) setRequestMessage(requestId, msg.id);

  // Auto-expire
  setTimeout(async () => {
    const req = getRequest(requestId);
    if (!req || req.status !== 'pending') return;
    resolveRequest(requestId, 'expired', null);
    try {
      const m = await feedChannel.messages.fetch(msg.id).catch(() => null);
      if (m) {
        const expEmbed = EmbedBuilder.from(m.embeds[0] || embed).setColor(0x6b7280).setTitle('⏰ Request Expired');
        await m.edit({ embeds: [expEmbed], components: [], content: null }).catch(() => {});
      }
    } catch {}
    const u = await client.users.fetch(requesterUser.id).catch(() => null);
    if (u) {
      await u.send({
        embeds: [new EmbedBuilder().setColor(0x6b7280).setTitle('⏰ Request Expired')
          .setDescription(`Your request to join **${office.channel_name}** expired with no response.`)]
      }).catch(() => {});
    }
  }, REQUEST_TIMEOUT_MS);

  return msg;
}

// ── Interaction handlers ───────────────────────────────────────────────────

export async function handleButton(interaction, client) {
  const id = interaction.customId;

  if (id === 'office_cancel') {
    return interaction.update({ content: 'Cancelled.', embeds: [], components: [] }).catch(() => {});
  }

  if (id.startsWith('office_req_')) {
    const channelId = id.slice('office_req_'.length);
    const office = getOffice(channelId);
    if (!office) {
      return interaction.update({
        embeds: [new EmbedBuilder().setColor(0xEF4444).setTitle('❌ Office not configured').setDescription('That channel is no longer managed.')],
        components: []
      }).catch(() => {});
    }

    const guild = client.guilds.cache.get(office.guild_id);
    if (!guild) return interaction.reply({ content: '❌ Guild unavailable.', ephemeral: true });

    const feedChannelId = getRequestFeed(guild.id);
    if (!feedChannelId) {
      return interaction.update({
        embeds: [new EmbedBuilder().setColor(0xEF4444).setTitle('❌ No request feed configured').setDescription('Tell a superuser to run `/office feed`.')],
        components: []
      }).catch(() => {});
    }

    const existing = getPendingRequest(guild.id, interaction.user.id);
    if (existing) {
      return interaction.update({
        embeds: [new EmbedBuilder().setColor(0xF59E0B).setTitle('⏳ Already pending')
          .setDescription(`You already have a pending request.`)],
        components: []
      }).catch(() => {});
    }

    const requestId = createRequest({
      guildId: guild.id, channelId, requesterId: interaction.user.id,
      requesterTag: interaction.user.tag || interaction.user.username,
      source: 'kicked', sourceChannelId: null
    });
    await interaction.update({
      embeds: [new EmbedBuilder().setColor(0x22C55E).setTitle('✅ Request sent')
        .setDescription(`Your request to join **${office.channel_name}** has been posted. You'll be DMd when someone responds.`)
        .setFooter({ text: 'Expires in 10 minutes if no response.' })],
      components: []
    }).catch(() => {});

    await postRequestToFeed(client, guild, office, requestId, interaction.user);

    await logAction(client, {
      action: '🔓 Office Request Created',
      moderator: { discordId: interaction.user.id, name: interaction.user.tag },
      target: { discordId: channelId, name: office.channel_name },
      reason: `Access requested for ${office.channel_name}`,
      color: 0x5865F2, logType: 'moderation.office', guildId: guild.id
    });
    return;
  }

  // Deny — works for both kicked + waiting-room flows
  if (id.startsWith('office_deny_')) {
    const requestId = parseInt(id.replace('office_deny_', ''));
    return resolveDeny(interaction, client, requestId);
  }

  // Approve (kicked flow — request was tied to a single office)
  if (id.startsWith('office_approve_')) {
    const requestId = parseInt(id.replace('office_approve_', ''));
    const req = getRequest(requestId);
    if (!req) return interaction.reply({ content: '❌ Request not found.', ephemeral: true });
    if (!req.channel_id) return interaction.reply({ content: '❌ Malformed request — no office attached.', ephemeral: true });
    return resolveApprove(interaction, client, requestId, req.channel_id);
  }

  // Approve (waiting-room flow — approver picked which office)
  if (id.startsWith('office_wrapprove_')) {
    const rest = id.replace('office_wrapprove_', '');
    const sep = rest.indexOf('_');
    const requestId = parseInt(rest.slice(0, sep));
    const officeChannelId = rest.slice(sep + 1);
    return resolveApprove(interaction, client, requestId, officeChannelId);
  }
}

async function resolveDeny(interaction, client, requestId) {
  const req = getRequest(requestId);
  if (!req) return interaction.reply({ content: '❌ Request not found.', ephemeral: true });
  if (req.status !== 'pending') {
    return interaction.reply({ content: `This request was already **${req.status}**.`, ephemeral: true });
  }

  const guild = interaction.guild;
  const isSuper = SUPERUSER_IDS.includes(String(interaction.user.id));

  // Authorisation: superuser OR currently in any of the involved offices
  let authorised = isSuper;
  if (!authorised) {
    if (req.channel_id) {
      authorised = !!guild.channels.cache.get(req.channel_id)?.members?.has(interaction.user.id);
    } else {
      // waiting-room request — any office occupant in the guild can deny
      const offices = listOffices(guild.id);
      authorised = offices.some(o => guild.channels.cache.get(o.channel_id)?.members?.has(interaction.user.id));
    }
  }
  if (!authorised) {
    return interaction.reply({ content: '❌ You must be inside a managed office (or a superuser) to deny this request.', ephemeral: true });
  }

  resolveRequest(requestId, 'denied', interaction.user.tag, null);

  const requesterUser = await client.users.fetch(req.requester_id).catch(() => null);
  if (requesterUser) {
    await requesterUser.send({
      embeds: [new EmbedBuilder().setColor(0xEF4444).setTitle('❌ Access Denied')
        .setDescription(`Your request was denied by ${interaction.user.tag}.`)]
    }).catch(() => {});
  }

  // If they're still in the waiting room, kick them
  if (req.source === 'waiting_room' && req.source_channel_id) {
    const wrMember = guild.channels.cache.get(req.source_channel_id)?.members?.get(req.requester_id);
    if (wrMember) {
      await wrMember.voice.disconnect(`[Office] Waiting-room request for ${requesterUser?.tag || req.requester_tag} denied by ${interaction.user.tag}`).catch(() => {});
    }
  }

  const updated = EmbedBuilder.from(interaction.message.embeds[0])
    .setColor(0xEF4444).setTitle('❌ Request Denied')
    .setFooter({ text: `Denied by ${interaction.user.tag}` });
  await interaction.update({ embeds: [updated], components: [], content: null });

  await logAction(client, {
    action: '❌ Office Request Denied',
    moderator: { discordId: interaction.user.id, name: interaction.user.tag },
    target: { discordId: req.requester_id, name: req.requester_tag },
    reason: `Access denied${req.source === 'waiting_room' ? ' (waiting-room request)' : ''}`,
    color: 0xEF4444, logType: 'moderation.office', guildId: guild.id
  });
}

async function resolveApprove(interaction, client, requestId, officeChannelId) {
  const req = getRequest(requestId);
  if (!req) return interaction.reply({ content: '❌ Request not found.', ephemeral: true });
  if (req.status !== 'pending') {
    return interaction.reply({ content: `This request was already **${req.status}**.`, ephemeral: true });
  }

  const office = getOffice(officeChannelId);
  if (!office) return interaction.reply({ content: '❌ Office no longer configured.', ephemeral: true });

  const guild = interaction.guild;
  const vc = guild.channels.cache.get(officeChannelId);
  if (!vc) return interaction.reply({ content: '❌ Voice channel not found.', ephemeral: true });

  // Authorisation: superuser OR currently in the chosen office
  const isSuper = SUPERUSER_IDS.includes(String(interaction.user.id));
  const inOffice = vc.members?.has(interaction.user.id);
  if (!isSuper && !inOffice) {
    return interaction.reply({ content: `❌ You must be currently in <#${officeChannelId}> (or a superuser) to bring someone in there.`, ephemeral: true });
  }

  resolveRequest(requestId, 'approved', interaction.user.tag, officeChannelId);

  const requesterMember = await guild.members.fetch(req.requester_id).catch(() => null);
  if (!requesterMember) {
    return interaction.reply({ content: 'Requester is no longer in the server.', ephemeral: true });
  }

  // One-shot pass — enforceJoin will skip them when they (re)join
  grantPass(officeChannelId, requesterMember.id);

  if (requesterMember.voice.channelId) {
    await requesterMember.voice.setChannel(vc).catch(e => console.error('[Office] move failed:', e.message));
  } else {
    await requesterMember.send({
      embeds: [new EmbedBuilder().setColor(0x22C55E).setTitle('✅ Access Approved')
        .setDescription(`Your request to join **${office.channel_name}** was approved by ${interaction.user.tag}.\n\nYou have **60 seconds** to join the channel.`)]
    }).catch(() => {});
  }

  setTimeout(() => clearPass(officeChannelId, requesterMember.id), APPROVE_WINDOW_MS);

  const updated = EmbedBuilder.from(interaction.message.embeds[0])
    .setColor(0x22C55E).setTitle(`✅ Brought into ${office.channel_name}`)
    .setFooter({ text: `Approved by ${interaction.user.tag}` });
  await interaction.update({ embeds: [updated], components: [], content: null });

  await logAction(client, {
    action: '✅ Office Request Approved',
    moderator: { discordId: interaction.user.id, name: interaction.user.tag },
    target: { discordId: req.requester_id, name: req.requester_tag },
    reason: `Access approved for ${office.channel_name}${req.source === 'waiting_room' ? ' (from waiting room)' : ''}`,
    color: 0x22C55E, logType: 'moderation.office', guildId: guild.id
  });
}
