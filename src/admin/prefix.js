// Old-style Community Organisation prefix admin commands (e.g. `.gban @user x`)
// for Dion + Evan ONLY. Unauthorised attempts on a known admin command are
// logged, the founders are alerted, and the attempter is DM'd. A valid command
// shows the animated processing emote while it runs, then edits to the result.
import { Events, EmbedBuilder } from 'discord.js';
import { COMMANDS } from './registry.js';
import { E } from '../lib/emoji.js';
import { SUPERUSER_IDS, MOD_LOG_CHANNEL_ID } from '../config.js';
import { BRAND } from '../utils/brand.js';

const PREFIX = '.';
const SUPERUSERS = new Set(SUPERUSER_IDS);
const NO_PING = { parse: [] };
const ALIASES = { commands: 'help', cmds: 'help', '?': 'help' };

// Per-group accent colour + fallback headline icon.
const THEME = {
    Moderation: { color: 0xDC2626, icon: E.gavel },
    Staff:      { color: 0x0D9488, icon: E.staff },
    Comms:      { color: 0x5865F2, icon: E.dm },
    Roles:      { color: 0x5865F2, icon: E.role },
    Channels:   { color: 0x0EA5E9, icon: E.server },
    Server:     { color: 0x6366F1, icon: E.server },
    Lookup:     { color: 0x4F46E5, icon: E.id },
    Help:       { color: 0x64748B, icon: E.seal },
};

async function dm(client, userId, payload) {
    try { const u = await client.users.fetch(userId); await u.send(payload); } catch { /* DMs closed */ }
}

async function handleUnauthorized(client, message, name) {
    const who = message.author;
    await dm(client, who.id, {
        embeds: [new EmbedBuilder().setColor(0xef4444).setTitle('Not authorised')
            .setDescription(`${E.cross} Admin commands are restricted to ${BRAND.name} directors.\n\nYou can only use **slash commands** — type \`/\` to see what's available.`)
            .setFooter({ text: `${BRAND.name} · this attempt has been logged` })],
    });
    const alert = new EmbedBuilder().setColor(0xf59e0b).setTitle('Unauthorised admin attempt')
        .setDescription(`${who} (\`${who.id}\`) tried to run \`.${name}\`.`)
        .addFields(
            { name: 'Where', value: message.guild ? `${message.guild.name} · <#${message.channel.id}>` : 'Direct message', inline: false },
            { name: 'Message', value: '`' + String(message.content).slice(0, 200) + '`', inline: false },
        ).setTimestamp();
    for (const id of SUPERUSERS) dm(client, id, { embeds: [alert] });
    const logCh = MOD_LOG_CHANNEL_ID ? await client.channels.fetch(MOD_LOG_CHANNEL_ID).catch(() => null) : null;
    if (logCh?.isTextBased?.()) logCh.send({ embeds: [alert] }).catch(() => {});
    console.warn('[co-admin] unauthorised attempt', who.id, name);
}

export function setupAdminPrefix(client) {
    client.on(Events.MessageCreate, async (message) => {
        try {
            if (message.author.bot || !message.content?.startsWith(PREFIX)) return;
            const body = message.content.slice(PREFIX.length).trim();
            if (!body) return;
            const parts = body.split(/\s+/);
            const name = ALIASES[parts[0].toLowerCase()] || parts[0].toLowerCase();
            const cmd = COMMANDS[name];
            if (!cmd) return; // not a known admin command — ignore quietly

            if (!SUPERUSERS.has(message.author.id)) { await handleUnauthorized(client, message, name); return; }

            const args = parts.slice(1);
            const rest = body.slice(parts[0].length).trim();
            const running = await message.reply({ content: `${E.processing} Running \`.${name}\`…`, allowedMentions: NO_PING });

            let result, ok = true;
            try { result = await cmd.run({ args, rest, message, client, authorId: message.author.id, authorName: message.author.username }); }
            catch (e) { ok = false; result = e.message || 'Command failed.'; }

            // Commands can return { raw: <message payload> } to render their
            // own embeds + components verbatim (e.g. .help's category button
            // menu). The standard title/note/fields path is bypassed.
            if (ok && result && typeof result === 'object' && result.raw) {
                await running.edit({ content: '', embeds: result.raw.embeds || [], components: result.raw.components || [], allowedMentions: NO_PING }).catch(() => {});
                return;
            }

            const embed = new EmbedBuilder().setTimestamp();
            if (!ok) {
                embed.setColor(0xEF4444).setAuthor({ name: BRAND.name }).setTitle(`Couldn't run .${name}`)
                    .setDescription(`${E.cross} ${result}`.slice(0, 4000)).setFooter({ text: `.${name} · attempted by ${message.author.username}` });
            } else {
                const r = (typeof result === 'string') ? { note: result } : (result || {});
                const theme = THEME[cmd.group] || { color: 0x5865F2, icon: E.check };
                const icon = r.icon || theme.icon || E.check;
                embed.setColor(r.color ?? theme.color).setAuthor({ name: BRAND.name }).setTitle(r.title || `.${name}`)
                    .setDescription(`${icon} ${r.note || 'Done.'}`.slice(0, 4000)).setFooter({ text: `.${name} · run by ${message.author.username}` });
                if (Array.isArray(r.fields) && r.fields.length) embed.addFields(r.fields.slice(0, 25));
                if (r.target) { const u = await client.users.fetch(r.target).catch(() => null); if (u) embed.setThumbnail(u.displayAvatarURL({ size: 128 })); }
            }
            await running.edit({ content: '', embeds: [embed], allowedMentions: NO_PING }).catch(() => {});
        } catch (err) { console.error('[co-adminPrefix]', err?.message); }
    });
    console.log(JSON.stringify({ msg: 'CO admin prefix commands ready', count: Object.keys(COMMANDS).length }));
}
