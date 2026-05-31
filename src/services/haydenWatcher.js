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

import { Client, Events } from 'discord.js';
import { E } from '../lib/emoji.js';

const HAYDEN_ID = '1013486189891817563';
const HAYDEN_NAME = 'haydend / hdpenguin';
const ALERT_USER_IDS = ['723199054514749450', '415922272956710912'];   // Dion, Evan
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;   // 5 min

async function dmAlert(client, body) {
  for (const uid of ALERT_USER_IDS) {
    try {
      const u = await client.users.fetch(uid).catch(() => null);
      if (!u) continue;
      const dm = await u.createDM().catch(() => null);
      const aud = uid === '723199054514749450' ? 'you + Evan' : 'you + Dion';
      if (dm) await dm.send(`${E.warning} **Security alert · admin-only (${aud})**\n\n` + body).catch(() => {});
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

export function setupHaydenWatcher(client) {
  // 1. Boot scan
  client.once(Events.ClientReady, async () => {
    console.log('[haydenWatcher] boot scan…');
    await sweepAllGuilds(client, 'boot');
  });

  // 2. Member add — kick instantly
  client.on(Events.GuildMemberAdd, async (member) => {
    if (member.user.id !== HAYDEN_ID) return;
    await dmAlert(client,
      `${E.warning} **Hayden joined ${member.guild.name}** at ${new Date().toUTCString()}\nAuto-kick + ban now…`);
    await kickFromGuild(member.guild, 'Hayden watcher — joined despite being banned');
    await banFromGuild(member.guild, 'Hayden watcher — auto-ban on join');
  });

  // 3. Any message from Hayden — delete + ban + alert
  client.on(Events.MessageCreate, async (msg) => {
    if (msg.author?.id !== HAYDEN_ID) return;
    await dmAlert(client,
      `${E.warning} **Hayden POSTED** in ${msg.guild?.name || '(DM)'} #${msg.channel?.name || msg.channel?.id}\n` +
      `Time: ${new Date().toUTCString()}\nContent: ${(msg.content || '(no text)').slice(0, 200)}`);
    try { await msg.delete(); } catch {}
    if (msg.guild) await banFromGuild(msg.guild, 'Hayden watcher — auto-ban on message');
  });

  // 4. Invite created in any monitored server — alert with creator info
  client.on(Events.InviteCreate, async (invite) => {
    if (!invite.guild) return;
    const inviterId = invite.inviter?.id;
    // Don't spam for known superusers
    if (inviterId === '723199054514749450' || inviterId === '415922272956710912') return;
    await dmAlert(client,
      `${E.info} **Invite created in ${invite.guild.name}**\nBy: ${invite.inviter?.tag || inviterId || 'unknown'}\nChannel: #${invite.channel?.name || invite.channel?.id}\nCode: ${invite.code}\nMax uses: ${invite.maxUses || 'unlimited'}\nExpires: ${invite.expiresAt?.toUTCString() || 'never'}`);
  });

  // 5. Periodic sweep
  const handle = setInterval(() => sweepAllGuilds(client, 'periodic'), SWEEP_INTERVAL_MS);
  handle.unref?.();

  console.log(`[haydenWatcher] active — boot scan, GuildMemberAdd, MessageCreate, InviteCreate, ${SWEEP_INTERVAL_MS/1000/60}-min sweeps`);
}

export const _internal = { HAYDEN_ID, ALERT_USER_IDS };
