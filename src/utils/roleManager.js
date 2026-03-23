import { POSITION_ROLES, ALL_SERVER_IDS, STAFF_HQ_ID, SUSPENDED_ROLE_ID, UNDER_INVESTIGATION_ROLE_ID } from '../config.js';

export async function removeAllStaffRoles(client, discordId, reason = 'Staff action') {
  const results = [];
  for (const serverId of ALL_SERVER_IDS) {
    try {
      const guild = await client.guilds.fetch(serverId).catch(() => null);
      if (!guild) continue;
      const member = await guild.members.fetch(discordId).catch(() => null);
      if (!member) continue;
      const allRoleNames = new Set(Object.values(POSITION_ROLES).flat());
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
  const roleNames = POSITION_ROLES[position] || [];
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
