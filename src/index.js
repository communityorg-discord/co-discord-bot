import express from 'express';
import { Client, GatewayIntentBits, Collection, REST, Routes, StringSelectMenuBuilder, ActionRowBuilder, ButtonBuilder, EmbedBuilder, Partials } from 'discord.js';
import { config } from 'dotenv';
import { COMMAND_LOG_CHANNEL_ID, MESSAGE_DELETE_LOG_CHANNEL_ID, MESSAGE_EDIT_LOG_CHANNEL_ID, FULL_MESSAGE_LOGS_CHANNEL_ID } from './config.js';
import { getLogChannel, getGlobalLogChannel } from './utils/botDb.js';
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
  partials: [Partials.Channel, Partials.Message],
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates]
});

client.commands = new Collection();
const commands = [dm, dmExempt, purge, scribe, brag, leave, staff, cases, nid, suspend, unsuspend, investigate, terminate, gban, gunban, infractions, user, botInfo, unban, verify, unverify, authorisationOverride, cooldown, massUnban, logspanel, createTicketPanel, ticketPanelSend, deleteTicketPanel, ticketOptions, warn, timeout, kick, serverban, help, inbox, assign, acting, remind, onboard, eliminate, lockdown, automodCmd, stats, officeSetup];
for (const cmd of commands) {
  client.commands.set(cmd.data.name, cmd);
}

async function setupEmailNotificationChannels(client) {
  try {
    const guild = await client.guilds.fetch('1357119461957570570').catch(() => null);
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
      { inboxId: 'audit_vault', name: 'audit-vault-inbox' },
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

  // Process any pending acting assignments at midnight too
  scheduleAtTime(0, 1, async () => {
    try {
      const { db } = await import('./utils/botDb.js');
      const { applyActingRoles } = await import('./services/leaveRoles.js');
      const pending = db.prepare("SELECT * FROM acting_assignments WHERE status = 'pending'").all();
      for (const a of pending) {
        await applyActingRoles(client, a.acting_discord_id, a.position, a.leave_request_id, a.on_leave_discord_id, a.assigned_by);
        db.prepare("UPDATE acting_assignments SET status = 'active', started_at = datetime('now') WHERE id = ?").run(a.id);
      }
      if (pending.length) console.log(`[Acting Midnight] Activated ${pending.length} pending acting assignments`);
    } catch (e) { console.error('[Acting Midnight]', e.message); }
  }, 'Acting Midnight Cron');

  // Sunday 10AM — BRAG submission reminder
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

  // BRAG message count sync — push deltas to portal every 30 minutes
  async function syncBragCounts() {
    try {
      const { db: botDatabase } = await import('./utils/botDb.js');
      const weekKey = getBragWeekKey();

      // Get all counts for current week grouped by discord_id, only where there are unsent deltas
      const counts = botDatabase.prepare(`
        SELECT discord_id, SUM(message_count) as total_count, SUM(last_synced_count) as total_synced, MAX(last_message_id) as last_message_id
        FROM brag_message_counts
        WHERE week_key = ?
        GROUP BY discord_id
        HAVING SUM(message_count) > SUM(last_synced_count)
      `).all(weekKey);

      if (counts.length === 0) return;

      const countsObj = {};
      const lastIdsObj = {};
      for (const row of counts) {
        const delta = row.total_count - row.total_synced;
        if (delta > 0) {
          countsObj[row.discord_id] = delta;
          lastIdsObj[row.discord_id] = row.last_message_id;
        }
      }

      if (Object.keys(countsObj).length === 0) return;

      const res = await fetch('http://localhost:3016/api/brag/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-bot-secret': process.env.BOT_WEBHOOK_SECRET
        },
        body: JSON.stringify({
          counts: countsObj,
          lastIds: lastIdsObj,
          weekKey,
          syncType: 'scheduled_sync'
        })
      });

      const data = await res.json();
      console.log(`[BRAG Sync] Synced ${Object.keys(countsObj).length} users for week ${weekKey} — ${data.imported} imported`);

      // Update last_synced_count to match current message_count so we don't re-send
      botDatabase.prepare(`
        UPDATE brag_message_counts SET last_synced_count = message_count WHERE week_key = ?
      `).run(weekKey);
    } catch (e) {
      console.error('[BRAG Sync] Failed:', e.message);
    }
  }

  // Sync on startup
  const bragDb = (await import('./utils/botDb.js')).db;
  const bragWeek = getBragWeekKey();
  const bragStats = bragDb.prepare(`
    SELECT COUNT(DISTINCT discord_id) as users, COALESCE(SUM(message_count), 0) as total
    FROM brag_message_counts WHERE week_key = ?
  `).get(bragWeek);
  console.log(`[BRAG] Week ${bragWeek}: tracking ${bragStats?.users || 0} users, ${bragStats?.total || 0} total messages`);
  await syncBragCounts();

  // Schedule every 30 minutes
  setInterval(syncBragCounts, 30 * 60 * 1000);
  console.log('[BRAG Sync] Started — syncing to portal every 30 minutes');

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
});

client.on('interactionCreate', async interaction => {
  try {
  console.log('[Interaction]', interaction.type, interaction.isChatInputCommand() ? interaction.commandName : '');
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
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

    // DM acknowledgement button — dm_ack_<moderatorId> or dm_ack_<moderatorId>_<recipientId>
    if (interaction.customId.startsWith('dm_ack_')) {
      const parts = interaction.customId.split('_');
      const moderatorId = parts[2];
      const recipientId = parts[3] || null;

      await interaction.update({
        content: `✅ **Acknowledged.** The sender has been notified that you have read this message.`,
        embeds: [],
        components: []
      });

      try {
        const sender = await interaction.client.users.fetch(moderatorId).catch(() => null);
        if (sender) {
          await sender.send({
            content: `📧 **Acknowledgement received.** ${recipientId ? `<@${recipientId}>` : 'A recipient'} has confirmed reading your DM.`
          });
        }
      } catch {}
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
        `**${e.display_name || 'Unknown'}** — <@${e.discord_id}>\n   Added by: ${e.exempted_by} · ${new Date(e.created_at).toLocaleDateString('en-GB')}`
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
        `**${e.display_name || 'Unknown'}** — <@${e.discord_id}>\n   Added by: ${e.exempted_by} · ${new Date(e.created_at).toLocaleDateString('en-GB')}`
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
        `**${e.display_name || 'Unknown'}** — <@${e.discord_id}>\n   Added by: ${e.exempted_by} · ${new Date(e.created_at).toLocaleDateString('en-GB')}`
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
        `**${e.display_name || 'Unknown'}** — <@${e.discord_id}>\n   Added by: ${e.exempted_by} · ${new Date(e.created_at).toLocaleDateString('en-GB')}`
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

// AutoMod message handler + BRAG message tracking
client.on('messageCreate', async (message) => {
  try { await automod.checkMessage(message); } catch (e) { console.error('[AutoMod messageCreate]', e.message); }

  // BRAG message counting — track per user per guild per week
  if (!message.author.bot && message.guild && !message.system) {
    try {
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
    } catch (e) {
      // Silent fail — don't break message flow for counting
    }
  }
});

// Message delete log — tracked globally across all servers
client.on('messageDelete', async (message) => {
  if (!message || message.author?.bot) return;
  try {
    const deleteChannelId = MESSAGE_DELETE_LOG_CHANNEL_ID;
    const guildId = message.guildId;
    const perGuildChannelId = guildId ? getLogChannel(guildId, 'message', 'message_delete') : null;
    const globalChannelId = getGlobalLogChannel('global_message');

    if (!deleteChannelId && !FULL_MESSAGE_LOGS_CHANNEL_ID && !perGuildChannelId && !globalChannelId) return;

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

    // Also DM watched users (Evan + Dion)
    await sendToWatchedUsers(client, embed);
  } catch (e) {
    console.error('[messageDelete log error]', e.message);
  }
});

// Message edit log — tracked globally across all servers
client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (!oldMessage || !newMessage || oldMessage.author?.bot) return;
  if (oldMessage.content === newMessage.content) return;
  try {
    const editChannelId = MESSAGE_EDIT_LOG_CHANNEL_ID;
    const guildId = newMessage.guildId;
    const perGuildChannelId = guildId ? getLogChannel(guildId, 'message', 'message_edit') : null;
    const globalChannelId = getGlobalLogChannel('global_message');

    if (!editChannelId && !FULL_MESSAGE_LOGS_CHANNEL_ID && !perGuildChannelId && !globalChannelId) return;

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

// ============ BOT WEBHOOK SERVER ============
const webhookApp = express();
webhookApp.use(express.json());

function verifyBotSecret(req, res) {
  const secret = req.headers['x-bot-secret'];
  if (!secret || !process.env.BOT_WEBHOOK_SECRET || secret !== process.env.BOT_WEBHOOK_SECRET) {
    res.status(401).json({ error: 'Unauthorised' });
    return false;
  }
  return true;
}

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
          extensionNote: `Extended — Performance Adjustment approved by ${approved_by || 'admin'}. New due date: ${new Date(new_due_date).toLocaleDateString('en-GB')}`,
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
        .setDescription(`Your task deadline for **"${assignment.title}"** has been extended to **${new Date(new_due_date).toLocaleDateString('en-GB')}** following an approved performance adjustment.`)
        .setFooter({ text: 'Community Organisation | Staff Assistant' })
        .setTimestamp()
      ]});
    } catch {}

    // DM assigner
    try {
      const { getUserByDiscordId: getUser } = await import('./db.js');
      const assigneeName = getUser(assignment.assigned_to)?.display_name || assignment.assigned_to;
      const assigner = await client.users.fetch(assignment.assigned_by);
      await assigner.send({ content: `📅 **${assigneeName}**'s task deadline for "${assignment.title}" has been extended to **${new Date(new_due_date).toLocaleDateString('en-GB')}** — performance adjustment approved by ${approved_by || 'admin'}.` });
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
      default:
        console.log(`[Webhook] Unknown type: ${type}`);
    }

    res.json({ ok: true });
  } catch (e) {
    console.error(`[Webhook] Error handling ${type}:`, e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/send-dm — unified DM endpoint for portal
webhookApp.post('/api/send-dm', async (req, res) => {
  if (!verifyBotSecret(req, res)) return;
  const { discord_id, message, embed } = req.body;
  if (!discord_id) return res.status(400).json({ error: 'discord_id required' });
  try {
    const user = await client.users.fetch(String(discord_id));
    if (embed) {
      await user.send({ embeds: [typeof embed === 'string' ? JSON.parse(embed) : embed] });
    } else {
      await user.send(message || 'No message provided');
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('[DM API]', e.message);
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
