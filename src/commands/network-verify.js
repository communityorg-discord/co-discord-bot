// COMMAND_PERMISSION_FALLBACK: superuser_only
// USGRP NETWORK-staff verification — wholly separate from CO verify and from
// USGRP RP-staff verify. Pick a network position for a user; preview the exact
// roles, global nickname and target servers (dry run); approve to apply roles +
// nickname across the USGRP network, mint + DM invites, record it and post the
// audit to #verification-queue. The actual work runs on aspire-bot (in every
// USGRP server with admin perms); this command is the picker + approval card.
import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { networkVerifyApi } from '../utils/aspireInternal.js';
import { logAction } from '../utils/logger.js';
import { E } from '../lib/emoji.js';

const SEP = '~'; // network position names contain spaces + "|" but never "~"
const short = (name) => name.replace('USGRP | ', '');

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
      description: `${p.group} · nickname "${p.short_title}"`.slice(0, 100),
      value: p.position.slice(0, 100),
    })));
  const e = new EmbedBuilder().setColor(0x5865F2).setTitle('Network Staff Verification')
    .setDescription(`Verifying <@${target.id}>.\n\nChoose the network position to assign — I'll show you the exact roles, global nickname and servers before anything is applied.`)
    .setFooter({ text: 'USGRP · Network Verification' });
  return interaction.editReply({ embeds: [e], components: [new ActionRowBuilder().addComponents(menu)] });
}

export async function handleSelect(interaction) {
  const id = interaction.customId;
  // Step 1: position chosen → if the seat has multiple slots, ask which one.
  if (id.startsWith(`netverify_pos${SEP}`)) {
    await interaction.deferUpdate();
    const targetId = id.split(SEP)[1];
    const position = interaction.values[0];
    const seats = await networkVerifyApi.seats(position);
    if (seats.ok && (seats.count || 1) > 1) {
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
    return renderPreview(interaction, targetId, position, null);
  }
  // Step 1b: seat chosen → preview.
  if (id.startsWith(`netverify_seat${SEP}`)) {
    await interaction.deferUpdate();
    const parts = id.split(SEP);
    return renderPreview(interaction, parts[1], parts.slice(2).join(SEP), Number(interaction.values[0]) || null);
  }
}

async function renderPreview(interaction, targetId, position, seatNo) {
  const pre = await networkVerifyApi.preview(targetId, position);
  if (!pre.ok) return interaction.editReply({ content: `${E.cross} Preview failed: ${pre.error || pre.status}`, embeds: [], components: [] });

  const satLabel = pre.group === 'FSA'
    ? '(same as main — FSA gets full roles everywhere)'
    : (pre.roles_satellite || []).map(r => `\`${r}\``).join(' ');
  const e = new EmbedBuilder().setColor(0xF59E0B).setTitle(`Dry run — ${position}${seatNo ? ` (seat ${seatNo})` : ''}`)
    .setDescription(`**<@${targetId}>** → **${position}**${seatNo ? ` · **seat ${seatNo}**` : ''}\nNothing is applied until you approve.`)
    .addFields(
      { name: 'Global nickname', value: pre.nickname || '—', inline: true },
      { name: 'Servers', value: `${pre.server_count}`, inline: true },
      { name: 'Roles on the main server', value: (pre.roles_main || []).map(r => `\`${r}\``).join(' ').slice(0, 1024) || '—' },
      { name: 'Roles on each satellite server', value: (satLabel || '—').slice(0, 1024) },
      { name: 'On every server', value: `\`${pre.network_staff_role}\`` },
      { name: `Target servers (${pre.server_count})`, value: (pre.servers || []).map(s => short(s.name)).join(', ').slice(0, 1024) || '—' },
    )
    .setFooter({ text: 'Approve to apply roles + nickname + send 7-day invites · USGRP Network Verification' });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`netverify_apply${SEP}${targetId}${SEP}${seatNo || 0}${SEP}${position}`).setLabel('Approve & sync').setStyle(ButtonStyle.Success),
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
  const position = parts.slice(3).join(SEP);

  const applying = EmbedBuilder.from(interaction.message.embeds[0]).setColor(0x5865F2)
    .setTitle(`Applying — ${position}…`).setFooter({ text: 'Syncing roles across the network…' });
  await interaction.editReply({ embeds: [applying], components: [] });

  const r = await networkVerifyApi.apply(targetId, position, interaction.user.id, seatNo);
  const final = r.ok
    ? new EmbedBuilder().setColor(0x22C55E).setTitle(`Verified — ${position}${r.seat_no ? ` (seat ${r.seat_no})` : ''}`)
        .setDescription(`<@${targetId}> is now **${position}**${r.seat_no ? ` · seat ${r.seat_no}` : ''}.`)
        .addFields(
          { name: 'Nickname', value: r.nickname || '—', inline: true },
          { name: 'Servers', value: `${r.servers_applied}/${r.servers_total} applied · ${r.invites} invites DM'd`, inline: true },
          { name: 'Roles granted', value: (r.roles || []).map(x => `\`${x}\``).join(' ').slice(0, 1024) || '—' },
        )
        .setFooter({ text: 'Roles synced + invites sent + audit posted · USGRP Network Verification' }).setTimestamp()
    : EmbedBuilder.from(interaction.message.embeds[0]).setColor(0xEF4444).setTitle('Apply failed')
        .setDescription(`${E.cross} ${r.error || r.status}`).setFooter({ text: 'USGRP Network Verification' });

  if (r.ok) {
    await logAction(interaction.client, {
      action: 'Network Staff Verified',
      target: { discordId: targetId },
      moderator: { discordId: interaction.user.id, name: interaction.user.username },
      reason: `${position} — ${r.servers_applied}/${r.servers_total} servers, ${r.invites} invites`,
      color: 0x22C55E,
    }).catch(() => {});
  }
  // A long apply (≈19 guilds) can make the interaction webhook flaky by the time
  // it returns — fall back to a direct message edit (works now the card isn't
  // ephemeral) so the embed ALWAYS flips from "Applying…".
  try { await interaction.editReply({ embeds: [final], components: [] }); }
  catch { await interaction.message.edit({ embeds: [final], components: [] }).catch(e => console.error('[netverify] final card update failed:', e?.message)); }
}
