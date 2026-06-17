// Core USGRP network-access operations: resolve a member's category, create
// invites, send the designed invite DM, check/kick membership, strip roles.
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } from 'discord.js';
import { networkVerifyApi } from '../utils/aspireInternal.js';
import {
    SERVERS, SERVER_BY_GUILD, bucketsFor, serversFor, accessLevel,
    NETWORK_STAFF_ROLE, NETWORK_ADMIN_ROLE,
} from './matrix.js';
import { E, ce } from '../lib/emoji.js';

const NAVY = 0x0A2342, GOLD = 0xC9A14A, RED = 0xB91C1C, GREEN = 0x166534;

// ── Member category resolution ───────────────────────────────────────────────
// Returns { verified, rec, buckets[], group, isDev, hasNA, mandatory[], request[] }.
export async function resolveMember(userId) {
    const r = await networkVerifyApi.record(String(userId)).catch(() => null);
    const rec = r?.record || null;
    if (!rec || !rec.position) return { verified: false };
    const b = bucketsFor(rec);
    const { mandatory, request } = serversFor(b.buckets);
    return { verified: true, rec, ...b, mandatory, request };
}

// What a server is to this member: 'mandatory' | 'request' | 'none'.
export function levelForMember(server, member) {
    if (!member?.verified) return 'none';
    return accessLevel(server, member.buckets);
}

// ── Live Discord membership ──────────────────────────────────────────────────
export function guildOf(client, guildId) { return client.guilds.cache.get(String(guildId)) || null; }

export async function isInGuild(client, guildId, userId) {
    const g = guildOf(client, guildId);
    if (!g) return false;
    const m = await g.members.fetch(String(userId)).catch(() => null);
    return !!m;
}

// Which of OUR tracked servers a user is currently in → array of server objects.
export async function joinedServers(client, userId) {
    const out = [];
    for (const s of SERVERS) {
        if (await isInGuild(client, s.guildId, userId)) out.push(s);
    }
    return out;
}

// ── Invite creation ──────────────────────────────────────────────────────────
async function inviteChannel(guild) {
    try { await guild.channels.fetch(); } catch { /* cache */ }
    const me = await guild.members.fetchMe().catch(() => null);
    const can = (ch) => ch && (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement)
        && (!me || ch.permissionsFor(me)?.has(PermissionFlagsBits.CreateInstantInvite));
    const text = [...guild.channels.cache.values()].filter(can).sort((a, b) => a.rawPosition - b.rawPosition);
    const prefer = ['welcome', 'start-here', 'start_here', 'information', 'info', 'rules', 'verify', 'verification', 'lobby', 'general', 'main-chat', 'chat', 'lounge'];
    for (const name of prefer) { const c = text.find(ch => ch.name.toLowerCase().includes(name)); if (c) return c; }
    if (guild.systemChannel && can(guild.systemChannel)) return guild.systemChannel;
    return text[0] || null;
}

// Create a unique invite for a server. Default: ONE-TIME USE, expires in 30
// minutes (Discord-standard maxAge/maxUses) — so a link only ever admits the one
// person it was sent to, and goes stale fast.
export const INVITE_MAX_AGE = 1800;  // 30 minutes
export const INVITE_MAX_USES = 1;    // one-time use
export async function createInvite(client, server, { maxAgeSeconds = INVITE_MAX_AGE, maxUses = INVITE_MAX_USES } = {}) {
    const guild = guildOf(client, server.guildId);
    if (!guild) return { ok: false, error: 'The bot is not in that server.' };
    const ch = await inviteChannel(guild);
    if (!ch) return { ok: false, error: 'No channel available to make an invite.' };
    const inv = await ch.createInvite({ maxAge: maxAgeSeconds, maxUses, unique: true, reason: 'USGRP network access' }).catch((e) => ({ _err: e?.message }));
    if (!inv || inv._err) return { ok: false, error: inv?._err || 'Could not create an invite.' };
    return { ok: true, code: inv.code, url: `https://discord.gg/${inv.code}`, linkExpiresAt: maxAgeSeconds ? Date.now() + maxAgeSeconds * 1000 : null };
}

// ── The designed invite DM ───────────────────────────────────────────────────
const fmtDur = (ms) => {
    if (ms == null) return null;
    const d = Math.round(ms / 86400000);
    if (d >= 1) return `${d} day${d === 1 ? '' : 's'}`;
    const h = Math.round(ms / 3600000);
    return `${h} hour${h === 1 ? '' : 's'}`;
};

export async function sendInviteDM(client, userId, { server, url, reason, kind, expiresAt, byName }) {
    const e = new EmbedBuilder()
        .setColor(kind === 'mandatory' ? GOLD : NAVY)
        .setAuthor({ name: 'USGRP · Network Administration' })
        .setTitle(`Server Invite — ${server.name.replace(/^USGRP \| /, '')}`)
        .setTimestamp();
    const lines = [];
    if (kind === 'mandatory') {
        lines.push(`${E.star} You're **expected to be a member** of **${server.name}**. Please join using the button below — there's no time limit.`);
    } else {
        lines.push(`${E.ticket} Here's your invite to **${server.name}**.`);
    }
    if (reason) lines.push(`\n**Reason:** ${reason}`);
    if (expiresAt) {
        lines.push(`**Access until:** <t:${Math.floor(expiresAt / 1000)}:F> *(in ${fmtDur(expiresAt - Date.now())})*`);
        lines.push(`*When the time's up you'll be removed automatically. You can ask for an extension with \`/access\` → "I need an extension".*`);
    } else if (kind !== 'mandatory') {
        lines.push(`**Time limit:** none — you can stay as long as you need.`);
    }
    if (byName) lines.push(`\n*Invited by ${byName}.*`);
    lines.push(`\n${E.pending} *This invite is **one-time use** and **expires in 30 minutes** — please join soon. It's tied to you; if anyone else uses it they'll be removed.*`);
    e.setDescription(lines.join('\n'));
    e.setFooter({ text: 'USGRP Network Administration · this invite is for you only' });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Join the server').setURL(url).setEmoji(ce('link')),
    );
    try {
        const user = await client.users.fetch(String(userId));
        await user.send({ embeds: [e], components: [row] });
        return true;
    } catch { return false; }
}

// ── Kick + role strip (termination / expiry) ─────────────────────────────────
export async function kickFromGuild(client, guildId, userId, reason) {
    const g = guildOf(client, guildId);
    if (!g) return { ok: false, error: 'not in guild' };
    const m = await g.members.fetch(String(userId)).catch(() => null);
    if (!m) return { ok: false, error: 'not a member' };
    if (!m.kickable) return { ok: false, error: 'not kickable' };
    try { await m.kick(reason?.slice(0, 400) || 'USGRP network access'); return { ok: true }; }
    catch (e) { return { ok: false, error: e?.message || 'kick failed' }; }
}

// Remove the network-verification roles from a member in one guild.
// roleNames = Set/array of role names to strip (the member's granted set + the
// shared Network Staff / Network Administration roles).
export async function stripVerifiedRoles(client, guildId, userId, roleNames) {
    const g = guildOf(client, guildId);
    if (!g) return { ok: false, error: 'not in guild' };
    const m = await g.members.fetch(String(userId)).catch(() => null);
    if (!m) return { ok: false, error: 'not a member' };
    const want = new Set([...(roleNames || []), NETWORK_STAFF_ROLE, NETWORK_ADMIN_ROLE]);
    const toRemove = [...m.roles.cache.values()].filter(r => want.has(r.name) && r.id !== g.id);
    let removed = 0;
    for (const r of toRemove) { try { await m.roles.remove(r, 'USGRP network termination'); removed++; } catch { /* hierarchy */ } }
    return { ok: true, removed };
}

export { SERVER_BY_GUILD, SERVERS };
