import { POSITIONS, ALL_MANAGED_ROLES } from './positions.js';
import db from './botDb.js';

/**
 * Apply roles + nickname for a verified member across ALL guilds.
 * Returns detailed per-guild results showing roles added/removed and any failures.
 */
export async function applyVerification(client, discordId, position, nickname, { isProbation = false, overrideAuthLevel = null } = {}) {
  const baseRoles = [...(POSITIONS[position] || []), 'Verified', 'CO Staff'];

  // If on probation, replace the auth level role with one level lower
  let roleNames = baseRoles;
  if (isProbation && !overrideAuthLevel) {
    const authLevelMatch = baseRoles.find(r => r.startsWith('Authorisation Level '));
    if (authLevelMatch) {
      const currentLevel = parseInt(authLevelMatch.replace('Authorisation Level ', ''), 10);
      const probationLevel = Math.max(1, currentLevel - 1);
      const probationRole = `Authorisation Level ${probationLevel}`;
      roleNames = baseRoles.map(r => r === authLevelMatch ? probationRole : r);
    }
  }

  // If override is provided, replace auth level role with the override
  if (overrideAuthLevel) {
    roleNames = roleNames.map(r => r.startsWith('Authorisation Level ') ? `Authorisation Level ${overrideAuthLevel}` : r);
  }

  const results = [];

  for (const [guildId, guild] of client.guilds.cache) {
    const guildResult = {
      guild: guild.name,
      guildId,
      nicknameSet: false,
      nicknameError: null,
      rolesAdded: [],
      rolesAddFailed: [],
      rolesRemoved: [],
      rolesRemoveFailed: [],
      success: true,
      error: null
    };

    try {
      const member = await guild.members.fetch(discordId).catch(() => null);
      if (!member) {
        guildResult.success = false;
        guildResult.error = 'Member not found in this server';
        results.push(guildResult);
        continue;
      }

      // Set nickname
      if (nickname) {
        try {
          await member.setNickname(nickname);
          guildResult.nicknameSet = true;
        } catch (e) {
          guildResult.nicknameError = e.message;
          guildResult.success = false;
        }
      }

      // Get all managed role objects that exist in this guild
      const allManagedInGuild = guild.roles.cache.filter(r => ALL_MANAGED_ROLES.includes(r.name));
      const toAssign = guild.roles.cache.filter(r => roleNames.includes(r.name));
      const toRemove = allManagedInGuild.filter(r => !roleNames.includes(r.name));

      // Remove old CO roles — track individual failures
      if (toRemove.size > 0) {
        const removeResult = await member.roles.remove(toRemove).catch(e => ({ error: e.message }));
        if (removeResult.error) {
          guildResult.rolesRemoveFailed = toRemove.map(r => r.name);
          guildResult.success = false;
          guildResult.error = removeResult.error;
        } else {
          guildResult.rolesRemoved = toRemove.map(r => r.name);
        }
      }

      // Add new roles — track individual failures
      if (toAssign.size > 0) {
        const addResult = await member.roles.add(toAssign).catch(e => ({ error: e.message }));
        if (addResult.error) {
          guildResult.rolesAddFailed = toAssign.map(r => r.name);
          guildResult.success = false;
          guildResult.error = addResult.error;
        } else {
          guildResult.rolesAdded = toAssign.map(r => r.name);
        }
      }

      results.push(guildResult);
    } catch (e) {
      guildResult.success = false;
      guildResult.error = e.message;
      results.push(guildResult);
    }
  }

  const successCount = results.filter(r => r.success).length;
  console.log(`[Verify] Applied for ${discordId} (${position}) — ${successCount}/${results.length} guilds OK`);
  return results;
}

/**
 * Strip all CO roles + reset nickname across ALL guilds.
 * Returns detailed per-guild results showing roles removed and any failures.
 */
export async function stripVerification(client, discordId, username) {
  const results = [];

  for (const [guildId, guild] of client.guilds.cache) {
    const guildResult = {
      guild: guild.name,
      guildId,
      nicknameReset: false,
      nicknameError: null,
      rolesRemoved: [],
      rolesRemoveFailed: [],
      success: true,
      error: null
    };

    try {
      const member = await guild.members.fetch(discordId).catch(() => null);
      if (!member) {
        guildResult.success = false;
        guildResult.error = 'Member not found in this server';
        results.push(guildResult);
        continue;
      }

      // Reset nickname to username
      if (username !== undefined) {
        try {
          await member.setNickname(username || null);
          guildResult.nicknameReset = true;
        } catch (e) {
          guildResult.nicknameError = e.message;
          guildResult.success = false;
        }
      }

      // Remove all managed CO roles — track individual failures
      const toRemove = guild.roles.cache.filter(r => ALL_MANAGED_ROLES.includes(r.name));
      if (toRemove.size > 0) {
        const removeResult = await member.roles.remove(toRemove).catch(e => ({ error: e.message }));
        if (removeResult.error) {
          guildResult.rolesRemoveFailed = toRemove.map(r => r.name);
          guildResult.success = false;
          guildResult.error = removeResult.error;
        } else {
          guildResult.rolesRemoved = toRemove.map(r => r.name);
        }
      }

      results.push(guildResult);
    } catch (e) {
      guildResult.success = false;
      guildResult.error = e.message;
      results.push(guildResult);
    }
  }

  const successCount = results.filter(r => r.success).length;
  console.log(`[Unverify] Stripped for ${discordId} — ${successCount}/${results.length} guilds OK`);
  return results;
}

// Get or create the verification-queue channel — searches all guilds, creates in first available
export async function getOrCreateVerificationChannel(client) {
  const stored = db.prepare("SELECT value FROM bot_config WHERE key = 'verification_channel_id'").get();
  if (stored) {
    const ch = await client.channels.fetch(stored.value).catch(() => null);
    if (ch) return ch;
  }

  // Create in the first guild where we have permission
  for (const [guildId, guild] of client.guilds.cache) {
    try {
      const existing = guild.channels.cache.find(c => c.name === 'verification-queue');
      if (existing) {
        db.prepare("INSERT OR REPLACE INTO bot_config (key, value) VALUES ('verification_channel_id', ?)").run(existing.id);
        return existing;
      }
      const created = await guild.channels.create({
        name: 'verification-queue',
        topic: 'CO Staff verification and unverification requests',
        permissionOverwrites: [{ id: guild.roles.everyone, deny: ['ViewChannel'] }]
      });
      db.prepare("INSERT OR REPLACE INTO bot_config (key, value) VALUES ('verification_channel_id', ?)").run(created.id);
      console.log('[Verify] Created verification-queue channel in', guild.name);
      return created;
    } catch (e) {
      console.warn('[Verify] Could not create channel in', guild.name, e.message);
    }
  }
  throw new Error('Could not find or create verification-queue channel in any guild');
}

// Check if a Discord user exists in the portal and return their data
export async function getPortalUser(discordId) {
  const secret = process.env.BOT_WEBHOOK_SECRET;
  const res = await fetch(`http://localhost:3016/api/staff/by-discord/${discordId}`, {
    headers: { 'x-bot-secret': secret }
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.user || data || null;
}

// Check if caller is a superuser via portal
export async function isSuperuser(discordId) {
  const user = await getPortalUser(discordId);
  return user && Number(user.auth_level) >= 99;
}
