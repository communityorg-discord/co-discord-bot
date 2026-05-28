// Community Organisation admin prefix-command registry — god-mode actions for
// Dion + Evan only (e.g. `.gban @user spamming`). Each command:
//   { system:'CO', group, usage, desc, run(ctx) }
// ctx = { args, rest, message, client, authorId, authorName }.
// run() returns a structured result the prefix renderer turns into a rich embed:
//   { title, note, target?, icon?, fields?: [{name,value,inline}] }
// Throw an Error to render a red failure embed. All actions are real.
import { EmbedBuilder, ChannelType } from 'discord.js';
import { E } from '../lib/emoji.js';
import {
    db, addInfraction, deleteInfraction, addGlobalBan, getActiveGlobalBan, addSuspension, liftSuspension,
    getActiveSuspension, startInvestigation, endInvestigation, getActiveInvestigation, getInfractions,
} from '../utils/botDb.js';
import { getUserByDiscordId } from '../db.js';
import {
    getEffectiveAllServerIds, getEffectiveStaffHqId, APPEALS_SERVER_ID,
    SUSPENDED_ROLE_ID, UNDER_INVESTIGATION_ROLE_ID,
} from '../config.js';
import { buildHome, buildCategory } from './helpUi.js';

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

    // ── Moderation (single-server + records) ──────────────────────
    serverban: { group: 'Moderation', usage: '.serverban <@user|id> <reason>', desc: 'Ban a member from THIS server only (not network-wide).',
        async run({ args, rest, message, authorId, authorName }) {
            const id = resolveId(args[0]); const reason = rest.replace(args[0], '').trim();
            if (!id || !reason) throw new Error('Usage: `.serverban <@user> <reason>`');
            await message.guild.bans.create(id, { reason }).catch((e) => { throw new Error('Could not ban: ' + (e.message || 'unknown')); });
            addInfraction(id, 'ban', reason, authorId, authorName, null, 1);
            return { title: 'Member banned (this server)', target: id, icon: E.ban,
                note: `<@${id}> has been banned from **${message.guild.name}**.`,
                fields: [{ name: 'Reason', value: reason, inline: false }] };
        } },
    note: { group: 'Moderation', usage: '.note <@user|id> <text>', desc: "Add a private note to a member's record.",
        async run({ args, rest, authorId, authorName }) {
            const id = resolveId(args[0]); const text = rest.replace(args[0], '').trim();
            if (!id || !text) throw new Error('Usage: `.note <@user> <text>`');
            const inf = addInfraction(id, 'note', text, authorId, authorName, null, 0);
            return { title: 'Note added', target: id, icon: E.logs,
                note: `Added a note to <@${id}>'s record.`,
                fields: [{ name: 'Case', value: `#${inf?.lastInsertRowid ?? '—'}`, inline: true }, { name: 'Note', value: text.slice(0, 1024), inline: false }] };
        } },
    delcase: { group: 'Moderation', usage: '.delcase <case_id>', desc: 'Delete an infraction/case by its ID.',
        async run({ args, authorId }) {
            const cid = parseInt(args[0], 10); if (!Number.isFinite(cid)) throw new Error('Usage: `.delcase <case_id>`');
            const removed = deleteInfraction(cid, authorId);
            if (!removed) throw new Error(`No case #${cid}.`);
            return { title: 'Case deleted', target: removed.discord_id, icon: E.gavel,
                note: `Deleted case **#${cid}** (${(removed.type || 'note').replace(/_/g, ' ')}) from <@${removed.discord_id}>'s record.`,
                fields: [{ name: 'Original reason', value: (removed.reason || '—').slice(0, 1024), inline: false }] };
        } },

    // ── Moderation (Discord timeout) ──────────────────────────────
    timeout: { group: 'Moderation', usage: '.timeout <@user|id> <minutes> [reason]', desc: 'Time a member out (Discord mute) for N minutes.',
        async run({ args, rest, message, authorId, authorName }) {
            const id = resolveId(args[0]); const mins = parseInt(args[1], 10);
            if (!id || !Number.isFinite(mins) || mins <= 0) throw new Error('Usage: `.timeout <@user> <minutes> [reason]`');
            if (mins > 40320) throw new Error('Max timeout is 28 days (40320 minutes).');
            const reason = rest.replace(args[0], '').replace(args[1], '').trim() || 'Timed out by administrator';
            const m = await message.guild.members.fetch(id).catch(() => null); if (!m) throw new Error('Member not in this server.');
            await m.timeout(mins * 60000, reason);
            addInfraction(id, 'timeout', reason, authorId, authorName, null, 1);
            return { title: 'Member timed out', target: id, icon: E.suspend,
                note: `<@${id}> has been timed out for **${mins}** minute${mins === 1 ? '' : 's'}.`,
                fields: [{ name: 'Duration', value: `${E.pending} ${mins} min`, inline: true }, { name: 'Reason', value: reason, inline: false }] };
        } },
    untimeout: { group: 'Moderation', usage: '.untimeout <@user|id>', desc: "Remove a member's timeout.",
        async run({ args, message }) {
            const id = resolveId(args[0]); if (!id) throw new Error('Usage: `.untimeout <@user>`');
            const m = await message.guild.members.fetch(id).catch(() => null); if (!m) throw new Error('Member not in this server.');
            await m.timeout(null);
            return { title: 'Timeout removed', target: id, icon: E.check,
                note: `<@${id}>'s timeout has been lifted.`,
                fields: [{ name: 'Status', value: `${E.check} Cleared`, inline: true }] };
        } },

    // ── Channels ──────────────────────────────────────────────────
    lock: { group: 'Channels', usage: '.lock', desc: 'Lock this channel (members can no longer send).',
        async run({ message }) {
            await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false }, { reason: 'Locked by admin' });
            return { title: 'Channel locked', icon: E.shield, note: `<#${message.channel.id}> is now locked — members can't send messages.` };
        } },
    unlock: { group: 'Channels', usage: '.unlock', desc: 'Unlock this channel.',
        async run({ message }) {
            await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null }, { reason: 'Unlocked by admin' });
            return { title: 'Channel unlocked', icon: E.check, note: `<#${message.channel.id}> is unlocked — members can send messages again.` };
        } },
    slowmode: { group: 'Channels', usage: '.slowmode <seconds>', desc: 'Set channel slowmode (0 clears, max 21600).',
        async run({ args, message }) {
            if (args[0] == null || Number.isNaN(parseInt(args[0], 10))) throw new Error('Usage: `.slowmode <seconds>`');
            const s = Math.min(Math.max(parseInt(args[0], 10), 0), 21600);
            await message.channel.setRateLimitPerUser(s, 'Admin slowmode');
            return { title: s ? 'Slowmode set' : 'Slowmode cleared', icon: E.pending,
                note: s ? `Slowmode in <#${message.channel.id}> set to **${s}s**.` : `Slowmode cleared in <#${message.channel.id}>.`,
                fields: [{ name: 'Delay', value: `${s}s`, inline: true }] };
        } },
    invite: { group: 'Channels', usage: '.invite [uses] [hours]', desc: 'Create an invite link to this channel.',
        async run({ args, message }) {
            const uses = Math.max(parseInt(args[0], 10) || 0, 0); const hours = Math.max(parseInt(args[1], 10) || 0, 0);
            const inv = await message.channel.createInvite({ maxUses: uses, maxAge: hours * 3600, unique: true }).catch((e) => { throw new Error('Could not create invite: ' + (e.message || 'unknown')); });
            return { title: 'Invite created', icon: E.link,
                note: `Created an invite to <#${message.channel.id}>.`,
                fields: [
                    { name: 'Link', value: inv.url, inline: false },
                    { name: 'Max uses', value: uses ? String(uses) : 'Unlimited', inline: true },
                    { name: 'Expires', value: hours ? `${hours}h` : 'Never', inline: true },
                ] };
        } },
    move: { group: 'Channels', usage: '.move <@user|id> <#voice|id>', desc: 'Move a member to a voice channel.',
        async run({ args, message }) {
            const id = resolveId(args[0]); const chId = resolveId(args[1]);
            if (!id || !chId) throw new Error('Usage: `.move <@user> <#voice-channel>`');
            const m = await message.guild.members.fetch(id).catch(() => null); if (!m) throw new Error('Member not in this server.');
            if (!m.voice?.channelId) throw new Error('That member is not in a voice channel.');
            const ch = await message.guild.channels.fetch(chId).catch(() => null);
            if (!ch || !ch.isVoiceBased?.()) throw new Error('Target is not a voice channel.');
            await m.voice.setChannel(ch.id, 'Moved by admin');
            return { title: 'Member moved', target: id, icon: E.member,
                note: `Moved <@${id}> to **${ch.name}**.`,
                fields: [{ name: 'Voice channel', value: ch.name, inline: true }] };
        } },
    pin: { group: 'Channels', usage: '.pin <message_id>', desc: 'Pin a message in this channel.',
        async run({ args, message }) {
            const mid = resolveId(args[0]); if (!mid) throw new Error('Usage: `.pin <message_id>`');
            const m = await message.channel.messages.fetch(mid).catch(() => null); if (!m) throw new Error('No message with that ID here.');
            await m.pin('Pinned by admin');
            return { title: 'Message pinned', icon: E.check, note: `Pinned a message in <#${message.channel.id}>.` };
        } },
    unpin: { group: 'Channels', usage: '.unpin <message_id>', desc: 'Unpin a message in this channel.',
        async run({ args, message }) {
            const mid = resolveId(args[0]); if (!mid) throw new Error('Usage: `.unpin <message_id>`');
            const m = await message.channel.messages.fetch(mid).catch(() => null); if (!m) throw new Error('No message with that ID here.');
            await m.unpin('Unpinned by admin');
            return { title: 'Message unpinned', icon: E.check, note: `Unpinned a message in <#${message.channel.id}>.` };
        } },
    delmsg: { group: 'Channels', usage: '.delmsg <message_id>', desc: 'Delete a single message by ID.',
        async run({ args, message }) {
            const mid = resolveId(args[0]); if (!mid) throw new Error('Usage: `.delmsg <message_id>`');
            const m = await message.channel.messages.fetch(mid).catch(() => null); if (!m) throw new Error('No message with that ID here.');
            await m.delete();
            return { title: 'Message deleted', icon: E.cross, note: `Deleted a message in <#${message.channel.id}>.` };
        } },
    thread: { group: 'Channels', usage: '.thread <name>', desc: 'Open a thread in this channel.',
        async run({ rest, message }) {
            const name = rest.trim(); if (!name) throw new Error('Usage: `.thread <name>`');
            const th = await message.channel.threads.create({ name: name.slice(0, 100), autoArchiveDuration: 1440 }).catch((e) => { throw new Error('Could not create thread: ' + (e.message || 'unknown')); });
            return { title: 'Thread created', icon: E.ticket,
                note: `Opened thread **${name.slice(0, 100)}** in <#${message.channel.id}>.`,
                fields: [{ name: 'Thread', value: `<#${th.id}>`, inline: true }] };
        } },

    // ── Staff / HR ────────────────────────────────────────────────
    staffwarn: { group: 'Staff', usage: '.staffwarn <@user|id> <reason>', desc: "Issue a verbal warning on a staff member's HR record.",
        async run({ args, rest, authorId }) {
            const id = resolveId(args[0]); const reason = rest.replace(args[0], '').trim();
            if (!id || !reason) throw new Error('Usage: `.staffwarn <@user> <reason>`');
            const target = getUserByDiscordId(id); if (!target) throw new Error('That user has no staff record.');
            const sup = getUserByDiscordId(authorId);
            const PORTAL = process.env.PORTAL_HTTP || 'http://localhost:3016';
            const r = await fetch(`${PORTAL}/api/disciplinary/non-investigational`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bot-Secret': process.env.BOT_SECRET || 'co-bot-internal' },
                body: JSON.stringify({ user_id: Number(target.id), action_type: 'verbal_warning', violation_description: reason, _bot_supervisor_id: sup?.id }),
            }).catch((e) => { throw new Error('Could not reach the staff portal: ' + (e.message || 'unknown')); });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j.error || `Portal returned ${r.status}.`);
            return { title: 'Staff warning issued', target: id, icon: E.warning,
                note: `Logged a verbal warning on **${target.display_name || target.full_name || 'the staff member'}**'s HR record.`,
                fields: [{ name: 'Reason', value: reason.slice(0, 1024), inline: false }] };
        } },
    staff: { group: 'Lookup', usage: '.staff <@user|id>', desc: "Look up a staff member's HR record.",
        async run({ args }) {
            const id = resolveId(args[0]); if (!id) throw new Error('Usage: `.staff <@user>`');
            const u = getUserByDiscordId(id); if (!u) throw new Error('That user has no staff record.');
            return { title: u.display_name || u.full_name || 'Staff member', target: id, icon: E.staff,
                note: `Staff HR record for <@${id}>.`,
                fields: [
                    { name: 'Name', value: `${E.member} ${u.full_name || u.display_name || '—'}`, inline: true },
                    { name: 'Position', value: u.position || '—', inline: true },
                    { name: 'Department', value: u.department || '—', inline: true },
                    { name: 'Status', value: u.account_status || '—', inline: true },
                ] };
        } },

    // ── Server (heavy ops — destructive ones need CONFIRM) ────────
    channel: { group: 'Server', usage: '.channel <create|rename|delete> …', desc: 'Create, rename, or delete a channel (delete needs CONFIRM).',
        async run({ args, rest, message }) {
            const op = String(args[0] || '').toLowerCase();
            if (op === 'create') {
                const name = rest.replace(args[0], '').trim(); if (!name) throw new Error('Usage: `.channel create <name>`');
                const ch = await message.guild.channels.create({ name: name.slice(0, 100), type: ChannelType.GuildText, parent: message.channel?.parentId || null });
                return { title: 'Channel created', icon: E.server, note: `Created <#${ch.id}>.`, fields: [{ name: 'Channel', value: `<#${ch.id}>`, inline: true }] };
            }
            if (op === 'rename') {
                const chId = resolveId(args[1]); const name = rest.replace(args[0], '').replace(args[1], '').trim();
                if (!chId || !name) throw new Error('Usage: `.channel rename <#channel> <new name>`');
                const ch = await message.guild.channels.fetch(chId).catch(() => null); if (!ch) throw new Error('No such channel.');
                const old = ch.name; await ch.setName(name.slice(0, 100), 'Admin rename');
                return { title: 'Channel renamed', icon: E.server, note: `Renamed **#${old}** → <#${ch.id}>.`, fields: [{ name: 'New name', value: `**${name.slice(0, 100)}**`, inline: true }] };
            }
            if (op === 'delete') {
                const chId = resolveId(args[1]); if (!chId) throw new Error('Usage: `.channel delete <#channel> CONFIRM`');
                if (!args.includes('CONFIRM')) throw new Error('This permanently deletes the channel. Re-run with `CONFIRM` at the end: `.channel delete <#channel> CONFIRM`');
                const ch = await message.guild.channels.fetch(chId).catch(() => null); if (!ch) throw new Error('No such channel.');
                const nm = ch.name; await ch.delete('Admin delete');
                return { title: 'Channel deleted', icon: E.cross, note: `Deleted **#${nm}**.` };
            }
            throw new Error('Usage: `.channel <create|rename|delete> …`');
        } },
    emoji: { group: 'Server', usage: '.emoji <add|delete> …', desc: 'Add a server emoji (name + image URL) or delete one by name.',
        async run({ args, message }) {
            const op = String(args[0] || '').toLowerCase();
            if (op === 'add') {
                const name = args[1], url = args[2];
                if (!name || !url) throw new Error('Usage: `.emoji add <name> <image_url>`');
                const em = await message.guild.emojis.create({ attachment: url, name: name.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32) }).catch((e) => { throw new Error('Could not add emoji: ' + (e.message || 'unknown')); });
                return { title: 'Emoji added', icon: E.star, note: `Added emoji **:${em.name}:** ${em}.`, fields: [{ name: 'Name', value: `\`:${em.name}:\``, inline: true }] };
            }
            if (op === 'delete') {
                const name = String(args[1] || '').replace(/:/g, ''); if (!name) throw new Error('Usage: `.emoji delete <name>`');
                const em = message.guild.emojis.cache.find((x) => x.name === name); if (!em) throw new Error(`No emoji named :${name}: here.`);
                await em.delete('Admin delete');
                return { title: 'Emoji deleted', icon: E.cross, note: `Deleted emoji **:${name}:**.` };
            }
            throw new Error('Usage: `.emoji <add|delete> …`');
        } },
    lockdown: { group: 'Server', usage: '.lockdown <on|off>', desc: 'Lock or unlock every text channel in this server (on needs CONFIRM).',
        async run({ args, message }) {
            const op = String(args[0] || '').toLowerCase();
            if (!['on', 'off'].includes(op)) throw new Error('Usage: `.lockdown <on|off>`');
            if (op === 'on' && !args.includes('CONFIRM')) throw new Error('This locks EVERY channel in the server. Re-run with `CONFIRM`: `.lockdown on CONFIRM`');
            const everyone = message.guild.roles.everyone;
            const chans = message.guild.channels.cache.filter((c) => c.isTextBased?.() && c.permissionOverwrites);
            let n = 0;
            for (const [, c] of chans) { try { await c.permissionOverwrites.edit(everyone, { SendMessages: op === 'on' ? false : null }, { reason: 'Lockdown ' + op }); n++; } catch { /* hierarchy */ } }
            return { title: op === 'on' ? 'Server locked down' : 'Lockdown lifted', icon: op === 'on' ? E.shield : E.check,
                note: op === 'on' ? `Locked **${n}** channels — only staff can send.` : `Unlocked **${n}** channels.`,
                fields: [{ name: 'Channels', value: `**${n}**`, inline: true }] };
        } },
    massunban: { group: 'Server', usage: '.massunban CONFIRM', desc: 'Lift EVERY Discord ban in this server.',
        async run({ args, message }) {
            if (!args.includes('CONFIRM')) throw new Error('This unbans EVERYONE in this server. Re-run with `CONFIRM`: `.massunban CONFIRM`');
            const bans = await message.guild.bans.fetch().catch(() => null); if (!bans) throw new Error('Could not fetch the ban list.');
            let n = 0; for (const [id] of bans) { try { await message.guild.bans.remove(id, 'Mass unban'); n++; } catch { /* */ } }
            return { title: 'Mass unban complete', icon: E.unban, note: `Lifted **${n}** ban${n === 1 ? '' : 's'} in **${message.guild.name}**.`, fields: [{ name: 'Unbanned', value: `**${n}**`, inline: true }] };
        } },

    // ── Help ──────────────────────────────────────────────────────
    // Renders the paginated help UI (helpUi.js): `.help` → category-button
    // landing page; `.help <group>` → jump straight to that group's page.
    // Returns { raw } so the prefix renderer attaches the buttons verbatim.
    help: { group: 'Help', usage: '.help [group]', desc: 'Browse admin commands by category (button menu).',
        async run({ args }) {
            const filter = String(args[0] || '').trim();
            return { raw: filter ? buildCategory(filter) : buildHome() };
        } },
};
