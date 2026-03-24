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
    WHERE account_status = 'active'
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

export function getPendingLeaveRequests(userId) {
  return db.prepare(`
    SELECT * FROM leave_requests 
    WHERE user_id = ? AND status = 'pending'
    ORDER BY created_at DESC LIMIT 5
  `).all(userId);
}
