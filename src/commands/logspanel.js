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

// Server-wide log categories — stored in global_log_config, applies within THIS server only
const SERVER_CATEGORIES = {
  global_moderation: {
    label: 'Server Moderation',
    emoji: '🛡️',
    description: 'All moderation actions in this server sent to one channel'
  },
  global_message: {
    label: 'Server Message Activity',
    emoji: '💬',
    description: 'All message delete/edit events in this server sent to one channel'
  },
  global_verification: {
    label: 'Server Verification',
    emoji: '✅',
    description: 'All verify/unverify actions in this server sent to one channel'
  },
  global_role_management: {
    label: 'Server Role Management',
    emoji: '🎭',
    description: 'All role management actions in this server sent to one channel'
  },
  global_email_log: {
    label: 'Server Email Log',
    emoji: '📧',
    description: 'Team inbox email activity logged in this server'
  }
};

// Build the info embed
function buildInfoEmbed(guildId) {
  const config = getLogConfig(guildId);
  const serverLogConfig = {};
  for (const [key, cat] of Object.entries(SERVER_CATEGORIES)) {
    serverLogConfig[key] = getGlobalLogChannel(key, guildId);
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
    .setDescription('Configure where different types of logs are sent **in this server**.\n\nUse the selectors below to set a channel for each log type. For organisation-wide logs across all servers, use `/orglogs`.')
    .addFields(...fields)
    .setFooter({ text: 'Community Organisation | Staff Assistant' })
    .setTimestamp();
}

// Build category select menu
function buildCategorySelect(disabled = false) {
  const options = [
    {
      label: 'Server Logs',
      emoji: '📡',
      value: 'cat_server_logs',
      description: 'Catch-all log channels for this server'
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

// Build server log type select
function buildServerTypeSelect(disabled = false) {
  const options = Object.entries(SERVER_CATEGORIES).map(([key, cat]) => ({
    label: cat.label,
    emoji: cat.emoji,
    value: `global_${key}`
  }));

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('logspanel_global_type')
      .setPlaceholder('Select a server log type...')
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

    // Server Logs category — catch-all channels for this server
    if (value === 'cat_server_logs') {
      const serverBindings = [];
      for (const [key, cat] of Object.entries(SERVER_CATEGORIES)) {
        const channelId = getGlobalLogChannel(key, interaction.guildId);
        serverBindings.push(cat.emoji + ' ' + cat.label + ': ' + (channelId ? '✅ <#' + channelId + '>' : '❌ Not set'));
      }
      const serverEmbed = new EmbedBuilder()
        .setTitle('📡 Server Log Bindings')
        .setColor(0x5865F2)
        .setDescription('Catch-all log channels for **this server only**. These receive all events of a type happening in this server.\n\n' + serverBindings.join('\n'))
        .setFooter({ text: 'Community Organisation | Staff Assistant' })
        .setTimestamp();

      const serverRow = buildServerTypeSelect();
      const backRow = buildBackButton();

      await interaction.update({
        content: '📡 **Server Logs** — Select the log type to configure, or go back:',
        embeds: [serverEmbed],
        components: [serverRow, backRow]
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
      typeRows.push(`**${cat.emoji} ${type.label}:** ${status}`);
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

  // Server log type selected — show modal
  if (customId === 'logspanel_global_type') {
    const value = interaction.values[0];
    const globalKey = value.replace('global_', '');
    const cat = SERVER_CATEGORIES[globalKey];
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

  // Server log channel modal
  if (customId.startsWith('logspanel_channel_global_')) {
    const globalKey = customId.replace('logspanel_channel_global_', '');
    const cat = SERVER_CATEGORIES[globalKey];
    if (!cat) return;

    const channelIdInput = interaction.fields.getTextInputValue('channel_id').trim();
    let targetChannel = null;

    if (channelIdInput) {
      targetChannel = await interaction.guild.channels.fetch(channelIdInput).catch(() => null);
      if (!targetChannel) {
        return interaction.reply({
          content: `❌ Channel ID "${channelIdInput}" not found in this server.`,
          flags: 64
        });
      }
      setGlobalLogChannel(globalKey, targetChannel.id, interaction.guildId);
    } else {
      setGlobalLogChannel(globalKey, null, interaction.guildId);
    }

    const embed = buildInfoEmbed(interaction.guildId);
    const categoryRow = buildCategorySelect();

    await interaction.reply({
      content: targetChannel
        ? `✅ ${cat.label} set to ${targetChannel}`
        : `✅ ${cat.label} has been cleared (server logs disabled)`,
      embeds: [embed],
      components: [categoryRow],
      flags: 64
    });

    await logAction(interaction.client, {
      action: '⚙️ Server Log Channel Configured',
      target: null,
      moderator: { discordId: interaction.user.id, name: interaction.user.username },
      color: 0x5865F2,
      description: `${cat.label} ${targetChannel ? `set to ${targetChannel}` : 'cleared'} by <@${interaction.user.id}>`,
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
      return interaction.reply({
        content: `❌ Channel ID "${channelIdInput}" not found in this server.`,
        flags: 64
      });
    }
    setLogChannel(interaction.guildId, categoryKey, typeKey, targetChannel.id, 'server');
  } else {
    setLogChannel(interaction.guildId, categoryKey, typeKey, null, 'server');
  }
  const embed = buildInfoEmbed(interaction.guildId);
  const categoryRow = buildCategorySelect();

  await interaction.reply({
    content: targetChannel
      ? `✅ ${type.label} set to ${targetChannel}`
      : `✅ ${type.label} has been cleared`,
    embeds: [embed],
    components: [categoryRow],
    flags: 64
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
