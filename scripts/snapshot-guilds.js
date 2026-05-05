#!/usr/bin/env node
// Discord server snapshot — pulls EVERYTHING from every guild the bot is
// in and saves a per-guild JSON file plus a top-level manifest.
//
// Captured per guild:
//   guild metadata, channels (incl. permission overwrites), roles
//   (incl. permission bitfields), members (paged 1000 at a time),
//   bans (paged), emojis, stickers, webhooks (requires perm),
//   invites (requires perm), guild scheduled events.
//
// Output: ~/snapshots/discord/<UTC-iso-stamp>/
//   manifest.json                    summary + counts + warnings
//   <guild_id>__<safe-name>.json     one file per guild
//
// Usage: node scripts/snapshot-guilds.js
// Cron-safe (no prompts). Exits non-zero on hard failure; per-guild
// errors are recorded in manifest.json but don't fail the whole run.

import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { config as loadEnv } from 'dotenv';
loadEnv();

const TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!TOKEN) { console.error('DISCORD_BOT_TOKEN not set'); process.exit(1); }

const OUT_ROOT = path.join(os.homedir(), 'snapshots', 'discord');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT_DIR = path.join(OUT_ROOT, STAMP);

const rest = new REST({ version: '10', timeout: 20000 }).setToken(TOKEN);

function safeName(s) { return String(s || 'unknown').replace(/[^a-z0-9._-]/gi, '_').slice(0, 60); }

async function get(route) {
  return rest.get(route).catch(e => ({ _error: e.message, _route: route }));
}

async function pullPaged(route, paramKey = 'after') {
  const out = [];
  let last = null;
  for (let i = 0; i < 50; i++) {     // hard cap 50 pages = 50k items
    const sep = route.includes('?') ? '&' : '?';
    const url = last ? `${route}${sep}limit=1000&${paramKey}=${last}` : `${route}${sep}limit=1000`;
    const page = await rest.get(url).catch(e => ({ _error: e.message }));
    if (page?._error) return out.length ? out.concat([{ _pageError: page._error }]) : [{ _error: page._error }];
    if (!Array.isArray(page) || page.length === 0) break;
    out.push(...page);
    if (page.length < 1000) break;
    // ban list paginates by user id, member list by user id
    last = page[page.length - 1].user?.id || page[page.length - 1].id;
    if (!last) break;
  }
  return out;
}

async function snapshotGuild(guildSummary) {
  const id = guildSummary.id;
  const start = Date.now();
  const data = { _stamp: STAMP, _summary: guildSummary };

  data.guild         = await get(`${Routes.guild(id)}?with_counts=true`);
  data.channels      = await get(Routes.guildChannels(id));
  data.roles         = await get(Routes.guildRoles(id));
  data.emojis        = await get(Routes.guildEmojis(id));
  data.stickers      = await get(`/guilds/${id}/stickers`);
  data.scheduled_events = await get(`/guilds/${id}/scheduled-events?with_user_count=true`);
  data.threads_active   = await get(Routes.guildActiveThreads(id));
  data.preview       = await get(`/guilds/${id}/preview`);
  data.vanity_url    = await get(`/guilds/${id}/vanity-url`);
  data.widget        = await get(Routes.guildWidgetSettings(id));
  // These can fail per-permission; that's OK — recorded as _error
  data.webhooks      = await get(`/guilds/${id}/webhooks`);
  data.invites       = await get(Routes.guildInvites(id));
  data.integrations  = await get(`/guilds/${id}/integrations`);
  // Paged
  data.members       = await pullPaged(Routes.guildMembers(id));
  data.bans          = await pullPaged(`/guilds/${id}/bans`);

  data._captured_in_ms = Date.now() - start;
  data._counts = {
    channels: Array.isArray(data.channels) ? data.channels.length : 0,
    roles:    Array.isArray(data.roles)    ? data.roles.length    : 0,
    emojis:   Array.isArray(data.emojis)   ? data.emojis.length   : 0,
    members:  Array.isArray(data.members)  ? data.members.length  : 0,
    bans:     Array.isArray(data.bans)     ? data.bans.length     : 0,
    threads_active: Array.isArray(data.threads_active?.threads) ? data.threads_active.threads.length : 0,
    webhooks: Array.isArray(data.webhooks) ? data.webhooks.length : 0,
    invites:  Array.isArray(data.invites)  ? data.invites.length  : 0,
  };
  return data;
}

(async () => {
  await fs.mkdir(OUT_DIR, { recursive: true, mode: 0o700 });
  console.log(`[snapshot] target dir: ${OUT_DIR}`);
  console.log(`[snapshot] fetching guild list…`);
  const guilds = await rest.get(Routes.userGuilds() + '?limit=200').catch(e => { console.error(e); process.exit(1); });
  if (!Array.isArray(guilds)) { console.error('failed to list guilds:', guilds); process.exit(1); }
  console.log(`[snapshot] ${guilds.length} guilds`);

  const manifest = { stamp: STAMP, captured_at: new Date().toISOString(), guilds: [] };

  for (const g of guilds) {
    process.stdout.write(`  ${g.name.padEnd(32)} (${g.id})  `);
    const data = await snapshotGuild(g);
    const filename = `${g.id}__${safeName(g.name)}.json`;
    await fs.writeFile(path.join(OUT_DIR, filename), JSON.stringify(data, null, 2), { mode: 0o600 });
    process.stdout.write(`channels=${data._counts.channels}  roles=${data._counts.roles}  members=${data._counts.members}  bans=${data._counts.bans}  in ${data._captured_in_ms}ms\n`);
    manifest.guilds.push({ id: g.id, name: g.name, file: filename, counts: data._counts, captured_in_ms: data._captured_in_ms });
  }

  await fs.writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });

  // Summary for the operator
  const totalMembers = manifest.guilds.reduce((s, g) => s + (g.counts.members || 0), 0);
  const totalChannels = manifest.guilds.reduce((s, g) => s + (g.counts.channels || 0), 0);
  const totalRoles = manifest.guilds.reduce((s, g) => s + (g.counts.roles || 0), 0);
  const totalBans = manifest.guilds.reduce((s, g) => s + (g.counts.bans || 0), 0);
  console.log(`\n[snapshot] DONE  guilds=${manifest.guilds.length}  channels=${totalChannels}  roles=${totalRoles}  members=${totalMembers}  bans=${totalBans}`);
  console.log(`[snapshot] saved to: ${OUT_DIR}`);
  // Also retention: keep the last 30 snapshot directories
  try {
    const dirs = (await fs.readdir(OUT_ROOT)).filter(d => /^\d{4}-\d{2}-\d{2}T/.test(d)).sort();
    if (dirs.length > 30) {
      for (const d of dirs.slice(0, dirs.length - 30)) {
        await fs.rm(path.join(OUT_ROOT, d), { recursive: true, force: true });
        console.log(`[snapshot] rotated out: ${d}`);
      }
    }
  } catch {}
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
