import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { logAction } from '../utils/logger.js';
import { setLogChannel, getLogChannel } from '../utils/botDb.js';

const ORGWIDE_LOG_TYPES = [
  { key: 'member_join', label: 'Member Join', emoji: '📥', description: 'When someone joins any CO server' },
  { key: 'member_leave', label: 'Member Leave', emoji: '📤', description: 'When someone leaves any CO server' },
  { key: 'role_change', label: 'Role Changes', emoji: '🎭', description: 'Role add/remove across all servers' },
  { key: 'channel_change', label: 'Channel Changes', emoji: '📁', description: 'Channel create/edit/delete across all servers' },
  { key: 'message_delete', label: 'Message Deletes', emoji: '🗑️', description: 'Deleted messages from all servers' },
  { key: 'verification', label: 'Verification', emoji: '✅', description: 'Verify/unverify across all servers' },
  { key: 'mod_action', label: 'Moderation Actions', emoji: '🛡️', description: 'Bans, kicks, timeouts from all servers' },
  { key: 'case_action', label: 'Case Actions', emoji: '📋', description: 'Case updates from all servers' },
  { key: 'dm_log', label: 'DM Log', emoji: '✉️', description: 'Bot DMs sent across all servers' },
];

function buildOverviewEmbed() {
  const bindings = ORGWIDE_LOG_TYPES.map(t => {
    const ch = getLogChannel('orgwide', 'orgwide', t.key);
    return `${t.emoji} **${t.label}**: ${ch ? `<#${ch}>` : '❌ Not set'}`;
  });

  return new EmbedBuilder()
    .setTitle('🏢 Organisation-Wide Log Channels')
    .setColor(0xf59e0b)
    .setDescription('These channels receive logs from **every CO server** — not just this one.\n\n' + bindings.join('\n'))
    .setFooter({ text: 'Community Organisation | Use /logspanel for per-server logs' })
    .setTimestamp();
}

function buildTypeSelect(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('orglogs_type')
      .setPlaceholder('Select an organisation log type to configure...')
      .setOptions(ORGWIDE_LOG_TYPES.map(t => ({
        label: t.label,
        emoji: t.emoji,
        value: t.key,
        description: t.description
      })))
      .setDisabled(disabled)
  );
}

export const data = new SlashCommandBuilder()
  .setName('orglogs')
  .setDescription('Configure organisation-wide log channels (logs from ALL servers)');

export async function execute(interaction) {
  await interaction.deferReply();

  const embed = buildOverviewEmbed();
  const row = buildTypeSelect();

  await interaction.editReply({
    content: '🏢 **Organisation Logs** — These channels receive events from **all CO servers**.',
    embeds: [embed],
    components: [row]
  });
}

export async function handleSelect(interaction) {
  if (interaction.customId !== 'orglogs_type') return;

  const typeKey = interaction.values[0];
  const typeMeta = ORGWIDE_LOG_TYPES.find(t => t.key === typeKey);
  if (!typeMeta) return;

  const modal = new ModalBuilder()
    .setCustomId(`orglogs_channel_${typeKey}`)
    .setTitle(`🏢 ${typeMeta.label} — Set Channel`);

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('channel_id')
        .setLabel('Channel ID (leave blank to disable)')
        .setStyle(1)
        .setPlaceholder('Paste the channel ID here')
        .setRequired(false)
    )
  );

  await interaction.showModal(modal);
}

export async function handleModal(interaction) {
  if (!interaction.customId.startsWith('orglogs_channel_')) return;

  const typeKey = interaction.customId.replace('orglogs_channel_', '');
  const typeMeta = ORGWIDE_LOG_TYPES.find(t => t.key === typeKey);
  if (!typeMeta) return;

  const channelIdInput = interaction.fields.getTextInputValue('channel_id').trim();
  let targetChannel = null;

  if (channelIdInput) {
    targetChannel = await interaction.guild.channels.fetch(channelIdInput).catch(() => null);
    if (!targetChannel) {
      return interaction.update({
        content: `❌ Channel ID "${channelIdInput}" not found in this server.`,
        components: []
      });
    }
    setLogChannel('orgwide', 'orgwide', typeKey, targetChannel.id);
  } else {
    setLogChannel('orgwide', 'orgwide', typeKey, null);
  }

  const embed = buildOverviewEmbed();
  const row = buildTypeSelect();

  await interaction.update({
    content: targetChannel
      ? `✅ ${typeMeta.emoji} **${typeMeta.label}** set to ${targetChannel} — logs from all servers will be sent here.`
      : `✅ ${typeMeta.emoji} **${typeMeta.label}** has been cleared.`,
    embeds: [embed],
    components: [row]
  });

  await logAction(interaction.client, {
    action: '🏢 Organisation Log Channel Configured',
    target: null,
    moderator: { discordId: interaction.user.id, name: interaction.user.username },
    color: 0xf59e0b,
    description: `Org-wide ${typeMeta.label} ${targetChannel ? `set to ${targetChannel}` : 'cleared'} by <@${interaction.user.id}>`,
    guildId: interaction.guildId
  });
}
