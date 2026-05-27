// COMMAND_PERMISSION_FALLBACK: everyone
// Detailed info on a Discord role — member count, position, perms,
// colour, who has it. Useful for "who's a Founder?", "what's this role for?",
// or auditing role membership at a glance.
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { E } from '../lib/emoji.js';

export const data = new SlashCommandBuilder()
  .setName('role-info')
  .setDescription('Detailed info on a Discord role: members, permissions, colour, position')
  .addRoleOption(opt => opt.setName('role').setDescription('The role to inspect').setRequired(true));

export async function execute(interaction) {
  const perm = await canUseCommand('role-info', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  const role = interaction.options.getRole('role');
  const guild = interaction.guild;
  if (!role || !guild) {
    return interaction.editReply({ content: `${E.cross} Role context required — run in a server.` });
  }

  // Force a member fetch so role.members is fresh
  await guild.members.fetch().catch(() => null);
  const members = role.members; // Collection<id, GuildMember>
  const memberCount = members.size;

  // Top 12 members by display name
  const topMembers = [...members.values()]
    .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''))
    .slice(0, 12)
    .map(m => `<@${m.id}>`)
    .join(', ');

  // Notable permissions (most powerful first)
  const NOTABLE = [
    ['Administrator', 'Administrator'],
    ['ManageGuild', 'Manage Server'],
    ['ManageChannels', 'Manage Channels'],
    ['ManageRoles', 'Manage Roles'],
    ['BanMembers', 'Ban Members'],
    ['KickMembers', 'Kick Members'],
    ['ManageMessages', 'Manage Messages'],
    ['MentionEveryone', '@everyone'],
    ['ManageWebhooks', 'Manage Webhooks'],
  ];
  const granted = NOTABLE
    .filter(([k]) => role.permissions.has(k))
    .map(([, label]) => label);

  const embed = new EmbedBuilder()
    .setTitle(`@${role.name}`)
    .setColor(role.color || 0x6b7280)
    .addFields(
      { name: 'ID', value: `\`${role.id}\``, inline: true },
      { name: 'Position', value: `${role.position} of ${guild.roles.cache.size}`, inline: true },
      { name: 'Members', value: String(memberCount), inline: true },
      { name: 'Colour', value: role.hexColor === '#000000' ? 'Default' : role.hexColor, inline: true },
      { name: 'Mentionable', value: role.mentionable ? 'Yes' : 'No', inline: true },
      { name: 'Hoisted', value: role.hoist ? 'Yes' : 'No', inline: true },
      { name: 'Created', value: `<t:${Math.floor(role.createdTimestamp / 1000)}:R>`, inline: false },
      { name: 'Notable permissions', value: granted.length ? granted.join(', ') : '_no special permissions_', inline: false },
    );

  if (topMembers) {
    embed.addFields({
      name: `Members (${memberCount > 12 ? `top 12 of ${memberCount}` : memberCount})`,
      value: topMembers.slice(0, 1024),
      inline: false,
    });
  }

  embed.setFooter({ text: guild.name }).setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}
