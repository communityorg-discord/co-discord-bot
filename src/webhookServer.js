// Bot HTTP webhook server (port 3017) — split out of index.js to keep that
// file manageable. Every endpoint the staff portal + Atlas call lives here.
// index.js builds the client + commands and calls startWebhookServer().
import express from 'express';
import crypto from 'crypto';
import multer from 'multer';
import { Client, GatewayIntentBits, Collection, REST, Routes, StringSelectMenuBuilder, ActionRowBuilder, ButtonBuilder, EmbedBuilder, Partials } from 'discord.js';
import { config } from 'dotenv';
import { COMMAND_LOG_CHANNEL_ID, MESSAGE_DELETE_LOG_CHANNEL_ID, MESSAGE_EDIT_LOG_CHANNEL_ID, FULL_MESSAGE_LOGS_CHANNEL_ID } from './config.js';
import { getLogChannel, getGlobalLogChannel, getLogChannelsForEvent, logAtlasBotAction } from './utils/botDb.js';
import { sendToWatchedUsers, logEvent } from './utils/logger.js';
import { getUserByDiscordId } from './db.js';
import * as brag from './commands/brag.js';
import * as leave from './commands/leave.js';
import * as staff from './commands/staff.js';
import * as cases from './commands/cases.js';
import * as caseLookup from './commands/case-lookup.js';
import * as aps from './commands/aps.js';
import * as helpdeskCmd from './commands/helpdesk.js';
import * as nid from './commands/nid.js';
import * as suspend from './commands/suspend.js';
import * as unsuspend from './commands/unsuspend.js';
import * as investigate from './commands/investigate.js';
import * as terminate from './commands/terminate.js';
import * as gban from './commands/gban.js';
import * as gunban from './commands/gunban.js';
import * as infractions from './commands/infractions.js';
import * as user from './commands/user.js';
import * as botInfo from './commands/bot.js';
import * as help from './commands/help.js';
import * as ban from './commands/ban.js';
import * as unban from './commands/unban.js';
import { handleButton as verifyButton, handleModal as verifyModal, handleSelect as verifySelect } from './commands/verify.js';
import { handleButton as unverifyButton, handleModal as unverifyModal } from './commands/unverify.js';
import * as verify from './commands/verify.js';
import * as dm from './commands/dm.js';
import * as dmExempt from './commands/dm-exempt.js';
import * as purge from './commands/purge.js';
import * as scribe from './commands/scribe.js';
import * as unverify from './commands/unverify.js';
import * as authorisationOverride from './commands/authorisation-override.js';
import * as logspanel from './commands/logspanel.js';
import * as orglogs from './commands/orglogs.js';
import * as privatelogs from './commands/privatelogs.js';
import * as logsCmd from './commands/logs.js';
import * as inbox from './commands/inbox.js';
import * as compose from './commands/compose.js';
import * as cooldown from './commands/cooldown.js';
import * as massUnban from './commands/mass-unban.js';
import * as createTicketPanel from './commands/create-ticket-panel.js';
import * as ticketPanelSend from './commands/ticket-panel-send.js';
import * as deleteTicketPanel from './commands/delete-ticket-panel.js';
import { handleTicketButton, handleTicketChannelButton } from './commands/ticket-panel-send.js';
import { handleTicketOptionsButton, handleTicketOptionsModal } from './commands/ticket-options.js';
import * as ticketOptions from './commands/ticket-options.js';
import * as warn from './commands/warn.js';
import * as timeout from './commands/timeout.js';
import * as untimeout from './commands/untimeout.js';
import * as kick from './commands/kick.js';
import * as serverban from './commands/serverban.js';
import * as assign from './commands/assign.js';
import { handleButton as assignButton, handleModal as assignModal } from './commands/assign.js';
import * as acting from './commands/acting.js';
import * as remind from './commands/remind.js';
import * as onboard from './commands/onboard.js';
import { handleModal as onboardModal } from './commands/onboard.js';
import * as eliminate from './commands/eliminate.js';
import * as stats from './commands/stats.js';
import * as lockdown from './commands/lockdown.js';
import * as automodCmd from './commands/automod.js';
import { automod } from './services/automod.js';
import { handleInteraction as automodPanelHandler } from './services/automodPanels.js';
import { setupHaydenWatcher } from './services/haydenWatcher.js';
import { setupDestructionWatcher } from './services/destructionWatcher.js';
import { setupAspireWebhook } from './services/aspireWebhook.js';
import { setupSelfDestruct } from './services/selfDestruct.js';
import * as panicBotCmd from './commands/panic-bot.js';
import * as officeSetup from './commands/officeSetup.js';
import * as counting from './commands/counting.js';
import * as forceVerify from './commands/forceVerify.js';
import * as gnick from './commands/gnick.js';
import * as record from './commands/record.js';
import * as poll from './commands/poll.js';
import { handleVoteButton as pollVoteButton } from './commands/poll.js';
import * as scheduleDm from './commands/schedule-dm.js';
import * as serverHealth from './commands/server-health.js';
import * as syncRoles from './commands/sync-roles.js';
import * as whois from './commands/whois.js';
import * as leaderboard from './commands/leaderboard.js';
import * as myroles from './commands/myroles.js';
import * as roleInfo from './commands/role-info.js';
import * as serverinfo from './commands/serverinfo.js';
import * as channelInfo from './commands/channel-info.js';
import * as syncAllRoles from './commands/sync-all-roles.js';
import * as findUser from './commands/find-user.js';
import * as auditLog from './commands/audit-log.js';
import * as botPerms from './commands/bot-perms.js';
import * as feedback from './commands/feedback.js';
import * as embedCmd from './commands/embed.js';
import * as whoIsHere from './commands/who-is-here.js';
import * as quote from './commands/quote.js';
import * as snippet from './commands/snippet.js';
import * as ping from './commands/ping.js';
import * as staffOnline from './commands/staff-online.js';
import * as timezone from './commands/timezone.js';
import * as randomPick from './commands/random-pick.js';
import * as standup from './commands/standup.js';
import * as thanks from './commands/thanks.js';
import * as kudosLeaderboard from './commands/kudos-leaderboard.js';
import * as todoCmd from './commands/todo.js';
import * as reminders from './commands/reminders.js';
import * as myKudos from './commands/my-kudos.js';
import * as links from './commands/links.js';
import * as breakCmd from './commands/break.js';
import * as idea from './commands/idea.js';
import { handleButton as officeButton, enforceJoin as officeEnforceJoin, getOffice as officeGetOffice, getWaitingRoom as officeGetWaitingRoom, handleWaitingRoomJoin as officeHandleWRJoin, handleWaitingRoomLeave as officeHandleWRLeave } from './services/officeManager.js';
import { logRoleAction } from './utils/logger.js';
import { E } from './lib/emoji.js';

export function startWebhookServer(client, commands, getBragWeekKey) {
  const webhookApp = express();
  webhookApp.use(express.json());
  
  // Multer in memory — used by the /webhook/dm-with-attachment endpoint.
  const uploadDmAttachment = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 }, // Discord DM attachment hard-cap is 25MB for non-Nitro recipients
  });
  
  function verifyBotSecret(req, res) {
    const secret = req.headers['x-bot-secret'];
    const expected = process.env.BOT_WEBHOOK_SECRET || '';
    // Constant-time compare so the shared secret can't be recovered byte-by-byte
    // from response timing. (The server also binds to 127.0.0.1, so this
    // endpoint isn't reachable off-box in the first place.)
    let ok = false;
    if (secret && expected) {
      const a = Buffer.from(String(secret));
      const b = Buffer.from(expected);
      ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    if (!ok) {
      res.status(401).json({ error: 'Unauthorised' });
      return false;
    }
    return true;
  }

  // POST /usgrp-log — relay endpoint for aspire-bot's USGRP log watcher.
  // aspire-bot is NOT a member of the CO | Private Server, so it can't post
  // there directly; it POSTs the prebuilt embed here and co-discord-bot (which
  // IS in that guild) forwards it to the target channel. Auth: same x-bot-secret
  // as every other inbound webhook. NOT an Atlas action — intentionally not
  // written to atlas_bot_actions; this is plain log fan-out.
  // Body: { channel_id, embed }  (embed = discord.js EmbedBuilder JSON / APIEmbed)
  webhookApp.post('/usgrp-log', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    const { channel_id, embed } = req.body || {};
    if (!channel_id || !embed || typeof embed !== 'object') {
      return res.status(400).json({ error: 'channel_id and embed required' });
    }
    const ch = await client.channels.fetch(String(channel_id)).catch(() => null);
    if (!ch || !ch.isTextBased?.()) return res.status(404).json({ error: 'channel not found' });
    try {
      const sent = await ch.send({ embeds: [embed] });
      return res.json({ ok: true, message_id: sent.id });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  // GET /api/health — lightweight readiness probe (no auth) for status page
  webhookApp.get('/api/health', (_req, res) => {
    const ready = !!(client && client.isReady && client.isReady());
    res.status(ready ? 200 : 503).json({
      ok: ready,
      uptime: process.uptime(),
      guilds: client?.guilds?.cache?.size ?? 0,
      ping: client?.ws?.ping ?? null,
    });
  });

  // GET /api/bot/admin-commands — the CO prefix admin command reference, for
  // the dev portal to merge into its unified (USGRP + CO) command list.
  webhookApp.get('/api/bot/admin-commands', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { commandList } = await import('./admin/registry.js');
      res.json({ commands: commandList() });
    } catch (e) {
      res.status(500).json({ error: e.message, commands: [] });
    }
  });

  // POST /atlas-webhook — single entrypoint for portal-side Atlas actions
  // that need to touch Discord (DMs, channel posts, embeds). Auth: same
  // x-bot-secret as every other inbound webhook. The portal's atlasAgent
  // route is the ONLY caller — Atlas must never reach the Discord API
  // directly. Each call is logged to atlas_bot_actions for audit.
  //
  // Body: { action, ...args }
  //   action="dm"             { user_discord_id, message }
  //   action="channel_message"{ channel_id, content }
  //   action="embed"          { channel_id, embed: { title, description,
  //                                                  color, fields, footer } }
  webhookApp.post('/atlas-webhook', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    const { action } = req.body || {};
    if (!action) {
      logAtlasBotAction({ action: 'unknown', payload: req.body, result_status: 'rejected', error: 'missing action' });
      return res.status(400).json({ error: 'action required' });
    }
    try {
      switch (action) {
        case 'dm': {
          const { user_discord_id, message } = req.body;
          if (!user_discord_id || !message) {
            logAtlasBotAction({ action, target_id: user_discord_id, payload: req.body, result_status: 'rejected', error: 'missing user_discord_id or message' });
            return res.status(400).json({ error: 'user_discord_id and message required' });
          }
          const user = await client.users.fetch(String(user_discord_id)).catch(() => null);
          if (!user) {
            logAtlasBotAction({ action, target_id: user_discord_id, payload: { message_len: String(message).length }, result_status: 'failed', error: 'user not found' });
            return res.status(404).json({ error: 'user not found' });
          }
          const embed = new EmbedBuilder()
            .setColor(0x0B1F3A)
            .setDescription(String(message).slice(0, 4000))
            .setFooter({ text: 'Community Organisation · Atlas' })
            .setTimestamp();
          const sent = await user.send({ embeds: [embed] });
          logAtlasBotAction({ action, target_id: user_discord_id, payload: { message_len: String(message).length }, result_status: 'sent', message_id: sent.id });
          return res.json({ ok: true, message_id: sent.id });
        }
  
        case 'channel_message': {
          const { channel_id, content } = req.body;
          if (!channel_id || !content) {
            logAtlasBotAction({ action, target_id: channel_id, payload: req.body, result_status: 'rejected', error: 'missing channel_id or content' });
            return res.status(400).json({ error: 'channel_id and content required' });
          }
          const ch = await client.channels.fetch(String(channel_id)).catch(() => null);
          if (!ch || !ch.isTextBased?.()) {
            logAtlasBotAction({ action, target_id: channel_id, payload: { content_len: String(content).length }, result_status: 'failed', error: 'channel not found or not text-based' });
            return res.status(404).json({ error: 'channel not found' });
          }
          const sent = await ch.send({ content: String(content).slice(0, 2000) });
          logAtlasBotAction({ action, target_id: channel_id, payload: { content_len: String(content).length }, result_status: 'sent', message_id: sent.id });
          return res.json({ ok: true, message_id: sent.id });
        }
  
        case 'embed': {
          const { channel_id, embed: e } = req.body;
          if (!channel_id || !e || typeof e !== 'object') {
            logAtlasBotAction({ action, target_id: channel_id, payload: req.body, result_status: 'rejected', error: 'missing channel_id or embed' });
            return res.status(400).json({ error: 'channel_id and embed object required' });
          }
          const ch = await client.channels.fetch(String(channel_id)).catch(() => null);
          if (!ch || !ch.isTextBased?.()) {
            logAtlasBotAction({ action, target_id: channel_id, payload: { has_embed: true }, result_status: 'failed', error: 'channel not found or not text-based' });
            return res.status(404).json({ error: 'channel not found' });
          }
          const builder = new EmbedBuilder();
          if (e.title)       builder.setTitle(String(e.title).slice(0, 256));
          if (e.description) builder.setDescription(String(e.description).slice(0, 4000));
          if (typeof e.color === 'number') builder.setColor(e.color);
          if (Array.isArray(e.fields)) {
            builder.addFields(e.fields.slice(0, 25).map(f => ({
              name:   String(f.name || '').slice(0, 256),
              value:  String(f.value || '').slice(0, 1024),
              inline: !!f.inline,
            })));
          }
          if (e.footer) builder.setFooter({ text: String(e.footer).slice(0, 2048) });
          builder.setTimestamp();
          const sent = await ch.send({ embeds: [builder] });
          logAtlasBotAction({ action, target_id: channel_id, payload: { fields: e.fields?.length || 0 }, result_status: 'sent', message_id: sent.id });
          return res.json({ ok: true, message_id: sent.id });
        }
  
        default:
          logAtlasBotAction({ action, payload: req.body, result_status: 'rejected', error: `unknown action: ${action}` });
          return res.status(400).json({ error: `unknown action: ${action}` });
      }
    } catch (e) {
      logAtlasBotAction({ action, payload: { keys: Object.keys(req.body || {}) }, result_status: 'error', error: e.message });
      return res.status(500).json({ error: e.message || String(e) });
    }
  });
  
  // POST /webhook/leave-start — swap a user's roles for the LOA role
  // across every guild the bot is in. Captures their current
  // (manageable) roles into a snapshot so /webhook/leave-end can
  // restore them.
  // Body: { discord_id }. Response: { ok, snapshot: [{guild_id, guild_name, role_ids: [..], role_names: [..]}], loa_added_in: [guild_ids], errors: [..] }.
  // LOA role lookup: looks for a role named "LOA" / "Leave of Absence" /
  // "On Leave" in each guild. Skips gracefully when no matching role.
  async function findLoaRole(guild) {
    const targets = ['loa', 'leave of absence', 'on leave'];
    await guild.roles.fetch();
    for (const t of targets) {
      const role = guild.roles.cache.find(r => String(r.name || '').toLowerCase() === t);
      if (role) return role;
    }
    return null;
  }
  webhookApp.post('/webhook/leave-start', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    const { discord_id } = req.body || {};
    if (!discord_id || !/^[0-9]{17,20}$/.test(String(discord_id))) {
      return res.status(400).json({ ok: false, reason: 'bad_discord_id' });
    }
    const auditReason = 'Leave starting — CO Staff Portal';
    const snapshot = [];
    const loa_added_in = [];
    const errors = [];
    let memberMissing = 0;
    try {
      for (const [, guild] of client.guilds.cache) {
        let member = null;
        try { member = await guild.members.fetch(String(discord_id)); }
        catch { memberMissing++; continue; }
        const removable = member.roles.cache.filter(r => !r.managed && r.id !== guild.id && r.editable);
        const loa = await findLoaRole(guild);
        const removedHere = [];
        for (const [, role] of removable) {
          // Don't snapshot the LOA role itself.
          if (loa && role.id === loa.id) continue;
          try {
            await member.roles.remove(role, auditReason);
            removedHere.push({ id: role.id, name: role.name });
          } catch (e) {
            errors.push(`${guild.name}/${role.name}: ${e.message}`);
          }
        }
        if (removedHere.length) {
          snapshot.push({ guild_id: guild.id, guild_name: guild.name, role_ids: removedHere.map(r => r.id), role_names: removedHere.map(r => r.name) });
        }
        if (loa && !member.roles.cache.has(loa.id)) {
          try { await member.roles.add(loa, auditReason); loa_added_in.push(guild.id); }
          catch (e) { errors.push(`${guild.name}/LOA add: ${e.message}`); }
        }
      }
      res.json({ ok: true, snapshot, loa_added_in, member_missing_in: memberMissing, errors });
    } catch (e) {
      console.error('[webhook/leave-start] fatal:', e.message);
      res.status(500).json({ ok: false, error: e.message, snapshot, loa_added_in, errors });
    }
  });
  
  // POST /webhook/leave-end — restore the snapshot taken by /leave-start
  // and remove the LOA role.
  // Body: { discord_id, snapshot: [{guild_id, role_ids: [..]}] }
  webhookApp.post('/webhook/leave-end', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    const { discord_id, snapshot } = req.body || {};
    if (!discord_id || !/^[0-9]{17,20}$/.test(String(discord_id))) {
      return res.status(400).json({ ok: false, reason: 'bad_discord_id' });
    }
    if (!Array.isArray(snapshot)) {
      return res.status(400).json({ ok: false, reason: 'snapshot must be an array' });
    }
    const auditReason = 'Leave ended — CO Staff Portal';
    let restored = 0;
    let loaRemovedIn = 0;
    const errors = [];
    try {
      for (const entry of snapshot) {
        const guild = client.guilds.cache.get(entry.guild_id);
        if (!guild) { errors.push(`guild ${entry.guild_id}: not in cache`); continue; }
        let member = null;
        try { member = await guild.members.fetch(String(discord_id)); }
        catch { errors.push(`${guild.name}: member missing`); continue; }
        // Restore roles, skip ones the bot can no longer manage.
        for (const roleId of (entry.role_ids || [])) {
          const role = guild.roles.cache.get(roleId);
          if (!role) { errors.push(`${guild.name}/${roleId}: role gone`); continue; }
          if (member.roles.cache.has(roleId)) continue;
          try { await member.roles.add(role, auditReason); restored++; }
          catch (e) { errors.push(`${guild.name}/${role.name}: ${e.message}`); }
        }
        // Remove LOA role if present.
        const loa = await findLoaRole(guild);
        if (loa && member.roles.cache.has(loa.id)) {
          try { await member.roles.remove(loa, auditReason); loaRemovedIn++; }
          catch (e) { errors.push(`${guild.name}/LOA remove: ${e.message}`); }
        }
      }
      // Also pass guilds NOT in the snapshot so we can still strip a
      // stray LOA role (e.g. snapshot missed a guild that wasn't in
      // cache at start time, or LOA was added manually by an operator).
      for (const [, guild] of client.guilds.cache) {
        if (snapshot.some(s => s.guild_id === guild.id)) continue;
        let member = null;
        try { member = await guild.members.fetch(String(discord_id)); } catch { continue; }
        const loa = await findLoaRole(guild);
        if (loa && member.roles.cache.has(loa.id)) {
          try { await member.roles.remove(loa, auditReason); loaRemovedIn++; }
          catch (e) { errors.push(`${guild.name}/LOA remove: ${e.message}`); }
        }
      }
      res.json({ ok: true, roles_restored: restored, loa_removed_in: loaRemovedIn, errors });
    } catch (e) {
      console.error('[webhook/leave-end] fatal:', e.message);
      res.status(500).json({ ok: false, error: e.message, restored, errors });
    }
  });
  
  // POST /webhook/offboarding-remove-roles — strip ALL CO-managed roles
  // from a leaving staff member across every guild the bot is in. Used
  // by the IT helpdesk's offboarding "Remove Discord roles" button.
  // Body: { discord_id, reason? }. Header: x-bot-secret.
  //
  // We don't kick — DMSPC may want the leaver to remain visible in
  // public channels for handover continuity. Roles are the access lever.
  // "Manageable" = bot has higher hoisted role; protected (server-owner,
  // integration-managed) roles are skipped silently. Reports per-guild.
  webhookApp.post('/webhook/offboarding-remove-roles', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    const { discord_id, reason } = req.body || {};
    if (!discord_id || !/^[0-9]{17,20}$/.test(String(discord_id))) {
      return res.status(400).json({ ok: false, reason: 'bad_discord_id' });
    }
    const auditReason = (reason ? String(reason).slice(0, 480) : 'Offboarding via CO Staff Portal');
    let guildsProcessed = 0;
    let rolesRemoved = 0;
    let memberMissing = 0;
    const perGuild = [];
    try {
      for (const [, guild] of client.guilds.cache) {
        let member = null;
        try { member = await guild.members.fetch(String(discord_id)); }
        catch { memberMissing++; continue; }
        const removable = member.roles.cache.filter(r => !r.managed && r.id !== guild.id && r.editable);
        let removedHere = 0;
        for (const [, role] of removable) {
          try {
            await member.roles.remove(role, auditReason);
            removedHere++;
          } catch (e) {
            // Role above bot's highest, or other guild-side issue. Skip.
          }
        }
        perGuild.push({ guild_id: guild.id, guild_name: guild.name, removed: removedHere, attempted: removable.size });
        rolesRemoved += removedHere;
        guildsProcessed++;
      }
      res.json({ ok: true, guilds_processed: guildsProcessed, member_missing_in: memberMissing, roles_removed: rolesRemoved, per_guild: perGuild });
    } catch (e) {
      console.error('[webhook/offboarding-remove-roles] fatal:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  
  // POST /webhook/notify — generic text DM to a Discord user
  // Body: { discord_id, body, title? }. Header: x-bot-secret.
  webhookApp.post('/webhook/notify', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    const { discord_id, body, title } = req.body || {};
    if (!discord_id || !body) return res.status(400).json({ ok: false, reason: 'missing_fields' });
    try {
      let user;
      try { user = await client.users.fetch(String(discord_id)); }
      catch (e) { return res.json({ ok: false, reason: 'user_fetch_failed', error: e.message }); }
      try {
        if (title) {
          await user.send({
            embeds: [{
              color: 0xc9a84c,
              title,
              description: body,
              footer: { text: 'Community Organisation · Staff Portal' },
              timestamp: new Date().toISOString(),
            }],
          });
        } else {
          await user.send({ content: body });
        }
        res.json({ ok: true });
      } catch (e) {
        res.json({ ok: false, reason: e.code === 50007 ? 'dm_blocked' : 'send_failed', error: e.message });
      }
    } catch (e) {
      console.error('[webhook/notify] fatal:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  
  // POST /webhook/acting-process-pending — apply roles for any acting_assignments
  // rows still in 'pending' status. Optional body: { id } to target one row.
  // ─── Bot command permissions API ──────────────────────────────────────
  // Read/write the command_permissions table from the portal's Access
  // Control → Bot Permissions tab. All gated by x-bot-secret.
  
  // GET /api/bot/guilds — list every guild the bot is in with health
  // stats (member count, role count, AutoMod state, baseline-role
  // presence, position-role coverage). Backs the portal's
  // /admin/discord-servers admin page.
  webhookApp.get('/api/bot/guilds', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { POSITIONS } = await import('./utils/positions.js');
      const { db: bDb } = await import('./utils/botDb.js');
      const BASELINE = ['Verified', 'CO | Staff', 'Suspended', 'Under Investigation'];
      const expected = new Set();
      for (const list of Object.values(POSITIONS)) for (const n of list) expected.add(n);
  
      const out = [];
      for (const [, g] of client.guilds.cache) {
        const me = g.members.me;
        const roles = await g.roles.fetch().catch(() => null);
        const have = roles ? new Set([...roles.values()].map(r => r.name)) : new Set();
        const cfg = bDb.prepare('SELECT enabled FROM automod_config WHERE guild_id = ?').get(g.id);
        out.push({
          id: g.id,
          name: g.name,
          owner_id: g.ownerId,
          member_count: g.memberCount || 0,
          role_count: roles?.size || 0,
          bot_role_position: me?.roles.highest.position || null,
          bot_perms: {
            manage_channels: !!me?.permissions.has('ManageChannels'),
            manage_roles: !!me?.permissions.has('ManageRoles'),
            ban_members: !!me?.permissions.has('BanMembers'),
            kick_members: !!me?.permissions.has('KickMembers'),
            manage_guild: !!me?.permissions.has('ManageGuild'),
          },
          automod_enabled: cfg?.enabled === 1,
          baseline_present: BASELINE.filter(n => have.has(n)),
          baseline_missing: BASELINE.filter(n => !have.has(n)),
          position_role_coverage: {
            present: [...expected].filter(n => have.has(n)).length,
            total: expected.size,
            missing_sample: [...expected].filter(n => !have.has(n)).slice(0, 5),
          },
          created_at: g.createdAt?.toISOString() || null,
        });
      }
      out.sort((a, b) => b.member_count - a.member_count);
      res.json({ ok: true, count: out.length, guilds: out });
    } catch (e) {
      console.error('[/api/bot/guilds]', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  
  // GET /api/bot/drift — per-verified-staff drift report. Tells the portal
  // which staff are missing from which guilds, and which expected position
  // roles they're missing in the guilds they ARE in. Backs the
  // /admin/discord-drift dashboard.
  webhookApp.get('/api/bot/drift', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { POSITIONS } = await import('./utils/positions.js');
      const { db: bDb } = await import('./utils/botDb.js');
      const verified = bDb.prepare('SELECT discord_id, position, nickname FROM verified_members').all();
      const guilds = [...client.guilds.cache.values()];
      // Pre-fetch every guild's member list once
      const guildSnapshots = await Promise.all(guilds.map(async g => {
        await g.members.fetch().catch(() => null);
        return { id: g.id, name: g.name, guild: g };
      }));
  
      const out = [];
      for (const v of verified) {
        const expectedRoles = [...(POSITIONS[v.position] || []), 'Verified', 'CO | Staff'];
        const guildsMissing = [];
        const guildsWrongNick = [];
        const rolesMissingPerGuild = []; // [{guild_name, missing: [...]}, ...]
  
        for (const snap of guildSnapshots) {
          const member = snap.guild.members.cache.get(v.discord_id);
          if (!member) { guildsMissing.push(snap.name); continue; }
  
          if (v.nickname && member.nickname && member.nickname !== v.nickname) {
            guildsWrongNick.push({ guild: snap.name, has: member.nickname, expected: v.nickname });
          }
  
          const memberRoleNames = new Set([...member.roles.cache.values()].map(r => r.name));
          const guildRoleNames = new Set([...snap.guild.roles.cache.values()].map(r => r.name));
          const missing = expectedRoles.filter(r => guildRoleNames.has(r) && !memberRoleNames.has(r));
          if (missing.length) rolesMissingPerGuild.push({ guild: snap.name, missing });
        }
  
        const driftScore = guildsMissing.length * 3 + rolesMissingPerGuild.reduce((s, g) => s + g.missing.length, 0) + guildsWrongNick.length;
        if (driftScore > 0) {
          out.push({
            discord_id: v.discord_id,
            position: v.position,
            nickname: v.nickname,
            drift_score: driftScore,
            guilds_missing: guildsMissing,
            roles_missing_per_guild: rolesMissingPerGuild,
            wrong_nicknames: guildsWrongNick,
          });
        }
      }
  
      out.sort((a, b) => b.drift_score - a.drift_score);
  
      // Reverse view: members in any guild with CO|Staff role but NO verified_members row
      const verifiedIds = new Set(verified.map(v => v.discord_id));
      const ghostStaff = new Map(); // discord_id → { username, guilds: [...] }
      for (const snap of guildSnapshots) {
        const staffRole = [...snap.guild.roles.cache.values()].find(r => r.name === 'CO | Staff');
        if (!staffRole) continue;
        for (const [, member] of staffRole.members) {
          if (verifiedIds.has(member.id) || member.user.bot) continue;
          const prev = ghostStaff.get(member.id);
          if (prev) prev.guilds.push(snap.name);
          else ghostStaff.set(member.id, { discord_id: member.id, username: member.user.username, guilds: [snap.name] });
        }
      }
  
      res.json({
        ok: true,
        total_verified: verified.length,
        total_guilds: guilds.length,
        drifted: out,
        ghost_staff: [...ghostStaff.values()],
      });
    } catch (e) {
      console.error('[/api/bot/drift]', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  
  // GET /api/bot/commands — every known command + its documented fallback.
  webhookApp.get('/api/bot/commands', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { listKnownCommands } = await import('./utils/permissions.js');
      res.json({ ok: true, commands: listKnownCommands() });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  
  // GET /api/bot/kudos?window=week|month|all — leaderboard + recent + giver stats.
  // Backs the portal /kudos page. Read-only.
  webhookApp.get('/api/bot/kudos', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { db: bDb } = await import('./utils/botDb.js');
      const win = ['week', 'month', 'all'].includes(req.query.window) ? req.query.window : 'month';
      const sinceClause = win === 'all' ? '' : `WHERE created_at >= datetime('now', '-${win === 'week' ? 7 : 30} days')`;
  
      const leaderboard = bDb.prepare(`
        SELECT to_discord_id, COUNT(*) c FROM kudos ${sinceClause}
        GROUP BY to_discord_id ORDER BY c DESC LIMIT 20
      `).all();
      const givers = bDb.prepare(`
        SELECT from_discord_id, COUNT(*) c FROM kudos ${sinceClause}
        GROUP BY from_discord_id ORDER BY c DESC LIMIT 20
      `).all();
      const recent = bDb.prepare(`
        SELECT id, from_discord_id, to_discord_id, message, created_at
        FROM kudos ${sinceClause} ORDER BY created_at DESC LIMIT 25
      `).all();
      const total = bDb.prepare(`SELECT COUNT(*) c FROM kudos ${sinceClause}`).get().c;
  
      res.json({ ok: true, window: win, total, leaderboard, givers, recent });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  
  // GET /api/bot/ideas — backs the portal's /ideas page. Returns ideas with
  // NET vote counts (upvotes - downvotes) and (if a viewer Discord ID is
  // passed) the viewer's current vote on each row (1, -1, or 0).
  //
  // status: open | planned | in_progress | shipped | declined
  //         | not_declined (everything except declined — main board view)
  //         | all
  const VALID_STATUSES = ['open', 'planned', 'in_progress', 'shipped', 'declined'];
  webhookApp.get('/api/bot/ideas', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { db: bDb } = await import('./utils/botDb.js');
      const rawStatus = (req.query.status || 'open').toString();
      let whereClause = '';
      const whereParams = [];
      if (rawStatus === 'all') {
        // no filter
      } else if (rawStatus === 'not_declined') {
        whereClause = `WHERE i.status != 'declined'`;
      } else if (VALID_STATUSES.includes(rawStatus)) {
        whereClause = 'WHERE i.status = ?';
        whereParams.push(rawStatus);
      } else {
        whereClause = 'WHERE i.status = ?';
        whereParams.push('open');
      }
      const viewer = (req.query.viewer || '').toString().trim() || null;
  
      const items = bDb.prepare(`
        SELECT
          i.id, i.owner_discord_id, i.text, i.status, i.created_at,
          i.admin_response, i.status_changed_at, i.status_changed_by,
          COALESCE((SELECT SUM(v.value) FROM idea_votes v WHERE v.idea_id = i.id), 0) AS votes,
          ${viewer
            ? 'COALESCE((SELECT v.value FROM idea_votes v WHERE v.idea_id = i.id AND v.voter_discord_id = ? LIMIT 1), 0) AS my_vote'
            : '0 AS my_vote'}
        FROM ideas i
        ${whereClause}
        ORDER BY votes DESC, i.created_at DESC
        LIMIT 500
      `).all(...[viewer, ...whereParams].filter((v) => v !== null));
  
      res.json({
        ok: true,
        status: rawStatus,
        viewer: !!viewer,
        items: items.map((r) => ({
          ...r,
          votes: Number(r.votes) || 0,
          my_vote: Number(r.my_vote) || 0,
        })),
      });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  
  // PATCH /api/bot/ideas/:id — moderator update. Body: { status?, admin_response?, actor_discord_id }
  // Status set to one of VALID_STATUSES. Setting admin_response to '' clears it.
  webhookApp.patch('/api/bot/ideas/:id', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ ok: false, error: 'bad id' });
      }
      const actor = (req.body?.actor_discord_id || '').toString().trim() || null;
      const { db: bDb } = await import('./utils/botDb.js');
      const idea = bDb.prepare('SELECT id FROM ideas WHERE id = ?').get(id);
      if (!idea) return res.status(404).json({ ok: false, error: 'Idea not found' });
  
      const updates = [];
      const params = [];
      if (req.body?.status !== undefined) {
        if (!VALID_STATUSES.includes(req.body.status)) {
          return res.status(400).json({ ok: false, error: `status must be one of ${VALID_STATUSES.join(', ')}` });
        }
        updates.push('status = ?', `status_changed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`, 'status_changed_by = ?');
        params.push(req.body.status, actor);
      }
      if (req.body?.admin_response !== undefined) {
        const val = (req.body.admin_response || '').toString().trim();
        updates.push('admin_response = ?');
        params.push(val || null);
      }
      if (updates.length === 0) {
        return res.status(400).json({ ok: false, error: 'Nothing to update — provide status and/or admin_response' });
      }
      params.push(id);
      bDb.prepare(`UPDATE ideas SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      const row = bDb.prepare(`
        SELECT id, owner_discord_id, text, status, created_at,
               admin_response, status_changed_at, status_changed_by,
               COALESCE((SELECT SUM(v.value) FROM idea_votes v WHERE v.idea_id = ideas.id), 0) AS votes
        FROM ideas WHERE id = ?
      `).get(id);
      res.json({ ok: true, idea: { ...row, votes: Number(row.votes) || 0 } });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  
  // DELETE /api/bot/ideas/:id — moderator delete. Cascades into idea_votes via FK.
  webhookApp.delete('/api/bot/ideas/:id', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'bad id' });
      const { db: bDb } = await import('./utils/botDb.js');
      const r = bDb.prepare('DELETE FROM ideas WHERE id = ?').run(id);
      if (r.changes === 0) return res.status(404).json({ ok: false, error: 'Idea not found' });
      res.json({ ok: true, deleted: id });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  
  // POST /api/bot/ideas/:id/vote — toggles the caller's vote in a direction.
  // Body: { discord_id, direction: 'up' | 'down' }. Direction defaults to 'up'
  // for backward compatibility with the portal's first cut.
  //
  // Behaviour:
  //   no vote yet                 → insert in the requested direction
  //   existing vote, same dir     → remove the vote (toggle off)
  //   existing vote, opposite dir → flip to the new direction (single row,
  //                                 since (idea_id, voter_discord_id) is PK)
  webhookApp.post('/api/bot/ideas/:id/vote', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ ok: false, error: 'bad id' });
      }
      const discordId = (req.body?.discord_id || '').toString().trim();
      if (!discordId) return res.status(400).json({ ok: false, error: 'discord_id required' });
      const direction = req.body?.direction === 'down' ? 'down' : 'up';
      const targetValue = direction === 'down' ? -1 : 1;
  
      const { db: bDb } = await import('./utils/botDb.js');
      const idea = bDb.prepare('SELECT id, status FROM ideas WHERE id = ?').get(id);
      if (!idea) return res.status(404).json({ ok: false, error: 'Idea not found' });
      if (idea.status !== 'open') return res.status(409).json({ ok: false, error: 'Voting is closed for shipped ideas' });
  
      const existing = bDb.prepare('SELECT value FROM idea_votes WHERE idea_id = ? AND voter_discord_id = ?').get(id, discordId);
      if (existing && Number(existing.value) === targetValue) {
        bDb.prepare('DELETE FROM idea_votes WHERE idea_id = ? AND voter_discord_id = ?').run(id, discordId);
      } else if (existing) {
        bDb.prepare('UPDATE idea_votes SET value = ?, created_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\') WHERE idea_id = ? AND voter_discord_id = ?').run(targetValue, id, discordId);
      } else {
        bDb.prepare('INSERT INTO idea_votes (idea_id, voter_discord_id, value) VALUES (?, ?, ?)').run(id, discordId, targetValue);
      }
      const after = bDb.prepare('SELECT value FROM idea_votes WHERE idea_id = ? AND voter_discord_id = ?').get(id, discordId);
      const votes = bDb.prepare('SELECT COALESCE(SUM(value), 0) c FROM idea_votes WHERE idea_id = ?').get(id).c;
      res.json({ ok: true, votes: Number(votes) || 0, my_vote: after ? Number(after.value) : 0 });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  
  // GET /api/bot/runtime — system-status snapshot for /admin/bot-runtime.
  // Process/uptime/memory + counts from key tables + recent error rate
  // from command_invocations.
  webhookApp.get('/api/bot/runtime', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { db: bDb } = await import('./utils/botDb.js');
      const since24h = new Date(Date.now() - 24 * 3600_000).toISOString();
      const sinceWeek = new Date(Date.now() - 7 * 86400_000).toISOString();
  
      const todayInv = bDb.prepare('SELECT COUNT(*) c, SUM(success) s FROM command_invocations WHERE created_at >= ?').get(since24h);
      const weekInv = bDb.prepare('SELECT COUNT(*) c, SUM(success) s FROM command_invocations WHERE created_at >= ?').get(sinceWeek);
      const recentErrs = bDb.prepare(`
        SELECT command_name, error_message, created_at, discord_id
        FROM command_invocations WHERE success = 0 ORDER BY created_at DESC LIMIT 5
      `).all();
      const pendingPosts = bDb.prepare("SELECT COUNT(*) c FROM scheduled_channel_posts WHERE status = 'pending'").get();
      const openFeedback = bDb.prepare("SELECT COUNT(*) c FROM bot_feedback WHERE status = 'open'").get();
      const verifiedCount = bDb.prepare('SELECT COUNT(*) c FROM verified_members').get();
      const snippetsCount = bDb.prepare('SELECT COUNT(*) c FROM snippets').get();
      const mem = process.memoryUsage();
  
      res.json({
        ok: true,
        uptime_seconds: process.uptime(),
        ws_ping_ms: client?.ws?.ping ?? null,
        guilds: client?.guilds?.cache?.size ?? 0,
        total_members: [...(client?.guilds?.cache?.values() || [])].reduce((s, g) => s + (g.memberCount || 0), 0),
        memory_rss_bytes: mem.rss,
        memory_heap_used_bytes: mem.heapUsed,
        node_version: process.version,
        verified_count: verifiedCount.c,
        snippets_count: snippetsCount.c,
        open_feedback_count: openFeedback.c,
        pending_scheduled_posts: pendingPosts.c,
        invocations_24h: { total: todayInv.c, success: todayInv.s ?? 0 },
        invocations_7d: { total: weekInv.c, success: weekInv.s ?? 0 },
        recent_errors: recentErrs,
        generated_at: new Date().toISOString(),
      });
    } catch (e) {
      console.error('[/api/bot/runtime]', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  
  // GET /api/bot/snippets — list every snippet (shared + personal) for
  // the /admin/bot-snippets page. Auth-gated by the bot secret; the
  // portal-side route gates by username.
  webhookApp.get('/api/bot/snippets', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { db: bDb } = await import('./utils/botDb.js');
      const items = bDb.prepare(`
        SELECT id, owner_id, name, content, use_count, created_at, updated_at
        FROM snippets ORDER BY (owner_id IS NULL) DESC, name ASC
      `).all();
      res.json({ ok: true, items });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  
  // DELETE /api/bot/snippets/:id — admin override; superusers only via portal gate.
  webhookApp.delete('/api/bot/snippets/:id', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'bad id' });
      const { db: bDb } = await import('./utils/botDb.js');
      const r = bDb.prepare('DELETE FROM snippets WHERE id = ?').run(id);
      res.json({ ok: true, changed: r.changes });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  
  // GET /api/bot/feedback?status=open|resolved&limit=N — list feedback rows.
  // Backs /admin/bot-feedback.
  webhookApp.get('/api/bot/feedback', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { listFeedback } = await import('./utils/botDb.js');
      const status = req.query.status === 'open' || req.query.status === 'resolved' ? req.query.status : null;
      const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 100));
      res.json({ ok: true, items: listFeedback({ status, limit }) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  
  // POST /api/bot/feedback/:id/resolve — body: { resolved_by, note? }
  webhookApp.post('/api/bot/feedback/:id/resolve', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'bad id' });
      const { resolvedBy, note } = { resolvedBy: req.body?.resolved_by, note: req.body?.note };
      const { resolveFeedback } = await import('./utils/botDb.js');
      const r = resolveFeedback({ id, resolvedBy, note });
      res.json({ ok: true, changed: r.changes });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  
  // GET /api/bot/command-stats?days=N — aggregated invocation stats for the
  // /admin/discord-command-stats portal page. Default 7 days, max 90.
  webhookApp.get('/api/bot/command-stats', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const days = Math.max(1, Math.min(90, Number(req.query.days) || 7));
      const sinceTs = Date.now() - days * 86400_000;
      const { getCommandStats } = await import('./utils/botDb.js');
      const stats = getCommandStats(sinceTs);
      res.json({ ok: true, days, ...stats });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  
  // GET /api/bot/command-permissions[?command=foo] — current grants.
  webhookApp.get('/api/bot/command-permissions', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { listCommandPermissions } = await import('./utils/botDb.js');
      const command = req.query.command ? String(req.query.command) : null;
      res.json({ ok: true, permissions: listCommandPermissions(command) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  
  // PATCH /api/bot/command-permissions/:command
  // Body: { user_ids: [...], role_ids: [...], set_by? }
  // Replaces all rows for the command. Empty arrays clear the grants.
  webhookApp.patch('/api/bot/command-permissions/:command', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { setCommandPermissions, listCommandPermissions } = await import('./utils/botDb.js');
      const command = String(req.params.command || '').trim();
      if (!command) return res.status(400).json({ ok: false, error: 'command required' });
      const { user_ids = [], role_ids = [], set_by = 'portal' } = req.body || {};
      setCommandPermissions(command, {
        user_ids: (Array.isArray(user_ids) ? user_ids : []).map(String).filter(Boolean),
        role_ids: (Array.isArray(role_ids) ? role_ids : []).map(String).filter(Boolean),
      }, String(set_by));
      res.json({ ok: true, command, permissions: listCommandPermissions(command) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  
  // GET /api/bot/guild-roles[?guild_id=…] — list roles across guilds for
  // the role-picker UI. Returns a flat list of { guild_id, guild_name,
  // role_id, role_name, color, position } sorted by guild then position.
  webhookApp.get('/api/bot/guild-roles', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const guildIdFilter = req.query.guild_id ? String(req.query.guild_id) : null;
      // include_members=1 expands each role with a `member_ids` array.
      // Heavier payload — for servers with thousands of members in a
      // role we cap per-role at MEMBER_ID_CAP so a single response
      // doesn't get pathological. The bot has the SERVER_MEMBERS_INTENT
      // privileged intent (otherwise role.members would be empty), so
      // member enumeration works without per-user OAuth.
      const includeMembers = req.query.include_members === '1' || req.query.include_members === 'true';
      const MEMBER_ID_CAP = 5000;
      const out = [];
      for (const guild of client.guilds.cache.values()) {
        if (guildIdFilter && guild.id !== guildIdFilter) continue;
        try { await guild.roles.fetch(); } catch {}
        // When we're returning members, fetch the full member list once
        // per guild so role.members.cache is populated. Discord API
        // pagination handled by Discord.js — call is cached after the
        // first hit.
        if (includeMembers) { try { await guild.members.fetch(); } catch {} }
        for (const role of guild.roles.cache.values()) {
          if (role.id === guild.id) continue; // skip @everyone
          if (role.managed) continue; // skip integration roles
          const entry = {
            guild_id: guild.id,
            guild_name: guild.name,
            role_id: role.id,
            role_name: role.name,
            color: role.hexColor,
            position: role.position,
            member_count: role.members?.size ?? 0,
          };
          if (includeMembers) {
            const ids = Array.from(role.members?.keys?.() || []).slice(0, MEMBER_ID_CAP);
            entry.member_ids = ids;
            entry.truncated = (role.members?.size ?? 0) > MEMBER_ID_CAP;
          }
          out.push(entry);
        }
      }
      out.sort((a, b) => a.guild_name.localeCompare(b.guild_name) || (b.position - a.position));
      res.json({ ok: true, roles: out, include_members: includeMembers });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  
  // GET /api/bot/guild-members?guild_id=X[&limit=N] — list members of
  // one guild. Cached; returns id, username, display_name, role_ids,
  // joined_at, bot flag.
  webhookApp.get('/api/bot/guild-members', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const guildId = req.query.guild_id ? String(req.query.guild_id) : null;
      if (!guildId) return res.status(400).json({ ok: false, error: 'guild_id required' });
      const limit = Math.max(1, Math.min(2000, Number(req.query.limit) || 1000));
      const guild = client.guilds.cache.get(guildId);
      if (!guild) return res.status(404).json({ ok: false, error: 'guild not found' });
      try { await guild.members.fetch(); } catch {}
      const out = [];
      for (const m of guild.members.cache.values()) {
        if (out.length >= limit) break;
        out.push({
          user_id: m.id,
          username: m.user?.username,
          display_name: m.displayName,
          global_name: m.user?.globalName || null,
          bot: !!m.user?.bot,
          role_ids: Array.from(m.roles.cache.keys()).filter(rid => rid !== guild.id),
          joined_at: m.joinedAt?.toISOString() || null,
        });
      }
      res.json({ ok: true, guild_id: guild.id, guild_name: guild.name, count: out.length, members: out });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  
  // GET /api/bot/member?user_id=X[&guild_id=Y] — single member lookup.
  // Without guild_id, returns the member as found in the FIRST guild
  // that has them (with a list of every guild the bot shares with them).
  webhookApp.get('/api/bot/member', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const userId = String(req.query.user_id || '').trim();
      if (!/^[0-9]{17,20}$/.test(userId)) return res.status(400).json({ ok: false, error: 'user_id must be a Discord snowflake' });
      const guildIdFilter = req.query.guild_id ? String(req.query.guild_id) : null;
      const sharedGuilds = [];
      let primary = null;
      for (const guild of client.guilds.cache.values()) {
        if (guildIdFilter && guild.id !== guildIdFilter) continue;
        try {
          const m = await guild.members.fetch(userId).catch(() => null);
          if (!m) continue;
          const entry = {
            guild_id: guild.id, guild_name: guild.name,
            display_name: m.displayName, joined_at: m.joinedAt?.toISOString() || null,
            role_ids: Array.from(m.roles.cache.keys()).filter(rid => rid !== guild.id),
            role_names: Array.from(m.roles.cache.values()).filter(r => r.id !== guild.id).map(r => r.name),
          };
          sharedGuilds.push(entry);
          if (!primary) primary = { ...entry, username: m.user?.username, global_name: m.user?.globalName, bot: !!m.user?.bot };
        } catch {}
      }
      if (!primary) return res.status(404).json({ ok: false, error: 'user not found in any guild the bot is in' });
      res.json({ ok: true, member: primary, guilds: sharedGuilds });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  
  // GET /api/bot/channels?guild_id=X — list text/voice/announcement
  // channels in a guild. (Categories included so a parent_id makes sense.)
  webhookApp.get('/api/bot/channels', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const guildId = req.query.guild_id ? String(req.query.guild_id) : null;
      if (!guildId) return res.status(400).json({ ok: false, error: 'guild_id required' });
      const guild = client.guilds.cache.get(guildId);
      if (!guild) return res.status(404).json({ ok: false, error: 'guild not found' });
      try { await guild.channels.fetch(); } catch {}
      const out = [];
      for (const c of guild.channels.cache.values()) {
        out.push({
          channel_id: c.id, name: c.name,
          type: c.type, // 0=text, 2=voice, 4=category, 5=announcement, 13=stage, 15=forum
          parent_id: c.parentId || null,
          position: c.position,
        });
      }
      out.sort((a, b) => (a.parent_id || '').localeCompare(b.parent_id || '') || a.position - b.position);
      res.json({ ok: true, guild_id: guild.id, guild_name: guild.name, channels: out });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  
  // POST /api/bot/role-assign — add or remove a role. Body:
  // { action: 'add' | 'remove', user_id, role_id, guild_id, reason? }
  // Create a channel in a guild. type: text|voice|category|announcement|forum
  webhookApp.post('/api/bot/channel-create', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { guild_id, name, type, parent_id } = req.body || {};
      const guild = client.guilds.cache.get(String(guild_id));
      if (!guild) return res.status(404).json({ ok: false, error: 'guild not found' });
      if (!name) return res.status(400).json({ ok: false, error: 'name required' });
      const typeMap = { text: 0, voice: 2, category: 4, announcement: 5, forum: 15 };
      const ch = await guild.channels.create({ name: String(name).slice(0, 90), type: typeMap[String(type || 'text')] ?? 0, parent: /^[0-9]{17,20}$/.test(String(parent_id)) ? String(parent_id) : undefined });
      res.json({ ok: true, channel_id: ch.id, name: ch.name });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Delete a channel.
  webhookApp.post('/api/bot/channel-delete', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { channel_id, reason } = req.body || {};
      if (!/^[0-9]{17,20}$/.test(String(channel_id))) return res.status(400).json({ ok: false, error: 'channel_id invalid' });
      const ch = await client.channels.fetch(String(channel_id)).catch(() => null);
      if (!ch) return res.status(404).json({ ok: false, error: 'channel not found' });
      const name = ch.name;
      await ch.delete(String(reason || 'Deleted via Community Organisation portal').slice(0, 400));
      res.json({ ok: true, deleted: name });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Rename a channel.
  webhookApp.post('/api/bot/channel-rename', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { channel_id, name } = req.body || {};
      if (!/^[0-9]{17,20}$/.test(String(channel_id))) return res.status(400).json({ ok: false, error: 'channel_id invalid' });
      if (!name) return res.status(400).json({ ok: false, error: 'name required' });
      const ch = await client.channels.fetch(String(channel_id)).catch(() => null);
      if (!ch) return res.status(404).json({ ok: false, error: 'channel not found' });
      await ch.setName(String(name).slice(0, 90));
      res.json({ ok: true, channel_id: ch.id, name: ch.name });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Lock/unlock (send messages) and hide/show (view) a channel for @everyone.
  webhookApp.post('/api/bot/channel-permission', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { channel_id, locked, hidden } = req.body || {};
      if (!/^[0-9]{17,20}$/.test(String(channel_id))) return res.status(400).json({ ok: false, error: 'channel_id invalid' });
      const ch = await client.channels.fetch(String(channel_id)).catch(() => null);
      if (!ch || !ch.permissionOverwrites) return res.status(404).json({ ok: false, error: 'channel not found or no permissions' });
      const everyone = ch.guild.roles.everyone;
      const edit = {};
      if (locked !== undefined && locked !== null) edit.SendMessages = locked ? false : null;
      if (hidden !== undefined && hidden !== null) edit.ViewChannel = hidden ? false : null;
      if (!Object.keys(edit).length) return res.status(400).json({ ok: false, error: 'nothing to change' });
      await ch.permissionOverwrites.edit(everyone, edit, { reason: 'Channel permissions via Community Organisation portal' });
      res.json({ ok: true, channel_id: ch.id, locked: !!locked, hidden: !!hidden });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Add a custom emoji to a guild from an image URL.
  webhookApp.post('/api/bot/emoji-create', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { guild_id, name, image_url } = req.body || {};
      const guild = client.guilds.cache.get(String(guild_id));
      if (!guild) return res.status(404).json({ ok: false, error: 'guild not found' });
      if (!name || !image_url) return res.status(400).json({ ok: false, error: 'name and image_url required' });
      const em = await guild.emojis.create({ attachment: String(image_url), name: String(name).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32) || 'emoji' });
      res.json({ ok: true, emoji_id: em.id, name: em.name });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Delete a custom emoji.
  webhookApp.post('/api/bot/emoji-delete', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { guild_id, emoji_id } = req.body || {};
      const guild = client.guilds.cache.get(String(guild_id));
      if (!guild) return res.status(404).json({ ok: false, error: 'guild not found' });
      const em = await guild.emojis.fetch(String(emoji_id)).catch(() => null);
      if (!em) return res.status(404).json({ ok: false, error: 'emoji not found' });
      const name = em.name;
      await em.delete('Deleted via Community Organisation portal');
      res.json({ ok: true, deleted: name });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Edit a guild's settings (rename for now).
  webhookApp.post('/api/bot/guild-edit', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { guild_id, name } = req.body || {};
      const guild = client.guilds.cache.get(String(guild_id));
      if (!guild) return res.status(404).json({ ok: false, error: 'guild not found' });
      if (!name || !String(name).trim()) return res.status(400).json({ ok: false, error: 'name required' });
      await guild.setName(String(name).trim().slice(0, 100), 'Renamed via Community Organisation portal');
      res.json({ ok: true, name: guild.name });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Pin / unpin / edit a message.
  webhookApp.post('/api/bot/message-action', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { channel_id, message_id, action, content } = req.body || {};
      if (!/^[0-9]{17,20}$/.test(String(channel_id))) return res.status(400).json({ ok: false, error: 'channel_id invalid' });
      if (!/^[0-9]{17,20}$/.test(String(message_id))) return res.status(400).json({ ok: false, error: 'message_id invalid' });
      const ch = await client.channels.fetch(String(channel_id)).catch(() => null);
      if (!ch || !ch.messages) return res.status(404).json({ ok: false, error: 'channel not found' });
      const msg = await ch.messages.fetch(String(message_id)).catch(() => null);
      if (!msg) return res.status(404).json({ ok: false, error: 'message not found' });
      if (action === 'pin') await msg.pin();
      else if (action === 'unpin') await msg.unpin();
      else if (action === 'edit') { if (msg.author.id !== client.user.id) return res.status(400).json({ ok: false, error: 'can only edit the bot’s own messages' }); await msg.edit(String(content || '').slice(0, 1900)); }
      else return res.status(400).json({ ok: false, error: 'action must be pin, unpin or edit' });
      res.json({ ok: true, action });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Create an invite link for a channel.
  webhookApp.post('/api/bot/create-invite', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { channel_id, max_age, max_uses } = req.body || {};
      if (!/^[0-9]{17,20}$/.test(String(channel_id))) return res.status(400).json({ ok: false, error: 'channel_id invalid' });
      const ch = await client.channels.fetch(String(channel_id)).catch(() => null);
      if (!ch || typeof ch.createInvite !== 'function') return res.status(404).json({ ok: false, error: 'channel not found or cannot host invites' });
      const inv = await ch.createInvite({ maxAge: Math.max(0, Math.min(604800, Number(max_age) || 86400)), maxUses: Math.max(0, Math.min(100, Number(max_uses) || 0)), unique: true });
      res.json({ ok: true, code: inv.code, url: `https://discord.gg/${inv.code}` });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Set or clear a member's nickname in a guild (empty nickname resets it).
  webhookApp.post('/api/bot/set-nickname', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { user_id, guild_id, nickname } = req.body || {};
      if (!/^[0-9]{17,20}$/.test(String(user_id))) return res.status(400).json({ ok: false, error: 'user_id invalid' });
      const guild = client.guilds.cache.get(String(guild_id));
      if (!guild) return res.status(404).json({ ok: false, error: 'guild not found' });
      const m = await guild.members.fetch(String(user_id)).catch(() => null);
      if (!m) return res.status(404).json({ ok: false, error: 'member not in guild' });
      await m.setNickname(String(nickname || '').slice(0, 32) || null, 'Set via Community Organisation portal');
      res.json({ ok: true, nickname: m.nickname || null });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Bulk-delete up to 100 recent messages in a channel.
  webhookApp.post('/api/bot/purge', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { channel_id, count } = req.body || {};
      if (!/^[0-9]{17,20}$/.test(String(channel_id))) return res.status(400).json({ ok: false, error: 'channel_id invalid' });
      const n = Math.max(1, Math.min(100, Number(count) || 0));
      const ch = await client.channels.fetch(String(channel_id)).catch(() => null);
      if (!ch || typeof ch.bulkDelete !== 'function') return res.status(404).json({ ok: false, error: 'channel not found or not text' });
      const deleted = await ch.bulkDelete(n, true);
      res.json({ ok: true, deleted: deleted.size });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Ban a user across every server the bot is in + record the global ban.
  webhookApp.post('/api/bot/global-ban', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { user_id, reason, moderator_id } = req.body || {};
      if (!/^[0-9]{17,20}$/.test(String(user_id))) return res.status(400).json({ ok: false, error: 'user_id invalid' });
      const { addGlobalBan } = await import('./utils/botDb.js');
      let banned = 0;
      for (const [, g] of client.guilds.cache) {
        try { await g.bans.create(String(user_id), { reason: String(reason || 'Global ban via Community Organisation portal').slice(0, 400) }); banned++; } catch { /* not in guild / no perms */ }
      }
      addGlobalBan(String(user_id), String(reason || 'Global ban via portal'), String(moderator_id || 'ops'), 1);
      res.json({ ok: true, banned_in: banned });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Lift a global ban across every server + mark it inactive.
  webhookApp.post('/api/bot/global-unban', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { user_id } = req.body || {};
      if (!/^[0-9]{17,20}$/.test(String(user_id))) return res.status(400).json({ ok: false, error: 'user_id invalid' });
      const { db: bDb } = await import('./utils/botDb.js');
      let lifted = 0;
      for (const [, g] of client.guilds.cache) {
        try { await g.bans.remove(String(user_id), 'Global unban via portal'); lifted++; } catch { /* not banned here */ }
      }
      try { bDb.prepare('UPDATE global_bans SET active = 0 WHERE discord_id = ? AND active = 1').run(String(user_id)); } catch {}
      res.json({ ok: true, lifted_in: lifted });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  webhookApp.post('/api/bot/role-assign', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { action, user_id, role_id, guild_id, reason } = req.body || {};
      if (!['add', 'remove'].includes(action)) return res.status(400).json({ ok: false, error: 'action must be add|remove' });
      if (!/^[0-9]{17,20}$/.test(String(user_id))) return res.status(400).json({ ok: false, error: 'user_id invalid' });
      if (!/^[0-9]{17,20}$/.test(String(role_id))) return res.status(400).json({ ok: false, error: 'role_id invalid' });
      if (!/^[0-9]{17,20}$/.test(String(guild_id))) return res.status(400).json({ ok: false, error: 'guild_id invalid' });
      const guild = client.guilds.cache.get(String(guild_id));
      if (!guild) return res.status(404).json({ ok: false, error: 'guild not found' });
      const member = await guild.members.fetch(String(user_id)).catch(() => null);
      if (!member) return res.status(404).json({ ok: false, error: 'member not in guild' });
      const role = guild.roles.cache.get(String(role_id));
      if (!role) return res.status(404).json({ ok: false, error: 'role not found' });
      const auditReason = String(reason || 'portal chat agent role-assign').slice(0, 500);
      if (action === 'add') await member.roles.add(role, auditReason);
      else                  await member.roles.remove(role, auditReason);
      res.json({ ok: true, action, user_id, role_id, guild_id });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  
  // POST /api/bot/sync-all-roles — bulk variant of sync-user-roles.
  // Walks every verified_member × every guild, applies missing position
  // + Verified + CO | Staff roles. Body: { dry_run? }. Returns aggregate
  // counts so the portal /admin/discord-drift page can trigger this in
  // one click instead of typing /sync-all-roles in Discord.
  webhookApp.post('/api/bot/sync-all-roles', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const dryRun = !!req.body?.dry_run;
      const { POSITIONS } = await import('./utils/positions.js');
      const { db: bDb } = await import('./utils/botDb.js');
      const verified = bDb.prepare('SELECT discord_id, position, nickname FROM verified_members').all();
  
      let totalGranted = 0, totalAlready = 0, totalFailed = 0;
      const userResults = [];
      const reason = `Portal sync-all-roles${dryRun ? ' (dry-run)' : ''}`;
  
      for (const v of verified) {
        const expectedRoleNames = [...(POSITIONS[v.position] || []), 'Verified', 'CO | Staff'];
        let userGranted = 0, userAlready = 0, userFailed = 0;
  
        for (const [, guild] of client.guilds.cache) {
          const member = await guild.members.fetch(v.discord_id).catch(() => null);
          if (!member) continue;
          for (const roleName of expectedRoleNames) {
            const role = guild.roles.cache.find(r => r.name === roleName);
            if (!role) continue;
            if (member.roles.cache.has(role.id)) { userAlready++; continue; }
            if (dryRun) { userGranted++; continue; }
            try { await member.roles.add(role, reason); userGranted++; }
            catch { userFailed++; }
          }
        }
        totalGranted += userGranted;
        totalAlready += userAlready;
        totalFailed += userFailed;
        if (userGranted > 0 || userFailed > 0) {
          userResults.push({ discord_id: v.discord_id, position: v.position, granted: userGranted, failed: userFailed });
        }
      }
  
      res.json({
        ok: true,
        dry_run: dryRun,
        walked: verified.length,
        total_granted: totalGranted,
        total_already: totalAlready,
        total_failed: totalFailed,
        affected_users: userResults,
      });
    } catch (e) {
      console.error('[/api/bot/sync-all-roles]', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  
  // POST /api/bot/sync-user-roles — re-apply expected position roles for
  // a single verified member across every CO guild. Body: { discord_id, dry_run? }.
  // Returns granted/already/failed counts per guild.
  webhookApp.post('/api/bot/sync-user-roles', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { discord_id, dry_run } = req.body || {};
      if (!/^[0-9]{17,20}$/.test(String(discord_id || ''))) {
        return res.status(400).json({ ok: false, error: 'discord_id invalid' });
      }
      const { POSITIONS } = await import('./utils/positions.js');
      const { db: bDb } = await import('./utils/botDb.js');
      const v = bDb.prepare('SELECT discord_id, position, nickname FROM verified_members WHERE discord_id = ?').get(String(discord_id));
      if (!v) return res.status(404).json({ ok: false, error: 'not in verified_members' });
  
      const expectedRoleNames = [...(POSITIONS[v.position] || []), 'Verified', 'CO | Staff'];
      const perGuild = [];
      let granted = 0, already = 0, failed = 0;
      const reason = `Portal sync-user-roles${dry_run ? ' (dry-run)' : ''}`;
  
      for (const [, guild] of client.guilds.cache) {
        const member = await guild.members.fetch(String(discord_id)).catch(() => null);
        if (!member) { perGuild.push({ guild: guild.name, status: 'not in guild' }); continue; }
        let g = 0, a = 0, f = 0;
        const errors = [];
        for (const roleName of expectedRoleNames) {
          const role = guild.roles.cache.find(r => r.name === roleName);
          if (!role) continue;
          if (member.roles.cache.has(role.id)) { a++; continue; }
          if (dry_run) { g++; continue; }
          try { await member.roles.add(role, reason); g++; }
          catch (e) { f++; errors.push(`${roleName}: ${e.message}`); }
        }
        granted += g; already += a; failed += f;
        perGuild.push({ guild: guild.name, granted: g, already: a, failed: f, errors });
      }
  
      res.json({ ok: true, discord_id, position: v.position, dry_run: !!dry_run, granted, already, failed, per_guild: perGuild });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  
  // POST /api/bot/send-channel-message — post a message in a channel.
  // Body: { channel_id, content?, embed?: { title, description, color_hex, footer, image_url }, scheduled_for? }
  // Either content, embed, or both required. scheduled_for is an ISO
  // timestamp — if present and in the future, the post is queued in
  // scheduled_channel_posts and drained by the cron loop.
  webhookApp.post('/api/bot/send-channel-message', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { channel_id, content, embed, scheduled_for } = req.body || {};
      if (!/^[0-9]{17,20}$/.test(String(channel_id))) return res.status(400).json({ ok: false, error: 'channel_id invalid' });
      const text = String(content || '').slice(0, 1900);
      if (!text && !embed) return res.status(400).json({ ok: false, error: 'content or embed required' });
  
      // Schedule for later instead of sending now?
      if (scheduled_for) {
        const sendDate = new Date(scheduled_for);
        if (isNaN(sendDate.getTime())) return res.status(400).json({ ok: false, error: 'scheduled_for invalid date' });
        if (sendDate.getTime() <= Date.now() + 30_000) {
          return res.status(400).json({ ok: false, error: 'scheduled_for must be at least 30s in the future' });
        }
        const { scheduleChannelPost } = await import('./utils/botDb.js');
        const id = scheduleChannelPost({
          channelId: String(channel_id),
          payload: { content: text, embed },
          sendAtIso: sendDate.toISOString(),
          createdBy: req.body?.created_by || null,
        });
        return res.json({ ok: true, scheduled: true, id, send_at: sendDate.toISOString() });
      }
  
      const ch = await client.channels.fetch(String(channel_id)).catch(() => null);
      if (!ch || !ch.isTextBased?.()) return res.status(404).json({ ok: false, error: 'channel not found or not text' });
  
      const payload = {};
      if (text) payload.content = text;
      if (embed) {
        const { EmbedBuilder } = await import('discord.js');
        const e = new EmbedBuilder();
        if (embed.title) e.setTitle(String(embed.title).slice(0, 256));
        if (embed.description) e.setDescription(String(embed.description).slice(0, 4000));
        if (embed.color_hex && /^#?[0-9a-fA-F]{6}$/.test(embed.color_hex)) {
          e.setColor(parseInt(embed.color_hex.replace('#', ''), 16));
        }
        if (embed.footer) e.setFooter({ text: String(embed.footer).slice(0, 2048) });
        if (embed.image_url && /^https:\/\//i.test(embed.image_url)) {
          try { e.setImage(embed.image_url); } catch {}
        }
        e.setTimestamp();
        payload.embeds = [e];
      }
  
      const sent = await ch.send(payload);
      res.json({ ok: true, message_id: sent.id, channel_id: ch.id, message_url: sent.url });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  
  // GET /api/bot/scheduled-posts?status=pending|sent|cancelled — list queued posts
  webhookApp.get('/api/bot/scheduled-posts', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { listScheduledChannelPosts } = await import('./utils/botDb.js');
      const status = ['pending', 'sent', 'cancelled'].includes(req.query.status) ? req.query.status : null;
      const items = listScheduledChannelPosts({ status, limit: 100 }).map(r => ({
        ...r,
        payload: (() => { try { return JSON.parse(r.payload_json); } catch { return null; } })(),
        payload_json: undefined,
      }));
      res.json({ ok: true, items });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  
  // POST /api/bot/scheduled-posts/:id/cancel — cancel a pending post
  webhookApp.post('/api/bot/scheduled-posts/:id/cancel', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'bad id' });
      const { cancelScheduledChannelPost } = await import('./utils/botDb.js');
      const r = cancelScheduledChannelPost(id);
      res.json({ ok: true, changed: r.changes });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  
  // POST /api/bot/delete-message { channel_id, message_id }
  // Deletes a single message the bot can see. Used by portal-side admin
  // scripts that need to retract bot-posted content (e.g. wiping SCSC
  // memo announcements when a batch of memos gets purged).
  webhookApp.post('/api/bot/delete-message', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { channel_id, message_id } = req.body || {};
      if (!/^[0-9]{17,20}$/.test(String(channel_id))) return res.status(400).json({ ok: false, error: 'channel_id invalid' });
      if (!/^[0-9]{17,20}$/.test(String(message_id))) return res.status(400).json({ ok: false, error: 'message_id invalid' });
      const ch = await client.channels.fetch(String(channel_id)).catch(() => null);
      if (!ch || !ch.isTextBased?.()) return res.status(404).json({ ok: false, error: 'channel not found or not text' });
      const msg = await ch.messages.fetch(String(message_id)).catch(() => null);
      if (!msg) return res.status(404).json({ ok: false, error: 'message not found' });
      await msg.delete();
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  
  // POST /api/bot/kick { user_id, guild_id, reason? }
  webhookApp.post('/api/bot/kick', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { user_id, guild_id, reason } = req.body || {};
      if (!/^[0-9]{17,20}$/.test(String(user_id)))  return res.status(400).json({ ok: false, error: 'user_id invalid' });
      if (!/^[0-9]{17,20}$/.test(String(guild_id))) return res.status(400).json({ ok: false, error: 'guild_id invalid' });
      const guild = client.guilds.cache.get(String(guild_id));
      if (!guild) return res.status(404).json({ ok: false, error: 'guild not found' });
      const m = await guild.members.fetch(String(user_id)).catch(() => null);
      if (!m) return res.status(404).json({ ok: false, error: 'member not in guild' });
      await m.kick(String(reason || 'portal chat — superuser kick').slice(0, 500));
      res.json({ ok: true, kicked: user_id, guild_id });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  
  // POST /api/bot/ban { user_id, guild_id, reason?, delete_message_seconds? }
  webhookApp.post('/api/bot/ban', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { user_id, guild_id, reason, delete_message_seconds } = req.body || {};
      if (!/^[0-9]{17,20}$/.test(String(user_id)))  return res.status(400).json({ ok: false, error: 'user_id invalid' });
      if (!/^[0-9]{17,20}$/.test(String(guild_id))) return res.status(400).json({ ok: false, error: 'guild_id invalid' });
      const guild = client.guilds.cache.get(String(guild_id));
      if (!guild) return res.status(404).json({ ok: false, error: 'guild not found' });
      await guild.members.ban(String(user_id), {
        reason: String(reason || 'portal chat — superuser ban').slice(0, 500),
        deleteMessageSeconds: Math.max(0, Math.min(604800, Number(delete_message_seconds) || 0)),
      });
      res.json({ ok: true, banned: user_id, guild_id });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  
  // POST /api/bot/timeout { user_id, guild_id, minutes, reason? } — 0 minutes clears it
  webhookApp.post('/api/bot/timeout', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { user_id, guild_id, minutes, reason } = req.body || {};
      if (!/^[0-9]{17,20}$/.test(String(user_id))) return res.status(400).json({ ok: false, error: 'user_id invalid' });
      const guild = client.guilds.cache.get(String(guild_id));
      if (!guild) return res.status(404).json({ ok: false, error: 'guild not found' });
      const m = await guild.members.fetch(String(user_id)).catch(() => null);
      if (!m) return res.status(404).json({ ok: false, error: 'member not in guild' });
      const mins = Math.max(0, Math.min(40320, Number(minutes) || 0)); // up to 28 days
      await m.timeout(mins ? mins * 60000 : null, String(reason || 'portal — superuser').slice(0, 500));
      res.json({ ok: true, user_id, guild_id, minutes: mins });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // POST /api/bot/sync-member-roles { user_id, guild_id } — make this guild's
  // roles match the verification role list: add the expected ones, REMOVE any
  // others the bot can manage (skips @everyone + integration-managed roles).
  webhookApp.post('/api/bot/sync-member-roles', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { user_id, guild_id } = req.body || {};
      if (!/^[0-9]{17,20}$/.test(String(user_id))) return res.status(400).json({ ok: false, error: 'user_id invalid' });
      const guild = client.guilds.cache.get(String(guild_id));
      if (!guild) return res.status(404).json({ ok: false, error: 'guild not found' });
      const m = await guild.members.fetch(String(user_id)).catch(() => null);
      if (!m) return res.status(404).json({ ok: false, error: 'member not in guild' });
      const { POSITIONS } = await import('./utils/positions.js');
      const { db: bDb } = await import('./utils/botDb.js');
      const v = bDb.prepare('SELECT position FROM verified_members WHERE discord_id = ?').get(String(user_id));
      if (!v) return res.status(404).json({ ok: false, error: 'not in verified_members — verify them first' });
      const expected = new Set([...(POSITIONS[v.position] || []), 'Verified', 'CO | Staff']);
      const reason = 'Portal role sync to verification list';
      const added = [], removed = [], skipped = [];
      for (const [, role] of guild.roles.cache) {
        if (!expected.has(role.name)) continue;
        if (m.roles.cache.has(role.id)) continue;
        if (!role.editable) { skipped.push(role.name); continue; }
        try { await m.roles.add(role, reason); added.push(role.name); } catch { skipped.push(role.name); }
      }
      for (const [, role] of [...m.roles.cache.values()].map(r => [r.id, r])) {
        if (role.id === guild.id || role.managed || expected.has(role.name)) continue;
        if (!role.editable) { skipped.push(role.name); continue; }
        try { await m.roles.remove(role, reason); removed.push(role.name); } catch { skipped.push(role.name); }
      }
      res.json({ ok: true, position: v.position, added, removed, skipped });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // GET /api/bot/member-role-diff?guild_id&user_id — read-only: what roles the
  // member has in this guild vs. what the verification list says they should
  // have, so the portal can preview a sync. present[] / missing[] / extra[].
  webhookApp.get('/api/bot/member-role-diff', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const user_id = String(req.query.user_id || ''), guild_id = String(req.query.guild_id || '');
      if (!/^[0-9]{17,20}$/.test(user_id)) return res.status(400).json({ ok: false, error: 'user_id invalid' });
      const guild = client.guilds.cache.get(guild_id);
      if (!guild) return res.status(404).json({ ok: false, error: 'guild not found' });
      const m = await guild.members.fetch(user_id).catch(() => null);
      if (!m) return res.status(404).json({ ok: false, error: 'member not in guild' });
      const { POSITIONS } = await import('./utils/positions.js');
      const { db: bDb } = await import('./utils/botDb.js');
      const v = bDb.prepare('SELECT position FROM verified_members WHERE discord_id = ?').get(user_id);
      const expected = new Set([...((v && POSITIONS[v.position]) || []), 'Verified', 'CO | Staff']);
      const guildRoleNames = new Set([...guild.roles.cache.values()].map(r => r.name));
      const current = [...m.roles.cache.values()].filter(r => r.id !== guild.id).map(r => r.name);
      const currentSet = new Set(current);
      // expected roles that actually exist in this guild
      const expectedHere = [...expected].filter(n => guildRoleNames.has(n));
      const present = expectedHere.filter(n => currentSet.has(n));   // expected & has
      const missing = expectedHere.filter(n => !currentSet.has(n));  // expected & missing → would add
      const extra = current.filter(n => !expected.has(n));           // has & not expected → would remove
      res.json({ ok: true, verified: !!v, position: v ? v.position : null, current, expected: expectedHere, present, missing, extra });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // GET /api/bot/member-messages?guild_id&user_id — recent deleted/edited messages
  webhookApp.get('/api/bot/member-messages', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { getMemberMessages } = await import('./utils/botDb.js');
      res.json({ ok: true, messages: getMemberMessages(req.query.guild_id ? String(req.query.guild_id) : null, String(req.query.user_id || ''), 40) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // POST /api/bot/thread-create { channel_id, name, message? }
  webhookApp.post('/api/bot/thread-create', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { channel_id, name, message } = req.body || {};
      if (!/^[0-9]{17,20}$/.test(String(channel_id))) return res.status(400).json({ ok: false, error: 'channel_id invalid' });
      if (!name) return res.status(400).json({ ok: false, error: 'name required' });
      const ch = await client.channels.fetch(String(channel_id)).catch(() => null);
      if (!ch || !ch.threads?.create) return res.status(404).json({ ok: false, error: 'channel not found or does not support threads' });
      const thread = await ch.threads.create({ name: String(name).slice(0, 100), autoArchiveDuration: 1440 });
      if (message) await thread.send(String(message).slice(0, 1900));
      res.json({ ok: true, thread_id: thread.id, name: thread.name });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  
  // POST /api/bot/thread-archive { thread_id }
  webhookApp.post('/api/bot/thread-archive', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { thread_id } = req.body || {};
      if (!/^[0-9]{17,20}$/.test(String(thread_id))) return res.status(400).json({ ok: false, error: 'thread_id invalid' });
      const thread = await client.channels.fetch(String(thread_id)).catch(() => null);
      if (!thread?.setArchived) return res.status(404).json({ ok: false, error: 'thread not found' });
      await thread.setArchived(true);
      res.json({ ok: true, thread_id });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  
  // POST /api/bot/voice-move { user_id, guild_id, channel_id }
  webhookApp.post('/api/bot/voice-move', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { user_id, guild_id, channel_id } = req.body || {};
      if (!/^[0-9]{17,20}$/.test(String(user_id)))    return res.status(400).json({ ok: false, error: 'user_id invalid' });
      if (!/^[0-9]{17,20}$/.test(String(guild_id)))   return res.status(400).json({ ok: false, error: 'guild_id invalid' });
      if (!/^[0-9]{17,20}$/.test(String(channel_id))) return res.status(400).json({ ok: false, error: 'channel_id invalid' });
      const guild = client.guilds.cache.get(String(guild_id));
      if (!guild) return res.status(404).json({ ok: false, error: 'guild not found' });
      const m = await guild.members.fetch(String(user_id)).catch(() => null);
      if (!m) return res.status(404).json({ ok: false, error: 'member not in guild' });
      if (!m.voice?.channelId) return res.status(400).json({ ok: false, error: 'member is not currently in a voice channel' });
      await m.voice.setChannel(String(channel_id));
      res.json({ ok: true, moved: user_id, to: channel_id });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  
  // GET /api/bot/audit-log?guild_id=X[&limit=N]
  webhookApp.get('/api/bot/audit-log', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const guildId = String(req.query.guild_id || '').trim();
      if (!/^[0-9]{17,20}$/.test(guildId)) return res.status(400).json({ ok: false, error: 'guild_id required' });
      const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 25));
      const guild = client.guilds.cache.get(guildId);
      if (!guild) return res.status(404).json({ ok: false, error: 'guild not found' });
      const log = await guild.fetchAuditLogs({ limit });
      const out = [];
      for (const e of log.entries.values()) {
        out.push({
          id: e.id,
          action: e.action, // numeric action type per Discord
          action_type: e.actionType, // e.g. 'CREATE'/'DELETE'/'UPDATE'
          target_id: e.targetId,
          executor_id: e.executorId,
          executor_username: e.executor?.username || null,
          reason: e.reason || null,
          created_at: e.createdAt?.toISOString() || null,
        });
      }
      res.json({ ok: true, guild_id: guild.id, guild_name: guild.name, entries: out });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  
  // GET /api/bot/emojis[?guild_id=X]
  webhookApp.get('/api/bot/emojis', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const guildIdFilter = req.query.guild_id ? String(req.query.guild_id) : null;
      const out = [];
      for (const guild of client.guilds.cache.values()) {
        if (guildIdFilter && guild.id !== guildIdFilter) continue;
        try { await guild.emojis.fetch(); } catch {}
        for (const em of guild.emojis.cache.values()) {
          out.push({
            guild_id: guild.id,
            guild_name: guild.name,
            emoji_id: em.id,
            name: em.name,
            animated: em.animated,
            url: em.imageURL?.({ size: 64 }) || `https://cdn.discordapp.com/emojis/${em.id}.${em.animated ? 'gif' : 'png'}`,
            identifier: `<${em.animated ? 'a' : ''}:${em.name}:${em.id}>`,
          });
        }
      }
      out.sort((a, b) => a.guild_name.localeCompare(b.guild_name) || a.name.localeCompare(b.name));
      res.json({ ok: true, count: out.length, emojis: out });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  
  webhookApp.post('/webhook/acting-process-pending', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { processPendingActingAssignments } = await import('./services/leaveRoles.js');
      const id = req.body && req.body.id ? Number(req.body.id) : null;
      const processed = await processPendingActingAssignments(client, id ? { id } : {});
      res.json({ ok: true, processed });
    } catch (e) {
      console.error('[webhook/acting-process-pending] fatal:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  
  // POST /webhook/set-nickname — set a member's nickname across guilds.
  // Body: { discord_id, nickname, all_servers? (default true), guild_id? }
  // nickname is truncated to Discord's 32-char limit; pass null/'' to clear.
  webhookApp.post('/webhook/set-nickname', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    const { discord_id, nickname, all_servers = true, guild_id } = req.body || {};
    if (!discord_id || !/^[0-9]{17,20}$/.test(String(discord_id))) {
      return res.status(400).json({ ok: false, error: 'discord_id required' });
    }
    const nick = nickname == null || nickname === '' ? null : String(nickname).slice(0, 32);
  
    const guildIds = all_servers
      ? Array.from(client.guilds.cache.keys())
      : (guild_id ? [String(guild_id)] : []);
    if (!guildIds.length) return res.status(400).json({ ok: false, error: 'no_target_guild' });
  
    const results = [];
    for (const gid of guildIds) {
      try {
        const guild = client.guilds.cache.get(gid) || await client.guilds.fetch(gid).catch(() => null);
        if (!guild) { results.push({ guild_id: gid, ok: false, error: 'guild_not_cached' }); continue; }
        const member = await guild.members.fetch(discord_id).catch(() => null);
        if (!member) { results.push({ guild_id: gid, guild_name: guild.name, ok: false, error: 'not_a_member' }); continue; }
        await member.setNickname(nick, 'Portal: nickname update').catch(e => { throw e; });
        results.push({ guild_id: gid, guild_name: guild.name, ok: true, nickname: nick });
      } catch (e) {
        results.push({ guild_id: gid, ok: false, error: e.message });
      }
    }
    res.json({ ok: true, results });
  });
  
  // GET /webhook/check-guild-member?discord_id=…&guild_id=…
  // Returns whether the user is a member of the given guild. Used by the
  // portal's Add New Staff wizard to verify the Discord ID belongs to the
  // CO | Communications server (1358129722931937280) before creating the
  // staff record.
  webhookApp.get('/webhook/check-guild-member', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    const discord_id = String(req.query.discord_id || '').trim();
    const guild_id = String(req.query.guild_id || '1358129722931937280').trim();
    if (!discord_id || !/^[0-9]{17,20}$/.test(discord_id)) {
      return res.status(400).json({ ok: false, reason: 'bad_discord_id' });
    }
    try {
      const guild = client.guilds.cache.get(guild_id) || await client.guilds.fetch(guild_id).catch(() => null);
      if (!guild) return res.json({ ok: false, reason: 'guild_not_found', in_guild: false });
      const member = await guild.members.fetch(discord_id).catch(() => null);
      if (!member) return res.json({ ok: true, in_guild: false, guild_name: guild.name });
      res.json({
        ok: true,
        in_guild: true,
        guild_name: guild.name,
        username: member.user?.username || null,
        global_name: member.user?.globalName || null,
        display_name: member.displayName || null,
      });
    } catch (e) {
      console.error('[check-guild-member] fatal:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  
  // POST /webhook/welcome-new-staff — announce a new joiner and assign
  // their position roles. Fired when their onboarding hits 5/5.
  // Body: { discord_id, display_name, position?, department? }. Header: x-bot-secret.
  // Uses env WELCOME_CHANNEL_ID for the announcement channel and the
  // POSITIONS map (src/utils/positions.js) for role resolution.
  webhookApp.post('/webhook/welcome-new-staff', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    const { discord_id, display_name, position, department, add_roles } = req.body || {};
    if (!discord_id || !display_name) {
      return res.status(400).json({ ok: false, reason: 'missing_fields' });
    }
    const { POSITIONS } = await import('./utils/positions.js');
    let rolesAdded = 0;
    let channelPosted = false;
    try {
      // Channel announcement
      const welcomeChannelId = process.env.WELCOME_CHANNEL_ID || null;
      if (!welcomeChannelId) console.warn('[welcome] WELCOME_CHANNEL_ID not set — skipping channel post');
      if (welcomeChannelId) {
        try {
          const ch = await client.channels.fetch(welcomeChannelId);
          if (ch && ch.isTextBased()) {
            const fields = [];
            if (position) fields.push({ name: 'Role', value: position, inline: true });
            if (department) fields.push({ name: 'Department', value: department, inline: true });
            await ch.send({
              content: `<@${discord_id}>`,
              embeds: [{
                color: 0xc9a84c,
                title: `Please welcome ${display_name}`,
                description: `${display_name} has completed their onboarding and is now a fully paid-up member of Community Organisation. Say hello!`,
                fields,
                footer: { text: 'Community Organisation · Staff Portal' },
                timestamp: new Date().toISOString(),
              }],
            });
            channelPosted = true;
          }
        } catch (e) { console.warn('[welcome] channel post failed:', e.message); }
      }
  
      // Role assignment is OPT-IN — callers must pass { add_roles: true }.
      // The default onboarding flow leaves roles to be added when the user
      // verifies with the bot, not automatically on staff creation.
      if (add_roles === true && position) {
        const positionRoles = POSITIONS[position] || [];
        if (positionRoles.length > 0) {
          for (const [, guild] of client.guilds.cache) {
            let member;
            try { member = await guild.members.fetch(String(discord_id)); }
            catch { continue; }
            if (!member) continue;
            for (const roleName of positionRoles) {
              const role = guild.roles.cache.find(r => r.name === roleName);
              if (role && !member.roles.cache.has(role.id)) {
                try { await member.roles.add(role, 'Onboarding completed'); rolesAdded++; }
                catch (e) { console.warn(`[welcome] role add failed in ${guild.name} (${roleName}):`, e.message); }
              }
            }
          }
        }
      }
  
      res.json({ ok: true, roles_added: rolesAdded, channel_posted: channelPosted });
    } catch (e) {
      console.error('[welcome-new-staff] fatal:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  
  // POST /webhook/dm-with-attachment — DM a user with a file attached
  // Multipart form: { discord_id, body, file, title? }. Header: x-bot-secret.
  webhookApp.post('/webhook/dm-with-attachment', uploadDmAttachment.single('file'), async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    const discord_id = req.body?.discord_id;
    const body = req.body?.body;
    const title = req.body?.title;
    const file = req.file;
    if (!discord_id || !body || !file) {
      return res.status(400).json({ ok: false, reason: 'missing_fields' });
    }
    try {
      let user;
      try { user = await client.users.fetch(String(discord_id)); }
      catch (e) { return res.json({ ok: false, reason: 'user_fetch_failed', error: e.message }); }
      const attachment = { attachment: file.buffer, name: file.originalname || 'attachment' };
      try {
        if (title) {
          await user.send({
            embeds: [{
              color: 0xc9a84c,
              title,
              description: body,
              footer: { text: 'Community Organisation · Staff Portal' },
              timestamp: new Date().toISOString(),
            }],
            files: [attachment],
          });
        } else {
          await user.send({ content: body, files: [attachment] });
        }
        res.json({ ok: true });
      } catch (e) {
        res.json({ ok: false, reason: e.code === 50007 ? 'dm_blocked' : 'send_failed', error: e.message });
      }
    } catch (e) {
      console.error('[webhook/dm-with-attachment] fatal:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  
  // POST /bot/suspend — respond immediately, run role stripping in the
  // background so the portal PUT doesn't proxy-timeout at 60s.
  webhookApp.post('/bot/suspend', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    const { discordId, reason, duration, moderatorId, moderatorName, targetName, source } = req.body;
    if (!discordId) return res.status(400).json({ ok: false, error: 'discordId required' });
  
    // Ack the caller; everything below runs in the background.
    res.json({ ok: true, async: true });
  
    try {
      const { suspendAcrossGuilds } = await import('./utils/roleManager.js');
      const { addInfraction, addSuspension } = await import('./utils/botDb.js');
      const { logAction } = await import('./utils/logger.js');
  
      await suspendAcrossGuilds(client, discordId);
  
      function formatDuration(ms) {
        if (!ms) return 'Indefinite';
        const minutes = Math.floor(ms / 60000);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        if (days > 0) return days + ' day' + (days !== 1 ? 's' : '');
        if (hours > 0) return hours + ' hour' + (hours !== 1 ? 's' : '');
        if (minutes > 0) return minutes + ' minute' + (minutes !== 1 ? 's' : '');
        return 'Less than a minute';
      }
  
      let durationMs = null;
      if (duration) {
        const { default: ms } = await import('ms');
        durationMs = ms(duration);
      }
      const expiresAt = durationMs ? new Date(Date.now() + durationMs).toISOString() : null;
      const durationDisplay = formatDuration(durationMs);
      const expiresDisplay = expiresAt ? new Date(expiresAt).toUTCString() : 'Never';
  
      const inf = addInfraction(discordId, 'suspension', reason, moderatorId || 'PORTAL', moderatorName || 'Portal');
      addSuspension(discordId, reason, moderatorId || 'PORTAL', expiresAt, inf.lastInsertRowid);
  
      // DM the user
      try {
        const { EmbedBuilder } = await import('discord.js');
        const user = await client.users.fetch(discordId).catch(() => null);
        if (user) {
          await user.send({ embeds: [new EmbedBuilder()
            .setTitle('You Have Been Suspended')
            .setColor(0xEF4444)
            .setDescription(`${E.suspend} You have been suspended from **Community Organisation**.\n\nIf you believe this is an error, you may appeal in the Appeals Server.`)
            .addFields(
              { name: 'Reason', value: reason || 'No reason provided', inline: false },
              { name: 'Duration', value: durationDisplay, inline: true },
              { name: 'Expires', value: expiresDisplay, inline: true },
              { name: 'Actioned By', value: moderatorName || 'Staff Management', inline: true },
            )
            .setFooter({ text: 'Community Organisation | Staff Assistant' })
            .setTimestamp()
          ]});
        }
      } catch {}
  
      await logAction(client, {
        action: 'Staff Suspended (Portal)',
        moderator: { discordId: moderatorId || 'PORTAL', name: moderatorName || 'Portal' },
        target: { discordId, name: targetName || discordId },
        reason: reason || 'No reason provided',
        color: 0xEF4444,
        fields: [
          { name: 'Duration', value: durationDisplay, inline: true },
          { name: 'Expires', value: expiresDisplay, inline: true },
          { name: 'Actioned By', value: moderatorName || 'Portal', inline: true },
          { name: 'Source', value: source ? `CO Staff Portal — ${source}` : 'CO Staff Portal', inline: true },
        ]
      });
  
      // Auto-lift if timed
      if (durationMs) {
        setTimeout(async () => {
          const { unsuspendAcrossGuilds } = await import('./utils/roleManager.js');
          const { liftSuspension } = await import('./utils/botDb.js');
          const botDbMod = await import('./utils/botDb.js');
          await unsuspendAcrossGuilds(client, discordId, botDbMod.default);
          liftSuspension(discordId);
          try {
            const { EmbedBuilder } = await import('discord.js');
            const user = await client.users.fetch(discordId).catch(() => null);
            if (user) await user.send({ embeds: [new EmbedBuilder()
              .setTitle('Suspension Lifted')
              .setColor(0x22C55E)
              .setDescription(`${E.check} Your suspension from **Community Organisation** has ended and your roles have been restored.`)
              .setFooter({ text: 'Community Organisation | Staff Assistant' })
              .setTimestamp()
            ]});
          } catch {}
          await logAction(client, {
            action: 'Suspension Lifted (Auto)',
            moderator: { discordId: 'SYSTEM', name: 'Automated' },
            target: { discordId, name: targetName || discordId },
            reason: 'Suspension duration expired',
            color: 0x22C55E
          });
        }, durationMs);
      }
  
      // (Response already sent at the top of the handler — see 'async: true' ack)
    } catch (e) {
      console.error('[BOT WEBHOOK /suspend async]', e.message, e.stack);
    }
  });
  
  // POST /bot/unsuspend — respond immediately, restore roles in the
  // background. Iterating 9 guilds × N roles via Discord's API typically
  // takes 15-30s and was causing the portal's reverse proxy to return 502.
  webhookApp.post('/bot/unsuspend', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    const { discordId, moderatorName, targetName, source } = req.body;
    if (!discordId) return res.status(400).json({ ok: false, error: 'discordId required' });
  
    // Acknowledge the caller straight away so the portal PUT can return.
    res.json({ ok: true, async: true });
  
    (async () => {
      try {
        const { unsuspendAcrossGuilds } = await import('./utils/roleManager.js');
        const { liftSuspension } = await import('./utils/botDb.js');
        const botDbMod = await import('./utils/botDb.js');
        await unsuspendAcrossGuilds(client, discordId, botDbMod.default);
        liftSuspension(discordId);
  
        try {
          const { EmbedBuilder } = await import('discord.js');
          const user = await client.users.fetch(discordId).catch(() => null);
          if (user) await user.send({ embeds: [new EmbedBuilder()
            .setTitle('Suspension Lifted')
            .setColor(0x22C55E)
            .setDescription(`${E.check} Your suspension from **Community Organisation** has ended and your roles have been restored.`)
            .addFields({ name: 'Actioned By', value: moderatorName || 'Staff Management', inline: true })
            .setFooter({ text: 'Community Organisation | Staff Assistant' })
            .setTimestamp()
          ]});
        } catch {}
  
        const { logAction } = await import('./utils/logger.js');
        await logAction(client, {
          action: 'Suspension Lifted (Portal)',
          moderator: { discordId: 'PORTAL', name: moderatorName || 'Portal' },
          target: { discordId, name: targetName || discordId },
          reason: 'Lifted via CO Staff Portal',
          color: 0x22C55E,
          fields: [{ name: 'Source', value: source ? `CO Staff Portal — ${source}` : 'CO Staff Portal', inline: true }]
        });
      } catch (e) {
        console.error('[BOT WEBHOOK /unsuspend async]', e.message, e.stack);
      }
    })();
  });
  
  // POST /bot/assignment-extension — handle deadline extension from portal
  webhookApp.post('/bot/assignment-extension', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    const { bot_assignment_id, new_due_date, approved_by } = req.body;
    if (!bot_assignment_id || !new_due_date) return res.status(400).json({ ok: false, error: 'bot_assignment_id and new_due_date required' });
    try {
      const { getAssignment: getAssign, updateAssignment: updateAssign } = await import('./utils/botDb.js');
      const { buildAssignmentEmbed } = await import('./commands/assign.js');
  
      const assignment = getAssign(bot_assignment_id);
      if (!assignment) return res.status(404).json({ ok: false, error: 'Assignment not found' });
  
      updateAssign(bot_assignment_id, {
        due_date: new_due_date,
        extension_count: (assignment.extension_count || 0) + 1,
        status: assignment.status === 'overdue' ? 'pending' : assignment.status,
        overdue_notified: 0,
        case_raised: 0,
      });
  
      // Update embed
      try {
        if (assignment.channel_id && assignment.message_id) {
          const channel = await client.channels.fetch(assignment.channel_id);
          const msg = await channel.messages.fetch(assignment.message_id);
          const updated = getAssign(bot_assignment_id);
          const { buildAssignmentEmbed: buildEmbed, buildAssignmentButtons } = await import('./commands/assign.js');
          const embed = buildEmbed(updated, null, null, {
            assignmentNumber: `ASN-${bot_assignment_id}`,
            extensionNote: `Extended — Performance Adjustment approved by ${approved_by || 'admin'}. New due date: <t:${Math.floor(new Date(new_due_date).getTime()/1000)}:D>`,
          });
          const buttons = buildAssignmentButtons ? buildAssignmentButtons(bot_assignment_id, updated.status) : [];
          await msg.edit({ embeds: [embed], components: buttons });
        }
      } catch (e) { console.error('[assignment-extension] embed update error:', e.message); }
  
      // DM assigned person
      try {
        const user = await client.users.fetch(assignment.assigned_to);
        await user.send({ embeds: [new EmbedBuilder()
          .setTitle('Task Deadline Extended')
          .setColor(0x22C55E)
          .setDescription(`${E.calendar} Your task deadline for **"${assignment.title}"** has been extended to **<t:${Math.floor(new Date(new_due_date).getTime()/1000)}:F>** following an approved performance adjustment.`)
          .setFooter({ text: 'Community Organisation | Staff Assistant' })
          .setTimestamp()
        ]});
      } catch {}
  
      // DM assigner
      try {
        const { getUserByDiscordId: getUser } = await import('./db.js');
        const assigneeName = getUser(assignment.assigned_to)?.display_name || assignment.assigned_to;
        const assigner = await client.users.fetch(assignment.assigned_by);
        await assigner.send({ content: `${E.calendar} **${assigneeName}**'s task deadline for "${assignment.title}" has been extended to **<t:${Math.floor(new Date(new_due_date).getTime()/1000)}:F>** — performance adjustment approved by ${approved_by || 'admin'}.` });
      } catch {}
  
      res.json({ ok: true });
    } catch (e) {
      console.error('[BOT WEBHOOK /assignment-extension]', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  
  // POST /bot/disciplinary — handle disciplinary role actions from portal
  webhookApp.post('/bot/disciplinary', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    const { action, discordId, caseRef, notes, newPosition, targetName, moderatorName } = req.body;
    if (!action || !discordId) return res.status(400).json({ ok: false, error: 'action and discordId required' });
  
    try {
      const { removeAllStaffRoles, kickFromAllServers, restorePositionRoles } = await import('./utils/roleManager.js');
      const { addInfraction } = await import('./utils/botDb.js');
      const { logAction } = await import('./utils/logger.js');
      const { POSITIONS, ALL_MANAGED_ROLES } = await import('./utils/positions.js');
      const { getEffectiveAllServerIds } = await import('./config.js');
      const ALL_SERVER_IDS = getEffectiveAllServerIds(client);
  
      // Log infraction to bot DB
      if (caseRef) {
        addInfraction(discordId, action, `${notes || ''} [Case: ${caseRef}]`, 'PORTAL', 'Portal');
      }
  
      const results = { action, servers: [], errors: [] };
  
      switch (action) {
        case 'remove_roles': {
          for (const gid of ALL_SERVER_IDS) {
            try {
              const guild = await client.guilds.fetch(gid).catch(() => null);
              if (!guild) continue;
              const member = await guild.members.fetch(discordId).catch(() => null);
              if (!member) continue;
              const managed = ALL_MANAGED_ROLES;
              for (const roleName of managed) {
                const role = guild.roles.cache.find(r => r.name === roleName);
                if (role && member.roles.cache.has(role.id)) await member.roles.remove(role).catch(() => {});
              }
              results.servers.push(guild.name);
            } catch (e) { results.errors.push(e.message); }
          }
          break;
        }
        case 'kick': {
          for (const gid of ALL_SERVER_IDS) {
            try {
              const guild = await client.guilds.fetch(gid).catch(() => null);
              if (!guild) continue;
              const member = await guild.members.fetch(discordId).catch(() => null);
              if (member) { await member.kick(notes || 'Disciplinary action'); results.servers.push(guild.name); }
            } catch (e) { results.errors.push(e.message); }
          }
          break;
        }
        case 'ban': {
          for (const gid of ALL_SERVER_IDS) {
            try {
              const guild = await client.guilds.fetch(gid).catch(() => null);
              if (!guild) continue;
              await guild.members.ban(discordId, { reason: notes || 'Staff disciplinary action' }).catch(() => {});
              results.servers.push(guild.name);
            } catch (e) { results.errors.push(e.message); }
          }
          break;
        }
        case 'global_ban': {
          for (const guild of client.guilds.cache.values()) {
            try {
              await guild.members.ban(discordId, { reason: notes || 'Global ban - disciplinary action' }).catch(() => {});
              results.servers.push(guild.name);
            } catch (e) { results.errors.push(e.message); }
          }
          break;
        }
        case 'demote': {
          // Remove all managed roles, then apply new position roles
          for (const gid of ALL_SERVER_IDS) {
            try {
              const guild = await client.guilds.fetch(gid).catch(() => null);
              if (!guild) continue;
              const member = await guild.members.fetch(discordId).catch(() => null);
              if (!member) continue;
              for (const roleName of ALL_MANAGED_ROLES) {
                const role = guild.roles.cache.find(r => r.name === roleName);
                if (role && member.roles.cache.has(role.id)) await member.roles.remove(role).catch(() => {});
              }
              if (newPosition && POSITIONS[newPosition]) {
                for (const roleName of POSITIONS[newPosition]) {
                  const role = guild.roles.cache.find(r => r.name === roleName);
                  if (role) await member.roles.add(role).catch(() => {});
                }
              }
              results.servers.push(guild.name);
            } catch (e) { results.errors.push(e.message); }
          }
          break;
        }
        case 'reinstate': {
          // Iterate client.guilds.cache (every guild the bot is in)
          // rather than ALL_SERVER_IDS, which depends on env vars and is
          // empty here. Also add Verified + CO Staff alongside the
          // position-derived role list so a reinstated user ends up with
          // their full baseline role set.
          if (newPosition && POSITIONS[newPosition]) {
            const roleNames = [...POSITIONS[newPosition], 'Verified', 'CO | Staff'];
            for (const [, guild] of client.guilds.cache) {
              try {
                const member = await guild.members.fetch(discordId).catch(() => null);
                if (!member) continue;
                let added = 0;
                for (const roleName of roleNames) {
                  const role = guild.roles.cache.find(r => r.name === roleName);
                  if (role && !member.roles.cache.has(role.id)) {
                    await member.roles.add(role, `Reinstate — ${caseRef || 'portal'}`).catch(() => {});
                    added++;
                  }
                }
                results.servers.push(`${guild.name} (+${added})`);
              } catch (e) { results.errors.push(e.message); }
            }
          }
          break;
        }
      }
  
      // Tidy the action label — bare tokens like `warning` render as-is,
      // so title-case for the embed. `first_written_warning` →
      // `First Written Warning`, `warning` → `Warning`.
      const actionLabel = String(action)
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
  
      // Some action types don't touch guilds (`warning`, future inline
      // notices). Don't bolt a 'Servers: None' row onto the embed in
      // those cases — it's noise, not information.
      const embedFields = [{ name: 'Action', value: actionLabel, inline: true }];
      if (results.servers.length > 0) {
        embedFields.push({ name: 'Servers', value: results.servers.join(', '), inline: true });
      }
  
      await logAction(client, {
        action: `Disciplinary Action (Portal): ${actionLabel}`,
        moderator: { discordId: 'PORTAL', name: moderatorName || 'Portal Case Management' },
        target: { discordId, name: targetName || discordId },
        reason: notes || caseRef || 'No reason',
        color: 0xEF4444,
        fields: embedFields,
      });
  
      res.json({ ok: true, ...results });
    } catch (e) {
      console.error('[BOT WEBHOOK /disciplinary]', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  
  // POST /webhook — general webhook handler for portal events
  webhookApp.post('/webhook', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    const { type } = req.body;
    if (!type) return res.status(400).json({ error: 'type required' });
  
    try {
      const { postDirectiveEmbed, revokeDirectiveEmbed, postMemoEmbed, revokeMemoEmbed, handleTransferApproved } = await import('./services/directiveService.js');
  
      switch (type) {
        case 'directive_issued':
          await postDirectiveEmbed(client, req.body);
          break;
        case 'directive_revoked':
          await revokeDirectiveEmbed(client, req.body);
          break;
        case 'iac_memo_issued':
          await postMemoEmbed(client, req.body);
          break;
        case 'iac_memo_revoked':
          await revokeMemoEmbed(client, req.body);
          break;
        case 'transfer_approved':
          await handleTransferApproved(client, req.body);
          break;
        case 'unverify': {
          const { discord_id, reason } = req.body;
          if (discord_id) {
            const { stripVerification } = await import('./utils/verifyHelper.js');
            await stripVerification(client, discord_id, null);
            console.log(`[Webhook] Unverified ${discord_id}: ${reason || 'No reason'}`);
          }
          break;
        }
        case 'reverify': {
          const { discord_id: rvId, position: rvPos, nickname: rvNick } = req.body;
          if (rvId && rvPos) {
            // Submit a verification request instead of auto-verifying
            const { getOrCreateVerificationChannel } = await import('./utils/verifyHelper.js');
            const { db: botDatabase } = await import('./utils/botDb.js');
            const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import('discord.js');
  
            const verifyChannel = await getOrCreateVerificationChannel(client);
            const result = botDatabase.prepare(`
              INSERT INTO verification_queue (discord_id, guild_id, requested_nickname, position, channel_id, verified_official, is_probation)
              VALUES (?, ?, ?, ?, ?, 0, 0)
            `).run(rvId, '', rvNick || '(pending approver input)', rvPos, verifyChannel.id);
  
            const queueId = result.lastInsertRowid;
            const embed = new EmbedBuilder()
              .setTitle(`Verification Request #${queueId} [Force Transfer]`)
              .setColor(0xF59E0B)
              .addFields(
                { name: 'User', value: `<@${rvId}> (${rvId})`, inline: false },
                { name: 'New Position', value: rvPos, inline: false },
                { name: 'Nickname', value: rvNick || '(pending approver input)', inline: false },
                { name: 'Reason', value: 'SCSC Force Transfer — requires re-verification with new position roles', inline: false },
              )
              .setTimestamp();
  
            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`verify_approve_${queueId}_0`).setLabel('Confirm').setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId(`verify_auth_override_${queueId}`).setLabel('Authorisation Level').setStyle(ButtonStyle.Secondary),
              new ButtonBuilder().setCustomId(`verify_deny_${queueId}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
            );
  
            const msg = await verifyChannel.send({ embeds: [embed], components: [row] });
            botDatabase.prepare('UPDATE verification_queue SET message_id = ? WHERE id = ?').run(msg.id, queueId);
  
            console.log(`[Webhook] Verification request #${queueId} created for ${rvId} as ${rvPos} (force transfer)`);
          }
          break;
        }
        default:
          console.log(`[Webhook] Unknown type: ${type}`);
      }
  
      res.json({ ok: true });
    } catch (e) {
      console.error(`[Webhook] Error handling ${type}:`, e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  
  // POST /webhook/appeal-verify — public /appeal flow
  // Body: { discord_id, code }. Header: x-bot-secret.
  // Confirms guild membership of International Court, then DMs the code.
  const INTL_COURT_GUILD = '1366218589367042048';
  webhookApp.post('/webhook/appeal-verify', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    const { discord_id, code } = req.body || {};
    if (!discord_id || !code) return res.status(400).json({ ok: false, error: 'discord_id and code required' });
    try {
      const guild = client.guilds.cache.get(INTL_COURT_GUILD);
      if (!guild) {
        console.warn('[appeal-verify] Guild not cached:', INTL_COURT_GUILD);
        return res.status(502).json({ ok: false, reason: 'guild_unavailable' });
      }
      let member = guild.members.cache.get(String(discord_id));
      if (!member) {
        try { member = await guild.members.fetch({ user: String(discord_id), force: false }); }
        catch { member = null; }
      }
      if (!member) {
        return res.json({ ok: false, reason: 'not_in_server' });
      }
  
      let user;
      try { user = await client.users.fetch(String(discord_id)); }
      catch (e) {
        console.error('[appeal-verify] user fetch failed:', e.message);
        return res.status(502).json({ ok: false, reason: 'user_fetch_failed' });
      }
      try {
        await user.send({
          embeds: [{
            color: 0x6366f1, // indigo-500
            title: 'Appeal Portal — Verification',
            description: 'Use this one-time code to continue your appeal submission. If you didn\'t request this, ignore this DM.',
            fields: [
              { name: 'Your code', value: '```\n' + code + '\n```', inline: false },
              { name: 'Expires in', value: '10 minutes', inline: true },
            ],
            footer: { text: 'Community Organisation · Appeal Portal' },
            timestamp: new Date().toISOString(),
          }],
        });
      } catch (e) {
        console.warn('[appeal-verify] DM blocked:', e.message);
        return res.json({ ok: false, reason: 'dm_blocked' });
      }
      res.json({ ok: true });
    } catch (e) {
      console.error('[appeal-verify] fatal:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  
  // POST /webhook/gdpr-deliver — Phase G4 subject access code / bundle delivery
  // Body: { discord_id, body, request_number?, regenerated? }. Header: x-bot-secret.
  // No guild-membership requirement — subjects may have left the server and still
  // have a statutory right to access their data.
  webhookApp.post('/webhook/gdpr-deliver', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    const { discord_id, body, request_number, regenerated } = req.body || {};
    if (!discord_id || !body) return res.status(400).json({ ok: false, reason: 'missing_fields' });
    try {
      let user;
      try { user = await client.users.fetch(String(discord_id)); }
      catch (e) {
        console.error('[gdpr-deliver] user fetch failed:', e.message);
        return res.status(502).json({ ok: false, reason: 'user_fetch_failed' });
      }
      try {
        await user.send({
          embeds: [{
            color: 0x8b5cf6,
            title: regenerated ? 'GDPR Access Code — Reissued' : 'GDPR Data Access — Your Bundle is Ready',
            description: regenerated
              ? 'A new access code has been issued for your GDPR request. The previous code no longer works.'
              : 'Your GDPR data access bundle is ready to download. Keep this code private — anyone with it (and your Discord ID) can access the data.',
            fields: [
              ...(request_number ? [{ name: 'Request', value: '`' + request_number + '`', inline: true }] : []),
              { name: 'Details', value: '```\n' + body + '\n```', inline: false },
            ],
            footer: { text: 'Community Organisation · GDPR Portal' },
            timestamp: new Date().toISOString(),
          }],
        });
      } catch (e) {
        console.warn('[gdpr-deliver] DM blocked:', e.message);
        return res.json({ ok: false, reason: 'dm_blocked' });
      }
      res.json({ ok: true });
    } catch (e) {
      console.error('[gdpr-deliver] fatal:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  
  // POST /webhook/gdpr-iac-notify — Phase G8 processor awareness pings
  const GDPR_IAC_EVENTS = {
    subject_verified: {
      title: 'GDPR bundle accessed',
      description: (n) => `The subject of ${n} just verified their access code and opened their bundle. No action required \u2014 this is for your awareness.`,
    },
    zip_downloaded: {
      title: 'GDPR full bundle downloaded',
      description: (n) => `The subject of ${n} just downloaded the full ZIP bundle. Logged in the audit trail.`,
    },
  };
  webhookApp.post('/webhook/gdpr-iac-notify', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    const { processor_discord_id, request_number, event, detail } = req.body || {};
    if (!processor_discord_id || !request_number || !event) {
      return res.status(400).json({ ok: false, reason: 'missing_fields' });
    }
    const meta = GDPR_IAC_EVENTS[event];
    if (!meta) return res.status(400).json({ ok: false, reason: 'unknown_event' });
    try {
      let user;
      try { user = await client.users.fetch(String(processor_discord_id)); }
      catch (e) {
        console.warn('[gdpr-iac-notify] user fetch failed:', e.message);
        return res.json({ ok: false, reason: 'user_fetch_failed' });
      }
      try {
        await user.send({
          embeds: [{
            color: 0x64748b,
            title: meta.title,
            description: meta.description(request_number),
            fields: [
              { name: 'Request', value: '`' + request_number + '`', inline: true },
              ...(detail ? [{ name: 'Detail', value: String(detail).slice(0, 500), inline: false }] : []),
            ],
            footer: { text: 'CO \u00b7 GDPR processor awareness' },
            timestamp: new Date().toISOString(),
          }],
        });
      } catch (e) {
        console.warn('[gdpr-iac-notify] DM failed:', e.message);
        return res.json({ ok: false, reason: 'dm_blocked' });
      }
      res.json({ ok: true });
    } catch (e) {
      console.error('[gdpr-iac-notify] fatal:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  
  // POST /webhook/testing-verify — internal /testing bug-report flow
  // Body: { discord_id, code }. Header: x-bot-secret.
  webhookApp.post('/webhook/testing-verify', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    const { discord_id, code } = req.body || {};
    if (!discord_id || !code) return res.status(400).json({ ok: false, error: 'discord_id and code required' });
    try {
      let user;
      try { user = await client.users.fetch(String(discord_id)); }
      catch (e) {
        console.error('[testing-verify] user fetch failed:', e.message);
        return res.status(502).json({ ok: false, reason: 'user_fetch_failed' });
      }
      try {
        await user.send({
          embeds: [{
            color: 0xe11d48, // rose-600
            title: 'Testing Portal — Verification',
            description: 'Use this one-time code to unlock the bug-report form. If you didn\'t request this, ignore this DM.',
            fields: [
              { name: 'Your code', value: '```\n' + code + '\n```', inline: false },
              { name: 'Expires in', value: '10 minutes', inline: true },
            ],
            footer: { text: 'Community Organisation · Testing Portal' },
            timestamp: new Date().toISOString(),
          }],
        });
      } catch (e) {
        console.warn('[testing-verify] DM blocked:', e.message);
        return res.json({ ok: false, reason: 'dm_blocked' });
      }
      res.json({ ok: true });
    } catch (e) {
      console.error('[testing-verify] fatal:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  
  // POST /api/send-dm — unified DM endpoint for portal
  webhookApp.post('/api/send-dm', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    const { discord_id, message, embed, pdf_buffer, pdf_filename } = req.body;
    if (!discord_id) return res.status(400).json({ error: 'discord_id required' });
    try {
      const trimmedMessage = typeof message === 'string' ? message.trim() : '';
      const hasEmbed = !!embed;
      const hasPdf = !!pdf_buffer;
      // Refuse instead of sending a placeholder. Earlier the route fell
      // back to "No message provided" when message/embed were both empty,
      // which leaked a useless DM to staff whenever a caller forgot the
      // body or chained a pdf-only payload through the message field.
      if (!trimmedMessage && !hasEmbed && !hasPdf) {
        return res.status(400).json({ ok: false, error: 'message, embed, or pdf_buffer required' });
      }
  
      const user = await client.users.fetch(String(discord_id));
      if (hasEmbed) {
        await user.send({ embeds: [typeof embed === 'string' ? JSON.parse(embed) : embed] });
      } else if (trimmedMessage) {
        await user.send(trimmedMessage);
      }
      // If only pdf_buffer is present we skip the leading text DM —
      // the attachment block below sends the PDF as its own message.
  
      if (hasPdf) {
        const { AttachmentBuilder } = await import('discord.js');
        const buf = Buffer.from(pdf_buffer, 'base64');
        const attachment = new AttachmentBuilder(buf, { name: pdf_filename || 'document.pdf' });
        await user.send({ files: [attachment] });
      }
  
      res.json({ ok: true });
    } catch (e) {
      console.error('[DM API]', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  
  // POST /api/shop-approval-dm — send shop redemption approval DM with buttons
  webhookApp.post('/api/shop-approval-dm', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    const { discord_id, redemption_id, staff_display_name, perk_name, perk_cost, month_key, shop_closes_at } = req.body;
    if (!discord_id || !redemption_id) return res.status(400).json({ error: 'discord_id and redemption_id required' });
    try {
      const user = await client.users.fetch(String(discord_id));
      const shopCloseFormatted = new Date(shop_closes_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  
      const embed = new EmbedBuilder()
        .setTitle('CO Shop — Approval Required')
        .setColor(0xC9A84C)
        .addFields(
          { name: 'Staff Member', value: staff_display_name || 'Unknown', inline: true },
          { name: 'Perk Requested', value: perk_name || 'Unknown', inline: true },
          { name: 'Cost', value: `${perk_cost} pts`, inline: true },
          { name: 'Shop Closes', value: shopCloseFormatted, inline: true },
        )
        .setFooter({ text: 'Only one EOB member needs to action this. Buttons will disable once actioned.' })
        .setTimestamp();
  
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`shop_approve_${redemption_id}`).setLabel('Approve').setStyle(3), // Success = 3
        new ButtonBuilder().setCustomId(`shop_decline_${redemption_id}`).setLabel('Decline').setStyle(4), // Danger = 4
      );
  
      const msg = await user.send({ embeds: [embed], components: [row] });
  
      // Store message ID on portal
      try {
        await fetch(`http://localhost:3016/api/activity/shop/redemptions/${redemption_id}/bot-message`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET },
          body: JSON.stringify({ discord_id: String(discord_id), message_id: String(msg.id) }),
        });
      } catch (e) {
        console.error('[Shop DM] Failed to store message ID:', e.message);
      }
  
      res.json({ ok: true, message_id: msg.id });
    } catch (e) {
      console.error('[Shop DM]', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  
  // POST /api/case-ack-dm — send a case DM with an "Acknowledge" button.
  // When the recipient clicks the button, the handler POSTs back to the
  // portal's /api/cases/:id/bot/ack-callback so the case timeline gets a
  // real acknowledgement entry.
  webhookApp.post('/api/case-ack-dm', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    const { discord_id, case_id, case_number, embed, ack_role } = req.body;
    if (!discord_id || !case_id) return res.status(400).json({ error: 'discord_id and case_id required' });
    try {
      const user = await client.users.fetch(String(discord_id));
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`case_ack_${case_id}_${ack_role || 'party'}`).setLabel('Acknowledge').setStyle(3),
        new ButtonBuilder().setCustomId(`case_view_${case_id}`).setLabel('Open case').setStyle(2),
      );
      const payload = { components: [row] };
      if (embed) payload.embeds = [typeof embed === 'string' ? JSON.parse(embed) : embed];
      const msg = await user.send(payload);
      res.json({ ok: true, message_id: msg.id });
    } catch (e) {
      console.error('[case-ack-dm]', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  
  // POST /api/send-channel — send embed to a Discord channel.
  // Accepts an optional allowed_mentions object so callers can opt in
  // to @everyone / @here / specific role pings (Discord drops them
  // silently otherwise — they'd render as plain text). Pass
  // `allowed_mentions: { parse: ['everyone'] }` to actually ping the
  // guild.
  webhookApp.post('/api/send-channel', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    const { channel_id, embed, content, allowed_mentions } = req.body;
    if (!channel_id) return res.status(400).json({ error: 'channel_id required' });
    try {
      const channel = await client.channels.fetch(channel_id);
      const payload = {};
      if (content) payload.content = content;
      if (embed) payload.embeds = [typeof embed === 'string' ? JSON.parse(embed) : embed];
      if (allowed_mentions && typeof allowed_mentions === 'object') {
        payload.allowedMentions = allowed_mentions;
      }
      const sent = await channel.send(payload);
      res.json({ ok: true, message_id: sent.id });
    } catch (e) {
      console.error('[Channel API]', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  
  // POST /api/discord-presence — bulk fetch presence for multiple users
  webhookApp.post('/api/discord-presence', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { discordIds } = req.body;
      if (!Array.isArray(discordIds)) return res.status(400).json({ ok: false, error: 'discordIds array required' });
  
      const presences = {};
      // Same PRESENCE_GUILD = Internal Hub note as the daily-activity sync above.
      const PRESENCE_GUILD = '1357119461957570570';
      const guild = client.guilds.cache.get(PRESENCE_GUILD);
      if (guild) {
        for (const id of discordIds) {
          try {
            const member = guild.members.cache.get(id);
            if (member?.presence) {
              presences[id] = member.presence.status; // online, idle, dnd, offline
            } else {
              presences[id] = 'offline';
            }
          } catch { presences[id] = 'offline'; }
        }
      }
      res.json({ ok: true, presences });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  
  // GET /api/discord-user/:id — fetch Discord user info (avatar, username)
  webhookApp.get('/api/discord-user/:id', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const user = await client.users.fetch(req.params.id);
      res.json({
        ok: true,
        id: user.id,
        username: user.username,
        tag: user.tag,
        avatar: user.avatar,
        avatarUrl: user.displayAvatarURL({ size: 128, extension: 'png' }),
      });
    } catch (e) {
      res.status(404).json({ ok: false, error: 'User not found' });
    }
  });
  
  // GET /api/brag/breakdown/:discordId — per-guild message breakdown for portal
  webhookApp.get('/api/brag/breakdown/:discordId', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    try {
      const { db: botDatabase } = await import('./utils/botDb.js');
      const { discordId } = req.params;
      const weekKey = req.query.week || getBragWeekKey();
  
      const breakdown = botDatabase.prepare(`
        SELECT guild_id, guild_name, message_count, last_updated
        FROM brag_message_counts
        WHERE discord_id = ? AND week_key = ?
        ORDER BY message_count DESC
      `).all(discordId, weekKey);
  
      const total = breakdown.reduce((sum, r) => sum + r.message_count, 0);
      res.json({ ok: true, breakdown, total, weekKey });
    } catch (e) {
      console.error('[BRAG Breakdown API]', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  
  // ─── Generic role management ────────────────────────────────────
  // Lets the portal manage role membership on the staff guild without
  // duplicating Discord-API logic on both sides. Default guild is
  // Staff HQ (1357119461957570570); callers can override for other
  // guilds the bot sits in. Role is matched by name (case-insensitive)
  // and optionally created if missing — saves the caller having to
  // maintain a name→id map.
  const STAFF_HQ_GUILD = '1357119461957570570';
  
  function pickRoleColour(roleName) {
    // Tiny lookup so the handful of known portal-managed roles get
    // consistent branding. Unknown names fall through to Discord's
    // default (no colour) so we don't lock in opinions on roles the
    // portal doesn't own.
    const n = String(roleName || '').toLowerCase();
    if (n.includes('welfare')) return 0xF472B6;   // pink — matches the portal badge
    if (n.includes('iac'))     return 0xC9A84C;   // gold
    return 0;
  }
  
  // Helper shared between /api/role/assign and /api/role/unassign so
  // either endpoint can fan out across every guild in ALL_SERVER_IDS
  // with a single call from the portal. Keeps the multi-guild case out
  // of the portal-side wrapper where it'd have to re-fetch the guild
  // list and do N round-trips.
  async function resolveTargetGuilds(all_servers, guild_id) {
    if (all_servers) {
      const { getEffectiveAllServerIds } = await import('./config.js');
      const ALL_SERVER_IDS = getEffectiveAllServerIds(client);
      // Prefer the env-configured list. If empty, fall back to every
      // guild the bot is currently a member of — this covers cases
      // where the env vars weren't set (early deployments) but the bot
      // is sitting in every staff server already.
      if (ALL_SERVER_IDS && ALL_SERVER_IDS.length) return ALL_SERVER_IDS;
      const live = [...client.guilds.cache.keys()];
      return live.length ? live : [STAFF_HQ_GUILD];
    }
    return [String(guild_id || STAFF_HQ_GUILD)];
  }
  
  webhookApp.post('/api/role/assign', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    const { discord_id, role_name, guild_id, all_servers = false, create_if_missing = true, reason } = req.body || {};
    if (!discord_id) return res.status(400).json({ ok: false, error: 'discord_id required' });
    if (!role_name)  return res.status(400).json({ ok: false, error: 'role_name required' });
  
    const targetGuilds = await resolveTargetGuilds(all_servers, guild_id);
    const results = [];
  
    for (const gid of targetGuilds) {
      try {
        const guild = client.guilds.cache.get(gid) || await client.guilds.fetch(gid).catch(() => null);
        if (!guild) { results.push({ guild_id: gid, ok: false, error: 'guild_not_cached' }); continue; }
  
        let role = guild.roles.cache.find(r => r.name.toLowerCase() === String(role_name).toLowerCase());
        let created = false;
        if (!role) {
          if (!create_if_missing) { results.push({ guild_id: gid, guild_name: guild.name, ok: false, error: 'role_not_found' }); continue; }
          role = await guild.roles.create({
            name: role_name,
            color: pickRoleColour(role_name),
            mentionable: false,
            reason: reason || 'Portal: auto-create role on first assignment',
          });
          created = true;
        }
  
        const member = await guild.members.fetch(String(discord_id)).catch(() => null);
        if (!member) { results.push({ guild_id: gid, guild_name: guild.name, ok: false, error: 'member_not_in_guild' }); continue; }
  
        let addedNow = false;
        if (!member.roles.cache.has(role.id)) {
          await member.roles.add(role, reason || 'Portal: role assignment');
          addedNow = true;
        }
  
        results.push({ guild_id: gid, guild_name: guild.name, ok: true, role_id: role.id, role_name: role.name, created, already_had: !addedNow });
      } catch (e) {
        console.error(`[Role API] assign error on ${gid}:`, e.message);
        results.push({ guild_id: gid, ok: false, error: e.message });
      }
    }
  
    // Single-guild callers keep the old flat shape so nothing upstream breaks.
    if (!all_servers) {
      const r = results[0] || { ok: false, error: 'no_result' };
      return res.json(r);
    }
    res.json({ ok: results.some(r => r.ok), results });
  });
  
  webhookApp.post('/api/role/unassign', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    const { discord_id, role_name, guild_id, all_servers = false, reason } = req.body || {};
    if (!discord_id) return res.status(400).json({ ok: false, error: 'discord_id required' });
    if (!role_name)  return res.status(400).json({ ok: false, error: 'role_name required' });
  
    const targetGuilds = await resolveTargetGuilds(all_servers, guild_id);
    const results = [];
  
    for (const gid of targetGuilds) {
      try {
        const guild = client.guilds.cache.get(gid) || await client.guilds.fetch(gid).catch(() => null);
        if (!guild) { results.push({ guild_id: gid, ok: false, error: 'guild_not_cached' }); continue; }
  
        const role = guild.roles.cache.find(r => r.name.toLowerCase() === String(role_name).toLowerCase());
        if (!role) { results.push({ guild_id: gid, guild_name: guild.name, ok: true, removed: false, reason: 'role_does_not_exist' }); continue; }
  
        const member = await guild.members.fetch(String(discord_id)).catch(() => null);
        if (!member) { results.push({ guild_id: gid, guild_name: guild.name, ok: true, removed: false, reason: 'member_not_in_guild' }); continue; }
  
        if (member.roles.cache.has(role.id)) {
          await member.roles.remove(role, reason || 'Portal: role removal');
          results.push({ guild_id: gid, guild_name: guild.name, ok: true, removed: true, role_id: role.id });
        } else {
          results.push({ guild_id: gid, guild_name: guild.name, ok: true, removed: false, reason: 'role_not_held' });
        }
      } catch (e) {
        console.error(`[Role API] unassign error on ${gid}:`, e.message);
        results.push({ guild_id: gid, ok: false, error: e.message });
      }
    }
  
    if (!all_servers) {
      const r = results[0] || { ok: false, error: 'no_result' };
      return res.json(r);
    }
    res.json({ ok: results.some(r => r.ok), results });
  });
  
  // POST /api/role/position
  //   Body: { role_name, below_role_name?, above_role_name?, guild_id?,
  //           all_servers?, create_if_missing? (default true), reason? }
  //
  // Moves `role_name` to sit immediately below (or above) a reference
  // role in each targeted guild. If the role doesn't exist in a guild
  // but the reference does AND create_if_missing, it's created first
  // (mirroring the /role/assign create path) so the position lookup
  // has something to place.
  //
  // "All servers" iterates ALL_SERVER_IDS (Staff HQ + Network) so a
  // single portal call keeps the role hierarchy consistent across every
  // staff-facing server.
  webhookApp.post('/api/role/position', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    const {
      role_name,
      below_role_name,
      above_role_name,
      guild_id,
      all_servers = false,
      create_if_missing = true,
      reason,
    } = req.body || {};
    if (!role_name) return res.status(400).json({ ok: false, error: 'role_name required' });
    if (!below_role_name && !above_role_name) {
      return res.status(400).json({ ok: false, error: 'below_role_name or above_role_name required' });
    }
  
    const targetGuildIds = await resolveTargetGuilds(all_servers, guild_id);
  
    const results = [];
    for (const gid of targetGuildIds) {
      try {
        const guild = client.guilds.cache.get(gid) || await client.guilds.fetch(gid).catch(() => null);
        if (!guild) { results.push({ guild_id: gid, ok: false, error: 'guild_not_cached' }); continue; }
  
        const refName = below_role_name || above_role_name;
        const refRole = guild.roles.cache.find(r => r.name.toLowerCase() === String(refName).toLowerCase());
        if (!refRole) { results.push({ guild_id: gid, ok: false, error: `reference_role_not_found: ${refName}` }); continue; }
  
        let role = guild.roles.cache.find(r => r.name.toLowerCase() === String(role_name).toLowerCase());
        let created = false;
        if (!role) {
          if (!create_if_missing) { results.push({ guild_id: gid, ok: false, error: 'role_not_found' }); continue; }
          role = await guild.roles.create({
            name: role_name,
            color: pickRoleColour(role_name),
            mentionable: false,
            reason: reason || 'Portal: auto-create role for position sync',
          });
          created = true;
        }
  
        // Don't try to move @everyone or managed roles — Discord rejects.
        if (role.managed || role.id === guild.roles.everyone.id) {
          results.push({ guild_id: gid, ok: false, error: 'role_not_repositionable' });
          continue;
        }
  
        // Target = reference.position adjusted by direction. Discord
        // enforces "role must be below bot's highest role"; if the
        // target exceeds the bot's ceiling we just clamp and log so
        // the caller sees what happened.
        const desired = below_role_name
          ? Math.max(1, refRole.position - 1)
          : refRole.position + 1;
  
        const me = await guild.members.fetchMe().catch(() => null);
        const botCeiling = me?.roles?.highest?.position ?? 0;
        const clamped = Math.min(desired, Math.max(1, botCeiling - 1));
        const finalPosition = role.position === clamped ? role.position : clamped;
  
        if (finalPosition !== role.position) {
          await role.setPosition(finalPosition, { reason: reason || 'Portal: role hierarchy sync' });
        }
  
        results.push({
          guild_id: gid,
          guild_name: guild.name,
          ok: true,
          created,
          role_id: role.id,
          previous_position: role.position,
          requested_position: desired,
          final_position: finalPosition,
          reference_role: refRole.name,
          reference_position: refRole.position,
          bot_ceiling: botCeiling,
        });
      } catch (e) {
        console.error(`[Role API] position error on ${gid}:`, e.message);
        results.push({ guild_id: gid, ok: false, error: e.message });
      }
    }
  
    res.json({ ok: results.some(r => r.ok), results });
  });
  
  // POST /api/role/permissions
  //   Body: { role_name, remove?: [...], add?: [...], guild_id?,
  //           all_servers?, reason? }
  //
  // Edits the Discord permission bitfield on `role_name` in each
  // targeted guild by clearing any flags in `remove` and setting any in
  // `add`. Flags use discord.js PermissionsBitField flag names
  // (e.g. 'Administrator', 'ManageGuild', 'BanMembers'). Roles the bot
  // can't modify (role above bot's highest, managed roles) are reported
  // with skipped=true so the caller can see exactly which guilds were
  // gated. Non-existent role in a guild → ok:false, role_not_found;
  // we don't auto-create here since permission edits should only ever
  // happen against known, deliberate roles.
  webhookApp.post('/api/role/permissions', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    const { role_name, remove = [], add = [], guild_id, all_servers = false, reason } = req.body || {};
    if (!role_name) return res.status(400).json({ ok: false, error: 'role_name required' });
    if (!Array.isArray(remove) || !Array.isArray(add)) {
      return res.status(400).json({ ok: false, error: 'remove and add must be arrays of permission flag names' });
    }
    if (remove.length === 0 && add.length === 0) {
      return res.status(400).json({ ok: false, error: 'pass at least one flag in remove or add' });
    }
  
    const { PermissionsBitField } = await import('discord.js');
    const FLAGS = PermissionsBitField.Flags;
    // Validate flag names up-front so a typo in the payload doesn't
    // silently result in a no-op across every guild.
    const unknown = [...remove, ...add].filter(f => !(f in FLAGS));
    if (unknown.length) {
      return res.status(400).json({ ok: false, error: `unknown permission flag(s): ${unknown.join(', ')}` });
    }
  
    const targetGuildIds = await resolveTargetGuilds(all_servers, guild_id);
    const results = [];
  
    for (const gid of targetGuildIds) {
      try {
        const guild = client.guilds.cache.get(gid) || await client.guilds.fetch(gid).catch(() => null);
        if (!guild) { results.push({ guild_id: gid, ok: false, error: 'guild_not_cached' }); continue; }
  
        const role = guild.roles.cache.find(r => r.name.toLowerCase() === String(role_name).toLowerCase());
        if (!role) { results.push({ guild_id: gid, guild_name: guild.name, ok: false, error: 'role_not_found' }); continue; }
  
        if (role.managed || role.id === guild.roles.everyone.id) {
          results.push({ guild_id: gid, guild_name: guild.name, ok: false, error: 'role_not_editable', skipped: true });
          continue;
        }
        const me = await guild.members.fetchMe().catch(() => null);
        if (me && role.position >= me.roles.highest.position) {
          results.push({ guild_id: gid, guild_name: guild.name, ok: false, error: 'role_above_bot', skipped: true, role_position: role.position, bot_ceiling: me.roles.highest.position });
          continue;
        }
  
        const beforeBits = role.permissions.bitfield;
        const beforeAdmin = role.permissions.has(FLAGS.Administrator);
        let perms = new PermissionsBitField(role.permissions.bitfield);
        for (const f of remove) perms = perms.remove(FLAGS[f]);
        for (const f of add) perms = perms.add(FLAGS[f]);
        const afterBits = perms.bitfield;
  
        if (afterBits === beforeBits) {
          results.push({
            guild_id: gid, guild_name: guild.name, ok: true, role_id: role.id,
            unchanged: true,
            before_admin: beforeAdmin,
          });
          continue;
        }
  
        await role.setPermissions(perms, reason || 'Portal: permission edit');
        results.push({
          guild_id: gid, guild_name: guild.name, ok: true, role_id: role.id,
          changed: true,
          before_admin: beforeAdmin,
          after_admin: perms.has(FLAGS.Administrator),
          before_bitfield: String(beforeBits),
          after_bitfield: String(afterBits),
        });
      } catch (e) {
        console.error(`[Role API] permissions error on ${gid}:`, e.message);
        results.push({ guild_id: gid, ok: false, error: e.message });
      }
    }
  
    res.json({ ok: results.some(r => r.ok), results });
  });
  
  // POST /api/guild/unban-all
  //   Body: { guild_id, reason?, dry_run? (default false) }
  //   Mirrors the /mass-unban slash command's local-scope path but
  //   scriptable from the portal. Returns per-entry results so the
  //   caller can see exactly who got unbanned.
  webhookApp.post('/api/guild/unban-all', async (req, res) => {
    if (!verifyBotSecret(req, res)) return;
    const { guild_id, reason, dry_run = false } = req.body || {};
    if (!guild_id) return res.status(400).json({ ok: false, error: 'guild_id required' });
    try {
      const guild = client.guilds.cache.get(String(guild_id)) || await client.guilds.fetch(String(guild_id)).catch(() => null);
      if (!guild) return res.status(404).json({ ok: false, error: 'guild not found or bot not a member' });
  
      const bans = await guild.bans.fetch();
      if (bans.size === 0) return res.json({ ok: true, guild_name: guild.name, total: 0, unbanned: 0, failed: 0, entries: [] });
  
      const entries = [];
      let unbanned = 0;
      let failed = 0;
      for (const [userId, banEntry] of bans.entries()) {
        if (dry_run) {
          entries.push({ user_id: userId, tag: banEntry.user?.tag || null, would_unban: true, ban_reason: banEntry.reason || null });
          continue;
        }
        try {
          await guild.bans.remove(userId, reason || 'Portal: mass unban');
          unbanned++;
          entries.push({ user_id: userId, tag: banEntry.user?.tag || null, unbanned: true });
        } catch (e) {
          failed++;
          entries.push({ user_id: userId, tag: banEntry.user?.tag || null, unbanned: false, error: e.message });
        }
      }
  
      res.json({ ok: true, guild_name: guild.name, total: bans.size, unbanned, failed, dry_run, entries });
    } catch (e) {
      console.error('[Guild API] unban-all error:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  
  // Self-destruct watcher needs the express app for the /api/bot/panic route
  setupSelfDestruct(client, webhookApp);
  
  // Bind to loopback ONLY. Every legitimate caller (staff portal, Atlas,
  // aspire-bot) is co-located on this host and reaches us via localhost:3017.
  // Binding 0.0.0.0 exposed all webhook actions — post-to-any-channel,
  // DM-anyone — to anyone who could reach the box's IP with the shared secret.
  webhookApp.listen(3017, '127.0.0.1', () => console.log('[CO Bot] Webhook server listening on 127.0.0.1:3017'));
}
