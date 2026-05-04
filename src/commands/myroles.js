// COMMAND_PERMISSION_FALLBACK: everyone
// "What roles do I have where?" — staff-facing utility. Shows the
// invoker's role list across every CO guild they're a member of, plus
// their portal position + auth level for context.
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { getUserByDiscordId } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('myroles')
  .setDescription('Show your roles across every CO server you are in');

export async function execute(interaction) {
  const perm = await canUseCommand('myroles', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;
  const portalUser = getUserByDiscordId(userId);
  const client = interaction.client;

  const perGuild = [];
  for (const [, g] of client.guilds.cache) {
    const member = await g.members.fetch(userId).catch(() => null);
    if (!member) continue;
    const roles = [...member.roles.cache.values()]
      .filter(r => r.id !== g.id)
      .sort((a, b) => b.position - a.position)
      .map(r => r.name);
    perGuild.push({ name: g.name, nickname: member.nickname, roles });
  }

  const embed = new EmbedBuilder()
    .setTitle(`🏷️ Your roles — ${portalUser?.display_name || interaction.user.username}`)
    .setColor(0x6366f1)
    .setThumbnail(interaction.user.displayAvatarURL());

  if (portalUser) {
    embed.addFields({
      name: 'Portal account',
      value: `**${portalUser.position || '—'}** (${portalUser.department || '—'}) · auth \`${portalUser.auth_level ?? '?'}\` · status \`${portalUser.account_status || '?'}\``,
      inline: false,
    });
  } else {
    embed.addFields({ name: 'Portal account', value: '❌ Not linked — run `/verify` to set up', inline: false });
  }

  if (!perGuild.length) {
    embed.addFields({ name: 'Guild roles', value: 'You are not in any CO guild the bot can see.', inline: false });
  } else {
    for (const g of perGuild.slice(0, 8)) {
      const nick = g.nickname ? ` _(nick: ${g.nickname})_` : '';
      const roles = g.roles.length ? g.roles.join(', ') : '_no roles_';
      embed.addFields({
        name: `${g.name}${nick}`,
        value: roles.slice(0, 1024),
        inline: false,
      });
    }
    if (perGuild.length > 8) {
      embed.addFields({
        name: `+ ${perGuild.length - 8} more guild(s)`,
        value: 'Discord caps embed fields at 25 — first 8 shown.',
        inline: false,
      });
    }
  }

  embed.setFooter({ text: `Need a role you should have? Ask IT — or run /sync-roles` }).setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}
