import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { logAction } from '../utils/logger.js';
import { setLogChannel, getLogChannel, getAllLogConfig, getGlobalLogChannel, setGlobalLogChannel } from '../utils/botDb.js';

// Per-type log categories — same structure as logspanel
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
      case_action: { label: 'Case Action Logs' },
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
  },
  membership: {
    label: 'Membership',
    emoji: '👥',
    types: {
      member_join: { label: 'Member Join Logs' },
      member_leave: { label: 'Member Leave Logs' },
    }
  },
  email: {
    label: 'Email',
    emoji: '📧',
    types: {
      email_log: { label: 'Email Activity Logs' },
    }
  }
};

// Catch-all org-wide categories — one channel receives ALL logs of a broad type from every server
const CATCHALL_CATEGORIES = {
  global_moderation: {
    label: 'All Moderation',
    emoji: '🛡️',
    description: 'All moderation actions from every server to one channel'
  },
  global_message: {
    label: 'All Message Activity',
    emoji: '💬',
    description: 'All message delete/edit events from every server to one channel'
  },
  global_verification: {
    label: 'All Verification',
    emoji: '✅',
    description: 'All verify/unverify actions from every server to one channel'
  },
  global_role_management: {
    label: 'All Role Management',
    emoji: '🎭',
    description: 'All role changes from every server to one channel'
  },
  global_membership: {
    label: 'All Membership',
    emoji: '👥',
    description: 'All member join/leave events from every server to one channel'
  },
  global_misc: {
    label: 'All Miscellaneous',
    emoji: '📋',
    description: 'All misc logs (brag, staff, user, NID, cases) from every server to one channel'
  },
  global_email_log: {
    label: 'All Email',
    emoji: '📧',
    description: 'All email activity from every server to one channel'
  }
};

function buildOverviewEmbed() {
  const config = getAllLogConfig('orgwide');
  const fields = [];

  // Catch-all bindings
  const catchallLines = [];
  for (const [key, cat] of Object.entries(CATCHALL_CATEGORIES)) {
    const channelId = getGlobalLogChannel(key, 'orgwide');
    catchallLines.push(`${channelId ? '✅' : '❌'} ${cat.emoji} ${cat.label}${channelId ? `: <#${channelId}>` : ''}`);
  }
  fields.push({ name: '📡 Catch-All Channels', value: catchallLines.join('\n'), inline: false });

  // Per-type bindings
  for (const [catKey, cat] of Object.entries(CATEGORIES)) {
    const lines = [];
    for (const [typeKey, type] of Object.entries(cat.types)) {
      const channelId = config[`${catKey}:${typeKey}`];
      lines.push(`${channelId ? '✅' : '❌'} ${type.label}${channelId ? `: <#${channelId}>` : ''}`);
    }
    fields.push({ name: `${cat.emoji} ${cat.label}`, value: lines.join('\n'), inline: true });
  }

  return new EmbedBuilder()
    .setTitle('🏢 Organisation-Wide Log Channels')
    .setColor(0xf59e0b)
    .setDescription('These channels receive logs from **every CO server** — not just this one.\nSelect a category below to configure.')
    .addFields(fields)
    .setFooter({ text: 'Community Organisation | Use /logspanel for per-server logs' })
    .setTimestamp();
}

function buildCategorySelect() {
  const options = [
    {
      label: 'Catch-All Channels',
      emoji: '📡',
      value: 'cat_catchall',
      description: 'One channel per broad category — receives everything'
    },
    ...Object.entries(CATEGORIES).map(([key, cat]) => ({
      label: cat.label,
      emoji: cat.emoji,
      value: `cat_${key}`,
      description: `Configure individual ${cat.label.toLowerCase()} log channels`
    }))
  ];

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('orglogs_category')
      .setPlaceholder('Select a log category to configure...')
      .setOptions(options)
  );
}

function buildTypeSelect(categoryKey) {
  const cat = CATEGORIES[categoryKey];
  if (!cat) return null;

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`orglogs_type_${categoryKey}`)
      .setPlaceholder(`Select a ${cat.label.toLowerCase()} log type...`)
      .setOptions(Object.entries(cat.types).map(([typeKey, type]) => ({
        label: type.label,
        value: `type_${categoryKey}_${typeKey}`,
        description: `Configure ${type.label.toLowerCase()} channel`
      })))
  );
}

function buildCatchallSelect() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('orglogs_catchall_type')
      .setPlaceholder('Select a catch-all log type...')
      .setOptions(Object.entries(CATCHALL_CATEGORIES).map(([key, cat]) => ({
        label: cat.label,
        emoji: cat.emoji,
        value: `catchall_${key}`,
        description: cat.description
      })))
  );
}

function buildBackButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('orglogs_back')
      .setLabel('← Back to Categories')
      .setStyle(ButtonStyle.Secondary)
  );
}

export const data = new SlashCommandBuilder()
  .setName('orglogs')
  .setDescription('Configure organisation-wide log channels (logs from ALL servers)');

export async function execute(interaction) {
  await interaction.deferReply();

  const embed = buildOverviewEmbed();
  const row = buildCategorySelect();

  await interaction.editReply({
    content: '🏢 **Organisation Logs** — These channels receive events from **all CO servers**.\nSelect a category to configure:',
    embeds: [embed],
    components: [row]
  });
}

export async function handleSelect(interaction) {
  const customId = interaction.customId;

  // Back button — return to main view
  if (customId === 'orglogs_back') {
    const embed = buildOverviewEmbed();
    const row = buildCategorySelect();
    await interaction.update({
      content: '🏢 **Organisation Logs** — These channels receive events from **all CO servers**.\nSelect a category to configure:',
      embeds: [embed],
      components: [row]
    });
    return;
  }

  // Category selected
  if (customId === 'orglogs_category') {
    const value = interaction.values[0];

    // Catch-all selected — show catch-all type selector
    if (value === 'cat_catchall') {
      const catchallLines = [];
      for (const [key, cat] of Object.entries(CATCHALL_CATEGORIES)) {
        const channelId = getGlobalLogChannel(key, 'orgwide');
        catchallLines.push(`${cat.emoji} ${cat.label}: ${channelId ? `✅ <#${channelId}>` : '❌ Not set'}`);
      }

      const embed = new EmbedBuilder()
        .setTitle('📡 Organisation Catch-All Channels')
        .setColor(0xf59e0b)
        .setDescription('Catch-all channels receive **all logs of a type** from **every CO server** in one channel. Individual type bindings take priority when set.\n\n' + catchallLines.join('\n'))
        .setFooter({ text: 'Community Organisation | Organisation-Wide Logs' })
        .setTimestamp();

      const selectRow = buildCatchallSelect();
      const backRow = buildBackButton();

      await interaction.update({
        content: '📡 **Catch-All Channels** — Select the log type to configure, or go back:',
        embeds: [embed],
        components: [selectRow, backRow]
      });
      return;
    }

    // Per-type category selected — show types within it
    const categoryKey = value.replace('cat_', '');
    const cat = CATEGORIES[categoryKey];
    if (!cat) return;

    const config = getAllLogConfig('orgwide');
    const typeRows = [];
    for (const [typeKey, type] of Object.entries(cat.types)) {
      const channelId = config[`${categoryKey}:${typeKey}`];
      typeRows.push(`**${type.label}:** ${channelId ? `✅ <#${channelId}>` : '❌ Not set'}`);
    }

    const catEmbed = new EmbedBuilder()
      .setTitle(`🏢 ${cat.emoji} ${cat.label} — Organisation Bindings`)
      .setColor(0xf59e0b)
      .setDescription('These apply to logs from **all CO servers**.')
      .addFields({ name: '​', value: typeRows.join('\n'), inline: false })
      .setFooter({ text: 'Community Organisation | Organisation-Wide Logs' })
      .setTimestamp();

    const typeRow = buildTypeSelect(categoryKey);
    const backRow = buildBackButton();

    await interaction.update({
      content: `🏢 **${cat.emoji} ${cat.label}** — Select the log type to configure:`,
      embeds: [catEmbed],
      components: [typeRow, backRow]
    });
    return;
  }

  // Catch-all type selected — show modal
  if (customId === 'orglogs_catchall_type') {
    const value = interaction.values[0];
    const globalKey = value.replace('catchall_', '');
    const cat = CATCHALL_CATEGORIES[globalKey];
    if (!cat) return;

    const modal = new ModalBuilder()
      .setCustomId(`orglogs_channel_catchall_${globalKey}`)
      .setTitle(`${cat.emoji} ${cat.label} — Set Channel`);

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
    return;
  }

  // Per-type selected within a category — show modal
  if (customId.startsWith('orglogs_type_')) {
    const value = interaction.values[0];
    if (!value.startsWith('type_')) return;

    const rest = value.slice('type_'.length);
    // Match against known category keys (handles underscored keys like role_management)
    const categoryKey = Object.keys(CATEGORIES).find(k => rest.startsWith(k + '_'));
    const typeKey = categoryKey ? rest.slice(categoryKey.length + 1) : null;

    const cat = CATEGORIES[categoryKey];
    const type = cat?.types[typeKey];
    if (!cat || !type) return;

    const modal = new ModalBuilder()
      .setCustomId(`orglogs_channel_${categoryKey}_${typeKey}`)
      .setTitle(`🏢 ${type.label} — Set Channel`);

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
}

export async function handleModal(interaction) {
  if (!interaction.customId.startsWith('orglogs_channel_')) return;

  const rest = interaction.customId.replace('orglogs_channel_', '');

  // Catch-all modal
  if (rest.startsWith('catchall_')) {
    const globalKey = rest.replace('catchall_', '');
    const cat = CATCHALL_CATEGORIES[globalKey];
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
      setGlobalLogChannel(globalKey, targetChannel.id, 'orgwide');
    } else {
      setGlobalLogChannel(globalKey, null, 'orgwide');
    }

    const embed = buildOverviewEmbed();
    const row = buildCategorySelect();

    await interaction.reply({
      content: targetChannel
        ? `✅ ${cat.emoji} **${cat.label}** set to ${targetChannel} — all logs of this type from every server will be sent here.`
        : `✅ ${cat.emoji} **${cat.label}** has been cleared.`,
      embeds: [embed],
      components: [row],
      flags: 64
    });

    await logAction(interaction.client, {
      action: '🏢 Organisation Catch-All Log Configured',
      target: null,
      moderator: { discordId: interaction.user.id, name: interaction.user.username },
      color: 0xf59e0b,
      description: `Org-wide catch-all ${cat.label} ${targetChannel ? `set to ${targetChannel}` : 'cleared'} by <@${interaction.user.id}>`,
      guildId: interaction.guildId
    });
    return;
  }

  // Per-type modal
  // Match against known category keys (handles underscored keys like role_management)
  const categoryKey = Object.keys(CATEGORIES).find(k => rest.startsWith(k + '_'));
  const typeKey = categoryKey ? rest.slice(categoryKey.length + 1) : null;

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
    setLogChannel('orgwide', categoryKey, typeKey, targetChannel.id);
  } else {
    setLogChannel('orgwide', categoryKey, typeKey, null);
  }

  const embed = buildOverviewEmbed();
  const row = buildCategorySelect();

  await interaction.reply({
    content: targetChannel
      ? `✅ ${cat.emoji} **${type.label}** set to ${targetChannel} — logs from all servers will be sent here.`
      : `✅ ${cat.emoji} **${type.label}** has been cleared.`,
    embeds: [embed],
    components: [row],
    flags: 64
  });

  await logAction(interaction.client, {
    action: '🏢 Organisation Log Channel Configured',
    target: null,
    moderator: { discordId: interaction.user.id, name: interaction.user.username },
    color: 0xf59e0b,
    description: `Org-wide ${type.label} ${targetChannel ? `set to ${targetChannel}` : 'cleared'} by <@${interaction.user.id}>`,
    guildId: interaction.guildId
  });
}
