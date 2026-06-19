// COMMAND_PERMISSION_FALLBACK: everyone
// /quote — attribute a quote to someone. Shows who said it (name + profile
// picture), the quote itself ("…" and/or an attached image), who quoted them,
// and optional context. Posts publicly so the channel can enjoy it.
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { E } from '../lib/emoji.js';

const isImageAttachment = (a) =>
  !!a && (/^image\//i.test(a.contentType || '') || /\.(png|jpe?g|gif|webp)$/i.test(a.name || ''));

export const data = new SlashCommandBuilder()
  .setName('quote')
  .setDescription('Quote someone — who said it, what they said, and who caught it')
  .addUserOption(opt => opt
    .setName('author')
    .setDescription('Who said the quote')
    .setRequired(true))
  .addStringOption(opt => opt
    .setName('quote')
    .setDescription('What they said (leave blank if you are quoting via an image)')
    .setMaxLength(1000))
  .addAttachmentOption(opt => opt
    .setName('image')
    .setDescription('Attach an image of the quote (optional)'))
  .addStringOption(opt => opt
    .setName('context')
    .setDescription('Optional context for the quote')
    .setMaxLength(500));

export async function execute(interaction) {
  const perm = await canUseCommand('quote', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });
  }

  const authorUser = interaction.options.getUser('author');
  const authorMember = interaction.options.getMember('author');
  const text = (interaction.options.getString('quote') || '').trim();
  const image = interaction.options.getAttachment('image');
  const context = (interaction.options.getString('context') || '').trim();

  // Need either words or a picture to quote.
  if (!text && !image) {
    return interaction.reply({
      content: `${E.cross} Give me a quote — type what they said, or attach an image of it.`,
      ephemeral: true,
    });
  }
  if (image && !isImageAttachment(image)) {
    return interaction.reply({
      content: `${E.cross} The attachment needs to be an image (png, jpg, gif or webp).`,
      ephemeral: true,
    });
  }

  // Who said it — guild display name + their avatar.
  const saidName = authorMember?.displayName || authorUser.globalName || authorUser.username;
  const saidAvatar = (authorMember ?? authorUser).displayAvatarURL?.() || authorUser.displayAvatarURL();
  // Who's quoting them.
  const quoterName = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;

  const embed = new EmbedBuilder()
    .setColor(0x6366f1)
    .setAuthor({ name: saidName, iconURL: saidAvatar })
    .setFooter({ text: `Quoted by ${quoterName}`, iconURL: interaction.user.displayAvatarURL() })
    .setTimestamp();

  if (text) embed.setDescription(`“${text}”`);
  if (image) embed.setImage(image.url);
  if (context) embed.addFields({ name: 'Context', value: context.slice(0, 1024) });

  return interaction.reply({ embeds: [embed] });
}
