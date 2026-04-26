// Central permission helpers for slash commands.
// Source of truth for who can use what:
//   1. SUPERUSER_IDS — always allowed (hardcoded in src/config.js).
//   2. command_permissions table — admin-managed via the portal's
//      Access Control → Bot Permissions tab. Per-user or per-role grants.
//   3. Documented fallback — each command file contains a top-of-file
//      comment "// COMMAND_PERMISSION_FALLBACK: <kind>" that captures
//      the historical auth logic. The fallback applies ONLY when the
//      table has zero rows for that command. As soon as an admin sets
//      even one row, the table becomes the source of truth.
//
// Fallback kinds supported:
//   superuser_only           — only SUPERUSER_IDS
//   everyone                 — anyone in any guild the bot is in
//   auth_level >= N          — portal-linked users with auth_level >= N
//   role:<discord role name> — members with a role of that exact name
//                              in their current guild
//   role_id:<id>             — members with that role id (any guild)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPERUSER_IDS } from '../config.js';
import { getUserByDiscordId } from '../db.js';
import { commandHasAnyRows, commandPermitsUser } from './botDb.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const COMMANDS_DIR = path.join(__dirname, '..', 'commands');

// Map: <command-name> | <command-name>:<sub> → fallback descriptor
const FALLBACK_MAP = (() => {
  const out = new Map();
  try {
    const files = fs.readdirSync(COMMANDS_DIR).filter(f => f.endsWith('.js'));
    for (const f of files) {
      const src = fs.readFileSync(path.join(COMMANDS_DIR, f), 'utf8');
      const nameMatch = src.match(/setName\(\s*['"]([^'"]+)['"]\s*\)/);
      if (!nameMatch) continue;
      const baseName = nameMatch[1];
      // "// COMMAND_PERMISSION_FALLBACK: <kind>"  (default for the command)
      // "// COMMAND_PERMISSION_FALLBACK[<sub>]: <kind>"  (subcommand-specific)
      const re = /\/\/\s*COMMAND_PERMISSION_FALLBACK(?:\[([^\]]+)\])?\s*:\s*([^\n\r]+)/gi;
      let m;
      while ((m = re.exec(src))) {
        const sub = m[1] ? m[1].trim() : '';
        const kind = m[2].trim();
        const key = sub ? `${baseName}:${sub}` : baseName;
        out.set(key, kind);
      }
    }
  } catch (e) {
    console.error('[permissions] Failed to build fallback map:', e.message);
  }
  return out;
})();

export function isSuperuser(discordId) {
  return SUPERUSER_IDS.includes(String(discordId));
}

export function getPortalUser(discordId) {
  return getUserByDiscordId(discordId);
}

export function hasPortalAuth(discordId, minLevel) {
  const user = getPortalUser(discordId);
  return user && (user.auth_level || 0) >= minLevel;
}

function memberRoleIds(interaction) {
  try {
    const roles = interaction?.member?.roles;
    if (!roles) return [];
    if (typeof roles.cache?.map === 'function') return roles.cache.map(r => r.id);
    if (Array.isArray(roles)) return roles.map(String);
  } catch {}
  return [];
}

function memberRoleNames(interaction) {
  try {
    const roles = interaction?.member?.roles?.cache;
    if (!roles) return [];
    return roles.map(r => r.name);
  } catch {}
  return [];
}

function applyFallback(commandKey, interaction, discordId) {
  const fallback = FALLBACK_MAP.get(commandKey);
  if (!fallback) return false;
  const f = fallback.toLowerCase().trim();
  if (f === 'superuser_only') return false; // already short-circuited above
  if (f === 'everyone' || f === 'public') return true;
  const lvlMatch = f.match(/^auth_level\s*>=\s*(\d+)$/);
  if (lvlMatch) return hasPortalAuth(discordId, Number(lvlMatch[1]));
  const roleNameMatch = f.match(/^role:(.+)$/);
  if (roleNameMatch) {
    const target = roleNameMatch[1].trim().toLowerCase();
    return memberRoleNames(interaction).some(n => String(n || '').toLowerCase() === target);
  }
  const roleIdMatch = f.match(/^role_id:(\d+)$/);
  if (roleIdMatch) return memberRoleIds(interaction).includes(roleIdMatch[1]);
  return false;
}

// canUseCommand(commandName, interaction)
// Returns { allowed: boolean, reason: string }.
// commandName: 'foo' or 'foo:bar' (subcommand). Most-specific first;
// falls back to the base command name if no rows / no fallback for the sub.
export async function canUseCommand(commandName, interaction) {
  const discordId = String(interaction?.user?.id || '');
  if (!discordId) return { allowed: false, reason: 'No user context.' };
  if (isSuperuser(discordId)) return { allowed: true, reason: 'Superuser bypass' };

  const candidates = [commandName];
  if (commandName.includes(':')) candidates.push(commandName.split(':')[0]);

  for (const key of candidates) {
    if (commandHasAnyRows(key)) {
      const roleIds = memberRoleIds(interaction);
      const ok = commandPermitsUser(key, discordId, roleIds);
      return ok
        ? { allowed: true, reason: `Granted via Bot Permissions (${key})` }
        : { allowed: false, reason: `You don't have permission to use /${commandName.replace(':', ' ')}.` };
    }
  }
  for (const key of candidates) {
    if (FALLBACK_MAP.has(key)) {
      const ok = applyFallback(key, interaction, discordId);
      return ok
        ? { allowed: true, reason: `Granted via fallback (${key})` }
        : { allowed: false, reason: `You don't have permission to use /${commandName.replace(':', ' ')}.` };
    }
  }
  return { allowed: false, reason: `You don't have permission to use /${commandName.replace(':', ' ')}.` };
}

// Legacy shim — old call sites used canRunCommand(discordId, level, guild).
export function canRunCommand(discordId, requiredLevel /*, guild */) {
  if (isSuperuser(discordId)) return { allowed: true, reason: 'Superuser' };
  if (hasPortalAuth(discordId, requiredLevel)) return { allowed: true, reason: 'OK' };
  const user = getPortalUser(discordId);
  if (!user) return { allowed: false, reason: 'Your Discord account is not linked to the CO Staff Portal.' };
  return { allowed: false, reason: `This command requires Auth Level ${requiredLevel}+. Your level: ${user.auth_level || 0}` };
}

export function requiresSuperuserWarning(targetDiscordId) {
  return SUPERUSER_IDS.includes(String(targetDiscordId));
}

// For the management UI: list every command-key the bot knows about,
// each with its documented fallback string. Used by the portal's Bot
// Permissions tab to enumerate commands alongside current grants.
export function listKnownCommands() {
  const out = [];
  for (const [key, fallback] of FALLBACK_MAP.entries()) {
    out.push({ name: key, fallback });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
