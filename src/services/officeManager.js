import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import db from '../utils/botDb.js';
import { logAction } from '../utils/logger.js';
import { SUPERUSER_IDS } from '../config.js';
import { E, ce } from '../lib/emoji.js';

const APPROVE_WINDOW_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10 * 60_000;

// ── schema (role-based access + hierarchy rank + timed keys) ─────────────────
try { db.exec('ALTER TABLE managed_offices ADD COLUMN owner_role_id TEXT'); } catch {}
try { db.exec('ALTER TABLE managed_offices ADD COLUMN rank INTEGER DEFAULT 100'); } catch {}
db.exec(`CREATE TABLE IF NOT EXISTS office_keys (
  channel_id TEXT NOT NULL, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL,
  granted_by TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (channel_id, user_id))`);

// In-memory one-shot passes — `${channelId}:${userId}`. Granted on approve, cleared after window/join.
const PASSES = new Set();
const pk = (c, u) => `${c}:${u}`;
export function grantPass(c, u) { PASSES.add(pk(c, u)); }
export function clearPass(c, u) { PASSES.delete(pk(c, u)); }
export function hasPass(c, u) { return PASSES.has(pk(c, u)); }

// Temp per-member Connect overwrites the bot adds to bring a guest into a
// permission-locked office (e.g. a citizen pulled from the waiting room).
// Removed when they leave the office (handleOfficeLeave).
const GUEST_GRANTS = new Set();

// ── DB helpers ──────────────────────────────────────────────────────────────
export function getOffice(channelId) { return db.prepare('SELECT * FROM managed_offices WHERE channel_id = ?').get(channelId); }
export function listOffices(guildId) { return db.prepare('SELECT * FROM managed_offices WHERE guild_id = ? ORDER BY rank, channel_name').all(guildId); }
export function upsertOffice(guildId, channelId, channelName, ownerRoleId = null, rank = 100) {
  db.prepare(`INSERT INTO managed_offices (channel_id, guild_id, channel_name, owner_role_id, rank)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(channel_id) DO UPDATE SET channel_name = excluded.channel_name,
      owner_role_id = COALESCE(excluded.owner_role_id, managed_offices.owner_role_id),
      rank = excluded.rank`).run(channelId, guildId, channelName, ownerRoleId, rank);
}
export function deleteOffice(channelId) { db.prepare('DELETE FROM managed_offices WHERE channel_id = ?').run(channelId); }

export function getAllowlist(channelId) { return db.prepare('SELECT discord_id FROM office_allowlist WHERE channel_id = ?').all(channelId).map(r => r.discord_id); }
export function addAllowed(channelId, discordId, addedBy) { db.prepare('INSERT OR IGNORE INTO office_allowlist (channel_id, discord_id, added_by) VALUES (?, ?, ?)').run(channelId, discordId, addedBy); }
export function removeAllowed(channelId, discordId) { db.prepare('DELETE FROM office_allowlist WHERE channel_id = ? AND discord_id = ?').run(channelId, discordId); }
function isOnAllowlist(channelId, discordId) { return !!db.prepare('SELECT 1 FROM office_allowlist WHERE channel_id = ? AND discord_id = ?').get(channelId, discordId); }

export function setRequestFeed(guildId, channelId) { db.prepare(`INSERT INTO office_request_feed (guild_id, channel_id) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET channel_id = excluded.channel_id`).run(guildId, channelId); }
export function getRequestFeed(guildId) { return db.prepare('SELECT channel_id FROM office_request_feed WHERE guild_id = ?').get(guildId)?.channel_id || null; }

// Waiting rooms
export function getWaitingRoom(channelId) { return db.prepare('SELECT * FROM office_waiting_rooms WHERE channel_id = ?').get(channelId); }
export function listWaitingRooms(guildId) { return db.prepare('SELECT * FROM office_waiting_rooms WHERE guild_id = ? ORDER BY channel_name').all(guildId); }
export function firstWaitingRoom(guildId) { return db.prepare('SELECT * FROM office_waiting_rooms WHERE guild_id = ? ORDER BY created_at LIMIT 1').get(guildId); }
export function upsertWaitingRoom(guildId, channelId, channelName) { db.prepare(`INSERT INTO office_waiting_rooms (channel_id, guild_id, channel_name) VALUES (?, ?, ?) ON CONFLICT(channel_id) DO UPDATE SET channel_name = excluded.channel_name`).run(channelId, guildId, channelName); }
export function deleteWaitingRoom(channelId) { db.prepare('DELETE FROM office_waiting_rooms WHERE channel_id = ?').run(channelId); }

// ── Office keys (temporary access) ───────────────────────────────────────────
export function grantKey(channelId, userId, expiresAtMs, grantedBy) {
  db.prepare(`INSERT INTO office_keys (channel_id, user_id, expires_at, granted_by) VALUES (?, ?, ?, ?)
    ON CONFLICT(channel_id, user_id) DO UPDATE SET expires_at = excluded.expires_at, granted_by = excluded.granted_by`).run(channelId, String(userId), Math.floor(expiresAtMs), String(grantedBy));
}
export function revokeKey(channelId, userId) { db.prepare('DELETE FROM office_keys WHERE channel_id = ? AND user_id = ?').run(channelId, String(userId)); }
export function hasValidKey(channelId, userId) {
  const row = db.prepare('SELECT expires_at FROM office_keys WHERE channel_id = ? AND user_id = ?').get(channelId, String(userId));
  if (!row) return false;
  if (row.expires_at <= Date.now()) { revokeKey(channelId, userId); return false; }
  return true;
}
export function listKeys(channelId) { return db.prepare('SELECT * FROM office_keys WHERE channel_id = ? AND expires_at > ?').all(channelId, Date.now()); }

// ── Access logic: superuser / owner role / higher rank / key / manual allow ──
export function isSuper(id) { return SUPERUSER_IDS.includes(String(id)); }

// The member's best (lowest-number = highest) rank, from any office whose owner
// role they hold. null if they hold no office role.
function memberBestRank(member, guildId) {
  let best = null;
  for (const o of listOffices(guildId)) {
    if (o.owner_role_id && member.roles?.cache?.has(o.owner_role_id)) {
      const r = o.rank ?? 100;
      if (best === null || r < best) best = r;
    }
  }
  return best;
}

export function canAccessOffice(member, office) {
  if (!member || !office) return false;
  if (isSuper(member.id)) return true;                                    // superusers bypass everything
  if (office.owner_role_id && member.roles?.cache?.has(office.owner_role_id)) return true; // own office
  const best = memberBestRank(member, office.guild_id);
  if (best !== null && best <= (office.rank ?? 100)) return true;          // higher rank → access lower offices
  if (hasValidKey(office.channel_id, member.id)) return true;             // temporary key
  // Allowlist entries can be a user id OR a role id, so an office can grant a
  // whole role standing access (e.g. VP + Chief of Staff to the Oval Office).
  const allow = getAllowlist(office.channel_id);
  if (allow.includes(member.id) || member.roles?.cache?.some(r => allow.includes(r.id))) return true;
  return false;
}

// ── Enforcement: move non-allowed joiners to the waiting room ────────────────
export async function enforceJoin(client, voiceState) {
  const member = voiceState.member, guild = voiceState.guild, channelId = voiceState.channelId;
  if (!member || !guild || !channelId || member.user.bot) return;
  const office = getOffice(channelId);
  if (!office) return;
  if (canAccessOffice(member, office)) return;
  if (hasPass(channelId, member.id)) { clearPass(channelId, member.id); return; } // one-shot approval

  const wr = firstWaitingRoom(guild.id);
  let moved = false;
  if (wr && wr.channel_id !== channelId) {
    await member.voice.setChannel(wr.channel_id).then(() => { moved = true; }).catch(async () => { await member.voice.disconnect().catch(() => {}); });
  } else {
    await member.voice.disconnect(`[Office] not authorised for ${office.channel_name}`).catch(() => {});
  }
  // Tell them why they were moved (best-effort DM — never blocks enforcement).
  const wrName = moved ? (guild.channels.cache.get(wr.channel_id)?.name || 'waiting room') : null;
  member.send({ embeds: [new EmbedBuilder().setColor(0xF59E0B).setTitle('Office access')
    .setDescription(moved
      ? `${E.warning} You don't have access to **${office.channel_name || 'that office'}**, so you've been moved to the **${wrName}**. Wait there and an office owner can bring you in.`
      : `${E.warning} You don't have access to **${office.channel_name || 'that office'}**, so you've been disconnected.`)] }).catch(() => {});
  await logAction(client, { action: 'Office — moved to waiting room', moderator: { discordId: 'SYSTEM', name: 'Office System' }, target: { discordId: member.id, name: member.user.tag }, reason: `Not authorised for ${office.channel_name || channelId}`, color: 0xF59E0B, logType: 'moderation.office', guildId: guild.id }).catch(() => {});
}

// ── Waiting room: self-select if they have access, else request ──────────────
function createRequest({ guildId, requesterId, requesterTag, sourceChannelId }) {
  return db.prepare(`INSERT INTO office_requests (guild_id, channel_id, requester_id, requester_tag, source, source_channel_id) VALUES (?, NULL, ?, ?, 'waiting_room', ?)`).run(guildId, requesterId, requesterTag, sourceChannelId || null).lastInsertRowid;
}
function getRequest(id) { return db.prepare('SELECT * FROM office_requests WHERE id = ?').get(id); }
function getPendingRequest(guildId, requesterId) { return db.prepare(`SELECT * FROM office_requests WHERE guild_id = ? AND requester_id = ? AND status = 'pending'`).get(guildId, requesterId); }
function setRequestMessage(id, messageId) { db.prepare('UPDATE office_requests SET feed_message_id = ? WHERE id = ?').run(messageId, id); }
function resolveRequest(id, status, by, officeId) { db.prepare(`UPDATE office_requests SET status = ?, resolved_by = ?, resolved_office_id = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?`).run(status, by || null, officeId || null, id); }
export function cancelPendingForUser(guildId, requesterId) {
  const reqs = db.prepare(`SELECT id FROM office_requests WHERE guild_id = ? AND requester_id = ? AND status = 'pending'`).all(guildId, requesterId);
  for (const r of reqs) db.prepare(`UPDATE office_requests SET status = 'cancelled', resolved_at = CURRENT_TIMESTAMP WHERE id = ?`).run(r.id);
  return reqs.map(r => r.id);
}

async function moveInto(member, office, reason) {
  grantPass(office.channel_id, member.id);
  setTimeout(() => clearPass(office.channel_id, member.id), APPROVE_WINDOW_MS);
  const vc = member.guild.channels.cache.get(office.channel_id);
  if (!vc) return;
  // A guest with no standing access (e.g. a citizen brought from the waiting
  // room) can't be moved into a Connect-locked office without a grant — give
  // them a personal Connect/View overwrite, cleaned up when they leave.
  if (!canAccessOffice(member, office)) {
    try {
      await vc.permissionOverwrites.edit(member.id, { ViewChannel: true, Connect: true }, { reason: 'Office: guest brought in' });
      GUEST_GRANTS.add(pk(office.channel_id, member.id));
    } catch (e) { console.error('[Office] guest grant failed:', e.message); }
  }
  if (member.voice.channelId) await member.voice.setChannel(vc).catch(e => console.error('[Office] move failed:', e.message));
}

// When a guest leaves an office we let into, strip the temporary Connect grant.
export async function handleOfficeLeave(client, oldState) {
  const member = oldState.member, chId = oldState.channelId;
  if (!member || !chId) return;
  const key = pk(chId, member.id);
  if (!GUEST_GRANTS.has(key)) return;
  GUEST_GRANTS.delete(key);
  const vc = oldState.guild?.channels?.cache?.get(chId);
  if (vc) await vc.permissionOverwrites.delete(member.id, 'Office: guest left').catch(() => {});
}

export async function handleWaitingRoomJoin(client, voiceState) {
  const member = voiceState.member, guild = voiceState.guild, channelId = voiceState.channelId;
  if (!member || !guild || !channelId || member.user.bot) return;
  const wr = getWaitingRoom(channelId);
  if (!wr) return;
  if (getPendingRequest(guild.id, member.id)) return;

  const offices = listOffices(guild.id);
  if (!offices.length) return;
  const wrVc = guild.channels.cache.get(channelId);

  // The waiting room is only for getting into an office you CAN'T already access —
  // you can just join the ones you can directly. So we never suggest a member the
  // offices they could already walk into; we look only at the ones they lack access
  // to and send an access request to whichever are in use. postWaitingRequest pings
  // the present owners (one office in use → Allow/Deny; several → asks the requester
  // which). So if only the Ownership office is staffed, its owners get the request.
  const requestable = offices.filter(o => !canAccessOffice(member, o));
  if (!requestable.length) {
    // They can already access every office — nothing to request. If exactly one is
    // in use, drop them straight in; otherwise leave them (they can join directly).
    const inUse = offices.filter(o => officeOccupied(guild, o));
    if (inUse.length === 1) await moveInto(member, inUse[0], 'auto');
    return;
  }

  const requestId = createRequest({ guildId: guild.id, requesterId: member.id, requesterTag: member.user.tag || member.user.username, sourceChannelId: channelId });
  await postWaitingRequest(client, guild, wrVc, requestId, member, requestable);
}

// Is anyone (a non-bot member) currently sitting in this office's voice channel?
function officeOccupied(guild, office) {
  const vc = guild.channels?.cache?.get(office.channel_id);
  if (!vc?.members) return false;
  for (const m of vc.members.values()) if (!m.user?.bot) return true;
  return false;
}

// Members sitting in an office's voice channel RIGHT NOW who could approve a
// request (own it / superuser / higher rank / key). These are who we ping.
function presentApprovers(guild, office) {
  const vc = guild.channels?.cache?.get(office.channel_id);
  if (!vc?.members) return [];
  const ids = [];
  for (const m of vc.members.values()) {
    if (m.user?.bot) continue;
    if (canAccessOffice(m, office)) ids.push(m.id);
  }
  return [...new Set(ids)];
}

// The actionable Allow / Deny card for ONE office, pinging that office's present
// owner(s). Used for the single-office case and after the requester picks.
async function postOfficeCard(target, requestId, requesterId, office, pingIds) {
  const ids = [...new Set(pingIds || [])];
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('Office Access Request')
    .setDescription(`${E.announce} <@${requesterId}> would like to join **${office.channel_name || 'your office'}**.\n\nAllow them in, or deny the request.`)
    .setFooter({ text: `Request #${requestId} • expires in 10 min` }).setTimestamp();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`office_bring_${requestId}_${office.channel_id}`).setLabel('Allow').setStyle(ButtonStyle.Success).setEmoji(ce('allow')),
    new ButtonBuilder().setCustomId(`office_deny_${requestId}`).setLabel('Deny').setStyle(ButtonStyle.Danger).setEmoji(ce('deny')),
  );
  const msg = await target.send({ content: ids.length ? ids.map(u => `<@${u}>`).join(' ') : undefined, embeds: [embed], components: [row], allowedMentions: { users: ids } }).catch(() => null);
  if (msg) setRequestMessage(requestId, msg.id);
  return msg;
}

async function postWaitingRequest(client, guild, wrVc, requestId, requester, offices) {
  // Prefer the configured request TEXT channel; fall back to the waiting-room chat.
  const rf = getRequestFeed(guild.id);
  const target = (rf && guild.channels.cache.get(rf)) || wrVc;
  if (!target?.send) return;

  // Only the offices actually IN USE — i.e. an owner who could approve is sitting
  // in them right now. Empty offices and offline owners are never shown or pinged.
  const occupied = [];
  for (const o of offices) {
    const approvers = presentApprovers(guild, o);
    if (approvers.length) occupied.push({ office: o, approvers });
  }

  if (occupied.length === 1) {
    // One office staffed → straight to Allow / Deny, pinging just its owner(s).
    await postOfficeCard(target, requestId, requester.id, occupied[0].office, occupied[0].approvers);
  } else if (occupied.length > 1) {
    // Several staffed → ask the REQUESTER which one they want to join first.
    const btns = occupied.slice(0, 20).map(({ office }) =>
      new ButtonBuilder().setCustomId(`office_choose_${requestId}_${office.channel_id}`).setLabel((office.channel_name || 'Office').slice(0, 80)).setStyle(ButtonStyle.Primary));
    const rows = [];
    for (let i = 0; i < btns.length; i += 5) rows.push(new ActionRowBuilder().addComponents(btns.slice(i, i + 5)));
    const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('Which office?')
      .setDescription(`${E.announce} <@${requester.id}> — a few offices are open. Pick the one you're requesting to join and its owner will be asked to let you in.`)
      .setFooter({ text: `Request #${requestId} • expires in 10 min` }).setTimestamp();
    const msg = await target.send({ content: `<@${requester.id}>`, embeds: [embed], components: rows, allowedMentions: { users: [requester.id] } }).catch(() => null);
    if (msg) setRequestMessage(requestId, msg.id);
  } else {
    // Nothing staffed → post the Allow/Deny card AND ping the offices' owner ROLES
    // so someone actually comes to let them in (Dion: "ping them outside"). We
    // ping the distinct owner roles of the configured offices, deduped + capped so
    // it's a targeted heads-up, not a blast of every role. Roles with no owner_role_id
    // are skipped; if none have one, we post pingless (as before).
    const btns = offices.slice(0, 20).map(o => new ButtonBuilder().setCustomId(`office_bring_${requestId}_${o.channel_id}`).setLabel(`Bring to ${o.channel_name || 'office'}`.slice(0, 80)).setStyle(ButtonStyle.Success).setEmoji(ce('allow')));
    const rows = [];
    for (let i = 0; i < btns.length; i += 5) rows.push(new ActionRowBuilder().addComponents(btns.slice(i, i + 5)));
    rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`office_deny_${requestId}`).setLabel('Deny').setStyle(ButtonStyle.Danger).setEmoji(ce('deny'))));
    const roleIds = [...new Set(offices.map(o => o.owner_role_id).filter(Boolean))].slice(0, 8);
    const pingLine = roleIds.length ? roleIds.map(r => `<@&${r}>`).join(' ') : undefined;
    const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('Office Access Request')
      .setDescription(`${E.announce} <@${requester.id}> is in the waiting room and would like to join an office.\n\nNo office is staffed right now — an owner can bring them in, or deny.`)
      .setFooter({ text: `Request #${requestId} • expires in 10 min` }).setTimestamp();
    const msg = await target.send({ content: pingLine, embeds: [embed], components: rows, allowedMentions: { roles: roleIds } }).catch(() => null);
    if (msg) setRequestMessage(requestId, msg.id);
  }

  // ONE expiry timer — always acts on the request's CURRENT message (it may move
  // from the "which office?" picker to the Allow/Deny card after a pick).
  setTimeout(async () => {
    const req = getRequest(requestId); if (!req || req.status !== 'pending') return;
    resolveRequest(requestId, 'expired', null, null);
    if (req.feed_message_id) {
      const m = await target.messages.fetch(req.feed_message_id).catch(() => null);
      if (m) { const base = m.embeds[0] ? EmbedBuilder.from(m.embeds[0]) : new EmbedBuilder(); await m.edit({ embeds: [base.setColor(0x6b7280).setTitle('Request expired')], components: [], content: null }).catch(() => {}); }
    }
  }, REQUEST_TIMEOUT_MS);
}

export async function handleWaitingRoomLeave(client, voiceState) {
  const member = voiceState.member, guild = voiceState.guild;
  if (!member || !guild) return;
  cancelPendingForUser(guild.id, member.id);
}

// ── Interaction handlers ─────────────────────────────────────────────────────
export async function handleButton(interaction, client) {
  const id = interaction.customId;

  // Self-select: a member with access picks which office to be moved into.
  if (id.startsWith('office_self_')) {
    const officeChannelId = id.slice('office_self_'.length);
    const office = getOffice(officeChannelId);
    if (!office) return interaction.reply({ content: `${E.cross} That office is no longer configured.`, flags: 64 }).catch(() => {});
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !canAccessOffice(member, office)) return interaction.reply({ content: `${E.cross} You don't have access to that office.`, flags: 64 }).catch(() => {});
    if (!member.voice.channelId) return interaction.reply({ content: `${E.cross} Join the waiting room first, then pick an office.`, flags: 64 }).catch(() => {});
    await moveInto(member, office, 'self-select');
    return interaction.reply({ content: `${E.check} Taking you into **${office.channel_name}**.`, flags: 64 }).catch(() => {});
  }

  // Requester picks which staffed office they're requesting → fire the Allow/Deny
  // card to that office's present owner(s). Only the requester can pick.
  if (id.startsWith('office_choose_')) {
    const rest = id.slice('office_choose_'.length); const sep = rest.indexOf('_');
    const requestId = parseInt(rest.slice(0, sep)); const officeChannelId = rest.slice(sep + 1);
    const req = getRequest(requestId);
    if (!req || req.status !== 'pending') return interaction.reply({ content: 'This request is no longer open.', flags: 64 }).catch(() => {});
    if (String(req.requester_id) !== String(interaction.user.id)) return interaction.reply({ content: `Only <@${req.requester_id}> can choose here.`, flags: 64 }).catch(() => {});
    const office = getOffice(officeChannelId);
    if (!office) return interaction.reply({ content: `${E.cross} That office is no longer configured.`, flags: 64 }).catch(() => {});
    const approvers = presentApprovers(interaction.guild, office);
    if (!approvers.length) return interaction.reply({ content: `${E.cross} No one's in **${office.channel_name}** anymore — pick another office.`, flags: 64 }).catch(() => {});
    await interaction.update({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Requested').setDescription(`${E.check} You asked to join **${office.channel_name}** — its owner has been notified.`)], components: [], content: null }).catch(() => {});
    await postOfficeCard(interaction.channel, requestId, req.requester_id, office, approvers);
    return;
  }

  if (id.startsWith('office_deny_')) return resolveDeny(interaction, client, parseInt(id.replace('office_deny_', '')));

  // Owner brings a requester into their office.
  if (id.startsWith('office_bring_')) {
    const rest = id.slice('office_bring_'.length); const sep = rest.indexOf('_');
    return resolveApprove(interaction, client, parseInt(rest.slice(0, sep)), rest.slice(sep + 1));
  }
}

async function resolveDeny(interaction, client, requestId) {
  const req = getRequest(requestId);
  if (!req) return interaction.reply({ content: `${E.cross} Request not found.`, flags: 64 }).catch(() => {});
  if (req.status !== 'pending') return interaction.reply({ content: `Already **${req.status}**.`, flags: 64 }).catch(() => {});
  const guild = interaction.guild;
  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  const authorised = isSuper(interaction.user.id) || listOffices(guild.id).some(o => member && canAccessOffice(member, o));
  if (!authorised) return interaction.reply({ content: `${E.cross} Only an office owner or a superuser can deny this.`, flags: 64 }).catch(() => {});
  resolveRequest(requestId, 'denied', interaction.user.tag, null);
  const u = await client.users.fetch(req.requester_id).catch(() => null);
  if (u) await u.send({ embeds: [new EmbedBuilder().setColor(0xEF4444).setTitle('Access denied').setDescription(`${E.cross} Your office request was denied.`)] }).catch(() => {});
  if (req.source_channel_id) { const wm = guild.channels.cache.get(req.source_channel_id)?.members?.get(req.requester_id); if (wm) await wm.voice.disconnect('[Office] request denied').catch(() => {}); }
  await interaction.update({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor(0xEF4444).setTitle('Request denied').setFooter({ text: `Denied by ${interaction.user.tag}` })], components: [], content: null }).catch(() => {});
}

async function resolveApprove(interaction, client, requestId, officeChannelId) {
  const req = getRequest(requestId);
  if (!req) return interaction.reply({ content: `${E.cross} Request not found.`, flags: 64 }).catch(() => {});
  if (req.status !== 'pending') return interaction.reply({ content: `Already **${req.status}**.`, flags: 64 }).catch(() => {});
  const office = getOffice(officeChannelId);
  if (!office) return interaction.reply({ content: `${E.cross} Office no longer configured.`, flags: 64 }).catch(() => {});
  const guild = interaction.guild;
  const approver = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!approver || !canAccessOffice(approver, office)) return interaction.reply({ content: `${E.cross} Only an owner of **${office.channel_name}** (or a superuser) can bring someone in there.`, flags: 64 }).catch(() => {});
  resolveRequest(requestId, 'approved', interaction.user.tag, officeChannelId);
  const requester = await guild.members.fetch(req.requester_id).catch(() => null);
  if (!requester) return interaction.reply({ content: 'Requester left the server.', flags: 64 }).catch(() => {});
  await moveInto(requester, office, 'approved');
  if (!requester.voice.channelId) await requester.send({ embeds: [new EmbedBuilder().setColor(0x22C55E).setTitle('Access approved').setDescription(`${E.check} You were approved for **${office.channel_name}** — you have 60 seconds to join.`)] }).catch(() => {});
  await interaction.update({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor(0x22C55E).setTitle(`Brought into ${office.channel_name}`).setFooter({ text: `Approved by ${interaction.user.tag}` })], components: [], content: null }).catch(() => {});
  await logAction(client, { action: 'Office Request Approved', moderator: { discordId: interaction.user.id, name: interaction.user.tag }, target: { discordId: req.requester_id, name: req.requester_tag }, reason: `Brought into ${office.channel_name}`, color: 0x22C55E, logType: 'moderation.office', guildId: guild.id }).catch(() => {});
}

// periodic key expiry sweep — gated by the CO crons kill-switch
if (process.env.CO_CRONS_DISABLED === '0') setInterval(() => { try { db.prepare('DELETE FROM office_keys WHERE expires_at <= ?').run(Date.now()); } catch {} }, 60_000);
