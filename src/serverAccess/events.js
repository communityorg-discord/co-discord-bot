// Interaction + gateway event handling for the USGRP network-access system.
//   • acc:* buttons + modals (invite confirm, reason capture, terminate, extend)
//   • guildMemberRemove — leave detection (flag supervisor, start 24h watch)
//   • guildMemberAdd    — resolve an open leave-watch when they rejoin
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { resolveMember } from './core.js';
import { SERVER_BY_KEY, SERVER_BY_GUILD, accessLevel, DIVISION_OPS_CHANNEL } from './matrix.js';
import { grantAndInvite, requestExtension } from './actions.js';
import { putPending, takePending, peekPending } from './state.js';
import * as store from './store.js';

const X = '❌', OK = '✅';
const reply = (i, content, extra = {}) => (i.deferred || i.replied) ? i.editReply({ content, components: [], embeds: [], ...extra }) : i.reply({ content, ephemeral: true, ...extra });

// ── Buttons ──────────────────────────────────────────────────────────────────
export async function handleButton(interaction) {
    const id = interaction.customId;
    if (!id.startsWith('acc:')) return false;
    const [, action, token, verb] = id.split(':');

    if (action === 'reason') {
        const p = peekPending(token);
        if (!p) return reply(interaction, `${X} That request expired — run \`/access request\` again.`), true;
        const server = SERVER_BY_KEY[p.serverKey];
        const modal = new ModalBuilder().setCustomId(`acc:reasonmodal:${token}`).setTitle(`Invite — ${(server?.name || '').replace(/^USGRP \| /, '').slice(0, 30)}`);
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Why do you need to join?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(300)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('days').setLabel('Time limit in days (blank = no limit)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(4).setValue(p.durationDays ? String(p.durationDays) : '')),
        );
        await interaction.showModal(modal);
        return true;
    }

    if (action === 'inv') {
        await interaction.deferUpdate().catch(() => {});
        const p = takePending(token);
        if (!p || p.userId !== interaction.user.id) return reply(interaction, `${X} That request expired — run \`/access request\` again.`), true;
        if (verb === 'no') return reply(interaction, 'Cancelled — no invite sent.'), true;
        const server = SERVER_BY_KEY[p.serverKey];
        const r = await grantAndInvite(interaction.client, { userId: p.userId, server, kind: 'request', reason: p.reason, durationDays: p.durationDays });
        return reply(interaction, r.ok
            ? `${OK} Invite to **${server.name.replace(/^USGRP \| /, '')}** sent to your DMs${r.expiresAt ? ` (expires <t:${Math.floor(r.expiresAt / 1000)}:R>)` : ' (no time limit)'}.${r.sent ? '' : ' *(Open your DMs — I couldn\'t message you.)*'}`
            : `${X} ${r.error}`), true;
    }

    if (action === 'term') {
        await interaction.deferUpdate().catch(() => {});
        const p = takePending(token);
        if (!p || p.byId !== interaction.user.id) return reply(interaction, `${X} That confirmation expired.`), true;
        if (verb === 'no') return reply(interaction, 'Cancelled — no action taken.'), true;
        const { doTermination } = await import('./actions.js');
        const r = await doTermination(interaction.client, { userId: p.userId, byId: p.byId, byName: p.byName, reason: p.reason });
        return reply(interaction, `${OK} <@${p.userId}> terminated. Kicked from **${r.kicked.length}** server(s)${r.stripped.length ? `, roles stripped in ${r.stripped.length} server(s)` : ''}.${r.kickFailed.length ? `\n⚠️ Couldn't kick from: ${r.kickFailed.join(', ')}` : ''}`), true;
    }

    if (action === 'extend') {
        // From a nearing-expiry DM: extend this grant by 7 days.
        await interaction.deferUpdate().catch(() => {});
        const grantId = Number(token);
        const grant = store.activeTimedGrants().find(g => g.id === grantId && g.discord_id === interaction.user.id);
        if (!grant) return interaction.followUp({ content: `${X} That access is no longer active.`, ephemeral: true }).catch(() => {}), true;
        const r = await requestExtension(interaction.client, { userId: interaction.user.id, serverKey: grant.server_key, extraDays: 7 });
        if (r.ok) {
            try { await interaction.message.edit({ components: [] }); } catch { /* */ }
            await interaction.followUp({ content: `${OK} Extended — your access to **${r.server?.name.replace(/^USGRP \| /, '')}** now runs until <t:${Math.floor(r.newExpiry / 1000)}:F>.`, ephemeral: true }).catch(() => {});
        }
        return true;
    }
    return false;
}

// ── Modals ───────────────────────────────────────────────────────────────────
export async function handleModal(interaction) {
    const id = interaction.customId;
    if (!id.startsWith('acc:reasonmodal:')) return false;
    const token = id.split(':')[2];
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
    const p = takePending(token);
    if (!p || p.userId !== interaction.user.id) return reply(interaction, `${X} That request expired — run \`/access request\` again.`), true;
    const reason = interaction.fields.getTextInputValue('reason').trim();
    const daysRaw = (interaction.fields.getTextInputValue('days') || '').replace(/[^0-9]/g, '');
    const durationDays = daysRaw ? Math.min(365, Math.max(1, parseInt(daysRaw, 10))) : null;
    const server = SERVER_BY_KEY[p.serverKey];
    if (!reason) return reply(interaction, `${X} A reason is required.`), true;
    const member = { ...(await resolveMember(interaction.user.id)), userId: interaction.user.id };
    if (!member.verified || accessLevel(server, member.buckets) === 'none') return reply(interaction, `${X} You don't have access to that server.`), true;
    const r = await grantAndInvite(interaction.client, { userId: interaction.user.id, server, kind: 'request', reason, durationDays });
    return reply(interaction, r.ok
        ? `${OK} Invite to **${server.name.replace(/^USGRP \| /, '')}** sent to your DMs${r.expiresAt ? ` (expires <t:${Math.floor(r.expiresAt / 1000)}:R>)` : ' (no time limit)'}.${r.sent ? '' : ' *(Open your DMs — I couldn\'t message you.)*'}`
        : `${X} ${r.error}`), true;
}

// ── Member left a guild ──────────────────────────────────────────────────────
export async function onMemberRemove(member) {
    try {
        const guildId = String(member.guild?.id || '');
        const server = SERVER_BY_GUILD[guildId];
        if (!server || member.user?.bot) return;
        const userId = String(member.id);
        const m = await resolveMember(userId);
        if (!m.verified) return;                       // not network staff — ignore
        const lvl = accessLevel(server, m.buckets);
        if (lvl === 'request') {                        // they left a server they'd requested — close the grant
            store.resolveLeaveWatch(userId, guildId);
            const g = store.getGrant(userId, guildId);
            if (g) store.setGrantStatus(g.id, 'revoked');
            return;
        }
        if (lvl !== 'mandatory') return;
        // Required server — start the 24h re-join watch and flag the division.
        store.startLeaveWatch({ discord_id: userId, guild_id: guildId, server_key: server.key, deadline_at: Date.now() + 86400000 });
        const chId = DIVISION_OPS_CHANNEL[m.bucket] || DIVISION_OPS_CHANNEL.fsa;
        const ch = await member.client.channels.fetch(chId).catch(() => null);
        if (ch) {
            await ch.send({ embeds: [new EmbedBuilder().setColor(0xB45309).setAuthor({ name: 'USGRP · Network Administration' })
                .setTitle('⚠️ Staff member left a required server')
                .setDescription(`<@${userId}> (${m.group}${m.hasNA ? ' · NA' : ''}) left **${server.name.replace(/^USGRP \| /, '')}**, which they're required to be in.\n\nIf they don't rejoin within **24 hours**, the bot will automatically send them a fresh invite. Supervisors, please check in.`)
                .setTimestamp()] }).catch(() => {});
            // mark flagged on the open watch
            const w = store.openLeaveWatch(userId, guildId);
            if (w) store.markLeaveFlagged(w.id);
        }
    } catch (e) { console.error('[access onMemberRemove]', e.message); }
}

// ── Member joined a guild ────────────────────────────────────────────────────
export async function onMemberAdd(member) {
    try {
        const guildId = String(member.guild?.id || '');
        if (!SERVER_BY_GUILD[guildId] || member.user?.bot) return;
        store.resolveLeaveWatch(String(member.id), guildId);   // they're back — close any watch
    } catch (e) { console.error('[access onMemberAdd]', e.message); }
}
