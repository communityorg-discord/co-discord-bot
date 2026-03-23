import { SUPERUSER_IDS } from '../config.js';
import { getUserByDiscordId } from '../db.js';

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

export function canRunCommand(discordId, requiredLevel, guild) {
  if (isSuperuser(discordId)) return { allowed: true, reason: 'Superuser' };
  const user = getPortalUser(discordId);
  if (!user) return { allowed: false, reason: 'Your Discord account is not linked to the CO Staff Portal.' };
  if ((user.auth_level || 0) < requiredLevel) return { allowed: false, reason: `This command requires Auth Level ${requiredLevel}+. Your level: ${user.auth_level || 0}` };
  return { allowed: true, reason: 'OK' };
}

export function requiresSuperuserWarning(targetDiscordId) {
  return SUPERUSER_IDS.includes(String(targetDiscordId));
}
