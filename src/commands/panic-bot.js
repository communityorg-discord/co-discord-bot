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
import { E } from '../lib/emoji.js';
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
  .addStringOption(o => o.setName('reason').setDescription('Why are you killing the bot?').setRequired(true))
  .addBooleanOption(o => o.setName('scorched').setDescription('Also LEAVE every guild before stopping (default true — token compromise mode)'));

export async function execute(interaction) {
  const perm = await canUseCommand('panic-bot', interaction);
  if (!perm.allowed) return interaction.reply({ content: `${E.cross} ${perm.reason}`, flags: MessageFlags.Ephemeral });

  const reason = interaction.options.getString('reason');
  const scorched = interaction.options.getBoolean('scorched');
  const doScorch = scorched === null ? true : scorched;
  const who = interaction.user.tag;
  // Wrap reason in a code block so any markdown/mentions are rendered inert
  const safeReason = `\`\`\`\n${reason.replaceAll('`', "'")}\n\`\`\``;

  await interaction.reply({
    content: `${E.warning} **Bot stopping in 5-10 sec.**\nTriggered by: ${who}\nReason: ${safeReason}\nScorched earth (leave all guilds): **${doScorch}**\nDion + Evan have been DM'd reset instructions.\n\nTo restart:\n${RESET_INSTRUCTIONS}`,
    flags: MessageFlags.Ephemeral,
  });

  // DM the alert pair
  const ALERT = ['723199054514749450', '415922272956710912'];
  for (const uid of ALERT) {
    try {
      const u = await interaction.client.users.fetch(uid).catch(() => null);
      if (!u) continue;
      const dm = await u.createDM().catch(() => null);
      const aud = uid === '723199054514749450' ? 'you + Evan' : 'you + Dion';
      if (dm) await dm.send(`${E.warning} **Security alert · admin-only (${aud})**\n**BOT PANIC via /panic-bot**\nBy: ${who}\nReason: ${safeReason}\nScorched earth: **${doScorch}**\nTime: ${new Date().toUTCString()}\n\nReset instructions:\n${RESET_INSTRUCTIONS}`).catch(() => {});
    } catch {}
  }

  // Optional: leave every guild before stopping (so the still-valid token
  // can't be used to post as us in our servers until it's reset).
  setTimeout(async () => {
    if (doScorch) {
      const guilds = [...interaction.client.guilds.cache.values()];
      console.error(`[panic-bot] leaving ${guilds.length} guilds…`);
      await Promise.allSettled(guilds.map(g =>
        Promise.race([
          g.leave(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
        ]).catch(e => console.error(`[panic-bot] leave ${g.name} failed: ${e.message}`))
      ));
    }
    try { spawn('pm2', ['stop', 'co-discord-bot'], { detached: true, stdio: 'ignore' }).unref(); } catch {}
    setTimeout(() => process.exit(2), 2000);
  }, 3500);
}
