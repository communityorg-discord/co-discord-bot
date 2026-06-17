// USGRP network server-access matrix.
//
// Encodes the access grid from the network-administration spec: for every USGRP
// server, what access each staff CATEGORY has. Categories come from the
// verification system (groupOf → FSA/DSA/SSA/SAD; SAD splits into Mod vs Dev;
// NA is an extra role flag). Access levels:
//   'mandatory' — the member is EXPECTED in this server (no time limit; daily
//                 DM until they join; leaving flags their supervisor).
//   'request'   — the member may REQUEST an invite (reason + optional time limit).
//   'none'      — not available to that category; never revealed by the bot.
//
// `manual: true` servers (Testing, Private Logs) are NEVER offered or revealed by
// the bot — Dion/Evan invite to those by hand.

// ── Buckets a member can fall into ──────────────────────────────────────────
//   na  — holds the Network Administration role (council); an ADDITIONAL bucket
//   fsa / dsa / ssa — the three administration divisions
//   mod / dev — the two halves of SAD (Staff Administration Department)
export const BUCKETS = ['na', 'fsa', 'dsa', 'ssa', 'mod', 'dev'];

const M = 'mandatory', R = 'request', N = 'none';

// Department / branch servers all share one access row (NA/FSA/DSA/SAD on
// request; SSA none; Mod & Dev follow SAD).
const DEPT = { na: R, fsa: R, dsa: R, ssa: N, mod: R, dev: R };

// kind: 'main' | 'staff' | 'devops' | 'department' | 'private'
export const SERVERS = [
    { key: 'main',       guildId: '1458621643537514590', name: 'United States Government Roleplay (USGRP)', kind: 'main',
      access: { na: M, fsa: M, dsa: M, ssa: M, mod: M, dev: M } },
    { key: 'staffhub',   guildId: '1357119461957570570', name: 'USGRP | Network Staff Hub', kind: 'staff',
      access: { na: M, fsa: M, dsa: M, ssa: M, mod: M, dev: M } },
    { key: 'devops',     guildId: '1472830470562775195', name: 'USGRP | Network & DevOps Server', kind: 'devops',
      access: { na: M, fsa: N, dsa: N, ssa: N, mod: N, dev: M } },

    // Never revealed by the bot — manual invites only (Dion/Evan).
    { key: 'privatelogs', guildId: '1485423682980675729', name: 'USGRP | Private Logs + Fortnite Hub', kind: 'private', manual: true,
      access: { na: N, fsa: N, dsa: N, ssa: N, mod: N, dev: N } },
    { key: 'testing',     guildId: '1472427405250396211', name: 'USGRP | Testing', kind: 'private', manual: true,
      access: { na: N, fsa: N, dsa: N, ssa: N, mod: N, dev: N } },

    // Department / branch servers (on request for NA/FSA/DSA/SAD).
    { key: 'eop',      guildId: '1508623585625903184', name: 'USGRP | Executive Office of the President', kind: 'department', access: DEPT },
    { key: 'ovp',      guildId: '1508623864538861658', name: 'USGRP | Office of the Vice President', kind: 'department', access: DEPT },
    { key: 'who',      guildId: '1472461017262063758', name: 'USGRP | White House Office', kind: 'department', access: DEPT },
    { key: 'state',    guildId: '1465120736057495775', name: 'USGRP | Department of State', kind: 'department', access: DEPT },
    { key: 'treasury', guildId: '1463749347882569749', name: 'USGRP | Department of the Treasury', kind: 'department', access: DEPT },
    { key: 'defense',  guildId: '1463748842540503114', name: 'USGRP | Department of Defense & Veterans Affairs', kind: 'department', access: DEPT },
    { key: 'justice',  guildId: '1463749094819495969', name: 'USGRP | Department of Justice & Homeland Security', kind: 'department', access: DEPT },
    { key: 'eai',      guildId: '1465118649139462288', name: 'USGRP | Department of Energy, Agriculture and the Interior', kind: 'department', access: DEPT },
    { key: 'commerce', guildId: '1465118901841952805', name: 'USGRP | Department of Commerce & Labor', kind: 'department', access: DEPT },
    { key: 'dot',      guildId: '1465119530912055499', name: 'USGRP | Department of Transportation, Housing & Urban Development', kind: 'department', access: DEPT },
    { key: 'hhs',      guildId: '1465120323468001445', name: 'USGRP | Department of Health, Human Services & Education', kind: 'department', access: DEPT },
    { key: 'omb',      guildId: '1508624278776451143', name: 'USGRP | Office of Management and Budget', kind: 'department', access: DEPT },
    { key: 'fbi',      guildId: '1508624531693240390', name: 'USGRP | Federal Bureau of Investigation', kind: 'department', access: DEPT },
    { key: 'odni',     guildId: '1465120987799617692', name: 'USGRP | Office of the Director of National Intelligence', kind: 'department', access: DEPT },
    { key: 'civic',    guildId: '1508624784026505407', name: 'USGRP | Civic Services', kind: 'department', access: DEPT },
    { key: 'congress', guildId: '1508624116775911456', name: 'USGRP | Congress', kind: 'department', access: DEPT },
    { key: 'courts',   guildId: '1508624369281269860', name: 'USGRP | Federal Judiciary', kind: 'department', access: DEPT },
];

export const SERVER_BY_KEY = Object.fromEntries(SERVERS.map(s => [s.key, s]));
export const SERVER_BY_GUILD = Object.fromEntries(SERVERS.map(s => [s.guildId, s]));

// Channels / guilds the system posts to.
export const STAFF_HUB_GUILD = '1357119461957570570';
export const FSA_OPS_CHANNEL = '1516269569185157251';        // #fsa-operations
export const DIVISION_OPS_CHANNEL = {                         // leave-flags by division
    fsa: '1516269569185157251', ssa: '1516269585202942123',
    dsa: '1516269594850103416', sad: '1516269605352378380',
    mod: '1516269605352378380', dev: '1516269605352378380', na: '1516269569185157251',
};
export const TERMINATION_LOG_CHANNEL = '1508702340054781992'; // #verification-queue (main)
export const NETWORK_ADMIN_ROLE = 'Network Administration';
export const NETWORK_STAFF_ROLE = 'USGRP | Network Staff';

// ── Category resolution from a verification record ───────────────────────────
// rec = { position, roles[], hub_roles[] } from networkVerifyApi.record.
// Returns { bucket, buckets[], hasNA, isDev, group, position } or null.
export function bucketsFor(rec) {
    if (!rec || !rec.position) return null;
    const position = String(rec.position);
    const group = /^FSA /.test(position) ? 'FSA'
        : /^DSA /.test(position) ? 'DSA'
        : /^SSA /.test(position) ? 'SSA' : 'SAD';
    const isDev = /Developer$/.test(position);
    const bucket = group === 'SAD' ? (isDev ? 'dev' : 'mod') : group.toLowerCase();
    const roleSet = [...(rec.hub_roles || []), ...(rec.roles || [])];
    const hasNA = roleSet.includes(NETWORK_ADMIN_ROLE);
    const buckets = hasNA ? [bucket, 'na'] : [bucket];
    return { bucket, buckets, hasNA, isDev, group, position };
}

// Same, but from a network-verification-list roster entry
// ({ discord_id, display_name, seats:['FSA: Head Admin', …], roles:[…] }).
export function bucketsForRoster(entry) {
    const seats = entry?.seats || [];
    const roles = entry?.roles || [];
    const code = String(seats[0] || '').split(':')[0].trim().toUpperCase();
    const group = ['FSA', 'DSA', 'SSA'].includes(code) ? code : 'SAD';
    const isDev = seats.some(s => /developer/i.test(s));
    const bucket = group === 'SAD' ? (isDev ? 'dev' : 'mod') : group.toLowerCase();
    const hasNA = roles.includes(NETWORK_ADMIN_ROLE);
    const buckets = hasNA ? [bucket, 'na'] : [bucket];
    return { bucket, buckets, hasNA, isDev, group };
}

const RANK = { mandatory: 3, request: 2, none: 1 };

// The member's effective access to a server = the most permissive across all
// buckets they fall into.
export function accessLevel(server, memberBuckets) {
    let best = 'none';
    for (const b of memberBuckets) {
        const lvl = server.access[b] || 'none';
        if (RANK[lvl] > RANK[best]) best = lvl;
    }
    return best;
}

// Servers split by what this member can do with them.
export function serversFor(memberBuckets) {
    const mandatory = [], request = [];
    for (const s of SERVERS) {
        if (s.manual) continue;
        const lvl = accessLevel(s, memberBuckets);
        if (lvl === 'mandatory') mandatory.push(s);
        else if (lvl === 'request') request.push(s);
    }
    return { mandatory, request };
}

// Servers a termination kicks the member OUT of (everything private/satellite,
// not the main server — there they only lose their verified roles).
export function terminationKickServers() {
    return SERVERS.filter(s => s.kind !== 'main');
}
