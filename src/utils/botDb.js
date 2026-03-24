import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const portalDb = new Database(process.env.PORTAL_DB_PATH, { readonly: true });
const db = new Database(path.join(__dirname, '../../bot-data.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS infractions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT NOT NULL,
    type TEXT NOT NULL,
    reason TEXT,
    moderator_id TEXT NOT NULL,
    moderator_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    active INTEGER DEFAULT 1,
    appealable INTEGER DEFAULT 1,
    appeal_denied_until DATETIME,
    deleted INTEGER DEFAULT 0,
    deleted_by TEXT,
    deleted_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS infraction_deleted_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_id INTEGER,
    discord_id TEXT,
    type TEXT,
    reason TEXT,
    moderator_id TEXT,
    created_at DATETIME,
    deleted_by TEXT,
    deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS suspensions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT NOT NULL,
    reason TEXT,
    moderator_id TEXT,
    suspended_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    lifted_at DATETIME,
    active INTEGER DEFAULT 1,
    infraction_id INTEGER
  );

  CREATE TABLE IF NOT EXISTS investigations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT NOT NULL,
    reason TEXT,
    moderator_id TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    outcome TEXT,
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS global_bans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT NOT NULL,
    reason TEXT,
    moderator_id TEXT,
    banned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    active INTEGER DEFAULT 1,
    appealable INTEGER DEFAULT 1,
    infraction_id INTEGER
  );

  CREATE TABLE IF NOT EXISTS appeals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    infraction_id INTEGER NOT NULL,
    discord_id TEXT NOT NULL,
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'pending',
    reviewed_by TEXT,
    reviewed_at DATETIME,
    outcome TEXT,
    cooldown_until DATETIME
  );

  CREATE TABLE IF NOT EXISTS staff_strikes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT NOT NULL,
    reason TEXT,
    moderator_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS dm_exemptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT NOT NULL UNIQUE,
    display_name TEXT,
    exempted_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS global_log_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL UNIQUE,
    channel_id TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ticket_panels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    intro_message TEXT NOT NULL,
    staff_role_id TEXT NOT NULL,
    ping_role_id TEXT NOT NULL,
    ticket_category_id TEXT NOT NULL,
    transcripts_channel_id TEXT,
    created_by TEXT NOT NULL,
    ticket_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ticket_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    panel_id INTEGER NOT NULL,
    discord_channel_id TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    claimed_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (panel_id) REFERENCES ticket_panels(id)
  );


  CREATE TABLE IF NOT EXISTS log_config (id INTEGER PRIMARY KEY, guild_id TEXT, channel_id TEXT, event_type TEXT);
  CREATE TABLE IF NOT EXISTS bot_config (id INTEGER PRIMARY KEY, key TEXT UNIQUE, value TEXT);
  CREATE TABLE IF NOT EXISTS verified_members (id INTEGER PRIMARY KEY, discord_id TEXT UNIQUE, portal_id INTEGER, position TEXT, auth_level INTEGER, verified_at DATETIME DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS verification_queue (id INTEGER PRIMARY KEY, discord_id TEXT, portal_id INTEGER, requested_at DATETIME DEFAULT CURRENT_TIMESTAMP, status TEXT DEFAULT 'pending');
  CREATE TABLE IF NOT EXISTS banned_users (id INTEGER PRIMARY KEY, discord_id TEXT, reason TEXT, banned_by TEXT, banned_at DATETIME DEFAULT CURRENT_TIMESTAMP, unban_at DATETIME, active INTEGER DEFAULT 1);
  CREATE TABLE IF NOT EXISTS guild_settings (id INTEGER PRIMARY KEY, guild_id TEXT UNIQUE, key TEXT, value TEXT);

  CREATE TABLE IF NOT EXISTS inbox_channel_map (
    inbox_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS inbox_seen_emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inbox_id TEXT NOT NULL,
    uid INTEGER NOT NULL,
    message_id TEXT,
    subject TEXT,
    from_address TEXT,
    received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    notification_message_id TEXT,
    notification_channel_id TEXT,
    UNIQUE(inbox_id, uid)
  );

  CREATE TABLE IF NOT EXISTS inbox_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reply_code TEXT NOT NULL UNIQUE,
    inbox_id TEXT NOT NULL,
    uid INTEGER NOT NULL,
    replied_by_discord_id TEXT NOT NULL,
    replied_by_name TEXT,
    reply_to TEXT,
    reply_subject TEXT,
    reply_body TEXT,
    replied_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`);

// Migration: add ticket_count column if missing (existing DBs)
try {
  db.prepare('SELECT ticket_count FROM ticket_panels LIMIT 1').get();
} catch {
  db.exec('ALTER TABLE ticket_panels ADD COLUMN ticket_count INTEGER DEFAULT 0');
}

// Migration: add claimed_by column if missing
try {
  db.prepare('SELECT claimed_by FROM ticket_channels LIMIT 1').get();
} catch {
  db.exec('ALTER TABLE ticket_channels ADD COLUMN claimed_by TEXT');
}

// Migration: add status column if missing
try {
  db.prepare('SELECT status FROM ticket_channels LIMIT 1').get();
} catch {
  db.exec("ALTER TABLE ticket_channels ADD COLUMN status TEXT DEFAULT 'open'");
}

// Migration: add transcripts_channel_id if missing
try {
  db.prepare('SELECT transcripts_channel_id FROM ticket_panels LIMIT 1').get();
} catch {
  db.exec('ALTER TABLE ticket_panels ADD COLUMN transcripts_channel_id TEXT');
}

export default db;

export function addDmExemption(discordId, displayName, exemptedBy) {
  try {
    db.prepare('INSERT OR IGNORE INTO dm_exemptions (discord_id, display_name, exempted_by) VALUES (?, ?, ?)').run(discordId, displayName, exemptedBy);
    return true;
  } catch { return false; }
}

export function removeDmExemption(discordId) {
  const result = db.prepare('DELETE FROM dm_exemptions WHERE discord_id = ?').run(discordId);
  return result.changes > 0;
}

export function getDmExemptions() {
  return db.prepare('SELECT * FROM dm_exemptions ORDER BY created_at DESC').all();
}

export function isDmExempt(discordId) {
  const row = db.prepare('SELECT id FROM dm_exemptions WHERE discord_id = ?').get(discordId);
  return !!row;
}

export function getGlobalLogChannel(category) {
  const row = db.prepare('SELECT channel_id FROM global_log_config WHERE category = ?').get(category);
  return row?.channel_id || null;
}

export function setGlobalLogChannel(category, channelId) {
  db.prepare(`
    INSERT INTO global_log_config (category, channel_id, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(category) DO UPDATE SET channel_id = excluded.channel_id, updated_at = CURRENT_TIMESTAMP
  `).run(category, channelId);
}

export function getLogChannel(guildId, category, type) {
  const row = db.prepare('SELECT channel_id FROM log_config WHERE guild_id = ? AND category = ? AND type = ?').get(guildId, category, type);
  return row?.channel_id || null;
}

export function setLogChannel(guildId, category, type, channelId) {
  db.prepare(`
    INSERT INTO log_config (guild_id, category, type, channel_id, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(guild_id, category, type) DO UPDATE SET channel_id = excluded.channel_id, updated_at = CURRENT_TIMESTAMP
  `).run(guildId, category, type, channelId);
}

export function getAllLogConfig(guildId) {
  const rows = db.prepare('SELECT * FROM log_config WHERE guild_id = ?').all(guildId);
  const config = {};
  for (const row of rows) {
    config[`${row.category}:${row.type}`] = row.channel_id;
  }
  return config;
}

// Guild settings (role IDs etc.)
export function getGuildSetting(guildId, key) {
  const row = db.prepare('SELECT value FROM guild_settings WHERE guild_id = ? AND key = ?').get(guildId, key);
  return row?.value || null;
}

export function setGuildSetting(guildId, key, value) {
  db.prepare(`
    INSERT INTO guild_settings (guild_id, \`key\`, value)
    VALUES (?, ?, ?)
    ON CONFLICT(guild_id, \`key\`) DO UPDATE SET value = excluded.value
  `).run(guildId, key, value);
}

export function isUserVerified(discordId) {
  const row = db.prepare('SELECT discord_id FROM verified_members WHERE discord_id = ?').get(discordId);
  return !!row;
}

// Alias for logspanel.js compatibility
export const getLogConfig = getAllLogConfig;

export function addInfraction(discordId, type, reason, moderatorId, moderatorName, expiresAt = null, appealable = 1) {
  return db.prepare(`
    INSERT INTO infractions (discord_id, type, reason, moderator_id, moderator_name, expires_at, appealable)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(discordId, type, reason, moderatorId, moderatorName, expiresAt, appealable);
}

export function getInfractions(discordId, includeDeleted = false) {
  const query = includeDeleted
    ? 'SELECT * FROM infractions WHERE discord_id = ? ORDER BY created_at DESC'
    : 'SELECT * FROM infractions WHERE discord_id = ? AND deleted = 0 ORDER BY created_at DESC';
  return db.prepare(query).all(discordId);
}

export function getDeletedInfractions(discordId) {
  return db.prepare('SELECT * FROM infraction_deleted_history WHERE discord_id = ? ORDER BY deleted_at DESC').all(discordId);
}

export function deleteInfraction(id, deletedBy) {
  const inf = db.prepare('SELECT * FROM infractions WHERE id = ?').get(id);
  if (!inf) return null;
  db.prepare('INSERT INTO infraction_deleted_history (original_id, discord_id, type, reason, moderator_id, created_at, deleted_by) VALUES (?,?,?,?,?,?,?)')
    .run(inf.id, inf.discord_id, inf.type, inf.reason, inf.moderator_id, inf.created_at, deletedBy);
  db.prepare('UPDATE infractions SET deleted = 1, deleted_by = ?, deleted_at = CURRENT_TIMESTAMP, active = 0 WHERE id = ?').run(deletedBy, id);
  return inf;
}

export function addSuspension(discordId, reason, moderatorId, expiresAt = null, infractionId = null) {
  return db.prepare(`
    INSERT INTO suspensions (discord_id, reason, moderator_id, expires_at, infraction_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(discordId, reason, moderatorId, expiresAt, infractionId);
}

export function getActiveSuspension(discordId) {
  return db.prepare('SELECT * FROM suspensions WHERE discord_id = ? AND active = 1 ORDER BY suspended_at DESC LIMIT 1').get(discordId);
}

export function liftSuspension(discordId) {
  return db.prepare('UPDATE suspensions SET active = 0, lifted_at = CURRENT_TIMESTAMP WHERE discord_id = ? AND active = 1').run(discordId);
}

export function addGlobalBan(discordId, reason, moderatorId, appealable = 1) {
  return db.prepare(`
    INSERT INTO global_bans (discord_id, reason, moderator_id, appealable)
    VALUES (?, ?, ?, ?)
  `).run(discordId, reason, moderatorId, appealable);
}

export function getActiveGlobalBan(discordId) {
  return db.prepare('SELECT * FROM global_bans WHERE discord_id = ? AND active = 1 LIMIT 1').get(discordId);
}

export function startInvestigation(discordId, reason, moderatorId) {
  return db.prepare(`
    INSERT INTO investigations (discord_id, reason, moderator_id)
    VALUES (?, ?, ?)
  `).run(discordId, reason, moderatorId);
}

export function endInvestigation(discordId, outcome) {
  return db.prepare(`
    UPDATE investigations SET active = 0, ended_at = CURRENT_TIMESTAMP, outcome = ?
    WHERE discord_id = ? AND active = 1
  `).run(outcome, discordId);
}

export function getActiveInvestigation(discordId) {
  return db.prepare('SELECT * FROM investigations WHERE discord_id = ? AND active = 1 LIMIT 1').get(discordId);
}

export function getAllActiveStaff() {
  return portalDb.prepare(
    `SELECT id, display_name, full_name, username, position, department, discord_id
     FROM users WHERE account_status = 'Active' ORDER BY display_name LIMIT 100`
  ).all();
}

export function getPortalUserById(userId) {
  return portalDb.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

// ── Ticket Panels ────────────────────────────────────────────────────────────

export function saveTicketPanel({ name, introMessage, staffRoleId, pingRoleId, ticketCategoryId, transcriptsChannelId, createdBy }) {
  return db.prepare(`
    INSERT INTO ticket_panels (name, intro_message, staff_role_id, ping_role_id, ticket_category_id, transcripts_channel_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(name, introMessage, String(staffRoleId), String(pingRoleId), String(ticketCategoryId), transcriptsChannelId ? String(transcriptsChannelId) : null, String(createdBy));
}

export function getTicketPanelByName(name) {
  return db.prepare('SELECT * FROM ticket_panels WHERE LOWER(name) = LOWER(?)').get(name);
}

export function getTicketPanelById(id) {
  return db.prepare('SELECT * FROM ticket_panels WHERE id = ?').get(id);
}

export function getAllTicketPanels() {
  return db.prepare('SELECT * FROM ticket_panels ORDER BY created_at DESC').all();
}

export function deleteTicketPanel(id) {
  return db.prepare('DELETE FROM ticket_panels WHERE id = ?').run(id);
}

export function incrementTicketCount(panelId) {
  db.prepare('UPDATE ticket_panels SET ticket_count = ticket_count + 1 WHERE id = ?').run(panelId);
  const panel = db.prepare('SELECT ticket_count FROM ticket_panels WHERE id = ?').get(panelId);
  return panel ? panel.ticket_count : 1;
}

export function saveTicketChannel({ panelId, discordChannelId, userId, claimedBy = null }) {
  return db.prepare(`
    INSERT INTO ticket_channels (panel_id, discord_channel_id, user_id, claimed_by)
    VALUES (?, ?, ?, ?)
  `).run(panelId, String(discordChannelId), String(userId), claimedBy ? String(claimedBy) : null);
}

export function getTicketChannelByUser(panelId, userId) {
  return db.prepare('SELECT * FROM ticket_channels WHERE panel_id = ? AND user_id = ?').get(panelId, String(userId));
}

export function getTicketChannelByChannelId(discordChannelId) {
  return db.prepare('SELECT * FROM ticket_channels WHERE discord_channel_id = ?').get(String(discordChannelId));
}

export function claimTicket(discordChannelId, moderatorId) {
  return db.prepare('UPDATE ticket_channels SET claimed_by = ? WHERE discord_channel_id = ?').run(String(moderatorId), String(discordChannelId));
}

export function closeTicket(discordChannelId) {
  return db.prepare("UPDATE ticket_channels SET status = 'closed' WHERE discord_channel_id = ?").run(String(discordChannelId));
}

export function reopenTicket(discordChannelId) {
  return db.prepare("UPDATE ticket_channels SET status = 'open', claimed_by = NULL WHERE discord_channel_id = ?").run(String(discordChannelId));
}

export function unclaimTicket(discordChannelId) {
  return db.prepare("UPDATE ticket_channels SET claimed_by = NULL WHERE discord_channel_id = ?").run(String(discordChannelId));
}

export function setTicketStatus(discordChannelId, status) {
  return db.prepare("UPDATE ticket_channels SET status = ? WHERE discord_channel_id = ?").run(status, String(discordChannelId));
}

// ── Email Inbox Helpers ───────────────────────────────────────────────────────

export function getInboxChannelId(inboxId) {
  const row = db.prepare('SELECT channel_id FROM inbox_channel_map WHERE inbox_id = ?').get(inboxId);
  return row?.channel_id || null;
}

export function markEmailSeen(inboxId, uid, subject, fromAddress, notifMsgId, notifChannelId) {
  db.prepare(`INSERT OR IGNORE INTO inbox_seen_emails (inbox_id, uid, subject, from_address, notification_message_id, notification_channel_id)
    VALUES (?, ?, ?, ?, ?, ?)`).run(inboxId, uid, subject, fromAddress, notifMsgId, notifChannelId);
}

export function isEmailSeen(inboxId, uid) {
  return !!db.prepare('SELECT id FROM inbox_seen_emails WHERE inbox_id = ? AND uid = ?').get(inboxId, uid);
}

export function getSeenEmail(inboxId, uid) {
  return db.prepare('SELECT * FROM inbox_seen_emails WHERE inbox_id = ? AND uid = ?').get(inboxId, uid);
}

export function saveReply(replyCode, inboxId, uid, discordId, name, replyTo, replySubject, replyBody) {
  db.prepare(`INSERT INTO inbox_replies (reply_code, inbox_id, uid, replied_by_discord_id, replied_by_name, reply_to, reply_subject, reply_body)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(replyCode, inboxId, uid, discordId, name, replyTo, replySubject, replyBody);
}

export function getReply(replyCode) {
  return db.prepare('SELECT * FROM inbox_replies WHERE reply_code = ?').get(replyCode);
}

export function getRepliesForEmail(inboxId, uid) {
  return db.prepare('SELECT * FROM inbox_replies WHERE inbox_id = ? AND uid = ? ORDER BY replied_at ASC').all(inboxId, uid);
}

