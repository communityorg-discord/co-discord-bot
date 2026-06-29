// COMMAND_PERMISSION_FALLBACK: everyone
// /help — lists the bot's slash commands, BUT only the ones the person running it
// can actually use. It checks each command through the real permission gate
// (canUseCommand), so it always matches what's enforced — no stale hardcoded
// list, and it respects the USGRP rank tiers + hidden CO commands automatically.
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { E } from '../lib/emoji.js';
import { BRAND } from '../utils/brand.js';

// Group commands into sections for a tidy display. Anything not listed falls
// under "Other". Order here is the display order.
const CATEGORY = {
  Moderation: ['warn', 'kick', 'timeout', 'untimeout', 'serverban', 'unban', 'purge', 'lockdown'],
  'Network Administration': ['gban', 'gunban', 'gnick', 'mass-unban', 'ban', 'terminate', 'network-verify', 'force-verify', 'access'],
  'Logs & Config': ['logspanel', 'orglogs', 'privatelogs', 'automod', 'server-health', 'bot-perms', 'audit-log', 'cooldown'],
  Tickets: ['create-ticket-panel', 'ticket-panel-send', 'ticket-panel-delete', 'ticket-options'],
  'Leave of Absence': ['loa', 'loa-panel'],
  'Info & Tools': ['panel', 'bot', 'info', 'ping', 'user', 'serverinfo', 'channel-info', 'role-info', 'who-is-here', 'help'],
  System: ['emergency', 'panic-bot', 'office'],
};
function categoryOf(name) {
  for (const [cat, names] of Object.entries(CATEGORY)) if (names.includes(name)) return cat;
  return 'Other';
}

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Show the commands you can use')
  .addStringOption(opt => opt.setName('search').setDescription('Filter to commands whose name or description matches this text'));

export async function execute(interaction) {
  const search = (interaction.options.getString('search') || '').trim().toLowerCase();
  await interaction.deferReply({ ephemeral: true });

  // Every loaded slash command (this is already the USGRP-visible set — hidden CO
  // commands aren't in the registry). Keep the ones THIS user can run.
  const all = [...interaction.client.commands.values()].map(c => ({
    name: c?.data?.name, desc: c?.data?.description || '',
  })).filter(c => c.name);

  const allowed = [];
  for (const c of all) {
    try { const perm = await canUseCommand(c.name, interaction); if (perm.allowed) allowed.push(c); } catch {}
  }

  let shown = allowed;
  if (search) shown = allowed.filter(c => c.name.toLowerCase().includes(search) || c.desc.toLowerCase().includes(search));
  shown.sort((a, b) => a.name.localeCompare(b.name));

  // Bucket into categories (display order from CATEGORY, then Other).
  const buckets = new Map();
  for (const c of shown) { const cat = categoryOf(c.name); if (!buckets.has(cat)) buckets.set(cat, []); buckets.get(cat).push(c); }
  const order = [...Object.keys(CATEGORY), 'Other'];

  const embed = new EmbedBuilder()
    .setColor(BRAND.color)
    .setTitle(`${BRAND.short} Bot — Your Commands`)
    .setDescription(
      shown.length
        ? (search
            ? `${E.info} **${shown.length}** of your commands match \`${search}\`.`
            : `${E.info} You can use **${shown.length}** command${shown.length === 1 ? '' : 's'}. Only what you have access to is shown.`)
        : (search ? `${E.info} None of your commands match \`${search}\`.` : `${E.info} You don't have access to any bot commands here.`)
    )
    .setFooter({ text: `${BRAND.footer} · more tools live in /panel` })
    .setTimestamp();

  for (const cat of order) {
    const list = buckets.get(cat);
    if (!list || !list.length) continue;
    embed.addFields({ name: cat, value: list.map(c => `\`/${c.name}\` — ${c.desc || '—'}`).join('\n'), inline: false });
  }

  await interaction.editReply({ embeds: [embed] });
}
