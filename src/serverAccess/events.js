// Interaction + gateway event handling for the USGRP network-access system.
//   • acc:* buttons, selects + modals (menu picks, invite confirm, reason
//     capture, terminate, extend, plain-English ask)
//   • guildMemberRemove — leave detection (flag supervisor, start 24h watch)
//   • guildMemberAdd    — resolve an open leave-watch when they rejoin
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder } from 'discord.js';
import { resolveMember, isInGuild } from './core.js';
import { SERVER_BY_KEY, SERVER_BY_GUILD, accessLevel, DIVISION_OPS_CHANNEL, FSA_OPS_CHANNEL } from './matrix.js';
import { grantAndInvite, requestExtension } from './actions.js';
import { putPending, takePending, peekPending } from './state.js';
import * as store from './store.js';
import { canUseCommand } from '../utils/permissions.js';
import { selfFlow, adminMenuPayload } from '../commands/access.js';
import { E, ce } from '../lib/emoji.js';

const X = E.cross, OK = E.check;
const nm = (s) => s ? s.name.replace(/^USGRP \| /, '') : '';
const isNetAdmin = (m) => !!m?.hasNA;
const isFsaAdminRank = (m) => /^FSA (Head |Senior )?Administrator$/i.test(m?.rec?.position || '');
const reply = (i, content, extra = {}) => (i.deferred || i.replied) ? i.editReply({ content, components: [], embeds: [], ...extra }) : i.reply({ content, ephemeral: true, ...extra });

function reasonModal(customId, server, presetDays = null) {
    return new ModalBuilder().setCustomId(customId).setTitle(`Invite — ${nm(server).slice(0, 30)}`).addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Why do they need to join?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(300)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('days').setLabel('Time limit in days (blank = no limit)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(4).setValue(presetDays ? String(presetDays) : '')),
    );
}

// ── Selects (menu picks) ─────────────────────────────────────────────────────
export async function handleSelect(interaction) {
    const id = interaction.customId;
    if (!id.startsWith('acc:')) return false;
    const parts = id.split(':');

    if (parts[1] === 'pick') {                       // self: request an invite to picked server
        const key = interaction.values?.[0];
        const server = SERVER_BY_KEY[key];
        const member = { ...(await resolveMember(interaction.user.id)), userId: interaction.user.id };
        if (!member.verified || !server) { await interaction.deferUpdate().catch(() => {}); return true; }
        const lvl = accessLevel(server, member.buckets);
        if (lvl === 'none') { await interaction.update({ content: `${X} You don't have access to that server.`, embeds: [], components: [] }).catch(() => {}); return true; }
        if (lvl === 'mandatory') {
            await interaction.deferUpdate().catch(() => {});
            const r = await grantAndInvite(interaction.client, { userId: member.userId, server, kind: 'mandatory', reason: 'Required network server' });
            await interaction.editReply({ content: r.ok ? `${OK} **${nm(server)}** is required — I've DM'd you an invite (no time limit).${r.sent ? '' : ' *(Open your DMs.)*'}` : `${X} ${r.error}`, embeds: [], components: [] });
            return true;
        }
        const token = putPending({ kind: 'reason', userId: member.userId, serverKey: key, durationDays: null });
        await interaction.showModal(reasonModal(`acc:reasonmodal:${token}`, server));
        return true;
    }

    if (parts[1] === 'auser') {                      // admin: picked which member to manage
        const sender = await resolveMember(interaction.user.id);
        const isSuper = (await canUseCommand('terminate', interaction)).allowed;
        if (!isNetAdmin(sender) && !isFsaAdminRank(sender) && !isSuper) { await interaction.update({ content: `${X} Not authorised.`, embeds: [], components: [] }).catch(() => {}); return true; }
        const target = await interaction.client.users.fetch(interaction.values?.[0]).catch(() => null);
        if (!target) { await interaction.deferUpdate().catch(() => {}); return true; }
        await interaction.deferUpdate().catch(() => {});
        const payload = await adminMenuPayload(interaction, target);
        await interaction.editReply({ content: payload.content || '', embeds: payload.embeds || [], components: payload.components || [] });
        return true;
    }

    if (parts[1] === 'apick') {                      // admin: invite picked server to a target
        const targetId = parts[2];
        const key = interaction.values?.[0];
        const server = SERVER_BY_KEY[key];
        const sender = await resolveMember(interaction.user.id);
        const isSuper = (await canUseCommand('terminate', interaction)).allowed;
        if (!isNetAdmin(sender) && !isFsaAdminRank(sender) && !isSuper) { await interaction.update({ content: `${X} Not authorised.`, embeds: [], components: [] }).catch(() => {}); return true; }
        if (!server || (server.kind === 'staff' && !(isNetAdmin(sender) || isFsaAdminRank(sender) || isSuper))) { await interaction.deferUpdate().catch(() => {}); return true; }
        const token = putPending({ kind: 'areason', targetId, serverKey: key, byId: interaction.user.id, byName: interaction.user.username });
        await interaction.showModal(reasonModal(`acc:areasonmodal:${token}`, server));
        return true;
    }
    return false;
}

// ── Buttons ──────────────────────────────────────────────────────────────────
export async function handleButton(interaction) {
    const id = interaction.customId;
    if (!id.startsWith('acc:')) return false;
    const [, action, token, verb] = id.split(':');

    if (action === 'adminpick') {                    // panel: "Manage another member" → user picker
        const sender = await resolveMember(interaction.user.id);
        const isSuper = (await canUseCommand('terminate', interaction)).allowed;
        if (!isNetAdmin(sender) && !isFsaAdminRank(sender) && !isSuper) return reply(interaction, `${X} Only Network Administration may manage other members.`), true;
        await interaction.deferUpdate().catch(() => {});
        const row = new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId('acc:auser').setPlaceholder('Pick a member to manage…').setMaxValues(1));
        await interaction.editReply({ content: `${E.member} **Manage another member** — pick who:`, embeds: [], components: [row] });
        return true;
    }

    if (action === 'aforce' || action === 'arefresh') {   // admin: force-send all missing / refresh statuses
        const targetId = token;                           // parts[2]
        const sender = await resolveMember(interaction.user.id);
        const isSuper = (await canUseCommand('terminate', interaction)).allowed;
        const canStaff = isNetAdmin(sender) || isFsaAdminRank(sender) || isSuper;
        if (!canStaff) return reply(interaction, `${X} Only Network Administration may manage other members.`), true;
        await interaction.deferUpdate().catch(() => {});
        const target = await interaction.client.users.fetch(targetId).catch(() => null);
        if (!target) return reply(interaction, `${X} Couldn't find that member.`), true;

        if (action === 'arefresh') {                      // just re-render the panel with fresh membership
            const payload = await adminMenuPayload(interaction, target);
            await interaction.editReply({ content: payload.content || '', embeds: payload.embeds || [], components: payload.components || [] });
            return true;
        }

        // Force-send: DM every server they should/can be in but aren't.
        const tm = { ...(await resolveMember(targetId)), userId: targetId };
        if (!tm.verified) return reply(interaction, `${X} <@${targetId}> isn't a verified network staff member.`), true;
        const missing = [];
        for (const s of tm.mandatory.filter(s => canStaff || s.kind !== 'staff')) if (!(await isInGuild(interaction.client, s.guildId, targetId))) missing.push(s);
        for (const s of tm.request.filter(s => s.kind === 'department')) if (!(await isInGuild(interaction.client, s.guildId, targetId))) missing.push(s);
        if (!missing.length) return reply(interaction, `${OK} <@${targetId}> is already in every server they can access — nothing to send.`), true;
        let delivered = 0, dmsClosed = 0; const failed = [];
        for (const s of missing) {
            const lvl = accessLevel(s, tm.buckets);
            const r = await grantAndInvite(interaction.client, { userId: targetId, server: s, kind: lvl === 'mandatory' ? 'mandatory' : 'request', reason: `Sent by ${interaction.user.username} via the access panel`, byId: interaction.user.id, byName: interaction.user.username });
            if (!r.ok) failed.push(nm(s));
            else if (r.sent) delivered++;
            else dmsClosed++;
        }
        const bits = [`${OK} Force-sent **${delivered}** invite${delivered === 1 ? '' : 's'} to <@${targetId}> by DM.`];
        if (dmsClosed) bits.push(`${X} ${dmsClosed} couldn't be delivered (their DMs are closed).`);
        if (failed.length) bits.push(`${E.warning} Couldn't create an invite for: ${failed.join(', ')}.`);
        return reply(interaction, bits.join('\n')), true;
    }

    if (action === 'ask') {                          // menu: "type a request instead"
        const modal = new ModalBuilder().setCustomId('acc:askmodal').setTitle('Tell me what you need').addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('q').setLabel('What do you need?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(300).setPlaceholder('e.g. invite me to the Treasury for 3 days to help with an audit')));
        await interaction.showModal(modal);
        return true;
    }

    if (action === 'ext') {                          // menu: extend my access
        await interaction.deferUpdate().catch(() => {});
        const r = await requestExtension(interaction.client, { userId: interaction.user.id, extraDays: 7 });
        return reply(interaction, r.ok ? `${OK} Extended your access to **${nm(r.server)}** — now until <t:${Math.floor(r.newExpiry / 1000)}:F>.` : `${X} ${r.ambiguous ? 'You have more than one timed server — say which with `/access message:"extend my Treasury access by 5 days"`.' : r.error}`), true;
    }

    if (action === 'atermbtn') {                     // admin menu: terminate → ask reason
        const targetId = token;                       // parts[2]
        const sender = await resolveMember(interaction.user.id);
        const isSuper = (await canUseCommand('terminate', interaction)).allowed;
        if (!isNetAdmin(sender) && !isSuper) return reply(interaction, `${X} Only Network Administration may terminate members.`), true;
        const modal = new ModalBuilder().setCustomId(`acc:atermreason:${targetId}`).setTitle('Terminate — reason').addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Reason (logged)').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(300)));
        await interaction.showModal(modal);
        return true;
    }

    if (action === 'reason') {                        // (legacy path) add a reason for a request
        const p = peekPending(token);
        if (!p) return reply(interaction, `${X} That request expired — run \`/access\` again.`), true;
        await interaction.showModal(reasonModal(`acc:reasonmodal:${token}`, SERVER_BY_KEY[p.serverKey], p.durationDays));
        return true;
    }

    if (action === 'inv') {                          // confirm an invite
        await interaction.deferUpdate().catch(() => {});
        const p = takePending(token);
        if (!p || p.userId !== interaction.user.id) return reply(interaction, `${X} That request expired — run \`/access\` again.`), true;
        if (verb === 'no') return reply(interaction, 'Cancelled — no invite sent.'), true;
        const server = SERVER_BY_KEY[p.serverKey];
        const r = await grantAndInvite(interaction.client, { userId: p.userId, server, kind: 'request', reason: p.reason, durationDays: p.durationDays });
        return reply(interaction, r.ok ? `${OK} Invite to **${nm(server)}** sent to your DMs${r.expiresAt ? ` (expires <t:${Math.floor(r.expiresAt / 1000)}:R>)` : ' (no time limit)'}.${r.sent ? '' : ' *(Open your DMs.)*'}` : `${X} ${r.error}`), true;
    }

    if (action === 'term') {                          // confirm termination
        await interaction.deferUpdate().catch(() => {});
        const p = takePending(token);
        if (!p || p.byId !== interaction.user.id) return reply(interaction, `${X} That confirmation expired.`), true;
        if (verb === 'no') return reply(interaction, 'Cancelled — no action taken.'), true;
        const { doTermination } = await import('./actions.js');
        const r = await doTermination(interaction.client, { userId: p.userId, byId: p.byId, byName: p.byName, reason: p.reason });
        return reply(interaction, `${OK} <@${p.userId}> terminated. Kicked from **${r.kicked.length}** server(s)${r.stripped.length ? `, roles stripped in ${r.stripped.length} server(s)` : ''}${r.unverified ? ', removed from the verified list' : ''}.${r.kickFailed.length ? `\n${E.warning} Couldn't kick from: ${r.kickFailed.join(', ')}` : ''}`), true;
    }

    if (action === 'extend') {                        // from a nearing-expiry DM: +7 days
        await interaction.deferUpdate().catch(() => {});
        const grant = store.activeTimedGrants().find(g => g.id === Number(token) && g.discord_id === interaction.user.id);
        if (!grant) return interaction.followUp({ content: `${X} That access is no longer active.`, ephemeral: true }).catch(() => {}), true;
        const r = await requestExtension(interaction.client, { userId: interaction.user.id, serverKey: grant.server_key, extraDays: 7 });
        if (r.ok) {
            try { await interaction.message.edit({ components: [] }); } catch { /* */ }
            await interaction.followUp({ content: `${OK} Extended — your access to **${nm(r.server)}** now runs until <t:${Math.floor(r.newExpiry / 1000)}:F>.`, ephemeral: true }).catch(() => {});
        }
        return true;
    }
    return false;
}

// ── Modals ───────────────────────────────────────────────────────────────────
export async function handleModal(interaction) {
    const id = interaction.customId;
    if (!id.startsWith('acc:')) return false;
    const parts = id.split(':');

    if (parts[1] === 'askmodal') {                   // plain-English ask from the menu
        await interaction.deferReply().catch(() => {});
        const q = interaction.fields.getTextInputValue('q').trim();
        try { await selfFlow(interaction, q); } catch (e) { await interaction.editReply({ content: `${X} ${e.message}` }).catch(() => {}); }
        return true;
    }

    if (parts[1] === 'reasonmodal' || parts[1] === 'areasonmodal') {
        const token = parts[2];
        await interaction.deferReply().catch(() => {});
        const p = takePending(token);
        if (!p) return reply(interaction, `${X} That request expired — run \`/access\` again.`), true;
        const reason = interaction.fields.getTextInputValue('reason').trim();
        const daysRaw = (interaction.fields.getTextInputValue('days') || '').replace(/[^0-9]/g, '');
        const durationDays = daysRaw ? Math.min(365, Math.max(1, parseInt(daysRaw, 10))) : (p.durationDays || null);
        const server = SERVER_BY_KEY[p.serverKey];
        if (!reason) return reply(interaction, `${X} A reason is required.`), true;

        if (parts[1] === 'reasonmodal') {            // self request
            if (p.userId !== interaction.user.id) return reply(interaction, `${X} That request expired.`), true;
            const member = { ...(await resolveMember(interaction.user.id)), userId: interaction.user.id };
            if (!member.verified || accessLevel(server, member.buckets) === 'none') return reply(interaction, `${X} You don't have access to that server.`), true;
            const r = await grantAndInvite(interaction.client, { userId: interaction.user.id, server, kind: 'request', reason, durationDays });
            return reply(interaction, r.ok ? `${OK} Invite to **${nm(server)}** sent to your DMs${r.expiresAt ? ` (expires <t:${Math.floor(r.expiresAt / 1000)}:R>)` : ' (no time limit)'}.${r.sent ? '' : ' *(Open your DMs.)*'}` : `${X} ${r.error}`), true;
        }
        // admin invite to a target
        const tm = { ...(await resolveMember(p.targetId)), userId: p.targetId };
        if (!tm.verified || accessLevel(server, tm.buckets) === 'none') return reply(interaction, `${X} <@${p.targetId}> doesn't have access to that server.`), true;
        const lvl = accessLevel(server, tm.buckets);
        const r = await grantAndInvite(interaction.client, { userId: p.targetId, server, kind: lvl === 'mandatory' ? 'mandatory' : 'request', reason, durationDays: lvl === 'mandatory' ? null : durationDays, byId: p.byId, byName: p.byName });
        return reply(interaction, r.ok ? `${OK} Invite to **${nm(server)}** sent to <@${p.targetId}>${r.expiresAt ? ` (expires <t:${Math.floor(r.expiresAt / 1000)}:R>)` : ' (no time limit)'}.${r.sent ? '' : ' *(They have DMs closed.)*'}` : `${X} ${r.error}`), true;
    }

    if (parts[1] === 'atermreason') {                // admin terminate: reason → confirm
        const targetId = parts[2];
        await interaction.deferReply().catch(() => {});
        const sender = await resolveMember(interaction.user.id);
        const isSuper = (await canUseCommand('terminate', interaction)).allowed;
        if (!isNetAdmin(sender) && !isSuper) return reply(interaction, `${X} Only Network Administration may terminate members.`), true;
        const reason = interaction.fields.getTextInputValue('reason').trim() || 'No reason provided';
        const tk = putPending({ kind: 'terminate', userId: targetId, reason, byId: interaction.user.id, byName: interaction.user.username });
        const e = new EmbedBuilder().setColor(0xB91C1C).setAuthor({ name: 'USGRP · Network Administration' })
            .setTitle('Confirm termination')
            .setDescription(`${E.terminate} This will **kick <@${targetId}> from the Network Staff Hub, DevOps and every department server**, strip their verified roles in the main server, remove them from the network verified list (so they won't get roles back on rejoin), and log it.`)
            .addFields({ name: 'Reason', value: reason.slice(0, 1024) }).setFooter({ text: 'This cannot be undone automatically.' });
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`acc:term:${tk}:yes`).setLabel('Terminate').setStyle(ButtonStyle.Danger).setEmoji(ce('terminate')),
            new ButtonBuilder().setCustomId(`acc:term:${tk}:no`).setLabel('Cancel').setStyle(ButtonStyle.Secondary).setEmoji(ce('cross')));
        return interaction.editReply({ embeds: [e], components: [row] }), true;
    }
    return false;
}

// ── Member left a guild ──────────────────────────────────────────────────────
export async function onMemberRemove(member) {
    try {
        const guildId = String(member.guild?.id || '');
        const server = SERVER_BY_GUILD[guildId];
        if (!server || member.user?.bot) return;
        const userId = String(member.id);
        const m = await resolveMember(userId);
        if (!m.verified) return;
        const lvl = accessLevel(server, m.buckets);
        if (lvl === 'request') {
            store.resolveLeaveWatch(userId, guildId);
            const g = store.getGrant(userId, guildId);
            if (g) store.setGrantStatus(g.id, 'revoked');
            return;
        }
        if (lvl !== 'mandatory') return;
        store.startLeaveWatch({ discord_id: userId, guild_id: guildId, server_key: server.key, deadline_at: Date.now() + 86400000 });
        const chId = DIVISION_OPS_CHANNEL[m.bucket] || DIVISION_OPS_CHANNEL.fsa;
        const ch = await member.client.channels.fetch(chId).catch(() => null);
        if (ch) {
            await ch.send({ embeds: [new EmbedBuilder().setColor(0xB45309).setAuthor({ name: 'USGRP · Network Administration' })
                .setTitle('Staff member left a required server')
                .setDescription(`${E.warning} <@${userId}> (${m.group}${m.hasNA ? ' · NA' : ''}) left **${nm(server)}**, which they're required to be in.\n\nIf they don't rejoin within **24 hours**, the bot will automatically send them a fresh invite. Supervisors, please check in.`)
                .setTimestamp()] }).catch(() => {});
            const w = store.openLeaveWatch(userId, guildId);
            if (w) store.markLeaveFlagged(w.id);
        }
    } catch (e) { console.error('[access onMemberRemove]', e.message); }
}

// ── Member joined a guild ────────────────────────────────────────────────────
export async function onMemberAdd(member) {
    try {
        const guildId = String(member.guild?.id || '');
        const server = SERVER_BY_GUILD[guildId];
        if (!server || member.user?.bot) return;
        store.resolveLeaveWatch(String(member.id), guildId);   // they're back — close any watch

        // Invite-gating — the public main server is exempt. Each invite we issue
        // is one-time-use, 30 min, and tied to one person. If someone joins using
        // a (still-in-window) invite that was sent to a DIFFERENT member, kick them.
        if (server.kind === 'main') return;
        let present;
        try { const invs = await member.guild.invites.fetch(); present = new Set(invs.map(i => i.code)); }
        catch { return; }                                       // can't read invites — don't punish
        const consumed = store.consumedInvite(guildId, present, Date.now());
        if (!consumed) return;                                  // joined via an untracked invite (verification/manual) — allowed
        if (String(consumed.discord_id) === String(member.id)) return; // the intended recipient — fine
        await member.kick(`Used an invite issued to ${consumed.discord_id}, not them`).catch(() => {});
        await alertInviteMisuse(member, server, consumed);
    } catch (e) { console.error('[access onMemberAdd]', e.message); }
}

async function alertInviteMisuse(member, server, consumed) {
    try {
        await member.user.send({ embeds: [new EmbedBuilder().setColor(0xB91C1C).setAuthor({ name: 'USGRP · Network Administration' })
            .setTitle('You were removed')
            .setDescription(`You joined **${nm(server)}** using an invite that was issued to someone else. Network servers are invite-only and every invite is for one specific person, so you've been removed. If you genuinely need access, ask the relevant administrator to send you your own invite.`)
            .setTimestamp()] });
    } catch { /* dms closed */ }
    const ch = await member.client.channels.fetch(FSA_OPS_CHANNEL).catch(() => null);
    if (ch) await ch.send({ embeds: [new EmbedBuilder().setColor(0xB45309).setAuthor({ name: 'USGRP · Network Administration' })
        .setTitle('Invite misuse — member auto-removed')
        .setDescription(`${E.warning} <@${member.id}> (\`${member.id}\`) joined **${nm(server)}** using an invite that had been issued to <@${consumed.discord_id}>.\n\nEach invite is one-time-use and tied to one person, so the account was kicked automatically.`)
        .setTimestamp()] }).catch(() => {});
}
