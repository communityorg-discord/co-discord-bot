// COMMAND_PERMISSION_FALLBACK: superuser_only
// /panic-bot — superuser-only Discord command that immediately panics
// the bot. Same effect as the HTTP /api/bot/panic endpoint: DMs Dion +
// Evan with reset instructions, runs `pm2 stop co-discord-bot`, exits.
// PM2 will NOT auto-restart a manually-stopped process.
//
// Use when: the bot token has leaked, the bot is misbehaving in a way
// you can't immediately diagnose, you suspect a compromised account is
// running commands as the bot.

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { spawn } from 'child_process';

const RESET_INSTRUCTIONS = [
  '1. discord.com/developers/applications → CO bot → Bot tab → Reset Token',
  '2. SSH co-prod-01',
  '3. Edit ~/clawd/services/co-discord-bot/.env → DISCORD_BOT_TOKEN=<new>',
  '4. pm2 start co-discord-bot --update-env',
].join('\n');

export const data = new SlashCommandBuilder()
  .setName('panic-bot')
  .setDescription('EMERGENCY — immediately stop the bot. Token must be reset before restart.')
  .addStringOption(o => o.setName('reason').setDescription('Why are you killing the bot?').setRequired(true));

export async function execute(interaction) {
  const perm = await canUseCommand('panic-bot', interaction);
  if (!perm.allowed) return interaction.reply({ content: `❌ ${perm.reason}`, flags: MessageFlags.Ephemeral });

  const reason = interaction.options.getString('reason');
  const who = interaction.user.tag;

  await interaction.reply({
    content: `🛑 **Bot stopping in 5 sec.**\nTriggered by: ${who}\nReason: ${reason}\nDion + Evan have been DM'd reset instructions.\n\nTo restart:\n${RESET_INSTRUCTIONS}`,
    flags: MessageFlags.Ephemeral,
  });

  // DM the alert pair
  const ALERT = ['723199054514749450', '415922272956710912'];
  for (const uid of ALERT) {
    try {
      const u = await interaction.client.users.fetch(uid).catch(() => null);
      if (!u) continue;
      const dm = await u.createDM().catch(() => null);
      if (dm) await dm.send(`🚨 **BOT PANIC via /panic-bot**\nBy: ${who}\nReason: ${reason}\nTime: ${new Date().toUTCString()}\n\nReset instructions:\n${RESET_INSTRUCTIONS}`).catch(() => {});
    } catch {}
  }

  // Stop self via PM2 (detached) then exit
  setTimeout(() => {
    try { spawn('pm2', ['stop', 'co-discord-bot'], { detached: true, stdio: 'ignore' }).unref(); } catch {}
    setTimeout(() => process.exit(2), 2000);
  }, 3500);
}
