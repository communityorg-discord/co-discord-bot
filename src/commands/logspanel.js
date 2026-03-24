import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, TextInputBuilder, ModalBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { logAction } from '../utils/logger.js';
import { getLogConfig, setLogChannel, getGlobalLogChannel, setGlobalLogChannel } from '../utils/botDb.js';

// Per-guild log categories and their types
const CATEGORIES = {
  moderation: {
    label: 'Moderation',
    emoji: '🛡️',
    types: {
      ban_unban: { label: 'Ban/Unban Logs' },
      gban_ungban: { label: 'Global Ban/Unban Logs' },
      suspend_unsuspend: { label: 'Suspend/Unsuspend Logs' },
      terminate: { label: 'Terminate Logs' },
      strike: { label: 'Strike Logs' },
      infractions_cases: { label: 'Infractions/Cases Logs' },
      investigation: { label: 'Investigation Logs' },
      purge_scribe: { label: 'Purge/Scribe Logs' },
      cooldown: { label: 'Cooldown Logs' },
      mass_unban: { label: 'Mass Unban Logs' },
    }
  },
  verification: {
    label: 'Verification',
    emoji: '✅',
    types: {
      verify_unverify: { label: 'Verify/Unverify Logs' },
      dm: { label: 'DM Logs' },
    }
  },
  message: {
    label: 'Message Activity',
    emoji: '💬',
    types: {
      message_delete: { label: 'Message Delete Logs' },
      message_edit: { label: 'Message Edit Logs' },
    }
  },
  misc: {
    label: 'Miscellaneous',
    emoji: '📋',
    types: {
      brag: { label: 'Brag Logs' },
      staff: { label: 'Staff Logs' },
      user: { label: 'User Logs' },
      nid: { label: 'NID Logs' },
    }
  },
  role_management: {
    label: 'Role Management',
    emoji: '🎭',
    types: {
      role_create: { label: 'Role Created Logs' },
      role_delete: { label: 'Role Deleted Logs' },
      role_update: { label: 'Role Updated Logs' },
      role_permission: { label: 'Role Permission Update Logs' },
      member_role_add: { label: 'Member Role Added Logs' },
      member_role_remove: { label: 'Member Role Removed Logs' },
    }
  }
};

// Global log categories — stored in global_log_config, applies across ALL servers
const GLOBAL_CATEGORIES = {
  global_moderation: {
    label: 'Global Moderation',
    emoji: '🌐',
    description: 'All moderation actions from all servers sent to one channel'
  },
  global_message: {
    label: 'Global Message Activity',
    emoji: '🌐',
    description: 'All message delete/edit events from all servers sent to one channel'
  },
  global_verification: {
    label: 'Global Verification',
    emoji: '🌐',
    description: 'All verify/unverify actions from all servers sent to one channel'
  },
  global_role_management: {
    label: 'Global Role Management',
    emoji: '🌐',
    description: 'All role management actions from all servers sent to one channel'
  }
};

// Build the info embed
function buildInfoEmbed(guildId) {
  const config = getLogConfig(guildId);
  const globalConfig = {};
  for (const [key, cat] of Object.entries(GLOBAL_CATEGORIES)) {
    globalConfig[key] = getGlobalLogChannel(key);
  }

  const rows = [];
  for (const [catKey, cat] of Object.entries(CATEGORIES)) {
    for (const [typeKey, type] of Object.entries(cat.types)) {
      const channelId = config[`${catKey}:${typeKey}`];
      const status = channelId ? `✅ <#${channelId}>` : '❌ Not set';
      rows.push(`**${cat.emoji} ${cat.label} > ${type.label}:** ${status}`);
    }
  }

  const globalRows = [];
  for (const [key, cat] of Object.entries(GLOBAL_CATEGORIES)) {
    const channelId = globalConfig[key];
    const status = channelId ? `✅ <#${channelId}>` : '❌ Not set';
    globalRows.push(`**${cat.emoji} ${cat.label}:** ${status}`);
  }

  function chunkString(str, maxLen) {
  const chunks = [];
  while (str.length > maxLen) {
    chunks.push(str.slice(0, maxLen));
    str = str.slice(maxLen);
  }
  chunks.push(str);
  return chunks;
}

  const orgwideRows = [];
  const orgwideTypes = ['member_join', 'member_leave', 'role_change', 'channel_change', 'message_delete', 'verification', 'mod_action', 'case_action', 'dm_log'];
  for (const t of orgwideTypes) {
    const ch = getLogConfig('orgwide', t);
    if (ch) orgwideRows.push(`[${t}] <#${ch}>`);
  }

  const orgwideTypes = ['member_join', 'member_leave', 'role_change', 'channel_change', 'message_delete', 'verification', 'mod_action', 'case_action', 'dm_log'];
  const orgwideRows = [];
  for (const t of orgwideTypes) {
    const ch = getLogConfig('orgwide', t);
    if (ch) orgwideRows.push(`[${t}] <#${ch}>`);
  }

  const allRows = [...globalRows, ...orgwideRows, ...rows];
  const fields = [];
  const content = allRows.join('\n') || 'No log channels configured yet.';
  const chunks = chunkString(content, 1020);
  for (let i = 0; i < chunks.length; i++) {
    fields.push({ name: i === 0 ? '📋 Log Channels' : `📋 Log Channels (cont. ${i + 1})`, value: chunks[i], inline: false });
  }
  fields.push({ name: '📌 Instructions', value: '1. Select a category below\n2. Choose a log type\n3. Pick a channel when prompted\n\nAll settings are optional.', inline: false });

  return new EmbedBuilder()
    .setTitle('⚙️ Log Channel Configuration Panel')
    .setColor(0x5865F2)
    .setDescription('Configure where different types of logs are sent.\n\nUse the selectors below to set a channel for each log type. All fields are optional — only selected log types will be configured.')
    .addFields(...fields)
    .setFooter({ text: 'Community Organisation | Staff Assistant' })
    .setTimestamp();
}

// Build category select menu
function buildCategorySelect(disabled = false) {
  const options = [
    {
      label: 'Global Logs',
      emoji: '🌐',
      value: 'cat_global_logs'
    },
    ...Object.entries(CATEGORIES).map(([key, cat]) => ({
      label: cat.label,
      emoji: cat.emoji,
      value: `cat_${key}`
    }))
  ];

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('logspanel_category')
      .setPlaceholder('Select a log category...')
      .setOptions(options)
      .setDisabled(disabled)
  );
}

// Build type select menu for a per-guild category
function buildTypeSelect(categoryKey, disabled = false) {
  const cat = CATEGORIES[categoryKey];
  if (!cat) return null;

  const options = Object.entries(cat.types).map(([key, type]) => ({
    label: type.label,
    value: `type_${categoryKey}_${key}`
  }));

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`logspanel_type_${categoryKey}`)
      .setPlaceholder(`Select a log type in ${cat.label}...`)
      .setOptions(options)
      .setDisabled(disabled)
  );
}

// Build global log type select
function buildGlobalTypeSelect(disabled = false) {
  const options = Object.entries(GLOBAL_CATEGORIES).map(([key, cat]) => ({
    label: cat.label,
    emoji: cat.emoji,
    value: `global_${key}`
  }));

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('logspanel_global_type')
      .setPlaceholder('Select a global log type...')
      .setOptions(options)
      .setDisabled(disabled)
  );
}

// Build back button row
function buildBackButton(label = '← Back to Categories') {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('logspanel_back')
      .setLabel(label)
      .setStyle(2)
  );
}

export const data = new SlashCommandBuilder()
  .setName('logspanel')
  .setDescription('Open the log channel configuration panel');

export async function execute(interaction) {
  try {
  await interaction.deferReply();

  const guildId = interaction.guildId;
  const embed = buildInfoEmbed(guildId);
  const categoryRow = buildCategorySelect();

  await interaction.editReply({
    content: '⚙️ **Log Configuration Panel**\nUse the selector below to configure log channels.',
    embeds: [embed],
    components: [categoryRow]
  });
  } catch (err) {
    console.error('[logspanel] Error:', err);
    const msg = { content: 'An error occurred. Please try again.', flags: 64 };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg);
    } else {
      await interaction.reply(msg);
    }
  }
}

// Handle select menu interactions
export async function handleSelect(interaction) {
  const customId = interaction.customId;

  // Back button — return to main view
  if (customId === 'logspanel_back' || customId.startsWith('logspanel_back_type_')) {
    const embed = buildInfoEmbed(interaction.guildId);
    const categoryRow = buildCategorySelect();
    await interaction.update({
      content: '⚙️ **Log Configuration Panel**\nUse the selector below to configure log channels.',
      embeds: [embed],
      components: [categoryRow]
    });
    return;
  }

  // Category selected
  if (customId === 'logspanel_category') {
    const value = interaction.values[0];

    // Global Logs category — show global type select
    if (value === 'cat_global_logs') {
      const globalRow = buildGlobalTypeSelect();
      const backRow = buildBackButton();
      const embed = buildInfoEmbed(interaction.guildId);

      await interaction.update({
        content: '🌐 **Global Logs** — Select the global log type to configure, or go back:',
        embeds: [embed],
        components: [globalRow, backRow]
      });
      return;
    }

    // Per-guild category — show type select
    const categoryKey = value.replace('cat_', '');
    const cat = CATEGORIES[categoryKey];
    if (!cat) return;

    const typeRow = buildTypeSelect(categoryKey);
    const backRow = buildBackButton();
    const embed = buildInfoEmbed(interaction.guildId);

    await interaction.update({
      content: `📁 **${cat.emoji} ${cat.label}** — Select the log type to configure, or go back:`,
      embeds: [embed],
      components: [typeRow, backRow]
    });
    return;
  }

  // Global log type selected — show modal
  if (customId === 'logspanel_global_type') {
    const value = interaction.values[0];
    const globalKey = value.replace('global_', '');
    const cat = GLOBAL_CATEGORIES[globalKey];
    if (!cat) return;

    const modal = new ModalBuilder()
      .setCustomId(`logspanel_channel_global_${globalKey}`)
      .setTitle(`${cat.emoji} ${cat.label} — Set Channel`);

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('channel_id')
          .setLabel('Channel ID')
          .setStyle(1)
          .setPlaceholder('Paste the channel ID here, or leave blank to disable')
          .setRequired(false)
      )
    );

    await interaction.showModal(modal);
    return;
  }

  // Per-guild log type selected — show modal
  if (customId.startsWith('logspanel_type_')) {
    const value = interaction.values[0];
    const valuePrefix = 'type_';
    if (!value.startsWith(valuePrefix)) return;

    const rest = value.slice(valuePrefix.length);
    const firstUnderscore = rest.indexOf('_');
    const categoryKey = rest.slice(0, firstUnderscore);
    const typeKey = rest.slice(firstUnderscore + 1);

    const cat = CATEGORIES[categoryKey];
    const type = cat?.types[typeKey];
    if (!cat || !type) return;

    const modal = new ModalBuilder()
      .setCustomId(`logspanel_channel_${categoryKey}_${typeKey}`)
      .setTitle(`Set ${type.label} Channel`);

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('channel_id')
          .setLabel('Channel ID')
          .setStyle(1)
          .setPlaceholder('Paste the channel ID here, or leave blank to disable')
          .setRequired(false)
      )
    );

    await interaction.showModal(modal);
  }
}

// Handle modal submit
export async function handleModal(interaction) {
  const customId = interaction.customId;
  if (!customId) return;

  // Global log channel modal
  if (customId.startsWith('logspanel_channel_global_')) {
    const globalKey = customId.replace('logspanel_channel_global_', '');
    const cat = GLOBAL_CATEGORIES[globalKey];
    if (!cat) return;

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
      setGlobalLogChannel(globalKey, targetChannel.id);
    } else {
      setGlobalLogChannel(globalKey, null);
    }

    const embed = buildInfoEmbed(interaction.guildId);
    const categoryRow = buildCategorySelect();

    await interaction.update({
      content: targetChannel
        ? `✅ ${cat.label} set to ${targetChannel}`
        : `✅ ${cat.label} has been cleared (global logs disabled)`,
      embeds: [embed],
      components: [categoryRow]
    });

    await logAction(interaction.client, {
      action: '⚙️ Global Log Channel Configured',
      target: null,
      moderator: { discordId: interaction.user.id, name: interaction.user.username },
      color: 0x5865F2,
      description: `Global ${cat.label} ${targetChannel ? `set to ${targetChannel}` : 'cleared'} by <@${interaction.user.id}>`,
      guildId: interaction.guildId
    });
    return;
  }

  // Per-guild log channel modal
  if (!customId.startsWith('logspanel_channel_')) return;
  if (customId.startsWith('logspanel_channel_global_')) return; // already handled above

  const rest = customId.replace('logspanel_channel_', '');
  const firstUnderscore = rest.indexOf('_');
  const categoryKey = rest.slice(0, firstUnderscore);
  const typeKey = rest.slice(firstUnderscore + 1);

  const cat = CATEGORIES[categoryKey];
  const type = cat?.types[typeKey];
  if (!cat || !type) return;

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
    setLogChannel(interaction.guildId, categoryKey, typeKey, targetChannel.id);
  } else {
    setLogChannel(interaction.guildId, categoryKey, typeKey, null);
  }

  const embed = buildInfoEmbed(interaction.guildId);
  const categoryRow = buildCategorySelect();

  await interaction.update({
    content: targetChannel
      ? `✅ ${type.label} set to ${targetChannel}`
      : `✅ ${type.label} has been cleared (logs disabled)`,
    embeds: [embed],
    components: [categoryRow]
  });

  await logAction(interaction.client, {
    action: '⚙️ Log Channel Configured',
    target: null,
    moderator: { discordId: interaction.user.id, name: interaction.user.username },
    color: 0x5865F2,
    description: `${type.label} ${targetChannel ? `set to ${targetChannel}` : 'cleared'} by <@${interaction.user.id}>`,
    guildId: interaction.guildId
  });
}
