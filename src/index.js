import express from 'express';
import multer from 'multer';
import { Client, GatewayIntentBits, Collection, REST, Routes, StringSelectMenuBuilder, ActionRowBuilder, ButtonBuilder, EmbedBuilder, Partials } from 'discord.js';
import { config } from 'dotenv';
import { COMMAND_LOG_CHANNEL_ID, MESSAGE_DELETE_LOG_CHANNEL_ID, MESSAGE_EDIT_LOG_CHANNEL_ID, FULL_MESSAGE_LOGS_CHANNEL_ID } from './config.js';
import { getLogChannel, getGlobalLogChannel, getLogChannelsForEvent } from './utils/botDb.js';
import { sendToWatchedUsers } from './utils/logger.js';
import { getUserByDiscordId } from './db.js';
import * as brag from './commands/brag.js';
import * as leave from './commands/leave.js';
import * as staff from './commands/staff.js';
import * as cases from './commands/cases.js';
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
import * as officeSetup from './commands/officeSetup.js';
import * as counting from './commands/counting.js';
import * as forceVerify from './commands/forceVerify.js';
import * as gnick from './commands/gnick.js';
import * as record from './commands/record.js';
import * as poll from './commands/poll.js';
import { handleVoteButton as pollVoteButton } from './commands/poll.js';
import * as scheduleDm from './commands/schedule-dm.js';
import { handleButton as officeButton, handleSelect as officeSelect, handleModal as officeModal, handleWaitingRoomJoin, enforceOfficeRestrictions, getOfficeByChannel, getWaitingRoomOffice, processExpiredKeys, refreshOfficePanels } from './services/officeManager.js';

config();
import { logRoleAction } from './utils/logger.js';

if (!process.env.BOT_WEBHOOK_SECRET) {
  console.error('[FATAL] BOT_WEBHOOK_SECRET is not set. Webhook server will not start.');
  process.exit(1);
}

// Monday-based ISO week key — matches portal getWeekKey() exactly
function getBragWeekKey(ts = Date.now()) {
  const d = new Date(ts);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

const client = new Client({
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildPresences, GatewayIntentBits.GuildInvites, GatewayIntentBits.GuildMessageReactions]
});

client.commands = new Collection();
const commands = [dm, dmExempt, purge, scribe, brag, leave, staff, cases, nid, suspend, unsuspend, investigate, terminate, gban, gunban, infractions, user, botInfo, unban, verify, unverify, authorisationOverride, cooldown, massUnban, logspanel, orglogs, privatelogs, createTicketPanel, ticketPanelSend, deleteTicketPanel, ticketOptions, warn, timeout, kick, serverban, help, inbox, assign, acting, remind, onboard, eliminate, lockdown, automodCmd, stats, officeSetup, counting, forceVerify, gnick, record, poll, scheduleDm];
for (const cmd of commands) {
  client.commands.set(cmd.data.name, cmd);
}

async function setupEmailNotificationChannels(client) {
  try {
    const guild = await client.guilds.fetch('1485422910972760176').catch(() => null);
    if (!guild) { console.error('[Email Channels] Guild not found'); return; }

    let category = guild.channels.cache.find(c => c.name === '📧 Team Inboxes' && c.type === 4);
    if (!category) {
      category = await guild.channels.create({
        name: '📧 Team Inboxes',
        type: 4,
        permissionOverwrites: [{ id: guild.roles.everyone.id, deny: ['ViewChannel'] }],
        reason: 'CO Bot email notification channels'
      });
      console.log('[Email Channels] Created category:', category.id);
    }

    const inboxChannels = [
      { inboxId: 'eob', name: 'eob-inbox' },
      { inboxId: 'bod', name: 'bod-inbox' },
      { inboxId: 'ebod', name: 'ebod-inbox' },
      { inboxId: 'dss', name: 'dss-inbox' },
      { inboxId: 'dmspc', name: 'dmspc-inbox' },
      { inboxId: 'ic', name: 'ic-inbox' },
      { inboxId: 'dgacm', name: 'dgacm-inbox' },
      { inboxId: 'dcos', name: 'dcos-inbox' },
    ];

    const { default: db } = await import('./utils/botDb.js');

    for (const { inboxId, name } of inboxChannels) {
      let ch = guild.channels.cache.find(c => c.name === name && c.parentId === category.id);
      if (!ch) {
        ch = await guild.channels.create({
          name,
          type: 0,
          parent: category.id,
          permissionOverwrites: [{ id: guild.roles.everyone.id, deny: ['ViewChannel'] }],
          reason: `CO Bot inbox notifications — ${inboxId}`
        });
        console.log(`[Email Channels] Created #${name}:`, ch.id);
      }
      db.prepare('INSERT OR REPLACE INTO inbox_channel_map (inbox_id, channel_id) VALUES (?, ?)').run(inboxId, ch.id);
    }

    // email-logs in the log server 1485423682980675729
    const logGuild = await client.guilds.fetch('1485423682980675729').catch(() => null);
    if (logGuild) {
      let logCat = logGuild.channels.cache.find(c => c.name === '📋 System Logs' && c.type === 4);
      let logCh = logGuild.channels.cache.find(c => c.name === 'email-logs');
      if (!logCh) {
        logCh = await logGuild.channels.create({
          name: 'email-logs',
          type: 0,
          parent: logCat?.id || null,
          reason: 'CO Bot email activity log'
        });
        console.log('[Email Channels] Created email-logs:', logCh.id);
      }
      db.prepare('INSERT OR REPLACE INTO inbox_channel_map (inbox_id, channel_id) VALUES (?, ?)').run('__email_log__', logCh.id);
    }

    console.log('[Email Channels] Setup complete');
  } catch (e) {
    console.error('[Email Channels] Setup error:', e.message);
  }
}

client.once('ready', async () => {
  console.log(`[CO Bot] Logged in as ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
  if (process.argv.includes('--register')) {
    try {
      await rest.put(
        Routes.applicationCommands(client.user.id),
        { body: commands.map(c => c.data.toJSON()) }
      );
      console.log('[CO Bot] Slash commands registered.');
    } catch (e) {
      console.error('[CO Bot] Failed to register commands:', e.message);
    }
  }

  // Initialize AutoMod
  automod.init(client);
  console.log('[AutoMod] Initialized');

  // C-05: Re-schedule timed suspensions and bans on startup
  const { default: db, getActiveSuspension, liftSuspension, getActiveGlobalBan } = await import('./utils/botDb.js');
  const { unsuspendAcrossGuilds } = await import('./utils/roleManager.js');
  const { EmbedBuilder } = await import('discord.js');

  // Suspensions
  const activeSuspensions = db.prepare("SELECT * FROM suspensions WHERE expires_at IS NOT NULL AND active = 1").all();
  for (const sus of activeSuspensions) {
    const expiresAt = new Date(sus.expires_at).getTime();
    if (expiresAt > Date.now()) {
      const remaining = expiresAt - Date.now();
      console.log('[C-05] Scheduling suspension lift for', sus.discord_id, 'in', Math.round(remaining / 1000 / 60), 'mins');
      setTimeout(async () => {
        try {
          await unsuspendAcrossGuilds(client, sus.discord_id);
          liftSuspension(sus.discord_id);
          const user = await client.users.fetch(sus.discord_id).catch(() => null);
          if (user) await user.send({ embeds: [new EmbedBuilder().setTitle('✅ Suspension Lifted').setColor(0x22C55E).setDescription('Your suspension from **Community Organisation** has ended and your roles have been restored.').setFooter({ text: 'Community Organisation | Staff Assistant' }).setTimestamp()] }).catch(() => {});
          const { logAction } = await import('./utils/logger.js');
          await logAction(client, { action: '✅ Suspension Lifted (Auto)', moderator: { discordId: 'SYSTEM', name: 'Automated' }, target: { discordId: sus.discord_id, name: sus.discord_id }, reason: 'Suspension duration expired', color: 0x22C55E });
        } catch (e) { console.error('[C-05 suspension lift error]', e.message); }
      }, remaining);
    } else {
      await unsuspendAcrossGuilds(client, sus.discord_id);
      liftSuspension(sus.discord_id);
    }
  }

  // Bans
  const activeBans = db.prepare("SELECT * FROM banned_users WHERE unban_at IS NOT NULL AND active = 1").all();
  for (const ban of activeBans) {
    const unbanAt = new Date(ban.unban_at).getTime();
    if (unbanAt > Date.now()) {
      const remaining = unbanAt - Date.now();
      console.log('[C-05] Scheduling ban lift for', ban.discord_id, 'in', Math.round(remaining / 1000 / 60), 'mins');
      setTimeout(async () => {
        try {
          
          for (const gid of ALL_SERVER_IDS) {
            const g = await client.guilds.fetch(gid).catch(() => null);
            if (g) await g.members.unban(ban.discord_id, 'Temporary ban expired').catch(() => {});
          }
          db.prepare("DELETE FROM banned_users WHERE discord_id = ? AND unban_at IS NOT NULL").run(ban.discord_id);
          const { logAction } = await import('./utils/logger.js');
          await logAction(client, { action: '✅ Temp Ban Expired — Auto Unbanned', moderator: { discordId: 'SYSTEM', name: 'Auto (Duration Expired)' }, target: { discordId: ban.discord_id, name: ban.discord_id }, reason: 'Temp ban expired', color: 0x22c55e });
        } catch (e) { console.error('[C-05 ban lift error]', e.message); }
      }, remaining);
    }
  }

  // Safety net: run every 60 seconds
  setInterval(async () => {
    try {
      const now = Date.now();
      const expiredSuspensions = db.prepare("SELECT * FROM suspensions WHERE expires_at IS NOT NULL AND active = 1 AND expires_at <= ?").all(new Date(now).toISOString());
      for (const sus of expiredSuspensions) {
        await unsuspendAcrossGuilds(client, sus.discord_id);
        liftSuspension(sus.discord_id);
        const user = await client.users.fetch(sus.discord_id).catch(() => null);
        if (user) await user.send({ embeds: [new EmbedBuilder().setTitle('✅ Suspension Lifted').setColor(0x22C55E).setDescription('Your suspension has ended.').setFooter({ text: 'Community Organisation | Staff Assistant' }).setTimestamp()] }).catch(() => {});
      }
      const expiredBans = db.prepare("SELECT * FROM banned_users WHERE unban_at IS NOT NULL AND active = 1 AND unban_at <= ?").all(new Date(now).toISOString());
      for (const ban of expiredBans) {
        
        for (const gid of ALL_SERVER_IDS) {
          const g = await client.guilds.fetch(gid).catch(() => null);
          if (g) await g.members.unban(ban.discord_id, 'Temporary ban expired').catch(() => {});
        }
        db.prepare("DELETE FROM banned_users WHERE discord_id = ? AND unban_at IS NOT NULL").run(ban.discord_id);
      }
      if (expiredSuspensions.length > 0 || expiredBans.length > 0) {
        console.log('[C-05 safety net] Processed', expiredSuspensions.length, 'suspensions and', expiredBans.length, 'bans');
      }
    } catch (e) { console.error('[C-05 safety net error]', e.message); }
  }, 60000);

  await setupEmailNotificationChannels(client);

  // Email polling — team inboxes every 60s
  setInterval(async () => {
    try {
      const { pollAllInboxes } = await import('./services/emailPoller.js');
      await pollAllInboxes(client);
    } catch (e) { console.error('[Email Poller]', e.message); }
  }, 60_000);
  console.log('[Email Poller] Started — polling every 60 seconds');

  // Personal email polling — per-user inboxes every 60s
  setInterval(async () => {
    try {
      const { pollPersonalInboxes } = await import('./services/emailPoller.js');
      await pollPersonalInboxes(client);
    } catch (e) { console.error('[Personal Email Poller]', e.message); }
  }, 60_000);
  console.log('[Personal Email Poller] Started');

  // Assignment overdue checker — every 30 minutes
  setInterval(async () => {
    try {
      const { getPendingOverdueAssignments, updateAssignment: updateAssign, getAssignment: getAssign } = await import('./utils/botDb.js');
      const { getUserByDiscordId: getUser } = await import('./db.js');
      const { logAction: overdueLog } = await import('./utils/logger.js');
      const { buildAssignmentEmbed } = await import('./commands/assign.js');

      const overdue = getPendingOverdueAssignments();
      for (const a of overdue) {
        const now = new Date();
        const dueDate = new Date(a.due_date);
        const hoursOverdue = (now - dueDate) / 3600000;

        // First notification (just went overdue, not yet notified)
        if (!a.overdue_notified) {
          updateAssign(a.id, { overdue_notified: 1, status: 'overdue' });

          // Update portal status
          if (a.portal_assignment_id) {
            try {
              const { default: fetch } = await import('node-fetch');
              await fetch(`http://localhost:3016/api/assignments/${a.portal_assignment_id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET },
                body: JSON.stringify({ status: 'overdue' })
              });
            } catch {}
          }

          // Update embed to red/overdue
          try {
            if (a.channel_id && a.message_id) {
              const channel = await client.channels.fetch(a.channel_id);
              const msg = await channel.messages.fetch(a.message_id);
              const updated = getAssign(a.id);
              const embed = buildAssignmentEmbed(updated, null, null, { assignmentNumber: `ASN-${a.id}` });
              await msg.edit({ embeds: [embed] });
            }
          } catch {}

          // DM assigned person
          try {
            const assignee = await client.users.fetch(a.assigned_to);
            await assignee.send({ embeds: [new EmbedBuilder()
              .setTitle('⚠️ OVERDUE TASK')
              .setColor(0xEF4444)
              .setDescription(`Your assignment **"${a.title}"** was due ${Math.round(hoursOverdue)} hour(s) ago and has not been marked complete.\n\nPlease complete it immediately or request an extension via the portal.`)
              .setFooter({ text: `ASN-${a.id} | Community Organisation` })
              .setTimestamp()
            ]});
          } catch {}

          // DM assigner
          try {
            const assigner = await client.users.fetch(a.assigned_by);
            const assigneeName = getUser(a.assigned_to)?.display_name || a.assigned_to;
            await assigner.send({ content: `⚠️ **OVERDUE TASK** — "${a.title}" assigned to **${assigneeName}** is now overdue. They have been notified.` });
          } catch {}
        }

        // 24+ hours overdue — raise case
        if (hoursOverdue >= 24 && !a.case_raised) {
          updateAssign(a.id, { case_raised: 1 });

          const assigneePortal = getUser(a.assigned_to);
          const assignerPortal = getUser(a.assigned_by);
          const assigneeName = assigneePortal?.display_name || a.assigned_to;

          // Raise case via portal API
          try {
            const { default: fetch } = await import('node-fetch');
            const resp = await fetch('http://localhost:3016/api/assignments/auto-case', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET },
              body: JSON.stringify({
                assignment_id: a.portal_assignment_id || a.id,
                bot_assignment_id: a.id,
                assigned_to_name: assigneeName,
                assigned_to_portal_id: assigneePortal?.id,
                assigned_by_portal_id: assignerPortal?.id,
                title: a.title,
                due_date: a.due_date,
                hours_overdue: Math.round(hoursOverdue),
              })
            });
            const data = await resp.json();

            if (data.case_number) {
              // Update embed with case number
              try {
                if (a.channel_id && a.message_id) {
                  const channel = await client.channels.fetch(a.channel_id);
                  const msg = await channel.messages.fetch(a.message_id);
                  const updated = getAssign(a.id);
                  const embed = buildAssignmentEmbed(updated, null, null, { assignmentNumber: `ASN-${a.id}`, caseNumber: data.case_number });
                  await msg.edit({ embeds: [embed] });
                }
              } catch {}

              // DM both parties
              try {
                const assignee = await client.users.fetch(a.assigned_to);
                await assignee.send({ content: `📋 **Case raised:** ${data.case_number} — Your assignment "${a.title}" is 24+ hours overdue. A case has been raised with DMSPC.` });
              } catch {}
              try {
                const assigner = await client.users.fetch(a.assigned_by);
                await assigner.send({ content: `📋 **Case raised:** ${data.case_number} — Assignment "${a.title}" assigned to ${assigneeName} is 24+ hours overdue.` });
              } catch {}
            }
          } catch (e) { console.error('[assign overdue] case raise error:', e.message); }

          // Second escalation DM
          try {
            const assignee = await client.users.fetch(a.assigned_to);
            await assignee.send({ embeds: [new EmbedBuilder()
              .setTitle('🔴 ESCALATION — 24+ Hours Overdue')
              .setColor(0xEF4444)
              .setDescription(`Your assignment **"${a.title}"** is now **${Math.round(hoursOverdue)} hours overdue**. A case has been raised and this may affect your BRAG tasks grade.`)
              .setFooter({ text: `ASN-${a.id} | Community Organisation` })
              .setTimestamp()
            ]});
          } catch {}
        }
      }
      if (overdue.length > 0) console.log(`[Assignments] Checked ${overdue.length} overdue assignments`);
    } catch (e) { console.error('[Assignment Overdue Check]', e.message); }
  }, 1800000); // 30 minutes
  console.log('[Assignment Overdue Check] Started — checking every 30 minutes');

  // Leave role crons
  // Midnight (00:00) — process leave starts and ends
  function scheduleAtTime(hour, min, fn, label) {
    const now = new Date();
    let next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, min, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = next - now;
    setTimeout(() => {
      fn();
      setInterval(fn, 86400000); // repeat daily
    }, delay);
    console.log(`[${label}] Scheduled — next run in ${Math.round(delay / 60000)}m`);
  }

  scheduleAtTime(0, 0, async () => {
    try {
      const { processLeaveRoles } = await import('./services/leaveRoles.js');
      await processLeaveRoles(client);
    } catch (e) { console.error('[Leave Cron Midnight]', e.message); }
  }, 'Leave Midnight Cron');

  // 9AM — acting nomination requests
  scheduleAtTime(9, 0, async () => {
    try {
      const { sendActingNominationRequests } = await import('./services/leaveRoles.js');
      await sendActingNominationRequests(client);
    } catch (e) { console.error('[Acting Nomination Cron]', e.message); }
  }, 'Acting Nomination Cron');

  // Process any pending acting assignments at midnight — apply roles but don't create duplicate DB records
  scheduleAtTime(0, 1, async () => {
    try {
      const { db } = await import('./utils/botDb.js');
      const { POSITIONS } = await import('./utils/positions.js');
      const pending = db.prepare("SELECT * FROM acting_assignments WHERE status = 'pending'").all();
      for (const a of pending) {
        // Check if there's already an active assignment for this person+position
        const existing = db.prepare("SELECT id FROM acting_assignments WHERE acting_discord_id = ? AND position = ? AND status = 'active'").get(a.acting_discord_id, a.position);
        if (existing) {
          console.log(`[Acting Midnight] ${a.acting_discord_id} already active as ${a.position} — skipping`);
          db.prepare("UPDATE acting_assignments SET status = 'ended', ended_at = datetime('now') WHERE id = ?").run(a.id);
          continue;
        }

        // Apply roles directly without creating a new DB record
        const positionRoles = POSITIONS[a.position] || [];
        const rolesApplied = {};
        for (const [guildId, guild] of client.guilds.cache) {
          try {
            const member = await guild.members.fetch(a.acting_discord_id).catch(() => null);
            if (!member) continue;
            const addedIds = [];
            for (const roleName of positionRoles) {
              const role = guild.roles.cache.find(r => r.name === roleName);
              if (role && !member.roles.cache.has(role.id)) {
                await member.roles.add(role).catch(() => {});
                addedIds.push(role.id);
              }
            }
            const shortPos = a.position.split('(')[0].split(',')[0].trim();
            const baseName = (member.nickname || member.user.username).replace(/ \(Acting.*\)$/, '');
            await member.setNickname((baseName + ` (Acting ${shortPos})`).slice(0, 32)).catch(() => {});
            if (addedIds.length) rolesApplied[guildId] = addedIds;
          } catch {}
        }
        db.prepare("UPDATE acting_assignments SET status = 'active', started_at = datetime('now'), roles_applied = ? WHERE id = ?")
          .run(JSON.stringify(rolesApplied), a.id);
        console.log(`[Acting Midnight] Activated ${a.acting_discord_id} as ${a.position}`);
      }
      if (pending.length) console.log(`[Acting Midnight] Processed ${pending.length} pending assignments`);
    } catch (e) { console.error('[Acting Midnight]', e.message); }
  }, 'Acting Midnight Cron');

  // Sunday 10AM — Activity points reminder (replaces BRAG reminder)
  function scheduleSundayCron() {
    const now = new Date();
    let next = new Date(now);
    // Find next Sunday
    const daysUntilSunday = (7 - now.getDay()) % 7;
    next.setDate(now.getDate() + (daysUntilSunday === 0 && now.getHours() >= 10 ? 7 : daysUntilSunday));
    next.setHours(10, 0, 0, 0);
    const delay = next - now;
    setTimeout(async () => {
      await sendBragReminders();
      setInterval(sendBragReminders, 7 * 86400000);
    }, delay);
    console.log(`[BRAG Reminder] Scheduled — next Sunday 10AM in ${Math.round(delay / 60000)}m`);
  }

  async function sendBragReminders() {
    try {
      const Database = (await import('better-sqlite3')).default;
      const portalDb = new Database(process.env.PORTAL_DB_PATH, { readonly: true });

      const d = new Date();
      const day = d.getDay();
      const diff = (day === 0 ? -6 : 1) - day;
      d.setDate(d.getDate() + diff);
      d.setHours(0, 0, 0, 0);
      const weekKey = d.toISOString().slice(0, 10);

      const notSubmitted = portalDb.prepare(
        `SELECT u.discord_id, u.display_name, u.full_name
         FROM users u
         LEFT JOIN brag_reports br ON br.user_id = u.id AND br.week_key = ?
         WHERE lower(u.account_status) = 'active'
           AND u.discord_id IS NOT NULL AND u.discord_id != ''
           AND br.id IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM performance_adjustments pa
             WHERE pa.user_id = u.id AND pa.adjustment_type = 'full_brag_exemption'
               AND lower(pa.status) = 'approved'
               AND (pa.expires_at IS NULL OR pa.expires_at > strftime('%s','now') * 1000)
           )`
      ).all(weekKey);

      console.log(`[BRAG Reminder] Sending to ${notSubmitted.length} staff`);

      for (const staff of notSubmitted) {
        try {
          const user = await client.users.fetch(staff.discord_id);
          await user.send({ embeds: [new EmbedBuilder()
            .setColor(0xF59E0B)
            .setTitle('⏰ BRAG Report Due Today')
            .setDescription(`Hi ${staff.display_name || staff.full_name}!\n\nYour weekly BRAG self-assessment is due by **12PM today (Sunday)**.\n\nFailure to submit will result in an automatic **Black** rating for Tasks and Contact this week per policy §3.2.`)
            .addFields({ name: 'Submit via', value: '[portal.communityorg.co.uk](https://portal.communityorg.co.uk/performance?tab=brag)', inline: false })
            .setFooter({ text: 'Community Organisation | BRAG System' })
            .setTimestamp()
          ]});
          await new Promise(r => setTimeout(r, 500));
        } catch (e) {
          console.error(`[BRAG Reminder] Failed for ${staff.discord_id}:`, e.message);
        }
      }

      portalDb.close();
      console.log(`[BRAG Reminder] Complete — sent to ${notSubmitted.length} staff`);
    } catch (e) {
      console.error('[BRAG Reminder]', e.message);
    }
  }

  scheduleSundayCron();

  // ========== ACTIVITY POINTS SYNC (replaces BRAG sync) ==========
  const ACTIVITY_LOG_CH = '1487643487460659280';

  // In-memory tracking sets
  const dailyActiveUsers = new Set();
  const voiceSessions = new Map(); // discord_id → { channel_id, channel_name, joined_at }
  const meetingAttendance = new Map(); // discord_id → { channel_name, joined_at }
  const weeklyReactions = new Map(); // discord_id (author) → count
  const welcomeTracker = new Map(); // discord_id → count this week

  // Staff cache — refreshed every 30 minutes
  let staffCache = new Map(); // discord_id → { id, display_name, position }
  async function refreshStaffCache() {
    try {
      const res = await fetch('http://localhost:3016/api/staff?limit=500', {
        headers: { 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET }
      });
      const data = await res.json();
      const list = data.staff || data.data || [];
      const m = new Map();
      for (const s of list) { if (s.discord_id) m.set(String(s.discord_id), s); }
      staffCache = m;
      console.log(`[Activity] Staff cache refreshed: ${m.size} members`);
    } catch (e) { console.error('[Activity] Staff cache refresh failed:', e.message); }
  }
  await refreshStaffCache();
  setInterval(refreshStaffCache, 30 * 60 * 1000);

  // Sync message counts to activity points portal — every 60 seconds
  async function syncActivityMessages() {
    try {
      const { db: botDatabase } = await import('./utils/botDb.js');
      const weekKey = getBragWeekKey();

      const counts = botDatabase.prepare(`
        SELECT discord_id, SUM(message_count) as total_count, SUM(last_synced_count) as total_synced
        FROM brag_message_counts WHERE week_key = ?
        GROUP BY discord_id HAVING SUM(message_count) > SUM(last_synced_count)
      `).all(weekKey);

      if (counts.length === 0) return;

      const records = [];
      for (const row of counts) {
        const delta = row.total_count - row.total_synced;
        if (delta > 0) records.push({ discord_id: row.discord_id, category: 'messages', points: row.total_count });
      }

      // Also sync welcome points
      for (const [discordId, count] of welcomeTracker) {
        if (count > 0) records.push({ discord_id: discordId, category: 'welcome', points: count * 3 });
      }

      if (records.length === 0) return;

      const res = await fetch('http://localhost:3016/api/activity/sync/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET },
        body: JSON.stringify({ weekKey, records })
      });
      const data = await res.json();
      console.log(`[Activity Sync] ${data.synced} synced, ${data.skipped} skipped for week ${weekKey}`);

      botDatabase.prepare('UPDATE brag_message_counts SET last_synced_count = message_count WHERE week_key = ?').run(weekKey);
    } catch (e) {
      console.error('[Activity Sync] Failed:', e.message);
    }
  }

  await syncActivityMessages();
  setInterval(syncActivityMessages, 60 * 1000);
  console.log('[Activity Sync] Started — syncing to portal every 60 seconds');

  // Daily activity + availability sync — 23:30 every day
  function scheduleDailyActivitySync() {
    const now = new Date();
    let next = new Date(now);
    next.setHours(23, 30, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = next - now;
    setTimeout(async () => {
      await syncDailyActivity();
      setInterval(syncDailyActivity, 24 * 60 * 60 * 1000);
    }, delay);
    console.log(`[Activity] Daily sync scheduled in ${Math.round(delay / 60000)}m`);
  }

  async function syncDailyActivity() {
    try {
      const weekKey = getBragWeekKey();
      const records = [];

      for (const discordId of dailyActiveUsers) {
        if (!staffCache.has(discordId)) continue;
        records.push({ discord_id: discordId, category: 'daily_activity', points: 5 });
      }

      // Check availability via presence for active users
      const STAFF_HQ = '1357119461957570570';
      const guild = client.guilds.cache.get(STAFF_HQ);
      if (guild) {
        for (const discordId of dailyActiveUsers) {
          if (!staffCache.has(discordId)) continue;
          try {
            const member = guild.members.cache.get(discordId);
            const status = member?.presence?.status;
            if (status && status !== 'offline') {
              records.push({ discord_id: discordId, category: 'available', points: 5 });
            }
          } catch {}
        }
      }

      if (records.length > 0) {
        const res = await fetch('http://localhost:3016/api/activity/sync/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET },
          body: JSON.stringify({ weekKey, records })
        });
        const data = await res.json();
        console.log(`[Activity Daily] Synced ${data.synced} daily activity records`);
      }

      dailyActiveUsers.clear();
    } catch (e) {
      console.error('[Activity Daily] Sync failed:', e.message);
    }
  }

  scheduleDailyActivitySync();

  // Weekly bonus — Sunday 23:55
  function scheduleWeeklyBonus() {
    const now = new Date();
    let next = new Date(now);
    const daysUntilSunday = (7 - now.getDay()) % 7;
    next.setDate(now.getDate() + (daysUntilSunday === 0 && (now.getHours() > 23 || (now.getHours() === 23 && now.getMinutes() >= 55)) ? 7 : daysUntilSunday));
    next.setHours(23, 55, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 7);
    const delay = next - now;
    setTimeout(async () => {
      await checkWeeklyBonus();
      setInterval(checkWeeklyBonus, 7 * 24 * 60 * 60 * 1000);
    }, delay);
    console.log(`[Activity] Weekly bonus scheduled in ${Math.round(delay / 60000)}m`);
  }

  async function checkWeeklyBonus() {
    try {
      const weekKey = getBragWeekKey();
      const res = await fetch(`http://localhost:3016/api/activity/weekly-activity-check?weekKey=${weekKey}`, {
        headers: { 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET }
      });
      const data = await res.json();
      if (!data.discord_ids?.length) { console.log('[Activity] Weekly bonus: no users qualified'); return; }

      const records = data.discord_ids.map(id => ({ discord_id: id, category: 'weekly_bonus', points: 30 }));
      await fetch('http://localhost:3016/api/activity/sync/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET },
        body: JSON.stringify({ weekKey, records })
      });
      console.log(`[Activity] Weekly bonus awarded to ${data.discord_ids.length} users`);
    } catch (e) {
      console.error('[Activity] Weekly bonus failed:', e.message);
    }
  }

  scheduleWeeklyBonus();

  // Tuesday 09:00 — weekly awards
  function scheduleTuesdayAwards() {
    const now = new Date();
    let next = new Date(now);
    const daysUntilTuesday = (2 - now.getDay() + 7) % 7 || 7;
    next.setDate(now.getDate() + (now.getDay() === 2 && now.getHours() < 9 ? 0 : daysUntilTuesday));
    next.setHours(9, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 7);
    const delay = next - now;
    setTimeout(async () => {
      await processWeeklyAwards();
      setInterval(processWeeklyAwards, 7 * 24 * 60 * 60 * 1000);
    }, delay);
    console.log(`[Activity] Tuesday awards scheduled in ${Math.round(delay / 60000)}m`);
  }

  const AWARDS_CHANNEL = '1366851210933567508';

  async function processWeeklyAwards() {
    try {
      const prevWeekKey = getBragWeekKey(Date.now() - 7 * 86400000);
      const res = await fetch(`http://localhost:3016/api/activity/awards/calculate?weekKey=${prevWeekKey}`, {
        headers: { 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET }
      });
      const data = await res.json();
      if (!data.awards?.length) { console.log('[Awards] No awards this week'); return; }

      const fields = [];
      for (const award of data.awards) {
        for (const winner of award.winners) {
          // Award shop points
          await fetch('http://localhost:3016/api/activity/shop/award', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET },
            body: JSON.stringify({ discord_id: winner.discord_id, points: award.award_points, award_name: award.award_name, week_key: prevWeekKey })
          }).catch(e => console.error('[Awards] Shop award failed:', e.message));

          // DM winner with rich embed
          try {
            const user = await client.users.fetch(winner.discord_id);
            const achievementMap = {
              'Most Messages Sent': `You sent the most messages this week with **${winner.value}** points worth.`,
              'Most Hours in Voice Channels': `You spent the most time in voice channels this week — **${winner.value}** pts worth.`,
              'Most Tasks Completed': `You completed the most tasks this week with **${winner.value}** approved claims.`,
              'Longest Single Voice Session': `Your longest voice session was **${winner.value}** minutes.`,
              'Biggest Improvement': `Your points improved by **${winner.value}** from last week.`,
              'Most Event Participation': `You spent **${winner.value}** minutes in meeting channels this week.`,
              'Highest Quality Score': `Your quality score was **${winner.value}** points from tasks and feedback.`,
            };
            const achievementText = achievementMap[award.award_name] || `Your achievement value: **${winner.value}**.`;
            await user.send({ embeds: [new EmbedBuilder()
              .setColor(0xC9A84C)
              .setTitle('🏆 Weekly Award')
              .setDescription(`Congratulations **${winner.display_name}**! You have won this week's **${award.award_name}** award.`)
              .addFields(
                { name: 'Award', value: award.award_name, inline: true },
                { name: 'Shop Points Earned', value: `**+${award.award_points} pts**`, inline: true },
                { name: 'Your Achievement', value: achievementText, inline: false },
              )
              .setFooter({ text: 'Shop opens on the 30th of each month. Visit the portal to browse perks.' })
              .setTimestamp()
            ]});
          } catch {}
          await new Promise(r => setTimeout(r, 300));
        }
        const winnerNames = award.winners.map(w => w.display_name).join(', ');
        fields.push({ name: award.award_name, value: `${winnerNames} — ${award.winners[0]?.value || 0} — ${award.award_points} pts awarded`, inline: false });
      }

      // Summary embed
      try {
        const ch = await client.channels.fetch(AWARDS_CHANNEL);
        await ch.send({ embeds: [new EmbedBuilder()
          .setColor(0xC9A84C)
          .setTitle(`🏆 CO Weekly Awards — Week of ${prevWeekKey}`)
          .addFields(fields.slice(0, 25))
          .setFooter({ text: 'Points added to monthly shop balances. Shop opens on the 30th.' })
          .setTimestamp()
        ]});
      } catch (e) { console.error('[Awards] Summary post failed:', e.message); }

      console.log(`[Awards] Processed ${data.awards.length} award categories for week ${prevWeekKey}`);
    } catch (e) {
      console.error('[Awards] Processing failed:', e.message);
    }
  }

  scheduleTuesdayAwards();

  // Monday 00:05 — grade DMs (after Sunday 23:59 grade calc)
  function scheduleMondayGradeDMs() {
    const now = new Date();
    let next = new Date(now);
    const daysUntilMonday = (1 - now.getDay() + 7) % 7 || 7;
    next.setDate(now.getDate() + (now.getDay() === 1 && now.getHours() === 0 && now.getMinutes() < 5 ? 0 : daysUntilMonday));
    next.setHours(0, 5, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 7);
    const delay = next - now;
    setTimeout(async () => {
      await sendGradeDMs();
      setInterval(sendGradeDMs, 7 * 24 * 60 * 60 * 1000);
    }, delay);
    console.log(`[Activity] Monday grade DMs scheduled in ${Math.round(delay / 60000)}m`);
  }

  const GRADE_COLOURS = { green: 0x1A6B3C, amber: 0xC9A84C, red: 0x8B1A1A, black: 0x2C2C2C, exempt: 0x3498DB };
  const GRADE_EMOJIS = { green: '🟢', amber: '🟡', red: '🔴', black: '⚫', exempt: '🔵' };
  const GRADE_MESSAGES = {
    green: 'Well done — you hit your Green target this week.',
    amber: "Close — you were within range but didn't reach Green.",
    red: 'You fell significantly short of your target this week.',
    black: 'No qualifying activity was recorded this week.',
    exempt: 'You are exempt from activity requirements this week.',
  };
  const CAT_ICONS = {
    messages: '💬', welcome: '👋', daily_activity: '✅', available: '🟢',
    meeting: '🏛️', weekly_bonus: '⭐', voice: '🎙️', task_small: '📋',
    task_medium: '📁', task_large: '🗂️', co_work: '⚙️', user_satisfaction: '😊',
    feedback: '💬', suggestion: '💡', bug_report: '🐛', deduction: '⚠️',
  };
  const CAT_LABELS = {
    messages: 'Messages', welcome: 'Welcome', daily_activity: 'Daily Activity', available: 'Available',
    meeting: 'Meeting', weekly_bonus: 'Weekly Bonus', voice: 'Voice Channel', task_small: 'Small Task',
    task_medium: 'Medium Task', task_large: 'Large Task', co_work: 'CO Work', user_satisfaction: 'User Satisfaction',
    feedback: 'Feedback', suggestion: 'Suggestion', bug_report: 'Bug Report',
  };

  async function sendGradeDMs() {
    try {
      const prevWeekKey = getBragWeekKey(Date.now() - 7 * 86400000);
      const res = await fetch(`http://localhost:3016/api/activity/grades/week-bot/${prevWeekKey}`, {
        headers: { 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET }
      });
      const data = await res.json();
      if (!data.grades?.length) return;

      let sent = 0;

      for (const g of data.grades) {
        if (!g.discord_id || g.grade === 'exempt') continue;
        try {
          const user = await client.users.fetch(g.discord_id);
          const grade = g.grade || 'black';
          const emoji = GRADE_EMOJIS[grade] || '⚫';

          // Fetch breakdown for this user
          let breakdownText = 'No activity recorded this week.';
          try {
            const bRes = await fetch(`http://localhost:3016/api/activity/grades/week-bot/${prevWeekKey}`, {
              headers: { 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET }
            });
            // We already have the data — use activity_point_records breakdown via a separate call if needed
            // For now build from what we have
          } catch {}
          // Simple breakdown placeholder — the portal doesn't return per-category in grades/week-bot
          breakdownText = `Total: **${g.total_points}** pts across **${g.categories_met}** categories.`;

          const fields = [
            { name: 'Grade', value: `**${grade.toUpperCase()}**`, inline: true },
            { name: 'Total Points', value: `**${g.total_points}** / ${g.green_target} pts`, inline: true },
            { name: 'Categories Met', value: `${g.categories_met} / 3`, inline: true },
            { name: '📊 Breakdown', value: breakdownText, inline: false },
          ];

          if (grade === 'black' || grade === 'red') {
            fields.push({ name: '⚠️ Action Required', value: 'Please contact your supervisor or DMSPC if you have questions about this grade.', inline: false });
          }

          const embed = new EmbedBuilder()
            .setTitle(`${emoji} Your Weekly Grade — ${prevWeekKey}`)
            .setDescription(GRADE_MESSAGES[grade] || '')
            .setColor(GRADE_COLOURS[grade] || 0x2C2C2C)
            .addFields(fields)
            .setFooter({ text: grade === 'green' ? 'Keep it up! Shop opens on the 30th.' : 'Visit the portal to review your activity and submit any outstanding claims.' })
            .setTimestamp();

          await user.send({ embeds: [embed] });
          sent++;
          await new Promise(r => setTimeout(r, 400));
        } catch {}
      }
      console.log(`[Activity] Grade DMs sent to ${sent} users for week ${prevWeekKey}`);
    } catch (e) {
      console.error('[Activity] Grade DMs failed:', e.message);
    }
  }

  scheduleMondayGradeDMs();

  // Message count leaderboard — edits same embed, new one each Monday
  const LEADERBOARD_CH = '1487667463129661471';

  async function postMessageLeaderboard() {
    try {
      const { db: cfgDb } = await import('./utils/botDb.js');
      const portalDb = (await import('./db.js')).default;
      const weekKey = getBragWeekKey();

      const rows = portalDb.prepare(`
        SELECT br.discord_id, br.message_count as total, u.display_name, u.full_name, u.position
        FROM brag_records br
        INNER JOIN users u ON u.discord_id = br.discord_id AND lower(u.account_status) = 'active'
        WHERE br.week_key = ? AND br.message_count > 0
        ORDER BY br.message_count DESC
        LIMIT 20
      `).all(weekKey);

      if (rows.length === 0) return;

      const totalStaff = portalDb.prepare("SELECT COUNT(*) as c FROM users WHERE lower(account_status) = 'active' AND discord_id IS NOT NULL AND discord_id != ''").get();
      const totalAll = rows.reduce((s, r) => s + r.total, 0);
      const lines = rows.map((r, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
        const name = r.display_name || r.full_name || `<@${r.discord_id}>`;
        return `${medal} ${name} — **${r.total}** messages`;
      });

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('📊 Staff Message Leaderboard')
        .setDescription(lines.join('\n'))
        .addFields(
          { name: 'Week', value: weekKey, inline: true },
          { name: 'Total Staff Messages', value: String(totalAll), inline: true },
          { name: 'Active Staff', value: `${rows.length}/${totalStaff?.c || '?'} tracked`, inline: true },
        )
        .setFooter({ text: 'Staff only | Resets every Monday | Updates every 5 minutes' })
        .setTimestamp();

      const ch = await client.channels.fetch(LEADERBOARD_CH).catch(() => null);
      if (!ch) return;

      // Check if we already have a message for this week
      const stored = cfgDb.prepare("SELECT value FROM bot_config WHERE key = ?").get('leaderboard_msg_' + weekKey);

      if (stored) {
        // Edit existing message
        try {
          const msg = await ch.messages.fetch(stored.value);
          await msg.edit({ embeds: [embed] });
          console.log('[Leaderboard] Updated for week ' + weekKey);
          return;
        } catch (e) {
          // Message deleted or not found — create new one
        }
      }

      // Create new message for this week
      const msg = await ch.send({ embeds: [embed] });
      cfgDb.prepare("INSERT OR REPLACE INTO bot_config (key, value) VALUES (?, ?)").run('leaderboard_msg_' + weekKey, msg.id);
      console.log('[Leaderboard] Created new for week ' + weekKey);
    } catch (e) {
      console.error('[Leaderboard] Failed:', e.message);
    }
  }

  // ── Voice Channel Leaderboard ──
  async function postVoiceLeaderboard() {
    try {
      const { db: cfgDb, getVoiceLeaderboard, flushActiveSessions } = await import('./utils/botDb.js');
      const portalDb = (await import('./db.js')).default;
      const weekKey = getBragWeekKey();

      // Flush active sessions so totals are current
      flushActiveSessions(weekKey);

      const rows = getVoiceLeaderboard(weekKey);
      if (rows.length === 0) return;

      // Enrich with portal display names
      const enriched = rows.map(r => {
        const user = portalDb.prepare("SELECT display_name, full_name, position FROM users WHERE discord_id = ? AND lower(account_status) = 'active'").get(r.discord_id);
        return { ...r, name: user?.display_name || user?.full_name || `<@${r.discord_id}>`, position: user?.position };
      }).filter(r => r.name);

      if (enriched.length === 0) return;

      function fmtTime(secs) {
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        if (h > 0) return `${h}h ${m}m`;
        return `${m}m`;
      }

      const totalSecs = enriched.reduce((s, r) => s + r.total_seconds, 0);
      const lines = enriched.map((r, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
        return `${medal} ${r.name} — **${fmtTime(r.total_seconds)}**`;
      });

      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle('🎙️ Staff Voice Channel Leaderboard')
        .setDescription(lines.join('\n'))
        .addFields(
          { name: 'Week', value: weekKey, inline: true },
          { name: 'Total VC Time', value: fmtTime(totalSecs), inline: true },
          { name: 'Participants', value: String(enriched.length), inline: true },
        )
        .setFooter({ text: 'Staff only | Resets every Monday | Updates every 5 minutes' })
        .setTimestamp();

      const ch = await client.channels.fetch(LEADERBOARD_CH).catch(() => null);
      if (!ch) return;

      const stored = cfgDb.prepare("SELECT value FROM bot_config WHERE key = ?").get('vc_leaderboard_msg_' + weekKey);

      if (stored) {
        try {
          const msg = await ch.messages.fetch(stored.value);
          await msg.edit({ embeds: [embed] });
          console.log('[VC Leaderboard] Updated for week ' + weekKey);
          return;
        } catch {}
      }

      const msg = await ch.send({ embeds: [embed] });
      cfgDb.prepare("INSERT OR REPLACE INTO bot_config (key, value) VALUES (?, ?)").run('vc_leaderboard_msg_' + weekKey, msg.id);
      console.log('[VC Leaderboard] Created new for week ' + weekKey);
    } catch (e) {
      console.error('[VC Leaderboard] Failed:', e.message);
    }
  }

  // ── Commands Used Leaderboard ──
  async function postCommandLeaderboard() {
    try {
      const { db: cfgDb, getCommandLeaderboard } = await import('./utils/botDb.js');
      const portalDb = (await import('./db.js')).default;
      const weekKey = getBragWeekKey();

      const rows = getCommandLeaderboard(weekKey);
      if (rows.length === 0) return;

      const enriched = rows.map(r => {
        const user = portalDb.prepare("SELECT display_name, full_name FROM users WHERE discord_id = ? AND lower(account_status) = 'active'").get(r.discord_id);
        return { ...r, name: user?.display_name || user?.full_name || `<@${r.discord_id}>` };
      }).filter(r => r.name);

      if (enriched.length === 0) return;

      const totalCmds = enriched.reduce((s, r) => s + r.command_count, 0);
      const lines = enriched.map((r, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
        return `${medal} ${r.name} — **${r.command_count}** commands`;
      });

      const embed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle('⚡ Staff Commands Used Leaderboard')
        .setDescription(lines.join('\n'))
        .addFields(
          { name: 'Week', value: weekKey, inline: true },
          { name: 'Total Commands', value: String(totalCmds), inline: true },
          { name: 'Users', value: String(enriched.length), inline: true },
        )
        .setFooter({ text: 'Staff only | Resets every Monday | Updates every 5 minutes' })
        .setTimestamp();

      const ch = await client.channels.fetch(LEADERBOARD_CH).catch(() => null);
      if (!ch) return;

      const stored = cfgDb.prepare("SELECT value FROM bot_config WHERE key = ?").get('cmd_leaderboard_msg_' + weekKey);
      if (stored) {
        try { const msg = await ch.messages.fetch(stored.value); await msg.edit({ embeds: [embed] }); return; } catch {}
      }
      const msg = await ch.send({ embeds: [embed] });
      cfgDb.prepare("INSERT OR REPLACE INTO bot_config (key, value) VALUES (?, ?)").run('cmd_leaderboard_msg_' + weekKey, msg.id);
    } catch (e) {
      console.error('[Cmd Leaderboard] Failed:', e.message);
    }
  }

  // ── DMs Sent Leaderboard ──
  async function postDMLeaderboard() {
    try {
      const { db: cfgDb, getDMLeaderboard } = await import('./utils/botDb.js');
      const portalDb = (await import('./db.js')).default;
      const weekKey = getBragWeekKey();

      const rows = getDMLeaderboard(weekKey);
      if (rows.length === 0) return;

      const enriched = rows.map(r => {
        const user = portalDb.prepare("SELECT display_name, full_name FROM users WHERE discord_id = ? AND lower(account_status) = 'active'").get(r.discord_id);
        return { ...r, name: user?.display_name || user?.full_name || `<@${r.discord_id}>` };
      }).filter(r => r.name);

      if (enriched.length === 0) return;

      const totalDMs = enriched.reduce((s, r) => s + r.dm_count, 0);
      const lines = enriched.map((r, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
        return `${medal} ${r.name} — **${r.dm_count}** DMs`;
      });

      const embed = new EmbedBuilder()
        .setColor(0xec4899)
        .setTitle('✉️ Staff DMs Sent Leaderboard')
        .setDescription(lines.join('\n'))
        .addFields(
          { name: 'Week', value: weekKey, inline: true },
          { name: 'Total DMs', value: String(totalDMs), inline: true },
          { name: 'Senders', value: String(enriched.length), inline: true },
        )
        .setFooter({ text: 'Staff only | Resets every Monday | Updates every 5 minutes' })
        .setTimestamp();

      const ch = await client.channels.fetch(LEADERBOARD_CH).catch(() => null);
      if (!ch) return;

      const stored = cfgDb.prepare("SELECT value FROM bot_config WHERE key = ?").get('dm_leaderboard_msg_' + weekKey);
      if (stored) {
        try { const msg = await ch.messages.fetch(stored.value); await msg.edit({ embeds: [embed] }); return; } catch {}
      }
      const msg = await ch.send({ embeds: [embed] });
      cfgDb.prepare("INSERT OR REPLACE INTO bot_config (key, value) VALUES (?, ?)").run('dm_leaderboard_msg_' + weekKey, msg.id);
    } catch (e) {
      console.error('[DM Leaderboard] Failed:', e.message);
    }
  }

  // ── Assignments Completed Leaderboard ──
  async function postAssignmentLeaderboard() {
    try {
      const { db: cfgDb } = await import('./utils/botDb.js');
      const portalDb = (await import('./db.js')).default;
      const weekKey = getBragWeekKey();

      const rows = cfgDb.prepare(`
        SELECT assigned_to as discord_id, COUNT(*) as completed
        FROM assignments
        WHERE status = 'complete'
          AND completed_at >= ?
          AND assigned_to != 'TEAM'
        GROUP BY assigned_to
        ORDER BY completed DESC
        LIMIT 20
      `).all(weekKey);

      if (rows.length === 0) return;

      const enriched = rows.map(r => {
        const user = portalDb.prepare("SELECT display_name, full_name FROM users WHERE discord_id = ? AND lower(account_status) = 'active'").get(r.discord_id);
        return { ...r, name: user?.display_name || user?.full_name || `<@${r.discord_id}>` };
      }).filter(r => r.name);

      if (enriched.length === 0) return;

      const total = enriched.reduce((s, r) => s + r.completed, 0);
      const lines = enriched.map((r, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
        return `${medal} ${r.name} — **${r.completed}** completed`;
      });

      const embed = new EmbedBuilder()
        .setColor(0x06b6d4)
        .setTitle('📋 Assignments Completed Leaderboard')
        .setDescription(lines.join('\n'))
        .addFields(
          { name: 'Week', value: weekKey, inline: true },
          { name: 'Total Completed', value: String(total), inline: true },
          { name: 'Staff', value: String(enriched.length), inline: true },
        )
        .setFooter({ text: 'Staff only | Resets every Monday | Updates every 5 minutes' })
        .setTimestamp();

      const ch = await client.channels.fetch(LEADERBOARD_CH).catch(() => null);
      if (!ch) return;

      const stored = cfgDb.prepare("SELECT value FROM bot_config WHERE key = ?").get('assign_leaderboard_msg_' + weekKey);
      if (stored) {
        try { const msg = await ch.messages.fetch(stored.value); await msg.edit({ embeds: [embed] }); return; } catch {}
      }
      const msg = await ch.send({ embeds: [embed] });
      cfgDb.prepare("INSERT OR REPLACE INTO bot_config (key, value) VALUES (?, ?)").run('assign_leaderboard_msg_' + weekKey, msg.id);
    } catch (e) {
      console.error('[Assignment Leaderboard] Failed:', e.message);
    }
  }

  // ── Login Streak Leaderboard ──
  async function postLoginStreakLeaderboard() {
    try {
      const { db: cfgDb } = await import('./utils/botDb.js');
      const portalDb = (await import('./db.js')).default;

      // Calculate consecutive login days per user from login_audit
      const users = portalDb.prepare(`
        SELECT u.id, u.display_name, u.full_name, u.discord_id,
          COUNT(DISTINCT date(la.attempted_at)) as login_days
        FROM users u
        INNER JOIN login_audit la ON la.user_id = u.id AND la.success = 1
        WHERE lower(u.account_status) = 'active'
          AND la.attempted_at >= date('now', '-30 days')
        GROUP BY u.id
        HAVING login_days > 0
        ORDER BY login_days DESC
        LIMIT 20
      `).all();

      if (users.length === 0) return;

      // Calculate actual streaks — consecutive days ending today
      const streaks = [];
      for (const u of users) {
        const days = portalDb.prepare(`
          SELECT DISTINCT date(attempted_at) as d FROM login_audit
          WHERE user_id = ? AND success = 1
          ORDER BY d DESC
        `).all(u.id).map(r => r.d);

        let streak = 0;
        const today = new Date().toISOString().slice(0, 10);
        let checkDate = today;
        for (const d of days) {
          if (d === checkDate) {
            streak++;
            const prev = new Date(checkDate);
            prev.setDate(prev.getDate() - 1);
            checkDate = prev.toISOString().slice(0, 10);
          } else if (d < checkDate) {
            break;
          }
        }
        if (streak > 0) streaks.push({ ...u, streak, name: u.display_name || u.full_name });
      }

      streaks.sort((a, b) => b.streak - a.streak);
      if (streaks.length === 0) return;

      const lines = streaks.slice(0, 15).map((r, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
        const fire = r.streak >= 7 ? ' 🔥' : r.streak >= 3 ? ' ⭐' : '';
        return `${medal} ${r.name} — **${r.streak}** day${r.streak !== 1 ? 's' : ''}${fire}`;
      });

      const embed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle('🔥 Login Streak Leaderboard')
        .setDescription(lines.join('\n'))
        .addFields(
          { name: 'Active Streaks', value: String(streaks.length), inline: true },
          { name: 'Longest', value: `${streaks[0].streak} days`, inline: true },
          { name: 'Leader', value: streaks[0].name, inline: true },
        )
        .setFooter({ text: 'Consecutive days logged into the portal | Updates every 5 minutes' })
        .setTimestamp();

      const ch = await client.channels.fetch(LEADERBOARD_CH).catch(() => null);
      if (!ch) return;

      const monthKey = new Date().toISOString().slice(0, 7);
      const stored = cfgDb.prepare("SELECT value FROM bot_config WHERE key = ?").get('login_leaderboard_msg_' + monthKey);
      if (stored) {
        try { const msg = await ch.messages.fetch(stored.value); await msg.edit({ embeds: [embed] }); return; } catch {}
      }
      const msg = await ch.send({ embeds: [embed] });
      cfgDb.prepare("INSERT OR REPLACE INTO bot_config (key, value) VALUES (?, ?)").run('login_leaderboard_msg_' + monthKey, msg.id);
    } catch (e) {
      console.error('[Login Streak Leaderboard] Failed:', e.message);
    }
  }

  // Post all leaderboards on startup, then every 5 minutes
  await postMessageLeaderboard();
  await postVoiceLeaderboard();
  await postCommandLeaderboard();
  await postDMLeaderboard();
  await postAssignmentLeaderboard();
  await postLoginStreakLeaderboard();
  setInterval(postMessageLeaderboard, 5 * 60 * 1000);
  setInterval(postVoiceLeaderboard, 5 * 60 * 1000);
  setInterval(postCommandLeaderboard, 5 * 60 * 1000);
  setInterval(postDMLeaderboard, 5 * 60 * 1000);
  setInterval(postAssignmentLeaderboard, 5 * 60 * 1000);
  setInterval(postLoginStreakLeaderboard, 5 * 60 * 1000);
  console.log('[Leaderboard] Started — 6 boards updating every 5 minutes');

  // Reminder cron — every 60 seconds
  setInterval(async () => {
    try {
      const { db } = await import('./utils/botDb.js');
      const due = db.prepare("SELECT * FROM reminders WHERE sent = 0 AND remind_at <= datetime('now')").all();
      for (const reminder of due) {
        try {
          const targetUser = await client.users.fetch(reminder.target_discord_id);
          const requesterUser = reminder.requester_discord_id !== reminder.target_discord_id
            ? await client.users.fetch(reminder.requester_discord_id).catch(() => null) : null;

          await targetUser.send({ embeds: [new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('⏰ Reminder')
            .setDescription(reminder.message)
            .addFields(requesterUser ? [{ name: 'Set by', value: `<@${requesterUser.id}>`, inline: true }] : [])
            .setFooter({ text: 'Community Organisation | Reminder' })
            .setTimestamp()
          ]});
        } catch (e) {
          console.error('[Remind]', e.message);
        }
        db.prepare('UPDATE reminders SET sent = 1 WHERE id = ?').run(reminder.id);
      }
    } catch (e) { console.error('[Reminder cron]', e.message); }
  }, 60000);
  console.log('[Reminder Cron] Started — checking every 60s');

  // AutoMod crons — lockdown auto-unlock every 60s, verify timeout hourly
  setInterval(async () => {
    try { await automod.processAutoUnlocks(); } catch (e) { console.error('[AutoMod auto-unlock]', e.message); }
  }, 60000);
  setInterval(async () => {
    try { await automod.processVerifyTimeouts(); } catch (e) { console.error('[AutoMod verify-timeout]', e.message); }
  }, 3600000);
  console.log('[AutoMod Crons] Started — auto-unlock 60s, verify-timeout 1h');

  // Office key expiry cron — every 5 minutes
  setInterval(async () => {
    try { await processExpiredKeys(client); } catch (e) { console.error('[Office Key Expiry]', e.message); }
  }, 5 * 60 * 1000);
  console.log('[Office Key Expiry] Started — checking every 5 minutes');

  // Recording cleanup — delete expired recordings daily at 3am
  setInterval(async () => {
    try {
      const { cleanupExpiredRecordings } = await import('./services/recordingService.js');
      await cleanupExpiredRecordings();
    } catch (e) { console.error('[Recording Cleanup]', e.message); }
  }, 24 * 60 * 60 * 1000);
  // Also run once on startup
  import('./services/recordingService.js').then(m => m.cleanupExpiredRecordings()).catch(() => {});
  console.log('[Recording Cleanup] Started — checking daily');

  // M365 activity log polling — disabled, replaced by Graph API webhooks on the portal
  // The portal receives instant webhook notifications and forwards embeds to Discord via /api/send-channel
  // Keeping m365LogService.js as fallback if webhooks fail
  // import('./services/m365LogService.js').then(m => m.startM365LogPolling(client)).catch(e => console.error('[M365 Logs] Init error:', e.message));
  console.log('[M365 Logs] Polling disabled — using Graph API webhooks via portal');

  // ── Poll ending cron — check every 60 seconds ──
  setInterval(async () => {
    try {
      const { default: pollDb } = await import('./utils/botDb.js');
      const { buildPollEmbed, buildPollButtons } = await import('./commands/poll.js');
      const expired = pollDb.prepare("SELECT * FROM polls WHERE ended = 0 AND ends_at <= datetime('now')").all();
      for (const poll of expired) {
        try {
          const options = JSON.parse(poll.options);
          const votes = JSON.parse(poll.votes || '{}');
          pollDb.prepare('UPDATE polls SET ended = 1 WHERE id = ?').run(poll.id);

          const embed = buildPollEmbed(poll, options, votes, true);
          embed.addFields({ name: 'Created by', value: `<@${poll.creator_id}>`, inline: true });
          const buttons = buildPollButtons(poll.id, options, true);

          const channel = await client.channels.fetch(poll.channel_id).catch(() => null);
          if (channel) {
            const msg = await channel.messages.fetch(poll.message_id).catch(() => null);
            if (msg) {
              await msg.edit({ embeds: [embed], components: buttons });
            }

            // Announce winner
            const totalVotes = Object.values(votes).reduce((sum, arr) => sum + arr.length, 0);
            if (totalVotes > 0) {
              let maxVotes = 0;
              for (const arr of Object.values(votes)) {
                if (arr.length > maxVotes) maxVotes = arr.length;
              }
              const winners = options.filter((_, i) => (votes[String(i)] || []).length === maxVotes);
              await channel.send({
                embeds: [new EmbedBuilder()
                  .setTitle('📊 Poll Results')
                  .setColor(0x22C55E)
                  .setDescription(`**${poll.question}**\n\nWinner: **${winners.join(', ')}** with ${maxVotes} vote${maxVotes !== 1 ? 's' : ''} (${totalVotes} total)`)
                  .setTimestamp()
                ]
              });
            }
          }
        } catch (e) {
          console.error('[Poll End] Error for poll', poll.id, e.message);
        }
      }
      if (expired.length > 0) console.log(`[Poll Cron] Ended ${expired.length} poll(s)`);
    } catch (e) { console.error('[Poll Cron]', e.message); }
  }, 60000);
  console.log('[Poll Cron] Started — checking every 60s');

  // ── Scheduled DM cron — check every 60 seconds ──
  setInterval(async () => {
    try {
      const { default: dmDb } = await import('./utils/botDb.js');
      const due = dmDb.prepare("SELECT * FROM scheduled_dms WHERE sent = 0 AND send_at <= datetime('now')").all();
      for (const scheduled of due) {
        try {
          const recipient = await client.users.fetch(scheduled.recipient_id).catch(() => null);
          if (recipient) {
            const senderPortal = getUserByDiscordId(scheduled.sender_id);
            const senderName = senderPortal?.display_name || 'A staff member';

            const embed = new EmbedBuilder()
              .setTitle(scheduled.subject ? `📨 ${scheduled.subject}` : '📨 Scheduled Message')
              .setColor(0x5865F2)
              .setDescription(scheduled.message)
              .addFields({ name: 'From', value: `${senderName} (<@${scheduled.sender_id}>)`, inline: true })
              .setFooter({ text: 'Community Organisation | Scheduled DM' })
              .setTimestamp();

            await recipient.send({ embeds: [embed] });
          }
        } catch (e) {
          console.error('[Scheduled DM] Send error:', e.message);
        }
        dmDb.prepare('UPDATE scheduled_dms SET sent = 1 WHERE id = ?').run(scheduled.id);
      }
      if (due.length > 0) console.log(`[Scheduled DM] Sent ${due.length} DM(s)`);
    } catch (e) { console.error('[Scheduled DM Cron]', e.message); }
  }, 60000);
  console.log('[Scheduled DM Cron] Started — checking every 60s');

  // ── Weekly moderation stats — Monday 9AM ──
  scheduleAtTime(9, 0, async () => {
    // Only run on Mondays
    if (new Date().getDay() !== 1) return;
    try {
      const { default: modDb } = await import('./utils/botDb.js');
      const portalDb = (await import('./db.js')).default;
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const infractions = modDb.prepare("SELECT COUNT(*) as c FROM infractions WHERE created_at >= ?").get(oneWeekAgo)?.c || 0;
      const bans = modDb.prepare("SELECT COUNT(*) as c FROM banned_users WHERE banned_at >= ?").get(oneWeekAgo)?.c || 0;
      const suspensions = modDb.prepare("SELECT COUNT(*) as c FROM suspensions WHERE suspended_at >= ?").get(oneWeekAgo)?.c || 0;
      const globalBans = modDb.prepare("SELECT COUNT(*) as c FROM global_bans WHERE banned_at >= ?").get(oneWeekAgo)?.c || 0;

      let casesOpened = 0, casesClosed = 0;
      try {
        casesOpened = portalDb.prepare("SELECT COUNT(*) as c FROM cases WHERE created_at >= ?").get(oneWeekAgo)?.c || 0;
        casesClosed = portalDb.prepare("SELECT COUNT(*) as c FROM cases WHERE closed_at IS NOT NULL AND closed_at >= ?").get(oneWeekAgo)?.c || 0;
      } catch {}

      const assignmentsCompleted = modDb.prepare("SELECT COUNT(*) as c FROM assignments WHERE status = 'complete' AND completed_at >= ?").get(oneWeekAgo)?.c || 0;

      let staffVerified = 0;
      try {
        staffVerified = modDb.prepare("SELECT COUNT(*) as c FROM verified_members WHERE verified_at >= ?").get(oneWeekAgo)?.c || 0;
      } catch {}

      const embed = new EmbedBuilder()
        .setTitle('📊 Weekly Moderation Summary')
        .setColor(0x5865F2)
        .setDescription(`Summary for the past 7 days (ending <t:${Math.floor(Date.now() / 1000)}:D>)`)
        .addFields(
          { name: '⚠️ Infractions Issued', value: String(infractions), inline: true },
          { name: '🔨 Bans', value: String(bans), inline: true },
          { name: '🌐 Global Bans', value: String(globalBans), inline: true },
          { name: '🔴 Suspensions', value: String(suspensions), inline: true },
          { name: '📋 Cases Opened', value: String(casesOpened), inline: true },
          { name: '✅ Cases Closed', value: String(casesClosed), inline: true },
          { name: '📌 Assignments Completed', value: String(assignmentsCompleted), inline: true },
          { name: '✔️ Staff Verified', value: String(staffVerified), inline: true },
        )
        .setFooter({ text: 'Community Organisation | Weekly Report' })
        .setTimestamp();

      // Post to leaderboard channel
      const ch = await client.channels.fetch(LEADERBOARD_CH).catch(() => null);
      if (ch) await ch.send({ embeds: [embed] });

      console.log('[Weekly Mod Stats] Posted summary');
    } catch (e) { console.error('[Weekly Mod Stats]', e.message); }
  }, 'Weekly Mod Stats');

  // ── Portal health monitoring — every 5 minutes ──
  let portalDown = false;
  setInterval(async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch('http://localhost:3016/api/health', { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      if (portalDown) {
        portalDown = false;
        console.log('[Health] Portal recovered');
        const embed = new EmbedBuilder()
          .setTitle('✅ Portal Recovered')
          .setColor(0x22C55E)
          .setDescription('The CO Staff Portal (`localhost:3016`) is back online.')
          .setTimestamp()
          .setFooter({ text: 'Community Organisation | Health Monitor' });
        await sendToWatchedUsers(client, embed);
      }
    } catch (e) {
      if (!portalDown) {
        portalDown = true;
        console.error('[Health] Portal is DOWN:', e.message);
        const embed = new EmbedBuilder()
          .setTitle('🔴 Portal DOWN')
          .setColor(0xEF4444)
          .setDescription(`The CO Staff Portal (\`localhost:3016\`) is not responding.\n\n**Error:** ${e.message}`)
          .setTimestamp()
          .setFooter({ text: 'Community Organisation | Health Monitor' });
        await sendToWatchedUsers(client, embed);
      }
    }
  }, 5 * 60 * 1000);
  console.log('[Health Monitor] Started — checking portal every 5 minutes');
});

const COMMAND_CHANNEL_ID = '1487636502593798255';
const COMMAND_CHANNEL_GUILD = '1357119461957570570';
const COMMAND_SUPERUSERS = ['723199054514749450', '415922272956710912', '1013486189891817563', '1355367209249148928', '878775920180228127'];
const VERIFICATION_CHANNEL_ID = '1487631939103100969';

client.on('interactionCreate', async interaction => {
  try {
  console.log('[Interaction]', interaction.type, interaction.isChatInputCommand() ? interaction.commandName : '');
  if (interaction.isChatInputCommand()) {
    // Restrict slash commands to the bot commands channel in Staff HQ (superusers exempt)
    // Allow /verify in the verification channel as well
    const isVerifyInVerificationChannel = interaction.commandName === 'verify' && interaction.channelId === VERIFICATION_CHANNEL_ID;
    if (interaction.guildId === COMMAND_CHANNEL_GUILD && interaction.channelId !== COMMAND_CHANNEL_ID && !COMMAND_SUPERUSERS.includes(interaction.user.id) && !isVerifyInVerificationChannel) {
      return interaction.reply({ content: `❌ Bot commands can only be used in <#${COMMAND_CHANNEL_ID}>.`, ephemeral: true });
    }

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    // Track command usage for leaderboard
    try {
      const { trackCommand } = await import('./utils/botDb.js');
      trackCommand(interaction.user.id, getBragWeekKey());
    } catch {}

    let commandError = null;
    try {
      await command.execute(interaction);
    } catch (e) {
      commandError = e.message;
      console.error(`[CO Bot] Command error (${interaction.commandName}):`, e.message);
      const msg = { content: '❌ An error occurred. Please try again or contact an administrator.', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(msg).catch(() => {});
      } else {
        await interaction.reply(msg).catch(() => {});
      }
    }

    const success = !commandError && !interaction._commandFailed;
    const errorMsg = commandError || (typeof interaction._commandFailed === 'string' ? interaction._commandFailed : null);

    // Always log the command attempt
    if (COMMAND_LOG_CHANNEL_ID) {
      const portalUser = getUserByDiscordId(interaction.user.id);
      const logChannel = await interaction.client.channels.fetch(COMMAND_LOG_CHANNEL_ID).catch(() => null);
      if (logChannel) {
        const options = interaction.options?._hoistedOptions?.map(o => `**${o.name}:** ${o.value}`).join('\n') || '';
        const embed = new EmbedBuilder()
          .setTitle(success ? `✅ Command Executed` : `❌ Command Failed`)
          .setColor(success ? 0x22c55e : 0xef4444)
          .addFields(
            { name: 'Command', value: `/${interaction.commandName}`, inline: true },
            { name: 'User', value: `${portalUser?.display_name || interaction.user.username} (<@${interaction.user.id}>)`, inline: true },
            { name: 'Guild', value: interaction.guild?.name || 'DM', inline: true },
            { name: 'Status', value: success ? '✅ Success' : '❌ Failed', inline: true },
            ...(options ? [{ name: 'Options', value: options, inline: false }] : []),
            ...(errorMsg ? [{ name: 'Error', value: String(errorMsg).slice(0, 500), inline: false }] : []),
          )
          .setFooter({ text: 'Community Organisation | Staff Assistant' })
          .setTimestamp();
        await logChannel.send({ embeds: [embed] }).catch(() => {});
      }
    }
  }

  // Autocomplete for ticket-panel-send and ticket-panel-delete
  if (interaction.isAutocomplete() && (interaction.commandName === 'ticket-panel-send' || interaction.commandName === 'ticket-panel-delete')) {
    const { getAllTicketPanels } = await import('./utils/botDb.js');
    const panels = getAllTicketPanels();
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'panel_name' || focused.name === 'name') {
      const value = focused.value.toLowerCase();
      const choices = panels
        .filter(p => p.name.toLowerCase().includes(value))
        .slice(0, 25)
        .map(p => ({ name: p.name, value: p.name }));
      return interaction.respond(choices).catch(() => {});
    }
  }

  if (interaction.isButton()) {
    // Verify/Unverify button handlers
    if (interaction.customId.startsWith('verify_auth_select_')) return verifySelect(interaction);
    if (interaction.customId.startsWith('verify_')) return verifyButton(interaction);
    if (interaction.customId.startsWith('unverify_')) return unverifyButton(interaction);
    // Logspanel back button handlers
    if (interaction.customId?.startsWith('logspanel_back')) {
      try { return logspanel.handleSelect(interaction); }
      catch(e) { console.error('[logspanel btn error]', e.message, 'customId:', interaction.customId); throw e; }
    }
    // Orglogs back button handler
    if (interaction.customId?.startsWith('orglogs_back')) {
      try { return orglogs.handleSelect(interaction); }
      catch(e) { console.error('[orglogs btn error]', e.message, 'customId:', interaction.customId); throw e; }
    }
    // Privatelogs back button handler
    if (interaction.customId?.startsWith('privatelogs_back')) {
      try { return privatelogs.handleSelect(interaction); }
      catch(e) { console.error('[privatelogs btn error]', e.message, 'customId:', interaction.customId); throw e; }
    }

    // Ticket create button
    if (interaction.customId.startsWith('ticket_create_')) {
      return handleTicketButton(interaction);
    }

    // Ticket channel buttons (claim / close)
    if (interaction.customId.startsWith('ticket_claim_') || interaction.customId.startsWith('ticket_close_')) {
      return handleTicketChannelButton(interaction);
    }

    // Ticket options buttons
    if (interaction.isButton() && interaction.customId.startsWith('ticketopts_')) {
      return handleTicketOptionsButton(interaction);
    }

    // NID button handlers
    if (interaction.customId.startsWith('nid_confirm_')) {
      const [, , userId, actionType] = interaction.customId.split('_');
      const supervisor = getUserByDiscordId(interaction.user.id);

      try {
        const { default: fetch } = await import('node-fetch');
        const response = await fetch('http://localhost:3016/api/disciplinary/non-investigational', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Bot-Secret': process.env.BOT_SECRET || 'co-bot-internal' },
          body: JSON.stringify({
            user_id: Number(userId),
            action_type: actionType,
            violation_description: 'Submitted via Discord bot',
            _bot_supervisor_id: supervisor?.id
          })
        });
        const data = await response.json();

        if (response.ok) {
          await interaction.update({
            content: `✅ NID submitted successfully. Case reference: **${data.case_ref}**\n[View in Portal](${process.env.PORTAL_URL}/cases)`,
            embeds: [], components: []
          });

          const { logAction: nidLog } = await import('./utils/logger.js');
          await nidLog(client, {
            action: '📋 NID Submitted',
            target: { discordId: userId, name: userId },
            moderator: { discordId: interaction.user.id, name: interaction.user.username },
            color: 0xF59E0B,
            description: `NID ${actionType} submitted for <@${userId}> via bot`,
            guildId: interaction.guildId
          });
        } else {
          await interaction.update({ content: `❌ Failed: ${data.error}`, embeds: [], components: [] });
        }
      } catch (e) {
        await interaction.update({ content: `❌ Error: ${e.message}`, embeds: [], components: [] });
      }
    }

    if (interaction.customId === 'nid_cancel') {
      await interaction.update({ content: 'NID submission cancelled.', embeds: [], components: [] });
    }

    // DM acknowledgement button — dm_ack_<senderId> or dm_ack_<senderId>_<recipientId>
    if (interaction.customId.startsWith('dm_ack_')) {
      const parts = interaction.customId.split('_');
      const senderId = parts[2];
      const recipientId = parts[3] || null;
      const acknowledgerName = interaction.user.username;

      await interaction.update({
        content: `✅ **Acknowledged.** The sender has been notified that you have read this message.`,
        embeds: [],
        components: []
      });

      try {
        const sender = await interaction.client.users.fetch(senderId).catch(() => null);
        if (sender) {
          await sender.send({
            embeds: [new EmbedBuilder()
              .setTitle('📧 Acknowledgement Received')
              .setColor(0x22c55e)
              .setDescription(`**${acknowledgerName}** (<@${interaction.user.id}>) has confirmed reading your DM.`)
              .setTimestamp()
            ]
          });
        }
      } catch (e) {
        console.error('[DM Ack] Failed to notify sender:', e.message);
      }
    }

    // Shop approval/decline button handlers
    if (interaction.customId.startsWith('shop_approve_') || interaction.customId.startsWith('shop_decline_')) {
      const isApprove = interaction.customId.startsWith('shop_approve_');
      const redemptionId = interaction.customId.replace(/^shop_(approve|decline)_/, '');

      await interaction.deferUpdate();

      try {
        // Check if the user is an EOB member
        const staffRes = await fetch(`http://localhost:3016/api/staff/by-discord/${interaction.user.id}`, {
          headers: { 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET },
        });
        const staffData = await staffRes.json();
        const isEob = staffData?.department === 'Executive Operations Board' || (staffData?.auth_level >= 99);

        if (!isEob) {
          await interaction.followUp({ content: '❌ You do not have permission to action shop redemptions.', ephemeral: true });
          return;
        }

        // Call portal to approve/decline
        const portalRes = await fetch(`http://localhost:3016/api/activity/shop/redemptions/${redemptionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET },
          body: JSON.stringify({
            action: isApprove ? 'approve' : 'decline',
            approved_by_discord_id: interaction.user.id,
          }),
        });
        const portalData = await portalRes.json();

        if (!portalRes.ok) {
          await interaction.followUp({ content: `❌ ${portalData.error || 'Action failed'}`, ephemeral: true });
          return;
        }

        const actionerName = interaction.user.globalName || interaction.user.username;
        const actionLabel = isApprove ? `✅ Approved by ${actionerName}` : `❌ Declined by ${actionerName}`;

        // Disable buttons on ALL sent DMs for this redemption
        const botMessageIds = portalData.bot_message_ids || [];
        for (const entry of botMessageIds) {
          try {
            const dmUser = await client.users.fetch(entry.discord_id);
            const dmChannel = await dmUser.createDM();
            const dmMsg = await dmChannel.messages.fetch(entry.message_id);
            if (dmMsg) {
              const disabledRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('shop_done_approve').setLabel(actionLabel).setStyle(2).setDisabled(true),
              );
              await dmMsg.edit({ components: [disabledRow] });
            }
          } catch (e) {
            // DM may have been deleted or user has DMs closed — non-fatal
          }
        }

        // Also disable buttons on the message the user just clicked
        try {
          const disabledRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('shop_done_action').setLabel(actionLabel).setStyle(2).setDisabled(true),
          );
          await interaction.editReply({ components: [disabledRow] });
        } catch (e) { /* non-fatal */ }

      } catch (e) {
        console.error('[Shop Button]', e.message);
        try { await interaction.followUp({ content: `❌ Error: ${e.message}`, ephemeral: true }); } catch {}
      }
      return;
    }

    // DM exempt button handlers
    if (interaction.customId === 'dm_exempt_add') {
      // Fetch guild members for select menu
      const guild = interaction.guild;
      if (!guild) {
        await interaction.update({ content: '❌ This command must be used in a server.', components: [] });
        return;
      }

      await guild.members.fetch();

      const members = guild.members.cache
        .filter(m => !m.user.bot)
        .map(m => ({
          label: m.displayName.slice(0, 100),
          value: m.user.id,
          description: (m.user.username || '').slice(0, 100) || null
        }))
        .slice(0, 25);

      if (members.length === 0) {
        await interaction.update({ content: '❌ No members found in this server.', components: [] });
        return;
      }

      await interaction.update({
        content: '**Select a server member to exempt from mass/team DMs:**',
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('dm_exempt_user_select')
              .setPlaceholder('Choose a member...')
              .addOptions(members)
          ),
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('dm_exempt_cancel').setLabel('Cancel').setStyle(2)
          )
        ]
      });
      return;
    }

    if (interaction.customId === 'dm_exempt_remove') {
      await interaction.showModal({
        title: 'Remove DM Exemption',
        customId: 'dm_exempt_remove_modal',
        components: [
          {
            type: 1,
            components: [{
              type: 4,
              style: 1,
              label: 'User mention or ID',
              placeholder: '@username or 123456789',
              customId: 'user_input',
              maxLength: 50,
            }]
          }
        ]
      });
      return;
    }
    // AutoMod panel buttons (all automod_ prefixed interactions)
    if (interaction.customId?.startsWith('automod_')) {
      try { const handled = await automodPanelHandler(interaction); if (handled) return; }
      catch(e) { console.error('[automod panel error]', e.message); throw e; }
    }

    // Directive acknowledge button
    if (interaction.customId?.startsWith('directive_ack_')) {
      try {
        const { handleDirectiveAcknowledge } = await import('./services/directiveService.js');
        return handleDirectiveAcknowledge(interaction);
      } catch(e) { console.error('[directive_ack error]', e.message); throw e; }
    }

    // Assignment button handlers
    if (interaction.customId?.startsWith('assign_')) {
      try { return assignButton(interaction); }
      catch(e) { console.error('[assign btn error]', e.message); throw e; }
    }

    // Inbox button handlers
    if (interaction.customId?.startsWith('inbox_')) {
      try { return inbox.handleInboxInteraction(interaction); }
      catch(e) { console.error('[inbox error]', e.message, 'customId:', interaction.customId); throw e; }
    }

    // Poll vote button handlers
    if (interaction.customId?.startsWith('poll_vote_')) {
      try { return pollVoteButton(interaction); }
      catch(e) { console.error('[poll vote error]', e.message, 'customId:', interaction.customId); throw e; }
    }

    // Office button handlers
    if (interaction.customId?.startsWith('office_')) {
      try { return officeButton(interaction, client); }
      catch(e) { console.error('[office btn error]', e.message, 'customId:', interaction.customId); throw e; }
    }

  }

  // String select menu handlers
  if (interaction.isStringSelectMenu()) {
    // AutoMod panel select menus
    if (interaction.customId?.startsWith('automod_')) {
      try { const handled = await automodPanelHandler(interaction); if (handled) return; }
      catch(e) { console.error('[automod select error]', e.message); throw e; }
    }

    if (interaction.customId === 'dm_exempt_user_select') {
      const { addDmExemption, getDmExemptions } = await import('./utils/botDb.js');

      const discordId = interaction.values[0];
      const member = interaction.guild?.members.cache.get(discordId);
      const displayName = member?.displayName || member?.user.username || discordId;

      addDmExemption(discordId, displayName, interaction.user.id);

      const exempts = getDmExemptions();
      const rows = exempts.map(e =>
        `**${e.display_name || 'Unknown'}** — <@${e.discord_id}>\n   Added by: ${e.exempted_by} · <t:${Math.floor(new Date(e.created_at).getTime()/1000)}:R>`
      );

      await interaction.update({
        content: null,
        embeds: [new EmbedBuilder()
          .setTitle(`📋 DM Exemptions (${exempts.length})`)
          .setColor(0x22c55e)
          .setDescription(rows.join('\n\n'))
          .setFooter({ text: 'Community Organisation | Staff Assistant' })
          .setTimestamp()
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('dm_exempt_add').setLabel('Add Exemption').setStyle(3),
            new ButtonBuilder().setCustomId('dm_exempt_remove').setLabel('Remove Exemption').setStyle(4),
          )
        ]
      });
      return;
    }

    if (interaction.customId === 'dm_exempt_cancel') {
      const { getDmExemptions } = await import('./utils/botDb.js');
      const exempts = getDmExemptions();
      const rows = exempts.map(e =>
        `**${e.display_name || 'Unknown'}** — <@${e.discord_id}>\n   Added by: ${e.exempted_by} · <t:${Math.floor(new Date(e.created_at).getTime()/1000)}:R>`
      );

      await interaction.update({
        content: null,
        embeds: [new EmbedBuilder()
          .setTitle(`📋 DM Exemptions (${exempts.length})`)
          .setColor(0x5865F2)
          .setDescription(rows.join('\n\n'))
          .setFooter({ text: 'Community Organisation | Staff Assistant' })
          .setTimestamp()
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('dm_exempt_add').setLabel('Add Exemption').setStyle(3),
            new ButtonBuilder().setCustomId('dm_exempt_remove').setLabel('Remove Exemption').setStyle(4),
          )
        ]
      });
      return;
    }
    if (interaction.customId.startsWith('verify_')) return verifyButton(interaction);
    if (interaction.customId.startsWith('unverify_')) return unverifyButton(interaction);
    if (interaction.customId?.startsWith('logspanel_')) {
      try { return logspanel.handleSelect(interaction); }
      catch(e) { console.error('[logspanel handleSelect error]', e.message, 'customId:', interaction.customId, 'values:', interaction.values); throw e; }
    }
    if (interaction.customId?.startsWith('orglogs_')) {
      try { return orglogs.handleSelect(interaction); }
      catch(e) { console.error('[orglogs handleSelect error]', e.message); throw e; }
    }
    if (interaction.customId?.startsWith('privatelogs_')) {
      try { return privatelogs.handleSelect(interaction); }
      catch(e) { console.error('[privatelogs handleSelect error]', e.message); throw e; }
    }
    // Inbox button/select handlers
    if (interaction.customId?.startsWith('inbox_')) {
      try { return inbox.handleInboxInteraction(interaction); }
      catch(e) { console.error('[inbox error]', e.message, 'customId:', interaction.customId); throw e; }
    }
    // Office select handlers
    if (interaction.customId?.startsWith('office_')) {
      try { return officeSelect(interaction, client); }
      catch(e) { console.error('[office select error]', e.message, 'customId:', interaction.customId); throw e; }
    }
  }

  // Verify/Unverify modal handlers
  if (interaction.isModalSubmit()) {
    // AutoMod panel modals
    if (interaction.customId?.startsWith('automod_')) {
      try { const handled = await automodPanelHandler(interaction); if (handled) return; }
      catch(e) { console.error('[automod modal error]', e.message); throw e; }
    }

    if (interaction.customId.startsWith('verify_nickname_')) return verifyModal(interaction);
    if (interaction.customId.startsWith('verify_deny_reason_')) return verifyModal(interaction);
    if (interaction.customId.startsWith('unverify_approve_reason_')) return unverifyModal(interaction);
    if (interaction.customId?.startsWith('logspanel_')) {
      try { return logspanel.handleModal(interaction); }
      catch(e) { console.error('[logspanel handleModal error]', e.message, 'customId:', interaction.customId); throw e; }
    }
    if (interaction.customId?.startsWith('orglogs_')) {
      try { return orglogs.handleModal(interaction); }
      catch(e) { console.error('[orglogs handleModal error]', e.message); throw e; }
    }
    if (interaction.customId?.startsWith('privatelogs_')) {
      try { return privatelogs.handleModal(interaction); }
      catch(e) { console.error('[privatelogs handleModal error]', e.message); throw e; }
    }
    // Inbox modal handler
    if (interaction.customId?.startsWith('inbox_')) {
      try { return inbox.handleInboxModal(interaction); }
      catch(e) { console.error('[inbox modal error]', e.message, 'customId:', interaction.customId); throw e; }
    }

    // Assignment modal handlers
    if (interaction.customId?.startsWith('assign_')) {
      try { return assignModal(interaction); }
      catch(e) { console.error('[assign modal error]', e.message); throw e; }
    }

    // Office modal handlers
    if (interaction.customId?.startsWith('office_')) {
      try { return officeModal(interaction, client); }
      catch(e) { console.error('[office modal error]', e.message, 'customId:', interaction.customId); throw e; }
    }

    // Onboard modal handlers
    if (interaction.customId?.startsWith('onboard_nickname_')) {
      try { return onboardModal(interaction); }
      catch(e) { console.error('[onboard modal error]', e.message); throw e; }
    }

    if (interaction.customId.startsWith('ticketopts_renamemodal_')) {
      return handleTicketOptionsModal(interaction);
    }

    if (interaction.customId === 'dm_exempt_add_modal') {
      const { addDmExemption, getDmExemptions } = await import('./utils/botDb.js');
      const { getUserByDiscordId } = await import('./db.js');
      const userInput = interaction.fields.getTextInputValue('user_input');
      const reason = interaction.fields.getTextInputValue('reason_input') || null;

      // Extract user ID from mention or raw ID
      const userId = userInput.replace(/<@!?/g, '').replace(/>/g, '').trim();
      const portalUser = getUserByDiscordId(userId);
      const displayName = portalUser?.display_name || userInput;

      addDmExemption(userId, displayName, interaction.user.id);

      const { logAction: dmLog } = await import('./utils/logger.js');
      await dmLog(client, {
        action: '✅ DM Exemption Added',
        target: { discordId: userId, name: displayName },
        moderator: { discordId: interaction.user.id, name: interaction.user.username },
        color: 0x22C55E,
        description: `DM exemption added for <@${userId}> (${displayName})`,
        guildId: interaction.guildId
      });

      const exempts = getDmExemptions();
      const rows = exempts.map(e =>
        `**${e.display_name || 'Unknown'}** — <@${e.discord_id}>\n   Added by: ${e.exempted_by} · <t:${Math.floor(new Date(e.created_at).getTime()/1000)}:R>`
      );

      await interaction.update({
        content: null,
        embeds: [new EmbedBuilder()
          .setTitle(`📋 DM Exemptions (${exempts.length})`)
          .setColor(0x22c55e)
          .setDescription(exempts.length > 0 ? rows.join('\n\n') : 'No users are currently exempt.')
          .setFooter({ text: 'Community Organisation | Staff Assistant' })
          .setTimestamp()
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('dm_exempt_add').setLabel('Add Exemption').setStyle(3),
            new ButtonBuilder().setCustomId('dm_exempt_remove').setLabel('Remove Exemption').setStyle(4),
          )
        ]
      });
    }

    if (interaction.customId === 'dm_exempt_remove_modal') {
      const { removeDmExemption, getDmExemptions } = await import('./utils/botDb.js');
      const userInput = interaction.fields.getTextInputValue('user_input');
      const userId = userInput.replace(/<@!?/g, '').replace(/>/g, '').trim();

      removeDmExemption(userId);

      const { logAction: dmLogRem } = await import('./utils/logger.js');
      await dmLogRem(client, {
        action: '❌ DM Exemption Removed',
        target: { discordId: userId, name: userId },
        moderator: { discordId: interaction.user.id, name: interaction.user.username },
        color: 0xEF4444,
        description: `DM exemption removed for <@${userId}>`,
        guildId: interaction.guildId
      });

      const exempts = getDmExemptions();
      const rows = exempts.map(e =>
        `**${e.display_name || 'Unknown'}** — <@${e.discord_id}>\n   Added by: ${e.exempted_by} · <t:${Math.floor(new Date(e.created_at).getTime()/1000)}:R>`
      );

      await interaction.update({
        content: null,
        embeds: [new EmbedBuilder()
          .setTitle(`📋 DM Exemptions (${exempts.length})`)
          .setColor(0x22c55e)
          .setDescription(exempts.length > 0 ? rows.join('\n\n') : 'No users are currently exempt.')
          .setFooter({ text: 'Community Organisation | Staff Assistant' })
          .setTimestamp()
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('dm_exempt_add').setLabel('Add Exemption').setStyle(3),
            new ButtonBuilder().setCustomId('dm_exempt_remove').setLabel('Remove Exemption').setStyle(4),
          )
        ]
      });
    }
  }
  } catch (e) {
    console.error('[interactionCreate] Unhandled error:', e.message);
    const msg = { content: '❌ An unexpected error occurred. Please try again.', ephemeral: true };
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(msg).catch(() => {});
      } else {
        await interaction.reply(msg).catch(() => {});
      }
    } catch (_) {}
  }
});

// Auto-apply roles + nickname when a verified member joins any server
client.on('guildMemberAdd', async (member) => {
  try {
    const { default: botDb } = await import('./utils/botDb.js');
    const verified = botDb.prepare("SELECT * FROM verified_members WHERE discord_id = ?").get(member.user.id);
    if (!verified) return;

    const { POSITIONS, ALL_MANAGED_ROLES } = await import('./utils/positions.js');
    const roleNames = [...(POSITIONS[verified.position] || []), 'Verified', 'CO Staff'];
    const toAssign = member.guild.roles.cache.filter(r => roleNames.includes(r.name));
    if (toAssign.size > 0) await member.roles.add(toAssign).catch(e => console.warn('[Verify Auto] Roles failed:', e.message));

    // Set nickname globally
    if (verified.nickname) {
      await member.setNickname(verified.nickname.slice(0, 32)).catch(e => console.warn(`[Verify Auto] Nickname failed in ${member.guild.name}:`, e.message));
    }
    console.log('[Verify] Auto-applied roles + nickname for', member.user.tag, 'on join to', member.guild.name);
  } catch (e) {
    console.error('[guildMemberAdd verify error]', e.message);
  }

  // AutoMod checks
  try { await automod.checkMemberAdd(member); } catch (e) { console.error('[AutoMod guildMemberAdd]', e.message); }
});

client.on('guildMemberRemove', async (member) => {
  try { await automod.checkMemberLeave(member); } catch (e) { console.error('[AutoMod guildMemberRemove]', e.message); }
});

// AutoMod message handler + counting + BRAG message tracking
client.on('messageCreate', async (message) => {
  // Cache every message in the Log Hub for audit trail
  if (message.guildId === '1485423163817988186') {
    try {
      const { storeLogHubMessage } = await import('./utils/botDb.js');
      const embedData = message.embeds?.length > 0
        ? JSON.stringify(message.embeds.map(e => ({ title: e.title, description: e.description?.slice(0, 500), fields: e.fields?.map(f => ({ name: f.name, value: f.value?.slice(0, 200) })) })))
        : null;
      const attachmentUrls = message.attachments?.size > 0
        ? JSON.stringify([...message.attachments.values()].map(a => a.url))
        : null;
      storeLogHubMessage({
        id: message.id,
        channelId: message.channelId,
        channelName: message.channel?.name,
        authorId: message.author?.id,
        authorTag: message.author?.tag || message.author?.username,
        content: message.content || null,
        embedData,
        attachmentUrls,
      });
    } catch {}
  }

  // Counting channel handler — runs first so counting messages aren't interfered with
  if (!message.author.bot && message.guild && !message.system) {
    try {
      const { db: countDb } = await import('./utils/botDb.js');
      const countChannel = countDb.prepare('SELECT * FROM counting_channels WHERE guild_id = ? AND channel_id = ?')
        .get(message.guild.id, message.channel.id);

      if (countChannel) {
        const content = message.content.trim();
        let value = null;

        if (/^[\d\s\+\-\*\/\(\)\.]+$/.test(content) && content.length > 0) {
          try {
            const result = Function('"use strict"; return (' + content + ')')();
            if (typeof result === 'number' && isFinite(result) && result === Math.floor(result)) {
              value = result;
            }
          } catch (e) { /* not valid math */ }
        }

        const expected = countChannel.current_count + 1;

        if (value === null) {
          await message.delete().catch(() => {});
          return;
        }

        if (message.author.id === countChannel.last_user_id) {
          await message.react('❌').catch(() => {});
          const newHighScore = Math.max(countChannel.high_score, countChannel.current_count);
          countDb.prepare(`
            UPDATE counting_channels
            SET current_count = 0, last_user_id = NULL, last_message_id = NULL,
                high_score = ?, failed_at = ?
            WHERE guild_id = ? AND channel_id = ?
          `).run(newHighScore, countChannel.current_count, message.guild.id, message.channel.id);
          await message.channel.send(
            `❌ <@${message.author.id}> counted twice in a row and ruined the count at **${countChannel.current_count}**! The next number is **1**.\n` +
            (newHighScore > 0 ? `🏆 High score: **${newHighScore}**` : '')
          );
          return;
        }

        if (value !== expected) {
          await message.react('❌').catch(() => {});
          const newHighScore = Math.max(countChannel.high_score, countChannel.current_count);
          countDb.prepare(`
            UPDATE counting_channels
            SET current_count = 0, last_user_id = NULL, last_message_id = NULL,
                high_score = ?, failed_at = ?
            WHERE guild_id = ? AND channel_id = ?
          `).run(newHighScore, countChannel.current_count, message.guild.id, message.channel.id);
          await message.channel.send(
            `❌ <@${message.author.id}> ruined the count at **${countChannel.current_count}**! The next number was **${expected}**.\n` +
            (newHighScore > 0 ? `🏆 High score: **${newHighScore}**` : '')
          );
          return;
        }

        // Correct number
        countDb.prepare(`
          UPDATE counting_channels
          SET current_count = ?, last_user_id = ?, last_message_id = ?,
              high_score = CASE WHEN ? > high_score THEN ? ELSE high_score END
          WHERE guild_id = ? AND channel_id = ?
        `).run(value, message.author.id, message.id, value, value, message.guild.id, message.channel.id);

        if (value % 1000 === 0) {
          await message.react('🎉').catch(() => {});
          await message.channel.send(`🎉 **${value}!** Amazing!`);
        } else if (value % 100 === 0) {
          await message.react('🔥').catch(() => {});
        } else {
          await message.react('✅').catch(() => {});
        }
        return; // Don't process counting messages through automod/BRAG
      }
    } catch (e) {
      console.error('[Counting]', e.message);
    }
  }

  try { await automod.checkMessage(message); } catch (e) { console.error('[AutoMod messageCreate]', e.message); }

  // Activity message counting — only track staff members
  if (!message.author.bot && message.guild && !message.system) {
    try {
      const { getUserByDiscordId: getUser } = await import('./db.js');
      const staffUser = getUser(message.author.id);
      if (!staffUser) return;

      const { db: botDatabase } = await import('./utils/botDb.js');
      const weekKey = getBragWeekKey();
      botDatabase.prepare(`
        INSERT INTO brag_message_counts (discord_id, guild_id, guild_name, week_key, message_count, last_message_id, last_updated)
        VALUES (?, ?, ?, ?, 1, ?, datetime('now'))
        ON CONFLICT(discord_id, guild_id, week_key) DO UPDATE SET
          message_count = message_count + 1,
          guild_name = excluded.guild_name,
          last_message_id = excluded.last_message_id,
          last_updated = datetime('now')
      `).run(message.author.id, message.guild.id, message.guild.name, weekKey, message.id);

      // Track daily activity
      dailyActiveUsers.add(message.author.id);

      // Welcome message detection
      const chName = (message.channel.name || '').toLowerCase();
      if ((chName.includes('general') || chName.includes('welcome')) && message.mentions.users.size > 0) {
        const content = message.content.toLowerCase();
        if (/welcome|glad to have|hello|hey|hi there/.test(content)) {
          const current = welcomeTracker.get(message.author.id) || 0;
          welcomeTracker.set(message.author.id, current + message.mentions.users.size);
        }
      }
    } catch (e) {
      // Silent fail
    }
  }
});

// Message delete log — tracked globally across all servers
client.on('messageDelete', async (message) => {
  if (!message) return;

  // Log Hub audit — ANY deletion in the log server gets recorded, even bot messages
  const LOG_HUB_GUILD = '1485423163817988186';
  if (message.guildId === LOG_HUB_GUILD) {
    try {
      const guild = await client.guilds.fetch(LOG_HUB_GUILD);
      const auditCh = guild.channels.cache.find(c => c.name === 'audit-trail');
      if (auditCh && message.channelId !== auditCh.id) {
        // Look up cached content from DB first
        const { getLogHubMessage } = await import('./utils/botDb.js');
        const cached = getLogHubMessage(message.id);

        const who = message.author?.tag || cached?.author_tag || message.author?.id || cached?.author_id || 'Unknown';
        const channel = message.channel?.name || cached?.channel_name || message.channelId;

        // Build content summary from live message + DB cache
        let contentSummary = '';
        const textContent = message.content || cached?.content;
        if (textContent) contentSummary = textContent.slice(0, 500);

        // Embeds — try live first, fall back to cached
        if (message.embeds?.length > 0) {
          const embedTitles = message.embeds.map(e => e.title || e.description?.slice(0, 80) || 'Untitled embed').join(', ');
          contentSummary += (contentSummary ? '\n' : '') + `[${message.embeds.length} embed(s): ${embedTitles}]`;
        } else if (cached?.embed_data) {
          try {
            const embeds = JSON.parse(cached.embed_data);
            const embedSummary = embeds.map(e => {
              let s = e.title || '';
              if (e.description) s += (s ? ' — ' : '') + e.description.slice(0, 100);
              if (e.fields?.length) s += (s ? ' | ' : '') + e.fields.map(f => `${f.name}: ${f.value?.slice(0, 50)}`).join(', ');
              return s || 'Embed';
            }).join('\n');
            contentSummary += (contentSummary ? '\n' : '') + `[Cached embed(s):\n${embedSummary}]`;
          } catch {}
        }

        if (message.attachments?.size > 0) {
          contentSummary += (contentSummary ? '\n' : '') + `[${message.attachments.size} attachment(s)]`;
        } else if (cached?.attachment_urls) {
          try {
            const urls = JSON.parse(cached.attachment_urls);
            contentSummary += (contentSummary ? '\n' : '') + `[${urls.length} cached attachment(s)]`;
          } catch {}
        }

        if (!contentSummary) contentSummary = '*No content recovered*';

        // Check audit log for who deleted it — wait briefly for it to populate
        await new Promise(r => setTimeout(r, 1500));
        let deletedBy = 'Unknown (self-delete or uncached)';
        try {
          const auditLogs = await guild.fetchAuditLogs({ type: 72, limit: 5 });
          for (const entry of auditLogs.entries.values()) {
            if (Date.now() - entry.createdTimestamp < 10000 && entry.extra?.channel?.id === message.channelId) {
              deletedBy = `${entry.executor?.tag || entry.executor?.id} (${entry.executor?.id})`;
              break;
            }
          }
        } catch {}

        await auditCh.send({ embeds: [new EmbedBuilder()
          .setTitle('Log Deletion Detected')
          .setColor(0xef4444)
          .setDescription(`A message was deleted in **#${channel}**`)
          .addFields(
            { name: 'Original Author', value: String(who), inline: true },
            { name: 'Deleted By', value: String(deletedBy), inline: true },
            { name: 'Channel', value: `#${channel}`, inline: true },
            { name: 'Message ID', value: String(message.id), inline: true },
            { name: 'Content', value: String(contentSummary).slice(0, 1024), inline: false },
          )
          .setTimestamp()
          .setFooter({ text: 'CO | Log Hub Audit Trail' })
        ]});
      }
    } catch (e) {
      console.error('[Log Hub Audit]', e.message);
    }
  }

  // Skip bot's own messages (including partials where author may not be loaded)
  if (message.author?.bot) return;
  if (message.author?.id === message.client.user.id) return;
  if (!message.author) return; // Partial with no author — likely bot or system message
  try {
    const deleteChannelId = MESSAGE_DELETE_LOG_CHANNEL_ID;
    const guildId = message.guildId;
    const perGuildChannelId = guildId ? getLogChannel(guildId, 'message', 'message_delete') : null;
    const globalChannelId = getGlobalLogChannel('global_message', guildId);
    const orgwideChannels = getLogChannelsForEvent(guildId || '', 'message', 'message_delete').filter(
      ch => ch !== perGuildChannelId && ch !== globalChannelId && ch !== deleteChannelId && ch !== FULL_MESSAGE_LOGS_CHANNEL_ID
    );

    if (!deleteChannelId && !FULL_MESSAGE_LOGS_CHANNEL_ID && !perGuildChannelId && !globalChannelId && orgwideChannels.length === 0) return;

    const content = message.content?.slice(0, 1500) || '*No text content*';
    const attachments = message.attachments.size > 0 ? `\n📎 ${message.attachments.size} attachment(s)` : '';
    const jumpLink = message.url ? `\n🔗 [Jump to message](${message.url})` : '';

    const embed = new EmbedBuilder()
      .setTitle('🗑️ Message Deleted')
      .setColor(0xef4444)
      .addFields(
        { name: '👤 Author', value: `${message.author.username} (<@${message.author.id}>)`, inline: true },
        { name: '📌 Channel', value: message.channel?.name ? `#${message.channel.name}` : message.channelId, inline: true },
        { name: '🏠 Server', value: message.guild?.name || 'DM', inline: true },
        { name: '💬 Content', value: content + attachments + jumpLink, inline: false },
      )
      .setFooter({ text: 'Community Organisation | Staff Assistant' })
      .setTimestamp();

    // Send to delete log channel
    if (deleteChannelId) {
      const deleteChannel = await client.channels.fetch(deleteChannelId).catch(() => null);
      if (deleteChannel) await deleteChannel.send({ embeds: [embed] });
    }
    // Also send to full-message-logs
    if (FULL_MESSAGE_LOGS_CHANNEL_ID) {
      const fullMsgChannel = await client.channels.fetch(FULL_MESSAGE_LOGS_CHANNEL_ID).catch(() => null);
      if (fullMsgChannel) await fullMsgChannel.send({ embeds: [embed] });
    }
    // Also send to per-guild configured channel
    if (perGuildChannelId) {
      const perGuildChannel = await client.channels.fetch(perGuildChannelId).catch(() => null);
      if (perGuildChannel) await perGuildChannel.send({ embeds: [embed] });
    }
    // Also send to global message log channel
    if (globalChannelId) {
      const globalChannel = await client.channels.fetch(globalChannelId).catch(() => null);
      if (globalChannel) await globalChannel.send({ embeds: [embed] });
    }
    // Also send to orgwide channels (/orglogs bindings)
    for (const chId of orgwideChannels) {
      const ch = await client.channels.fetch(chId).catch(() => null);
      if (ch) await ch.send({ embeds: [embed] });
    }

    // Also DM watched users (Evan + Dion)
    await sendToWatchedUsers(client, embed);
  } catch (e) {
    console.error('[messageDelete log error]', e.message);
  }
});

// Internal staff servers — only superusers + bot can create invites
// Public servers (Communications + International Court) are excluded
const PUBLIC_SERVERS = [
  '1358129722931937280', // CO | Communications
  '1366218589367042048', // CO | International Court
];
const SUPERUSER_INVITE_IDS = [
  '723199054514749450',  // dionm
  '415922272956710912',  // evans
  '1013486189891817563', // haydend
  '1355367209249148928', // CO | Ownership
  '878775920180228127',  // CO | IAC
];

client.on('inviteCreate', async (invite) => {
  if (!invite.guild) return;
  // Allow public servers
  if (PUBLIC_SERVERS.includes(invite.guild.id)) return;
  // Allow superusers
  if (SUPERUSER_INVITE_IDS.includes(invite.inviterId)) return;
  // Allow the bot itself
  if (invite.inviterId === client.user.id) return;

  try {
    await invite.delete('Unauthorised — only superusers can create invites for internal servers');
    console.log(`[Invite Guard] Deleted invite ${invite.code} in ${invite.guild.name} by ${invite.inviter?.tag || invite.inviterId}`);

    if (invite.inviter) {
      await invite.inviter.send({
        embeds: [new EmbedBuilder()
          .setTitle('Invite Deleted')
          .setColor(0xef4444)
          .setDescription(`Your invite to **${invite.guild.name}** was automatically deleted. Only superusers can create invites for internal CO servers.`)
          .setFooter({ text: 'Community Organisation' })
          .setTimestamp()
        ]
      }).catch(() => {});
    }
  } catch (e) {
    console.error('[Invite Guard] Failed:', e.message);
  }
});

// Message edit log — tracked globally across all servers
client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (!oldMessage || !newMessage) return;
  if (oldMessage.author?.bot) return;
  if (newMessage.author?.id === newMessage.client.user.id) return;
  if (oldMessage.content === newMessage.content) return;
  try {
    const editChannelId = MESSAGE_EDIT_LOG_CHANNEL_ID;
    const guildId = newMessage.guildId;
    const perGuildChannelId = guildId ? getLogChannel(guildId, 'message', 'message_edit') : null;
    const globalChannelId = getGlobalLogChannel('global_message', guildId);
    const orgwideChannels = getLogChannelsForEvent(guildId || '', 'message', 'message_edit').filter(
      ch => ch !== perGuildChannelId && ch !== globalChannelId && ch !== editChannelId && ch !== FULL_MESSAGE_LOGS_CHANNEL_ID
    );

    if (!editChannelId && !FULL_MESSAGE_LOGS_CHANNEL_ID && !perGuildChannelId && !globalChannelId && orgwideChannels.length === 0) return;

    const oldContent = oldMessage.content?.slice(0, 750) || '*No text content*';
    const newContent = newMessage.content?.slice(0, 750) || '*No text content*';
    const jumpLink = newMessage.url ? `\n🔗 [Jump to message](${newMessage.url})` : '';

    const embed = new EmbedBuilder()
      .setTitle('✏️ Message Edited')
      .setColor(0xf59e0b)
      .addFields(
        { name: '👤 Author', value: `${newMessage.author.username} (<@${newMessage.author.id}>)`, inline: true },
        { name: '📌 Channel', value: newMessage.channel?.name ? `#${newMessage.channel.name}` : newMessage.channelId, inline: true },
        { name: '🏠 Server', value: newMessage.guild?.name || 'DM', inline: true },
        { name: '📝 Before', value: oldContent, inline: false },
        { name: '📝 After', value: newContent + jumpLink, inline: false },
      )
      .setFooter({ text: 'Community Organisation | Staff Assistant' })
      .setTimestamp();

    // Send to edit log channel
    if (editChannelId) {
      const editChannel = await client.channels.fetch(editChannelId).catch(() => null);
      if (editChannel) await editChannel.send({ embeds: [embed] });
    }
    // Also send to full-message-logs
    if (FULL_MESSAGE_LOGS_CHANNEL_ID) {
      const fullMsgChannel = await client.channels.fetch(FULL_MESSAGE_LOGS_CHANNEL_ID).catch(() => null);
      if (fullMsgChannel) await fullMsgChannel.send({ embeds: [embed] });
    }
    // Also send to per-guild configured channel
    if (perGuildChannelId) {
      const perGuildChannel = await client.channels.fetch(perGuildChannelId).catch(() => null);
      if (perGuildChannel) await perGuildChannel.send({ embeds: [embed] });
    }
    // Also send to global message log channel
    if (globalChannelId) {
      const globalChannel = await client.channels.fetch(globalChannelId).catch(() => null);
      if (globalChannel) await globalChannel.send({ embeds: [embed] });
    }
    // Also send to orgwide channels (/orglogs bindings)
    for (const chId of orgwideChannels) {
      const ch = await client.channels.fetch(chId).catch(() => null);
      if (ch) await ch.send({ embeds: [embed] });
    }
  } catch (e) {
    console.error('[messageUpdate log error]', e.message);
  }
});

// ============ ROLE MANAGEMENT LOGGING ============

// Role created
// AutoMod channel creation guard
client.on('channelCreate', async (channel) => {
  try { await automod.checkChannelCreate(channel); } catch (e) { console.error('[AutoMod channelCreate]', e.message); }
});

client.on('roleCreate', async (role) => {
  try {
    if (!role || !role.guild) return;
    const guildId = role.guild.id;
    await logRoleAction(role.client, {
      action: 'Role Created',
      target: `@${role.name}`,
      moderator: null,
      color: 0x22C55E,
      fields: [
        { name: 'Role Name', value: role.name, inline: true },
        { name: 'Role ID', value: role.id, inline: true },
        { name: 'Color', value: role.hexColor === '#000000' ? 'Default' : role.hexColor, inline: true },
        { name: 'Server', value: role.guild.name, inline: false },
      ],
      roleLogType: 'role_create',
      guildId
    });
  } catch (e) {
    console.error('[roleCreate log error]', e.message);
  }
  // AutoMod check
  try { await automod.checkRoleCreate(role); } catch (e) { console.error('[AutoMod roleCreate]', e.message); }
});

// Role deleted
client.on('roleDelete', async (role) => {
  try {
    if (!role || !role.guild) return;
    const guildId = role.guild.id;
    await logRoleAction(role.client, {
      action: 'Role Deleted',
      target: `@${role.name}`,
      moderator: null,
      color: 0xEF4444,
      fields: [
        { name: 'Role Name', value: role.name, inline: true },
        { name: 'Role ID', value: role.id, inline: true },
        { name: 'Color', value: role.hexColor === '#000000' ? 'Default' : role.hexColor, inline: true },
        { name: 'Server', value: role.guild.name, inline: false },
      ],
      roleLogType: 'role_delete',
      guildId
    });
  } catch (e) {
    console.error('[roleDelete log error]', e.message);
  }
});

// Role updated (name, color, permissions, etc.)
client.on('roleUpdate', async (oldRole, newRole) => {
  try {
    const changes = [];
    if (oldRole.name !== newRole.name) changes.push(`Name: "${oldRole.name}" → "${newRole.name}"`);
    if (oldRole.hexColor !== newRole.hexColor) changes.push(`Color: ${oldRole.hexColor || 'Default'} → ${newRole.hexColor || 'Default'}`);
    if (oldRole.position !== newRole.position) changes.push(`Position: ${oldRole.position} → ${newRole.position}`);
    if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) changes.push(`Permissions changed`);

    if (changes.length === 0) return; // No meaningful changes

    const guildId = newRole.guild.id;
    const isPermissionChange = oldRole.permissions.bitfield !== newRole.permissions.bitfield;

    await logRoleAction(newRole.client, {
      action: 'Role Updated',
      target: `@${newRole.name}`,
      moderator: null,
      color: 0xF59E0B,
      fields: [
        { name: 'Role', value: `<@&${newRole.id}>`, inline: true },
        { name: 'Server', value: newRole.guild.name, inline: true },
        { name: 'Changes', value: changes.join('\n'), inline: false },
      ],
      roleLogType: isPermissionChange ? 'role_permission' : 'role_update',
      guildId
    });
  } catch (e) {
    console.error('[roleUpdate log error]', e.message);
  }
});

// Member role added
// Member roles updated (added or removed)
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  try {
    if (!oldMember || !newMember || newMember.user?.bot) return;
    const guildId = newMember.guild.id;

    const oldRoles = oldMember.roles.cache;
    const newRoles = newMember.roles.cache;

    const addedRoles = newRoles.filter(r => !oldRoles.has(r.id));
    const removedRoles = oldRoles.filter(r => !newRoles.has(r.id));

    for (const role of addedRoles.values()) {
      await logRoleAction(newMember.client, {
        action: 'Member Role Added',
        target: { discordId: newMember.user.id, name: newMember.user.username },
        moderator: null,
        color: 0x22C55E,
        fields: [
          { name: 'Member', value: `<@${newMember.user.id}>`, inline: true },
          { name: 'Role Added', value: role.name, inline: false },
          { name: 'Server', value: newMember.guild.name, inline: false },
        ],
        roleLogType: 'member_role_add',
        guildId
      });
    }

    for (const role of removedRoles.values()) {
      await logRoleAction(newMember.client, {
        action: 'Member Role Removed',
        target: { discordId: newMember.user.id, name: newMember.user.username },
        moderator: null,
        color: 0xEF4444,
        fields: [
          { name: 'Member', value: `<@${newMember.user.id}>`, inline: true },
          { name: 'Role Removed', value: role.name, inline: false },
          { name: 'Server', value: newMember.guild.name, inline: false },
        ],
        roleLogType: 'member_role_remove',
        guildId
      });
    }
  } catch (e) {
    console.error('[guildMemberUpdate log error]', e.message);
  }
  // AutoMod permission guard
  try { await automod.checkMemberUpdate(oldMember, newMember); } catch (e) { console.error('[AutoMod guildMemberUpdate]', e.message); }
});

// ============ VOICE OFFICE RESTRICTIONS ============
client.on('voiceStateUpdate', async (oldState, newState) => {
  // Voice time tracking for leaderboard + activity points
  try {
    const userId = newState.member?.id || oldState.member?.id;
    if (userId && !(newState.member?.user?.bot || oldState.member?.user?.bot)) {
      const { voiceJoin, voiceLeave } = await import('./utils/botDb.js');
      const joined = !oldState.channelId && newState.channelId;
      const left = oldState.channelId && !newState.channelId;
      const moved = oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId;

      if (joined || moved) {
        voiceJoin(userId, getBragWeekKey());
        dailyActiveUsers.add(userId);
        // Record voice session start
        voiceSessions.set(userId, {
          channel_id: newState.channelId,
          channel_name: newState.channel?.name || '',
          joined_at: Date.now(),
        });
        // Meeting channel tracking
        const MEETING_CHANNELS = ['Office Room 1', 'Office Room 2', 'Theatre', 'Conference Room 1'];
        const chName = newState.channel?.name || '';
        if (MEETING_CHANNELS.some(mc => chName.includes(mc))) {
          meetingAttendance.set(userId, { channel_name: chName, joined_at: Date.now() });
        }
      }
      if (left || moved) {
        voiceLeave(userId, getBragWeekKey());
        // Log voice session to portal
        const session = voiceSessions.get(userId);
        if (session) {
          const durationMs = Date.now() - session.joined_at;
          const durationMinutes = Math.round(durationMs / 60000);
          if (durationMinutes >= 1) {
            fetch('http://localhost:3016/api/activity/voice-log', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET },
              body: JSON.stringify({
                discord_id: userId, channel_id: session.channel_id, channel_name: session.channel_name,
                joined_at: new Date(session.joined_at).toISOString(), left_at: new Date().toISOString(),
                duration_minutes: durationMinutes, week_key: getBragWeekKey(),
              })
            }).catch(e => console.error('[VoiceLog] POST failed:', e.message));
          }
          voiceSessions.delete(userId);
        }
        // Meeting attendance — check if qualified (10+ min)
        const meeting = meetingAttendance.get(userId);
        if (meeting) {
          const meetDuration = Math.round((Date.now() - meeting.joined_at) / 60000);
          if (meetDuration >= 10) {
            fetch('http://localhost:3016/api/activity/sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET },
              body: JSON.stringify({ weekKey: getBragWeekKey(), userId: userId, category: 'meeting', points: 10 })
            }).catch(e => console.error('[Meeting] Sync failed:', e.message));
          }
          meetingAttendance.delete(userId);
        }
      }
    }
  } catch (e) {
    console.error('[VoiceTrack] Error:', e.message);
  }

  try {
    // Only care about channel joins (not leaves or same-channel updates)
    if (!newState.channelId || newState.channelId === oldState.channelId) return;
    if (newState.member?.user?.bot) return;

    const guildId = newState.guild.id;

    // Check if they joined a waiting room
    const waitingRoomOffice = getWaitingRoomOffice(guildId, newState.channelId);
    if (waitingRoomOffice) {
      await handleWaitingRoomJoin(client, newState);
      return;
    }

    // Check if they joined a restricted office
    const office = getOfficeByChannel(guildId, newState.channelId);
    if (office && (office.is_restricted || office.is_owner_only)) {
      await enforceOfficeRestrictions(client, newState, office);
    }

    // Refresh panels when someone joins/leaves any registered office
    if (office) {
      await refreshOfficePanels(client, guildId);
    }
  } catch (e) {
    console.error('[voiceStateUpdate office error]', e.message);
  }

  // Also refresh panels on leave
  try {
    if (oldState.channelId && oldState.channelId !== newState.channelId) {
      const oldOffice = getOfficeByChannel(oldState.guild.id, oldState.channelId);
      if (oldOffice) {
        await refreshOfficePanels(client, oldState.guild.id);
      }
    }
  } catch (e) {
    console.error('[voiceStateUpdate leave refresh error]', e.message);
  }
});

// ============ REACTION TRACKING (for weekly awards) ============
client.on('messageReactionAdd', async (reaction, user) => {
  try {
    if (user.bot) return;
    const positiveEmojis = ['👍', '✅', '❤️', '🙌'];
    const emoji = reaction.emoji.name;
    if (!positiveEmojis.includes(emoji)) return;

    // Fetch partial message if needed
    if (reaction.partial) { try { await reaction.fetch(); } catch { return; } }
    const author = reaction.message.author;
    if (!author || author.bot || author.id === user.id) return; // Ignore bots and self-reactions

    // Only count if both are CO staff
    if (!staffCache.has(author.id) || !staffCache.has(user.id)) return;

    const current = weeklyReactions.get(author.id) || 0;
    weeklyReactions.set(author.id, current + 1);
  } catch (e) {
    // Silent fail
  }
});

// ============ BOT WEBHOOK SERVER ============
const webhookApp = express();
webhookApp.use(express.json());

// Multer in memory — used by the /webhook/dm-with-attachment endpoint.
const uploadDmAttachment = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // Discord DM attachment hard-cap is 25MB for non-Nitro recipients
});

function verifyBotSecret(req, res) {
  const secret = req.headers['x-bot-secret'];
  if (!secret || !process.env.BOT_WEBHOOK_SECRET || secret !== process.env.BOT_WEBHOOK_SECRET) {
    res.status(401).json({ error: 'Unauthorised' });
    return false;
  }
  return true;
}

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

// POST /bot/suspend
webhookApp.post('/bot/suspend', async (req, res) => {
  if (!verifyBotSecret(req, res)) return;
  const { discordId, reason, duration, moderatorId, moderatorName, targetName } = req.body;
  if (!discordId) return res.status(400).json({ ok: false, error: 'discordId required' });
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
          .setTitle('🔴 You Have Been Suspended')
          .setColor(0xEF4444)
          .setDescription('You have been suspended from **Community Organisation**.\n\nIf you believe this is an error, you may appeal in the Appeals Server.')
          .addFields(
            { name: '📋 Reason', value: reason || 'No reason provided', inline: false },
            { name: '⏱️ Duration', value: durationDisplay, inline: true },
            { name: '📅 Expires', value: expiresDisplay, inline: true },
            { name: '👤 Actioned By', value: moderatorName || 'Staff Management', inline: true },
          )
          .setFooter({ text: 'Community Organisation | Staff Assistant' })
          .setTimestamp()
        ]});
      }
    } catch {}

    await logAction(client, {
      action: '🔴 Staff Suspended (Portal)',
      moderator: { discordId: moderatorId || 'PORTAL', name: moderatorName || 'Portal' },
      target: { discordId, name: targetName || discordId },
      reason: reason || 'No reason provided',
      color: 0xEF4444,
      fields: [
        { name: '⏱️ Duration', value: durationDisplay, inline: true },
        { name: '📅 Expires', value: expiresDisplay, inline: true },
        { name: '👤 Actioned By', value: moderatorName || 'Portal', inline: true },
        { name: '🌐 Source', value: 'CO Staff Portal — Case Management', inline: true },
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
            .setTitle('✅ Suspension Lifted')
            .setColor(0x22C55E)
            .setDescription('Your suspension from **Community Organisation** has ended and your roles have been restored.')
            .setFooter({ text: 'Community Organisation | Staff Assistant' })
            .setTimestamp()
          ]});
        } catch {}
        await logAction(client, {
          action: '✅ Suspension Lifted (Auto)',
          moderator: { discordId: 'SYSTEM', name: 'Automated' },
          target: { discordId, name: targetName || discordId },
          reason: 'Suspension duration expired',
          color: 0x22C55E
        });
      }, durationMs);
    }

    res.json({ ok: true, duration: durationDisplay, expires: expiresAt });
  } catch (e) {
    console.error('[BOT WEBHOOK /suspend]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /bot/unsuspend
webhookApp.post('/bot/unsuspend', async (req, res) => {
  if (!verifyBotSecret(req, res)) return;
  const { discordId, moderatorName, targetName } = req.body;
  if (!discordId) return res.status(400).json({ ok: false, error: 'discordId required' });
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
        .setTitle('✅ Suspension Lifted')
        .setColor(0x22C55E)
        .setDescription('Your suspension from **Community Organisation** has ended and your roles have been restored.')
        .addFields({ name: '👤 Actioned By', value: moderatorName || 'Staff Management', inline: true })
        .setFooter({ text: 'Community Organisation | Staff Assistant' })
        .setTimestamp()
      ]});
    } catch {}

    const { logAction } = await import('./utils/logger.js');
    await logAction(client, {
      action: '✅ Suspension Lifted (Portal)',
      moderator: { discordId: 'PORTAL', name: moderatorName || 'Portal' },
      target: { discordId, name: targetName || discordId },
      reason: 'Lifted via CO Staff Portal',
      color: 0x22C55E,
      fields: [{ name: '🌐 Source', value: 'CO Staff Portal — Case Management', inline: true }]
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('[BOT WEBHOOK /unsuspend]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
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
        .setTitle('📅 Task Deadline Extended')
        .setColor(0x22C55E)
        .setDescription(`Your task deadline for **"${assignment.title}"** has been extended to **<t:${Math.floor(new Date(new_due_date).getTime()/1000)}:F>** following an approved performance adjustment.`)
        .setFooter({ text: 'Community Organisation | Staff Assistant' })
        .setTimestamp()
      ]});
    } catch {}

    // DM assigner
    try {
      const { getUserByDiscordId: getUser } = await import('./db.js');
      const assigneeName = getUser(assignment.assigned_to)?.display_name || assignment.assigned_to;
      const assigner = await client.users.fetch(assignment.assigned_by);
      await assigner.send({ content: `📅 **${assigneeName}**'s task deadline for "${assignment.title}" has been extended to **<t:${Math.floor(new Date(new_due_date).getTime()/1000)}:F>** — performance adjustment approved by ${approved_by || 'admin'}.` });
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
  const { action, discordId, caseRef, notes, newPosition, targetName } = req.body;
  if (!action || !discordId) return res.status(400).json({ ok: false, error: 'action and discordId required' });

  try {
    const { removeAllStaffRoles, kickFromAllServers, restorePositionRoles } = await import('./utils/roleManager.js');
    const { addInfraction } = await import('./utils/botDb.js');
    const { logAction } = await import('./utils/logger.js');
    const { POSITIONS, ALL_MANAGED_ROLES } = await import('./utils/positions.js');
    const { ALL_SERVER_IDS } = await import('./config.js');

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
        if (newPosition && POSITIONS[newPosition]) {
          for (const gid of ALL_SERVER_IDS) {
            try {
              const guild = await client.guilds.fetch(gid).catch(() => null);
              if (!guild) continue;
              const member = await guild.members.fetch(discordId).catch(() => null);
              if (!member) continue;
              for (const roleName of POSITIONS[newPosition]) {
                const role = guild.roles.cache.find(r => r.name === roleName);
                if (role && !member.roles.cache.has(role.id)) await member.roles.add(role).catch(() => {});
              }
              results.servers.push(guild.name);
            } catch (e) { results.errors.push(e.message); }
          }
        }
        break;
      }
    }

    await logAction(client, {
      action: `📋 Disciplinary Action (Portal): ${action}`,
      moderator: { discordId: 'PORTAL', name: 'Portal Case Management' },
      target: { discordId, name: targetName || discordId },
      reason: notes || caseRef || 'No reason',
      color: 0xEF4444,
      fields: [
        { name: 'Action', value: action, inline: true },
        { name: 'Servers', value: results.servers.join(', ') || 'None', inline: true },
      ]
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
    const user = await client.users.fetch(String(discord_id));
    if (embed) {
      await user.send({ embeds: [typeof embed === 'string' ? JSON.parse(embed) : embed] });
    } else {
      await user.send(message || 'No message provided');
    }

    // Send PDF attachment if provided
    if (pdf_buffer) {
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

// POST /api/send-channel — send embed to a Discord channel
webhookApp.post('/api/send-channel', async (req, res) => {
  if (!verifyBotSecret(req, res)) return;
  const { channel_id, embed, content } = req.body;
  if (!channel_id) return res.status(400).json({ error: 'channel_id required' });
  try {
    const channel = await client.channels.fetch(channel_id);
    const payload = {};
    if (content) payload.content = content;
    if (embed) payload.embeds = [typeof embed === 'string' ? JSON.parse(embed) : embed];
    await channel.send(payload);
    res.json({ ok: true });
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
    const STAFF_HQ = '1357119461957570570';
    const guild = client.guilds.cache.get(STAFF_HQ);
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

webhookApp.listen(3017, () => console.log('[CO Bot] Webhook server listening on port 3017'));

client.login(process.env.DISCORD_BOT_TOKEN);
