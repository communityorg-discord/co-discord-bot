// COMMAND_PERMISSION_FALLBACK: everyone
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';

const CATEGORIES = [
  { name: 'Verification & Onboarding', emoji: '✅', commands: [
    { name: 'verify', desc: 'Submit a staff verification request' },
    { name: 'unverify', desc: 'Revoke a verified member\'s access (auth 5+)' },
    { name: 'onboard', desc: 'Full onboarding — credentials, roles, nickname, Drive (auth 5+)' },
    { name: 'force-verify', desc: 'Submit a verification on behalf of another user (superuser)' },
    { name: 'authorisation-override', desc: 'Override auth level (superuser)' },
    { name: 'gnick', desc: 'Set a nickname for a user across all servers (auth 6+)' },
    { name: 'sync-roles', desc: 'Re-apply position roles for a user across every guild (auth 7+)' },
    { name: 'sync-all-roles', desc: 'Mass re-apply position roles for ALL verified members (superuser)' },
  ]},
  { name: 'Moderation', emoji: '🛡️', commands: [
    { name: 'warn', desc: 'Warn a user — auto-escalates: 3 warnings = kick, 5 = ban' },
    { name: 'kick', desc: 'Kick from server (auth 5+)' },
    { name: 'timeout', desc: 'Timeout/mute a user (auth 5+)' },
    { name: 'untimeout', desc: 'Remove a timeout (auth 5+)' },
    { name: 'ban', desc: 'Temp/permanent ban all servers (superuser)' },
    { name: 'unban', desc: 'Unban from current server (auth 5+)' },
    { name: 'serverban', desc: 'Ban/unban current server only (auth 5+)' },
    { name: 'gban', desc: 'Global ban all CO servers (auth 7+)' },
    { name: 'gunban', desc: 'Remove global ban (auth 7+)' },
    { name: 'infractions', desc: 'View/delete infractions (auth 3+ / superuser)' },
    { name: 'purge', desc: 'Delete messages — channel, server, or global (auth 5+)' },
    { name: 'scribe', desc: 'Archive/format messages (auth 5+)' },
    { name: 'dm', desc: 'DM a user via the bot (auth 5+)' },
    { name: 'dm-exempt', desc: 'Manage DM exemptions (auth 5+)' },
    { name: 'mass-unban', desc: 'Bulk unban (auth 7+)' },
    { name: 'cooldown', desc: 'Rate-limit commands (superuser)' },
    { name: 'eliminate', desc: 'Remove all traces of a user (superuser)' },
  ]},
  { name: 'DMSPC & Cases', emoji: '📋', commands: [
    { name: 'suspend', desc: 'Suspend staff member (auth 5+)' },
    { name: 'unsuspend', desc: 'Lift suspension (auth 5+)' },
    { name: 'investigate', desc: 'Start investigation (auth 5+)' },
    { name: 'terminate', desc: 'Terminate staff member (superuser)' },
    { name: 'cases', desc: 'View portal cases for a user' },
    { name: 'case', desc: 'Look up a case by ref (e.g. CAS-2026-0001)' },
    { name: 'caseopen', desc: 'Open a new case in Case Management' },
    { name: 'nid', desc: 'Submit non-investigational disciplinary' },
    { name: 'acting', desc: 'Assign/end acting positions (superuser)' },
  ]},
  { name: 'Staff Info', emoji: '👤', commands: [
    { name: 'user', desc: 'Full user profile — portal data, infractions, leave, BRAG' },
    { name: 'staff', desc: 'Search staff directory' },
    { name: 'leave', desc: 'Check leave balance and requests' },
    { name: 'brag', desc: 'View latest BRAG report' },
    { name: 'aps', desc: 'Your Activity Points System summary for this week' },
    { name: 'whois', desc: 'Aggregate everything bot + portal know about a Discord user (auth 5+)' },
    { name: 'find-user', desc: 'Cross-guild fuzzy search for users by name fragment (auth 5+)' },
    { name: 'staff-online', desc: 'Verified staff who are currently online — sourced from Staff HQ presence' },
    { name: 'leaderboard', desc: 'Top staff this week — voice or messages' },
    { name: 'myroles', desc: 'Show your roles across every CO server' },
    { name: 'role-info', desc: 'Detailed info on a Discord role — members, perms, colour' },
    { name: 'serverinfo', desc: 'Comprehensive info about the current Discord server' },
    { name: 'channel-info', desc: 'Inspect a channel — type, slowmode, permissions, parent' },
    { name: 'audit-log', desc: 'Recent Discord audit-log entries — kicks, bans, role changes (auth 5+)' },
    { name: 'stats', desc: 'Organisation-wide statistics' },
  ]},
  { name: 'Security & AutoMod', emoji: '🔒', commands: [
    { name: 'automod setup', desc: 'Post AutoMod control panels (superuser)' },
    { name: 'automod request-approval', desc: 'Request 20-min elevated access' },
    { name: 'lockdown', desc: 'Lock/unlock channel, server, or global (auth 5+)' },
  ]},
  { name: 'Assignments', emoji: '📌', commands: [
    { name: 'assign', desc: 'Create task assignment for staff' },
    { name: 'remind', desc: 'Set a timed reminder' },
    { name: 'reminders', desc: 'List and cancel your pending reminders' },
    { name: 'break', desc: 'AFK announcer + auto-reminder (1-180 min)' },
    { name: 'snippet', desc: 'Save and reuse text snippets — save / use / list / delete' },
    { name: 'schedule-dm', desc: 'Schedule a DM to be sent later (auth 5+)' },
    { name: 'poll', desc: 'Create a poll' },
    { name: 'random-pick', desc: 'Pick N random members from a role (online-only filter optional)' },
    { name: 'standup', desc: 'Post a quick standup (yesterday / today / blockers) to the current channel' },
    { name: 'thanks', desc: 'Public kudos to a colleague — posts in channel + DMs them' },
    { name: 'kudos-leaderboard', desc: 'Top recipients of /thanks kudos (week / month / all-time)' },
    { name: 'my-kudos', desc: 'Personal kudos history — received + given counts + recent messages' },
    { name: 'todo', desc: 'Personal todo list — add / list / done / undo / remove / clear' },
  ]},
  { name: 'Voice & Recording', emoji: '🎙️', commands: [
    { name: 'office', desc: 'Manage voice-channel access control (superuser)' },
    { name: 'record', desc: 'Start/stop a voice-channel recording session' },
    { name: 'who-is-here', desc: 'See who\'s currently in voice channels (this server or all)' },
    { name: 'quote', desc: 'Fetch a Discord message by link and reformat as a quote embed' },
  ]},
  { name: 'Channels & Logs', emoji: '📡', commands: [
    { name: 'orglogs', desc: 'Configure organisation-wide log channels' },
    { name: 'privatelogs', desc: 'Configure private log channels (per-server)' },
    { name: 'counting', desc: 'Manage counting channels (auth 5+)' },
  ]},
  { name: 'Tickets & Email', emoji: '📧', commands: [
    { name: 'create-ticket-panel', desc: 'Create ticket panel (auth 7+)' },
    { name: 'ticket-panel-send', desc: 'Send panel to channel (auth 7+)' },
    { name: 'delete-ticket-panel', desc: 'Delete ticket panel (auth 7+)' },
    { name: 'ticket-options', desc: 'Configure ticket options (auth 7+)' },
    { name: 'inbox', desc: 'Access team email inboxes' },
    { name: 'inbox-reply', desc: 'View a sent inbox reply by code' },
    { name: 'compose', desc: 'Compose a new personal email from your CO address' },
    { name: 'setup-email', desc: 'Configure personal email' },
    { name: 'helpdesk', desc: 'Interact with the CO IT Help Desk' },
  ]},
  { name: 'Config & Info', emoji: '⚙️', commands: [
    { name: 'logspanel', desc: 'Configure log channels (auth 5+)' },
    { name: 'bot', desc: 'Bot info — version, uptime, servers' },
    { name: 'ping', desc: 'Bot ↔ Discord gateway ↔ portal latency check' },
    { name: 'timezone', desc: 'Show current time in common staff timezones (with optional in-Xh offset)' },
    { name: 'server-health', desc: 'Per-guild role/AutoMod/baseline-role audit (auth 7+)' },
    { name: 'bot-perms', desc: 'Per-channel audit of missing bot perms in this server (auth 5+)' },
    { name: 'feedback', desc: 'Send a bug report, feature request, or feedback to maintainers' },
    { name: 'embed', desc: 'Compose and post a rich embed to any channel via the bot (auth 5+)' },
    { name: 'links', desc: 'Quick-access list of important CO portal pages' },
    { name: 'help', desc: 'This command' },
  ]},
];

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Show all bot commands grouped by category')
  .addStringOption(opt => opt
    .setName('search')
    .setDescription('Filter to commands whose name or description matches this text'))
  .addBooleanOption(opt => opt
    .setName('mine')
    .setDescription('Filter to commands you can run based on your portal auth level'));

// Parse '(auth N+)' or '(superuser)' out of a description; returns the
// minimum auth level required, or null if the description doesn't say.
function requiredAuthLevel(desc) {
  const m = desc.match(/auth\s*(\d+)\+/i);
  if (m) return Number(m[1]);
  if (/superuser/i.test(desc)) return 99;
  return null;
}

export async function execute(interaction) {
  const perm = await canUseCommand('help', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });
  }
  const filterMine = interaction.options.getBoolean('mine') || false;
  const search = (interaction.options.getString('search') || '').trim().toLowerCase();
  let myAuth = 1;
  if (filterMine) {
    try {
      const { getUserByDiscordId } = await import('../db.js');
      const portalUser = getUserByDiscordId(interaction.user.id);
      if (portalUser?.auth_level) myAuth = Number(portalUser.auth_level);
    } catch {}
  }
  const visible = CATEGORIES.map(cat => ({
    ...cat,
    commands: cat.commands.filter(c => {
      if (filterMine) {
        const min = requiredAuthLevel(c.desc);
        if (min !== null && myAuth < min) return false;
      }
      if (search) {
        return c.name.toLowerCase().includes(search) || c.desc.toLowerCase().includes(search);
      }
      return true;
    }),
  })).filter(cat => cat.commands.length > 0);
  const totalCmds = visible.reduce((s, c) => s + c.commands.length, 0);

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('📚 CO Bot — Command Reference')
    .setDescription(
      search
        ? `**${totalCmds} match${totalCmds === 1 ? '' : 'es'}** for \`${search}\`\n\u200b`
        : `**${totalCmds} commands** across ${CATEGORIES.length} categories\n\u200b`
    )
    .setFooter({ text: 'Community Organisation | Staff Assistant' })
    .setTimestamp();

  for (const cat of visible) {
    embed.addFields({ name: `${cat.emoji} ${cat.name}`, value: cat.commands.map(c => `\`/${c.name}\` — ${c.desc}`).join('\n') + '\n\u200b', inline: false });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
