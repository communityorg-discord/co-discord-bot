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
    x.save(); x.translate(64, 64); x.rotate(Math.PI / 4);
    x.fillStyle = CREAM; x.fillRect(-9, -34, 18, 46);
    x.fillStyle = INK; x.fillRect(-9, -34, 18, 8);
    x.beginPath(); x.moveTo(-9, 12); x.lineTo(0, 30); x.lineTo(9, 12); x.closePath(); x.fillStyle = CREAM; x.fill();
    x.fillStyle = INK; x.beginPath(); x.moveTo(-3.5, 23); x.lineTo(0, 30); x.lineTo(3.5, 23); x.closePath(); x.fill();
    x.restore();
}
function box(x) {
    x.fillStyle = CREAM; x.beginPath(); x.moveTo(64, 30); x.lineTo(96, 46); x.lineTo(64, 62); x.lineTo(32, 46); x.closePath(); x.fill();
    x.fillStyle = 'rgba(245,237,228,0.82)'; x.beginPath(); x.moveTo(32, 46); x.lineTo(64, 62); x.lineTo(64, 96); x.lineTo(32, 80); x.closePath(); x.fill();
    x.fillStyle = 'rgba(245,237,228,0.62)'; x.beginPath(); x.moveTo(96, 46); x.lineTo(64, 62); x.lineTo(64, 96); x.lineTo(96, 80); x.closePath(); x.fill();
    x.strokeStyle = CORALD; x.lineWidth = 2.5; x.beginPath(); x.moveTo(48, 38); x.lineTo(80, 54); x.stroke();
}
function rocket(x) {
    x.fillStyle = CREAM;
    x.beginPath(); x.moveTo(64, 26); x.quadraticCurveTo(82, 46, 74, 78); x.lineTo(54, 78); x.quadraticCurveTo(46, 46, 64, 26); x.fill();
    x.fillStyle = CORALD; x.beginPath(); x.arc(64, 54, 7, 0, Math.PI * 2); x.fill();
    x.fillStyle = CREAM; x.beginPath(); x.moveTo(54, 70); x.lineTo(40, 86); x.lineTo(54, 84) ; x.closePath(); x.fill();
    x.beginPath(); x.moveTo(74, 70); x.lineTo(88, 86); x.lineTo(74, 84); x.closePath(); x.fill();
    x.fillStyle = AMBER; x.beginPath(); x.moveTo(58, 82); x.quadraticCurveTo(64, 100, 70, 82); x.closePath(); x.fill();
}
function gitGraph(x) {
    x.strokeStyle = CREAM; x.lineWidth = 6; x.lineCap = 'round';
    x.beginPath(); x.moveTo(46, 36); x.lineTo(46, 92); x.stroke();
    x.beginPath(); x.moveTo(46, 56); x.quadraticCurveTo(78, 56, 82, 80); x.stroke();
    x.fillStyle = CREAM;
    for (const [cx, cy] of [[46, 36], [46, 92], [82, 84]]) { x.beginPath(); x.arc(cx, cy, 9, 0, Math.PI * 2); x.fill(); x.fillStyle = CREAM; }
    x.fillStyle = CORALD; for (const [cx, cy] of [[46, 36], [46, 92], [82, 84]]) { x.beginPath(); x.arc(cx, cy, 4, 0, Math.PI * 2); x.fill(); }
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
    // octagonal stop sign
    x.fillStyle = CREAM;
    x.beginPath();
    for (let i = 0; i < 8; i++) {
        const a = Math.PI / 8 + Math.PI * 2 * i / 8;
        const px = CX + Math.cos(a) * 36, py = CY + Math.sin(a) * 36;
        i ? x.lineTo(px, py) : x.moveTo(px, py);
    }
    x.closePath(); x.fill();
    x.fillStyle = RED; x.beginPath(); x.roundRect(50, 50, 28, 28, 5); x.fill();
}
function cross(x) { x.strokeStyle = CREAM; x.lineWidth = 13; x.lineCap = 'round'; x.beginPath(); x.moveTo(46, 46); x.lineTo(82, 82); x.moveTo(82, 46); x.lineTo(46, 82); x.stroke(); }

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
const out = {};
for (const app of APPS) {
    const appId = appIdOf(app.token);
    const H = { Authorization: `Bot ${app.token}`, 'Content-Type': 'application/json' };
    const existing = await (await fetch(`https://discord.com/api/v10/applications/${appId}/emojis`, { headers: H })).json();
    const byName = new Map((existing.items || []).map(e => [e.name, e.id]));
    out[appId] = {};
    for (const name of Object.keys(EMOJI)) {
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
