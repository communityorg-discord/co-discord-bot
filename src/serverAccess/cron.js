// Scheduled jobs for the USGRP network-access system.
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { networkVerifyApi } from '../utils/aspireInternal.js';
import { createInvite, sendInviteDM, isInGuild, kickFromGuild } from './core.js';
import {
    SERVERS, SERVER_BY_KEY, serversFor, bucketsFor, FSA_OPS_CHANNEL, accessLevel,
} from './matrix.js';
import { grantAndInvite } from './actions.js';
import * as store from './store.js';

const DAY = 86400000, HOUR = 3600000;
const short = (n) => String(n).replace(/^USGRP \| /, '');

// Roster of verified staff from ops.network_verifications, each with a precomputed
// bucket set. [{ discord_id, position, hub_roles, _b:{buckets,…} }].
async function roster() {
    const r = await networkVerifyApi.all().catch(() => null);
    const staff = (r && Array.isArray(r.staff)) ? r.staff : [];
    return staff.map(s => ({ ...s, _b: bucketsFor(s) })).filter(s => s._b);
}

// ── 1. Daily reminder for missing MANDATORY servers (one DM/day) ─────────────
export async function runDailyMandatory(client) {
    const staff = await roster();
    let dmd = 0;
    for (const s of staff) {
        const userId = String(s.discord_id);
        if (Date.now() - store.lastDailyDm(userId) < 20 * HOUR) continue;
        const b = s._b;
        const { mandatory } = serversFor(b.buckets);
        const missing = [];
        for (const srv of mandatory) if (!(await isInGuild(client, srv.guildId, userId))) missing.push(srv);
        if (!missing.length) continue;

        const buttons = [];
        for (const srv of missing.slice(0, 5)) {
            const inv = await createInvite(client, srv, { maxAgeSeconds: 0 });
            if (!inv.ok) continue;
            store.upsertGrant({ discord_id: userId, guild_id: srv.guildId, server_key: srv.key, kind: 'mandatory', reason: 'Required network server' });
            store.logInvite({ discord_id: userId, guild_id: srv.guildId, server_key: srv.key, kind: 'mandatory', reason: 'daily reminder', by_id: null, code: inv.code });
            buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(`Join ${short(srv.name)}`.slice(0, 80)).setURL(inv.url));
        }
        if (!buttons.length) continue;
        const e = new EmbedBuilder().setColor(0xC9A14A).setAuthor({ name: 'USGRP · Network Administration' })
            .setTitle('📋  You\'re missing required server(s)')
            .setDescription(`As network staff you're expected to be a member of these server(s). Please join using the buttons below — there's no time limit. *(You'll get this reminder daily until you join.)*\n\n${missing.slice(0, 5).map(srv => `• **${short(srv.name)}**`).join('\n')}`)
            .setFooter({ text: 'USGRP Network Administration' }).setTimestamp();
        try {
            const u = await client.users.fetch(userId);
            const rows = [];
            for (let i = 0; i < buttons.length; i += 5) rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
            await u.send({ embeds: [e], components: rows });
            dmd++;
        } catch { /* dms closed */ }
        store.setDailyDm(userId);
    }
    console.log(`[access] daily mandatory reminder: DM'd ${dmd} staff`);
}

// ── 2. Expiry (auto-kick) + nearing-expiry extension prompt ──────────────────
export async function runExpiryAndWarn(client) {
    const grants = store.activeTimedGrants();
    let kicked = 0, warned = 0;
    for (const g of grants) {
        const server = SERVER_BY_KEY[g.server_key];
        if (!server) { store.setGrantStatus(g.id, 'revoked'); continue; }
        if (g.expires_at <= Date.now()) {
            // time's up — kick + close + notify
            await kickFromGuild(client, server.guildId, g.discord_id, 'Server access time limit expired');
            store.setGrantStatus(g.id, 'expired');
            store.resolveLeaveWatch(g.discord_id, server.guildId);
            kicked++;
            try {
                const u = await client.users.fetch(String(g.discord_id));
                await u.send({ embeds: [new EmbedBuilder().setColor(0xB91C1C).setAuthor({ name: 'USGRP · Network Administration' })
                    .setTitle('⌛ Your access has expired')
                    .setDescription(`Your time-limited access to **${short(server.name)}** has ended, so you've been removed. Need back in? Run \`/access request\` and ask for a new invite or an extension.`)
                    .setFooter({ text: 'USGRP Network Administration' }).setTimestamp()] });
            } catch { /* */ }
            continue;
        }
        // within 24h and not yet warned → DM an extension prompt (AI-style opener)
        if (g.expires_at - Date.now() <= DAY && !g.warned_at) {
            store.markWarned(g.id);
            try {
                const u = await client.users.fetch(String(g.discord_id));
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`acc:extend:${g.id}`).setLabel('Yes, extend by 7 days').setStyle(ButtonStyle.Success).setEmoji('⏳'));
                await u.send({ embeds: [new EmbedBuilder().setColor(0xB45309).setAuthor({ name: 'USGRP · Network Administration' })
                    .setTitle('⏳ Your access is about to expire')
                    .setDescription(`Heads up — your access to **${short(server.name)}** ends <t:${Math.floor(g.expires_at / 1000)}:R>. Do you still need it?\n\nTap below to extend by 7 days, or run \`/access request\` and tell me how long you need (e.g. *"extend my ${short(server.name)} access by 2 weeks"*). If you don't need it any more, no action is needed — you'll be removed automatically.`)
                    .setFooter({ text: 'USGRP Network Administration' }).setTimestamp()], components: [row] });
                warned++;
            } catch { /* */ }
        }
    }
    if (kicked || warned) console.log(`[access] expiry sweep: kicked ${kicked}, warned ${warned}`);
}

// ── 3. Leave-watch — re-invite if not back within 24h ────────────────────────
export async function runLeaveWatch(client) {
    const watches = store.openLeaveWatches();
    for (const w of watches) {
        const server = SERVER_BY_KEY[w.server_key];
        if (!server) { store.resolveLeaveWatch(w.discord_id, w.guild_id); continue; }
        if (await isInGuild(client, w.guild_id, w.discord_id)) { store.resolveLeaveWatch(w.discord_id, w.guild_id); continue; }
        if (Date.now() < w.deadline_at || w.reinvited) continue;
        // 24h passed, still not back, not yet re-invited → send a fresh invite
        const r = await grantAndInvite(client, { userId: w.discord_id, server, kind: 'mandatory', reason: 'Please rejoin — this server is required' });
        store.markLeaveReinvited(w.id);
        console.log(`[access] leave-watch re-invite ${w.discord_id} -> ${server.key} (sent=${r.sent})`);
    }
}

// ── 4. Weekly report to #fsa-operations ──────────────────────────────────────
export async function runWeeklyReport(client) {
    const staff = await roster();
    const mandatoryServers = SERVERS.filter(s => s.kind === 'main' || s.kind === 'staff' || s.kind === 'devops');
    // membership tallies per mandatory server (only over staff for whom it's mandatory)
    const tally = {}; const missingByServer = {};
    for (const srv of mandatoryServers) { tally[srv.key] = { in: 0, total: 0 }; missingByServer[srv.key] = []; }
    for (const s of staff) {
        const b = s._b;
        for (const srv of mandatoryServers) {
            if (accessLevel(srv, b.buckets) !== 'mandatory') continue;
            tally[srv.key].total++;
            if (await isInGuild(client, srv.guildId, s.discord_id)) tally[srv.key].in++;
            else missingByServer[srv.key].push(s.discord_id);
        }
    }
    const grants = store.activeGrantsFor.bind(null); // not used directly
    const timed = store.activeTimedGrants();

    const e = new EmbedBuilder().setColor(0x0A2342).setAuthor({ name: 'USGRP · Network Administration' })
        .setTitle('📊  Weekly Network Access Report')
        .setDescription(`Verified network staff: **${staff.length}**`)
        .setTimestamp().setFooter({ text: 'USGRP Network Administration · weekly' });
    for (const srv of mandatoryServers) {
        const t = tally[srv.key];
        const miss = missingByServer[srv.key];
        e.addFields({
            name: `${short(srv.name)} — ${t.in}/${t.total} in`,
            value: miss.length ? `Missing: ${miss.slice(0, 15).map(id => `<@${id}>`).join(' ')}${miss.length > 15 ? ` +${miss.length - 15}` : ''}` : '✅ everyone in',
            inline: false,
        });
    }
    if (timed.length) {
        e.addFields({
            name: `⏳ Time-limited access (${timed.length})`,
            value: timed.slice(0, 12).map(g => `<@${g.discord_id}> · ${short(SERVER_BY_KEY[g.server_key]?.name || g.server_key)} · until <t:${Math.floor(g.expires_at / 1000)}:d>`).join('\n').slice(0, 1024),
            inline: false,
        });
    }
    try { const ch = await client.channels.fetch(FSA_OPS_CHANNEL); await ch.send({ embeds: [e] }); console.log('[access] weekly report posted'); }
    catch (err) { console.error('[access] weekly report failed:', err.message); }
}

// ── Scheduler ────────────────────────────────────────────────────────────────
export function startAccessCrons(client) {
    const at = (h, m, fn, label) => {
        const next = () => { const n = new Date(); const t = new Date(n); t.setHours(h, m, 0, 0); if (t <= n) t.setDate(t.getDate() + 1); return t - n; };
        const arm = () => setTimeout(async () => { try { await fn(); } catch (e) { console.error(`[access cron ${label}]`, e.message); } setInterval(async () => { try { await fn(); } catch (e) { console.error(`[access cron ${label}]`, e.message); } }, DAY); }, next());
        arm();
    };
    // expiry + extension prompts: every 30 min
    setInterval(() => runExpiryAndWarn(client).catch(e => console.error('[access expiry]', e.message)), 30 * 60 * 1000);
    // leave-watch: every 30 min
    setInterval(() => runLeaveWatch(client).catch(e => console.error('[access leavewatch]', e.message)), 30 * 60 * 1000);
    // daily mandatory reminder: 10:00
    at(10, 0, () => runDailyMandatory(client), 'daily-mandatory');
    // weekly report: Sunday 12:00 (check hourly for Sunday-noon)
    setInterval(() => { const n = new Date(); if (n.getDay() === 0 && n.getHours() === 12 && n.getMinutes() < 30) runWeeklyReport(client).catch(e => console.error('[access weekly]', e.message)); }, 30 * 60 * 1000);
    console.log('[access] crons scheduled');
}
