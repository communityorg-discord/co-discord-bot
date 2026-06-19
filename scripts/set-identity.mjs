// Rename the bot + set its avatar in one PATCH. argv[2]=new username, argv[3]=png path.
import { readFileSync } from 'node:fs';

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const username = process.argv[2];
const file = process.argv[3];
const body = {};
if (username) body.username = username;
if (file) body.avatar = `data:image/png;base64,${readFileSync(file).toString('base64')}`;

const r = await fetch('https://discord.com/api/v10/users/@me', {
    method: 'PATCH',
    headers: { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
});
const j = await r.json().catch(() => ({}));
if (!r.ok) { console.error('FAILED', r.status, JSON.stringify(j).slice(0, 500)); process.exit(1); }
console.log('OK — username:', JSON.stringify(j.username), '| avatar hash:', j.avatar);
