// COMMAND_PERMISSION_FALLBACK: auth_level >= 6
// Accessible to Junior Admin and above (netadmin RANK power >= 6 — Junior Admin,
// Deputy/DSA/SSA Admin=6, FSA Administrator=7, Senior=8, Head=9); founders always
// bypass. Trial accept/reject buttons carry the same gate (canUseCommand check).
// USGRP NETWORK-staff position TRANSFER — move an existing (or new) network
// staffer to a DIFFERENT position. They do NOT keep the old one; the single
// per-person record swaps over, roles + nickname re-sync across the network, and
// the hierarchy site updates. A transfer can be PERMANENT or a TRIAL: on a trial
// the new position goes live now, and when the window ends an approver (Junior
// Admin / Admin) is asked to accept it (make permanent) or reject it (revert to
// the original position). The heavy lifting runs on aspire-bot; this is the
// picker + approval, mirroring /network-verify.
import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { networkVerifyApi } from '../utils/aspireInternal.js';
import { usgrpPowerLevel, powerFromRecord } from '../utils/usgrpAuthority.js';
import { SUPERUSER_IDS } from '../config.js';
import { logAction } from '../utils/logger.js';

// The rank power a given network position confers (Head Admin 9 … Member 4).
// Used to stop someone transferring a person INTO a position above their own
// rank — a Junior Admin must not be able to create a Head Administrator.
const positionPower = (position) => powerFromRecord({ position });
import { E } from '../lib/emoji.js';

const SEP = '~';
// Dion + Evan only (Dion: "me and Evan get notified") — matches FOUNDER_IDS in index.js.
const FOUNDER_IDS = ['723199054514749450', '415922272956710912'];

// DM the founders an embed (they want a heads-up on every staff move), plus DM
// the affected staffer so they know their own position changed. Best-effort.
async function notifyFounders(client, embed) {
  for (const id of FOUNDER_IDS) {
    try { const u = await client.users.fetch(id); await u.send({ embeds: [embed] }); } catch { /* DMs closed */ }
  }
}
async function dmUser(client, userId, embed) {
  try { const u = await client.users.fetch(String(userId)); await u.send({ embeds: [embed] }); return true; } catch { return false; }
}
const TRIAL_DAYS = [0, 7, 14, 30]; // 0 = permanent
const trialLabel = (d) => d === 0 ? 'Permanent transfer' : `${d}-day trial`;

// Seat availability for a position (from networkPositions: seat_count/taken/open).
// Shown right in the picker so you see at a glance what's open vs full.
const posSeats = (p) => {
  const total = p.seat_count || 1;
  const taken = Math.min(p.taken || 0, total);
  return { total, taken, open: Math.max(0, total - taken) };
};
function availLabel(p) {
  const { total, taken, open } = posSeats(p);
  if (open === 0) return `FULL (${taken}/${total})`;
  if (taken === 0) return `${open} open (all vacant)`;
  return `${open} of ${total} open`;
}
const availEmoji = (p) => { const { taken, open } = posSeats(p); return open === 0 ? '🔴' : (taken === 0 ? '🟢' : '🟡'); };

// Strip any leaked title/division junk (e.g. a display name already carrying
// "Ian V.  FSA") so the prefilled name is just the person's name.
function cleanNameGuess(raw) {
  let n = String(raw || '').split('|')[0].replace(/[~|]/g, '');
  let prev;
  do { prev = n; n = n.replace(/[\s,]+(?:FSA|DSA|SSA|SAD)\s*$/i, ''); } while (n !== prev);
  return n.replace(/\s+/g, ' ').trim();
}
function guessName(interaction, targetId) {
  const m = interaction.guild?.members?.cache?.get(targetId);
  const u = interaction.client.users.cache.get(targetId);
  const raw = m?.displayName || u?.globalName || u?.username || '';
  return cleanNameGuess(raw).slice(0, 24);
}

function nameModal(targetId, seatNo, position, days, prefill) {
  const modal = new ModalBuilder()
    .setCustomId(`nettransfer_name${SEP}${targetId}${SEP}${seatNo || 0}${SEP}${days}${SEP}${position}`)
    .setTitle('Position Transfer');
  const input = new TextInputBuilder()
    .setCustomId('name').setLabel("What's their name?").setPlaceholder('e.g. Dion M.')
    .setStyle(TextInputStyle.Short).setMaxLength(24).setRequired(true);
  if (prefill) input.setValue(prefill);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

export const data = new SlashCommandBuilder()
  .setName('network-transfer')
  .setDescription('Move a network staffer to a different position — permanently or on a trial')
  .addUserOption(o => o.setName('user').setDescription('The network staff member to transfer').setRequired(true));

export async function execute(interaction) {
  await interaction.deferReply();
  const perm = await canUseCommand('network-transfer', interaction);
  if (!perm.allowed) return interaction.editReply({ content: `${E.cross} ${perm.reason}` });

  const target = interaction.options.getUser('user');
  const [posRes, cur] = await Promise.all([
    networkVerifyApi.positions(),
    networkVerifyApi.record(target.id).catch(() => ({})),
  ]);
  if (!posRes.ok || !Array.isArray(posRes.positions) || !posRes.positions.length) {
    return interaction.editReply({ content: `${E.cross} Couldn't load network positions from aspire-bot (${posRes.error || posRes.status}).` });
  }
  const currentPos = cur && cur.position ? cur.position : null;

  // Rank cap: you can only transfer someone INTO a position at or below your OWN
  // rank — a Junior Admin (6) must not be able to create a Head Administrator (9).
  // Founders bypass and see every position.
  const isFounder = SUPERUSER_IDS.includes(String(interaction.user.id));
  const myPower = isFounder ? 99 : await usgrpPowerLevel(interaction.user.id);
  const allowed = posRes.positions.filter(p => isFounder || positionPower(p.position) <= myPower);
  if (!allowed.length) {
    return interaction.editReply({ content: `${E.cross} There are no positions at or below your own rank that you can transfer someone into.` });
  }
  const hiddenN = posRes.positions.length - allowed.length;

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`nettransfer_pos${SEP}${target.id}`)
    .setPlaceholder('Choose the NEW position…')
    .addOptions(allowed.slice(0, 25).map(p => ({
      label: `${p.position} · ${availLabel(p)}`.slice(0, 100),
      description: `${p.group} · "${p.short_title}, ${p.group}"`.slice(0, 100),
      value: p.position.slice(0, 100),
      emoji: availEmoji(p),
      default: false,
    })));
  const capNote = hiddenN > 0 ? `\n\n_${hiddenN} position${hiddenN === 1 ? '' : 's'} above your own rank ${hiddenN === 1 ? 'is' : 'are'} hidden — you can't transfer someone above your level._` : '';
  const e = new EmbedBuilder().setColor(0x5865F2).setTitle('Network Position Transfer')
    .setDescription(`Transferring <@${target.id}>${currentPos ? ` from **${currentPos}**` : ' (not currently network-verified)'}.\n\nChoose the **new** position — they'll move to it and no longer hold the old one. Each shows how many seats are open. 🟢 fully vacant · 🟡 some open · 🔴 fully filled (picking it re-assigns a seat). Next you'll pick permanent or a trial, then approve.${capNote}`)
    .setFooter({ text: 'USGRP · Network Transfer' });
  return interaction.editReply({ embeds: [e], components: [new ActionRowBuilder().addComponents(menu)] });
}

// Server-side rank guard reused at every step (select/modal/apply) so a crafted
// customId can't bypass the picker's visual filter. Returns true if OK.
async function actorMayAssign(interaction, position) {
  if (SUPERUSER_IDS.includes(String(interaction.user.id))) return true;
  const myPower = await usgrpPowerLevel(interaction.user.id);
  return positionPower(position) <= myPower;
}

export async function handleSelect(interaction) {
  const id = interaction.customId;
  // Step 1: new position chosen → (seat picker if multi-slot) → trial-length picker.
  if (id.startsWith(`nettransfer_pos${SEP}`)) {
    const targetId = id.split(SEP)[1];
    const position = interaction.values[0];
    const seats = await networkVerifyApi.seats(position);
    if (seats.ok && (seats.count || 1) > 1) {
      await interaction.deferUpdate();
      const taken = new Map((seats.taken || []).filter(t => t.seat_no).map(t => [Number(t.seat_no), t.name]));
      const posLabel = position.replace(/\s*\|\s*/, ' ');
      const opts = [];
      for (let n = 1; n <= seats.count && opts.length < 25; n++) {
        const who = taken.get(n);
        opts.push({ label: `${posLabel} ${n}`.slice(0, 100), description: (who ? `Held by ${who} — re-assigns` : 'Open').slice(0, 100), value: String(n) });
      }
      const menu = new StringSelectMenuBuilder().setCustomId(`nettransfer_seat${SEP}${targetId}${SEP}${position}`).setPlaceholder('Which seat?').addOptions(opts);
      const e = new EmbedBuilder().setColor(0x5865F2).setTitle('Network Position Transfer')
        .setDescription(`**<@${targetId}>** → **${position}**\nThis seat has **${seats.count} slots** — pick which one.`).setFooter({ text: 'USGRP · Network Transfer' });
      return interaction.editReply({ embeds: [e], components: [new ActionRowBuilder().addComponents(menu)] });
    }
    return interaction.update(trialPicker(targetId, null, position));
  }
  // Step 1b: seat chosen → trial-length picker.
  if (id.startsWith(`nettransfer_seat${SEP}`)) {
    const parts = id.split(SEP);
    const targetId = parts[1];
    const position = parts.slice(2).join(SEP);
    const seatNo = Number(interaction.values[0]) || null;
    return interaction.update(trialPicker(targetId, seatNo, position));
  }
  // Step 2: trial length chosen → name modal.
  if (id.startsWith(`nettransfer_days${SEP}`)) {
    const parts = id.split(SEP);
    const targetId = parts[1];
    const seatNo = Number(parts[2]) || null;
    const position = parts.slice(3).join(SEP);
    const days = Number(interaction.values[0]) || 0;
    return interaction.showModal(nameModal(targetId, seatNo, position, days, guessName(interaction, targetId)));
  }
}

function trialPicker(targetId, seatNo, position) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`nettransfer_days${SEP}${targetId}${SEP}${seatNo || 0}${SEP}${position}`)
    .setPlaceholder('Permanent, or how long a trial?')
    .addOptions(TRIAL_DAYS.map(d => ({ label: trialLabel(d), value: String(d),
      description: d === 0 ? 'Move them permanently' : `Reverts unless an approver accepts after ${d} days` })));
  const e = new EmbedBuilder().setColor(0x5865F2).setTitle('Network Position Transfer')
    .setDescription(`**<@${targetId}>** → **${position}**${seatNo ? ` · seat ${seatNo}` : ''}\n\nPermanent transfer, or a trial? On a trial they move now, and when it ends an approver is asked to keep or revert it.`)
    .setFooter({ text: 'USGRP · Network Transfer' });
  return { embeds: [e], components: [new ActionRowBuilder().addComponents(menu)] };
}

// Step 3: name typed → dry-run preview + approve.
export async function handleModal(interaction) {
  if (!interaction.customId.startsWith(`nettransfer_name${SEP}`)) return;
  await interaction.deferUpdate();
  const parts = interaction.customId.split(SEP);
  const targetId = parts[1];
  const seatNo = Number(parts[2]) || null;
  const days = Number(parts[3]) || 0;
  const position = parts.slice(4).join(SEP);
  const name = (interaction.fields.getTextInputValue('name') || '').split(SEP).join('').trim();

  const pre = await networkVerifyApi.preview(targetId, position, name || '');
  if (!pre.ok) return interaction.editReply({ content: `${E.cross} Preview failed: ${pre.error || pre.status}`, embeds: [], components: [] });

  const e = new EmbedBuilder().setColor(0xF59E0B).setTitle(`Dry run — ${trialLabel(days)}`)
    .setDescription(`**<@${targetId}>** → **${position}**${seatNo ? ` · seat ${seatNo}` : ''}\n${days === 0 ? 'They move permanently and no longer hold their old position.' : `They move now for a **${days}-day trial**. When it ends, an approver is asked to keep it or revert.`}\nNothing is applied until you approve.`)
    .addFields(
      { name: 'Global nickname', value: pre.nickname || '—', inline: true },
      { name: 'Servers', value: `${(pre.server_count || 0) + 1}`, inline: true },
      { name: 'Type', value: trialLabel(days), inline: true },
      { name: 'Roles on the main server', value: (pre.roles_main || []).map(r => `\`${r}\``).join(' ').slice(0, 1024) || '—' },
    )
    .setFooter({ text: 'Approve to move them across the network · USGRP Network Transfer' });
  const safeName = (name || '').split(SEP).join('');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`nettransfer_apply${SEP}${targetId}${SEP}${seatNo || 0}${SEP}${days}${SEP}${position}${SEP}${safeName}`).setLabel(days === 0 ? 'Approve transfer' : 'Start trial').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`nettransfer_cancel${SEP}${targetId}`).setLabel('Cancel').setStyle(ButtonStyle.Danger),
  );
  return interaction.editReply({ embeds: [e], components: [row] });
}

export async function handleButton(interaction) {
  const id = interaction.customId;
  if (id.startsWith(`nettransfer_cancel${SEP}`)) {
    await interaction.deferUpdate();
    const e = EmbedBuilder.from(interaction.message.embeds[0]).setColor(0xEF4444).setTitle('Cancelled').setFooter({ text: 'No change made · USGRP Network Transfer' });
    return interaction.editReply({ embeds: [e], components: [] });
  }
  // Approver's accept/reject on a trial that reached its window.
  if (id.startsWith(`nettrial_accept${SEP}`) || id.startsWith(`nettrial_reject${SEP}`)) {
    const perm = await canUseCommand('network-transfer', interaction);
    if (!perm.allowed) return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });
    await interaction.deferUpdate();
    const accept = id.startsWith(`nettrial_accept${SEP}`);
    const trialId = id.split(SEP)[1];
    const r = await networkVerifyApi.decideTrial(trialId, accept, interaction.user.id);
    const base = EmbedBuilder.from(interaction.message.embeds[0]);
    if (!r.ok) return interaction.editReply({ embeds: [base.setColor(0xEF4444).setTitle('Couldn\'t decide trial').setFooter({ text: `${r.error || r.status}` })], components: [] });
    const e = accept
      ? base.setColor(0x22C55E).setTitle('Trial accepted — position kept').setDescription(`<@${r.user_id}> keeps **${r.position}** permanently.`).setFooter({ text: `Decided by ${interaction.user.username} · USGRP Network Transfer` })
      : base.setColor(0xF59E0B).setTitle('Trial rejected — reverted').setDescription(`<@${r.user_id}> reverted${r.reverted_to ? ` to **${r.reverted_to}**` : ' — network verification removed (they held nothing before)'}.`).setFooter({ text: `Decided by ${interaction.user.username} · USGRP Network Transfer` });
    await logAction(interaction.client, { action: `Network Trial ${accept ? 'Accepted' : 'Rejected'}`, target: { discordId: r.user_id }, moderator: { discordId: interaction.user.id, name: interaction.user.username }, reason: accept ? r.position : `reverted to ${r.reverted_to || 'none'}`, color: accept ? 0x22C55E : 0xF59E0B }).catch(() => {});
    // Founders get the outcome too.
    await notifyFounders(interaction.client, new EmbedBuilder().setColor(accept ? 0x22C55E : 0xF59E0B)
      .setTitle(accept ? '✅ Network trial accepted' : '↩️ Network trial reverted')
      .setDescription(accept ? `<@${r.user_id}> keeps **${r.position}** permanently.` : `<@${r.user_id}> reverted${r.reverted_to ? ` to **${r.reverted_to}**` : ' — verification removed (held nothing before)'}.`)
      .addFields({ name: 'Decided by', value: `<@${interaction.user.id}>`, inline: true })
      .setFooter({ text: 'USGRP · Network Transfer' }).setTimestamp());
    // Tell the affected staffer the outcome of their trial.
    await dmUser(interaction.client, r.user_id, new EmbedBuilder().setColor(accept ? 0x22C55E : 0xF59E0B)
      .setTitle(accept ? `Your trial was accepted — you keep ${r.position}` : 'Your trial ended — position reverted')
      .setDescription(accept ? `Congratulations — your trial as **${r.position}** is now permanent. Your roles across the network stay as they are.` : `Your trial has ended and you've been returned${r.reverted_to ? ` to **${r.reverted_to}**` : ' to your previous state (network verification removed)'}. Your roles and nickname have been updated accordingly.`)
      .setFooter({ text: 'USGRP · Network Transfer' }).setTimestamp());
    return interaction.editReply({ embeds: [e], components: [] });
  }
  if (!id.startsWith(`nettransfer_apply${SEP}`)) return;

  const perm = await canUseCommand('network-transfer', interaction);
  if (!perm.allowed) return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });
  await interaction.deferUpdate();
  const parts = id.split(SEP);
  const targetId = parts[1];
  const seatNo = Number(parts[2]) || null;
  const days = Number(parts[3]) || 0;
  const position = parts[4];
  const name = parts.slice(5).join(SEP) || null;

  // Server-side rank guard — a crafted customId can't move someone above the
  // actor's own rank even if the picker filter were bypassed.
  if (!await actorMayAssign(interaction, position)) {
    const denied = EmbedBuilder.from(interaction.message.embeds[0]).setColor(0xEF4444).setTitle('Above your rank')
      .setDescription(`${E.cross} You can't transfer someone into **${position}** — it's above your own rank.`).setFooter({ text: 'USGRP · Network Transfer' });
    return interaction.editReply({ embeds: [denied], components: [] });
  }

  const applying = EmbedBuilder.from(interaction.message.embeds[0]).setColor(0x5865F2).setTitle(`${days === 0 ? 'Transferring' : 'Starting trial'} — ${position}…`).setFooter({ text: 'Syncing roles across the network…' });
  await interaction.editReply({ embeds: [applying], components: [] });

  const r = await networkVerifyApi.transfer(targetId, position, interaction.user.id, seatNo, name, days);
  if (!r.ok) {
    const retry = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`nettransfer_apply${SEP}${targetId}${SEP}${seatNo || 0}${SEP}${days}${SEP}${position}${SEP}${name || ''}`).setLabel('Retry').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`nettransfer_cancel${SEP}${targetId}`).setLabel('Cancel').setStyle(ButtonStyle.Danger),
    );
    const fail = EmbedBuilder.from(interaction.message.embeds[0]).setColor(0xEF4444).setTitle('Transfer failed').setDescription(`${E.cross} ${r.error === 'trial_in_progress' ? 'That person already has an active trial — decide that one first.' : (r.error || r.status)}`).setFooter({ text: 'USGRP · Network Transfer' });
    return interaction.editReply({ embeds: [fail], components: [retry] });
  }

  const trialLine = r.is_trial ? `\n\n⏳ **Trial** — ends <t:${Math.floor(new Date(r.trial.ends_at).getTime() / 1000)}:R>. An approver will be asked to keep or revert it then.` : '';
  const final = new EmbedBuilder().setColor(r.is_trial ? 0xF59E0B : 0x22C55E)
    .setTitle(r.is_trial ? `Trial started — ${position}` : `Transferred — ${position}`)
    .setDescription(`<@${targetId}>${r.transferred_from ? ` moved from **${r.transferred_from}** to` : ' is now'} **${position}**${r.seat_no ? ` · seat ${r.seat_no}` : ''}. They no longer hold their old position.${trialLine}`)
    .addFields(
      { name: 'Nickname', value: r.nickname || '—', inline: true },
      { name: 'Servers', value: `${r.servers_applied}/${r.servers_total} applied`, inline: true },
      { name: 'Type', value: trialLabel(days), inline: true },
    )
    .setFooter({ text: 'Roles + nickname synced · hierarchy updated · USGRP Network Transfer' }).setTimestamp();
  await logAction(interaction.client, { action: r.is_trial ? 'Network Position Trial Started' : 'Network Position Transferred', target: { discordId: targetId }, moderator: { discordId: interaction.user.id, name: interaction.user.username }, reason: `${r.transferred_from || 'none'} → ${position}${r.is_trial ? ` (${days}d trial)` : ''}`, color: r.is_trial ? 0xF59E0B : 0x22C55E }).catch(() => {});

  // Notify the FOUNDERS (Dion + Evan) — they want a heads-up on every move.
  await notifyFounders(interaction.client, new EmbedBuilder().setColor(r.is_trial ? 0xF59E0B : 0x22C55E)
    .setTitle(r.is_trial ? '⏳ Network position trial started' : '🔀 Network position transferred')
    .setDescription(`<@${targetId}>${r.transferred_from ? ` moved from **${r.transferred_from}** to` : ' is now'} **${position}**${r.seat_no ? ` · seat ${r.seat_no}` : ''}.${r.is_trial ? `\n\nTrial ends <t:${Math.floor(new Date(r.trial.ends_at).getTime() / 1000)}:R> — the approver will be asked to keep or revert.` : ''}`)
    .addFields({ name: 'Approved by', value: `<@${interaction.user.id}>`, inline: true }, { name: 'Type', value: trialLabel(days), inline: true })
    .setFooter({ text: 'USGRP · Network Transfer' }).setTimestamp());

  // DM the AFFECTED staffer so they know their own position changed.
  await dmUser(interaction.client, targetId, new EmbedBuilder().setColor(r.is_trial ? 0xF59E0B : 0x5865F2)
    .setTitle(r.is_trial ? `You're on a ${days}-day trial as ${position}` : `You've moved to ${position}`)
    .setDescription(`${r.transferred_from ? `You've moved from **${r.transferred_from}** to` : 'You are now'} **${position}**${r.seat_no ? ` · seat ${r.seat_no}` : ''} across the USGRP network. Your roles and nickname have been updated.${r.is_trial ? `\n\n⏳ This is a **trial** — it ends <t:${Math.floor(new Date(r.trial.ends_at).getTime() / 1000)}:R>. An approver will then decide whether you keep it or return to your previous position.` : ''}`)
    .setFooter({ text: 'USGRP · Network Transfer' }).setTimestamp());

  // Refresh the #structure org charts (aspire-bot already rewrote structure.json).
  (async () => {
    try {
      const { createRequire } = await import('node:module');
      const { updateStructure } = createRequire(import.meta.url)('/home/vpcommunityorganisation/clawd/services/hierarchy-admin/scripts/post-network-structure.cjs');
      await updateStructure({ token: process.env.DISCORD_BOT_TOKEN, channelId: '1516284990168764586' });
    } catch (e) { console.error('[network-transfer] structure refresh failed:', e?.message); }
  })();

  try { await interaction.editReply({ embeds: [final], components: [] }); }
  catch { await interaction.message.edit({ embeds: [final], components: [] }).catch(() => {}); }
}
