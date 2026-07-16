#!/usr/bin/env node
// Live tracker for Dion's REAL-MONEY darts acca — £7.50 13-fold, Match Winner
// on 13 of the 16 World Matchplay first-round ties (Sat 18 – Mon 20 Jul 2026,
// Blackpool). Sister script to bet-checker.mjs (the England v Argentina
// tracker) but multi-event: the legs span three days of sessions, so this one
// lives on a cron for the whole tournament window and posts a card into
// #bot-commands whenever a leg goes live, moves, or settles.
//
// DATA SOURCE: Flashscore's mobile feed (global.flashscore.ninja) with the
// public x-fsign key — the only feed reachable from this box that carries
// per-match PDC darts (ESPN has no darts; TheSportsDB only has whole-session
// "Day 1" events; Sofascore 403s datacenter IPs). One daily-schedule fetch per
// match day still holding unsettled legs; rows carry live leg scores (AG-AH)
// and the finished flag, keyed by stable event ids resolved 2026-07-16.
//
// Acca maths: 13 fractional prices multiply to 69.957x → £7.50 returns
// ~£524.68 (bookie rounding may differ by pennies).
//
// Manual override (feed insurance, same idea as bet-checker's manual file):
//   echo '{"legs":{"4zw6r2bk":"won"}}' > ~/.local/state/darts-acca-manual.json
// Values: "won" | "lost" | "void" (void = leg drops out, e.g. retirement
// refund — shown ⚪ and excluded from the multiplier note).
//
// Cron (self-removes after the final card):
//   */3 * * * * /usr/bin/node .../co-discord-bot/scripts/darts-acca-checker.mjs
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!TOKEN) { console.error('[acca] DISCORD_BOT_TOKEN missing'); process.exit(1); }

const CHANNEL = '1472453534304960585';                 // #bot-commands (USGRP | Testing)
const STATE = '/home/vpcommunityorganisation/.local/state/darts-acca-checker.json';
const MANUAL_FILE = '/home/vpcommunityorganisation/.local/state/darts-acca-manual.json';
const FEED = 'https://global.flashscore.ninja/2/x/feed';
const FSIGN = 'SW9D1eZo';

// ===== ACCA CONFIG ===========================================================
// Legs exactly as placed. `id` = Flashscore event id; `side` = which side of
// that fixture Dion backed (feed home/away order — note Doets is the AWAY
// player in Smith v Doets). `date` = fixture date in Europe/London, used to
// pick the daily feed. Odds are the placed fractional prices.
const ACCA = {
  label: 'World Matchplay 13-fold',
  stake: '£7.50',
  combined: '69.96x',
  returns: '~£524.68',
  legs: [
    { id: '4zw6r2bk', pick: 'Stephen Bunting',    side: 'home', vs: 'Niels Zonneveld',      odds: '1/2',  date: '2026-07-18' },
    { id: 'fsoKi6y3', pick: 'Luke Littler',       side: 'home', vs: 'Niko Springer',        odds: '1/12', date: '2026-07-18' },
    { id: 'SzgYT2qd', pick: 'Nathan Aspinall',    side: 'home', vs: 'Joe Cullen',           odds: '1/2',  date: '2026-07-18' },
    { id: 'MgIwc1Dr', pick: 'Chris Dobey',        side: 'home', vs: 'Dirk van Duijvenbode', odds: '1/2',  date: '2026-07-19' },
    { id: 'YinzlOzS', pick: 'Gary Anderson',      side: 'home', vs: 'Ryan Joyce',           odds: '1/4',  date: '2026-07-19' },
    { id: 'jBR72NkL', pick: 'Michael van Gerwen', side: 'home', vs: 'Andrew Gilding',       odds: '1/3',  date: '2026-07-19' },
    { id: 'C0tEttT1', pick: 'Jonny Clayton',      side: 'home', vs: 'Damon Heta',           odds: '8/15', date: '2026-07-19' },
    { id: 'QsJQ7IR0', pick: 'Ryan Searle',        side: 'home', vs: "William O'Connor",     odds: '8/15', date: '2026-07-19' },
    { id: 'IHFI9vcl', pick: 'James Wade',         side: 'home', vs: 'Jermaine Wattimena',   odds: '8/13', date: '2026-07-19' },
    { id: 'nZOnF0ZQ', pick: 'Wessel Nijman',      side: 'home', vs: 'Dave Chisnall',        odds: '1/6',  date: '2026-07-19' },
    { id: '4fTa4qL8', pick: 'Kevin Doets',        side: 'away', vs: 'Ross Smith',           odds: '8/11', date: '2026-07-20' },
    { id: 'f7Goeure', pick: 'Gerwyn Price',       side: 'home', vs: 'Martin Schindler',     odds: '2/7',  date: '2026-07-20' },
    { id: 'ELQvHM4E', pick: 'Luke Humphries',     side: 'home', vs: 'Cameron Menzies',      odds: '1/6',  date: '2026-07-20' },
  ],
};
// =============================================================================

let st = { armed: false, postedFinal: false, legs: {} };  // legs[id] = { status, score, start }
try { st = { ...st, ...JSON.parse(readFileSync(STATE, 'utf8')) }; } catch { /* first run */ }
const saveState = () => { mkdirSync('/home/vpcommunityorganisation/.local/state', { recursive: true }); writeFileSync(STATE, JSON.stringify(st)); };

let MANUAL = {};
try { MANUAL = JSON.parse(readFileSync(MANUAL_FILE, 'utf8')); } catch { /* none */ }

// ---- Discord post + cron helpers (same shape as bet-checker.mjs) ------------
async function post(embed) {
  const r = await fetch(`https://discord.com/api/v10/channels/${CHANNEL}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  });
  if (!r.ok) { console.error('[acca] post failed', r.status, await r.text()); process.exit(1); }
}
function removeSelfCron() {
  try {
    const cur = execSync('crontab -l', { encoding: 'utf8' });
    const next = cur.split('\n').filter(l => !l.includes('darts-acca-checker.mjs')).join('\n');
    execSync('crontab -', { input: next.endsWith('\n') ? next : next + '\n' });
    console.log('[acca] removed own cron line');
  } catch (e) { console.error('[acca] cron self-remove failed', e.message); }
}

if (process.argv.includes('--stop')) {
  if (!st.postedFinal) {
    await post({
      title: `🛑 Acca tracker stopped — ${ACCA.label}`,
      description: 'Switching the live tracker off here on request — no more cards for this slip.',
      color: 0xE74C3C,
      footer: { text: 'Claude · live acca tracker · stopped' },
      timestamp: new Date().toISOString(),
    });
  }
  st.postedFinal = true; saveState();
  removeSelfCron();
  console.log('[acca] stopped on request');
  process.exit(0);
}

// ---- fetch the daily schedule feeds -----------------------------------------
// Flashscore daily feeds are keyed by day OFFSET from today in the requested
// timezone (param `1` = UTC+1 = UK summer time). Fetch one feed per match day
// that still has unsettled legs; skip days outside the feed's ±7-day window.
const dayMs = 86_400_000;
const ukToday = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' }));
const offsetFor = (date) => Math.round((new Date(date) - ukToday) / dayMs);
const isTerminal = (s) => ['won', 'lost', 'void', 'check'].includes(s);

const wantDays = [...new Set(ACCA.legs.filter(l => !isTerminal(st.legs[l.id]?.status)).map(l => l.date))];
const rows = {};   // event id -> parsed field map
for (const date of wantDays) {
  const off = offsetFor(date);
  if (off < -7 || off > 7) continue;
  try {
    const r = await fetch(`${FEED}/f_14_${off}_1_en_1`, {
      headers: { 'x-fsign': FSIGN, 'User-Agent': 'okhttp/4.9.3' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error('feed ' + r.status);
    const txt = await r.text();
    for (const row of txt.split('~')) {
      const f = {};
      for (const kv of row.split('¬')) { const i = kv.indexOf('÷'); if (i > 0) f[kv.slice(0, i)] = kv.slice(i + 1); }
      if (f.AA) rows[f.AA] = f;
    }
  } catch (e) { console.error('[acca] feed fetch failed for', date, e.message); }
}

// ---- evaluate each leg -------------------------------------------------------
// Flashscore stage codes (AB): 1 scheduled · 2 live · 3 finished. AG/AH = legs
// won home/away. Manual file wins over the feed; settled legs never reopen
// (a feed hiccup must not un-settle a decided leg).
const ukTime = (ts) => new Date(ts * 1000).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit' });
for (const leg of ACCA.legs) {
  const prev = st.legs[leg.id] || {};
  const manual = MANUAL.legs?.[leg.id];
  if (manual && ['won', 'lost', 'void'].includes(manual)) { st.legs[leg.id] = { ...prev, status: manual, score: prev.score || 'manual' }; continue; }
  if (isTerminal(prev.status)) continue;
  const f = rows[leg.id];
  if (!f) { st.legs[leg.id] = { ...prev, status: prev.status || 'pending' }; continue; }
  const ab = Number(f.AB || 1);
  const hs = Number(f.AG), as = Number(f.AH);
  const haveScore = Number.isFinite(hs) && Number.isFinite(as);
  const pickScore = leg.side === 'home' ? hs : as;
  const oppScore = leg.side === 'home' ? as : hs;
  const score = haveScore ? `${pickScore}-${oppScore}` : null;
  const start = Number(f.AD) ? ukTime(Number(f.AD)) : prev.start;
  if (ab === 3) {
    // Finished. No usable score (walkover / retirement / feed gap) → 'check':
    // terminal for our purposes but flagged to verify settlement at the bookie.
    if (!haveScore || pickScore === oppScore) st.legs[leg.id] = { status: 'check', score: score || 'no score', start };
    else st.legs[leg.id] = { status: pickScore > oppScore ? 'won' : 'lost', score, start };
  } else if (ab === 2) {
    st.legs[leg.id] = { status: 'live', score: score || '0-0', start };
  } else {
    st.legs[leg.id] = { status: 'pending', score: null, start };
  }
}

// ---- render the card ---------------------------------------------------------
const ICON = { won: '✅', lost: '❌', live: '🎯', pending: '⏳', void: '⚪', check: '❔' };
const legLine = (leg) => {
  const s = st.legs[leg.id] || { status: 'pending' };
  const bits = [`${ICON[s.status]} **${leg.pick}** ${leg.odds}`, `v ${leg.vs}`];
  if (s.status === 'pending') bits.push(`· ${s.start || leg.date}`);
  if (s.status === 'live') bits.push(`· LIVE ${s.score}`);
  if (s.status === 'won' || s.status === 'lost') bits.push(`· ${s.score}`);
  if (s.status === 'check') bits.push(`· finished ${s.score} — check the bookie`);
  if (s.status === 'void') bits.push('· void (manual)');
  return bits.join(' ');
};
const statuses = ACCA.legs.map(l => st.legs[l.id]?.status || 'pending');
const won = statuses.filter(s => s === 'won').length;
const lost = statuses.filter(s => s === 'lost').length;
const liveNow = statuses.filter(s => s === 'live').length;
const allDone = statuses.every(isTerminal);
const dead = lost > 0;
const headline = dead
  ? `🔴 ACCA GONE — ${lost} leg${lost > 1 ? 's' : ''} down (${won}/${ACCA.legs.length} landed)`
  : allDone
    ? (statuses.every(s => s === 'won') ? `🏆 WINNER — all ${ACCA.legs.length} landed · ${ACCA.stake} → ${ACCA.returns}` : `🟡 ${won}/${ACCA.legs.length} landed — ❔ legs need checking at the bookie`)
    : `🟢 alive — ${won}/${ACCA.legs.length} landed${liveNow ? ` · ${liveNow} on the oche now` : ''}`;
const description = [
  `**${ACCA.stake} · ${ACCA.legs.length}-fold @ ${ACCA.combined} → ${ACCA.returns}**`,
  headline, '',
  ...ACCA.legs.map(legLine), '',
  '✅ landed · 🎯 live · ⏳ still to throw · ❌ gone · ❔ check settlement',
].join('\n');
const embed = (title, color, footerNote) => ({
  title, color, description,
  footer: { text: `Claude · live acca tracker${footerNote ? ` · ${footerNote}` : ''}` },
  timestamp: new Date().toISOString(),
});

// ---- on-demand preview (read-only, like bet-checker) --------------------------
if (process.argv.includes('--preview')) {
  await post(embed(`👀 Preview — ${ACCA.label}`, 0x9B59B6, 'preview'));
  console.log('[acca] posted preview card');
  process.exit(0);
}

// ---- post logic ---------------------------------------------------------------
// Post only on material change. While the acca is alive that includes live
// scores; once it's dead, only leg settlements re-post (three days of live
// ticks on a dead slip is just noise).
const sig = ACCA.legs.map(l => {
  const s = st.legs[l.id] || {};
  return `${l.id}:${s.status || 'pending'}:${(!dead || isTerminal(s.status)) ? (s.score || '') : ''}`;
}).join('|') + `|dead${dead}`;

if (!st.armed) {
  await post(embed(`🎯 Acca tracker armed — ${ACCA.label}`, 0x2ECC71, 'armed'));
  st.armed = true;
  st.liveSig = sig;
  saveState();
  console.log('[acca] armed');
  process.exit(0);
}

if (st.postedFinal) { console.log('[acca] final already posted'); removeSelfCron(); process.exit(0); }

if (!allDone && st.liveSig === sig) { console.log('[acca] no change — staying quiet'); process.exit(0); }

if (allDone) {
  await post(embed(`🏁 FINAL — ${ACCA.label}`, statuses.every(s => s === 'won') ? 0xF1C40F : (dead ? 0xE74C3C : 0xF39C12), 'final'));
  st.postedFinal = true; st.liveSig = sig; saveState();
  removeSelfCron();
  console.log('[acca] posted FINAL card');
} else {
  const justDied = dead && !st.deadNotified;
  await post(embed(
    justDied ? `💔 Leg down — ${ACCA.label}` : `🎯 ${liveNow ? 'LIVE' : 'Update'} — ${ACCA.label}`,
    dead ? 0xE74C3C : 0x3498DB,
  ));
  if (justDied) st.deadNotified = true;
  st.liveSig = sig; saveState();
  console.log('[acca] posted card:', headline);
}
