import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { isSuperuser } from '../utils/verifyHelper.js';
import { getAuthLevelRole } from '../utils/positions.js';
import { ALL_SERVER_IDS } from '../config.js';
import { logAction } from '../utils/logger.js';
import { AUTH_OVERRIDE_LOG_CHANNEL_ID } from '../config.js';

export const data = new SlashCommandBuilder()
  .setName('authorisation-override')
  .setDescription('Override a user\'s authorisation level role (superusers only)')
  .addUserOption(opt =>
    opt.setName('user')
      .setDescription('Target user')
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

    if (!await isSuperuser(interaction.user.id)) {
      return interaction.editReply({ content: '❌ Only superusers can use this command.' });
    }

    const targetUser = interaction.options.getUser('user');
    const newAuthLevel = interaction.options.getInteger('level');
    const reason = interaction.options.getString('reason') || 'Not specified';

    if (!targetUser) {
      return interaction.editReply({ content: '❌ Invalid user. Provide a mention or user ID.' });
    }

    const targetUserId = targetUser.id;

    const newAuthLevelRoleName = getAuthLevelRole(newAuthLevel);

    // Uses ALL_SERVER_IDS from config.js

    let updated = 0;
    const results = [];
    let previousLevel = null;

    for (const guildId of ALL_SERVER_IDS) {
      try {
        const guild = await interaction.client.guilds.fetch(guildId);
        if (!guild) { results.push(`❌ ${guildId}: not found`); continue; }

        const member = await guild.members.fetch(targetUserId).catch(() => null);
        if (!member) { results.push(`⚠️ ${guild.name}: not a member`); continue; }

        const oldAuthRole = member.roles.cache.find(r => r.name.startsWith('Authorisation Level '));
        if (oldAuthRole) {
          if (previousLevel === null) previousLevel = parseInt(oldAuthRole.name.replace('Authorisation Level ', ''));
          await member.roles.remove(oldAuthRole).catch(e => console.warn(`[Auth Override] Remove error ${guild.name}: ${e.message}`));
          results.push(`🔄 ${guild.name}: removed ${oldAuthRole.name}`);
        }

        const newAuthRole = guild.roles.cache.find(r => r.name === newAuthLevelRoleName);
        if (newAuthRole) {
          await member.roles.add(newAuthRole).catch(e => console.warn(`[Auth Override] Add error ${guild.name}: ${e.message}`));
          results.push(`✅ ${guild.name}: added ${newAuthRole.name}`);
          updated++;
        } else {
          results.push(`⚠️ ${guild.name}: role not found`);
        }
      } catch (e) {
        results.push(`❌ ${guildId}: ${e.message}`);
      }
    }

    const embed = new EmbedBuilder()
      .setTitle(`🔐 Authorisation Override — Level ${newAuthLevel}`)
      .setColor(updated > 0 ? 0x22c55e : 0xef4444)
      .addFields(
        { name: 'Target', value: `<@${targetUserId}>`, inline: false },
        { name: 'New Auth Level', value: newAuthLevelRoleName, inline: false },
        { name: 'Reason', value: reason, inline: false },
        { name: 'Actioned By', value: `<@${interaction.user.id}>`, inline: false },
        { name: 'Results', value: results.join('\n').slice(0, 1024), inline: false },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    // Log to auth-override channel
    await logAction(interaction.client, {
      action: `🔐 Auth Override: Level ${previousLevel || 'None'} → Level ${newAuthLevel}`,
      moderator: { discordId: interaction.user.id, name: interaction.user.username },
      target: { discordId: targetUserId, name: targetUser.username },
      reason,
      color: updated > 0 ? 0x22c55e : 0xef4444,
      fields: [
        { name: 'Target', value: `<@${targetUserId}>`, inline: true },
        { name: 'Previous Level', value: previousLevel ? `Level ${previousLevel}` : 'None', inline: true },
        { name: 'New Level', value: newAuthLevelRoleName, inline: true },
        { name: 'Servers Updated', value: `${updated}/${ALL_SERVER_IDS.length}`, inline: true },
        { name: 'Results', value: results.join('\n').slice(0, 1024) || 'None', inline: false },
      ],
      specificChannelId: AUTH_OVERRIDE_LOG_CHANNEL_ID,
    });
  } catch (err) {
    console.error('[Auth Override] Error:', err.message);
    try {
      await interaction.editReply({ content: '❌ An error occurred.' });
    } catch (_) {}
  }
}
