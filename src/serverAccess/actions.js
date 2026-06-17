// High-level USGRP network-access actions, shared by the /access command, the
// AI parser, and the crons: grant an invite, extend a time limit, terminate.
import { EmbedBuilder } from 'discord.js';
import {
    createInvite, sendInviteDM, resolveMember, kickFromGuild, stripVerifiedRoles,
} from './core.js';
import {
    SERVERS, SERVER_BY_KEY, terminationKickServers, TERMINATION_LOG_CHANNEL,
    NETWORK_STAFF_ROLE, NETWORK_ADMIN_ROLE,
} from './matrix.js';
import * as store from './store.js';
import { networkVerifyApi } from '../utils/aspireInternal.js';

const DAY = 86400000;

// Grant a member access to a server: make an invite, DM it, record the grant
// (with optional time limit). kind 'mandatory' | 'request'.
export async function grantAndInvite(client, { userId, server, kind = 'request', reason = null, durationDays = null, byId = null, byName = null }) {
    const inv = await createInvite(client, server, { maxAgeSeconds: 0 });
    if (!inv.ok) return { ok: false, error: inv.error };
    const expiresAt = (kind !== 'mandatory' && durationDays) ? Date.now() + durationDays * DAY : null;
    store.upsertGrant({ discord_id: userId, guild_id: server.guildId, server_key: server.key, kind, reason, granted_by: byId, expires_at: expiresAt });
    const sent = await sendInviteDM(client, userId, { server, url: inv.url, reason, kind, expiresAt, byName });
    store.logInvite({ discord_id: userId, guild_id: server.guildId, server_key: server.key, kind, reason, by_id: byId, code: inv.code });
    return { ok: true, sent, url: inv.url, expiresAt };
}

// Extend an active time-limited grant by extraDays (from the later of now / its
// current expiry). serverKey optional — if omitted and exactly one timed grant
// exists, that one is used.
export async function requestExtension(client, { userId, serverKey = null, extraDays = 7 }) {
    const timed = store.activeGrantsFor(userId).filter(g => g.expires_at);
    if (!timed.length) return { ok: false, error: 'You have no time-limited access to extend.' };
    let grant = serverKey ? timed.find(g => g.server_key === serverKey) : (timed.length === 1 ? timed[0] : null);
    if (!grant) return { ok: false, error: 'Tell me which server — you have more than one timed access.', ambiguous: timed };
    const base = Math.max(Date.now(), grant.expires_at);
    const newExpiry = base + extraDays * DAY;
    store.extendGrant(grant.id, newExpiry);
    const server = SERVER_BY_KEY[grant.server_key];
    try {
        const u = await client.users.fetch(String(userId));
        await u.send({ embeds: [new EmbedBuilder().setColor(0x166534).setAuthor({ name: 'USGRP · Network Administration' })
            .setTitle('✅ Access extended')
            .setDescription(`Your access to **${server?.name || grant.server_key}** now runs until <t:${Math.floor(newExpiry / 1000)}:F>.`)
            .setFooter({ text: 'USGRP Network Administration' }).setTimestamp()] });
    } catch { /* dms closed */ }
    return { ok: true, server, newExpiry };
}

// Termination: kick from every private/satellite server, strip the verification
// roles in the main (and state) servers, revoke grants, log it.
export async function doTermination(client, { userId, byId = null, byName = 'Network Administration', reason = 'No reason provided' }) {
    const m = await resolveMember(userId).catch(() => ({ verified: false }));
    const roleNames = new Set([...(m?.rec?.hub_roles || []), ...(m?.rec?.roles || []), NETWORK_STAFF_ROLE, NETWORK_ADMIN_ROLE]);

    const kicked = [], kickFailed = [];
    for (const s of terminationKickServers()) {
        const r = await kickFromGuild(client, s.guildId, userId, `Network termination: ${reason}`);
        if (r.ok) kicked.push(s.name);
        else if (r.error !== 'not a member' && r.error !== 'not in guild') kickFailed.push(`${s.name} (${r.error})`);
    }
    // Strip verified roles in main + state servers (state servers join the matrix later).
    const stripped = [];
    for (const s of SERVERS.filter(x => x.kind === 'main' || x.kind === 'state')) {
        const r = await stripVerifiedRoles(client, s.guildId, userId, roleNames);
        if (r.ok && r.removed) stripped.push(`${s.name} (${r.removed})`);
    }
    store.revokeGrantsForUser(userId);

    // Remove them from the network verified list so the on-join handler never
    // re-grants their roles when they rejoin a server.
    const unverify = await networkVerifyApi.remove(userId).catch(() => ({ ok: false }));

    // Log to the network-staff unverified log.
    try {
        const ch = await client.channels.fetch(TERMINATION_LOG_CHANNEL);
        const e = new EmbedBuilder().setColor(0xB91C1C).setAuthor({ name: 'USGRP · Network Administration' })
            .setTitle('🚫 Network Staff Terminated')
            .setDescription(`<@${userId}> (\`${userId}\`) has been removed from the network.`)
            .addFields(
                { name: 'Reason', value: String(reason).slice(0, 1024), inline: false },
                { name: 'Kicked from', value: (kicked.length ? kicked.join(', ') : 'none').slice(0, 1024), inline: false },
                { name: 'Roles stripped', value: (stripped.length ? stripped.join(', ') : 'none').slice(0, 1024), inline: false },
                { name: 'Network verification', value: unverify.ok ? (unverify.removed ? '✅ removed from the verified list' : 'not on the verified list') : '⚠️ could not remove — check manually', inline: false },
                { name: 'By', value: byName, inline: true },
            ).setTimestamp();
        await ch.send({ embeds: [e] });
    } catch { /* channel unreachable */ }

    return { ok: true, kicked, kickFailed, stripped, unverified: !!unverify.ok };
}

// Best-effort: which mandatory servers a member is NOT currently in.
export async function missingMandatory(client, member, isInGuild) {
    const out = [];
    for (const s of member.mandatory) {
        if (!(await isInGuild(client, s.guildId, member.userId))) out.push(s);
    }
    return out;
}
