// Detached Claude runner — the thing that actually does the work for the
// "Claude fix this" Discord bridge. Spawned DETACHED by either bot's bridge so
// it OUTLIVES a bot restart: a fix that restarts co-discord-bot/aspire-bot can
// no longer kill the run mid-flight (the old footgun). It talks to Discord
// purely over REST, streams live progress into a status message, and posts the
// final summary itself.
//
// CONCURRENCY: instead of one global lock (one session at a time), there is a
// POOL of bot identities — USGRP | Utilities, USGRP | Services, USGRP | GOVT,
// USGRP | Logs. Each run claims the first FREE identity and posts AS that bot,
// so up to N "Claude" sessions can run at once. A run that finds every worker
// busy says so and bails. Locks are PID-stamped AND time-bounded, so a crashed
// run can never wedge a slot forever (any lock older than a max run self-heals).
//
// SESSION CONTINUITY: the session follows the CONVERSATION, not the bot. A reply
// to a Claude card resumes that exact session (CR_RESUME, set by the listener);
// a plain follow-up resumes the channel's last session (channels.json), guarded
// by a per-channel lock + a freshness TTL + a fresh-retry if the id is stale.
//
// Invoked as: node claudeRun.mjs   with env:
//   CR_CHANNEL, CR_MSG (the trigger message), CR_PROMPT_B64 (base64 prompt),
//   CR_RESUME (optional session id to continue), CR_REPLY_TOKEN (DM: the
//   owning bot's token — DMs are private to one bot so the pool can't apply).
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, openSync, writeSync, closeSync, unlinkSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';

const REPO = '/home/vpcommunityorganisation/clawd/services';
const CLAUDE = '/home/vpcommunityorganisation/.npm-global/bin/claude';
const HOME = process.env.HOME || '/home/vpcommunityorganisation';
const LOCK_DIR = `${HOME}/.cache/claude-bridge`;
const CLAIMS = `${LOCK_DIR}/claims`;
const RUN_MARKER = `${LOCK_DIR}/RUNNING`;        // legacy "something is running" flag the Stop button checks
const STOP_FILE = `${LOCK_DIR}/STOP`;            // written by either bot's Stop button
const SESS_FILE = `${LOCK_DIR}/sessions.json`;
const CHAN_FILE = `${LOCK_DIR}/channels.json`;
const API = 'https://discord.com/api/v10';
const TIMEOUT_MS = 60 * 60_000;                  // hard wall for a single run (big "fix everything" jobs need room; reply-to-continue resumes if it's still not enough)
// Idle wall: if the headless session emits NOTHING on stdout for this long and
// hasn't produced a result, its output stream is dead (a dropped API stream
// leaves the CLI blocked in ep_poll forever). Without this the run only ends at
// the 60-min hard wall, wedging its worker slot + channel lock the whole time —
// the "Utilities says it's running but nothing's happening" orphan. Any stream
// event (tool call, assistant text, tool result) resets the heartbeat, so it's
// generous enough not to trip a long single tool/sub-agent step.
const IDLE_MS = 20 * 60_000;
const LOCK_TTL_MS = TIMEOUT_MS + 90_000;         // a lock older than this MUST be dead → reclaim (self-heal). Derived, so it tracks TIMEOUT_MS automatically.
const CHAN_RESUME_TTL_MS = 45 * 60_000;          // only resume a channel session this fresh

const CHANNEL = process.env.CR_CHANNEL;
const MSG = process.env.CR_MSG;
const PROMPT = Buffer.from(process.env.CR_PROMPT_B64 || '', 'base64').toString('utf8');
const RESUME = process.env.CR_RESUME || null;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Read a bot token straight off its .env (the var name differs per bot).
function readTok(file, varName) {
  try {
    const env = readFileSync(`${REPO}/${file}`, 'utf8');
    const m = env.match(new RegExp(`^\\s*${varName}\\s*=\\s*(.+)$`, 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
  } catch { return null; }
}
// The worker pool, in preference order — a single run uses USGRP | Utilities (the
// familiar "Claude" identity); extra concurrent runs spill onto the others.
const POOL_DEF = [
  { name: 'USGRP | Utilities', file: 'co-discord-bot/.env', var: 'DISCORD_BOT_TOKEN' },
  { name: 'USGRP | Services', file: 'aspire-bot/.env',     var: 'ASPIRE_DISCORD_BOT_TOKEN' },
  { name: 'USGRP | GOVT',    file: 'usgrp-gov-bot/.env',  var: 'USGRP_GOV_BOT_TOKEN' },
  { name: 'USGRP | Logs',    file: 'usgrp-logs-bot/.env', var: 'DISCORD_TOKEN' },
];
function buildPool() {
  // A DM channel is private to the bot that received it — the pool can't apply;
  // we MUST post as that bot. One slot, keyed 'dm'.
  if (process.env.CR_REPLY_TOKEN) return [{ name: 'Claude', token: process.env.CR_REPLY_TOKEN, id: 'dm' }];
  return POOL_DEF
    .map((p, i) => ({ name: p.name, token: readTok(p.file, p.var), id: String(i) }))
    .filter(p => p.token);
}

// ── Host locks (PID-stamped + time-bounded; work across BOTH bots) ───────
function claimMessage(id) { try { mkdirSync(CLAIMS, { recursive: true }); mkdirSync(`${CLAIMS}/${id}`); return true; } catch { return false; } }
function pruneClaims() {   // claims/<msg> dirs accrete forever otherwise
  try { const now = Date.now(); for (const d of readdirSync(CLAIMS)) { try { if (now - statSync(`${CLAIMS}/${d}`).mtimeMs > 86_400_000) rmSync(`${CLAIMS}/${d}`, { recursive: true, force: true }); } catch { } } } catch { }
}
// Atomic create; if it exists, reclaim only when its owner PID is dead OR the
// lock is older than any possible run (PID-reuse can't wedge a slot forever).
function takeLock(name) {
  mkdirSync(LOCK_DIR, { recursive: true });
  const f = `${LOCK_DIR}/${name}`;
  for (let i = 0; i < 3; i++) {
    try { const fd = openSync(f, 'wx'); writeSync(fd, String(process.pid)); closeSync(fd); return true; }
    catch {
      let stale = false;
      try {
        if (Date.now() - statSync(f).mtimeMs > LOCK_TTL_MS) stale = true;     // too old to be live → dead
        else { const pid = parseInt(readFileSync(f, 'utf8'), 10); if (!pid) stale = false; else { try { process.kill(pid, 0); } catch { stale = true; } } }
      } catch { stale = true; }
      if (!stale) return false;
      try { unlinkSync(f); } catch { }
    }
  }
  return false;
}
const dropLock = (name) => { try { unlinkSync(`${LOCK_DIR}/${name}`); } catch { } };
function acquireSlot(pool) {
  for (const p of pool) if (takeLock(`RUNNING.${p.id}`)) { try { writeFileSync(RUN_MARKER, String(process.pid)); } catch { } return p; }
  return null;
}
function releaseSlot(id) {
  dropLock(`RUNNING.${id}`);
  // When no worker slot remains active, clear the legacy marker + any stale STOP.
  try {
    const anyLeft = readdirSync(LOCK_DIR).some(f => /^RUNNING\.(dm|\d+)$/.test(f));
    if (!anyLeft) { dropLock('RUNNING'); dropLock('STOP'); }
  } catch { }
}
const lockChannel = (ch) => takeLock(`RUNNING.chan.${ch}`);
const releaseChannel = (ch) => dropLock(`RUNNING.chan.${ch}`);
// A session transcript can only be driven by ONE live process — the Claude CLI
// deadlocks if two runs --resume the same id (both block on the model stream
// forever). This lock is keyed on the session id itself, so it guards BOTH
// resume paths (explicit reply CR_RESUME and channel-fallback) which the
// channel lock alone did not — an in-flight reply used to fork the transcript.
const lockSession = (id) => takeLock(`RUNNING.sess.${id}`);
const releaseSession = (id) => dropLock(`RUNNING.sess.${id}`);

function rememberSession(replyId, sessionId) {
  if (!replyId || !sessionId) return;
  let map = {}; try { map = JSON.parse(readFileSync(SESS_FILE, 'utf8')); } catch { }
  map[replyId] = sessionId;
  const keys = Object.keys(map); if (keys.length > 300) delete map[keys[0]];
  try { writeFileSync(SESS_FILE, JSON.stringify(map)); } catch { }
}
// Whether a saved session id can actually be resumed. Two ways it can't:
//   · the transcript FILE is gone (archived/rotated/never existed) — resuming a
//     nonexistent session hard-fails with "No conversation found with session
//     ID …", and worse, the failure keeps getting re-saved so replies loop on a
//     dead id forever. Missing file → start fresh.
//   · the transcript is HUGE — the CLI chokes loading a month of history and the
//     turn dies with 0 turns / no reply. Past the cap → start fresh.
// Only a present, non-empty, small-enough transcript is resumable.
const RESUME_MAX_BYTES = 40 * 1024 * 1024; // 40MB
function canResume(sessionId) {
  if (!sessionId) return false;
  try {
    const proj = REPO.replace(/\//g, '-');
    const f = `${HOME}/.claude/projects/${proj}/${sessionId}.jsonl`;
    const sz = statSync(f).size;             // throws if the file is missing
    return sz > 0 && sz <= RESUME_MAX_BYTES;
  } catch { return false; }                  // missing/unreadable → can't resume
}

// Channel-scoped session memory (the conversation's session, bot-agnostic).
function channelSession(ch) {
  try { const e = JSON.parse(readFileSync(CHAN_FILE, 'utf8'))[ch]; if (e?.session && Date.now() - (e.at || 0) < CHAN_RESUME_TTL_MS) return e.session; } catch { }
  return null;
}
function recordChannelSession(ch, sessionId) {
  if (!ch || !sessionId) return;
  let m = {}; try { m = JSON.parse(readFileSync(CHAN_FILE, 'utf8')); } catch { }
  m[ch] = { session: sessionId, at: Date.now() };
  const keys = Object.keys(m); if (keys.length > 500) delete m[keys[0]];
  try { writeFileSync(CHAN_FILE, JSON.stringify(m)); } catch { }
}

// ── Discord REST (token + emoji pack are set once a slot is claimed) ──────
let TOKEN = null, H = null, EMOJIS = {};
const em = (k, fb) => EMOJIS[k] || fb;
function useIdentity(token) {
  TOKEN = token;
  H = { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json' };
  try {
    const maps = JSON.parse(readFileSync(new URL('./claude-emojis.json', import.meta.url), 'utf8'));
    const appId = Buffer.from(TOKEN.split('.')[0], 'base64').toString('utf8');
    EMOJIS = maps[appId] || {};
  } catch { EMOJIS = {}; }
}
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
  const r = await dapi('POST', `/channels/${CHANNEL}/messages`, { ...payload, message_reference: { message_id: MSG, fail_if_not_exists: false }, allowed_mentions: payload.allowed_mentions || { replied_user: false } });
  return (r && r.ok) ? r.json() : null;
}
const editMsg = (id, payload) => dapi('PATCH', `/channels/${CHANNEL}/messages/${id}`, payload);

const PHASES = {
  investigate: { key: 'read',   emoji: '🔍', doing: 'Reading the code',         done: 'Read the code' },
  edit:        { key: 'edit',   emoji: '✏️', doing: 'Editing the code',         done: 'Edited the code' },
  build:       { key: 'build',  emoji: '📦', doing: 'Building',                 done: 'Built it' },
  deploy:      { key: 'deploy', emoji: '🚀', doing: 'Deploying',                done: 'Deployed' },
  commit:      { key: 'commit', emoji: '💾', doing: 'Committing to git',        done: 'Committed' },
  run:         { key: 'run',    emoji: '⚙️', doing: 'Running a command',        done: 'Ran a command' },
  subagent:    { key: 'agent',  emoji: '🤖', doing: 'Working with a sub-agent', done: 'Used a sub-agent' },
  think:       { key: 'think',  emoji: '💭', doing: 'Thinking it through',      done: 'Thought it through' },
};
function phaseFor(name, input) {
  if (['Read', 'Grep', 'Glob', 'LS'].includes(name)) return 'investigate';
  if (['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(name)) return 'edit';
  if (name === 'Task') return 'subagent';
  if (name === 'Bash') {
    const c = String(input?.command || '').toLowerCase();
    if (/npm (run )?build|vite build|\btsc\b|webpack/.test(c)) return 'build';
    if (/pm2 (restart|reload|start)/.test(c)) return 'deploy';
    if (/git (commit|push)/.test(c)) return 'commit';
    if (/git (add|status|diff|stash)/.test(c)) return 'edit';
    return 'run';
  }
  return 'think';
}
// State icon for the embed author row, reusing the bot's own emoji pack as CDN
// images: the animated spinner while live, tick/stop/err once finished. Falls
// back to no icon when the pack is missing.
const emojiUrl = (key) => { const m = /^<(a?):\w+:(\d+)>$/.exec(EMOJIS[key] || ''); return m ? `https://cdn.discordapp.com/emojis/${m[2]}.${m[1] ? 'gif' : 'png'}` : undefined; };
const embed = (color, desc, footer, icon) => ({ color, author: { name: 'Claude', icon_url: emojiUrl(icon || 'processing') }, description: String(desc).slice(0, 4000), footer: footer ? { text: footer } : undefined, timestamp: new Date().toISOString() });
const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// Released exactly once, from every exit path (success / error / stop / throw).
let ACTIVE_SLOT = null, ACTIVE_CHAN = null, ACTIVE_SESS = null;
function cleanup() {
  if (ACTIVE_SLOT != null) { releaseSlot(ACTIVE_SLOT); ACTIVE_SLOT = null; }
  if (ACTIVE_CHAN != null) { releaseChannel(ACTIVE_CHAN); ACTIVE_CHAN = null; }
  if (ACTIVE_SESS != null) { releaseSession(ACTIVE_SESS); ACTIVE_SESS = null; }
}

(async () => {
  if (!CHANNEL || !MSG) { console.error('[claudeRun] missing channel/msg'); process.exit(1); }
  pruneClaims();
  // Dedup: if the other bot's runner already claimed this exact message, bail.
  if (!claimMessage(MSG)) return;
  const pool = buildPool();
  if (!pool.length) { console.error('[claudeRun] no bot tokens available'); process.exit(1); }

  const startedAt = Date.now();
  const seen = [];                              // ordered phase keys (consecutive-deduped)
  const pushPhase = (k) => { if (seen[seen.length - 1] !== k) seen.push(k); };
  let WORKER = null, statusId = null, lastEdit = 0;
  const foot = (label) => `${label} · ${WORKER} · ${mmss(Date.now() - startedAt)}`;
  const doneFoot = (r) => `✓ done in ${mmss(Date.now() - startedAt)} · ${r.turns} turn${r.turns === 1 ? '' : 's'} · $${r.cost.toFixed(2)} · reply to continue`;
  // Aggregate the step trail: each distinct step once, in first-seen order, with
  // an ×N count — the old render emitted one line per occurrence, so a long run
  // read as "Thought it through / Ran a command / Thought it through / …" noise
  // that drowned the actual summary.
  const tally = (list) => { const m = new Map(); for (const k of list) m.set(k, (m.get(k) || 0) + 1); return [...m.entries()]; };
  const renderProgress = () => {
    const cur = seen[seen.length - 1] || 'investigate';
    // Finished steps as a compact ticked checklist; the current step last with
    // the animated processing spinner so the card visibly *moves* while it works.
    const lines = tally(seen.slice(0, -1)).map(([k, n]) => `${em('tick', '✅')} ${(PHASES[k] || PHASES.think).done}${n > 1 ? ` ×${n}` : ''}`);
    const p = PHASES[cur] || PHASES.think;
    lines.push(`${em('processing', '⏳')} ${em(p.key, p.emoji)} ${p.doing}…`);
    return lines.join('\n');
  };
  // Finished cards lead with the summary; the trail collapses to one small
  // subtext line underneath — what happened, not a log.
  const renderTrail = () => tally(seen).map(([k, n]) => { const p = PHASES[k] || PHASES.think; return `${em(p.key, p.emoji)} ${p.done}${n > 1 ? ` ×${n}` : ''}`; }).join(' · ');
  // Append the -# subtext trail only if it fits inside the 4000-char description
  // cap — a slice mid-emoji would render as broken `<:cl_…` markup.
  const withTrail = (text) => { const t = String(text); const trail = renderTrail(); const add = trail ? `\n\n-# ${trail}` : ''; return (add && t.length + add.length <= 4000) ? t + add : t; };
  const setStatus = async () => {
    if (!statusId || Date.now() - lastEdit < 3000) return;
    lastEdit = Date.now();
    await editMsg(statusId, { embeds: [embed(0x6c7bff, renderProgress(), foot('live'))] }).catch(() => { });
  };

  // Claim a free worker AND successfully post the status as that bot. If a
  // worker can't reach this channel, free it and advance to the next one.
  const remaining = [...pool];
  while (remaining.length) {
    const s = acquireSlot(remaining);
    if (!s) break;                              // every remaining worker is busy
    remaining.splice(remaining.findIndex(p => p.id === s.id), 1);
    useIdentity(s.token);
    WORKER = s.name;
    const stopRef = /<:(\w+):(\d+)>/.exec(em('stop', '') || '');
    var STOP_ROW = [{ type: 1, components: [{ type: 2, style: 4, label: 'Stop all', emoji: stopRef ? { name: stopRef[1], id: stopRef[2] } : { name: '🛑' }, custom_id: 'claudebr:stop' }] }];
    const st = await reply({ embeds: [embed(0x6c7bff, `${em('processing', '⏳')} ${em('boot', '🔧')} Spinning up a session…`, foot('live'))], components: STOP_ROW });
    if (st?.id) { ACTIVE_SLOT = s.id; statusId = st.id; break; }
    releaseSlot(s.id);                          // couldn't post here → try the next worker
  }
  if (ACTIVE_SLOT == null) {
    const t = pool[0].token;
    const HH = { Authorization: `Bot ${t}`, 'Content-Type': 'application/json' };
    await fetch(`${API}/channels/${CHANNEL}/messages`, { method: 'POST', headers: HH, body: JSON.stringify({ content: `All ${pool.length} Claude workers are busy right now — give it a moment and reply again.`, message_reference: { message_id: MSG, fail_if_not_exists: false }, allowed_mentions: { replied_user: false } }) }).catch(() => { });
    process.exit(0);
  }

  // Who asked — so we can @ them when it's done.
  let requesterId = null;
  try { const r = await dapi('GET', `/channels/${CHANNEL}/messages/${MSG}`); if (r && r.ok) { const m = await r.json(); requesterId = m.author?.id || null; } } catch { }

  await react('👀');
  await typing();
  const typer = setInterval(() => typing(), 8000);

  // One headless Claude attempt. Streams progress into the status message and
  // resolves to the run's outcome. The first terminal cause (normal close /
  // timeout / Stop) wins atomically.
  async function runOnce(resumeId) {
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'];
    if (resumeId) args.push('--resume', resumeId);
    // CLAUDE_AUTOMATED silences the global "Claude finished — your turn" Stop-hook
    // DM — this bridge run posts its own rich progress card, so the generic
    // session-end DM to Dion + Evan is just noise.
    const env = { ...process.env, HOME, CLAUDE_AUTOMATED: '1', PATH: `${process.env.PATH || ''}:${HOME}/.npm-global/bin:/usr/local/bin:/usr/bin:/bin` };
    const child = spawn(CLAUDE, args, { cwd: REPO, env });
    let buf = '', finalText = null, sessionId = resumeId, isErr = false, cost = 0, turns = 0, stderr = '', stoppedBy = null, terminated = false, stalled = false;
    // Fallback for the "ticks but no message" bug: the `result` event's text is
    // occasionally empty (the model ended its turn on a tool call / an empty final
    // message). Keep the last non-empty assistant TEXT block we streamed so we can
    // fall back to it instead of posting a blank success embed.
    let lastAssistantText = null;
    // Resolve as soon as the run is truly finished — don't block on the stdout
    // pipe closing. If the Claude session spawned a BACKGROUNDED child (e.g. a
    // run_in_background bash), that child inherits stdout and keeps the pipe open
    // long after Claude emitted its `result` and exited — so waiting on
    // child.on('close') would leave the reply stuck on the last phase ("Thinking
    // it through…") until the 60-min timeout. `doneResolve` finalises the moment
    // we have everything (the result event, a stop, or the process exiting).
    let doneResolve;
    const done = new Promise(res => { doneResolve = res; });
    const finish = () => { try { doneResolve(); } catch {} };
    const term = (reason) => {
      if (terminated) return; terminated = true;
      if (reason.stop) stoppedBy = reason.stop;
      if (reason.timeout) { isErr = true; finalText = `timed out after ${Math.round(TIMEOUT_MS / 60_000)} minutes`; }
      if (reason.stalled) { isErr = true; stalled = true; finalText = `the session went quiet for ${Math.round(IDLE_MS / 60_000)} minutes with no output (its stream to the model dropped), so I stopped it here to free the worker`; }
      try { child.kill('SIGKILL'); } catch { }
      finish();
    };
    const killer = setTimeout(() => term({ timeout: true }), TIMEOUT_MS);
    // Idle watchdog: rearmed on every stdout chunk (see child.stdout 'data'). If
    // it ever fires, the stream has been silent for IDLE_MS → the run is dead.
    let idle = setTimeout(() => term({ stalled: true }), IDLE_MS);
    const beat = () => { clearTimeout(idle); idle = setTimeout(() => term({ stalled: true }), IDLE_MS); };
    // Stop button → kill sessions that were running when it was clicked (we
    // honour a STOP only if it's newer than our start; a fresh run ignores an
    // old one). releaseSlot clears STOP once the last session ends.
    const stopWatch = setInterval(() => {
      try {
        if (!existsSync(STOP_FILE) || statSync(STOP_FILE).mtimeMs < startedAt) return;
        let by; try { by = JSON.parse(readFileSync(STOP_FILE, 'utf8').trim()); } catch { by = { name: 'a founder' }; }
        term({ stop: by });
      } catch { }
    }, 1500);
    child.stdin.write(PROMPT); child.stdin.end();
    child.stderr.on('data', d => stderr += d);
    child.stdout.on('data', d => {
      beat();                     // any output = alive; rearm the idle watchdog
      buf += d; let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'system' && ev.subtype === 'init') {
          sessionId = ev.session_id || sessionId;
          // Map the status card → this session AS SOON AS the id is known, not
          // only on completion. Otherwise, if the founder replies to the card
          // while the run is still going — or the run errors before the
          // completion-time rememberSession() — the reply finds no mapping,
          // dispatches resume:false, and cold-starts with NO memory of the
          // conversation (the "why don't you check your previous responses" bug:
          // whole multi-turn threads kept re-litigating from scratch). Recording
          // it here means a reply resumes the moment a session exists. Also seed
          // the channel session so a plain follow-up resumes too.
          if (sessionId && statusId) { rememberSession(statusId, sessionId); recordChannelSession(CHANNEL, sessionId); }
          // Lock a FRESH session id the moment it's minted, so a reply arriving
          // mid-run can't resume (and deadlock) the transcript we're driving.
          if (sessionId && ACTIVE_SESS !== sessionId && lockSession(sessionId)) ACTIVE_SESS = sessionId;
          pushPhase('investigate'); setStatus();
        }
        else if (ev.type === 'assistant' && ev.message?.content) {
          const toolBlocks = ev.message.content.filter(b => b.type === 'tool_use');
          if (toolBlocks.length) { const tb = toolBlocks[toolBlocks.length - 1]; pushPhase(phaseFor(tb.name, tb.input)); setStatus(); }
          else {
            // Remember the last real text the model produced — the fallback if the
            // result event comes back empty.
            const txt = ev.message.content.filter(b => b.type === 'text' && b.text).map(b => b.text).join('\n').trim();
            if (txt) { lastAssistantText = txt; pushPhase('think'); setStatus(); }
          }
        } else if (ev.type === 'result' && !terminated) {
          // Prefer the result text; fall back to the last streamed assistant text
          // if it's empty/whitespace, so a valid turn never posts a blank message.
          const resultText = (ev.result == null ? '' : String(ev.result)).trim();
          finalText = resultText || lastAssistantText || null;
          sessionId = ev.session_id || sessionId; isErr = !!ev.is_error; cost = ev.total_cost_usd || 0; turns = ev.num_turns || 0;
          // The result event IS the definitive end of the turn — finalise now so a
          // backgrounded child holding stdout open can't stall the reply. Kill the
          // child (and its group) so any such leaked pipe is released.
          try { child.kill('SIGKILL'); } catch {}
          finish();
        }
      }
    });
    // Also finalise if the process exits/closes without a result event (crash,
    // early EOF) — whichever comes first wins; both are idempotent.
    child.on('close', finish);
    child.on('exit', finish);
    await done;
    clearTimeout(killer); clearTimeout(idle); clearInterval(stopWatch);
    return { finalText, sessionId, isErr, cost, turns, stderr, stoppedBy, stalled };
  }

  // Resume order: an explicit reply (CR_RESUME) is precise and wins. Otherwise
  // fall back to the channel's last session — but only under a per-channel lock
  // so two same-channel runs can't fork one transcript; if it's locked, or the
  // session turns out stale, we start fresh.
  let resume = RESUME, usedChannelResume = false;
  // An explicit reply resume (CR_RESUME) is only usable if its transcript still
  // exists and isn't bloated — otherwise the CLI hard-fails ("No conversation
  // found …"). Drop a dead/huge one so we cleanly start fresh instead of looping.
  if (resume && !canResume(resume)) resume = null;
  // A session can only be driven by one live run. If another process already
  // holds this session (e.g. you replied to a card whose run is STILL going),
  // don't resume it — that deadlocks the CLI. Start fresh instead so the ask
  // still gets done. Guards the explicit-reply path the channel lock missed.
  if (resume && !lockSession(resume)) resume = null;
  else if (resume) ACTIVE_SESS = resume;
  if (!resume) {
    const cs = channelSession(CHANNEL);
    if (cs && canResume(cs) && lockChannel(CHANNEL) && lockSession(cs)) {
      resume = cs; usedChannelResume = true; ACTIVE_CHAN = CHANNEL; ACTIVE_SESS = cs;
    }
  }

  let R = await runOnce(resume);
  // A resume that still failed at runtime (stale id, race, transcript vanished
  // between the check and the run) would otherwise strand the founder. Retry
  // once as a FRESH session for ANY resume — reply-resume or channel-resume —
  // so the ask still gets done. (Only a genuine error, never a Stop.)
  if (R.isErr && resume && !R.stoppedBy) {
    // The resume failed — free its session lock before retrying fresh so we
    // don't hold a dead id (the fresh run mints + locks its own id at init).
    if (ACTIVE_SESS != null) { releaseSession(ACTIVE_SESS); ACTIVE_SESS = null; }
    pushPhase('think'); await setStatus(); R = await runOnce(null);
  }

  clearInterval(typer);
  await unreact('👀');

  const pingDone = async (line) => {
    if (!requesterId) return null;
    const r = await reply({ content: `${line} <@${requesterId}>`, allowed_mentions: { users: [requesterId], replied_user: false } });
    return r?.id || null;
  };

  if (R.stoppedBy) {
    await react('🛑');
    const e = embed(0xf59e0b, withTrail(`${em('stop', '🛑')} **Stopped by ${R.stoppedBy.name}**`), foot('stopped'), 'stop');
    if (statusId) await editMsg(statusId, { embeds: [e], components: [] });
    const pingId = await pingDone(`${em('stop', '🛑')} Stopped.`);
    if (R.sessionId) { rememberSession(statusId, R.sessionId); rememberSession(pingId, R.sessionId); }
  } else if (R.isErr || R.finalText == null || !String(R.finalText).trim()) {
    // Genuine failure OR the turn ended with no usable text (result empty AND no
    // assistant text to fall back on). Never leave the founder with blank ticks:
    // if it wasn't an error, say the work's done but there was no written reply.
    const noText = !R.isErr && (R.finalText == null || !String(R.finalText).trim());
    await react(noText ? '✅' : '❌');
    if (noText) {
      const body = withTrail(`${em('tick', '✅')} Done — but I didn't produce a written reply this time (the turn ended on an action with no summary). Reply to continue if you need more.`);
      const e = embed(0x4ade80, body, doneFoot(R), 'tick');
      if (statusId) await editMsg(statusId, { embeds: [e], components: [] });
      const pingId = await pingDone(`${em('tick', '✅')} Done (no written reply) — reply to continue.`);
      if (R.sessionId) { rememberSession(statusId, R.sessionId); rememberSession(pingId, R.sessionId); }
    } else {
      const msg = String(R.finalText || R.stderr || 'see server logs').slice(0, 1500);
      if (statusId) await editMsg(statusId, { embeds: [embed(0xef4444, withTrail(`${em('err', '❌')} Couldn't finish — ` + msg), foot('failed'), 'err')], components: [] });
      const pingId = await pingDone(`${em('err', '❌')} That one didn't finish —`);
      // Only remember the session if it's genuinely resumable. A failed run's
      // sessionId is often the dead resume id we were handed — re-saving it here
      // is what re-poisoned the map and made replies loop on a dead session.
      if (R.sessionId && canResume(R.sessionId)) { rememberSession(statusId, R.sessionId); rememberSession(pingId, R.sessionId); }
    }
  } else {
    await react('✅');
    const e = embed(0x4ade80, withTrail(R.finalText), doneFoot(R), 'tick');
    let replyId = statusId;
    if (statusId) await editMsg(statusId, { embeds: [e], components: [] });
    else { const r = await reply({ embeds: [e] }); replyId = r?.id; }
    const pingId = await pingDone(`${em('tick', '✅')} Done in ${mmss(Date.now() - startedAt)} — reply to continue.`);
    rememberSession(replyId, R.sessionId);
    rememberSession(pingId, R.sessionId);
    recordChannelSession(CHANNEL, R.sessionId);   // only on success — never poison the channel with a failed id
  }
  cleanup();
  process.exit(0);
})().catch(e => { console.error('[claudeRun]', e?.message); try { cleanup(); } catch { } process.exit(1); });
