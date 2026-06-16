import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import db from '../utils/botDb.js';
import { logAction } from '../utils/logger.js';
import { SUPERUSER_IDS } from '../config.js';
import { E } from '../lib/emoji.js';

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
  if (isOnAllowlist(office.channel_id, member.id)) return true;           // manual per-user allow
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
  if (wr && wr.channel_id !== channelId) {
    await member.voice.setChannel(wr.channel_id).catch(async () => { await member.voice.disconnect().catch(() => {}); });
  } else {
    await member.voice.disconnect(`[Office] not authorised for ${office.channel_name}`).catch(() => {});
  }
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
  if (vc && member.voice.channelId) await member.voice.setChannel(vc).catch(e => console.error('[Office] move failed:', e.message));
}

export async function handleWaitingRoomJoin(client, voiceState) {
  const member = voiceState.member, guild = voiceState.guild, channelId = voiceState.channelId;
  if (!member || !guild || !channelId || member.user.bot) return;
  const wr = getWaitingRoom(channelId);
  if (!wr) return;
  if (getPendingRequest(guild.id, member.id)) return;

  const offices = listOffices(guild.id);
  if (!offices.length) return;
  const accessible = offices.filter(o => canAccessOffice(member, o));
  const wrVc = guild.channels.cache.get(channelId);

  // 1) They already have access to exactly one office → take them straight in.
  if (accessible.length === 1) { await moveInto(member, accessible[0], 'auto'); return; }

  // 2) They have access to several → ask which one (self-select, no approval needed).
  if (accessible.length > 1) {
    const rows = [];
    const btns = accessible.slice(0, 20).map(o => new ButtonBuilder().setCustomId(`office_self_${o.channel_id}`).setLabel((o.channel_name || 'Office').slice(0, 80)).setStyle(ButtonStyle.Primary));
    for (let i = 0; i < btns.length; i += 5) rows.push(new ActionRowBuilder().addComponents(btns.slice(i, i + 5)));
    await wrVc?.send({
      content: `<@${member.id}>`,
      embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Which office?').setDescription(`${E.announce} <@${member.id}> — you have access to several offices. Pick the one you'd like to join.`)],
      components: rows, allowedMentions: { users: [member.id] },
    }).catch(() => {});
    return;
  }

  // 3) No access → post an access request, pinging the office owners, in the waiting-room text chat.
  const requestId = createRequest({ guildId: guild.id, requesterId: member.id, requesterTag: member.user.tag || member.user.username, sourceChannelId: channelId });
  await postWaitingRequest(client, guild, wrVc, requestId, member, offices);
}

async function postWaitingRequest(client, guild, wrVc, requestId, requester, offices) {
  const target = wrVc || (getRequestFeed(guild.id) && guild.channels.cache.get(getRequestFeed(guild.id)));
  if (!target?.send) return;
  // owner-role pings
  const roleIds = [...new Set(offices.map(o => o.owner_role_id).filter(Boolean))];
  const rows = [];
  const btns = offices.slice(0, 20).map(o => new ButtonBuilder().setCustomId(`office_bring_${requestId}_${o.channel_id}`).setLabel(`Bring to ${o.channel_name || 'office'}`.slice(0, 80)).setStyle(ButtonStyle.Success));
  for (let i = 0; i < btns.length; i += 5) rows.push(new ActionRowBuilder().addComponents(btns.slice(i, i + 5)));
  rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`office_deny_${requestId}`).setLabel('Deny').setStyle(ButtonStyle.Danger).setEmoji('❌')));
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('Office Access Request')
    .setDescription(`${E.announce} <@${requester.id}> is in the waiting room and would like to join an office.\n\nAn office owner can bring them into their office, or deny the request.`)
    .setFooter({ text: `Request #${requestId} • expires in 10 min` }).setTimestamp();
  const msg = await target.send({ content: roleIds.length ? roleIds.map(r => `<@&${r}>`).join(' ') : undefined, embeds: [embed], components: rows, allowedMentions: { roles: roleIds } }).catch(() => null);
  if (msg) setRequestMessage(requestId, msg.id);
  setTimeout(async () => {
    const req = getRequest(requestId); if (!req || req.status !== 'pending') return;
    resolveRequest(requestId, 'expired', null, null);
    if (msg) { const m = await target.messages.fetch(msg.id).catch(() => null); if (m) await m.edit({ embeds: [EmbedBuilder.from(m.embeds[0] || embed).setColor(0x6b7280).setTitle('Request expired')], components: [], content: null }).catch(() => {}); }
  }, REQUEST_TIMEOUT_MS);
  return msg;
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

// periodic key expiry sweep
setInterval(() => { try { db.prepare('DELETE FROM office_keys WHERE expires_at <= ?').run(Date.now()); } catch {} }, 60_000);
