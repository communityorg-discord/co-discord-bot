// One-off: ensure all active staff are in Staff HQ; DM single-use invites to those missing.
// Uses REST only (no gateway) to avoid colliding with the running bot session.
import { config } from 'dotenv';
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import Database from 'better-sqlite3';

config({ path: new URL('../.env', import.meta.url).pathname });

const STAFF_HQ_GUILD_ID = '1357119461957570570';
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const PORTAL_DB_PATH = process.env.PORTAL_DB_PATH;

if (!TOKEN) { console.error('DISCORD_BOT_TOKEN missing'); process.exit(1); }
if (!PORTAL_DB_PATH) { console.error('PORTAL_DB_PATH missing'); process.exit(1); }

const rest = new REST({ version: '10' }).setToken(TOKEN);
const db = new Database(PORTAL_DB_PATH, { readonly: true });

const staff = db.prepare(`
  SELECT id, username, display_name, full_name, position, discord_id
  FROM users
  WHERE lower(account_status) = 'active'
    AND discord_id IS NOT NULL AND discord_id != ''
  ORDER BY display_name ASC
`).all();

console.log(`[audit] ${staff.length} active staff with discord_id`);

// Pull all Staff HQ members (paginated, 1000/page)
const memberSet = new Set();
let after = '0';
while (true) {
  const page = await rest.get(Routes.guildMembers(STAFF_HQ_GUILD_ID), { query: new URLSearchParams({ limit: '1000', after }) });
  if (!page.length) break;
  for (const m of page) memberSet.add(m.user.id);
  if (page.length < 1000) break;
  after = page[page.length - 1].user.id;
}
console.log(`[audit] Staff HQ has ${memberSet.size} members`);

// Find a channel with CreateInstantInvite (we'll create one invite per missing user)
const channels = await rest.get(Routes.guildChannels(STAFF_HQ_GUILD_ID));
const guildResp = await rest.get(Routes.guild(STAFF_HQ_GUILD_ID));
const meId = (await rest.get(Routes.user('@me'))).id;

// Get bot member to compute permissions
const botMember = await rest.get(Routes.guildMember(STAFF_HQ_GUILD_ID, meId));
const botRoleIds = new Set(botMember.roles);

const roles = await rest.get(Routes.guildRoles(STAFF_HQ_GUILD_ID));
const roleById = Object.fromEntries(roles.map(r => [r.id, r]));
const everyoneRole = roleById[guildResp.id];

const PERM_ADMIN = 0x8n;
const PERM_CREATE_INVITE = 0x1n;
const PERM_VIEW_CHANNEL = 0x400n;

function basePerms() {
  let perms = BigInt(everyoneRole.permissions);
  for (const rid of botRoleIds) {
    const r = roleById[rid];
    if (r) perms |= BigInt(r.permissions);
  }
  return perms;
}
function channelPerms(channel) {
  let perms = basePerms();
  if (perms & PERM_ADMIN) return ~0n;
  // @everyone overwrite
  const everyoneOw = channel.permission_overwrites?.find(o => o.id === guildResp.id);
  if (everyoneOw) {
    perms &= ~BigInt(everyoneOw.deny);
    perms |= BigInt(everyoneOw.allow);
  }
  // role overwrites
  let allow = 0n, deny = 0n;
  for (const ow of channel.permission_overwrites || []) {
    if (ow.type === 0 && botRoleIds.has(ow.id)) {
      allow |= BigInt(ow.allow);
      deny |= BigInt(ow.deny);
    }
  }
  perms &= ~deny;
  perms |= allow;
  // member overwrite
  const memberOw = channel.permission_overwrites?.find(o => o.type === 1 && o.id === meId);
  if (memberOw) {
    perms &= ~BigInt(memberOw.deny);
    perms |= BigInt(memberOw.allow);
  }
  return perms;
}

const inviteChannel = channels
  .filter(c => [0, 5].includes(c.type)) // text or announcement
  .find(c => {
    const p = channelPerms(c);
    return (p & PERM_VIEW_CHANNEL) && (p & PERM_CREATE_INVITE);
  });

if (!inviteChannel) { console.error('No channel where bot can CreateInstantInvite'); process.exit(1); }
console.log(`[audit] Using #${inviteChannel.name} (${inviteChannel.id}) for invites`);

const missing = staff.filter(s => !memberSet.has(s.discord_id));
console.log(`[audit] ${missing.length} staff not in Staff HQ:`);
for (const s of missing) console.log(`  - ${s.display_name || s.full_name || s.username} (@${s.username}, ${s.position}, ${s.discord_id})`);

if (process.env.DRY_RUN) { console.log('\n[DRY_RUN=1] not sending DMs. Re-run without DRY_RUN to send.'); process.exit(0); }

const results = { invited: [], failed: [] };

for (const s of missing) {
  const label = `${s.display_name || s.full_name || s.username} (@${s.username}, ${s.discord_id})`;
  try {
    const invite = await rest.post(Routes.channelInvites(inviteChannel.id), {
      body: { max_age: 604800, max_uses: 1, unique: true, temporary: false },
      reason: `Audit: missing from Staff HQ — ${s.username}`
    });
    const dm = await rest.post(Routes.userChannels(), { body: { recipient_id: s.discord_id } });
    await rest.post(Routes.channelMessages(dm.id), {
      body: {
        embeds: [{
          title: '🏛️ Staff HQ Server Invite',
          color: 0x22C55E,
          description: `Hi ${s.display_name || s.username}, our records show you aren't currently in the **CO Staff HQ** Discord server. As a member of CO staff (${s.position}), you're required to be in Staff HQ.\n\nPlease join using the link below — it's single-use and expires in 7 days.`,
          fields: [{ name: 'Invite', value: `https://discord.gg/${invite.code}` }],
          footer: { text: 'Community Organisation | Staff Assistant' },
          timestamp: new Date().toISOString()
        }]
      }
    });
    console.log(`  ✅ ${label}`);
    results.invited.push({ ...s, invite: `https://discord.gg/${invite.code}` });
  } catch (e) {
    const code = e?.rawError?.code;
    const msg = e?.rawError?.message || e.message;
    let reason = `${code || ''} ${msg}`.trim();
    if (code === 50007) reason = 'DMs disabled / cannot DM (50007)';
    if (code === 10013) reason = 'Unknown user (10013) — discord_id may be stale';
    console.log(`  ❌ ${label} — ${reason}`);
    results.failed.push({ ...s, reason });
  }
}

console.log('\n──────── SUMMARY ────────');
console.log(`Already in Staff HQ:  ${staff.length - missing.length}`);
console.log(`Successfully DM'd:    ${results.invited.length}`);
console.log(`Failed to DM/invite:  ${results.failed.length}`);

if (results.invited.length) {
  console.log('\nInvited:');
  for (const r of results.invited) console.log(`  • ${r.display_name || r.username} (${r.position}) — ${r.invite}`);
}
if (results.failed.length) {
  console.log('\nFailed (action needed):');
  for (const r of results.failed) console.log(`  • ${r.display_name || r.username} (@${r.username}, ${r.discord_id}) — ${r.reason}`);
}
