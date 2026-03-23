import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canRunCommand } from '../utils/permissions.js';
import { getDmExemptions, addDmExemption, removeDmExemption } from '../utils/botDb.js';
import { getUserByDiscordId } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('dm-exempt')
  .setDescription('Manage exemptions from mass/team DM notifications')
  .addSubcommand(sub =>
    sub.setName('add')
      .setDescription('Exempt a user from mass/team DMs')
      .addUserOption(opt => opt.setName('user').setDescription('User to exempt').setRequired(true))
      .addStringOption(opt => opt.setName('reason').setDescription('Reason (optional)').setRequired(false))
  )
  .addSubcommand(sub =>
    sub.setName('remove')
      .setDescription('Remove a user exemption')
      .addUserOption(opt => opt.setName('user').setDescription('User to un-exempt').setRequired(true))
  )
  .addSubcommand(sub =>
    sub.setName('list')
      .setDescription('View all exempt users')
  );

export async function execute(interaction) {
  const perm = canRunCommand(interaction.user.id, 5);
  if (!perm.allowed) return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });

  await interaction.deferReply({ ephemeral: true });

  const sub = interaction.options.getSubcommand();

  if (sub === 'add') {
    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');
    const moderatorPortalUser = getUserByDiscordId(interaction.user.id);
    const moderatorName = moderatorPortalUser?.display_name || interaction.user.username;

    const added = addDmExemption(target.id, target.username, moderatorName);

    if (!added) {
      return interaction.editReply({ content: `❌ **<@${target.id}>** is already exempt from mass DMs.` });
    }

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle('✅ User Exempted')
        .setColor(0x22c55e)
        .setDescription(`**${target.username}** (<@${target.id}>) has been exempted from all mass and team DMs.${reason ? `\n\n📋 Reason: ${reason}` : ''}`)
        .setFooter({ text: 'Community Organisation | Staff Assistant' })
        .setTimestamp()
      ]
    });
  }

  if (sub === 'remove') {
    const target = interaction.options.getUser('user');
    const removed = removeDmExemption(target.id);

    if (!removed) {
      return interaction.editReply({ content: `❌ **${target.username}** (<@${target.id}>) is not currently exempt.` });
    }

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle('✅ Exemption Removed')
        .setColor(0x22c55e)
        .setDescription(`**${target.username}** (<@${target.id}>) can now receive mass and team DMs again.`)
        .setFooter({ text: 'Community Organisation | Staff Assistant' })
        .setTimestamp()
      ]
    });
  }

  if (sub === 'list') {
    const exempts = getDmExemptions();

    if (exempts.length === 0) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('📋 DM Exemptions')
          .setColor(0x5865F2)
          .setDescription('No users are currently exempt from mass/team DMs.')
          .setFooter({ text: 'Community Organisation | Staff Assistant' })
          .setTimestamp()
        ]
      });
    }

    const rows = exempts.map(e =>
      `<@${e.discord_id}> — ${e.display_name || 'Unknown'}\n` +
      `   Added by: ${e.exempted_by} · ${new Date(e.created_at).toLocaleDateString('en-GB')}`
    );

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle(`📋 DM Exemptions (${exempts.length})`)
        .setColor(0x5865F2)
        .setDescription(rows.join('\n\n'))
        .setFooter({ text: 'Community Organisation | Staff Assistant' })
        .setTimestamp()
      ]
    });
  }
}
