import { POSITIONS, ALL_MANAGED_ROLES } from './positions.js';
import db from './botDb.js';

// Apply roles + nickname for a verified member across ALL guilds
export async function applyVerification(client, discordId, position, nickname) {
  const roleNames = POSITIONS[position] || [];
  const results = [];

  for (const [guildId, guild] of client.guilds.cache) {
    try {
      const member = await guild.members.fetch(discordId).catch(() => null);
      if (!member) continue;

      // Set nickname
      try {
        await member.setNickname(nickname);
      } catch (e) {
        console.warn(`[Verify] Could not set nickname in ${guild.name}:`, e.message);
      }

      // Get all managed role objects that exist in this guild
      const allManagedInGuild = guild.roles.cache.filter(r => ALL_MANAGED_ROLES.includes(r.name));
      const toAssign = guild.roles.cache.filter(r => roleNames.includes(r.name));
      const toRemove = allManagedInGuild.filter(r => !roleNames.includes(r.name));

      // Remove old CO roles
      if (toRemove.size > 0) {
        await member.roles.remove(toRemove).catch(e => console.warn(`[Verify] Remove roles error in ${guild.name}:`, e.message));
      }
      // Add new roles
      if (toAssign.size > 0) {
        await member.roles.add(toAssign).catch(e => console.warn(`[Verify] Add roles error in ${guild.name}:`, e.message));
      }

      results.push({ guild: guild.name, success: true });
    } catch (e) {
      console.error(`[Verify] Error in guild ${guild.name}:`, e.message);
      results.push({ guild: guild.name, success: false, error: e.message });
    }
  }

  console.log(`[Verify] Applied verification for ${discordId} (${position}) across ${results.length} guilds`);
  return results;
}

// Strip all CO roles + reset nickname across ALL guilds
export async function stripVerification(client, discordId, username) {
  const results = [];

  for (const [guildId, guild] of client.guilds.cache) {
    try {
      const member = await guild.members.fetch(discordId).catch(() => null);
      if (!member) continue;

      // Reset nickname to username
      try {
        await member.setNickname(username || null);
      } catch (e) {
        console.warn(`[Unverify] Could not reset nickname in ${guild.name}:`, e.message);
      }

      // Remove all managed CO roles
      const toRemove = guild.roles.cache.filter(r => ALL_MANAGED_ROLES.includes(r.name));
      if (toRemove.size > 0) {
        await member.roles.remove(toRemove).catch(e => console.warn(`[Unverify] Remove roles error in ${guild.name}:`, e.message));
      }

      results.push({ guild: guild.name, success: true });
    } catch (e) {
      console.error(`[Unverify] Error in guild ${guild.name}:`, e.message);
      results.push({ guild: guild.name, success: false, error: e.message });
    }
  }

  console.log(`[Unverify] Stripped verification for ${discordId} across ${results.length} guilds`);
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
