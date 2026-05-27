// Community Organisation admin prefix-command registry — god-mode actions for
// Dion + Evan only (e.g. `.gban @user spamming`). Each command:
//   { system:'CO', group, usage, desc, run(ctx) }
// ctx = { args, rest, message, client, authorId, authorName }.
// run() returns a structured result the prefix renderer turns into a rich embed:
//   { title, note, target?, icon?, fields?: [{name,value,inline}] }
// Throw an Error to render a red failure embed. All actions are real.
import { EmbedBuilder } from 'discord.js';
import { E } from '../lib/emoji.js';
import {
    db, addInfraction, addGlobalBan, getActiveGlobalBan, addSuspension, liftSuspension,
    getActiveSuspension, startInvestigation, endInvestigation, getActiveInvestigation, getInfractions,
} from '../utils/botDb.js';
import { getUserByDiscordId } from '../db.js';
import {
    getEffectiveAllServerIds, getEffectiveStaffHqId, APPEALS_SERVER_ID,
    SUSPENDED_ROLE_ID, UNDER_INVESTIGATION_ROLE_ID,
} from '../config.js';

export function resolveId(token) { return String(token || '').replace(/[^0-9]/g, ''); }

// Metadata for the dev portal reference + AI command-builder (no executors).
export function commandList() {
    return Object.entries(COMMANDS).map(([name, c]) => ({ name, system: 'CO', group: c.group, usage: c.usage, desc: c.desc }));
}

async function applyRole(client, guildId, userId, roleId, add, reason) {
    if (!guildId || !roleId) return false;
    const g = await client.guilds.fetch(guildId).catch(() => null); if (!g) return false;
    const m = await g.members.fetch(userId).catch(() => null); if (!m) return false;
    if (add) await m.roles.add(roleId, reason).catch(() => {}); else await m.roles.remove(roleId, reason).catch(() => {});
    return true;
}

export const COMMANDS = {
    // ── Moderation ────────────────────────────────────────────────
    gban: { group: 'Moderation', usage: '.gban <@user|id> <reason>', desc: 'Global ban across every Community Organisation server.',
        async run({ args, rest, message, client, authorId, authorName }) {
            const id = resolveId(args[0]); const reason = rest.replace(args[0], '').trim();
            if (!id || !reason) throw new Error('Usage: `.gban <@user> <reason>`');
            if (getActiveGlobalBan(id)) throw new Error('That user already has an active global ban.');
            let banned = 0;
            for (const sid of getEffectiveAllServerIds(client)) {
                if (sid === APPEALS_SERVER_ID) continue;
                const g = await client.guilds.fetch(sid).catch(() => null); if (!g) continue;
                try { await g.bans.create(id, { reason: `Global Ban: ${reason}` }); banned++; } catch { /* missing perms / not present */ }
            }
            addInfraction(id, 'global_ban', reason, authorId, authorName, null, 1);
            addGlobalBan(id, reason, authorId, 1);
            return { title: 'Global ban issued', target: id, icon: E.gban,
                note: `<@${id}> has been globally banned from the Community Organisation network.`,
                fields: [
                    { name: 'Servers', value: `${E.shield} **${banned}** banned`, inline: true },
                    { name: 'Reason', value: reason, inline: false },
                ] };
        } },
    gunban: { group: 'Moderation', usage: '.gunban <@user|id>', desc: 'Lift a global ban across every server.',
        async run({ args, client }) {
            const id = resolveId(args[0]); if (!id) throw new Error('Usage: `.gunban <@user>`');
            let lifted = 0;
            for (const sid of getEffectiveAllServerIds(client)) {
                const g = await client.guilds.fetch(sid).catch(() => null); if (!g) continue;
                try { await g.bans.remove(id, 'Global unban'); lifted++; } catch { /* not banned here */ }
            }
            db.prepare('UPDATE global_bans SET active = 0 WHERE discord_id = ? AND active = 1').run(id);
            db.prepare('DELETE FROM banned_users WHERE discord_id = ?').run(id);
            return { title: 'Global ban lifted', target: id, icon: E.unban,
                note: `<@${id}>'s global ban has been lifted.`,
                fields: [{ name: 'Servers', value: `${E.check} **${lifted}** unbanned`, inline: true }] };
        } },
    warn: { group: 'Moderation', usage: '.warn <@user|id> <reason>', desc: 'Log a warning (infraction) against a member.',
        async run({ args, rest, authorId, authorName }) {
            const id = resolveId(args[0]); const reason = rest.replace(args[0], '').trim();
            if (!id || !reason) throw new Error('Usage: `.warn <@user> <reason>`');
            const inf = addInfraction(id, 'warning', reason, authorId, authorName, null, 1);
            const count = getInfractions(id).length;
            return { title: 'Warning logged', target: id, icon: E.warning,
                note: `Logged a warning against <@${id}>.`,
                fields: [
                    { name: 'Case', value: `#${inf?.lastInsertRowid ?? '—'}`, inline: true },
                    { name: 'Total infractions', value: `**${count}**`, inline: true },
                    { name: 'Reason', value: reason, inline: false },
                ] };
        } },
    suspend: { group: 'Moderation', usage: '.suspend <@user|id> <reason>', desc: 'Suspend a staff member (applies the suspended role).',
        async run({ args, rest, client, authorId }) {
            const id = resolveId(args[0]); const reason = rest.replace(args[0], '').trim();
            if (!id || !reason) throw new Error('Usage: `.suspend <@user> <reason>`');
            if (getActiveSuspension(id)) throw new Error('That member is already suspended.');
            addSuspension(id, reason, authorId);
            const applied = await applyRole(client, getEffectiveStaffHqId(client), id, SUSPENDED_ROLE_ID, true, 'Suspended');
            return { title: 'Member suspended', target: id, icon: E.suspend,
                note: `<@${id}> has been suspended.`,
                fields: [
                    { name: 'Role applied', value: applied ? `${E.check} Yes` : `${E.warning} Role not set`, inline: true },
                    { name: 'Reason', value: reason, inline: false },
                ] };
        } },
    unsuspend: { group: 'Moderation', usage: '.unsuspend <@user|id>', desc: 'Lift a suspension and remove the role.',
        async run({ args, client }) {
            const id = resolveId(args[0]); if (!id) throw new Error('Usage: `.unsuspend <@user>`');
            if (!getActiveSuspension(id)) throw new Error('That member is not suspended.');
            liftSuspension(id);
            await applyRole(client, getEffectiveStaffHqId(client), id, SUSPENDED_ROLE_ID, false, 'Unsuspended');
            return { title: 'Suspension lifted', target: id, icon: E.check,
                note: `<@${id}>'s suspension has been lifted.`,
                fields: [{ name: 'Status', value: `${E.check} Active`, inline: true }] };
        } },
    investigate: { group: 'Moderation', usage: '.investigate <@user|id> <reason>', desc: 'Open an investigation (applies the investigation role).',
        async run({ args, rest, client, authorId }) {
            const id = resolveId(args[0]); const reason = rest.replace(args[0], '').trim();
            if (!id || !reason) throw new Error('Usage: `.investigate <@user> <reason>`');
            if (getActiveInvestigation(id)) throw new Error('That member is already under investigation.');
            startInvestigation(id, reason, authorId);
            const applied = await applyRole(client, getEffectiveStaffHqId(client), id, UNDER_INVESTIGATION_ROLE_ID, true, 'Under investigation');
            return { title: 'Investigation opened', target: id, icon: E.investigate,
                note: `<@${id}> is now under investigation.`,
                fields: [
                    { name: 'Role applied', value: applied ? `${E.check} Yes` : `${E.warning} Role not set`, inline: true },
                    { name: 'Reason', value: reason, inline: false },
                ] };
        } },
    closecase: { group: 'Moderation', usage: '.closecase <@user|id> <outcome>', desc: 'Close an investigation with an outcome.',
        async run({ args, rest, client }) {
            const id = resolveId(args[0]); const outcome = rest.replace(args[0], '').trim() || 'closed';
            if (!id) throw new Error('Usage: `.closecase <@user> <outcome>`');
            if (!getActiveInvestigation(id)) throw new Error('That member has no open investigation.');
            endInvestigation(id, outcome);
            await applyRole(client, getEffectiveStaffHqId(client), id, UNDER_INVESTIGATION_ROLE_ID, false, 'Investigation closed');
            return { title: 'Investigation closed', target: id, icon: E.gavel,
                note: `Closed the investigation into <@${id}>.`,
                fields: [{ name: 'Outcome', value: outcome.slice(0, 256), inline: true }] };
        } },

    // ── Comms ─────────────────────────────────────────────────────
    dm: { group: 'Comms', usage: '.dm <@user|id> <message>', desc: 'Send a direct message to a member as the bot.',
        async run({ args, rest, client }) {
            const id = resolveId(args[0]); const text = rest.replace(args[0], '').trim();
            if (!id || !text) throw new Error('Usage: `.dm <@user> <message>`');
            const u = await client.users.fetch(id).catch(() => null); if (!u) throw new Error('Could not find that user.');
            await u.send({ embeds: [new EmbedBuilder().setColor(0x5865F2).setAuthor({ name: 'Community Organisation' }).setDescription(text.slice(0, 4000)).setTimestamp()] });
            return { title: 'Direct message sent', target: id, icon: E.dm,
                note: `Delivered your message to <@${id}>.`,
                fields: [{ name: 'Message', value: text.slice(0, 1024), inline: false }] };
        } },
    purge: { group: 'Comms', usage: '.purge <count>', desc: 'Bulk-delete the last N messages in this channel (max 100).',
        async run({ args, message }) {
            const n = Math.min(Math.max(parseInt(args[0], 10) || 0, 1), 100);
            if (!n) throw new Error('Usage: `.purge <count>` (1–100)');
            const deleted = await message.channel.bulkDelete(n, true).catch((e) => { throw new Error('Could not purge: ' + (e.message || 'unknown')); });
            return { title: 'Messages purged', icon: E.cross,
                note: `Deleted **${deleted.size}** message${deleted.size === 1 ? '' : 's'} in <#${message.channel.id}>.`,
                fields: [{ name: 'Removed', value: `**${deleted.size}**`, inline: true }] };
        } },

    // ── Roles ─────────────────────────────────────────────────────
    role: { group: 'Roles', usage: '.role <add|remove> <@user|id> <role name>', desc: 'Add or remove a role (this server).',
        async run({ args, rest, message }) {
            const op = String(args[0] || '').toLowerCase(); const id = resolveId(args[1]);
            const roleName = rest.replace(args[0], '').replace(args[1], '').trim();
            if (!['add', 'remove'].includes(op) || !id || !roleName) throw new Error('Usage: `.role <add|remove> <@user> <role name>`');
            const m = await message.guild.members.fetch(id).catch(() => null); if (!m) throw new Error('Member not in this server.');
            const role = message.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
            if (!role) throw new Error(`No role named "${roleName}" here.`);
            if (op === 'add') await m.roles.add(role, 'Admin'); else await m.roles.remove(role, 'Admin');
            return { title: op === 'add' ? 'Role added' : 'Role removed', target: id, icon: E.role,
                note: `${op === 'add' ? 'Added' : 'Removed'} the **${role.name}** role ${op === 'add' ? 'to' : 'from'} <@${id}>.`,
                fields: [{ name: 'Role', value: `**${role.name}**`, inline: true }, { name: 'Server', value: message.guild.name, inline: true }] };
        } },
    nick: { group: 'Roles', usage: '.nick <@user|id> <nickname>', desc: "Set a member's nickname (this server).",
        async run({ args, rest, message }) {
            const id = resolveId(args[0]); const nick = rest.replace(args[0], '').trim();
            if (!id) throw new Error('Usage: `.nick <@user> <nickname>`');
            const m = await message.guild.members.fetch(id).catch(() => null); if (!m) throw new Error('Member not in this server.');
            await m.setNickname(nick || null, 'Admin');
            return { title: 'Nickname set', target: id, icon: E.member,
                note: `Updated the nickname for <@${id}>.`,
                fields: [{ name: 'Nickname', value: nick ? `**${nick}**` : '_(cleared)_', inline: true }] };
        } },

    // ── Lookup ────────────────────────────────────────────────────
    whois: { group: 'Lookup', usage: '.whois <@user|id>', desc: 'Full staff/member profile.',
        async run({ args }) {
            const id = resolveId(args[0]); if (!id) throw new Error('Usage: `.whois <@user>`');
            const u = getUserByDiscordId(id);
            const ban = getActiveGlobalBan(id), susp = getActiveSuspension(id), inv = getActiveInvestigation(id);
            const infCount = getInfractions(id).length;
            const fields = [
                { name: 'Discord ID', value: `\`${id}\``, inline: true },
                { name: 'Staff record', value: u ? `${E.staff} ${u.display_name || u.position || 'On file'}` : 'Not on file', inline: true },
                { name: 'Position', value: u?.position || '—', inline: true },
                { name: 'Infractions', value: `${E.gavel} **${infCount}**`, inline: true },
                { name: 'Global ban', value: ban ? `${E.gban} Active` : `${E.check} None`, inline: true },
                { name: 'Suspension', value: susp ? `${E.suspend} Active` : `${E.check} None`, inline: true },
            ];
            if (inv) fields.push({ name: 'Investigation', value: `${E.investigate} Open`, inline: true });
            return { title: u?.display_name || `Member ${id}`, target: id, icon: E.id,
                note: `Community Organisation profile for <@${id}>.`, fields };
        } },
    infractions: { group: 'Lookup', usage: '.infractions <@user|id>', desc: "List a member's infractions.",
        async run({ args }) {
            const id = resolveId(args[0]); if (!id) throw new Error('Usage: `.infractions <@user>`');
            const list = getInfractions(id);
            if (!list.length) return { title: 'No infractions', target: id, icon: E.check, note: `<@${id}> has a clean record.` };
            const lines = list.slice(0, 10).map(r => `${E.gavel} \`#${r.id}\` **${(r.type || 'note').replace(/_/g, ' ')}** — ${(r.reason || '').slice(0, 80)}`);
            return { title: 'Infractions', target: id, icon: E.gavel,
                note: `**${list.length}** infraction${list.length === 1 ? '' : 's'} on record for <@${id}>.\n\n${lines.join('\n')}`.slice(0, 4000) };
        } },

    // ── Help ──────────────────────────────────────────────────────
    help: { group: 'Help', usage: '.help [group]', desc: 'List every Community Organisation admin command.',
        async run({ args }) {
            const filter = String(args[0] || '').toLowerCase();
            const groups = {};
            for (const [name, c] of Object.entries(COMMANDS)) { if (name === 'help') continue; (groups[c.group] = groups[c.group] || []).push(c); }
            const ORDER = ['Moderation', 'Comms', 'Roles', 'Lookup'];
            const ordered = [...ORDER.filter((g) => groups[g]), ...Object.keys(groups).filter((g) => !ORDER.includes(g))];
            const want = ordered.filter((g) => !filter || g.toLowerCase().includes(filter));
            if (!want.length) throw new Error(`No command group matching "${args[0]}". Run \`.help\` on its own.`);
            const fields = want.map((g) => ({
                name: `${g} (${groups[g].length})`,
                value: groups[g].map((c) => `\`[CO] ${c.usage}\`\n${c.desc}`).join('\n').slice(0, 1024),
                inline: false,
            }));
            const total = Object.values(groups).reduce((n, a) => n + a.length, 0);
            return { title: 'Community Organisation — Admin Commands', icon: E.seal,
                note: filter
                    ? `Showing **${want.join(', ')}**. Run \`.help\` on its own for all commands.`
                    : `All **${total}** CO admin commands — tagged **[CO]**. Prefix every one with \`.\` — e.g. \`.gban @user reason\`. Filter with \`.help <group>\`.`,
                fields };
        } },
};
