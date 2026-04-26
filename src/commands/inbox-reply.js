// COMMAND_PERMISSION_FALLBACK: everyone
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getReply } from '../utils/botDb.js';
import { canUseCommand } from '../utils/permissions.js';

export const data = new SlashCommandBuilder()
  .setName('inbox-reply')
  .setDescription('View the contents of a sent inbox reply by code')
  .addStringOption(opt =>
    opt.setName('code')
      .setDescription('The reply code (e.g. A3F7K2)')
      .setRequired(true)
  );

export async function execute(interaction) {
  const perm = await canUseCommand('inbox-reply', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });
  }
  const code = interaction.options.getString('code').trim().toUpperCase();
  const reply = getReply(code);

  if (!reply) {
    return interaction.reply({ content: `❌ No reply found with code \`${code}\`.`, ephemeral: true });
  }

  const embed = new EmbedBuilder()
    .setTitle(`📋 Reply Code: ${code}`)
    .setColor(0x22C55E)
    .addFields(
      { name: '👤 Replied By', value: reply.replied_by_name || reply.replied_by_discord_id, inline: true },
      { name: '📅 Replied At', value: `<t:${Math.floor(new Date(reply.replied_at).getTime() / 1000)}:F>`, inline: true },
      { name: '📤 To', value: reply.reply_to || 'N/A', inline: true },
      { name: '📌 Subject', value: reply.reply_subject || 'N/A', inline: false },
      { name: '💬 Message', value: (reply.reply_body || '(no content)').slice(0, 1024), inline: false },
    )
    .setFooter({ text: 'CO Inbox System' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
