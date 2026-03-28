import { EmbedBuilder, AuditLogEvent, PermissionFlagsBits } from 'discord.js';
import { db } from '../utils/botDb.js';
import { getUserByDiscordId } from '../db.js';

const INVITE_REGEX = /(discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\/[a-zA-Z0-9]+/gi;
const SEVERITY_COLORS = { low: 0x3B82F6, medium: 0xF59E0B, high: 0xEF4444, critical: 0x7F1D1D };
const SEVERITY_EMOJIS = { low: '🔵', medium: '🟡', high: '🔴', critical: '💀' };

export class AutoMod {
  constructor() {
    this.client = null;
    this.messageCache = new Map();
    this.joinCache = new Map();
  }

  init(client) {
    this.client = client;
  }

  getConfig(guildId) {
    let config = db.prepare('SELECT * FROM automod_config WHERE guild_id = ?').get(guildId);
    if (!config) {
      db.prepare('INSERT OR IGNORE INTO automod_config (guild_id) VALUES (?)').run(guildId);
      config = db.prepare('SELECT * FROM automod_config WHERE guild_id = ?').get(guildId);
    }
    return config;
  }

  isImmune(guildId, targetId, targetType, checkType) {
    if (!targetId) return false;
    const immunity = db.prepare(`SELECT id FROM automod_immunity
      WHERE (guild_id = ? OR guild_id IS NULL) AND target_type = ? AND target_id = ?
        AND (immune_from = ? OR immune_from = 'all')
        AND (expires_at IS NULL OR expires_at > datetime('now'))
      LIMIT 1`).get(guildId, targetType, targetId, checkType);
    return !!immunity;
  }

  hasApproval(guildId, userId, actionType) {
    return !!db.prepare(`SELECT id FROM approval_requests
      WHERE guild_id = ? AND requester_discord_id = ? AND action_type = ? AND status = 'approved'
        AND expires_at > datetime('now') LIMIT 1`).get(guildId, userId, actionType);
  }

  logIncident(guildId, type, targetId, targetUsername, severity, action, details, channelId) {
    const result = db.prepare(`INSERT INTO automod_incidents (guild_id, incident_type, target_discord_id, target_username, severity, action_taken, details, channel_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(guildId, type, targetId || null, targetUsername || null, severity, action, details, channelId || null);

    // Post incident embed with action buttons to alert channel
    if (this.client) {
      import('./automodPanels.js').then(({ postIncidentEmbed, refreshPanel }) => {
        postIncidentEmbed(this.client, guildId, { id: result.lastInsertRowid, incident_type: type, target_discord_id: targetId, target_username: targetUsername, severity, action_taken: action, details });
        refreshPanel(this.client, guildId, 'status');
      }).catch(() => {});
    }
  }

  async notifyEOB(guildId, type, targetId, targetUsername, severity, action, details) {
    const embed = new EmbedBuilder()
      .setColor(SEVERITY_COLORS[severity] || SEVERITY_COLORS.medium)
      .setTitle(`${SEVERITY_EMOJIS[severity] || '🟡'} AutoMod — ${type.replace(/_/g, ' ').toUpperCase()}`)
      .addFields(
        { name: 'Target', value: targetId ? `<@${targetId}> (${targetUsername || targetId})` : 'N/A', inline: true },
        { name: 'Severity', value: severity.toUpperCase(), inline: true },
        { name: 'Action', value: action, inline: true },
        { name: 'Details', value: (details || '').slice(0, 1000), inline: false },
        { name: 'Server', value: this.client?.guilds.cache.get(guildId)?.name || guildId, inline: true },
      )
      .setFooter({ text: 'CO AutoMod System' })
      .setTimestamp();

    // Post to alert channel
    const config = this.getConfig(guildId);
    if (config.alert_channel_id) {
      const ch = this.client?.channels.cache.get(config.alert_channel_id);
      if (ch) await ch.send({ embeds: [embed] }).catch(() => {});
    }

    // DM EOB for high/critical
    if (severity === 'high' || severity === 'critical') {
      try {
        const portalDb = db; // bot already has portal db access via db.js
        const eob = getUserByDiscordId ? null : null; // use direct query
        const Database = (await import('better-sqlite3')).default;
        const pDb = new Database(process.env.PORTAL_DB_PATH, { readonly: true });
        const eobMembers = pDb.prepare("SELECT discord_id FROM users WHERE auth_level >= 7 AND lower(account_status) = 'active' AND discord_id IS NOT NULL AND discord_id != ''").all();
        pDb.close();
        for (const m of eobMembers) {
          const user = await this.client?.users.fetch(m.discord_id).catch(() => null);
          if (user) await user.send({ embeds: [embed] }).catch(() => {});
        }
      } catch (e) { console.error('[AutoMod] EOB DM error:', e.message); }
    }
  }

  async takeAction(guild, member, action, reason, timeoutMinutes) {
    if (!member) return;
    try {
      switch (action) {
        case 'warn': case 'delete_warn':
          await this.issueWarn(guild, member, reason);
          break;
        case 'timeout':
          await member.timeout((timeoutMinutes || 10) * 60 * 1000, `[AutoMod] ${reason}`).catch(() => {});
          break;
        case 'kick':
          await member.kick(`[AutoMod] ${reason}`).catch(() => {});
          break;
        case 'ban':
          await guild.members.ban(member.id, { reason: `[AutoMod] ${reason}` }).catch(() => {});
          break;
        case 'quarantine':
          await this.quarantineUser(guild, member, reason);
          break;
      }
    } catch (e) { console.error('[AutoMod] takeAction error:', e.message); }
  }

  async issueWarn(guild, member, reason) {
    db.prepare(`INSERT INTO infractions (discord_id, type, reason, moderator_id, moderator_name)
      VALUES (?, 'warning', ?, 'AUTOMOD', 'AutoMod')`).run(member.id, `[AutoMod] ${reason}`);
    await member.send({ embeds: [new EmbedBuilder()
      .setColor(0xF59E0B).setTitle('⚠️ Automated Warning')
      .setDescription(`You received an automated warning in **${guild.name}**.\n\n**Reason:** ${reason}`)
      .setFooter({ text: 'CO AutoMod System' }).setTimestamp()
    ]}).catch(() => {});
  }

  async quarantineUser(guild, member, reason) {
    const config = this.getConfig(guild.id);

    // Store current roles
    const currentRoles = member.roles.cache.filter(r => r.id !== guild.id).map(r => r.id);
    db.prepare(`INSERT OR REPLACE INTO stored_roles (discord_id, guild_id, roles, nickname, stored_reason)
      VALUES (?, ?, ?, ?, 'quarantine')`).run(member.id, guild.id, JSON.stringify(currentRoles), member.nickname);

    // Get or create quarantine role
    let qRole = config.quarantine_role_id ? guild.roles.cache.get(config.quarantine_role_id) : null;
    if (!qRole) {
      qRole = await guild.roles.create({ name: 'Quarantine', color: 0xDC2626, permissions: [], reason: '[AutoMod] Quarantine role' }).catch(() => null);
      if (qRole) {
        db.prepare('UPDATE automod_config SET quarantine_role_id = ? WHERE guild_id = ?').run(qRole.id, guild.id);
        for (const [, ch] of guild.channels.cache) {
          await ch.permissionOverwrites.edit(qRole, { ViewChannel: false, SendMessages: false }).catch(() => {});
        }
      }
    }

    await member.roles.set(qRole ? [qRole.id] : []).catch(() => {});
    await member.send({ embeds: [new EmbedBuilder()
      .setColor(0xDC2626).setTitle('🔒 Quarantined')
      .setDescription(`You have been quarantined in **${guild.name}**.\n\n**Reason:** ${reason}\n\nThe moderation team has been notified.`)
      .setFooter({ text: 'CO AutoMod System' }).setTimestamp()
    ]}).catch(() => {});
  }

  async triggerRaidLockdown(guild, reason) {
    const result = db.prepare(`INSERT OR REPLACE INTO lockdown_state (guild_id, lockdown_type, locked_by, reason, is_active)
      VALUES (?, 'server', 'automod', ?, 1)`).run(guild.id, reason);
    const ldId = result.lastInsertRowid;

    const channels = guild.channels.cache.filter(c => c.isTextBased());
    for (const [, ch] of channels) {
      // Snapshot @everyone SendMessages state before locking
      const evOw = ch.permissionOverwrites.cache.get(guild.id);
      const prev = evOw?.allow.has('SendMessages') ? 'allow' : evOw?.deny.has('SendMessages') ? 'deny' : 'neutral';
      db.prepare(`INSERT OR REPLACE INTO lockdown_permission_snapshots (lockdown_id, guild_id, channel_id, role_id, allow_permissions, deny_permissions) VALUES (?, ?, ?, ?, ?, '')`).run(ldId, guild.id, ch.id, guild.id, prev);
      // Only touch @everyone SendMessages
      await ch.permissionOverwrites.edit(guild.id, { SendMessages: false }).catch(() => {});
    }
    const sysChannel = guild.systemChannel || channels.first();
    if (sysChannel) {
      await sysChannel.send({ embeds: [new EmbedBuilder()
        .setColor(0x7F1D1D).setTitle('🚨 RAID LOCKDOWN ACTIVATED')
        .setDescription(`Server auto-locked due to suspected raid.\n\n**Reason:** ${reason}`)
        .setTimestamp()
      ]}).catch(() => {});
    }
  }

  // ── Detection modules ──────────────────────────────────────────────────────

  async checkMessage(message) {
    if (!message.guild || message.author.bot) return;
    const config = this.getConfig(message.guild.id);
    if (!config.enabled) return;

    await this._checkSpam(message, config);
    await this._checkMentionSpam(message, config);
    await this._checkRoleMentions(message, config);
    await this._checkInviteLinks(message, config);
  }

  async checkMemberAdd(member) {
    if (!member.guild) return;
    const config = this.getConfig(member.guild.id);
    if (!config.enabled) return;

    await this._checkNewAccount(member, config);
    await this._checkRaidJoin(member, config);

    // Track for verify timeout
    if (config.verify_timeout_enabled) {
      db.prepare('INSERT OR IGNORE INTO verify_pending (guild_id, discord_id, joined_at) VALUES (?, ?, datetime(\'now\'))').run(member.guild.id, member.id);
    }
  }

  async checkMemberLeave(member) {
    if (!member.guild) return;
    // Track join/leave for mass DM detection
    const recent = db.prepare("SELECT COUNT(*) as c FROM join_rate_log WHERE guild_id = ? AND discord_id = ? AND joined_at > datetime('now', '-1 hour')").get(member.guild.id, member.id);
    if (recent.c >= 3) {
      this.logIncident(member.guild.id, 'mass_dm_suspected', member.id, member.user?.tag, 'high', 'global_ban', 'Joined and left multiple times — suspected mass DM bot');
      for (const g of this.client.guilds.cache.values()) {
        await g.bans.create(member.id, { reason: '[AutoMod] Suspected mass DM bot' }).catch(() => {});
      }
    }
  }

  async checkMemberUpdate(oldMember, newMember) {
    if (!newMember.guild) return;
    const config = this.getConfig(newMember.guild.id);
    if (!config.enabled || !config.permission_guard_enabled) return;
    if (this.isImmune(newMember.guild.id, newMember.id, 'user', 'permission_guard')) return;

    const ADMIN_PERMS = [PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.BanMembers];
    const oldHasAdmin = ADMIN_PERMS.some(p => oldMember.permissions.has(p));
    const newHasAdmin = ADMIN_PERMS.some(p => newMember.permissions.has(p));

    if (!oldHasAdmin && newHasAdmin) {
      const portalUser = getUserByDiscordId(newMember.id);
      if (portalUser && (portalUser.auth_level || 0) >= 99) return;

      await this.quarantineUser(newMember.guild, newMember, 'Unauthorised admin permissions detected');
      this.logIncident(newMember.guild.id, 'unauthorised_permissions', newMember.id, newMember.user.tag, 'critical', 'quarantine', 'Admin permissions granted without authorisation');
      await this.notifyEOB(newMember.guild.id, 'unauthorised_permissions', newMember.id, newMember.user.tag, 'critical', 'quarantine', 'User received admin permissions without authorisation and was quarantined');
    }
  }

  async checkChannelCreate(channel) {
    if (!channel.guild) return;
    const config = this.getConfig(channel.guild.id);
    if (!config.enabled) return;

    // Auto-deny quarantine role on new channels
    if (config.quarantine_role_id) {
      const qRole = channel.guild.roles.cache.get(config.quarantine_role_id);
      if (qRole) await channel.permissionOverwrites.edit(qRole, { ViewChannel: false, SendMessages: false }).catch(() => {});
    }

    if (!config.channel_creation_guard_enabled) return;

    const audit = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelCreate, limit: 1 }).catch(() => null);
    const entry = audit?.entries.first();
    if (!entry?.executor || entry.executor.bot) return;
    if (this.isImmune(channel.guild.id, entry.executor.id, 'user', 'channel_creation')) return;
    if (this.hasApproval(channel.guild.id, entry.executor.id, 'create_channel')) return;

    const portalUser = getUserByDiscordId(entry.executor.id);
    if (portalUser && (portalUser.auth_level || 0) >= 6) return;

    const member = channel.guild.members.cache.get(entry.executor.id);
    if (member) await this.issueWarn(channel.guild, member, `Channel created without approval: #${channel.name}`);
    this.logIncident(channel.guild.id, 'unauthorised_channel', entry.executor.id, entry.executor.tag, 'medium', 'warn', `Created #${channel.name} without approval`);
    await this.notifyEOB(channel.guild.id, 'unauthorised_channel', entry.executor.id, entry.executor.tag, 'medium', 'warn', `Created channel #${channel.name} without approval`);
  }

  async checkRoleCreate(role) {
    if (!role.guild) return;
    const config = this.getConfig(role.guild.id);
    if (!config.enabled || !config.role_creation_guard_enabled) return;

    const audit = await role.guild.fetchAuditLogs({ type: AuditLogEvent.RoleCreate, limit: 1 }).catch(() => null);
    const entry = audit?.entries.first();
    if (!entry?.executor || entry.executor.bot) return;
    if (this.isImmune(role.guild.id, entry.executor.id, 'user', 'role_creation')) return;
    if (this.hasApproval(role.guild.id, entry.executor.id, 'create_role')) return;

    const portalUser = getUserByDiscordId(entry.executor.id);
    if (portalUser && (portalUser.auth_level || 0) >= 6) return;

    const member = role.guild.members.cache.get(entry.executor.id);
    if (member) await this.issueWarn(role.guild, member, `Role created without approval: ${role.name}`);
    this.logIncident(role.guild.id, 'unauthorised_role', entry.executor.id, entry.executor.tag, 'medium', 'warn', `Created role "${role.name}" without approval`);
    await this.notifyEOB(role.guild.id, 'unauthorised_role', entry.executor.id, entry.executor.tag, 'medium', 'warn', `Created role "${role.name}" without approval`);
  }

  // ── Private detection methods ──────────────────────────────────────────────

  async _checkSpam(message, config) {
    if (!config.spam_enabled) return;
    if (this.isImmune(message.guild.id, message.author.id, 'user', 'spam')) return;

    const key = `spam_${message.guild.id}_${message.author.id}`;
    const now = Date.now();
    const window = config.spam_window_seconds * 1000;
    const ts = (this.messageCache.get(key) || []).filter(t => now - t < window);
    ts.push(now);
    this.messageCache.set(key, ts);

    if (ts.length >= config.spam_threshold) {
      const recent = await message.channel.messages.fetch({ limit: 20 }).catch(() => null);
      if (recent) {
        const spam = recent.filter(m => m.author.id === message.author.id && Date.now() - m.createdTimestamp < window * 2);
        if (spam.size > 1) await message.channel.bulkDelete(spam).catch(() => {});
      }
      const member = message.guild.members.cache.get(message.author.id);
      if (member) await this.takeAction(message.guild, member, config.spam_action, 'Message spam detected', config.spam_timeout_minutes);
      this.logIncident(message.guild.id, 'spam', message.author.id, message.author.tag, 'medium', config.spam_action, `${ts.length} msgs in ${config.spam_window_seconds}s in #${message.channel.name}`, message.channel.id);
      await this.notifyEOB(message.guild.id, 'spam', message.author.id, message.author.tag, 'medium', config.spam_action, `${ts.length} messages in ${config.spam_window_seconds}s`);
      this.messageCache.set(key, []);
    }
  }

  async _checkMentionSpam(message, config) {
    if (!config.mention_spam_enabled) return;
    if (this.isImmune(message.guild.id, message.author.id, 'user', 'mention_spam')) return;
    const total = message.mentions.users.size + message.mentions.roles.size;
    if (total === 0) return;

    const key = `mention_${message.guild.id}_${message.author.id}`;
    const now = Date.now();
    const window = config.mention_window_seconds * 1000;
    const ts = (this.messageCache.get(key) || []).filter(t => now - t < window);
    for (let i = 0; i < total; i++) ts.push(now);
    this.messageCache.set(key, ts);

    if (ts.length >= config.mention_threshold) {
      await message.delete().catch(() => {});
      const member = message.guild.members.cache.get(message.author.id);
      if (member) await this.takeAction(message.guild, member, config.mention_action, 'Mention spam detected');
      this.logIncident(message.guild.id, 'mention_spam', message.author.id, message.author.tag, 'high', config.mention_action, `${ts.length} mentions in ${config.mention_window_seconds}s`, message.channel.id);
      await this.notifyEOB(message.guild.id, 'mention_spam', message.author.id, message.author.tag, 'high', config.mention_action, `${ts.length} mentions in ${config.mention_window_seconds}s`);
      this.messageCache.set(key, []);
    }
  }

  async _checkRoleMentions(message, config) {
    if (!config.role_mention_enabled) return;
    if (this.isImmune(message.guild.id, message.author.id, 'user', 'role_mention')) return;
    if (message.mentions.roles.size < config.role_mention_threshold) return;

    await message.delete().catch(() => {});
    const member = message.guild.members.cache.get(message.author.id);
    if (member) await this.issueWarn(message.guild, member, `Mass role mention: ${message.mentions.roles.size} roles`);
    this.logIncident(message.guild.id, 'mass_role_mention', message.author.id, message.author.tag, 'high', 'delete_warn', `${message.mentions.roles.size} roles mentioned`, message.channel.id);
    await this.notifyEOB(message.guild.id, 'mass_role_mention', message.author.id, message.author.tag, 'high', 'delete_warn', `${message.mentions.roles.size} role mentions in single message`);
  }

  async _checkInviteLinks(message, config) {
    if (!config.invite_links_enabled) return;
    if (this.isImmune(message.guild.id, message.author.id, 'user', 'invite_links')) return;
    if (!INVITE_REGEX.test(message.content)) return;
    INVITE_REGEX.lastIndex = 0;

    await message.delete().catch(() => {});
    const member = message.guild.members.cache.get(message.author.id);
    if (member) await this.issueWarn(message.guild, member, 'Discord invite links are not permitted');
    this.logIncident(message.guild.id, 'invite_link', message.author.id, message.author.tag, 'medium', 'delete_warn', `Invite link in #${message.channel.name}`, message.channel.id);
  }

  async _checkNewAccount(member, config) {
    if (!config.new_account_enabled) return;
    if (this.isImmune(member.guild.id, member.id, 'user', 'new_account')) return;
    const ageDays = (Date.now() - member.user.createdTimestamp) / 86400000;
    if (ageDays >= config.new_account_min_age_days) return;

    await this.takeAction(member.guild, member, config.new_account_action, `Account too new (${Math.floor(ageDays)}d, min ${config.new_account_min_age_days}d)`);
    this.logIncident(member.guild.id, 'new_account', member.id, member.user.tag, 'high', config.new_account_action, `Account age: ${Math.floor(ageDays)} days`);
    await this.notifyEOB(member.guild.id, 'new_account', member.id, member.user.tag, 'high', config.new_account_action, `Account only ${Math.floor(ageDays)} days old (min: ${config.new_account_min_age_days})`);
  }

  async _checkRaidJoin(member, config) {
    if (!config.raid_detection_enabled) return;

    db.prepare('INSERT INTO join_rate_log (guild_id, discord_id) VALUES (?, ?)').run(member.guild.id, member.id);
    db.prepare("DELETE FROM join_rate_log WHERE guild_id = ? AND joined_at < datetime('now', '-' || ? || ' seconds')").run(member.guild.id, config.raid_join_window_seconds);

    const count = db.prepare('SELECT COUNT(*) as c FROM join_rate_log WHERE guild_id = ?').get(member.guild.id).c;
    if (count >= config.raid_join_threshold) {
      console.warn(`[AutoMod] RAID DETECTED in ${member.guild.name}: ${count} joins in ${config.raid_join_window_seconds}s`);
      if (config.raid_action === 'lockdown') await this.triggerRaidLockdown(member.guild, `Raid: ${count} joins in ${config.raid_join_window_seconds}s`);
      this.logIncident(member.guild.id, 'raid_detected', null, 'Multiple', 'critical', config.raid_action, `${count} joins in ${config.raid_join_window_seconds}s — RAID LOCKDOWN`);
      await this.notifyEOB(member.guild.id, 'raid_detected', null, 'Multiple users', 'critical', config.raid_action, `${count} joins in ${config.raid_join_window_seconds}s — RAID PROTOCOL ACTIVATED`);
    }
  }

  // ── Verify timeout cron ────────────────────────────────────────────────────

  async processVerifyTimeouts() {
    const configs = db.prepare('SELECT * FROM automod_config WHERE verify_timeout_enabled = 1').all();
    for (const config of configs) {
      const guild = this.client?.guilds.cache.get(config.guild_id);
      if (!guild) continue;

      const pending = db.prepare('SELECT * FROM verify_pending WHERE guild_id = ? AND terminated = 0').all(config.guild_id);
      for (const p of pending) {
        const portalUser = getUserByDiscordId(p.discord_id);
        if (portalUser?.discord_id) { db.prepare('DELETE FROM verify_pending WHERE id = ?').run(p.id); continue; }
        const verified = db.prepare('SELECT id FROM verified_members WHERE discord_id = ?').get(p.discord_id);
        if (verified) { db.prepare('DELETE FROM verify_pending WHERE id = ?').run(p.id); continue; }

        const hours = (Date.now() - new Date(p.joined_at).getTime()) / 3600000;

        if (hours >= config.verify_warning_hours && !p.warning_sent) {
          const member = await guild.members.fetch(p.discord_id).catch(() => null);
          if (member) {
            await member.send({ embeds: [new EmbedBuilder()
              .setColor(0xF59E0B).setTitle('⚠️ Verification Required')
              .setDescription(`You joined **${guild.name}** ${Math.floor(hours)} hours ago without verifying.\n\nRun \`/verify\` immediately. You will be removed in ${config.verify_terminate_hours - config.verify_warning_hours} hours.`)
              .setFooter({ text: 'CO AutoMod System' })
            ]}).catch(() => {});
          }
          db.prepare("UPDATE verify_pending SET warning_sent = 1, warning_sent_at = datetime('now') WHERE id = ?").run(p.id);
        }

        if (hours >= config.verify_terminate_hours && p.warning_sent) {
          const member = await guild.members.fetch(p.discord_id).catch(() => null);
          if (member) {
            await member.send({ embeds: [new EmbedBuilder()
              .setColor(0xEF4444).setTitle('❌ Removed — Failure to Verify')
              .setDescription(`You were removed from **${guild.name}** for not verifying within ${config.verify_terminate_hours} hours.`)
              .setFooter({ text: 'CO AutoMod System' })
            ]}).catch(() => {});
            await member.kick('[AutoMod] Verify timeout').catch(() => {});
          }
          db.prepare('UPDATE verify_pending SET terminated = 1 WHERE id = ?').run(p.id);
          this.logIncident(config.guild_id, 'verify_timeout', p.discord_id, 'Unknown', 'medium', 'kick', `No verification after ${config.verify_terminate_hours}h`);
        }
      }
    }
  }

  // ── Auto-unlock cron ───────────────────────────────────────────────────────

  async processAutoUnlocks() {
    const expired = db.prepare("SELECT * FROM lockdown_state WHERE is_active = 1 AND auto_unlock_at IS NOT NULL AND auto_unlock_at <= datetime('now')").all();
    for (const ld of expired) {
      try {
        const guild = this.client?.guilds.cache.get(ld.guild_id);
        if (!guild) continue;

        // Get all snapshot channels for this lockdown
        const snaps = db.prepare('SELECT * FROM lockdown_permission_snapshots WHERE lockdown_id = ?').all(ld.id);
        for (const snap of snaps) {
          const ch = guild.channels.cache.get(snap.channel_id);
          if (!ch) continue;
          // Restore only @everyone SendMessages from snapshot
          if (snap.allow_permissions === 'allow') {
            await ch.permissionOverwrites.edit(guild.id, { SendMessages: true }).catch(() => {});
          } else if (snap.allow_permissions === 'deny') {
            // Was already denied — leave it
          } else {
            await ch.permissionOverwrites.edit(guild.id, { SendMessages: null }).catch(() => {});
          }
        }

        // If single channel lockdown, also notify
        if (ld.channel_id) {
          const ch = guild.channels.cache.get(ld.channel_id);
          if (ch) await ch.send({ embeds: [new EmbedBuilder().setColor(0x22C55E).setTitle('🔓 Auto-Unlocked').setDescription('Lockdown duration expired.').setTimestamp()] }).catch(() => {});
        }

        db.prepare("UPDATE lockdown_state SET is_active = 0, unlocked_at = datetime('now') WHERE id = ?").run(ld.id);
        db.prepare('DELETE FROM lockdown_permission_snapshots WHERE lockdown_id = ?').run(ld.id);
        console.log(`[AutoMod] Auto-unlocked lockdown #${ld.id}`);
      } catch (e) { console.error('[AutoMod] Auto-unlock error:', e.message); }
    }
  }
}

export const automod = new AutoMod();
