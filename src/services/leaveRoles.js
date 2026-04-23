import { POSITIONS, ALL_MANAGED_ROLES } from '../utils/positions.js';
import { storeRoles, getStoredRoles, deleteStoredRoles, createActingAssignment, getActiveActingByLeave, endActingAssignment, activateActingAssignment } from '../utils/botDb.js';
import { getUserByDiscordId } from '../db.js';
import { logAction } from '../utils/logger.js';
import { ALL_SERVER_IDS } from '../config.js';

const ON_LEAVE_ROLE_NAME = 'On Leave';

const MANAGER_POSITIONS = [
  'Director', 'Manager', 'Supervisor', 'Secretary-General', 'Deputy Secretary-General',
  'Chef de Cabinet', 'Director-General', 'Chief Operations Officer',
  'Under Secretary-General', 'Assistant Secretary-General',
  'President', 'Vice-President', 'Senior Advisor'
];

function isManagerPosition(position) {
  if (!position) return false;
  return MANAGER_POSITIONS.some(t => position.includes(t));
}

// ── Apply On Leave role across all guilds ────────────────────────────────────

export async function applyLeaveRole(client, leave, portalDb) {
  const results = [];

  for (const guild of client.guilds.cache.values()) {
    try {
      const member = await guild.members.fetch(leave.discord_id).catch(() => null);
      if (!member) continue;

      const onLeaveRole = guild.roles.cache.find(r => r.name === ON_LEAVE_ROLE_NAME);
      if (!onLeaveRole) {
        console.warn(`[Leave] No "${ON_LEAVE_ROLE_NAME}" role in ${guild.name}`);
        continue;
      }

      // Store current roles
      const currentRoles = member.roles.cache.filter(r => r.id !== guild.id).map(r => r.id);
      storeRoles(leave.discord_id, guild.id, currentRoles, member.nickname, `leave_${leave.id}`);

      // Set to On Leave role only
      await member.roles.set([onLeaveRole.id]).catch(e => console.error('[Leave] Role set failed:', e.message));

      // Update nickname
      const baseName = (member.nickname || member.user.username).replace(/ \(On Leave\)$/, '');
      await member.setNickname(`${baseName} (On Leave)`.slice(0, 32)).catch(() => {});

      results.push({ guild: guild.name, success: true });
    } catch (e) {
      console.error(`[Leave] Failed in ${guild.name}:`, e.message);
      results.push({ guild: guild.name, success: false, error: e.message });
    }
  }

  // Mark as applied in portal
  if (portalDb) {
    try { await portalDb.run('UPDATE leave_requests SET discord_role_applied = 1 WHERE id = ?', [leave.id]); } catch {}
  }

  // Log
  await logAction(client, {
    action: '🏖️ Leave Role Applied',
    moderator: { discordId: 'SYSTEM', name: 'Leave System' },
    target: { discordId: leave.discord_id, name: leave.display_name || leave.full_name || leave.discord_id },
    reason: `${leave.leave_type} leave: ${leave.start_date} to ${leave.end_date}`,
    color: 0xF59E0B,
    fields: [
      { name: 'Leave Type', value: leave.leave_type || 'Unknown', inline: true },
      { name: 'Period', value: `${leave.start_date} to ${leave.end_date}`, inline: true },
    ],
    logType: 'moderation.suspend_unsuspend'
  });

  // DM the person
  try {
    const user = await client.users.fetch(leave.discord_id);
    await user.send({ embeds: [{
      title: '🏖️ Leave Started',
      color: 0xF59E0B,
      description: `Your **${leave.leave_type}** has started. Your Discord roles have been updated to **On Leave** across all servers.\n\nYour roles will be automatically restored when your leave ends on **${leave.end_date}**.`,
      footer: { text: 'Community Organisation | Leave Management' },
      timestamp: new Date().toISOString()
    }]});
  } catch {}

  return results;
}

// ── Apply acting roles for a position ────────────────────────────────────────

export async function applyActingRoles(client, actingDiscordId, position, leaveRequestId, onLeaveDiscordId, assignedBy) {
  const positionRoles = POSITIONS[position] || [];
  if (positionRoles.length === 0) {
    console.warn(`[Acting] No roles mapped for position: ${position}`);
    return;
  }

  const rolesApplied = {};

  for (const guild of client.guilds.cache.values()) {
    try {
      const member = await guild.members.fetch(actingDiscordId).catch(() => null);
      if (!member) continue;

      // Store current roles
      const currentRoles = member.roles.cache.filter(r => r.id !== guild.id).map(r => r.id);
      storeRoles(actingDiscordId, guild.id, currentRoles, member.nickname, `acting_${leaveRequestId}`);

      // Add position roles on top of existing
      const addedIds = [];
      for (const roleName of positionRoles) {
        const role = guild.roles.cache.find(r => r.name === roleName);
        if (role && !member.roles.cache.has(role.id)) {
          await member.roles.add(role).catch(() => {});
          addedIds.push(role.id);
        }
      }

      // Update nickname
      const shortPos = position.split('(')[0].split(',')[0].trim();
      const baseName = (member.nickname || member.user.username).replace(/ \(Acting.*\)$/, '');
      const suffix = ` (Acting ${shortPos})`;
      await member.setNickname((baseName + suffix).slice(0, 32)).catch(() => {});

      if (addedIds.length) rolesApplied[guild.id] = addedIds;
    } catch (e) {
      console.error(`[Acting] Failed in ${guild.name}:`, e.message);
    }
  }

  // Save assignment
  createActingAssignment({
    leaveRequestId,
    onLeaveDiscordId: onLeaveDiscordId || 'unknown',
    actingDiscordId,
    position,
    rolesApplied,
    originalRoles: [],
    assignedBy: assignedBy || 'system',
  });

  // Log
  const actingUser = getUserByDiscordId(actingDiscordId);
  await logAction(client, {
    action: '🔄 Acting Role Assigned',
    moderator: { discordId: 'SYSTEM', name: assignedBy || 'Leave System' },
    target: { discordId: actingDiscordId, name: actingUser?.display_name || actingDiscordId },
    reason: `Acting as ${position}`,
    color: 0x5865F2,
    fields: [
      { name: 'Position', value: position, inline: true },
      { name: 'Replacing', value: onLeaveDiscordId ? `<@${onLeaveDiscordId}>` : 'N/A', inline: true },
    ],
    logType: 'moderation.suspend_unsuspend'
  });

  // DM acting person
  try {
    const user = await client.users.fetch(actingDiscordId);
    await user.send({ embeds: [{
      title: '📌 Acting Position Assigned',
      color: 0x22C55E,
      description: `You have been assigned to act in the position of **${position}**.\n\nYour Discord roles have been updated. Your original roles will be restored when the acting period ends.`,
      footer: { text: 'Community Organisation | Leave Management' },
      timestamp: new Date().toISOString()
    }]});
  } catch {}
}

// ── Revert On Leave role ─────────────────────────────────────────────────────

export async function revertLeaveRole(client, leave, portalDb) {
  for (const guild of client.guilds.cache.values()) {
    try {
      const member = await guild.members.fetch(leave.discord_id).catch(() => null);
      if (!member) continue;

      const stored = getStoredRoles(leave.discord_id, guild.id, `leave_${leave.id}`);
      if (stored) {
        const rolesToRestore = JSON.parse(stored.roles || '[]');
        await member.roles.set(rolesToRestore).catch(e => console.error('[Leave revert] Role set failed:', e.message));
        await member.setNickname(stored.nickname || null).catch(() => {});
        deleteStoredRoles(stored.id);
      }
    } catch (e) {
      console.error(`[Leave revert] Failed in ${guild.name}:`, e.message);
    }
  }

  // Revert acting if exists
  if (leave.acting_discord_id) {
    await revertActingRoles(client, leave.acting_discord_id, leave.id);

    try {
      const actingUser = await client.users.fetch(leave.acting_discord_id);
      const leaveName = leave.display_name || leave.full_name || 'the staff member';
      await actingUser.send({ content: `Your acting role for **${leave.position}** has ended. **${leaveName}** has returned from leave. Your original roles have been restored.` });
    } catch {}
  }

  // DM the returning person
  try {
    const user = await client.users.fetch(leave.discord_id);
    await user.send({ embeds: [{
      title: '✅ Welcome Back',
      color: 0x22C55E,
      description: `Welcome back! Your Discord roles have been restored following your **${leave.leave_type}**.`,
      footer: { text: 'Community Organisation | Leave Management' },
      timestamp: new Date().toISOString()
    }]});
  } catch {}

  // Mark as reverted
  if (portalDb) {
    try { await portalDb.run('UPDATE leave_requests SET discord_role_applied = 0 WHERE id = ?', [leave.id]); } catch {}
  }

  await logAction(client, {
    action: '✅ Leave Role Reverted',
    moderator: { discordId: 'SYSTEM', name: 'Leave System' },
    target: { discordId: leave.discord_id, name: leave.display_name || leave.full_name || leave.discord_id },
    reason: `Returned from ${leave.leave_type} leave`,
    color: 0x22C55E,
    logType: 'moderation.suspend_unsuspend'
  });
}

// ── Revert acting roles ──────────────────────────────────────────────────────

export async function revertActingRoles(client, actingDiscordId, leaveRequestId) {
  for (const guild of client.guilds.cache.values()) {
    try {
      const member = await guild.members.fetch(actingDiscordId).catch(() => null);
      if (!member) continue;

      const stored = getStoredRoles(actingDiscordId, guild.id, `acting_${leaveRequestId}`);
      if (stored) {
        await member.roles.set(JSON.parse(stored.roles || '[]')).catch(() => {});
        await member.setNickname(stored.nickname || null).catch(() => {});
        deleteStoredRoles(stored.id);
      }
    } catch (e) {
      console.error(`[Acting revert] Failed in ${guild.name}:`, e.message);
    }
  }

  // End acting assignment in DB
  const { db } = await import('../utils/botDb.js');
  const acting = db.prepare("SELECT id FROM acting_assignments WHERE leave_request_id = ? AND acting_discord_id = ? AND status = 'active'").get(leaveRequestId, actingDiscordId);
  if (acting) endActingAssignment(acting.id);

  await logAction(client, {
    action: '🔄 Acting Role Reverted',
    moderator: { discordId: 'SYSTEM', name: 'Leave System' },
    target: { discordId: actingDiscordId, name: getUserByDiscordId(actingDiscordId)?.display_name || actingDiscordId },
    reason: 'Acting period ended',
    color: 0x6B7280,
    logType: 'moderation.suspend_unsuspend'
  });
}

// ── Midnight cron — process leave starts and ends ────────────────────────────

export async function processLeaveRoles(client) {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  let portalDb;
  try {
    const Database = (await import('better-sqlite3')).default;
    portalDb = new Database(process.env.PORTAL_DB_PATH, { readonly: false });
  } catch (e) {
    console.error('[Leave Cron] Cannot open portal DB:', e.message);
    return;
  }

  try {
    // Leave starting today
    const starting = portalDb.prepare(
      `SELECT lr.*, u.discord_id, u.display_name, u.full_name, u.position, u.auth_level
       FROM leave_requests lr
       JOIN users u ON u.id = lr.user_id
       WHERE lr.start_date = ? AND lower(lr.status) = 'approved' AND COALESCE(lr.discord_role_applied, 0) = 0`
    ).all(today);

    for (const leave of starting) {
      if (!leave.discord_id) continue;
      console.log(`[Leave Cron] Applying On Leave to ${leave.display_name} (${leave.leave_type})`);
      await applyLeaveRole(client, leave, { run: (sql, params) => portalDb.prepare(sql).run(...params) });

      // Apply acting if confirmed
      if (leave.acting_discord_id && leave.acting_confirmed) {
        await applyActingRoles(client, leave.acting_discord_id, leave.position, leave.id, leave.discord_id, 'system');
      }
    }

    // Leave ending yesterday (restore today)
    const ending = portalDb.prepare(
      `SELECT lr.*, u.discord_id, u.display_name, u.full_name, u.position, u.auth_level
       FROM leave_requests lr
       JOIN users u ON u.id = lr.user_id
       WHERE lr.end_date = ? AND lower(lr.status) = 'approved' AND COALESCE(lr.discord_role_applied, 0) = 1`
    ).all(yesterday);

    for (const leave of ending) {
      if (!leave.discord_id) continue;
      console.log(`[Leave Cron] Reverting leave for ${leave.display_name}`);
      await revertLeaveRole(client, leave, { run: (sql, params) => portalDb.prepare(sql).run(...params) });
    }

    if (starting.length || ending.length) {
      console.log(`[Leave Cron] Processed ${starting.length} starts, ${ending.length} ends`);
    }
  } catch (e) {
    console.error('[Leave Cron] Error:', e.message);
  } finally {
    try { portalDb.close(); } catch {}
  }
}

// ── 9AM cron — acting nomination requests ────────────────────────────────────

export async function sendActingNominationRequests(client) {
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  let portalDb;
  try {
    const Database = (await import('better-sqlite3')).default;
    portalDb = new Database(process.env.PORTAL_DB_PATH, { readonly: false });
  } catch (e) {
    console.error('[Acting Nomination] Cannot open portal DB:', e.message);
    return;
  }

  try {
    const leaveTomorrow = portalDb.prepare(
      `SELECT lr.*, u.discord_id, u.display_name, u.full_name, u.position, u.auth_level,
              u.line_manager_id, lm.discord_id as manager_discord_id, lm.display_name as manager_name
       FROM leave_requests lr
       JOIN users u ON u.id = lr.user_id
       LEFT JOIN users lm ON lm.id = u.line_manager_id
       WHERE lr.start_date = ? AND lower(lr.status) = 'approved' AND COALESCE(lr.acting_notified, 0) = 0`
    ).all(tomorrow);

    for (const leave of leaveTomorrow) {
      const isManager = (leave.auth_level || 0) >= 4 || isManagerPosition(leave.position);

      if (!isManager) {
        // Not a manager — no acting needed
        portalDb.prepare('UPDATE leave_requests SET acting_notified = 1 WHERE id = ?').run(leave.id);
        continue;
      }

      if (!leave.discord_id) continue;

      try {
        const leaveUser = await client.users.fetch(leave.discord_id);
        await leaveUser.send({ embeds: [{
          color: 0x5865F2,
          title: '📋 Acting Nomination Required',
          description: `Your **${leave.leave_type}** begins tomorrow (**${leave.start_date}**).\n\nAs you hold a management position (**${leave.position}**), please nominate someone to act in your position while you are away.\n\nReply to this message with the **@mention** or **Discord user ID** of the person you wish to nominate.\n\nType **"none"** if no acting is required.`,
          fields: [
            { name: 'Leave Period', value: `${leave.start_date} to ${leave.end_date}`, inline: true },
            { name: 'Your Position', value: leave.position, inline: true },
          ],
          footer: { text: 'You have 12 hours to respond. | Community Organisation' }
        }]});

        // Collect response
        const dmChannel = await leaveUser.createDM();
        const collector = dmChannel.createMessageCollector({
          filter: m => m.author.id === leave.discord_id,
          time: 12 * 60 * 60 * 1000,
          max: 1
        });

        collector.on('collect', async (msg) => {
          if (msg.content.toLowerCase().trim() === 'none') {
            portalDb.prepare('UPDATE leave_requests SET acting_notified = 1 WHERE id = ?').run(leave.id);
            await msg.reply('Understood — no acting will be assigned. Your roles will be updated at midnight.');
            return;
          }

          const mentionedId = msg.mentions.users.first()?.id || msg.content.replace(/[<@!>]/g, '').trim();
          if (!mentionedId || !/^\d{17,20}$/.test(mentionedId)) {
            await msg.reply('I couldn\'t find that user. Please mention them with @username or paste their Discord ID.');
            return;
          }

          // Verify they exist in portal
          const actingPortal = getUserByDiscordId(mentionedId);
          if (!actingPortal) {
            await msg.reply('That user is not linked to the CO Staff Portal. Please nominate a verified staff member.');
            return;
          }

          portalDb.prepare(
            'UPDATE leave_requests SET acting_discord_id = ?, acting_notified = 1, acting_confirmed = 1 WHERE id = ?'
          ).run(mentionedId, leave.id);

          await msg.reply({ embeds: [{
            color: 0x22C55E,
            title: '✅ Acting Nomination Confirmed',
            description: `<@${mentionedId}> (**${actingPortal.display_name}**) will act in your position (**${leave.position}**) from ${leave.start_date} to ${leave.end_date}.\n\nThey will receive your position roles at midnight tonight and will be notified.`,
          }]});

          // DM the acting person
          try {
            const actingUser = await client.users.fetch(mentionedId);
            await actingUser.send({ embeds: [{
              color: 0x22C55E,
              title: '📌 Acting Position Assigned',
              description: `You have been nominated to act in the position of **${leave.position}** while **${leave.display_name || leave.full_name}** is on leave.`,
              fields: [
                { name: 'Period', value: `${leave.start_date} to ${leave.end_date}`, inline: true },
                { name: 'Acting Position', value: leave.position, inline: true },
              ],
              footer: { text: 'Your Discord roles will be updated at midnight tonight. | Community Organisation' }
            }]});
          } catch (e) {
            console.error('[Acting] Could not DM acting person:', e.message);
          }
        });

        collector.on('end', async (collected) => {
          if (collected.size === 0) {
            portalDb.prepare('UPDATE leave_requests SET acting_notified = 1 WHERE id = ?').run(leave.id);
            await leaveUser.send('No acting nomination received. Your roles will be updated at midnight without an acting assignment.').catch(() => {});
          }
        });

      } catch (e) {
        console.error('[Acting nomination]', leave.discord_id, e.message);
      }

      // Mark notified regardless of DM success
      portalDb.prepare('UPDATE leave_requests SET acting_notified = 1 WHERE id = ?').run(leave.id);
    }

    if (leaveTomorrow.length) {
      console.log(`[Acting Nomination] Processed ${leaveTomorrow.length} leave requests starting tomorrow`);
    }
  } catch (e) {
    console.error('[Acting Nomination] Error:', e.message);
  } finally {
    try { portalDb.close(); } catch {}
  }
}
