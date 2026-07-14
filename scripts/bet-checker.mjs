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
  event: '760514',              // ESPN gameId
  league: 'fifa.world',         // ESPN soccer league slug
  home: 'France',               // exact ESPN display name (home)
  away: 'Spain',                // exact ESPN display name (away)
  label: 'France v Spain',
};
// =============================================================================

let st = { event: MATCH.event, armed: false, postedFinal: false, postedHalftime: false, maxHomeLead: 0, maxAwayLead: 0, htHome: null, htAway: null };
try {
  const saved = JSON.parse(readFileSync(STATE, 'utf8'));
  if (saved.event === MATCH.event) st = { ...st, ...saved };  // same match → resume; different → fresh
} catch { /* first run */ }
const saveState = () => { mkdirSync('/home/vpcommunityorganisation/.local/state', { recursive: true }); writeFileSync(STATE, JSON.stringify(st)); };

// ---- manual stat overrides ----------------------------------------------------
// For markets ESPN's feed doesn't carry (throw-ins). When Dion posts the count
// from the bookie, drop it in this file and the leg tracks it like any other
// stat — no code change needed:
//   echo '{"event":"760514","throwIns":16,"asOf":"HT (7+9)"}' > ~/.local/state/bet-checker-manual.json
// Keys: event (must match MATCH.event or the file is ignored), one entry per
// market (throwIns: <number>), optional asOf (shown next to the count), and
// optional final:true meaning the numbers are full-time-final so an
// under-the-line count may settle to a definite miss.
const MANUAL_FILE = '/home/vpcommunityorganisation/.local/state/bet-checker-manual.json';
let MANUAL = {};
try { const m = JSON.parse(readFileSync(MANUAL_FILE, 'utf8')); if (String(m.event) === MATCH.event) MANUAL = m; } catch { /* none yet */ }

// ---- manual stop ------------------------------------------------------------
// `node bet-checker.mjs --stop` ends the tracker on demand (e.g. the slips are
// dead and there's no point watching extra time). Posts one closing card, marks
// the tracker done, and removes its own cron so it stops running. Deliberately
// independent of the live feed so it works even if ESPN is slow or down.
if (process.argv.includes('--stop')) {
  if (!st.postedFinal) {
    await post({
      title: `🛑 Bet tracker stopped — ${MATCH.label}`,
      description: 'Closing this one out — the slips can’t come in, so I’m switching the live tracker off here. No more cards for this match.',
      color: 0xE74C3C,
      footer: { text: 'Claude · live bet tracker · stopped' },
      timestamp: new Date().toISOString(),
    });
  }
  st.postedFinal = true; saveState();
  removeSelfCron();
  console.log('[bets] stopped on request');
  process.exit(0);
}

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
const PLAYER = { sot: {}, goals: {}, foulsWon: {}, assists: {}, foulsCommitted: {}, woodwork: {}, cards: {}, shots: {}, saves: {} };
const bump = (bag, name) => { if (name) bag[name] = (bag[name] || 0) + 1; };
// Per-team goal tally (by scorer). Feeds slipDeadReason so we can tell when a
// correct-score leg and several anytime-scorer legs on one slip have become
// jointly impossible even though no single leg has individually died yet.
const goalsByTeam = { home: {}, away: {} };
const goalSide = (e) => {
  const tid = String(e.team?.id ?? ''); const tname = e.team?.displayName || '';
  if (tid === String(home?.team?.id) || tname.includes(MATCH.home)) return 'home';
  if (tid === String(away?.team?.id) || tname.includes(MATCH.away)) return 'away';
  return null;
};
for (const e of (json.keyEvents || [])) {
  const type = (e.type?.text || '').toLowerCase();
  // A converted IN-GAME penalty arrives as type "Penalty - Scored", not "Goal…"
  // (Oyarzabal's 22' pen tonight), so key on ESPN's scoringPlay flag as well as
  // the type text. Shootout pens carry shootout:true and must NOT count toward
  // scorer/team-goal markets.
  const isGoal = (type.startsWith('goal') || e.scoringPlay === true) && e.shootout !== true;
  if (isGoal && !type.includes('own')) {
    const scorer = e.participants?.[0]?.athlete?.displayName
      || (e.text || '').match(/Goal![^.]*?\.\s*([A-Z][^()]+?)\s*\(/)?.[1]?.trim();
    if (scorer) { bump(PLAYER.goals, scorer); bump(PLAYER.sot, scorer); }  // a goal is a shot on target
    const side = goalSide(e);
    if (side) bump(goalsByTeam[side], scorer || '(unknown)');
    // second participant on a goal event is usually the assister
    const assister = e.participants?.[1]?.athlete?.displayName;
    if (assister) bump(PLAYER.assists, assister);
  } else if (isGoal && type.includes('own')) {
    // own goal credits the OTHER team's tally (never a named-scorer leg)
    const benef = goalSide(e) === 'home' ? 'away' : goalSide(e) === 'away' ? 'home' : null;
    if (benef) bump(goalsByTeam[benef], '(own goal)');
  } else if (type.includes('card')) {
    // Yellow/red card events carry the booked player — feeds "player carded" legs.
    const booked = e.participants?.[0]?.athlete?.displayName;
    if (booked) bump(PLAYER.cards, booked);
  }
}
for (const c of (json.commentary || [])) {
  const t = c.text || '';
  let m;
  if ((m = t.match(/Attempt saved\.\s*([^.(]+?)\s*\(/))) bump(PLAYER.sot, m[1].trim());
  else if ((m = t.match(/^Goal!.*?\.\s*([^.(]+?)\s*\(/))) { const n = m[1].trim(); if (!PLAYER.goals[n]) bump(PLAYER.goals, n); bump(PLAYER.sot, n); }
  // Woodwork: ESPN commentary writes "hits the ... post"/"hits the bar"/"hits the crossbar".
  // Counts toward "shots on target INCLUDING woodwork" enhanced markets only.
  if ((m = t.match(/([^.(]+?)\s*\([^)]*\)[^.]*?hits the (?:left |right )?(?:post|bar|crossbar)/i))) bump(PLAYER.woodwork, m[1].trim());
  if ((m = t.match(/([^.(]+?)\s*\([^)]*\)\s*wins a free kick/))) bump(PLAYER.foulsWon, m[1].trim());
  // "Assisted by X." appears on the goal commentary line
  if ((m = t.match(/Assisted by\s+([^.(]+?)\s*[.(]/))) bump(PLAYER.assists, m[1].trim());
  // "Foul by X (Team)." → fouls committed
  if ((m = t.match(/Foul by\s+([^.(]+?)\s*\(/))) bump(PLAYER.foulsCommitted, m[1].trim());
  // "X (Team) is shown the yellow/red card" → player booked (fallback to keyEvents)
  if ((m = t.match(/([^.(]+?)\s*\([^)]*\)\s*is shown the (?:yellow|red) card/i))) { const n = m[1].trim(); if (!PLAYER.cards[n]) bump(PLAYER.cards, n); }
}
// Accent-insensitive so "Mbappé" matches a feed that writes "Mbappe" and
// vice-versa. Also fold the Nordic letters (ø→o, å→a, æ→ae, ð→d) that NFD does
// NOT decompose, so "Ødegaard" matches a feed writing "Odegaard" either way.
const norm = (s) => (s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/ø/gi, 'o').replace(/å/gi, 'a').replace(/æ/gi, 'ae').replace(/ð/gi, 'd').replace(/þ/gi, 'th')
  .toLowerCase();
function countFor(bag, nameSub) {
  const sub = norm(nameSub); let n = 0;
  for (const [name, c] of Object.entries(bag)) if (norm(name).includes(sub)) n += c;
  return n;
}
// ---- Opta-grade structured per-player stats ---------------------------------
// ESPN's soccer summary is Stats-Perform/Opta-sourced and carries an actual
// per-player stat block in rosters[].roster[].stats — the same granular numbers
// bookies settle on (shots on target, fouls suffered = "fouled X times", goals,
// assists). That's far more reliable than inferring them from commentary text,
// so we PREFER these when the feed has them and keep the commentary scrape as an
// early-match fallback (and the only source for woodwork, which isn't in here).
const ROSTER_PLAYERS = [];
for (const side of (json.rosters || [])) {
  for (const p of (side.roster || [])) {
    if (!Array.isArray(p.stats) || !p.stats.length) continue;
    const stat = {};
    for (const s of p.stats) { const n = Number(s.value); if (Number.isFinite(n)) stat[s.name] = n; }
    if (Object.keys(stat).length) ROSTER_PLAYERS.push({ name: p.athlete?.displayName || '', stat });
  }
}
const haveRosterStats = ROSTER_PLAYERS.length > 0;
// map our leg "kind" → ESPN roster stat field name. `cards` is special (sum of
// yellowCards + redCards) so it's handled directly in rosterStat below.
const ROSTER_FIELD = { goals: 'totalGoals', sot: 'shotsOnTarget', foulsWon: 'foulsSuffered', foulsCommitted: 'foulsCommitted', assists: 'goalAssists', shots: 'totalShots', saves: 'saves' };
function rosterStat(nameSub, kind) {
  const sub = norm(nameSub); let n = 0, matched = false;
  for (const p of ROSTER_PLAYERS) {
    if (!norm(p.name).includes(sub)) continue;
    if (kind === 'cards') {
      const y = p.stat.yellowCards, r = p.stat.redCards;
      if (y != null || r != null) { n += (y || 0) + (r || 0); matched = true; }
    } else {
      const field = ROSTER_FIELD[kind];
      if (field && p.stat[field] != null) { n += p.stat[field]; matched = true; }
    }
  }
  return matched ? n : null;
}
// Minutes on the match clock (0 pre-kickoff; parses "45'+2'" → 45).
const clockMin = Number(String(comp?.status?.displayClock || '0').match(/\d+/)?.[0] || 0);
function playerStat(nameSub, kind) {
  // Opta-grade structured stats first; fall back to commentary if the player
  // isn't in the roster block yet (or the feed hasn't published stats at all).
  if (haveRosterStats) { const r = rosterStat(nameSub, kind); if (r != null) return r; }
  const bag = kind === 'goals' ? PLAYER.goals : kind === 'foulsWon' ? PLAYER.foulsWon : kind === 'assists' ? PLAYER.assists : kind === 'foulsCommitted' ? PLAYER.foulsCommitted : kind === 'cards' ? PLAYER.cards : kind === 'shots' ? PLAYER.shots : kind === 'saves' ? PLAYER.saves : PLAYER.sot;
  const anyData = (json.commentary || []).length > 0 || (json.keyEvents || []).length > 1;
  // Before the feeds wake up — pre-kickoff and the opening minutes before the
  // first commentary line / roster-stat block lands — every player is genuinely
  // on 0 of everything, so report a live 0 (⏳ pending), not ❔ "no data".
  // Keep ❔ only for a real mid-game feed gap: play well underway yet ESPN
  // publishing NO player data at all, where a hard 0 would be a guess.
  if (!anyData) return (state === 'pre' || (state === 'in' && clockMin < 10)) ? 0 : null;
  return countFor(bag, nameSub);  // 0 is a real answer once play is underway
}
const SAVES = ['saves', 'goalKeeperSaves', 'savesMade'];

const homeCorners = teamStat(MATCH.home, ['wonCorners', 'corners', 'cornerKicks']) ?? 0;
const awayCorners = teamStat(MATCH.away, ['wonCorners', 'corners', 'cornerKicks']) ?? 0;
const totalCorners = homeCorners + awayCorners;
const totalFouls = (teamStat(MATCH.home, ['foulsCommitted', 'fouls']) ?? 0) + (teamStat(MATCH.away, ['foulsCommitted', 'fouls']) ?? 0);
const totalCards = (teamStat(MATCH.home, ['yellowCards']) ?? 0) + (teamStat(MATCH.home, ['redCards']) ?? 0) + (teamStat(MATCH.away, ['yellowCards']) ?? 0) + (teamStat(MATCH.away, ['redCards']) ?? 0);
const totalGoals = homeScore + awayScore;
const totalSOT = (teamStat(MATCH.home, ['shotsOnTarget', 'onTargetScoringAtt']) ?? 0) + (teamStat(MATCH.away, ['shotsOnTarget', 'onTargetScoringAtt']) ?? 0);
const totalShots = (teamStat(MATCH.home, ['totalShots', 'totalShotsTaken']) ?? 0) + (teamStat(MATCH.away, ['totalShots', 'totalShotsTaken']) ?? 0);
const keeperSaves = (team) => teamStat(team, SAVES);   // each side has one keeper; team `saves` = GK saves

// Which side scored the game's FIRST goal — derived from keyEvents (goals carry a
// team). Returns 'home' | 'away' | null (no goal yet / can't tell).
function firstScorer() {
  for (const e of (json.keyEvents || [])) {
    const type = (e.type?.text || '').toLowerCase();
    // same rule as the tally loop: in-game pens count (scoringPlay), shootout pens don't
    if ((type.startsWith('goal') || e.scoringPlay === true) && e.shootout !== true) {
      const tid = String(e.team?.id ?? '');
      const tname = e.team?.displayName || '';
      const isOwn = type.includes('own');
      // own goal credits the OTHER team
      if (tid === String(home?.team?.id) || tname.includes(MATCH.home)) return isOwn ? 'away' : 'home';
      if (tid === String(away?.team?.id) || tname.includes(MATCH.away)) return isOwn ? 'home' : 'away';
    }
  }
  // fallback: if only one side is on the board, they scored first
  if (homeScore > 0 && awayScore === 0) return 'home';
  if (awayScore > 0 && homeScore === 0) return 'away';
  return null;
}

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
// "Shots on Target INCLUDING Woodwork": SOT plus any post/bar strikes. Returns
// null (pending) until there's feed data, same convention as playerStat.
const sotWood = (sub) => {
  const s = playerStat(sub, 'sot');
  if (s == null) return null;
  return s + countFor(PLAYER.woodwork, sub);
};
const gl = (sub) => playerStat(sub, 'goals');
const fc = (sub) => playerStat(sub, 'foulsCommitted');   // player fouls committed
// "Under N goals" leg: alive while goals < N, LOST the instant goals reach N,
// won at FT if still under. (limit is the line, e.g. 3.5 → busts at 4 goals)
const underLeg = (label, cur, limit) => {
  const dead = cur > limit;
  return { label, status: dead ? 'miss' : (final ? 'hit' : 'pending'), cur };
};
// "Over N.5" leg (goals, corners, etc.): HITS the instant the running total
// clears the line (e.g. Over 1.5 → hit at 2), and can only ever go up, so once
// hit it stays hit. Pending until then; a miss only at FT if still short.
const overLeg = (label, cur, line) => {
  const hit = cur > line;
  return { label, status: hit ? 'hit' : (final ? 'miss' : 'pending'), cur };
};
const scoreOrAssist = (label, sub) => {
  const g = playerStat(sub, 'goals');
  const a = playerStat(sub, 'assists');
  if (g == null && a == null) return boolLeg(label, false, '?');  // no feed yet
  const hit = (g || 0) >= 1 || (a || 0) >= 1;
  return boolLeg(label, hit, `${g || 0}g ${a || 0}a`);
};
const scoreTxt = `${homeScore}-${awayScore}`;
// 2UP pays the moment the backed side ever goes 2 clear (early payout); also
// counts as won at FT if that side is simply ahead.
const twoUp = (side) => {
  const everTwoClear = side === 'home' ? st.maxHomeLead >= 2 : st.maxAwayLead >= 2;
  const winningAtFT = final && (side === 'home' ? homeScore > awayScore : awayScore > homeScore);
  return boolLeg(`${side === 'home' ? MATCH.home : MATCH.away} Match Result (2UP)`, everTwoClear || winningAtFT, scoreTxt);
};
const btts = () => boolLeg('Both Teams To Score', homeScore >= 1 && awayScore >= 1, scoreTxt);
// Straight match result (win): only settles at FT. Alive/pending until then,
// hit if the backed side is ahead at the whistle.
const matchResult = (side, label) => {
  const winning = side === 'home' ? homeScore > awayScore : awayScore > homeScore;
  return { label, status: final ? (winning ? 'hit' : 'miss') : 'pending', cur: scoreTxt };
};
// Team with most corners: settles at FT (a lead can flip). Shows running count.
const mostCorners = (side, label) => {
  const ahead = side === 'home' ? homeCorners > awayCorners : awayCorners > homeCorners;
  return { label, status: final ? (ahead ? 'hit' : 'miss') : 'pending', cur: `${homeCorners}-${awayCorners}` };
};
// First team to score: locks the instant the first goal goes in.
const firstToScore = (side, label) => {
  const fs = firstScorer();
  if (fs === side) return { label, status: 'hit', cur: scoreTxt };
  if (fs) return { label, status: 'miss', cur: scoreTxt };          // other side struck first
  return { label, status: final ? 'miss' : 'pending', cur: scoreTxt }; // 0-0 → miss at FT
};
// Exact correct score (home-away): settles at FT — any in-play score is still
// reachable, so it stays alive until the whistle, busting only once the running
// goals already EXCEED the predicted tally on either side (can't come back down).
const correctScore = (h, a, label) => {
  const dead = homeScore > h || awayScore > a;
  return { label, status: final ? ((homeScore === h && awayScore === a) ? 'hit' : 'miss') : (dead ? 'miss' : 'pending'), cur: scoreTxt, meta: { kind: 'correctScore', h, a } };
};
// Half-time/Full-time double (e.g. "Draw / Spain" = level at the break, backed
// side ahead at FT). htSide/ftSide: 'home' | 'away' | 'draw'. The HT half only
// locks once we've reached the break; before that the whole leg is pending.
const htFtLeg = (htSide, ftSide, label) => {
  const ahead = (s) => s === 'draw' ? homeScore === awayScore : s === 'home' ? homeScore > awayScore : awayScore > homeScore;
  const htHeld = st.htHome != null
    ? (htSide === 'draw' ? st.htHome === st.htAway : htSide === 'home' ? st.htHome > st.htAway : st.htAway > st.htHome)
    : ahead(htSide);
  const htKnown = st.htHome != null || statusName === 'STATUS_HALFTIME' || state === 'post';
  if (htKnown && !htHeld) return { label, status: 'miss', cur: scoreTxt };   // HT half already wrong → dead
  return { label, status: final ? ((htHeld && ahead(ftSide)) ? 'hit' : 'miss') : 'pending', cur: scoreTxt };
};

// Team total cards (yellows + reds) for one side — for a "Belgium 2+ Cards" leg.
const teamCards = (team) => (teamStat(team, ['yellowCards']) ?? 0) + (teamStat(team, ['redCards']) ?? 0);
const fw = (sub) => playerStat(sub, 'foulsWon');
const cd = (sub) => playerStat(sub, 'cards');    // player yellow+red cards (for "carded anytime")
const sh = (sub) => playerStat(sub, 'shots');    // player total shots (on+off target)
const sv = (sub) => playerStat(sub, 'saves');    // NAMED keeper saves (roster block; no commentary fallback)
const asst = (sub) => playerStat(sub, 'assists'); // player assists (roster goalAssists / "Assisted by X")
// Market the ESPN feed simply doesn't carry (checked: no throw-in stat at team
// OR player level in the fifa.world summary) but that we can feed by hand via
// MANUAL_FILE. No manual number yet → ❔ like before. Counts only go up, so a
// hit locks the moment the fed number clears the line; a definite miss needs
// final:true in the file — an under-the-line number at FT without it stays ❔
// (it may just be the half-time count) and the FT card says to check the bookie.
const manualNumLeg = (label, key, target) => {
  const v = Number(MANUAL[key]);
  if (!Number.isFinite(v)) return { label, status: 'unknown', cur: 'not in feed' };
  const cur = `${v}${MANUAL.asOf ? ` manual @ ${MANUAL.asOf}` : ' manual'}`;
  if (v >= target) return { label, status: 'hit', cur };
  if (MANUAL.final) return { label, status: 'miss', cur };
  return { label, status: final ? 'unknown' : 'pending', cur };
};
// Anytime-goalscorer leg for a NAMED player on a KNOWN side. Same evaluation as
// numLeg(..., gl(sub), 1) but tagged with { side, sub } so slipDeadReason can
// spot when a slip's scorer legs + a correct-score cap have become jointly
// impossible (e.g. "Spain 2-1" but needing 2 *different* Spain players to score,
// after someone else already scored Spain's first).
const anytimeScorer = (sub, side, label) => {
  const leg = numLeg(label, gl(sub), 1);
  leg.meta = { kind: 'anytimeScorer', side, sub };
  return leg;
};

// ===== SLIP CONFIG ===========================================================
// Dion's THREE PLACED bet-builders on France v Spain (transcribed from his slip
// screenshots 2026-07-14). France = home, Spain = away.
// Leg → helper map for this bookie's exact market names:
//   "Match Result (2UP)"      → twoUp('home')  (early payout if 2 clear)
//   "Over 1.50 Total Goals"   → overLeg(totalGoals, 1.5)
//   "N+ Match Total Corners"  → numLeg(totalCorners, N)
//   "N+ Team Total Corners"   → numLeg(homeCorners | awayCorners, N)
//   "N+ Match Total Cards"    → numLeg(totalCards, N)
//   "N+ Team Total Cards"     → numLeg(teamCards(name), N)
//   "<keeper> N+ Saves"       → sv(name)   (named-keeper roster saves)
//   "<player> N+ Shots"       → sh(name)   (total shots)
//   "<player> N+ Shots on Target" → sot(name)  (plain SOT — NOT woodwork here)
//   "<player> N+ Fouls"       → fc(name)   (fouls COMMITTED)
//   "<player> N+ Fouls Won"   → fw(name)   (fouls SUFFERED / won free kicks)
//   "<player> N+ Assists"     → asst(name)
//   "<player> Carded Anytime" → cd(name)
//   "<player> Anytime Goalscorer" → anytimeScorer(name,'home'|'away')
//   "<player> Score or Assist" → scoreOrAssist(label, name)
//   "Both Teams to Score: Yes" → btts()
//   "N+ Match Total Throw-Ins" → manualNumLeg(label,'throwIns',N)  (no ESPN stat; fed via MANUAL_FILE)
const SLIPS = [{
  // £5 @ 18/1 → £95.00 (Bet ID 26304331). 8 legs.
  title: 'Slip 1 · Bet Builder (8 legs) · £5 @ 18/1 → £95.00', legs: [
    numLeg('Lamine Yamal 1+ Shots on Target', sot('Yamal'), 1),
    numLeg('Rodri 2+ Fouls Won', fw('Rodri'), 2),
    numLeg('Alex Baena 1+ Fouls', fc('Baena'), 1),
    numLeg('France 1+ Team Total Cards', teamCards(MATCH.home), 1),
    btts(),
    scoreOrAssist('Michael Olise Score or Assist', 'Olise'),
    numLeg('Kylian Mbappé 2+ Shots on Target', sot('Mbapp'), 2),
    numLeg('8+ Match Total Corners', totalCorners, 8),
  ],
}, {
  // £5 @ 20/1 → £105.00 (Bet ID 26302396). 7 legs.
  title: 'Slip 2 · Bet Builder (7 legs) · £5 @ 20/1 → £105.00', legs: [
    numLeg('Kylian Mbappé 2+ Shots on Target', sot('Mbapp'), 2),
    numLeg('Michael Olise 1+ Shots on Target', sot('Olise'), 1),
    numLeg('Michael Olise 1+ Assists', asst('Olise'), 1),
    scoreOrAssist('Lamine Yamal Score or Assist', 'Yamal'),
    numLeg('8+ Match Total Corners', totalCorners, 8),
    numLeg('France 1+ Team Total Cards', teamCards(MATCH.home), 1),
    numLeg('Lamine Yamal 1+ Shots on Target', sot('Yamal'), 1),
  ],
}, {
  // £0.50 bet credit longshot @ 425/1 → £212.50. 11 legs, incl. a throw-ins
  // market the feed can't see — fed by hand via MANUAL_FILE when Dion posts
  // the bookie's count (❔ until the first number lands).
  title: 'Slip 3 · Bet Builder (11 legs) · £0.50 credit @ 425/1 → £212.50', legs: [
    numLeg('France 4+ Team Total Corners', homeCorners, 4),
    numLeg('Spain 4+ Team Total Corners', awayCorners, 4),
    numLeg('9+ Match Total Corners', totalCorners, 9),
    numLeg('Marc Cucurella Carded Anytime', cd('Cucurella'), 1),
    numLeg('Lamine Yamal 2+ Fouls', fc('Yamal'), 2),
    numLeg('Kylian Mbappé 2+ Shots on Target', sot('Mbapp'), 2),
    btts(),
    numLeg('4+ Match Total Cards', totalCards, 4),
    anytimeScorer('Mbapp', 'home', 'Kylian Mbappé Anytime Goalscorer'),
    anytimeScorer('Yamal', 'away', 'Lamine Yamal Anytime Goalscorer'),
    manualNumLeg('32+ Match Total Throw-Ins', 'throwIns', 32),
  ],
}];
// =============================================================================

const ICON = { hit: '✅', miss: '❌', pending: '⏳', unknown: '❔' };
function renderSlip(s) {
  const hits = s.legs.filter(l => l.status === 'hit').length;
  const gone = s.legs.filter(l => l.status === 'miss').length;
  const unknowns = s.legs.filter(l => l.status === 'unknown').length;
  const tag = final
    ? (gone > 0 ? `🔴 ${gone} gone` : unknowns > 0 ? '🟡 check ❔ legs on the bookie' : '🟢 WINNER')
    : (gone ? `🔴 ${gone} gone` : '🟢 alive');
  return `**${s.title}** — ${hits}/${s.legs.length} ${tag}\n` + s.legs.map(l => `${ICON[l.status]} ${l.label} (${l.cur})`).join('\n');
}
const LEGEND = '✅ landed · ⏳ still to come · ❌ gone · ❔ no data from the feed yet';
const slipsBody = () => (SLIPS.map(renderSlip).join('\n\n') + `\n\n${LEGEND}`).slice(0, 4096);

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

// ---- on-demand preview ------------------------------------------------------
// `node bet-checker.mjs --preview` posts the current slips card right now,
// whatever the match state (handy pre-kickoff to see the embed). Read-only: it
// touches NEITHER the state file NOR the cron — it just renders + posts once.
if (process.argv.includes('--preview')) {
  const pre = state === 'pre';
  await post({
    title: `${pre ? '👀 Preview' : '⚽ LIVE'} — ${MATCH.label}${pre ? ' · not kicked off yet' : ''}`,
    description: slipsBody(),
    color: 0x9B59B6,
    footer: { text: `Claude · live bet tracker · preview (${SLIPS.length} slips)` },
    timestamp: new Date().toISOString(),
  });
  console.log('[bets] posted preview card');
  process.exit(0);
}

if (state === 'pre') {
  if (!st.armed) {
    await post({
      title: `🎯 Bet tracker armed — ${MATCH.label}`,
      description: `Locked and loaded on ${SLIPS.length === 1 ? 'your slip' : `both your slips (${SLIPS.length})`}. I’ll post a live leg-by-leg card in here as things happen once it kicks off, and a final card at full time. ✅ hit · ⏳ still to land · ❌ gone.`,
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
  // Lock the half-time score the first time we see the break — htFtLeg reads it.
  if (st.htHome == null) { st.htHome = homeScore; st.htAway = awayScore; saveState(); }
  const sig = `${scoreTxt}|c${totalCorners}|f${totalFouls}|k${totalCards}|m${JSON.stringify(MANUAL)}`;
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
// Roster fingerprint: the per-player structured stats now drive most legs
// (shots, SoT, cards, fouls), so fold them into the signature — otherwise a
// roster-only change (no team-total move) wouldn't trigger a fresh card.
const rosterSig = ROSTER_PLAYERS.map(p => `${p.name}:${p.stat.totalShots||0},${p.stat.shotsOnTarget||0},${p.stat.foulsSuffered||0},${p.stat.foulsCommitted||0},${(p.stat.yellowCards||0)+(p.stat.redCards||0)},${p.stat.totalGoals||0},${p.stat.goalAssists||0}`).join('|');
const liveSig = `${scoreTxt}|c${totalCorners}|f${totalFouls}|k${totalCards}|tsot${totalSOT}`
  + `|hs${keeperSaves(MATCH.home) ?? '?'}|as${keeperSaves(MATCH.away) ?? '?'}`
  + `|sot${JSON.stringify(PLAYER.sot)}|g${JSON.stringify(PLAYER.goals)}|fc${JSON.stringify(PLAYER.foulsCommitted)}|fwn${JSON.stringify(PLAYER.foulsWon)}|ww${JSON.stringify(PLAYER.woodwork)}|cd${JSON.stringify(PLAYER.cards)}`
  + `|r${rosterSig}|m${JSON.stringify(MANUAL)}`;
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
