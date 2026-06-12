// Custom emoji pack for the "Claude fix this" bridge — the live progress
// cards stop using stock Unicode (✅ 🔍 ⚙️ 🛑 …) and get a bespoke set drawn
// in Claude's coral palette. Uploaded as APPLICATION emojis to BOTH bots
// (whichever app owns the status message must own the emoji), and the map is
// written to src/services/claude-emojis.json keyed by application id — the
// runner decodes its token's app id and picks the right set at runtime.
//
// Run from co-discord-bot/:  node scripts/gen-claude-emojis.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const req = createRequire('/home/vpcommunityorganisation/clawd/services/aspire-bot/scripts/x.mjs');
const { createCanvas } = req('@napi-rs/canvas');

const SERVICES = '/home/vpcommunityorganisation/clawd/services';
const tokenFrom = (file, key) => {
    const m = readFileSync(file, 'utf8').match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
};
const APPS = [
    { name: 'co-discord-bot', token: tokenFrom(`${SERVICES}/co-discord-bot/.env`, 'DISCORD_BOT_TOKEN') },
    { name: 'aspire-bot', token: tokenFrom(`${SERVICES}/aspire-bot/.env`, 'ASPIRE_DISCORD_BOT_TOKEN') },
].filter(a => a.token);
const appIdOf = (token) => Buffer.from(token.split('.')[0], 'base64').toString('utf8');

// ── palette: Claude coral ────────────────────────────────────────────────────
const S = 128, CX = 64, CY = 64;
const CORAL = '#d97757', CORALD = '#b35a3e', CREAM = '#f5ede4', INK = '#2a1c16';
const GREEN = '#1f7a45', RED = '#b91c1c', AMBER = '#c98a16';

const mk = () => { const c = createCanvas(S, S); return { c, x: c.getContext('2d') }; };
function roundel(x, c1, c2) {
    const g = x.createLinearGradient(0, 8, 0, S - 8); g.addColorStop(0, c1); g.addColorStop(1, c2 || c1);
    x.fillStyle = g; x.beginPath(); x.arc(CX, CY, 60, 0, Math.PI * 2); x.fill();
    x.lineWidth = 4; x.strokeStyle = 'rgba(255,255,255,0.16)'; x.beginPath(); x.arc(CX, CY, 57, 0, Math.PI * 2); x.stroke();
}
const CL = (draw) => (x) => { roundel(x, CORAL, CORALD); draw(x); };

function check(x, w = 13) { x.strokeStyle = CREAM; x.lineWidth = w; x.lineCap = 'round'; x.lineJoin = 'round'; x.beginPath(); x.moveTo(38, 66); x.lineTo(57, 86); x.lineTo(92, 44); x.stroke(); }
function magnifier(x) {
    x.strokeStyle = CREAM; x.lineWidth = 8; x.beginPath(); x.arc(56, 56, 20, 0, Math.PI * 2); x.stroke();
    x.lineCap = 'round'; x.beginPath(); x.moveTo(72, 72); x.lineTo(92, 92); x.stroke();
    x.fillStyle = 'rgba(245,237,228,0.22)'; x.beginPath(); x.arc(56, 56, 16, 0, Math.PI * 2); x.fill();
}
function pencil(x) {
    // bold pen nib drawing a line — high contrast, reads at 20px
    x.strokeStyle = CREAM; x.lineWidth = 14; x.lineCap = 'round';
    x.beginPath(); x.moveTo(78, 36); x.lineTo(52, 62); x.stroke();
    x.fillStyle = CREAM; x.beginPath(); x.moveTo(46, 56); x.lineTo(58, 68); x.lineTo(38, 76); x.closePath(); x.fill();
    x.strokeStyle = CREAM; x.lineWidth = 6; x.beginPath(); x.moveTo(36, 92); x.lineTo(92, 92); x.stroke();
}
function box(x) {
    // three stacked blocks — assembly
    x.fillStyle = CREAM;
    x.beginPath(); x.roundRect(36, 66, 26, 26, 4); x.fill();
    x.beginPath(); x.roundRect(66, 66, 26, 26, 4); x.fill();
    x.beginPath(); x.roundRect(51, 36, 26, 26, 4); x.fill();
    x.strokeStyle = CORALD; x.lineWidth = 3;
    x.strokeRect(36, 66, 26, 26); x.strokeRect(66, 66, 26, 26); x.strokeRect(51, 36, 26, 26);
}
function rocket(x) {
    // ship-it: bold arrow launching from a tray
    x.fillStyle = CREAM;
    x.beginPath(); x.moveTo(64, 26); x.lineTo(88, 54); x.lineTo(72, 54); x.lineTo(72, 76); x.lineTo(56, 76); x.lineTo(56, 54); x.lineTo(40, 54); x.closePath(); x.fill();
    x.strokeStyle = CREAM; x.lineWidth = 8; x.lineCap = 'round';
    x.beginPath(); x.moveTo(36, 92); x.lineTo(36, 98); x.lineTo(92, 98); x.lineTo(92, 92); x.stroke();
}

function gitGraph(x) {
    // floppy disk — saved
    x.fillStyle = CREAM;
    x.beginPath(); x.moveTo(36, 36); x.lineTo(82, 36); x.lineTo(92, 46); x.lineTo(92, 92); x.lineTo(36, 92); x.closePath(); x.fill();
    x.fillStyle = CORALD;
    x.fillRect(48, 36, 30, 18);
    x.beginPath(); x.roundRect(46, 64, 36, 28, 3); x.fill();
    x.fillStyle = CREAM; x.fillRect(66, 39, 8, 12);
    x.strokeStyle = CREAM; x.lineWidth = 3;
    x.beginPath(); x.moveTo(52, 72); x.lineTo(76, 72); x.moveTo(52, 80); x.lineTo(76, 80); x.stroke();
}

function gear(x) {
    x.fillStyle = CREAM;
    for (let i = 0; i < 8; i++) {
        const a = Math.PI * 2 * i / 8;
        x.save(); x.translate(CX, CY); x.rotate(a); x.fillRect(-7, -38, 14, 16); x.restore();
    }
    x.beginPath(); x.arc(CX, CY, 26, 0, Math.PI * 2); x.fill();
    x.fillStyle = CORALD; x.beginPath(); x.arc(CX, CY, 11, 0, Math.PI * 2); x.fill();
}
function robot(x) {
    x.fillStyle = CREAM; x.beginPath(); x.roundRect(38, 44, 52, 42, 9); x.fill();
    x.fillStyle = CORALD; x.beginPath(); x.arc(53, 62, 6.5, 0, Math.PI * 2); x.fill(); x.beginPath(); x.arc(75, 62, 6.5, 0, Math.PI * 2); x.fill();
    x.strokeStyle = CORALD; x.lineWidth = 4; x.lineCap = 'round'; x.beginPath(); x.moveTo(52, 76); x.lineTo(76, 76); x.stroke();
    x.strokeStyle = CREAM; x.beginPath(); x.moveTo(64, 44); x.lineTo(64, 32); x.stroke();
    x.fillStyle = CREAM; x.beginPath(); x.arc(64, 29, 5, 0, Math.PI * 2); x.fill();
}
function thought(x) {
    x.fillStyle = CREAM; x.beginPath(); x.ellipse(64, 56, 30, 22, 0, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.arc(44, 84, 7, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.arc(34, 96, 4, 0, Math.PI * 2); x.fill();
    x.fillStyle = CORALD; for (const dx of [-12, 0, 12]) { x.beginPath(); x.arc(64 + dx, 56, 3.6, 0, Math.PI * 2); x.fill(); }
}
function wrench(x) {
    x.save(); x.translate(64, 64); x.rotate(-Math.PI / 4);
    x.strokeStyle = CREAM; x.lineWidth = 12; x.lineCap = 'round';
    x.beginPath(); x.moveTo(0, -8); x.lineTo(0, 34); x.stroke();
    x.lineWidth = 9; x.beginPath(); x.arc(0, -22, 14, Math.PI * 0.22, Math.PI * 2.78); x.stroke();
    x.restore();
}
function stopMark(x) {
    // plain bold stop square
    x.fillStyle = CREAM; x.beginPath(); x.roundRect(42, 42, 44, 44, 8); x.fill();
}
function cross(x) { x.strokeStyle = CREAM; x.lineWidth = 13; x.lineCap = 'round'; x.beginPath(); x.moveTo(46, 46); x.lineTo(82, 82); x.moveTo(82, 46); x.lineTo(46, 82); x.stroke(); }

const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',').map(t => t.trim())) : null;
const EMOJI = {
    cl_tick:  (x) => { roundel(x, GREEN, '#155e36'); check(x); },
    cl_stop:  (x) => { roundel(x, RED, '#7f1d1d'); stopMark(x); },
    cl_err:   (x) => { roundel(x, RED, '#7f1d1d'); cross(x); },
    cl_read:  CL(magnifier),
    cl_edit:  CL(pencil),
    cl_build: CL(box),
    cl_deploy: CL(rocket),
    cl_commit: CL(gitGraph),
    cl_run:   CL(gear),
    cl_agent: CL(robot),
    cl_think: CL(thought),
    cl_boot:  CL(wrench),
};

const render = (name) => { const { c, x } = mk(); EMOJI[name](x); return c.toBuffer('image/png'); };

// contact sheet for a visual once-over
{
    const names = Object.keys(EMOJI);
    const cols = 6, cell = 96, pad = 16;
    const sheet = createCanvas(cols * cell + pad, Math.ceil(names.length / cols) * cell + pad);
    const sx = sheet.getContext('2d');
    sx.fillStyle = '#16100d'; sx.fillRect(0, 0, sheet.width, sheet.height);
    names.forEach((n, i) => {
        const gx = pad + (i % cols) * cell, gy = pad + Math.floor(i / cols) * cell;
        const m = mk(); EMOJI[n](m.x); sx.drawImage(m.c, gx, gy, 72, 72);
        sx.fillStyle = '#e8ddd2'; sx.font = '11px sans-serif'; sx.textAlign = 'center'; sx.fillText(n, gx + 36, gy + 86);
    });
    writeFileSync(process.env.HOME + '/claude-emoji-sheet.png', sheet.toBuffer('image/png'));
    console.log('sheet → ~/claude-emoji-sheet.png');
}
if (process.env.DRY === '1') process.exit(0);

// upload to BOTH apps; merge map keyed by application id
let out = {};
try { out = JSON.parse(readFileSync(new URL('../src/services/claude-emojis.json', import.meta.url), 'utf8')); } catch { }
for (const app of APPS) {
    const appId = appIdOf(app.token);
    const H = { Authorization: `Bot ${app.token}`, 'Content-Type': 'application/json' };
    const existing = await (await fetch(`https://discord.com/api/v10/applications/${appId}/emojis`, { headers: H })).json();
    const byName = new Map((existing.items || []).map(e => [e.name, e.id]));
    out[appId] = out[appId] || {};
    for (const name of Object.keys(EMOJI)) {
        if (ONLY && !ONLY.has(name)) continue;
        if (byName.has(name)) await fetch(`https://discord.com/api/v10/applications/${appId}/emojis/${byName.get(name)}`, { method: 'DELETE', headers: H }).catch(() => { });
        const b64 = render(name).toString('base64');
        const r = await fetch(`https://discord.com/api/v10/applications/${appId}/emojis`, {
            method: 'POST', headers: H, body: JSON.stringify({ name, image: `data:image/png;base64,${b64}` }),
        });
        const j = await r.json();
        if (j.id) { out[appId][name.replace(/^cl_/, '')] = `<:${name}:${j.id}>`; console.log(`${app.name} :${name}: ${j.id}`); }
        else console.warn(`${app.name} ${name} FAILED:`, JSON.stringify(j).slice(0, 120));
    }
}
writeFileSync(new URL('../src/services/claude-emojis.json', import.meta.url), JSON.stringify(out, null, 2));
console.log('wrote src/services/claude-emojis.json for', Object.keys(out).length, 'apps');
