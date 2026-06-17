// Unified /office PANEL — one ephemeral, menu-and-button interface for managing
// office voice channels (gov-bot style). Superuser only. All component/modal
// customIds use the 'officep:' prefix and route here from index.js.
import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType,
  StringSelectMenuBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder,
  UserSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import {
  listOffices, firstWaitingRoom, listWaitingRooms, getOffice, upsertOffice, deleteOffice,
  upsertWaitingRoom, grantKey, revokeKey, getAllowlist, addAllowed, removeAllowed,
  canAccessOffice, isSuper, setRequestFeed, getRequestFeed,
} from '../services/officeManager.js';
import { E } from '../lib/emoji.js';

const DRAFTS = new Map();                                   // userId → in-progress selections
const draft = uid => { if (!DRAFTS.has(uid)) DRAFTS.set(uid, {}); return DRAFTS.get(uid); };
const reset = uid => DRAFTS.set(uid, {});
const backBtn = () => new ButtonBuilder().setCustomId('officep:home').setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji(E.arrow_left);
const vcSelect = (cid, ph) => new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId(cid).setChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice).setPlaceholder(ph));
const textSelect = (cid, ph) => new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId(cid).setChannelTypes(ChannelType.GuildText).setPlaceholder(ph));

export function buildHome(guild, note = null) {
  const offices = listOffices(guild.id), wr = firstWaitingRoom(guild.id), rf = getRequestFeed(guild.id);
  const list = offices.length
    ? offices.map(o => `\`rank ${o.rank ?? 100}\` <#${o.channel_id}> → ${o.owner_role_id ? `<@&${o.owner_role_id}>` : '*allowlist only*'}`).join('\n')
    : '*No offices configured yet — choose "Set up an office".*';
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('🏢 Office Manager')
    .setDescription(`${note ? note + '\n\n' : ''}Control who can access each office voice channel.\n\n${list}`)
    .addFields(
      { name: 'Waiting room', value: wr ? `<#${wr.channel_id}>` : '*not set*', inline: true },
      { name: 'Request channel', value: rf ? `<#${rf}>` : '*waiting-room chat*', inline: true },
    )
    .setFooter({ text: 'Lower rank = more senior. Seniors can reach junior offices. Superusers bypass all VCs.' });
  const nav = new StringSelectMenuBuilder().setCustomId('officep:nav').setPlaceholder('Choose what to do…').addOptions(
    { label: 'Set up an office', value: 'setoffice', emoji: '🏢', description: 'Pick a VC, owner role and rank' },
    { label: 'Set the waiting room', value: 'waiting', emoji: '🚪', description: 'Where unauthorised joiners go' },
    { label: 'Set the request channel', value: 'reqchannel', emoji: '📨', description: 'Text channel where access requests post' },
    { label: 'Grant a key', value: 'key', emoji: '🔑', description: 'Temporary access for someone' },
    { label: 'Revoke a key', value: 'revoke', emoji: '🗝️', description: "Take back someone's key" },
    { label: 'Edit office allowlist', value: 'allow', emoji: '👤', description: 'Per-person access (e.g. Ownership)' },
    { label: 'Remove an office', value: 'remove', emoji: '🗑️', description: 'Stop managing a channel' },
  );
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(nav)], flags: 64 };
}

function setOfficeView(guild, uid) {
  const d = draft(uid);
  const rows = [
    vcSelect('officep:ch:setoffice', '1) Pick the office voice channel'),
    new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('officep:role:setoffice').setPlaceholder('2) Pick the role that owns it')),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('officep:btn:setrank').setLabel('3) Set rank & save').setStyle(ButtonStyle.Success).setDisabled(!(d.channel && d.role)),
      backBtn()),
  ];
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('🏢 Set up an office')
    .setDescription(`Pick the channel and its owner role, then set the rank.\n\n**Channel:** ${d.channel ? `<#${d.channel}>` : '—'}\n**Owner role:** ${d.role ? `<@&${d.role}>` : '—'}`);
  return { embeds: [embed], components: rows };
}

function keyView(guild, uid) {
  const d = draft(uid);
  const rows = [
    vcSelect('officep:ch:key', '1) Pick the office'),
    new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId('officep:user:key').setPlaceholder('2) Pick who gets the key')),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('officep:btn:keydur').setLabel('3) Set duration & grant').setStyle(ButtonStyle.Success).setDisabled(!(d.channel && d.keyuser)),
      backBtn()),
  ];
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('🔑 Grant a key')
    .setDescription(`Give someone temporary access to an office.\n\n**Office:** ${d.channel ? `<#${d.channel}>` : '—'}\n**Member:** ${d.keyuser ? `<@${d.keyuser}>` : '—'}`);
  return { embeds: [embed], components: rows };
}

function revokeView(guild, uid) {
  const d = draft(uid);
  const rows = [
    vcSelect('officep:ch:revoke', '1) Pick the office'),
    new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId('officep:user:revoke').setPlaceholder('2) Pick whose key to revoke').setDisabled(!d.channel)),
    new ActionRowBuilder().addComponents(backBtn()),
  ];
  const embed = new EmbedBuilder().setColor(0xF59E0B).setTitle('🗝️ Revoke a key')
    .setDescription(`**Office:** ${d.channel ? `<#${d.channel}>` : '— pick one first'}\n\nPicking a member revokes their key for that office.`);
  return { embeds: [embed], components: rows };
}

function allowView(guild, uid) {
  const d = draft(uid);
  const rows = [vcSelect('officep:ch:allow', '1) Pick the office')];
  let current = '';
  if (d.channel) {
    const ids = getAllowlist(d.channel);
    current = ids.length ? ids.map(i => `<@${i}>`).join(' ') : '*nobody*';
    rows.push(new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId('officep:user:allowadd').setPlaceholder('Add a person')));
    if (ids.length) rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('officep:sel:allowremove').setPlaceholder('Remove a person').addOptions(ids.slice(0, 25).map(i => ({ label: i, value: i })))));
  }
  rows.push(new ActionRowBuilder().addComponents(backBtn()));
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('👤 Office allowlist')
    .setDescription(`Per-person access on top of roles/ranks.\n\n**Office:** ${d.channel ? `<#${d.channel}>` : '— pick one first'}${d.channel ? `\n**Allowed:** ${current}` : ''}`);
  return { embeds: [embed], components: rows };
}

function removeOfficeView(guild) {
  const offices = listOffices(guild.id);
  const rows = offices.length
    ? [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('officep:sel:removeoffice').setPlaceholder('Pick an office to stop managing')
        .addOptions(offices.slice(0, 25).map(o => ({ label: (o.channel_name || o.channel_id).slice(0, 100), value: o.channel_id, description: `rank ${o.rank ?? 100}` })))),
       new ActionRowBuilder().addComponents(backBtn())]
    : [new ActionRowBuilder().addComponents(backBtn())];
  return { embeds: [new EmbedBuilder().setColor(0xF59E0B).setTitle('🗑️ Remove an office').setDescription(offices.length ? 'Pick an office below to stop managing it.' : '*No offices configured.*')], components: rows };
}

function viewFor(action, guild, uid) {
  reset(uid); draft(uid).action = action;
  if (action === 'setoffice') return setOfficeView(guild, uid);
  if (action === 'waiting') return { embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🚪 Set the waiting room').setDescription('Pick the voice channel to use as the waiting room.')], components: [vcSelect('officep:ch:waiting', 'Pick the waiting-room channel'), new ActionRowBuilder().addComponents(backBtn())] };
  if (action === 'reqchannel') return { embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('📨 Set the request channel').setDescription('Pick the **text channel** where office access requests should be posted (and the owners pinged). Leave it unset to use the waiting-room chat.')], components: [textSelect('officep:ch:reqchannel', 'Pick the request text channel'), new ActionRowBuilder().addComponents(backBtn())] };
  if (action === 'key') return keyView(guild, uid);
  if (action === 'revoke') return revokeView(guild, uid);
  if (action === 'allow') return allowView(guild, uid);
  if (action === 'remove') return removeOfficeView(guild);
  return buildHome(guild);
}

// Move anyone in an office who isn't authorised into the waiting room.
async function sweep(guild, channelId) {
  const vc = guild.channels.cache.get(channelId), office = getOffice(channelId), wr = firstWaitingRoom(guild.id);
  if (!vc?.members || !office) return;
  for (const [, m] of vc.members) { if (m.user.bot) continue; if (!canAccessOffice(m, office)) { if (wr && wr.channel_id !== channelId) await m.voice.setChannel(wr.channel_id).catch(() => {}); else await m.voice.disconnect().catch(() => {}); } }
}

export async function handlePanel(interaction, client) {
  const id = interaction.customId, uid = interaction.user.id, guild = interaction.guild;
  if (!guild) return interaction.reply({ content: `${E.cross} Use this in a server.`, flags: 64 }).catch(() => {});
  if (!isSuper(uid)) return interaction.reply({ content: `${E.cross} This is for superusers only.`, flags: 64 }).catch(() => {});
  const v = interaction.values?.[0];
  try {
    if (id === 'officep:home') { reset(uid); return interaction.update(buildHome(guild)); }
    if (id === 'officep:nav') return interaction.update(viewFor(v, guild, uid));

    // Set office
    if (id === 'officep:ch:setoffice') { draft(uid).channel = v; return interaction.update(setOfficeView(guild, uid)); }
    if (id === 'officep:role:setoffice') { draft(uid).role = v; return interaction.update(setOfficeView(guild, uid)); }
    if (id === 'officep:btn:setrank') {
      const d = draft(uid);
      if (!d.channel || !d.role) return interaction.reply({ content: `${E.cross} Pick a channel and role first.`, flags: 64 });
      return interaction.showModal(new ModalBuilder().setCustomId('officep:m:setrank').setTitle('Office rank').addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rank').setLabel('Rank — 0 = top, higher = more junior').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('e.g. 3'))));
    }
    if (id === 'officep:m:setrank') {
      const d = draft(uid); const rank = parseInt(interaction.fields.getTextInputValue('rank'), 10);
      if (isNaN(rank) || rank < 0 || rank > 100) return interaction.reply({ content: `${E.cross} Rank must be a number 0–100.`, flags: 64 });
      const ch = guild.channels.cache.get(d.channel);
      upsertOffice(guild.id, d.channel, ch?.name || 'Office', d.role, rank);
      await sweep(guild, d.channel);
      const note = `${E.check} <#${d.channel}> → <@&${d.role}> at rank ${rank}.`; reset(uid);
      return interaction.update(buildHome(guild, note));
    }

    // Waiting room
    if (id === 'officep:ch:waiting') { const ch = guild.channels.cache.get(v); upsertWaitingRoom(guild.id, v, ch?.name || 'Waiting Room'); return interaction.update(buildHome(guild, `${E.check} Waiting room set to <#${v}>.`)); }

    // Request channel — where access requests post (falls back to waiting-room chat).
    if (id === 'officep:ch:reqchannel') { setRequestFeed(guild.id, v); return interaction.update(buildHome(guild, `${E.check} Office access requests will now post in <#${v}>.`)); }

    // Key
    if (id === 'officep:ch:key') { if (!getOffice(v)) return interaction.reply({ content: `${E.cross} That isn't a managed office — set it up first.`, flags: 64 }); draft(uid).channel = v; return interaction.update(keyView(guild, uid)); }
    if (id === 'officep:user:key') { draft(uid).keyuser = v; return interaction.update(keyView(guild, uid)); }
    if (id === 'officep:btn:keydur') {
      const d = draft(uid); if (!d.channel || !d.keyuser) return interaction.reply({ content: `${E.cross} Pick an office and a member first.`, flags: 64 });
      return interaction.showModal(new ModalBuilder().setCustomId('officep:m:keydur').setTitle('Key duration').addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('minutes').setLabel('How many minutes?').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('e.g. 120'))));
    }
    if (id === 'officep:m:keydur') {
      const d = draft(uid); const minutes = parseInt(interaction.fields.getTextInputValue('minutes'), 10);
      if (isNaN(minutes) || minutes < 1 || minutes > 20160) return interaction.reply({ content: `${E.cross} Minutes must be 1–20160.`, flags: 64 });
      const expires = Date.now() + minutes * 60_000;
      grantKey(d.channel, d.keyuser, expires, uid);
      const ch = guild.channels.cache.get(d.channel);
      client.users.fetch(d.keyuser).then(u => u.send({ embeds: [new EmbedBuilder().setColor(0x22C55E).setTitle('Office key granted').setDescription(`${E.check} You can access **${ch?.name || 'an office'}** until <t:${Math.floor(expires / 1000)}:R>.`)] })).catch(() => {});
      const note = `${E.check} Gave <@${d.keyuser}> a key to <#${d.channel}> until <t:${Math.floor(expires / 1000)}:R>.`; reset(uid);
      return interaction.update(buildHome(guild, note));
    }

    // Revoke
    if (id === 'officep:ch:revoke') { draft(uid).channel = v; return interaction.update(revokeView(guild, uid)); }
    if (id === 'officep:user:revoke') { const d = draft(uid); if (!d.channel) return interaction.reply({ content: `${E.cross} Pick an office first.`, flags: 64 }); revokeKey(d.channel, v); const note = `${E.warning} Revoked <@${v}>'s key for <#${d.channel}>.`; reset(uid); return interaction.update(buildHome(guild, note)); }

    // Allowlist
    if (id === 'officep:ch:allow') { draft(uid).channel = v; return interaction.update(allowView(guild, uid)); }
    if (id === 'officep:user:allowadd') { const d = draft(uid); if (!d.channel) return interaction.reply({ content: `${E.cross} Pick an office first.`, flags: 64 }); addAllowed(d.channel, v, uid); return interaction.update(allowView(guild, uid)); }
    if (id === 'officep:sel:allowremove') { const d = draft(uid); if (d.channel) removeAllowed(d.channel, v); return interaction.update(allowView(guild, uid)); }

    // Remove office
    if (id === 'officep:sel:removeoffice') { deleteOffice(v); return interaction.update(buildHome(guild, `${E.warning} Stopped managing <#${v}>.`)); }
  } catch (e) {
    console.error('[officePanel]', e.message);
    if (!interaction.replied && !interaction.deferred) interaction.reply({ content: `${E.cross} Something went wrong: ${e.message}`, flags: 64 }).catch(() => {});
  }
}
