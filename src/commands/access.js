// COMMAND_PERMISSION_FALLBACK: everyone
// /access — ONE command for everything, driven by plain English (DeepSeek).
//   Self:   "invite me to the Treasury for 3 days to help with an audit",
//           "I need an extension", "what am I in?"
//   Admin:  add the `member` option, then "invite them to the FBI for a week
//           because …" or "terminate them — repeated misconduct".
import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { resolveMember, isInGuild } from '../serverAccess/core.js';
import { SERVER_BY_KEY, accessLevel } from '../serverAccess/matrix.js';
import { grantAndInvite, requestExtension } from '../serverAccess/actions.js';
import { parseAccessIntent, parseAdminIntent, aiAvailable } from '../serverAccess/ai.js';
import { putPending } from '../serverAccess/state.js';
import * as store from '../serverAccess/store.js';

const NAVY = 0x0A2342;
const X = '❌', OK = '✅', DOT = '•';
const nm = (s) => s.name.replace(/^USGRP \| /, '');

const isNetAdmin = (m) => !!m?.hasNA;
const isFsaAdminRank = (m) => /^FSA (Head |Senior )?Administrator$/i.test(m?.rec?.position || '');

export const data = new SlashCommandBuilder()
    .setName('access')
    .setDescription('USGRP network server access — open the menu, or just say what you need')
    .addStringOption(o => o.setName('message').setRequired(false)
        .setDescription('Optional: say it in plain English, e.g. "invite me to the Treasury for 3 days"'))
    .addUserOption(o => o.setName('member')
        .setDescription('(Network Admin) the member to invite or terminate'));

export async function execute(interaction) {
    const perm = await canUseCommand('access', interaction);
    if (!perm.allowed) return interaction.reply({ content: `${X} ${perm.reason}`, ephemeral: true });
    await interaction.deferReply(); // public — all invites go via DM, so the panel needn't be ephemeral
    const message = interaction.options.getString('message');
    const target = interaction.options.getUser('member');
    try {
        if (message) {
            if (!aiAvailable()) return interaction.editReply({ content: `${X} The plain-English assistant isn't available right now — run \`/access\` without text to use the menu.` });
            return target ? await adminFlow(interaction, message, target) : await selfFlow(interaction, message);
        }
        return target ? await adminMenu(interaction, target) : await selfMenu(interaction);
    } catch (e) {
        return interaction.editReply({ content: `${X} Something went wrong: ${e.message}` });
    }
}

// ── Menus (no message given) ─────────────────────────────────────────────────
async function selfMenu(interaction) {
    const member = { ...(await resolveMember(interaction.user.id)), userId: interaction.user.id };
    if (!member.verified) return interaction.editReply({ content: `${X} You're not a verified network staff member, so you have no server access to manage.` });

    // Compute live membership once and share it with the status embed + pickers.
    const mandStatus = [];
    for (const s of member.mandatory) mandStatus.push({ s, inIt: await isInGuild(interaction.client, s.guildId, member.userId) });
    const grantedKeys = new Set(store.activeGrantsFor(member.userId).filter(g => g.kind === 'request').map(g => g.server_key));
    const deptCandidates = member.request.filter(s => s.kind === 'department' && !grantedKeys.has(s.key));
    const deptNotIn = [];
    for (const s of deptCandidates) if (!(await isInGuild(interaction.client, s.guildId, member.userId))) deptNotIn.push(s);

    const embed = await buildStatus(interaction, member, { compact: true, mandStatus, deptNotIn });
    const components = [];

    // Mandatory servers picker — only required servers this member ISN'T in yet.
    const mandMissing = mandStatus.filter(m => !m.inIt);
    if (mandMissing.length) {
        components.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('acc:pick:m').setPlaceholder('⭐  Mandatory servers — get an invite…')
                .addOptions(mandMissing.slice(0, 25).map(({ s }) => ({ label: nm(s).slice(0, 100), value: s.key, emoji: '⭐', description: 'Required — get your invite' })))));
    }

    // Department servers picker — only on-request servers this member can access AND isn't already in.
    if (deptNotIn.length) {
        components.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('acc:pick:d').setPlaceholder('🏛️  Department servers — request an invite…')
                .addOptions(deptNotIn.slice(0, 25).map(s => ({ label: nm(s).slice(0, 100), value: s.key, description: 'Set a reason & optional time limit' })))));
    }

    const btns = [new ButtonBuilder().setCustomId('acc:ask').setLabel('Type a request instead').setStyle(ButtonStyle.Secondary).setEmoji('💬')];
    if (store.activeGrantsFor(member.userId).some(g => g.expires_at)) {
        btns.push(new ButtonBuilder().setCustomId('acc:ext').setLabel('Extend my access').setStyle(ButtonStyle.Secondary).setEmoji('⏳'));
    }
    components.push(new ActionRowBuilder().addComponents(btns));
    return interaction.editReply({ embeds: [embed], components });
}

async function adminMenu(interaction, target) {
    const sender = await resolveMember(interaction.user.id);
    const isSuper = (await canUseCommand('terminate', interaction)).allowed;
    if (!isNetAdmin(sender) && !isFsaAdminRank(sender) && !isSuper) {
        return interaction.editReply({ content: `${X} Only Network Administration may run access actions on other members.` });
    }
    const tm = { ...(await resolveMember(target.id)), userId: target.id };
    if (!tm.verified) return interaction.editReply({ content: `${X} <@${target.id}> isn't a verified network staff member.` });

    // Only offer servers the target isn't already in.
    const canStaff = isNetAdmin(sender) || isFsaAdminRank(sender) || isSuper;
    const mand = [], dept = [];
    for (const s of tm.mandatory.filter(s => canStaff || s.kind !== 'staff')) if (!(await isInGuild(interaction.client, s.guildId, target.id))) mand.push(s);
    for (const s of tm.request.filter(s => s.kind === 'department')) if (!(await isInGuild(interaction.client, s.guildId, target.id))) dept.push(s);
    const embed = new EmbedBuilder().setColor(NAVY).setAuthor({ name: 'USGRP · Network Administration' })
        .setTitle(`🛠️  Manage access — ${target.username}`)
        .setDescription(`<@${target.id}> · **${tm.group}${tm.hasNA ? ' · NA' : ''}**\n\n${mand.length || dept.length ? 'Pick a server to invite them to, or terminate them.' : 'They\'re already in every server they can access. You can still terminate them below.'}`)
        .setFooter({ text: 'You\'ll add a reason on the next step' });
    const components = [];
    if (mand.length) {
        components.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId(`acc:apick:${target.id}:m`).setPlaceholder('⭐  Mandatory servers — send an invite…')
                .addOptions(mand.slice(0, 25).map(s => ({ label: nm(s).slice(0, 100), value: s.key })))));
    }
    if (dept.length) {
        components.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId(`acc:apick:${target.id}:d`).setPlaceholder('🏛️  Department servers — send an invite…')
                .addOptions(dept.slice(0, 25).map(s => ({ label: nm(s).slice(0, 100), value: s.key })))));
    }
    const tbtn = [];
    if (isNetAdmin(sender) || isSuper) tbtn.push(new ButtonBuilder().setCustomId(`acc:atermbtn:${target.id}`).setLabel('Terminate').setStyle(ButtonStyle.Danger).setEmoji('🚫'));
    if (tbtn.length) components.push(new ActionRowBuilder().addComponents(tbtn));
    return interaction.editReply({ embeds: [embed], components });
}

// ── Self-service ─────────────────────────────────────────────────────────────
export async function selfFlow(interaction, message) {
    const member = { ...(await resolveMember(interaction.user.id)), userId: interaction.user.id };
    if (!member.verified) return interaction.editReply({ content: `${X} You're not a verified network staff member, so you have no server access to manage.` });

    const requestServers = member.request.map(s => ({ key: s.key, name: s.name }));
    const activeTimed = store.activeGrantsFor(member.userId).filter(g => g.expires_at).map(g => ({ key: g.server_key, name: SERVER_BY_KEY[g.server_key]?.name || g.server_key }));
    const intent = await parseAccessIntent(message, { requestServers, activeTimed }).catch(() => ({ action: 'unknown' }));

    if (intent.action === 'status') return interaction.editReply({ embeds: [await buildStatus(interaction, member)] });

    if (intent.action === 'extend') {
        const r = await requestExtension(interaction.client, { userId: member.userId, serverKey: intent.server_key, extraDays: intent.duration_days || 7 });
        if (!r.ok) return interaction.editReply({ content: `${X} ${r.ambiguous ? 'You have time limits on more than one server — say which, e.g. *"extend my Treasury access by 5 days"*.' : r.error}` });
        return interaction.editReply({ content: `${OK} Extended your access to **${nm(r.server)}** — now until <t:${Math.floor(r.newExpiry / 1000)}:F>.` });
    }

    if (intent.action === 'invite') {
        const server = intent.server_key ? SERVER_BY_KEY[intent.server_key] : null;
        if (!server) return interaction.editReply({ content: `${X} I couldn't match that to a server you can request. ${member.request.length ? 'You can request: ' + member.request.map(nm).join(', ') + '.' : 'You have no servers you can request right now.'}` });
        const lvl = accessLevel(server, member.buckets);
        if (lvl === 'none') return interaction.editReply({ content: `${X} Your role doesn't have access to **${nm(server)}**.` });
        if (lvl === 'mandatory') {
            const r = await grantAndInvite(interaction.client, { userId: member.userId, server, kind: 'mandatory', reason: 'Required network server' });
            return interaction.editReply({ content: r.ok ? `${OK} **${nm(server)}** is a server you're required to be in — I've DM'd you an invite (no time limit).${r.sent ? '' : ' *(Open your DMs — I couldn\'t message you.)*'}` : `${X} ${r.error}` });
        }
        if (!intent.reason) {
            const token = putPending({ kind: 'reason', userId: member.userId, serverKey: server.key, durationDays: intent.no_limit ? null : intent.duration_days });
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`acc:reason:${token}`).setLabel('Add a reason & send').setStyle(ButtonStyle.Primary).setEmoji('📝'));
            return interaction.editReply({ content: `You'd like an invite to **${nm(server)}**${intent.no_limit ? ' (no time limit)' : intent.duration_days ? ` for ${intent.duration_days} day(s)` : ''}. I just need a reason — click below.`, components: [row] });
        }
        return confirmInvite(interaction, member, server, intent.reason, intent.no_limit ? null : intent.duration_days);
    }

    return interaction.editReply({ content: `🤔 Try *"invite me to the Treasury for 3 days to help with an audit"*, *"I need an extension"*, or *"what am I in?"*.` });
}

// ── Admin (member option set) ────────────────────────────────────────────────
async function adminFlow(interaction, message, target) {
    const sender = await resolveMember(interaction.user.id);
    const isSuper = (await canUseCommand('terminate', interaction)).allowed;
    if (!isNetAdmin(sender) && !isFsaAdminRank(sender) && !isSuper) {
        return interaction.editReply({ content: `${X} Only Network Administration may run access actions on other members.` });
    }
    const tm = { ...(await resolveMember(target.id)), userId: target.id };
    if (!tm.verified) return interaction.editReply({ content: `${X} <@${target.id}> isn't a verified network staff member.` });

    const targetServers = [...tm.request, ...tm.mandatory].map(s => ({ key: s.key, name: s.name }));
    const intent = await parseAdminIntent(message, { targetServers }).catch(() => ({ action: 'unknown' }));

    if (intent.action === 'terminate') {
        if (!isNetAdmin(sender) && !isSuper) return interaction.editReply({ content: `${X} Only Network Administration may terminate members.` });
        const token = putPending({ kind: 'terminate', userId: target.id, reason: intent.reason || 'No reason provided', byId: interaction.user.id, byName: interaction.user.username });
        const e = new EmbedBuilder().setColor(0xB91C1C).setAuthor({ name: 'USGRP · Network Administration' })
            .setTitle('🚫  Confirm termination')
            .setDescription(`This will **kick <@${target.id}> from the Network Staff Hub, DevOps and every department server**, strip their verified roles in the main server, remove them from the network verified list (so they won't get roles back on rejoin), and log it.`)
            .addFields({ name: 'Reason', value: (intent.reason || 'No reason provided').slice(0, 1024) })
            .setFooter({ text: 'This cannot be undone automatically.' });
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`acc:term:${token}:yes`).setLabel('Terminate').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`acc:term:${token}:no`).setLabel('Cancel').setStyle(ButtonStyle.Secondary));
        return interaction.editReply({ embeds: [e], components: [row] });
    }

    if (intent.action === 'send') {
        const server = intent.server_key ? SERVER_BY_KEY[intent.server_key] : null;
        if (!server || server.manual) return interaction.editReply({ content: `${X} I couldn't match that to a server <@${target.id}> can be invited to. They can be invited to: ${targetServers.map(s => s.name.replace(/^USGRP \| /, '')).join(', ') || '(none)'}.` });
        const lvl = accessLevel(server, tm.buckets);
        if (lvl === 'none') return interaction.editReply({ content: `${X} <@${target.id}>'s role doesn't have access to **${nm(server)}**.` });
        if (server.kind === 'staff' && !(isNetAdmin(sender) || isFsaAdminRank(sender) || isSuper)) {
            return interaction.editReply({ content: `${X} Only an FSA Administrator (or above) may send Network Staff Hub invites.` });
        }
        if (!intent.reason) return interaction.editReply({ content: `${X} You must give a reason — e.g. *"invite them to the Treasury for 3 days **because** they're covering an audit"*.` });
        const r = await grantAndInvite(interaction.client, {
            userId: target.id, server, kind: lvl === 'mandatory' ? 'mandatory' : 'request',
            reason: intent.reason, durationDays: lvl === 'mandatory' ? null : (intent.no_limit ? null : intent.duration_days),
            byId: interaction.user.id, byName: interaction.user.username,
        });
        if (!r.ok) return interaction.editReply({ content: `${X} ${r.error}` });
        return interaction.editReply({ content: `${OK} Invite to **${nm(server)}** sent to <@${target.id}>${r.expiresAt ? ` (expires <t:${Math.floor(r.expiresAt / 1000)}:R>)` : ' (no time limit)'}.${r.sent ? '' : ' *(They have DMs closed — they didn\'t receive it.)*'}` });
    }

    return interaction.editReply({ content: `🤔 With <@${target.id}> selected I can **send them an invite** (*"invite them to the Treasury for 3 days because …"*) or **terminate** them (*"terminate them — repeated misconduct"*). What would you like to do?` });
}

// ── Shared bits ──────────────────────────────────────────────────────────────
async function buildStatus(interaction, member, { compact = false, mandStatus = null, deptNotIn = null } = {}) {
    const client = interaction.client;
    if (!mandStatus) { mandStatus = []; for (const s of member.mandatory) mandStatus.push({ s, inIt: await isInGuild(client, s.guildId, member.userId) }); }
    const grants = store.activeGrantsFor(member.userId).filter(g => g.kind === 'request');
    if (!deptNotIn) {
        const grantedKeys = new Set(grants.map(g => g.server_key));
        const cand = member.request.filter(s => s.kind === 'department' && !grantedKeys.has(s.key));
        deptNotIn = []; for (const s of cand) if (!(await isInGuild(client, s.guildId, member.userId))) deptNotIn.push(s);
    }
    const lines = ['**Servers you must be in**'];
    for (const { s, inIt } of mandStatus) lines.push(`${inIt ? OK : X} ${nm(s)}${inIt ? '' : ' — *not joined*'}`);
    if (grants.length) {
        lines.push('\n**Your requested access**');
        for (const g of grants) {
            const s = SERVER_BY_KEY[g.server_key];
            lines.push(`${DOT} ${s ? nm(s) : g.server_key} — ${g.expires_at ? `until <t:${Math.floor(g.expires_at / 1000)}:R>` : 'no time limit'}`);
        }
    }
    if (deptNotIn.length) {
        if (compact) {
            lines.push(`\n${DOT} **${deptNotIn.length}** department server${deptNotIn.length === 1 ? '' : 's'} you can request — pick one from the menu below.`);
        } else {
            lines.push('\n**You can request an invite to**');
            lines.push(deptNotIn.slice(0, 12).map(nm).join(' · ') + (deptNotIn.length > 12 ? ` · +${deptNotIn.length - 12} more` : ''));
        }
    }
    return new EmbedBuilder().setColor(NAVY).setAuthor({ name: 'USGRP · Network Administration' })
        .setTitle('🗂️  Your Server Access').setDescription(lines.join('\n').slice(0, 4000))
        .setFooter({ text: 'Use the menus below, or /access and tell me what you need' }).setTimestamp();
}

export async function confirmInvite(interaction, member, server, reason, durationDays) {
    const token = putPending({ kind: 'invite', userId: member.userId, serverKey: server.key, reason, durationDays });
    const e = new EmbedBuilder().setColor(NAVY).setAuthor({ name: 'USGRP · Network Administration' })
        .setTitle('🎟️  Confirm your invite request')
        .addFields(
            { name: 'Server', value: nm(server), inline: true },
            { name: 'Time limit', value: durationDays ? `${durationDays} day(s)` : 'No limit', inline: true },
            { name: 'Reason', value: reason.slice(0, 1024), inline: false })
        .setFooter({ text: 'The invite is DM\'d to you on confirm' });
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`acc:inv:${token}:yes`).setLabel('Send my invite').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`acc:inv:${token}:no`).setLabel('Cancel').setStyle(ButtonStyle.Secondary));
    return interaction.editReply({ embeds: [e], components: [row] });
}
