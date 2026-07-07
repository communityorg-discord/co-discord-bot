#!/usr/bin/env node
// Live bet tracker for Dion's USA v Belgium bet-builder slips (2026-07-06).
// Reads the live ESPN match feed, evaluates every leg on all three slips, and
// posts a leg-by-leg card into #bot-commands. Runs on a cron every few minutes
// while the match is on; posts an "armed" note before kick-off, live updates
// during the game, one final card at FT, then self-removes its own cron line.
//
// All the bet stats are MONOTONIC (goals/cards/corners/fouls/shots/saves only
// ever go up), so once a leg is hit it stays hit — no need to persist per-leg
// state beyond the 2UP "max Belgium lead" (a lead can shrink if USA pull one
// back, but 2UP pays the moment they ever go 2 clear).
//
// Cron (added by me):
//   */3 * * * * /usr/bin/node .../co-discord-bot/scripts/bet-checker.mjs
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!TOKEN) { console.error('[bets] DISCORD_BOT_TOKEN missing'); process.exit(1); }

const CHANNEL = '1472453534304960585';                 // #bot-commands (USGRP | Testing)
const EVENT = '760507';                                 // ESPN gameId USA v Belgium
const LEAGUE = 'fifa.friendly';
const STATE = '/home/vpcommunityorganisation/.local/state/bet-checker.json';
const SELF = fileURLToPath(import.meta.url);

let st = { armed: false, postedFinal: false, maxBelLead: 0 };
try { st = { ...st, ...JSON.parse(readFileSync(STATE, 'utf8')) }; } catch { /* first run */ }
const saveState = () => { mkdirSync('/home/vpcommunityorganisation/.local/state', { recursive: true }); writeFileSync(STATE, JSON.stringify(st)); };

// ---- fetch live feed --------------------------------------------------------
let json;
try {
  const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${LEAGUE}/summary?event=${EVENT}`, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error('espn ' + r.status);
  json = await r.json();
} catch (e) { console.error('[bets] feed fetch failed', e.message); process.exit(0); }

const comp = json.header?.competitions?.[0];
const state = comp?.status?.type?.state || 'pre';        // pre | in | post
const clock = comp?.status?.type?.shortDetail || comp?.status?.displayClock || '';
const home = (comp?.competitors || []).find(c => c.homeAway === 'home');
const away = (comp?.competitors || []).find(c => c.homeAway === 'away');
// ESPN's soccer summary leaves competitor.score undefined and keeps the live
// score in linescores (a single cumulative entry that updates as goals go in).
// Prefer .score, fall back to the last linescore value.
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
const usaScore = liveScore(home);                       // United States = home
const belScore = liveScore(away);                       // Belgium = away
const lead = belScore - usaScore;
if (lead > st.maxBelLead) { st.maxBelLead = lead; }

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
// ESPN's soccer summary does NOT populate boxscore.players during a live match
// (it stays empty and only fills post-game, if ever). The live per-player facts
// we need — goals, shots on target, fouls won — are only in the text feeds:
//   keyEvents[]  → goals & cards (structured, reliable)
//   commentary[] → "Attempt saved/blocked/missed by X", "Goal! ... X (Team)",
//                  "X wins a free kick" (fouls won)
// So we derive per-player counts by parsing that text.
const PLAYER = { sot: {}, goals: {}, foulsWon: {} };  // { substringKey: count } via helpers below
const bump = (bag, name) => { if (name) bag[name] = (bag[name] || 0) + 1; };

// Structured goals from keyEvents (most reliable for scorers).
for (const e of (json.keyEvents || [])) {
  const type = (e.type?.text || '').toLowerCase();
  if (type.startsWith('goal') && !type.includes('own')) {
    // first participant is the scorer; "Goal! ... Name (Team)" also in text
    const scorer = e.participants?.[0]?.athlete?.displayName
      || (e.text || '').match(/Goal![^.]*?\.\s*([A-Z][^()]+?)\s*\(/)?.[1]?.trim();
    if (scorer) { bump(PLAYER.goals, scorer); bump(PLAYER.sot, scorer); } // a goal is a shot on target
  }
}
// Commentary text parse for shots on target + fouls won (and goals as backup).
for (const c of (json.commentary || [])) {
  const t = c.text || '';
  let m;
  if ((m = t.match(/Attempt saved\.\s*([^.(]+?)\s*\(/))) bump(PLAYER.sot, m[1].trim());
  else if ((m = t.match(/^Goal!.*?\.\s*([^.(]+?)\s*\(/))) { const n = m[1].trim(); if (!PLAYER.goals[n]) bump(PLAYER.goals, n); bump(PLAYER.sot, n); }
  if ((m = t.match(/([^.(]+?)\s*\([^)]*\)\s*wins a free kick/))) bump(PLAYER.foulsWon, m[1].trim());
}

function countFor(bag, nameSub) {
  const sub = nameSub.toLowerCase();
  let n = 0; let seen = false;
  for (const [name, c] of Object.entries(bag)) if (name.toLowerCase().includes(sub)) { n += c; seen = true; }
  return { n, seen };
}
// Returns a live count for a player metric, or null when we genuinely have no
// signal yet (so the leg shows ⏳ pending, not a false 0). Once the game has
// events, an absent name means 0 for that metric (they just haven't done it).
function playerStat(nameSub, kind) {
  const bag = kind === 'goals' ? PLAYER.goals : kind === 'foulsWon' ? PLAYER.foulsWon : PLAYER.sot;
  const anyData = (json.commentary || []).length > 0 || (json.keyEvents || []).length > 1;
  if (!anyData) return null;                 // no feed yet → pending
  return countFor(bag, nameSub).n;           // 0 is a real answer once play is underway
}
const SAVES = ['saves', 'goalKeeperSaves', 'savesMade'];

const totalFouls = (teamStat('United States', ['foulsCommitted', 'fouls']) ?? 0) + (teamStat('Belgium', ['foulsCommitted', 'fouls']) ?? 0);
const totalCorners = (teamStat('United States', ['wonCorners', 'corners', 'cornerKicks']) ?? 0) + (teamStat('Belgium', ['wonCorners', 'corners', 'cornerKicks']) ?? 0);
const totalCards = (teamStat('United States', ['yellowCards']) ?? 0) + (teamStat('United States', ['redCards']) ?? 0) + (teamStat('Belgium', ['yellowCards']) ?? 0) + (teamStat('Belgium', ['redCards']) ?? 0);
const totalGoals = usaScore + belScore;
// Keeper saves come from the TEAM stat (each side has one keeper) — the live
// team boxscore carries `saves`, which is exactly the GK's save count.
const freeseSaves = teamStat('United States', SAVES);
const courtoisSaves = teamStat('Belgium', SAVES);

// ---- leg helpers ------------------------------------------------------------
const final = state === 'post';
// numeric "N+" leg: hit if cur>=target; unknown if data missing; pending until FT; miss at FT
const numLeg = (label, cur, target) => {
  let status;
  if (cur == null) status = final ? 'miss' : 'unknown';
  else if (cur >= target) status = 'hit';
  else status = final ? 'miss' : 'pending';
  return { label, status, cur: cur == null ? '?' : cur };
};
// boolean leg (already-happened condition)
const boolLeg = (label, cond, curTxt) => ({ label, status: cond ? 'hit' : (final ? 'miss' : 'pending'), cur: curTxt });

const sot = (sub) => playerStat(sub, 'sot');
const fw = (sub) => playerStat(sub, 'foulsWon');
const gl = (sub) => playerStat(sub, 'goals');

const slip1 = {
  title: 'Slip 1 · £4.50 → £162 @ 35/1', legs: [
    numLeg('3+ Match Total Cards', totalCards, 3),
    numLeg('Balogun 1+ Shots on Target', sot('Balogun'), 1),
    numLeg('Balogun 2+ Fouls Won', fw('Balogun'), 2),
    numLeg('9+ Match Total Corners', totalCorners, 9),
    numLeg('Freese 3+ Saves', freeseSaves, 3),
    numLeg('Courtois 2+ Saves', courtoisSaves, 2),
    numLeg('De Ketelaere 1+ Fouls Won', fw('Ketelaere'), 1),
    numLeg('Balogun Anytime Scorer', gl('Balogun'), 1),
    numLeg('Trossard 1+ Shots on Target', sot('Trossard'), 1),
    numLeg('De Ketelaere 1+ Shots on Target', sot('Ketelaere'), 1),
    boolLeg('Both Teams To Score', usaScore >= 1 && belScore >= 1, `${usaScore}-${belScore}`),
  ],
};
const slip2 = {
  title: 'Slip 2 · £4.50 → £904.50 @ 180/1', legs: [
    numLeg('22+ Match Total Fouls', totalFouls, 22),
    numLeg('9+ Match Total Corners', totalCorners, 9),
    numLeg('Courtois 3+ Saves', courtoisSaves, 3),
    numLeg('Freese 3+ Saves', freeseSaves, 3),
    numLeg('Balogun 3+ Fouls Won', fw('Balogun'), 3),
    numLeg('3+ Match Total Cards', totalCards, 3),
    numLeg('Balogun 1+ Shots on Target', sot('Balogun'), 1),
    numLeg('De Ketelaere 1+ Shots on Target', sot('Ketelaere'), 1),
    numLeg('Balogun Anytime Scorer', gl('Balogun'), 1),
    numLeg('Trossard Anytime Scorer', gl('Trossard'), 1),
  ],
};
const slip3 = {
  title: 'Slip 3 · £2 free → £80 @ 40/1', legs: [
    boolLeg('Belgium (2UP paid if 2 clear)', st.maxBelLead >= 2 || (final && belScore > usaScore), `${usaScore}-${belScore}`),
    boolLeg('Both Teams To Score', usaScore >= 1 && belScore >= 1, `${usaScore}-${belScore}`),
    numLeg('Over 2.5 Total Goals', totalGoals, 3),
    numLeg('Pulisic 1+ Shots on Target', sot('Pulisic'), 1),
    numLeg('De Bruyne 1+ Shots on Target (benched)', sot('Bruyne'), 1),
    numLeg('Balogun Anytime Scorer', gl('Balogun'), 1),
    numLeg('9+ Match Total Corners', totalCorners, 9),
    numLeg('Freese 3+ Saves', freeseSaves, 3),
    numLeg('Courtois 2+ Saves', courtoisSaves, 2),
  ],
};

const ICON = { hit: '✅', miss: '❌', pending: '⏳', unknown: '❔' };
function renderSlip(s) {
  const hits = s.legs.filter(l => l.status === 'hit').length;
  const gone = s.legs.filter(l => l.status === 'miss').length;
  const tag = final ? (gone === 0 ? '🟢 WINNER' : gone > 0 && hits === s.legs.length - gone ? `🔴 ${gone} gone` : `🔴 ${gone} gone`) : (gone ? `🔴 ${gone} gone` : '🟢 alive');
  const head = `**${s.title}** — ${hits}/${s.legs.length} ${tag}`;
  const body = s.legs.map(l => `${ICON[l.status]} ${l.label} (${l.cur})`).join('\n');
  return `${head}\n${body}`;
}

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
      title: '🎯 Bet tracker armed — USA v Belgium',
      description: 'Locked and loaded on all three of your slips. I’ll post a live leg-by-leg card in here every few minutes once it kicks off, and a final card at full time. ✅ hit · ⏳ still to land · ❌ gone.',
      color: 0x2ECC71,
      footer: { text: 'Claude · live bet tracker' },
    });
    st.armed = true; saveState();
    console.log('[bets] armed');
  } else console.log('[bets] pre-game, waiting');
  process.exit(0);
}

if (state === 'post' && st.postedFinal) { console.log('[bets] final already posted'); removeSelfCron(); process.exit(0); }

const scoreLine = `${home?.team?.displayName || 'USA'} ${usaScore}–${belScore} ${away?.team?.displayName || 'Belgium'}`;
const embed = {
  title: `${final ? '🏁 FULL TIME' : '⚽ LIVE'} — ${scoreLine}${clock ? ` · ${clock}` : ''}`,
  description: [renderSlip(slip1), renderSlip(slip2), renderSlip(slip3)].join('\n\n').slice(0, 4096),
  color: final ? 0xF1C40F : 0x3498DB,
  footer: { text: `Claude · live bet tracker${final ? ' · final' : ''}` },
  timestamp: new Date().toISOString(),
};
await post(embed);
if (final) { st.postedFinal = true; saveState(); removeSelfCron(); }
console.log(`[bets] posted ${final ? 'FINAL' : 'live'} card (${scoreLine})`);
