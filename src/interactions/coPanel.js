// CO Utilities — the /panel hub. Mirrors the gov-bot UX: one command opens an
// (ephemeral) panel with a "Go to…" dropdown; each section lists its commands as
// buttons; clicking a button RUNS that command. The less-used commands are
// deregistered from the slash-command picker and reached only through here, so
// the picker stays lean (moderation + network stay as direct commands).
//
// The launcher is generic: it reads each command's own option schema
// (cmd.data.toJSON().options) and either runs it directly (no args), pops a modal
// (value args), or shows a subcommand picker — then calls the command's existing
// execute() through a proxy interaction. No per-command rewrites.
import {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { BRAND } from '../utils/brand.js';
import { IS_USGRP, CO_ONLY_COMMANDS } from '../config.js';

const COLOR = 0x5865F2;

// section key -> { label, emoji, blurb, commands: [names] }
const SECTIONS = [
  ['tickets',  { label: 'Tickets',        emoji: '🎫', blurb: 'Ticket panels & options.',
    commands: ['ticket-panel-send', 'ticket-panel-delete', 'ticket-options'] }],
  ['logs',     { label: 'Logs & Config',  emoji: '📋', blurb: 'Log routing, audit log, AutoMod, server health.',
    commands: ['logs', 'logspanel', 'orglogs', 'privatelogs', 'audit-log', 'automod', 'server-health', 'bot-perms', 'counting'] }],
  ['utilities',{ label: 'Utilities',      emoji: '🔧', blurb: 'Polls, embeds, reminders, snippets and more.',
    commands: ['poll', 'embed', 'snippet', 'remind', 'reminders', 'todo', 'random-pick', 'timezone', 'break', 'feedback', 'idea', 'schedule-dm'] }],
  ['info',     { label: 'Info & Lookups', emoji: 'ℹ️', blurb: 'Bot, server, user, channel and role info.',
    commands: ['bot', 'info', 'ping', 'user', 'serverinfo', 'channel-info', 'role-info', 'who-is-here'] }],
  ['system',   { label: 'Voice & System', emoji: '🎙️', blurb: 'Voice recording/office and emergency controls.',
    commands: ['record', 'office', 'emergency', 'panic-bot'] }],
];
// Under USGRP, drop CO-only commands from each section and remove any section
// that ends up empty — so the panel only ever offers the USGRP surface.
const HIDDEN = new Set(IS_USGRP ? CO_ONLY_COMMANDS : []);
for (const [, sec] of SECTIONS) sec.commands = sec.commands.filter(c => !HIDDEN.has(c));
const VISIBLE_SECTIONS = SECTIONS.filter(([, sec]) => sec.commands.length > 0);
SECTIONS.length = 0; SECTIONS.push(...VISIBLE_SECTIONS);
const SECTION_MAP = new Map(SECTIONS);

// Nicer button labels than the raw command name where it helps.
const LABELS = {
  'bot': 'Bot Info', 'info': 'About', 'who-is-here': "Who's in Voice", 'audit-log': 'Audit Log',
  'server-health': 'Server Health', 'bot-perms': 'Bot Permissions', 'random-pick': 'Random Pick',
  'ticket-panel-send': 'Send Ticket Panel', 'ticket-panel-delete': 'Delete Ticket Panel',
  'ticket-options': 'Ticket Options', 'logspanel': 'Log Channels', 'orglogs': 'Org-wide Logs',
  'privatelogs': 'Private Logs', 'schedule-dm': 'Schedule DM', 'channel-info': 'Channel Info',
  'role-info': 'Role Info', 'panic-bot': 'Panic (stop bot)',
};
const title = (n) => LABELS[n] || n.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

let REGISTRY = new Map(); // name -> command module (.data, .execute)
export function initPanel(registry) { REGISTRY = registry; }

// ── Views ───────────────────────────────────────────────────────────────────
function navRow(active) {
  const menu = new StringSelectMenuBuilder().setCustomId('copanel:nav').setPlaceholder('Go to…')
    .addOptions(SECTIONS.map(([key, s]) => ({ label: s.label, value: key, emoji: s.emoji, default: key === active })));
  return new ActionRowBuilder().addComponents(menu);
}

export function buildHome() {
  const e = new EmbedBuilder().setColor(COLOR).setTitle(`${BRAND.name} Utilities`)
    .setDescription('Pick a section from the **Go to…** menu below, then click a command to run it.\n\n' +
      SECTIONS.map(([, s]) => `${s.emoji} **${s.label}** — ${s.blurb}`).join('\n'))
    .setFooter({ text: 'Moderation & network commands stay as direct / commands.' });
  return { embeds: [e], components: [navRow(null)], ephemeral: true };
}

function sectionView(key) {
  const s = SECTION_MAP.get(key);
  if (!s) return buildHome();
  const e = new EmbedBuilder().setColor(COLOR).setTitle(`${s.emoji} ${s.label}`).setDescription(s.blurb);
  const rows = [navRow(key)];
  let row = new ActionRowBuilder();
  for (const name of s.commands) {
    if (!REGISTRY.has(name)) continue;
    if (row.components.length === 5) { rows.push(row); row = new ActionRowBuilder(); }
    row.components.push(new ButtonBuilder().setCustomId(`copanel:run:${name}`).setLabel(title(name).slice(0, 80)).setStyle(ButtonStyle.Secondary));
  }
  if (row.components.length) rows.push(row);
  // Explicit Back to the overview (the "Go to…" dropdown stays for jumping around).
  if (rows.length < 5) rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('copanel:home').setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji(E.arrow_left)));
  return { embeds: [e], components: rows.slice(0, 5) };
}

// ── Proxy: make a button/select/modal interaction look like a slash command ──
function makeOptions(values) {
  const has = (n) => Object.prototype.hasOwnProperty.call(values, n);
  const raw = (n) => (has(n) ? values[n] : null);
  return {
    getString: (n) => { const v = raw(n); return v == null || v === '' ? null : String(v); },
    getInteger: (n) => { const v = raw(n); return v == null || v === '' ? null : parseInt(v, 10); },
    getNumber: (n) => { const v = raw(n); return v == null || v === '' ? null : Number(v); },
    getBoolean: (n) => { const v = raw(n); if (v == null || v === '') return null; return v === true || /^(y|yes|true|on|1)$/i.test(String(v)); },
    getUser: (n) => values[`${n}__user`] || null,
    getMember: (n) => values[`${n}__member`] || null,
    getChannel: (n) => values[`${n}__channel`] || null,
    getRole: (n) => values[`${n}__role`] || null,
    getMentionable: (n) => values[`${n}__role`] || values[`${n}__user`] || null,
    getAttachment: () => null,
    getSubcommand: (req = true) => { if (values.__sub) return values.__sub; if (req) throw new Error('No subcommand supplied'); return null; },
    getSubcommandGroup: () => values.__group || null,
    getFocused: () => '',
    get data() { return []; },
  };
}
function asSlash(real, name, values) {
  const opts = makeOptions(values);
  return new Proxy(real, {
    get(t, p) {
      if (p === 'options') return opts;
      if (p === 'commandName') return name;
      if (p === 'isChatInputCommand') return () => true;
      if (p === 'isButton' || p === 'isStringSelectMenu' || p === 'isAnySelectMenu' || p === 'isModalSubmit' || p === 'isContextMenuCommand') return () => false;
      const v = Reflect.get(t, p, t);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}

// ── Launch helpers ───────────────────────────────────────────────────────────
const valueOptionsOf = (opts) => (opts || []).filter(o => o.type >= 3); // 3+ are value args; 1/2 are sub/group
const subcommandsOf = (opts) => (opts || []).filter(o => o.type === 1);

async function resolveValues(opts, fields, interaction) {
  const values = {};
  for (const o of opts) {
    const txt = (fields[o.name] || '').trim();
    if (!txt) continue;
    values[o.name] = txt;
    if (o.type === 6) { // USER
      const id = (txt.match(/\d{17,20}/) || [])[0];
      if (id) {
        const member = await interaction.guild?.members.fetch(id).catch(() => null);
        values[`${o.name}__member`] = member || null;
        values[`${o.name}__user`] = member?.user || await interaction.client.users.fetch(id).catch(() => null);
      }
    } else if (o.type === 7) { // CHANNEL
      const id = (txt.match(/\d{17,20}/) || [])[0];
      values[`${o.name}__channel`] = (id && interaction.guild?.channels.cache.get(id)) ||
        interaction.guild?.channels.cache.find(c => c.name.toLowerCase() === txt.replace(/^#/, '').toLowerCase()) || null;
    } else if (o.type === 8) { // ROLE
      const id = (txt.match(/\d{17,20}/) || [])[0];
      values[`${o.name}__role`] = (id && interaction.guild?.roles.cache.get(id)) ||
        interaction.guild?.roles.cache.find(r => r.name.toLowerCase() === txt.replace(/^@/, '').toLowerCase()) || null;
    }
  }
  return values;
}

function buildModal(name, sub, opts) {
  const modal = new ModalBuilder().setCustomId(`copanel:m:${name}:${sub || ''}`).setTitle(`Run /${name}${sub ? ' ' + sub : ''}`.slice(0, 45));
  const ENTITY = { 6: ' (name, @mention or ID)', 7: ' (name, #mention or ID)', 8: ' (name, @mention or ID)', 5: ' (yes / no)' };
  for (const o of opts.slice(0, 5)) {
    const long = /reason|message|content|description|body|note|text|details/i.test(o.name);
    const input = new TextInputBuilder().setCustomId(o.name)
      .setLabel(title(o.name).slice(0, 45))
      .setStyle(long ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(!!o.required)
      .setPlaceholder(`${o.description || ''}${ENTITY[o.type] || ''}`.slice(0, 100));
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }
  return modal;
}

async function runCommand(interaction, name, values) {
  const cmd = REGISTRY.get(name);
  if (!cmd?.execute) return interaction.reply({ content: `⚠️ \`${name}\` isn't available.`, ephemeral: true }).catch(() => {});
  try {
    await cmd.execute(asSlash(interaction, name, values));
  } catch (e) {
    console.error(`[coPanel] run ${name} failed:`, e?.message);
    const msg = `⚠️ Couldn't run **/${name}**: ${e?.message || 'error'}`;
    if (interaction.replied || interaction.deferred) await interaction.followUp({ content: msg, ephemeral: true }).catch(() => {});
    else await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
  }
}

// ── Routers (return true if handled) ─────────────────────────────────────────
export async function handleSelect(interaction) {
  const id = interaction.customId || '';
  if (!id.startsWith('copanel:')) return false;
  if (id === 'copanel:nav') {
    await interaction.update(sectionView(interaction.values[0]));
    return true;
  }
  if (id.startsWith('copanel:sub:')) {
    const name = id.slice('copanel:sub:'.length);
    const sub = interaction.values[0];
    const cmd = REGISTRY.get(name);
    const subDef = subcommandsOf(cmd?.data?.toJSON?.().options).find(s => s.name === sub);
    const vopts = valueOptionsOf(subDef?.options);
    if (vopts.length) return interaction.showModal(buildModal(name, sub, vopts)).then(() => true);
    await runCommand(interaction, name, { __sub: sub });
    return true;
  }
  return false;
}

export async function handleButton(interaction) {
  const id = interaction.customId || '';
  if (id === 'copanel:home') { await interaction.update(buildHome()); return true; }
  if (!id.startsWith('copanel:run:')) return id.startsWith('copanel:');
  const name = id.slice('copanel:run:'.length);
  const cmd = REGISTRY.get(name);
  if (!cmd) { await interaction.reply({ content: `⚠️ \`${name}\` isn't available.`, ephemeral: true }); return true; }
  const opts = cmd.data?.toJSON?.().options || [];
  const subs = subcommandsOf(opts);
  if (subs.length) {
    const menu = new StringSelectMenuBuilder().setCustomId(`copanel:sub:${name}`).setPlaceholder(`/${name} — choose an action`)
      .addOptions(subs.slice(0, 25).map(s => ({ label: title(s.name).slice(0, 100), value: s.name, description: (s.description || '').slice(0, 100) || undefined })));
    await interaction.reply({ content: `**/${name}** — pick what to do:`, components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
    return true;
  }
  const vopts = valueOptionsOf(opts);
  if (vopts.length) return interaction.showModal(buildModal(name, '', vopts)).then(() => true);
  await runCommand(interaction, name, {});
  return true;
}

export async function handleModal(interaction) {
  const id = interaction.customId || '';
  if (!id.startsWith('copanel:m:')) return false;
  const rest = id.slice('copanel:m:'.length);
  const ci = rest.lastIndexOf(':');
  const name = rest.slice(0, ci);
  const sub = rest.slice(ci + 1) || null;
  const cmd = REGISTRY.get(name);
  const allOpts = cmd?.data?.toJSON?.().options || [];
  const opts = sub ? (subcommandsOf(allOpts).find(s => s.name === sub)?.options || []) : valueOptionsOf(allOpts);
  const fields = {};
  for (const o of opts.slice(0, 5)) { try { fields[o.name] = interaction.fields.getTextInputValue(o.name); } catch { /* not in modal */ } }
  const values = await resolveValues(opts, fields, interaction);
  if (sub) values.__sub = sub;
  await runCommand(interaction, name, values);
  return true;
}
