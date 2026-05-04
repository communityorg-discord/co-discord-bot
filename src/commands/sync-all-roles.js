// COMMAND_PERMISSION_FALLBACK: superuser_only
// Mass version of /sync-roles — iterates every verified_members row and
// re-applies position roles + Verified + CO | Staff across every guild
// the user is in. Use after a config change (POSITIONS map update,
// guild-wide role rename) to backfill drift in one shot.
//
// Long-running; defers reply, streams progress as a final embed.
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { POSITIONS } from '../utils/positions.js';
import { db as botDb } from '../utils/botDb.js';
import { getEffectiveAllServerIds } from '../config.js';

export const data = new SlashCommandBuilder()
  .setName('sync-all-roles')
  .setDescription('Re-apply position roles for EVERY verified staff member across every CO guild (superuser)')
  .addBooleanOption(opt => opt
    .setName('dry_run')
    .setDescription('Compute what would change without applying. Recommended first.'));

export async function execute(interaction) {
  const perm = await canUseCommand('sync-all-roles', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  const dryRun = interaction.options.getBoolean('dry_run') || false;
  const client = interaction.client;
  const verified = botDb.prepare('SELECT discord_id, position, nickname FROM verified_members').all();
  const serverIds = getEffectiveAllServerIds(client);

  let totalGranted = 0;
  let totalAlready = 0;
  let totalFailed = 0;
  const userResults = [];

  for (const v of verified) {
    const expectedRoleNames = [...(POSITIONS[v.position] || []), 'Verified', 'CO | Staff'];
    if (!expectedRoleNames.length) continue;

    let userGranted = 0;
    let userAlready = 0;
    let userFailed = 0;
    const guildBlocks = [];

    for (const gid of serverIds) {
      const guild = client.guilds.cache.get(gid) || await client.guilds.fetch(gid).catch(() => null);
      if (!guild) continue;
      const member = await guild.members.fetch(v.discord_id).catch(() => null);
      if (!member) continue;

      for (const roleName of expectedRoleNames) {
        const role = guild.roles.cache.find(r => r.name === roleName);
        if (!role) continue;
        if (member.roles.cache.has(role.id)) { userAlready++; continue; }
        if (dryRun) { userGranted++; continue; }
        try {
          await member.roles.add(role, `Mass /sync-all-roles by ${interaction.user.username}`);
          userGranted++;
        } catch (e) {
          userFailed++;
          guildBlocks.push(`${guild.name}/${role.name}: ${e.message}`);
        }
      }
    }
    totalGranted += userGranted;
    totalAlready += userAlready;
    totalFailed += userFailed;
    if (userGranted > 0 || userFailed > 0) {
      userResults.push({ discord_id: v.discord_id, position: v.position, granted: userGranted, failed: userFailed });
    }
  }

  const embed = new EmbedBuilder()
    .setTitle(dryRun ? '🔍 Mass role sync — dry run' : '🔄 Mass role sync — done')
    .setColor(dryRun ? 0xf59e0b : 0x22c55e)
    .setDescription(`Walked ${verified.length} verified member${verified.length === 1 ? '' : 's'} across ${serverIds.length} guild${serverIds.length === 1 ? '' : 's'}.`)
    .addFields(
      { name: dryRun ? 'Would grant' : 'Granted', value: String(totalGranted), inline: true },
      { name: 'Already had', value: String(totalAlready), inline: true },
      { name: 'Failed', value: String(totalFailed), inline: true },
    );

  if (userResults.length) {
    const lines = userResults.slice(0, 15).map(u =>
      `<@${u.discord_id}> (${u.position}) — ${dryRun ? 'would grant' : 'granted'} ${u.granted}${u.failed ? `, ${u.failed} failed` : ''}`
    );
    embed.addFields({
      name: `Per-user (${userResults.length} affected, top 15)`,
      value: lines.join('\n').slice(0, 1024),
      inline: false,
    });
  }

  embed.setFooter({ text: `Triggered by ${interaction.user.username}${dryRun ? ' — dry-run mode' : ''}` })
    .setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}
