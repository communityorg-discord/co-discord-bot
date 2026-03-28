import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { db } from '../utils/botDb.js';
import { isSuperuser, canRunCommand } from '../utils/permissions.js';
import { randomBytes } from 'crypto';
import { postAllPanels } from '../services/automodPanels.js';
import { automod } from '../services/automod.js';

export const data = new SlashCommandBuilder()
  .setName('automod')
  .setDescription('AutoMod control system')
  .addSubcommand(sub => sub.setName('setup').setDescription('Post automod control panels to this channel (superuser only)'))
  .addSubcommand(sub => sub.setName('request-approval').setDescription('Request temporary elevated access for a protected action')
    .addStringOption(opt => opt.setName('action').setDescription('What you need to do').setRequired(true).addChoices(
      { name: 'Create Channel', value: 'create_channel' },
      { name: 'Create Role', value: 'create_role' },
      { name: 'Admin Access', value: 'admin_access' },
      { name: 'Other', value: 'other' }
    ))
    .addStringOption(opt => opt.setName('description').setDescription('Describe what you need').setRequired(true)));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'setup') {
    if (!isSuperuser(interaction.user.id)) {
      return interaction.reply({ content: '❌ Only superusers can set up automod panels.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const results = await postAllPanels(interaction.channel, interaction.guildId);
      await interaction.editReply({ content: `✅ AutoMod panels posted: ${results.join(', ')}. All management is now done via these panels.` });
    } catch (e) {
      console.error('[AutoMod Setup]', e.message);
      await interaction.editReply({ content: `❌ Failed to post panels: ${e.message}` });
    }
  }

  else if (sub === 'request-approval') {
    await interaction.deferReply({ ephemeral: true });

    const actionType = interaction.options.getString('action');
    const description = interaction.options.getString('description');
    const guildId = interaction.guildId;
    const token = randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    const config = automod.getConfig(guildId);

    db.prepare('INSERT INTO approval_requests (guild_id, requester_discord_id, requester_username, action_type, action_description, token, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(guildId, interaction.user.id, interaction.user.tag, actionType, description, token, expiresAt);
    const reqId = db.prepare('SELECT last_insert_rowid() as id').get().id;

    // Post to approval channel
    const APPROVAL_CHANNEL_ID = '1487556103364673616';
    try {
      const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import('discord.js');
      const approvalCh = await interaction.client.channels.fetch(APPROVAL_CHANNEL_ID).catch(() => null);
      if (approvalCh) {
        await approvalCh.send({
          content: `@here New approval request from <@${interaction.user.id}>`,
          embeds: [new EmbedBuilder()
            .setColor(0xF59E0B).setTitle('📋 Approval Request')
            .addFields(
              { name: 'Requester', value: `<@${interaction.user.id}>`, inline: true },
              { name: 'Action', value: actionType, inline: true },
              { name: 'Description', value: description, inline: false },
              { name: 'Expires', value: `<t:${Math.floor(Date.now() / 1000 + 1200)}:R>`, inline: true },
            ).setTimestamp()
          ],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`automod_approval_approve_${reqId}`).setLabel('Approve (20 min)').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`automod_approval_deny_${reqId}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
          )]
        });
      }
    } catch (e) { console.error('[Approval] Channel post failed:', e.message); }

    // Refresh approvals panel
    const { refreshPanel } = await import('../services/automodPanels.js');
    await refreshPanel(interaction.client, guildId, 'approvals');

    await interaction.editReply({ content: '✅ Approval request submitted. An EOB member will review it shortly.' });
  }
}
