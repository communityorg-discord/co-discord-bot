// COMMAND_PERMISSION_FALLBACK: everyone
// /access — USGRP network server-access self-service + admin tools.
//   request  — natural-language ("I need an invite to the Treasury", "I need an
//              extension") → AI routes it.
//   status   — what you're in, your time limits, what you can request.
//   send     — (Network Admin) invite another member, reason required.
//   terminate— (Network Admin) remove a member from the whole network.
import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { resolveMember, isInGuild, levelForMember } from '../serverAccess/core.js';
import { SERVER_BY_KEY, accessLevel } from '../serverAccess/matrix.js';
import { grantAndInvite, requestExtension } from '../serverAccess/actions.js';
import { parseAccessIntent, aiAvailable } from '../serverAccess/ai.js';
import { putPending } from '../serverAccess/state.js';
import * as store from '../serverAccess/store.js';

const NAVY = 0x0A2342;
const X = '❌', OK = '✅', DOT = '•';

// Admin gates --------------------------------------------------------------
const isNetAdmin = (member) => !!member?.hasNA;
const isFsaAdminRank = (member) => /^FSA (Head |Senior )?Administrator$/i.test(member?.rec?.position || '');

export const data = new SlashCommandBuilder()
    .setName('access')
    .setDescription('USGRP network server access — request invites, set time limits, manage members')
    .addSubcommand(s => s.setName('request')
        .setDescription('Ask for an invite, an extension, or your status — in plain English')
        .addStringOption(o => o.setName('message').setDescription('e.g. "I need an invite to the Treasury for 3 days to help with an audit"').setRequired(true)))
    .addSubcommand(s => s.setName('status').setDescription('See which servers you\'re in, your time limits, and what you can request'))
    .addSubcommand(s => s.setName('send')
        .setDescription('(Network Admin) Send another member an invite — reason required')
        .addUserOption(o => o.setName('member').setDescription('Who to invite').setRequired(true))
        .addStringOption(o => o.setName('server').setDescription('Which server').setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName('reason').setDescription('Why they need access').setRequired(true))
        .addIntegerOption(o => o.setName('days').setDescription('Time limit in days (leave empty for no limit)').setMinValue(1).setMaxValue(365)))
    .addSubcommand(s => s.setName('terminate')
        .setDescription('(Network Admin) Remove a member from the whole network')
        .addUserOption(o => o.setName('member').setDescription('Who to terminate').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason (logged)').setRequired(true)));

// Autocomplete for /access send server -------------------------------------
export async function autocomplete(interaction) {
    const focused = (interaction.options.getFocused() || '').toLowerCase();
    const target = interaction.options.getUser('member');
    let choices = [];
    if (target) {
        const tm = await resolveMember(target.id);
        if (tm.verified) choices = [...tm.request, ...tm.mandatory];
    }
    if (!choices.length) choices = [...new Set(Object.values(SERVER_BY_KEY).filter(s => !s.manual))];
    const out = choices
        .filter(s => s.name.toLowerCase().includes(focused) || s.key.includes(focused))
        .slice(0, 25)
        .map(s => ({ name: s.name.replace(/^USGRP \| /, '').slice(0, 100), value: s.key }));
    await interaction.respond(out).catch(() => {});
}

export async function execute(interaction) {
    const perm = await canUseCommand('access', interaction);
    if (!perm.allowed) return interaction.reply({ content: `${X} ${perm.reason}`, ephemeral: true });
    const sub = interaction.options.getSubcommand();
    if (sub === 'request') return doRequest(interaction);
    if (sub === 'status') return doStatus(interaction);
    if (sub === 'send') return doSend(interaction);
    if (sub === 'terminate') return doTerminate(interaction);
}

// ── status ───────────────────────────────────────────────────────────────────
async function buildStatus(interaction, member) {
    const client = interaction.client;
    const lines = [];
    lines.push('**Servers you must be in**');
    for (const s of member.mandatory) {
        const inIt = await isInGuild(client, s.guildId, member.userId);
        lines.push(`${inIt ? OK : X} ${s.name.replace(/^USGRP \| /, '')}${inIt ? '' : ' — *not joined; run `/access request` if you need a fresh invite*'}`);
    }
    const grants = store.activeGrantsFor(member.userId).filter(g => g.kind === 'request');
    if (grants.length) {
        lines.push('\n**Your requested access**');
        for (const g of grants) {
            const s = SERVER_BY_KEY[g.server_key];
            const exp = g.expires_at ? `until <t:${Math.floor(g.expires_at / 1000)}:R>` : 'no time limit';
            lines.push(`${DOT} ${s?.name.replace(/^USGRP \| /, '') || g.server_key} — ${exp}`);
        }
    }
    const grantedKeys = new Set(grants.map(g => g.server_key));
    const canReq = member.request.filter(s => !grantedKeys.has(s.key));
    if (canReq.length) {
        lines.push('\n**You can request an invite to**');
        lines.push(canReq.map(s => s.name.replace(/^USGRP \| /, '')).join(' · '));
    }
    return new EmbedBuilder().setColor(NAVY)
        .setAuthor({ name: 'USGRP · Network Administration' })
        .setTitle('🗂️  Your Server Access')
        .setDescription(lines.join('\n').slice(0, 4000))
        .setFooter({ text: 'Use /access request "…" to ask for an invite or an extension' })
        .setTimestamp();
}

async function doStatus(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const member = { ...(await resolveMember(interaction.user.id)), userId: interaction.user.id };
    if (!member.verified) return interaction.editReply({ content: `${X} You're not a verified network staff member, so you have no server access to manage.` });
    return interaction.editReply({ embeds: [await buildStatus(interaction, member)] });
}

// ── request (AI) ─────────────────────────────────────────────────────────────
async function doRequest(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const member = { ...(await resolveMember(interaction.user.id)), userId: interaction.user.id };
    if (!member.verified) return interaction.editReply({ content: `${X} You're not a verified network staff member, so you can't request server access.` });

    const msg = interaction.options.getString('message');
    if (!aiAvailable()) return interaction.editReply({ content: `${X} The natural-language assistant isn't available right now. Use \`/access status\` to see your options.` });

    const requestServers = member.request.map(s => ({ key: s.key, name: s.name }));
    const activeTimed = store.activeGrantsFor(member.userId).filter(g => g.expires_at).map(g => ({ key: g.server_key, name: SERVER_BY_KEY[g.server_key]?.name || g.server_key }));
    const intent = await parseAccessIntent(msg, { requestServers, activeTimed }).catch(() => ({ action: 'unknown' }));

    if (intent.action === 'status') return interaction.editReply({ embeds: [await buildStatus(interaction, member)] });

    if (intent.action === 'extend') {
        const r = await requestExtension(interaction.client, { userId: member.userId, serverKey: intent.server_key, extraDays: intent.duration_days || 7 });
        if (!r.ok) {
            if (r.ambiguous) return interaction.editReply({ content: `${X} You have time limits on more than one server — say which, e.g. *"extend my Treasury access by 5 days"*.` });
            return interaction.editReply({ content: `${X} ${r.error}` });
        }
        return interaction.editReply({ content: `${OK} Extended your access to **${r.server?.name.replace(/^USGRP \| /, '')}** — now until <t:${Math.floor(r.newExpiry / 1000)}:F>.` });
    }

    if (intent.action === 'invite') {
        const server = intent.server_key ? SERVER_BY_KEY[intent.server_key] : null;
        if (!server) return interaction.editReply({ content: `${X} I couldn't match that to a server you can request. ${member.request.length ? 'You can request: ' + member.request.map(s => s.name.replace(/^USGRP \| /, '')).join(', ') + '.' : 'You have no servers you can request right now.'}` });
        const lvl = accessLevel(server, member.buckets);
        if (lvl === 'none') return interaction.editReply({ content: `${X} Your role doesn't have access to **${server.name.replace(/^USGRP \| /, '')}**.` });
        if (lvl === 'mandatory') {
            // It's a mandatory server — just send them the invite, no time limit.
            const r = await grantAndInvite(interaction.client, { userId: member.userId, server, kind: 'mandatory', reason: 'Required network server' });
            return interaction.editReply({ content: r.ok ? `${OK} **${server.name.replace(/^USGRP \| /, '')}** is a server you're required to be in — I've DM'd you an invite (no time limit).${r.sent ? '' : ' *(I couldn\'t DM you — please open your DMs.)*'}` : `${X} ${r.error}` });
        }
        // On-request server — need a reason. Use the parsed one, or ask.
        if (!intent.reason) {
            const token = putPending({ kind: 'reason', userId: member.userId, serverKey: server.key, durationDays: intent.no_limit ? null : intent.duration_days });
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`acc:reason:${token}`).setLabel('Add a reason & send').setStyle(ButtonStyle.Primary).setEmoji('📝'));
            return interaction.editReply({ content: `You'd like an invite to **${server.name.replace(/^USGRP \| /, '')}**${intent.no_limit ? ' (no time limit)' : intent.duration_days ? ` for ${intent.duration_days} day(s)` : ''}. I just need a reason — click below.`, components: [row] });
        }
        return confirmInvite(interaction, member, server, intent.reason, intent.no_limit ? null : intent.duration_days);
    }

    return interaction.editReply({ content: `🤔 I wasn't sure what you needed. Try *"I need an invite to the Treasury for 3 days to help with an audit"*, *"I need an extension"*, or use \`/access status\`.` });
}

// Confirmation card before an on-request invite goes out.
export async function confirmInvite(interaction, member, server, reason, durationDays) {
    const token = putPending({ kind: 'invite', userId: member.userId, serverKey: server.key, reason, durationDays });
    const e = new EmbedBuilder().setColor(NAVY).setAuthor({ name: 'USGRP · Network Administration' })
        .setTitle('🎟️  Confirm your invite request')
        .addFields(
            { name: 'Server', value: server.name.replace(/^USGRP \| /, ''), inline: true },
            { name: 'Time limit', value: durationDays ? `${durationDays} day(s)` : 'No limit', inline: true },
            { name: 'Reason', value: reason.slice(0, 1024), inline: false },
        ).setFooter({ text: 'The invite is DM\'d to you on confirm' });
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`acc:inv:${token}:yes`).setLabel('Send my invite').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`acc:inv:${token}:no`).setLabel('Cancel').setStyle(ButtonStyle.Secondary));
    const payload = { embeds: [e], components: [row] };
    return interaction.deferred || interaction.replied ? interaction.editReply(payload) : interaction.reply({ ...payload, ephemeral: true });
}

// ── send (admin invites another member) ──────────────────────────────────────
async function doSend(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const sender = await resolveMember(interaction.user.id);
    const isSuper = !!(interaction.member && (await canUseCommand('terminate', interaction)).allowed); // superuser/high-auth shortcut
    if (!isNetAdmin(sender) && !isFsaAdminRank(sender) && !isSuper) {
        return interaction.editReply({ content: `${X} Only Network Administration may send invites to other members.` });
    }
    const target = interaction.options.getUser('member');
    const key = interaction.options.getString('server');
    const reason = interaction.options.getString('reason');
    const days = interaction.options.getInteger('days');
    const server = SERVER_BY_KEY[key];
    if (!server || server.manual) return interaction.editReply({ content: `${X} That isn't a server invites can be sent to.` });

    const tm = { ...(await resolveMember(target.id)), userId: target.id };
    if (!tm.verified) return interaction.editReply({ content: `${X} <@${target.id}> isn't a verified network staff member.` });
    const lvl = accessLevel(server, tm.buckets);
    if (lvl === 'none') return interaction.editReply({ content: `${X} <@${target.id}>'s role doesn't have access to **${server.name.replace(/^USGRP \| /, '')}**.` });
    // Staff Hub invites: FSA Admin/Senior/Head or NA only.
    if (server.kind === 'staff' && !(isNetAdmin(sender) || isFsaAdminRank(sender) || isSuper)) {
        return interaction.editReply({ content: `${X} Only an FSA Administrator (or above) may send Network Staff Hub invites.` });
    }
    const r = await grantAndInvite(interaction.client, {
        userId: target.id, server, kind: lvl === 'mandatory' ? 'mandatory' : 'request',
        reason, durationDays: lvl === 'mandatory' ? null : days, byId: interaction.user.id, byName: interaction.user.username,
    });
    if (!r.ok) return interaction.editReply({ content: `${X} ${r.error}` });
    return interaction.editReply({ content: `${OK} Invite to **${server.name.replace(/^USGRP \| /, '')}** sent to <@${target.id}>${r.expiresAt ? ` (expires <t:${Math.floor(r.expiresAt / 1000)}:R>)` : ' (no time limit)'}.${r.sent ? '' : ' *(They have DMs closed — they didn\'t receive it.)*'}` });
}

// ── terminate (admin) ────────────────────────────────────────────────────────
async function doTerminate(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const sender = await resolveMember(interaction.user.id);
    const isSuper = (await canUseCommand('terminate', interaction)).allowed;
    if (!isNetAdmin(sender) && !isSuper) return interaction.editReply({ content: `${X} Only Network Administration may terminate members.` });
    const target = interaction.options.getUser('member');
    const reason = interaction.options.getString('reason');
    const token = putPending({ kind: 'terminate', userId: target.id, reason, byId: interaction.user.id, byName: interaction.user.username });
    const e = new EmbedBuilder().setColor(0xB91C1C).setAuthor({ name: 'USGRP · Network Administration' })
        .setTitle('🚫  Confirm termination')
        .setDescription(`This will **kick <@${target.id}> from the Network Staff Hub, DevOps and every department server**, strip their verified roles in the main server, and log it.`)
        .addFields({ name: 'Reason', value: reason.slice(0, 1024) })
        .setFooter({ text: 'This cannot be undone automatically.' });
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`acc:term:${token}:yes`).setLabel('Terminate').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`acc:term:${token}:no`).setLabel('Cancel').setStyle(ButtonStyle.Secondary));
    return interaction.editReply({ embeds: [e], components: [row] });
}
