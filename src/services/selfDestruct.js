// Bot self-destruct — detects token compromise / hostile shard activity
// and shuts the bot down so an attacker can't ride the bot identity for
// further damage. Cannot programmatically REVOKE the token (only Discord's
// developer portal can do that, manually) — but it CAN ensure the running
// process exits and PM2 doesn't auto-restart it.
//
// Trigger paths:
//   1. Gateway close code 4004 (auth failed) — token has been reset by
//      Discord or by us in the developer portal. Self-stops + alerts.
//   2. Gateway close code 4014 (disallowed intents) — config drift or
//      Discord disabled the bot. Self-stops + alerts.
//   3. Operator HTTP POST /api/bot/panic with x-bot-secret AND
//      x-bot-panic-key headers. Both must match. Immediate stop.
//   4. Slash command /panic-bot (superuser only). Same effect.
//
// On any trigger:
//   - DM Dion + Evan with reset instructions
//   - Run `pm2 stop co-discord-bot` (so it doesn't auto-restart)
//   - process.exit(2)
//
// To recover: reset the token at
//   https://discord.com/developers/applications/<app_id>/bot
// then update DISCORD_BOT_TOKEN in .env, then `pm2 start co-discord-bot`.

import { Events } from 'discord.js';
import { execSync, spawn } from 'child_process';

const ALERT_USER_IDS = ['723199054514749450', '415922272956710912'];   // Dion, Evan

// Codes that mean the token / connection is no longer valid in a way we
// shouldn't recover from (default discord.js would retry forever).
const FATAL_CLOSE_CODES = new Set([4004, 4014, 4011, 4013]);

const RESET_INSTRUCTIONS = [
  '1. Open https://discord.com/developers/applications',
  '2. Pick the CO bot app',
  '3. Bot tab → "Reset Token" → confirm',
  '4. Copy the new token',
  '5. SSH into co-prod-01',
  '6. Edit ~/clawd/services/co-discord-bot/.env  →  set DISCORD_BOT_TOKEN=<new>',
  '7. pm2 start co-discord-bot --update-env',
  '8. Watch logs: pm2 logs co-discord-bot --lines 50',
].join('\n');

async function alert(client, body) {
  for (const uid of ALERT_USER_IDS) {
    try {
      const u = await client.users.fetch(uid).catch(() => null);
      if (!u) continue;
      const dm = await u.createDM().catch(() => null);
      if (dm) await dm.send(body.slice(0, 1900)).catch(() => {});
    } catch {}
  }
}

function stopSelfAndExit(reason) {
  console.error(`[selfDestruct] STOPPING — ${reason}`);
  // Detach pm2 stop so we can exit even if pm2 hangs
  try {
    spawn('pm2', ['stop', 'co-discord-bot'], { detached: true, stdio: 'ignore' }).unref();
  } catch (e) {
    console.error('[selfDestruct] pm2 stop failed:', e.message);
  }
  // Give the spawn 2s to take effect, then exit hard
  setTimeout(() => process.exit(2), 2000);
}

let _detonated = false;
async function detonate(client, reason) {
  if (_detonated) return;
  _detonated = true;
  const body = `🚨 **BOT SELF-DESTRUCT TRIGGERED**\n\nReason: ${reason}\nTime: ${new Date().toUTCString()}\nProcess will exit in 5 seconds. PM2 will NOT auto-restart.\n\n**Action required — reset the token:**\n${RESET_INSTRUCTIONS}`;
  console.error(`[selfDestruct] ${reason}`);
  try { await alert(client, body); } catch {}
  // Give DMs ~3 sec to deliver before pulling the plug
  setTimeout(() => stopSelfAndExit(reason), 3000);
}

export function setupSelfDestruct(client, webhookApp) {
  // 1. Watch for fatal gateway close codes
  client.on(Events.ShardDisconnect, (event, shardId) => {
    const code = event?.code;
    if (FATAL_CLOSE_CODES.has(code)) {
      detonate(client, `gateway close code ${code} on shard ${shardId} — token / intents invalid`);
    }
  });
  client.on(Events.ShardError, (err, shardId) => {
    if (/4004|invalid token|authentication failed/i.test(err?.message || '')) {
      detonate(client, `shard ${shardId} error: ${err.message}`);
    }
  });

  // 2. HTTP panic endpoint — requires BOTH bot secret AND panic key
  if (webhookApp) {
    webhookApp.post('/api/bot/panic', async (req, res) => {
      const sec = req.headers['x-bot-secret'];
      const key = req.headers['x-bot-panic-key'];
      const expectedSec = process.env.BOT_WEBHOOK_SECRET;
      const expectedKey = process.env.BOT_PANIC_KEY;
      if (!expectedKey) return res.status(503).json({ error: 'PANIC_KEY_NOT_SET — set BOT_PANIC_KEY in .env first' });
      if (sec !== expectedSec || key !== expectedKey) return res.status(401).json({ error: 'UNAUTHORIZED' });
      res.json({ ok: true, message: 'panic acknowledged — bot stopping in 5 sec' });
      detonate(client, `HTTP /api/bot/panic invoked from ${req.ip}`);
    });
  }

  console.log('[selfDestruct] active — watching gateway close codes 4004/4014/4011/4013, /api/bot/panic endpoint');
}
