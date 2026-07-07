#!/usr/bin/env node
// Live bet tracker for Dion's bet-builder slips. Reads the live ESPN match feed,
// evaluates every leg on each slip, and posts a leg-by-leg card into
// #bot-commands. Runs on a cron every few minutes while a match is on: posts an
// "armed" note before kick-off, live cards during the game (only when something
// material changes), a quiet half-time card, one final card at FT, then removes
// its own cron line.
//
// CONFIG-DRIVEN: to track a new match, edit the MATCH block and the SLIPS block
// below, wipe the state file, and re-add the cron. Everything else is generic.
//
// Cron:
//   */3 * * * * /usr/bin/node .../co-discord-bot/scripts/bet-checker.mjs
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!TOKEN) { console.error('[bets] DISCORD_BOT_TOKEN missing'); process.exit(1); }

const CHANNEL = '1472453534304960585';                 // #bot-commands (USGRP | Testing)
const STATE = '/home/vpcommunityorganisation/.local/state/bet-checker.json';

// ===== MATCH CONFIG ==========================================================
const MATCH = {
  event: '760509',              // ESPN gameId
  league: 'fifa.world',         // ESPN soccer league slug
  home: 'Argentina',            // exact ESPN display name (home)
  away: 'Egypt',                // exact ESPN display name (away)
  label: 'Argentina v Egypt',
};
// =============================================================================

let st = { event: MATCH.event, armed: false, postedFinal: false, postedHalftime: false, maxHomeLead: 0, maxAwayLead: 0 };
try {
  const saved = JSON.parse(readFileSync(STATE, 'utf8'));
  if (saved.event === MATCH.event) st = { ...st, ...saved };  // same match → resume; different → fresh
} catch { /* first run */ }
const saveState = () => { mkdirSync('/home/vpcommunityorganisation/.local/state', { recursive: true }); writeFileSync(STATE, JSON.stringify(st)); };

// ---- fetch live feed --------------------------------------------------------
let json;
try {
  const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${MATCH.league}/summary?event=${MATCH.event}`, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error('espn ' + r.status);
  json = await r.json();
} catch (e) { console.error('[bets] feed fetch failed', e.message); process.exit(0); }

const comp = json.header?.competitions?.[0];
const state = comp?.status?.type?.state || 'pre';        // pre | in | post
const statusName = comp?.status?.type?.name || '';       // e.g. STATUS_HALFTIME
const clock = comp?.status?.type?.shortDetail || comp?.status?.displayClock || '';
const home = (comp?.competitors || []).find(c => c.homeAway === 'home');
const away = (comp?.competitors || []).find(c => c.homeAway === 'away');
// ESPN's soccer summary leaves competitor.score undefined and keeps the live
// score in linescores (a single cumulative entry that updates as goals go in).
function liveScore(c) {
  const s = Number(c?.score);
  if (Number.isFinite(s)) return s;
  const ls = c?.linescores;
  if (Array.isArray(ls) && ls.length) {
    const v = Number(ls[ls.length - 1]?.displayValue ?? ls[ls.length - 1]?.value);
    if (Number.isFinite(v)) return v;
  }
  return 0;
}
const homeScore = liveScore(home);
const awayScore = liveScore(away);
if (homeScore - awayScore > st.maxHomeLead) st.maxHomeLead = homeScore - awayScore;
if (awayScore - homeScore > st.maxAwayLead) st.maxAwayLead = awayScore - homeScore;

// ---- stat lookups -----------------------------------------------------------
function teamStat(teamName, keys) {
  const t = (json.boxscore?.teams || []).find(x => (x.team?.displayName || '').includes(teamName));
  if (!t) return null;
  for (const k of keys) {
    const s = (t.statistics || []).find(s => s.name === k);
    if (s) { const n = Number(String(s.value ?? s.displayValue).replace(/[^0-9.-]/g, '')); if (Number.isFinite(n)) return n; }
  }
  return null;
}
// ESPN does NOT populate boxscore.players live, so per-player facts (goals, shots
// on target, fouls won) are derived from the text feeds: keyEvents for goals &
// cards, commentary for "Attempt saved" (SOT), goals, and "X wins a free kick".
const PLAYER = { sot: {}, goals: {}, foulsWon: {} };
const bump = (bag, name) => { if (name) bag[name] = (bag[name] || 0) + 1; };
for (const e of (json.keyEvents || [])) {
  const type = (e.type?.text || '').toLowerCase();
  if (type.startsWith('goal') && !type.includes('own')) {
    const scorer = e.participants?.[0]?.athlete?.displayName
      || (e.text || '').match(/Goal![^.]*?\.\s*([A-Z][^()]+?)\s*\(/)?.[1]?.trim();
    if (scorer) { bump(PLAYER.goals, scorer); bump(PLAYER.sot, scorer); }  // a goal is a shot on target
  }
}
for (const c of (json.commentary || [])) {
  const t = c.text || '';
  let m;
  if ((m = t.match(/Attempt saved\.\s*([^.(]+?)\s*\(/))) bump(PLAYER.sot, m[1].trim());
  else if ((m = t.match(/^Goal!.*?\.\s*([^.(]+?)\s*\(/))) { const n = m[1].trim(); if (!PLAYER.goals[n]) bump(PLAYER.goals, n); bump(PLAYER.sot, n); }
  if ((m = t.match(/([^.(]+?)\s*\([^)]*\)\s*wins a free kick/))) bump(PLAYER.foulsWon, m[1].trim());
}
function countFor(bag, nameSub) {
  const sub = nameSub.toLowerCase(); let n = 0;
  for (const [name, c] of Object.entries(bag)) if (name.toLowerCase().includes(sub)) n += c;
  return n;
}
function playerStat(nameSub, kind) {
  const bag = kind === 'goals' ? PLAYER.goals : kind === 'foulsWon' ? PLAYER.foulsWon : PLAYER.sot;
  const anyData = (json.commentary || []).length > 0 || (json.keyEvents || []).length > 1;
  if (!anyData) return null;      // no feed yet → pending
  return countFor(bag, nameSub);  // 0 is a real answer once play is underway
}
const SAVES = ['saves', 'goalKeeperSaves', 'savesMade'];

const totalCorners = (teamStat(MATCH.home, ['wonCorners', 'corners', 'cornerKicks']) ?? 0) + (teamStat(MATCH.away, ['wonCorners', 'corners', 'cornerKicks']) ?? 0);
const totalFouls = (teamStat(MATCH.home, ['foulsCommitted', 'fouls']) ?? 0) + (teamStat(MATCH.away, ['foulsCommitted', 'fouls']) ?? 0);
const totalCards = (teamStat(MATCH.home, ['yellowCards']) ?? 0) + (teamStat(MATCH.home, ['redCards']) ?? 0) + (teamStat(MATCH.away, ['yellowCards']) ?? 0) + (teamStat(MATCH.away, ['redCards']) ?? 0);
const totalGoals = homeScore + awayScore;
const keeperSaves = (team) => teamStat(team, SAVES);   // each side has one keeper; team `saves` = GK saves

// ---- leg helpers ------------------------------------------------------------
const final = state === 'post';
const numLeg = (label, cur, target) => {
  let status;
  if (cur == null) status = final ? 'miss' : 'unknown';
  else if (cur >= target) status = 'hit';
  else status = final ? 'miss' : 'pending';
  return { label, status, cur: cur == null ? '?' : cur };
};
const boolLeg = (label, cond, curTxt) => ({ label, status: cond ? 'hit' : (final ? 'miss' : 'pending'), cur: curTxt });
const sot = (sub) => playerStat(sub, 'sot');
const gl = (sub) => playerStat(sub, 'goals');
const scoreTxt = `${homeScore}-${awayScore}`;
// 2UP pays the moment the backed side ever goes 2 clear (early payout); also
// counts as won at FT if that side is simply ahead.
const twoUp = (side) => {
  const everTwoClear = side === 'home' ? st.maxHomeLead >= 2 : st.maxAwayLead >= 2;
  const winningAtFT = final && (side === 'home' ? homeScore > awayScore : awayScore > homeScore);
  return boolLeg(`${side === 'home' ? MATCH.home : MATCH.away} Match Result (2UP)`, everTwoClear || winningAtFT, scoreTxt);
};
const btts = () => boolLeg('Both Teams To Score', homeScore >= 1 && awayScore >= 1, scoreTxt);

// ===== SLIP CONFIG ===========================================================
// Dion's placed slip: £2 free bet → £100 @ 50/1 (9 legs).
const SLIPS = [{
  title: 'Slip · £2 free → £100 @ 50/1', legs: [
    twoUp('home'),                                              // Argentina Match Result (2UP)
    numLeg('Over 2.5 Total Goals', totalGoals, 3),
    btts(),
    numLeg('8+ Match Total Corners', totalCorners, 8),
    numLeg('Lautaro Martínez 1+ Shots on Target', sot('Lautaro'), 1),
    numLeg('Emi Martínez 2+ Saves', keeperSaves(MATCH.home), 2),
    numLeg('Shobeir 4+ Saves', keeperSaves(MATCH.away), 4),
    numLeg('Enzo Fernández 1+ Shots on Target', sot('Enzo'), 1),
    numLeg('Messi 2+ Goals', gl('Messi'), 2),
  ],
}];
// =============================================================================

const ICON = { hit: '✅', miss: '❌', pending: '⏳', unknown: '❔' };
function renderSlip(s) {
  const hits = s.legs.filter(l => l.status === 'hit').length;
  const gone = s.legs.filter(l => l.status === 'miss').length;
  const tag = final ? (gone === 0 ? '🟢 WINNER' : `🔴 ${gone} gone`) : (gone ? `🔴 ${gone} gone` : '🟢 alive');
  return `**${s.title}** — ${hits}/${s.legs.length} ${tag}\n` + s.legs.map(l => `${ICON[l.status]} ${l.label} (${l.cur})`).join('\n');
}
const slipsBody = () => SLIPS.map(renderSlip).join('\n\n').slice(0, 4096);

// ---- post -------------------------------------------------------------------
async function post(embed) {
  const r = await fetch(`https://discord.com/api/v10/channels/${CHANNEL}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  });
  if (!r.ok) { console.error('[bets] post failed', r.status, await r.text()); process.exit(1); }
}
function removeSelfCron() {
  try {
    const cur = execSync('crontab -l', { encoding: 'utf8' });
    const next = cur.split('\n').filter(l => !l.includes('bet-checker.mjs')).join('\n');
    execSync('crontab -', { input: next.endsWith('\n') ? next : next + '\n' });
    console.log('[bets] removed own cron line');
  } catch (e) { console.error('[bets] cron self-remove failed', e.message); }
}

if (state === 'pre') {
  if (!st.armed) {
    await post({
      title: `🎯 Bet tracker armed — ${MATCH.label}`,
      description: 'Locked and loaded on your slip. I’ll post a live leg-by-leg card in here as things happen once it kicks off, and a final card at full time. ✅ hit · ⏳ still to land · ❌ gone.',
      color: 0x2ECC71,
      footer: { text: 'Claude · live bet tracker' },
    });
    st.armed = true; saveState();
    console.log('[bets] armed');
  } else console.log('[bets] pre-game, waiting');
  process.exit(0);
}

if (state === 'post' && st.postedFinal) { console.log('[bets] final already posted'); removeSelfCron(); process.exit(0); }

const scoreLine = `${home?.team?.displayName || MATCH.home} ${homeScore}–${awayScore} ${away?.team?.displayName || MATCH.away}`;

// Half time — mostly static, but ESPN's stat feed lags the whistle and keeps
// catching up for a minute or two, so re-post only when the key totals move.
if (statusName === 'STATUS_HALFTIME') {
  const sig = `${scoreTxt}|c${totalCorners}|f${totalFouls}|k${totalCards}`;
  if (st.htSig !== sig) {
    await post({
      title: `⏸️ HALF TIME — ${scoreLine}`,
      description: slipsBody() + '\n\n*Paused for the break — I’ll pick back up when the second half kicks off.*',
      color: 0x95A5A6,
      footer: { text: 'Claude · live bet tracker · half time' },
      timestamp: new Date().toISOString(),
    });
    st.postedHalftime = true; st.htSig = sig; saveState();
    console.log('[bets] posted HT card (sig', sig + ')');
  } else console.log('[bets] halftime, no stat change — staying quiet');
  process.exit(0);
}

// In open play, only post when something MATERIAL moved so the channel gets a
// card on every real event instead of an identical one every 3 min. FT always posts.
const liveSig = `${scoreTxt}|c${totalCorners}|f${totalFouls}|k${totalCards}`
  + `|hs${keeperSaves(MATCH.home) ?? '?'}|as${keeperSaves(MATCH.away) ?? '?'}`
  + `|sot${JSON.stringify(PLAYER.sot)}|g${JSON.stringify(PLAYER.goals)}`;
if (!final && st.liveSig === liveSig) { console.log('[bets] no change since last card — skipping'); process.exit(0); }
await post({
  title: `${final ? '🏁 FULL TIME' : '⚽ LIVE'} — ${scoreLine}${clock ? ` · ${clock}` : ''}`,
  description: slipsBody(),
  color: final ? 0xF1C40F : 0x3498DB,
  footer: { text: `Claude · live bet tracker${final ? ' · final' : ''}` },
  timestamp: new Date().toISOString(),
});
st.liveSig = liveSig;
if (final) st.postedFinal = true;
saveState();
if (final) removeSelfCron();
console.log(`[bets] posted ${final ? 'FINAL' : 'live'} card (${scoreLine})`);
