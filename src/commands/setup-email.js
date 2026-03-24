import { SlashCommandBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, ActionRowBuilder } from 'discord.js';
import { savePersonalEmailSetup, getPersonalEmailSetup, removePersonalEmailSetup } from '../utils/botDb.js';
import { getUserByDiscordId } from '../db.js';

export const data = new SlashCommandBuilder()
  .setName('setup-email')
  .setDescription('Set up personal email monitoring — receive new emails via DM')
  .addSubcommand(sub => sub
    .setName('configure')
    .setDescription('Set up or update your personal email monitoring')
  )
  .addSubcommand(sub => sub
    .setName('status')
    .setDescription('Check your current email setup status')
  )
  .addSubcommand(sub => sub
    .setName('disable')
    .setDescription('Disable personal email monitoring')
  );

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'configure') {
    const portalUser = getUserByDiscordId(interaction.user.id);
    const userEmail = portalUser?.co_email || portalUser?.email || null;
    if (!userEmail) {
      return interaction.reply({
        content: '❌ No email address found for your account in the staff portal. Contact DMSPC to have your email set up first.',
        ephemeral: true,
      });
    }

    const modal = new ModalBuilder()
      .setCustomId('setup_email_modal')
      .setTitle('📧 Personal Email Setup');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('email_display')
          .setLabel('Your CO Email (read only)')
          .setStyle(1)
          .setValue(userEmail)
          .setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('imap_password')
          .setLabel('Your Email Password')
          .setStyle(1)
          .setPlaceholder('Enter your email account password')
          .setRequired(true)
      ),
    );

    await interaction.showModal(modal);
  }

  if (sub === 'status') {
    const setup = getPersonalEmailSetup(interaction.user.id);
    if (!setup) {
      return interaction.reply({
        content: '📭 No personal email monitoring configured. Run `/setup-email configure` to set it up.',
        ephemeral: true,
      });
    }

    const embed = new EmbedBuilder()
      .setTitle('📧 Personal Email Monitoring')
      .setColor(0x22C55E)
      .addFields(
        { name: '📮 Email Address', value: setup.co_email, inline: true },
        { name: '✅ Status', value: 'Active', inline: true },
        { name: '🖥️ IMAP Host', value: `${setup.imap_host}:${setup.imap_port}`, inline: true },
        { name: '📅 Configured', value: `<t:${Math.floor(new Date(setup.created_at).getTime() / 1000)}:R>`, inline: false },
      )
      .setFooter({ text: 'New emails are checked every minute and sent to your DMs' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (sub === 'disable') {
    removePersonalEmailSetup(interaction.user.id);
    return interaction.reply({
      content: '✅ Personal email monitoring disabled. Run `/setup-email configure` to re-enable.',
      ephemeral: true,
    });
  }
}

export async function handleModal(interaction) {
  if (interaction.customId !== 'setup_email_modal') return;

  const password = interaction.fields.getTextInputValue('imap_password').trim();
  const portalUser = getUserByDiscordId(interaction.user.id);

  const userEmail = portalUser?.co_email || portalUser?.email || null;
    if (!userEmail) {
    return interaction.reply({ content: '❌ CO email not found.', ephemeral: true });
  }

  const coEmail = portalUser.co_email || portalUser.email;

  await interaction.deferReply({ ephemeral: true });

  try {
    const { testImapConnection } = await import('../services/emailService.js');
    await testImapConnection({
      host: 'mail.mybustimes.cc',
      port: 993,
      user: coEmail,
      password,
      secure: true,
    });

    savePersonalEmailSetup(interaction.user.id, coEmail, password);

    return interaction.editReply({
      content: `✅ Email monitoring configured for **${coEmail}**.\n\nNew emails will be sent to your DMs every minute. Use \`/setup-email status\` to check your setup.`,
    });
  } catch (err) {
    return interaction.editReply({
      content: `❌ Could not connect to your email account: \`${err.message}\`\n\nPlease check your password and try again.`,
    });
  }
}
