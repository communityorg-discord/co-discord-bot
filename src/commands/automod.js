import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { db } from '../utils/botDb.js';
import { isSuperuser, canRunCommand } from '../utils/permissions.js';
import { randomBytes } from 'crypto';
import { automod } from '../services/automod.js';

const MODULES = ['spam', 'mention_spam', 'role_mention', 'invite_links', 'new_account', 'raid_detection', 'permission_guard', 'channel_creation_guard', 'role_creation_guard', 'verify_timeout'];
const SETTINGS = ['spam_threshold', 'spam_window_seconds', 'spam_timeout_minutes', 'mention_threshold', 'mention_window_seconds', 'role_mention_threshold', 'new_account_min_age_days', 'raid_join_threshold', 'raid_join_window_seconds', 'verify_warning_hours', 'verify_terminate_hours', 'alert_channel_id', 'quarantine_role_id', 'quarantine_channel_id'];

export const data = new SlashCommandBuilder()
  .setName('automod')
  .setDescription('Configure the AutoMod system')
  .addSubcommand(sub => sub.setName('show').setDescription('Show current AutoMod config'))
  .addSubcommand(sub => sub.setName('enable').setDescription('Enable a module')
    .addStringOption(opt => opt.setName('module').setDescription('Module name').setRequired(true).addChoices(...MODULES.map(m => ({ name: m, value: m })))))
  .addSubcommand(sub => sub.setName('disable').setDescription('Disable a module')
    .addStringOption(opt => opt.setName('module').setDescription('Module name').setRequired(true).addChoices(...MODULES.map(m => ({ name: m, value: m })))))
  .addSubcommand(sub => sub.setName('set').setDescription('Set a config value')
    .addStringOption(opt => opt.setName('setting').setDescription('Setting name').setRequired(true).addChoices(...SETTINGS.map(s => ({ name: s, value: s }))))
    .addStringOption(opt => opt.setName('value').setDescription('New value').setRequired(true)))
  .addSubcommand(sub => sub.setName('incidents').setDescription('Show recent AutoMod incidents'))
  .addSubcommand(sub => sub.setName('immune-add').setDescription('Grant immunity')
    .addStringOption(opt => opt.setName('target_type').setDescription('user/role').setRequired(true).addChoices({ name: 'user', value: 'user' }, { name: 'role', value: 'role' }))
    .addStringOption(opt => opt.setName('target_id').setDescription('User or role ID').setRequired(true))
    .addStringOption(opt => opt.setName('from').setDescription('Immune from what (e.g. spam, invite_links, all)').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Reason').setRequired(false)))
  .addSubcommand(sub => sub.setName('immune-list').setDescription('List immunity entries'))
  .addSubcommand(sub => sub.setName('immune-remove').setDescription('Remove immunity')
    .addIntegerOption(opt => opt.setName('id').setDescription('Immunity ID').setRequired(true)))
  .addSubcommand(sub => sub.setName('request-approval').setDescription('Request temporary elevated access')
    .addStringOption(opt => opt.setName('action').setDescription('What you need to do').setRequired(true).addChoices(
      { name: 'Create Channel', value: 'create_channel' },
      { name: 'Create Role', value: 'create_role' },
      { name: 'Admin Access', value: 'admin_access' },
      { name: 'Other', value: 'other' }
    ))
    .addStringOption(opt => opt.setName('description').setDescription('Describe what you need').setRequired(true)));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (['enable', 'disable', 'set', 'immune-add', 'immune-remove'].includes(sub)) {
    if (!isSuperuser(interaction.user.id)) return interaction.reply({ content: '❌ Superuser only.', ephemeral: true });
  } else if (sub !== 'request-approval') {
    const perm = canRunCommand(interaction.user.id, 5);
    if (!perm.allowed) return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });
  const config = automod.getConfig(guildId);

  if (sub === 'show') {
    const fields = MODULES.map(m => {
      const enabled = config[`${m}_enabled`];
      return { name: m.replace(/_/g, ' '), value: enabled ? '✅ Enabled' : '❌ Disabled', inline: true };
    });
    fields.push({ name: 'Alert Channel', value: config.alert_channel_id ? `<#${config.alert_channel_id}>` : 'Not set', inline: true });
    fields.push({ name: 'Quarantine Role', value: config.quarantine_role_id || 'Auto-create', inline: true });

    await interaction.editReply({ embeds: [new EmbedBuilder()
      .setColor(0x5865F2).setTitle('⚙️ AutoMod Configuration')
      .addFields(...fields).setTimestamp()
    ]});
  }

  else if (sub === 'enable' || sub === 'disable') {
    const module = interaction.options.getString('module');
    const col = `${module}_enabled`;
    db.prepare(`UPDATE automod_config SET ${col} = ?, updated_at = datetime('now') WHERE guild_id = ?`).run(sub === 'enable' ? 1 : 0, guildId);
    await interaction.editReply({ content: `${sub === 'enable' ? '✅' : '❌'} Module **${module}** ${sub}d.` });
  }

  else if (sub === 'set') {
    const setting = interaction.options.getString('setting');
    const value = interaction.options.getString('value');
    if (!SETTINGS.includes(setting)) return interaction.editReply({ content: '❌ Invalid setting.' });
    db.prepare(`UPDATE automod_config SET ${setting} = ?, updated_at = datetime('now') WHERE guild_id = ?`).run(value, guildId);
    await interaction.editReply({ content: `✅ **${setting}** set to \`${value}\`.` });
  }

  else if (sub === 'incidents') {
    const incidents = db.prepare('SELECT * FROM automod_incidents WHERE guild_id = ? ORDER BY created_at DESC LIMIT 10').all(guildId);
    if (incidents.length === 0) return interaction.editReply({ content: 'No recent incidents.' });
    const desc = incidents.map(i => `**${i.incident_type}** | <@${i.target_discord_id || '?'}> | ${i.severity} | ${i.action_taken} | ${new Date(i.created_at).toLocaleDateString('en-GB')}`).join('\n');
    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('📋 Recent AutoMod Incidents').setDescription(desc).setTimestamp()] });
  }

  else if (sub === 'immune-add') {
    const targetType = interaction.options.getString('target_type');
    const targetId = interaction.options.getString('target_id');
    const from = interaction.options.getString('from');
    const reason = interaction.options.getString('reason') || null;
    db.prepare('INSERT OR REPLACE INTO automod_immunity (guild_id, target_type, target_id, immune_from, granted_by, reason) VALUES (?, ?, ?, ?, ?, ?)')
      .run(guildId, targetType, targetId, from, interaction.user.id, reason);
    await interaction.editReply({ content: `✅ Immunity granted: ${targetType} \`${targetId}\` immune from **${from}**.` });
  }

  else if (sub === 'immune-list') {
    const list = db.prepare('SELECT * FROM automod_immunity WHERE guild_id = ? OR guild_id IS NULL').all(guildId);
    if (list.length === 0) return interaction.editReply({ content: 'No immunity entries.' });
    const desc = list.map(i => `**#${i.id}** | ${i.target_type} \`${i.target_id}\` | from: ${i.immune_from}`).join('\n');
    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🛡️ AutoMod Immunity List').setDescription(desc)] });
  }

  else if (sub === 'immune-remove') {
    const id = interaction.options.getInteger('id');
    db.prepare('DELETE FROM automod_immunity WHERE id = ?').run(id);
    await interaction.editReply({ content: `✅ Immunity #${id} removed.` });
  }

  else if (sub === 'request-approval') {
    const actionType = interaction.options.getString('action');
    const description = interaction.options.getString('description');
    const token = randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();

    db.prepare('INSERT INTO approval_requests (guild_id, requester_discord_id, requester_username, action_type, action_description, token, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(guildId, interaction.user.id, interaction.user.tag, actionType, description, token, expiresAt);

    const reqId = db.prepare('SELECT last_insert_rowid() as id').get().id;

    // Post to alert channel for approval
    if (config.alert_channel_id) {
      const alertCh = interaction.client.channels.cache.get(config.alert_channel_id);
      if (alertCh) {
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import('discord.js');
        await alertCh.send({
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
            new ButtonBuilder().setCustomId(`approval_approve_${reqId}`).setLabel('Approve (20 min)').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`approval_deny_${reqId}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
          )]
        });
      }
    }

    await interaction.editReply({ content: '✅ Approval request submitted. An EOB member will review it shortly.' });
  }
}

// Button handler for approval approve/deny
export async function handleButton(interaction) {
  const customId = interaction.customId;

  if (customId.startsWith('approval_approve_')) {
    if (!isSuperuser(interaction.user.id)) {
      const perm = canRunCommand(interaction.user.id, 7);
      if (!perm.allowed) return interaction.reply({ content: '❌ Auth 7+ required to approve.', ephemeral: true });
    }
    const reqId = parseInt(customId.replace('approval_approve_', ''));
    const req = db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(reqId);
    if (!req || req.status !== 'pending') return interaction.reply({ content: '❌ Request not found or already processed.', ephemeral: true });

    const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    db.prepare("UPDATE approval_requests SET status = 'approved', approved_by = ?, expires_at = ? WHERE id = ?").run(interaction.user.id, expiresAt, reqId);

    // DM requester
    try {
      const requester = await interaction.client.users.fetch(req.requester_discord_id);
      await requester.send({ embeds: [new EmbedBuilder()
        .setColor(0x22C55E).setTitle('✅ Approval Granted')
        .setDescription(`Your request for **${req.action_type}** has been approved for 20 minutes.\n\n**Description:** ${req.action_description}`)
        .setFooter({ text: 'This approval expires in 20 minutes' }).setTimestamp()
      ]});
    } catch {}

    await interaction.update({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor(0x22C55E).setTitle('✅ Approved')
      .addFields({ name: 'Approved By', value: `<@${interaction.user.id}>`, inline: true })], components: [] });
  }

  if (customId.startsWith('approval_deny_')) {
    if (!isSuperuser(interaction.user.id)) {
      const perm = canRunCommand(interaction.user.id, 7);
      if (!perm.allowed) return interaction.reply({ content: '❌ Auth 7+ required.', ephemeral: true });
    }
    const reqId = parseInt(customId.replace('approval_deny_', ''));
    db.prepare("UPDATE approval_requests SET status = 'denied', approved_by = ? WHERE id = ?").run(interaction.user.id, reqId);
    await interaction.update({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor(0xEF4444).setTitle('❌ Denied')], components: [] });
  }
}
