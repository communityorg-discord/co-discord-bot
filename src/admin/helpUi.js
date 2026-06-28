// Paginated CO admin-help UI. `.help` shows a compact landing page with one
// button per command category; clicking a category shows just that group's
// commands, with a "← All categories" button to go back. Replaces the old
// single mega-embed that listed every CO admin command at once.
//
// Mirrors aspire-bot/src/admin/helpUi.js. Button interactions are gated to
// the same superusers as the prefix commands themselves.
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { COMMANDS } from './registry.js';
import { E } from '../lib/emoji.js';
import { SUPERUSER_IDS } from '../config.js';
import { BRAND } from '../utils/brand.js';

const SUPERUSERS = new Set(SUPERUSER_IDS);

// Display order + a headline icon per group (mirrors prefix.js THEME).
const ORDER = ['Moderation', 'Staff', 'Comms', 'Roles', 'Channels', 'Server', 'Lookup'];
const ICON = {
    Moderation: E.gavel, Staff: E.staff, Comms: E.dm, Roles: E.role,
    Channels: E.server, Server: E.server, Lookup: E.id,
};
const ACCENT = 0x5865F2;

const emoji = (t) => { const m = /<a?:(\w+):(\d+)>/.exec(t || ''); return m ? { id: m[2], name: m[1] } : null; };

function groupedCommands() {
    const groups = {};
    for (const [name, c] of Object.entries(COMMANDS)) {
        if (name === 'help') continue;
        (groups[c.group] = groups[c.group] || []).push({ name, ...c });
    }
    const ordered = [...ORDER.filter((g) => groups[g]), ...Object.keys(groups).filter((g) => !ORDER.includes(g))];
    return { groups, ordered };
}

// Category buttons, 5 per row, max 5 rows. customId carries the group name.
function categoryRows(ordered, groups) {
    const rows = [];
    for (let i = 0; i < ordered.length; i += 5) {
        const row = new ActionRowBuilder();
        for (const g of ordered.slice(i, i + 5)) {
            const b = new ButtonBuilder()
                .setCustomId(`cohelp:cat:${g}`)
                .setLabel(`${g} (${groups[g].length})`)
                .setStyle(ButtonStyle.Secondary);
            const e = emoji(ICON[g]);
            if (e) b.setEmoji(e);
            row.addComponents(b);
        }
        rows.push(row);
    }
    return rows;
}

export function buildHome() {
    const { groups, ordered } = groupedCommands();
    const total = Object.values(groups).reduce((n, a) => n + a.length, 0);
    const e = new EmbedBuilder()
        .setColor(ACCENT)
        .setAuthor({ name: BRAND.name })
        .setTitle('Admin Command Reference')
        .setDescription(
            `${E.seal} **${total}** admin commands across **${ordered.length}** categories. ` +
            `Pick a category below to see its commands.\n\n` +
            `Every command is prefixed with \`.\` — e.g. \`.gban @user reason\`. ` +
            `You can also jump straight to a group with \`.help <group>\`.`)
        .setFooter({ text: 'Admin only · Dion + Evan' });
    return { embeds: [e], components: categoryRows(ordered, groups) };
}

export function buildCategory(group) {
    const { groups } = groupedCommands();
    const key = Object.keys(groups).find((g) => g.toLowerCase() === String(group).toLowerCase());
    if (!key) return buildHome();
    const cmds = groups[key];
    const e = new EmbedBuilder()
        .setColor(ACCENT)
        .setAuthor({ name: BRAND.name })
        .setTitle(`${key} — ${cmds.length} command${cmds.length === 1 ? '' : 's'}`)
        .setDescription(cmds.map((c) => `\`${c.usage}\`\n${c.desc}`).join('\n\n').slice(0, 4000))
        .setFooter({ text: 'Admin only · Dion + Evan' });
    const back = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cohelp:home').setLabel('All categories').setEmoji(E.arrow_left).setStyle(ButtonStyle.Primary),
    );
    return { embeds: [e], components: [back] };
}

// Button dispatch — returns true if it handled the interaction.
export async function handleButton(interaction) {
    const id = interaction.customId || '';
    if (!id.startsWith('cohelp:')) return false;
    if (!SUPERUSERS.has(interaction.user.id)) {
        await interaction.reply({ content: 'Admin command reference is restricted to Dion + Evan.', ephemeral: true }).catch(() => {});
        return true;
    }
    if (id === 'cohelp:home') {
        await interaction.update(buildHome()).catch(() => {});
        return true;
    }
    if (id.startsWith('cohelp:cat:')) {
        await interaction.update(buildCategory(id.slice('cohelp:cat:'.length))).catch(() => {});
        return true;
    }
    return false;
}
