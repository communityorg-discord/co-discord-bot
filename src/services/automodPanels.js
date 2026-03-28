import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { db } from '../utils/botDb.js';
import { automod } from './automod.js';
import { isSuperuser, canRunCommand } from '../utils/permissions.js';
import { randomBytes } from 'crypto';

const MODULES = [
  { key: 'spam', label: 'Spam', emoji: '💬' },
  { key: 'mention_spam', label: 'Mentions', emoji: '📢' },
  { key: 'role_mention', label: 'Role Mentions', emoji: '🏷️' },
  { key: 'invite_links', label: 'Invites', emoji: '🔗' },
  { key: 'new_account', label: 'New Accounts', emoji: '👤' },
  { key: 'raid_detection', label: 'Raid', emoji: '🚨' },
  { key: 'permission_guard', label: 'Permissions', emoji: '🔐' },
  { key: 'channel_creation_guard', label: 'Channels', emoji: '📁' },
  { key: 'role_creation_guard', label: 'Roles', emoji: '🎭' },
  { key: 'verify_timeout', label: 'Verify Timeout', emoji: '⏰' },
];

const MODULE_SETTINGS = {
  spam: ['spam_threshold', 'spam_window_seconds', 'spam_action', 'spam_timeout_minutes'],
  mention_spam: ['mention_threshold', 'mention_window_seconds', 'mention_action'],
  role_mention: ['role_mention_threshold', 'role_mention_action'],
  invite_links: ['invite_links_action'],
  new_account: ['new_account_min_age_days', 'new_account_action'],
  raid_detection: ['raid_join_threshold', 'raid_join_window_seconds', 'raid_action'],
  verify_timeout: ['verify_warning_hours', 'verify_terminate_hours'],
};

function savePanel(guildId, channelId, panelType, messageId) {
  db.prepare('INSERT OR REPLACE INTO automod_panels (guild_id, channel_id, panel_type, message_id) VALUES (?, ?, ?, ?)').run(guildId, channelId, panelType, messageId);
}

function getPanel(guildId, panelType) {
  return db.prepare('SELECT * FROM automod_panels WHERE guild_id = ? AND panel_type = ?').get(guildId, panelType);
}

function checkAuth(interaction) {
  if (isSuperuser(interaction.user.id)) return true;
  const perm = canRunCommand(interaction.user.id, 5);
  return perm.allowed;
}

// ── Panel 1: Status & Overview ───────────────────────────────────────────────

function buildStatusEmbed(guildId) {
  const config = automod.getConfig(guildId);
  const todayIncidents = db.prepare("SELECT COUNT(*) as c FROM automod_incidents WHERE guild_id = ? AND created_at >= date('now')").get(guildId)?.c || 0;
  const lastIncident = db.prepare("SELECT created_at FROM automod_incidents WHERE guild_id = ? ORDER BY created_at DESC LIMIT 1").get(guildId);
  const lastAgo = lastIncident ? `<t:${Math.floor(new Date(lastIncident.created_at).getTime() / 1000)}:R>` : 'Never';

  const moduleList = MODULES.map(m => {
    const enabled = config[`${m.key}_enabled`];
    return `${enabled ? '🟢' : '🔴'} ${m.label}`;
  }).join('  |  ');

  return new EmbedBuilder()
    .setColor(config.enabled ? 0x22C55E : 0xEF4444)
    .setTitle('🛡️ CO | AUTOMOD CONTROL CENTRE')
    .setDescription(`**Status:** ${config.enabled ? '🟢 ACTIVE' : '🔴 DISABLED'}  |  **Incidents today:** ${todayIncidents}  |  **Last action:** ${lastAgo}\n\n**MODULES**\n${moduleList}`)
    .setFooter({ text: 'Click buttons below to manage | CO AutoMod System' })
    .setTimestamp();
}

function buildStatusButtons(guildId) {
  const config = automod.getConfig(guildId);
  const rows = [];

  // Module toggle buttons (2 rows of 5)
  const row1 = new ActionRowBuilder();
  const row2 = new ActionRowBuilder();
  MODULES.forEach((m, i) => {
    const enabled = config[`${m.key}_enabled`];
    const btn = new ButtonBuilder()
      .setCustomId(`automod_toggle_${m.key}_${guildId}`)
      .setLabel(m.label)
      .setStyle(enabled ? ButtonStyle.Success : ButtonStyle.Danger)
      .setEmoji(m.emoji);
    (i < 5 ? row1 : row2).addComponents(btn);
  });
  rows.push(row1, row2);

  // Action buttons
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`automod_disable_all_${guildId}`).setLabel('Disable All').setStyle(ButtonStyle.Danger).setEmoji('🔴'),
    new ButtonBuilder().setCustomId(`automod_enable_all_${guildId}`).setLabel('Enable All').setStyle(ButtonStyle.Success).setEmoji('🟢'),
    new ButtonBuilder().setCustomId(`automod_refresh_${guildId}`).setLabel('Refresh').setStyle(ButtonStyle.Secondary).setEmoji('🔄'),
    new ButtonBuilder().setCustomId(`automod_incidents_${guildId}`).setLabel('Incidents').setStyle(ButtonStyle.Primary).setEmoji('📋'),
  );
  rows.push(row3);
  return rows;
}

// ── Panel 2: Module Configuration ────────────────────────────────────────────

function buildConfigEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('⚙️ AUTOMOD CONFIGURATION')
    .setDescription('Select a module from the dropdown below to view and edit its settings.')
    .setFooter({ text: 'CO AutoMod System' });
}

function buildConfigDropdown(guildId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`automod_config_select_${guildId}`)
      .setPlaceholder('Select a module to configure...')
      .addOptions(MODULES.filter(m => MODULE_SETTINGS[m.key]).map(m => ({
        label: m.label,
        value: m.key,
        emoji: m.emoji,
      })))
  );
}

// ── Panel 3: Lockdown Control ────────────────────────────────────────────────

function buildLockdownEmbed(guildId) {
  const active = db.prepare("SELECT * FROM lockdown_state WHERE guild_id = ? AND is_active = 1").all(guildId);
  const globalActive = db.prepare("SELECT * FROM lockdown_state WHERE lockdown_type = 'global' AND is_active = 1").all();
  const allActive = [...active, ...globalActive.filter(g => g.guild_id !== guildId)];

  let desc = allActive.length === 0
    ? '**Current Status:** 🟢 NO ACTIVE LOCKDOWNS'
    : `**Current Status:** 🔴 ${allActive.length} ACTIVE LOCKDOWN(S)\n\n` +
      allActive.map(l => `• **${l.lockdown_type}** in ${l.guild_id === guildId ? 'this server' : l.guild_id} — ${l.reason || 'No reason'}${l.auto_unlock_at ? ` (expires <t:${Math.floor(new Date(l.auto_unlock_at).getTime() / 1000)}:R>)` : ''}`).join('\n');

  return new EmbedBuilder()
    .setColor(allActive.length > 0 ? 0xEF4444 : 0x22C55E)
    .setTitle('🔒 LOCKDOWN CONTROL')
    .setDescription(desc)
    .setFooter({ text: 'CO AutoMod System' })
    .setTimestamp();
}

function buildLockdownButtons(guildId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`automod_lock_channel_${guildId}`).setLabel('Lock Channel').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
      new ButtonBuilder().setCustomId(`automod_lock_server_${guildId}`).setLabel('Lock Server').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
      new ButtonBuilder().setCustomId(`automod_global_lock_${guildId}`).setLabel('Global Lockdown').setStyle(ButtonStyle.Danger).setEmoji('🌐'),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`automod_unlock_channel_${guildId}`).setLabel('Unlock Channel').setStyle(ButtonStyle.Success).setEmoji('🔓'),
      new ButtonBuilder().setCustomId(`automod_unlock_server_${guildId}`).setLabel('Unlock Server').setStyle(ButtonStyle.Success).setEmoji('🔓'),
      new ButtonBuilder().setCustomId(`automod_global_unlock_${guildId}`).setLabel('Global Unlock').setStyle(ButtonStyle.Success).setEmoji('🌐'),
    ),
  ];
}

// ── Panel 4: Immunity Management ─────────────────────────────────────────────

function buildImmunityEmbed(guildId) {
  const immunities = db.prepare('SELECT * FROM automod_immunity WHERE guild_id = ? OR guild_id IS NULL ORDER BY created_at DESC LIMIT 10').all(guildId);
  const list = immunities.length === 0 ? 'No active immunities.'
    : immunities.map(i => `• **${i.target_type}** \`${i.target_id}\` — from: **${i.immune_from}** ${i.expires_at ? `(expires <t:${Math.floor(new Date(i.expires_at).getTime() / 1000)}:R>)` : '(permanent)'}`).join('\n');

  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🛡️ IMMUNITY MANAGEMENT')
    .setDescription(`Grant immunity to users, roles, or servers from specific automod modules.\n\n**Currently Immune:**\n${list}`)
    .setFooter({ text: 'CO AutoMod System' })
    .setTimestamp();
}

function buildImmunityButtons(guildId) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`automod_immunity_add_${guildId}`).setLabel('Add Immunity').setStyle(ButtonStyle.Primary).setEmoji('➕'),
    new ButtonBuilder().setCustomId(`automod_immunity_view_${guildId}`).setLabel('View All').setStyle(ButtonStyle.Secondary).setEmoji('📋'),
    new ButtonBuilder().setCustomId(`automod_immunity_remove_${guildId}`).setLabel('Remove').setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
  )];
}

// ── Panel 5: Pending Approvals ───────────────────────────────────────────────

function buildApprovalEmbed(guildId) {
  const pending = db.prepare("SELECT COUNT(*) as c FROM approval_requests WHERE guild_id = ? AND status = 'pending'").get(guildId)?.c || 0;
  const approvedToday = db.prepare("SELECT COUNT(*) as c FROM approval_requests WHERE guild_id = ? AND status = 'approved' AND created_at >= date('now')").get(guildId)?.c || 0;
  const deniedToday = db.prepare("SELECT COUNT(*) as c FROM approval_requests WHERE guild_id = ? AND status = 'denied' AND created_at >= date('now')").get(guildId)?.c || 0;

  return new EmbedBuilder()
    .setColor(pending > 0 ? 0xF59E0B : 0x22C55E)
    .setTitle('✅ APPROVAL REQUESTS')
    .setDescription(`**Pending:** ${pending}  |  **Approved today:** ${approvedToday}  |  **Denied today:** ${deniedToday}`)
    .setFooter({ text: 'CO AutoMod System' })
    .setTimestamp();
}

function buildApprovalButtons(guildId) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`automod_approval_view_${guildId}`).setLabel('View Pending').setStyle(ButtonStyle.Primary).setEmoji('📋'),
  )];
}

// ── Post all panels ──────────────────────────────────────────────────────────

export async function postAllPanels(channel, guildId) {
  const results = [];

  // Panel 1: Status
  const statusMsg = await channel.send({ embeds: [buildStatusEmbed(guildId)], components: buildStatusButtons(guildId) });
  savePanel(guildId, channel.id, 'status', statusMsg.id);
  results.push('Status');

  // Panel 2: Config
  const configMsg = await channel.send({ embeds: [buildConfigEmbed()], components: [buildConfigDropdown(guildId)] });
  savePanel(guildId, channel.id, 'config', configMsg.id);
  results.push('Config');

  // Panel 3: Lockdown
  const lockMsg = await channel.send({ embeds: [buildLockdownEmbed(guildId)], components: buildLockdownButtons(guildId) });
  savePanel(guildId, channel.id, 'lockdown', lockMsg.id);
  results.push('Lockdown');

  // Panel 4: Immunity
  const immunityMsg = await channel.send({ embeds: [buildImmunityEmbed(guildId)], components: buildImmunityButtons(guildId) });
  savePanel(guildId, channel.id, 'immunity', immunityMsg.id);
  results.push('Immunity');

  // Panel 5: Approvals
  const approvalMsg = await channel.send({ embeds: [buildApprovalEmbed(guildId)], components: buildApprovalButtons(guildId) });
  savePanel(guildId, channel.id, 'approvals', approvalMsg.id);
  results.push('Approvals');

  return results;
}

// ── Refresh a specific panel ─────────────────────────────────────────────────

export async function refreshPanel(client, guildId, panelType) {
  const panel = getPanel(guildId, panelType);
  if (!panel) return;
  try {
    const channel = await client.channels.fetch(panel.channel_id).catch(() => null);
    if (!channel) return;
    const msg = await channel.messages.fetch(panel.message_id).catch(() => null);
    if (!msg) return;

    switch (panelType) {
      case 'status':
        await msg.edit({ embeds: [buildStatusEmbed(guildId)], components: buildStatusButtons(guildId) });
        break;
      case 'lockdown':
        await msg.edit({ embeds: [buildLockdownEmbed(guildId)], components: buildLockdownButtons(guildId) });
        break;
      case 'immunity':
        await msg.edit({ embeds: [buildImmunityEmbed(guildId)], components: buildImmunityButtons(guildId) });
        break;
      case 'approvals':
        await msg.edit({ embeds: [buildApprovalEmbed(guildId)], components: buildApprovalButtons(guildId) });
        break;
    }
  } catch (e) {
    console.error(`[AutoMod Panels] Refresh ${panelType} failed:`, e.message);
  }
}

// ── Handle all button/select/modal interactions ──────────────────────────────

export async function handleInteraction(interaction) {
  const id = interaction.customId;
  if (!id.startsWith('automod_')) return false;

  if (!checkAuth(interaction)) {
    return interaction.reply({ content: '❌ You don\'t have permission to use automod controls.', ephemeral: true });
  }

  // ── Module toggle ──
  if (id.startsWith('automod_toggle_')) {
    const parts = id.replace('automod_toggle_', '').split('_');
    const guildId = parts.pop();
    const module = parts.join('_');
    const config = automod.getConfig(guildId);
    const col = `${module}_enabled`;
    const newVal = config[col] ? 0 : 1;
    db.prepare(`UPDATE automod_config SET ${col} = ?, updated_at = datetime('now') WHERE guild_id = ?`).run(newVal, guildId);
    await interaction.update({ embeds: [buildStatusEmbed(guildId)], components: buildStatusButtons(guildId) });
    return true;
  }

  // ── Enable/Disable all ──
  if (id.startsWith('automod_enable_all_') || id.startsWith('automod_disable_all_')) {
    const guildId = id.split('_').pop();
    const val = id.includes('enable') ? 1 : 0;
    const sets = MODULES.map(m => `${m.key}_enabled = ${val}`).join(', ');
    db.prepare(`UPDATE automod_config SET ${sets}, enabled = ${val}, updated_at = datetime('now') WHERE guild_id = ?`).run(guildId);
    await interaction.update({ embeds: [buildStatusEmbed(guildId)], components: buildStatusButtons(guildId) });
    return true;
  }

  // ── Refresh ──
  if (id.startsWith('automod_refresh_')) {
    const guildId = id.replace('automod_refresh_', '');
    await interaction.update({ embeds: [buildStatusEmbed(guildId)], components: buildStatusButtons(guildId) });
    return true;
  }

  // ── View incidents ──
  if (id.startsWith('automod_incidents_')) {
    const guildId = id.replace('automod_incidents_', '');
    const incidents = db.prepare('SELECT * FROM automod_incidents WHERE guild_id = ? ORDER BY created_at DESC LIMIT 15').all(guildId);
    if (incidents.length === 0) return interaction.reply({ content: 'No recent incidents.', ephemeral: true });
    const desc = incidents.map(i => `**${i.incident_type}** | ${i.target_discord_id ? `<@${i.target_discord_id}>` : 'N/A'} | ${i.severity} | ${i.action_taken} | <t:${Math.floor(new Date(i.created_at).getTime() / 1000)}:R>`).join('\n');
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('📋 Recent Incidents').setDescription(desc).setTimestamp()], ephemeral: true });
  }

  // ── Config select dropdown ──
  if (id.startsWith('automod_config_select_')) {
    const guildId = id.replace('automod_config_select_', '');
    const module = interaction.values[0];
    const config = automod.getConfig(guildId);
    const settings = MODULE_SETTINGS[module] || [];
    const m = MODULES.find(x => x.key === module);

    const fields = settings.map(s => ({ name: s.replace(/_/g, ' '), value: `\`${config[s] ?? 'default'}\``, inline: true }));
    fields.push({ name: 'Status', value: config[`${module}_enabled`] ? '🟢 Enabled' : '🔴 Disabled', inline: true });

    const buttons = new ActionRowBuilder();
    settings.slice(0, 4).forEach(s => {
      buttons.addComponents(new ButtonBuilder().setCustomId(`automod_config_edit_${s}_${module}_${guildId}`).setLabel(s.replace(/_/g, ' ').slice(0, 20)).setStyle(ButtonStyle.Secondary).setEmoji('✏️'));
    });
    buttons.addComponents(new ButtonBuilder().setCustomId(`automod_config_toggle_${module}_${guildId}`).setLabel('Toggle').setStyle(config[`${module}_enabled`] ? ButtonStyle.Danger : ButtonStyle.Success));

    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(`${m?.emoji || '⚙️'} ${m?.label || module} Configuration`).addFields(...fields).setTimestamp()],
      components: [buttons],
      ephemeral: true
    });
    return true;
  }

  // ── Config edit button → modal ──
  if (id.startsWith('automod_config_edit_')) {
    const rest = id.replace('automod_config_edit_', '');
    const parts = rest.split('_');
    const guildId = parts.pop();
    const module = parts.pop();
    const setting = parts.join('_');
    const config = automod.getConfig(guildId);

    await interaction.showModal(new ModalBuilder()
      .setCustomId(`automod_config_save_${setting}_${module}_${guildId}`)
      .setTitle(`Edit ${setting.replace(/_/g, ' ')}`)
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('value').setLabel(setting.replace(/_/g, ' ')).setStyle(TextInputStyle.Short).setRequired(true).setValue(String(config[setting] ?? ''))
      ))
    );
    return true;
  }

  // ── Config save modal ──
  if (id.startsWith('automod_config_save_')) {
    const rest = id.replace('automod_config_save_', '');
    const parts = rest.split('_');
    const guildId = parts.pop();
    const module = parts.pop();
    const setting = parts.join('_');
    const value = interaction.fields.getTextInputValue('value');
    db.prepare(`UPDATE automod_config SET ${setting} = ?, updated_at = datetime('now') WHERE guild_id = ?`).run(value, guildId);
    await interaction.reply({ content: `✅ **${setting}** set to \`${value}\`.`, ephemeral: true });
    await refreshPanel(interaction.client, guildId, 'status');
    return true;
  }

  // ── Config toggle ──
  if (id.startsWith('automod_config_toggle_')) {
    const rest = id.replace('automod_config_toggle_', '');
    const parts = rest.split('_');
    const guildId = parts.pop();
    const module = parts.join('_');
    const config = automod.getConfig(guildId);
    const col = `${module}_enabled`;
    db.prepare(`UPDATE automod_config SET ${col} = ?, updated_at = datetime('now') WHERE guild_id = ?`).run(config[col] ? 0 : 1, guildId);
    await interaction.reply({ content: `✅ **${module}** ${config[col] ? 'disabled' : 'enabled'}.`, ephemeral: true });
    await refreshPanel(interaction.client, guildId, 'status');
    return true;
  }

  // ── Lockdown buttons → modals ──
  if (id.startsWith('automod_lock_channel_') || id.startsWith('automod_lock_server_') || id.startsWith('automod_global_lock_')) {
    const scope = id.includes('global') ? 'global' : id.includes('server') ? 'server' : 'channel';
    const guildId = id.split('_').pop();
    if (scope === 'global' && !isSuperuser(interaction.user.id)) {
      return interaction.reply({ content: '❌ Global lockdown is superuser only.', ephemeral: true });
    }
    await interaction.showModal(new ModalBuilder()
      .setCustomId(`automod_lock_confirm_${scope}_${guildId}`)
      .setTitle(`${scope === 'global' ? 'Global' : scope === 'server' ? 'Server' : 'Channel'} Lockdown`)
      .addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Reason').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('duration').setLabel('Duration (optional, e.g. "2 hours")').setStyle(TextInputStyle.Short).setRequired(false)),
      )
    );
    return true;
  }

  // ── Lockdown confirm modal ──
  if (id.startsWith('automod_lock_confirm_')) {
    const rest = id.replace('automod_lock_confirm_', '');
    const parts = rest.split('_');
    const guildId = parts.pop();
    const scope = parts.join('_');
    const reason = interaction.fields.getTextInputValue('reason');
    const durationStr = interaction.fields.getTextInputValue('duration') || '';

    await interaction.deferReply({ ephemeral: true });

    // Import lockdown logic
    const lockdownCmd = await import('../commands/lockdown.js');
    // Simulate the lockdown execution
    const { ChannelType } = await import('discord.js');

    let autoUnlockAt = null;
    if (durationStr) {
      const match = durationStr.toLowerCase().match(/^(\d+)\s*(m|min|h|hr|hours?|d|days?)$/);
      if (match) {
        const num = parseInt(match[1]);
        const unit = match[2].charAt(0);
        const ms = unit === 'm' ? num * 60000 : unit === 'h' ? num * 3600000 : num * 86400000;
        autoUnlockAt = new Date(Date.now() + ms).toISOString();
      }
    }

    if (scope === 'channel') {
      const channel = interaction.channel;
      const result = db.prepare(`INSERT INTO lockdown_state (guild_id, channel_id, lockdown_type, locked_by, reason, auto_unlock_at) VALUES (?, ?, 'channel', ?, ?, ?)`).run(guildId, channel.id, interaction.user.id, reason, autoUnlockAt);
      // Snapshot @everyone SendMessages state
      const evOw = channel.permissionOverwrites.cache.get(guildId);
      const prev = evOw?.allow.has('SendMessages') ? 'allow' : evOw?.deny.has('SendMessages') ? 'deny' : 'neutral';
      db.prepare(`INSERT OR REPLACE INTO lockdown_permission_snapshots (lockdown_id, guild_id, channel_id, role_id, allow_permissions, deny_permissions) VALUES (?, ?, ?, ?, ?, '')`).run(result.lastInsertRowid, guildId, channel.id, guildId, prev);
      await channel.permissionOverwrites.edit(guildId, { SendMessages: false }).catch(() => {});
      await interaction.editReply({ content: `🔒 Channel locked. Reason: ${reason}` });
    } else {
      const guilds = scope === 'global' ? [...interaction.client.guilds.cache.values()] : [interaction.guild];
      let count = 0;
      for (const guild of guilds) {
        const result = db.prepare(`INSERT OR REPLACE INTO lockdown_state (guild_id, lockdown_type, locked_by, reason, is_active, auto_unlock_at) VALUES (?, ?, ?, ?, 1, ?)`).run(guild.id, scope, interaction.user.id, reason, autoUnlockAt);
        const ldId = result.lastInsertRowid;
        const channels = guild.channels.cache.filter(c => c.type === ChannelType.GuildText);
        for (const [, ch] of channels) {
          const evOw = ch.permissionOverwrites.cache.get(guild.id);
          const prev = evOw?.allow.has('SendMessages') ? 'allow' : evOw?.deny.has('SendMessages') ? 'deny' : 'neutral';
          db.prepare(`INSERT OR REPLACE INTO lockdown_permission_snapshots (lockdown_id, guild_id, channel_id, role_id, allow_permissions, deny_permissions) VALUES (?, ?, ?, ?, ?, '')`).run(ldId, guild.id, ch.id, guild.id, prev);
          await ch.permissionOverwrites.edit(guild.id, { SendMessages: false }).catch(() => {});
        }
        count++;
      }
      await interaction.editReply({ content: `🔒 ${scope === 'global' ? 'Global' : 'Server'} lockdown applied across ${count} guild(s).` });
    }
    await refreshPanel(interaction.client, guildId, 'lockdown');
    return true;
  }

  // ── Unlock buttons ──
  if (id.startsWith('automod_unlock_channel_') || id.startsWith('automod_unlock_server_') || id.startsWith('automod_global_unlock_')) {
    const scope = id.includes('global') ? 'global' : id.includes('server') ? 'server' : 'channel';
    const guildId = id.split('_').pop();
    await interaction.deferReply({ ephemeral: true });

    if (scope === 'channel') {
      const ld = db.prepare("SELECT * FROM lockdown_state WHERE guild_id = ? AND channel_id = ? AND is_active = 1").get(guildId, interaction.channelId);
      if (!ld) return interaction.editReply({ content: '❌ No active lockdown on this channel.' });
      // Restore from snapshot
      const snap = db.prepare('SELECT * FROM lockdown_permission_snapshots WHERE lockdown_id = ? AND channel_id = ? AND role_id = ?').get(ld.id, interaction.channelId, guildId);
      if (snap?.allow_permissions === 'allow') {
        await interaction.channel.permissionOverwrites.edit(guildId, { SendMessages: true }).catch(() => {});
      } else if (snap?.allow_permissions === 'deny') {
        // Was already denied — leave it
      } else {
        await interaction.channel.permissionOverwrites.edit(guildId, { SendMessages: null }).catch(() => {});
      }
      db.prepare("UPDATE lockdown_state SET is_active = 0, unlocked_at = datetime('now') WHERE id = ?").run(ld.id);
      db.prepare('DELETE FROM lockdown_permission_snapshots WHERE lockdown_id = ?').run(ld.id);
      await interaction.editReply({ content: '🔓 Channel unlocked.' });
    } else {
      const guilds = scope === 'global' ? [...interaction.client.guilds.cache.values()] : [interaction.guild];
      for (const guild of guilds) {
        const lockdowns = db.prepare("SELECT * FROM lockdown_state WHERE guild_id = ? AND is_active = 1").all(guild.id);
        const { ChannelType } = await import('discord.js');
        const channels = guild.channels.cache.filter(c => c.type === ChannelType.GuildText);
        for (const ld of lockdowns) {
          for (const [, ch] of channels) {
            const snap = db.prepare('SELECT * FROM lockdown_permission_snapshots WHERE lockdown_id = ? AND channel_id = ? AND role_id = ?').get(ld.id, ch.id, guild.id);
            if (snap?.allow_permissions === 'allow') {
              await ch.permissionOverwrites.edit(guild.id, { SendMessages: true }).catch(() => {});
            } else if (snap?.allow_permissions === 'deny') {
              // Was already denied
            } else {
              await ch.permissionOverwrites.edit(guild.id, { SendMessages: null }).catch(() => {});
            }
          }
          db.prepare("UPDATE lockdown_state SET is_active = 0, unlocked_at = datetime('now') WHERE id = ?").run(ld.id);
          db.prepare('DELETE FROM lockdown_permission_snapshots WHERE lockdown_id = ?').run(ld.id);
        }
      }
      await interaction.editReply({ content: `🔓 ${scope === 'global' ? 'Global' : 'Server'} unlock complete.` });
    }
    await refreshPanel(interaction.client, guildId, 'lockdown');
    return true;
  }

  // ── Immunity add → modal ──
  if (id.startsWith('automod_immunity_add_')) {
    const guildId = id.replace('automod_immunity_add_', '');
    await interaction.showModal(new ModalBuilder()
      .setCustomId(`automod_immunity_save_${guildId}`)
      .setTitle('Add Immunity')
      .addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('target_type').setLabel('Type (user / role)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('user')),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('target_id').setLabel('User or Role ID').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('immune_from').setLabel('Immune from (e.g. spam, invite_links, all)').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Reason').setStyle(TextInputStyle.Short).setRequired(false)),
      )
    );
    return true;
  }

  // ── Immunity save modal ──
  if (id.startsWith('automod_immunity_save_')) {
    const guildId = id.replace('automod_immunity_save_', '');
    const targetType = interaction.fields.getTextInputValue('target_type').toLowerCase().trim();
    const targetId = interaction.fields.getTextInputValue('target_id').replace(/[<@!&>]/g, '').trim();
    const immuneFrom = interaction.fields.getTextInputValue('immune_from').trim();
    const reason = interaction.fields.getTextInputValue('reason') || null;
    db.prepare('INSERT OR REPLACE INTO automod_immunity (guild_id, target_type, target_id, immune_from, granted_by, reason) VALUES (?, ?, ?, ?, ?, ?)')
      .run(guildId, targetType, targetId, immuneFrom, interaction.user.id, reason);
    await interaction.reply({ content: `✅ Immunity granted: ${targetType} \`${targetId}\` immune from **${immuneFrom}**.`, ephemeral: true });
    await refreshPanel(interaction.client, guildId, 'immunity');
    return true;
  }

  // ── Immunity view ──
  if (id.startsWith('automod_immunity_view_')) {
    const guildId = id.replace('automod_immunity_view_', '');
    const list = db.prepare('SELECT * FROM automod_immunity WHERE guild_id = ? OR guild_id IS NULL ORDER BY created_at DESC').all(guildId);
    if (list.length === 0) return interaction.reply({ content: 'No immunities.', ephemeral: true });
    const desc = list.map(i => `**#${i.id}** | ${i.target_type} \`${i.target_id}\` | from: **${i.immune_from}** ${i.expires_at ? `(expires <t:${Math.floor(new Date(i.expires_at).getTime() / 1000)}:R>)` : '(permanent)'}`).join('\n');
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🛡️ All Immunities').setDescription(desc)], ephemeral: true });
  }

  // ── Immunity remove → ephemeral select ──
  if (id.startsWith('automod_immunity_remove_')) {
    const guildId = id.replace('automod_immunity_remove_', '');
    const list = db.prepare('SELECT * FROM automod_immunity WHERE guild_id = ? OR guild_id IS NULL ORDER BY created_at DESC LIMIT 25').all(guildId);
    if (list.length === 0) return interaction.reply({ content: 'No immunities to remove.', ephemeral: true });
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`automod_immunity_delete_${guildId}`)
      .setPlaceholder('Select immunity to remove...')
      .addOptions(list.map(i => ({ label: `#${i.id} ${i.target_type} ${i.target_id}`, description: `from: ${i.immune_from}`, value: String(i.id) })));
    return interaction.reply({ components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
  }

  // ── Immunity delete select ──
  if (id.startsWith('automod_immunity_delete_')) {
    const guildId = id.replace('automod_immunity_delete_', '');
    const immunityId = interaction.values[0];
    db.prepare('DELETE FROM automod_immunity WHERE id = ?').run(immunityId);
    await interaction.update({ content: `✅ Immunity #${immunityId} removed.`, components: [] });
    await refreshPanel(interaction.client, guildId, 'immunity');
    return true;
  }

  // ── Approval view ──
  if (id.startsWith('automod_approval_view_')) {
    const guildId = id.replace('automod_approval_view_', '');
    const pending = db.prepare("SELECT * FROM approval_requests WHERE guild_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 10").all(guildId);
    if (pending.length === 0) return interaction.reply({ content: 'No pending approvals.', ephemeral: true });

    const embeds = pending.map(r => new EmbedBuilder()
      .setColor(0xF59E0B).setTitle(`Approval #${r.id}`)
      .addFields(
        { name: 'Requester', value: `<@${r.requester_discord_id}>`, inline: true },
        { name: 'Action', value: r.action_type, inline: true },
        { name: 'Description', value: r.action_description, inline: false },
      ).setTimestamp(new Date(r.created_at))
    );

    const rows = pending.map(r => new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`automod_approval_approve_${r.id}`).setLabel(`Approve #${r.id}`).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`automod_approval_deny_${r.id}`).setLabel(`Deny #${r.id}`).setStyle(ButtonStyle.Danger),
    ));

    return interaction.reply({ embeds: embeds.slice(0, 5), components: rows.slice(0, 5), ephemeral: true });
  }

  // ── Approval approve/deny ──
  if (id.startsWith('automod_approval_approve_') || id.startsWith('automod_approval_deny_')) {
    const isApprove = id.includes('approve');
    const reqId = parseInt(id.split('_').pop());
    const req = db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(reqId);
    if (!req || req.status !== 'pending') return interaction.reply({ content: '❌ Request not found or already processed.', ephemeral: true });

    const expiresAt = isApprove ? new Date(Date.now() + 20 * 60 * 1000).toISOString() : null;
    db.prepare(`UPDATE approval_requests SET status = ?, approved_by = ?, expires_at = COALESCE(?, expires_at) WHERE id = ?`)
      .run(isApprove ? 'approved' : 'denied', interaction.user.id, expiresAt, reqId);

    try {
      const requester = await interaction.client.users.fetch(req.requester_discord_id);
      await requester.send({ embeds: [new EmbedBuilder()
        .setColor(isApprove ? 0x22C55E : 0xEF4444)
        .setTitle(isApprove ? '✅ Approval Granted' : '❌ Approval Denied')
        .setDescription(`Your request for **${req.action_type}** has been ${isApprove ? 'approved for 20 minutes' : 'denied'}.`)
        .setTimestamp()
      ]}).catch(() => {});
    } catch {}

    await interaction.reply({ content: `${isApprove ? '✅ Approved' : '❌ Denied'} request #${reqId}.`, ephemeral: true });
    await refreshPanel(interaction.client, req.guild_id, 'approvals');
    return true;
  }

  // ── Incident actions ──
  if (id.startsWith('automod_incident_dismiss_')) {
    const incidentId = id.replace('automod_incident_dismiss_', '');
    db.prepare("UPDATE automod_incidents SET auto_resolved = 1, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?").run(interaction.user.id, incidentId);
    await interaction.update({ components: [] });
    return true;
  }

  if (id.startsWith('automod_incident_escalate_')) {
    const incidentId = id.replace('automod_incident_escalate_', '');
    db.prepare("UPDATE automod_incidents SET severity = 'critical' WHERE id = ?").run(incidentId);
    const incident = db.prepare('SELECT * FROM automod_incidents WHERE id = ?').get(incidentId);
    if (incident) {
      await automod.notifyEOB(incident.guild_id, incident.incident_type, incident.target_discord_id, incident.target_username, 'critical', 'escalated', `Escalated by <@${interaction.user.id}>: ${incident.details}`);
    }
    await interaction.reply({ content: '⬆️ Incident escalated to critical. EOB notified.', ephemeral: true });
    return true;
  }

  return false;
}

// ── Post incident with action buttons to alert channel ───────────────────────

export async function postIncidentEmbed(client, guildId, incident) {
  const config = automod.getConfig(guildId);
  if (!config.alert_channel_id) return;

  const channel = client.channels.cache.get(config.alert_channel_id);
  if (!channel) return;

  const SEVERITY_COLORS = { low: 0x3B82F6, medium: 0xF59E0B, high: 0xEF4444, critical: 0x7F1D1D };
  const SEVERITY_EMOJIS = { low: '🔵', medium: '🟡', high: '🔴', critical: '💀' };

  const embed = new EmbedBuilder()
    .setColor(SEVERITY_COLORS[incident.severity] || SEVERITY_COLORS.medium)
    .setTitle(`${SEVERITY_EMOJIS[incident.severity] || '🟡'} AUTOMOD — ${incident.incident_type.replace(/_/g, ' ').toUpperCase()}`)
    .addFields(
      { name: 'User', value: incident.target_discord_id ? `<@${incident.target_discord_id}>` : 'N/A', inline: true },
      { name: 'Action', value: incident.action_taken || 'None', inline: true },
      { name: 'Severity', value: incident.severity?.toUpperCase() || 'MEDIUM', inline: true },
      { name: 'Details', value: (incident.details || '').slice(0, 500), inline: false },
    )
    .setFooter({ text: `Incident #${incident.id || '?'} | CO AutoMod` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`automod_incident_escalate_${incident.id}`).setLabel('Escalate').setStyle(ButtonStyle.Danger).setEmoji('⬆️'),
    new ButtonBuilder().setCustomId(`automod_incident_dismiss_${incident.id}`).setLabel('Dismiss').setStyle(ButtonStyle.Secondary).setEmoji('✅'),
  );

  await channel.send({ embeds: [embed], components: [row] }).catch(() => {});
}
