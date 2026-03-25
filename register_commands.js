import { REST } from 'discord.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load env
const envContent = readFileSync('/home/vpcommunityorganisation/clawd/services/co-discord-bot/.env', 'utf8');
for (const line of envContent.split('\n')) {
  const idx = line.indexOf('=');
  if (idx > 0 && !line.startsWith('#')) {
    process.env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
}

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!BOT_TOKEN) { console.error('No BOT_TOKEN'); process.exit(1); }

// Import commands
const { data: infractionsData } = await import('/home/vpcommunityorganisation/clawd/services/co-discord-bot/src/commands/infractions.js');
const { data: banData } = await import('/home/vpcommunityorganisation/clawd/services/co-discord-bot/src/commands/ban.js');
const { data: unbanData } = await import('/home/vpcommunityorganisation/clawd/services/co-discord-bot/src/commands/unban.js');
const { data: gunbanData } = await import('/home/vpcommunityorganisation/clawd/services/co-discord-bot/src/commands/gunban.js');
const { data: untimeoutData } = await import('/home/vpcommunityorganisation/clawd/services/co-discord-bot/src/commands/untimeout.js');
const { data: terminateData } = await import('/home/vpcommunityorganisation/clawd/services/co-discord-bot/src/commands/terminate.js');
const { data: unsuspendData } = await import('/home/vpcommunityorganisation/clawd/services/co-discord-bot/src/commands/unsuspend.js');
const { data: verifyData } = await import('/home/vpcommunityorganisation/clawd/services/co-discord-bot/src/commands/verify.js');
const { data: unverifyData } = await import('/home/vpcommunityorganisation/clawd/services/co-discord-bot/src/commands/unverify.js');
const { data: userData } = await import('/home/vpcommunityorganisation/clawd/services/co-discord-bot/src/commands/user.js');
const { data: staffData } = await import('/home/vpcommunityorganisation/clawd/services/co-discord-bot/src/commands/staff.js');
const { data: casesData } = await import('/home/vpcommunityorganisation/clawd/services/co-discord-bot/src/commands/cases.js');
const { data: investigateData } = await import('/home/vpcommunityorganisation/clawd/services/co-discord-bot/src/commands/investigate.js');
const { data: dmData } = await import('/home/vpcommunityorganisation/clawd/services/co-discord-bot/src/commands/dm.js');
const { data: leaveData } = await import('/home/vpcommunityorganisation/clawd/services/co-discord-bot/src/commands/leave.js');
const { data: nidData } = await import('/home/vpcommunityorganisation/clawd/services/co-discord-bot/src/commands/nid.js');
const { data: purgeData } = await import('/home/vpcommunityorganisation/clawd/services/co-discord-bot/src/commands/purge.js');
const { data: scribeData } = await import('/home/vpcommunityorganisation/clawd/services/co-discord-bot/src/commands/scribe.js');
const { data: suspendData } = await import('/home/vpcommunityorganisation/clawd/services/co-discord-bot/src/commands/suspend.js');
const { data: unverify2Data } = await import('/home/vpcommunityorganisation/clawd/services/co-discord-bot/src/commands/unverify.js');
const { data: logspanelData } = await import('/home/vpcommunityorganisation/clawd/services/co-discord-bot/src/commands/logspanel.js');
const { data: strikeData } = await import('/home/vpcommunityorganisation/clawd/services/co-discord-bot/src/commands/strike.js');
const { data: setupEmailData } = await import('/home/vpcommunityorganisation/clawd/services/co-discord-bot/src/commands/setup-email.js');
const { data: warnData } = await import('/home/vpcommunityorganisation/clawd/services/co-discord-bot/src/commands/warn.js');
const { data: timeoutData } = await import('/home/vpcommunityorganisation/clawd/services/co-discord-bot/src/commands/timeout.js');

const commands = [
  infractionsData, banData, unbanData, gunbanData, untimeoutData, terminateData,
  unsuspendData, verifyData, unverifyData, userData, staffData, casesData,
  investigateData, dmData, leaveData, nidData, purgeData, scribeData, suspendData,
  logspanelData, strikeData, setupEmailData, warnData, timeoutData,
].filter(Boolean);

console.log(`Registering ${commands.length} commands...`);

const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
try {
  const me = await rest.get('/users/@me');
  console.log('Bot user:', me.username, me.id);

  await rest.put(
    `https://discord.com/api/v10/applications/${me.id}/commands`,
    { body: commands.map(c => c.toJSON()) }
  );
  console.log('Commands registered successfully!');
} catch (e) {
  console.error('Registration failed:', e.message);
  process.exit(1);
}
