// Wire co-discord-bot's "private" log scope to the CO | Private Server, and tidy
// its log channels. Idempotent — safe to re-run.
//
// WHAT IT DOES
//   1. Maps every per-type log (moderation/verification/message/misc/role/
//      membership/email) to the matching #channel in CO | Private Server and
//      writes the binding as guild_id='private' rows in bot-data.db.log_config
//      — exactly what `/privatelogs` would write. Also binds each category's
//      catch-all (#all-… channel) via global_log_config (guild_id='private').
//      This makes CO logs actually flow into the Private Server.
//   2. Re-parents the seven "#all-…" summary channels from the "Catch All Logs"
//      bucket to the TOP of their own category, and files #all-logs under
//      "Catch All Logs". Routing is by channel ID, so this is purely cosmetic
//      and never breaks bindings.
//
// Run from co-discord-bot/:  node scripts/wire-private-logs.mjs

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';

const GUILD = '1485423682980675729'; // CO | Private Server
const env = (k) => { const l = readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').find(x => x.startsWith(k + '=')); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, '') : null; };
const TOKEN = env('DISCORD_BOT_TOKEN');

// (category, type) -> channel name in the Private Server
const TYPE_CHANNEL = {
  moderation: {
    ban_unban: 'ban-unban-logs', gban_ungban: 'gban-ungban-logs', suspend_unsuspend: 'suspend-unsuspend-logs',
    terminate: 'terminate-logs', strike: 'strike-logs', infractions_cases: 'infractions-cases-logs',
    investigation: 'investigation-logs', purge_scribe: 'purge-scribe-logs', cooldown: 'cooldown-logs', mass_unban: 'mass-unban-logs',
  },
  verification: { verify_unverify: 'verify-unverify-logs', dm: 'dm-logs' },
  message: { message_delete: 'delete-message-logs', message_edit: 'edit-message-logs' },
  misc: { brag: 'brag-logs', staff: 'staff-logs', user: 'user-logs', nid: 'nid-logs', case_action: 'case-action-logs' },
  role_management: {
    role_create: 'role-created-logs', role_delete: 'role-deleted-logs', role_update: 'role-updated-logs',
    role_permission: 'role-permission-update-logs', member_role_add: 'member-role-added-logs', member_role_remove: 'member-role-removed-logs',
  },
  membership: { member_join: 'member-join-logs', member_leave: 'member-leave-logs' },
  email: { email_log: 'email-activity-logs' },
};
// catch-all key -> #all-… channel name + the category whose section it heads
const CATCHALL_CHANNEL = {
  global_moderation: 'all-mod-logs', global_message: 'all-message-logs', global_verification: 'all-verification-logs',
  global_role_management: 'all-role-management-logs', global_membership: 'all-membership', global_misc: 'all-miscellaneous',
  global_email_log: 'all-email',
};
// which existing category each "#all-…" channel should sit atop (by category channel name)
const ALL_TO_CATEGORY = {
  'all-mod-logs': 'Moderation', 'all-message-logs': 'Message Activity', 'all-verification-logs': 'Verification',
  'all-role-management-logs': 'Role Management', 'all-membership': 'Membership', 'all-miscellaneous': 'Miscellaneous',
  'all-email': 'Email', 'all-logs': 'Catch All Logs',
};

const api = async (method, path, body) => {
  const r = await fetch('https://discord.com/api/v10' + path, { method, headers: { Authorization: 'Bot ' + TOKEN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { ok: r.ok, status: r.status, json: await r.json().catch(() => null) };
};

// ── fetch live channels ──
const channels = (await api('GET', `/guilds/${GUILD}/channels`)).json;
const byName = {}; const catId = {};
for (const c of channels) { if (c.type === 0) byName[c.name] = c.id; if (c.type === 4) catId[c.name] = c.id; }

// ── 1. wire private-scope routing ──
const db = new Database('bot-data.db');
db.pragma('busy_timeout = 8000');
const upsertType = db.prepare(`INSERT INTO log_config (guild_id, category, type, channel_id, log_scope, updated_at)
  VALUES ('private', ?, ?, ?, 'server', CURRENT_TIMESTAMP)
  ON CONFLICT(guild_id, category, type) DO UPDATE SET channel_id = excluded.channel_id, updated_at = CURRENT_TIMESTAMP`);
const upGlobal = db.prepare(`UPDATE global_log_config SET channel_id = ?, updated_at = CURRENT_TIMESTAMP WHERE category = ? AND guild_id = 'private'`);
const insGlobal = db.prepare(`INSERT OR IGNORE INTO global_log_config (category, channel_id, guild_id, updated_at) VALUES (?, ?, 'private', CURRENT_TIMESTAMP)`);

let typeBound = 0, missing = [];
for (const [cat, types] of Object.entries(TYPE_CHANNEL)) {
  for (const [type, chName] of Object.entries(types)) {
    const id = byName[chName];
    if (!id) { missing.push(`${cat}/${type} (#${chName})`); continue; }
    upsertType.run(cat, type, id); typeBound++;
  }
}
let catchBound = 0;
for (const [key, chName] of Object.entries(CATCHALL_CHANNEL)) {
  const id = byName[chName];
  if (!id) { missing.push(`${key} (#${chName})`); continue; }
  if (upGlobal.run(id, key).changes === 0) insGlobal.run(key, id);
  catchBound++;
}
db.close();
console.log(`Wired private-scope routing: ${typeBound} per-type + ${catchBound} catch-all bindings.`);
if (missing.length) console.log('  MISSING channels (skipped):', missing.join(', '));

// ── 2. tidy: move each #all-… channel atop its category ──
let moved = 0;
for (const [chName, catName] of Object.entries(ALL_TO_CATEGORY)) {
  const id = byName[chName]; const parent = catId[catName];
  if (!id || !parent) { console.log(`  skip move ${chName} -> ${catName} (missing)`); continue; }
  const r = await api('PATCH', `/channels/${id}`, { parent_id: parent, position: 0 });
  console.log(`  moved #${chName} -> [${catName}] (${r.ok ? 'ok' : r.status})`);
  if (r.ok) moved++;
  await new Promise(res => setTimeout(res, 350));
}
console.log(`Re-parented ${moved} summary channels.`);
console.log('DONE.');
