// COMMAND_PERMISSION_FALLBACK: everyone
// Quick daily/weekly standup post. Three-field modal (yesterday /
// today / blockers); on submit, posts a clean embed to the current
// channel under the runner's name. No DB persistence — Discord is
// the system of record.
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';

export const data = new SlashCommandBuilder()
  .setName('standup')
  .setDescription('Post a quick standup (yesterday / today / blockers) to the current channel');

export async function execute(interaction) {
  const perm = await canUseCommand('standup', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });
  }
  if (!interaction.channel || !interaction.channel.isTextBased?.()) {
    return interaction.reply({ content: '❌ Run in a text channel.', ephemeral: true });
  }

  const modal = new ModalBuilder()
    .setCustomId(`standup_modal:${interaction.channelId}`)
    .setTitle('Standup');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('yesterday').setLabel('Yesterday')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('What did you finish?')
        .setMaxLength(700).setRequired(true),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('today').setLabel('Today')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('What will you focus on?')
        .setMaxLength(700).setRequired(true),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('blockers').setLabel('Blockers (optional)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Anything stopping you? "None" is a fine answer.')
        .setMaxLength(500).setRequired(false),
    ),
  );

  await interaction.showModal(modal);
}

export async function handleModalSubmit(interaction) {
  if (!interaction.customId.startsWith('standup_modal:')) return false;
  const [, channelId] = interaction.customId.split(':');
  const yesterday = interaction.fields.getTextInputValue('yesterday');
  const today = interaction.fields.getTextInputValue('today');
  const blockers = interaction.fields.getTextInputValue('blockers').trim();

  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    return interaction.reply({ content: '❌ Channel no longer accessible.', ephemeral: true });
  }

  const member = interaction.guild ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null) : null;
  const display = member?.displayName || interaction.user.username;

  const embed = new EmbedBuilder()
    .setAuthor({ name: `${display} — standup`, iconURL: interaction.user.displayAvatarURL() })
    .setColor(0x6366f1)
    .addFields(
      { name: '📌 Yesterday', value: yesterday.slice(0, 1024), inline: false },
      { name: '🎯 Today',     value: today.slice(0, 1024),     inline: false },
    )
    .setTimestamp();

  if (blockers && !/^(none|no|n\/a|nothing)\b/i.test(blockers)) {
    embed.addFields({ name: '🚧 Blockers', value: blockers.slice(0, 1024), inline: false });
    embed.setColor(0xf59e0b);
  } else if (blockers) {
    embed.setFooter({ text: 'No blockers 🟢' });
  }

  try {
    const sent = await channel.send({ embeds: [embed] });
    await interaction.reply({
      content: `✅ Standup posted — [jump](${sent.url})`,
      ephemeral: true,
    });
  } catch (e) {
    await interaction.reply({ content: `❌ Send failed: ${e.message}`, ephemeral: true });
  }
  return true;
}
