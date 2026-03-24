import { ALL_SERVER_IDS, STAFF_HQ_ID, SUSPENDED_ROLE_ID, UNDER_INVESTIGATION_ROLE_ID } from '../config.js';

export async function removeAllStaffRoles(client, discordId, reason = 'Staff action') {
  const results = [];
  for (const serverId of ALL_SERVER_IDS) {
    try {
      const guild = await client.guilds.fetch(serverId).catch(() => null);
      if (!guild) continue;
      const member = await guild.members.fetch(discordId).catch(() => null);
      if (!member) continue;
      const { POSITIONS } = await import('./positions.js');
  const allRoleNames = new Set(Object.values(POSITIONS).flat());
      const rolesToRemove = member.roles.cache.filter(r => allRoleNames.has(r.name));
      for (const [, role] of rolesToRemove) {
        await member.roles.remove(role, reason).catch(e => console.error(`[RoleManager] Failed to remove ${role.name}:`, e.message));
      }
      results.push({ serverId, removed: rolesToRemove.size });
    } catch (e) {
      console.error(`[RoleManager] Error in server ${serverId}:`, e.message);
    }
  }
  return results;
}

export async function addSuspendedRole(client, discordId) {
  try {
    const guild = await client.guilds.fetch(STAFF_HQ_ID);
    const member = await guild.members.fetch(discordId);
    await member.roles.add(SUSPENDED_ROLE_ID, 'Suspension applied');
    return true;
  } catch (e) {
    console.error('[RoleManager] addSuspendedRole error:', e.message);
    return false;
  }
}

export async function removeSuspendedRole(client, discordId) {
  try {
    const guild = await client.guilds.fetch(STAFF_HQ_ID);
    const member = await guild.members.fetch(discordId);
    await member.roles.remove(SUSPENDED_ROLE_ID, 'Suspension lifted');
    return true;
  } catch (e) {
    console.error('[RoleManager] removeSuspendedRole error:', e.message);
    return false;
  }
}

export async function addInvestigationRole(client, discordId) {
  try {
    const guild = await client.guilds.fetch(STAFF_HQ_ID);
    const member = await guild.members.fetch(discordId);
    await member.roles.add(UNDER_INVESTIGATION_ROLE_ID, 'Investigation started');
    return true;
  } catch (e) {
    console.error('[RoleManager] addInvestigationRole error:', e.message);
    return false;
  }
}

export async function removeInvestigationRole(client, discordId) {
  try {
    const guild = await client.guilds.fetch(STAFF_HQ_ID);
    const member = await guild.members.fetch(discordId);
    await member.roles.remove(UNDER_INVESTIGATION_ROLE_ID, 'Investigation ended');
    return true;
  } catch (e) {
    console.error('[RoleManager] removeInvestigationRole error:', e.message);
    return false;
  }
}

export async function restorePositionRoles(client, discordId, position) {
  const { POSITIONS } = await import('./positions.js');
  const roleNames = POSITIONS[position] || [];
  if (!roleNames.length) return;
  for (const serverId of ALL_SERVER_IDS) {
    try {
      const guild = await client.guilds.fetch(serverId).catch(() => null);
      if (!guild) continue;
      const member = await guild.members.fetch(discordId).catch(() => null);
      if (!member) continue;
      for (const roleName of roleNames) {
        const role = guild.roles.cache.find(r => r.name === roleName);
        if (role) await member.roles.add(role, 'Position roles restored').catch(() => {});
      }
    } catch (e) {
      console.error(`[RoleManager] restorePositionRoles error in ${serverId}:`, e.message);
    }
  }
}

export async function kickFromAllServers(client, discordId, reason) {
  for (const serverId of ALL_SERVER_IDS) {
    try {
      const guild = await client.guilds.fetch(serverId).catch(() => null);
      if (!guild) continue;
      const member = await guild.members.fetch(discordId).catch(() => null);
      if (!member) continue;
      await member.kick(reason);
    } catch (e) {
      console.error(`[RoleManager] kick error in ${serverId}:`, e.message);
    }
  }
}

// Get or create a role by name in a guild
async function getOrCreateRole(guild, roleName) {
  const existing = guild.roles.cache.find(r => r.name === roleName);
  if (existing) return existing;
  try {
    const created = await guild.roles.create({ name: roleName, reason: 'CO Bot auto-created role' });
    console.log('[RoleManager] Created role:', roleName, 'in', guild.name);
    return created;
  } catch (e) {
    console.warn('[RoleManager] Could not create role', roleName, 'in', guild.name, e.message);
    return null;
  }
}

// Suspend: strip all CO + verified roles, add Suspended across all guilds
export async function suspendAcrossGuilds(client, discordId) {
  const { ALL_MANAGED_ROLES } = await import('./positions.js');
  const allManaged = [...ALL_MANAGED_ROLES, 'Verified', 'CO Staff'];

  for (const [guildId, guild] of client.guilds.cache) {
    try {
      const member = await guild.members.fetch(discordId).catch(() => null);
      if (!member) continue;

      // Remove all CO roles
      const toRemove = guild.roles.cache.filter(r => allManaged.includes(r.name));
      if (toRemove.size > 0) await member.roles.remove(toRemove).catch(e => console.warn('[Suspend] Remove error in', guild.name, e.message));

      // Add Suspended role (create if missing)
      const suspendedRole = await getOrCreateRole(guild, 'Suspended');
      if (suspendedRole) await member.roles.add(suspendedRole).catch(e => console.warn('[Suspend] Add error in', guild.name, e.message));

      console.log('[Suspend] Applied in', guild.name);
    } catch (e) {
      console.error('[Suspend] Error in', guild.name, e.message);
    }
  }
}

// Unsuspend: remove Suspended, re-apply verification roles from verified_members
export async function unsuspendAcrossGuilds(client, discordId, botDb) {
  const { POSITIONS } = await import('./positions.js');

  const verified = botDb.prepare("SELECT * FROM verified_members WHERE discord_id = ?").get(discordId);

  for (const [guildId, guild] of client.guilds.cache) {
    try {
      const member = await guild.members.fetch(discordId).catch(() => null);
      if (!member) continue;

      // Remove Suspended role
      const suspendedRole = guild.roles.cache.find(r => r.name === 'Suspended');
      if (suspendedRole) await member.roles.remove(suspendedRole).catch(() => {});

      // Re-apply verification roles if verified
      if (verified) {
        const roleNames = [...(POSITIONS[verified.position] || []), 'Verified', 'CO Staff'];
        const toAdd = guild.roles.cache.filter(r => roleNames.includes(r.name));
        if (toAdd.size > 0) await member.roles.add(toAdd).catch(e => console.warn('[Unsuspend] Add error in', guild.name, e.message));
        await member.setNickname(verified.nickname || null).catch(() => {});
      }

      console.log('[Unsuspend] Applied in', guild.name);
    } catch (e) {
      console.error('[Unsuspend] Error in', guild.name, e.message);
    }
  }
}

// Terminate: kick from most servers, strip to Member-only in appeals/network servers
const KEEP_SERVERS = ['1485423935569920135', '1485424535405723729'];

export async function terminateAcrossGuilds(client, discordId, botDb) {
  const { ALL_MANAGED_ROLES } = await import('./positions.js');
  const allManaged = [...ALL_MANAGED_ROLES, 'Verified', 'CO Staff', 'Suspended'];

  for (const [guildId, guild] of client.guilds.cache) {
    try {
      const member = await guild.members.fetch(discordId).catch(() => null);
      if (!member) continue;

      if (KEEP_SERVERS.includes(guildId)) {
        // Strip all CO roles, keep only Member
        const toRemove = guild.roles.cache.filter(r => allManaged.includes(r.name));
        if (toRemove.size > 0) await member.roles.remove(toRemove).catch(e => console.warn('[Terminate] Remove error in', guild.name, e.message));
        await member.setNickname(null).catch(() => {});
        console.log('[Terminate] Stripped roles in keep-server:', guild.name);
      } else {
        // Kick from all other servers
        await member.kick('CO Staff termination').catch(e => console.warn('[Terminate] Kick error in', guild.name, e.message));
        console.log('[Terminate] Kicked from', guild.name);
      }
    } catch (e) {
      console.error('[Terminate] Error in', guild.name, e.message);
    }
  }

  // Remove from verified_members
  botDb.prepare("DELETE FROM verified_members WHERE discord_id = ?").run(discordId);
}
