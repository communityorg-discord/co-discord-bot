// USGRP staff authority resolver.
//
// On the USGRP network, command authority is NOT the CO portal's numeric
// auth_level — it's the netadmin RANK (NAD / FSA / DSA / SSA / Mod / Dev),
// read from Postgres via aspire-bot's internal network-verify API. This maps a
// member's netadmin position to a 0-9 "power level" that lines up with the SAME
// thresholds the command files already use (COMMAND_PERMISSION_FALLBACK:
// auth_level >= N), so when the active network is USGRP we resolve those
// thresholds against rank instead of CO auth_level — no command changes, and
// CO mode is untouched.
//
// Power scale (matches the handbook rank tiers):
//   3  Junior Moderator / Developer / base network staff   (view, nid)
//   4  Moderator / DSA·SSA member                            (warn)
//   5  Senior Moderator / FSA·NAD member / Head Developer    (timeout, kick, suspend, serverban, channel purge/lockdown)
//   6  Deputy Head Moderator / Junior Admin / DSA·SSA Deputy (server lockdown, gnick)
//   7  Head Moderator / Administrator / DSA·SSA Admin / NAD council  (gban, terminate, sync-roles, server-health)
//   8  Senior Administrator
//   9  Head Administrator
// Founders (SUPERUSER_IDS) bypass everything before this is even consulted.
import { networkVerifyApi } from './aspireInternal.js';

// Map a netadmin position record -> 0-9 power level. Pattern-matched on the
// position title (same shape bucketsFor uses), most-specific first.
export function powerFromRecord(rec) {
    if (!rec || !rec.position) return 0;
    const p = String(rec.position);
    const has = (re) => re.test(p);

    // Title-driven. The umbrella "Network Administration" role is held broadly
    // (every FSA/NAD member has it) so it is NOT used to grant power — only the
    // specific position title decides the level, most-specific first.
    let lvl = 0;
    if (has(/Head Admin(istrator)?/i)) lvl = 9;
    else if (has(/Senior Admin(istrator)?/i)) lvl = 8;
    else if (has(/Junior Admin(istrator)?/i)) lvl = 6;
    else if (has(/Deputy Admin/i)) lvl = 6;
    else if (has(/Admin(istrator)?/i)) lvl = 7;            // Administrator / DSA Admin / SSA Admin
    else if (has(/Deputy Head Moderator/i)) lvl = 6;
    else if (has(/Head Moderator/i)) lvl = 7;
    else if (has(/Senior Moderator/i)) lvl = 5;
    else if (has(/Junior Moderator/i)) lvl = 3;
    else if (has(/Moderator/i)) lvl = 4;
    else if (has(/Head Developer/i)) lvl = 5;
    else if (has(/Developer/i)) lvl = 3;
    else if (has(/Member/i)) lvl = 4;                      // division member = warn-level baseline
    return lvl;
}

// 60s per-user cache so the permission gate doesn't hammer aspire-bot.
const _cache = new Map();   // discordId -> { lvl, at }
const TTL = 60_000;

export async function usgrpPowerLevel(discordId) {
    const id = String(discordId || '');
    if (!id) return 0;
    const c = _cache.get(id);
    if (c && (Date.now() - c.at) < TTL) return c.lvl;
    let lvl = 0;
    try {
        const resp = await networkVerifyApi.record(id);
        // The internal API wraps the row: { ok, status, record: { position, roles, … } }.
        const rec = resp?.record || resp;
        if (resp && resp.ok !== false && rec && rec.position) lvl = powerFromRecord(rec);
    } catch { lvl = 0; }
    _cache.set(id, { lvl, at: Date.now() });
    return lvl;
}

export async function usgrpHasRank(discordId, minLevel) {
    return (await usgrpPowerLevel(discordId)) >= minLevel;
}

export function clearAuthorityCache(discordId) {
    if (discordId) _cache.delete(String(discordId)); else _cache.clear();
}
