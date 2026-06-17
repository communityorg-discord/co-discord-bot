// COMMAND_PERMISSION_FALLBACK: superuser_only
// USGRP NETWORK-staff verification — wholly separate from CO verify and from
// USGRP RP-staff verify. Pick a network position for a user, TYPE their name,
// preview the exact roles, global nickname and target servers (dry run); approve
// to apply roles + nickname across the USGRP network, mint + DM invites, record it
// and post the audit to #verification-queue. The actual work runs on aspire-bot
// (in every USGRP server with admin perms); this command is the picker + approval.
import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { networkVerifyApi } from '../utils/aspireInternal.js';
import { logAction } from '../utils/logger.js';
import { E } from '../lib/emoji.js';

const SEP = '~'; // network position names contain spaces + "|" but never "~"
const short = (name) => name.replace('USGRP | ', '');

// USGRP | Network Staff Hub — EVERY network-staff member (every position, down to
// Junior Mod) gets an invite + their network roles here. aspire-bot (the engine)
// isn't in this server, but THIS (CO Utilities) bot is, so it handles the Hub.
const STAFF_HUB_ID = '1357119461957570570';
const STAFF_HUB_NAME = 'Network Staff Hub';
async function applyStaffHub(client, targetId, roleNames, nickname) {
  const out = { invite: null, applied: 0 };
  const hub = client.guilds.cache.get(STAFF_HUB_ID);
  if (!hub) return out;
  try {
    await hub.roles.fetch();
    const member = await hub.members.fetch(targetId).catch(() => null);
    if (member) {
      for (const name of (roleNames || [])) {
        const role = hub.roles.cache.find(x => x.name === name);
        if (role && !member.roles.cache.has(role.id)) { await member.roles.add(role, 'Network verify — Staff Hub').catch(() => {}); out.applied++; }
      }
      // Set their network nickname in the Hub too (best-effort — fails silently if
      // they outrank the bot). Without this they keep their join nick (e.g. a gov title).
      if (nickname) await member.setNickname(nickname, 'Network verify — Staff Hub').catch(() => {});
    }
    // The Staff Hub invite is created with the other mandatory-server invites
    // below (one-time use, 30-min, tracked) — not here.
  } catch (e) { console.error('[netverify] staff-hub failed:', e?.message); }
  return out;
}

// Best-guess for the name field — strip anything after "|" off the cached display
// name. Cache-only (no awaited fetch) so showModal stays inside the 3s window.
function guessName(interaction, targetId) {
  const m = interaction.guild?.members?.cache?.get(targetId);
  const u = interaction.client.users.cache.get(targetId);
  const raw = m?.displayName || u?.globalName || u?.username || '';
  return String(raw).split('|')[0].trim().slice(0, 24);
}

// The "What's their name?" modal — shown after the position (and seat) is picked.
function nameModal(targetId, seatNo, position, prefill) {
  const modal = new ModalBuilder()
    .setCustomId(`netverify_name${SEP}${targetId}${SEP}${seatNo || 0}${SEP}${position}`)
    .setTitle('Network Verification');
  const input = new TextInputBuilder()
    .setCustomId('name')
    .setLabel("What's their name?")
    .setPlaceholder('e.g. Dion M.')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(24)
    .setRequired(true);
  if (prefill) input.setValue(prefill);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

export const data = new SlashCommandBuilder()
  .setName('network-verify')
  .setDescription('Verify a USGRP network-staff member and sync their roles across the network')
  .addUserOption(o => o.setName('user').setDescription('The network staff member to verify').setRequired(true));

export async function execute(interaction) {
  await interaction.deferReply(); // public — it's a verification card others can see + approve
  const perm = await canUseCommand('network-verify', interaction);
  if (!perm.allowed) return interaction.editReply({ content: `${E.cross} ${perm.reason}` });

  const target = interaction.options.getUser('user');
  const res = await networkVerifyApi.positions();
  if (!res.ok || !Array.isArray(res.positions) || !res.positions.length) {
    return interaction.editReply({ content: `${E.cross} Couldn't load network positions from aspire-bot (${res.error || res.status}).` });
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`netverify_pos${SEP}${target.id}`)
    .setPlaceholder('Choose the network position…')
    .addOptions(res.positions.slice(0, 25).map(p => ({
      label: p.position.slice(0, 100),
      description: `${p.group} · nickname "${p.short_title}, ${p.group}"`.slice(0, 100),
      value: p.position.slice(0, 100),
    })));
  const e = new EmbedBuilder().setColor(0x5865F2).setTitle('Network Staff Verification')
    .setDescription(`Verifying <@${target.id}>.\n\nChoose the network position to assign — I'll ask for their name, then show you the exact roles, global nickname and servers before anything is applied.`)
    .setFooter({ text: 'USGRP · Network Verification' });
  return interaction.editReply({ embeds: [e], components: [new ActionRowBuilder().addComponents(menu)] });
}

export async function handleSelect(interaction) {
  const id = interaction.customId;
  // Step 1: position chosen → if the seat has multiple slots, ask which one;
  // otherwise jump straight to the name modal. (No deferUpdate before showModal —
  // a modal must be the first response to the interaction.)
  if (id.startsWith(`netverify_pos${SEP}`)) {
    const targetId = id.split(SEP)[1];
    const position = interaction.values[0];
    const seats = await networkVerifyApi.seats(position);
    if (seats.ok && (seats.count || 1) > 1) {
      await interaction.deferUpdate();
      const taken = new Map((seats.taken || []).filter(t => t.seat_no).map(t => [Number(t.seat_no), t.name]));
      const posLabel = position.replace(/\s*\|\s*/, ' '); // "FSA | Member" → "FSA Member"
      const opts = [];
      for (let n = 1; n <= seats.count && opts.length < 25; n++) {
        const who = taken.get(n);
        opts.push({ label: `${posLabel} ${n}`.slice(0, 100), description: (who ? `Held by ${who} — re-assigns` : 'Open').slice(0, 100), value: String(n) });
      }
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`netverify_seat${SEP}${targetId}${SEP}${position}`)
        .setPlaceholder('Which seat?')
        .addOptions(opts);
      const e = new EmbedBuilder().setColor(0x5865F2).setTitle('Network Staff Verification')
        .setDescription(`**<@${targetId}>** → **${position}**\nThis seat has **${seats.count} slots** — pick which one to fill.`)
        .setFooter({ text: 'USGRP · Network Verification' });
      return interaction.editReply({ embeds: [e], components: [new ActionRowBuilder().addComponents(menu)] });
    }
    return interaction.showModal(nameModal(targetId, null, position, guessName(interaction, targetId)));
  }
  // Step 1b: seat chosen → ask the name.
  if (id.startsWith(`netverify_seat${SEP}`)) {
    const parts = id.split(SEP);
    const targetId = parts[1];
    const position = parts.slice(2).join(SEP);
    const seatNo = Number(interaction.values[0]) || null;
    return interaction.showModal(nameModal(targetId, seatNo, position, guessName(interaction, targetId)));
  }
}

// Step 2: name typed → render the dry-run preview.
export async function handleModal(interaction) {
  if (!interaction.customId.startsWith(`netverify_name${SEP}`)) return;
  await interaction.deferUpdate();
  const parts = interaction.customId.split(SEP);
  const targetId = parts[1];
  const seatNo = Number(parts[2]) || null;
  const position = parts.slice(3).join(SEP);
  const name = (interaction.fields.getTextInputValue('name') || '').split(SEP).join('').trim();
  return renderPreview(interaction, targetId, position, seatNo, name);
}

async function renderPreview(interaction, targetId, position, seatNo, name) {
  const pre = await networkVerifyApi.preview(targetId, position, name || '');
  if (!pre.ok) return interaction.editReply({ content: `${E.cross} Preview failed: ${pre.error || pre.status}`, embeds: [], components: [] });

  const satLabel = pre.group === 'FSA'
    ? '(same as main — FSA gets full roles everywhere)'
    : (pre.roles_satellite || []).map(r => `\`${r}\``).join(' ');
  // The Hub isn't one of aspire-bot's guilds (it isn't in it), so add it here so
  // the count + list reflect that EVERY staffer also lands in the Network Staff Hub.
  const total = (pre.server_count || 0) + 1;
  const serverList = [...(pre.servers || []).map(s => short(s.name)), STAFF_HUB_NAME];
  const e = new EmbedBuilder().setColor(0xF59E0B).setTitle(`Dry run — ${position}${seatNo ? ` (seat ${seatNo})` : ''}`)
    .setDescription(`**<@${targetId}>** → **${position}**${seatNo ? ` · **seat ${seatNo}**` : ''}\nNothing is applied until you approve.`)
    .addFields(
      { name: 'Global nickname', value: pre.nickname || '—', inline: true },
      { name: 'Servers', value: `${total}`, inline: true },
      { name: 'Roles on the main server', value: (pre.roles_main || []).map(r => `\`${r}\``).join(' ').slice(0, 1024) || '—' },
      { name: 'Roles on each satellite server', value: (satLabel || '—').slice(0, 1024) },
      { name: 'On every server', value: `\`${pre.network_staff_role}\`` },
      { name: `Target servers (${total})`, value: serverList.join(', ').slice(0, 1024) || '—' },
    )
    .setFooter({ text: 'Approve to apply roles + nickname + send 7-day invites · USGRP Network Verification' });
  const safeName = (name || '').split(SEP).join('');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`netverify_apply${SEP}${targetId}${SEP}${seatNo || 0}${SEP}${position}${SEP}${safeName}`).setLabel('Approve & sync').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`netverify_decline${SEP}${targetId}`).setLabel('Decline').setStyle(ButtonStyle.Danger),
  );
  return interaction.editReply({ embeds: [e], components: [row] });
}

export async function handleButton(interaction) {
  if (interaction.customId.startsWith(`netverify_decline${SEP}`)) {
    await interaction.deferUpdate();
    const e = EmbedBuilder.from(interaction.message.embeds[0]).setColor(0xEF4444).setTitle('Declined')
      .setFooter({ text: 'No roles applied · USGRP Network Verification' });
    return interaction.editReply({ embeds: [e], components: [] });
  }
  if (!interaction.customId.startsWith(`netverify_apply${SEP}`)) return;

  const perm = await canUseCommand('network-verify', interaction);
  if (!perm.allowed) return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });

  await interaction.deferUpdate();
  const parts = interaction.customId.split(SEP);
  const targetId = parts[1];
  const seatNo = Number(parts[2]) || null;
  const position = parts[3];
  const name = parts.slice(4).join(SEP) || null; // typed name (SEP already stripped)

  const applying = EmbedBuilder.from(interaction.message.embeds[0]).setColor(0x5865F2)
    .setTitle(`Applying — ${position}…`).setFooter({ text: 'Syncing roles across the network…' });
  await interaction.editReply({ embeds: [applying], components: [] });

  const r = await networkVerifyApi.apply(targetId, position, interaction.user.id, seatNo, name);

  // Network Staff Hub — every position gets it. aspire-bot (the engine) isn't in
  // this server, so co-bot (which is) applies the roles + mints the invite here.
  // Use the FULL position role set (hub_roles), not the per-satellite granted set
  // (which is empty when the member wasn't already in the satellites).
  let hub = { invite: null, applied: 0 };
  if (r.ok) hub = await applyStaffHub(interaction.client, targetId, (r.hub_roles && r.hub_roles.length) ? r.hub_roles : r.roles, r.nickname);

  // Create invites ONLY to the servers this person is required to be in — via the
  // access system, so they're one-time use, 30-min, and tracked. Department
  // servers are on request through /access.
  const mandatoryInvites = [];
  if (r.ok) {
    try {
      const { bucketsFor, serversFor } = await import('../serverAccess/matrix.js');
      const { createInvite, isInGuild } = await import('../serverAccess/core.js');
      const accessStore = await import('../serverAccess/store.js');
      const b = bucketsFor({ position: r.position, roles: r.roles || [], hub_roles: r.hub_roles || [] });
      const mandatory = b ? serversFor(b.buckets).mandatory : [];
      for (const s of mandatory) {
        if (await isInGuild(interaction.client, s.guildId, targetId)) continue; // already in
        const inv = await createInvite(interaction.client, s);
        if (!inv.ok) continue;
        accessStore.logInvite({ discord_id: targetId, guild_id: s.guildId, server_key: s.key, kind: 'mandatory', reason: 'verification', by_id: interaction.user.id, code: inv.code, link_expires_at: inv.linkExpiresAt });
        mandatoryInvites.push({ name: s.name.replace(/^USGRP \| /, ''), url: inv.url });
      }
    } catch (e) { console.error('[netverify] mandatory invites failed:', e?.message); }
  }

  const roleSet = (r.hub_roles && r.hub_roles.length) ? r.hub_roles : (r.roles || []);
  const pendingServers = mandatoryInvites.length > 0;
  const final = r.ok
    ? new EmbedBuilder().setColor(0x22C55E).setTitle(`Verified — ${position}${r.seat_no ? ` (seat ${r.seat_no})` : ''}`)
        .setDescription(`<@${targetId}> is now **${position}**${r.seat_no ? ` · seat ${r.seat_no}` : ''}.${hub.applied ? `\n\nRoles applied in the **Network Staff Hub**.` : ''}${pendingServers ? `\n\nThey aren't in the other network servers yet, so I've DM'd their invites — **their roles + nickname apply automatically the moment they join each one.**` : ''}`)
        .addFields(
          { name: 'Nickname', value: r.nickname || '—', inline: true },
          { name: 'Servers', value: `${r.servers_applied}/${r.servers_total} roles applied · ${mandatoryInvites.length} required-server invite(s) DM'd`, inline: true },
          { name: 'Roles', value: roleSet.map(x => `\`${x}\``).join(' ').slice(0, 1024) || '—' },
        )
        .setFooter({ text: 'Roles + nickname synced · invites sent · audit posted · USGRP Network Verification' }).setTimestamp()
    : EmbedBuilder.from(interaction.message.embeds[0]).setColor(0xEF4444).setTitle('Apply failed')
        .setDescription(`${E.cross} ${r.error || r.status}`).setFooter({ text: 'USGRP Network Verification' });

  if (r.ok) {
    if (hub.invite) final.addFields({ name: 'Staff Hub', value: `invite sent${hub.applied ? ` · +${hub.applied} roles applied` : ''}`, inline: true });
    // Auto-refresh the #structure org charts now this person is onboarded. The
    // verify engine (aspire-bot) already rewrote structure.json with the new
    // holder, so this just re-renders and EDITS the existing structure messages
    // in place. Background — never blocks the verification response. Wired into
    // the bot itself (this command), NOT routed through a Claude session.
    (async () => {
      try {
        const { createRequire } = await import('node:module');
        const { updateStructure } = createRequire(import.meta.url)('/home/vpcommunityorganisation/clawd/services/hierarchy-admin/scripts/post-network-structure.cjs');
        const res = await updateStructure({ token: process.env.DISCORD_BOT_TOKEN, channelId: '1516284990168764586' });
        console.log(`[network-verify] #structure refreshed: ${JSON.stringify(res)}`);
      } catch (e) { console.error('[network-verify] structure refresh failed:', e?.message); }
    })();
    await logAction(interaction.client, {
      action: 'Network Staff Verified',
      target: { discordId: targetId },
      moderator: { discordId: interaction.user.id, name: interaction.user.username },
      reason: `${position} — ${r.servers_applied}/${r.servers_total} servers, ${r.invites} invites`,
      color: 0x22C55E,
    }).catch(() => {});
    // DM the verified member their REQUIRED-server invites — from THIS (CO
    // Utilities) bot. One-time use, 30-min links, tracked by the access system.
    const lines = mandatoryInvites.map(i => `[${i.name}](${i.url})`).join('\n');
    const dm = new EmbedBuilder().setColor(0x5865F2)
      .setTitle("You've been verified as USGRP Network Staff")
      .setDescription(`You're verified as **${position}**. Your nickname across the network is **${r.nickname}**.\n\nHere are invites to the servers you're **required** to be in. ⏳ Each invite is **one-time use** and **expires in 30 minutes**, so please join soon — your roles apply automatically when you join.\n\n**Server invites**\n${lines || '_You\'re already in all of your required servers._'}\n\n💡 Need a new link, or access to a department server? Just run **/access**.`)
      .setFooter({ text: 'USGRP · Network Verification' }).setTimestamp();
    const targetUser = await interaction.client.users.fetch(targetId).catch(() => null);
    if (targetUser) await targetUser.send({ embeds: [dm] }).catch(() => {});
  }
  // A long apply (≈19 guilds) can make the interaction webhook flaky by the time
  // it returns — fall back to a direct message edit (works now the card isn't
  // ephemeral) so the embed ALWAYS flips from "Applying…".
  try { await interaction.editReply({ embeds: [final], components: [] }); }
  catch { await interaction.message.edit({ embeds: [final], components: [] }).catch(e => console.error('[netverify] final card update failed:', e?.message)); }
}
