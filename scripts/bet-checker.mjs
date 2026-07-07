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
// flatten every player's stat row into { fullName: { key: value } }
const players = {};
for (const g of (json.boxscore?.players || [])) {
  for (const block of (g.statistics || [])) {
    const keys = block.keys || block.names || [];
    for (const a of (block.athletes || [])) {
      const name = a.athlete?.displayName || '';
      const rec = players[name] || (players[name] = {});
      (a.stats || []).forEach((v, i) => { if (keys[i]) rec[keys[i]] = v; });
    }
  }
}
function playerStat(nameSub, keys) {
  const entry = Object.entries(players).find(([n]) => n.toLowerCase().includes(nameSub.toLowerCase()));
  if (!entry) return null;
  for (const k of keys) {
    const raw = entry[1][k];
    if (raw != null) { const n = Number(String(raw).replace(/[^0-9.-]/g, '')); if (Number.isFinite(n)) return n; }
  }
  return null;
}
const SOT = ['shotsOnTarget', 'shotsOnGoal', 'onTargetScoringAtt'];
const GOALS = ['totalGoals', 'goals'];
const FOULS_WON = ['foulsSuffered', 'foulsDrawn', 'wasFouled'];
const SAVES = ['saves', 'goalKeeperSaves', 'savesMade'];

const totalFouls = (teamStat('United States', ['foulsCommitted', 'fouls']) ?? 0) + (teamStat('Belgium', ['foulsCommitted', 'fouls']) ?? 0);
const totalCorners = (teamStat('United States', ['wonCorners', 'corners', 'cornerKicks']) ?? 0) + (teamStat('Belgium', ['wonCorners', 'corners', 'cornerKicks']) ?? 0);
const totalCards = (teamStat('United States', ['yellowCards']) ?? 0) + (teamStat('United States', ['redCards']) ?? 0) + (teamStat('Belgium', ['yellowCards']) ?? 0) + (teamStat('Belgium', ['redCards']) ?? 0);
const totalGoals = usaScore + belScore;
const freeseSaves = teamStat('United States', SAVES) ?? playerStat('Freese', SAVES);
const courtoisSaves = teamStat('Belgium', SAVES) ?? playerStat('Courtois', SAVES);

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

const player = (sub, keys) => playerStat(sub, keys);

const slip1 = {
  title: 'Slip 1 · £4.50 → £162 @ 35/1', legs: [
    numLeg('3+ Match Total Cards', totalCards, 3),
    numLeg('Balogun 1+ Shots on Target', player('Balogun', SOT), 1),
    numLeg('Balogun 2+ Fouls Won', player('Balogun', FOULS_WON), 2),
    numLeg('9+ Match Total Corners', totalCorners, 9),
    numLeg('Freese 3+ Saves', freeseSaves, 3),
    numLeg('Courtois 2+ Saves', courtoisSaves, 2),
    numLeg('De Ketelaere 1+ Fouls Won', player('Ketelaere', FOULS_WON), 1),
    numLeg('Balogun Anytime Scorer', player('Balogun', GOALS), 1),
    numLeg('Trossard 1+ Shots on Target', player('Trossard', SOT), 1),
    numLeg('De Ketelaere 1+ Shots on Target', player('Ketelaere', SOT), 1),
    boolLeg('Both Teams To Score', usaScore >= 1 && belScore >= 1, `${usaScore}-${belScore}`),
  ],
};
const slip2 = {
  title: 'Slip 2 · £4.50 → £904.50 @ 180/1', legs: [
    numLeg('22+ Match Total Fouls', totalFouls, 22),
    numLeg('9+ Match Total Corners', totalCorners, 9),
    numLeg('Courtois 3+ Saves', courtoisSaves, 3),
    numLeg('Freese 3+ Saves', freeseSaves, 3),
    numLeg('Balogun 3+ Fouls Won', player('Balogun', FOULS_WON), 3),
    numLeg('3+ Match Total Cards', totalCards, 3),
    numLeg('Balogun 1+ Shots on Target', player('Balogun', SOT), 1),
    numLeg('De Ketelaere 1+ Shots on Target', player('Ketelaere', SOT), 1),
    numLeg('Balogun Anytime Scorer', player('Balogun', GOALS), 1),
    numLeg('Trossard Anytime Scorer', player('Trossard', GOALS), 1),
  ],
};
const slip3 = {
  title: 'Slip 3 · £2 free → £80 @ 40/1', legs: [
    boolLeg('Belgium (2UP paid if 2 clear)', st.maxBelLead >= 2 || (final && belScore > usaScore), `${usaScore}-${belScore}`),
    boolLeg('Both Teams To Score', usaScore >= 1 && belScore >= 1, `${usaScore}-${belScore}`),
    numLeg('Over 2.5 Total Goals', totalGoals, 3),
    numLeg('Pulisic 1+ Shots on Target', player('Pulisic', SOT), 1),
    numLeg('De Bruyne 1+ Shots on Target (benched)', player('Bruyne', SOT), 1),
    numLeg('Balogun Anytime Scorer', player('Balogun', GOALS), 1),
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
