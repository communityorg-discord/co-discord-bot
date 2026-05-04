import { config } from 'dotenv';
config();

export const STAFF_HQ_ID = process.env.STAFF_HQ_ID;
export const NETWORK_SERVER_IDS = (process.env.NETWORK_SERVER_IDS || '').split(',').filter(Boolean);
export const ALL_SERVER_IDS = [
  ...(STAFF_HQ_ID ? [STAFF_HQ_ID] : []),
  ...NETWORK_SERVER_IDS
];

// Runtime helpers for code paths that need a list of CO guilds. The env
// vars above are often unset in practice (they aren't in .env right now)
// — without these helpers, every cross-guild loop silently iterates the
// empty array and does nothing. Fall back to "every guild the bot is
// currently in" when env config is empty.
export function getEffectiveAllServerIds(client) {
  if (ALL_SERVER_IDS.length > 0) return ALL_SERVER_IDS;
  return client?.guilds?.cache ? [...client.guilds.cache.keys()] : [];
}

// Same fallback for code paths that target the Staff HQ guild
// specifically (suspend/investigate role apply). Looks for a guild
// named "Staff HQ" first, then the largest guild as a last resort.
export function getEffectiveStaffHqId(client) {
  if (STAFF_HQ_ID) return STAFF_HQ_ID;
  if (!client?.guilds?.cache) return null;
  for (const [id, g] of client.guilds.cache) {
    if (g.name && g.name.toLowerCase().includes('staff hq')) return id;
  }
  let bestId = null, bestCount = -1;
  for (const [id, g] of client.guilds.cache) {
    const c = g.memberCount || 0;
    if (c > bestCount) { bestCount = c; bestId = id; }
  }
  return bestId;
}
export const SUSPENDED_ROLE_ID = process.env.SUSPENDED_ROLE_ID;
export const UNDER_INVESTIGATION_ROLE_ID = process.env.UNDER_INVESTIGATION_ROLE_ID;
export const APPEALS_SERVER_ID = process.env.APPEALS_SERVER_ID;
export const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
export const COMMAND_LOG_CHANNEL_ID = process.env.COMMAND_LOG_CHANNEL_ID;
const HARDCODED_SUPERUSER_IDS = [
  '723199054514749450',  // Dion M.
  '415922272956710912',  // Evan S.
  '1013486189891817563', // Hayden D.
];
const ENV_SUPERUSER_IDS = (process.env.SUPERUSER_IDS || '').split(',').filter(Boolean);
export const SUPERUSER_IDS = Array.from(new Set([...HARDCODED_SUPERUSER_IDS, ...ENV_SUPERUSER_IDS]));
export const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

// Re-export moderation log channel IDs from dedicated channels config
export {
  MOD_LOG_CHANNEL_ID,
  BAN_UNBAN_LOG_CHANNEL_ID,
  GBAN_UNGBAN_LOG_CHANNEL_ID,
  SUSPEND_UNSUSPEND_LOG_CHANNEL_ID,
  TERMINATE_LOG_CHANNEL_ID,
  STRIKE_LOG_CHANNEL_ID,
  INFRACTIONS_CASES_LOG_CHANNEL_ID,
  INVESTIGATION_LOG_CHANNEL_ID,
  PURGE_SCRIBE_LOG_CHANNEL_ID,
  VERIFY_UNVERIFY_LOG_CHANNEL_ID,
  DM_LOG_CHANNEL_ID,
  BRAG_LOG_CHANNEL_ID,
  STAFF_LOG_CHANNEL_ID,
  USER_LOG_CHANNEL_ID,
  NID_LOG_CHANNEL_ID,
  MESSAGE_DELETE_LOG_CHANNEL_ID,
  MESSAGE_EDIT_LOG_CHANNEL_ID,
  FULL_MESSAGE_LOGS_CHANNEL_ID,
  AUTH_OVERRIDE_LOG_CHANNEL_ID,
  COOLDOWN_LOG_CHANNEL_ID,
  MASS_UNBAN_LOG_CHANNEL_ID,
  ROLE_CREATE_LOG_CHANNEL_ID,
  ROLE_DELETE_LOG_CHANNEL_ID,
  ROLE_UPDATE_LOG_CHANNEL_ID,
  ROLE_PERMISSION_LOG_CHANNEL_ID,
  MEMBER_ROLE_ADD_LOG_CHANNEL_ID,
  MEMBER_ROLE_REMOVE_LOG_CHANNEL_ID,
  ROLE_ALL_LOG_CHANNEL_ID,
} from './config/channels.js';

export const OFFICIAL_BYPASS_IDS = ['878775920180228127', '1355367209249148928'];
