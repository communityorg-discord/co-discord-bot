// COMMAND_PERMISSION_FALLBACK: everyone (gated by personal email setup existing)
import { SlashCommandBuilder, ModalBuilder, TextInputBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getPersonalEmailSetup } from '../utils/botDb.js';
import { fetchEmailConfig } from '../services/emailService.js';
import { canUseCommand } from '../utils/permissions.js';

export const data = new SlashCommandBuilder()
  .setName('compose')
  .setDescription('Compose a new personal email (uses your CO email address)')
  .addStringOption(opt =>
    opt.setName('to')
      .setDescription('Recipient email address(es), comma separated')
      .setRequired(true)
  );

export async function execute(interaction) {
  const perm = await canUseCommand('compose', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });
  }
  const setup = getPersonalEmailSetup(interaction.user.id);
  if (!setup) {
    return interaction.reply({
      content: '❌ No personal email configured. Run `/setup-email configure` first.\n\nTo send from a **team inbox**, use `/inbox` instead.',
      ephemeral: true,
    });
  }

  const toInput = interaction.options.getString('to').trim();

  let ccOptions = [];
  try {
    const config = await fetchEmailConfig();
    ccOptions = Object.values(config).map(ib => ({
      label: `${ib.emoji} ${ib.name}`,
      value: ib.imap.user || ib.inbox_id,
      description: ib.description?.slice(0, 50) || '',
    })).filter(opt => opt.value);
  } catch { /* no cc options */ }

  if (ccOptions.length > 0) {
    const ccRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`personal_compose_cc|${encodeURIComponent(toInput)}`)
        .setPlaceholder('CC a team inbox (optional)...')
        .setMinValues(0)
        .setMaxValues(Math.min(ccOptions.length, 5))
        .addOptions(ccOptions.slice(0, 25))
    );
    const skipRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`personal_compose_skip|${encodeURIComponent(toInput)}`)
        .setLabel('Skip CC — Compose Now')
        .setStyle(ButtonStyle.Secondary),
    );
    return interaction.reply({
      content: `**✉️ Compose from ${setup.co_email} — Step 1:** CC a team inbox (optional):`,
      components: [ccRow, skipRow],
      ephemeral: true,
    });
  }

  return showPersonalComposeModal(interaction, toInput, '');
}

export async function showPersonalComposeModal(interaction, to, cc) {
  const modal = new ModalBuilder()
    .setCustomId(`personal_compose_submit|${encodeURIComponent(to)}|${encodeURIComponent(cc || '')}`)
    .setTitle('✉️ Compose Email');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('compose_to')
        .setLabel('To')
        .setStyle(1)
        .setValue(to || '')
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('compose_cc')
        .setLabel('CC (comma separated, optional)')
        .setStyle(1)
        .setValue(cc || '')
        .setPlaceholder('cc@example.com')
        .setRequired(false)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('compose_subject')
        .setLabel('Subject')
        .setStyle(1)
        .setPlaceholder('Email subject...')
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('compose_body')
        .setLabel('Message')
        .setStyle(2)
        .setPlaceholder('Write your message...')
        .setRequired(true)
    ),
  );
  await interaction.showModal(modal);
}
