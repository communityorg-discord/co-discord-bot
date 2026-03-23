import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

  CREATE TABLE IF NOT EXISTS elections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    created_by TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ends_at DATETIME,
    active INTEGER DEFAULT 1,
    result TEXT
  );

  CREATE TABLE IF NOT EXISTS election_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id INTEGER,
    discord_id TEXT,
    name TEXT,
    whitelisted INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS election_votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    election_id INTEGER,
    voter_id TEXT,
    candidate_id INTEGER,
    voted_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

export default db;

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
