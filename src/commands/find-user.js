// COMMAND_PERMISSION_FALLBACK: auth_5
// Cross-guild fuzzy user search — find a Discord user by partial username,
// display name, or nickname across every CO guild the bot is in. Returns
// a unique-by-discord-id list with which guilds they're in and (if available)
// their portal record. Saves staff from "I think their name was jake-something"
// dead-ends.
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { getEffectiveAllServerIds } from '../config.js';
import { db as botDb } from '../utils/botDb.js';
import { E } from '../lib/emoji.js';

export const data = new SlashCommandBuilder()
  .setName('find-user')
  .setDescription('Search every CO guild for users matching a name fragment')
  .addStringOption(opt => opt
    .setName('query')
    .setDescription('Substring to match against username, display name, or nickname')
    .setRequired(true)
    .setMinLength(2));

export async function execute(interaction) {
  const perm = await canUseCommand('find-user', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });

  const q = interaction.options.getString('query').trim().toLowerCase();
  const client = interaction.client;
  const serverIds = getEffectiveAllServerIds(client);

  // Pre-cache verified members so we can flag staff inline
  const verified = botDb.prepare('SELECT discord_id, position, nickname FROM verified_members').all();
  const verifiedMap = new Map(verified.map(v => [v.discord_id, v]));

  // discord_id → { username, displayName, guilds: Set<name> }
  const matches = new Map();

  for (const gid of serverIds) {
    const guild = client.guilds.cache.get(gid) || await client.guilds.fetch(gid).catch(() => null);
    if (!guild) continue;
    await guild.members.fetch().catch(() => null);

    for (const [, member] of guild.members.cache) {
      const u = member.user.username.toLowerCase();
      const dn = (member.displayName || '').toLowerCase();
      const gn = (member.user.globalName || '').toLowerCase();
      if (!u.includes(q) && !dn.includes(q) && !gn.includes(q)) continue;

      const existing = matches.get(member.id);
      if (existing) {
        existing.guilds.add(guild.name);
      } else {
        matches.set(member.id, {
          id: member.id,
          username: member.user.username,
          displayName: member.displayName,
          isBot: member.user.bot,
          guilds: new Set([guild.name]),
        });
      }
    }
  }

  if (matches.size === 0) {
    return interaction.editReply({
      content: `${E.investigate} No matches for \`${q}\` across ${serverIds.length} CO guild${serverIds.length === 1 ? '' : 's'}.`,
    });
  }

  const ranked = [...matches.values()]
    .sort((a, b) => b.guilds.size - a.guilds.size || a.username.localeCompare(b.username))
    .slice(0, 25);

  const lines = ranked.map(m => {
    const v = verifiedMap.get(m.id);
    const tag = v ? ` · ${E.staff} ${v.position}` : (m.isBot ? ` · ${E.bot} bot` : '');
    const guildStr = m.guilds.size === serverIds.length
      ? `all ${serverIds.length} guilds`
      : `${m.guilds.size}/${serverIds.length}`;
    return `<@${m.id}> \`${m.username}\` — ${m.displayName}${tag} (${guildStr})`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`${matches.size} match${matches.size === 1 ? '' : 'es'} for "${q}"`)
    .setColor(0x6366f1)
    .setDescription(lines.join('\n').slice(0, 4096))
    .setFooter({
      text: matches.size > 25
        ? `Showing top 25 of ${matches.size} (sorted by guild presence)`
        : `Across ${serverIds.length} CO guild${serverIds.length === 1 ? '' : 's'}`,
    })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
