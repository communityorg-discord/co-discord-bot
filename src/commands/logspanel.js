import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, TextInputBuilder, ModalBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import db from '../utils/botDb.js';

// Log categories and their types
const CATEGORIES = {
  moderation: {
    label: 'Moderation',
    emoji: '🛡️',
    types: {
      ban_unban: { label: 'Ban/Unban Logs', channelIdField: 'mod_log_channel_id' },
      gban_ungban: { label: 'Global Ban/Unban Logs', channelIdField: 'mod_log_channel_id' },
      suspend_unsuspend: { label: 'Suspend/Unsuspend Logs', channelIdField: 'mod_log_channel_id' },
      terminate: { label: 'Terminate Logs', channelIdField: 'mod_log_channel_id' },
      strike: { label: 'Strike Logs', channelIdField: 'mod_log_channel_id' },
      infractions_cases: { label: 'Infractions/Cases Logs', channelIdField: 'mod_log_channel_id' },
      investigation: { label: 'Investigation Logs', channelIdField: 'mod_log_channel_id' },
      purge_scribe: { label: 'Purge/Scribe Logs', channelIdField: 'mod_log_channel_id' },
      cooldown: { label: 'Cooldown Logs', channelIdField: 'mod_log_channel_id' },
    }
  },
  verification: {
    label: 'Verification',
    emoji: '✅',
    types: {
      verify_unverify: { label: 'Verify/Unverify Logs', channelIdField: 'mod_log_channel_id' },
      dm: { label: 'DM Logs', channelIdField: 'dm_log_channel_id' },
    }
  },
  message: {
    label: 'Message Activity',
    emoji: '💬',
    types: {
      message_delete: { label: 'Message Delete Logs', channelIdField: 'message_delete_channel_id' },
      message_edit: { label: 'Message Edit Logs', channelIdField: 'message_edit_channel_id' },
    }
  },
  misc: {
    label: 'Miscellaneous',
    emoji: '📋',
    types: {
      brag: { label: 'Brag Logs', channelIdField: 'misc_log_channel_id' },
      staff: { label: 'Staff Logs', channelIdField: 'misc_log_channel_id' },
      user: { label: 'User Logs', channelIdField: 'misc_log_channel_id' },
      nid: { label: 'NID Logs', channelIdField: 'misc_log_channel_id' },
    }
  }
};

// DB table for log config
db.exec(`
  CREATE TABLE IF NOT EXISTS log_config (
    guild_id TEXT NOT NULL,
    category TEXT NOT NULL,
    type TEXT NOT NULL,
    channel_id TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, category, type)
  )
`);

// Get current config for a guild
function getLogConfig(guildId) {
  const rows = db.prepare('SELECT * FROM log_config WHERE guild_id = ?').all(guildId);
  const config = {};
  for (const row of rows) {
    config[`${row.category}:${row.type}`] = row.channel_id;
  }
  return config;
}

// Save a log channel config
function setLogChannel(guildId, category, type, channelId) {
  db.prepare(`
    INSERT INTO log_config (guild_id, category, type, channel_id, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(guild_id, category, type) DO UPDATE SET channel_id = excluded.channel_id, updated_at = CURRENT_TIMESTAMP
  `).run(guildId, category, type, channelId);
}

// Build the info embed
function buildInfoEmbed(guildId) {
  const config = getLogConfig(guildId);

  const rows = [];
  for (const [catKey, cat] of Object.entries(CATEGORIES)) {
    for (const [typeKey, type] of Object.entries(cat.types)) {
      const channelId = config[`${catKey}:${typeKey}`];
      const status = channelId ? `✅ <#${channelId}>` : '❌ Not set';
      rows.push(`**${cat.emoji} ${cat.label} > ${type.label}:** ${status}`);
    }
  }

  return new EmbedBuilder()
    .setTitle('⚙️ Log Channel Configuration Panel')
    .setColor(0x5865F2)
    .setDescription('Configure where different types of logs are sent.\n\nUse the selectors below to set a channel for each log type. All fields are optional — only selected log types will be configured.')
    .addFields(
      { name: 'Instructions', value: '1. Select a category below\n2. Choose a log type\n3. Pick a channel when prompted\n\nAll settings are optional.', inline: false },
      { name: 'Current Configuration', value: rows.join('\n') || 'No logs configured yet', inline: false }
    )
    .setFooter({ text: 'Community Organisation | Staff Assistant' })
    .setTimestamp();
}

// Build category select menu
function buildCategorySelect(disabled = false) {
  const options = Object.entries(CATEGORIES).map(([key, cat]) => ({
    label: cat.label,
    emoji: cat.emoji,
    value: `cat_${key}`
  }));

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('logspanel_category')
      .setPlaceholder('Select a log category...')
      .setOptions(options)
      .setDisabled(disabled)
  );
}

// Build type select menu for a category
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

// Build back button row
function buildBackButton(label = '← Back to Categories') {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('logspanel_back')
      .setLabel(label)
      .setStyle(2)
  );
}

// Build back to type-select button for channel modal
function buildBackToTypeButton(categoryKey) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`logspanel_back_type_${categoryKey}`)
      .setLabel('← Back')
      .setStyle(2)
  );
}

export const data = new SlashCommandBuilder()
  .setName('logspanel')
  .setDescription('Open the log channel configuration panel');

export async function execute(interaction) {
  await interaction.deferReply();

  const guildId = interaction.guildId;

  const embed = buildInfoEmbed(guildId);
  const categoryRow = buildCategorySelect();

  await interaction.editReply({
    content: '⚙️ **Log Configuration Panel**\nUse the selector below to configure log channels.',
    embeds: [embed],
    components: [categoryRow]
  });
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

  // Category selected — show type select for that category
  if (customId === 'logspanel_category') {
    const categoryKey = interaction.values[0].replace('cat_', '');
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

  // Type selected — show modal to pick channel
  if (customId.startsWith('logspanel_type_')) {
    // interaction.values[0] is 'type_categoryKey_typeKey' where typeKey may contain underscores
    // e.g. 'type_moderation_ban_unban' -> category='moderation', type='ban_unban'
    const valuePrefix = 'type_';
    const value = interaction.values[0];
    if (!value.startsWith(valuePrefix)) return;

    const rest = value.slice(valuePrefix.length); // 'moderation_ban_unban'
    const firstUnderscore = rest.indexOf('_');
    const categoryKey = rest.slice(0, firstUnderscore); // 'moderation'
    const typeKey = rest.slice(firstUnderscore + 1); // 'ban_unban'

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
  if (!interaction.customId.startsWith('logspanel_channel_')) return;

  // logspanel_channel_category_type -> extract category and type
  // type can have underscores (e.g. ban_unban), so split from end
  const prefix = 'logspanel_channel_';
  const rest = interaction.customId.slice(prefix.length); // 'moderation_ban_unban'
  const firstUnderscore = rest.indexOf('_');
  const categoryKey = rest.slice(0, firstUnderscore); // 'moderation'
  const typeKey = rest.slice(firstUnderscore + 1); // 'ban_unban'

  const channelIdInput = interaction.fields.getTextInputValue('channel_id').trim();

  const cat = CATEGORIES[categoryKey];
  const type = cat?.types[typeKey];
  if (!cat || !type) return;

  // If channel ID provided, validate it
  let targetChannel = null;
  if (channelIdInput) {
    targetChannel = await interaction.guild.channels.fetch(channelIdInput).catch(() => null);
    if (!targetChannel) {
      return interaction.update({
        content: `❌ Channel ID "${channelIdInput}" not found in this server. Please try again with a valid channel ID.`,
        components: []
      });
    }
    setLogChannel(interaction.guildId, categoryKey, typeKey, targetChannel.id);
  } else {
    // Clear the config for this type
    setLogChannel(interaction.guildId, categoryKey, typeKey, null);
  }

  const config = getLogConfig(interaction.guildId);
  const embed = buildInfoEmbed(interaction.guildId);

  const categoryRow = buildCategorySelect();

  const msg = await interaction.update({
    content: targetChannel
      ? `✅ ${type.label} set to ${targetChannel}`
      : `✅ ${type.label} has been cleared (logs disabled)`,
    embeds: [embed],
    components: [categoryRow]
  });
}
