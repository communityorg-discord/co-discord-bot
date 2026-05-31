// COMMAND_PERMISSION_FALLBACK: everyone
// Fetch a Discord message by link and re-render it as a quote embed.
// Useful when staff want to surface a moment from one channel into
// another (or into a DM) with the bot's signature ephemeral receipt.
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { E } from '../lib/emoji.js';

// https://discord.com/channels/{guild_id}/{channel_id}/{message_id}
// or          discordapp.com (legacy host) — handle both.
const MESSAGE_LINK_RE = /^https?:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/(\d{17,20}|@me)\/(\d{17,20})\/(\d{17,20})\/?$/i;

export const data = new SlashCommandBuilder()
  .setName('quote')
  .setDescription('Fetch a Discord message by link and reformat as a quote embed')
  .addStringOption(opt => opt
    .setName('link')
    .setDescription('Message link — right-click → Copy Message Link')
    .setRequired(true))
  .addBooleanOption(opt => opt
    .setName('public')
    .setDescription('Post the quote visibly in this channel (default: ephemeral)'));

export async function execute(interaction) {
  const perm = await canUseCommand('quote', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });
  }

  const link = interaction.options.getString('link').trim();
  const isPublic = interaction.options.getBoolean('public') || false;

  const m = link.match(MESSAGE_LINK_RE);
  if (!m) {
    return interaction.reply({
      content: `${E.cross} That doesn't look like a Discord message link. Right-click a message → Copy Message Link.`,
      ephemeral: true,
    });
  }
  const [, guildId, channelId, messageId] = m;

  await interaction.deferReply({ ephemeral: !isPublic });

  // Bot must be in the source guild
  if (guildId !== '@me' && !interaction.client.guilds.cache.has(guildId)) {
    return interaction.editReply({ content: `${E.cross} Bot is not in the source server.` });
  }

  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased?.()) {
    return interaction.editReply({ content: `${E.cross} Couldn't access that channel.` });
  }

  const msg = await channel.messages.fetch(messageId).catch(() => null);
  if (!msg) {
    return interaction.editReply({ content: `${E.cross} Message not found (deleted or no read history).` });
  }

  const author = msg.author;
  const guild = msg.guild;
  const memberDisplay = guild ? (await guild.members.fetch(author.id).catch(() => null))?.displayName : author.username;

  const content = msg.content || '_(no text · embeds/attachments only)_';

  const embed = new EmbedBuilder()
    .setAuthor({
      name: `${memberDisplay || author.username} ${author.bot ? '[bot]' : ''}`,
      iconURL: author.displayAvatarURL(),
      url: msg.url,
    })
    .setDescription(`${E.inbox} ${content.slice(0, 4000)}`)
    .setColor(0x6366f1)
    .setTimestamp(msg.createdTimestamp)
    .setFooter({
      text: `${guild ? `${guild.name} · ` : ''}#${channel.name || 'dm'} · quoted by ${interaction.user.username}`,
    });

  if (msg.attachments.size > 0) {
    embed.addFields({ name: 'Attachments', value: `${msg.attachments.size} attachment${msg.attachments.size === 1 ? '' : 's'}`, inline: true });
  }

  // Forward image attachment as embed image (Discord only supports one)
  const firstImage = [...msg.attachments.values()].find(a => /image\//i.test(a.contentType || '') || /\.(png|jpe?g|gif|webp)$/i.test(a.name || ''));
  if (firstImage) {
    try { embed.setImage(firstImage.url); } catch {}
  }

  await interaction.editReply({ embeds: [embed] });
}
