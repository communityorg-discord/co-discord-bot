import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { isSuperuser } from '../utils/verifyHelper.js';
import { POSITIONS, getAuthLevelRole } from '../utils/positions.js';

export const data = new SlashCommandBuilder()
  .setName('authorisation-override')
  .setDescription('Override a user\'s authorisation level role (superusers only)')
  .addStringOption(opt =>
    opt.setName('user')
      .setDescription('User mention or ID')
      .setRequired(true)
  )
  .addIntegerOption(opt =>
    opt.setName('level')
      .setDescription('New authorisation level (1-7)')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(7)
  )
  .addStringOption(opt =>
    opt.setName('reason')
      .setDescription('Reason for the override')
      .setRequired(false)
  );

export async function execute(interaction) {
  try {
    await interaction.deferReply({ ephemeral: true });

    // Check superuser
    if (!await isSuperuser(interaction.user.id)) {
      return interaction.editReply({ content: '❌ Only superusers can use this command.' });
    }

    const userArg = interaction.options.getString('user').replace(/[<@!>]/g, '').trim();
    const newAuthLevel = interaction.options.getInteger('level');
    const reason = interaction.options.getString('reason') || 'Not specified';

    // Parse user ID
    const targetUserId = userArg.replace(/[^0-9]/g, '');
    if (!targetUserId) {
      return interaction.editReply({ content: '❌ Invalid user. Provide a mention or user ID.' });
    }

    const newAuthLevelRoleName = getAuthLevelRole(newAuthLevel);
    const oldAuthLevelRoleName = getAuthLevelRole(newAuthLevel); // we'll detect old dynamically

    // Get all CO servers
    const GUILD_IDS = [
      '1485422910972760176', // CO | Staff HQ
      '1485423163817988186', // CO | Private Server
      '1485423682980675729', // CO | System Log Hub
      '1485423935569920135', // CO | Communications
      '1485424535405723729', // CO | Appeals Hub
    ];

    let updated = 0;
    let failed = 0;
    const results = [];

    for (const guildId of GUILD_IDS) {
      try {
        const guild = await interaction.client.guilds.fetch(guildId);
        if (!guild) {
          results.push(`❌ ${guildId}: guild not found`);
          failed++;
          continue;
        }

        // Find the target member
        const member = await guild.members.fetch(targetUserId).catch(() => null);
        if (!member) {
          results.push(`⚠️ ${guild.name}: member not found`);
          failed++;
          continue;
        }

        // Find old auth level role (any Auth Level X role) and remove it
        const oldAuthRole = member.roles.cache.find(r => r.name.startsWith('Authorisation Level '));
        if (oldAuthRole) {
          await member.roles.remove(oldAuthRole).catch(e => {
            console.warn(`[Auth Override] Could not remove old auth role in ${guild.name}: ${e.message}`);
          });
          results.push(`🔄 ${guild.name}: removed ${oldAuthRole.name}`);
        }

        // Find and add the new auth level role
        const newAuthRole = guild.roles.cache.find(r => r.name === newAuthLevelRoleName);
        if (newAuthRole) {
          await member.roles.add(newAuthRole).catch(e => {
            console.warn(`[Auth Override] Could not add new auth role in ${guild.name}: ${e.message}`);
          });
          results.push(`✅ ${guild.name}: added ${newAuthRole.name}`);
          updated++;
        } else {
          results.push(`⚠️ ${guild.name}: role ${newAuthLevelRoleName} not found`);
          failed++;
        }
      } catch (e) {
        results.push(`❌ ${guildId}: ${e.message}`);
        failed++;
      }
    }

    const statusColor = updated > 0 ? 0x22c55e : 0xef4444;
    const embed = new EmbedBuilder()
      .setTitle(`🔐 Authorisation Override — Level ${newAuthLevel}`)
      .setColor(statusColor)
      .addFields(
        { name: 'Target User', value: `<@${targetUserId}>`, inline: false },
        { name: 'New Auth Level', value: newAuthLevelRoleName, inline: false },
        { name: 'Reason', value: reason, inline: false },
        { name: 'Actioned By', value: `<@${interaction.user.id}>`, inline: false },
      )
      .setTimestamp();

    // Add results as a field
    const resultText = results.join('\n');
    embed.addFields({ name: 'Results', value: resultText.slice(0, 1024), inline: false });

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error('[Auth Override] Error:', err.message);
    try {
      await interaction.editReply({ content: '❌ An error occurred.' });
    } catch (_) {}
  }
}
