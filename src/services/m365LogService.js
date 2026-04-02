import { ClientSecretCredential } from '@azure/identity';
import { EmbedBuilder } from 'discord.js';

const credential = new ClientSecretCredential(
  process.env.MICROSOFT_TENANT_ID,
  process.env.MICROSOFT_CLIENT_ID,
  process.env.MICROSOFT_CLIENT_SECRET
);

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const CHANNEL_ID = '1488856926145085502';

let lastPollTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
let discordClient = null;

async function getToken() {
  const t = await credential.getToken('https://graph.microsoft.com/.default');
  return t.token;
}

async function graph(endpoint) {
  const token = await getToken();
  const res = await fetch(`${GRAPH_BASE}${endpoint}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) return null;
  return res.json();
}

async function postToDiscord(embed) {
  try {
    const channel = await discordClient.channels.fetch(CHANNEL_ID).catch(() => null);
    if (!channel) return;
    await channel.send({ embeds: [embed] });
  } catch (e) {
    console.error('[M365 Logs] Discord post failed:', e.message);
  }
}

// Colour code by activity type
const COLOR_MAP = {
  'Reset password': 0xf59e0b,
  'Reset password (by admin)': 0xf59e0b,
  'Change password': 0xf59e0b,
  'Change password (self-service)': 0xf59e0b,
  'Disable account': 0xef4444,
  'Enable account': 0x22c55e,
  'Add user': 0x5865F2,
  'Delete user': 0xef4444,
  'Update user': 0x6b7280,
  'Add member to group': 0x5865F2,
  'Remove member from group': 0xf59e0b,
  'Add group': 0x5865F2,
  'Delete group': 0xef4444,
  'Add member to role': 0x5865F2,
  'Remove member from role': 0xf59e0b,
  'Set license properties': 0x6b7280,
  'Assign license': 0x22c55e,
  'Remove license': 0xef4444,
  'Consent to application': 0xf59e0b,
  'Add app role assignment to service principal': 0x5865F2,
  'Add delegated permission grant': 0xf59e0b,
};

// Noisy events to skip
const IGNORED_ACTIVITIES = [
  'Update StsRefreshTokenValidFrom Timestamp',
  'Update Conditional Access policy',
];

async function checkAuditLogs() {
  const filter = `activityDateTime ge ${lastPollTime}`;
  const data = await graph(`/auditLogs/directoryAudits?$filter=${encodeURIComponent(filter)}&$top=30&$orderby=activityDateTime desc`);
  if (!data?.value) return 0;

  let posted = 0;

  for (const log of data.value) {
    if (IGNORED_ACTIVITIES.includes(log.activityDisplayName)) continue;

    const success = log.result === 'success';
    const color = COLOR_MAP[log.activityDisplayName] || (success ? 0x5865F2 : 0xef4444);

    const initiatedBy = log.initiatedBy?.user?.userPrincipalName
      || log.initiatedBy?.user?.displayName
      || log.initiatedBy?.app?.displayName
      || 'System';

    const targets = (log.targetResources || []).map(t =>
      t.userPrincipalName || t.displayName || t.id || 'Unknown'
    ).join(', ') || 'N/A';

    // Extract modified properties if available
    const modifiedProps = (log.targetResources?.[0]?.modifiedProperties || [])
      .filter(p => p.displayName && p.newValue && p.newValue !== '""')
      .slice(0, 3)
      .map(p => `${p.displayName}: ${p.oldValue || '(empty)'} -> ${p.newValue}`)
      .join('\n');

    const fields = [
      { name: 'Performed By', value: String(initiatedBy), inline: true },
      { name: 'Target', value: String(targets).slice(0, 256), inline: true },
      { name: 'Result', value: success ? 'Success' : `Failed: ${log.resultReason || 'Unknown'}`, inline: true },
      { name: 'Category', value: log.category || 'Unknown', inline: true },
    ];

    if (modifiedProps) {
      fields.push({ name: 'Changes', value: modifiedProps.slice(0, 1024), inline: false });
    }

    const timeStr = new Date(log.activityDateTime).toLocaleString('en-GB', { timeZone: 'Europe/London' });

    const embed = new EmbedBuilder()
      .setColor(color)
      .setAuthor({ name: 'M365 | Account Activity' })
      .setTitle(log.activityDisplayName)
      .addFields(fields)
      .setFooter({ text: `M365 Activity Log | ${timeStr}` })
      .setTimestamp(log.activityDateTime);

    await postToDiscord(embed);
    posted++;
    await new Promise(r => setTimeout(r, 400));
  }

  return posted;
}

export async function pollM365Logs() {
  try {
    const posted = await checkAuditLogs();
    if (posted > 0) console.log(`[M365 Logs] Posted ${posted} audit log entries`);
  } catch (e) {
    console.error('[M365 Logs] Poll error:', e.message);
  }
  lastPollTime = new Date().toISOString();
}

export function startM365LogPolling(client) {
  discordClient = client;

  if (!process.env.MICROSOFT_TENANT_ID || !process.env.MICROSOFT_CLIENT_ID) {
    console.log('[M365 Logs] Microsoft credentials not configured — skipping');
    return;
  }

  console.log('[M365 Logs] Started — polling every 5 minutes');
  pollM365Logs();
  setInterval(pollM365Logs, 5 * 60 * 1000);
}
