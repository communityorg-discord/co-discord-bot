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
import { SUPERUSER_IDS } from '../config.js';
import { networkVerifyApi } from '../utils/aspireInternal.js';
import {
  createLoaRequest, getLoa, getActiveLoaForUser, getPendingLoaForUser,
  setLoaRequestMessage, approveLoaRow, declineLoaRow, endLoaRow, getExpiredActiveLoas,
  getBotConfig, setBotConfig,
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

// Is this member allowed to approve LOAs? Founders always; otherwise a member of
// the FSA (Federal Server Administration) — position "FSA | …" or the division role.
export async function isFSA(discordId) {
  if (SUPERUSER_IDS.includes(String(discordId))) return true;
  try {
    const resp = await networkVerifyApi.record(String(discordId));
    const rec = resp?.record || resp;
    if (!rec || resp?.ok === false) return false;
    if (/^FSA\b/i.test(String(rec.position || ''))) return true;
    const roles = Array.isArray(rec.roles) ? rec.roles : [];
    return roles.some(r => /^FSA\b/i.test(String(r)) || /Federal Server Administration/i.test(String(r)));
  } catch { return false; }
}

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
      'Going to be away for a while? Request an LOA so the team knows you\'re off — no questions, just give us a heads-up.\n\n' +
      '**How to request**\n' +
      '• Tap **Request LOA** below (or run `/loa`).\n' +
      '• Tell us **why** and **roughly how long** you\'ll be away.\n' +
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
    .addFields({ name: 'Requested', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true })
    .setFooter({ text: `LOA #${loa.id} · approved by the FSA` });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`loa:approve:${loa.id}`).setLabel('Approve').setStyle(ButtonStyle.Success).setEmoji(emojiId(E.allow) || emojiId(E.check)),
    new ButtonBuilder().setCustomId(`loa:decline:${loa.id}`).setLabel('Decline').setStyle(ButtonStyle.Danger).setEmoji(emojiId(E.deny) || emojiId(E.cross)),
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
  if (existingId) { const msg = await channel.messages.fetch(existingId).catch(() => null); if (msg) return; }
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

function requestModal() {
  return new ModalBuilder().setCustomId('loa_modal').setTitle('Request a Leave of Absence').addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('reason').setLabel('Why are you taking leave?')
        .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(900)
        .setPlaceholder('e.g. exams, holiday, personal time, work…')),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('duration').setLabel('How long? (optional)')
        .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(60)
        .setPlaceholder('e.g. 1 week, 10 days, 48h — blank = open-ended')),
  );
}

// Slash command + button both open the same modal.
export async function openRequestModal(interaction) {
  const active = getActiveLoaForUser(interaction.user.id);
  if (active) return interaction.reply({ content: `${E.cross} You're already on LOA (#${active.id}). End that one before starting another.`, ephemeral: true });
  const pending = getPendingLoaForUser(interaction.user.id);
  if (pending) return interaction.reply({ content: `${E.pending} You already have a pending LOA request (#${pending.id}) waiting on FSA review.`, ephemeral: true });
  return interaction.showModal(requestModal());
}

export async function handleModalSubmit(interaction) {
  if (interaction.customId !== 'loa_modal') return false;
  const reason = (interaction.fields.getTextInputValue('reason') || '').trim();
  const durationText = (interaction.fields.getTextInputValue('duration') || '').trim() || null;
  if (!reason) return interaction.reply({ content: `${E.cross} A reason is required.`, ephemeral: true });

  // Guard against duplicates (modal could be opened before another finished).
  const active = getActiveLoaForUser(interaction.user.id);
  if (active) return interaction.reply({ content: `${E.cross} You're already on LOA (#${active.id}).`, ephemeral: true });
  const pending = getPendingLoaForUser(interaction.user.id);
  if (pending) return interaction.reply({ content: `${E.pending} You already have a pending LOA request (#${pending.id}).`, ephemeral: true });

  await interaction.deferReply({ ephemeral: true });

  const channel = (await resolveLoaChannel(interaction.client)) || interaction.channel;
  const displayName = interaction.member?.displayName || interaction.user.username;
  const id = createLoaRequest({ discordId: interaction.user.id, displayName, reason, durationText, channelId: channel?.id });
  const loa = getLoa(id);

  const payload = buildPendingEmbed(loa);
  // Ping the FSA division role in that guild, if present.
  let content;
  const fsaRole = channel?.guild?.roles?.cache?.find(r => /^FSA\b/i.test(r.name) || /Federal Server Administration/i.test(r.name));
  if (fsaRole) content = `${fsaRole} — new LOA request`;

  try {
    const msg = await channel.send({ ...payload, content, allowedMentions: fsaRole ? { roles: [fsaRole.id] } : { parse: [] } });
    setLoaRequestMessage(id, channel.id, msg.id);
    return interaction.editReply({ content: `${E.check} Your LOA request (#${id}) has been sent to ${channel} for FSA review. You'll be DM'd when it's decided.` });
  } catch (e) {
    console.error('[LOA] post request error:', e.message);
    return interaction.editReply({ content: `${E.cross} Couldn't post your request to the LOA channel. Ping an admin.` });
  }
}

// Dispatch all loa:* buttons. Returns true if handled.
export async function handleButton(interaction) {
  const [, action, idStr] = interaction.customId.split(':');
  const id = idStr ? Number(idStr) : null;
  if (action === 'request') { await openRequestModal(interaction); return true; }
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

  const { snapshot, loaNick } = await applyLoaAcrossGuilds(interaction.client, loa.discord_id);
  const durMs = await durationToMs(loa.duration_text);
  const endsAt = durMs ? new Date(Date.now() + durMs).toISOString() : null;
  approveLoaRow(id, { decidedBy: interaction.user.id, endsAt, nickSnapshot: snapshot, loaNick });

  const updated = getLoa(id);
  await refreshRequestMessage(interaction, buildActiveEmbed(updated));

  const user = await interaction.client.users.fetch(loa.discord_id).catch(() => null);
  if (user) {
    const endLine = endsAt ? `It will end automatically <t:${Math.floor(new Date(endsAt).getTime() / 1000)}:R>.` : 'It stays active until you (or the FSA) end it.';
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
  if (!loa || loa.status !== 'active') return interaction.reply({ content: `${E.cross} This LOA isn't active.`, ephemeral: true });
  const isOwner = String(interaction.user.id) === String(loa.discord_id);
  if (!isOwner && !await isFSA(interaction.user.id)) return interaction.reply({ content: `${E.cross} Only the person on LOA or a member of the FSA can end this.`, ephemeral: true });
  await interaction.deferUpdate();

  let snapshot = {};
  try { snapshot = JSON.parse(loa.nick_snapshot || '{}'); } catch {}
  await endLoaAcrossGuilds(interaction.client, loa.discord_id, snapshot);
  endLoaRow(id, 'cancelled');
  const updated = getLoa(id);
  await refreshRequestMessage(interaction, buildEndedEmbed(updated, 'cancelled'));

  const user = await interaction.client.users.fetch(loa.discord_id).catch(() => null);
  if (user) await user.send(dm(`${E.member} Welcome back — LOA ended`, `Your leave of absence has ended${isOwner ? '' : ` (ended by <@${interaction.user.id}>)`}. Your name and roles are back to normal across the network.`, C_ENDED)).catch(() => {});
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
