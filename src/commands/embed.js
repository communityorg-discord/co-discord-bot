// COMMAND_PERMISSION_FALLBACK: auth_5
// Compose-and-post a rich embed via a 4-field modal. Saves staff
// from having to write embed JSON or use /scribe/etc for plain
// announcements. Posts to the chosen channel as the bot, with an
// optional accent colour.
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ChannelType,
  PermissionFlagsBits,
} from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { E } from '../lib/emoji.js';

const COLOR_CHOICES = [
  { name: 'Indigo (default)', value: 'indigo' },
  { name: 'Emerald (success)', value: 'emerald' },
  { name: 'Amber (warning)', value: 'amber' },
  { name: 'Red (alert)', value: 'red' },
  { name: 'Violet (info)', value: 'violet' },
  { name: 'Slate (neutral)', value: 'slate' },
];
const COLOR_HEX = {
  indigo: 0x6366f1, emerald: 0x22c55e, amber: 0xf59e0b,
  red: 0xef4444, violet: 0x8b5cf6, slate: 0x64748b,
};

export const data = new SlashCommandBuilder()
  .setName('embed')
  .setDescription('Compose and post a rich embed to a channel via the bot (auth 5+)')
  .addChannelOption(opt => opt
    .setName('channel')
    .setDescription('Where to post (default: current channel)')
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum))
  .addStringOption(opt => opt
    .setName('color')
    .setDescription('Accent colour')
    .addChoices(...COLOR_CHOICES));

export async function execute(interaction) {
  const perm = await canUseCommand('embed', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });
  }

  const target = interaction.options.getChannel('channel') || interaction.channel;
  const color = interaction.options.getString('color') || 'indigo';

  // Verify bot can post there before opening the modal — skip the modal
  // round-trip if the answer is going to be no.
  const me = await interaction.guild.members.fetchMe();
  const myPerms = target.permissionsFor(me);
  if (!myPerms?.has(PermissionFlagsBits.SendMessages) || !myPerms?.has(PermissionFlagsBits.EmbedLinks)) {
    return interaction.reply({
      content: `${E.cross} Bot can't post in ${target} — missing SendMessages or EmbedLinks. Run \`/bot-perms\` to audit.`,
      ephemeral: true,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId(`embed_modal:${target.id}:${color}`)
    .setTitle('Compose embed');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('title').setLabel('Title')
        .setStyle(TextInputStyle.Short).setMaxLength(256).setRequired(true),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('description').setLabel('Description (markdown supported)')
        .setStyle(TextInputStyle.Paragraph).setMaxLength(4000).setRequired(true),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('footer').setLabel('Footer (optional)')
        .setStyle(TextInputStyle.Short).setMaxLength(2048).setRequired(false),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('image_url').setLabel('Image URL (optional)')
        .setStyle(TextInputStyle.Short).setMaxLength(500).setRequired(false),
    ),
  );

  await interaction.showModal(modal);
}

export async function handleModalSubmit(interaction) {
  if (!interaction.customId.startsWith('embed_modal:')) return false;
  const [, channelId, color] = interaction.customId.split(':');
  const title = interaction.fields.getTextInputValue('title');
  const description = interaction.fields.getTextInputValue('description');
  const footer = interaction.fields.getTextInputValue('footer');
  const imageUrl = interaction.fields.getTextInputValue('image_url');

  await interaction.deferReply({ ephemeral: true });

  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    return interaction.editReply({ content: `${E.cross} Channel no longer accessible.` });
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(COLOR_HEX[color] || COLOR_HEX.indigo)
    .setTimestamp();
  if (footer) embed.setFooter({ text: footer });
  if (imageUrl && /^https:\/\//i.test(imageUrl)) {
    try { embed.setImage(imageUrl); } catch {}
  }

  try {
    const sent = await channel.send({ embeds: [embed] });
    await interaction.editReply({
      content: `${E.check} Posted to <#${channel.id}> — [jump to message](${sent.url})`,
    });
  } catch (e) {
    await interaction.editReply({ content: `${E.cross} Send failed: ${e.message}` });
  }
  return true;
}
