import Database from 'better-sqlite3';
import { config } from 'dotenv';
config();

const db = new Database(process.env.PORTAL_DB_PATH, { readonly: true });
export default db;

export function getUserByDiscordId(discordId) {
  return db.prepare('SELECT * FROM users WHERE discord_id = ?').get(String(discordId));
}

export function getUserById(userId) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

export function getBragStatus(userId) {
  // brag_reports uses discord_id not user_id — get user first
  const user = db.prepare('SELECT discord_id FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  return db.prepare(`
    SELECT * FROM brag_reports 
    WHERE discord_id = ? 
    ORDER BY submitted_at DESC LIMIT 1
  `).get(user.discord_id);
}

export function getLeaveBalance(userId) {
  return db.prepare('SELECT * FROM staff_leave WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(userId);
}

export function getStaffByName(query) {
  return db.prepare(`
    SELECT id, display_name, full_name, username, position, department, discord_id
    FROM users 
    WHERE lower(account_status) = 'active'
    AND (display_name LIKE ? OR full_name LIKE ? OR username LIKE ?)
    LIMIT 5
  `).all(`%${query}%`, `%${query}%`, `%${query}%`);
}

export function getRecentCases(userId) {
  return db.prepare(`
    SELECT case_number, case_type, status, stage, subject, created_at
    FROM cases
    WHERE raised_by = ? OR assigned_to = ?
    ORDER BY created_at DESC LIMIT 5
  `).all(userId, userId);
}

// ─── Help Desk ────────────────────────────────────────────────

export function getHelpdeskTicketByRef(ref) {
  return db.prepare(`
    SELECT t.*, u.username AS submitter_username,
           COALESCE(u.display_name, u.full_name) AS submitter_name
    FROM helpdesk_tickets t
    LEFT JOIN users u ON u.id = t.user_id
    WHERE t.ticket_ref = ? COLLATE NOCASE
  `).get(ref);
}

export function getRecentHelpdeskTickets(userId, { limit = 5 } = {}) {
  return db.prepare(`
    SELECT ticket_ref, type, title, status, priority, created_at, escalated, sla_breached
    FROM helpdesk_tickets
    WHERE user_id = ? OR assigned_to = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(userId, userId, limit);
}

// Map team names to abbreviations used in position titles like "Under Secretary-General (IC)"
const TEAM_ABBREVS = {
  'International Court': 'IC',
  'Department for Safety and Security': 'DSS',
  'Department of Management Strategy, Policy and Compliance': 'DMSPC',
  'Department of Communications and Operational Support': 'DCOS',
  'Department of General Assembly and Conference Management': 'DGACM',
};

export function getTeamMembers(department) {
  // Get direct department members
  const direct = db.prepare(`
    SELECT id, display_name, username, position, department, discord_id
    FROM users
    WHERE lower(account_status) = 'active'
    AND department = ?
    ORDER BY display_name ASC
  `).all(department);

  // Also get USGs/ASGs whose position contains the team abbreviation
  const abbrev = TEAM_ABBREVS[department];
  let leaders = [];
  if (abbrev) {
    leaders = db.prepare(`
      SELECT id, display_name, username, position, department, discord_id
      FROM users
      WHERE lower(account_status) = 'active'
      AND position LIKE ?
      AND department != ?
    `).all(`%(${abbrev})%`, department);
  }

  // For EOB/BOD — also include members whose department matches directly
  // (already handled by the first query)

  // Deduplicate by id
  const seen = new Set();
  const result = [];
  for (const m of [...direct, ...leaders]) {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      result.push(m);
    }
  }
  return result;
}

export function getPendingLeaveRequests(userId) {
  return db.prepare(`
    SELECT * FROM leave_requests 
    WHERE user_id = ? AND status = 'pending'
    ORDER BY created_at DESC LIMIT 5
  `).all(userId);
}
