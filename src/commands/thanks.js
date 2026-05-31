// COMMAND_PERMISSION_FALLBACK: everyone
// /thanks — peer recognition. Posts a public embed in the current
// channel, DMs the recipient, and logs to the kudos table so we can
// show a leaderboard later. Cannot thank yourself or a bot.
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { db } from '../utils/botDb.js';
import { E } from '../lib/emoji.js';

export const data = new SlashCommandBuilder()
  .setName('thanks')
  .setDescription('Send public recognition to a colleague (with optional DM)')
  .addUserOption(opt => opt
    .setName('user').setDescription('Who to thank').setRequired(true))
  .addStringOption(opt => opt
    .setName('for').setDescription('What you\'re thanking them for').setRequired(true).setMaxLength(800))
  .addBooleanOption(opt => opt
    .setName('dm_them').setDescription('Also DM them the kudos (default: true)'));

export async function execute(interaction) {
  const perm = await canUseCommand('thanks', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });
  }

  const target = interaction.options.getUser('user');
  const reason = interaction.options.getString('for');
  const dmThem = interaction.options.getBoolean('dm_them') ?? true;

  if (target.id === interaction.user.id) {
    return interaction.reply({ content: 'Modesty is a virtue — you can\'t thank yourself.', ephemeral: true });
  }
  if (target.bot) {
    return interaction.reply({ content: `${E.bot} Bots don't need encouragement.`, ephemeral: true });
  }

  // Persist before sending so the DB has it even if the channel send fails
  let inserted;
  try {
    inserted = db.prepare(`
      INSERT INTO kudos (from_discord_id, to_discord_id, message, guild_id, channel_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(interaction.user.id, target.id, reason, interaction.guildId || null, interaction.channelId || null);
  } catch (e) {
    return interaction.reply({ content: `${E.cross} Couldn't log: ${e.message}`, ephemeral: true });
  }

  // Pull recipient's recent kudos count for the celebratory footer
  const recentCount = db.prepare(`
    SELECT COUNT(*) c FROM kudos
    WHERE to_discord_id = ? AND created_at >= datetime('now', '-30 days')
  `).get(target.id).c;

  const embed = new EmbedBuilder()
    .setTitle('Kudos!')
    .setColor(0xfacc15)
    .setDescription(`${E.kudos} <@${interaction.user.id}> wants to thank <@${target.id}> for…\n\n> ${reason.split('\n').join('\n> ')}`)
    .setFooter({
      text: recentCount === 1
        ? 'First kudos for this staffer in the last 30 days'
        : `${recentCount} kudos for this staffer in the last 30 days`,
    })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });

  if (dmThem) {
    try {
      await target.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('You got kudos!')
            .setColor(0xfacc15)
            .setDescription(`${E.kudos} <@${interaction.user.id}> just sent you a public thanks for…\n\n> ${reason.split('\n').join('\n> ')}`)
            .setFooter({ text: `In ${interaction.guild?.name || 'a CO server'}` })
            .setTimestamp(),
        ],
      });
    } catch { /* DMs disabled — silent */ }
  }
}
