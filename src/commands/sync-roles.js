// COMMAND_PERMISSION_FALLBACK: auth_level >= 7
// Re-apply position roles for a single staff member across every guild
// the bot is in. Useful when roles drift (e.g. someone's position changed
// in the portal but the Discord roles weren't updated, or a guild had a
// role created/renamed and existing members didn't get a refresh).
//
// Reads the user's verified record from the bot DB so the role mapping
// matches what /verify originally granted.
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { POSITIONS } from '../utils/positions.js';
import { db as botDb } from '../utils/botDb.js';
import { getEffectiveAllServerIds } from '../config.js';
import { E } from '../lib/emoji.js';

export const data = new SlashCommandBuilder()
  .setName('sync-roles')
  .setDescription('Re-apply verified position roles for a staff member across every CO guild (auth 7+)')
  .addUserOption(opt => opt.setName('user').setDescription('The staff member whose roles to re-sync').setRequired(true));

export async function execute(interaction) {
  const perm = await canUseCommand('sync-roles', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  const target = interaction.options.getUser('user');
  const verified = botDb.prepare("SELECT * FROM verified_members WHERE discord_id = ?").get(target.id);
  if (!verified) {
    return interaction.editReply({ content: `${E.cross} <@${target.id}> isn't in the verified_members table — run /verify first, then re-sync.` });
  }

  const expectedRoleNames = [...(POSITIONS[verified.position] || []), 'Verified', 'CO | Staff'];
  if (!expectedRoleNames.length) {
    return interaction.editReply({ content: `${E.cross} No position-role mapping for '${verified.position}' — check the POSITIONS map in src/utils/positions.js.` });
  }

  const client = interaction.client;
  const serverIds = getEffectiveAllServerIds(client);
  const perGuild = [];
  for (const gid of serverIds) {
    const guild = client.guilds.cache.get(gid) || await client.guilds.fetch(gid).catch(() => null);
    if (!guild) { perGuild.push({ name: `(unknown ${gid})`, status: 'guild not in cache' }); continue; }
    const member = await guild.members.fetch(target.id).catch(() => null);
    if (!member) { perGuild.push({ name: guild.name, status: 'not a member' }); continue; }

    let granted = 0; const failed = [];
    for (const roleName of expectedRoleNames) {
      const role = guild.roles.cache.find(r => r.name === roleName);
      if (!role) continue; // role doesn't exist in this guild — skip silently
      if (member.roles.cache.has(role.id)) continue; // already has it
      try {
        await member.roles.add(role, `Re-sync via /sync-roles by ${interaction.user.username}`);
        granted++;
      } catch (e) {
        failed.push(`${role.name}: ${e.message}`);
      }
    }
    perGuild.push({
      name: guild.name,
      status: failed.length ? `${granted} added, ${failed.length} blocked` : `${granted} added`,
      failed,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle(`Role re-sync — ${verified.nickname || target.username}`)
    .setColor(0x6366f1)
    .setDescription(`${E.role} Position: **${verified.position}**\nRoles checked: \`${expectedRoleNames.join('`, `')}\``)
    .addFields(perGuild.slice(0, 24).map(g => ({
      name: g.name,
      value: g.failed?.length ? `${g.status}\n_${g.failed.slice(0, 3).join('; ')}_` : g.status,
      inline: false,
    })))
    .setFooter({ text: `Triggered by ${interaction.user.username}` })
    .setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}
