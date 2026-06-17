// One-off: upload a single branded "arrow_left" (Back) application emoji to a
// bot, matching the fleet house style (navy roundel + gold ring + gold left
// arrow). Idempotent — skips if the emoji already exists. Prints the <:name:id>
// ref to paste into the bot's emoji registry.
//
//   TOKEN=<bot token> [CLIENT_ID=<app id>] [NAME=arrow_left] node scripts/upload-back-emoji.mjs
import { REST } from 'discord.js';
import { createRequire } from 'node:module';

let createCanvas;
try { ({ createCanvas } = await import('@napi-rs/canvas')); }
catch {
  const req = createRequire('/home/vpcommunityorganisation/clawd/services/aspire-bot/scripts/gen-emojis.mjs');
  ({ createCanvas } = req('@napi-rs/canvas'));
}

const TOKEN = process.env.TOKEN;
const NAME = process.env.NAME || 'arrow_left';
if (!TOKEN) { console.error('TOKEN required'); process.exit(1); }

const S = 128, CX = 64, CY = 64, INK = '#0a1f3d', INK2 = '#06183a', GOLD = '#d8bd73';
const c = createCanvas(S, S), x = c.getContext('2d');
const g = x.createLinearGradient(0, 8, 0, S - 8); g.addColorStop(0, INK); g.addColorStop(1, INK2);
x.fillStyle = g; x.beginPath(); x.arc(CX, CY, 60, 0, Math.PI * 2); x.fill();
x.lineWidth = 4; x.strokeStyle = 'rgba(255,255,255,0.14)'; x.beginPath(); x.arc(CX, CY, 58, 0, Math.PI * 2); x.stroke();
x.lineWidth = 5; x.strokeStyle = GOLD; x.beginPath(); x.arc(CX, CY, 55, 0, Math.PI * 2); x.stroke();
x.fillStyle = GOLD; x.beginPath();
x.moveTo(34, 64); x.lineTo(62, 40); x.lineTo(62, 53); x.lineTo(94, 53); x.lineTo(94, 75); x.lineTo(62, 75); x.lineTo(62, 88);
x.closePath(); x.fill();
const b64 = c.toBuffer('image/png').toString('base64');

const rest = new REST({ version: '10' }).setToken(TOKEN);
let app = process.env.CLIENT_ID;
if (!app) { const me = await rest.get('/applications/@me'); app = me.id; }
const route = `/applications/${app}/emojis`;

let existing = [];
try { const r = await rest.get(route); existing = r.items || r || []; } catch { /* none */ }
const found = existing.find(e => e.name === NAME);
if (found) { console.log(`exists :${NAME}: ${found.id}`); console.log(`<:${NAME}:${found.id}>`); process.exit(0); }

const created = await rest.post(route, { body: { name: NAME, image: `data:image/png;base64,${b64}` } });
console.log(`uploaded :${NAME}: ${created.id}`);
console.log(`<:${NAME}:${created.id}>`);
