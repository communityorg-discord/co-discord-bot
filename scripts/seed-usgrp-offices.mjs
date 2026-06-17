// One-time seed: register the USGRP main-guild office voice rooms + waiting room
// in the /office system (managed_offices / office_waiting_rooms / office_allowlist)
// — exactly the rows the /office panel writes — so the bot manages access, the
// waiting-room request/bring flow, and enforcement. Idempotent.
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dir, '..', 'bot-data.db'));
db.pragma('busy_timeout = 5000');

const GUILD = '1458621643537514590';
const ROLE = {
    potus: '1508675332729995325', vpotus: '1508675335313690697', cos: '1508675359468421222',
    mckew: '1508675330263744532', whOffice: '1513332307757502665',
};
const WAITING = '1516625550079430778';
// office channel → [name, owner role, rank, extra role-allowlist]
const OFFICES = [
    ['1508702345079292037', 'Oval Office',    ROLE.potus,    1, [ROLE.vpotus, ROLE.cos]],
    ['1508702347839406134', 'Cabinet Room',   ROLE.mckew,    2, []],
    ['1508702350616035390', 'Roosevelt Room', ROLE.whOffice, 3, [ROLE.cos, ROLE.vpotus]],
];

const upsertOffice = db.prepare(`INSERT INTO managed_offices (channel_id, guild_id, channel_name, owner_role_id, rank)
    VALUES (?,?,?,?,?) ON CONFLICT(channel_id) DO UPDATE SET channel_name=excluded.channel_name, owner_role_id=excluded.owner_role_id, rank=excluded.rank`);
const upsertWR = db.prepare(`INSERT INTO office_waiting_rooms (channel_id, guild_id, channel_name) VALUES (?,?,?)
    ON CONFLICT(channel_id) DO UPDATE SET channel_name=excluded.channel_name`);
const addAllow = db.prepare(`INSERT OR IGNORE INTO office_allowlist (channel_id, discord_id, added_by) VALUES (?,?,?)`);

for (const [ch, name, owner, rank, extra] of OFFICES) {
    upsertOffice.run(ch, GUILD, name, owner, rank);
    for (const rid of extra) addAllow.run(ch, rid, 'setup');
    console.log(`office: ${name} → owner ${owner} rank ${rank}${extra.length ? ` + allow [${extra.join(', ')}]` : ''}`);
}
upsertWR.run(WAITING, GUILD, '🕓 Waiting Room');
console.log('waiting room set:', WAITING);

console.log('\nUSGRP offices now registered:');
for (const r of db.prepare('SELECT channel_name, owner_role_id, rank FROM managed_offices WHERE guild_id=? ORDER BY rank').all(GUILD)) console.log('  ', JSON.stringify(r));
db.close();

// Give the President direct Connect to the Cabinet Room (rank-1 reaches rank-2).
const TOKEN = (readFileSync(path.join(__dir, '..', '.env'), 'utf8').match(/DISCORD(?:_BOT)?_TOKEN=(.+)/) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const CABINET = '1508702347839406134';
const VIEW = 1024n, CONNECT = 1048576n;
const cab = await (await fetch(`https://discord.com/api/v10/channels/${CABINET}`, { headers: { Authorization: `Bot ${TOKEN}` } })).json();
const ow = (cab.permission_overwrites || []).filter(o => o.id !== ROLE.potus);
ow.push({ id: ROLE.potus, type: 0, allow: String(VIEW | CONNECT), deny: '0' });
const r = await fetch(`https://discord.com/api/v10/channels/${CABINET}`, {
    method: 'PATCH', headers: { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ permission_overwrites: ow }),
});
console.log('Cabinet Room President connect:', r.status === 200 ? 'granted' : `FAILED ${r.status}`);
console.log('DONE');
