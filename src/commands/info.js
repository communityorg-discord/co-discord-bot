// COMMAND_PERMISSION_FALLBACK: everyone
// /info — friendly alias of /bot. Same system info card (version, uptime,
// servers, maintainers); just the name people instinctively reach for.
import { SlashCommandBuilder } from 'discord.js';
export { execute } from './bot.js';

export const data = new SlashCommandBuilder()
  .setName('info')
  .setDescription('About the CO Bot — version, uptime, servers, developers');
