// Hayden watcher — defence in depth against the former staff member's
// Discord account (1013486189891817563). Multiple overlapping checks:
//
//   1. On bot startup: scan every guild the bot is in. If Hayden's
//      Discord account is a member, kick him + DM Dion + Evan.
//   2. On guildMemberAdd: kick instantly + alert.
//   3. On any inviteCreate: alert (so we know who can be invited where).
//   4. On any messageCreate from Hayden's ID: delete + ban + alert
//      (he should never be in any server, but defence-in-depth).
//   5. Periodic 5-min sweep of every guild.
//
// All alerts DM Dion (723199054514749450) AND Evan (415922272956710912).
// If SECURITY_ALERTS_CHANNEL_ID is set, also posts there.

import { Client, Events, EmbedBuilder } from 'discord.js';
import { E } from '../lib/emoji.js';
import { emitToLogsBot } from './logsBotClient.js';

const HAYDEN_ID = '1013486189891817563';
const HAYDEN_NAME = 'haydend / hdpenguin';
const ALERT_USER_IDS = ['723199054514749450', '415922272956710912'];   // Dion, Evan
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;   // 5 min

async function dmAlert(client, body) {
  for (const uid of ALERT_USER_IDS) {
    const aud = uid === '723199054514749450' ? 'you + Evan' : 'you + Dion';
    const embed = new EmbedBuilder().setColor(0xEF4444)
      .setDescription(`${E.warning} **Security alert · admin-only (${aud})**\n\n` + String(body).slice(0, 4000))
      .setTimestamp();
    // Central USGRP | Logs bot first; direct-DM fallback if it's unreachable.
    if (await emitToLogsBot({ kind: 'admin-dm', user_ids: [uid], embed })) continue;
    try {
      const u = await client.users.fetch(uid).catch(() => null);
      if (!u) continue;
      const dm = await u.createDM().catch(() => null);
      if (dm) await dm.send({ embeds: [embed] }).catch(() => {});
    } catch (e) { console.warn('[haydenWatcher] DM failed:', e.message); }
  }
  const channelId = process.env.SECURITY_ALERTS_CHANNEL_ID;
  if (channelId) {
    try {
      const ch = await client.channels.fetch(channelId).catch(() => null);
      if (ch) await ch.send(body).catch(() => {});
    } catch {}
  }
}

async function kickFromGuild(guild, reason) {
  try {
    const member = await guild.members.fetch(HAYDEN_ID).catch(() => null);
    if (!member) return false;
    if (!member.kickable) {
      console.warn(`[haydenWatcher] cannot kick from ${guild.name} — bot lacks permission or hierarchy`);
      return false;
    }
    await member.kick(reason);
    console.log(`[haydenWatcher] kicked ${HAYDEN_NAME} from ${guild.name}`);
    return true;
  } catch (e) {
    console.warn(`[haydenWatcher] kick failed in ${guild.name}: ${e.message}`);
    return false;
  }
}

async function banFromGuild(guild, reason) {
  try {
    if (!guild.members.me?.permissions?.has('BanMembers')) return false;
    await guild.bans.create(HAYDEN_ID, { reason: reason.slice(0, 512) });
    console.log(`[haydenWatcher] banned ${HAYDEN_ID} from ${guild.name}`);
    return true;
  } catch (e) {
    console.warn(`[haydenWatcher] ban failed in ${guild.name}: ${e.message}`);
    return false;
  }
}

async function sweepAllGuilds(client, label = 'sweep') {
  const found = [];
  for (const guild of client.guilds.cache.values()) {
    try {
      const member = await guild.members.fetch(HAYDEN_ID).catch(() => null);
      if (member) {
        found.push(guild.name);
        await kickFromGuild(guild, `Hayden watcher (${label}) — auto-removal of former staff member`);
        await banFromGuild(guild, `Hayden watcher (${label}) — auto-ban`);
      }
    } catch {}
  }
  if (found.length) {
    await dmAlert(client, `${E.warning} **Hayden detected in ${found.length} guild(s)** — auto-kicked + banned\nGuilds: ${found.join(', ')}\nTrigger: ${label}\nTime: ${new Date().toUTCString()}`);
  }
  return found;
}

// DISABLED 2026-07-01 — reconciled with Hayden. The watcher used to boot-scan,
// auto-kick, auto-ban, delete his messages and sweep every 5 minutes. All of
// that is now off; setupHaydenWatcher is a deliberate no-op so nothing
// re-bans or removes him. The helpers above are kept only for reference /
// git history and are no longer wired to any Discord event or timer.
export function setupHaydenWatcher(_client) {
  console.log('[haydenWatcher] DISABLED — reconciled; no scans, kicks, bans or sweeps.');
}

export const _internal = { HAYDEN_ID, ALERT_USER_IDS };
