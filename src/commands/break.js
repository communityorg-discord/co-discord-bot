// COMMAND_PERMISSION_FALLBACK: everyone
// /break — quick "I'm AFK for N minutes" announcer + auto-reminder.
// Posts a small embed in the current channel saying you're on a
// break, sets a /remind back to yourself when the timer's up. Saves
// the "brb 5" message + manual timer.
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { db } from '../utils/botDb.js';

export const data = new SlashCommandBuilder()
  .setName('break')
  .setDescription('Tell people you\'re AFK for N minutes — posts in channel + reminds you when the timer\'s up')
  .addIntegerOption(opt => opt
    .setName('minutes')
    .setDescription('How long? (1–180, default 15)')
    .setMinValue(1).setMaxValue(180))
  .addStringOption(opt => opt
    .setName('reason')
    .setDescription('Optional reason (lunch, focus block, errand, …)')
    .setMaxLength(100));

export async function execute(interaction) {
  const perm = await canUseCommand('break', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });
  }
  const minutes = interaction.options.getInteger('minutes') || 15;
  const reason = (interaction.options.getString('reason') || '').trim();
  const member = interaction.guild ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null) : null;
  const display = member?.displayName || interaction.user.username;

  const remindAt = new Date(Date.now() + minutes * 60_000);
  const ts = Math.floor(remindAt.getTime() / 1000);

  // Schedule a self-reminder via the existing reminders pipeline.
  try {
    db.prepare(`
      INSERT INTO reminders (requester_discord_id, target_discord_id, guild_id, channel_id, message, remind_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      interaction.user.id,
      interaction.user.id,
      interaction.guildId || null,
      interaction.channelId || null,
      `Break's over (${minutes}min · ${reason || 'no reason given'})`,
      remindAt.toISOString().slice(0, 19).replace('T', ' '),
    );
  } catch (e) {
    console.error('[break] reminder insert failed:', e.message);
  }

  const embed = new EmbedBuilder()
    .setAuthor({ name: `${display} is AFK`, iconURL: interaction.user.displayAvatarURL() })
    .setColor(0xf59e0b)
    .setDescription(`☕ Back <t:${ts}:R> (~${minutes} min)${reason ? `\n_${reason}_` : ''}`)
    .setFooter({ text: 'Set with /break — reminder goes back to me when the timer fires.' });

  await interaction.reply({ embeds: [embed] });
}
