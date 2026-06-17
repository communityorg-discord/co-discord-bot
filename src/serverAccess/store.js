// SQLite store for the USGRP network server-access system. Tables live in the
// bot's own bot-data.db (read-write). Timestamps are INTEGER ms-epoch.
import db from '../utils/botDb.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS na_grants (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id  TEXT NOT NULL,
    guild_id    TEXT NOT NULL,
    server_key  TEXT,
    kind        TEXT NOT NULL DEFAULT 'request',   -- mandatory | request
    reason      TEXT,
    granted_by  TEXT,
    granted_at  INTEGER NOT NULL,
    expires_at  INTEGER,                            -- NULL = no time limit
    status      TEXT NOT NULL DEFAULT 'active',     -- active | expired | revoked
    ext_count   INTEGER NOT NULL DEFAULT 0,
    warned_at   INTEGER,                            -- nearing-expiry DM sent
    UNIQUE(discord_id, guild_id)
  );
  CREATE INDEX IF NOT EXISTS idx_na_grants_status ON na_grants(status, expires_at);

  CREATE TABLE IF NOT EXISTS na_invite_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id  TEXT NOT NULL,
    guild_id    TEXT NOT NULL,
    server_key  TEXT,
    kind        TEXT,
    reason      TEXT,
    by_id       TEXT,
    code        TEXT,
    at          INTEGER NOT NULL,
    link_expires_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_na_invite_code ON na_invite_log(code);

  CREATE TABLE IF NOT EXISTS na_leavewatch (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id  TEXT NOT NULL,
    guild_id    TEXT NOT NULL,
    server_key  TEXT,
    left_at     INTEGER NOT NULL,
    deadline_at INTEGER NOT NULL,
    flagged     INTEGER NOT NULL DEFAULT 0,
    reinvited   INTEGER NOT NULL DEFAULT 0,
    resolved    INTEGER NOT NULL DEFAULT 0,
    resolved_at INTEGER,
    UNIQUE(discord_id, guild_id, resolved)
  );

  CREATE TABLE IF NOT EXISTS na_daily_dm (
    discord_id  TEXT PRIMARY KEY,
    last_dm_at  INTEGER NOT NULL
  );
`);
// Back-fill the link-expiry column on an older table.
try { db.exec(`ALTER TABLE na_invite_log ADD COLUMN link_expires_at INTEGER`); } catch { /* exists */ }

const now = () => Date.now();

// ── Grants ───────────────────────────────────────────────────────────────────
export function upsertGrant({ discord_id, guild_id, server_key, kind = 'request', reason = null, granted_by = null, expires_at = null }) {
    db.prepare(`
        INSERT INTO na_grants (discord_id, guild_id, server_key, kind, reason, granted_by, granted_at, expires_at, status, ext_count, warned_at)
        VALUES (@discord_id, @guild_id, @server_key, @kind, @reason, @granted_by, @now, @expires_at, 'active', 0, NULL)
        ON CONFLICT(discord_id, guild_id) DO UPDATE SET
            server_key=excluded.server_key, kind=excluded.kind, reason=excluded.reason,
            granted_by=excluded.granted_by, granted_at=excluded.granted_at,
            expires_at=excluded.expires_at, status='active', warned_at=NULL
    `).run({ discord_id: String(discord_id), guild_id: String(guild_id), server_key, kind, reason, granted_by: granted_by ? String(granted_by) : null, expires_at, now: now() });
    return getGrant(discord_id, guild_id);
}

export function getGrant(discord_id, guild_id) {
    return db.prepare(`SELECT * FROM na_grants WHERE discord_id=? AND guild_id=?`).get(String(discord_id), String(guild_id)) || null;
}
export function activeGrantsFor(discord_id) {
    return db.prepare(`SELECT * FROM na_grants WHERE discord_id=? AND status='active'`).all(String(discord_id));
}
export function activeTimedGrants() {
    return db.prepare(`SELECT * FROM na_grants WHERE status='active' AND expires_at IS NOT NULL`).all();
}
export function setGrantStatus(id, status) {
    db.prepare(`UPDATE na_grants SET status=? WHERE id=?`).run(status, id);
}
export function revokeGrantsForUser(discord_id) {
    db.prepare(`UPDATE na_grants SET status='revoked' WHERE discord_id=? AND status='active'`).run(String(discord_id));
}
export function extendGrant(id, newExpiry) {
    db.prepare(`UPDATE na_grants SET expires_at=?, ext_count=ext_count+1, warned_at=NULL, status='active' WHERE id=?`).run(newExpiry, id);
}
export function markWarned(id) {
    db.prepare(`UPDATE na_grants SET warned_at=? WHERE id=?`).run(now(), id);
}

// ── Invite log (who each invite code was sent to) ────────────────────────────
export function logInvite({ discord_id, guild_id, server_key, kind, reason, by_id, code, link_expires_at = null }) {
    db.prepare(`INSERT INTO na_invite_log (discord_id, guild_id, server_key, kind, reason, by_id, code, at, link_expires_at)
                VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(String(discord_id), String(guild_id), server_key, kind, reason, by_id ? String(by_id) : null, code, now(), link_expires_at);
}
// Find the intended recipient of a specific invite code.
export function inviteRecipient(code) {
    return db.prepare(`SELECT discord_id FROM na_invite_log WHERE code=? ORDER BY at DESC LIMIT 1`).get(String(code))?.discord_id || null;
}
// A tracked invite for this guild that is STILL within its link-expiry window
// (so it can't have aged out) but is no longer present in the guild's invite
// list → it was CONSUMED. Returns { code, discord_id } of the most recent such
// invite (i.e. the one the joining member used), or null.
export function consumedInvite(guild_id, presentCodes, nowMs) {
    const rows = db.prepare(`SELECT code, discord_id FROM na_invite_log
        WHERE guild_id=? AND link_expires_at IS NOT NULL AND link_expires_at > ?
        ORDER BY at DESC`).all(String(guild_id), nowMs);
    for (const r of rows) if (!presentCodes.has(r.code)) return r;
    return null;
}

// ── Leave watch ──────────────────────────────────────────────────────────────
export function openLeaveWatch(discord_id, guild_id) {
    return db.prepare(`SELECT * FROM na_leavewatch WHERE discord_id=? AND guild_id=? AND resolved=0`).get(String(discord_id), String(guild_id)) || null;
}
export function startLeaveWatch({ discord_id, guild_id, server_key, deadline_at }) {
    if (openLeaveWatch(discord_id, guild_id)) return;
    db.prepare(`INSERT OR IGNORE INTO na_leavewatch (discord_id, guild_id, server_key, left_at, deadline_at, flagged, reinvited, resolved)
                VALUES (?,?,?,?,?,0,0,0)`)
        .run(String(discord_id), String(guild_id), server_key, now(), deadline_at);
}
export function resolveLeaveWatch(discord_id, guild_id) {
    db.prepare(`UPDATE na_leavewatch SET resolved=1, resolved_at=? WHERE discord_id=? AND guild_id=? AND resolved=0`).run(now(), String(discord_id), String(guild_id));
}
export function markLeaveFlagged(id) { db.prepare(`UPDATE na_leavewatch SET flagged=1 WHERE id=?`).run(id); }
export function markLeaveReinvited(id) { db.prepare(`UPDATE na_leavewatch SET reinvited=1 WHERE id=?`).run(id); }
export function openLeaveWatches() {
    return db.prepare(`SELECT * FROM na_leavewatch WHERE resolved=0`).all();
}

// ── Daily-DM throttle (one mandatory-server reminder per day) ─────────────────
export function lastDailyDm(discord_id) {
    return db.prepare(`SELECT last_dm_at FROM na_daily_dm WHERE discord_id=?`).get(String(discord_id))?.last_dm_at || 0;
}
export function setDailyDm(discord_id) {
    db.prepare(`INSERT INTO na_daily_dm (discord_id, last_dm_at) VALUES (?,?)
                ON CONFLICT(discord_id) DO UPDATE SET last_dm_at=excluded.last_dm_at`).run(String(discord_id), now());
}

export default db;
