import { config } from 'dotenv';
config();

export const STAFF_HQ_ID = process.env.STAFF_HQ_ID;
export const NETWORK_SERVER_IDS = (process.env.NETWORK_SERVER_IDS || '').split(',').filter(Boolean);
export const ALL_SERVER_IDS = [
  ...(STAFF_HQ_ID ? [STAFF_HQ_ID] : []),
  ...NETWORK_SERVER_IDS
];
export const SUSPENDED_ROLE_ID = process.env.SUSPENDED_ROLE_ID;
export const UNDER_INVESTIGATION_ROLE_ID = process.env.UNDER_INVESTIGATION_ROLE_ID;
export const APPEALS_SERVER_ID = process.env.APPEALS_SERVER_ID;
export const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
export const MOD_LOG_CHANNEL_ID = process.env.MOD_LOG_CHANNEL_ID;
export const COMMAND_LOG_CHANNEL_ID = process.env.COMMAND_LOG_CHANNEL_ID;
export const SUPERUSER_IDS = (process.env.SUPERUSER_IDS || '').split(',').filter(Boolean);
export const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

export const POSITION_ROLES = {
  "Secretary-General": ["Secretary-General", "Authorisation Level 7", "Executive Operations Board", "Board of Directors", "Extended Board of Directors"],
  "Deputy Secretary-General": ["Deputy Secretary-General", "Authorisation Level 7", "Executive Operations Board", "Board of Directors", "Extended Board of Directors"],
  "Chef de Cabinet": ["Chef de Cabinet", "Authorisation Level 7", "Executive Operations Board", "Board of Directors", "Extended Board of Directors"],
  "Senior Advisor to the Secretariat": ["Senior Advisor to the Secretariat", "Authorisation Level 7", "Executive Operations Board", "Board of Directors", "Extended Board of Directors"],
  "Director-General": ["Director-General", "Authorisation Level 7", "Executive Operations Board", "Board of Directors", "Extended Board of Directors"],
  "Under Secretary-General (DSS)": ["Under Secretary-General (DSS)", "Authorisation Level 6", "Board of Directors", "Extended Board of Directors", "Department for Safety and Security"],
  "Under Secretary-General (DMSPC)": ["Under Secretary-General (DMSPC)", "Authorisation Level 6", "Board of Directors", "Extended Board of Directors", "Department of Management Strategy, Policy and Compliance"],
  "Under Secretary-General (IC)": ["Under Secretary-General (IC)", "Authorisation Level 6", "Board of Directors", "Extended Board of Directors", "International Court"],
  "Under Secretary-General (DGACM)": ["Under Secretary-General (DGACM)", "Authorisation Level 6", "Board of Directors", "Extended Board of Directors", "Department of General Assembly and Conference Management"],
  "Under Secretary-General (DCOS)": ["Under Secretary-General (DCOS)", "Authorisation Level 6", "Board of Directors", "Extended Board of Directors", "Department of Communications and Operational Support"],
  "Assistant Secretary-General (DSS)": ["Assistant Secretary-General (DSS)", "Authorisation Level 5", "Extended Board of Directors", "Department for Safety and Security"],
  "Assistant Secretary-General (DMSPC)": ["Assistant Secretary-General (DMSPC)", "Authorisation Level 5", "Extended Board of Directors", "Department of Management Strategy, Policy and Compliance"],
  "Assistant Secretary-General (IC)": ["Assistant Secretary-General (IC)", "Authorisation Level 5", "Extended Board of Directors", "International Court"],
  "Assistant Secretary-General (DGACM)": ["Assistant Secretary-General (DGACM)", "Authorisation Level 5", "Extended Board of Directors", "Department of General Assembly and Conference Management"],
  "Assistant Secretary-General (DCOS)": ["Assistant Secretary-General (DCOS)", "Authorisation Level 5", "Extended Board of Directors", "Department of Communications and Operational Support"],
  "Director, Safety": ["Director, Safety", "Authorisation Level 4", "Department for Safety and Security"],
  "Director, Security": ["Director, Security", "Authorisation Level 4", "Department for Safety and Security"],
  "Director, Management Strategy": ["Director, Management Strategy", "Authorisation Level 4", "Department of Management Strategy, Policy and Compliance"],
  "Director, Policy and Compliance": ["Director, Policy and Compliance", "Authorisation Level 4", "Department of Management Strategy, Policy and Compliance"],
  "Director, Communications": ["Director, Communications", "Authorisation Level 4", "Department of Communications and Operational Support"],
  "Director, Operational Support": ["Director, Operational Support", "Authorisation Level 4", "Department of Communications and Operational Support"],
  "President of the General Assembly": ["President of the General Assembly", "Authorisation Level 4", "Department of General Assembly and Conference Management"],
  "Deputy Director, Safety": ["Deputy Director, Safety", "Authorisation Level 3", "Department for Safety and Security"],
  "Deputy Director, Security": ["Deputy Director, Security", "Authorisation Level 3", "Department for Safety and Security"],
  "Deputy Director, Management Strategy": ["Deputy Director, Management Strategy", "Authorisation Level 3", "Department of Management Strategy, Policy and Compliance"],
  "Deputy Director, Policy and Compliance": ["Deputy Director, Policy and Compliance", "Authorisation Level 3", "Department of Management Strategy, Policy and Compliance"],
  "Deputy Director, Communications": ["Deputy Director, Communications", "Authorisation Level 3", "Department of Communications and Operational Support"],
  "Deputy Director, Operational Support": ["Deputy Director, Operational Support", "Authorisation Level 3", "Department of Communications and Operational Support"],
  "Vice-President": ["Vice-President", "Authorisation Level 3"],
  "Vice-President of the General Assembly": ["Vice-President of the General Assembly", "Authorisation Level 3", "Department of General Assembly and Conference Management"],
  "Judge": ["Judge", "Authorisation Level 2", "International Court"],
  "Secretary of the General Assembly": ["Secretary of the General Assembly", "Authorisation Level 2", "Department of General Assembly and Conference Management"],
  "Registrar": ["Registrar", "Authorisation Level 1", "Department of General Assembly and Conference Management"],
  "Member of the General Assembly": ["Member of the General Assembly", "Authorisation Level 1", "Department of General Assembly and Conference Management"],
};
export const BAN_UNBAN_LOG_CHANNEL_ID = process.env.BAN_UNBAN_LOG_CHANNEL_ID;
export const GBAN_UNGBAN_LOG_CHANNEL_ID = process.env.GBAN_UNGBAN_LOG_CHANNEL_ID;
export const SUSPEND_UNSUSPEND_LOG_CHANNEL_ID = process.env.SUSPEND_UNSUSPEND_LOG_CHANNEL_ID;
export const TERMINATE_LOG_CHANNEL_ID = process.env.TERMINATE_LOG_CHANNEL_ID;
export const STRIKE_LOG_CHANNEL_ID = process.env.STRIKE_LOG_CHANNEL_ID;
export const INFRACTIONS_CASES_LOG_CHANNEL_ID = process.env.INFRACTIONS_CASES_LOG_CHANNEL_ID;
export const INVESTIGATION_LOG_CHANNEL_ID = process.env.INVESTIGATION_LOG_CHANNEL_ID;
export const PURGE_SCRIBE_LOG_CHANNEL_ID = process.env.PURGE_SCRIBE_LOG_CHANNEL_ID;
export const VERIFY_UNVERIFY_LOG_CHANNEL_ID = process.env.VERIFY_UNVERIFY_LOG_CHANNEL_ID;
export const DM_LOG_CHANNEL_ID = process.env.DM_LOG_CHANNEL_ID;
export const BRAG_LOG_CHANNEL_ID = process.env.BRAG_LOG_CHANNEL_ID;
export const STAFF_LOG_CHANNEL_ID = process.env.STAFF_LOG_CHANNEL_ID;
export const USER_LOG_CHANNEL_ID = process.env.USER_LOG_CHANNEL_ID;
export const NID_LOG_CHANNEL_ID = process.env.NID_LOG_CHANNEL_ID;
