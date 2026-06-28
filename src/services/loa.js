// Leave of Absence (LOA) — self-service staff leave for the USGRP network.
//
// Flow: a member taps "Request LOA" in #loa (or runs /loa) → fills reason + how
// long → the request posts in #loa with Approve/Decline for the FSA. On approve
// they get the "LOA" role and their nickname becomes "Name | LOA" on EVERY server;
// the embed flips to Active with a Cancel button. The LOA ends when the owner (or
// FSA) taps Cancel, or when the duration expires — role removed + nickname
// restored across the network.
//
// Cross-bot note: aspire-bot's nicknameLock is LOA-aware — when a member holds the
// LOA role it locks them to "<name> | LOA" instead of fighting this change.
import {
  EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType,
} from 'discord.js';
import { E } from '../lib/emoji.js';
import { BRAND } from '../utils/brand.js';
import { isFSA } from '../utils/usgrpAuthority.js';
import { parseLoaIntent, aiAvailable } from '../serverAccess/ai.js';
import {
  createLoaRequest, getLoa, getActiveLoaForUser, getPendingLoaForUser, getOpenLoaForUser,
  setLoaRequestMessage, approveLoaRow, scheduleLoaRow, activateLoaRow, declineLoaRow, endLoaRow,
  getExpiredActiveLoas, getDueScheduledLoas, getBotConfig, setBotConfig,
} from '../utils/botDb.js';

const LOA_ROLE_NAME = 'LOA';
const NICK_SUFFIX = ' | LOA';
// USGRP | Network Staff Hub — where #loa lives (mirrors serverAccess/matrix.js).
const STAFF_HUB_GUILD = '1357119461957570570';

const C_PENDING = 0xFFBE2E;   // federal gold
const C_ACTIVE  = 0x22C55E;   // green
const C_DECLINE = 0xEF4444;   // red
const C_ENDED   = 0x9CA3AF;   // grey

// ── helpers ──────────────────────────────────────────────────────────────────

// LOA approvals + cancels are gated to the FSA (shared with /terminate).
export { isFSA };

// Strip any "| suffix" (rank/title or an existing | LOA) to get the bare name.
function baseNameOf(member) {
  const raw = member?.displayName || member?.nickname || member?.user?.username || 'Member';
  return String(raw).split(' | ')[0].trim() || 'Member';
}
function loaNickFor(base) {
  const b = base.length + NICK_SUFFIX.length > 32 ? base.slice(0, 32 - NICK_SUFFIX.length).trim() : base;
  return b + NICK_SUFFIX;
}

async function getOrCreateLoaRole(guild) {
  const existing = guild.roles.cache.find(r => r.name === LOA_ROLE_NAME);
  if (existing) return existing;
  try {
    return await guild.roles.create({ name: LOA_ROLE_NAME, color: 0xFFBE2E, hoist: false, mentionable: false, reason: 'LOA system — on-leave marker role' });
  } catch (e) { console.warn('[LOA] could not create LOA role in', guild.name, e.message); return null; }
}

// Parse a freeform "how long" string to ms (null = open-ended / unparseable).
async function durationToMs(text) {
  if (!text) return null;
  try { const { default: ms } = await import('ms'); const v = ms(text.trim()); return (typeof v === 'number' && v > 0) ? v : null; }
  catch { return null; }
}

const C_SCHEDULED = 0x3B82F6; // blue
function ts(iso, style = 'F') { return `<t:${Math.floor(new Date(iso).getTime() / 1000)}:${style}>`; }
function isFuture(iso) { return iso && new Date(iso).getTime() > Date.now() + 60_000; }
function durLabelFromDays(d) { return d ? `${d} day${d === 1 ? '' : 's'}` : null; }

// Short-lived per-user draft of an in-progress AI request, so a follow-up
// answer is combined with what they already said. TTL 10 min.
const _drafts = new Map(); // userId -> { text, question, at }
const DRAFT_TTL = 10 * 60_000;
function getDraft(uid) { const d = _drafts.get(uid); if (d && Date.now() - d.at < DRAFT_TTL) return d; _drafts.delete(uid); return null; }
function setDraft(uid, text, question) { _drafts.set(uid, { text, question, at: Date.now() }); }
function clearDraft(uid) { _drafts.delete(uid); }

// ── cross-guild apply / revert ───────────────────────────────────────────────

// Add the LOA role + "Name | LOA" nickname on every server the bot shares with
// the member. Snapshots each guild's original nickname so we can restore it.
// Role is added BEFORE the nickname so aspire-bot's LOA-aware lock sees the role.
export async function applyLoaAcrossGuilds(client, discordId) {
  const snapshot = {};
  let loaNick = null, applied = 0;
  for (const [guildId, guild] of client.guilds.cache) {
    try {
      const member = await guild.members.fetch(discordId).catch(() => null);
      if (!member) continue;
      const base = baseNameOf(member);
      const wantNick = loaNickFor(base);
      if (!loaNick) loaNick = wantNick;
      snapshot[guildId] = member.nickname ?? null;

      const role = await getOrCreateLoaRole(guild);
      if (role) { try { await member.roles.add(role, 'LOA approved'); } catch (e) { console.warn('[LOA] add role', guild.name, e.message); } }
      try { await member.setNickname(wantNick, 'LOA approved'); } catch (e) { console.warn('[LOA] set nick', guild.name, e.message); }
      applied++;
    } catch (e) { console.error('[LOA] apply error in', guildId, e.message); }
  }
  return { snapshot, loaNick, applied };
}

// Remove the LOA role + restore the snapshotted nickname everywhere. Role removed
// FIRST so aspire-bot's lock reverts to the normal verified identity.
export async function endLoaAcrossGuilds(client, discordId, snapshot = {}) {
  for (const [guildId, guild] of client.guilds.cache) {
    try {
      const member = await guild.members.fetch(discordId).catch(() => null);
      if (!member) continue;
      const role = guild.roles.cache.find(r => r.name === LOA_ROLE_NAME);
      if (role && member.roles.cache.has(role.id)) { try { await member.roles.remove(role, 'LOA ended'); } catch (e) { console.warn('[LOA] remove role', guild.name, e.message); } }
      if (Object.prototype.hasOwnProperty.call(snapshot, guildId)) {
        try { await member.setNickname(snapshot[guildId] ?? null, 'LOA ended'); } catch (e) { console.warn('[LOA] restore nick', guild.name, e.message); }
      }
    } catch (e) { console.error('[LOA] end error in', guildId, e.message); }
  }
}

// ── embeds + components ───────────────────────────────────────────────────────

export function buildInfoPanel() {
  const embed = new EmbedBuilder()
    .setColor(BRAND.color)
    .setTitle(`${E.leave} Leave of Absence (LOA)`)
    .setDescription(
      'Going to be away for a while? Request an LOA so the team knows you\'re off — no forms, just tell it in your own words.\n\n' +
      '**How to request**\n' +
      '• Tap **Request LOA** below (or run `/loa`).\n' +
      '• Just describe it naturally — e.g. *"I need an LOA next week for exams, about 10 days"* or *"off now for a fortnight, holiday"*. It works out the dates for you and asks if anything\'s missing.\n' +
      '• Your request appears here for review.\n\n' +
      '**What happens next**\n' +
      '• A member of the **FSA** approves or declines it.\n' +
      `• Once approved you get the **${LOA_ROLE_NAME}** role and your name shows as \`Name | LOA\` on every server.\n` +
      '• When you\'re back, you (or the FSA) tap **Cancel** on your approved request — your name and roles go straight back to normal. If you gave a duration it ends automatically.'
    )
    .setFooter({ text: `${BRAND.name} · LOA requests are approved by the FSA` });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('loa:request').setLabel('Request LOA').setStyle(ButtonStyle.Primary).setEmoji(emojiId(E.leave))
  );
  return { embeds: [embed], components: [row] };
}

// Pull the raw id out of a "<:name:id>" custom-emoji string for .setEmoji().
function emojiId(e) {
  const m = /<a?:\w+:(\d+)>/.exec(String(e || ''));
  return m ? m[1] : undefined;
}

function reqFields(loa, durationLabel) {
  return [
    { name: 'Member', value: `<@${loa.discord_id}>`, inline: true },
    { name: 'How long', value: durationLabel, inline: true },
    { name: 'Reason', value: String(loa.reason || '—').slice(0, 1024), inline: false },
  ];
}
function durLabel(loa) { return loa.duration_text ? String(loa.duration_text).slice(0, 100) : 'Open-ended'; }

export function buildPendingEmbed(loa) {
  const embed = new EmbedBuilder()
    .setColor(C_PENDING)
    .setTitle(`${E.pending} LOA Request — Pending`)
    .addFields(reqFields(loa))
    .addFields(
      { name: 'Starts', value: loa.start_at ? ts(loa.start_at) : 'When approved', inline: true },
      { name: 'Requested', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
    )
    .setFooter({ text: `LOA #${loa.id} · approved by the FSA` });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`loa:approve:${loa.id}`).setLabel('Approve').setStyle(ButtonStyle.Success).setEmoji(emojiId(E.allow) || emojiId(E.check)),
    new ButtonBuilder().setCustomId(`loa:decline:${loa.id}`).setLabel('Decline').setStyle(ButtonStyle.Danger).setEmoji(emojiId(E.deny) || emojiId(E.cross)),
  );
  return { embeds: [embed], components: [row] };
}

export function buildScheduledEmbed(loa) {
  const embed = new EmbedBuilder()
    .setColor(C_SCHEDULED)
    .setTitle(`${E.calendar} LOA — Scheduled`)
    .addFields(reqFields(loa))
    .addFields(
      { name: 'Starts', value: loa.start_at ? `${ts(loa.start_at)} (${ts(loa.start_at, 'R')})` : 'Soon', inline: true },
      { name: 'Ends', value: loa.ends_at ? ts(loa.ends_at) : 'When cancelled', inline: true },
      { name: 'Approved by', value: loa.decided_by ? `<@${loa.decided_by}>` : '—', inline: true },
    )
    .setFooter({ text: `LOA #${loa.id} · activates automatically on the start date` });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`loa:cancel:${loa.id}`).setLabel('Cancel (before it starts)').setStyle(ButtonStyle.Danger).setEmoji(emojiId(E.cross)),
  );
  return { embeds: [embed], components: [row] };
}

export function buildActiveEmbed(loa) {
  const ends = loa.ends_at ? `<t:${Math.floor(new Date(loa.ends_at).getTime() / 1000)}:F> (<t:${Math.floor(new Date(loa.ends_at).getTime() / 1000)}:R>)` : 'When cancelled';
  const embed = new EmbedBuilder()
    .setColor(C_ACTIVE)
    .setTitle(`${E.check} LOA — Active`)
    .addFields(reqFields(loa))
    .addFields(
      { name: 'Ends', value: ends, inline: true },
      { name: 'Approved by', value: loa.decided_by ? `<@${loa.decided_by}>` : '—', inline: true },
    )
    .setFooter({ text: `LOA #${loa.id} · the person on LOA or the FSA can cancel` });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`loa:cancel:${loa.id}`).setLabel('Cancel LOA (end now)').setStyle(ButtonStyle.Danger).setEmoji(emojiId(E.cross)),
  );
  return { embeds: [embed], components: [row] };
}

export function buildDeclinedEmbed(loa) {
  const embed = new EmbedBuilder()
    .setColor(C_DECLINE)
    .setTitle(`${E.cross} LOA Request — Declined`)
    .addFields(reqFields(loa))
    .addFields({ name: 'Reviewed by', value: loa.decided_by ? `<@${loa.decided_by}>` : '—', inline: true })
    .setFooter({ text: `LOA #${loa.id}` });
  return { embeds: [embed], components: [] };
}

export function buildEndedEmbed(loa, how) {
  const embed = new EmbedBuilder()
    .setColor(C_ENDED)
    .setTitle(`${E.member} LOA — Ended`)
    .addFields(reqFields(loa))
    .addFields({ name: 'Ended', value: `${how === 'expired' ? 'Duration expired' : 'Cancelled'} · <t:${Math.floor(Date.now() / 1000)}:R>`, inline: true })
    .setFooter({ text: `LOA #${loa.id}` });
  return { embeds: [embed], components: [] };
}

function dm(title, desc, color) {
  return { embeds: [new EmbedBuilder().setColor(color).setTitle(title).setDescription(desc).setFooter({ text: BRAND.footer }).setTimestamp()] };
}

// ── channel + panel ───────────────────────────────────────────────────────────

export async function resolveLoaChannel(client) {
  const saved = getBotConfig('loa_channel_id');
  if (saved) { const ch = await client.channels.fetch(saved).catch(() => null); if (ch) return ch; }
  const isLoa = (c) => c && c.type === ChannelType.GuildText && /(^|[^a-z])loa([^a-z]|$)/i.test(c.name);
  const hub = client.guilds.cache.get(STAFF_HUB_GUILD);
  if (hub) { const found = hub.channels.cache.find(isLoa); if (found) { setBotConfig('loa_channel_id', found.id); return found; } }
  for (const [, guild] of client.guilds.cache) {
    const found = guild.channels.cache.find(isLoa);
    if (found) { setBotConfig('loa_channel_id', found.id); return found; }
  }
  return null;
}

// Post the standing info panel into #loa once (idempotent). Safe to call every boot.
export async function ensurePanel(client) {
  const channel = await resolveLoaChannel(client);
  if (!channel) { console.warn('[LOA] no #loa channel found — panel not posted. Run /loa-panel in the channel you want.'); return; }
  const existingId = getBotConfig('loa_panel_msg_id');
  if (existingId) {
    const msg = await channel.messages.fetch(existingId).catch(() => null);
    // Refresh the existing panel in place so copy changes land without reposting.
    if (msg) { try { await msg.edit(buildInfoPanel()); } catch (e) { console.warn('[LOA] panel refresh failed:', e.message); } return; }
  }
  try {
    const msg = await channel.send(buildInfoPanel());
    setBotConfig('loa_panel_msg_id', msg.id);
    setBotConfig('loa_channel_id', channel.id);
    console.log('[LOA] info panel posted in', `#${channel.name}`);
  } catch (e) { console.error('[LOA] failed to post panel:', e.message); }
}

// Force-(re)post the panel to a specific channel (for /loa-panel).
export async function postPanelTo(channel) {
  const msg = await channel.send(buildInfoPanel());
  setBotConfig('loa_panel_msg_id', msg.id);
  setBotConfig('loa_channel_id', channel.id);
  return msg;
}

// ── interaction handlers ───────────────────────────────────────────────────────

// One free-text box — the member just describes their leave in their own words
// and the AI works out the reason, start date and duration. `placeholder` carries
// a follow-up question when we need more info.
function aiModal(placeholder) {
  return new ModalBuilder().setCustomId('loa_modal').setTitle('Request a Leave of Absence').addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('text').setLabel('Tell me about your leave')
        .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500)
        .setPlaceholder((placeholder || 'e.g. "I need an LOA next week for exams, about 10 days" — or "off now for 2 weeks, holiday"').slice(0, 100))),
  );
}

function openMsg(open) {
  if (open.status === 'active') return `${E.cross} You're already on LOA (#${open.id}). End that one before starting another.`;
  if (open.status === 'scheduled') return `${E.pending} You already have an LOA (#${open.id}) scheduled to start ${open.start_at ? ts(open.start_at, 'R') : 'soon'}. Cancel it first if you want to change it.`;
  return `${E.pending} You already have a pending LOA request (#${open.id}) waiting on FSA review.`;
}

// Slash command + button both open the same AI box.
export async function openRequestModal(interaction) {
  const open = getOpenLoaForUser(interaction.user.id);
  if (open) return interaction.reply({ content: openMsg(open), ephemeral: true });
  return interaction.showModal(aiModal());
}

export async function handleModalSubmit(interaction) {
  if (interaction.customId !== 'loa_modal') return false;
  await handleAiText(interaction, interaction.fields.getTextInputValue('text') || '');
  return true;
}

// The AI request flow: interpret the member's words, ask a follow-up if needed,
// otherwise file the request. Used by the modal, /loa <text>, and the follow-up.
export async function handleAiText(interaction, rawText) {
  const uid = interaction.user.id;
  const text = String(rawText || '').trim();
  if (!text) return interaction.reply({ content: `${E.cross} Tell me about your leave first.`, ephemeral: true });

  const open = getOpenLoaForUser(uid);
  if (open) { clearDraft(uid); return interaction.reply({ content: openMsg(open), ephemeral: true }); }

  await interaction.deferReply({ ephemeral: true });

  // Combine with any prior draft (i.e. a follow-up answer to our question).
  const draft = getDraft(uid);
  const combined = draft ? `${draft.text}\n${text}` : text;

  let parsed = null;
  if (aiAvailable()) { try { parsed = await parseLoaIntent(combined, { nowIso: new Date().toISOString() }); } catch (e) { console.error('[LOA] AI parse error:', e.message); } }
  // No AI / parse failed → treat the whole message as the reason, open-ended, start now.
  if (!parsed || !parsed.ok) parsed = { ok: true, reason: combined.slice(0, 500), start_at: null, duration_days: null, complete: true, summary: null, question: null };

  if (!parsed.complete) {
    setDraft(uid, combined, parsed.question);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('loa:more').setLabel('Add details').setStyle(ButtonStyle.Primary));
    return interaction.editReply({ content: `${E.pending} ${parsed.question}`, components: [row] });
  }

  clearDraft(uid);
  const durationText = durLabelFromDays(parsed.duration_days);
  const channel = (await resolveLoaChannel(interaction.client)) || interaction.channel;
  const displayName = interaction.member?.displayName || interaction.user.username;
  const id = createLoaRequest({ discordId: uid, displayName, reason: parsed.reason, durationText, startAt: parsed.start_at, channelId: channel?.id });
  const loa = getLoa(id);

  const payload = buildPendingEmbed(loa);
  let content;
  const fsaRole = channel?.guild?.roles?.cache?.find(r => /^FSA\b/i.test(r.name) || /Federal Server Administration/i.test(r.name));
  if (fsaRole) content = `${fsaRole} — new LOA request`;

  try {
    const msg = await channel.send({ ...payload, content, allowedMentions: fsaRole ? { roles: [fsaRole.id] } : { parse: [] } });
    setLoaRequestMessage(id, channel.id, msg.id);
    const summary = parsed.summary ? `\n\n> ${parsed.summary}` : '';
    return interaction.editReply({ content: `${E.check} Your LOA request (#${id}) has been sent to ${channel} for FSA review.${summary}\n\nYou'll be DM'd when it's decided.`, components: [] });
  } catch (e) {
    console.error('[LOA] post request error:', e.message);
    return interaction.editReply({ content: `${E.cross} Couldn't post your request to the LOA channel. Ping an admin.`, components: [] });
  }
}

// Dispatch all loa:* buttons. Returns true if handled.
export async function handleButton(interaction) {
  const [, action, idStr] = interaction.customId.split(':');
  const id = idStr ? Number(idStr) : null;
  if (action === 'request') { await openRequestModal(interaction); return true; }
  if (action === 'more') {
    const open = getOpenLoaForUser(interaction.user.id);
    if (open) { await interaction.reply({ content: openMsg(open), ephemeral: true }); return true; }
    const draft = getDraft(interaction.user.id);
    await interaction.showModal(aiModal(draft?.question));
    return true;
  }
  if (action === 'approve') { await handleApprove(interaction, id); return true; }
  if (action === 'decline') { await handleDecline(interaction, id); return true; }
  if (action === 'cancel')  { await handleCancel(interaction, id);  return true; }
  return false;
}

async function refreshRequestMessage(interaction, payload) {
  // Edit the embed the button lives on.
  try { await interaction.message.edit(payload); } catch (e) { console.warn('[LOA] message edit failed:', e.message); }
}

async function handleApprove(interaction, id) {
  if (!await isFSA(interaction.user.id)) return interaction.reply({ content: `${E.cross} Only a member of the **FSA** can approve LOAs.`, ephemeral: true });
  const loa = getLoa(id);
  if (!loa || loa.status !== 'pending') return interaction.reply({ content: `${E.cross} This request isn't pending anymore.`, ephemeral: true });
  await interaction.deferUpdate();

  const durMs = await durationToMs(loa.duration_text);
  const startMs = isFuture(loa.start_at) ? new Date(loa.start_at).getTime() : Date.now();
  const endsAt = durMs ? new Date(startMs + durMs).toISOString() : null;
  const user = await interaction.client.users.fetch(loa.discord_id).catch(() => null);

  if (isFuture(loa.start_at)) {
    // Future-dated → schedule it; the role/nick apply when the start date arrives.
    scheduleLoaRow(id, { decidedBy: interaction.user.id, endsAt });
    const updated = getLoa(id);
    await refreshRequestMessage(interaction, buildScheduledEmbed(updated));
    if (user) {
      const endLine = endsAt ? `It will then end automatically ${ts(endsAt, 'R')}.` : 'It stays active until you (or the FSA) end it.';
      await user.send(dm(`${E.calendar} Your LOA is approved & scheduled`, `Your leave of absence has been **approved** by <@${interaction.user.id}>.\n\nIt starts ${ts(loa.start_at)} (${ts(loa.start_at, 'R')}) — your **${LOA_ROLE_NAME}** role and \`Name | LOA\` nickname go on automatically then. ${endLine}\n\nNeed to call it off before it starts? Tap **Cancel** on your request in the LOA channel.`, C_SCHEDULED)).catch(() => {});
    }
    return;
  }

  // Immediate.
  const { snapshot, loaNick } = await applyLoaAcrossGuilds(interaction.client, loa.discord_id);
  approveLoaRow(id, { decidedBy: interaction.user.id, endsAt, nickSnapshot: snapshot, loaNick });
  const updated = getLoa(id);
  await refreshRequestMessage(interaction, buildActiveEmbed(updated));
  if (user) {
    const endLine = endsAt ? `It will end automatically ${ts(endsAt, 'R')}.` : 'It stays active until you (or the FSA) end it.';
    await user.send(dm(`${E.check} Your LOA is active`, `Your leave of absence has been **approved** by <@${interaction.user.id}>.\n\nYour name now shows as **\`${loaNick}\`** across the network and you have the **${LOA_ROLE_NAME}** role.\n\n${endLine}\n\nTo come back early, tap **Cancel** on your approved request in the LOA channel.`, C_ACTIVE)).catch(() => {});
  }
}

async function handleDecline(interaction, id) {
  if (!await isFSA(interaction.user.id)) return interaction.reply({ content: `${E.cross} Only a member of the **FSA** can decline LOAs.`, ephemeral: true });
  const loa = getLoa(id);
  if (!loa || loa.status !== 'pending') return interaction.reply({ content: `${E.cross} This request isn't pending anymore.`, ephemeral: true });
  await interaction.deferUpdate();

  declineLoaRow(id, interaction.user.id);
  const updated = getLoa(id);
  await refreshRequestMessage(interaction, buildDeclinedEmbed(updated));

  const user = await interaction.client.users.fetch(loa.discord_id).catch(() => null);
  if (user) await user.send(dm(`${E.cross} LOA request declined`, `Your leave of absence request was **declined** by <@${interaction.user.id}>.\n\nIf you think this was a mistake, reach out to the FSA.`, C_DECLINE)).catch(() => {});
}

async function handleCancel(interaction, id) {
  const loa = getLoa(id);
  if (!loa || (loa.status !== 'active' && loa.status !== 'scheduled')) return interaction.reply({ content: `${E.cross} This LOA isn't active or scheduled.`, ephemeral: true });
  const isOwner = String(interaction.user.id) === String(loa.discord_id);
  if (!isOwner && !await isFSA(interaction.user.id)) return interaction.reply({ content: `${E.cross} Only the person on LOA or a member of the FSA can end this.`, ephemeral: true });
  await interaction.deferUpdate();

  // Scheduled (not started yet) → nothing applied across guilds; just cancel.
  if (loa.status === 'active') {
    let snapshot = {};
    try { snapshot = JSON.parse(loa.nick_snapshot || '{}'); } catch {}
    await endLoaAcrossGuilds(interaction.client, loa.discord_id, snapshot);
  }
  endLoaRow(id, loa.status === 'scheduled' ? 'cancelled-before-start' : 'cancelled');
  const updated = getLoa(id);
  await refreshRequestMessage(interaction, buildEndedEmbed(updated, 'cancelled'));

  const user = await interaction.client.users.fetch(loa.discord_id).catch(() => null);
  if (user) {
    const body = loa.status === 'scheduled'
      ? `Your scheduled leave of absence has been cancelled${isOwner ? '' : ` by <@${interaction.user.id}>`} before it started.`
      : `Your leave of absence has ended${isOwner ? '' : ` (ended by <@${interaction.user.id}>)`}. Your name and roles are back to normal across the network.`;
    await user.send(dm(`${E.member} LOA ${loa.status === 'scheduled' ? 'cancelled' : 'ended — welcome back'}`, body, C_ENDED)).catch(() => {});
  }
}

// 60s tick: activate scheduled LOAs whose start date has arrived.
export async function activateScheduledLOAs(client) {
  const rows = getDueScheduledLoas(new Date().toISOString());
  for (const loa of rows) {
    try {
      const { snapshot, loaNick } = await applyLoaAcrossGuilds(client, loa.discord_id);
      activateLoaRow(loa.id, { nickSnapshot: snapshot, loaNick });
      const updated = getLoa(loa.id);
      if (loa.channel_id && loa.request_message_id) {
        const ch = await client.channels.fetch(loa.channel_id).catch(() => null);
        if (ch) { const msg = await ch.messages.fetch(loa.request_message_id).catch(() => null); if (msg) await msg.edit(buildActiveEmbed(updated)).catch(() => {}); }
      }
      const user = await client.users.fetch(loa.discord_id).catch(() => null);
      if (user) {
        const endLine = updated.ends_at ? `It will end automatically ${ts(updated.ends_at, 'R')}.` : 'It stays active until you (or the FSA) end it.';
        await user.send(dm(`${E.check} Your LOA has started`, `Your scheduled leave of absence is now **active** — your name shows as **\`${loaNick}\`** with the **${LOA_ROLE_NAME}** role across the network.\n\n${endLine}\n\nTap **Cancel** on your request to come back early.`, C_ACTIVE)).catch(() => {});
      }
      console.log('[LOA] activated scheduled LOA #' + loa.id);
    } catch (e) { console.error('[LOA] activate error for #' + loa.id, e.message); }
  }
}

// 60s tick: end any active LOA whose duration has elapsed.
export async function sweepExpiredLOAs(client) {
  const rows = getExpiredActiveLoas(new Date().toISOString());
  for (const loa of rows) {
    try {
      let snapshot = {};
      try { snapshot = JSON.parse(loa.nick_snapshot || '{}'); } catch {}
      await endLoaAcrossGuilds(client, loa.discord_id, snapshot);
      endLoaRow(loa.id, 'expired');
      const updated = getLoa(loa.id);
      if (loa.channel_id && loa.request_message_id) {
        const ch = await client.channels.fetch(loa.channel_id).catch(() => null);
        if (ch) { const msg = await ch.messages.fetch(loa.request_message_id).catch(() => null); if (msg) await msg.edit(buildEndedEmbed(updated, 'expired')).catch(() => {}); }
      }
      const user = await client.users.fetch(loa.discord_id).catch(() => null);
      if (user) await user.send(dm(`${E.member} Welcome back — LOA ended`, 'Your leave of absence duration has elapsed, so it\'s been ended automatically. Your name and roles are back to normal across the network.', C_ENDED)).catch(() => {});
      console.log('[LOA] auto-ended expired LOA #' + loa.id);
    } catch (e) { console.error('[LOA] sweep error for #' + loa.id, e.message); }
  }
}

// One tick: start any scheduled LOAs that are due, then end any that have expired.
export async function tickLOAs(client) {
  await activateScheduledLOAs(client);
  await sweepExpiredLOAs(client);
}
