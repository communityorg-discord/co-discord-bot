// Detached Claude runner — the thing that actually does the work for the
// "Claude fix this" Discord bridge. Spawned DETACHED by either bot's bridge so
// it OUTLIVES a bot restart: a fix that restarts co-discord-bot/aspire-bot can
// no longer kill the run mid-flight (the old footgun). It talks to Discord
// purely over REST with the CO bot's token, streams live progress into a status
// message, and posts the final summary itself.
//
// Invoked as: node claudeRun.mjs   with env:
//   CR_CHANNEL, CR_MSG (the trigger message), CR_PROMPT_B64 (base64 prompt),
//   CR_RESUME (optional session id to continue).
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, openSync, writeSync, closeSync, unlinkSync } from 'node:fs';

const REPO = '/home/vpcommunityorganisation/clawd/services';
const CLAUDE = '/home/vpcommunityorganisation/.npm-global/bin/claude';
const HOME = process.env.HOME || '/home/vpcommunityorganisation';
const LOCK_DIR = `${HOME}/.cache/claude-bridge`;
const CLAIMS = `${LOCK_DIR}/claims`;
const RUN_LOCK = `${LOCK_DIR}/RUNNING`;
const SESS_FILE = `${LOCK_DIR}/sessions.json`;
const API = 'https://discord.com/api/v10';
const TIMEOUT_MS = 20 * 60_000;

const CHANNEL = process.env.CR_CHANNEL;
const MSG = process.env.CR_MSG;
const PROMPT = Buffer.from(process.env.CR_PROMPT_B64 || '', 'base64').toString('utf8');
const RESUME = process.env.CR_RESUME || null;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Always reply as the CO bot (one consistent "Claude" identity) regardless of
// which bot spawned us — read its token straight off disk.
function coToken() {
  try {
    const env = readFileSync(`${REPO}/co-discord-bot/.env`, 'utf8');
    const m = env.match(/^\s*DISCORD_BOT_TOKEN\s*=\s*(.+)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
  } catch { return null; }
}
const TOKEN = coToken();
const H = { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json' };

async function dapi(method, path, body) {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(API + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined }).catch(() => null);
    if (!r) { await sleep(800); continue; }
    if (r.status === 429) { const j = await r.json().catch(() => ({})); await sleep(((j.retry_after) || 1) * 1000 + 250); continue; }
    return r;
  }
  return null;
}
const react = (e) => dapi('PUT', `/channels/${CHANNEL}/messages/${MSG}/reactions/${encodeURIComponent(e)}/@me`);
const unreact = (e) => dapi('DELETE', `/channels/${CHANNEL}/messages/${MSG}/reactions/${encodeURIComponent(e)}/@me`);
const typing = () => dapi('POST', `/channels/${CHANNEL}/typing`);
async function reply(payload) {
  const r = await dapi('POST', `/channels/${CHANNEL}/messages`, { ...payload, message_reference: { message_id: MSG, fail_if_not_exists: false }, allowed_mentions: { replied_user: false } });
  return (r && r.ok) ? r.json() : null;
}
const editMsg = (id, payload) => dapi('PATCH', `/channels/${CHANNEL}/messages/${id}`, payload);

// ── Host-level locks (work across BOTH bots) ──────────────────────────
function claimMessage(id) { try { mkdirSync(CLAIMS, { recursive: true }); mkdirSync(`${CLAIMS}/${id}`); return true; } catch { return false; } }
// PID-stamped lock file. If the lock exists but its owner PID is dead (e.g. a
// run got killed by a bot restart before releasing), it's stale → clear + take
// it. No more 20-min stuck locks blocking every new run.
function acquireRunLock() {
  mkdirSync(LOCK_DIR, { recursive: true });
  for (let i = 0; i < 3; i++) {
    try { const fd = openSync(RUN_LOCK, 'wx'); writeSync(fd, String(process.pid)); closeSync(fd); return true; }
    catch {
      let alive = false;
      try { const pid = parseInt(readFileSync(RUN_LOCK, 'utf8'), 10); if (pid) { process.kill(pid, 0); alive = true; } } catch { alive = false; }
      if (alive) return false;            // held by a live run
      try { unlinkSync(RUN_LOCK); } catch { }   // stale → clear and retry
    }
  }
  return false;
}
const releaseRunLock = () => { try { unlinkSync(RUN_LOCK); } catch { } };
function rememberSession(replyId, sessionId) {
  if (!replyId || !sessionId) return;
  let map = {}; try { map = JSON.parse(readFileSync(SESS_FILE, 'utf8')); } catch { }
  map[replyId] = sessionId;
  const keys = Object.keys(map); if (keys.length > 300) delete map[keys[0]];
  try { writeFileSync(SESS_FILE, JSON.stringify(map)); } catch { }
}

const ACTIVITY = { Read: 'reading the code', Edit: 'editing code', MultiEdit: 'editing code', Write: 'writing a file', Bash: 'running a command', Grep: 'searching the code', Glob: 'looking for files', Task: 'spinning up a sub-agent', WebFetch: 'checking a page', TodoWrite: 'planning the steps' };
const embed = (color, desc, footer) => ({ color, author: { name: 'Claude' }, description: String(desc).slice(0, 4000), footer: footer ? { text: footer } : undefined, timestamp: new Date().toISOString() });

(async () => {
  if (!TOKEN || !CHANNEL || !MSG) { console.error('[claudeRun] missing token/channel/msg'); process.exit(1); }
  // Dedup: if the other bot's runner already claimed this exact message, bail.
  if (!claimMessage(MSG)) return;
  if (!acquireRunLock()) { await react('⏳'); await reply({ content: "I'm mid-fix on another request — give me a moment and try again." }); return; }

  await react('👀');
  await typing();
  const typer = setInterval(() => typing(), 8000);
  const status = await reply({ embeds: [embed(0x6c7bff, '🔧 On it — spinning up a session…', 'live · working…')] });
  const statusId = status?.id || null;
  let lastEdit = 0;
  const setStatus = async (txt) => {
    if (!statusId) return;
    if (Date.now() - lastEdit < 3500) return;
    lastEdit = Date.now();
    await editMsg(statusId, { embeds: [embed(0x6c7bff, '🔧 ' + txt, 'live · working…')] }).catch(() => { });
  };

  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'];
  if (RESUME) args.push('--resume', RESUME);
  const env = { ...process.env, HOME, PATH: `${process.env.PATH || ''}:${HOME}/.npm-global/bin:/usr/local/bin:/usr/bin:/bin` };
  const child = spawn(CLAUDE, args, { cwd: REPO, env });

  let buf = '', finalText = null, sessionId = RESUME, isErr = false, cost = 0, turns = 0, stderr = '';
  const killer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { } isErr = true; finalText = 'timed out after 20 minutes'; }, TIMEOUT_MS);
  child.stdin.write(PROMPT); child.stdin.end();
  child.stderr.on('data', d => stderr += d);
  child.stdout.on('data', d => {
    buf += d; let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type === 'system' && ev.subtype === 'init') { sessionId = ev.session_id || sessionId; setStatus('reading the code…'); }
      else if (ev.type === 'assistant' && ev.message?.content) {
        const tools = ev.message.content.filter(b => b.type === 'tool_use').map(b => b.name);
        if (tools.length) setStatus(ACTIVITY[tools[tools.length - 1]] || (tools[tools.length - 1] + '…'));
        else { const t = ev.message.content.find(b => b.type === 'text'); if (t?.text) setStatus('thinking it through…'); }
      } else if (ev.type === 'result') { finalText = ev.result; sessionId = ev.session_id || sessionId; isErr = !!ev.is_error; cost = ev.total_cost_usd || 0; turns = ev.num_turns || 0; }
    }
  });
  await new Promise(res => child.on('close', res)).catch(() => { });
  clearTimeout(killer); clearInterval(typer);
  await unreact('👀');

  if (isErr || finalText == null) {
    await react('❌');
    const msg = String(finalText || stderr || 'see server logs').slice(0, 1500);
    if (statusId) await editMsg(statusId, { embeds: [embed(0xef4444, '❌ Couldn\'t finish — ' + msg)] });
    else await reply({ content: '❌ Couldn\'t finish — ' + msg });
  } else {
    await react('✅');
    const e = embed(0x6c7bff, finalText, `session ${String(sessionId || '').slice(0, 8)} · ${turns} turns · $${cost.toFixed(3)} · reply to continue`);
    let replyId = statusId;
    if (statusId) await editMsg(statusId, { embeds: [e] });
    else { const r = await reply({ embeds: [e] }); replyId = r?.id; }
    rememberSession(replyId, sessionId);
  }
  releaseRunLock();
  process.exit(0);
})().catch(e => { console.error('[claudeRun]', e?.message); releaseRunLock(); process.exit(1); });
