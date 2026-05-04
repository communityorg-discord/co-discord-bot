// COMMAND_PERMISSION_FALLBACK: everyone
// Pick a random member from a role — useful for spreading work
// fairly ("who reviews this?", "who triages this ticket?",
// "who's this week's notetaker?"). Optionally filters by online
// status so you don't pick someone offline.
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';

export const data = new SlashCommandBuilder()
  .setName('random-pick')
  .setDescription('Pick a random member from a role')
  .addRoleOption(opt => opt
    .setName('role')
    .setDescription('Role to pick from')
    .setRequired(true))
  .addBooleanOption(opt => opt
    .setName('online_only')
    .setDescription('Only pick from members currently online (or idle/dnd)'))
  .addIntegerOption(opt => opt
    .setName('count')
    .setDescription('How many to pick (default 1, max 10)')
    .setMinValue(1)
    .setMaxValue(10));

export async function execute(interaction) {
  const perm = await canUseCommand('random-pick', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });
  }
  await interaction.deferReply();

  const role = interaction.options.getRole('role');
  const onlineOnly = interaction.options.getBoolean('online_only') || false;
  const count = interaction.options.getInteger('count') || 1;

  await interaction.guild.members.fetch().catch(() => null);

  let pool = [...role.members.values()].filter(m => !m.user.bot);
  if (onlineOnly) {
    pool = pool.filter(m => {
      const s = m.presence?.status;
      return s === 'online' || s === 'idle' || s === 'dnd';
    });
  }

  if (!pool.length) {
    return interaction.editReply({
      content: onlineOnly
        ? `🪙 No-one with **${role.name}** is online right now.`
        : `🪙 **${role.name}** has no human members.`,
    });
  }

  // Fisher-Yates shuffle, take first N
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const winners = pool.slice(0, Math.min(count, pool.length));

  const embed = new EmbedBuilder()
    .setTitle(`🎲 ${winners.length === 1 ? 'And the lucky one is…' : `${winners.length} picked`}`)
    .setColor(role.color || 0x6366f1)
    .setDescription(winners.map(m => `🎉 <@${m.id}>`).join('\n'))
    .setFooter({
      text: `From @${role.name} — pool of ${pool.length}${onlineOnly ? ' (online only)' : ''} · picked by ${interaction.user.username}`,
    })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
