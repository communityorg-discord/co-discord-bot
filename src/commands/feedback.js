// COMMAND_PERMISSION_FALLBACK: everyone
// Quick feedback/bug-report channel — any staffer can /feedback,
// gets a 3-field modal, submission DMs the maintainers + posts to
// the bot maintainer channel. No portal page required.
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { E } from '../lib/emoji.js';

// Same maintainer set as /bot info
const MAINTAINER_IDS = [
  '723199054514749450', // dionm
  '415922272956710912', // evans
];

const KIND_LABEL = {
  bug: 'Bug',
  feature: 'Feature request',
  question: 'Question',
  other: 'Other',
};

export const data = new SlashCommandBuilder()
  .setName('feedback')
  .setDescription('Send a bug report, feature request, or feedback to the bot maintainers')
  .addStringOption(opt => opt
    .setName('kind')
    .setDescription('What kind of feedback?')
    .setRequired(true)
    .addChoices(
      { name: 'Bug — something broken', value: 'bug' },
      { name: 'Feature — would be nice if…', value: 'feature' },
      { name: 'Question — how do I…', value: 'question' },
      { name: 'Other', value: 'other' },
    ));

export async function execute(interaction) {
  const perm = await canUseCommand('feedback', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `${E.cross} ${perm.reason}`, ephemeral: true });
  }

  const kind = interaction.options.getString('kind');
  const modal = new ModalBuilder()
    .setCustomId(`feedback_modal:${kind}`)
    .setTitle(`${KIND_LABEL[kind]} — feedback`);

  const summaryInput = new TextInputBuilder()
    .setCustomId('summary')
    .setLabel('One-line summary')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(kind === 'bug' ? 'e.g. /sync-roles fails on IC guild' : 'Describe in one line')
    .setMaxLength(120)
    .setRequired(true);

  const detailInput = new TextInputBuilder()
    .setCustomId('detail')
    .setLabel(kind === 'bug' ? 'What happened? Steps to reproduce?' : 'Details / context')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder(kind === 'bug' ? 'Steps:\n1. …\n2. …\nExpected vs got.' : 'As much detail as you want')
    .setMaxLength(1500)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(summaryInput),
    new ActionRowBuilder().addComponents(detailInput),
  );

  await interaction.showModal(modal);
}

// Modal-submit handler — wired by interactionCreate dispatch on customId prefix.
export async function handleModalSubmit(interaction) {
  if (!interaction.customId.startsWith('feedback_modal:')) return false;
  const kind = interaction.customId.slice('feedback_modal:'.length);
  const summary = interaction.fields.getTextInputValue('summary');
  const detail = interaction.fields.getTextInputValue('detail');

  await interaction.deferReply({ ephemeral: true });

  // Persist for portal /admin/bot-feedback before doing anything else
  try {
    const { logFeedback } = await import('../utils/botDb.js');
    logFeedback({
      discordId: interaction.user.id,
      username: interaction.user.username,
      kind,
      summary,
      detail,
      guildId: interaction.guildId,
      guildName: interaction.guild?.name,
      channelId: interaction.channel?.id,
    });
  } catch (e) {
    console.error('[feedback persist]', e.message);
  }

  const guildName = interaction.guild?.name || 'DM';
  const embed = new EmbedBuilder()
    .setTitle(`${KIND_LABEL[kind] || kind} — ${summary}`)
    .setColor(kind === 'bug' ? 0xef4444 : kind === 'feature' ? 0x6366f1 : 0x22c55e)
    .setDescription(`${E.inbox} **Admin · feedback for you + Evan**`)
    .addFields(
      { name: 'From', value: `<@${interaction.user.id}> \`${interaction.user.username}\``, inline: true },
      { name: 'Server', value: guildName, inline: true },
      { name: 'Channel', value: interaction.channel ? `<#${interaction.channel.id}>` : '_dm_', inline: true },
      { name: 'Details', value: detail.slice(0, 1024), inline: false },
    )
    .setFooter({ text: 'CO Bot · /feedback' })
    .setTimestamp();

  let dmDelivered = 0;
  let dmFailed = 0;
  for (const id of MAINTAINER_IDS) {
    try {
      const u = await interaction.client.users.fetch(id);
      await u.send({ embeds: [embed] });
      dmDelivered++;
    } catch {
      dmFailed++;
    }
  }

  await interaction.editReply({
    content: dmDelivered > 0
      ? `${E.check} Thanks — your ${KIND_LABEL[kind] || kind} has been sent to ${dmDelivered} maintainer${dmDelivered === 1 ? '' : 's'}.${dmFailed ? ` (${dmFailed} couldn't be reached.)` : ''}`
      : `${E.warning} Could not deliver to any maintainer (${dmFailed} failed). Please ping <@${MAINTAINER_IDS[0]}> directly.`,
  });
  return true;
}
