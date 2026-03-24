import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getUserByDiscordId } from '../db.js';
import { getInfractions, getActiveSuspension, getActiveInvestigation, getActiveGlobalBan } from '../utils/botDb.js';
import botDb from '../utils/botDb.js';

export const data = new SlashCommandBuilder()
  .setName('user')
  .setDescription('View information about a user')
  .addUserOption(opt => opt.setName('user').setDescription('User to look up').setRequired(false));

export async function execute(interaction) {
  try {
    const target = interaction.options.getUser('user') || interaction.user;
    const portalUser = getUserByDiscordId(target.id);
    const infractions = getInfractions(target.id);
    const suspension = getActiveSuspension(target.id);
    const investigation = getActiveInvestigation(target.id);
    const gban = getActiveGlobalBan(target.id);

    const verified = botDb.prepare("SELECT * FROM verified_members WHERE discord_id = ?").get(target.id);
    const lastQueue = botDb.prepare("SELECT * FROM verification_queue WHERE discord_id = ? ORDER BY id DESC LIMIT 1").get(target.id);
    const pendingQueue = botDb.prepare("SELECT * FROM verification_queue WHERE discord_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1").get(target.id);

    const verifyStatus = verified
      ? '✅ Verified'
      : pendingQueue
      ? `⏳ Pending (#${pendingQueue.id})`
      : lastQueue?.status === 'denied'
      ? '❌ Denied'
      : lastQueue?.status === 'unverified'
      ? '🔴 Unverified'
      : '❌ Not Verified';

    const embed = new EmbedBuilder()
      .setTitle(`👤 ${portalUser?.display_name || target.username}`)
      .setColor(0x5865F2)
      .setThumbnail(target.displayAvatarURL())
      .addFields(
        { name: 'Discord', value: `<@${target.id}>`, inline: true },
        { name: 'Account Created', value: `<t:${Math.floor(target.createdTimestamp / 1000)}:D>`, inline: true },
        { name: '\u200b', value: '\u200b', inline: true },
        { name: 'Portal Account', value: portalUser ? '✅ Linked' : '❌ Not linked', inline: true },
        { name: 'Position', value: portalUser?.position || 'N/A', inline: true },
        { name: 'Auth Level', value: portalUser?.auth_level ? `Level ${portalUser.auth_level}` : 'N/A', inline: true },
        { name: 'Employee ID', value: portalUser?.employee_number || 'N/A', inline: true },
        { name: 'Department', value: portalUser?.department || 'N/A', inline: true },
        { name: 'Account Status', value: portalUser?.account_status || 'N/A', inline: true },
        { name: '🔖 Verification Status', value: verifyStatus, inline: true },
        { name: '🏷️ Verified Nickname', value: verified?.nickname || 'N/A', inline: true },
        { name: '📋 Verified Position', value: verified?.position || 'N/A', inline: true },
        { name: '🗓️ Verified Since', value: verified?.verified_at ? `<t:${Math.floor(new Date(verified.verified_at).getTime() / 1000)}:D>` : 'N/A', inline: true },
        { name: '🔢 Last Request ID', value: lastQueue ? `#${lastQueue.id} (${lastQueue.status})` : 'None', inline: true },
        { name: '👤 Reviewed By', value: lastQueue?.reviewed_by ? `<@${lastQueue.reviewed_by}>` : 'N/A', inline: true },
        { name: '⚖️ Infractions', value: String(infractions.length), inline: true },
        { name: '🔍 Under Investigation', value: investigation ? '⚠️ Yes' : '✅ No', inline: true },
        { name: '🔴 Suspended', value: suspension ? '⚠️ Yes' : '✅ No', inline: true },
        { name: '🔨 Global Ban', value: gban ? '🔴 Yes' : '✅ No', inline: true },
        ...(lastQueue?.deny_reason ? [{ name: '❌ Last Denial Reason', value: lastQueue.deny_reason, inline: false }] : [])
      )
      .setFooter({ text: 'Community Organisation | Staff Portal' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  } catch (e) {
    console.error('[/user ERROR]', e);
    await interaction.reply({ content: 'Error: ' + e.message, ephemeral: true }).catch(() => {});
  }
}
