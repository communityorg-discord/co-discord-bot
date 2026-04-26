// COMMAND_PERMISSION_FALLBACK: auth_level >= 5
import { SlashCommandBuilder, EmbedBuilder, ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { canUseCommand } from '../utils/permissions.js';
import { getUserByDiscordId } from '../db.js';
import { POSITIONS } from '../utils/positions.js';
import { applyVerification } from '../utils/verifyHelper.js';
import { logAction } from '../utils/logger.js';
import { db } from '../utils/botDb.js';
import fetch from 'node-fetch';

const positionChoices = Object.keys(POSITIONS)
  .filter(p => !['CO | Official Account', 'Bot Developer', 'Founder'].includes(p))
  .slice(0, 25)
  .map(p => ({ name: p, value: p }));

export const data = new SlashCommandBuilder()
  .setName('onboard')
  .setDescription('Onboard a new staff member — credentials, roles, nickname, Drive folder')
  .addUserOption(opt => opt.setName('user').setDescription('The person to onboard').setRequired(true))
  .addStringOption(opt => opt.setName('position').setDescription('Their position').setRequired(true).addChoices(...positionChoices));

export async function execute(interaction) {
  const perm = await canUseCommand('onboard', interaction);
  if (!perm.allowed) {
    return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });
  }

  const targetUser = interaction.options.getUser('user');
  const position = interaction.options.getString('position');

  // Show nickname modal
  const modal = new ModalBuilder()
    .setCustomId(`onboard_nickname_${targetUser.id}_${position.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}`)
    .setTitle('Set Onboarding Nickname')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('nickname')
          .setLabel('Nickname (e.g. Evan S. | Secretary-General)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(32)
          .setPlaceholder('Firstname L. | Position')
      )
    );

  await interaction.showModal(modal);
}

export async function handleModal(interaction) {
  if (!interaction.customId.startsWith('onboard_nickname_')) return;

  await interaction.deferReply({ ephemeral: true });

  const parts = interaction.customId.replace('onboard_nickname_', '').split('_');
  const targetDiscordId = parts[0];
  const position = parts.slice(1).join(' ').replace(/_/g, ' ');
  const nickname = interaction.fields.getTextInputValue('nickname').trim();

  // Find the actual position from the encoded name
  const matchedPosition = Object.keys(POSITIONS).find(p => p.replace(/[^a-zA-Z0-9]/g, ' ').includes(position.replace(/_/g, ' '))) || position;

  const targetUser = await interaction.client.users.fetch(targetDiscordId).catch(() => null);
  if (!targetUser) return interaction.editReply({ content: '❌ Could not find that user.' });

  const steps = [];
  let portalUser = getUserByDiscordId(targetDiscordId);

  // Step 1 — Generate portal credentials
  let credentials = null;
  try {
    const resp = await fetch(`http://localhost:3016/api/admin-tools/generate-setup-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET },
      body: JSON.stringify({ discord_id: targetDiscordId, position: matchedPosition })
    });
    if (resp.ok) {
      credentials = await resp.json();
      steps.push('Portal credentials generated');
    } else {
      const err = await resp.json().catch(() => ({}));
      steps.push(`Portal credentials: ${err.error || 'failed'}`);
    }
  } catch (e) {
    steps.push(`Portal credentials: ${e.message}`);
  }

  // Re-fetch portal user after setup
  portalUser = getUserByDiscordId(targetDiscordId);

  // Step 2 — DM credentials
  try {
    await targetUser.send({ embeds: [new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('👋 Welcome to Community Organisation')
      .setDescription('Welcome to the CO team! Your staff portal account has been set up.')
      .addFields(
        { name: '🌐 Portal URL', value: 'https://portal.communityorg.co.uk', inline: false },
        { name: '👤 Username', value: `\`${credentials?.username || portalUser?.username || 'N/A'}\``, inline: true },
        { name: '🔑 Temporary Password', value: `\`${credentials?.temp_password || 'Contact admin'}\``, inline: true },
        { name: '📌 Position', value: matchedPosition, inline: true },
        { name: '⚠️ Action Required', value: 'Please log in and change your password immediately. You will also be asked to set up 2FA on first login.', inline: false },
      )
      .setFooter({ text: 'Community Organisation | Keep these credentials private' })
      .setTimestamp()
    ]});
    steps.push('Credentials DM sent');
  } catch (e) {
    steps.push(`Credentials DM failed: ${e.message}`);
  }

  // Step 3 — Apply Discord roles
  let roleCount = 0;
  try {
    const results = await applyVerification(interaction.client, targetDiscordId, matchedPosition, nickname, {});
    roleCount = results.filter(r => r.success).length;

    // Save to verified_members
    db.prepare(`INSERT OR REPLACE INTO verified_members (discord_id, portal_id, position, auth_level, verified_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`)
      .run(targetDiscordId, portalUser?.id || null, matchedPosition, portalUser?.auth_level || 1);

    steps.push(`${roleCount} guild(s) roles applied`);
  } catch (e) {
    steps.push(`Role application failed: ${e.message}`);
  }

  // Step 4 — Trigger Drive folder
  try {
    if (portalUser?.id) {
      await fetch('http://localhost:3016/api/drive/backfill-staff-folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-bot-secret': process.env.BOT_WEBHOOK_SECRET },
        body: JSON.stringify({ user_id: portalUser.id })
      });
      steps.push('Drive folder creation queued');
    }
  } catch (e) {
    steps.push(`Drive folder: ${e.message}`);
  }

  // Reply
  await interaction.editReply({ embeds: [new EmbedBuilder()
    .setColor(0x22C55E)
    .setTitle('✅ Onboarding Complete')
    .setDescription(`**${targetUser.tag}** has been onboarded as **${matchedPosition}**.`)
    .addFields(
      { name: 'Nickname', value: nickname, inline: true },
      { name: 'Steps', value: steps.map((s, i) => `${i + 1}. ${s}`).join('\n'), inline: false },
    )
    .setFooter({ text: `Onboarded by ${interaction.user.username}` })
    .setTimestamp()
  ]});

  await logAction(interaction.client, {
    action: '👋 Staff Onboarded',
    moderator: { discordId: interaction.user.id, name: interaction.user.username },
    target: { discordId: targetDiscordId, name: nickname },
    reason: `Position: ${matchedPosition}`,
    color: 0x22C55E,
    fields: steps.map(s => ({ name: '​', value: s, inline: false })),
    logType: 'verification.verify_unverify',
    guildId: interaction.guildId
  });
}
