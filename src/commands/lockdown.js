import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { db } from '../utils/botDb.js';
import { canRunCommand, isSuperuser } from '../utils/permissions.js';
import { logAction } from '../utils/logger.js';

function parseDuration(input) {
  if (!input) return null;
  const match = input.toLowerCase().match(/^(\d+)\s*(m|min|minutes?|h|hr|hours?|d|days?)$/);
  if (!match) return null;
  const num = parseInt(match[1]);
  const unit = match[2].charAt(0);
  const ms = unit === 'm' ? num * 60000 : unit === 'h' ? num * 3600000 : num * 86400000;
  return new Date(Date.now() + ms);
}

// Only snapshot and modify @everyone SendMessages — never touch anything else
async function snapshotAndLock(channel, lockdownId) {
  const guild = channel.guild;
  const everyoneOverwrite = channel.permissionOverwrites.cache.get(guild.id);

  // Record only @everyone's current SendMessages state
  const prevState = everyoneOverwrite?.allow.has('SendMessages')
    ? 'allow'
    : everyoneOverwrite?.deny.has('SendMessages')
      ? 'deny'
      : 'neutral';

  db.prepare(`INSERT OR REPLACE INTO lockdown_permission_snapshots (lockdown_id, guild_id, channel_id, role_id, allow_permissions, deny_permissions)
    VALUES (?, ?, ?, ?, ?, '')`).run(lockdownId, guild.id, channel.id, guild.id, prevState);

  // ONLY set SendMessages to false on @everyone — nothing else
  await channel.permissionOverwrites.edit(guild.id, { SendMessages: false }).catch(() => {});
}

async function restoreChannel(channel, lockdownId) {
  const snapshot = db.prepare('SELECT * FROM lockdown_permission_snapshots WHERE lockdown_id = ? AND channel_id = ? AND role_id = ?')
    .get(lockdownId, channel.id, channel.guild.id);

  if (snapshot) {
    if (snapshot.allow_permissions === 'allow') {
      await channel.permissionOverwrites.edit(channel.guild.id, { SendMessages: true }).catch(() => {});
    } else if (snapshot.allow_permissions === 'deny') {
      // Was already denied — leave it denied
    } else {
      // Was neutral — remove our deny so it inherits
      await channel.permissionOverwrites.edit(channel.guild.id, { SendMessages: null }).catch(() => {});
    }
  } else {
    // No snapshot — safe default: set back to inherit
    await channel.permissionOverwrites.edit(channel.guild.id, { SendMessages: null }).catch(() => {});
  }
}

export async function unlockFromState(lockdownRecord) {
  const guild = await (await import('discord.js')).default?.guilds?.cache?.get(lockdownRecord.guild_id);
  // This is called from cron with the client — we pass client externally
  return lockdownRecord; // placeholder, actual unlock done in cron with client
}

export const data = new SlashCommandBuilder()
  .setName('lockdown')
  .setDescription('Lock or unlock channels, servers, or all CO servers')
  .addSubcommand(sub => sub
    .setName('channel')
    .setDescription('Lock or unlock a channel')
    .addStringOption(opt => opt.setName('action').setDescription('lock or unlock').setRequired(true).addChoices({ name: 'Lock', value: 'lock' }, { name: 'Unlock', value: 'unlock' }))
    .addChannelOption(opt => opt.setName('channel').setDescription('Channel (default: current)').setRequired(false))
    .addStringOption(opt => opt.setName('reason').setDescription('Reason').setRequired(false))
    .addStringOption(opt => opt.setName('duration').setDescription('Auto-unlock after e.g. "2 hours"').setRequired(false))
  )
  .addSubcommand(sub => sub
    .setName('server')
    .setDescription('Lock or unlock all channels in this server')
    .addStringOption(opt => opt.setName('action').setDescription('lock or unlock').setRequired(true).addChoices({ name: 'Lock', value: 'lock' }, { name: 'Unlock', value: 'unlock' }))
    .addStringOption(opt => opt.setName('reason').setDescription('Reason').setRequired(false))
    .addStringOption(opt => opt.setName('duration').setDescription('Auto-unlock after e.g. "2 hours"').setRequired(false))
  )
  .addSubcommand(sub => sub
    .setName('global')
    .setDescription('Lock or unlock ALL CO servers (superuser only)')
    .addStringOption(opt => opt.setName('action').setDescription('lock or unlock').setRequired(true).addChoices({ name: 'Lock', value: 'lock' }, { name: 'Unlock', value: 'unlock' }))
    .addStringOption(opt => opt.setName('reason').setDescription('Reason').setRequired(false))
    .addStringOption(opt => opt.setName('confirm').setDescription('Type CONFIRM for global').setRequired(false))
  );

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const action = interaction.options.getString('action');
  const reason = interaction.options.getString('reason') || 'No reason provided';

  // Auth checks
  if (sub === 'channel') {
    const perm = canRunCommand(interaction.user.id, 5);
    if (!perm.allowed) return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });
  } else if (sub === 'server') {
    const perm = canRunCommand(interaction.user.id, 6);
    if (!perm.allowed) return interaction.reply({ content: `❌ ${perm.reason}`, ephemeral: true });
  } else if (sub === 'global') {
    if (!isSuperuser(interaction.user.id)) return interaction.reply({ content: '❌ Global lockdown is superuser only.', ephemeral: true });
    if (action === 'lock' && interaction.options.getString('confirm') !== 'CONFIRM') {
      return interaction.reply({ content: '❌ Set `confirm` to `CONFIRM` for global lockdown.', ephemeral: true });
    }
  }

  await interaction.deferReply({ ephemeral: true });

  if (sub === 'channel') {
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    const duration = interaction.options.getString('duration');
    const autoUnlock = parseDuration(duration);

    if (action === 'lock') {
      const result = db.prepare(`INSERT INTO lockdown_state (guild_id, channel_id, lockdown_type, locked_by, reason, auto_unlock_at)
        VALUES (?, ?, 'channel', ?, ?, ?)`).run(interaction.guildId, channel.id, interaction.user.id, reason, autoUnlock?.toISOString() || null);
      await snapshotAndLock(channel, result.lastInsertRowid);
      await channel.send({ embeds: [new EmbedBuilder().setColor(0xEF4444).setTitle('🔒 Channel Locked').setDescription(`This channel has been locked.\n**Reason:** ${reason}${autoUnlock ? `\n**Auto-unlock:** <t:${Math.floor(autoUnlock.getTime() / 1000)}:R>` : ''}`).setTimestamp()] });
      await interaction.editReply({ content: `🔒 <#${channel.id}> locked.` });
    } else {
      const lockdown = db.prepare("SELECT * FROM lockdown_state WHERE guild_id = ? AND channel_id = ? AND is_active = 1").get(interaction.guildId, channel.id);
      if (!lockdown) return interaction.editReply({ content: '❌ No active lockdown on this channel.' });
      await restoreChannel(channel, lockdown.id);
      db.prepare("UPDATE lockdown_state SET is_active = 0, unlocked_at = datetime('now') WHERE id = ?").run(lockdown.id);
      db.prepare('DELETE FROM lockdown_permission_snapshots WHERE lockdown_id = ?').run(lockdown.id);
      await channel.send({ embeds: [new EmbedBuilder().setColor(0x22C55E).setTitle('🔓 Channel Unlocked').setDescription('This channel has been unlocked.').setTimestamp()] });
      await interaction.editReply({ content: `🔓 <#${channel.id}> unlocked.` });
    }
  } else if (sub === 'server' || sub === 'global') {
    const guilds = sub === 'global' ? [...interaction.client.guilds.cache.values()] : [interaction.guild];
    let lockedCount = 0;

    for (const guild of guilds) {
      if (action === 'lock') {
        const result = db.prepare(`INSERT INTO lockdown_state (guild_id, lockdown_type, locked_by, reason)
          VALUES (?, ?, ?, ?)`).run(guild.id, sub, interaction.user.id, reason);
        const lockdownId = result.lastInsertRowid;
        const channels = guild.channels.cache.filter(c => c.type === ChannelType.GuildText);
        for (const [, ch] of channels) {
          await snapshotAndLock(ch, lockdownId);
        }
        const sysChannel = guild.systemChannel || channels.first();
        if (sysChannel) {
          await sysChannel.send({ embeds: [new EmbedBuilder().setColor(0x7F1D1D).setTitle(`🚨 ${sub === 'global' ? 'GLOBAL ' : ''}SERVER LOCKDOWN`).setDescription(`All channels locked.\n**Reason:** ${reason}`).setTimestamp()] }).catch(() => {});
        }
        lockedCount++;
      } else {
        const lockdowns = db.prepare("SELECT * FROM lockdown_state WHERE guild_id = ? AND is_active = 1").all(guild.id);
        for (const ld of lockdowns) {
          const channels = guild.channels.cache.filter(c => c.type === ChannelType.GuildText);
          for (const [, ch] of channels) {
            await restoreChannel(ch, ld.id);
          }
          db.prepare("UPDATE lockdown_state SET is_active = 0, unlocked_at = datetime('now') WHERE id = ?").run(ld.id);
          db.prepare('DELETE FROM lockdown_permission_snapshots WHERE lockdown_id = ?').run(ld.id);
        }
        const sysChannel = guild.systemChannel || guild.channels.cache.filter(c => c.type === ChannelType.GuildText).first();
        if (sysChannel) {
          await sysChannel.send({ embeds: [new EmbedBuilder().setColor(0x22C55E).setTitle('🔓 Lockdown Lifted').setDescription('All channels have been unlocked.').setTimestamp()] }).catch(() => {});
        }
        lockedCount++;
      }
    }

    await logAction(interaction.client, {
      action: `${action === 'lock' ? '🔒' : '🔓'} ${sub === 'global' ? 'Global' : 'Server'} Lockdown ${action === 'lock' ? 'Applied' : 'Lifted'}`,
      moderator: { discordId: interaction.user.id, name: interaction.user.username },
      target: { discordId: 'ALL', name: sub === 'global' ? 'All CO Servers' : interaction.guild.name },
      reason,
      color: action === 'lock' ? 0xEF4444 : 0x22C55E,
      fields: [{ name: 'Guilds', value: String(lockedCount), inline: true }]
    });

    await interaction.editReply({ content: `${action === 'lock' ? '🔒' : '🔓'} ${sub === 'global' ? 'Global' : 'Server'} lockdown ${action === 'lock' ? 'applied' : 'lifted'} across ${lockedCount} guild(s).` });
  }
}
