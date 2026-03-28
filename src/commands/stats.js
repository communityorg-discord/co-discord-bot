import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { db } from '../utils/botDb.js';
import { getUserByDiscordId } from '../db.js';
import Database from 'better-sqlite3';

export const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('View organisation-wide statistics');

export async function execute(interaction) {
  await interaction.deferReply();

  let portalDb;
  try { portalDb = new Database(process.env.PORTAL_DB_PATH, { readonly: true }); } catch { portalDb = null; }

  // Portal stats
  const activeStaff = portalDb?.prepare("SELECT COUNT(*) as c FROM users WHERE lower(account_status) = 'active'").get()?.c || 0;
  const totalStaff = portalDb?.prepare("SELECT COUNT(*) as c FROM users").get()?.c || 0;
  const onLeave = portalDb?.prepare("SELECT COUNT(*) as c FROM users WHERE lower(account_status) = 'on leave'").get()?.c || 0;
  const suspended = portalDb?.prepare("SELECT COUNT(*) as c FROM users WHERE lower(account_status) = 'suspended'").get()?.c || 0;
  const openCases = portalDb?.prepare("SELECT COUNT(*) as c FROM cases WHERE lower(status) IN ('open','new','pending')").get()?.c || 0;
  const pendingLeave = portalDb?.prepare("SELECT COUNT(*) as c FROM leave_requests WHERE lower(status) = 'pending'").get()?.c || 0;

  // BRAG this week
  const d = new Date(); const day = d.getDay(); const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff); d.setHours(0, 0, 0, 0);
  const weekKey = d.toISOString().slice(0, 10);
  const bragSubmitted = portalDb?.prepare("SELECT COUNT(*) as c FROM brag_reports WHERE week_key = ?").get(weekKey)?.c || 0;

  // Bot stats
  const totalInfractions = db.prepare("SELECT COUNT(*) as c FROM infractions WHERE deleted = 0").get().c;
  const activeWarnings = db.prepare("SELECT COUNT(*) as c FROM infractions WHERE type = 'warning' AND active = 1 AND deleted = 0").get().c;
  const verifiedMembers = db.prepare("SELECT COUNT(*) as c FROM verified_members").get().c;
  const activeSuspensions = db.prepare("SELECT COUNT(*) as c FROM suspensions WHERE active = 1").get().c;
  const automodIncidentsToday = db.prepare("SELECT COUNT(*) as c FROM automod_incidents WHERE created_at >= date('now')").get().c;
  const pendingReminders = db.prepare("SELECT COUNT(*) as c FROM reminders WHERE sent = 0").get().c;
  const activeLockdowns = db.prepare("SELECT COUNT(*) as c FROM lockdown_state WHERE is_active = 1").get().c;

  // Discord stats
  const guilds = interaction.client.guilds.cache;
  const totalMembers = guilds.reduce((s, g) => s + g.memberCount, 0);

  if (portalDb) try { portalDb.close(); } catch {}

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('📊 CO Organisation Statistics')
    .setDescription(`Real-time data from the portal, bot, and Discord.\n\u200b`)
    .addFields(
      { name: '👥 Staff', value: [
        `**Active:** ${activeStaff}`,
        `**Total:** ${totalStaff}`,
        `**On Leave:** ${onLeave}`,
        `**Suspended:** ${suspended}`,
        `**Verified (Discord):** ${verifiedMembers}`,
      ].join('\n'), inline: true },
      { name: '📋 Cases & Leave', value: [
        `**Open Cases:** ${openCases}`,
        `**Pending Leave:** ${pendingLeave}`,
        `**BRAG Submitted:** ${bragSubmitted} (w/c ${weekKey})`,
      ].join('\n'), inline: true },
      { name: '🛡️ Moderation', value: [
        `**Total Infractions:** ${totalInfractions}`,
        `**Active Warnings:** ${activeWarnings}`,
        `**Active Suspensions:** ${activeSuspensions}`,
        `**AutoMod Today:** ${automodIncidentsToday}`,
        `**Active Lockdowns:** ${activeLockdowns}`,
      ].join('\n'), inline: true },
      { name: '🌐 Discord', value: [
        `**Servers:** ${guilds.size}`,
        `**Total Members:** ${totalMembers}`,
        `**Pending Reminders:** ${pendingReminders}`,
        `**Bot Uptime:** <t:${Math.floor((Date.now() - interaction.client.uptime) / 1000)}:R>`,
      ].join('\n'), inline: true },
    )
    .setFooter({ text: 'Community Organisation | Staff Assistant' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
