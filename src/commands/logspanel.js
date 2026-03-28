import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, TextInputBuilder, ModalBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { logAction } from '../utils/logger.js';
import { getLogConfig, setLogChannel, getGlobalLogChannel, setGlobalLogChannel, getLogChannel, getAllLogConfig, getAssignmentStats } from '../utils/botDb.js';

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
  },
  global_email_log: {
    label: 'Global Email Log',
    emoji: '🌐',
    description: 'All team inbox email activity logged to one channel'
  }
};

// Build the info embed
function buildInfoEmbed(guildId) {
  const config = getLogConfig(guildId);
  const globalConfig = {};
  for (const [key, cat] of Object.entries(GLOBAL_CATEGORIES)) {
    globalConfig[key] = getGlobalLogChannel(key);
  }

  const fields = [];
  // Assignment stats
  try {
    const stats = getAssignmentStats();
    fields.push({ name: '📋 Assignments This Week', value: `Total: **${stats.total_this_week}** | Completed: **${stats.completed_this_week}** | Overdue: **${stats.overdue}** | Pending: **${stats.pending}**`, inline: false });
  } catch {}

  fields.push({ name: '📌 Instructions', value: '1. Select a category below\n2. Choose a log type\n3. Pick a channel when prompted\n\nGlobal and Orgwide bindings appear after selecting their categories.', inline: false });

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
      label: 'Organisation Logs',
      emoji: '🏢',
      value: 'cat_orgwide'
    },
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

// Build orgwide log type select
const ORGWIDE_LOG_TYPES = [
  { key: 'member_join', label: 'Member Join Logs' },
  { key: 'member_leave', label: 'Member Leave Logs' },
  { key: 'role_change', label: 'Role Change Logs' },
  { key: 'channel_change', label: 'Channel Change Logs' },
  { key: 'message_delete', label: 'Message Delete Logs' },
  { key: 'verification', label: 'Verification Logs' },
  { key: 'mod_action', label: 'Moderation Action Logs' },
  { key: 'case_action', label: 'Case Action Logs' },
  { key: 'dm_log', label: 'DM Logs' },
];

function buildOrgwideTypeSelect(disabled = false) {
  const orgwideTypes = ['member_join', 'member_leave', 'role_change', 'channel_change', 'message_delete', 'verification', 'mod_action', 'case_action', 'dm_log'];
  const orgwideRows = [];
  for (const t of orgwideTypes) {
    const ch = getLogConfig('orgwide', t);
    if (ch) orgwideRows.push(t);
  }

  const options = ORGWIDE_LOG_TYPES.map(({ key, label }) => ({
    label,
    value: `orgwide_${key}`,
    description: orgwideRows.includes(key) ? 'Configured' : 'Not configured'
  }));

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('logspanel_orgwide_type')
      .setPlaceholder('Select an organisation log type...')
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

    // Organisation Logs category — show orgwide type select with global + orgwide bindings
    if (value === 'cat_orgwide') {
      const orgwideTypes = ['member_join', 'member_leave', 'role_change', 'channel_change', 'message_delete', 'verification', 'mod_action', 'case_action', 'dm_log'];
      const orgwideBindings = [];
      for (const t of orgwideTypes) {
        const ch = getLogChannel('orgwide', t, null);
        orgwideBindings.push('[' + t + '] ' + (ch ? '✅ <#' + ch + '>' : '❌ Not set'));
      }

      const orgwideEmbed = new EmbedBuilder()
        .setTitle('🏢 Organisation Log Bindings')
        .setColor(0x5865F2)
        .setDescription('All logs captured here come from **ALL servers**. ' + orgwideBindings.join(' | '))
        .setFooter({ text: 'Community Organisation | Staff Assistant' })
        .setTimestamp();

      const orgwideRow = buildOrgwideTypeSelect();
      const backRow = buildBackButton();

      await interaction.update({
        content: '🏢 **Organisation Logs** — Select the log type to configure, or go back:',
        embeds: [orgwideEmbed],
        components: [orgwideRow, backRow]
      });
      return;
    }

    // Global Logs category — show global type select with per-server global bindings
    if (value === 'cat_global_logs') {
      const globalBindings = [];
      for (const [key, cat] of Object.entries(GLOBAL_CATEGORIES)) {
        const channelId = getGlobalLogChannel(key);
        globalBindings.push(cat.emoji + ' ' + cat.label + ': ' + (channelId ? '✅ <#' + channelId + '>' : '❌ Not set'));
      }
      const globalEmbed = new EmbedBuilder()
        .setTitle('🌐 Global Log Bindings')
        .setColor(0x5865F2)
        .setDescription('Logs captured here are for **this server only**.  ' + globalBindings.join('\n'))
        .setFooter({ text: 'Community Organisation | Staff Assistant' })
        .setTimestamp();

      const globalRow = buildGlobalTypeSelect();
      const backRow = buildBackButton();

      await interaction.update({
        content: '🌐 **Global Logs** — Select the global log type to configure, or go back:',
        embeds: [globalEmbed],
        components: [globalRow, backRow]
      });
      return;
    }

    // Per-guild category — show type select with category-specific bindings
    const categoryKey = value.replace('cat_', '');
    const cat = CATEGORIES[categoryKey];
    if (!cat) return;

    const config = getAllLogConfig(interaction.guildId);
    const typeRows = [];
    for (const [typeKey, type] of Object.entries(cat.types)) {
      const channelId = config[`${categoryKey}:${typeKey}`];
      const status = channelId ? `✅ <#${channelId}>` : '❌ Not set';
      typeRows.push(`**${cat.emoji} ${cat.label} > ${type.label}:** ${status}`);
    }

    const catEmbed = new EmbedBuilder()
      .setTitle(`📁 ${cat.emoji} ${cat.label} — Log Bindings`)
      .setColor(0x5865F2)
      .addFields({ name: '​', value: typeRows.join('\n'), inline: false })
      .setFooter({ text: 'Community Organisation | Staff Assistant' })
      .setTimestamp();

    const typeRow = buildTypeSelect(categoryKey);
    const backRow = buildBackButton();

    await interaction.update({
      content: `📁 **${cat.emoji} ${cat.label}** — Select the log type to configure, or go back:`,
      embeds: [catEmbed],
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

  // Organisation-wide log type selected — show modal
  if (customId === 'logspanel_orgwide_type') {
    const value = interaction.values[0];
    const typeKey = value.replace('orgwide_', '');
    const typeMeta = ORGWIDE_LOG_TYPES.find(t => t.key === typeKey);
    if (!typeMeta) return;

    const modal = new ModalBuilder()
      .setCustomId(`logspanel_channel_orgwide_${typeKey}`)
      .setTitle(`🏢 ${typeMeta.label} — Set Channel`);

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

  // Organisation-wide log channel modal
  if (customId.startsWith('logspanel_channel_orgwide_')) {
    const typeKey = customId.replace('logspanel_channel_orgwide_', '');
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

    const embed = buildInfoEmbed(interaction.guildId);
    const categoryRow = buildCategorySelect();

    await interaction.update({
      content: targetChannel
        ? `✅ ${typeMeta.label} set to ${targetChannel}`
        : `✅ ${typeMeta.label} has been cleared (orgwide logs disabled)`,
      embeds: [embed],
      components: [categoryRow]
    });

    await logAction(interaction.client, {
      action: '⚙️ Org Log Channel Configured',
      target: null,
      moderator: { discordId: interaction.user.id, name: interaction.user.username },
      color: 0x5865F2,
      description: `Orgwide ${typeMeta.label} ${targetChannel ? `set to ${targetChannel}` : 'cleared'} by <@${interaction.user.id}>`,
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
