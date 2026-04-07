import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, PermissionFlagsBits } from 'discord.js';
import db from '../utils/botDb.js';
import { logAction } from '../utils/logger.js';

// ── DB Helpers ──────────────────────────────────────────────────────────────

export function getOffice(id) {
  return db.prepare('SELECT * FROM offices WHERE id = ?').get(id);
}

export function getOfficeByChannel(guildId, channelId) {
  return db.prepare('SELECT * FROM offices WHERE guild_id = ? AND channel_id = ?').get(guildId, channelId);
}

export function getOfficesByGuild(guildId) {
  return db.prepare('SELECT * FROM offices WHERE guild_id = ? ORDER BY channel_name').all(guildId);
}

export function getWaitingRoomOffice(guildId, channelId) {
  return db.prepare('SELECT * FROM offices WHERE guild_id = ? AND waiting_room_channel_id = ? AND waiting_room_enabled = 1').get(guildId, channelId);
}

export function createOffice({ guildId, channelId, channelName, ownerDiscordId }) {
  return db.prepare(`INSERT INTO offices (guild_id, channel_id, channel_name, owner_discord_id)
    VALUES (?, ?, ?, ?)`).run(guildId, channelId, channelName, ownerDiscordId);
}

export function updateOffice(id, fields) {
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  if (sets.length === 0) return;
  sets.push('updated_at = CURRENT_TIMESTAMP');
  vals.push(id);
  db.prepare(`UPDATE offices SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function deleteOffice(id) {
  db.prepare('DELETE FROM offices WHERE id = ?').run(id);
}

export function getMasterPanel(guildId) {
  return db.prepare('SELECT * FROM office_master_panel WHERE guild_id = ?').get(guildId);
}

export function saveMasterPanel(guildId, channelId, messageId) {
  db.prepare(`INSERT INTO office_master_panel (guild_id, channel_id, message_id)
    VALUES (?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id`
  ).run(guildId, channelId, messageId);
}

// Allowlist
export function getAllowlist(officeId) {
  return db.prepare('SELECT * FROM office_allowlist WHERE office_id = ? ORDER BY added_at').all(officeId);
}

export function addToAllowlist(officeId, discordId, addedBy, entryType = 'user') {
  return db.prepare('INSERT OR IGNORE INTO office_allowlist (office_id, discord_id, added_by, entry_type) VALUES (?, ?, ?, ?)').run(officeId, discordId, addedBy, entryType);
}

export function removeFromAllowlist(officeId, discordId) {
  return db.prepare('DELETE FROM office_allowlist WHERE office_id = ? AND discord_id = ?').run(officeId, discordId);
}

const SUPERUSER_IDS = ['723199054514749450', '415922272956710912', '1013486189891817563', '1355367209249148928', '878775920180228127'];

export function isOnAllowlist(officeId, member) {
  // Superusers always have access
  if (SUPERUSER_IDS.includes(member.id || member)) return true;
  const discordId = member.id || member;
  // Direct user allowlist
  if (db.prepare("SELECT id FROM office_allowlist WHERE office_id = ? AND discord_id = ? AND entry_type = 'user'").get(officeId, discordId)) return true;
  // Role-based allowlist
  if (member.roles?.cache) {
    const roleEntries = db.prepare("SELECT discord_id FROM office_allowlist WHERE office_id = ? AND entry_type = 'role'").all(officeId);
    for (const entry of roleEntries) {
      if (member.roles.cache.has(entry.discord_id)) return true;
    }
  }
  return false;
}

// Keys
export function getKeys(officeId) {
  return db.prepare('SELECT * FROM office_keys WHERE office_id = ? ORDER BY created_at').all(officeId);
}

export function getActiveKeys(officeId) {
  return db.prepare(`SELECT * FROM office_keys WHERE office_id = ? AND (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY created_at`).all(officeId);
}

export function addKey(officeId, roleId, guildId, grantedBy, expiresAt) {
  return db.prepare(`INSERT INTO office_keys (office_id, role_id, guild_id, granted_by, expires_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(office_id, role_id) DO UPDATE SET granted_by = excluded.granted_by, expires_at = excluded.expires_at`
  ).run(officeId, roleId, guildId, grantedBy, expiresAt || null);
}

export function removeKey(officeId, roleId) {
  return db.prepare('DELETE FROM office_keys WHERE office_id = ? AND role_id = ?').run(officeId, roleId);
}

export function getExpiredKeys() {
  return db.prepare(`SELECT ok.*, o.channel_id, o.channel_name, o.owner_discord_id, o.guild_id as office_guild_id
    FROM office_keys ok JOIN offices o ON o.id = ok.office_id
    WHERE ok.expires_at IS NOT NULL AND ok.expires_at <= datetime('now')`).all();
}

// Access requests
export function createAccessRequest(officeId, discordId, username) {
  return db.prepare(`INSERT INTO office_access_requests (office_id, requester_discord_id, requester_username)
    VALUES (?, ?, ?)`).run(officeId, discordId, username);
}

export function getAccessRequest(id) {
  return db.prepare('SELECT * FROM office_access_requests WHERE id = ?').get(id);
}

export function getPendingRequest(guildId, discordId) {
  return db.prepare(`SELECT ar.* FROM office_access_requests ar
    JOIN offices o ON o.id = ar.office_id
    WHERE o.guild_id = ? AND ar.requester_discord_id = ? AND ar.status = 'pending'`).get(guildId, discordId);
}

export function updateAccessRequest(id, fields) {
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  if (sets.length === 0) return;
  vals.push(id);
  db.prepare(`UPDATE office_access_requests SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function getPendingRequests(officeId) {
  return db.prepare("SELECT * FROM office_access_requests WHERE office_id = ? AND status = 'pending' ORDER BY requested_at").all(officeId);
}

// ── Panel Builders ──────────────────────────────────────────────────────────

function statusIcon(office) {
  if (office.is_owner_only) return '\u{1F512}'; // lock
  if (office.is_restricted) return '\u{1F511}'; // key
  return '\u{1F7E2}'; // green circle
}

function statusLabel(office) {
  if (office.is_owner_only) return 'Owner-Only';
  if (office.is_restricted) return 'Restricted';
  return 'Open';
}

export function buildMasterEmbed(offices, guild) {
  const lines = offices.map(o => {
    const icon = statusIcon(o);
    const label = statusLabel(o);
    const vc = guild?.channels?.cache?.get(o.channel_id);
    const memberCount = vc?.members?.size ?? 0;
    const waitingCount = o.waiting_room_enabled && o.waiting_room_channel_id
      ? (guild?.channels?.cache?.get(o.waiting_room_channel_id)?.members?.size ?? 0) : 0;
    let line = `${icon} **${o.channel_name}** \u2014 [${label}] \u2014 ${memberCount} inside`;
    if (waitingCount > 0) line += ` \u2014 ${waitingCount} waiting`;
    return line;
  });

  const embed = new EmbedBuilder()
    .setTitle('\u{1F3E2} CO | OFFICE MANAGEMENT')
    .setColor(0x5865F2)
    .setDescription('Manage voice office restrictions, access keys, allowlists and waiting rooms.')
    .setTimestamp();

  if (lines.length > 0) {
    embed.addFields({ name: 'REGISTERED OFFICES', value: lines.join('\n') || 'None', inline: false });
  } else {
    embed.addFields({ name: 'REGISTERED OFFICES', value: 'No offices registered yet. Click **Register Office** to get started.', inline: false });
  }

  return embed;
}

export function buildMasterButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('office_register').setLabel('\u2795 Register Office').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('office_refresh').setLabel('\u{1F504} Refresh').setStyle(ButtonStyle.Secondary),
  );
}

export function buildOfficeEmbed(office, guild) {
  const vc = guild?.channels?.cache?.get(office.channel_id);
  const members = vc?.members?.filter(m => !m.user.bot);
  const memberNames = members?.map(m => m.displayName).join(', ') || 'Empty';

  const keys = getActiveKeys(office.id);
  const allowlist = getAllowlist(office.id);

  const keyInfo = keys.length > 0
    ? keys.map(k => {
        const role = guild?.roles?.cache?.get(k.role_id);
        const exp = k.expires_at ? `Expires <t:${Math.floor(new Date(k.expires_at).getTime() / 1000)}:R>` : 'Permanent';
        return `@${role?.name || k.role_id} (${exp})`;
      }).join(', ')
    : 'None';

  const restricted = office.is_restricted ? '\u{2705}' : '\u274C';
  const ownerOnly = office.is_owner_only ? '\u{2705}' : '\u274C';
  const keyRequired = keys.length > 0 ? '\u{2705}' : '\u274C';
  const waitingRoom = office.waiting_room_enabled ? '\u{2705}' : '\u274C';

  const embed = new EmbedBuilder()
    .setTitle(`\u{1F3E2} ${office.channel_name}`)
    .setColor(office.is_owner_only ? 0xEF4444 : office.is_restricted ? 0xF59E0B : 0x22C55E)
    .setDescription(
      `**Status:** ${statusIcon(office)} ${statusLabel(office)}  |  **Owner-Only:** ${ownerOnly}  |  **Key:** ${keyRequired}  |  **Waiting Room:** ${waitingRoom}\n` +
      `**Currently inside:** ${memberNames}\n` +
      `**Keys held by:** ${keyInfo}\n` +
      `**Allowlist:** ${allowlist.length} user${allowlist.length !== 1 ? 's' : ''}`
    )
    .setFooter({ text: `Office ID: ${office.id} | Channel: ${office.channel_id}` })
    .setTimestamp();

  return embed;
}

export function buildOfficeButtons(officeId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`office_settings_${officeId}`).setLabel('\u2699\uFE0F Settings').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`office_keys_${officeId}`).setLabel('\u{1F5DD}\uFE0F Keys').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`office_allowlist_${officeId}`).setLabel('\u{1F465} Allowlist').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`office_requests_${officeId}`).setLabel('\u{1F4CB} Requests').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`office_unregister_${officeId}`).setLabel('\u{1F5D1}\uFE0F Unregister').setStyle(ButtonStyle.Danger),
  );
}

// ── Panel Refresh ───────────────────────────────────────────────────────────

export async function refreshOfficePanels(client, guildId) {
  try {
    const panel = getMasterPanel(guildId);
    if (!panel) return;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const channel = guild.channels.cache.get(panel.channel_id) || await guild.channels.fetch(panel.channel_id).catch(() => null);
    if (!channel) return;

    const offices = getOfficesByGuild(guildId);

    // Update master panel
    try {
      const masterMsg = await channel.messages.fetch(panel.message_id).catch(() => null);
      if (masterMsg) {
        await masterMsg.edit({
          embeds: [buildMasterEmbed(offices, guild)],
          components: [buildMasterButtons()]
        });
      }
    } catch (e) {
      console.error('[Office] Master panel refresh error:', e.message);
    }

    // Update each office's individual panel
    for (const office of offices) {
      if (!office.panel_message_id) continue;
      try {
        const officeMsg = await channel.messages.fetch(office.panel_message_id).catch(() => null);
        if (officeMsg) {
          await officeMsg.edit({
            embeds: [buildOfficeEmbed(office, guild)],
            components: [buildOfficeButtons(office.id)]
          });
        }
      } catch (e) {
        console.error(`[Office] Panel refresh error for office ${office.id}:`, e.message);
      }
    }
  } catch (e) {
    console.error('[Office] refreshOfficePanels error:', e.message);
  }
}

// ── Channel Permissions ─────────────────────────────────────────────────────

export async function applyRestriction(guild, office) {
  const vc = guild.channels.cache.get(office.channel_id);
  if (!vc) return;

  if (office.is_restricted) {
    // Set channel topic — enforcement handled by enforceOfficeRestrictions (bot kicks users)
    await vc.setTopic('This channel is restricted 🔒').catch(() => {});
    // Remove all permission overwrites — bot manages access via enforceOfficeRestrictions
    await vc.permissionOverwrites.delete(guild.roles.everyone.id).catch(() => {});
    for (const suId of SUPERUSER_IDS) {
      await vc.permissionOverwrites.delete(suId).catch(() => {});
    }
    if (office.owner_discord_id) {
      await vc.permissionOverwrites.delete(office.owner_discord_id).catch(() => {});
    }
    const keys = getActiveKeys(office.id);
    for (const key of keys) {
      await vc.permissionOverwrites.delete(key.role_id).catch(() => {});
    }
    const allowlist = getAllowlist(office.id);
    for (const entry of allowlist) {
      await vc.permissionOverwrites.delete(entry.discord_id).catch(() => {});
    }
    return;
  }

  if (office.is_owner_only) {
    // Set channel topic
    await vc.setTopic('This channel is restricted 🔒').catch(() => {});
    // Deny @everyone
    await vc.permissionOverwrites.edit(guild.roles.everyone.id, { Connect: false }).catch(e => console.error('[Office] Deny @everyone:', e.message));
    // Owner gets access
    if (office.owner_discord_id) {
      await vc.permissionOverwrites.edit(office.owner_discord_id, { Connect: true }).catch(() => {});
    }
    // Superusers get access
    for (const suId of SUPERUSER_IDS) {
      await vc.permissionOverwrites.edit(suId, { Connect: true }).catch(() => {});
    }
    // Allowlist gets access
    const allowlist = getAllowlist(office.id);
    for (const entry of allowlist) {
      await vc.permissionOverwrites.edit(entry.discord_id, { Connect: true }).catch(() => {});
    }
    return;
  }

  // Open office — clear all overwrites
  await vc.setTopic('').catch(() => {});
  await vc.permissionOverwrites.delete(guild.roles.everyone.id).catch(() => {});
  for (const suId of SUPERUSER_IDS) {
    await vc.permissionOverwrites.delete(suId).catch(() => {});
  }
  if (office.owner_discord_id) {
    await vc.permissionOverwrites.delete(office.owner_discord_id).catch(() => {});
  }
  const keys = getActiveKeys(office.id);
  for (const key of keys) {
    await vc.permissionOverwrites.delete(key.role_id).catch(() => {});
  }
  const allowlist = getAllowlist(office.id);
  for (const entry of allowlist) {
    await vc.permissionOverwrites.delete(entry.discord_id).catch(() => {});
  }
}

export async function removeRestriction(guild, office) {
  const vc = guild.channels.cache.get(office.channel_id);
  if (!vc) return;
  // Remove all office-managed overwrites
  await vc.permissionOverwrites.delete(guild.roles.everyone.id).catch(() => {});
  const keys = getKeys(office.id);
  for (const key of keys) {
    await vc.permissionOverwrites.delete(key.role_id).catch(() => {});
  }
  const allowlist = getAllowlist(office.id);
  for (const entry of allowlist) {
    await vc.permissionOverwrites.delete(entry.discord_id).catch(() => {});
  }
  if (office.owner_discord_id) {
    await vc.permissionOverwrites.delete(office.owner_discord_id).catch(() => {});
  }
}

// ── Waiting Room Flow ───────────────────────────────────────────────────────

export async function handleWaitingRoomJoin(client, voiceState) {
  const member = voiceState.member;
  const guild = voiceState.guild;

  const offices = getOfficesByGuild(guild.id).filter(o => o.is_restricted || o.is_owner_only);

  if (offices.length === 0) {
    await member.send({
      embeds: [new EmbedBuilder().setColor(0x6b7280).setTitle('\u{1F6AA} No Restricted Offices').setDescription('There are currently no restricted offices available to request access to.')]
    }).catch(() => {});
    return;
  }

  const existing = getPendingRequest(guild.id, member.id);
  if (existing) {
    await member.send({
      embeds: [new EmbedBuilder().setColor(0xF59E0B).setTitle('\u23F3 Pending Request').setDescription('You already have a pending access request. Please wait for a response.')]
    }).catch(() => {});
    return;
  }

  const officeOptions = offices.map(o => ({
    label: o.channel_name.slice(0, 100),
    value: String(o.id),
    description: (o.is_owner_only ? 'Owner-Only Office' : 'Restricted Office').slice(0, 100)
  })).slice(0, 25);

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`office_wr_select_${member.id}`)
    .setPlaceholder('Select an office to request access to...')
    .addOptions(officeOptions);

  const row = new ActionRowBuilder().addComponents(selectMenu);

  try {
    await member.send({
      embeds: [new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('\u{1F6AA} Office Access Request')
        .setDescription(`You joined the **Waiting Room** in **${guild.name}**.\n\nPlease select which office you would like to request access to:`)
        .setFooter({ text: 'This request will be sent to the people currently in the office.' })
        .setTimestamp()
      ],
      components: [row]
    });
  } catch (e) {
    console.error('[Office] Could not DM waiting room member:', e.message);
    const channel = guild.channels.cache.get(voiceState.channelId);
    if (channel) {
      const fallback = await channel.send({
        content: `<@${member.id}>`,
        embeds: [new EmbedBuilder().setColor(0xF59E0B).setTitle('\u26A0\uFE0F Enable DMs').setDescription('Please enable DMs from server members so we can process your office access request.')]
      }).catch(() => null);
      if (fallback) setTimeout(() => fallback.delete().catch(() => {}), 15000);
    }
  }
}

// ── Notify Occupants ────────────────────────────────────────────────────────

export async function notifyOfficeOccupants(client, office, requestId, requester) {
  const guild = client.guilds.cache.get(office.guild_id);
  if (!guild) return;

  const voiceChannel = guild.channels.cache.get(office.channel_id);
  if (!voiceChannel) return;

  const occupants = voiceChannel.members?.filter(m => !m.user.bot);

  if (!occupants || occupants.size === 0) {
    const requesterUser = await client.users.fetch(requester.id).catch(() => null);
    if (requesterUser) {
      await requesterUser.send({
        embeds: [new EmbedBuilder().setColor(0xEF4444).setTitle('\u274C Office Empty').setDescription(`There is nobody currently in **${office.channel_name}** to approve your request. Please try again later.`)]
      }).catch(() => {});
    }
    updateAccessRequest(requestId, { status: 'denied', resolved_at: new Date().toISOString() });
    return;
  }

  const approveButton = new ButtonBuilder().setCustomId(`office_approve_${requestId}`).setLabel('\u2705 Approve').setStyle(ButtonStyle.Success);
  const denyButton = new ButtonBuilder().setCustomId(`office_deny_${requestId}`).setLabel('\u274C Deny').setStyle(ButtonStyle.Danger);
  const row = new ActionRowBuilder().addComponents(approveButton, denyButton);

  const approvalEmbed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('\u{1F6AA} Office Access Request')
    .setDescription(`**${requester.tag || requester.username}** is requesting access to join your office.`)
    .addFields(
      { name: 'Office', value: office.channel_name, inline: true },
      { name: 'Requester', value: `<@${requester.id}>`, inline: true },
      { name: 'Requested At', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
    )
    .setFooter({ text: 'This request will expire in 10 minutes if no action is taken.' })
    .setTimestamp();

  for (const [, member] of occupants) {
    try {
      await member.send({ embeds: [approvalEmbed], components: [row] });
    } catch (e) {
      console.error('[Office] Could not DM occupant:', e.message);
    }
  }

  // Auto-expire after 10 minutes
  setTimeout(async () => {
    const req = getAccessRequest(requestId);
    if (req && req.status === 'pending') {
      updateAccessRequest(requestId, { status: 'expired', resolved_at: new Date().toISOString() });
      const requesterUser = await client.users.fetch(requester.id).catch(() => null);
      if (requesterUser) {
        await requesterUser.send({
          embeds: [new EmbedBuilder().setColor(0x6b7280).setTitle('\u23F0 Request Expired').setDescription(`Your request to join **${office.channel_name}** expired after 10 minutes with no response.`)]
        }).catch(() => {});
      }
    }
  }, 10 * 60 * 1000);
}

// ── Enforcement ─────────────────────────────────────────────────────────────

export async function enforceOfficeRestrictions(client, voiceState, office) {
  const member = voiceState.member;
  const guild = voiceState.guild;

  // Check allowlist
  const onAllowlist = isOnAllowlist(office.id, member);

  if (office.is_restricted) {
    // Restricted: kick everyone — no exceptions
    await member.voice.disconnect('[Office] Restricted office').catch(() => {});

    const wrField = office.waiting_room_channel_id
      ? [{ name: 'Waiting Room', value: `<#${office.waiting_room_channel_id}>`, inline: true }]
      : [];

    await member.send({
      embeds: [new EmbedBuilder()
        .setColor(0xF59E0B)
        .setTitle('\u{1F512} Restricted Office')
        .setDescription(`**${office.channel_name}** is restricted. You need to request access.\n\nJoin the **Waiting Room** to submit an access request.`)
        .addFields(...wrField)
      ]
    }).catch(() => {});

    await logAction(client, {
      action: '\u{1F512} Office Access Denied',
      moderator: { discordId: 'SYSTEM', name: 'Office System' },
      target: { discordId: member.id, name: member.user.tag },
      reason: `Restricted office: ${office.channel_name}`,
      color: 0xF59E0B,
      logType: 'moderation.office',
      guildId: guild.id
    });
    return;
  }

  if (office.is_owner_only) {
    // Owner always has access
    if (member.id === office.owner_discord_id) return;
    // Superusers always have access
    if (SUPERUSER_IDS.includes(member.id)) return;
    // Check allowlist
    if (!onAllowlist) {
      await member.voice.disconnect('[Office] Owner-only office \u2014 not on allowlist').catch(() => {});
      await member.send({
        embeds: [new EmbedBuilder().setColor(0xEF4444).setTitle('\u{1F512} Access Denied').setDescription(`**${office.channel_name}** is an owner-only office. You are not on the access list.`)]
      }).catch(() => {});

      await logAction(client, {
        action: '\u{1F512} Office Access Denied',
        moderator: { discordId: 'SYSTEM', name: 'Office System' },
        target: { discordId: member.id, name: member.user.tag },
        reason: `Owner-only office: ${office.channel_name}`,
        color: 0xEF4444,
        logType: 'moderation.office',
        guildId: guild.id
      });
      return;
    }
    return; // On allowlist
  }

  // Office is open — owner and superusers always have access
  if (member.id === office.owner_discord_id) return;
  if (SUPERUSER_IDS.includes(member.id)) return;

  // Check keys and allowlist
  const memberRoles = member.roles.cache.map(r => r.id);
  const keys = getActiveKeys(office.id);
  const hasKey = keys.some(k => memberRoles.includes(k.role_id));
  if (hasKey || onAllowlist) return; // Has key or allowlist = allowed
}

// ── Interaction Handlers ────────────────────────────────────────────────────

export async function handleButton(interaction, client) {
  const id = interaction.customId;

  // Register Office modal
  if (id === 'office_register') {
    const modal = new ModalBuilder()
      .setCustomId('office_register_modal')
      .setTitle('Register an Office')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('channel_input')
            .setLabel('Voice Channel ID or Name')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter channel ID or exact name')
            .setRequired(true)
        )
      );
    return interaction.showModal(modal);
  }

  // Refresh master panel
  if (id === 'office_refresh') {
    await interaction.deferUpdate();
    await refreshOfficePanels(client, interaction.guildId);
    return;
  }

  // Settings
  if (id.startsWith('office_settings_')) {
    const officeId = parseInt(id.replace('office_settings_', ''));
    return showSettingsPanel(interaction, officeId);
  }

  // Setting toggles
  if (id.startsWith('office_toggle_restricted_')) {
    const officeId = parseInt(id.replace('office_toggle_restricted_', ''));
    return toggleSetting(interaction, client, officeId, 'is_restricted');
  }
  if (id.startsWith('office_toggle_owneronly_')) {
    const officeId = parseInt(id.replace('office_toggle_owneronly_', ''));
    return toggleSetting(interaction, client, officeId, 'is_owner_only');
  }
  if (id.startsWith('office_toggle_waitingroom_')) {
    const officeId = parseInt(id.replace('office_toggle_waitingroom_', ''));
    return toggleSetting(interaction, client, officeId, 'waiting_room_enabled');
  }
  if (id.startsWith('office_wr_channel_')) {
    const officeId = parseInt(id.replace('office_wr_channel_', ''));
    const modal = new ModalBuilder()
      .setCustomId(`office_wr_channel_modal_${officeId}`)
      .setTitle('Set Waiting Room Channel')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('channel_input')
            .setLabel('Voice Channel ID or Name')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter waiting room channel ID or name')
            .setRequired(true)
        )
      );
    return interaction.showModal(modal);
  }
  if (id.startsWith('office_settings_done_')) {
    return interaction.update({ content: 'Settings saved.', embeds: [], components: [] });
  }

  // Keys management
  if (id.startsWith('office_keys_')) {
    const officeId = parseInt(id.replace('office_keys_', ''));
    return showKeysPanel(interaction, officeId);
  }
  if (id.startsWith('office_addkey_')) {
    const officeId = parseInt(id.replace('office_addkey_', ''));
    const modal = new ModalBuilder()
      .setCustomId(`office_addkey_modal_${officeId}`)
      .setTitle('Add Office Key')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('role_input').setLabel('Role ID or Name').setStyle(TextInputStyle.Short).setPlaceholder('Enter role ID or exact name').setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('duration_input').setLabel('Duration').setStyle(TextInputStyle.Short).setPlaceholder('permanent, 24 hours, 7 days, etc.').setRequired(true)
        )
      );
    return interaction.showModal(modal);
  }
  if (id.startsWith('office_revokekey_')) {
    const parts = id.replace('office_revokekey_', '').split('_');
    const officeId = parseInt(parts[0]);
    const roleId = parts[1];
    return revokeKey(interaction, client, officeId, roleId);
  }

  // Allowlist management
  if (id.startsWith('office_allowlist_')) {
    const officeId = parseInt(id.replace('office_allowlist_', ''));
    return showAllowlistPanel(interaction, officeId);
  }
  if (id.startsWith('office_addallow_')) {
    const officeId = parseInt(id.replace('office_addallow_', ''));
    const modal = new ModalBuilder()
      .setCustomId(`office_addallow_modal_${officeId}`)
      .setTitle('Add User or Role to Allowlist')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('user_input').setLabel('User ID, Role ID, or Mention').setStyle(TextInputStyle.Short).setPlaceholder('@user, @role, or ID').setRequired(true)
        )
      );
    return interaction.showModal(modal);
  }
  if (id.startsWith('office_removeallow_')) {
    const parts = id.replace('office_removeallow_', '').split('_');
    const officeId = parseInt(parts[0]);
    const discordId = parts[1];
    return removeAllowlistEntry(interaction, client, officeId, discordId);
  }

  // Requests panel
  if (id.startsWith('office_requests_')) {
    const officeId = parseInt(id.replace('office_requests_', ''));
    return showRequestsPanel(interaction, officeId);
  }

  // Unregister
  if (id.startsWith('office_unregister_')) {
    const officeId = parseInt(id.replace('office_unregister_', ''));
    return unregisterOffice(interaction, client, officeId);
  }

  // Approve/Deny access requests
  if (id.startsWith('office_approve_')) {
    const requestId = parseInt(id.replace('office_approve_', ''));
    return approveRequest(interaction, client, requestId);
  }
  if (id.startsWith('office_deny_')) {
    const requestId = parseInt(id.replace('office_deny_', ''));
    return denyRequest(interaction, client, requestId);
  }
}

export async function handleSelect(interaction, client) {
  const id = interaction.customId;

  // Waiting room office selection
  if (id.startsWith('office_wr_select_')) {
    const officeId = parseInt(interaction.values[0]);
    const office = getOffice(officeId);

    if (!office) {
      return interaction.update({ content: '\u274C Office not found.', components: [], embeds: [] });
    }

    const result = createAccessRequest(officeId, interaction.user.id, interaction.user.tag || interaction.user.username);
    const requestId = result.lastInsertRowid;

    await interaction.update({
      embeds: [new EmbedBuilder()
        .setColor(0x22C55E)
        .setTitle('\u2705 Request Sent')
        .setDescription(`Your request to join **${office.channel_name}** has been sent.\n\nYou will be notified when someone in the office responds.`)
        .setFooter({ text: 'Requests expire after 10 minutes if no response.' })
      ],
      components: []
    });

    await notifyOfficeOccupants(client, office, requestId, interaction.user);
  }
}

export async function handleModal(interaction, client) {
  const id = interaction.customId;

  // Register office modal
  if (id === 'office_register_modal') {
    await interaction.deferReply({ ephemeral: true });
    const channelInput = interaction.fields.getTextInputValue('channel_input').trim();
    const guild = interaction.guild;

    // Find channel by ID or name
    let vc = guild.channels.cache.get(channelInput);
    if (!vc) {
      vc = guild.channels.cache.find(c => c.name === channelInput && c.type === ChannelType.GuildVoice);
    }
    if (!vc) {
      vc = guild.channels.cache.find(c => c.name.toLowerCase() === channelInput.toLowerCase() && c.type === ChannelType.GuildVoice);
    }

    if (!vc || vc.type !== ChannelType.GuildVoice) {
      return interaction.editReply({ content: '\u274C Voice channel not found. Please provide a valid voice channel ID or exact name.' });
    }

    // Check if already registered
    const existing = getOfficeByChannel(guild.id, vc.id);
    if (existing) {
      return interaction.editReply({ content: `\u274C **${vc.name}** is already registered as an office.` });
    }

    const result = createOffice({ guildId: guild.id, channelId: vc.id, channelName: vc.name, ownerDiscordId: interaction.user.id });
    const officeId = result.lastInsertRowid;
    const office = getOffice(officeId);

    // Post per-office embed in the panel channel
    const masterPanel = getMasterPanel(guild.id);
    if (masterPanel) {
      const panelChannel = guild.channels.cache.get(masterPanel.channel_id);
      if (panelChannel) {
        const officeMsg = await panelChannel.send({
          embeds: [buildOfficeEmbed(office, guild)],
          components: [buildOfficeButtons(officeId)]
        });
        updateOffice(officeId, { panel_message_id: officeMsg.id });
      }
    }

    await refreshOfficePanels(client, guild.id);

    await logAction(client, {
      action: '\u{1F3E2} Office Registered',
      moderator: { discordId: interaction.user.id, name: interaction.user.tag },
      target: { discordId: vc.id, name: vc.name },
      reason: `Voice channel registered as office by ${interaction.user.tag}`,
      color: 0x22C55E,
      logType: 'moderation.office',
      guildId: guild.id
    });

    return interaction.editReply({ content: `\u2705 **${vc.name}** has been registered as an office. Use the panel buttons to configure restrictions.` });
  }

  // Waiting room channel modal
  if (id.startsWith('office_wr_channel_modal_')) {
    const officeId = parseInt(id.replace('office_wr_channel_modal_', ''));
    await interaction.deferUpdate();
    const channelInput = interaction.fields.getTextInputValue('channel_input').trim();
    const guild = interaction.guild;

    let vc = guild.channels.cache.get(channelInput);
    if (!vc) {
      vc = guild.channels.cache.find(c => c.name.toLowerCase() === channelInput.toLowerCase() && c.type === ChannelType.GuildVoice);
    }

    if (!vc || vc.type !== ChannelType.GuildVoice) {
      return interaction.followUp({ content: '\u274C Voice channel not found.', ephemeral: true });
    }

    updateOffice(officeId, { waiting_room_channel_id: vc.id });
    await refreshOfficePanels(client, guild.id);

    const office = getOffice(officeId);
    return showSettingsPanel(interaction, officeId, true);
  }

  // Add key modal
  if (id.startsWith('office_addkey_modal_')) {
    const officeId = parseInt(id.replace('office_addkey_modal_', ''));
    await interaction.deferUpdate();
    const roleInput = interaction.fields.getTextInputValue('role_input').trim();
    const durationInput = interaction.fields.getTextInputValue('duration_input').trim().toLowerCase();
    const guild = interaction.guild;

    let role = guild.roles.cache.get(roleInput);
    if (!role) {
      role = guild.roles.cache.find(r => r.name === roleInput);
    }
    if (!role) {
      role = guild.roles.cache.find(r => r.name.toLowerCase() === roleInput.toLowerCase());
    }

    if (!role) {
      return interaction.followUp({ content: '\u274C Role not found.', ephemeral: true });
    }

    let expiresAt = null;
    if (durationInput !== 'permanent') {
      const ms = parseDuration(durationInput);
      if (!ms) {
        return interaction.followUp({ content: '\u274C Invalid duration. Use "permanent", "24 hours", "7 days", etc.', ephemeral: true });
      }
      expiresAt = new Date(Date.now() + ms).toISOString();
    }

    addKey(officeId, role.id, guild.id, interaction.user.id, expiresAt);

    // Apply channel permission
    const office = getOffice(officeId);
    if (office && !office.is_owner_only) {
      const vc = guild.channels.cache.get(office.channel_id);
      if (vc) {
        await vc.permissionOverwrites.edit(role.id, { Connect: true }).catch(() => {});
      }
    }

    await refreshOfficePanels(client, guild.id);

    await logAction(client, {
      action: '\u{1F5DD}\uFE0F Office Key Granted',
      moderator: { discordId: interaction.user.id, name: interaction.user.tag },
      target: { discordId: role.id, name: `@${role.name}` },
      reason: `Key granted for ${office.channel_name}${expiresAt ? ` (expires ${new Date(expiresAt).toLocaleString('en-GB')})` : ' (permanent)'}`,
      color: 0x22C55E,
      logType: 'moderation.office',
      guildId: guild.id
    });

    return showKeysPanel(interaction, officeId, true);
  }

  // Add allowlist modal — supports users and roles
  if (id.startsWith('office_addallow_modal_')) {
    const officeId = parseInt(id.replace('office_addallow_modal_', ''));
    await interaction.deferUpdate();
    const rawInput = interaction.fields.getTextInputValue('user_input').trim();
    const guild = interaction.guild;

    // Strip mention formatting
    const cleanId = rawInput.replace(/<@[!&]?/g, '').replace(/>/g, '').trim();

    // Try as role first
    const role = guild.roles.cache.get(cleanId);
    if (role) {
      addToAllowlist(officeId, role.id, interaction.user.id, 'role');
      const office = getOffice(officeId);
      if (office) {
        const vc = guild.channels.cache.get(office.channel_id);
        if (vc) await vc.permissionOverwrites.edit(role.id, { Connect: true }).catch(() => {});
      }
      await refreshOfficePanels(client, guild.id);
      await logAction(client, {
        action: '\u{1F465} Office Allowlist Updated',
        moderator: { discordId: interaction.user.id, name: interaction.user.tag },
        target: { discordId: role.id, name: `@${role.name}` },
        reason: `Role added to allowlist for ${office.channel_name}`,
        color: 0x22C55E, logType: 'moderation.office', guildId: guild.id
      });
      return showAllowlistPanel(interaction, officeId, true);
    }

    // Try as user
    const member = await guild.members.fetch(cleanId).catch(() => null);
    if (!member) {
      return interaction.followUp({ content: '\u274C User or role not found in this server.', ephemeral: true });
    }

    addToAllowlist(officeId, member.id, interaction.user.id, 'user');
    const office = getOffice(officeId);
    if (office) {
      const vc = guild.channels.cache.get(office.channel_id);
      if (vc) await vc.permissionOverwrites.edit(member.id, { Connect: true }).catch(() => {});
    }
    await refreshOfficePanels(client, guild.id);
    await logAction(client, {
      action: '\u{1F465} Office Allowlist Updated',
      moderator: { discordId: interaction.user.id, name: interaction.user.tag },
      target: { discordId: member.id, name: member.user.tag },
      reason: `Added to allowlist for ${office.channel_name}`,
      color: 0x22C55E, logType: 'moderation.office', guildId: guild.id
    });
    return showAllowlistPanel(interaction, officeId, true);
  }
}

// ── Sub-panel Builders ──────────────────────────────────────────────────────

async function showSettingsPanel(interaction, officeId, isFollowUp = false) {
  const office = getOffice(officeId);
  if (!office) {
    const msg = { content: '\u274C Office not found.', ephemeral: true };
    return isFollowUp ? interaction.editReply(msg) : interaction.reply(msg);
  }

  const wrChannel = office.waiting_room_channel_id ? `<#${office.waiting_room_channel_id}>` : 'Not set';

  const embed = new EmbedBuilder()
    .setTitle(`\u2699\uFE0F Settings \u2014 ${office.channel_name}`)
    .setColor(0x5865F2)
    .setDescription(
      `\u{1F512} **Restricted Access** \u2014 Currently: ${office.is_restricted ? 'ON' : 'OFF'}\n` +
      `\u{1F451} **Owner-Only Mode** \u2014 Currently: ${office.is_owner_only ? 'ON' : 'OFF'}\n` +
      `\u23F3 **Waiting Room** \u2014 Currently: ${office.waiting_room_enabled ? 'ON' : 'OFF'}\n` +
      `\u{1F6AA} **Waiting Room Channel** \u2014 ${wrChannel}`
    );

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`office_toggle_restricted_${officeId}`).setLabel(`${office.is_restricted ? '\u{1F7E2} Restricted: ON' : '\u{1F534} Restricted: OFF'}`).setStyle(office.is_restricted ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`office_toggle_owneronly_${officeId}`).setLabel(`${office.is_owner_only ? '\u{1F7E2} Owner-Only: ON' : '\u{1F534} Owner-Only: OFF'}`).setStyle(office.is_owner_only ? ButtonStyle.Success : ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`office_toggle_waitingroom_${officeId}`).setLabel(`${office.waiting_room_enabled ? '\u{1F7E2} Waiting Room: ON' : '\u{1F534} Waiting Room: OFF'}`).setStyle(office.waiting_room_enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`office_wr_channel_${officeId}`).setLabel('\u{1F6AA} Set WR Channel').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`office_settings_done_${officeId}`).setLabel('\u{1F4BE} Done').setStyle(ButtonStyle.Primary),
    )
  ];

  const payload = { embeds: [embed], components: rows, ephemeral: true };

  if (isFollowUp) {
    return interaction.editReply(payload);
  }
  return interaction.reply(payload);
}

async function toggleSetting(interaction, client, officeId, field) {
  await interaction.deferUpdate({ ephemeral: true });

  const office = getOffice(officeId);
  if (!office) return interaction.editReply({ content: '\u274C Office not found.', ephemeral: true });

  const newVal = office[field] ? 0 : 1;
  const updateFields = { [field]: newVal };

  // If enabling owner-only, also enable restricted
  if (field === 'is_owner_only' && newVal === 1) {
    updateFields.is_restricted = 1;
  }

  updateOffice(officeId, updateFields);
  const updated = getOffice(officeId);

  // Apply permissions
  const guild = interaction.guild;
  await applyRestriction(guild, updated);

  await refreshOfficePanels(client, guild.id);

  const label = field.replace('is_', '').replace('_', ' ');
  await logAction(client, {
    action: `\u{1F3E2} Office ${label} ${newVal ? 'Enabled' : 'Disabled'}`,
    moderator: { discordId: interaction.user.id, name: interaction.user.tag },
    target: { discordId: office.channel_id, name: office.channel_name },
    reason: `${label} ${newVal ? 'enabled' : 'disabled'} for ${office.channel_name}`,
    color: newVal ? 0x22C55E : 0xF59E0B,
    logType: 'moderation.office',
    guildId: guild.id
  });

  return showSettingsPanel(interaction, officeId, true);
}

async function showKeysPanel(interaction, officeId, isFollowUp = false) {
  const office = getOffice(officeId);
  if (!office) {
    const msg = { content: '\u274C Office not found.', ephemeral: true };
    return isFollowUp ? interaction.editReply(msg) : interaction.reply(msg);
  }

  const keys = getKeys(officeId);
  const guild = interaction.guild;

  const keyLines = keys.length > 0
    ? keys.map(k => {
        const role = guild.roles.cache.get(k.role_id);
        const exp = k.expires_at
          ? (new Date(k.expires_at) <= new Date() ? '**EXPIRED**' : `Expires <t:${Math.floor(new Date(k.expires_at).getTime() / 1000)}:R>`)
          : 'Permanent';
        return `\u2022 @${role?.name || k.role_id} \u2014 ${exp}`;
      }).join('\n')
    : 'No keys configured.';

  const embed = new EmbedBuilder()
    .setTitle(`\u{1F5DD}\uFE0F Office Keys \u2014 ${office.channel_name}`)
    .setColor(0x5865F2)
    .setDescription(keyLines);

  const buttons = [
    new ButtonBuilder().setCustomId(`office_addkey_${officeId}`).setLabel('\u2795 Add Key').setStyle(ButtonStyle.Success),
  ];

  // Add revoke buttons for each key (max 4 more)
  for (const k of keys.slice(0, 4)) {
    const role = guild.roles.cache.get(k.role_id);
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`office_revokekey_${officeId}_${k.role_id}`)
        .setLabel(`\u{1F5D1}\uFE0F ${(role?.name || k.role_id).slice(0, 70)}`)
        .setStyle(ButtonStyle.Danger)
    );
  }

  const row = new ActionRowBuilder().addComponents(buttons);
  const payload = { embeds: [embed], components: [row], ephemeral: true };

  if (isFollowUp) {
    return interaction.editReply(payload);
  }
  return interaction.reply(payload);
}

async function revokeKey(interaction, client, officeId, roleId) {
  const office = getOffice(officeId);
  if (!office) return interaction.reply({ content: '\u274C Office not found.', ephemeral: true });

  removeKey(officeId, roleId);

  // Remove channel permission
  const guild = interaction.guild;
  const vc = guild.channels.cache.get(office.channel_id);
  if (vc) {
    await vc.permissionOverwrites.delete(roleId).catch(() => {});
  }

  await refreshOfficePanels(client, guild.id);

  const role = guild.roles.cache.get(roleId);
  await logAction(client, {
    action: '\u{1F5DD}\uFE0F Office Key Revoked',
    moderator: { discordId: interaction.user.id, name: interaction.user.tag },
    target: { discordId: roleId, name: `@${role?.name || roleId}` },
    reason: `Key revoked for ${office.channel_name}`,
    color: 0xEF4444,
    logType: 'moderation.office',
    guildId: guild.id
  });

  return showKeysPanel(interaction, officeId);
}

async function showAllowlistPanel(interaction, officeId, isFollowUp = false) {
  const office = getOffice(officeId);
  if (!office) {
    const msg = { content: '\u274C Office not found.', ephemeral: true };
    return isFollowUp ? interaction.editReply(msg) : interaction.reply(msg);
  }

  const allowlist = getAllowlist(officeId);

  const lines = allowlist.length > 0
    ? allowlist.map(a => {
        const prefix = a.entry_type === 'role' ? `<@&${a.discord_id}>` : `<@${a.discord_id}>`;
        return `\u2022 ${prefix} \u2014 Added by <@${a.added_by}>`;
      }).join('\n')
    : 'No users or roles on the allowlist.';

  const embed = new EmbedBuilder()
    .setTitle(`\u{1F465} Allowlist \u2014 ${office.channel_name}`)
    .setColor(0x5865F2)
    .setDescription(lines);

  const buttons = [
    new ButtonBuilder().setCustomId(`office_addallow_${officeId}`).setLabel('\u2795 Add User/Role').setStyle(ButtonStyle.Success),
  ];

  for (const a of allowlist.slice(0, 4)) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`office_removeallow_${officeId}_${a.discord_id}`)
        .setLabel(`\u{1F5D1}\uFE0F ${a.discord_id.slice(0, 15)}`)
        .setStyle(ButtonStyle.Danger)
    );
  }

  const row = new ActionRowBuilder().addComponents(buttons);
  const payload = { embeds: [embed], components: [row], ephemeral: true };

  if (isFollowUp) {
    return interaction.editReply(payload);
  }
  return interaction.reply(payload);
}

async function removeAllowlistEntry(interaction, client, officeId, discordId) {
  const office = getOffice(officeId);
  if (!office) return interaction.reply({ content: '\u274C Office not found.', ephemeral: true });

  removeFromAllowlist(officeId, discordId);

  // Remove channel permission
  const guild = interaction.guild;
  const vc = guild.channels.cache.get(office.channel_id);
  if (vc) {
    await vc.permissionOverwrites.delete(discordId).catch(() => {});
  }

  await refreshOfficePanels(client, guild.id);

  await logAction(client, {
    action: '\u{1F465} Office Allowlist Updated',
    moderator: { discordId: interaction.user.id, name: interaction.user.tag },
    target: { discordId, name: discordId },
    reason: `Removed from allowlist for ${office.channel_name}`,
    color: 0xEF4444,
    logType: 'moderation.office',
    guildId: guild.id
  });

  return showAllowlistPanel(interaction, officeId);
}

async function showRequestsPanel(interaction, officeId) {
  const office = getOffice(officeId);
  if (!office) return interaction.reply({ content: '\u274C Office not found.', ephemeral: true });

  const requests = db.prepare(`SELECT * FROM office_access_requests WHERE office_id = ? ORDER BY requested_at DESC LIMIT 20`).all(officeId);

  const lines = requests.length > 0
    ? requests.map(r => {
        const status = { pending: '\u23F3', approved: '\u2705', denied: '\u274C', expired: '\u23F0', cancelled: '\u{1F6AB}' }[r.status] || '\u2753';
        return `${status} **${r.requester_username || r.requester_discord_id}** \u2014 ${r.status} \u2014 <t:${Math.floor(new Date(r.requested_at).getTime() / 1000)}:R>`;
      }).join('\n')
    : 'No access requests.';

  const embed = new EmbedBuilder()
    .setTitle(`\u{1F4CB} Access Requests \u2014 ${office.channel_name}`)
    .setColor(0x5865F2)
    .setDescription(lines)
    .setFooter({ text: 'Showing last 20 requests' });

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function unregisterOffice(interaction, client, officeId) {
  const office = getOffice(officeId);
  if (!office) return interaction.reply({ content: '\u274C Office not found.', ephemeral: true });

  const guild = interaction.guild;

  // Remove channel permissions
  await removeRestriction(guild, office);

  // Delete the per-office panel message
  if (office.panel_message_id) {
    const masterPanel = getMasterPanel(guild.id);
    if (masterPanel) {
      const panelChannel = guild.channels.cache.get(masterPanel.channel_id);
      if (panelChannel) {
        const msg = await panelChannel.messages.fetch(office.panel_message_id).catch(() => null);
        if (msg) await msg.delete().catch(() => {});
      }
    }
  }

  deleteOffice(officeId);
  await refreshOfficePanels(client, guild.id);

  await logAction(client, {
    action: '\u{1F5D1}\uFE0F Office Unregistered',
    moderator: { discordId: interaction.user.id, name: interaction.user.tag },
    target: { discordId: office.channel_id, name: office.channel_name },
    reason: `Office unregistered by ${interaction.user.tag}`,
    color: 0xEF4444,
    logType: 'moderation.office',
    guildId: guild.id
  });

  return interaction.reply({ content: `\u2705 **${office.channel_name}** has been unregistered.`, ephemeral: true });
}

async function approveRequest(interaction, client, requestId) {
  const request = getAccessRequest(requestId);
  if (!request || request.status !== 'pending') {
    return interaction.reply({ content: 'This request has already been handled or expired.', ephemeral: true });
  }

  const office = getOffice(request.office_id);
  if (!office) return interaction.reply({ content: '\u274C Office not found.', ephemeral: true });

  const guild = client.guilds.cache.get(office.guild_id);
  if (!guild) return interaction.reply({ content: '\u274C Guild not found.', ephemeral: true });

  const requesterMember = await guild.members.fetch(request.requester_discord_id).catch(() => null);
  if (!requesterMember) {
    return interaction.reply({ content: 'The requester is no longer in the server.', ephemeral: true });
  }

  updateAccessRequest(requestId, { status: 'approved', approved_by: interaction.user.tag, resolved_at: new Date().toISOString() });

  // Temporarily grant Connect
  const voiceChannel = guild.channels.cache.get(office.channel_id);
  if (voiceChannel) {
    await voiceChannel.permissionOverwrites.edit(requesterMember.id, { Connect: true }).catch(() => {});
  }

  // Move them into the office if they're in a voice channel
  if (requesterMember.voice.channelId) {
    try {
      await requesterMember.voice.setChannel(voiceChannel);
      // Remove temp overwrite after 5 seconds
      setTimeout(async () => {
        if (voiceChannel && !isOnAllowlist(office.id, requesterMember.id)) {
          await voiceChannel.permissionOverwrites.delete(requesterMember.id).catch(() => {});
        }
      }, 5000);
    } catch (e) {
      console.error('[Office] Move failed:', e.message);
      await requesterMember.send({
        embeds: [new EmbedBuilder().setColor(0x22C55E).setTitle('\u2705 Access Approved')
          .setDescription(`Your request to join **${office.channel_name}** was approved by ${interaction.user.tag}.\n\nPlease join the channel now \u2014 your access has been granted for 60 seconds.`)]
      }).catch(() => {});
      // Remove overwrite after 60 seconds if they don't join
      setTimeout(async () => {
        if (voiceChannel && !isOnAllowlist(office.id, requesterMember.id)) {
          await voiceChannel.permissionOverwrites.delete(requesterMember.id).catch(() => {});
        }
      }, 60000);
    }
  } else {
    await requesterMember.send({
      embeds: [new EmbedBuilder().setColor(0x22C55E).setTitle('\u2705 Access Approved')
        .setDescription(`Your request to join **${office.channel_name}** was approved by ${interaction.user.tag}.\n\nPlease join the channel now \u2014 your access has been granted for 60 seconds.`)]
    }).catch(() => {});
    setTimeout(async () => {
      if (voiceChannel && !isOnAllowlist(office.id, requesterMember.id)) {
        await voiceChannel.permissionOverwrites.delete(requesterMember.id).catch(() => {});
      }
    }, 60000);
  }

  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0x22C55E).setTitle('\u2705 Request Approved')
      .setDescription(`You approved **${request.requester_username}**'s request to join **${office.channel_name}**.`)],
    components: []
  });

  await logAction(client, {
    action: '\u2705 Office Access Approved',
    moderator: { discordId: interaction.user.id, name: interaction.user.tag },
    target: { discordId: request.requester_discord_id, name: request.requester_username },
    reason: `Access approved for ${office.channel_name}`,
    color: 0x22C55E,
    logType: 'moderation.office',
    guildId: office.guild_id
  });
}

async function denyRequest(interaction, client, requestId) {
  const request = getAccessRequest(requestId);
  if (!request || request.status !== 'pending') {
    return interaction.reply({ content: 'This request has already been handled or expired.', ephemeral: true });
  }

  const office = getOffice(request.office_id);
  if (!office) return interaction.reply({ content: '\u274C Office not found.', ephemeral: true });

  updateAccessRequest(requestId, { status: 'denied', approved_by: interaction.user.tag, resolved_at: new Date().toISOString() });

  const requesterUser = await client.users.fetch(request.requester_discord_id).catch(() => null);
  if (requesterUser) {
    await requesterUser.send({
      embeds: [new EmbedBuilder().setColor(0xEF4444).setTitle('\u274C Access Denied')
        .setDescription(`Your request to join **${office.channel_name}** was denied.`)]
    }).catch(() => {});
  }

  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0xEF4444).setTitle('\u274C Request Denied')
      .setDescription(`You denied **${request.requester_username}**'s request to join **${office.channel_name}**.`)],
    components: []
  });

  await logAction(client, {
    action: '\u274C Office Access Denied',
    moderator: { discordId: interaction.user.id, name: interaction.user.tag },
    target: { discordId: request.requester_discord_id, name: request.requester_username },
    reason: `Access denied for ${office.channel_name}`,
    color: 0xEF4444,
    logType: 'moderation.office',
    guildId: office.guild_id
  });
}

// ── Key Expiry Cron ─────────────────────────────────────────────────────────

export async function processExpiredKeys(client) {
  try {
    const expired = getExpiredKeys();
    for (const key of expired) {
      const guild = client.guilds.cache.get(key.office_guild_id);
      if (guild) {
        const vc = guild.channels.cache.get(key.channel_id);
        if (vc) {
          await vc.permissionOverwrites.delete(key.role_id).catch(() => {});
        }
      }

      removeKey(key.office_id, key.role_id);

      // DM the office owner
      if (key.owner_discord_id) {
        const owner = await client.users.fetch(key.owner_discord_id).catch(() => null);
        const role = guild?.roles?.cache?.get(key.role_id);
        if (owner) {
          await owner.send({
            embeds: [new EmbedBuilder().setColor(0xF59E0B).setTitle('\u{1F5DD}\uFE0F Office Key Expired')
              .setDescription(`Office key for **@${role?.name || key.role_id}** in **${key.channel_name}** has expired and been automatically revoked.`)]
          }).catch(() => {});
        }
      }

      if (guild) {
        await logAction(client, {
          action: '\u{1F5DD}\uFE0F Office Key Auto-Expired',
          moderator: { discordId: 'SYSTEM', name: 'Automated' },
          target: { discordId: key.role_id, name: `@${key.role_id}` },
          reason: `Key expired for ${key.channel_name}`,
          color: 0xF59E0B,
          logType: 'moderation.office',
          guildId: key.office_guild_id
        });

        await refreshOfficePanels(client, key.office_guild_id);
      }
    }
    if (expired.length > 0) console.log(`[Office] Auto-revoked ${expired.length} expired key(s)`);
  } catch (e) {
    console.error('[Office] processExpiredKeys error:', e.message);
  }
}

// ── Duration Parser ─────────────────────────────────────────────────────────

function parseDuration(input) {
  const match = input.match(/^(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|weeks?)$/i);
  if (!match) return null;
  const num = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  if (unit.startsWith('m')) return num * 60 * 1000;
  if (unit.startsWith('h')) return num * 60 * 60 * 1000;
  if (unit.startsWith('d')) return num * 24 * 60 * 60 * 1000;
  if (unit.startsWith('w')) return num * 7 * 24 * 60 * 60 * 1000;
  return null;
}
