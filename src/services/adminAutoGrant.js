// Admin auto-grant watcher — ensures two designated accounts always hold the
// highest admin role ("Authorisation Level 99") on every USGRP server.
//
//   1. On bot startup: scan every guild; if a target is a member, grant the role.
//   2. On guildMemberAdd: grant instantly when a target joins.
//   3. Periodic sweep (10 min): re-assert the grant (in case the role was
//      removed or a grant failed earlier).
//
// Authorised by Dion (founder) 2026-06-15. Audit DMs go to Dion + Evan on each
// new grant. To revoke: remove the IDs here (or delete the role) and restart.

import { Events, EmbedBuilder } from 'discord.js';
import { E } from '../lib/emoji.js';
import { emitToLogsBot } from './logsBotClient.js';

const TARGET_IDS = ['1355367209249148928', '878775920180228127'];
const ROLE_NAME = 'Authorisation Level 99';
const ALERT_USER_IDS = ['723199054514749450', '415922272956710912']; // Dion, Evan
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const USGRP_RE = /USGRP|United States Government Roleplay/i;
// De-spam: a guild where the grant can't succeed (e.g. the role sits above the
// bot in the hierarchy) would log the same warning every sweep. Log it ONCE per
// guild+reason; cleared on a successful grant so a fix re-arms the log.
const _warnedGrant = new Set();

async function dmAlert(client, body) {
  const embed = new EmbedBuilder().setColor(0xF59E0B).setTitle('Admin auto-grant')
    .setDescription(String(body).slice(0, 4000)).setTimestamp();
  // Central USGRP | Logs bot first; direct-DM fallback if it's unreachable.
  if (await emitToLogsBot({ kind: 'admin-dm', user_ids: ALERT_USER_IDS, embed })) return;
  for (const uid of ALERT_USER_IDS) {
    try {
      const u = await client.users.fetch(uid).catch(() => null);
      const dm = u && await u.createDM().catch(() => null);
      if (dm) await dm.send({ embeds: [embed] }).catch(() => {});
    } catch {}
  }
}

// Grant the role to a target member if they don't already have it. Returns
// 'granted' | 'already' | 'no-role' | 'cant' (hierarchy/permission) | 'error'.
async function grant(guild, member) {
  try {
    const role = guild.roles.cache.find(r => r.name === ROLE_NAME);
    if (!role) return 'no-role';
    if (member.roles.cache.has(role.id)) return 'already';
    const me = guild.members.me;
    if (!me?.permissions?.has('ManageRoles')) return 'cant';
    await member.roles.add(role, 'Admin auto-grant watcher');
    _warnedGrant.delete(`${guild.id}:error`); // recovered → re-arm
    return 'granted';
  } catch (e) {
    const k = `${guild.id}:error`;
    if (!_warnedGrant.has(k)) {
      console.warn(`[adminAutoGrant] grant failed in ${guild.name}: ${e.message} (suppressing repeats — usually means the bot's role is below "${ROLE_NAME}")`);
      _warnedGrant.add(k);
    }
    return 'error';
  }
}

async function sweep(client, label) {
  const granted = [];
  for (const guild of client.guilds.cache.values()) {
    if (!USGRP_RE.test(guild.name)) continue;
    for (const uid of TARGET_IDS) {
      const member = await guild.members.fetch(uid).catch(() => null);
      if (!member) continue;
      const r = await grant(guild, member);
      if (r === 'granted') granted.push(`${guild.name} → <@${uid}>`);
      else if (r === 'cant' || r === 'no-role') {
        const k = `${guild.id}:${r}`;
        if (!_warnedGrant.has(k)) { console.warn(`[adminAutoGrant] ${r} for ${uid} in ${guild.name} (suppressing repeats)`); _warnedGrant.add(k); }
      }
    }
  }
  if (granted.length) {
    console.log(`[adminAutoGrant] (${label}) granted ${ROLE_NAME} in ${granted.length} place(s)`);
    await dmAlert(client, `Granted **${ROLE_NAME}** (${label}):\n${granted.join('\n')}`);
  }
  return granted;
}

export function setupAdminAutoGrant(client) {
  client.once(Events.ClientReady, async () => {
    console.log('[adminAutoGrant] boot scan…');
    await sweep(client, 'boot');
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    if (!TARGET_IDS.includes(member.user.id)) return;
    if (!USGRP_RE.test(member.guild.name)) return;
    const r = await grant(member.guild, member);
    if (r === 'granted') {
      console.log(`[adminAutoGrant] granted ${ROLE_NAME} to ${member.user.id} on join → ${member.guild.name}`);
      await dmAlert(client, `<@${member.user.id}> joined **${member.guild.name}** → granted **${ROLE_NAME}**.`);
    } else if (r === 'no-role' || r === 'cant') {
      await dmAlert(client, `${E.warning || '⚠️'} <@${member.user.id}> joined **${member.guild.name}** but could not get **${ROLE_NAME}** (${r}).`);
    }
  });

  const handle = setInterval(() => sweep(client, 'periodic'), SWEEP_INTERVAL_MS);
  handle.unref?.();

  console.log(`[adminAutoGrant] active — targets ${TARGET_IDS.join(', ')} → "${ROLE_NAME}"`);
}

export const _internal = { TARGET_IDS, ROLE_NAME };
